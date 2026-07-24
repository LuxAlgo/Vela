# Debugging

Most Vela bugs reduce to one question: **is it the engine or the renderer?** The tooling is built to answer that quickly, then to drill into whichever side is at fault.

## Step 1 — isolate the engine, offline

There is **offline engine-isolation tooling** that runs a script through the scripting engine **in Node, with no renderer at all**, and lets you inspect the **per-plot output** directly. Run the per-plot capture tool against a script file to print the plot output shape and values.

This is the fastest way to split the problem:

- If the per-plot values are already wrong here, the bug is **upstream of the renderer** — in the script, the engine, or the data feeding it. The renderer is exonerated.
- If the per-plot values look correct here but the chart looks wrong, the bug is **in or after the renderer**.

Reach for this before opening a browser. It removes an entire half of the system from suspicion in one run.

## Step 2 — debug in the browser via the playground

When the values are right but the picture is not, debug in the **playground** (`npm run playground`). Two things make this tractable:

- **Deterministic seeded offline data** — runs are reproducible, so a bug shows up the same way every time rather than drifting with live market data.
- **Global handles** — the running chart and its pieces are reachable from the browser console (for example, the live chart and its handle are attached to the `window` object), so you can poke at live state directly.

The playground runs the **source directly** (vite HMR) — `npm run playground` and debug live; original TS shows up in devtools via the dev server's source maps.

## A diagnostic with a sharp edge

The same offline capture tooling carries a diagnostic that **rewrites a few built-ins to constants** before the run (neutralizing symbol, timeframe, and chart built-ins that an offline array run does not populate). It is useful for checking **plot shape** — confirming that a series mounts where and how you expect. It is **not a faithful run**: those values are no longer real. Use it to answer "is the shape/wiring right?", never to judge correctness of output. You reach it through the same per-plot capture tool described in Step 1.

## Capability "lies" — the silent failure mode

The core **trusts the capability flags** each backend declares (engines declare streaming, viewport-awareness, inputs; renderers declare panes, fills, backgrounds, horizontal lines, bar coloring, markers, drawings, tables, per-point color, inputs UI). Nothing re-checks them at runtime.

That means a backend whose declared capabilities do not match its real behavior produces **silent wrong output** — no error, just a chart that is blank, stale, or subtly off. So when something renders **blank or stale**, check these two things first, before anything else:

1. **Capability flags** — does the backend actually do what it claims to do? A renderer that declares it supports something it doesn't, or an engine that claims streaming it doesn't truly stream, fails quietly.
2. **Value-patch vs remount** — is the update arriving on the right path? Live ticks and viewport changes flow as **value patches** to existing elements (matched by stable, content-addressed ids); an input edit is a **structural remount**. A patch landing where a remount was needed (or vice versa) shows up as stale or missing visuals rather than an error.

These two account for most "it renders nothing and throws nothing" reports. Check them before suspecting the data or rewriting logic.

## Putting it together

1. Reproduce with the **seeded offline data** so the bug is deterministic.
2. Run the script through the **offline engine isolation** (the per-plot capture tool, run through the engine in Node) to decide engine-vs-renderer.
3. If it is the renderer, debug in the **playground** with the global handles; use the constants diagnostic only to check **shape**.
4. For blank/stale output, check **capability flags** and **patch-vs-remount** first.

See [testing.md](./testing.md) for the two test tiers and [workflow.md](./workflow.md) for the quality gate.
