import type { DrawingPoint, FreeAxis, Projector } from './geometry';
import type { DrawingStyle, DrawingText } from './style';
import { defaultStyle, defaultText } from './style';
import type { SettingsSchema } from './schema';

/**
 * The interactive user-drawing types. The lean-core set ships first; new types
 * (fibs/patterns) extend the union + register a class — no base/port change.
 */
export type DrawingTypeKey =
    | 'trendline'
    | 'hline'
    | 'ray'
    | 'extendedline'
    | 'vline'
    | 'hray'
    | 'crossline'
    | 'infoline'
    | 'trendangle'
    | 'box'
    | 'text'
    | 'note'
    | 'pricenote'
    | 'comment'
    | 'pricelabel'
    | 'signpost'
    | 'parallelchannel'
    | 'disjointchannel'
    | 'flattopbottom'
    | 'regressionchannel'
    | 'anchoredvwap'
    | 'fixedrangevp'
    | 'pitchfork'
    | 'schiffpitchfork'
    | 'modifiedschiffpitchfork'
    | 'insidepitchfork'
    | 'arrow'
    | 'callout'
    | 'ellipse'
    | 'triangle'
    | 'polyline'
    | 'freehand'
    | 'highlighter'
    | 'circle'
    | 'rotatedrect'
    | 'path'
    | 'arc'
    | 'curve'
    | 'arrowmarkup'
    | 'arrowmarkdown'
    | 'flagmark'
    | 'iconstamp'
    | 'fibretracement'
    | 'fibextension'
    | 'fibextensiontrend'
    | 'fibfan'
    | 'fibtimezones'
    | 'fibchannel'
    | 'fibspeedfan'
    | 'trendfibtime'
    | 'fibcircles'
    | 'fibarcs'
    | 'fibwedge'
    | 'fibspiral'
    | 'gannfan'
    | 'gannbox'
    | 'gannsquare'
    | 'dedekind'
    | 'sonic'
    | 'supersonic'
    | 'goldensonic'
    | 'goldensupersonic'
    | 'datepricerange'
    | 'position'
    | 'xabcd'
    | 'abcd'
    | 'elliottimpulse'
    | 'elliottcorrection'
    | 'headshoulders'
    | 'gartley'
    | 'bat'
    | 'butterfly'
    | 'crab'
    | 'shark'
    | 'cypher';

/** One anchor's role + which axes its handle may move along. */
export interface AnchorSlot {
    role: string;
    free: FreeAxis;
}

/**
 * The plain-JSON shape of one drawing — the ONLY representation that crosses the
 * renderer port and the persistence boundary. A {@link Drawing} (rich behavior)
 * serializes to/from this; the renderer never sees a class instance.
 */
export interface SerializedDrawing {
    id: string;
    type: DrawingTypeKey;
    paneId: string;
    /** time+price anchors — the single source of geometry truth. */
    anchors: DrawingPoint[];
    style: DrawingStyle;
    text?: DrawingText;
    locked: boolean;
    visible: boolean;
    /** Draw-order key. On a renderer with `drawingDepth` it shares ONE space with the pane's
     *  series — the candles and each indicator carry z keys of their own — so a drawing can sit
     *  anywhere in the stack, under the candles or between two indicators included. */
    zIndex: number;
    createdAt: number;
    /** Per-type extras (e.g. box `extend`) — keeps the base closed. */
    props?: Record<string, unknown>;
}

/**
 * The parent of every user drawing. Owns the shared state + settings/serialization
 * (the "everything inherits from a parent object" intent), and declares the
 * geometry behaviors as PURE functions of `(anchors, Projector)` so the whole
 * hierarchy stays renderer-neutral and serializable.
 */
export abstract class Drawing {
    readonly id: string;
    abstract readonly type: DrawingTypeKey;

    paneId: string;
    /** DATA-space anchors (time+price). The only geometry the model stores. */
    anchors: DrawingPoint[];
    style: DrawingStyle;
    text?: DrawingText;
    locked = false;
    visible = true;
    zIndex = 0;
    readonly createdAt: number;

