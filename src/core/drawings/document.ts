import type { SerializedDrawing } from './Drawing';

/** Versioned persistence envelope for a chart's user drawings. */
export interface DrawingsDocument {
    version: 1;
    drawings: SerializedDrawing[];
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
    return { version: DRAWINGS_DOC_VERSION, drawings: d.drawings.filter(isValidSerialized) };
}
