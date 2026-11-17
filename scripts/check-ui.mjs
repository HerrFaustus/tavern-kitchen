import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname,'..');
const cachedPlaywright = path.join(root, '.cache/pw/node_modules/playwright-core');
const env = { ...process.env };
if (!env.PLAYWRIGHT_MODULE && !fs.existsSync(path.join(root, 'node_modules/playwright')) && fs.existsSync(cachedPlaywright)) {
    env.PLAYWRIGHT_MODULE = cachedPlaywright;
}
if (!env.CHROMIUM_BIN) {
    const pwTarget = env.PLAYWRIGHT_MODULE || (fs.existsSync(path.join(root, 'node_modules/playwright')) ? 'playwright' : null);
    if (pwTarget) {
        const { chromium } = createRequire(import.meta.url)(pwTarget);
        const executable = chromium?.executablePath?.();
        if (executable && fs.existsSync(executable)) env.CHROMIUM_BIN = executable;
    }
}
const suites = ['workspace-layout','api-layout','api-workspace','summary-workspace','summary-footer',
    'place-map','proposal-workspace','planner-ui','planner-workspace'];
for (const suite of suites) {
    const file = 'scripts/check-' + suite + '.mjs';
    console.log(file);
    const result = spawnSync(process.execPath,[file],{cwd:root,stdio:'inherit',env});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(JSON.stringify({passed:suites.length,suites}));
