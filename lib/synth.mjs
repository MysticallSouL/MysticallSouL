import { mulberry32, hashSeed } from '../composition/lib/noise.js';

// Trilha e efeitos sintetizados em código, determinísticos (semente fixa, sem Math.random).
// A grade de batidas começa em t = 0: batida k cai em k * 60 / bpm.

const TAU = Math.PI * 2;
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function addKick(buf, sr, at, gain) {
  const n = Math.floor(sr * 0.35);
  const i0 = Math.round(at * sr);
  let phase = 0;
  for (let i = 0; i < n && i0 + i < buf.length; i++) {
    const t = i / sr;
    const f = 48 + 110 * Math.exp(-t * 28);
    phase += (TAU * f) / sr;
    const env = Math.exp(-t * 9) * Math.min(1, t * 2000);
    buf[i0 + i] += gain * env * Math.sin(phase) + gain * 0.25 * Math.exp(-t * 200) * Math.sin(phase * 3);
  }
}

function addNoiseHit(buf, sr, at, gain, decay, rnd, hp = 0.85) {
  const n = Math.floor(sr * Math.min(0.5, 6 / decay));
  const i0 = Math.round(at * sr);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < n && i0 + i < buf.length; i++) {
    const x = rnd() * 2 - 1;
    const y = hp * (prevOut + x - prevIn); // passa-altas de um polo
    prevIn = x;
    prevOut = y;
    buf[i0 + i] += gain * y * Math.exp((-i / sr) * decay);
  }
}

function addTone(buf, sr, at, dur, hz, gain, { wave = 'saw', attack = 0.01, release = 0.08, cutoff = 900 } = {}) {
  const i0 = Math.round(at * sr);
  const n = Math.floor(sr * (dur + release));
  let phase = 0;
  let lp = 0;
  const a = 1 - Math.exp((-TAU * cutoff) / sr);
  for (let i = 0; i < n && i0 + i < buf.length; i++) {
    const t = i / sr;
    phase = (phase + hz / sr) % 1;
    const raw = wave === 'saw' ? 2 * phase - 1 : wave === 'square' ? (phase < 0.5 ? 1 : -1) : Math.sin(TAU * phase);
    lp += a * (raw - lp);
    const env = Math.min(1, t / attack) * (t > dur ? Math.max(0, 1 - (t - dur) / release) : 1);
    buf[i0 + i] += gain * env * lp;
  }
}

// Progressão em lá menor: Am - F - C - G (graus i - VI - III - VII).
const PROGRESSION = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];

// style "pulse": bumbo em todas as batidas, caixa, chimbal, baixo e pad (ritmo marcado).
// style "bed": fundo discreto para fala — pulso grave suave, baixo e pad, sem caixa nem chimbal.
export function renderScore({ bpm, duration, seed, sampleRate: sr, style = 'pulse' }) {
  const n = Math.ceil(duration * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const drums = new Float32Array(n);
  const rnd = mulberry32(hashSeed(seed, 'score'));
  const beat = 60 / bpm;
  const totalBeats = Math.ceil(duration / beat) + 1;
  for (let k = 0; k < totalBeats; k++) {
    const t = k * beat;
    const inBar = k % 4;
    const bar = Math.floor(k / 4);
    // Bumbo em todas as batidas (mais forte no 1) — dá um pulso claro para a medição.
    const bed = style === 'bed';
    addKick(drums, sr, t, bed ? (inBar === 0 ? 0.55 : 0.32) : inBar === 0 ? 1.0 : 0.62);
    if (!bed && (inBar === 1 || inBar === 3)) addNoiseHit(drums, sr, t, 0.32, 22, rnd, 0.7);
    if (!bed) addNoiseHit(drums, sr, t + beat * 0.5, 0.07 + 0.04 * rnd(), 60, rnd, 0.95);
    if (inBar === 0) {
      const chord = PROGRESSION[bar % PROGRESSION.length];
      addTone(L, sr, t, beat * 2 - 0.05, midiHz(chord[0] - 24), 0.28, { cutoff: 420 });
      addTone(L, sr, t + beat * 2, beat * 2 - 0.05, midiHz(chord[2] - 12), 0.12, { cutoff: 700 });
      for (const [j, m] of chord.entries()) {
        addTone(j % 2 ? R : L, sr, t, beat * 4, midiHz(m), 0.045, { wave: 'square', attack: 0.3, release: 0.4, cutoff: 1400 });
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const bass = L[i];
    L[i] = Math.tanh(bass + drums[i]);
    R[i] = Math.tanh(R[i] + drums[i] + bass * 0.9);
  }
  // Saída curta no final (só o áudio; a regra contra fades é visual).
  const fade = Math.min(n, Math.floor(0.6 * sr));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    L[n - 1 - i] *= g;
    R[n - 1 - i] *= g;
  }
  return [L, R];
}

// Efeitos sonoros. "at" é o instante do impacto (para o whoosh, o pico fica no corte).
export function renderSfx(events, { duration, seed, sampleRate: sr }) {
  const n = Math.ceil(duration * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (const [idx, ev] of events.entries()) {
    const rnd = mulberry32(hashSeed(seed, 'sfx', idx, ev.type));
    const g = ev.gain ?? 1;
    if (ev.type === 'whoosh' || ev.type === 'riser') {
      const len = ev.type === 'whoosh' ? 0.42 : 1.2;
      const peakAt = ev.type === 'whoosh' ? 0.62 : 0.97;
      const start = ev.at - len * peakAt;
      let low = 0;
      let band = 0;
      for (let i = 0; i < len * sr; i++) {
        const idxS = Math.round(start * sr) + i;
        if (idxS < 0 || idxS >= n) continue;
        const k = i / (len * sr);
        const env = k < peakAt ? Math.pow(k / peakAt, 2) : Math.pow(1 - (k - peakAt) / (1 - peakAt), 1.5);
        const fc = 300 + 5200 * (ev.type === 'riser' ? k : Math.sin(Math.PI * Math.min(1, k / (peakAt * 2))));
        const f = 2 * Math.sin((Math.PI * fc) / sr);
        const x = rnd() * 2 - 1;
        low += f * band;
        band += f * (x - low - 0.6 * band); // filtro de estado variável (passa-banda)
        const pan = ev.type === 'whoosh' ? k : 0.5;
        L[idxS] += g * 0.9 * env * band * (1 - pan * 0.6);
        R[idxS] += g * 0.9 * env * band * (0.4 + pan * 0.6);
      }
    } else if (ev.type === 'hit') {
      const mono = new Float32Array(n);
      addKick(mono, sr, ev.at, 0.9 * g);
      addNoiseHit(mono, sr, ev.at, 0.35 * g, 35, rnd, 0.6);
      for (let i = 0; i < n; i++) {
        L[i] += mono[i];
        R[i] += mono[i];
      }
    } else if (ev.type === 'pop') {
      const i0 = Math.round(ev.at * sr);
      for (let i = 0; i < 0.09 * sr && i0 + i < n; i++) {
        const t = i / sr;
        const v = g * 0.5 * Math.sin(TAU * (900 - 500 * t * 10) * t) * Math.exp(-t * 45);
        L[i0 + i] += v;
        R[i0 + i] += v;
      }
    }
  }
  return [L, R];
}
