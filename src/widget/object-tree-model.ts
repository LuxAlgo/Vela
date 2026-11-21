// The object tree AS DATA. This half takes a snapshot of the chart — its panes, the
// indicators in them, the editable stacking order, the drawings — and lays it out as the
// blocks and rows the panel paints. No DOM and no chart calls, so the layout rules (what
// sits in front of what, which pane a drawing belongs to, how a group folds) are all
// unit-testable on plain objects.
import type { PaneInfo } from '../core/options';
import type { SerializedDrawing } from '../core/drawings/Drawing';
import { getDrawingType } from '../core/drawings/registry';
import { msg } from '../core/i18n/message';
import { sourceText, textOf } from '../core/i18n/text';
import type { Translator } from '../core/i18n/types';

const TEXT = {
    mainChart: msg('widget.objectTree.mainChart', 'Main chart'),
    pane: msg('widget.objectTree.pane', 'Panel {n}'),
    drawingWithText: msg('widget.objectTree.drawingWithText', '{name} — {text}'),
    group: msg('widget.objectTree.group', 'Group {n}'),
};

/** A user-made bundle of drawings that hide, lock, delete and move as one. */
export interface DrawGroup {
    id: string;
    name: string;
    ids: string[];
    /** The pane an EMPTY group sits in. A group made before it holds anything has no member to
     *  take a pane from; once drawings join, theirs is where it shows. Absent: the main chart. */
    pane?: string;
}

/** The candles. */
export interface PriceRow {
    kind: 'price';
    label: string;
    visible: boolean;
}

export interface IndicatorRow {
    kind: 'indicator';
    id: string;
    label: string;
    visible: boolean;
    /** Draws against its own price scale rather than the pane's — surfaced as a tag. */
    ownScale: boolean;
}

/** One series row in a pane's stack. Study panes hold indicator rows only; the price pane
 *  also holds the candles, stacked among them. */
export type TreeRow = PriceRow | IndicatorRow;

/** A pane's drawings as top-level units, front-most first: a lone drawing, or a group
 *  block surfacing at its front-most member's slot with the members nested inside. */
export type DrawUnit =
    | { kind: 'draw'; drawing: SerializedDrawing }
    | { kind: 'group'; group: DrawGroup; members: SerializedDrawing[] };

/** One entry in a pane's rendered stack: a drawing unit, or a series row. */
export type TreeItem = { kind: 'unit'; unit: DrawUnit } | { kind: 'row'; row: TreeRow };

/** One pane's block: its stack read top to bottom as front to back. */
export interface TreePane {
    id: string;
    kind: 'price' | 'study';
    label: string;
    order: number;
    collapsed: boolean;
    maximized: boolean;
    /** The pane's stack, front-most first. With `interleave` the drawings and the series merge
     *  into ONE z-ordered column — a drawing can sit under the candles or between two
     *  indicators; otherwise the drawings lead (they always paint over) and the series follow. */
    items: TreeItem[];
}

/** Everything the layout needs, pulled from the chart by the panel before it renders. */
export interface TreeSnapshot {
    panes: readonly PaneInfo[];
    /** The shell's translator (pane names). Absent: English. */
    i18n?: Translator | null;
    /** Live visibility per indicator id — the pane model doesn't carry it. */
    indicatorVisible: (id: string) => boolean;
    /** A handle's title, used only as a FALLBACK: the pane model carries the resolved display
     *  title, while a handle can still report the generic placeholder for a script that names
     *  itself late. */
    handleTitle: (id: string) => string | undefined;
    /** Whether the renderer exposes editable stacking (`seriesOrder` + `candleZOrder`). */
    stackable: boolean;
    /** Whether drawings share the series' draw-order space on this renderer (`drawingDepth`):
     *  a drawing then takes a slot anywhere in its pane's column. Without it the panel keeps
     *  every drawing in front of the series, matching how such a renderer paints. */
    interleave: boolean;
    /** `renderer.get('seriesOrder')` — ignored when `stackable` is false. */
    zOrder: ReadonlyArray<{ id: string; z: number }>;
    /** `renderer.get('candleZOrder')` — ignored when `stackable` is false. */
    candleZ: number;
    priceLabel: string;
    priceVisible: boolean;
    drawings: readonly SerializedDrawing[];
    groups: readonly DrawGroup[];
}

