import path from 'node:path';
import { loadConfig } from './config.mjs';
import { exists, isLfsPointer, listFiles, readJson, writeJson } from './fsutil.mjs';
import { VIDEO_EXTENSIONS } from './paths.mjs';
import { probeVideo } from './probe.mjs';
import { draftEdl, offBeatCuts, resolveClips, resolveTime, validateEdl } from './edl.mjs';
import { extractClipFrames } from './frames.mjs';
import { buildCaptionPages, findCaptionFile, loadCaptionFile, mapWordsToTimeline, wordsFromDocument } from './captions.mjs';
import { buildMusic, buildSfx, buildVoice, mixAndMaster, planSfx } from './audio.mjs';

export class PendingInputError extends Error {}

const rel = (paths, p) => path.relative(paths.root, p).split(path.sep).join('/');
const projUrl = (paths, p) => `/proj/${rel(paths, p)}`;

export function assetUrl(paths, ref) {
  if (!ref) return null;
  if (ref.startsWith('vendor:')) return `/vendor/${ref.slice(7)}`;
  if (ref.startsWith('proj:')) return `/proj/${ref.slice(5)}`;
  return projUrl(paths, path.resolve(paths.root, ref));
}

export async function discoverVideos(paths) {
  const files = listFiles(paths.videos, VIDEO_EXTENSIONS);
  const pointers = files.filter(isLfsPointer);
  if (pointers.length) {
    throw new PendingInputError(
      `Estes vídeos ainda são ponteiros do Git LFS (conteúdo não baixado): ${pointers.map((f) => path.basename(f)).join(', ')}.\nRode: git lfs install && git lfs pull`,
    );
  }
  return files;
}

// Quadro que contém o instante t (eventos visuais entram no quadro onde cai a batida).
const toFrame = (t, fps) => Math.floor(t * fps + 1e-6) / fps;

// A primeira palavra entra no início do texto; as demais, uma por batida seguinte.
function placeHookWords(tx, beats, fps) {
  const tokens = tx.text.split(/\s+/).filter(Boolean);
  const after = beats.filter((b) => b > tx.start + 0.2 && b < tx.end);
  const times = after.length >= tokens.length - 1
    ? [tx.start, ...after.slice(0, tokens.length - 1)]
    : tokens.map((_, i) => tx.start + (i * (tx.end - tx.start)) / (tokens.length + 1));
  return tokens.map((text, i) => ({ text, at: Number(toFrame(times[i], fps).toFixed(6)) }));
}

// Textos com tempos resolvidos (âncoras -> linha do tempo) e alinhados à grade de quadros.
function resolveText(tx, clips, beats, fps) {
  const start = toFrame(resolveTime(tx.start, clips), fps);
  // Fim arredondado como as fronteiras de clipe: um texto que termina num corte some junto com ele.
  const end = Math.round(resolveTime(tx.end, clips) * fps) / fps;
  if (tx.type === 'card') {
    const lines = tx.lines.map((l) => ({
      text: l.text,
      accent: Boolean(l.accent),
      at: Number(toFrame(l.at === undefined ? start : resolveTime(l.at, clips), fps).toFixed(6)),
    }));
    return { type: 'card', start, end, lines };
  }
  return { type: tx.type, text: tx.text, start, end, words: placeHookWords({ ...tx, start, end }, beats, fps) };
}

