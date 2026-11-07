import type { ManagementTool } from '../../../capabilities/management/index.js';
import { MANAGEMENT_PAGE_SIZE } from '../../../capabilities/management/read-page.js';
import { mapTools, MAP_ATLAS_READ_RESULT, MAP_MAINTENANCE_TOOL_NAMES as TOOLS } from '../tools/tool-contract.js';
import { withDocumentEdit, withDocumentRead } from '../../../capabilities/management/document-tools.js';

const LABELS: Record<string, string> = {
    [TOOLS.ATLAS_READ]: '查看图册',
    [TOOLS.SCENE_READ]: '查看场景',
    [TOOLS.ATLAS_EDIT]: '修改图册',
    [TOOLS.SCENE_EDIT]: '修改场景',
};

export function createMapManagementTools(): readonly ManagementTool[] {
    return mapTools([
        'This call saves valid edits. Returns {ok,status,data}; status is saved, partial, unchanged or failed.',
        'data contains the edit report {ok,status,changed,applied,skipped,warnings,hint?,data?}. Its status describes the edit; the outer status describes persistence.',
    ].join('\n')).map(tool => {
        const definition = structuredClone(tool) as ManagementTool['definition'];
        const name = definition.function.name;
        const properties = definition.function.parameters.properties as Record<string, Record<string, unknown>>;
        if (name === TOOLS.ATLAS_READ) {
            properties.mode.enum = ['summary', 'locations', 'links', 'actors'];
            properties.limit.maximum = MANAGEMENT_PAGE_SIZE;
            properties.limit.description = `Records per page. Default and maximum ${MANAGEMENT_PAGE_SIZE}.`;
            definition.function.description = [
                'Read the current world atlas.',
                'Returns {ok,status,data}; a successful read has status read.',
                MAP_ATLAS_READ_RESULT,
                'Use a collection to find existing keys before editing.',
            ].join('\n');
        }
        if (name === TOOLS.ATLAS_READ) { withDocumentRead(definition); }
        if (name === TOOLS.ATLAS_EDIT) { withDocumentEdit(definition); }
        return {
            definition,
            effect: name.endsWith('Read') ? 'read' : 'write',
            label: LABELS[name],
            target: args => String(args.scene ?? args.query ?? args.mode ?? ''),
        };
    });
}
