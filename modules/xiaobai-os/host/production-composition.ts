import { getKitchenMount, openKitchenTab, openKitchenModal, closeKitchenWorkspace, bindKitchenSurface } from '../../../core/kitchen-workspace.js';
import { loadBuildEntry } from '../../../core/build-assets.js';
import { observeBackgroundTask } from '../../../shared/common/async-errors.js';
import { getRequestHeaders } from '../../../../../../../script.js';
import { createAgentApiModule } from '../apps/agent-api/module.js';
import {
    createMapContextCapabilityRegistration,
    MAP_CONTEXT_CAPABILITY,
} from '../apps/map/context-capability.js';
import { createProductionMapModule } from '../apps/map/production-module.js';
import { createProductionWorldModule } from '../apps/world/production-module.js';
import { createWorldContextCapabilityRegistration, WORLD_CONTEXT_CAPABILITY } from '../apps/world/context-capability.js';
import { copyWorldBranch } from '../apps/world/host/branch-copy.js';
import { createAgentCapabilityRegistration } from '../capabilities/agent/index.js';
import { createManagementCapabilityRegistration } from '../capabilities/management/index.js';
import {
    createMaintenanceCapabilityRegistration,
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
    subscribeMapPromptEvents,
    subscribeWorldPromptEvents,
    subscribeXiaobaiOsChatChanged,
} from './sillytavern-runtime-adapters.js';

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

    const modules = [
        createAgentApiModule(),
        createProductionMapModule({
            settings,
            getPlayerDisplayName: () => getSillyTavernChatSurface()?.playerName ?? '玩家',
            getChatIdentity: getSillyTavernChatIdentity,
            subscribePrompt: subscribeMapPromptEvents,
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
            initialPartitions: () => Promise.resolve({}),
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

    const openWideMapModal = (
        payload: Record<string, unknown>,
        onSelectPlace: (placeKey: string) => void,
    ): void => {
        const svgNs = 'http://www.w3.org/2000/svg';
        const wrap = document.createElement('div');
        wrap.className = 'tk-wide-map-wrap';
        const hint = document.createElement('p');
        hint.className = 'tk-wide-map-hint';
        hint.textContent = '点击任意地点节点可切换侧栏定位并关闭此窗。';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('class', 'tk-wide-map-svg');
        svg.setAttribute('viewBox', typeof payload.viewBox === 'string' && payload.viewBox ? payload.viewBox : '0 0 600 400');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', typeof payload.label === 'string' && payload.label ? payload.label : '区域地图大图');
        const defs = document.createElementNS(svgNs, 'defs');
        const marker = document.createElementNS(svgNs, 'marker');
        const markerId = 'tk-wide-map-arrow';
        marker.setAttribute('id', markerId);
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '5');
        marker.setAttribute('markerHeight', '5');
        marker.setAttribute('orient', 'auto');
        const arrowPath = document.createElementNS(svgNs, 'path');
        arrowPath.setAttribute('d', 'M0 0L10 5L0 10Z');
        arrowPath.setAttribute('fill', 'currentColor');
        marker.append(arrowPath);
        defs.append(marker);
        svg.append(defs);

        const routes = Array.isArray(payload.routes) ? payload.routes : [];
        for (const item of routes) {
            if (!item || typeof item !== 'object') { continue; }
            const r = item as Record<string, unknown>;
            const line = document.createElementNS(svgNs, 'line');
            line.setAttribute('x1', String(Number(r.x1) || 0));
            line.setAttribute('y1', String(Number(r.y1) || 0));
            line.setAttribute('x2', String(Number(r.x2) || 0));
            line.setAttribute('y2', String(Number(r.y2) || 0));
            line.setAttribute('stroke', 'currentColor');
            line.setAttribute('stroke-width', '2');
            if (!r.bidirectional) { line.setAttribute('marker-end', `url(#${markerId})`); }
            if (typeof r.title === 'string' && r.title) {
                const t = document.createElementNS(svgNs, 'title');
                t.textContent = r.title;
                line.append(t);
            }
            svg.append(line);
        }

        let modalHandle: { close?: () => void } | null = null;
        const selectedKey = typeof payload.selected === 'string' ? payload.selected : '';
        const currentKey = typeof payload.current === 'string' ? payload.current : '';
        const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
        for (const item of nodes) {
            if (!item || typeof item !== 'object') { continue; }
            const n = item as Record<string, unknown>;
            const key = typeof n.key === 'string' ? n.key : '';
            const name = typeof n.name === 'string' ? n.name : key;
            const x = Number(n.x) || 0;
            const y = Number(n.y) || 0;
            const g = document.createElementNS(svgNs, 'g');
            g.setAttribute('role', 'button');
            g.setAttribute('tabindex', '0');
            g.setAttribute('aria-label', `查看${name}`);
            g.setAttribute('transform', `translate(${x} ${y})`);
            if (key === selectedKey) {
                const ring = document.createElementNS(svgNs, 'circle');
                ring.setAttribute('r', '19');
                ring.setAttribute('class', 'ring');
                g.append(ring);
            }
            const dot = document.createElementNS(svgNs, 'circle');
            dot.setAttribute('r', '12');
            if (key === currentKey) { dot.setAttribute('class', 'here'); }
            g.append(dot);
            const text = document.createElementNS(svgNs, 'text');
            text.setAttribute('y', '39');
            text.setAttribute('text-anchor', 'middle');
            text.textContent = name;
            g.append(text);
            if (key === currentKey) {
                const hereLabel = document.createElementNS(svgNs, 'text');
                hereLabel.setAttribute('y', '63');
                hereLabel.setAttribute('text-anchor', 'middle');
                hereLabel.textContent = '当前位置';
                g.append(hereLabel);
            }
            const pick = () => {
                if (key) { onSelectPlace(key); }
                modalHandle?.close?.();
            };
            g.addEventListener('click', pick);
            g.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    pick();
                }
            });
            svg.append(g);
        }
        wrap.append(hint, svg);
        modalHandle = openKitchenModal({
            title: typeof payload.label === 'string' && payload.label ? `${payload.label} · 区域地图` : '区域地图',
            wide: true,
            content: wrap,
        }) || null;
    };

    return createXiaobaiOsBootstrap({
        composition: productionComposition,
        embeddedMount: () => getKitchenMount('map'),
        onEmbeddedClose: closeKitchenWorkspace,
        onNavigateKitchen: (route, detail) => {
            observeBackgroundTask(Promise.resolve(openKitchenTab(route, detail || null)), {
                source: import.meta.url,
                operation: 'navigate-kitchen',
            });
        },
        onOpenWideMap: openWideMapModal,
        onSurfaceCreated: bindKitchenSurface,
        mountApp: async (target, shadowRoot, clientBridge) => {
            const mod = await loadBuildEntry('apps/xiaobai-os', shadowRoot, { includeEmbedded: true }) as {
                mountXiaobaiOsApp: (el: HTMLElement, bridge: typeof clientBridge) => () => void;
            };
            return mod.mountXiaobaiOsApp(target, clientBridge);
        },
        subscribeChatChanged: subscribeXiaobaiOsChatChanged,
        getInitSnapshot: getSillyTavernShellSnapshot,
        captureChatBinding: references.capture,
        isChatBindingCurrent: references.isCurrent,
    });
}
