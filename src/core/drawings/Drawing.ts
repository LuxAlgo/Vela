import type { DrawingPoint, FreeAxis, Projector } from './geometry';
import type { DrawingStyle, DrawingText } from './style';
import { defaultStyle, defaultText } from './style';
import type { SettingsSchema } from './schema';
import type { MessageLike } from '../i18n/types';
import { sanitizeShowOn } from './visibility';
import type { DrawingData, DrawingShape, ShapeContext } from './shapes';

/** What a pointer position hits on a drawing: the named part (null for the plain body), and
 *  what the chart shows for it. */
export interface DrawingHit {
    part: string | null;
    cursor?: string;
    tip?: string;
}

/** One value a drawing reports (the data window, `chart.drawings.readout()`). */
export interface DrawingReadoutRow {
    /** Names the value, so a read-only settings row can show it (`results.<key>`). */
    key?: string;
    label: MessageLike;
    value: string;
    color?: string;
}

/** A point or a level the magnet may snap to: a time, a price, or both. */
export interface SnapTarget {
    time?: number;
    price?: number;
}

/** What the renderer hands a drawing it starts painting. */
export interface DrawingHost {
    /** The instance this one replaces (same id and type), so cached results carry over a
     *  re-sync instead of being computed again. */
    prev: Drawing | null;
    /** Ask for a repaint (an asynchronous result landed). */
    invalidate(): void;
}

/** The drawing types Vela ships. */
export type BuiltinDrawingType =
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
    | 'magnifier'
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
    | 'cypher'
    | 'fairvaluegap'
    | 'orderblock'
    | 'liquidity';

/**
 * A drawing type's key: one of the built-in tools, or any string a host registers a type
 * under (`registerDrawingType`, `defineDrawing`). Namespace a custom key (`'acme.spiral'`)
 * so it never meets a tool a later release adds.
 */
export type DrawingTypeKey = BuiltinDrawingType | (string & {});

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
    /** The timeframe bands the drawing shows on (see `TIMEFRAME_BANDS`); absent = every one. */
    showOn?: string[];
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
    /** The timeframe bands the drawing shows on; `undefined` = every timeframe. */
    showOn?: string[];
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
        this.showOn = sanitizeShowOn(init.showOn);
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
     * Map the point of placement step `index` to the anchor the drawing stores: constrain it
     * (the same price as the first point, the nearest bar), or read the chart at it. Called
     * for each click and, with `preview`, for the cursor between clicks, so the ghost shows
     * what the click would commit. Default: the point as given.
     */
    placeAnchor(_index: number, point: DrawingPoint, _proj: Projector, _preview: boolean): DrawingPoint {
        return point;
    }

    /** True when placement should end before `anchorSchema().max` points are in (a tool
     *  whose sequence depends on what was clicked). Checked after every committed point. */
    placementFinished(): boolean {
        return false;
    }

    /** The prompt for placement step `index` (the point about to be clicked), shown while
     *  placing; null keeps the type's one `placementHint`. */
    stepHint(_index: number): MessageLike | null {
        return null;
    }

    /** Whether holding Shift locks a two-point drawing of this type to 45° steps. */
    angleSnaps(): boolean {
        return false;
    }

    /**
     * The drawing as a list of shapes: the paint seam. A type that implements it needs no
     * branch in a renderer, which draws the list as it is. Types the renderer already knows
     * by class leave it undefined.
     */
    shapes?(ctx: ShapeContext<object>): DrawingShape[];

    /** The drawing's data as `shapes()` and the other hooks read it. `proj` is the frame's
     *  projector, when the read happens inside one. */
    shapeData(proj?: Projector | null): DrawingData<object> {
        return {
            id: this.id,
            type: this.type,
            paneId: this.paneId,
            anchors: this.anchors,
            props: this.writeProps() ?? {},
            style: this.style,
            text: this.text,
            state: undefined,
            pending: false,
            bars: (from, to) => proj?.barsInRange?.(from, to) ?? [],
        };
    }

    /** What (px, py) hits on this drawing beyond "the body": a named part, its cursor and its
     *  tip. Null when the type has no parts. */
    hitInfo(_px: number, _py: number, _proj: Projector, _tol: number): DrawingHit | null {
        return null;
    }

    /** A click landed on the drawing (on `part`, or on its plain body). Return true when the
     *  click changed the drawing: the chart then saves the change in place of opening the
     *  settings bar. */
    onClick(_part: string | null): boolean {
        return false;
    }

    /** The drawing's price at `time` (a line's level there, a curve's value), or null where
     *  it has none: what an alert on the drawing compares the price with. `proj` is the
     *  chart's projector when the read comes through a renderer: a straight line is then
     *  read as it is painted, whatever the price scale and the gaps in the time axis. */
    valueAt(_time: number, _proj?: Projector | null): number | null {
        return null;
    }

    /** The values the drawing reports, for the data window and `chart.drawings.readout()`. */
    readout(): DrawingReadoutRow[] {
        return [];
    }

    /** Points and levels this drawing offers the magnet while ANOTHER drawing is placed or
     *  reshaped. */
    snapTargets(): SnapTarget[] {
        return [];
    }

    /** Whether the pane's price scale widens to keep this drawing in view. */
    autoscales(): boolean {
        return false;
    }

    /** The renderer starts painting this instance. */
    mount(_host: DrawingHost): void {
        /* base keeps no state across instances */
    }

    /**
     * Move handle `index` to `pt`. By default handle `i` IS anchor `i`, moved along the axes its slot
     * frees; a type with more handles than anchors (a box's edge midpoints) maps each extra handle
     * onto the anchor coordinates it edits.
     */
    dragHandle(index: number, pt: DrawingPoint): void {
        const a = this.anchors[index];
        if (!a) return;
        const free = this.anchorSchema().slots[index]?.free ?? 'both';
        if (free === 'both' || free === 'x') a.time = pt.time;
        if (free === 'both' || free === 'y') a.price = pt.price;
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
    /** Visible price span on its pane. The pane's scale keeps it in view for a type that
     *  opts in (`autoscales()`). */
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

    /** The text a fresh drawing of this type starts with ("Note", "Callout"), as a message,
     *  or null for a type that seeds none. A new drawing stores its English source; the chart
     *  that places one interactively writes it in its own language instead. */
    placeholderText(): MessageLike | null {
        return null;
    }

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
            // Always present (undefined = every timeframe) so an edit can lift a limit; JSON
            // drops the undefined value, so unlimited drawings save as before.
            showOn: this.showOn ? [...this.showOn] : undefined,
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
