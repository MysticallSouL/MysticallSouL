import { ffmpeg } from './proc.mjs';
import { probeOutput } from './probe.mjs';

// H.264 High, yuv420p, BT.709 faixa limitada, CFR, faststart; áudio AAC 48 kHz.
export async function encodeVideo({ framesPattern, audioFile, outFile, cfg, frameCount }) {
  const { fps } = cfg.format;
  const r = cfg.render;
  await ffmpeg([
    '-framerate', String(fps), '-start_number', '0', '-i', framesPattern,
    '-i', audioFile,
    '-map', '0:v:0', '-map', '1:a:0',
    '-frames:v', String(frameCount),
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', r.preset, '-crf', String(r.crf), '-profile:v', 'high', '-level:v', '4.2',
    '-pix_fmt', 'yuv420p', '-r', String(fps), '-fps_mode', 'cfr', '-g', String(fps * 2),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', r.audioBitrate, '-ar', String(cfg.audio.sampleRate), '-ac', '2',
    '-t', (frameCount / fps).toFixed(6),
    '-movflags', '+faststart',
    outFile,
  ]);
}

// Confere o arquivo final contra o contrato técnico.
export async function verifyOutput(file, cfg, frameCount) {
  const info = await probeOutput(file);
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  const { width, height, fps } = cfg.format;
  const checks = [
    ['codec H.264', v?.codec_name === 'h264', v?.codec_name],
    ['pix_fmt yuv420p', v?.pix_fmt === 'yuv420p', v?.pix_fmt],
    [`resolução ${width}x${height}`, v?.width === width && v?.height === height, `${v?.width}x${v?.height}`],
    [`CFR ${fps}`, v?.r_frame_rate === `${fps}/1` && v?.avg_frame_rate === `${fps}/1`, `${v?.r_frame_rate} / ${v?.avg_frame_rate}`],
    [`${frameCount} quadros`, Number(v?.nb_read_frames) === frameCount, v?.nb_read_frames],
    ['áudio AAC', a?.codec_name === 'aac', a?.codec_name],
  ];
  return { ok: checks.every((c) => c[1]), checks: checks.map(([name, ok, got]) => ({ name, ok, got })), info };
}
