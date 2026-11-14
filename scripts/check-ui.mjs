import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname,'..');
const suites = ['workspace-layout','api-layout','api-workspace','summary-workspace','summary-footer',
    'place-map','proposal-workspace','planner-ui','planner-workspace'];
for (const suite of suites) {
    const file = 'scripts/check-' + suite + '.mjs';
    console.log(file);
    const result = spawnSync(process.execPath,[file],{cwd:root,stdio:'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(JSON.stringify({passed:suites.length,suites}));
