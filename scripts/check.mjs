import { spawnSync } from 'node:child_process';
import { root } from './build/browser-entries.mjs';
// Static, build, regression and memory-runtime acceptance. No paid API or live-host browser test.
for (const args of [['scripts/quality.mjs'], ['scripts/build.mjs', '--check'], ['scripts/test.mjs'], ['scripts/check-runtime.mjs']]) {
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
