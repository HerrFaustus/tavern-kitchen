import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const semver = /^\d+\.\d+\.\d+$/;

function read(directory, relative) {
    return fs.readFileSync(path.join(directory, relative), 'utf8');
}

function readJson(directory, relative) {
    return JSON.parse(read(directory, relative));
}

function expect(label, actual, expected) {
    if (actual !== expected) throw new Error(`Version consistency: ${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function capture(label, source, pattern) {
    const match = source.match(pattern);
    if (!match) throw new Error(`Version consistency: cannot find version in ${label}`);
    return match[1];
}

function sha256(file) {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function checkVersions(directory = root, { tag = process.env.GITHUB_REF_NAME } = {}) {
    const manifest = readJson(directory, 'manifest.json');
    const version = manifest.version;
    if (!semver.test(version)) throw new Error(`Version consistency: manifest version is not semver: ${version}`);

    expect('package.json', readJson(directory, 'package.json').version, version);
    expect('README.md', capture('README.md', read(directory, 'README.md'), /^# 酒馆后厨 (\d+\.\d+\.\d+)\s*$/m), version);
    expect('docs/UPSTREAM.md', capture('docs/UPSTREAM.md', read(directory, 'docs/UPSTREAM.md'), /派生版：酒馆后厨 (\d+\.\d+\.\d+)/), version);
    expect('docs/validation.json', readJson(directory, 'docs/validation.json').version, version);
    if (!new RegExp(`^## ${version.replaceAll('.', '\\.')}(?:\\s|$)`, 'm').test(read(directory, 'docs/VALIDATION.md'))) {
        throw new Error(`Version consistency: docs/VALIDATION.md has no ${version} section`);
    }

    const releaseInfo = path.join(directory, 'release/release-info.json');
    if (fs.existsSync(releaseInfo)) {
        const info = readJson(directory, 'release/release-info.json');
        expect('release/release-info.json', info.version, version);
        expect('release/release-info.json archive', info.archive, `tavern-kitchen-${version}.zip`);
        const archive = path.resolve(directory, 'release', info.archive);
        if (!archive.startsWith(path.join(directory, 'release') + path.sep)) throw new Error('Version consistency: release archive escapes release/');
        if (!fs.existsSync(archive)) throw new Error(`Version consistency: missing release archive ${info.archive}`);
        expect(`release/${info.archive} sha256`, sha256(archive), info.sha256);
    }

    if (tag?.startsWith('v')) expect(`git tag ${tag}`, tag.slice(1), version);
    return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(`Version consistency passed: ${checkVersions()}`);
}
