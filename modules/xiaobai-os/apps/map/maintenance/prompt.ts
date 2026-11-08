import { definePanelPrompt } from '../../../../../core/panel-policy.js';
import type { MaintenanceMode } from '../../../capabilities/maintenance/registry.js';
import { MAP_GEOGRAPHY_PROMPT, MAP_PLACE_SETUP_PROMPT } from '../geography-prompt.js';

const mapUpdate = definePanelPrompt('map','mapUpdate','地图更新',[MAP_GEOGRAPHY_PROMPT, MAP_PLACE_SETUP_PROMPT,'保留既有词条，按本轮新增事实修订。'].join('\n'));
const mapRebuild = definePanelPrompt('map','mapRebuild','地图重建',[MAP_GEOGRAPHY_PROMPT, MAP_PLACE_SETUP_PROMPT,'根据现有资料整理初始地点词条。'].join('\n'));
export function buildMapMaintenancePrompt(mode: MaintenanceMode): string {
    return mode === 'rebuild' ? mapRebuild() : mapUpdate();
}
