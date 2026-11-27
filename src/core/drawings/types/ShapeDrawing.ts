import { Drawing, type AnchorSlot, type DrawingHit, type DrawingHost, type DrawingReadoutRow, type SerializedDrawing, type SnapTarget } from '../Drawing';
import type { DrawingPoint, FreeAxis, Projector } from '../geometry';
import type { SettingsField, SettingsSchema } from '../schema';
import { FILL_FIELDS, LINE_FIELDS } from '../schema';
import { handleAt } from '../hittest';
import { clonePlain } from '../document';
import { defaultStyle, defaultText, type DrawingStyle, type DrawingText } from '../style';
import { MAX_EMBED_DEPTH, hitShapes, reportDrawingError, shapeContext, shapesBounds, usableShapes, type DrawingData, type DrawingShape, type ShapeBar, type ShapeContext, type ShapePoint } from '../shapes';
import { createDrawing, drawingTypeEntry, registerDrawingType, unregisterDrawingType, type DrawingTypeMeta } from '../registry';
import { svg24 } from '../../icons';
import type { MessageLike } from '../../i18n/types';

/** How the chart's bars differ from the ones `compute` last ran on. */
export type BarsChange = 'none' | 'tick' | 'append' | 'reset';

/** What `compute` receives: the drawing's data and what changed since its last result. */
export interface ComputeContext<P = Record<string, unknown>> {
    readonly anchors: readonly DrawingPoint[];
    readonly props: P;
    /** The chart's bars in a time range. */
    bars(from: number, to: number): ReadonlyArray<ShapeBar>;
    /** The time zone the chart shows its times in, as an IANA name (`'UTC'` when the
     *  renderer does not say): what a session, a day or a week is measured in. */
    readonly timeZone: string;
    /**
     * Why this run happens. `bars` is `'tick'` when only the newest bar moved, `'append'`
     * when bars were added after it, `'reset'` when the series is another one (a symbol or
     * timeframe change, older history loaded) or the chart's time zone changed: the first
     * two let a result be extended from the previous one in place of a full pass.
     */
    readonly change: { anchors: boolean; props: boolean; bars: BarsChange };
}

/** An extra handle: a grip at a data point that edits the drawing when dragged. */
export interface ShapeHandle<P = Record<string, unknown>> {
    at: DrawingPoint;
    /** The handle was dragged to `point`: return the props to change (or move the anchors). */
    drag(point: DrawingPoint): Partial<P> | void;
}

interface Cache<S> {
    /** What the newest run was started for. */
    key: string;
    barsKey: string | undefined;
    state: S | undefined;
    /** What `state` was computed from. A run is told what changed since THAT: a run still
     *  on its way, or one that failed, produced nothing to extend. */
    stateKey: string | undefined;
    stateBarsKey: string | undefined;
    pending: boolean;
}

/** How many drawings deep a hit-test follows embedded drawings (a type that embeds itself
 *  would otherwise never end). */
let embedDepth = 0;

/** Classify a bars change from two `Projector.barsKey` values
 *  (`count|firstTime|lastTime|series|lastBar`). */
function barsChange(prev: string | undefined, next: string | undefined): BarsChange {
    if (prev === next) return 'none';
    if (prev === undefined || next === undefined) return 'reset';
    const [pc, pf, pl, ps] = prev.split('|');
    const [nc, nf, nl, ns] = next.split('|');
    if (pf !== nf || ps !== ns) return 'reset';
    if (pc === nc && pl === nl) return 'tick';
    return Number(nc) > Number(pc) ? 'append' : 'reset';
}

/**
 * A drawing described by the shapes it paints. Implement `shapes()` (and `anchorSchema()`):
 * hit-testing, the hover parts, the handles, the selection bounds and the saved document all
 * follow from the shape list, the anchors and `props`. No renderer knows this class.
 */
