import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pluginRoot } from './paths.mjs';

export function localHostReference() {
    const references = path.resolve(pluginRoot, '../references');
    const receiptPath = path.join(references, 'receipts/SillyTavern__SillyTavern.json');
    if (!fs.existsSync(receiptPath)) return null;
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const sourceRoot = path.resolve(references, receipt.summary.local_path);
    for (const entry of receipt.files) {
        const target = path.resolve(sourceRoot, entry.path);
        if (!target.startsWith(sourceRoot + path.sep)) throw new Error('Invalid host receipt path');
        const hash = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
        if (hash !== entry.sha256) throw new Error(`Host reference changed: ${entry.path}`);
    }
    const metadata = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
    return { version: metadata.version, commit: receipt.commit, entries: receipt.files, sourceRoot };
}
