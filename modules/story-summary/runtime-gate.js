export function isXiaobaiMasterEnabled(scope = globalThis) {
    return scope?.window?.isTavernKitchenEnabled !== false;
}
