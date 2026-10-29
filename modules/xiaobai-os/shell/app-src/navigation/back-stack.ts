/** UI-only, owned by one mounted APP. A handler consumes one Back action. */
export function createBackStack(changed: (size: number) => void = () => {}) {
    const entries: Array<() => boolean> = [];
    return {
        add(handler: () => boolean): () => void {
            entries.push(handler);
            changed(entries.length);
            return () => { const index = entries.indexOf(handler); if (index >= 0) { entries.splice(index, 1); changed(entries.length); } };
        },
        back(): boolean {
            for (const handler of [...entries].reverse()) { if (handler()) { return true; } }
            return false;
        },
    };
}
