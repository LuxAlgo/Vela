# Writing a scripting engine

An engine turns source in some language into Vela's neutral indicator model. The core feeds it
bars; it never fetches them. Everything it builds against comes from `@luxalgo/vela/plugin`.

## A complete engine

```ts
import { stableSeriesId, type ExecutionHandlers, type ExecutionRequest, type ExecutionSession, type IndicatorModel, type InputValue, type PreparedScript, type ScriptingEngine } from '@luxalgo/vela/plugin';

// A toy language whose source is a moving-average length, such as "20".
export class AverageEngine implements ScriptingEngine {
    readonly language = 'average';
    readonly capabilities = { streaming: false, visibleRange: false, inputs: true }; // honest: the core trusts them

    async prepare(source: string, instanceId: string): Promise<PreparedScript> {
        const length = Number.parseInt(source.trim(), 10);
        if (!(length >= 1)) throw new Error('The source is a length, such as "20".');
        return {
            language: this.language,
            inputs: [{ key: 'length', title: 'Length', type: 'int', defval: length, min: 1, max: 500 }],
            meta: { title: `Average ${length}`, overlay: true },
            reactsToViewport: false,
            token: { instanceId },         // opaque to the core, read back in execute
        };
    }

    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const { instanceId } = req.prepared.token as { instanceId: string };
        let inputs: Record<string, InputValue> = { ...Object.fromEntries(req.prepared.inputs.map((i) => [i.key, i.defval])), ...req.inputs };
        let complete = req.historyState !== 'backfill'; // a partial history computes wrong values
        let stopped = false;
        const run = () => {
            if (stopped || !complete) return;
            const bars = req.getBars?.() ?? req.bars;
            const length = Number(inputs.length);
            let sum = 0;
            const points = bars.map((b, i) => {
                sum += b.close - (i >= length ? bars[i - length]!.close : 0);
                return { time: b.time, value: i >= length - 1 ? sum / length : null };
            });
            const model: IndicatorModel = {
                id: instanceId,            // the id the core gave prepare
                title: req.prepared.meta.title,
                overlay: true,
                paneHint: 'price',
                series: [{ id: stableSeriesId({ instanceId, kind: 'line', title: 'Average', ordinal: 0 }), title: 'Average', paneId: '', kind: 'line', points, style: { color: '#f59e0b', width: 2, lineStyle: 'solid' } }],
                fills: [],
                backgrounds: [],
                priceLines: [],
                inputs: req.prepared.inputs,
                inputValues: inputs,
            };
            handlers.onModel(model);       // fires on every run: each model is complete
            handlers.onDone?.();
        };
        run();
        return {
            stop: () => { stopped = true; },
            update: (next) => { inputs = { ...inputs, ...next }; run(); },
            setVisibleRange: () => {},
            notifyBars: (reason) => {      // undefined = a tick; 'backfill' = older bars still landing
                if (reason === 'complete') complete = true;
                if (reason !== 'backfill') run();
            },
        };
    }
}

chart.registerEngine('average', new AverageEngine());
chart.addIndicator('20', { language: 'average' });
```

## The contract

- **`prepare` is async and reads no market data.** It parses the source and returns the inputs
  schema, the declaration (`meta`) and an opaque `token`. A thrown error reaches the host as a
  failed `runScript` (`{ ok: false, error }`).
- **`execute` returns its session at once.** Results arrive through `handlers.onModel`, on the
  first run and on every re-run or tick; each model must be complete on its own.
- **The core owns the bars.** Read `req.getBars()` (or the `req.bars` snapshot). A secondary
  symbol or timeframe comes through `req.fetchSeries(symbol, timeframe, range)`, never a fetch
  of your own.
- **Ids are a contract.** `model.id` is the `instanceId` given to `prepare`; every series id
  comes from `stableSeriesId({ instanceId, kind, title, ordinal })`, with `ordinal` counted
  afresh on every run, so a re-run patches values in place instead of remounting.
- **Capabilities are trusted, not checked.** Declare `streaming: true` only if the engine keeps a
  live incremental context; otherwise the core re-runs it statically on each `notifyBars()`.
- **History can arrive in parts.** `req.historyState: 'backfill'` means the bars are a partial
  history; `notifyBars('complete')` comes exactly once when it finishes. A stateful language
  waits for it, as above.
- **`stop()` releases everything**: timers, workers, subscriptions.
- **The default language is fixed when a chart is built**: an engine registered later needs
  `addIndicator(source, { language })`, or the chart's `defaultLanguage` option.

## Multi-selects and section help

Two optional schema fields, for inputs and declaration props (`prepare`'s `props`) alike:

- **`multiple: { separator, locked? }`** on a `string` input with `options` shows the options as
  checkboxes in one dropdown. The value stays one string: the checked options joined by
  `separator` in `options` order, so split it to read it. `locked` options are always checked
  and their checkboxes disabled. Fragments that name no option are dropped.
- **`groupHelp: { text?, url? }`** puts a question-mark mark beside the input's `group` heading:
  `text` is its tooltip, `url` opens in a new tab (`http:` and `https:` only; any other URL is
  not linked). The first input of the group that carries one sets it.

```ts
const scriptExecution: InputSchema = {
    key: 'script_execution', title: 'Script execution', type: 'string', defval: 'On bar close',
    options: ['On bar close', 'On order fill', 'On realtime bar tick'],
    multiple: { separator: ', ', locked: ['On bar close'] }, // checking "On order fill" stores "On bar close, On order fill"
    group: 'Detalization and execution',
    groupHelp: { text: 'When the strategy runs.', url: 'https://example.com/docs/execution' },
};
```

## Shipping it

An engine is its own package: `@luxalgo/vela` as a peer dependency (never bundled, or the SDK's
registries are duplicated), values imported from `@luxalgo/vela/plugin`, and the language
runtime as your own dependency. A worker form spawned from a Blob URL needs `worker-src blob:`
under a Content-Security-Policy; offer a `workerUrl` option for hosts that cannot allow it.
`node_modules/@luxalgo/vela/docs/contributing/adding-an-engine.md` covers live streaming,
context snapshots (`getContext`) and worker transports in depth.
