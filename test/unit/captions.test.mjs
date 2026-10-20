import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSrt, parseVtt, estimateWords, wordsFromDocument, mapWordsToTimeline, paginate, displayText, buildCaptionPages } from '../../lib/captions.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.mjs';

test('SRT: tempos, várias linhas e tags removidas', () => {
  const s = parseSrt('1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Olá</i>, tudo\r\nbem?\r\n\r\n2\r\n00:01:00,250 --> 00:01:01,000\r\n{\\an8}Tchau\r\n');
  assert.deepEqual(s, [
    { start: 1, end: 2.5, text: 'Olá, tudo bem?' },
    { start: 60.25, end: 61, text: 'Tchau' },
  ]);
});

test('VTT: cabeçalho, NOTE e configurações de cue', () => {
  const s = parseVtt('WEBVTT\n\nNOTE comentário\n\n00:01.500 --> 00:03.000 align:center\nPrimeira fala\n');
  assert.deepEqual(s, [{ start: 1.5, end: 3, text: 'Primeira fala' }]);
});

test('palavras estimadas cobrem o segmento inteiro', () => {
  const w = estimateWords({ start: 2, end: 4, text: 'uma frase curta' });
  assert.equal(w.length, 3);
  assert.equal(w[0].start, 2);
  assert.ok(Math.abs(w[2].end - 4) < 1e-9);
  assert.ok(w.every((x) => x.estimated));
});

test('caixa alta pt-BR preserva acentos; pontuação final removida, ? e ! mantidos', () => {
  const opts = { uppercase: true, stripPunctuation: true };
  assert.equal(displayText('ação,', opts), 'AÇÃO');
  assert.equal(displayText('você?', opts), 'VOCÊ?');
  assert.equal(displayText('coração!', opts), 'CORAÇÃO!');
  assert.equal(displayText('R$10,50.', opts), 'R$10,50');
});

test('mapeamento respeita in/out, velocidade e posição do clipe', () => {
  const words = { 'a.mp4': [
    { text: 'fora', start: 0.0, end: 0.4 },
    { text: 'dentro', start: 1.0, end: 1.4 },
    { text: 'depois', start: 3.0, end: 3.2 },
  ] };
  const clips = [{ id: 'c1', source: 'a.mp4', in: 0.8, out: 2.8, speed: 2, start: 5, end: 6 }];
  const m = mapWordsToTimeline(words, clips);
  assert.equal(m.length, 1);
  assert.equal(m[0].text, 'dentro');
  assert.ok(Math.abs(m[0].start - 5.1) < 1e-9 && Math.abs(m[0].end - 5.3) < 1e-9);
  assert.equal(m[0].clipEnd, 6);
});

test('paginação: limite de palavras, não termina em palavra fraca, quebra no fim de segmento e no corte', () => {
  const mk = (text, start, extra = {}) => ({ text, start, end: start + 0.2, clip: 'c1', clipEnd: 10, ...extra });
  const words = [mk('vamos', 0), mk('falar', 0.2), mk('de', 0.4), mk('energia', 0.6), mk('fim', 0.8, { segmentEnd: true }), mk('novo', 1.0), mk('outro', 1.2, { clip: 'c2' })];
  const pages = paginate(words, { maxWordsPerPage: 3, maxCharsPerPage: 30, maxPageGap: 0.6 });
  assert.deepEqual(pages.map((p) => p.words.map((w) => w.text).join(' ')), ['vamos falar', 'de energia fim', 'novo', 'outro']);
  assert.ok(pages.every((p, i) => !pages[i + 1] || p.end <= pages[i + 1].start));
});

test('página não ultrapassa o fim do clipe', () => {
  const pages = paginate([{ text: 'última', start: 1.8, end: 1.95, clip: 'c1', clipEnd: 2 }], { maxWordsPerPage: 3, maxCharsPerPage: 18, maxPageGap: 0.6 });
  assert.equal(pages[0].end, 2);
});

test('documento JSON com palavras + pipeline completo de páginas', () => {
  const words = wordsFromDocument({ segments: [{ start: 0, end: 1, text: 'olá mundo', words: [{ word: ' olá', start: 0, end: 0.4 }, { word: ' mundo.', start: 0.4, end: 1 }] }] });
  const clips = [{ id: 'c1', source: 'v.mp4', in: 0, out: 1, speed: 1, start: 0, end: 1 }];
  const pages = buildCaptionPages(mapWordsToTimeline({ 'v.mp4': words }, clips), DEFAULT_CONFIG);
  assert.deepEqual(pages[0].words.map((w) => w.text), ['OLÁ', 'MUNDO']);
});

test('destaque pontual: só a palavra escolhida, no clipe escolhido', () => {
  const words = [
    { text: 'uma', start: 0, end: 0.2, clip: 'c1', clipEnd: 5 },
    { text: 'zona.', start: 0.2, end: 0.5, clip: 'c1', clipEnd: 5 },
    { text: 'zona', start: 5, end: 5.3, clip: 'c2', clipEnd: 9 },
  ];
  const cfg = { captions: { ...DEFAULT_CONFIG.captions, uppercase: false, stripPunctuation: false } };
  const pages = buildCaptionPages(words, cfg, [{ clip: 'c1', word: 'Zona' }]);
  const flat = pages.flatMap((p) => p.words);
  assert.deepEqual(flat.map((w) => [w.text, Boolean(w.em)]), [['uma', false], ['zona.', true], ['zona', false]]);
});

test('paginação: quebra depois de vírgula e não separa nomes próprios', () => {
  const ws = 'teve discussão sobre o Banco Master, sobre corrupção e foi ontem entre Flávio Bolsonaro e Lula,'.split(' ');
  const words = ws.map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25, clip: 'c1', clipEnd: 99 }));
  const pages = paginate(words, { maxWordsPerPage: 4, maxCharsPerPage: 18, maxPageGap: 0.6 }).map((p) => p.words.map((w) => w.text).join(' '));
  for (const pair of ['Banco Master,', 'Flávio Bolsonaro']) assert.ok(pages.some((p) => p.includes(pair)), `${pair} separado: ${JSON.stringify(pages)}`);
  assert.ok(pages.every((p) => !/,\s/.test(p)), `vírgula no meio da página: ${JSON.stringify(pages)}`);
});