export abstract class ShapeDrawing<P extends object = Record<string, unknown>, S = unknown> extends Drawing {
    /** The drawing's own settings, saved with it. Declared, not initialized: `readProps`
     *  fills it while the base constructor runs. */
    declare props: P;
    private cache: Cache<S> | null = null;
    private host: DrawingHost | null = null;
    /** The last projector a paint or a hit-test went through: a data read made outside a
     *  frame (a value for an alert) reaches the chart's bars through it. */
    private lastProj: Projector | null = null;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.props) this.props = this.defaultProps();
    }

    abstract override shapes(ctx: ShapeContext<P, S>): DrawingShape[];

    /** The props a fresh drawing starts with. */
    protected defaultProps(): P {
        return {} as P;
    }

    /**
     * Work that depends on the anchors, the props and the chart's bars, and not on the
     * viewport: it runs when one of them changes, never on a pan or a zoom, and `shapes()`
     * reads its result as `ctx.state`. Return a promise to do the work elsewhere (a worker):
     * the previous result stays painted until the new one lands.
     */
    compute?(ctx: ComputeContext<P>, prev: S | undefined): S | Promise<S>;

    /** Extra handles, beyond one per anchor. */
    protected handles(_data: DrawingData<P, S>): ShapeHandle<P>[] {
        return [];
    }

    override mount(host: DrawingHost): void {
        this.host = host;
        // Only from an instance of this very class: a type that was defined again computes
        // again, since the result on hand is the old definition's.
        if (host.prev instanceof ShapeDrawing && host.prev.constructor === this.constructor) {
            this.cache = host.prev.cache as Cache<S> | null;
            this.lastProj = host.prev.lastProj;
        }
    }

    /** The drawing's data as its hooks read it. `proj` is the frame's projector when there is
     *  one; without it the last result of `compute` is handed back as it stands. */
    override shapeData(proj?: Projector | null): DrawingData<P, S> {
        if (proj) this.lastProj = proj;
        const source = proj ?? this.lastProj;
        const bars = (from: number, to: number): ReadonlyArray<ShapeBar> => source?.barsInRange?.(from, to) ?? [];
        if (proj && this.compute) this.runCompute(proj, bars);
        return {
            id: this.id,
            type: this.type,
            paneId: this.paneId,
            anchors: this.anchors,
            props: this.props,
            style: this.style,
            text: this.text,
            state: this.cache?.state,
            pending: this.cache?.pending ?? false,
            bars,
        };
    }

    private runCompute(proj: Projector, bars: (from: number, to: number) => ReadonlyArray<ShapeBar>): void {
        const anchorsKey = JSON.stringify(this.anchors);
        const propsKey = JSON.stringify(this.props);
        const timeZone = proj.timeZone ?? 'UTC';
        // The zone rides the key (JSON keeps the first two parts free of line breaks): a
        // result worked out in one zone is not the answer in another.
        const key = `${anchorsKey}\n${propsKey}\n${timeZone}`;
        const prev = this.cache;
        if (prev && prev.key === key && prev.barsKey === proj.barsKey) return;
        const from = prev?.stateKey;
        const [fromAnchors, fromProps, fromZone] = from !== undefined ? from.split('\n') : [];
        const change = {
            anchors: fromAnchors !== anchorsKey,
            props: fromProps !== propsKey,
            bars: from !== undefined && fromZone === timeZone ? barsChange(prev?.stateBarsKey, proj.barsKey) : ('reset' as const),
        };
        const cache: Cache<S> = { key, barsKey: proj.barsKey, state: prev?.state, stateKey: from, stateBarsKey: prev?.stateBarsKey, pending: false };
        // Stored before the run: one that fails is tried again when its inputs change, not
        // on every frame.
        this.cache = cache;
        const settle = (state: S): void => {
            cache.state = state;
            cache.stateKey = key;
            cache.stateBarsKey = proj.barsKey;
        };
        let out: S | Promise<S>;
        try {
            out = this.compute!({ anchors: this.anchors, props: this.props, bars, timeZone, change }, prev?.state);
        } catch (err) {
            reportDrawingError(this.type, 'compute', err);
            return;
        }
        if (out && typeof (out as Promise<S>).then === 'function') {
            cache.pending = true;
            (out as Promise<S>).then(
                (state) => {
                    cache.pending = false;
                    // Written into the cache OBJECT, which later instances of this drawing
                    // share (see `mount`); a run that replaced it left this one unread.
                    settle(state);
                    this.host?.invalidate();
                },
                (err) => {
                    cache.pending = false;
                    reportDrawingError(this.type, 'compute', err);
                    this.host?.invalidate();
                },
            );
        } else settle(out as S);
    }

    /** The shapes for a hit-test or the bounds (no frame state). A tool whose `shapes()`
     *  throws has no shapes: the pointer path must not fail on every move. */
    private resolve(proj: Projector): DrawingShape[] {
        try {
            return usableShapes(this.type, this.shapes(shapeContext(this.shapeData(proj), proj)));
        } catch (err) {
            reportDrawingError(this.type, 'shapes', err);
            return [];
        }
    }

    private hitShape(px: number, py: number, proj: Projector, tol: number): DrawingShape | null {
        return hitShapes(this.resolve(proj), px, py, tol, {
            width: proj.width,
            height: proj.height,
            lineWidth: this.style.lineWidth,
            embedded: (s) => {
                if (embedDepth >= MAX_EMBED_DEPTH) return false;
                const child = createDrawing(s.type, { paneId: this.paneId, anchors: [...s.anchors], style: s.style as DrawingStyle | undefined, text: s.text, props: s.props });
                if (!child) return false;
                embedDepth += 1;
                try {
                    return child.hitTest(px, py, proj, tol);
                } finally {
                    embedDepth -= 1;
                }
            },
        });
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        return this.hitShape(px, py, proj, tol) != null;
    }

    override hitInfo(px: number, py: number, proj: Projector, tol: number): DrawingHit | null {
        const s = this.hitShape(px, py, proj, tol);
        if (!s || s.kind === 'tag') return null;
        return { part: s.part ?? null, cursor: s.cursor, tip: s.tip };
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const out: Array<[number, number]> = [];
        const add = (p: DrawingPoint): boolean => {
            const y = proj.yOf(p.price, this.paneId);
            if (y == null) return false;
            out.push([proj.xOf(p.time), y]);
            return true;
        };
        for (const a of this.anchors) if (!add(a)) return [];
        for (const h of this.handles(this.shapeData(proj))) add(h.at);
        return out;
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    override dragHandle(index: number, pt: DrawingPoint): void {
        if (index < this.anchors.length) {
            super.dragHandle(index, pt);
            return;
        }
        const patch = this.handles(this.shapeData())[index - this.anchors.length]?.drag(pt);
        if (patch) this.props = { ...this.props, ...patch };
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        return shapesBounds(this.resolve(proj), this.handlePoints(proj) as ShapePoint[]);
    }

    priceRange(): { min: number; max: number } | null {
        if (this.anchors.length === 0) return null;
        let min = Infinity;
        let max = -Infinity;
        for (const a of this.anchors) {
            if (a.price < min) min = a.price;
            if (a.price > max) max = a.price;
        }
        return { min, max };
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...(this.style.fillColor !== undefined ? FILL_FIELDS : [])] };
    }

    /** The readout as a record, so a read-only settings row can name one value by path
     *  (`results.<key>`). */
    get results(): Record<string, string> {
        const out: Record<string, string> = {};
        this.readout().forEach((row, i) => (out[row.key ?? String(i)] = row.value));
        return out;
    }

    /** The level editor reads and writes `levels` on the drawing itself. */
    get levels(): unknown {
        return (this.props as Record<string, unknown>).levels;
    }

    protected override writeProps(): Record<string, unknown> {
        return clonePlain(this.props) as Record<string, unknown>;
    }

    protected override readProps(props: Record<string, unknown>): void {
        this.props = { ...this.defaultProps(), ...clonePlain(props) } as P;
    }

    /** An edit names the props it changes: the others keep their values (a restored
     *  record went through `readProps`, where the defaults fill what it lacks). */
    override applyProps(props: Record<string, unknown>): void {
        this.props = { ...this.props, ...clonePlain(props) } as P;
    }
}

