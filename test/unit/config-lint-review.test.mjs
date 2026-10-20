import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, deepMerge, validateConfig, loadConfig } from '../../lib/config.mjs';
import { lintComposition, lintSource } from '../../lib/lint.mjs';
import { checkGate, noveltyGaps, CRITERIA } from '../../lib/review.mjs';
import { projectPaths } from '../../lib/paths.mjs';
import { writeJson, isLfsPointer } from '../../lib/fsutil.mjs';

test('configuração padrão segue o contrato: 1080x1920, CFR 16, -14 LUFS, 2 fontes, 1 destaque', () => {
  assert.deepEqual(DEFAULT_CONFIG.format, { width: 1080, height: 1920, fps: 16 });
  assert.equal(DEFAULT_CONFIG.audio.targetLufs, -14);
  assert.deepEqual(Object.keys(DEFAULT_CONFIG.brand.fonts).sort(), ['display', 'ui']);
  assert.deepEqual(validateConfig(DEFAULT_CONFIG), []);
});

test('merge ignora chaves de comentário e valida erros', () => {
  const cfg = deepMerge(DEFAULT_CONFIG, { $comment: 'x', format: { fps: 0 }, brand: { accent: 'roxo' } });
  assert.equal(cfg.$comment, undefined);
  const errs = validateConfig(cfg);
  assert.ok(errs.some((e) => e.includes('fps')) && errs.some((e) => e.includes('accent')));
});

test('o config.json do repositório é válido', () => {
  assert.doesNotThrow(() => loadConfig(projectPaths()));
});

test('a composição do repositório passa no lint do contrato', () => {
  assert.deepEqual(lintComposition(), []);
});

test('lint pega violações do contrato', () => {
  assert.equal(lintSource('const x = Math.random();', 'a.js').length, 1);
  assert.equal(lintSource('requestAnimationFrame(f); setTimeout(g, 1)', 'a.js').length, 2);
  assert.equal(lintSource('.a { transition: opacity 1s }', 'a.css').length, 1);
  assert.equal(lintSource('@keyframes x {}', 'a.css').length, 1);
  assert.equal(lintSource('el.style.transition = "all 1s"', 'a.js').length, 1);
  assert.equal(lintSource('// Math.random proibido\nconst transitionIn = 1;', 'a.js').length, 0);
});

test('trava de revisão: sem rodada, hash diferente, nota baixa, aprovado', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-gate-'));
  const paths = projectPaths(root);
  const cfg = DEFAULT_CONFIG;
  assert.equal(checkGate(paths, cfg, 'h1').ok, false);
  const scores = Object.fromEntries(Object.keys(CRITERIA).map((k) => [k, 9]));
  writeJson(paths.scorecard, { rounds: [{ round: 1, hash: 'h0', scores }] });
  assert.ok(checkGate(paths, cfg, 'h1').reasons[0].includes('não corresponde'));
  writeJson(paths.scorecard, { rounds: [{ round: 1, hash: 'h1', scores: { ...scores, sync: 7 } }] });
  assert.ok(checkGate(paths, cfg, 'h1').reasons.some((r) => r.includes('sync')));
  writeJson(paths.scorecard, { rounds: [{ round: 1, hash: 'h1', scores: { ...scores, sync: 7 } }, { round: 2, hash: 'h1', scores }] });
  assert.equal(checkGate(paths, cfg, 'h1').ok, true);
});

test('intervalos sem novidade acima de 4 s são detectados', () => {
  const tl = { duration: 10, clips: [{ start: 0, punches: [] }, { start: 3, punches: [] }], captions: [], texts: [] };
  assert.deepEqual(noveltyGaps(tl), [{ from: 3, to: 10, seconds: 7 }]);
});

test('detecta ponteiro do Git LFS', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ms-lfs-')), 'v.mp4');
  fs.writeFileSync(f, 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n');
  assert.equal(isLfsPointer(f), true);
});

test('o modelo projeto/config.exemplo.json é válido', async () => {
  const { readJson } = await import('../../lib/fsutil.mjs');
  const { CODE_ROOT } = await import('../../lib/paths.mjs');
  const cfg = deepMerge(DEFAULT_CONFIG, readJson(path.join(CODE_ROOT, 'projeto', 'config.exemplo.json')));
  assert.deepEqual(validateConfig(cfg), []);
});