export const PRICE_PANE_ID = 'price';
/** The price pane's name in English (the tree shows it in the shell's language). */
export const PRICE_PANE_LABEL = sourceText(TEXT.mainChart);

/** A drawing type's display name and icon markup, from the type registry. Unregistered
 *  types fall back to a title-cased key so a plugin drawing still reads as a name. */
export function drawingMeta(type: string, i18n?: Translator | null): { label: string; icon: string | null } {
    const meta = getDrawingType(type, i18n ?? undefined);
    if (meta) return { label: meta.label, icon: meta.icon };
    return { label: String(type || 'drawing').replace(/(^|\s)\S/g, (c) => c.toUpperCase()), icon: null };
}

/** A drawing's row label — its type's name, plus its own text when it carries any. */
export function drawingLabel(d: SerializedDrawing, i18n?: Translator | null): string {
    const { label } = drawingMeta(d.type, i18n);
    const text = d.text?.value?.trim();
    return text ? textOf(i18n, TEXT.drawingWithText, { name: label, text }) : label;
}

/** A pane's display name: the price pane is the main chart, a study pane borrows the title
 *  of the indicator that owns its scale (falling back to its slot number). */
export function paneLabel(pane: PaneInfo, fallbackTitle: (id: string) => string | undefined, i18n?: Translator | null): string {
    if (pane.kind === 'price') return textOf(i18n, TEXT.mainChart);
    const master = pane.indicators.find((i) => !i.ownScale) ?? pane.indicators[0];
    if (master) return indicatorLabel(master, fallbackTitle);
    return textOf(i18n, TEXT.pane, { n: String(pane.order + 1) });
}

/** An indicator's full display name. */
function indicatorLabel(i: PaneInfo['indicators'][number], fallbackTitle: (id: string) => string | undefined): string {
    return i.title || fallbackTitle(i.id) || i.id;
}

/** An indicator row's label: the compact name it declares — matching its legend chip — or
 *  else its full name. */
function indicatorRowLabel(i: PaneInfo['indicators'][number], fallbackTitle: (id: string) => string | undefined): string {
    return i.shorttitle || indicatorLabel(i, fallbackTitle);
}

/** The pane's series rows, extracted from its stack in rendered (front-first) order. */
export function paneRows(pane: TreePane): TreeRow[] {
    return pane.items.flatMap((it) => (it.kind === 'row' ? [it.row] : []));
}

// ── the stack as tokens ────────────────────────────────────────────────────
// A reorder works on the pane's stack FLATTENED to one token per z key: the candles, each
// indicator, each drawing (a group contributes one token per member, so the bundle stays
// contiguous). Front-most first, mirroring how the panel reads.

export type StackToken = { kind: 'price' } | { kind: 'indicator'; id: string } | { kind: 'drawing'; id: string };

export function sameToken(a: StackToken, b: StackToken): boolean {
    if (a.kind === 'price' || b.kind === 'price') return a.kind === b.kind;
    return a.kind === b.kind && a.id === b.id;
}

function unitTokens(u: DrawUnit): StackToken[] {
    if (u.kind === 'draw') return [{ kind: 'drawing', id: u.drawing.id }];
    return u.members.map((m) => ({ kind: 'drawing' as const, id: m.id }));
}

function itemTokens(item: TreeItem): StackToken[] {
    if (item.kind === 'unit') return unitTokens(item.unit);
    return [item.row.kind === 'price' ? { kind: 'price' } : { kind: 'indicator', id: item.row.id }];
}

/** The pane's whole stack as tokens, front-most first. */
export function paneTokens(pane: TreePane): StackToken[] {
    return pane.items.flatMap(itemTokens);
}

/** Where a slot between rendered items lands in the token list — a group is one item but
 *  as many tokens as it has members. */
export function tokenIndexOfSlot(pane: TreePane, slot: number): number {
    let at = 0;
    for (let i = 0; i < Math.min(slot, pane.items.length); i += 1) at += itemTokens(pane.items[i]!).length;
    return at;
}

