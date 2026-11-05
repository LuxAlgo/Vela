---
name: adding-vela-indicators
description: Puts indicators on Vela charts (@luxalgo/vela) and adds new ones - the 70+ built-in studies (moving averages, RSI, MACD, Bollinger Bands, VWAP…), Pine Script indicators through the @luxalgo/vela-pinets engine, indicators computed in TypeScript and registered with registerNativeIndicator, scripting engines for other languages (the ScriptingEngine port), and new built-in studies contributed to Vela. Use when adding a study or indicator to a Vela chart, running Pine scripts on it, writing a custom indicator, or when an indicator never appears or computes wrong values.
license: Apache-2.0
---

# Adding Vela indicators

| Need | Route |
| --- | --- |
| A standard study | built in: `chart.addNativeIndicator('rsi')`, or the workspace's Indicators menu |
| Pine Script® indicators | the `@luxalgo/vela-pinets` engine |
| An indicator written in TypeScript, shipped with your app | `registerNativeIndicator` |
| Another scripting language | a `ScriptingEngine` |
| A new built-in study for every Vela user | the Vela repository (last section) |

## Built-in studies

```ts
import { getNativeIndicator } from '@luxalgo/vela';

chart.addNativeIndicator('moving-average', { inputs: { maType: 'EMA', length: 50 } });
chart.addNativeIndicator('rsi');
const types = (await chart.availableNativeIndicators()).map((n) => n.type); // every registered type
const keys = getNativeIndicator('moving-average')?.inputsSchema().map((i) => i.key); // its input keys
```

Type ids are kebab-case (`moving-average`, `bollinger-bands`, `macd`, `vwap`, `supertrend`):
an unknown id returns a handle that never mounts, so take ids from `availableNativeIndicators()`
and input keys from `inputsSchema()`. In a `VelaWorkspace`, `ws.chart` is the active chart.

## Pine Script®

Vela ships no engine. Install `@luxalgo/vela-pinets` and its `pinets` peer, in a version whose
peer range includes your Vela version, then:

```ts
import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { PineWorkerEngine } from '@luxalgo/vela-pinets';

// workspace: one engine per chart, off the main thread; the menu lists the manifest's scripts
new VelaWorkspace('#chart', {
    /* … */
    engines: { pine: () => new PineWorkerEngine() },
    indicators: [{ name: 'EMA 20', enabled: true, script: '//@version=5\nindicator("EMA 20", overlay=true)\nplot(ta.ema(close, 20))' }],
});

// bare chart
chart.registerEngine('pine', new PineWorkerEngine());
const ema = chart.addIndicator('//@version=5\nindicator("EMA", overlay=true)\nplot(ta.ema(close, 20))');
ema.on('ready', () => { /* values computed */ });
const result = await chart.runScript(source); // never rejects
if (result.ok && result.run) console.log(result.run.plots); else console.warn(result.error);
```

`registerDefaultEngine('pine', () => new PineWorkerEngine())` (`@luxalgo/vela/plugin`) wires it
into every chart built afterwards. Under a strict Content-Security-Policy the worker needs
`worker-src blob:`, or pass the engine a `workerUrl` you host; `PineEngine` runs in-process
without a worker.

## A native indicator of your own

Computed in TypeScript over the chart's bars, with the same legend, settings, panes and saved
state as the built-in studies, and listed in the workspace's Indicators menu.

