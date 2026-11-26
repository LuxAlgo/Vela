// Custom drawing tools, written against the PUBLIC plugin entry only (`@luxalgo/vela/plugin`;
// here `../src/plugin`). Each one is a single `defineDrawing` call: the tool describes what
// it paints as shapes, and the chart does the rest (toolbar entry, placement, handles,
// hit-testing, settings, undo, saving).
//
// They are deliberately close to tools Vela ships, to show the same API reaches them: a
// spiral, an anchored VWAP, a Fibonacci retracement, a regression channel, a zone, a
// position, a volume profile, a five-point pattern, and a tool made of two built-in ones.
import {
    BORDER_FIELDS,
    FILL_FIELDS,
    LINE_FIELDS,
    defineDrawing,
    registerDrawingGroup,
    registerWidgetAction,
    type DrawingShape,
    type ShapeBar,
    type ShapePoint,
} from '../src/plugin';

const GROUP = 'playground';
/** A group that starts with no tool: its menu is where the first one is made. */
const OWN_GROUP = 'playground-own';
const OWN_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 19.5 12 12"/><circle cx="4.5" cy="19.5" r="1.4"/><path d="M17 4v7M13.5 7.5h7"/></svg>';
const BLUE = '#2962ff';
const GREEN = '#089981';
const RED = '#f23645';
const AMBER = '#f59e0b';

/** An Archimedean spiral: the radius grows by the same amount every turn. */
function spiral(): void {
    defineDrawing({
        type: 'playground.spiral',
        label: 'Archimedean Spiral',
        group: GROUP,
        anchors: [{ role: 'center', hint: 'Click the center' }, { role: 'edge', hint: 'Click where the spiral ends' }],
        props: { turns: 4 },
        settings: [...LINE_FIELDS, { path: 'props.turns', label: 'Turns', kind: 'number', min: 1, max: 12, step: 1 }],
        shapes: (c) => {
            const [o, e] = c.points;
            if (!o || !e) return [];
            const radius = Math.hypot(e[0] - o[0], e[1] - o[1]);
            const end = Math.atan2(e[1] - o[1], e[0] - o[0]);
            const total = c.props.turns * Math.PI * 2;
            const points: ShapePoint[] = [];
            for (let s = 0; s <= total; s += Math.PI / 48) {
                const r = (radius * s) / total;
                points.push([o[0] + r * Math.cos(end - total + s), o[1] + r * Math.sin(end - total + s)]);
            }
            points.push(e);
            return [{ kind: 'path', points }];
        },
    });
}

interface VwapPoint {
    time: number;
    mid: number;
    upper: number;
    lower: number;
}

/** A VWAP from one bar onward, with a band: computed from the chart's bars, never per frame. */
function anchoredVwap(): void {
    defineDrawing<{ multiplier: number }, VwapPoint[]>({
        type: 'playground.vwap',
        label: 'Anchored VWAP',
        group: GROUP,
        anchors: [{ role: 'anchor', free: 'x' }],
        placementHint: 'Click the bar to anchor the VWAP at',
        style: { lineColor: BLUE, lineWidth: 2, fillColor: `${BLUE}22` },
        props: { multiplier: 1 },
        autoscale: true,
        settings: [
            ...LINE_FIELDS,
            ...FILL_FIELDS,
            { path: 'props.multiplier', label: 'Band multiplier', kind: 'number', min: 0.5, max: 5, step: 0.5 },
            { path: 'results.vwap', label: 'VWAP now', kind: 'readout' },
        ],
        compute: (c) => {
            const from = c.anchors[0]?.time ?? Infinity;
            let w = 0;
            let pv = 0;
            let p2v = 0;
            return c.bars(from, Infinity).map((b) => {
                const tp = (b.high + b.low + b.close) / 3;
                const vol = b.volume && b.volume > 0 ? b.volume : 1;
                w += vol;
                pv += tp * vol;
                p2v += tp * tp * vol;
                const mid = pv / w;
                const dev = Math.sqrt(Math.max(0, p2v / w - mid * mid)) * c.props.multiplier;
                return { time: b.time, mid, upper: mid + dev, lower: mid - dev };
            });
        },
        shapes: (c) => {
            const pts = c.state ?? [];
            if (pts.length === 0) return [];
            const line = (pick: (p: VwapPoint) => number): ShapePoint[] => pts.map((p) => [c.x(p.time), c.y(pick(p))]);
            const last = pts[pts.length - 1]!;
            return [
                { kind: 'band', upper: line((p) => p.upper), lower: line((p) => p.lower), fill: true },
                { kind: 'path', points: line((p) => p.mid) },
                { kind: 'tag', axis: 'price', value: last.mid },
            ];
        },
        timeExtent: (d) => (d.anchors[0] ? { min: d.anchors[0].time, max: Infinity } : null),
        priceRange: (d) => {
            const pts = d.state ?? [];
            return pts.length ? { min: Math.min(...pts.map((p) => p.lower)), max: Math.max(...pts.map((p) => p.upper)) } : null;
        },
        // The value an alert would watch: the VWAP at (or just before) a time.
        valueAt: (time, d) => {
            const pts = d.state ?? [];
            let at: VwapPoint | undefined;
            for (const p of pts) {
                if (p.time > time) break;
                at = p;
            }
            return at ? at.mid : null;
        },
        readout: (d) => {
            const last = d.state?.[d.state.length - 1];
            return last ? [{ key: 'vwap', label: 'VWAP', value: last.mid.toFixed(2), color: d.style.lineColor }] : [];
        },
    });
}

