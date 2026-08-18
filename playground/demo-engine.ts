/**
 * A tiny scripting engine, written against Vela's public `ScriptingEngine` port.
 *
 * Vela ships NO engine — the port is the product, engines are separate packages
 * (Pine Script: `@luxalgo/vela-pinets`) or host code. This one exists so the
 * playground can exercise the whole indicator path — prepare → inputs schema →
 * execute → model → re-run — WITHOUT any engine dependency, and so
 * `docs/contributing/adding-an-engine.md` has a runnable companion that fits on
 * one screen. It is a demo, not a product: no `request.security`, no streaming
 * context, no drawings.
 *
 * The language, one statement per line:
 *
 *     title    Moving averages          // legend title
 *     overlay  true                     // price pane (false = its own pane)
 *     input    fast = 10                // an int input → the gear dialog
 *     plot     sma(close, fast) "Fast" #f0b90b width=2
 *     plot     rsi(close, 14) "RSI" style=area
 *
 * Comments are `//` — `#` opens a color literal, never a comment.
 *
 * Expressions: `+ - * /` and parentheses over the bar sources
 * (`open high low close volume hl2 hlc3 ohlc4`), numbers, declared inputs, and
 * the functions `sma ema rsi stdev highest lowest abs`. Series and scalars mix
 * freely (a scalar broadcasts over the bars).
 */
import type {
    ScriptingEngine,
    PreparedScript,
    ExecutionRequest,
    ExecutionHandlers,
    ExecutionSession,
    EngineContextSnapshot,
    ContextSelect,
    InputSchema,
    InputValue,
    IndicatorModel,
    LineLikeKind,
    LineLikeSeries,
    OHLCV,
} from '../src/plugin';
import { stableSeriesId, ACCENT, CATEGORICAL } from '../src/plugin';

// ── The parsed program ────────────────────────────────────────────────────────

interface PlotDecl {
    expr: Node;
    title: string;
    color?: string;
    width: number;
    kind: LineLikeKind;
}

interface Program {
    title: string;
    overlay: boolean;
    inputs: InputSchema[];
    plots: PlotDecl[];
}

// ── Expressions ───────────────────────────────────────────────────────────────

type Node =
    | { t: 'num'; v: number }
    | { t: 'ref'; name: string }
    | { t: 'bin'; op: '+' | '-' | '*' | '/'; l: Node; r: Node }
    | { t: 'call'; name: string; args: Node[] };

/** Hand-rolled recursive descent over a single line — small enough to read in one pass. */
class ExprParser {
    private i = 0;
    constructor(private readonly src: string) {}

    /** Parse one expression and STOP; `rest` returns whatever trailed it (the plot modifiers). */
    parse(): Node {
        const n = this.additive();
        return n;
    }
    rest(): string {
        return this.src.slice(this.i).trim();
    }

    private ws(): void {
        while (this.i < this.src.length && /\s/.test(this.src[this.i]!)) this.i += 1;
    }
    private peek(): string {
        this.ws();
        return this.src[this.i] ?? '';
    }
    private eat(ch: string): boolean {
        if (this.peek() === ch) {
            this.i += 1;
            return true;
        }
        return false;
    }

    private additive(): Node {
        let l = this.multiplicative();
        for (;;) {
            const c = this.peek();
            if (c !== '+' && c !== '-') return l;
            this.i += 1;
            l = { t: 'bin', op: c, l, r: this.multiplicative() };
        }
    }
    private multiplicative(): Node {
        let l = this.unary();
        for (;;) {
            const c = this.peek();
            if (c !== '*' && c !== '/') return l;
            this.i += 1;
            l = { t: 'bin', op: c, l, r: this.unary() };
        }
    }
    private unary(): Node {
        if (this.eat('-')) return { t: 'bin', op: '-', l: { t: 'num', v: 0 }, r: this.unary() };
        return this.primary();
    }
    private primary(): Node {
        if (this.eat('(')) {
            const n = this.additive();
            if (!this.eat(')')) throw new Error('missing ")"');
            return n;
        }
        this.ws();
        const num = /^\d+(\.\d+)?/.exec(this.src.slice(this.i));
        if (num) {
            this.i += num[0].length;
            return { t: 'num', v: Number(num[0]) };
        }
        const id = /^[A-Za-z_]\w*/.exec(this.src.slice(this.i));
        if (!id) throw new Error(`unexpected "${this.src.slice(this.i, this.i + 12)}"`);
        this.i += id[0].length;
        if (!this.eat('(')) return { t: 'ref', name: id[0] };
        const args: Node[] = [];
        if (!this.eat(')')) {
            do args.push(this.additive());
            while (this.eat(','));
            if (!this.eat(')')) throw new Error(`missing ")" after ${id[0]}(`);
        }
        return { t: 'call', name: id[0], args };
    }
}

