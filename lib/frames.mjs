import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, exists, readJson, sha256, writeJson } from './fsutil.mjs';
import { ffmpeg } from './proc.mjs';

const even = (x) => Math.max(2, Math.floor(x / 2) * 2);

// Recorte 9:16 a partir do ponto de foco (0..1) do clipe.
export function cropFor(probe, focus, width, height) {
  const target = width / height;
  const src = probe.width / probe.height;
  if (src > target) {
    const w = even(probe.height * target);
    return { w, h: even(probe.height), x: Math.round((probe.width - w) * focus.x), y: 0 };
  }
  const h = even(probe.width / target);
  return { w: even(probe.width), h, x: 0, y: Math.round((probe.height - h) * focus.y) };
}

// Extrai a sequência de quadros (JPEG) de um clipe já na grade de FPS do projeto.
// Cache por conteúdo: só reextrai se fonte, corte, foco ou formato mudarem.
export async function extractClipFrames(clip, probe, cfg, framesDir) {
  const { width, height, fps } = cfg.format;
  const crop = cropFor(probe, clip.focus, width, height);
  const key = sha256(
    JSON.stringify({ v: 2, f: probe.file, s: probe.size, m: probe.mtimeMs, in: clip.in, out: clip.out, sp: clip.speed, crop, width, height, fps }),
  ).slice(0, 16);
  const dir = path.join(framesDir, `${clip.id}-${key}`);
  const manifestFile = path.join(dir, 'manifest.json');
  if (exists(manifestFile)) return { dir, ...readJson(manifestFile), cached: true };
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  const tonemap = probe.hdr
    ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,'
    : '';
  const vf = [
    `${tonemap}setpts=(PTS-STARTPTS)/${clip.speed}`,
    `fps=${fps}`,
    `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`,
    `scale=${width}:${height}:flags=lanczos`,
    'format=yuvj420p',
  ].join(',');
  await ffmpeg([
    '-ss', clip.in.toFixed(4), '-t', (clip.out - clip.in).toFixed(4), '-i', probe.file,
    '-an', '-vf', vf, '-q:v', '2', '-start_number', '0', path.join(dir, '%06d.jpg'),
  ]);
  const count = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length;
  const expected = Math.round(clip.duration * fps);
  if (count === 0) throw new Error(`Nenhum quadro extraído de ${probe.name} (${clip.in}s–${clip.out}s).`);
  const manifest = { count, expected, crop, hdrTonemapped: probe.hdr };
  writeJson(manifestFile, manifest);
  return { dir, ...manifest, cached: false };
}
