import { msg } from '../../i18n/message';
import { BULLISH, BEARISH, NEUTRAL } from '../../palette';
import type { ClassicIndicatorSpec } from './define';
import { num, str } from './define';
import { anchorPlot, centeredOscillator, colorInput, lengthInput, symbolInput, transp } from './shared';
import { alignBars, closes, correlation, fill, logReturns } from './math';

/** Cross-instrument correlation studies. */

const correlationCoefficient: ClassicIndicatorSpec = {
    type: 'correlation-coefficient',
    title: msg('indicator.correlationCoefficient.title', 'Correlation Coefficient'),
    shortTitle: msg('indicator.correlationCoefficient.shortTitle', 'CC'),
    overlay: false,
    inputs: [
        symbolInput('symbol', msg('indicator.correlationCoefficient.symbol', 'Symbol'), '', {
            confirm: true,
            tooltip: msg('indicator.correlationCoefficient.symbol.tooltip', 'Secondary symbol whose closing prices are correlated with the chart symbol.'),
        }),
        lengthInput(20, 'length', msg('indicator.correlationCoefficient.length', 'Length'), 2000, msg('indicator.correlationCoefficient.length.tooltip', 'Number of bars over which the Pearson correlation coefficient is computed.')),
        colorInput(BULLISH, msg('indicator.correlationCoefficient.bullColor', 'Positive'), 'bullColor', msg('indicator.correlationCoefficient.bullColor.tooltip', 'Line and area color while correlation is above zero.')),
        colorInput(BEARISH, msg('indicator.correlationCoefficient.bearColor', 'Negative'), 'bearColor', msg('indicator.correlationCoefficient.bearColor.tooltip', 'Line and area color while correlation is below zero.')),
        colorInput(NEUTRAL, msg('indicator.correlationCoefficient.zeroColor', 'Zero Line'), 'zeroColor', msg('indicator.correlationCoefficient.zeroColor.tooltip', 'Color of the zero reference line.')),
    ],
    externalSymbols: (inputs) => {
        const sym = str(inputs, 'symbol', '').trim();
        return sym ? [sym] : [];
    },
    compute: (bars, inputs, external) => {
        const sym = str(inputs, 'symbol', '').trim();
        let values: number[];
        if (!sym) {
            values = fill(bars.length, Number.NaN);
        } else {
            const other = alignBars(bars, external?.get(sym) ?? []).map((b) => (b ? b.close : Number.NaN));
            values = correlation(closes(bars), other, num(inputs, 'length', 20));
        }
        const bull = str(inputs, 'bullColor', BULLISH);
        const bear = str(inputs, 'bearColor', BEARISH);
        const zeroInk = str(inputs, 'zeroColor', NEUTRAL);
        const inkOf = (x: number): string => (x > 0 ? bull : x < 0 ? bear : NEUTRAL);
        return {
            plots: [
                {
                    key: 'cc',
                    title: msg('indicator.correlationCoefficient.plot.cc', 'Correlation'),
                    values,
                    color: NEUTRAL,
                    width: 1,
                    colors: values.map((x) => (Number.isFinite(x) ? inkOf(x) : null)),
                },
                anchorPlot('baseline', 'Baseline Anchor', values.length, 0),
            ],
            bands: [
                {
                    key: 'area',
                    from: 'cc',
                    to: 'baseline',
                    color: transp(NEUTRAL, 100),
                    colors: values.map((x) => (Number.isFinite(x) ? transp(inkOf(x), 80) : null)),
                },
            ],
            levels: [
                {
                    key: 'zero',
                    price: 0,
                    color: zeroInk,
                    lineStyle: 'dashed',
                    title: msg('indicator.common.level.zero', 'Zero Line'),
                },
            ],
        };
    },
};

const correlationLog: ClassicIndicatorSpec = {
    type: 'correlation-log',
    title: msg('indicator.correlationLog.title', 'Correlation - Log'),
    shortTitle: msg('indicator.correlationLog.shortTitle', 'Correlation - Log'),
    overlay: false,
    inputs: [
        symbolInput('instrument', msg('indicator.correlationLog.instrument', 'Instrument 1'), '', {
            confirm: true,
            tooltip: msg('indicator.correlationLog.instrument.tooltip', 'First symbol whose log returns enter the correlation.'),
        }),
        symbolInput('instrument2', msg('indicator.correlationLog.instrument2', 'Instrument 2'), '', {
            confirm: true,
            tooltip: msg('indicator.correlationLog.instrument2.tooltip', 'Second symbol whose log returns enter the correlation.'),
        }),
        { ...lengthInput(25, 'length', msg('indicator.correlationLog.length', 'Length'), 5000, msg('indicator.correlationLog.length.tooltip', 'Number of bar-to-bar log returns used to compute the Pearson correlation.')), min: 2 },
        colorInput(BULLISH, msg('indicator.correlationLog.bullColor', 'Positive'), 'bullColor', msg('indicator.correlationLog.bullColor.tooltip', 'Line and wash color while correlation is above zero.')),
        colorInput(BEARISH, msg('indicator.correlationLog.bearColor', 'Negative'), 'bearColor', msg('indicator.correlationLog.bearColor.tooltip', 'Line and wash color while correlation is below zero.')),
        colorInput(NEUTRAL, msg('indicator.correlationLog.zeroColor', 'Zero Line'), 'zeroColor', msg('indicator.correlationLog.zeroColor.tooltip', 'Color of the zero reference line.')),
    ],
    externalSymbols: (inputs) => {
        const a = str(inputs, 'instrument', '').trim();
        const b = str(inputs, 'instrument2', '').trim();
        return [a, b].filter(Boolean);
    },
    compute: (bars, inputs, external) => {
        const sym1 = str(inputs, 'instrument', '').trim();
        const sym2 = str(inputs, 'instrument2', '').trim();
        let values: number[];
        if (!sym1 || !sym2) {
            values = fill(bars.length, Number.NaN);
        } else {
            const c1 = alignBars(bars, external?.get(sym1) ?? []).map((b) => (b ? b.close : Number.NaN));
            const c2 = alignBars(bars, external?.get(sym2) ?? []).map((b) => (b ? b.close : Number.NaN));
            values = correlation(logReturns(c1), logReturns(c2), num(inputs, 'length', 25));
        }
        return centeredOscillator({
            key: 'corr',
            title: msg('indicator.correlationLog.plot.corr', 'Correlation'),
            values,
            ink: { bull: str(inputs, 'bullColor', BULLISH), bear: str(inputs, 'bearColor', BEARISH), neutral: NEUTRAL },
            zeroInk: str(inputs, 'zeroColor', NEUTRAL),
        });
    },
};

export const correlationSpecs: ClassicIndicatorSpec[] = [correlationCoefficient, correlationLog];
