// The bare playground page: mount the Vela WIDGET (topbar + chart) with the Binance provider
// (public API, no key, no server needed), the main-thread Pine engine, and an inline
// indicator manifest — the OS integration surface exercised end to end.
import { VelaWidget } from '../src/widget';
import { PineWorkerEngine } from '../src';
import { BinanceProvider } from '../src/data/providers/binance';
import { playgroundStorage } from './persistence';

// Worker-path test instrumentation: count real Web Worker spawns so a browser probe
// can PROVE Pine runs off the main thread (window.__workerSpawns >= 1). Temporary,
// while the worker engine's fate in the npm package is being decided.
const RealWorker = window.Worker;
(window as unknown as { __workerSpawns: number }).__workerSpawns = 0;
window.Worker = class extends RealWorker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        (window as unknown as { __workerSpawns: number }).__workerSpawns++;
    }
} as typeof Worker;

// The playground's CUSTOM persistence (shared with the workspace page): with `persist`
// on, the widget saves and restores EVERYTHING through this adapter — prefs, renderer
// config, and user drawings. No `urlState` here — a URL param would win over the
// stored state and mask the system this page is exercising.
const storage = playgroundStorage();

const widget = new VelaWidget('#chart', {
    provider: 'binance',
    symbol: 'BTCUSDT',
    timeframe: '60',
    live: true,
    theme: 'dark',
    persist: true, // key 'vela-widget' → 'vela-play:vela-widget' in devtools
    storage,
    providers: { binance: () => new BinanceProvider() },
    engines: { pine: () => new PineWorkerEngine() },
    indicators: [
        {
            name: 'EMA 20',
            script: `//@version=5
indicator("EMA 20", overlay=true)
plot(ta.ema(close, 20), color=color.orange, linewidth=2)`,
        },
    ],
});

void widget.chart.ready().then(() => console.log('[vela-dev] chart ready'));

// Handy for poking around from the browser console.
(window as unknown as { widget: VelaWidget }).widget = widget;

// ── State surface demo (uncomment to try) ─────────────────────────────────────
// The widget speaks the SAME state triplet and document format as the workspace —
// it is the single-cell case (layout '1', one `c1` cell). `persist` above writes
// exactly this document; the calls below are how a host composes custom flows
// (server snapshots, share links, templates) on top of it.
//
// // READ — one versioned document: market, prefs, renderer config, user drawings,
// // and the indicator ledger. JSON-safe: `JSON.stringify(snapshot)` is the payload.
// const snapshot = widget.getState();
// console.log('[state] widget document:', snapshot);
//
// // EVENT — fires debounced (~500ms) after ANY persistable change (draw a line,
// // switch the symbol, add an indicator…). Re-pull getState() for the fresh doc.
// // Returns an unsubscribe function.
// const offState = widget.on('state:changed', () => {
//     console.log('[state] changed →', widget.getState().cells.c1);
// });
//
// // WRITE — applied IN PLACE: the chart instance survives (the market switches via
// // setMarket), config/drawings/indicators are replaced. Untrusted-safe: malformed
// // fields are dropped by the shared codec, never thrown on.
// setTimeout(() => {
//     const doc = widget.getState();
//     doc.cells.c1!.symbol = 'SOLUSDT'; // retarget the chart…
//     doc.cells.c1!.drawings = { version: 1, drawings: [] }; // …and wipe its drawings
//     widget.applyState(doc);
//     offState();
// }, 5000);


// ── "Code" topbar entry — paste a script, Run it, injected on success (SDK showcase:
// contributed action + kit Dialog + chart.runIndicator; errors surface inline). ──
import { registerWidgetAction, registerIcon, type WidgetContext } from '../src/plugin';
import { Dialog } from '../src/ui';

registerIcon('code', '<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 4.5-4 3.5 4 3.5M10.5 4.5l4 3.5-4 3.5"/></svg>');

