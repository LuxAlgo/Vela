// Donut: a ring split in segments with a figure in its middle (a win rate), and a legend of
// the segments beside it. Each segment names its ink: a token (`t.profit.var`) or a color.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';

export const donutDef = defineComponent({
    name: 'donut',
    parts: ['root', 'ring', 'track', 'segment', 'figure', 'caption', 'legend', 'item', 'swatch', 'label', 'value'],
    settings: { 'swatch-radius': '2px' },
});

export interface DonutSegment {
    value: number;
    label: string;
    /** The segment's ink: a token's `var()` (`t.profit.var`) or a color. */
    color: string;
}

export interface DonutProps {
    segments: readonly DonutSegment[];
    /** The figure in the middle. */
    center: string;
    /** A line under the figure. */
    caption?: string;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface DonutHandle {
    readonly el: HTMLElement;
    set(segments: readonly DonutSegment[], center: string, caption?: string): void;
    destroy(): void;
}

const NS = 'http://www.w3.org/2000/svg';
const R = 42;

const injectStyles = defineStyles(
    'vela-ui-donut',
    css`
        @layer vela.ui {
            [data-slot='donut']:where(:not([hidden])) {
                display: flex;
                align-items: center;
                gap: 16px;
            }
            [data-slot='donut-ring'] {
                flex: none;
            }
            [data-slot='donut-track'] {
                fill: none;
                stroke: ${t.hover};
                stroke-width: 12;
            }
            [data-slot='donut-segment'] {
                fill: none;
                stroke-width: 12;
            }
            [data-slot='donut-figure'] {
                fill: ${t.fg.bright};
                font-size: 17px;
                font-weight: 600;
            }
            [data-slot='donut-caption'] {
                fill: ${t.fg.muted};
                font-size: 10px;
            }
            [data-slot='donut-legend']:where(:not([hidden])) {
                display: flex;
                flex-direction: column;
                gap: 6px;
                min-width: 140px;
                font-size: 12px;
            }
            [data-slot='donut-item']:where(:not([hidden])) {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            [data-slot='donut-swatch'] {
                width: 8px;
                height: 8px;
                border-radius: ${donutDef.vars['swatch-radius']};
            }
            [data-slot='donut-label'] {
                color: ${t.fg.muted};
            }
            [data-slot='donut-value'] {
                margin-inline-start: auto;
                color: ${t.fg.bright};
                font-weight: 600;
                font-variant-numeric: tabular-nums;
            }
        }
    `,
);

function svgPart<K extends 'circle' | 'text' | 'svg'>(tag: K, part: (typeof donutDef.parts)[number], attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const el = document.createElementNS(NS, tag);
    el.setAttribute('data-slot', donutDef.slot(part));
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

export function createDonut(props: DonutProps): DonutHandle {
    injectStyles(document);
    const ring = svgPart('svg', 'ring', { viewBox: '0 0 112 112', width: 112, height: 112, 'aria-hidden': 'true' });
    const legend = h('div', { slot: donutDef.slot('legend') });
    const el = h('div', { className: props.className, slot: donutDef.slot('root') }, ring as unknown as Node, legend);
    const set = (segments: readonly DonutSegment[], center: string, caption?: string): void => {
        const total = segments.reduce((a, s) => a + s.value, 0) || 1;
        const c = 2 * Math.PI * R;
        let offset = 0;
        const rings: SVGElement[] = [svgPart('circle', 'track', { cx: 56, cy: 56, r: R })];
        for (const s of segments) {
            const len = (s.value / total) * c;
            if (len > 0) {
                const seg = svgPart('circle', 'segment', { cx: 56, cy: 56, r: R, 'stroke-dasharray': `${len} ${c - len}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 56 56)' });
                seg.style.stroke = s.color;
                rings.push(seg);
            }
            offset += len;
        }
        const figure = svgPart('text', 'figure', { x: 56, y: caption ? 56 : 60, 'text-anchor': 'middle' });
        figure.textContent = center;
        rings.push(figure);
        if (caption) {
            const cap = svgPart('text', 'caption', { x: 56, y: 73, 'text-anchor': 'middle' });
            cap.textContent = caption;
            rings.push(cap);
        }
        ring.replaceChildren(...rings);
        legend.replaceChildren(
            ...segments.map((s) => {
                const swatch = h('span', { slot: donutDef.slot('swatch') });
                swatch.style.background = s.color;
                return h('div', { slot: donutDef.slot('item') }, swatch, h('span', { slot: donutDef.slot('label'), text: s.label }), h('b', { slot: donutDef.slot('value'), text: String(s.value) }));
            }),
        );
    };
    set(props.segments, props.center, props.caption);
    return { el, set, destroy: () => el.remove() };
}
