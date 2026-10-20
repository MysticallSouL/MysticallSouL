import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagesToSrt } from '../../lib/srt.mjs';
import { renderScore } from '../../lib/synth.mjs';
import { detectBeats } from '../../lib/beats.mjs';

test('SRT a partir das páginas de legenda', () => {
  const srt = pagesToSrt([
    { start: 0, end: 1.25, words: [{ text: 'Olá,' }, { text: 'mundo.' }] },
    { start: 61.5, end: 3723.004, words: [{ text: 'Fim' }] },
  ]);
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:01,250\nOlá, mundo.\n\n2\n00:01:01,500 --> 01:02:03,004\nFim\n');
});

test('trilha "bed" é mais discreta que "pulse" e mantém a grade medível', () => {
  const sr = 22050;
  const rms = (ch) => Math.sqrt(ch.reduce((s, v) => s + v * v, 0) / ch.length);
  const [pL] = renderScore({ bpm: 100, duration: 12, seed: 7, sampleRate: sr, style: 'pulse' });
  const [bL, bR] = renderScore({ bpm: 100, duration: 12, seed: 7, sampleRate: sr, style: 'bed' });
  assert.ok(rms(bL) < rms(pL) * 0.8, `bed ${rms(bL)} vs pulse ${rms(pL)}`);
  const r = detectBeats(bL.map((v, i) => (v + bR[i]) / 2), sr, { preferBpm: 100 });
  assert.ok(Math.abs(r.bpm - 100) < 1, `medido ${r.bpm}`);
});
