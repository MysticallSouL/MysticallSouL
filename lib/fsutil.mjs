import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const exists = (p) => fs.existsSync(p);
export const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });
export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export function writeJson(p, data) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
}

export function listFiles(dir, extensions) {
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith('.') && extensions.includes(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    .map((f) => path.join(dir, f));
}

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

export function sha256File(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(1 << 20);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest('hex');
}

// Arquivo ainda é um ponteiro do Git LFS (não baixado com `git lfs pull`)?
export function isLfsPointer(p) {
  const st = fs.statSync(p);
  if (st.size > 1024) return false;
  return fs.readFileSync(p, 'utf8').startsWith('version https://git-lfs.github.com/spec/');
}
