import { HOST_BINDING, HOST_PROVIDER } from '../text-api/model.js';

export function assertPlannerPresetReady(preset) {
    if (preset?.id === HOST_BINDING || preset?.provider === HOST_PROVIDER) return;
    if (!String(preset?.baseUrl || '').trim()) throw new Error('编剧需要填写所选配置的 API 地址。');
    if (!String(preset?.model || '').trim()) throw new Error('编剧需要填写所选配置的模型名称。');
}