/** One point of a tool's placement. */
export interface AnchorSpec {
    role?: string;
    /** The axes the point's handle moves along once placed. */
    free?: FreeAxis;
    /** The prompt shown before this point is clicked. */
    hint?: MessageLike;
}

/** One placement step, as `place` sees it. */
export interface PlacementStep<P = Record<string, unknown>> {
    /** Which point this is (0 for the first click). */
    readonly index: number;
    /** Where the pointer is, after the magnet. */
    readonly point: DrawingPoint;
    /** The points already placed. */
    readonly anchors: readonly DrawingPoint[];
    readonly props: P;
    /** The pointer is only passing over: nothing is committed yet. */
    readonly preview: boolean;
    bars(from: number, to: number): ReadonlyArray<ShapeBar>;
    /** Keep values read at this click in the drawing's props (ignored on a preview). */
    set(patch: Partial<P>): void;
    /** End the placement with this point, before the last declared one. */
    finish(): void;
}

/** A drawing tool as one object: what `defineDrawing` registers. */
export interface DrawingDefinition<P extends object = Record<string, unknown>, S = unknown> {
    /** The type key. Namespace it: `'acme.spiral'`. */
    type: string;
    /** The tool's name (toolbar, settings, object tree). */
    label: MessageLike;
    /** Inline SVG markup for the toolbar. */
    icon?: string;
    /** The toolbar group: a built-in one (`'lines'`, `'shapes'`, `'fibonacci'`…) or your own
     *  (`registerDrawingGroup`). Default `'custom'`. */
    group?: string;
    /** `false` keeps the tool off the default toolbar: your own interface arms it
     *  (`chart.drawings.setTool`). */
    toolbar?: boolean;
    /** The prompt shown while the tool is armed. */
    placementHint?: MessageLike;
    /** How many points the tool takes: a count, a range (a variable tool finishes on Enter or
     *  a double-click), or one entry per point. Default 2. */
    anchors?: number | { min: number; max: number } | readonly AnchorSpec[];
    placement?: 'click' | 'drag' | 'freehand';
    /** Shift locks a two-point tool to 45° steps. */
    angleSnap?: boolean;
    /** The look a new drawing starts with, over the neutral default. */
    style?: Partial<DrawingStyle>;
    /** The text block a new drawing starts with. */
    text?: Partial<DrawingText>;
    /** The drawing's own settings and their defaults: saved with it as `props`. */
    props?: P;
    /** The settings shown for the drawing. Paths read into it: `props.<key>`, `style.<key>`,
     *  `text.<key>`, `results.<key>`. Default: the line settings (and the fill, when `style`
     *  sets one). */
    settings?: readonly SettingsField[];
    /** `props.levels` is a list of `{ ratio, color, enabled }` the level editor edits. */
    levels?: boolean;
    /** The drawing's body replaces the series under it: a new one starts over them. */
    coversSeries?: boolean;
    /** The pane's price scale widens to keep the drawing in view. */
    autoscale?: boolean;
    /** The paint seam: the drawing as shapes, for this frame. */
    shapes(ctx: ShapeContext<P, S>): DrawingShape[];
    /** See {@link ShapeDrawing.compute}. */
    compute?(ctx: ComputeContext<P>, prev: S | undefined): S | Promise<S>;
    /** Extra handles, beyond one per point. */
    handles?(data: DrawingData<P, S>): ShapeHandle<P>[];
    /** Called for every placement step: return a point to constrain it, `set()` to keep what
     *  was read there, `finish()` to stop early. */
    place?(step: PlacementStep<P>): DrawingPoint | void;
    /** Placement ended: return props to keep (values captured from the chart). */
    placed?(data: DrawingData<P, S>): Partial<P> | void;
    /** A point's handle was dragged: re-impose what must hold between the points. */
    constrain?(index: number, anchors: DrawingPoint[], props: P): void;
    /** Move the body by (dt, dp): return the new points. Default moves every point. */
    translate?(dt: number, dp: number, orig: readonly DrawingPoint[]): DrawingPoint[];
    /** The time span the drawing covers, for culling: `'all'` never culls (a full-width tool). */
    timeExtent?: 'all' | ((data: DrawingData<P, S>) => { min: number; max: number } | null);
    /** The price span the drawing covers. Default: its points'. */
    priceRange?(data: DrawingData<P, S>): { min: number; max: number } | null;
    /** The drawing's price at a time: what an alert on it compares the price with. `proj` is
     *  the chart's projector when a renderer answers (pass it to `lineValueAt` to read a
     *  straight line as it is painted). */
    valueAt?(time: number, data: DrawingData<P, S>, proj: Projector | null): number | null;
    /** The values the drawing reports (data window, `chart.drawings.readout()`). */
    readout?(data: DrawingData<P, S>): DrawingReadoutRow[];
    /** Points and levels offered to the magnet while another drawing is placed or reshaped. */
    snapTargets?(data: DrawingData<P, S>): SnapTarget[];
    /** A click on the drawing: return props to change, and the click edits the drawing in
     *  place of opening its settings bar. */
    click?(part: string | null, data: DrawingData<P, S>): Partial<P> | void;
}