```ts
import { registerNativeIndicator, stableSeriesId, type InputValue, type NativeIndicator, type NativeIndicatorContext } from '@luxalgo/vela/plugin';

// The close's z-score against its rolling mean, in a pane of its own.
registerNativeIndicator({
    type: 'acme.zscore',               // namespaced: 'vendor.name'
    title: 'Z-Score',
    paneHint: 'new',                   // 'price' + overlay: true draws over the candles
    overlay: false,
    multiInstance: true,               // users stack several, at different lengths
    waitsForHistory: true,             // each value depends on earlier bars: compute once history is complete
    inputsSchema: () => [{ key: 'length', title: 'Length', type: 'int', defval: 20, min: 2, max: 500 }],
    defaultInputs: () => ({ length: 20 }),
    create: (): NativeIndicator => {
        let ctx: NativeIndicatorContext | null = null;
        let length = 20;
        const read = (inputs: Record<string, InputValue>) => (length = Math.max(2, Number(inputs.length ?? 20)));
        const compute = () => {
            if (!ctx) return;
            const bars = ctx.bars();       // one output point per bar, in this order
            let sum = 0;
            let sumSq = 0;
            const points = bars.map((b, i) => {
                sum += b.close;
                sumSq += b.close * b.close;
                if (i >= length) {
                    sum -= bars[i - length]!.close;
                    sumSq -= bars[i - length]!.close ** 2;
                }
                if (i < length - 1) return { time: b.time, value: null };
                const mean = sum / length;
                const sd = Math.sqrt(Math.max(0, sumSq / length - mean * mean));
                return { time: b.time, value: sd === 0 ? 0 : (b.close - mean) / sd };
            });
            ctx.emit({
                series: [{
                    id: stableSeriesId({ instanceId: 'acme.zscore', kind: 'line', title: 'Z', ordinal: 0 }),
                    title: 'Z',
                    paneId: '',            // the chart routes the pane
                    kind: 'line',
                    points,
                    style: { color: '#2962ff', width: 2, lineStyle: 'solid' },
                }],
                priceLines: [{ id: stableSeriesId({ instanceId: 'acme.zscore', kind: 'hline', title: 'zero', ordinal: 0 }), paneId: '', price: 0, lineStyle: 'dashed', width: 1 }],
            });
        };
        return {
            start: (c, inputs) => { ctx = c; read(inputs); compute(); },
            onBars: compute,               // a tick, older history landing, or a price style change
            onViewport: () => {},
            setInputs: (inputs) => { read(inputs); compute(); },
            suspend: () => {},             // hidden: stop timers and fetches
            resume: compute,
            stop: () => { ctx = null; },
        };
    },
});

chart.addNativeIndicator('acme.zscore', { inputs: { length: 50 } });
```

Register at import time, before charts are built. Series ids come from `stableSeriesId`, so a
recompute updates the plot in place instead of remounting it; pass the type as `instanceId`, as
the built-in studies do, so ids stay the same across reloads (stacked instances are told apart
by their indicator id, `ctx.id`).

## A scripting engine for another language

An engine turns source into the neutral indicator model: `prepare(source)` parses it,
`execute(request, handlers)` runs it over the bars the core hands in and emits models. **Before
writing one, read [references/scripting-engine.md](references/scripting-engine.md)**: a complete
engine to start from, and the rules the core relies on (ids, history arriving in parts,
capabilities). Register it with `chart.registerEngine(language, engine)` and add scripts with
`chart.addIndicator(source, { language })`.


## A new built-in study, in the Vela repository

Built-in studies are specs in `src/core/native-indicators/classics/` (`averages.ts`,
`bands.ts`, `oscillators.ts`, `trend.ts`, `volatility.ts`, `volume.ts`, `overlays.ts`). Copy
the closest one, such as `rsiSpec` in `oscillators.ts`:

1. A `ClassicIndicatorSpec`: `type` (kebab-case), `title` and `shortTitle` as `msg('indicator.<name>.title', 'English')`,
   `overlay`, inputs from the helpers in `shared.ts`, and `compute(bars, inputs)` returning
   `{ plots, bands?, levels? }` built from the helpers in `math.ts`.
2. Add it to its file's spec array; the catalog registers every spec.
3. `npm run i18n:extract` writes the new messages into `src/locales/en.json`.
4. Test its values in `test/classic-indicators.test.ts` against an independent reference,
   never against what the code prints.

## Check your work

1. `chart.indicators()` lists it, and its handle's `ready` event fires.
2. `chart.inspect()` reports its series; values at a few bars match a reference calculation.
3. Change an input in its settings: it recomputes in place (no flicker or duplicate pane).

## Further reading

- `node_modules/@luxalgo/vela/docs/user/scripting-engines.md`: Pine Script®, licensing, CDN use.
- `node_modules/@luxalgo/vela/docs/contributing/adding-an-engine.md`: the engine contract in depth
  (live streaming, history backfill, context snapshots, worker transports).
- `node_modules/@luxalgo/vela/docs/contributing/plugin-sdk.md`: native indicators that paint
  through renderer layers, legend-less natives, `paneAxis`.
