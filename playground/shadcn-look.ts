// A test of the theme config: shadcn's button (every variant and size) and its tabs island,
// from `createTheme` alone. The page defines shadcn's color variables (zinc, dark) on a
// `.shadcn` host; the theme maps the kit's tokens onto them and restyles the parts. Whatever
// it cannot express names a setting or a part the kit is missing.
import { createTheme, css, t } from '@luxalgo/vela-ui';

const VARS = `
.shadcn {
    --background: #09090b;
    --foreground: #fafafa;
    --popover: #18181b;
    --primary: #fafafa;
    --primary-foreground: #18181b;
    --secondary: #27272a;
    --secondary-foreground: #fafafa;
    --muted: #27272a;
    --muted-foreground: #a1a1aa;
    --accent: #27272a;
    --destructive: #dc2626;
    --border: rgba(255, 255, 255, 0.1);
    --input: rgba(255, 255, 255, 0.15);
    --ring: #71717a;
    --radius: 0.625rem;
}`;

if (!document.getElementById('shadcn-vars')) {
    const style = document.createElement('style');
    style.id = 'shadcn-vars';
    style.textContent = VARS;
    document.head.append(style);
}

/** Shadow-xs and shadow-sm. */
const SHADOW_XS = '0 1px 2px 0 rgb(0 0 0 / 0.05)';
const SHADOW_SM = '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)';

export const shadcnTheme = createTheme({
    base: 'dark',
    tokens: {
        bg: 'var(--background)',
        fg: 'var(--foreground)',
        'fg-bright': 'var(--foreground)',
        'fg-muted': 'var(--muted-foreground)',
        surface: 'var(--background)',
        'surface-elev': 'var(--popover)',
        'surface-sunken': 'var(--secondary)',
        border: 'var(--border)',
        'border-strong': 'var(--input)',
        hover: 'var(--accent)',
        active: 'var(--accent)',
        accent: 'var(--primary)',
        'selected-bg': 'var(--primary)',
        'selected-fg': 'var(--primary-foreground)',
        'fg-on-fill': 'var(--primary-foreground)',
        focus: 'var(--ring)',
        // A derived token has no color to compute from when its source is a host variable:
        // the wash is mixed in CSS instead.
        'focus-soft': 'color-mix(in srgb, var(--ring) 50%, transparent)',
        danger: 'var(--destructive)',
        'radius-sm': 'calc(var(--radius) - 4px)',
        'radius-md': 'calc(var(--radius) - 2px)',
        'radius-lg': 'var(--radius)',
    },
    components: {
        button: {
            css: {
                root: css`
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    height: 36px;
                    padding-inline: 16px;
                    border-color: transparent;
                    font-size: 14px;
                    font-weight: 500;
                    box-shadow: ${SHADOW_XS};
                    transition:
                        background 150ms,
                        color 150ms,
                        box-shadow 150ms;
                    &:focus-visible {
                        outline: none;
                        border-color: ${t.focus};
                        box-shadow: 0 0 0 3px ${t.focus.soft};
                    }
                    &:disabled {
                        opacity: 0.5;
                        pointer-events: none;
                    }
                    &[data-size='xs'] {
                        height: 24px;
                        gap: 4px;
                        padding-inline: 8px;
                        font-size: 12px;
                    }
                    &[data-size='sm'] {
                        height: 32px;
                        gap: 6px;
                        padding-inline: 12px;
                        font-size: 14px;
                    }
                    &[data-size='lg'] {
                        height: 40px;
                        padding-inline: 24px;
                    }
                    &[data-size='icon'] {
                        width: 36px;
                        padding: 0;
                    }
                    &[data-size='icon-xs'] {
                        width: 24px;
                        height: 24px;
                        padding: 0;
                    }
                    &[data-size='icon-sm'] {
                        width: 32px;
                        height: 32px;
                        padding: 0;
                    }
                    &[data-size='icon-lg'] {
                        width: 40px;
                        padding: 0;
                    }
                    &[data-variant='default'] {
                        background: var(--primary);
                        color: var(--primary-foreground);
                    }
                    &[data-variant='default']:not(:disabled):hover {
                        background: color-mix(in srgb, var(--primary) 90%, transparent);
                        color: var(--primary-foreground);
                        opacity: 1;
                    }
                    &[data-variant='outline'] {
                        background: color-mix(in srgb, var(--input) 30%, transparent);
                        border-color: var(--input);
                        color: var(--foreground);
                    }
                    &[data-variant='outline']:not(:disabled):hover {
                        background: color-mix(in srgb, var(--input) 50%, transparent);
                        border-color: var(--input);
                    }
                    &[data-variant='secondary'] {
                        background: var(--secondary);
                        color: var(--secondary-foreground);
                    }
                    &[data-variant='secondary']:not(:disabled):hover {
                        background: color-mix(in srgb, var(--secondary) 80%, transparent);
                        border-color: transparent;
                    }
                    &[data-variant='ghost'] {
                        box-shadow: none;
                        color: var(--foreground);
                    }
                    &[data-variant='ghost']:not(:disabled):hover {
                        background: color-mix(in srgb, var(--accent) 50%, transparent);
                    }
                    &[data-variant='destructive'] {
                        background: color-mix(in srgb, var(--destructive) 60%, transparent);
                        color: var(--foreground);
                    }
                    &[data-variant='destructive']:not(:disabled):hover {
                        background: color-mix(in srgb, var(--destructive) 50%, transparent);
                        color: var(--foreground);
                    }
                    &[data-variant='link'] {
                        box-shadow: none;
                        color: var(--primary);
                        padding-inline: 16px;
                    }
                `,
                icon: css`
                    width: 16px;
                    height: 16px;
                `,
            },
        },
        tabs: {
            css: {
                list: css`
                    &[data-variant='default'][data-orientation='horizontal'] {
                        height: 36px;
                        padding: 3px;
                        border-radius: ${t.radius.lg};
                        background: var(--muted);
                        align-items: center;
                    }
                `,
                trigger: css`
                    &[data-variant='default'] {
                        height: calc(100% - 1px);
                        padding: 4px 8px;
                        border: 1px solid transparent;
                        border-radius: ${t.radius.md};
                        font-size: 14px;
                        color: var(--muted-foreground);
                        transition:
                            color 150ms,
                            box-shadow 150ms;
                    }
                    &[data-variant='default'][data-selected] {
                        background: color-mix(in srgb, var(--input) 30%, transparent);
                        border-color: var(--input);
                        color: var(--foreground);
                        box-shadow: ${SHADOW_SM};
                    }
                `,
            },
        },
    },
});
