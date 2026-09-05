// Start the source playground first (`npm run playground`), then run this script.
// Override APP_URL for another dev server or OBSCURA_WORKER for a non-default binary.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const worker = spawn(process.env.OBSCURA_WORKER ?? 'obscura-worker', [], {
    env: { ...process.env, OBSCURA_ALLOW_PRIVATE_NETWORK: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
});
const lines = createInterface({ input: worker.stdout });
let pending;

function settle(error, result) {
    if (!pending) return;
    const request = pending;
    pending = undefined;
    clearTimeout(request.timer);
    if (error) request.reject(error);
    else request.resolve(result);
}

lines.on('line', (line) => {
    try {
        const reply = JSON.parse(line);
        settle(reply.ok ? null : new Error(reply.error), reply.result);
    } catch (error) {
        settle(error);
    }
});
worker.on('error', (error) => settle(error));
worker.on('exit', (code, signal) => settle(new Error(`Browser worker exited: ${code ?? signal}`)));

function command(input) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            settle(new Error(`Browser command timed out: ${input.cmd}`));
            worker.kill();
        }, 45_000);
        pending = { resolve, reject, timer };
        worker.stdin.write(`${JSON.stringify(input)}\n`);
    });
}

async function scenario() {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = async (condition, description) => {
        const deadline = Date.now() + 20_000;
        while (!condition()) {
            if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
            await pause(25);
        }
    };
    let assertions = 0;
    const check = (condition, message) => {
        if (!condition) throw new Error(message);
        assertions += 1;
    };
    const paintedPixels = (cell) => [...cell.querySelectorAll('canvas')].reduce((total, canvas) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(canvas).visibility === 'hidden') return total;
        const context = canvas.getContext('2d');
        if (!context) return total;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 16) {
            const red = pixels[i];
            const green = pixels[i + 1];
            const blue = pixels[i + 2];
            const alpha = pixels[i + 3];
            if (alpha && ((green > red * 1.25 && green > blue * 1.1) || (red > green * 1.25 && red > blue * 1.1))) total += 1;
        }
        return total;
    }, 0);
    const backingStoreMatches = (canvas) => {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        // NativeRenderer prefers the browser's device-pixel box when available; its
        // snapped integer size may differ from rect × DPR by at most one device pixel.
        return Math.abs(canvas.width - rect.width * dpr) <= 1
            && Math.abs(canvas.height - rect.height * dpr) <= 1;
    };

    await until(() => window.__ws, 'source workspace');
    const Workspace = window.__ws.constructor;
    window.__ws.destroy();
    const host = document.querySelector('#workspace');
    host.replaceChildren();
    host.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
    const first = Date.UTC(2026, 0, 1);
    const data = Array.from({ length: 120 }, (_, index) => {
        const open = 100 + index * 0.1;
        const close = open + (index % 2 === 0 ? -2 : 2);
        return {
            time: first + index * 60 * 60 * 1000,
            open,
            high: Math.max(open, close) + 1,
            low: Math.min(open, close) - 1,
            close,
            volume: 1000 + index,
        };
    });
    const provider = {
        async getBars(_ticker, _timeframe, range) {
            let bars = data.filter((bar) => (range.from === undefined || bar.time >= range.from)
                && (range.to === undefined || bar.time <= range.to));
            if (range.limit !== undefined) {
                const limit = Math.max(0, Math.floor(range.limit));
                bars = limit === 0 ? [] : bars.slice(-limit);
            }
            return bars.map((bar) => ({ ...bar }));
        },
    };
    const workspace = new Workspace(host, {
        layout: '4',
        symbol: 'fixture:TEST',
        timeframe: '60',
        providers: { fixture: () => provider },
        live: false,
        nativeBackend: 'canvas2d',
        animations: false,
        volume: false,
        statusline: false,
        watermark: false,
    });
    const root = host.querySelector('.vela-workspace');
    root.style.width = '1000px';
    root.style.height = '640px';

    const visibleCells = () => [...root.querySelectorAll('.vela-cell')]
        .filter((cell) => getComputedStyle(cell).visibility !== 'hidden');
    const geometryReady = (expectedCells) => {
        const cells = visibleCells();
        if (cells.length !== expectedCells) return false;
        return cells.every((cell) => {
            const cellRect = cell.getBoundingClientRect();
            const renderer = cell.firstElementChild;
            if (!renderer || cellRect.width <= 100 || cellRect.height <= 100) return false;
            const rendererRect = renderer.getBoundingClientRect();
            if (Math.abs(rendererRect.width - cellRect.width) > 1 || Math.abs(rendererRect.height - cellRect.height) > 1) return false;
            const canvases = [...renderer.querySelectorAll('canvas')];
            return canvases.length > 0 && canvases.every((canvas) => {
                const rect = canvas.getBoundingClientRect();
                return Math.abs(rect.width - cellRect.width) <= 1
                    && Math.abs(rect.height - cellRect.height) <= 1
                    && backingStoreMatches(canvas);
            });
        });
    };
    const geometry = (label, expectedCells) => {
        const cells = visibleCells();
        check(cells.length === expectedCells, `${label}: expected ${expectedCells} visible cells, got ${cells.length}`);
        const heights = [];
        for (const cell of cells) {
            const cellRect = cell.getBoundingClientRect();
            const renderer = cell.firstElementChild;
            const rendererRect = renderer.getBoundingClientRect();
            const canvases = [...renderer.querySelectorAll('canvas')];
            check(cellRect.width > 100 && cellRect.height > 100, `${label}: grid cell has no usable area`);
            check(Math.abs(rendererRect.width - cellRect.width) <= 1, `${label}: renderer width does not fill its cell`);
            check(Math.abs(rendererRect.height - cellRect.height) <= 1, `${label}: renderer height does not fill its cell`);
            check(canvases.length > 0, `${label}: renderer has no canvases`);
            check(canvases.every((canvas) => {
                const rect = canvas.getBoundingClientRect();
                return Math.abs(rect.width - cellRect.width) <= 1 && Math.abs(rect.height - cellRect.height) <= 1;
            }), `${label}: a canvas does not fill its cell`);
            check(canvases.every(backingStoreMatches), `${label}: a canvas backing store does not match its displayed size`);
            heights.push(cellRect.height);
        }
        return heights;
    };
    const painted = async (label) => {
        try {
            await until(() => visibleCells().every((cell) => paintedPixels(cell) > 100), `${label} painted price geometry in every cell`);
        } catch {
            throw new Error(`${label}: painted price pixels by cell: ${visibleCells().map(paintedPixels).join(', ')}`);
        }
        const pixels = visibleCells().map(paintedPixels);
        check(pixels.every((count) => count > 100), `${label}: a cell has no painted price geometry`);
        return pixels;
    };

    await until(() => geometryReady(4), 'initial grid layout');
    const initial = { heights: geometry('initial 2x2 layout', 4), pixels: await painted('initial 2x2 layout') };

    workspace.setLayout('1');
    await until(() => geometryReady(1), 'single-cell layout');
    const single = { heights: geometry('single-cell layout', 1), pixels: await painted('single-cell layout') };

    root.style.width = '860px';
    root.style.height = '520px';
    await until(() => geometryReady(1) && visibleCells()[0].getBoundingClientRect().height < single.heights[0], 'workspace resize');
    const resized = { heights: geometry('resized workspace', 1), pixels: await painted('resized workspace') };

    host.style.display = 'none';
    await until(() => [...root.querySelectorAll('canvas')].every((canvas) => canvas.getBoundingClientRect().height === 0), 'hidden workspace');
    host.style.display = 'block';
    await until(() => geometryReady(1), 'shown workspace');
    const shown = { heights: geometry('shown workspace', 1), pixels: await painted('shown workspace') };

    workspace.setLayout('4');
    await until(() => geometryReady(4), 'restored 2x2 layout');
    const multi = { heights: geometry('restored 2x2 layout', 4), pixels: await painted('restored 2x2 layout') };

    const maximizedId = workspace.cells()[1].id;
    workspace.maximizeCell(maximizedId);
    await until(() => geometryReady(1), 'maximized cell');
    const maximized = { heights: geometry('maximized cell', 1), pixels: await painted('maximized cell') };
    workspace.maximizeCell(null);
    await until(() => geometryReady(4), 'restored maximized cell');
    const restored = { heights: geometry('restored maximized cell', 4), pixels: await painted('restored maximized cell') };

    workspace.destroy();
    check(!host.querySelector('.vela-workspace'), 'workspace destroy left its root mounted');
    return JSON.stringify({ assertions, initial, single, resized, shown, multi, maximized, restored });
}

