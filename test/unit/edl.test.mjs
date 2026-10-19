import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftEdl, validateEdl, resolveClips, offBeatCuts } from '../../lib/edl.mjs';

const probes = [
  { name: 'b.mp4', duration: 4.25 },
  { name: 'a.mp4', duration: 3.1 },
];
const byName = Object.fromEntries(probes.map((p) => [p.name, p]));

test('rascunho usa os vídeos inteiros sem inventar textos', () => {
  const edl = draftEdl(probes);
  assert.equal(edl.status, 'draft');
  assert.deepEqual(edl.clips.map((c) => [c.source, c.in, c.out]), [['b.mp4', 0, 4.25], ['a.mp4', 0, 3.1]]);
  assert.deepEqual(edl.texts, []);
  const v = validateEdl(edl, byName);
  assert.deepEqual(v.errors, []);
  assert.ok(v.warnings.some((w) => w.includes('rascunho')));
});

test('erros: fonte inexistente, out além da duração, foco e velocidade inválidos', () => {
  const v = validateEdl({ clips: [
    { id: 'x', source: 'nao.mp4', in: 0, out: 1 },
    { id: 'y', source: 'a.mp4', in: 0, out: 9 },
    { id: 'z', source: 'a.mp4', in: 0, out: 1, focus: { x: 2 }, speed: 5 },
    { id: 'z', source: 'a.mp4', in: 1, out: 0.5 },
  ], texts: [{ type: 'titulo', text: '', start: 0, end: 1 }] }, byName);
  for (const frag of ['não encontrada', 'passa da duração', 'focus.x', 'speed', 'id repetido', 'in < out', 'type deve ser', 'text vazio']) {
    assert.ok(v.errors.some((e) => e.includes(frag)), `faltou erro: ${frag}`);
  }
});

test('clipes resolvidos ficam contíguos e na grade de quadros', () => {
  const clips = resolveClips({ clips: [
    { id: 'a', source: 'a.mp4', in: 0, out: 1.03 },
    { id: 'b', source: 'b.mp4', in: 1, out: 3, speed: 2, punches: [{ at: 0.5 }] },
    { id: 'c', source: 'a.mp4', in: 0, out: 0.7 },
  ] }, 16);
  for (let i = 1; i < clips.length; i++) assert.equal(clips[i].start, clips[i - 1].end);
  for (const c of clips) {
    assert.ok(Number.isInteger(Math.round(c.start * 16 * 1e6) / 1e6));
    assert.ok(Math.abs(c.end * 16 - Math.round(c.end * 16)) < 1e-9);
  }
  assert.equal(clips[1].punches[0].at, clips[1].start + 0.5);
  assert.equal(clips[0].transitionIn, 'cut');
});

test('cortes fora da grade de batidas são apontados', () => {
  const clips = [{ id: 'a', start: 0 }, { id: 'b', start: 1.0 }, { id: 'c', start: 1.8 }];
  const off = offBeatCuts(clips, [0, 0.5, 1.0, 1.5, 2.0], 0.05);
  assert.deepEqual(off.map((o) => o.clip), ['c']);
});
