import { spawnSync } from 'node:child_process';
import { root } from './build/browser-entries.mjs';

for (const args of [
    ['scripts/check-project.mjs'],
    ['scripts/check-garbled.js'],
    ['scripts/check-relative-imports.mjs'],
    ['node_modules/eslint/bin/eslint.js', '.', '--ext', '.js,.mjs,.cjs,.ts,.mts,.cts,.vue,.html', '--max-warnings', '0'],
]) {
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
