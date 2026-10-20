import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftEdl, validateEdl, resolveClips, offBeatCuts, resolveTime } from '../../lib/edl.mjs';

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

test('âncoras {clip, t} acompanham a posição do clipe na linha do tempo', () => {
  const edl = { clips: [
    { id: 'a', source: 'a.mp4', in: 1, out: 3 },
    { id: 'b', source: 'b.mp4', in: 2, out: 4, speed: 2 },
  ] };
  const clips = resolveClips(edl, 30);
  assert.equal(resolveTime(2.5, clips), 2.5);
  assert.equal(resolveTime({ clip: 'a', t: 1.5 }, clips), 0.5);
  assert.equal(resolveTime({ clip: 'b', t: 3 }, clips), 2.5);
});

test('validação de cartões, âncoras, zoomEnd e destaques', () => {
  const clips = [{ id: 'a', source: 'a.mp4', in: 0, out: 3, zoomEnd: 3 }];
  const v = validateEdl({ clips, texts: [
    { type: 'card', start: { clip: 'a', t: 0.5 }, end: { clip: 'x', t: 1 }, lines: [] },
    { type: 'card', start: 0, end: { clip: 'a', t: 9 }, lines: [{ text: 'ok', at: { clip: 'a' } }] },
    { type: 'card', start: 2, end: 1, lines: [{ text: 'ok' }] },
  ], emphasis: [{ clip: 'z', word: 'x' }] }, byName);
  for (const frag of ['zoomEnd', 'precisa de "lines"', 'clipe "x" não existe', 'fora do trecho', 'use segundos ou uma âncora', 'start < end', 'emphasis[0]']) {
    assert.ok(v.errors.some((e) => e.includes(frag)), `faltou erro: ${frag}`);
  }
  const ok = validateEdl({ clips: [{ id: 'a', source: 'a.mp4', in: 0, out: 3, zoom: 1, zoomEnd: 1.05 }], texts: [
    { type: 'card', start: { clip: 'a', t: 0.5 }, end: 2, lines: [{ text: 'X', accent: true }, { text: 'Y', at: { clip: 'a', t: 1 } }] },
  ], emphasis: [{ clip: 'a', word: 'teste' }] }, byName);
  assert.deepEqual(ok.errors, []);
});
