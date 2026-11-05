import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { checkRemovedVariables } from './check-removed-variables.mjs';

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(tmpdir(), 'kitchen-removal-'));
    t.after(() => {
        assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    for (const child of ['docs', 'core', 'dist', 'output']) fs.mkdirSync(path.join(directory, child));
    fs.writeFileSync(path.join(directory, 'docs/removed-variable-files.json'), JSON.stringify({ paths: ['modules/variables/old.js'], runtimeSymbols: ['TK_Guard'] }));
    fs.writeFileSync(path.join(directory, 'output/browser-build-audit.json'), JSON.stringify({ modules: { 'entry.js': ['core/kitchen-runtime.js'] } }));
    return directory;
}
test('the repository contains no retired variable runtime, imports or navigation', () => {
    assert.equal(checkRemovedVariables(), 23);
});
test('source removal gate rejects restored files, live engine symbols and an old navigation entry', t => {
    const directory = fixture(t);
    assert.equal(checkRemovedVariables(directory), 1);
    const runtime = path.join(directory, 'core/kitchen-workspace.js');
    fs.writeFileSync(runtime, "const routes = [['variables', '变量']];");
    assert.throws(() => checkRemovedVariables(directory), /navigation/);
    fs.writeFileSync(runtime, 'globalThis.TK_Guard = {};');
    assert.throws(() => checkRemovedVariables(directory), /runtime/);
    fs.writeFileSync(runtime, '');
    fs.mkdirSync(path.join(directory, 'modules/variables'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'modules/variables/old.js'), '');
    assert.throws(() => checkRemovedVariables(directory), /source remains/);
});
test('build removal gate rejects both a retired module in the graph and a hidden built runtime', t => {
    const directory = fixture(t), buildDirectory = path.join(directory, 'dist');
    assert.equal(checkRemovedVariables(directory, { buildDirectory }), 1);
    fs.writeFileSync(path.join(directory, 'output/browser-build-audit.json'), JSON.stringify({ modules: { 'entry.js': ['modules/variables/hidden.js'] } }));
    assert.throws(() => checkRemovedVariables(directory, { buildDirectory }), /module in build/);
    fs.writeFileSync(path.join(directory, 'output/browser-build-audit.json'), JSON.stringify({ modules: {} }));
    fs.writeFileSync(path.join(buildDirectory, 'entry.js'), 'globalThis.TK_Guard = {};');
    assert.throws(() => checkRemovedVariables(directory, { buildDirectory }), /runtime/);
});
