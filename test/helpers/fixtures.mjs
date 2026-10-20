// Projeto de TESTE com material sintético (padrões testsrc do FFmpeg e tons).
// Nada aqui representa os vídeos, falas ou legendas reais da Mysticall Soul.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpeg } from '../../lib/proc.mjs';
import { writeJson } from '../../lib/fsutil.mjs';

export async function createFixtureProject({ seconds = 3, withEdl = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-fixture-'));
  const vids = path.join(root, 'entrada', 'videos');
  const caps = path.join(root, 'entrada', 'legendas');
  fs.mkdirSync(vids, { recursive: true });
  fs.mkdirSync(caps, { recursive: true });
  const tone = (hz) => `sine=f=${hz}:r=48000:d=${seconds},volume='0.5+0.4*sin(2*PI*3*t)':eval=frame`;
  // A: horizontal 16:9 com áudio; B: vertical 9:16 com áudio; C: 16:9 menor, sem áudio.
  await ffmpeg(['-f', 'lavfi', '-i', `testsrc2=s=1920x1080:r=30:d=${seconds}`, '-f', 'lavfi', '-i', tone(220), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(vids, 'teste-a.mp4')]);
  await ffmpeg(['-f', 'lavfi', '-i', `smptehdbars=s=1080x1920:r=25:d=${seconds}`, '-f', 'lavfi', '-i', tone(330), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(vids, 'teste-b.mp4')]);
  await ffmpeg(['-f', 'lavfi', '-i', `testsrc=s=1280x720:r=24:d=${seconds}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(vids, 'teste-c.mp4')]);
  fs.writeFileSync(
    path.join(caps, 'teste-a.srt'),
    '1\n00:00:00,100 --> 00:00:01,400\nlegenda de teste número um\n\n2\n00:00:01,500 --> 00:00:02,900\nação, coração e informação!\n',
  );
  writeJson(path.join(caps, 'teste-b.json'), {
    origin: 'fixture-de-teste',
    reviewed: true,
    segments: [
      { start: 0.2, end: 1.6, text: 'palavras com tempo exato', words: [
        { text: 'palavras', start: 0.2, end: 0.6 }, { text: 'com', start: 0.6, end: 0.8 },
        { text: 'tempo', start: 0.8, end: 1.2 }, { text: 'exato', start: 1.2, end: 1.6 },
      ] },
    ],
  });
  writeJson(path.join(root, 'projeto', 'config.json'), {
    brand: { name: 'Teste', accent: '#9D5CFF' },
    audio: { music: { mode: 'synth', bpm: 120, seed: 3 } },
    render: { workers: 2, preset: 'veryfast' },
  });
  if (withEdl) {
    writeJson(path.join(root, 'projeto', 'edl.json'), {
      version: 1,
      status: 'edited',
      clips: [
        { id: 'c01', source: 'teste-a.mp4', in: 0, out: 2, focus: { x: 0.3, y: 0.5 }, punches: [{ at: 1, scale: 1.15 }] },
        { id: 'c02', source: 'teste-b.mp4', in: 0, out: 2, transitionIn: 'whip', zoom: 1, zoomEnd: 1.1 },
        { id: 'c03', source: 'teste-c.mp4', in: 0.5, out: 2.5, transitionIn: 'cut' },
      ],
      texts: [
        { type: 'hook', text: 'GANCHO DE TESTE', start: 0, end: 2 },
        { type: 'cta', text: 'FIM DO TESTE', start: 4.5, end: 6 },
        { type: 'card', start: { clip: 'c02', t: 0.5 }, end: { clip: 'c02', t: 1.9 }, lines: [
          { text: 'CARTÃO DE TESTE', accent: true }, { text: 'SEGUNDA LINHA', at: { clip: 'c02', t: 1.25 } },
        ] },
      ],
      emphasis: [{ clip: 'c02', word: 'tempo' }],
      sfx: [{ type: 'pop', at: 3 }],
    });
  }
  return root;
}
