import type { InputSchema } from '../../model/inputs';
import type { OHLCV } from '../../model/ohlcv';
import type { FillGradientStop } from '../../model/scene';
import type { LineStyle } from '../../model/series';
import { BULLISH, BEARISH, INFO, NEUTRAL } from '../../palette';
import type { ClassicBand, ClassicLevel, ClassicPlot } from './define';
import { SOURCES } from './math';

/** Input-schema builders and small color utilities shared by the catalog families. */

/** The two settings sections every classic splits its inputs into. */
export const SETTINGS = 'Settings';
export const STYLE = 'Style';

export function lengthInput(defval: number, key = 'length', title = 'Length', max = 5000, tooltip?: string): InputSchema {
    return { key, title, type: 'int', defval, min: 1, max, step: 1, group: SETTINGS, ...(tooltip != null ? { tooltip } : {}) };
}

export function intInput(key: string, title: string, defval: number, min = 1, max = 5000, tooltip?: string): InputSchema {
    return { key, title, type: 'int', defval, min, max, step: 1, group: SETTINGS, ...(tooltip != null ? { tooltip } : {}) };
}

export function floatInput(key: string, title: string, defval: number, min = 0, max = 1000, step = 0.1, tooltip?: string): InputSchema {
    return { key, title, type: 'float', defval, min, max, step, group: SETTINGS, ...(tooltip != null ? { tooltip } : {}) };
}

export function boolInput(key: string, title: string, defval: boolean, group = SETTINGS, tooltip?: string): InputSchema {
    return { key, title, type: 'bool', defval, group, ...(tooltip != null ? { tooltip } : {}) };
}

export function optionInput(key: string, title: string, defval: string, options: readonly string[], tooltip?: string): InputSchema {
    return { key, title, type: 'string', defval, options, group: SETTINGS, ...(tooltip != null ? { tooltip } : {}) };
}

export function sourceInput(defval: string = 'Close', key = 'source', title = 'Source', tooltip?: string): InputSchema {
    return { key, title, type: 'string', defval, options: SOURCES, group: SETTINGS, ...(tooltip != null ? { tooltip } : {}) };
}

export function colorInput(defval: string = INFO, title = 'Color', key = 'color', tooltip?: string): InputSchema {
    return { key, title, type: 'color', defval, group: STYLE, ...(tooltip != null ? { tooltip } : {}) };
}

export function widthInput(defval = 2, key = 'lineWidth', title = 'Line Width'): InputSchema {
    return { key, title, type: 'int', defval, min: 1, max: 5, step: 1, group: STYLE, tooltip: 'Width of the plotted line, in pixels.' };
}

/**
 * Transparency in the reference catalog's scale (0 = opaque, 100 = invisible),
 * applied over a 6-digit hex. The catalog's fills are specified that way, so the
 * specs read as the same numbers the reference does.
 */
export function transp(hex: string, transparency: number): string {
    return withAlpha(hex, (100 - transparency) / 100);
}

