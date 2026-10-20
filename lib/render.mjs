import path from 'node:path';
import { chromium } from 'playwright';
import { ensureDir } from './fsutil.mjs';
import { startServer } from './server.mjs';

// Flags para rasterização estável entre execuções (sem GPU, sem hinting/subpixel dependente do sistema).
const CHROMIUM_ARGS = ['--disable-gpu', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--disable-skia-runtime-opts'];

export async function launchBrowser() {
  try {
    return await chromium.launch({ args: CHROMIUM_ARGS });
  } catch (e) {
    throw new Error(`Não foi possível abrir o Chromium do Playwright. Rode "npx playwright install chromium".\n${e.message}`);
  }
}

// Abre N abas com a composição carregada e pronta (window.__ready).
export async function openComposition(paths, timeline, { workers = 1, captions = true } = {}) {
  const server = await startServer(paths.root);
  const browser = await launchBrowser();
  const { width, height } = timeline.format;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  const pages = [];
  for (let i = 0; i < workers; i++) {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${server.url}/app/index.html?mode=render&timeline=/proj/build/timeline.json${captions ? '' : '&captions=0'}`);
    await page.evaluate(() => window.__ready);
    pages.push(page);
  }
  const close = async () => {
    await browser.close();
    await server.close();
  };
  return { pages, errors, close, server };
}

export async function captureAt(page, t, file, { quality = 95 } = {}) {
  await page.evaluate((time) => window.seek(time), t);
  const type = file.endsWith('.png') ? 'png' : 'jpeg';
  return page.screenshot({ path: file, type, quality: type === 'jpeg' ? quality : undefined, animations: 'disabled', caret: 'hide' });
}

// Renderiza uma lista de {t, file} distribuída entre as abas.
export async function renderFrameList(comp, jobs, { quality, onProgress } = {}) {
  ensureDir(path.dirname(jobs[0]?.file ?? '.'));
  let next = 0;
  let done = 0;
  await Promise.all(
    comp.pages.map(async (page) => {
      while (next < jobs.length) {
        const job = jobs[next++];
        await captureAt(page, job.t, job.file, { quality });
        done++;
        if (onProgress && (done % 25 === 0 || done === jobs.length)) onProgress(done, jobs.length);
      }
    }),
  );
  if (comp.errors.length) throw new Error(`Erros na composição:\n${comp.errors.join('\n')}`);
}

export const frameTime = (n, fps) => n / fps;
// Quadro visível no instante t (o quadro n cobre [n/fps, (n+1)/fps)).
export const frameIndexAt = (t, fps) => Math.floor(t * fps + 1e-6);