interface Level {
    ratio: number;
    color: string;
    enabled: boolean;
}

/** A retracement: levels edited in the settings, each one a part with its own hover and tip. */
function retracement(): void {
    defineDrawing<{ levels: Level[]; extend: boolean }>({
        type: 'playground.retracement',
        label: 'Retracement',
        group: GROUP,
        style: { lineColor: '#787b86', lineWidth: 1 },
        levels: true,
        props: {
            extend: false,
            levels: [
                { ratio: 0, color: '#787b86', enabled: true },
                { ratio: 0.382, color: GREEN, enabled: true },
                { ratio: 0.5, color: AMBER, enabled: true },
                { ratio: 0.618, color: BLUE, enabled: true },
                { ratio: 1, color: '#787b86', enabled: true },
            ],
        },
        settings: [...LINE_FIELDS, { path: 'props.extend', label: 'Extend right', kind: 'boolean' }],
        shapes: (c) => {
            const [a, b] = c.anchors;
            if (!a || !b) return [];
            const x0 = c.x(Math.min(a.time, b.time));
            const x1 = c.props.extend ? c.width : c.x(Math.max(a.time, b.time));
            const out: DrawingShape[] = [{ kind: 'line', from: c.point(a), to: c.point(b), stroke: { dash: 'dashed' }, hit: false }];
            c.props.levels.forEach((level, i) => {
                if (!level.enabled) return;
                const price = b.price + (a.price - b.price) * level.ratio;
                const y = c.y(price);
                const part = `level-${i}`;
                const hot = c.view.part === part;
                out.push({ kind: 'line', from: [x0, y], to: [x1, y], stroke: { color: level.color, width: hot ? 3 : undefined }, part, tip: `${level.ratio} at ${c.price(price)}` });
                out.push({ kind: 'text', at: [x0 - 6, y], text: `${level.ratio}`, color: level.color, size: 'small', align: 'right', baseline: 'middle', hit: false });
                // The hovered level names its price on the axis.
                if (hot) out.push({ kind: 'tag', axis: 'price', value: price, color: level.color });
            });
            return out;
        },
        // The levels are what another drawing would want to snap to.
        snapTargets: (d) => {
            const [a, b] = d.anchors;
            return a && b ? d.props.levels.filter((l) => l.enabled).map((l) => ({ price: b.price + (a.price - b.price) * l.ratio })) : [];
        },
    });
}

interface Fit {
    from: number;
    to: number;
    start: number;
    end: number;
    dev: number;
    r2: number;
}

function fit(bars: ReadonlyArray<ShapeBar>): Fit | null {
    const n = bars.length;
    if (n < 2) return null;
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    bars.forEach((b, i) => {
        sx += i;
        sy += b.close;
        sxy += i * b.close;
        sxx += i * i;
    });
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    let res = 0;
    let tot = 0;
    bars.forEach((b, i) => {
        res += (b.close - (intercept + slope * i)) ** 2;
        tot += (b.close - sy / n) ** 2;
    });
    return { from: bars[0]!.time, to: bars[n - 1]!.time, start: intercept, end: intercept + slope * (n - 1), dev: Math.sqrt(res / n), r2: tot > 0 ? 1 - res / tot : 0 };
}

