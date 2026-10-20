// Ponta a ponta com material SINTÉTICO de teste (padrões do FFmpeg), nunca com os vídeos reais.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createFixtureProject } from '../helpers/fixtures.mjs';
import { projectPaths, CODE_ROOT } from '../../lib/paths.mjs';
import { prepare, PendingInputError } from '../../lib/prepare.mjs';
import { openComposition } from '../../lib/render.mjs';
import { currentHash, CRITERIA } from '../../lib/review.mjs';
import { measureLoudness } from '../../lib/audio.mjs';
import { readJson, writeJson } from '../../lib/fsutil.mjs';

let root;
let paths;
let prepared;
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const renderCli = (...args) => spawnSync('node', [path.join(CODE_ROOT, 'render.mjs'), '--projeto', root, ...args], { encoding: 'utf8' });

before(async () => {
  root = await createFixtureProject({ seconds: 3 });
  paths = projectPaths(root);
  prepared = await prepare(paths);
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('sem vídeos: erro de material pendente, não falha genérica', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-vazio-'));
  await assert.rejects(prepare(projectPaths(empty)), PendingInputError);
});

test('preparação: linha do tempo, quadros, grade medida e loudness', () => {
  const tl = prepared.timeline;
  assert.equal(tl.duration, 6);
  assert.equal(tl.frameCount, 96);
  assert.deepEqual(tl.clips.map((c) => [c.start, c.end]), [[0, 2], [2, 4], [4, 6]]);
  for (const c of tl.clips) assert.equal(c.frames.count, 32, `${c.id}: ${c.frames.count} quadros`);
  assert.equal(tl.beats.measured, true);
  assert.ok(Math.abs(tl.beats.bpm - 120) < 1, `bpm ${tl.beats.bpm}`);
  assert.ok(fs.existsSync(paths.beats));
  assert.ok(tl.sfx.length > 0 && tl.sfx.every((s) => s.onGrid));
  assert.ok(tl.captions.length >= 4, 'legendas dos vídeos A e B');
  assert.ok(tl.captions.every((p) => p.words.every((w) => w.text === w.text.toLocaleUpperCase('pt-BR'))));
  assert.ok(prepared.warnings.some((w) => w.includes('Legendas pendentes') && w.includes('teste-c')));
  assert.equal(tl.texts[0].words[0].at, 0, 'gancho começa no quadro 0');
  const card = tl.texts.find((x) => x.type === 'card');
  assert.deepEqual(card.lines.map((l) => l.at), [2.5, 3.25], 'âncoras {clip, t} resolvidas para a linha do tempo');
  assert.ok(tl.captions.some((p) => p.words.some((w) => w.em && w.text === 'TEMPO')), 'destaque pontual aplicado');
  const l = tl.audio.loudness;
  assert.ok(Math.abs(l.integratedLufs + 14) <= 0.5, `LUFS ${l.integratedLufs}`);
  assert.ok(l.truePeakDb <= -0.9, `pico ${l.truePeakDb}`);
});

test('re-preparar reaproveita quadros e produz o mesmo hash (determinismo da preparação)', async () => {
  const h1 = currentHash(paths);
  await prepare(paths);
  assert.equal(currentHash(paths), h1);
});

test('seek(t) é função pura do tempo: mesma imagem independentemente da ordem e da aba', async () => {
  const comp = await openComposition(paths, prepared.timeline, { workers: 2 });
  try {
    const [p1, p2] = comp.pages;
    const shot = async (page, t) => {
      await page.evaluate((x) => window.seek(x), t);
      return md5(await page.screenshot({ type: 'png' }));
    };
    for (const t of [0, 0.5, 1.0625, 2.0, 2.0625, 3.9375, 4.5, 5.5]) {
      const a = await shot(p1, t);
      await shot(p1, 5.9375 - t);
      const b = await shot(p1, t);
      const c = await shot(p2, t);
      assert.equal(a, b, `t=${t}: muda conforme o quadro anterior`);
      assert.equal(a, c, `t=${t}: muda entre abas`);
    }
    assert.notEqual(await shot(p1, 0), await shot(p1, 0.0625), 'quadros consecutivos do gancho devem diferir');
    for (const t of [2.75, 3.5]) {
      const a = await shot(p1, t);
      await shot(p1, 0.3);
      assert.equal(a, await shot(p1, t), `cartão em t=${t} depende do quadro anterior`);
    }
    assert.deepEqual(comp.errors, []);
  } finally {
    await comp.close();
  }
});

test('folha de contato, trava de revisão e render final H.264', () => {
  const cs = renderCli('--contact-sheet');
  assert.equal(cs.status, 0, cs.stderr + cs.stdout);
  const report = readJson(path.join(paths.reviewBuild, 'report.json'));
  assert.ok(report.sheets.length >= 1);
  for (const s of report.sheets) assert.ok(fs.existsSync(path.join(root, s)));
  assert.equal(report.beats.count, prepared.timeline.beats.beats.length, 'um quadro por batida');

  const blocked = renderCli();
  assert.equal(blocked.status, 2, 'sem revisão o render final deve ser bloqueado');
  assert.match(blocked.stdout, /bloqueado/);

  // Notas fictícias APENAS para exercitar a trava no projeto de teste.
  writeJson(paths.scorecard, { rounds: [{ round: 1, hash: report.hash, scores: Object.fromEntries(Object.keys(CRITERIA).map((k) => [k, 8])), note: 'teste automatizado' }] });
  const final = renderCli();
  assert.equal(final.status, 0, final.stderr + final.stdout);
  const meta = readJson(path.join(paths.output, 'mysticall-soul-final.json'));
  assert.deepEqual(Object.keys(meta.files).sort(), ['mysticall-soul-final-sem-legendas.mp4', 'mysticall-soul-final.mp4']);
  for (const checks of Object.values(meta.files)) for (const c of checks) assert.ok(c.ok, `${c.name}: ${c.got}`);
  const srt = fs.readFileSync(path.join(paths.output, 'mysticall-soul-final.srt'), 'utf8');
  assert.match(srt, /^1\n00:00:00,\d{3} --> /);
  assert.ok(fs.existsSync(path.join(paths.output, 'mysticall-soul-final-edl.json')));
});

test('arquivo final: loudness após AAC dentro de ±1 LU de -14', async () => {
  const l = await measureLoudness(path.join(paths.output, 'mysticall-soul-final.mp4'));
  assert.ok(Math.abs(l.integratedLufs + 14) <= 1, `LUFS ${l.integratedLufs}`);
});
