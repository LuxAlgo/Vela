import { Vela, type VelaDeps } from '../Vela';
import type { MarketConfig, MarketSwitch, VelaOptions } from '../core/options';
import type { OHLCV } from '../core/model/ohlcv';

export type CellRuntimeBoot = Pick<MarketConfig, 'data' | 'visibleRange'>;

const inlineData = new WeakMap<Vela, OHLCV[]>();

/** Tracks host-supplied arrays without exposing them through persisted chart state. */
export class CellChart extends Vela {
    private marketRevision = 0;

    constructor(element: HTMLElement, options: VelaOptions, deps: VelaDeps) {
        super(element, options, deps);
        if (options.data !== undefined) inlineData.set(this, options.data);
    }

    override setMarket(next: MarketSwitch): Promise<void> {
        const revision = ++this.marketRevision;
        const previousData = inlineData.get(this);
        // A synchronous load listener can pool this cell or request another market.
        // Publish the incoming array before delegating, and never overwrite a nested
        // request with this call's array when the delegation returns.
        if (next.data !== undefined) inlineData.set(this, next.data);
        let result: Promise<void>;
        try {
            result = super.setMarket(next);
        } catch (error) {
            if (revision === this.marketRevision) {
                if (previousData !== undefined) inlineData.set(this, previousData);
                else inlineData.delete(this);
            }
            throw error;
        }
        // The public snapshot reflects the accepted request before its load resolves.
        // A same-symbol no-op can leave the chart offline even with a symbol argument.
        if (!this.market.offline) inlineData.delete(this);
        return result;
    }
}

/** Runtime-only inputs for rebuilding a live cell after a layout/backend change. */
export function snapshotCellBoot(chart: Vela): CellRuntimeBoot {
    return {
        data: chart.market.offline ? inlineData.get(chart) : undefined,
        visibleRange: chart.getVisibleRange() ?? undefined,
    };
}
