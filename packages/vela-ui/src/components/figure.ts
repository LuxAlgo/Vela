// Figure: a value under its label (Net P&L, Win rate), with an optional line under it. Its tone
// colors a gain or a loss; `toneOf` reads one from a signed number.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants, type VariantProps } from '../lib/variants';

export const figureDef = defineComponent({
    name: 'figure',
    parts: ['root', 'label', 'value', 'sub'],
});

export const figureVariants = variants({ tone: ['neutral', 'profit', 'loss'] });

export type FigureTone = (typeof figureVariants.spec.tone)[number];

export interface FigureProps extends VariantProps<typeof figureVariants> {
    label: string;
    /** The figure (default `—`). */
    value?: string;
    /** A line under the figure (a count, a percentage). */
    sub?: string;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface FigureHandle {
    readonly el: HTMLElement;
    /** A new figure, its tone and its line (`null` hides the line). */
    set(value: string, tone?: FigureTone, sub?: string | null): void;
    destroy(): void;
}

/** The tone of a signed figure: a gain, a loss, or neither. */
export function toneOf(n: number): FigureTone {
    return n > 0 ? 'profit' : n < 0 ? 'loss' : 'neutral';
}

const injectStyles = defineStyles(
    'vela-ui-figure',
    css`
        @layer vela.ui {
            [data-slot='figure']:where(:not([hidden])) {
                display: flex;
                flex-direction: column;
                gap: 3px;
                min-width: 0;
            }
            [data-slot='figure-label'] {
                font-size: 11px;
                color: ${t.fg.muted};
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            [data-slot='figure-value'] {
                font-size: 14px;
                font-weight: 600;
                color: ${t.fg.bright};
                font-variant-numeric: tabular-nums;
                white-space: nowrap;

                &:is([data-tone='profit'] > *) {
                    color: ${t.profit};
                }
                &:is([data-tone='loss'] > *) {
                    color: ${t.loss};
                }
            }
            [data-slot='figure-sub'] {
                font-size: 11px;
                color: ${t.fg.muted};
                font-variant-numeric: tabular-nums;
            }
        }
    `,
);

export function createFigure(props: FigureProps): FigureHandle {
    injectStyles(document);
    const value = h('span', { slot: figureDef.slot('value'), text: props.value ?? '—' });
    const sub = h('span', { slot: figureDef.slot('sub'), text: props.sub ?? '' });
    sub.hidden = !props.sub;
    const el = h('div', { className: props.className, slot: figureDef.slot('root'), attrs: figureVariants(props) }, h('span', { slot: figureDef.slot('label'), text: props.label }), value, sub);
    return {
        el,
        set(next, tone = 'neutral', line = null) {
            value.textContent = next;
            el.setAttribute('data-tone', tone);
            sub.textContent = line ?? '';
            sub.hidden = !line;
        },
        destroy: () => el.remove(),
    };
}
