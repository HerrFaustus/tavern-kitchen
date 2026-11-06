import { TEXT_API_COPY } from '../text-api/copy.js';
import { HOST_PROVIDER } from '../text-api/model.js';

export function assertPlannerPresetReady(preset) {
    if (preset?.provider === HOST_PROVIDER) throw new Error('剧情规划需要选择独立 API 配置。');
    if (!String(preset?.apiKey || '').trim()) throw new Error(TEXT_API_COPY.plannerKey);
}
