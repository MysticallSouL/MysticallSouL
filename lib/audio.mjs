import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, listFiles, writeJson } from './fsutil.mjs';
import { AUDIO_EXTENSIONS } from './paths.mjs';
import { ffmpeg, run } from './proc.mjs';
import { writeWav, decodeMono } from './wav.mjs';
import { renderScore, renderSfx } from './synth.mjs';
import { detectBeats } from './beats.mjs';
import { nearestBeat } from './edl.mjs';

const dbToLin = (db) => Math.pow(10, db / 20);

// 1) Voz: recorta o áudio original de cada clipe na ordem da EDL e aplica o tratamento.
export async function buildVoice(clips, probesByName, cfg, outFile) {
  const sr = cfg.audio.sampleRate;
  const v = cfg.audio.voice;
  const args = [];
  const chains = [];
  clips.forEach((c, k) => {
    const p = probesByName[c.source];
    const len = c.out - c.in;
    if (p.hasAudio) args.push('-ss', c.in.toFixed(4), '-t', len.toFixed(4), '-i', p.file);
    else args.push('-f', 'lavfi', '-t', len.toFixed(4), '-i', `anullsrc=r=${sr}:cl=mono`);
    const samples = Math.round(c.duration * sr);
    const tempo = c.speed !== 1 ? `,atempo=${c.speed}` : '';
    // Microfades nas bordas de cada trecho: evitam estalos nas emendas da fala.
    const fade = Math.min(cfg.audio.edgeFadeMs / 1000, c.duration / 4);
    const edges = fade > 0 ? `,afade=t=in:d=${fade.toFixed(4)},afade=t=out:st=${(c.duration - fade).toFixed(4)}:d=${fade.toFixed(4)}` : '';
    chains.push(
      `[${k}:a]aresample=${sr},aformat=sample_fmts=fltp:channel_layouts=mono${tempo},volume=${c.volume},apad,atrim=end_sample=${samples},asetpts=N/SR/TB${edges}[a${k}]`,
    );
  });
  const treat = [
    v.highpassHz ? `highpass=f=${v.highpassHz}` : null,
    v.denoise ? 'afftdn=nf=-25:tn=1' : null,
    v.deess ? 'deesser=i=0.4' : null,
    v.compress ? 'acompressor=threshold=0.1:ratio=3:attack=8:release=160:makeup=2' : null,
    v.gainDb ? `volume=${v.gainDb}dB` : null,
  ].filter(Boolean);
  const concat = `${clips.map((_, k) => `[a${k}]`).join('')}concat=n=${clips.length}:v=0:a=1${treat.length ? `,${treat.join(',')}` : ''}[voz]`;
  ensureDir(path.dirname(outFile));
  await ffmpeg([...args, '-filter_complex', [...chains, concat].join(';'), '-map', '[voz]', '-ar', String(sr), '-c:a', 'pcm_f32le', outFile]);
  return { file: outFile, hasSpeech: clips.some((c) => probesByName[c.source].hasAudio) };
}

// 2) Trilha: sintetizada, fornecida (entrada/musica/) ou nenhuma. Depois mede a grade de batidas.
export async function buildMusic(paths, cfg, duration) {
  const m = cfg.audio.music;
  const sr = cfg.audio.sampleRate;
  const out = path.join(paths.audio, 'trilha.wav');
  let source = m.mode;
  let musicFile = null;
  if (m.mode === 'file') {
    musicFile = listFiles(paths.music, AUDIO_EXTENSIONS)[0];
    if (!musicFile) throw new Error('audio.music.mode = "file", mas não há arquivo em entrada/musica/.');
    await ffmpeg([
      '-stream_loop', '-1', '-i', musicFile, '-t', duration.toFixed(4),
      '-af', `aresample=${sr},aformat=channel_layouts=stereo,afade=t=out:st=${Math.max(0, duration - 0.6).toFixed(3)}:d=0.6`,
      '-c:a', 'pcm_f32le', out,
    ]);
  } else if (m.mode === 'synth') {
    writeWav(out, renderScore({ bpm: m.bpm, duration, seed: m.seed, sampleRate: sr, style: m.style }), sr);
  }
  let beats;
  if (m.mode === 'none') {
    // Sem música não há o que medir: grade nominal pelo BPM configurado, marcada como não medida.
    const step = 60 / m.bpm;
    const list = [];
    for (let t = 0; t <= duration; t += step) list.push(Number(t.toFixed(4)));
    beats = { source: 'nominal', measured: false, bpm: m.bpm, beats: list, downbeats: list.filter((_, i) => i % 4 === 0), confidence: null };
  } else {
    const pcm = await decodeMono(out, 22050);
    const r = detectBeats(pcm, 22050, { preferBpm: m.mode === 'synth' ? m.bpm : m.expectedBpm ?? 115 });
    beats = { source: source === 'synth' ? 'trilha-sintetizada' : path.basename(musicFile), measured: true, ...r };
    if (m.mode === 'synth' && Math.abs(r.bpm - m.bpm) > 1) {
      throw new Error(`Medição da trilha sintetizada divergiu: esperado ${m.bpm} BPM, medido ${r.bpm} BPM.`);
    }
  }
  writeJson(paths.beats, beats);
  return { file: m.mode === 'none' ? null : out, beats };
}

