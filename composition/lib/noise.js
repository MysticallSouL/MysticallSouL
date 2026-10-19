// Ruído determinístico. Nunca usar Math.random: todo valor aleatório vem daqui.
// Módulo ES puro, importado tanto pela composição (navegador) quanto pelo Node.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash de inteiros para derivar sementes independentes (ex.: semente global + número do quadro).
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Valor em [0, 1) para uma chave, sem estado entre chamadas.
export function noiseAt(seed, ...key) {
  return mulberry32(hashSeed(seed, ...key))();
}
