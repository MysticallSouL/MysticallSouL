// Composição: window.seek(t) pinta o quadro t a partir apenas da linha do tempo e de t.
// Proibido aqui: Math.random, setTimeout/setInterval, requestAnimationFrame, relógio, transições CSS
// e qualquer estado carregado entre quadros. Ruído vem de lib/noise.js (mulberry32 com semente).
import { clamp, easeInOutCubic, easeOutBack, easeOutCubic, lerp, progress, punchEnvelope } from './lib/ease.js';
import { noiseAt } from './lib/noise.js';

const params = new URLSearchParams(location.search);
const MODE = params.get('mode') || 'render';
const TIMELINE_URL = params.get('timeline') || '/proj/build/timeline.json';
const SHOW_CAPTIONS = params.get('captions') !== '0'; // versão sem legendas: ?captions=0

const $ = (id) => document.getElementById(id);
const el = {
  stage: $('stage'),
  plate: $('plate'),
  hook: $('hook'),
  cta: $('cta'),
  captions: $('captions'),
  cards: $('cards'),
};

let TL = null; // linha do tempo imutável depois de carregada

async function loadFonts(fonts) {
  const loaded = [];
  for (const f of Object.values(fonts)) {
    const face = new FontFace(f.family, `url(${f.url})`, { weight: String(f.weight) });
    document.fonts.add(face);
    loaded.push(face.load());
  }
  await Promise.all(loaded);
}

async function init() {
  const res = await fetch(TIMELINE_URL);
  if (!res.ok) throw new Error(`Linha do tempo não encontrada: ${TIMELINE_URL}`);
  TL = await res.json();
  const root = document.documentElement.style;
  const { width, height } = TL.format;
  root.setProperty('--w', `${width}px`);
  root.setProperty('--h', `${height}px`);
  root.setProperty('--accent', TL.brand.accent);
  root.setProperty('--text', TL.brand.textColor);
  root.setProperty('--shadow', TL.brand.shadowColor);
  root.setProperty('--font-display', `"${TL.brand.fonts.display.family}"`);
  root.setProperty('--font-ui', `"${TL.brand.fonts.ui.family}"`);
  for (const k of ['top', 'bottom', 'left', 'right']) root.setProperty(`--safe-${k}`, `${TL.safeZone[k]}px`);
  root.setProperty('--caption-size', `${TL.captionStyle.fontSize}px`);
  root.setProperty('--caption-center', String(TL.captionStyle.centerY));
  root.setProperty('--caption-font', TL.captionStyle.font === 'ui' ? 'var(--font-ui)' : 'var(--font-display)');
  await loadFonts(TL.brand.fonts);
  return true;
}

// ---------- seleção pura ----------

function clipAt(t) {
  const clips = TL.clips;
  for (let i = clips.length - 1; i >= 0; i--) if (t >= clips[i].start - 1e-9) return i;
  return 0;
}

function frameUrl(clip, t) {
  const n = Math.floor((t - clip.start) * TL.format.fps + 1e-6);
  const i = clamp(n, 0, clip.frames.count - 1);
  return `${clip.frames.url}${String(i).padStart(6, '0')}.jpg`;
}

// ---------- camadas ----------

function footageTransform(t, ci) {
  const clip = TL.clips[ci];
  const next = TL.clips[ci + 1];
  const m = TL.motion;
  // Aproximação lenta ao longo do clipe (zoom -> zoomEnd), suave nas pontas.
  let scale = lerp(clip.zoom, clip.zoomEnd ?? clip.zoom, easeInOutCubic(progress(t, clip.start, clip.duration)));
  // Punch de entrada em cada corte seco: entra mais perto e assenta.
  if (ci > 0 && clip.transitionIn === 'cut') scale *= lerp(m.cutPunchScale, 1, easeOutCubic(progress(t, clip.start, 0.3)));
  // Punches explícitos da EDL.
  for (const p of clip.punches) scale *= 1 + (p.scale - 1) * punchEnvelope(t, p.at);
  // Pulso nos tempos fortes (a cada N batidas).
  if (m.beatPunch.enabled) {
    // Alinhado ao primeiro tempo forte medido (início de compasso).
    const first = Math.max(0, TL.beats.beats.indexOf(TL.beats.downbeats[0]));
    const strong = TL.beats.beats.filter((_, i) => i >= first && (i - first) % m.beatPunch.everyNBeats === 0);
    for (const b of strong) if (b >= clip.start) scale *= 1 + (m.beatPunch.scale - 1) * punchEnvelope(t, b, { attack: 0.06, hold: 0, release: 0.35 });
  }
  // Whip pan: saída para a esquerda antes do corte, entrada pela direita depois.
  const half = m.whipDuration / 2;
  const W = TL.format.width;
  let x = 0;
  let blur = 0;
  if (next && next.transitionIn === 'whip' && t >= next.start - half) {
    const k = easeOutCubic(progress(t, next.start - half, half)) ** 2;
    x = -k * W * 0.55;
    blur = 22 * k;
  }
  if (clip.transitionIn === 'whip' && t < clip.start + half) {
    const k = 0.7 * (1 - easeOutCubic(progress(t, clip.start, half)));
    x = k * W * 0.55;
    blur = 22 * k;
  }
  return { scale, x, blur };
}

