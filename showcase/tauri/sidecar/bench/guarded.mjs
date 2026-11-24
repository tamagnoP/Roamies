// Imported first by the measuring tools that can make a sound: unless they already run under guard.sh, they start
// themselves again under it and leave with its exit code, so the sound is put back however the run ends.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.BENCH_GUARD) {
  const guard = path.join(path.dirname(fileURLToPath(import.meta.url)), 'guard.sh');
  const r = spawnSync(guard, [process.execPath, ...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
