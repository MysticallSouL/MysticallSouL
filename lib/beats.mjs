// Detector de batidas: fluxo espectral -> tempo por autocorrelação -> fase por pente -> ajuste fino
// de cada batida no pico local. Puro JS, determinístico.

function fftMag(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const mag = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}

export function onsetEnvelope(pcm, sampleRate, { win = 1024, hop = 256 } = {}) {
  const frames = Math.max(0, Math.floor((pcm.length - win) / hop) + 1);
  const hann = new Float32Array(win).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win));
  const env = new Float32Array(frames);
  const low = new Float32Array(frames);
  const bandFrames = [];
  const lowBins = Math.ceil((150 * win) / sampleRate);
  // Fluxo espectral em ~24 bandas logarítmicas: evita que ruído agudo (muitos bins) domine o grave.
  const edges = [];
  for (let e = 0, f = 40; f < sampleRate / 2; f *= 1.3, e++) edges.push(Math.max(1, Math.round((f * win) / sampleRate)));
  const bands = edges.length - 1;
  let prev = null;
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(win);
    const im = new Float64Array(win);
    for (let i = 0; i < win; i++) re[i] = pcm[f * hop + i] * hann[i];
    const mag = fftMag(re, im);
    const cur = new Float32Array(bands);
    for (let b = 0; b < bands; b++) {
      let s = 0;
      for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) s += mag[k] || 0;
      cur[b] = Math.log1p(100 * (s / Math.max(1, edges[b + 1] - edges[b])));
    }
    if (prev) {
      let s = 0;
      let sl = 0;
      for (let b = 0; b < bands; b++) {
        const d = cur[b] - prev[b];
        if (d > 0) {
          s += d;
          if (edges[b] <= lowBins) sl += d;
        }
      }
      env[f] = s;
      low[f] = sl;
    }
    bandFrames.push(cur);
    prev = cur;
  }
  // Remove a média local e retifica.
  const w = Math.round((0.4 * sampleRate) / hop);
  const out = new Float32Array(frames);
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    acc += env[f];
    if (f > 2 * w) acc -= env[f - 2 * w - 1];
    const cnt = Math.min(f + 1, 2 * w + 1);
    const center = f - w;
    if (center >= 0) out[center] = Math.max(0, env[center] - acc / cnt);
  }
  let max = 0;
  for (const v of out) max = Math.max(max, v);
  if (max > 0) for (let f = 0; f < frames; f++) out[f] /= max;
  return { env: out, low, bandFrames, frameRate: sampleRate / hop, hop, win };
}

// Calibração empírica (cliques de tempo conhecido): o pico do fluxo chega antes do centro da janela.
const ONSET_OFFSET_FRAMES = 1;

const at = (arr, x) => {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= arr.length) return 0;
  return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
};

