#!/usr/bin/env node
// Ponto de entrada da renderização (contrato: `node render.mjs`).
//
//   node render.mjs                    render final (exige revisão aprovada: todas as notas >= 8)
//   node render.mjs --contact-sheet    um quadro por batida em folhas de contato + relatório
//   node render.mjs --frame 3.5        um quadro isolado (PNG) para inspeção
//   node render.mjs --range 2:6        trecho em MP4 para checar movimento (não é entrega)
//   --projeto <dir>                    usa outra raiz de projeto (testes)
import fs from 'node:fs';
import path from 'node:path';
import { projectPaths, rootFromArgs } from './lib/paths.mjs';
import { ensureDir, writeJson } from './lib/fsutil.mjs';
import { log } from './lib/proc.mjs';
import { prepare, PendingInputError } from './lib/prepare.mjs';
import { openComposition, renderFrameList, captureAt, frameIndexAt } from './lib/render.mjs';
import { encodeVideo, verifyOutput } from './lib/encode.mjs';
import { buildContactSheets, checkGate, currentHash, noveltyGaps, writeReviewReport, CRITERIA } from './lib/review.mjs';
import { lintComposition } from './lib/lint.mjs';
import { ffmpeg } from './lib/proc.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

function printWarnings(warnings) {
  if (!warnings.length) return;
  log('\nAvisos:');
  for (const w of warnings) log(`  ! ${w}`);
}

async function renderRange(paths, cfg, timeline, a, b, { workers }) {
  const fps = cfg.format.fps;
  const first = frameIndexAt(a, fps);
  const last = Math.min(timeline.frameCount, Math.round(b * fps));
  const dir = path.join(paths.renderFrames, `trecho-${first}-${last}`);
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  const jobs = [];
  for (let n = first; n < last; n++) jobs.push({ t: n / fps, file: path.join(dir, `${String(n - first).padStart(6, '0')}.jpg`) });
  const comp = await openComposition(paths, timeline, { workers });
  try {
    const t0 = Date.now();
    await renderFrameList(comp, jobs, {
      quality: cfg.render.jpegQuality,
      onProgress: (d, n) => log(`  quadros ${d}/${n} (${((Date.now() - t0) / d).toFixed(0)} ms/quadro)`),
    });
  } finally {
    await comp.close();
  }
  return { dir, count: jobs.length, first };
}

