// Funções de easing e envelopes puras: dependem apenas dos argumentos.

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const progress = (t, start, dur) => (dur <= 0 ? (t >= start ? 1 : 0) : clamp((t - start) / dur));

export const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3);
export const easeInCubic = (k) => k * k * k;
export const easeInOutCubic = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const easeOutBack = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);

// Envelope de "punch": sobe rápido até `peak`, segura e volta suavemente a 0.
export function punchEnvelope(t, at, { attack = 0.08, hold = 0.12, release = 0.3 } = {}) {
  const dt = t - at;
  if (dt < 0 || dt > attack + hold + release) return 0;
  if (dt < attack) return easeOutCubic(dt / attack);
  if (dt < attack + hold) return 1;
  return 1 - easeInOutCubic((dt - attack - hold) / release);
}
