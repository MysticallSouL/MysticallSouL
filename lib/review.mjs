import fs from 'node:fs';
import path from 'node:path';
import { CODE_ROOT } from './paths.mjs';
import { ensureDir, exists, readJson, sha256, sha256File, writeJson } from './fsutil.mjs';
import { ffmpeg } from './proc.mjs';
import { captureAt, frameIndexAt } from './render.mjs';

export const CRITERIA = {
  hook: 'Gancho nos primeiros 2 s',
  readability: 'Legibilidade em tela de celular',
  motion: 'Qualidade do movimento',
  variety: 'Variedade (algo novo a cada 2–4 s)',
  brand: 'Fidelidade à marca',
  sync: 'Sincronia com o som',
};

function compositionSources() {
  const dir = path.join(CODE_ROOT, 'composition');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  return walk(dir).sort();
}

// Assinatura do corte atual: linha do tempo + código da composição + áudio final.
// Qualquer mudança invalida a revisão anterior e exige nova rodada.
export function currentHash(paths) {
  const parts = [fs.readFileSync(paths.timeline)];
  for (const f of compositionSources()) parts.push(Buffer.from(path.relative(CODE_ROOT, f)), fs.readFileSync(f));
  const audio = path.join(paths.audio, 'final.wav');
  if (exists(audio)) parts.push(Buffer.from(sha256File(audio)));
  return sha256(Buffer.concat(parts)).slice(0, 20);
}

// Momentos em que algo novo aparece (cortes, páginas de legenda, palavras de texto, punches).
export function noveltyEvents(tl) {
  const ev = [{ t: 0, what: 'início' }];
  for (const c of tl.clips.slice(1)) ev.push({ t: c.start, what: `corte ${c.id}` });
  for (const c of tl.clips) for (const p of c.punches) ev.push({ t: p.at, what: `punch ${c.id}` });
  for (const p of tl.captions) ev.push({ t: p.start, what: 'legenda' });
  for (const tx of tl.texts) for (const w of tx.words || tx.lines) ev.push({ t: w.at, what: `${tx.type}: ${w.text}` });
  return ev.sort((a, b) => a.t - b.t);
}

export function noveltyGaps(tl, maxGap = 4) {
  const ev = noveltyEvents(tl);
  ev.push({ t: tl.duration, what: 'fim' });
  const gaps = [];
  for (let i = 1; i < ev.length; i++) {
    const g = ev[i].t - ev[i - 1].t;
    if (g > maxGap) gaps.push({ from: Number(ev[i - 1].t.toFixed(3)), to: Number(ev[i].t.toFixed(3)), seconds: Number(g.toFixed(2)) });
  }
  return gaps;
}

async function grayThumb(file) {
  const { stdout } = await ffmpeg(['-i', file, '-vf', 'scale=36:64,format=gray', '-f', 'rawvideo', '-']);
  return stdout;
}

const meanAbsDiff = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length / 255;
};

// Um quadro por batida, montados em folhas de contato com rótulo de batida/tempo/clipe.
export async function buildContactSheets(paths, cfg, tl, comp) {
  const fps = tl.format.fps;
  const outDir = paths.reviewBuild;
  const beatDir = path.join(outDir, 'batidas');
  fs.rmSync(outDir, { recursive: true, force: true });
  ensureDir(beatDir);
  const beats = tl.beats.beats.length ? tl.beats.beats : [0];
  const downs = new Set(tl.beats.downbeats.map((b) => b.toFixed(4)));
  const jobs = beats.map((b, i) => {
    const n = frameIndexAt(b, fps);
    return { i, beat: b, n, t: n / fps, file: path.join(beatDir, `${String(i).padStart(4, '0')}.jpg`), down: downs.has(b.toFixed(4)) };
  });
  let next = 0;
  await Promise.all(
    comp.pages.map(async (page) => {
      while (next < jobs.length) {
        const j = jobs[next++];
        await captureAt(page, j.t, j.file, { quality: 85 });
      }
    }),
  );

  const clipOf = (t) => [...tl.clips].reverse().find((c) => t >= c.start - 1e-9)?.id;
  const per = cfg.review.contactSheetColumns * cfg.review.contactSheetRows;
  const sheets = [];
  const page = comp.pages[0];
  for (let s = 0; s * per < jobs.length; s++) {
    const chunk = jobs.slice(s * per, (s + 1) * per);
    const cells = chunk
      .map(
        (j) => `<figure><img src="${comp.server.url}/proj/${path.relative(paths.root, j.file).split(path.sep).join('/')}"><figcaption>${j.down ? '●' : '○'} #${j.i + 1} · ${j.beat.toFixed(2)}s · q${j.n} · ${clipOf(j.t)}</figcaption></figure>`,
      )
      .join('');
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;background:#111;color:#ddd;font:600 15px system-ui,sans-serif}
      header{padding:12px 16px;font-size:18px}
      main{display:grid;grid-template-columns:repeat(${cfg.review.contactSheetColumns},270px);gap:10px;padding:0 16px 16px}
      figure{margin:0} img{display:block;width:270px;height:480px} figcaption{padding:4px 0}
    </style><header>Folha ${s + 1} · ${tl.beats.bpm} BPM (${tl.beats.measured ? 'medido' : 'nominal'}) · ● tempo forte · tamanho ≈ celular (270×480)</header><main>${cells}</main>`;
    await page.setViewportSize({ width: cfg.review.contactSheetColumns * 280 + 32, height: 800 });
    await page.setContent(html);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    const file = path.join(outDir, `contact-sheet-${String(s + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: file, fullPage: true });
    sheets.push(file);
  }

  const novelty = [];
  let prev = null;
  for (const j of jobs) {
    const g = await grayThumb(j.file);
    if (prev) novelty.push({ beat: j.i + 1, t: Number(j.beat.toFixed(3)), change: Number(meanAbsDiff(prev, g).toFixed(4)) });
    prev = g;
  }
  return { sheets, frames: jobs.length, novelty };
}

export function loadScorecard(paths) {
  return exists(paths.scorecard) ? readJson(paths.scorecard) : { criteria: Object.keys(CRITERIA), rounds: [] };
}

export function checkGate(paths, cfg, hash) {
  const card = loadScorecard(paths);
  const last = card.rounds?.[card.rounds.length - 1];
  const reasons = [];
  if (!last) reasons.push('Nenhuma rodada de revisão registrada em revisao/scorecard.json.');
  else {
    if (last.hash !== hash) reasons.push(`A última revisão (hash ${last.hash}) não corresponde ao corte atual (hash ${hash}). Gere a folha de contato de novo e revise.`);
    for (const k of Object.keys(CRITERIA)) {
      const v = last.scores?.[k];
      if (!Number.isInteger(v) || v < 1 || v > 10) reasons.push(`Nota ausente ou inválida para "${k}" (${CRITERIA[k]}).`);
      else if (v < cfg.review.minScore) reasons.push(`"${k}" (${CRITERIA[k]}) com nota ${v} < ${cfg.review.minScore}.`);
    }
  }
  return { ok: reasons.length === 0, reasons, last };
}

export function writeReviewReport(paths, report) {
  writeJson(path.join(paths.reviewBuild, 'report.json'), report);
}
