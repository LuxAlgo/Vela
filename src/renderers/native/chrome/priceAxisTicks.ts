import type { PriceAxisTick, PriceAxisTickContext, PriceAxisTicksFn } from '../../../core/options';
import type { CoordinateSystem, PriceScale } from '../core/CoordinateSystem';
import { percentScaleFor, type PaneNode, type SceneGraph } from '../core/SceneGraph';
import { paneAxisTicks } from './ticks';

/** Everything a pane's ticks depend on, plus the ticks computed from it. */
interface TickMemo {
    kind: PaneNode['kind'];
    min: number;
    max: number;
    log: boolean;
    invert: boolean;
    height: number;
    baseline: number | undefined;
    indexed: boolean;
    mintick: number | undefined;
    format: PaneNode['axisFormat'];
    fontSize: number;
    ticks: readonly PriceAxisTick[];
}

/**
 * The ticks of each pane's MASTER price axis — the one source both the gridlines (backdrop)
 * and the axis labels (chrome) read, so they always agree. Without a host function they are
 * the built-in ladder; with one (the `priceAxisTicks` feature) the host's ticks replace it.
 * Host results are memoized per pane on every input they depend on, so the backdrop and the
 * chrome share one call per data frame and a chrome-only repaint (the countdown's second
 * pulse, a mark hover) never calls the host again.
 */
export class PriceAxisTickSource {
    private fn: PriceAxisTicksFn | null = null;
    private memo = new WeakMap<PaneNode, TickMemo>();
    private warned = false;

    /** The host function, or null for the built-in ticks. */
    get hook(): PriceAxisTicksFn | null {
        return this.fn;
    }

    /** Set (or clear) the host function. Drops every memoized result, so setting the same
     *  function again recomputes — how a host refreshes ticks that depend on its own state. */
    setHook(fn: PriceAxisTicksFn | null): void {
        this.fn = fn;
        this.memo = new WeakMap();
    }

    /** The pane's master-scale ticks for this frame. An unscaled pane (`axisFormat: 'none'`)
     *  gets none, and the host is never asked for it. */
    ticksFor(scene: SceneGraph, pane: PaneNode, coords: CoordinateSystem): readonly PriceAxisTick[] {
        const format = pane.axisFormat;
        if (format === 'none') return [];
        const pct = percentScaleFor(scene, pane);
        const height = pane.bounds.height;
        const fn = this.fn;
        if (!fn || !(height > 0)) return paneAxisTicks(pane.scale, height, pct, scene.priceMintick, format);
        const s = pane.scale;
        const m = this.memo.get(pane);
        const fontSize = scene.style.fontSize;
        if (
            m &&
            m.kind === pane.kind &&
            m.min === s.min &&
            m.max === s.max &&
            m.log === !!s.log &&
            m.invert === !!s.invert &&
            m.height === height &&
            m.baseline === pct?.baseline &&
            m.indexed === !!pct?.indexed &&
            m.mintick === scene.priceMintick &&
            m.format === format &&
            m.fontSize === fontSize
        ) {
            return m.ticks;
        }
        const defaults = paneAxisTicks(s, height, pct, scene.priceMintick, format);
        const ticks = this.callHook(fn, scene, pane, coords, defaults, pct?.baseline, pct ? (pct.indexed ? 'indexed' : 'percent') : 'price');
        this.memo.set(pane, {
            kind: pane.kind,
            min: s.min,
            max: s.max,
            log: !!s.log,
            invert: !!s.invert,
            height,
            baseline: pct?.baseline,
            indexed: !!pct?.indexed,
            mintick: scene.priceMintick,
            format,
            fontSize,
            ticks,
        });
        return ticks;
    }

    private callHook(
        fn: PriceAxisTicksFn,
        scene: SceneGraph,
        pane: PaneNode,
        coords: CoordinateSystem,
        defaults: readonly PriceAxisTick[],
        baseline: number | undefined,
        mode: PriceAxisTickContext['mode'],
    ): readonly PriceAxisTick[] {
        // A snapshot: the live scale object is restamped every frame, and a host may keep `priceToY`.
        const scale: PriceScale = { min: pane.scale.min, max: pane.scale.max, log: !!pane.scale.log, invert: !!pane.scale.invert };
        const bounds = { top: 0, height: pane.bounds.height };
        const ctx: PriceAxisTickContext = {
            pane: { id: pane.id, kind: pane.kind },
            min: Math.min(scale.min, scale.max),
            max: Math.max(scale.min, scale.max),
            log: !!scale.log,
            height: bounds.height,
            mode,
            baseline,
            mintick: scene.priceMintick,
            fontSize: scene.style.fontSize,
            priceToY: (price) => coords.priceToY(price, scale, bounds),
            defaults,
        };
        let out: unknown;
        try {
            out = fn(ctx);
        } catch (err) {
            this.warnOnce('threw', err);
            return defaults;
        }
        if (out == null) return defaults;
        if (!Array.isArray(out)) {
            this.warnOnce('returned a non-array', out);
            return defaults;
        }
        const ticks: PriceAxisTick[] = [];
        for (const t of out as unknown[]) {
            if (!t || typeof t !== 'object') continue;
            const { price, label, major } = t as Partial<PriceAxisTick>;
            if (typeof price !== 'number' || !Number.isFinite(price) || typeof label !== 'string') continue;
            ticks.push(typeof major === 'boolean' ? { price, label, major } : { price, label });
        }
        return ticks;
    }

    private warnOnce(what: string, detail: unknown): void {
        if (this.warned) return;
        this.warned = true;
        console.warn(`[vela] the priceAxisTicks function ${what} — the default ticks are used instead.`, detail);
    }
}
