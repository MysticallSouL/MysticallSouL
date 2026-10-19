import { spawn } from 'node:child_process';

// Executa um processo e devolve stdout (Buffer) e stderr (string).
// Em caso de falha, a mensagem inclui o final do stderr para diagnóstico.
export function run(cmd, args, { input, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      err += d;
      if (err.length > 200_000) err = err.slice(-100_000);
    });
    child.on('error', (e) => reject(new Error(`Não foi possível executar ${cmd}: ${e.message}`)));
    child.on('close', (code) => {
      const stdout = Buffer.concat(out);
      if (code === 0) resolve({ stdout, stderr: err });
      else {
        const tail = err.trim().split('\n').slice(-15).join('\n');
        reject(new Error(`${cmd} terminou com código ${code}\n${tail}`));
      }
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export const ffmpeg = (args, opts) => run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], opts);
export const ffprobe = (args, opts) => run('ffprobe', ['-v', 'error', ...args], opts);

export function log(msg) {
  process.stdout.write(`${msg}\n`);
}
