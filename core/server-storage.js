import { getRequestHeaders } from '../../../../../script.js';
import { debounce } from '../../../../utils.js';
import { StorageFile } from './storage-file.js';

const createStorage = (filename, opts = {}) => new StorageFile(filename, {
    ...opts,
    getRequestHeaders,
    debounce,
});

export const EnaPlannerStorage = createStorage('TavernKitchen_EnaPlanner.json', { debounceMs: 800 });
export const AgentApiStorage = createStorage('TavernKitchen_AgentApi.json', { debounceMs: 800 });
export const CommonSettingStorage = createStorage('TavernKitchen_CommonSettings.json', { debounceMs: 1000, readTimeoutMs: 5000 });
export const VectorStorage = createStorage('TavernKitchen_Vectors.json', { debounceMs: 3000 });
