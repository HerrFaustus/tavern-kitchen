import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const runtimeExtensions = new Set(['.js', '.mjs', '.ts', '.vue', '.html', '.css']);
function files(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory()
        ? item.name === 'tests' ? [] : files(path.join(directory, item.name))
        : runtimeExtensions.has(path.extname(item.name)) && !/\.test\.[cm]?[jt]s$/.test(item.name) ? [path.join(directory, item.name)] : []);
}
export function checkRemovedVariables(directory = root, { buildDirectory } = {}) {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'docs/removed-variable-files.json'), 'utf8'));
    for (const relative of ['modules/variables', ...manifest.paths]) {
        if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Invalid removal manifest path');
        if (fs.existsSync(path.join(directory, relative))) throw new Error(`Retired variable source remains: ${relative}`);
    }
    const inspect = file => {
        const source = fs.readFileSync(file, 'utf8');
        for (const symbol of manifest.runtimeSymbols) if (source.includes(symbol)) throw new Error(`Retired variable runtime ${symbol}: ${path.relative(directory, file)}`);
        if (path.basename(file) === 'kitchen-workspace.js' && /\[\s*['"]variables['"]\s*,/.test(source)) throw new Error('Retired variable navigation remains');
    };
    for (const location of ['core', 'modules', 'shared']) for (const file of files(path.join(directory, location))) inspect(file);
    if (buildDirectory) {
        const audit = JSON.parse(fs.readFileSync(path.join(directory, 'output/browser-build-audit.json'), 'utf8'));
        for (const module of Object.values(audit.modules).flat()) {
            const normalized = module.replaceAll('\\', '/');
            if (normalized.includes('modules/variables/') || manifest.paths.some(relative => normalized === relative || normalized.endsWith(`/${relative}`))) {
                throw new Error(`Retired variable module in build: ${module}`);
            }
        }
        for (const file of files(buildDirectory)) inspect(file);
    }
    return manifest.paths.length;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(`Retired variable system absent (${checkRemovedVariables()} deleted source files).`);
}
