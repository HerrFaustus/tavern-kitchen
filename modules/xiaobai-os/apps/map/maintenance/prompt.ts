import type { MaintenanceMode } from '../../../capabilities/maintenance/registry.js';
import { MAP_GEOGRAPHY_PROMPT, MAP_PLACE_SETUP_PROMPT } from '../geography-prompt.js';

export function buildMapMaintenancePrompt(mode: MaintenanceMode): string {
    return [MAP_GEOGRAPHY_PROMPT, MAP_PLACE_SETUP_PROMPT, mode === 'rebuild' ? '根据现有资料整理初始地点词条。' : '保留既有词条，按本轮新增事实修订。'].join('\n');
}
