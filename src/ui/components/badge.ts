// Badge: a short status label, or a round count. `default` is filled with the selection color,
// `secondary` a neutral tint, `outline` bordered, `destructive` tinted with the danger color,
// `up` and `down` with the market colors.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants, type VariantProps } from '../lib/variants';

export const badgeDef = defineComponent({
    name: 'badge',
    parts: ['root'],
    settings: { radius: '5px' },
});

export const badgeVariants = variants({ variant: ['default', 'secondary', 'outline', 'destructive', 'up', 'down'] });

export type BadgeVariant = (typeof badgeVariants.spec.variant)[number];

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
    text: string;
    /** A round count pill (`3`, `9+`) rather than a label. */
    count?: boolean;
    className?: string;
}

export interface BadgeHandle {
    readonly el: HTMLSpanElement;
    setText(text: string): void;
    setVariant(variant: BadgeVariant): void;
    destroy(): void;
}

export const BADGE_STYLE_ID = 'vela-ui-badge';

export const BADGE_CSS = css`
    @layer vela.ui {
        [data-slot='badge'] {
            align-items: center;
            gap: 4px;
            box-sizing: border-box;
            height: 20px;
            padding: 0 6px;
            border-radius: ${badgeDef.vars.radius};
            border: 1px solid transparent;
            font-size: 12px;
            font-weight: 500;
            line-height: 1;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
            background: ${t.selected.bg};
            color: ${t.selected.fg};

            &:where(:not([hidden])) {
                display: inline-flex;
            }
            &[data-count] {
                min-width: 18px;
                height: 18px;
                padding: 0 5px;
                justify-content: center;
                border-radius: 999px;
                font-size: 11px;
            }
            &[data-variant='secondary'] {
                background: ${t.hover};
                color: ${t.fg.muted};
            }
            &[data-variant='outline'] {
                background: transparent;
                border-color: ${t.border.strong};
                color: ${t.fg};
            }
            &[data-variant='destructive'] {
                background: color-mix(in srgb, ${t.danger} 18%, transparent);
                color: ${t.danger};
            }
            &[data-variant='up'] {
                background: color-mix(in srgb, ${t.up} 18%, transparent);
                color: ${t.up};
            }
            &[data-variant='down'] {
                background: color-mix(in srgb, ${t.down} 18%, transparent);
                color: ${t.down};
            }
        }
    }
`;

const injectStyles = defineStyles(BADGE_STYLE_ID, BADGE_CSS);

class BadgeImpl implements BadgeHandle {
    readonly el: HTMLSpanElement;

    constructor(props: BadgeProps) {
        injectStyles(document);
        this.el = h('span', {
            className: props.className ? `vela-badge ${props.className}` : 'vela-badge',
            slot: badgeDef.slot('root'),
            attrs: badgeVariants(props),
            data: { count: props.count === true },
            text: props.text,
        });
    }

    setText(text: string): void {
        this.el.textContent = text;
    }

    setVariant(variant: BadgeVariant): void {
        this.el.setAttribute('data-variant', variant);
    }

    destroy(): void {}
}

export function createBadge(props: BadgeProps): BadgeHandle {
    return new BadgeImpl(props);
}