// ── Parsing a program ─────────────────────────────────────────────────────────

const KINDS: readonly string[] = ['line', 'area', 'step', 'histogram', 'columns', 'circles', 'cross'];

function parseProgram(source: string): Program {
    const prog: Program = { title: 'Demo', overlay: true, inputs: [], plots: [] };
    for (const raw of source.split('\n')) {
        // `//` comments, NOT `#` — `#rrggbb` is a color literal and must survive.
        const line = raw.replace(/(^|\s)\/\/.*$/, '').trim();
        if (!line) continue;
        const [head, ...tailWords] = line.split(/\s+/);
        const tail = line.slice(head!.length).trim();
        switch (head) {
            case 'title':
                prog.title = tail || prog.title;
                break;
            case 'overlay':
                prog.overlay = tail !== 'false';
                break;
            case 'input': {
                // A bar-source default (`input source = close`) declares a dropdown over
                // the sources; anything else must be numeric.
                const src = /^(\w+)\s*=\s*([a-z]\w*)$/.exec(tail);
                if (src && src[2]! in SOURCES) {
                    prog.inputs.push({
                        key: src[1]!,
                        title: src[1]!,
                        type: 'string',
                        defval: src[2]!,
                        options: Object.keys(SOURCES),
                    });
                    break;
                }
                const m = /^(\w+)\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(tail);
                if (!m) throw new Error(`bad input declaration: "${line}" (expected: input name = number|source)`);
                const defval = Number(m[2]);
                prog.inputs.push({
                    key: m[1]!,
                    title: m[1]!,
                    type: Number.isInteger(defval) ? 'int' : 'float',
                    defval,
                    min: 1,
                });
                break;
            }
            case 'plot': {
                const p = new ExprParser(tail);
                const expr = p.parse();
                const mods = p.rest();
                const titleMatch = /"([^"]*)"/.exec(mods);
                const colorMatch = /#[0-9a-fA-F]{3,8}\b/.exec(mods);
                const widthMatch = /\bwidth\s*=\s*(\d+)/.exec(mods);
                const styleMatch = /\bstyle\s*=\s*(\w+)/.exec(mods);
                const kind = styleMatch?.[1];
                if (kind && !KINDS.includes(kind)) throw new Error(`unknown style "${kind}" (${KINDS.join(', ')})`);
                prog.plots.push({
                    expr,
                    title: titleMatch?.[1] ?? `plot ${prog.plots.length + 1}`,
                    color: colorMatch?.[0],
                    width: widthMatch ? Number(widthMatch[1]) : 2,
                    kind: (kind as LineLikeKind | undefined) ?? 'line',
                });
                break;
            }
            default:
                throw new Error(`unknown statement "${head}" (title, overlay, input, plot) — ${tailWords.length ? line : head}`);
        }
    }
    if (!prog.plots.length) throw new Error('the script plots nothing — add at least one `plot <expression>` line');
    return prog;
}

// ── Evaluation ────────────────────────────────────────────────────────────────

type Value = number | Array<number | null>;

const SOURCES: Record<string, (b: OHLCV) => number> = {
    open: (b) => b.open,
    high: (b) => b.high,
    low: (b) => b.low,
    close: (b) => b.close,
    volume: (b) => b.volume ?? 0,
    hl2: (b) => (b.high + b.low) / 2,
    hlc3: (b) => (b.high + b.low + b.close) / 3,
    ohlc4: (b) => (b.open + b.high + b.low + b.close) / 4,
};

