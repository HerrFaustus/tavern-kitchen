"""Package the already-built plugin, including modified source and upstream notices."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))['version']
DIST = json.loads((ROOT / 'dist/manifest.json').read_text(encoding='utf-8'))
DIRECTORIES = ['bridges', 'core', 'docs', 'dist', 'libs', 'modules', 'scripts', 'shared', 'widgets']
FILES = ['README.md', 'manifest.json', 'package.json', 'pnpm-lock.yaml', 'plugin-entry.js', 'index.js',
         'settings.html', 'style.css', 'tsconfig.json', 'vite.plugin.config.mjs', '.gitignore', '.eslintignore', '.eslintrc.cjs']
files = [ROOT / name for name in FILES]
for name in DIRECTORIES:
    files.extend(p for p in (ROOT / name).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
for file in files:
    if file.is_symlink() or not file.resolve().is_relative_to(ROOT) or not file.is_file():
        raise ValueError(f'Invalid package source: {file}')
for entry in DIST['entries'].values():
    if not (ROOT / 'dist' / entry['file']).is_file():
        raise ValueError('Missing build entry')
for required in ['docs/LICENSE.md', 'docs/COPYRIGHT', 'docs/NOTICE', 'docs/UPSTREAM.md', 'docs/VALIDATION.md']:
    assert ROOT / required in files, required

release = ROOT / 'release'
release.mkdir(exist_ok=True)
archive = release / f'tavern-kitchen-{VERSION}.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
    for file in sorted(files):
        output.write(file, 'tavern-kitchen/' + file.relative_to(ROOT).as_posix())
with zipfile.ZipFile(archive) as check:
    assert check.testzip() is None
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(release / (archive.name + '.sha256')).write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
info = {'version': VERSION, 'build_id': DIST['buildId'], 'archive': archive.name,
        'sha256': digest, 'files': len(files), 'bytes': archive.stat().st_size,
        'source_included': True, 'dependencies_or_private_data_included': False}
(release / 'release-info.json').write_text(json.dumps(info, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(info, ensure_ascii=False))
