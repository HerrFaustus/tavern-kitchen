import { createWorldModule } from './module.js';
import { registerEvolutionReader } from './evolution-view.js';
import { createWorldManagement } from './management/participant.js';
import { createWorldService } from './application/service.js';
import type { PartitionStore } from '../../kernel/contracts.js';
import type { WorldDomain } from '../../domains/world/types.js';
import type { XiaobaiOsAppModule } from '../../kernel/app-registry.js';
import { MANAGEMENT_CAPABILITY } from '../../capabilities/management/index.js';
import { createWorldController } from './host/controller.js';
import type { WorldPromptEventHandlers } from './host/prompt-runtime.js';
import type { XiaobaiOsSettingsRepository } from '../../host/settings-repository.js';

export function createProductionWorldModule(dependencies: {
    settings: XiaobaiOsSettingsRepository;
    getChatIdentity(): string;
    subscribePrompt?: (handlers: WorldPromptEventHandlers) => () => void;
}): XiaobaiOsAppModule {
    const module = createWorldModule({
        settings: dependencies.settings,
        getChatIdentity: dependencies.getChatIdentity,
        // WHY: 3A retires duplicate world MaintenanceRunner loop and WORLD_PROMPTS injection;
        // simulation Agent + world-records drive all world evolution and authority injection.
        install({ world, maintenance }) {
            return createWorldController({
                world,
                settings: dependencies.settings,
                maintenance: maintenance.runner,
                getChatIdentity: dependencies.getChatIdentity,
            });
        },
    });
    return { ...module, register(context) {
        const registry = context.useCapability(MANAGEMENT_CAPABILITY);
        const world = createWorldService(context.partition as PartitionStore<WorldDomain>, context.files, dependencies.getChatIdentity);
        try {
            const unregister = registry.register(createWorldManagement(world));
            const disconnect = registerEvolutionReader(world);
            return () => { disconnect(); unregister(); world.dispose(); };
        } catch (error) { world.dispose(); throw error; }
    } };
}