// Eventos sonoros: cortes, palavras do gancho e efeitos manuais da EDL, encaixados na grade medida.
export function planSfx(timeline, cfg) {
  const s = cfg.audio.sfx;
  if (!s.enabled) return [];
  const beats = timeline.beats.beats;
  const events = [];
  for (const c of timeline.clips.slice(1)) {
    const type = c.transitionIn === 'whip' ? 'whoosh' : s.onCuts;
    if (type && type !== 'none') events.push({ type, at: c.start, reason: `corte ${c.id}` });
  }
  for (const tx of timeline.texts) {
    if (tx.type !== 'hook' || !s.onHookWords || s.onHookWords === 'none') continue;
    for (const w of tx.words) events.push({ type: s.onHookWords, at: w.at, reason: 'palavra do gancho', gain: 0.6 });
  }
  for (const e of timeline.edlSfx) events.push({ type: e.type, at: e.at, reason: 'EDL' });
  return events.map((e) => {
    const b = beats.length ? nearestBeat(e.at, beats) : null;
    const onGrid = b !== null && Math.abs(b - e.at) <= s.snapTolerance;
    return { ...e, at: onGrid ? b : e.at, requested: e.at, onGrid };
  });
}

export function buildSfx(events, cfg, duration, outFile) {
  const sr = cfg.audio.sampleRate;
  writeWav(outFile, renderSfx(events, { duration, seed: cfg.audio.music.seed, sampleRate: sr }), sr);
  return outFile;
}

function parseLoudnormJson(stderr) {
  const i = stderr.lastIndexOf('{');
  const j = stderr.lastIndexOf('}');
  return JSON.parse(stderr.slice(i, j + 1));
}

export async function measureLoudness(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const grab = (re) => {
    const m = summary.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    integratedLufs: grab(/I:\s+(-?[\d.]+|-inf) LUFS/),
    loudnessRange: grab(/LRA:\s+(-?[\d.]+) LU/),
    truePeakDb: grab(/Peak:\s+(-?[\d.]+|-inf) dBFS/),
  };
}

// 3) Mixagem: voz + trilha com ducking pela voz + efeitos, normalizada em duas passagens (EBU R128).
export async function mixAndMaster({ voiceFile, musicFile, sfxFile, cfg, duration, outFile, reportFile }) {
  const a = cfg.audio;
  const sr = a.sampleRate;
  const inputs = ['-i', voiceFile];
  const parts = ['[0:a]aformat=channel_layouts=stereo,asplit=2[v][vk]'];
  const mixIn = ['[v]'];
  let idx = 1;
  if (musicFile) {
    inputs.push('-i', musicFile);
    const duck = a.music.duck ? '[mraw][vk]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=450[m]' : '[mraw]anull[m];[vk]anullsink';
    parts.push(`[${idx}:a]volume=${dbToLin(a.music.gainDb).toFixed(5)}[mraw]`, duck);
    mixIn.push('[m]');
    idx++;
  } else parts.push('[vk]anullsink');
  if (sfxFile) {
    inputs.push('-i', sfxFile);
    parts.push(`[${idx}:a]volume=${dbToLin(a.sfx.gainDb).toFixed(5)}[s]`);
    mixIn.push('[s]');
  }
  parts.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0:duration=first,atrim=end=${duration.toFixed(4)}[mix]`);
  const premix = path.join(path.dirname(outFile), 'premix.wav');
  await ffmpeg([...inputs, '-filter_complex', parts.join(';'), '-map', '[mix]', '-ar', String(sr), '-c:a', 'pcm_f32le', premix]);

  const target = `I=${a.targetLufs}:TP=${a.truePeak}:LRA=11`;
  const pass1 = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', premix, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  const m1 = parseLoudnormJson(pass1.stderr);
  const report = { target: { lufs: a.targetLufs, truePeak: a.truePeak }, pass1: m1 };
  if (!Number.isFinite(Number(m1.input_i)) || Number(m1.input_i) < -70) {
    fs.copyFileSync(premix, outFile);
    report.warning = 'Mixagem praticamente silenciosa: normalização não aplicada.';
  } else {
    const measured = `measured_I=${m1.input_i}:measured_TP=${m1.input_tp}:measured_LRA=${m1.input_lra}:measured_thresh=${m1.input_thresh}:offset=${m1.target_offset}`;
    await ffmpeg(['-i', premix, '-af', `loudnorm=${target}:${measured}:linear=true,aresample=${sr}`, '-ar', String(sr), '-c:a', 'pcm_s24le', outFile]);
    let final = await measureLoudness(outFile);
    // Ajuste fino se o modo linear não chegou ao alvo (ex.: limitado pelo true peak).
    if (Math.abs(final.integratedLufs - a.targetLufs) > a.lufsTolerance) {
      const tmp = `${outFile}.tmp.wav`;
      const gain = a.targetLufs - final.integratedLufs;
      await ffmpeg(['-i', outFile, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=${dbToLin(a.truePeak - 0.3).toFixed(4)}:level=false,aresample=${sr}`, '-c:a', 'pcm_s24le', tmp]);
      fs.renameSync(tmp, outFile);
      report.correctionDb = Number(gain.toFixed(2));
      final = await measureLoudness(outFile);
    }
    report.final = final;
    report.withinTarget = Math.abs(final.integratedLufs - a.targetLufs) <= a.lufsTolerance && final.truePeakDb <= a.truePeak + 0.1;
  }
  writeJson(reportFile, report);
  return report;
}
