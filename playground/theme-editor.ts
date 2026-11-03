// The gallery's theme editor: a few choices that re-theme the page live, and the createTheme
// call that makes the same theme, to copy into a project.
import { createButton, createTextField, createToggleGroup, colorField, createTheme, type ThemeInput } from '../src/ui';
import { DARK_THEME } from '../src/core/theme';

const RADII = ['none', 'sm', 'md', 'lg'] as const;

export function themeEditor(apply: (theme: ReturnType<typeof createTheme>) => void): HTMLElement {
    const input: { base: 'dark' | 'light'; accent: string; radius: (typeof RADII)[number]; font: string } = { base: 'dark', accent: '#2962ff', radius: 'md', font: '' };
    const root = document.createElement('div');
    root.className = 'theme-editor';
    const code = document.createElement('pre');
    code.className = 'theme-code';

    const themeInput = (): ThemeInput => ({
        base: input.base,
        accent: input.accent,
        ...(input.radius !== 'md' ? { radius: input.radius } : {}),
        ...(input.font.trim() ? { font: input.font.trim() } : {}),
    });
    const source = (): string => {
        const fields = Object.entries(themeInput()).map(([k, v]) => `    ${k}: '${String(v)}',`);
        return `import { createTheme } from '@luxalgo/vela-ui/theme';\n\nconst theme = createTheme({\n${fields.join('\n')}\n});`;
    };
    const update = (): void => {
        apply(createTheme(themeInput()));
        code.textContent = source();
    };

    const field = (label: string, control: HTMLElement): HTMLElement => {
        const row = document.createElement('div');
        row.className = 'row';
        const name = document.createElement('span');
        name.className = 'label';
        name.textContent = label;
        row.append(name, control);
        return row;
    };

    root.append(
        field(
            'base',
            createToggleGroup({
                size: 'sm',
                label: 'Base',
                items: [
                    { value: 'dark', label: 'Dark' },
                    { value: 'light', label: 'Light' },
                ],
                defaultValue: input.base,
                onValueChange: (v) => {
                    input.base = v === 'light' ? 'light' : 'dark';
                    update();
                },
            }).el,
        ),
        field(
            'accent',
            colorField(
                DARK_THEME,
                () => input.accent,
                (v) => {
                    input.accent = v;
                    update();
                },
                { shape: 'circle' },
            ),
        ),
        field(
            'radius',
            createToggleGroup({
                size: 'sm',
                label: 'Radius',
                items: RADII.map((r) => ({ value: r, label: r })),
                defaultValue: input.radius,
                onValueChange: (v) => {
                    input.radius = (RADII as readonly string[]).includes(v) ? (v as (typeof RADII)[number]) : 'md';
                    update();
                },
            }).el,
        ),
        field(
            'font',
            createTextField({
                size: 'sm',
                fill: false,
                value: input.font,
                onChange: (v) => {
                    input.font = v;
                    update();
                },
            }).el,
        ),
        code,
        field(
            '',
            createButton({
                text: 'Copy',
                variant: 'outline',
                size: 'sm',
                onClick: () => void navigator.clipboard?.writeText(source()),
            }).el,
        ),
    );
    code.textContent = source();
    return root;
}