/** A regression channel between two times: a fit of the closes, two bands and its R². */
function regression(): void {
    defineDrawing<{ deviations: number }, Fit | null>({
        type: 'playground.regression',
        label: 'Regression Channel',
        group: GROUP,
        anchors: [{ role: 'from', free: 'x', hint: 'Click the first bar' }, { role: 'to', free: 'x', hint: 'Click the last bar' }],
        style: { lineColor: '#787b86', lineWidth: 1 },
        props: { deviations: 2 },
        settings: [...LINE_FIELDS, { path: 'props.deviations', label: 'Deviations', kind: 'number', min: 0.5, max: 4, step: 0.5 }, { path: 'results.r2', label: 'R²', kind: 'readout' }],
        compute: (c) => {
            const [a, b] = c.anchors;
            return a && b ? fit(c.bars(Math.min(a.time, b.time), Math.max(a.time, b.time))) : null;
        },
        shapes: (c) => {
            const f = c.state;
            if (!f) return c.points.length === 2 ? [{ kind: 'line', from: c.points[0]!, to: c.points[1]!, stroke: { dash: 'dashed' } }] : [];
            const off = f.dev * c.props.deviations;
            const at = (time: number, price: number): ShapePoint => [c.x(time), c.y(price)];
            const mid: [ShapePoint, ShapePoint] = [at(f.from, f.start), at(f.to, f.end)];
            const up: [ShapePoint, ShapePoint] = [at(f.from, f.start + off), at(f.to, f.end + off)];
            const down: [ShapePoint, ShapePoint] = [at(f.from, f.start - off), at(f.to, f.end - off)];
            return [
                { kind: 'path', points: [mid[0], mid[1], up[1], up[0]], closed: true, fill: `${GREEN}22`, stroke: null },
                { kind: 'path', points: [mid[0], mid[1], down[1], down[0]], closed: true, fill: `${RED}22`, stroke: null },
                { kind: 'line', from: up[0], to: up[1], stroke: GREEN },
                { kind: 'line', from: down[0], to: down[1], stroke: RED },
                { kind: 'line', from: mid[0], to: mid[1], stroke: { dash: 'dashed' } },
                { kind: 'text', at: [mid[1][0] + 6, mid[1][1]], text: `R² ${Math.round(f.r2 * 100)}%`, size: 'small', baseline: 'middle', plate: true, color: 'auto' },
            ];
        },
        valueAt: (time, d) => {
            const f = d.state;
            return f && time >= f.from && time <= f.to && f.to > f.from ? f.start + ((f.end - f.start) * (time - f.from)) / (f.to - f.from) : null;
        },
        readout: (d) => (d.state ? [{ key: 'r2', label: 'R²', value: `${Math.round(d.state.r2 * 100)}%` }] : []),
    });
}

/** A zone that runs to the right edge: its fill sits under the candles, its label over them. */
function zone(): void {
    defineDrawing({
        type: 'playground.zone',
        label: 'Zone',
        group: GROUP,
        placement: 'drag',
        style: { lineColor: RED, lineWidth: 1, fillColor: `${RED}55` },
        props: { label: 'Supply' },
        settings: [...BORDER_FIELDS, ...FILL_FIELDS, { path: 'props.label', label: 'Label', kind: 'text' }],
        shapes: (c) => {
            const [a, b] = c.points;
            if (!a || !b) return [];
            const left = Math.min(a[0], b[0]);
            const top = Math.min(a[1], b[1]);
            const fill = c.style.fillColor ?? `${RED}55`;
            return [
                // Fading out toward the right edge.
                { kind: 'rect', from: [left, a[1]], to: [c.width, b[1]], stroke: null, fill: { gradient: { from: [left, 0], to: [c.width, 0], stops: [[0, fill], [1, `${fill.slice(0, 7)}00`]] } } },
                // The part the user dragged: hatched and outlined.
                { kind: 'rect', from: a, to: b, fill: { hatch: { color: `${c.style.lineColor}66`, spacing: 7 } } },
                { kind: 'text', at: [left + 6, top + 6], text: c.props.label, size: 'small', bold: true, plate: { fill: c.style.lineColor, radius: 3 }, color: 'auto', front: true },
            ];
        },
        valueAt: (_time, d) => (d.anchors[0] ? d.anchors[0].price : null),
    });
}