async function inlineDataScenario() {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = async (condition, description) => {
        const deadline = Date.now() + 20_000;
        while (!condition()) {
            if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
            await pause(25);
        }
    };
    let assertions = 0;
    const check = (condition, message) => {
        if (!condition) throw new Error(message);
        assertions += 1;
    };
    const sameRange = (actual, expected) => actual?.from === expected.from && actual?.to === expected.to;
    const closeOf = (cell) => Number(cell.chart.renderer.dataWindowReadout()?.ohlc?.c?.replaceAll(',', ''));
    const paintedPixels = (cell) => [...cell.host.querySelectorAll('canvas')].reduce((total, canvas) => {
        const context = canvas.getContext('2d');
        if (!context || canvas.width <= 0 || canvas.height <= 0) return total;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 16) {
            const red = pixels[i];
            const green = pixels[i + 1];
            const blue = pixels[i + 2];
            const alpha = pixels[i + 3];
            if (alpha && ((green > red * 1.25 && green > blue * 1.1) || (red > green * 1.25 && red > blue * 1.1))) total += 1;
        }
        return total;
    }, 0);
    const awaitRanges = async (expected, label) => {
        try {
            await until(() => Object.entries(expected).every(([id, range]) => sameRange(workspace.cell(id)?.chart.getVisibleRange(), range)), `${label} visible ranges`);
        } catch {
            const actual = Object.fromEntries(Object.keys(expected).map((id) => [id, workspace.cell(id)?.chart.getVisibleRange()]));
            throw new Error(`${label}: visible ranges ${JSON.stringify(actual)}`);
        }
        for (const [id, range] of Object.entries(expected)) {
            check(sameRange(workspace.cell(id)?.chart.getVisibleRange(), range), `${label}: ${id} lost its visible range`);
        }
    };
    const awaitPainted = async (label) => {
        await until(() => workspace.cells().every((cell) => paintedPixels(cell) > 100), `${label} painted price geometry in every cell`);
        const pixels = Object.fromEntries(workspace.cells().map((cell) => [cell.id, paintedPixels(cell)]));
        check(Object.values(pixels).every((count) => count > 100), `${label}: a cell has no painted price geometry`);
        return pixels;
    };
    const assertDocumentExcludesRuntimeData = (label, expectedOrder) => {
        const state = workspace.getState();
        check(JSON.stringify(state.charts.map((chart) => chart.id)) === JSON.stringify(expectedOrder), `${label}: state lost dormant cell identities`);
        check(!Object.hasOwn(state, 'data') && !Object.hasOwn(state, 'visibleRange') && !Object.hasOwn(state, 'offline'), `${label}: workspace state leaked runtime market data`);
        check(state.charts.every((chart) => !Object.hasOwn(chart, 'data')), `${label}: chart state persisted inline bars`);
        check(state.charts.every((chart) => !Object.hasOwn(chart, 'visibleRange')), `${label}: chart state persisted a boot-only visible range`);
        check(state.charts.every((chart) => !Object.hasOwn(chart, 'offline')), `${label}: chart state persisted the runtime offline flag`);
        check(JSON.parse(JSON.stringify(state)).charts.length === expectedOrder.length, `${label}: workspace state is not JSON serializable`);
    };

    const Workspace = window.__ws.constructor;
    const host = document.querySelector('#workspace');
    host.replaceChildren();
    host.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
    const first = Date.UTC(2026, 0, 1);
    const hour = 60 * 60 * 1000;
    const makeBars = (close) => Array.from({ length: 120 }, (_, index) => ({
        time: first + index * hour,
        open: close + (index % 2 === 0 ? 2 : -2),
        high: close + 3,
        low: close - 3,
        close,
        volume: 1000 + index,
    }));
    const specs = [
        { id: 'alpha', symbol: 'fixture:INLINE_ALPHA', close: 111, range: { from: first + 20 * hour, to: first + 60 * hour } },
        { id: 'beta', symbol: 'fixture:INLINE_BETA', close: 222, range: { from: first + 25 * hour, to: first + 65 * hour } },
        { id: 'gamma', symbol: 'fixture:INLINE_GAMMA', close: 333, range: { from: first + 30 * hour, to: first + 70 * hour } },
        { id: 'delta', symbol: 'fixture:INLINE_DELTA', close: 444, range: { from: first + 35 * hour, to: first + 75 * hour } },
    ];
    const providerClose = 909;
    const providerBars = makeBars(providerClose);
    const provider = {
        async getBars(_ticker, _timeframe, range) {
            let bars = providerBars.filter((bar) => (range.from === undefined || bar.time >= range.from)
                && (range.to === undefined || bar.time <= range.to));
            if (range.limit !== undefined) {
                const limit = Math.max(0, Math.floor(range.limit));
                bars = limit === 0 ? [] : bars.slice(-limit);
            }
            return bars.map((bar) => ({ ...bar }));
        },
    };
    const cells = Object.fromEntries(specs.map((spec) => [spec.id, {
        symbol: spec.symbol,
        timeframe: '60',
        data: makeBars(spec.close),
        visibleRange: spec.range,
    }]));
    const workspace = new Workspace(host, {
        layout: '4',
        cells,
        providers: { fixture: () => provider },
        live: false,
        nativeBackend: 'canvas2d',
        animations: false,
        volume: false,
        statusline: false,
        watermark: false,
    });
    const root = host.querySelector('.vela-workspace');
    root.style.width = '1000px';
    root.style.height = '640px';

    await Promise.all(workspace.cells().map((cell) => cell.chart.ready()));
    check(JSON.stringify(workspace.cells().map((cell) => cell.id)) === JSON.stringify(specs.map((spec) => spec.id)), 'inline data: configured cell identity order changed');
    for (const spec of specs) {
        const cell = workspace.cell(spec.id);
        check(cell?.chart.market.symbol === spec.symbol, `inline data: ${spec.id} lost its configured symbol`);
        check(cell?.chart.market.timeframe === '60', `inline data: ${spec.id} lost its configured timeframe`);
        check(cell?.chart.market.offline === true, `inline data: ${spec.id} did not boot offline`);
        check(closeOf(cell) === spec.close, `inline data: ${spec.id} loaded the wrong close`);
    }
    await awaitRanges(Object.fromEntries(specs.map((spec) => [spec.id, spec.range])), 'initial inline data');
    const initialPixels = await awaitPainted('initial inline data');

    const replacementClose = 777;
    const replacementRange = { from: first + 45 * hour, to: first + 85 * hour };
    const beta = workspace.cell('beta');
    await beta.chart.setMarket({ data: makeBars(replacementClose) });
    beta.chart.setVisibleRange(replacementRange);
    await awaitRanges({ beta: replacementRange }, 'replacement inline data');
    check(closeOf(beta) === replacementClose, 'replacement inline data did not paint before pooling');

    const delta = workspace.cell('delta');
    await delta.chart.setMarket({ symbol: 'fixture:PROVIDER' });
    check(delta.chart.market.offline === false, 'provider switch remained offline before pooling');
    check(closeOf(delta) === providerClose, 'provider switch did not paint provider data before pooling');
    const providerRange = delta.chart.getVisibleRange();
    check(providerRange !== null, 'provider switch has no visible range before pooling');
    const rangesBeforePool = Object.fromEntries(workspace.cells().map((cell) => [cell.id, cell.chart.getVisibleRange()]));
    check(['alpha', 'beta', 'delta'].every((id) => rangesBeforePool[id] != null), 'a cell has no visible range before pooling');

    const gammaChart = workspace.cell('gamma').chart;
    workspace.setActiveCell('gamma');
    check(workspace.active.id === 'gamma', 'non-first active identity was not selected');
    workspace.setLayout('1');
    check(workspace.cells().length === 1 && workspace.active.id === 'gamma', 'active identity did not survive the layout shrink');
    check(workspace.active.chart === gammaChart, 'the surviving active chart was rebuilt');
    assertDocumentExcludesRuntimeData('pooled inline data', ['gamma', 'alpha', 'beta', 'delta']);

    workspace.setLayout('4');
    await Promise.all(workspace.cells().map((cell) => cell.chart.ready()));
    const restoredOrder = workspace.cells().map((cell) => cell.id);
    check(JSON.stringify(restoredOrder) === JSON.stringify(['gamma', 'alpha', 'beta', 'delta']), 'restored cells followed positions instead of durable identities');
    const expectedCloses = { gamma: 333, alpha: 111, beta: replacementClose, delta: providerClose };
    for (const [id, close] of Object.entries(expectedCloses)) {
        check(closeOf(workspace.cell(id)) === close, `restored ${id} loaded the wrong close`);
    }
    check(workspace.cell('alpha').chart.market.offline === true, 'restored alpha lost its inline data');
    check(workspace.cell('beta').chart.market.offline === true, 'restored beta lost its replacement inline data');
    check(workspace.cell('gamma').chart.market.offline === true, 'surviving gamma lost its inline data');
    check(workspace.cell('delta').chart.market.offline === false, 'restored delta resurrected configured inline data');
    check(workspace.cell('delta').chart.market.symbol === 'fixture:PROVIDER', 'restored delta lost its provider-backed identity');
    await awaitRanges({ alpha: rangesBeforePool.alpha, beta: rangesBeforePool.beta, delta: providerRange }, 'restored inline data');
    check(workspace.cell('gamma').chart.getVisibleRange() !== null, 'surviving gamma lost its visible range');
    const restoredPixels = await awaitPainted('restored inline data');
    const restoredCloses = Object.fromEntries(restoredOrder.map((id) => [id, closeOf(workspace.cell(id))]));
    assertDocumentExcludesRuntimeData('restored inline data', restoredOrder);

    workspace.destroy();
    check(!host.querySelector('.vela-workspace'), 'inline-data workspace destroy left its root mounted');
    return JSON.stringify({ assertions, restoredOrder, restoredCloses, initialPixels, restoredPixels });
}

try {
    await command({ cmd: 'navigate', url: process.env.APP_URL ?? 'http://127.0.0.1:5190/workspace.html' });
    const expression = `(async () => {
        try {
            const sizing = JSON.parse(await (${scenario.toString()})());
            const inlineData = JSON.parse(await (${inlineDataScenario.toString()})());
            return JSON.stringify({ assertions: sizing.assertions + inlineData.assertions, sizing, inlineData });
        } catch (error) {
            return JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
        }
    })()`;
    const result = JSON.parse(await command({ cmd: 'evaluate', expression }));
    if (!result || typeof result !== 'object') throw new Error('Browser smoke returned no result');
    if (result.error) throw new Error(result.stack ?? result.error);
    if (typeof result.assertions !== 'number' || result.assertions < 1) throw new Error('Browser smoke ran no assertions');
    console.log(JSON.stringify(result, null, 2));
    await command({ cmd: 'shutdown' });
} finally {
    lines.close();
    worker.stdin.end();
    if (worker.exitCode === null) worker.kill();
}
