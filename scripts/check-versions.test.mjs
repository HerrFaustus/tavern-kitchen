import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkVersions } from './check-versions.mjs';

function fixture(t, version = '1.2.3') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-kitchen-versions-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.mkdirSync(path.join(directory, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ version }));
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version }));
    fs.writeFileSync(path.join(directory, 'README.md'), `# 酒馆后厨 ${version}\n`);
    fs.writeFileSync(path.join(directory, 'docs/UPSTREAM.md'), `派生版：酒馆后厨 ${version}。\n`);
    fs.writeFileSync(path.join(directory, 'docs/validation.json'), JSON.stringify({ version }));
    fs.writeFileSync(path.join(directory, 'docs/VALIDATION.md'), `## ${version} 验证\n`);
    return directory;
}

test('accepts matching versions and a matching release tag', t => {
    const directory = fixture(t);
    assert.equal(checkVersions(directory, { tag: 'v1.2.3' }), '1.2.3');
});

test('rejects a mismatched package version', t => {
    const directory = fixture(t);
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '1.2.4' }));
    assert.throws(() => checkVersions(directory), /package\.json/);
});

test('rejects a mismatched release tag', t => {
    const directory = fixture(t);
    assert.throws(() => checkVersions(directory, { tag: 'v1.2.4' }), /git tag v1\.2\.4/);
});

test('ignores branch refs that are not version tags', t => {
    const directory = fixture(t);
    assert.equal(checkVersions(directory, { tag: 'main' }), '1.2.3');
});