export function detectBeats(pcm, sampleRate, { minBpm = 60, maxBpm = 200, preferBpm = 115 } = {}) {
  const { env, low, bandFrames, frameRate, win } = onsetEnvelope(pcm, sampleRate);
  const duration = pcm.length / sampleRate;
  const latency = win / 2 / sampleRate; // centro da janela de análise
  // Tempo e fase: busca em pente. Para cada andamento candidato, a melhor fase e a média do
  // envelope sob o pente; uma preferência suave (log-normal) desempata múltiplos/submúltiplos.
  const candidates = [];
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
    const p = (60 * frameRate) / bpm;
    let phaseBest = 0;
    let phaseScore = -Infinity;
    for (let ph = 0; ph < p; ph += 0.5) {
      let s = 0;
      let n = 0;
      for (let x = ph; x < env.length; x += p, n++) s += at(env, x);
      if (n && s / n > phaseScore) {
        phaseScore = s / n;
        phaseBest = ph;
      }
    }
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / preferBpm) / 0.5, 2));
    candidates.push({ bpm, period: p, phase: phaseBest, score: phaseScore, prior });
  }
  // Entre candidatos quase empatados (metade/dobro do andamento), fica o mais próximo do esperado.
  const top = Math.max(...candidates.map((c) => c.score));
  const chosen = candidates
    .filter((c) => c.score >= 0.6 * top)
    .reduce((a, c) => (c.prior * c.score > a.prior * a.score ? c : a));
  const period = chosen.period;
  const bestPhase = chosen.phase;
  const bestScore = chosen.score;
  // Ajuste fino: cada batida vai para o pico local (±8% do período), com interpolação parabólica.
  const radius = Math.max(1, Math.round(period * 0.08));
  const beats = [];
  const strength = [];
  // Estende a grade para trás até t ~ 0 (o primeiro ataque não gera fluxo antes do quadro 0).
  const timeOf = (x) => (x + ONSET_OFFSET_FRAMES) / frameRate + latency;
  let first = bestPhase;
  while (timeOf(first - period) >= -0.25 * (period / frameRate)) first -= period;
  for (let x = first; x < env.length; x += period) {
    const ci = Math.round(x);
    let pi = ci;
    for (let i = ci - radius; i <= ci + radius; i++) if (i >= 0 && i < env.length && env[i] > env[pi]) pi = i;
    let pos = pi;
    if (ci - radius >= 0 && env[pi] > 0.15 && pi > 0 && pi + 1 < env.length) {
      const d = env[pi - 1] - 2 * env[pi] + env[pi + 1];
      if (d !== 0) pos = pi + (0.5 * (env[pi - 1] - env[pi + 1])) / d;
    } else pos = x;
    const t = Math.max(0, timeOf(pos));
    if (t <= duration) {
      beats.push(Number(t.toFixed(4)));
      // Energia grave: máximo numa janela curta (o pico grave pode vir 1–2 quadros depois do fluxo total).
      let lm = 0;
      for (let i = Math.round(pos) - 2; i <= Math.round(pos) + 4; i++) if (i >= 0 && i < low.length) lm = Math.max(lm, low[i]);
      strength.push(lm);
    }
  }
  // Desvio isolado (pico de outro instrumento) vira a mediana do desvio dos vizinhos.
  const ideal = beats.map((_, i) => beats[0] + (i * period) / frameRate);
  const dev = beats.map((t, i) => t - ideal[i]);
  for (let i = 0; i < beats.length; i++) {
    const nb = dev.slice(Math.max(0, i - 3), i).concat(dev.slice(i + 1, i + 4)).sort((x, y) => x - y);
    if (nb.length < 2) continue;
    const med = nb[Math.floor(nb.length / 2)];
    if (Math.abs(dev[i] - med) > 0.02) beats[i] = Number(Math.max(0, ideal[i] + med).toFixed(4));
  }

  // Compasso 4/4 estimado: acordes costumam mudar no tempo 1. Novidade harmônica entre o espectro
  // médio de cada intervalo de batida e o anterior, somada por fase, mais a força grave.
  const frameOf = (t) => Math.max(0, Math.min(bandFrames.length - 1, Math.round((t - latency) * frameRate) - ONSET_OFFSET_FRAMES));
  const mean = (a, b) => {
    const v = new Float32Array(bandFrames[0]?.length || 0);
    const n = Math.max(1, b - a);
    for (let f = a; f < b; f++) for (let k = 0; k < v.length; k++) v[k] += bandFrames[f][k] / n;
    return v;
  };
  const segs = beats.slice(0, -1).map((t, i) => mean(frameOf(t) + 2, Math.max(frameOf(t) + 3, frameOf(beats[i + 1]) - 1)));
  const novelty = beats.map((_, i) => {
    if (i === 0 || i >= segs.length) return 0;
    let d = 0;
    for (let k = 0; k < segs[i].length; k++) d += Math.abs(segs[i][k] - segs[i - 1][k]);
    return d;
  });
  novelty[0] = Math.max(...novelty); // começo da música conta como início de compasso
  const norm = (arr) => {
    const m = Math.max(...arr, 1e-9);
    return arr.map((x) => x / m);
  };
  const nNov = norm(novelty);
  const nLow = norm(strength);
  let downPhase = 0;
  let downBest = -Infinity;
  for (let p = 0; p < 4; p++) {
    let s = 0;
    let n = 0;
    for (let i = p; i < beats.length; i += 4, n++) s += nNov[i] + 0.5 * nLow[i];
    if (n && s / n > downBest) {
      downBest = s / n;
      downPhase = p;
    }
  }
  const iois = beats.slice(1).map((t, i) => t - beats[i]).sort((x, y) => x - y);
  const medianIoi = iois.length ? iois[Math.floor(iois.length / 2)] : period / frameRate;
  const onBeat = bestScore;
  return {
    bpm: Number((60 / medianIoi).toFixed(2)),
    beats,
    downbeats: beats.filter((_, i) => i % 4 === downPhase),
    confidence: Number(Math.min(1, onBeat).toFixed(3)),
    duration: Number(duration.toFixed(4)),
  };
}
