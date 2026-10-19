#!/usr/bin/env node
// Servidor de pré-visualização: abra a URL impressa no navegador (requer "npm run preparar" antes).
import { projectPaths, rootFromArgs } from '../lib/paths.mjs';
import { exists } from '../lib/fsutil.mjs';
import { startServer } from '../lib/server.mjs';

const paths = projectPaths(rootFromArgs());
if (!exists(paths.timeline)) {
  console.log('Linha do tempo não encontrada. Rode "npm run preparar" primeiro.');
  process.exit(3);
}
const port = Number(process.env.PORT) || 5173;
const server = await startServer(paths.root, { port });
console.log(`Pré-visualização: ${server.url}/app/index.html?mode=preview`);
console.log('Ctrl+C para encerrar.');
