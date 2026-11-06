type Situation = { id: string; title: string };
type Development = { id: string; title: string; body: string; situationId?: string };
let catalog: ((identity: string) => Situation[]) | undefined;
let news: ((identity: string) => Development[]) | undefined;
export function registerSituationCatalog(read: NonNullable<typeof catalog>) {
    catalog = read;
    return () => { if (catalog === read) { catalog = undefined; } };
}
export function registerLinkedDevelopments(read: NonNullable<typeof news>) {
    news = read;
    return () => { if (news === read) { news = undefined; } };
}
export const readSituationCatalog = (identity: string) => catalog?.(identity) || [];
export const readLinkedDevelopments = (identity?: string) => identity ? news?.(identity) || [] : [];

export type Involvement = {key:string; kind:string; title:string; near:boolean; reason:string; wakeFloor?:number};
let involvement: ((identity:string) => Involvement[]) | undefined;
export function registerInvolvement(read: NonNullable<typeof involvement>) {
    involvement = read;
    return () => { if (involvement === read) { involvement = undefined; } };
}
export const currentInvolvement = (identity:string) => involvement?.(identity) || [];