/** A long position: an entry, a stop and a target, the last two dragged by their own handles. */
function position(): void {
    defineDrawing<{ stop: number; target: number }>({
        type: 'playground.position',
        label: 'Long Position',
        group: GROUP,
        anchors: [{ role: 'entry' }, { role: 'end', free: 'x' }],
        placement: 'drag',
        style: { lineColor: '#787b86', lineWidth: 1 },
        props: { stop: 0, target: 0 },
        settings: [
            { path: 'props.target', label: 'Target', kind: 'number', step: 0.01, unit: { base: 'anchors.0.price' } },
            { path: 'props.stop', label: 'Stop', kind: 'number', step: 0.01, unit: { base: 'anchors.0.price' } },
            { path: 'results.rr', label: 'Risk / reward', kind: 'readout' },
        ],
        // The stop and the target start 1% and 2% from the entry the user clicked.
        placed: (d) => {
            const entry = d.anchors[0]?.price ?? 0;
            return { stop: entry * 0.99, target: entry * 1.02 };
        },
        handles: (d) => {
            const end = d.anchors[1]?.time ?? d.anchors[0]?.time ?? 0;
            return [
                { at: { time: end, price: d.props.target }, drag: (pt) => ({ target: pt.price }) },
                { at: { time: end, price: d.props.stop }, drag: (pt) => ({ stop: pt.price }) },
            ];
        },
        shapes: (c) => {
            const [a, b] = c.anchors;
            if (!a || !b) return [];
            const x0 = c.x(a.time);
            const x1 = c.x(b.time);
            const entry = c.y(a.price);
            // Still being dragged out: the levels do not exist yet.
            const target = c.props.target || a.price * 1.02;
            const stop = c.props.stop || a.price * 0.99;
            const rr = (target - a.price) / Math.max(1e-9, a.price - stop);
            const mid = (x0 + x1) / 2;
            return [
                { kind: 'rect', from: [x0, entry], to: [x1, c.y(target)], fill: `${GREEN}33`, stroke: null, part: 'reward' },
                { kind: 'rect', from: [x0, entry], to: [x1, c.y(stop)], fill: `${RED}33`, stroke: null, part: 'risk' },
                { kind: 'line', from: [x0, entry], to: [x1, entry] },
                { kind: 'text', at: [mid, c.y(target) - 4], text: `Target ${c.price(target)}`, size: 'small', align: 'center', baseline: 'bottom', plate: { fill: GREEN }, color: 'auto', avoid: true },
                { kind: 'text', at: [mid, c.y(stop) + 4], text: `Stop ${c.price(stop)}`, size: 'small', align: 'center', plate: { fill: RED }, color: 'auto', avoid: true },
                { kind: 'text', at: [mid, entry], text: `R:R ${rr.toFixed(2)}`, size: 'small', align: 'center', baseline: 'middle', plate: true, color: 'auto', avoid: true },
                { kind: 'tag', axis: 'price', value: target, color: GREEN },
                { kind: 'tag', axis: 'price', value: stop, color: RED },
            ];
        },
        priceRange: (d) => (d.anchors[0] ? { min: Math.min(d.props.stop, d.anchors[0].price), max: Math.max(d.props.target, d.anchors[0].price) } : null),
        readout: (d) => {
            const entry = d.anchors[0]?.price;
            if (entry === undefined) return [];
            return [{ key: 'rr', label: 'Risk / reward', value: ((d.props.target - entry) / Math.max(1e-9, entry - d.props.stop)).toFixed(2) }];
        },
    });
}

interface ProfileRow {
    low: number;
    high: number;
    volume: number;
}

/** Volume by price between two times, as histogram rows. */
function profile(): void {
    defineDrawing<{ rows: number }, ProfileRow[]>({
        type: 'playground.profile',
        label: 'Range Profile',
        group: GROUP,
        anchors: [{ role: 'from', free: 'x' }, { role: 'to', free: 'x' }],
        style: { lineColor: BLUE, lineWidth: 1, fillColor: `${BLUE}66` },
        props: { rows: 24 },
        settings: [...FILL_FIELDS, { path: 'props.rows', label: 'Rows', kind: 'number', min: 4, max: 80, step: 1 }],
        compute: (c) => {
            const [a, b] = c.anchors;
            if (!a || !b) return [];
            const bars = c.bars(Math.min(a.time, b.time), Math.max(a.time, b.time));
            if (bars.length === 0) return [];
            const low = Math.min(...bars.map((x) => x.low));
            const high = Math.max(...bars.map((x) => x.high));
            const step = (high - low) / c.props.rows || 1;
            const rows: ProfileRow[] = Array.from({ length: c.props.rows }, (_, i) => ({ low: low + i * step, high: low + (i + 1) * step, volume: 0 }));
            for (const bar of bars) {
                const first = Math.max(0, Math.min(rows.length - 1, Math.floor((bar.low - low) / step)));
                const last = Math.max(0, Math.min(rows.length - 1, Math.floor((bar.high - low) / step)));
                for (let i = first; i <= last; i += 1) rows[i]!.volume += (bar.volume ?? 1) / (last - first + 1);
            }
            return rows;
        },
        shapes: (c) => {
            const rows = c.state ?? [];
            const [a, b] = c.points;
            if (!a || !b || rows.length === 0) return [];
            const x0 = Math.min(a[0], b[0]);
            const span = Math.abs(b[0] - a[0]);
            const max = Math.max(...rows.map((r) => r.volume)) || 1;
            const poc = rows.reduce((best, r) => (r.volume > best.volume ? r : best), rows[0]!);
            return [
                { kind: 'rect', from: [x0, c.y(rows[rows.length - 1]!.high)], to: [x0 + span, c.y(rows[0]!.low)], stroke: { dash: 'dotted' }, hit: false },
                {
                    kind: 'rows',
                    x: x0,
                    fill: true,
                    rows: rows.map((r) => ({ y: c.y(r.high) + 0.5, h: Math.max(1, c.y(r.low) - c.y(r.high) - 1), w: (span * r.volume) / max, fill: r === poc ? AMBER : undefined })),
                },
                { kind: 'tag', axis: 'price', value: (poc.low + poc.high) / 2, color: AMBER },
            ];
        },
    });
}

