import fs from 'node:fs';
import path from 'node:path';
import { CAPTION_EXTENSIONS } from './paths.mjs';

// Legendas em pt-BR. Fonte: arquivos fornecidos em entrada/legendas/ (SRT, VTT ou JSON com
// tempos por palavra gerado por scripts/transcrever.py). O texto nunca é inventado ou reescrito:
// apenas caixa alta, remoção opcional de pontuação final e quebra em "páginas" curtas.

// Palavras que soam mal no fim de uma página de legenda (artigos, preposições, conjunções).
const WEAK_WORDS = new Set(
  'a o as os um uma uns umas de da do das dos em na no nas nos e ou que por pra pro para com sem se me te lhe ao à aos às mas nem num numa meu minha seu sua'.split(' '),
);

function parseTimestamp(s) {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) throw new Error(`Tempo de legenda inválido: "${s}"`);
  const [, h = '0', min, sec, ms] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(sec) + Number(ms.padEnd(3, '0')) / 1000;
}

const cleanCueText = (lines) =>
  lines
    .join(' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function parseCues(text, { vtt }) {
  const blocks = text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/);
  const segments = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    if (vtt && /^(WEBVTT|NOTE|STYLE|REGION)/.test(lines[0])) continue;
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const start = parseTimestamp(a);
    const end = parseTimestamp(b.trim().split(/\s+/)[0]);
    const body = cleanCueText(lines.slice(ti + 1));
    if (body && end > start) segments.push({ start, end, text: body });
  }
  return segments;
}

export const parseSrt = (text) => parseCues(text, { vtt: false });
export const parseVtt = (text) => parseCues(text, { vtt: true });

// Distribui palavras de um segmento proporcionalmente ao tamanho (tempo estimado).
export function estimateWords(seg) {
  const tokens = seg.text.split(/\s+/).filter(Boolean);
  const weights = tokens.map((w) => Math.max(2, w.length + 1));
  const total = weights.reduce((s, w) => s + w, 0);
  let t = seg.start;
  return tokens.map((text, i) => {
    const d = ((seg.end - seg.start) * weights[i]) / total;
    const w = { text, start: t, end: t + d, estimated: true };
    t += d;
    return w;
  });
}

export function wordsFromDocument(doc) {
  return doc.segments.flatMap((seg) => {
    const words =
      Array.isArray(seg.words) && seg.words.length
        ? seg.words.map((w) => ({ text: String(w.text ?? w.word).trim(), start: w.start, end: w.end })).filter((w) => w.text)
        : estimateWords(seg);
    if (words.length) words[words.length - 1].segmentEnd = true; // fim de segmento = fim de página
    return words;
  });
}

export function loadCaptionFile(file) {
  const ext = path.extname(file).toLowerCase();
  const raw = fs.readFileSync(file, 'utf8');
  if (ext === '.json') {
    const doc = JSON.parse(raw);
    if (!Array.isArray(doc.segments)) throw new Error(`${file}: JSON de legenda precisa de "segments".`);
    return { file, format: 'json', origin: doc.origin ?? 'desconhecida', reviewed: doc.reviewed === true, segments: doc.segments };
  }
  const segments = ext === '.vtt' ? parseVtt(raw) : parseSrt(raw);
  return { file, format: ext.slice(1), origin: 'arquivo-fornecido', reviewed: true, segments };
}

// Para cada vídeo, procura entrada/legendas/<nome-sem-extensão>.{json,srt,vtt}.
export function findCaptionFile(captionsDir, videoName) {
  const base = path.parse(videoName).name;
  for (const ext of CAPTION_EXTENSIONS) {
    const p = path.join(captionsDir, base + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Leva as palavras do tempo da fonte para o tempo da linha do tempo, respeitando os cortes.
export function mapWordsToTimeline(wordsBySource, clips) {
  const out = [];
  for (const c of clips) {
    for (const w of wordsBySource[c.source] || []) {
      const mid = (w.start + w.end) / 2;
      if (mid < c.in || mid >= c.out) continue;
      const toTl = (s) => Math.min(c.end, Math.max(c.start, c.start + (s - c.in) / c.speed));
      out.push({ text: w.text, start: toTl(w.start), end: toTl(w.end), clip: c.id, clipEnd: c.end, segmentEnd: Boolean(w.segmentEnd), estimated: Boolean(w.estimated) });
    }
  }
  return out;
}

export function displayText(text, { uppercase, stripPunctuation }) {
  let s = text;
  if (stripPunctuation) s = s.replace(/[.,;:…]+$/u, '');
  return uppercase ? s.toLocaleUpperCase('pt-BR') : s;
}

const endsSentence = (w) => /[.!?…]$/u.test(w.text);
const bare = (w) => w.text.toLocaleLowerCase('pt-BR').replace(/[^\p{L}]/gu, '');
const isCap = (w) => /^\p{Lu}/u.test(w.text);

export function paginate(words, { maxWordsPerPage, maxCharsPerPage, maxPageGap }) {
  const pages = [];
  let cur = [];
  const chars = (ws) => ws.reduce((s, w) => s + w.text.length, 0) + Math.max(0, ws.length - 1);
  const flush = (next) => {
    if (!cur.length) return [];
    const carry = [];
    // Não termina página em palavra fraca nem separa nomes próprios ("Banco | Master"):
    // essas palavras passam para a próxima página (mesma frase, mesmo clipe).
    let following = next;
    while (cur.length > 1 && following && following.clip === cur[cur.length - 1].clip) {
      const last = cur[cur.length - 1];
      if (endsSentence(last) || last.segmentEnd || /,$/.test(last.text)) break;
      const weak = WEAK_WORDS.has(bare(last));
      const namePair = isCap(last) && isCap(following) && cur.length > 1;
      if (!weak && !namePair) break;
      carry.unshift(cur.pop());
      following = carry[0];
    }
    pages.push(cur);
    cur = [];
    return carry;
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const breakHere =
      prev &&
      (cur.length >= maxWordsPerPage ||
        chars([...cur, w]) > maxCharsPerPage ||
        w.start - prev.end > maxPageGap ||
        w.clip !== prev.clip ||
        endsSentence(prev) ||
        prev.segmentEnd ||
        (/,$/.test(prev.text) && cur.length >= 2));
    if (breakHere) cur = flush(w);
    cur.push(w);
  }
  flush(null);
  return pages.map((ws, i) => {
    const next = pages[i + 1];
    const start = ws[0].start;
    const last = ws[ws.length - 1];
    let end = last.end + 0.35;
    if (next) end = Math.min(end, next[0].start);
    if (last.clipEnd !== undefined) end = Math.min(end, last.clipEnd); // não atravessa o corte
    return { start, end, words: ws };
  });
}

// emphasis: [{clip, word}] — destaque pontual (cor de destaque) para palavras escolhidas na edição.
export function buildCaptionPages(words, cfg, emphasis = []) {
  const c = cfg.captions;
  const em = new Set(emphasis.map((e) => `${e.clip}|${bare({ text: e.word })}`));
  return paginate(words, c).map((p) => ({
    start: p.start,
    end: p.end,
    words: p.words.map((w) => {
      const out = { text: displayText(w.text, c), start: w.start, end: w.end };
      if (em.has(`${w.clip}|${bare(w)}`)) out.em = true;
      return out;
    }),
  }));
}
