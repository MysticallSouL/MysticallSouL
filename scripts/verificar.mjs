#!/usr/bin/env node
// Diagnóstico: dependências, configuração, contrato e estado do material de entrada.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CODE_ROOT, projectPaths, rootFromArgs, AUDIO_EXTENSIONS } from '../lib/paths.mjs';
import { run } from '../lib/proc.mjs';
import { exists, isLfsPointer, listFiles, readJson } from '../lib/fsutil.mjs';
import { loadConfig } from '../lib/config.mjs';
import { lintComposition } from '../lib/lint.mjs';
import { findCaptionFile } from '../lib/captions.mjs';
import { validateEdl } from '../lib/edl.mjs';
import { probeVideo } from '../lib/probe.mjs';
import { discoverVideos } from '../lib/prepare.mjs';
import { launchBrowser } from '../lib/render.mjs';
import { checkGate, currentHash } from '../lib/review.mjs';

const paths = projectPaths(rootFromArgs());
let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => {
  failures++;
  console.log(`  ✗ ${m}`);
};
const pend = (m) => console.log(`  … ${m}`);

console.log('Ferramentas');
const [major] = process.versions.node.split('.').map(Number);
major >= 20 ? ok(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node} (precisa >= 20)`);
try {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-version']);
  ok(stdout.toString().split('\n')[0]);
  const enc = (await run('ffmpeg', ['-hide_banner', '-encoders'])).stdout.toString();
  const flt = (await run('ffmpeg', ['-hide_banner', '-filters'])).stdout.toString();
  for (const e of ['libx264', 'aac']) (new RegExp(`\\s${e}\\s`).test(enc) ? ok : fail)(`codificador ${e}`);
  for (const f of ['loudnorm', 'ebur128', 'sidechaincompress', 'afftdn', 'deesser', 'acompressor', 'alimiter', 'zscale', 'tonemap']) {
    (new RegExp(`\\s${f}\\s`).test(flt) ? ok : fail)(`filtro ${f}`);
  }
  await run('ffprobe', ['-version']);
  ok('ffprobe');
} catch (e) {
  fail(`FFmpeg/ffprobe indisponível: ${e.message.split('\n')[0]}`);
}
try {
  const require = createRequire(path.join(CODE_ROOT, 'package.json'));
  ok(`playwright ${require('playwright/package.json').version}`);
  const browser = await launchBrowser();
  ok(`Chromium ${browser.version()}`);
  await browser.close();
} catch (e) {
  fail(`Playwright/Chromium: ${e.message.split('\n')[0]} — rode "npm install" e "npx playwright install chromium"`);
}

console.log('\nProjeto');
let cfg;
try {
  cfg = loadConfig(paths);
  ok(`configuração válida (${cfg.format.width}x${cfg.format.height} @ ${cfg.format.fps} fps CFR)`);
  if (cfg.brand.accentProvisional) pend(`cor de destaque ${cfg.brand.accent} é PROVISÓRIA (brand.accentProvisional = true) — confirmar com a marca`);
  if (!cfg.brand.name) pend('nome da marca não definido em projeto/config.json (brand.name)');
  for (const [role, f] of Object.entries(cfg.brand.fonts)) {
    const file = f.file.startsWith('vendor:') ? path.join(CODE_ROOT, 'node_modules', f.file.slice(7)) : path.resolve(paths.root, f.file.replace(/^proj:/, ''));
    exists(file) ? ok(`fonte ${role}: ${f.family}`) : fail(`fonte ${role} não encontrada: ${file}`);
  }
} catch (e) {
  fail(e.message);
}
const lint = lintComposition();
lint.length ? lint.forEach((p) => fail(`contrato: ${p}`)) : ok('composição respeita o contrato (sem Math.random, timers, rAF, transições CSS)');
if (exists(paths.briefing) && /STATUS:\s*PENDENTE/.test(fs.readFileSync(paths.briefing, 'utf8'))) {
  pend('briefing editorial ainda PENDENTE (projeto/briefing.md)');
}

console.log('\nMaterial de entrada');
let videos = [];
try {
  videos = await discoverVideos(paths);
} catch (e) {
  fail(e.message);
}
if (!videos.length) pend(`nenhum vídeo em entrada/videos/ (esperados ${cfg?.expectedVideos ?? 3})`);
const probesByName = {};
for (const v of videos) {
  try {
    const p = await probeVideo(v);
    probesByName[p.name] = p;
    ok(`${p.name}: ${p.width}x${p.height}, ${p.duration.toFixed(2)} s, ${p.fps?.toFixed(2)} fps, ${p.hasAudio ? 'com' : 'SEM'} áudio${p.hdr ? ', HDR' : ''}`);
    const cap = findCaptionFile(paths.captions, p.name);
    if (cap) {
      const reviewed = cap.endsWith('.json') ? readJson(cap).reviewed === true : true;
      (reviewed ? ok : pend)(`  legendas: ${path.basename(cap)}${reviewed ? '' : ' (transcrição automática NÃO revisada)'}`);
    } else pend(`  legendas pendentes: entrada/legendas/${path.parse(p.name).name}.srt|.vtt|.json`);
  } catch (e) {
    fail(`${path.basename(v)}: ${e.message.split('\n')[0]}`);
  }
}
if (videos.length && cfg && videos.length !== cfg.expectedVideos) pend(`encontrados ${videos.length} vídeos; o projeto espera ${cfg.expectedVideos}`);
if (cfg?.audio.music.mode === 'file') {
  const m = listFiles(paths.music, AUDIO_EXTENSIONS)[0];
  m && !isLfsPointer(m) ? ok(`trilha: ${path.basename(m)}`) : fail('audio.music.mode = "file" mas não há trilha em entrada/musica/');
} else if (cfg) ok(`trilha: ${cfg.audio.music.mode === 'synth' ? `sintetizada em código (${cfg.audio.music.bpm} BPM)` : 'nenhuma'}`);

console.log('\nEdição e revisão');
if (!exists(paths.edl)) pend('projeto/edl.json ainda não existe (será criado como rascunho no primeiro "npm run preparar")');
else {
  const edl = readJson(paths.edl);
  const v = validateEdl(edl, probesByName);
  v.errors.forEach((e) => fail(`EDL: ${e}`));
  v.warnings.forEach((w) => pend(`EDL: ${w}`));
  if (!v.errors.length) ok(`EDL válida: ${edl.clips.length} clipe(s), ${(edl.texts || []).length} texto(s)`);
}
if (exists(paths.timeline) && cfg) {
  const gate = checkGate(paths, cfg, currentHash(paths));
  gate.ok ? ok('revisão aprovada para o corte atual — render final liberado') : pend(`render final bloqueado: ${gate.reasons[0]}`);
} else pend('linha do tempo ainda não gerada');

console.log(failures ? `\n${failures} problema(s) impedem o uso.` : '\nInfraestrutura pronta. Itens "…" dependem do material ou do briefing.');
process.exitCode = failures ? 1 : 0;