function paintFootage(t) {
  const ci = clipAt(t);
  const clip = TL.clips[ci];
  const { scale, x, blur } = footageTransform(t, ci);
  const fx = (clip.focus.x * 100).toFixed(2);
  const fy = (clip.focus.y * 100).toFixed(2);
  el.plate.style.transformOrigin = `${fx}% ${fy}%`;
  el.plate.style.transform = `translate3d(${x.toFixed(2)}px,0,0) scale(${scale.toFixed(5)})`;
  el.plate.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
  const url = frameUrl(clip, t);
  if (el.plate.getAttribute('src') !== url) el.plate.setAttribute('src', url);
  return el.plate.decode();
}

function paintCaptions(t) {
  const box = el.captions;
  box.replaceChildren();
  box.style.transform = 'none';
  const page = SHOW_CAPTIONS && TL.captions.find((p) => t >= p.start && t < p.end);
  if (!page) return;
  // Entrada da página: leve encaixe de escala (sem fade).
  const enter = easeOutCubic(progress(t, page.start, 0.1));
  box.style.transform = `scale(${lerp(1.06, 1, enter).toFixed(4)})`;
  page.words.forEach((w) => {
    const span = document.createElement('span');
    span.className = 'word';
    span.textContent = w.text;
    const active = TL.captionStyle.highlightActiveWord && t >= w.start && t < (w.end > w.start ? Math.max(w.end, w.start + 0.12) : w.start + 0.12);
    if (w.em) span.classList.add('em');
    if (active) {
      span.classList.add('active');
      const pop = 1 - easeOutCubic(progress(t, w.start, 0.14));
      span.style.transform = `scale(${(1 + 0.12 * pop).toFixed(4)})`;
    }
    box.append(span);
  });
}

function paintKinetic(container, type, t) {
  container.replaceChildren();
  const tx = TL.texts.find((x) => x.type === type && t >= x.start && t < x.end);
  if (!tx) return;
  if (type === 'cta' && TL.brand.logoUrl) {
    const img = document.createElement('img');
    img.className = 'logo';
    img.src = TL.brand.logoUrl;
    container.append(img);
  }
  const visible = tx.words.filter((w) => t >= w.at);
  visible.forEach((w, i) => {
    const span = document.createElement('span');
    span.className = 'kword';
    span.textContent = w.text;
    const k = progress(t, w.at, 0.2);
    const tilt = (noiseAt(TL.seed, tx.type, tx.start, i) - 0.5) * 4; // inclinação estável por palavra
    const s = lerp(1.28, 1, easeOutBack(k, 1.8));
    span.style.transform = `rotate(${tilt.toFixed(2)}deg) scale(${s.toFixed(4)})`;
    if (i === visible.length - 1) {
      span.classList.add('latest');
      const tape = document.createElement('i');
      tape.className = 'tape';
      const wipe = lerp(0.45, 1, easeOutCubic(progress(t, w.at, 0.12)));
      tape.style.clipPath = `inset(0 ${((1 - wipe) * 100).toFixed(2)}% 0 0)`;
      span.append(tape);
    }
    container.append(span);
  });
}

function paintCards(t) {
  el.cards.replaceChildren();
  const card = TL.texts.find((x) => x.type === 'card' && t >= x.start && t < x.end);
  if (!card) return;
  // Todas as linhas entram no layout (as futuras invisíveis): posições estáveis e um único
  // tamanho de fonte por cartão, reduzido só o necessário para cada linha caber sem quebrar.
  el.cards.style.fontSize = '';
  const divs = card.lines.map((line) => {
    const div = document.createElement('div');
    div.className = line.accent ? 'cline accent' : 'cline';
    div.textContent = line.text;
    el.cards.append(div);
    return div;
  });
  const avail = el.cards.clientWidth;
  const widest = Math.max(...divs.map((d) => d.scrollWidth));
  if (widest > avail) {
    const base = parseFloat(getComputedStyle(el.cards).fontSize);
    el.cards.style.fontSize = `${Math.floor((base * avail) / widest)}px`;
  }
  card.lines.forEach((line, i) => {
    const div = divs[i];
    if (t < line.at) {
      div.style.visibility = 'hidden';
      return;
    }
    // Entrada: revelação da esquerda para a direita com leve subida (sem fade).
    // Linha que já começa no primeiro quadro aparece completa (o quadro 0 precisa comunicar).
    const k = line.at <= 0 ? 1 : easeOutCubic(progress(t, line.at, 0.16));
    div.style.clipPath = `inset(0 ${((1 - k) * 100).toFixed(2)}% 0 0)`;
    div.style.transform = `translateY(${((1 - k) * 14).toFixed(2)}px)`;
  });
}

// ---------- API pública ----------

window.seek = async function seek(t) {
  if (!TL) throw new Error('Composição ainda não carregada (aguarde window.__ready).');
  const time = clamp(t, 0, TL.duration - 1e-6);
  const decoding = paintFootage(time);
  paintCaptions(time);
  paintKinetic(el.hook, 'hook', time);
  paintKinetic(el.cta, 'cta', time);
  paintCards(time);
  await decoding;
  const imgs = [...el.cta.querySelectorAll('img')];
  await Promise.all(imgs.map((i) => i.decode()));
  return time;
};

window.__mode = MODE;
window.__ready = init().then(() => {
  window.__timeline = TL;
  if (MODE === 'preview') import('./preview.js');
  return true;
});
