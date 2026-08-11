// Timeframe drawer (mobile) — the bottom-sheet counterpart of the topbar timeframe menu
// PLUS the desktop bottombar's range chips: date ranges first (horizontally scrollable),
// then the timeframe presets. Selection state is re-read on every open, so it always
// mirrors whatever path last changed the timeframe (quick entry, API, a range chip).
import { Drawer } from '../ui/components/drawer';
import { injectStyles } from '../ui/styles';
import type { RangePreset } from './bottombar';
import { timeframeLabel } from './timeframe';

const STYLE_ID = 'vela-widget-tf-drawer';
const CSS = `
.vela-tfd-heading {
    padding: 4px 2px 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--vela-fg-bright);
}
.vela-tfd-heading + .vela-tfd-ranges,
.vela-tfd-heading + .vela-tfd-grid { padding-top: 0; }
.vela-tfd-ranges {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    /* Sideways-scrolling strip: keep its touches native scroll (the drawer body is pan-y). */
    touch-action: pan-x;
    padding: 0 2px 14px;
}
.vela-tfd-ranges::-webkit-scrollbar { display: none; }
.vela-tfd-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
    gap: 6px;
    padding-bottom: 4px;
}
.vela-tfd-chip {
    all: unset;
    min-height: 40px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--vela-fg);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-tfd-chip:active { background: var(--vela-hover); }
.vela-tfd-chip[data-active='1'] {
    color: var(--vela-fg-bright);
    border-color: var(--vela-fg-bright);
    background: var(--vela-hover);
}
`;

export interface TimeframeDrawerOptions {
    host: HTMLElement;
    timeframes: readonly string[];
    ranges: readonly RangePreset[];
    /** Read live at open — the current timeframe (highlights its chip). */
    currentTimeframe: () => string;
    /** Read live at open — the active range chip id, or null. */
    activeRange: () => string | null;
    onTimeframe: (tf: string) => void;
    onRange: (preset: RangePreset) => void;
    onOpenChange?: (open: boolean) => void;
}

export class TimeframeDrawer {
    private readonly drawer: Drawer;
    private readonly rangeChips = new Map<string, HTMLButtonElement>();
    private readonly tfChips = new Map<string, HTMLButtonElement>();

    constructor(private readonly opts: TimeframeDrawerOptions) {
        const doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.drawer = new Drawer({ host: opts.host, onOpenChange: opts.onOpenChange });

        const rangeHeading = doc.createElement('div');
        rangeHeading.className = 'vela-tfd-heading';
        rangeHeading.textContent = 'Date Range';

        const ranges = doc.createElement('div');
        ranges.className = 'vela-tfd-ranges';
        for (const preset of opts.ranges) {
            const chip = doc.createElement('button');
            chip.className = 'vela-tfd-chip';
            chip.textContent = preset.id;
            chip.addEventListener('click', () => {
                opts.onRange(preset);
                this.drawer.hide();
            });
            this.rangeChips.set(preset.id, chip);
            ranges.appendChild(chip);
        }

        const tfHeading = doc.createElement('div');
        tfHeading.className = 'vela-tfd-heading';
        tfHeading.textContent = 'Timeframes';

        const grid = doc.createElement('div');
        grid.className = 'vela-tfd-grid';
        for (const tf of opts.timeframes) {
            const chip = doc.createElement('button');
            chip.className = 'vela-tfd-chip';
            chip.textContent = timeframeLabel(tf);
            chip.addEventListener('click', () => {
                opts.onTimeframe(tf);
                this.drawer.hide();
            });
            this.tfChips.set(tf, chip);
            grid.appendChild(chip);
        }

        this.drawer.body.append(rangeHeading, ranges, tfHeading, grid);
    }

    open(): void {
        const tf = this.opts.currentTimeframe();
        const range = this.opts.activeRange();
        for (const [id, chip] of this.rangeChips) {
            if (range !== null && id === range) chip.dataset.active = '1';
            else delete chip.dataset.active;
        }
        for (const [id, chip] of this.tfChips) {
            if (range === null && id === tf) chip.dataset.active = '1';
            else delete chip.dataset.active;
        }
        this.drawer.show();
    }

    close(): void {
        this.drawer.hide();
    }

    destroy(): void {
        this.drawer.destroy();
    }
}
