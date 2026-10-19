import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, hashSeed, noiseAt } from '../../composition/lib/noise.js';

test('mulberry32 é determinístico e fica em [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = Array.from({ length: 1000 }, a);
  assert.deepEqual(seqA, Array.from({ length: 1000 }, b));
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
  assert.notDeepEqual(seqA.slice(0, 5), Array.from({ length: 5 }, mulberry32(43)));
});

test('valor de referência estável entre versões', () => {
  assert.equal(mulberry32(1)().toFixed(10), '0.6270739406');
});

test('noiseAt não carrega estado entre chamadas', () => {
  const x = noiseAt(7, 'hook', 3);
  noiseAt(7, 'outra', 1);
  assert.equal(noiseAt(7, 'hook', 3), x);
  assert.notEqual(hashSeed(1, 'a'), hashSeed(1, 'b'));
});