async function main() {
  const paths = projectPaths(rootFromArgs(argv));
  const problems = lintComposition();
  if (problems.length) throw new Error(`A composição viola o contrato de renderização:\n- ${problems.join('\n- ')}`);

  const { cfg, timeline, warnings } = await prepare(paths, { log });
  const workers = Math.max(1, Number(value('--workers')) || cfg.render.workers);
  const hash = currentHash(paths);

  if (flag('--frame')) {
    const t = Number(value('--frame'));
    if (!Number.isFinite(t)) throw new Error('Uso: node render.mjs --frame <segundos>');
    const file = path.join(paths.build, 'quadros', `t_${t.toFixed(3)}.png`);
    ensureDir(path.dirname(file));
    const comp = await openComposition(paths, timeline);
    try {
      const n = frameIndexAt(t, cfg.format.fps);
      await captureAt(comp.pages[0], n / cfg.format.fps, file);
    } finally {
      await comp.close();
    }
    log(`Quadro salvo: ${file}`);
    printWarnings(warnings);
    return;
  }

  if (flag('--range')) {
    const [a, b] = String(value('--range')).split(':').map(Number);
    if (!(a >= 0 && b > a)) throw new Error('Uso: node render.mjs --range <inicio>:<fim> (segundos)');
    const out = path.join(paths.reviewBuild, `trecho_${a}-${b}.mp4`);
    ensureDir(path.dirname(out));
    const r = await renderRange(paths, cfg, timeline, a, b, { workers });
    const audioTrim = path.join(r.dir, 'audio.wav');
    await ffmpeg(['-ss', (r.first / cfg.format.fps).toFixed(4), '-t', (r.count / cfg.format.fps).toFixed(4), '-i', path.join(paths.audio, 'final.wav'), audioTrim]);
    await encodeVideo({ framesPattern: path.join(r.dir, '%06d.jpg'), audioFile: audioTrim, outFile: out, cfg, frameCount: r.count });
    log(`Trecho para revisão (não é entrega): ${out}`);
    printWarnings(warnings);
    return;
  }

  if (flag('--contact-sheet')) {
    const comp = await openComposition(paths, timeline, { workers });
    let sheets;
    try {
      sheets = await buildContactSheets(paths, cfg, timeline, comp);
    } finally {
      await comp.close();
    }
    const gaps = noveltyGaps(timeline);
    const report = {
      hash,
      duration: timeline.duration,
      beats: { bpm: timeline.beats.bpm, measured: timeline.beats.measured, count: sheets.frames },
      sheets: sheets.sheets.map((s) => path.relative(paths.root, s)),
      noveltyGaps: gaps,
      lowChangeBeats: sheets.novelty.filter((x) => x.change < 0.01),
      loudness: timeline.audio.loudness,
      warnings,
    };
    writeReviewReport(paths, report);
    log('\nFolhas de contato (um quadro por batida):');
    for (const s of sheets.sheets) log(`  ${s}`);
    log(`\nHash do corte: ${hash}`);
    if (gaps.length) log(`Intervalos sem novidade > 4 s: ${gaps.map((g) => `${g.from}–${g.to}s`).join(', ')}`);
    log('\nOLHE as folhas e registre a rodada em revisao/scorecard.json com notas 1–10 para:');
    for (const [k, d] of Object.entries(CRITERIA)) log(`  ${k.padEnd(12)} ${d}`);
    log(`Depois corrija os 3 piores problemas e repita até todas as notas >= ${cfg.review.minScore}.`);
    printWarnings(warnings);
    return;
  }

  // Render final: só depois da revisão aprovada para este exato corte.
  const gate = checkGate(paths, cfg, hash);
  if (!gate.ok) {
    log('Render final bloqueado — o ciclo de revisão do contrato ainda não foi cumprido:');
    for (const r of gate.reasons) log(`  - ${r}`);
    log('\nRode `node render.mjs --contact-sheet`, olhe as folhas, registre as notas e corrija até todas ficarem >= 8.');
    process.exitCode = 2;
    return;
  }
  const fps = cfg.format.fps;
  const r = await renderRange(paths, cfg, timeline, 0, timeline.duration, { workers });
  ensureDir(paths.output);
  const out = path.join(paths.output, `${cfg.output.name}.mp4`);
  log('Codificando H.264…');
  await encodeVideo({ framesPattern: path.join(r.dir, '%06d.jpg'), audioFile: path.join(paths.audio, 'final.wav'), outFile: out, cfg, frameCount: timeline.frameCount });
  const ver = await verifyOutput(out, cfg, timeline.frameCount);
  writeJson(path.join(paths.output, `${cfg.output.name}.json`), {
    hash,
    review: gate.last,
    duration: timeline.duration,
    frames: timeline.frameCount,
    fps,
    loudness: timeline.audio.loudness,
    checks: ver.checks,
    warnings,
  });
  for (const c of ver.checks) log(`  ${c.ok ? '✓' : '✗'} ${c.name} (${c.got})`);
  if (!ver.ok) {
    process.exitCode = 1;
    log('O arquivo final não passou em todas as verificações.');
  } else log(`\nVídeo final: ${out}`);
  printWarnings(warnings);
}

main().catch((e) => {
  if (e instanceof PendingInputError) {
    log(`Aguardando material: ${e.message}`);
    process.exitCode = 3;
  } else {
    console.error(e.message || e);
    process.exitCode = 1;
  }
});
