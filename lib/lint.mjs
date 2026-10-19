import fs from 'node:fs';
import path from 'node:path';
import { CODE_ROOT } from './paths.mjs';

// Verificação estática do contrato de renderização sobre os arquivos da composição.
// preview.js é a única exceção (só roda no modo de pré-visualização).
const RULES = [
  { re: /Math\.random/, msg: 'Math.random (use mulberry32 de lib/noise.js)' },
  { re: /\bsetTimeout\b|\bsetInterval\b/, msg: 'setTimeout/setInterval' },
  { re: /requestAnimationFrame/, msg: 'requestAnimationFrame' },
  { re: /Date\.now|performance\.now|new Date\(/, msg: 'leitura de relógio' },
  { re: /(^|[;{\s])transition(-[a-z]+)?\s*:/m, msg: 'transição CSS', css: true },
  { re: /(^|[;{\s])animation(-[a-z]+)?\s*:/m, msg: 'animação CSS', css: true },
  { re: /@keyframes/, msg: '@keyframes', css: true },
  { re: /\.animate\(/, msg: 'Web Animations API' },
  { re: /style\.(transition|animation)|setProperty\(['"](transition|animation)/, msg: 'transição/animação CSS via JS' },
];

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

export function lintSource(src, file) {
  const code = stripComments(src);
  const ext = path.extname(file);
  return RULES.filter((r) => !r.css || ['.css', '.html'].includes(ext))
    .filter((r) => r.re.test(code))
    .map((r) => `${file}: ${r.msg}`);
}

export function lintComposition(dir = path.join(CODE_ROOT, 'composition')) {
  const problems = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|mjs|css|html)$/.test(e.name) && e.name !== 'preview.js') {
        problems.push(...lintSource(fs.readFileSync(p, 'utf8'), path.relative(CODE_ROOT, p)));
      }
    }
  };
  walk(dir);
  return problems;
}
