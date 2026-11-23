import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = dirname(fileURLToPath(import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Neon may need a few seconds to wake its database after an idle period.
if (process.env.DATABASE_URL) {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (!databaseUrl.searchParams.has('connect_timeout')) {
    databaseUrl.searchParams.set('connect_timeout', '15');
  }
  process.env.DATABASE_URL = databaseUrl.toString();
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: serverDir,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let output = '';
    if (capture) {
      for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', chunk => {
          const text = chunk.toString();
          output = (output + text).slice(-20000);
          (stream === child.stdout ? process.stdout : process.stderr).write(chunk);
        });
      }
    }
    child.on('error', rejectRun);
    child.on('close', code => resolveRun({ code: code ?? 1, output }));
  });
}

let migrationResult;
for (let attempt = 1; attempt <= 4; attempt += 1) {
  migrationResult = await run(npm, ['run', 'db:migrate'], { capture: true });
  if (migrationResult.code === 0) break;

  const timedOut = /P1002|timed out/i.test(migrationResult.output);
  if (!timedOut || attempt === 4) process.exit(migrationResult.code);

  const waitSeconds = attempt * 5;
  console.warn(`Database migration timed out. Retrying in ${waitSeconds} seconds (${attempt}/3)...`);
  await delay(waitSeconds * 1000);
}

const seedResult = await run(npm, ['run', 'db:seed']);
if (seedResult.code !== 0) process.exit(seedResult.code);

const app = spawn(process.execPath, [resolve(serverDir, 'src/app.js')], {
  cwd: serverDir,
  env: process.env,
  stdio: 'inherit',
});
app.on('error', error => {
  console.error('Could not start the web server:', error);
  process.exitCode = 1;
});
app.on('close', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => app.kill(signal));
}
