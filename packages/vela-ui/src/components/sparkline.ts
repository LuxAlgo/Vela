// Sparkline: a tiny line of values (a watchlist row's day, an equity curve in a card), in the
// profit tone when it ends at or above where it started (or its baseline) and the loss tone
// below, with an optional soft area under it and a dotted baseline (the previous close).
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { t } from '../lib/t';

export const sparklineDef = defineComponent({
    name: 'sparkline',
    parts: ['root', 'area', 'baseline', 'line'],
    settings: { 'stroke-width': '1.25' },
});

export interface SparklineProps {
    values: readonly number[];
    /** px (default 56 × 20). */
    width?: number;
    height?: number;
    /** A soft area under the line. */
    area?: boolean;
    /** A dotted line at this value; the tone compares the last value with it. */
    baseline?: number | null;
}

export interface SparklineHandle {
    readonly el: SVGSVGElement;
    setValues(values: readonly number[], baseline?: number | null): void;
    destroy(): void;
}

const NS = 'http://www.w3.org/2000/svg';

const injectStyles = defineStyles(
    'vela-ui-sparkline',
    css`
        @layer vela.ui {
            [data-slot='sparkline'] {
                --_ink: ${t.profit};
                overflow: visible;

                &[data-tone='loss'] {
                    --_ink: ${t.loss};
                }
            }
            [data-slot='sparkline-line'] {
                fill: none;
                stroke: var(--_ink);
                stroke-width: ${sparklineDef.vars['stroke-width']};
                stroke-linejoin: round;
            }
            [data-slot='sparkline-area'] {
                fill: color-mix(in srgb, var(--_ink) 14%, transparent);
            }
            [data-slot='sparkline-baseline'] {
                stroke: ${t.fg.faint};
                stroke-dasharray: 1.5 2;
            }
        }
    `,
);

function part(name: string): SVGElement {
    const el = document.createElementNS(NS, name === 'baseline' ? 'line' : 'path');
    el.setAttribute('data-slot', sparklineDef.slot(name as 'area' | 'baseline' | 'line'));
    return el;
}

export function createSparkline(props: SparklineProps): SparklineHandle {
    injectStyles(document);
    const w = props.width ?? 56;
    const ht = props.height ?? 20;
    const el = document.createElementNS(NS, 'svg');
    el.setAttribute('viewBox', `0 0 ${w} ${ht}`);
    el.setAttribute('width', String(w));
    el.setAttribute('height', String(ht));
    el.setAttribute('data-slot', sparklineDef.slot('root'));
    el.setAttribute('aria-hidden', 'true');
    const draw = (values: readonly number[], baseline: number | null): void => {
        el.replaceChildren();
        const pts = values.filter((v) => Number.isFinite(v));
        if (pts.length < 2) return;
        const ref = baseline ?? pts[0]!;
        let lo = Math.min(...pts, baseline ?? Infinity);
        let hi = Math.max(...pts, baseline ?? -Infinity);
        if (hi === lo) {
            hi += 1;
            lo -= 1;
        }
        const y = (v: number): number => 1.5 + (ht - 3) * (1 - (v - lo) / (hi - lo));
        const x = (i: number): number => (i / (pts.length - 1)) * w;
        const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
        el.setAttribute('data-tone', pts[pts.length - 1]! >= ref ? 'profit' : 'loss');
        if (props.area) {
            const area = part('area');
            area.setAttribute('d', `${d}L${w} ${ht}L0 ${ht}Z`);
            el.appendChild(area);
        }
        if (baseline != null) {
            const base = part('baseline');
            const by = y(baseline).toFixed(1);
            for (const [k, v] of [['x1', '0'], ['x2', String(w)], ['y1', by], ['y2', by]]) base.setAttribute(k!, v!);
            el.appendChild(base);
        }
        const line = part('line');
        line.setAttribute('d', d);
        el.appendChild(line);
    };
    draw(props.values, props.baseline ?? null);
    return {
        el,
        setValues: (values, baseline = props.baseline ?? null) => draw(values, baseline),
        destroy: () => el.remove(),
    };
}