    // Public so the registry can construct concrete subclasses; `abstract` still
    // prevents `new Drawing()` directly.
    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        this.id = init.id ?? `dw-${(Drawing.seq += 1)}`;
        this.paneId = init.paneId;
        this.anchors = (init.anchors ?? []).map((p) => ({ time: p.time, price: p.price }));
        this.style = init.style ? { ...init.style } : defaultStyle();
        this.text = init.text ? { ...init.text } : undefined;
        this.locked = init.locked ?? false;
        this.visible = init.visible ?? true;
        this.zIndex = init.zIndex ?? 0;
        this.createdAt = init.createdAt ?? Date.now();
        if (init.props) this.readProps(init.props);
    }

    /** Fallback id counter — used only when no id is supplied (store assigns real ids). */
    private static seq = 0;

    // ── anchor schema: how many points, which axes are free ──
    abstract anchorSchema(): { min: number; max: number; slots: AnchorSlot[] };
    /** True once enough anchors exist to be a real shape. */
    isComplete(): boolean {
        return this.anchors.length >= this.anchorSchema().min;
    }

    /**
     * How the tool is placed: `'click'` (click each anchor; a variable-count tool —
     * `max > min` — keeps adding until a finish gesture), `'drag'` (press at the first
     * corner, drag, release at the second — the press-drag-release idiom for boxes/ranges/positions),
     * or `'freehand'` (press, drag to capture a path, release). Drives the state machine.
     */
    placementMode(): 'click' | 'drag' | 'freehand' {
        return 'click';
    }

    /**
     * Hook run once after interactive placement finishes, before the `create` intent —
     * lets a type finalize its anchors against the live projector (e.g. a position deriving
     * its stop/target/width in pixel space so a bare click drops a default-sized box).
     * Default: no-op.
     */
    onPlaced(_proj: Projector): void {
        /* base keeps its placed anchors as-is */
    }

    /**
     * After a single handle (anchor `index`) is dragged, re-impose any cross-anchor invariant —
     * e.g. a position keeps its stop and target on opposite sides of the entry, flipping the
     * non-dragged side across the entry when a drag would put them on the same side. Default: no-op.
     */
    constrainHandleDrag(_index: number): void {
        /* base anchors move independently */
    }

    /**
     * Apply a whole-body drag — translate the original anchors by (dt, dp) in data space.
     * Default moves every anchor together; a type can pin some (e.g. a callout keeps its
     * pointer tip fixed and moves only the box).
     */
    translateBody(dt: number, dp: number, orig: DrawingPoint[]): DrawingPoint[] {
        return orig.map((o) => ({ time: o.time + dt, price: o.price + dp }));
    }

    // ── geometry behaviors: PURE functions of (anchors, projector) ──
    /** Is the pixel (px,py) on this drawing's body, within `tol` px? */
    abstract hitTest(px: number, py: number, proj: Projector, tol: number): boolean;
    /** Index of the grabbed handle, or -1 for the body. */
    abstract hitHandle(px: number, py: number, proj: Projector, tol: number): number;
    /** Pixel positions of the draggable handles (for painting + hit-test). */
    abstract handlePoints(proj: Projector): Array<[number, number]>;
    /** Tight pixel bounds (selection box), or null when unresolvable. */
    abstract bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null;
    /** Visible price span on its pane — folded into autoscale. */
    abstract priceRange(): { min: number; max: number } | null;

    /**
     * Time span (epoch ms) the drawing occupies, for visible-range culling. Default
     * is the anchor extent; a full-width drawing (e.g. a horizontal line) overrides
     * to `null` meaning "all time" so it never culls.
     */
    timeExtent(): { min: number; max: number } | null {
        if (this.anchors.length === 0) return null;
        let lo = Infinity;
        let hi = -Infinity;
        for (const a of this.anchors) {
            if (a.time < lo) lo = a.time;
            if (a.time > hi) hi = a.time;
        }
        return { min: lo, max: hi };
    }

    // ── settings (data-driven) ──
    abstract schema(): SettingsSchema;

    /**
     * Editable per-level config for a rich "gear" settings panel (Fibonacci levels):
     * each entry's `color` / `enabled` / `label` is mutated via a `levels.<i>.<field>`
     * settings path. Simple drawings return null (no gear).
     */
    editableLevels(): Array<{ ratio: number; color: string; enabled: boolean; label?: string }> | null {
        return null;
    }

    /** Apply a `{ 'dot.path': value }` patch (the popup emits these). */
    applySettings(patch: Record<string, unknown>): void {
        for (const [path, value] of Object.entries(patch)) {
            if (path.startsWith('text.') && !this.text) this.text = defaultText();
            setByPath(this as unknown as Record<string, unknown>, path, value);
        }
    }

    /** Re-read per-type extras (props) onto this instance — used by the store on an edit. */
    applyProps(props: Record<string, unknown>): void {
        this.readProps(props);
    }

    // ── serialization ──
    serialize(): SerializedDrawing {
        return {
            id: this.id,
            type: this.type,
            paneId: this.paneId,
            anchors: this.anchors.map((p) => ({ time: p.time, price: p.price })),
            style: { ...this.style },
            text: this.text ? { ...this.text } : undefined,
            locked: this.locked,
            visible: this.visible,
            zIndex: this.zIndex,
            createdAt: this.createdAt,
            props: this.writeProps(),
        };
    }

    /** Per-type extras to serialize into `props` (override in subclasses). */
    protected writeProps(): Record<string, unknown> | undefined {
        return undefined;
    }
    /** Read per-type extras from a `props` bag (override in subclasses). */
    protected readProps(_props: Record<string, unknown>): void {
        /* base has no extras */
    }
}

/**
 * Set `obj[a][b][c] = value` for a dotted `path`, creating plain intermediates.
 * Tolerant by design — an unknown path is a no-op rather than a throw (the popup
 * is schema-driven, but persisted/untrusted patches must never crash the store).
 */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split('.');
    let cur: Record<string, unknown> = obj;
    for (let i = 0; i < keys.length - 1; i += 1) {
        const k = keys[i]!;
        let next = cur[k];
        if (next == null || typeof next !== 'object') {
            next = {};
            cur[k] = next;
        }
        cur = next as Record<string, unknown>;
    }
    cur[keys[keys.length - 1]!] = value;
}