/** A five-point pattern: a labelled path with its two triangles filled. */
function pattern(): void {
    const labels = ['X', 'A', 'B', 'C', 'D'];
    defineDrawing({
        type: 'playground.pattern',
        label: 'Five-point Pattern',
        group: GROUP,
        anchors: labels.map((role) => ({ role, hint: `Click point ${role}` })),
        style: { lineColor: BLUE, lineWidth: 2, fillColor: `${BLUE}22` },
        shapes: (c) => {
            const p = c.points;
            const out: DrawingShape[] = [];
            if (p.length >= 3) out.push({ kind: 'path', points: [p[0]!, p[1]!, p[2]!], closed: true, fill: true, stroke: null, hit: false });
            if (p.length >= 5) out.push({ kind: 'path', points: [p[2]!, p[3]!, p[4]!], closed: true, fill: true, stroke: null, hit: false });
            out.push({ kind: 'path', points: p });
            p.forEach((pt, i) => {
                const above = i === 0 || pt[1] < p[i - 1]![1];
                out.push({ kind: 'text', at: [pt[0], pt[1] + (above ? -6 : 6)], text: labels[i]!, bold: true, align: 'center', baseline: above ? 'bottom' : 'top', halo: true, hit: false });
            });
            return out;
        },
    });
}

/** One tool made of two built-in ones: a trend line and the retracement of the same move. */
function trendWithRetracement(): void {
    defineDrawing({
        type: 'playground.trend-fib',
        label: 'Trend + Retracement',
        group: GROUP,
        angleSnap: true,
        shapes: (c) =>
            c.anchors.length < 2
                ? []
                : [
                      { kind: 'drawing', type: 'fibretracement', anchors: c.anchors, part: 'fib' },
                      { kind: 'drawing', type: 'trendline', anchors: c.anchors, style: { lineColor: c.style.lineColor, lineWidth: 2 }, part: 'trend' },
                  ],
    });
}

/** A group kept on the bar before it has a tool, with a command in its menu that makes one:
 *  each run defines another level tool, which joins the group above the command. */
function ownTools(): void {
    registerDrawingGroup({ id: OWN_GROUP, label: 'Your tools', icon: OWN_ICON, showEmpty: true });
    let made = 0;
    registerWidgetAction({
        id: 'playground.createTool',
        target: 'drawings',
        group: OWN_GROUP,
        label: 'Create a tool',
        icon: 'plus',
        run: (ctx) => {
            const n = ++made;
            const color = [BLUE, GREEN, RED, AMBER][(n - 1) % 4]!;
            defineDrawing({
                type: `playground.level${n}`,
                label: `Level ${n}`,
                group: OWN_GROUP,
                anchors: 1,
                shapes: (c) => {
                    const at = c.anchors[0];
                    if (!at) return [];
                    const y = c.y(at.price);
                    return [
                        { kind: 'line', from: [0, y], to: [c.width, y], stroke: { color, width: 2 } },
                        { kind: 'tag', axis: 'price', value: at.price, color },
                    ];
                },
            });
            ctx.chart.drawings.setTool(`playground.level${n}`);
        },
    });
}

/** Register every playground tool, in a toolbar group of their own. Call it before (or after)
 *  the charts are built: a chart's toolbar follows the registry either way. */
export function registerPlaygroundDrawings(): void {
    registerDrawingGroup({ id: GROUP, label: 'Custom tools' });
    spiral();
    anchoredVwap();
    retracement();
    regression();
    zone();
    position();
    profile();
    pattern();
    trendWithRetracement();
    ownTools();
}