// Lazy UI singletons — DOM state only (the edited script survives reopen). The
// WidgetContext is NEVER stored: `run(ctx)` rebinds the Run button's handler on every
// invocation, so the ctx lives in that closure alone and always belongs to the
// invoking widget (the pattern that keeps working in a multi-chart shell).
let codeDialog: Dialog | null = null;
let codeArea: HTMLTextAreaElement | null = null;
let codeStatus: HTMLElement | null = null;
let codeRun: HTMLButtonElement | null = null;

registerWidgetAction({
    id: 'dev.code',
    target: 'topbar',
    label: 'Code',
    icon: 'code',
    run: (ctx) => {
        if (!codeDialog) {
            codeArea = document.createElement('textarea');
            codeArea.value = `//@version=5
indicator("My RSI", overlay=false)
plot(ta.rsi(close, 14), color=color.purple)`;
            codeArea.spellcheck = false;
            codeArea.style.cssText =
                'width:520px;max-width:80vw;height:220px;resize:vertical;background:var(--vela-surface-overlay);color:var(--vela-fg);border:1px solid var(--vela-border-soft);border-radius:var(--vela-radius-md);padding:10px;font:12px/1.5 ui-monospace,Consolas,monospace;outline:none;';
            codeRun = document.createElement('button');
            codeRun.textContent = 'Run';
            codeRun.style.cssText =
                'all:unset;margin-top:8px;padding:6px 18px;border-radius:var(--vela-radius-sm);background:var(--vela-accent);color:#0b0e14;font-weight:600;cursor:pointer;';
            codeStatus = document.createElement('div');
            codeStatus.style.cssText = 'margin-top:8px;min-height:1.3em;font-size:var(--vela-font-size-md);white-space:pre-wrap;';
            codeDialog = new Dialog({
                title: 'Run an indicator',
                host: ctx.host, // first invoker's root hosts the singleton (fine for the one-widget demo)
                closeOnInteractOutside: true,
                content: (body) => body.append(codeArea!, codeRun!, codeStatus!),
            });
        }
        // Rebind per invocation — `ctx` stays in this closure, no module-level context.
        codeRun!.onclick = () => void runCode(ctx);
        codeStatus!.textContent = '';
        codeDialog.show();
        setTimeout(() => codeArea?.focus(), 0);
    },
});

async function runCode(ctx: WidgetContext): Promise<void> {
    if (!codeArea || !codeStatus) return;
    codeStatus.style.color = 'var(--vela-fg-muted)';
    codeStatus.textContent = 'Running…';
    const r = await ctx.chart.runIndicator(codeArea.value);
    if (r.ok) {
        codeStatus.style.color = 'var(--vela-accent)';
        codeStatus.textContent = `✓ ${r.handle!.title || 'Indicator'} added to the chart`;
    } else {
        codeStatus.style.color = 'var(--vela-danger)';
        codeStatus.textContent = `✗ ${r.error!.message}`;
    }
}

widget.refreshActions();

// ── Execution-context listener demo — how host code intercepts Vela's engine context.
// 'context:changed' fires after the initial run and (throttled ~1/s) on live candles;
// pull a read-only snapshot and inspect it. Subscriptions survive symbol/timeframe
// changes — the widget switches markets IN PLACE (setMarket), same chart instance.
void widget.chart.ready().then(() => {
    const chart = widget.chart;
    chart.on('context:changed', ({ id }) => {
        void (async () => {
            const handle = chart.indicators().find((h) => h.id === id);
            const snap = await handle?.context(['plots', 'barIndex']);
            if (!handle || !snap) return;
            const keys = Object.keys(snap.plots);
            const points = Object.values(snap.plots).reduce((n, p) => n + p.length, 0);
            console.log(
                `[vela-ctx] ${handle.title || id} — ${keys.length} plot(s) [${keys.join(', ')}], ` +
                    `${points} points, last bar #${snap.barIndex} (${snap.phase})`,
            );
        })();
    });
});