export async function prepare(paths, { log = () => {} } = {}) {
  const cfg = loadConfig(paths);
  const { fps } = cfg.format;
  const warnings = [];

  const files = await discoverVideos(paths);
  if (!files.length) {
    throw new PendingInputError(`Nenhum vídeo em ${rel(paths, paths.videos)}/. Coloque os vídeos originais lá (formatos: ${VIDEO_EXTENSIONS.join(', ')}).`);
  }
  if (files.length !== cfg.expectedVideos) warnings.push(`Esperados ${cfg.expectedVideos} vídeos, encontrados ${files.length}.`);
  log(`Analisando ${files.length} vídeo(s)…`);
  const probes = [];
  for (const f of files) probes.push(await probeVideo(f));
  writeJson(paths.probes, probes);
  const probesByName = Object.fromEntries(probes.map((p) => [p.name, p]));
  for (const p of probes) {
    if (p.hdr) warnings.push(`${p.name}: vídeo HDR (${p.colorTransfer}); será convertido para SDR BT.709.`);
    if (!p.hasAudio) warnings.push(`${p.name}: sem trilha de áudio.`);
  }

  if (!exists(paths.edl)) {
    writeJson(paths.edl, draftEdl(probes));
    log(`EDL de rascunho criada em ${rel(paths, paths.edl)} (vídeos inteiros, em ordem).`);
  }
  const edl = readJson(paths.edl);
  const v = validateEdl(edl, probesByName);
  if (v.errors.length) throw new Error(`EDL inválida (${rel(paths, paths.edl)}):\n- ${v.errors.join('\n- ')}`);
  warnings.push(...v.warnings);
  const clips = resolveClips(edl, fps);
  const duration = clips[clips.length - 1].end;

  log('Extraindo quadros…');
  for (const c of clips) {
    const fr = await extractClipFrames(c, probesByName[c.source], cfg, paths.frames);
    c.frames = { url: `${projUrl(paths, fr.dir)}/`, count: fr.count };
    if (fr.count < fr.expected) warnings.push(`${c.id}: ${fr.count} quadros extraídos, ${fr.expected} esperados (o último será repetido).`);
  }

  const wordsBySource = {};
  const captionSources = [];
  if (cfg.captions.enabled) {
    for (const p of probes) {
      const file = findCaptionFile(paths.captions, p.name);
      if (!file) {
        if (clips.some((c) => c.source === p.name)) warnings.push(`Legendas pendentes: falta entrada/legendas/${path.parse(p.name).name}.(json|srt|vtt).`);
        continue;
      }
      const doc = loadCaptionFile(file);
      if (!doc.reviewed) warnings.push(`${path.basename(file)}: transcrição automática ainda não revisada ("reviewed": false).`);
      wordsBySource[p.name] = wordsFromDocument(doc);
      captionSources.push({ video: p.name, file: rel(paths, file), origin: doc.origin, reviewed: doc.reviewed });
    }
  }
  const captionPages = buildCaptionPages(mapWordsToTimeline(wordsBySource, clips), cfg, edl.emphasis || []);
  // Fala que começa logo no início: a primeira legenda já aparece no quadro 0.
  if (captionPages[0] && captionPages[0].start < 0.3) captionPages[0].start = 0;

  log('Tratando a voz…');
  const voice = await buildVoice(clips, probesByName, cfg, path.join(paths.audio, 'voz.wav'));
  log('Trilha e grade de batidas…');
  const music = await buildMusic(paths, cfg, duration);
  const beatList = music.beats.beats.filter((b) => b < duration);
  const tol = cfg.audio.sfx.snapTolerance;
  for (const o of offBeatCuts(clips, beatList, tol)) {
    warnings.push(`Corte em ${o.cut.toFixed(3)}s (${o.clip}) fora da grade; batida mais próxima: ${o.nearestBeat.toFixed(3)}s.`);
  }

  const f = cfg.brand.fonts;
  const timeline = {
    version: 1,
    format: cfg.format,
    duration,
    frameCount: Math.round(duration * fps),
    brand: {
      name: cfg.brand.name,
      accent: cfg.brand.accent,
      textColor: cfg.brand.textColor,
      shadowColor: cfg.brand.shadowColor,
      logoUrl: assetUrl(paths, cfg.brand.logo),
      fonts: {
        display: { family: f.display.family, weight: f.display.weight, url: assetUrl(paths, f.display.file) },
        ui: { family: f.ui.family, weight: f.ui.weight, url: assetUrl(paths, f.ui.file) },
      },
    },
    safeZone: cfg.safeZone,
    captionStyle: { centerY: cfg.captions.centerY, fontSize: cfg.captions.fontSize, font: cfg.captions.font, highlightActiveWord: cfg.captions.highlightActiveWord },
    motion: cfg.motion,
    seed: cfg.audio.music.seed,
    clips: clips.map(({ index, ...c }) => c),
    captions: captionPages,
    captionSources,
    texts: (edl.texts || []).map((tx) => resolveText(tx, clips, beatList, fps)),
    edlSfx: (edl.sfx || []).map((s) => ({ type: s.type, at: resolveTime(s.at, clips) })),
    beats: { source: music.beats.source, measured: music.beats.measured, bpm: music.beats.bpm, beats: beatList, downbeats: music.beats.downbeats.filter((b) => b < duration) },
  };

  timeline.sfx = planSfx(timeline, cfg);
  for (const e of timeline.sfx.filter((s) => !s.onGrid)) warnings.push(`SFX (${e.reason}) em ${e.requested.toFixed(3)}s fora da grade de batidas.`);
  const sfxFile = timeline.sfx.length ? buildSfx(timeline.sfx, cfg, duration, path.join(paths.audio, 'sfx.wav')) : null;
  log('Mixagem e loudness…');
  const finalAudio = path.join(paths.audio, 'final.wav');
  const loudness = await mixAndMaster({
    voiceFile: voice.file, musicFile: music.file, sfxFile, cfg, duration, outFile: finalAudio, reportFile: path.join(paths.audio, 'loudness.json'),
  });
  if (loudness.warning) warnings.push(loudness.warning);
  else if (!loudness.withinTarget) warnings.push(`Loudness final ${loudness.final.integratedLufs} LUFS / pico ${loudness.final.truePeakDb} dBTP fora do alvo.`);
  timeline.audio = { url: projUrl(paths, finalAudio), loudness: loudness.final ?? null };
  timeline.warnings = warnings;
  writeJson(paths.timeline, timeline);
  return { cfg, timeline, warnings, probes };
}
