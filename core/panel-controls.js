import { AGENT_BINDINGS, readAgentBinding } from '../modules/text-api/model.js';

const moduleAgents = { overview:'update', people:'update', places:'update', map:'simulation', situation:'update', opening:'update',
    memory:'update', proofreading:'update', clues:'update', suspense:'update', planner:'planner' };

export function panelAgent(route) { return moduleAgents[route]; }

export async function requireAgent(agent, loadRepository = () => import('../modules/text-api/repository.js').then(module => module.getTextApiRepository())) {
    if (!agent) return;
    const config = await (await loadRepository()).load();
    if (readAgentBinding(config, agent).id) return;
    throw Object.assign(new Error('请先在设置中配置' + AGENT_BINDINGS[agent].name + 'agent'), { agent });
}