/** Where a drop inside a group lands in the token list: at the member it points at, or —
 *  past the last member — right after the group's run. */
export function groupTokenIndex(pane: TreePane, groupId: string, memberSlot: number): number {
    let at = 0;
    for (const item of pane.items) {
        if (item.kind === 'unit' && item.unit.kind === 'group' && item.unit.group.id === groupId) {
            return at + Math.min(memberSlot, item.unit.members.length);
        }
        at += itemTokens(item).length;
    }
    return at;
}

/**
 * Place `dragged` (as one contiguous run) at token index `at`, measured against the stack AS
 * RENDERED — lifting the dragged tokens out first shifts everything below them up, so dropping
 * a row just beneath itself means "stay put", not "move down one". Tokens arriving from
 * another pane aren't in the list yet and are simply inserted.
 */
export function placeTokens(tokens: readonly StackToken[], dragged: readonly StackToken[], at: number): StackToken[] {
    const isDragged = (t: StackToken): boolean => dragged.some((d) => sameToken(d, t));
    let adjusted = at;
    tokens.forEach((t, i) => {
        if (i < at && isDragged(t)) adjusted -= 1;
    });
    const rest = tokens.filter((t) => !isDragged(t));
    rest.splice(Math.max(0, Math.min(adjusted, rest.length)), 0, ...dragged);
    return rest;
}

export function tokensEqual(a: readonly StackToken[], b: readonly StackToken[]): boolean {
    return a.length === b.length && a.every((t, i) => sameToken(t, b[i]!));
}

/**
 * z keys for a FRONT-FIRST token stack — the front-most token takes the highest key, so one
 * write renormalizes the whole pane into contiguous, tie-free values. `candleZ` is null when
 * the candles aren't in the stack (a study pane); `series` feeds `seriesOrder`, `drawings`
 * feeds `zIndex` patches.
 */
export function stackWrites(tokens: readonly StackToken[]): {
    candleZ: number | null;
    series: Array<{ id: string; z: number }>;
    drawings: Array<{ id: string; z: number }>;
} {
    const n = tokens.length;
    let candleZ: number | null = null;
    const series: Array<{ id: string; z: number }> = [];
    const drawings: Array<{ id: string; z: number }> = [];
    tokens.forEach((t, i) => {
        const z = n - i;
        if (t.kind === 'price') candleZ = z;
        else if (t.kind === 'indicator') series.push({ id: t.id, z });
        else drawings.push({ id: t.id, z });
    });
    return { candleZ, series, drawings };
}

/** The extremes of a pane's stacking — what "bring to front" and "send to back" have to
 *  beat. `extra` folds in the drawings' z keys when they share the space. Zero is always
 *  in range so an empty stack still has bounds. */
export function zStackBounds(zOrder: ReadonlyArray<{ id: string; z: number }>, candleZ: number, extra: readonly number[] = []): { top: number; bottom: number } {
    const zs = [...zOrder.map((e) => e.z), ...extra];
    return { top: Math.max(candleZ, 0, ...zs), bottom: Math.min(candleZ, 0, ...zs) };
}

/**
 * A pane's drawings, FRONT-MOST FIRST. Orphans — drawings left behind by a pane that no
 * longer exists — fold into the price pane so they stay reachable rather than vanishing.
 */
export function paneDrawings(drawings: readonly SerializedDrawing[], paneId: string, paneIds: ReadonlySet<string>): SerializedDrawing[] {
    const mine = drawings.filter((d) => (paneId === PRICE_PANE_ID ? d.paneId === PRICE_PANE_ID || !paneIds.has(d.paneId) : d.paneId === paneId));
    return mine.slice().reverse(); // the store lists paint order (back→front); the tree leads with the front
}

/** The group a drawing belongs to, or null. */
export function groupOf(groups: readonly DrawGroup[], drawingId: string): DrawGroup | null {
    return groups.find((g) => g.ids.includes(drawingId)) ?? null;
}

/**
 * A group's aggregate state, which is what its own eye and padlock report. Both read as "on"
 * only when EVERY member agrees: one hidden member must not make the whole bundle look hidden,
 * or the group's eye would offer to show what is already showing.
 */
