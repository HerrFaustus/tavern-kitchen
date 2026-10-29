import { observeBackgroundTask } from '../../../shared/common/async-errors.js';
import { getRequestHeaders } from '../../../../../../../script.js';
import { extensionFolderPath } from '../../../core/constants.js';
import { createAgentApiModule } from '../apps/agent-api/module.js';
import { createProductionDiceModule } from '../apps/dice/production-module.js';
import { upgradeDiceUserFile } from '../apps/dice/upgrade/partition-v1.js';
import {
    createMapContextCapabilityRegistration,
    MAP_CONTEXT_CAPABILITY,
} from '../apps/map/context-capability.js';
import { createProductionMapModule } from '../apps/map/production-module.js';
import { createMapProjectionRuntime } from '../apps/map/host/projection-runtime.js';
import { createProductionWorldModule } from '../apps/world/production-module.js';
import { createWorldContextCapabilityRegistration, WORLD_CONTEXT_CAPABILITY } from '../apps/world/context-capability.js';
import { copyWorldBranch } from '../apps/world/host/branch-copy.js';
import { createAgentCapabilityRegistration } from '../capabilities/agent/index.js';
import { createManagementCapabilityRegistration } from '../capabilities/management/index.js';
import {
    createMaintenanceCapabilityRegistration,
    MAINTENANCE_CAPABILITY,
} from '../capabilities/maintenance/index.js';
import { createChatBindingManager } from '../storage/chat-binding.js';
import { createChatBindingLifecycle } from '../storage/chat-binding-lifecycle.js';
import { createChatReferencePort } from '../storage/chat-reference.js';
import {
    createSillyTavernFileStorage,
    createSillyTavernUserJsonFilePort,
} from '../storage/sillytavern-file-storage.js';
import { createSillyTavernChatMetadataAdapter } from '../storage/sillytavern-chat-metadata.js';
import { createSidecarIndex } from '../storage/sidecar-index.js';
import { initialUserPartitions } from './user-initial-partitions.js';
import { createUserStoryResolver } from './user-story.js';
import { createXiaobaiOsBootstrap, type XiaobaiOsBootstrap } from './bootstrap.js';
import { createKernelComposition } from './kernel-composition.js';
import { createPromptContextAdapter } from './prompt-context/adapter.js';
import { createMaintenanceBackgroundCapture } from './prompt-context/maintenance-background.js';
import { createPromptInjectionCapabilityRegistration } from '../capabilities/prompt-injection/index.js';
import { PROMPT_INJECTION_POLICY } from './prompt-injection-policy.js';
import { createSillyTavernPromptInjectionHost } from './sillytavern-prompt-injection.js';
import type { XiaobaiOsSettingsRepository } from './settings-repository.js';
import {
    getSillyTavernChatIdentity,
    getSillyTavernChatSurface,
    getSillyTavernShellSnapshot,
} from './sillytavern-context.js';
import {
    createChatBindingEventAdapter,
    createSillyTavernMainGenerationRuntime,
    subscribeMaintenanceMessages,
    subscribeMapPromptEvents,
    subscribeWorldPromptEvents,
    subscribeXiaobaiOsChatChanged,
} from './sillytavern-runtime-adapters.js';

const hostStylesheet = `${extensionFolderPath}/modules/xiaobai-os/host.css`;
const frameSource = `${extensionFolderPath}/modules/xiaobai-os/shell/xiaobai-os.html`;

