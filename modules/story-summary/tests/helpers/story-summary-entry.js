import { panelEnabled } from '../../../../core/panel-policy.js';
import { timelineRounds, summaryLayers } from '../../data/summary-layers.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { observeBackgroundTask } from '../../../../shared/common/async-errors.js';
import { getUpdateAndSimulationBounds } from '../../data/turn-bounds.js';
import { refreshFloorSummaries } from '../../floor-summary.js';
import { floorCoverageEnd } from '../../inline/ledger.js';
import { firstInvalidMemorySource, matchesRangeDigest } from '../../data/turn-source.js';
import { prepareMemorySources, validateMemorySources } from '../../../world-records/turn-runtime.js';
import { worldAuthorityForContext, authorityStoryStore } from '../../../world-records/authority-context.js';
import { getSummarySourceEnd } from '../../generate/source-boundary.js';
import { SUMMARY_BATCH_FLOORS } from '../../data/summary-workflow.js';
import { clearRecallHistory } from '../../recall-history.js';
import { isVectorApiConfigured } from '../../vector/llm/api-config-policy.js';

// Execute production entrypoints with explicit boundary dependencies. Never
// assert source spelling: these tests protect observable state and stored data.
const sourceUrl = new URL('../../story-summary.js', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const declarations = parse(source, { sourceType: 'module', ecmaVersion: 'latest' }).body
    .map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
    .filter(Boolean);
export function entry(names, dependencies) {
    // Existing entrypoint fixtures exercise the retained independent-summary path.
    // Main-reply behavior is tested through its controller and actual persistence separately.
    const context = vm.createContext({ panelEnabled, getSummarySourceEnd, getUpdateAndSimulationBounds, observeBackgroundTask, refreshFloorSummaries, floorCoverageEnd, SUMMARY_BATCH_FLOORS,
        timelineRounds, summaryLayers, firstInvalidMemorySource, matchesRangeDigest, prepareMemorySources, validateMemorySources, worldAuthorityForContext, authorityStoryStore,
        clearRecallHistory, isVectorApiConfigured, getSummaryPanelConfig: () => ({ inlineSummary: { enabled: false } }), ...dependencies });
    vm.runInContext(declarations.filter(node => node.type === 'FunctionDeclaration' ? names.includes(node.id.name)
        : node.type === 'VariableDeclaration' && node.declarations.some(item => names.includes(item.id.name)))
        .map(node => source.slice(node.start, node.end)).join('\n')
        .replaceAll('import.meta.url', JSON.stringify(sourceUrl.href)), context);
    return context;
}

// Run the DOM-ready and summary-toggle wiring without evaluating unrelated UI setup.
export function startupEntry(names, dependencies) {
    const context = entry(names, dependencies);
    const startup = declarations.filter(node => node.type === 'ExpressionStatement'
        && node.expression.type === 'CallExpression'
        && (node.expression.callee.name === 'jQuery'
            || (node.expression.callee.property?.name === 'on'
                && node.expression.arguments[0]?.name === 'STORY_SUMMARY_TOGGLE_EVENT')));
    vm.runInContext(startup.map(node => source.slice(node.start, node.end)).join('\n')
        .replaceAll('import.meta.url', JSON.stringify(sourceUrl.href)), context);
    return context;
}

const uiSource = readFileSync(new URL('../../story-summary-ui.js', import.meta.url), 'utf8');
const uiAst = parse(uiSource, { sourceType: 'module', ecmaVersion: 'latest' }).body;
const uiRootFn = uiAst.find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration'
    && node.declaration.id?.name === 'mountStorySummaryUI')?.declaration;
const uiDeclarations = uiRootFn.body.body;

export function uiEntry(names, dependencies) {
    const context = vm.createContext({ ...dependencies });
    vm.runInContext(uiDeclarations.filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
        .map(node => uiSource.slice(node.start, node.end)).join('\n'), context);
    return context;
}