const at = (v: Value, i: number): number | null => (typeof v === 'number' ? v : (v[i] ?? null));
const len = (n: Value): number => Math.max(1, Math.round(typeof n === 'number' ? n : (n[n.length - 1] ?? 1) ?? 1));

/** Rolling window helper: `f(window)` over the last `n` finite values, null until full. */
function rolling(src: Value, n: number, count: number, f: (w: number[]) => number): Array<number | null> {
    const out: Array<number | null> = [];
    const w: number[] = [];
    for (let i = 0; i < count; i += 1) {
        const v = at(src, i);
        w.push(typeof v === 'number' && Number.isFinite(v) ? v : NaN);
        if (w.length > n) w.shift();
        out.push(w.length < n || w.some(Number.isNaN) ? null : f(w));
    }
    return out;
}

function evaluate(node: Node, bars: OHLCV[], inputs: Record<string, InputValue>): Value {
    const count = bars.length;
    switch (node.t) {
        case 'num':
            return node.v;
        case 'ref': {
            const src = SOURCES[node.name];
            if (src) return bars.map(src);
            const iv = inputs[node.name];
            if (typeof iv === 'number') return iv;
            if (typeof iv === 'string' && SOURCES[iv]) return bars.map(SOURCES[iv]!);
            throw new Error(`unknown name "${node.name}"`);
        }
        case 'bin': {
            const l = evaluate(node.l, bars, inputs);
            const r = evaluate(node.r, bars, inputs);
            const apply = (a: number, b: number): number => (node.op === '+' ? a + b : node.op === '-' ? a - b : node.op === '*' ? a * b : a / b);
            if (typeof l === 'number' && typeof r === 'number') return apply(l, r);
            const out: Array<number | null> = [];
            for (let i = 0; i < count; i += 1) {
                const a = at(l, i);
                const b = at(r, i);
                out.push(a == null || b == null ? null : apply(a, b));
            }
            return out;
        }
        case 'call': {
            const args = node.args.map((a) => evaluate(a, bars, inputs));
            const [x, n] = args;
            switch (node.name) {
                case 'abs':
                    return typeof x === 'number' ? Math.abs(x) : (x ?? []).map((v) => (v == null ? null : Math.abs(v)));
                case 'sma':
                    return rolling(x ?? 0, len(n ?? 1), count, (w) => w.reduce((s, v) => s + v, 0) / w.length);
                case 'highest':
                    return rolling(x ?? 0, len(n ?? 1), count, (w) => Math.max(...w));
                case 'lowest':
                    return rolling(x ?? 0, len(n ?? 1), count, (w) => Math.min(...w));
                case 'stdev':
                    return rolling(x ?? 0, len(n ?? 1), count, (w) => {
                        const m = w.reduce((s, v) => s + v, 0) / w.length;
                        return Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / w.length);
                    });
                case 'ema': {
                    const p = len(n ?? 1);
                    const k = 2 / (p + 1);
                    const out: Array<number | null> = [];
                    let prev: number | null = null;
                    for (let i = 0; i < count; i += 1) {
                        const v = at(x ?? 0, i);
                        if (v == null || !Number.isFinite(v)) {
                            out.push(prev);
                            continue;
                        }
                        prev = prev == null ? v : v * k + prev * (1 - k);
                        out.push(i < p - 1 ? null : prev);
                    }
                    return out;
                }
                case 'rsi': {
                    const p = len(n ?? 1);
                    const out: Array<number | null> = [];
                    let avgGain = 0;
                    let avgLoss = 0;
                    let prevV: number | null = null;
                    for (let i = 0; i < count; i += 1) {
                        const v = at(x ?? 0, i);
                        if (v == null || prevV == null) {
                            out.push(null);
                            prevV = v;
                            continue;
                        }
                        const d = v - prevV;
                        prevV = v;
                        const gain = Math.max(d, 0);
                        const loss = Math.max(-d, 0);
                        avgGain = i <= p ? (avgGain * (i - 1) + gain) / Math.max(1, i) : (avgGain * (p - 1) + gain) / p;
                        avgLoss = i <= p ? (avgLoss * (i - 1) + loss) / Math.max(1, i) : (avgLoss * (p - 1) + loss) / p;
                        out.push(i < p ? null : avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
                    }
                    return out;
                }
                default:
                    throw new Error(`unknown function "${node.name}()"`);
            }
        }
    }
}

