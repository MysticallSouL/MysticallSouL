import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Todos os caminhos do projeto. A raiz pode ser trocada (testes usam um projeto temporário)
// via argumento --projeto <dir> ou variável de ambiente MS_PROJETO.
export function projectPaths(root = process.env.MS_PROJETO || CODE_ROOT) {
  const r = path.resolve(root);
  const j = (...p) => path.join(r, ...p);
  return {
    root: r,
    input: j('entrada'),
    videos: j('entrada', 'videos'),
    captions: j('entrada', 'legendas'),
    music: j('entrada', 'musica'),
    brand: j('entrada', 'marca'),
    project: j('projeto'),
    config: j('projeto', 'config.json'),
    briefing: j('projeto', 'briefing.md'),
    edl: j('projeto', 'edl.json'),
    review: j('revisao'),
    scorecard: j('revisao', 'scorecard.json'),
    build: j('build'),
    probes: j('build', 'probes.json'),
    frames: j('build', 'frames'),
    audio: j('build', 'audio'),
    beats: j('build', 'beats.json'),
    timeline: j('build', 'timeline.json'),
    renderFrames: j('build', 'render'),
    reviewBuild: j('build', 'review'),
    output: j('saida'),
  };
}

export function rootFromArgs(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--projeto');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
}

export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi'];
export const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg'];
export const CAPTION_EXTENSIONS = ['.json', '.srt', '.vtt'];
