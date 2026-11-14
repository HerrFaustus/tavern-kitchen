import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Media belongs to its feature, never to a second copy in the output tree. */
export function createSourceAssetPlugin({ root }) {
    const prefix = '\0source-asset:';
    const canonicalRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
    return {
        name: 'plugin-source-assets',
        apply: 'build',
        enforce: 'pre',
        resolveId(source, importer) {
            if (!importer || !source.startsWith('.')) return null;
            const [filename, query] = source.split('?', 2);
            const parameters = new URLSearchParams(query);
            if (!parameters.has('url') || !parameters.has('no-inline')) return null;
            const resolved = path.resolve(path.dirname(importer.split('?')[0]), filename);
            const canonicalResolved = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
            const relative = path.relative(canonicalRoot, canonicalResolved);
            if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null;
            return prefix + canonicalResolved;
        },
        load(id) {
            if (!id.startsWith(prefix)) return null;
            const filename = id.slice(prefix.length);
            this.addWatchFile(filename);
            const version = createHash('sha256').update(fs.readFileSync(filename)).digest('hex').slice(0, 16);
            const url = path.relative(canonicalRoot, filename).split(path.sep).map(encodeURIComponent).join('/');
            const loader = path.join(canonicalRoot, 'core/build-assets.js').replaceAll('\\', '/');
            return `import { pluginAsset } from ${JSON.stringify(loader)};export default pluginAsset(${JSON.stringify(`${url}?v=${version}`)});`;
        },
    };
}
