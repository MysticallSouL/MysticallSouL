import { exists, readJson } from './fsutil.mjs';

// Valores padrão. O arquivo projeto/config.json só precisa conter o que muda.
export const DEFAULT_CONFIG = {
  output: { name: 'mysticall-soul-final' },
  format: { width: 1080, height: 1920, fps: 16 },
  brand: {
    name: null,
    accent: '#9D5CFF',
    accentProvisional: true,
    textColor: '#FFFFFF',
    shadowColor: '#0B0712',
    logo: null,
    fonts: {
      display: { family: 'Anton', file: 'vendor:@fontsource/anton/files/anton-latin-400-normal.woff2', weight: 400 },
      ui: { family: 'Inter', file: 'vendor:@fontsource/inter/files/inter-latin-600-normal.woff2', weight: 600 },
    },
  },
  safeZone: { top: 160, bottom: 480, left: 64, right: 150 },
  // Correção de cor aplicada na extração dos quadros (cadeia de filtros FFmpeg) ou null.
  video: { grade: null },
  captions: {
    enabled: true,
    language: 'pt-BR',
    uppercase: true,
    maxWordsPerPage: 3,
    maxCharsPerPage: 18,
    maxPageGap: 0.6,
    stripPunctuation: true,
    centerY: 0.62,
    fontSize: 92,
    font: 'display',
    highlightActiveWord: true,
  },
  motion: {
    beatPunch: { enabled: true, everyNBeats: 4, scale: 1.05 },
    cutPunchScale: 1.08,
    whipDuration: 0.25,
  },
  audio: {
    sampleRate: 48000,
    targetLufs: -14,
    truePeak: -1.0,
    lufsTolerance: 0.5,
    voice: { highpassHz: 80, denoise: true, deess: true, compress: true, gainDb: 0 },
    music: { mode: 'synth', style: 'pulse', bpm: 112, seed: 7, gainDb: -18, duck: true },
    sfx: { enabled: true, onCuts: 'whoosh', onHookWords: 'hit', gainDb: -12, snapTolerance: 0.2 },
    edgeFadeMs: 8,
  },
  render: { workers: 4, jpegQuality: 95, crf: 17, preset: 'slow', audioBitrate: '192k' },
  review: { minScore: 8, contactSheetColumns: 6, contactSheetRows: 6 },
  expectedVideos: 3,
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, over) {
  if (!isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k.startsWith('$') || k.startsWith('_')) continue; // chaves de comentário
    out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function validateConfig(cfg) {
  const errors = [];
  const { width, height, fps } = cfg.format;
  if (!(Number.isInteger(width) && Number.isInteger(height) && width % 2 === 0 && height % 2 === 0)) {
    errors.push('format.width/height devem ser inteiros pares.');
  }
  if (!(Number.isInteger(fps) && fps >= 1 && fps <= 60)) errors.push('format.fps deve ser inteiro entre 1 e 60.');
  if (!/^#[0-9a-fA-F]{6}$/.test(cfg.brand.accent)) errors.push('brand.accent deve ser uma cor #RRGGBB.');
  const fonts = Object.keys(cfg.brand.fonts);
  if (fonts.length !== 2 || !fonts.includes('display') || !fonts.includes('ui')) {
    errors.push('brand.fonts deve ter exatamente "display" e "ui" (uma fonte de exibição e uma de interface).');
  }
  if (!['synth', 'file', 'none'].includes(cfg.audio.music.mode)) errors.push('audio.music.mode deve ser synth, file ou none.');
  if (!['pulse', 'bed'].includes(cfg.audio.music.style)) errors.push('audio.music.style deve ser pulse ou bed.');
  if (!['display', 'ui'].includes(cfg.captions.font)) errors.push('captions.font deve ser display ou ui.');
  if (cfg.audio.music.bpm < 60 || cfg.audio.music.bpm > 200) errors.push('audio.music.bpm deve estar entre 60 e 200.');
  if (cfg.captions.maxWordsPerPage < 1) errors.push('captions.maxWordsPerPage deve ser >= 1.');
  return errors;
}

export function loadConfig(paths) {
  const user = exists(paths.config) ? readJson(paths.config) : {};
  const cfg = deepMerge(DEFAULT_CONFIG, user);
  const errors = validateConfig(cfg);
  if (errors.length) throw new Error(`Configuração inválida (${paths.config}):\n- ${errors.join('\n- ')}`);
  return cfg;
}