export function groupState(members: readonly SerializedDrawing[]): { allHidden: boolean; allLocked: boolean } {
    return {
        allHidden: members.length > 0 && members.every((d) => d.visible === false),
        allLocked: members.length > 0 && members.every((d) => d.locked === true),
    };
}

/** Whether a selection can form a fresh group: something is selected, and none of it is
 *  already grouped — a drawing belongs to at most one group. */
export function canGroup(ids: readonly string[], groups: readonly DrawGroup[]): boolean {
    return ids.length > 0 && ids.every((id) => groupOf(groups, id) === null);
}

/** The next default group name: the lowest `Group N` no existing group has taken. The name is
 *  the user's from then on (it persists, and can be renamed), so it is written once, in the
 *  shell's language at the time. */
export function nextGroupName(groups: readonly DrawGroup[], i18n?: Translator | null): string {
    const taken = new Set(groups.map((g) => g.name));
    const nameOf = (n: number): string => textOf(i18n, TEXT.group, { n: String(n) });
    // One of the first n+1 candidates is always free, since n groups can occupy at most n.
    for (let n = 1; n <= groups.length; n += 1) {
        const name = nameOf(n);
        if (!taken.has(name)) return name;
    }
    return nameOf(groups.length + 1);
}

/** Whether a group survives a membership change. One the change emptied disappears rather
 *  than lingering as an empty row; one that was empty all along is a fresh group still waiting
 *  for its first drawing, and stays. */
function survives(before: DrawGroup, after: DrawGroup): boolean {
    return after.ids.length > 0 || before.ids.length === 0;
}

/** Rebuild a group list with only the members that pass `keep`. */
function withMembers(groups: readonly DrawGroup[], keep: (id: string) => boolean): DrawGroup[] {
    return groups.flatMap((g) => {
        const next = { ...g, ids: g.ids.filter(keep) };
        return survives(g, next) ? [next] : [];
    });
}

/** Drop members that no longer exist, and the groups left empty by that. */
export function pruneGroups(groups: readonly DrawGroup[], live: ReadonlySet<string>): DrawGroup[] {
    return withMembers(groups, (id) => live.has(id));
}

/** Take drawings out of whatever group they were in. */
export function removeFromGroups(groups: readonly DrawGroup[], ids: readonly string[]): DrawGroup[] {
    const drop = new Set(ids);
    return withMembers(groups, (id) => !drop.has(id));
}

/** Put drawings into one group, taking them out of any other on the way — membership is
 *  exclusive, so a drawing can never show up under two groups at once. */
export function assignToGroup(groups: readonly DrawGroup[], groupId: string, ids: readonly string[]): DrawGroup[] {
    const moving = new Set(ids);
    return groups.flatMap((g) => {
        const kept = g.ids.filter((id) => !moving.has(id));
        const next = { ...g, ids: g.id === groupId ? [...kept, ...ids] : kept };
        return survives(g, next) ? [next] : [];
    });
}

/** The groups still waiting for their first drawing that sit in this pane. Like an orphaned
 *  drawing, one whose pane is gone folds into the main chart. */
export function emptyGroupsIn(groups: readonly DrawGroup[], paneId: string, paneIds: ReadonlySet<string>): DrawGroup[] {
    return groups.filter((g) => {
        if (g.ids.length > 0) return false;
        const at = g.pane ?? PRICE_PANE_ID;
        return paneId === PRICE_PANE_ID ? at === PRICE_PANE_ID || !paneIds.has(at) : at === paneId;
    });
}

/**
 * Fold a pane's front-first drawings into top-level units. A grouped drawing surfaces as
 * part of its group's block at the front-most member's slot, so a group never scatters.
 */
export function drawingUnits(paneDraws: readonly SerializedDrawing[], groups: readonly DrawGroup[]): DrawUnit[] {
    const units: DrawUnit[] = [];
    const seen = new Set<string>();
    for (const d of paneDraws) {
        if (seen.has(d.id)) continue;
        const g = groupOf(groups, d.id);
        if (g) {
            const members = paneDraws.filter((x) => g.ids.includes(x.id));
            for (const m of members) seen.add(m.id);
            units.push({ kind: 'group', group: g, members });
        } else {
            seen.add(d.id);
            units.push({ kind: 'draw', drawing: d });
        }
    }
    return units;
}

