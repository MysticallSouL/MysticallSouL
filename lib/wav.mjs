import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './fsutil.mjs';
import { ffmpeg } from './proc.mjs';

// WAV IEEE float 32 bits (sem perda para mixagem posterior no FFmpeg).
export function encodeWav(channels, sampleRate) {
  const n = channels[0].length;
  const nc = channels.length;
  const dataBytes = n * nc * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20);
  buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * nc * 4, 28);
  buf.writeUInt16LE(nc * 4, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++, o += 4) buf.writeFloatLE(channels[c][i], o);
  return buf;
}

export function writeWav(file, channels, sampleRate) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, encodeWav(channels, sampleRate));
}

// Decodifica qualquer áudio para PCM mono float32 na taxa pedida.
export async function decodeMono(file, sampleRate) {
  const { stdout } = await ffmpeg(['-i', file, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-']);
  return new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4).slice();
}