const DEFAULT_ICON = svg24('<path d="M4 18c3-9 6-9 8-4s5 3 8-6"/><circle cx="4" cy="18" r="1.6"/><circle cx="20" cy="8" r="1.6"/>');

function slotsOf(spec: DrawingDefinition['anchors']): { min: number; max: number; slots: AnchorSlot[]; hints: Array<MessageLike | undefined> } {
    if (spec === undefined || typeof spec === 'number') {
        const n = spec ?? 2;
        return { min: n, max: n, slots: Array.from({ length: n }, (_, i) => ({ role: `p${i + 1}`, free: 'both' as const })), hints: [] };
    }
    if (Array.isArray(spec)) {
        const list = spec as readonly AnchorSpec[];
        return {
            min: list.length,
            max: list.length,
            slots: list.map((a, i) => ({ role: a.role ?? `p${i + 1}`, free: a.free ?? 'both' })),
            hints: list.map((a) => a.hint),
        };
    }
    const range = spec as { min: number; max: number };
    return { min: range.min, max: range.max, slots: [], hints: [] };
}

/**
 * Register a drawing tool from one definition. The tool joins the toolbar, places, edits,
 * saves and undoes like a built-in one; `shapes()` is all a renderer needs of it. Returns
 * the function that unregisters it. Defining a type again replaces it, and the drawings
 * already on a chart follow.
 */
