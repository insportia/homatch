import { spawn } from 'node:child_process';

console.log('[launcher] starting Homatch worker under Xvfb');

const child = spawn('xvfb-run', ['-a', 'npm', 'start'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  console.error('[launcher] failed to start xvfb-run', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) console.error(`[launcher] worker terminated by signal ${signal}`);
  else console.error(`[launcher] worker exited with code ${code}`);
  process.exit(code ?? 1);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}