export function createProductionBootstrap(
    settings: XiaobaiOsSettingsRepository,
): XiaobaiOsBootstrap {
    const storage = createSillyTavernFileStorage({ getRequestHeaders });
    const userFiles = createSillyTavernUserJsonFilePort({ getRequestHeaders });
    const metadata = createSillyTavernChatMetadataAdapter();
    const index = createSidecarIndex(createSillyTavernUserJsonFilePort({ getRequestHeaders }));
    const references = createChatReferencePort(metadata, {
        recordOrphan: index.remember,
        recordReference: index.remember,
    });
    const bindingManager = createChatBindingManager({ metadata, references, storage, index,
        async prepareClonedPartitions(capture, source, partitions) {
            copyWorldBranch(capture, source, partitions);
        },
    });
    const bindingEvents = createChatBindingEventAdapter();
    const mainGeneration = createSillyTavernMainGenerationRuntime();
    const promptContext = createPromptContextAdapter();
    let composition: ReturnType<typeof createKernelComposition>;

    const capabilities = [
        createPromptInjectionCapabilityRegistration(PROMPT_INJECTION_POLICY, createSillyTavernPromptInjectionHost),
        createAgentCapabilityRegistration(),
        createManagementCapabilityRegistration(),
        createMapContextCapabilityRegistration(),
        createWorldContextCapabilityRegistration(),
        createMaintenanceCapabilityRegistration({
            captureSurface: getSillyTavernChatSurface,
            isGenerationActive: mainGeneration.isActive,
            writeGate: {
                getState: () => composition.transactions.getFileState(),
                subscribe: listener => composition.transactions.subscribeFileState(change => listener(change.state)),
            },
            captureBackground: createMaintenanceBackgroundCapture({
                promptContext,
                readMapContext: () => composition.capabilities.require(MAP_CONTEXT_CAPABILITY).readPromptContext(),
                readWorldContext: identity => composition.capabilities.require(WORLD_CONTEXT_CAPABILITY).readCurrent(identity),
            }),
            onError: error => console.error('[TavernKitchen] 后厨工作台 后台维护失败', error),
        }),
    ];

    const dice = createProductionDiceModule(settings, async identityKey => {
        const summary = await import('../../story-summary/story-summary.js') as { isStorySummaryEnabledForCurrentChat(): boolean };
        return { world: composition.capabilities.require(WORLD_CONTEXT_CAPABILITY).isStoryBackgroundEnabled(identityKey),
            summary: summary.isStorySummaryEnabledForCurrentChat() };
    }, () => false, () => upgradeDiceUserFile(composition.userTransactions!));
    const modules = [
        dice,
        createAgentApiModule(),
        createProductionMapModule({
            settings,
            mainGeneration,
            replyPause: dice.replyPause,
            getPlayerDisplayName: () => getSillyTavernChatSurface()?.playerName ?? '玩家',
            getChatIdentity: getSillyTavernChatIdentity,
            subscribePrompt: subscribeMapPromptEvents,
            createProjectionRuntime: createMapProjectionRuntime,
        }),
        createProductionWorldModule({
            settings,
            getChatIdentity: () => getSillyTavernChatIdentity()?.key ?? '',
            subscribePrompt: subscribeWorldPromptEvents,
        }),
    ];

    composition = createKernelComposition({
        storage,
        chatReferences: references,
        capabilities,
        modules,
        beforeRead: () => bindingLifecycle.ready(),
        user: {
            storage: userFiles,
            initialPartitions: () => initialUserPartitions(settings.readLegacyDiceSheet()),
            resolveStory: createUserStoryResolver({
                ready: () => bindingLifecycle.ready(), references, manager: bindingManager,
                install: envelope => composition.transactions.installResolvedEnvelope(envelope),
            }),
        },
    });
    const bindingLifecycle = createChatBindingLifecycle({
        manager: bindingManager,
        installResolvedSidecar: composition.transactions.installResolvedEnvelope,
        invalidateSidecar: composition.transactions.invalidateCurrent,
        events: bindingEvents.source,
        eventNames: bindingEvents.names,
    });
    let productionInstalled = false;

    const productionApps = Object.freeze({
        ...composition.apps,
        async handleWindowOpened() {
            await bindingLifecycle.ready();
            await composition.apps.handleWindowOpened();
        },
    });
    const productionComposition = {
        apps: productionApps,
        async install() {
            if (productionInstalled) { return; }
            observeBackgroundTask(mainGeneration.startBackground?.(), { source: import.meta.url, operation: 'install' });
            try {
                bindingLifecycle.start();
                await bindingLifecycle.ready();
                await composition.install();
                // Only remove the old sheet after the user document has acknowledged its copy.
                // App installation is isolated: an unavailable user file must not disable chat-only APPs.
                if (composition.userTransactions?.getFileState() === 'ready') {
                    await composition.userTransactions.prepare();
                    await settings.finishDiceSheetMigration();
                }
                const maintenance = composition.capabilities.require(MAINTENANCE_CAPABILITY);
                maintenance.runner.startBackground(subscribeMaintenanceMessages);
                productionInstalled = true;
            } catch (error) {
                await bindingLifecycle.stop();
                observeBackgroundTask(mainGeneration.stopBackground?.(), { source: import.meta.url, operation: 'install:cleanup' });
                await composition.dispose().catch(cleanupError => {
                    console.error('[TavernKitchen] 后厨工作台 安装失败后的资源释放失败', cleanupError);
                });
                throw error;
            }
        },
        async dispose() {
            if (!productionInstalled) { return; }
            productionInstalled = false;
            await bindingLifecycle.stop();
            bindingEvents.dispose();
            observeBackgroundTask(mainGeneration.stopBackground?.(), { source: import.meta.url, operation: 'dispose' });
            await composition.dispose();
        },
    };

    return createXiaobaiOsBootstrap({
        composition: productionComposition,
        stylesheetHref: hostStylesheet,
        frameSrc: frameSource,
        subscribeChatChanged: subscribeXiaobaiOsChatChanged,
        getInitSnapshot: getSillyTavernShellSnapshot,
        getAppOrder: () => settings.read()?.appOrder ?? [],
        saveAppOrder: async order => { await settings.setAppOrder(order); },
        subscribeAppOrderChanged: handler => {
            let previous = JSON.stringify(settings.read()?.appOrder ?? []);
            return settings.subscribe(value => {
                const next = JSON.stringify(value.appOrder);
                if (next === previous) { return; }
                previous = next;
                handler();
            });
        },
        captureChatBinding: references.capture,
        isChatBindingCurrent: references.isCurrent,
        onChatRequired: () => (window.toastr as unknown as { info?(message: string): void } | undefined)?.info?.('请先进入聊天，再打开后厨工作台。'),
    });
}
