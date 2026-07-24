import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS } from '../schema';
import { distToSegment, handleAt } from '../hittest';

/** One configurable Fibonacci entry — a ratio (or sequence index) with color / enabled / label. */
export interface FibLevel {
    ratio: number;
    color: string;
    enabled: boolean;
    label?: string;
}

/** Font size for the entry numbers / labels (cycled by the bar buttons). */
export type FibTextSize = 'small' | 'normal' | 'large' | 'huge';
const isFibSize = (v: unknown): v is FibTextSize => v === 'small' || v === 'normal' || v === 'large' || v === 'huge';

/** Coerce an untrusted value into a valid level (defensive, for persistence/round-trip). */
function sanitizeLevel(v: unknown): FibLevel | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Partial<FibLevel>;
    if (typeof o.ratio !== 'number' || typeof o.color !== 'string') return null;
    return {
        ratio: o.ratio,
        color: o.color,
        enabled: o.enabled !== false,
        ...(typeof o.label === 'string' && o.label ? { label: o.label } : {}),
    };
}

/** A resolved entry's pixel line + auto-number + custom-label placement (the painter's input). */
export interface FibEntryLine {
    color: string;
    label?: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    numberText: string;
    numberX: number;
    numberY: number;
    numberAlign: 'left' | 'center' | 'right';
    labelX: number;
    labelY: number;
}

/**
 * Shared base for every Fibonacci tool (retracement, extension, fan, time zones,
 * trend extension). Holds the editable per-entry config — `levels` (ratio / color /
 * enabled / label) plus number/label font sizes — which drives the settings gear
 * panel, persisted through `props`. Hit-test, handles, schema, and serialization all
 * derive from the abstract {@link entryLines}; subclasses only supply their default
 * ratio set, anchor count, geometry (`entryLines`), and price range.
 */
export abstract class FibRatios extends Drawing {
    /** Editable per-entry config (seeded from {@link defaultLevels}, persisted via props). */
    levels!: FibLevel[];
    /** Font size of the auto numbers (bar button cycles it). */
    numbersSize!: FibTextSize;
    /** Font size of the custom labels (bar button cycles it). */
    labelsSize!: FibTextSize;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.levels) this.levels = this.defaultLevels().map((l) => ({ ...l }));
        if (!this.numbersSize) this.numbersSize = 'small';
        if (!this.labelsSize) this.labelsSize = 'normal';
    }

    /** The tool's default entry set (ratios + colors), all enabled. */
    abstract defaultLevels(): readonly FibLevel[];
    /** ENABLED entries resolved to pixel lines + label placement — the painter's input. */
    abstract entryLines(proj: Projector): FibEntryLine[] | null;
    /** Optional fill bands between entries (retracement/extension override); default none. */
    fillBands(_proj: Projector): Array<{ color: string; x: number; y: number; w: number; h: number }> {
        return [];
    }

    override editableLevels(): FibLevel[] | null {
        return this.levels;
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'p1', free: 'both' }, { role: 'p2', free: 'both' }] };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const lines = this.entryLines(proj);
        return lines != null && lines.some((l) => distToSegment(px, py, l.x1, l.y1, l.x2, l.y2) <= tol);
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const pts: Array<[number, number]> = [];
        for (const a of this.anchors) {
            const y = proj.yOf(a.price, this.paneId);
            if (y == null) return [];
            pts.push([proj.xOf(a.time), y]);
        }
        return pts;
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const pts = this.handlePoints(proj);
        if (pts.length === 0) return null;
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }

    schema(): SettingsSchema {
        // Width + style apply to all entries; per-entry color/enable/label live in the gear panel.
        return { fields: LINE_FIELDS.filter((f) => f.path !== 'style.lineColor') };
    }

    protected override writeProps(): Record<string, unknown> {
        return { levels: this.levels.map((l) => ({ ...l })), numbersSize: this.numbersSize, labelsSize: this.labelsSize };
    }

    protected override readProps(props: Record<string, unknown>): void {
        if (Array.isArray(props.levels)) {
            const parsed = props.levels.map(sanitizeLevel).filter((l): l is FibLevel => l != null);
            if (parsed.length) this.levels = parsed;
        }
        if (isFibSize(props.numbersSize)) this.numbersSize = props.numbersSize;
        if (isFibSize(props.labelsSize)) this.labelsSize = props.labelsSize;
    }
}
