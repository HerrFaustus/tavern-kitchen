import path from 'node:path';
export const pluginRoot = path.resolve(import.meta.dirname, '../..');
export const virtualPluginRoot = '/public/scripts/extensions/third-party/tavern-kitchen';

// Host imports are deployment-relative, independent of the developer checkout's depth.
export function hostPathForImport(importer, specifier) {
    if (!specifier.startsWith('.')) return null;
    const relative = path.relative(pluginRoot, importer.split('?')[0]).replaceAll('\\', '/');
    const target = path.posix.resolve(virtualPluginRoot, path.posix.dirname(relative), specifier.split('?')[0]);
    if (target === virtualPluginRoot || target.startsWith(`${virtualPluginRoot}/`)) return null;
    if (!target.startsWith('/public/')) throw new Error(`Import escapes the host public tree: ${specifier}`);
    return target.slice(1);
}

export function servedHostImport(chunkFile, hostPath) {
    return path.posix.relative(path.posix.join(virtualPluginRoot, 'dist', path.posix.dirname(chunkFile)), `/${hostPath}`);
}
