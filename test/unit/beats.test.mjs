import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBeats } from '../../lib/beats.mjs';
import { renderScore } from '../../lib/synth.mjs';

const SR = 22050;

function clickTrack(bpm, offset, seconds) {
  const pcm = new Float32Array(SR * seconds);
  for (let t = offset; t < seconds; t += 60 / bpm) {
    const i0 = Math.round(t * SR);
    for (let i = 0; i < 200 && i0 + i < pcm.length; i++) pcm[i0 + i] += Math.sin(i * 0.3) * Math.exp(-i / 60);
  }
  return pcm;
}

const maxError = (beats, bpm, offset) =>
  Math.max(...beats.slice(1, -1).map((t) => Math.abs(t - (offset + Math.round(((t - offset) * bpm) / 60) * (60 / bpm)))));

test('cliques: andamento e fase com erro < 10 ms', () => {
  for (const [bpm, off] of [[100, 0.123], [120, 0.31], [140, 0.05]]) {
    const r = detectBeats(clickTrack(bpm, off, 15), SR);
    assert.ok(Math.abs(r.bpm - bpm) < 0.5, `${bpm}: medido ${r.bpm}`);
    assert.ok(maxError(r.beats, bpm, off) < 0.01, `${bpm}: erro ${maxError(r.beats, bpm, off)}`);
  }
});

test('trilha sintetizada: grade medida bate com a gerada (< 20 ms), começa em ~0 e acha o compasso', () => {
  for (const bpm of [90, 112, 128, 150]) {
    const [L, R] = renderScore({ bpm, duration: 16, seed: 7, sampleRate: SR });
    const r = detectBeats(L.map((v, i) => (v + R[i]) / 2), SR, { preferBpm: bpm });
    assert.ok(Math.abs(r.bpm - bpm) < 1, `${bpm}: medido ${r.bpm}`);
    assert.ok(maxError(r.beats, bpm, 0) < 0.02, `${bpm}: erro ${maxError(r.beats, bpm, 0)}`);
    assert.ok(r.beats[0] < 0.03, `${bpm}: primeira batida em ${r.beats[0]}`);
    assert.ok(r.downbeats[0] < 0.03, `${bpm}: primeiro tempo forte em ${r.downbeats[0]}`);
  }
});

test('trilha sintetizada é determinística', () => {
  const a = renderScore({ bpm: 112, duration: 3, seed: 7, sampleRate: 8000 });
  const b = renderScore({ bpm: 112, duration: 3, seed: 7, sampleRate: 8000 });
  assert.deepEqual(a[0], b[0]);
  assert.deepEqual(a[1], b[1]);
});