// ── The engine ────────────────────────────────────────────────────────────────

export class DemoEngine implements ScriptingEngine {
    readonly language = 'demo';
    // Honest capabilities: no incremental streaming context (the orchestrator will run
    // this one statically and poke `notifyBars`), no viewport built-ins, but a real
    // inputs schema so the gear dialog works.
    readonly capabilities = { streaming: false, visibleRange: false, inputs: true };

    prepare(source: string, _instanceId: string): Promise<PreparedScript> {
        const program = parseProgram(source);
        return Promise.resolve({
            language: this.language,
            inputs: program.inputs,
            meta: { title: program.title, overlay: program.overlay },
            reactsToViewport: false,
            token: program,
        });
    }

    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const program = req.prepared.token as Program;
        const instanceId = req.prepared.meta.title;
        const values: Record<string, InputValue> = { ...Object.fromEntries(program.inputs.map((i) => [i.key, i.defval])), ...req.inputs };
        let snapshot: EngineContextSnapshot | null = null;
        let stopped = false;

        const run = (): void => {
            if (stopped) return;
            const bars = req.getBars?.() ?? req.bars;
            try {
                const series: LineLikeSeries[] = program.plots.map((p, ordinal) => {
                    const v = evaluate(p.expr, bars, values);
                    return {
                        // The identity contract: content-addressed, stable across re-runs —
                        // value patches and persisted per-series state are keyed by this.
                        id: stableSeriesId({ instanceId, kind: p.kind, title: p.title, ordinal }),
                        title: p.title,
                        paneId: '', // filled in by the orchestrator when it routes the pane
                        kind: p.kind,
                        points: bars.map((b, i) => ({ time: b.time, value: at(v, i) })),
                        style: { color: p.color ?? CATEGORICAL[ordinal % CATEGORICAL.length] ?? ACCENT, width: p.width, lineStyle: 'solid' },
                    };
                });
                const model: IndicatorModel = {
                    id: instanceId,
                    title: program.title,
                    overlay: program.overlay,
                    paneHint: program.overlay ? 'price' : 'new',
                    series,
                    fills: [],
                    backgrounds: [],
                    priceLines: [],
                    inputs: program.inputs,
                    inputValues: values,
                };
                snapshot = {
                    language: this.language,
                    phase: 'idle',
                    barIndex: bars.length - 1,
                    meta: { title: program.title, overlay: program.overlay },
                    plots: Object.fromEntries(series.map((s) => [s.title, s.points.map((p) => ({ time: p.time, value: p.value }))])),
                    variables: { ...values },
                    result: null,
                    warnings: [],
                };
                handlers.onModel(model);
                handlers.onDone?.();
            } catch (e) {
                handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
            }
        };

        run();

        return {
            getContext: (select?: ContextSelect) => {
                if (!snapshot || !select) return Promise.resolve(snapshot);
                const picked = Object.fromEntries(select.map((k) => [k, snapshot![k]]));
                return Promise.resolve({ ...snapshot, ...picked });
            },
            stop: () => {
                stopped = true;
            },
            update: (next) => {
                Object.assign(values, next);
                run();
            },
            setVisibleRange: () => {},
            notifyBars: (reason) => {
                // Skip the mid-backfill churn; run once history is whole, and on every tick.
                if (reason !== 'backfill') run();
            },
        };
    }
}

/** The scripts the playground offers in its indicator manifest / Code dialog. */
export const DEMO_SCRIPTS = {
    ema: `title    EMA 20
overlay  true
input    length = 20
input    source = close
plot     ema(source, length) "EMA" #f0b90b width=2`,
    bands: `title    Bollinger Bands
overlay  true
input    length = 20
input    mult = 2
plot     sma(close, length) "Basis" #2962ff
plot     sma(close, length) + mult * stdev(close, length) "Upper" #787b86
plot     sma(close, length) - mult * stdev(close, length) "Lower" #787b86`,
    rsi: `title    RSI 14
overlay  false
input    length = 14
plot     rsi(close, length) "RSI" #7e57c2 width=2`,
};
