import type { SerializedDrawing } from './Drawing';

/** A named bundle of drawings that hide, lock, delete and move as one (the object tree's
 *  groups). Membership is exclusive: a drawing sits in one group at most. */
export interface DrawingGroup {
    id: string;
    name: string;
    /** The member drawings' ids. */
    ids: string[];
    /** The pane an EMPTY group sits in. Once drawings join, theirs is where it shows.
     *  Absent: the main chart. */
    pane?: string;
}

/** Versioned persistence envelope for a chart's user drawings. */
export interface DrawingsDocument {
    version: 1;
    drawings: SerializedDrawing[];
    /** The drawings' groups. Absent when there is none. */
    groups?: DrawingGroup[];
}

export const DRAWINGS_DOC_VERSION = 1 as const;

/** Deep-clone plain JSON (snapshots/clipboard must be independent of live state). */
export function clonePlain<T>(value: T): T {
    const sc = (globalThis as { structuredClone?: <U>(v: U) => U }).structuredClone;
    return sc ? sc(value) : (JSON.parse(JSON.stringify(value)) as T);
}

/** Whether a raw value is a structurally valid serialized drawing (defensive). */
export function isValidSerialized(v: unknown): v is SerializedDrawing {
    if (!v || typeof v !== 'object') return false;
    const d = v as Partial<SerializedDrawing>;
    return (
        typeof d.id === 'string' &&
        typeof d.type === 'string' &&
        typeof d.paneId === 'string' &&
        Array.isArray(d.anchors) &&
        d.anchors.every((p) => p && typeof p.time === 'number' && typeof p.price === 'number') &&
        !!d.style &&
        typeof d.style === 'object'
    );
}

/**
 * Coerce untrusted JSON into a valid {@link DrawingsDocument}. Unknown versions or
 * malformed entries are dropped rather than throwing — the same lenient contract
 * the renderer port uses for `applyConfig`.
 */
export function migrate(doc: unknown): DrawingsDocument {
    const d = doc as Partial<DrawingsDocument> | null;
    if (!d || typeof d !== 'object' || d.version !== DRAWINGS_DOC_VERSION || !Array.isArray(d.drawings)) {
        return { version: DRAWINGS_DOC_VERSION, drawings: [] };
    }
    const drawings = d.drawings.filter(isValidSerialized);
    const groups = sanitizeGroups(d.groups, new Set(drawings.map((x) => x.id)));
    return groups.length > 0 ? { version: DRAWINGS_DOC_VERSION, drawings, groups } : { version: DRAWINGS_DOC_VERSION, drawings };
}

/**
 * Coerce untrusted groups into valid ones over the drawings in `live`. Malformed entries
 * and repeated group ids are dropped; members that are not live drawings, or that an
 * earlier group already holds, are left out. A group that held drawings and has none left
 * goes too; one that was empty all along (just made, waiting for drawings) stays.
 */
export function sanitizeGroups(raw: unknown, live: ReadonlySet<string>): DrawingGroup[] {
    if (!Array.isArray(raw)) return [];
    const out: DrawingGroup[] = [];
    const seenGroups = new Set<string>();
    const taken = new Set<string>();
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const g = entry as Partial<DrawingGroup>;
        if (typeof g.id !== 'string' || g.id === '' || seenGroups.has(g.id)) continue;
        if (typeof g.name !== 'string' || !Array.isArray(g.ids)) continue;
        const ids: string[] = [];
        for (const id of g.ids) {
            if (typeof id !== 'string' || !live.has(id) || taken.has(id)) continue;
            taken.add(id);
            ids.push(id);
        }
        if (ids.length === 0 && g.ids.length > 0) continue;
        seenGroups.add(g.id);
        const group: DrawingGroup = { id: g.id, name: g.name, ids };
        if (typeof g.pane === 'string' && g.pane !== '') group.pane = g.pane;
        out.push(group);
    }
    return out;
}