export function defineDrawing<P extends object = Record<string, unknown>, S = unknown>(def: DrawingDefinition<P, S>): () => void {
    const schema = slotsOf(def.anchors);
    const style: DrawingStyle = { ...defaultStyle(), ...def.style };

    // The definition's hooks run inside the paint, the pointer path, the autoscale and the
    // data window, on every frame or every move. One that throws (it read a `state` that
    // `compute` has not returned yet) is reported once for the tool and answers `undefined`:
    // the caller then does what it does for a tool without that hook.
    const hook = <T>(name: string, call: () => T): T | undefined => {
        try {
            return call();
        } catch (err) {
            reportDrawingError(def.type, name, err);
            return undefined;
        }
    };
    const isPoint = (p: unknown): p is DrawingPoint => p != null && typeof (p as DrawingPoint).time === 'number' && typeof (p as DrawingPoint).price === 'number';

    class Defined extends ShapeDrawing<P, S> {
        readonly type = def.type;
        private finished = false;

        constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
            super(init);
            if (def.text && !this.text) this.text = { ...defaultText(), ...def.text };
        }

        protected override defaultProps(): P {
            return clonePlain(def.props ?? {}) as P;
        }

        anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
            return { min: schema.min, max: schema.max, slots: schema.slots };
        }

        override placementMode(): 'click' | 'drag' | 'freehand' {
            return def.placement ?? 'click';
        }

        override stepHint(index: number): MessageLike | null {
            return schema.hints[index] ?? null;
        }

        override angleSnaps(): boolean {
            return def.angleSnap === true;
        }

        override placeAnchor(index: number, point: DrawingPoint, proj: Projector, preview: boolean): DrawingPoint {
            const place = def.place;
            if (!place) return point;
            const out = hook('place', () =>
                place({
                    index,
                    point,
                    anchors: this.anchors.slice(0, index),
                    props: this.props,
                    preview,
                    bars: (from, to) => proj.barsInRange?.(from, to) ?? [],
                    set: (patch) => {
                        if (!preview) this.props = { ...this.props, ...patch };
                    },
                    finish: () => {
                        if (!preview) this.finished = true;
                    },
                }),
            );
            return isPoint(out) ? out : point;
        }

        override placementFinished(): boolean {
            return this.finished;
        }

        override onPlaced(proj: Projector): void {
            const placed = def.placed;
            const patch = placed && hook('placed', () => placed(this.shapeData(proj)));
            if (patch) this.props = { ...this.props, ...patch };
        }

        override constrainHandleDrag(index: number): void {
            const constrain = def.constrain;
            if (constrain) hook('constrain', () => constrain(index, this.anchors, this.props));
        }

        override translateBody(dt: number, dp: number, orig: DrawingPoint[]): DrawingPoint[] {
            const translate = def.translate;
            const moved = translate && hook('translate', () => translate(dt, dp, orig));
            // Not a point per anchor: the drawing moves as one without the hook does.
            return Array.isArray(moved) && moved.length === orig.length && moved.every(isPoint) ? moved : super.translateBody(dt, dp, orig);
        }

        override timeExtent(): { min: number; max: number } | null {
            const extent = def.timeExtent;
            if (extent === 'all') return null;
            const own = extent && hook('timeExtent', () => extent(this.shapeData()));
            return own === undefined ? super.timeExtent() : own;
        }

        override priceRange(): { min: number; max: number } | null {
            const range = def.priceRange;
            const own = range && hook('priceRange', () => range(this.shapeData()));
            return own === undefined ? super.priceRange() : own;
        }

        override autoscales(): boolean {
            return def.autoscale === true;
        }

        override valueAt(time: number, proj?: Projector | null): number | null {
            const valueAt = def.valueAt;
            return (valueAt && hook('valueAt', () => valueAt(time, this.shapeData(proj), proj ?? null))) ?? null;
        }

        override readout(): DrawingReadoutRow[] {
            const readout = def.readout;
            const rows = readout && hook('readout', () => readout(this.shapeData()));
            return Array.isArray(rows) ? rows.filter((row) => row != null) : [];
        }

        override snapTargets(): SnapTarget[] {
            const snapTargets = def.snapTargets;
            const targets = snapTargets && hook('snapTargets', () => snapTargets(this.shapeData()));
            return Array.isArray(targets) ? targets.filter((target) => target != null) : [];
        }

        override onClick(part: string | null): boolean {
            const click = def.click;
            const patch = click && hook('click', () => click(part, this.shapeData()));
            if (!patch) return false;
            this.props = { ...this.props, ...patch };
            return true;
        }

        protected override handles(data: DrawingData<P, S>): ShapeHandle<P>[] {
            const handles = def.handles;
            const list = handles && hook('handles', () => handles(data));
            if (!Array.isArray(list)) return [];
            // A grip needs a point to sit at; its drag runs on every pointer move.
            return list
                .filter((h) => h != null && isPoint(h.at))
                .map((h) => ({ at: h.at, drag: (point) => hook('handle drag', () => h.drag(point)) }));
        }

        override schema(): SettingsSchema {
            return def.settings ? { fields: [...def.settings] } : super.schema();
        }

        override editableLevels(): Array<{ ratio: number; color: string; enabled: boolean; label?: string }> | null {
            const levels = def.levels ? this.levels : null;
            return Array.isArray(levels) ? (levels as Array<{ ratio: number; color: string; enabled: boolean; label?: string }>) : null;
        }

        override shapes(ctx: ShapeContext<P, S>): DrawingShape[] {
            return def.shapes(ctx);
        }
    }
    if (def.compute) Defined.prototype.compute = (ctx, prev) => def.compute!(ctx, prev);

    const meta: DrawingTypeMeta = {
        type: def.type,
        group: def.group ?? 'custom',
        label: def.label,
        icon: def.icon ?? DEFAULT_ICON,
        defaultStyle: style,
        coversSeries: def.coversSeries,
        placementHint: def.placementHint,
        staysArmed: def.placement === 'freehand',
        toolbar: def.toolbar,
        create: (init) => new Defined(init),
    };
    registerDrawingType(meta);
    return () => {
        // Only its own registration: the key may since belong to a later definition.
        if (drawingTypeEntry(def.type) === meta) unregisterDrawingType(def.type);
    };
}