/** Soft band tint derived from a line ink (alpha applied over a 6-digit hex). */
export function withAlpha(hex: string, alpha = 0.08): string {
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return hex;
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${m[1]!}${a}`;
}

/** The Bullish / Bearish / Basis trio a directional channel is styled with. */
export function channelStyleInputs(basisTitle = 'Basis'): InputSchema[] {
    return [
        colorInput(BULLISH, 'Bullish', 'bullColor', 'Color of the lower band and of the basis while price holds above it.'),
        colorInput(BEARISH, 'Bearish', 'bearColor', 'Color of the upper band and of the basis while price sits below it.'),
        colorInput(NEUTRAL, basisTitle, 'basisColor', 'Color of the basis line while price sits exactly on it.'),
    ];
}

/**
 * The shared look of a directional channel: a basis that takes price's side, bands
 * tinted by the side they defend, and an interior washing bearish at the top down to
 * bullish at the bottom.
 */
export function directionalChannel(
    bars: readonly OHLCV[],
    basis: readonly number[],
    upper: readonly number[],
    lower: readonly number[],
    ink: { bull: string; bear: string; neutral: string },
    key: string,
): { plots: ClassicPlot[]; bands: ClassicBand[] } {
    const basisColors = basis.map((b, i) => {
        if (!Number.isFinite(b)) return null;
        const c = bars[i]!.close;
        return c > b ? ink.bull : c < b ? ink.bear : ink.neutral;
    });
    const wash = upper.map((u, i) => {
        const l = lower[i]!;
        if (!Number.isFinite(u) || !Number.isFinite(l)) return null;
        return { topValue: u, bottomValue: l, topColor: transp(ink.bear, 90), bottomColor: transp(ink.bull, 90) };
    });
    return {
        plots: [
            { key: 'basis', title: 'Basis', values: [...basis], color: ink.neutral, colors: basisColors },
            { key: 'upper', title: 'Upper', values: [...upper], color: transp(ink.bear, 30) },
            { key: 'lower', title: 'Lower', values: [...lower], color: transp(ink.bull, 30) },
        ],
        bands: [{ key, from: 'upper', to: 'lower', color: transp(NEUTRAL, 90), gradient: wash }],
    };
}

/** A constant-valued series shown nowhere — the anchor a band is filled against. */
export function anchorPlot(key: string, title: string, length: number, level: number): ClassicPlot {
    return {
        key,
        title,
        values: new Array<number>(length).fill(level),
        color: transp(NEUTRAL, 100),
        display: { pane: false, legend: false, dataWindow: false },
    };
}

/**
 * The soft shading a bounded oscillator wears beyond its thresholds: from the
 * overbought level up to the top of the scale, and from the oversold level down to
 * the bottom. Returns the hidden anchors and the two washes to merge into the output.
 */
export function thresholdZones(
    length: number,
    levels: { overbought: number; oversold: number; top: number; bottom: number },
    ink: { overbought: string; oversold: string },
    transparency = 92,
): { plots: ClassicPlot[]; bands: ClassicBand[] } {
    return {
        plots: [
            anchorPlot('obAnchor', 'Overbought Anchor', length, levels.overbought),
            anchorPlot('osAnchor', 'Oversold Anchor', length, levels.oversold),
            anchorPlot('topAnchor', 'Top Anchor', length, levels.top),
            anchorPlot('bottomAnchor', 'Bottom Anchor', length, levels.bottom),
        ],
        bands: [
            { key: 'obZone', from: 'obAnchor', to: 'topAnchor', color: transp(ink.overbought, transparency) },
            { key: 'osZone', from: 'osAnchor', to: 'bottomAnchor', color: transp(ink.oversold, transparency) },
        ],
    };
}

/**
 * Ink along a low → mid → high ramp: `lowInk` at or under `low`, `midInk` at `mid`,
 * `highInk` at or over `high`, blended in between. The reference's bounded-oscillator look.
 */
export function rampColors(
    values: readonly number[],
    levels: { low: number; mid: number; high: number },
    ink: { low: string; mid: string; high: string },
): Array<string | null> {
    return values.map((x) => {
        if (!Number.isFinite(x)) return null;
        return x <= levels.mid ? gradient(x, levels.low, levels.mid, ink.low, ink.mid) : gradient(x, levels.mid, levels.high, ink.mid, ink.high);
    });
}

/**
 * A vertical wash between a series and a flat baseline — opaque at the value, invisible
 * where it meets the baseline. Pair with {@link anchorPlot} for the baseline anchor.
 */
export function baselineGradient(
    values: readonly number[],
    baseline: number,
    inkOf: (value: number, index: number) => string,
    valueTransparency = 50,
    baseTransparency = 100,
): Array<FillGradientStop | null> {
    return values.map((x, i) => {
        if (!Number.isFinite(x)) return null;
        const ink = inkOf(x, i);
        const above = x > baseline;
        return {
            topValue: Math.max(x, baseline),
            bottomValue: Math.min(x, baseline),
            topColor: transp(ink, above ? valueTransparency : baseTransparency),
            bottomColor: transp(ink, above ? baseTransparency : valueTransparency),
        };
    });
}

/**
 * The four-tone momentum histogram: a column is bright while its side of zero is
 * growing and faded once it turns back.
 */
export function momentumColumnColors(values: readonly number[], ink: { growAbove: string; fallAbove: string; growBelow: string; fallBelow: string }): Array<string | null> {
    return values.map((x, i) => {
        if (!Number.isFinite(x)) return null;
        const prev = i > 0 && Number.isFinite(values[i - 1]!) ? values[i - 1]! : x;
        const rising = x > prev;
        if (x >= 0) return rising ? ink.growAbove : ink.fallAbove;
        return rising ? ink.growBelow : ink.fallBelow;
    });
}

export interface BoundedOptions {
    key: string;
    title: string;
    values: number[];
    overbought: number;
    oversold: number;
    scale: { top: number; bottom: number };
    /** Ink at the oversold end, at the midpoint, and at the overbought end of the ramp. */
    ink: { low: string; mid: string; high: string };
    levelInk: string;
    width?: number;
    zoneTransparency?: number;
    /** Dotted guide at a fixed price (the reference's midline). */
    midline?: number;
    /** Wash between the two thresholds (the reference's "band fill"). */
    bandFill?: string;
    /** Vertical wash from the line back to the midpoint of the band. */
    midpointWash?: boolean;
    levelTitles?: { overbought: string; oversold: string };
}

/**
 * The shape every bounded oscillator shares: a line that ramps from the oversold ink
 * through neutral to the overbought ink, dashed threshold levels, and soft shading
 * beyond each threshold out to the edge of the scale.
 */
export function boundedOscillator(opts: BoundedOptions): { plots: ClassicPlot[]; bands: ClassicBand[]; levels: ClassicLevel[] } {
    const mid = (opts.overbought + opts.oversold) / 2;
    const ramp = rampColors(opts.values, { low: opts.oversold, mid, high: opts.overbought }, opts.ink);
    const zones = thresholdZones(
        opts.values.length,
        { overbought: opts.overbought, oversold: opts.oversold, top: opts.scale.top, bottom: opts.scale.bottom },
        { overbought: opts.ink.high, oversold: opts.ink.low },
        opts.zoneTransparency,
    );
    const plots: ClassicPlot[] = [{ key: opts.key, title: opts.title, values: opts.values, color: opts.ink.mid, width: opts.width ?? 1, colors: ramp }, ...zones.plots];
    const bands: ClassicBand[] = [...zones.bands];
    if (opts.bandFill != null) bands.push({ key: 'band', from: 'obAnchor', to: 'osAnchor', color: opts.bandFill });
    if (opts.midpointWash) {
        plots.push(anchorPlot('midAnchor', 'Midpoint Anchor', opts.values.length, mid));
        bands.push({ key: 'wash', from: opts.key, to: 'midAnchor', color: transp(NEUTRAL, 100), gradient: baselineGradient(opts.values, mid, (_x, i) => ramp[i] ?? opts.ink.mid) });
    }
    const levels: ClassicLevel[] = [
        { key: 'overbought', price: opts.overbought, color: opts.levelInk, lineStyle: 'dashed', title: opts.levelTitles?.overbought ?? 'Overbought' },
        { key: 'oversold', price: opts.oversold, color: opts.levelInk, lineStyle: 'dashed', title: opts.levelTitles?.oversold ?? 'Oversold' },
    ];
    if (opts.midline != null) levels.splice(1, 0, { key: 'midline', price: opts.midline, color: opts.levelInk, lineStyle: 'dotted', title: 'Midline' });
    return { plots, bands, levels };
}

export interface CenteredOptions {
    key: string;
    title: string;
    values: number[];
    /** Ink at the value while above / below the baseline, and exactly on it. */
    ink: { bull: string; bear: string; neutral: string };
    zeroInk: string;
    baseline?: number;
    width?: number;
    fill?: boolean;
    valueTransparency?: number;
    zeroLineStyle?: LineStyle;
    zeroTitle?: string;
    extraPlots?: ClassicPlot[];
    extraLevels?: ClassicLevel[];
}

/**
 * The shape every baseline-centred study shares: a line inked by its side of the
 * baseline, washed toward it with a vertical gradient that fades out where the two meet.
 */
export function centeredOscillator(opts: CenteredOptions): { plots: ClassicPlot[]; bands: ClassicBand[]; levels: ClassicLevel[] } {
    const baseline = opts.baseline ?? 0;
    const inkOf = (x: number): string => (x > baseline ? opts.ink.bull : x < baseline ? opts.ink.bear : opts.ink.neutral);
    const plots: ClassicPlot[] = [
        { key: opts.key, title: opts.title, values: opts.values, color: opts.ink.neutral, width: opts.width ?? 1, colors: opts.values.map((x) => (Number.isFinite(x) ? inkOf(x) : null)) },
        ...(opts.extraPlots ?? []),
    ];
    const bands: ClassicBand[] = [];
    if (opts.fill !== false) {
        plots.push(anchorPlot('baseline', 'Baseline Anchor', opts.values.length, baseline));
        bands.push({ key: 'wash', from: opts.key, to: 'baseline', color: transp(NEUTRAL, 100), gradient: baselineGradient(opts.values, baseline, inkOf, opts.valueTransparency) });
    }
    return {
        plots,
        bands,
        levels: [{ key: 'zero', price: baseline, color: opts.zeroInk, lineStyle: opts.zeroLineStyle ?? 'dashed', title: opts.zeroTitle ?? 'Zero Line' }, ...(opts.extraLevels ?? [])],
    };
}

function channels(hex: string): [number, number, number] | null {
    const m = /^#([0-9a-f]{6})/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Blend `from`→`to` by where `value` falls in `[low, high]`, clamped at both ends
 * (a non-finite value or an unparseable ink yields `from`).
 */
export function gradient(value: number, low: number, high: number, from: string, to: string): string {
    const a = channels(from);
    const b = channels(to);
    if (!a || !b || !Number.isFinite(value)) return from;
    const span = high - low;
    const t = span === 0 ? 0 : Math.max(0, Math.min(1, (value - low) / span));
    const mix = (i: number): string =>
        Math.round(a[i]! + (b[i]! - a[i]!) * t)
            .toString(16)
            .padStart(2, '0');
    return `#${mix(0)}${mix(1)}${mix(2)}`;
}