/** A unit's z key: its front-most member's. That is the slot a group surfaces at, so a
 *  bundle whose members straddle a series still reads as one block. An empty group has no
 *  member to go by and leads the pane, where a new group is easiest to find. */
function unitZ(u: DrawUnit): number {
    if (u.kind === 'draw') return u.drawing.zIndex;
    return u.members[0]?.zIndex ?? Infinity;
}

/**
 * One pane's stack. With interleaving, drawings and series merge into a single column sorted
 * by z (a drawing tying a series paints under it, so the series row comes first); without it,
 * the drawings lead — they always paint over the series — and the series follow.
 */
function paneItems(snap: TreeSnapshot, pane: PaneInfo, units: DrawUnit[]): TreeItem[] {
    const priceRow = (): PriceRow => ({ kind: 'price', label: snap.priceLabel, visible: snap.priceVisible });
    const indicatorRow = (i: PaneInfo['indicators'][number]): IndicatorRow => ({
        kind: 'indicator',
        id: i.id,
        label: indicatorRowLabel(i, snap.handleTitle),
        visible: snap.indicatorVisible(i.id),
        ownScale: i.ownScale,
    });
    const unitItems: TreeItem[] = units.map((unit) => ({ kind: 'unit', unit }));
    if (!snap.stackable) {
        const rows: TreeItem[] = pane.indicators.map((i) => ({ kind: 'row', row: indicatorRow(i) }));
        if (pane.kind === 'price') rows.unshift({ kind: 'row', row: priceRow() });
        return [...unitItems, ...rows];
    }
    const zOf = new Map(snap.zOrder.map((e) => [e.id, e.z]));
    // `zOrder` lists the indicators back to front as they paint, so on a shared key its
    // order (not the pane's listing order) says which one is in front.
    const rank = new Map(snap.zOrder.map((e, i) => [e.id, i]));
    const rows: Array<{ item: TreeItem; z: number; rank: number }> = pane.indicators.map((i) => ({
        item: { kind: 'row', row: indicatorRow(i) },
        z: zOf.get(i.id) ?? 0,
        rank: rank.get(i.id) ?? -1,
    }));
    // The candles paint before an indicator sharing their key.
    if (pane.kind === 'price') rows.push({ item: { kind: 'row', row: priceRow() }, z: snap.candleZ, rank: -Infinity });
    rows.sort((a, b) => b.z - a.z || b.rank - a.rank);
    if (!snap.interleave) return [...unitItems, ...rows.map((r) => r.item)];
    const entries = [...rows, ...units.map((unit) => ({ item: { kind: 'unit', unit } as TreeItem, z: unitZ(unit) }))];
    // Front-first; on a tie the series row leads — a drawing at a series' own z paints under it.
    entries.sort((a, b) => (a.z === b.z ? Number(a.item.kind === 'unit') - Number(b.item.kind === 'unit') : b.z - a.z));
    return entries.map((e) => e.item);
}

/** The whole tree, top pane first. */
export function buildTree(snap: TreeSnapshot): TreePane[] {
    const paneIds = new Set(snap.panes.map((p) => p.id));
    return snap.panes.map((pane) => ({
        id: pane.id,
        kind: pane.kind,
        label: paneLabel(pane, snap.handleTitle, snap.i18n),
        order: pane.order,
        collapsed: pane.collapsed,
        maximized: pane.maximized,
        items: paneItems(snap, pane, [
            ...emptyGroupsIn(snap.groups, pane.id, paneIds).map((group): DrawUnit => ({ kind: 'group', group, members: [] })),
            ...drawingUnits(paneDrawings(snap.drawings, pane.id, paneIds), snap.groups),
        ]),
    }));
}

/** True when the tree has nothing to show — no indicators beyond the candles, no drawings. */
export function treeIsEmpty(panes: readonly TreePane[]): boolean {
    return panes.every((p) => p.items.every((it) => it.kind === 'row' && it.row.kind === 'price'));
}
