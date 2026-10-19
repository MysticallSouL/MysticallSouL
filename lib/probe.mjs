import fs from 'node:fs';
import path from 'node:path';
import { ffprobe } from './proc.mjs';

const HDR_TRANSFERS = ['smpte2084', 'arib-std-b67'];

function parseRate(r) {
  if (!r || r === '0/0') return null;
  const [n, d] = r.split('/').map(Number);
  return d ? n / d : n;
}

// Lê metadados de um vídeo e normaliza dimensões considerando a rotação gravada pelo celular.
export async function probeVideo(file) {
  const { stdout } = await ffprobe(['-print_format', 'json', '-show_streams', '-show_format', file]);
  const info = JSON.parse(stdout.toString());
  const v = info.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error(`Arquivo sem trilha de vídeo: ${file}`);
  const a = info.streams.find((s) => s.codec_type === 'audio');
  let rotation = 0;
  for (const sd of v.side_data_list || []) if (typeof sd.rotation === 'number') rotation = sd.rotation;
  if (!rotation && v.tags?.rotate) rotation = Number(v.tags.rotate);
  const swap = Math.abs(rotation) % 180 === 90;
  const duration = Number(info.format.duration || v.duration);
  const st = fs.statSync(file);
  return {
    file: path.resolve(file),
    name: path.basename(file),
    size: st.size,
    mtimeMs: Math.round(st.mtimeMs),
    duration,
    width: swap ? v.height : v.width,
    height: swap ? v.width : v.height,
    rotation,
    fps: parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate),
    videoCodec: v.codec_name,
    pixFmt: v.pix_fmt,
    colorTransfer: v.color_transfer || null,
    hdr: HDR_TRANSFERS.includes(v.color_transfer),
    hasAudio: Boolean(a),
    audioCodec: a?.codec_name || null,
    audioChannels: a?.channels || 0,
    audioSampleRate: a ? Number(a.sample_rate) : null,
  };
}

export async function probeOutput(file) {
  const { stdout } = await ffprobe([
    '-print_format', 'json', '-count_frames', '-show_streams', '-show_format', file,
  ]);
  return JSON.parse(stdout.toString());
}
