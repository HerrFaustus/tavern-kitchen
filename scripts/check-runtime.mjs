import { spawnSync } from 'node:child_process';
import { root } from './build/browser-entries.mjs';
const result = spawnSync(process.execPath, ['scripts/story-summary-runtime-check.mjs'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
