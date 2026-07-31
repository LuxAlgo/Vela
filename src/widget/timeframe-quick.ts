// Timeframe quick entry — the "type a number to change timeframe" dialog. Opens seeded
// with the first typed character; shows a live human hint from the timeframe grammar;
// Enter applies the canonical value.
import { Dialog } from '../ui/components/dialog';
import { injectStyles } from '../ui/styles';
import { parseTimeframe } from './timeframe';

const STYLE_ID = 'vela-widget-tfquick';
const CSS = `
.vela-tq-input {
    display: block;
    margin: 0 auto;
    width: 220px;
    box-sizing: border-box;
    height: 40px;
    background: var(--vela-surface-elev);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    padding: 0 12px;
    font-size: 18px;
    text-align: center;
    outline: none;
}
.vela-tq-input:focus { border-color: var(--vela-border-strong); }
.vela-tq-hint { margin-top: var(--vela-space-2); text-align: center; color: var(--vela-fg-muted); min-height: 1.2em; }
.vela-tq-hint[data-invalid] { color: var(--vela-danger); }
`;

export interface TimeframeQuickOptions {
    onApply: (canonical: string) => void;
    onOpenChange?: (open: boolean) => void;
    host?: HTMLElement;
}

export class TimeframeQuick {
    private readonly dialog: Dialog;
    private readonly input: HTMLInputElement;
    private readonly hint: HTMLElement;

    constructor(opts: TimeframeQuickOptions) {
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.input = doc.createElement('input');
        this.input.className = 'vela-tq-input';
        this.input.setAttribute('spellcheck', 'false');
        this.hint = doc.createElement('div');
        this.hint.className = 'vela-tq-hint';
        this.dialog = new Dialog({
            title: 'Change timeframe',
            host: opts.host,
            draggable: true,
            closeOnInteractOutside: true,
            content: (body) => body.append(this.input, this.hint),
            onOpenChange: (open) => opts.onOpenChange?.(open),
        });
        this.input.addEventListener('input', () => this.renderHint());
        this.input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const parsed = parseTimeframe(this.input.value);
            if (parsed.valid && parsed.canonical !== undefined) {
                this.close();
                opts.onApply(parsed.canonical);
            }
        });
    }

    open(seed = ''): void {
        this.dialog.show();
        this.input.value = seed;
        this.renderHint();
        setTimeout(() => {
            this.input.focus();
            this.input.setSelectionRange(this.input.value.length, this.input.value.length);
        }, 0);
    }

    close(): void {
        this.dialog.hide();
    }

    destroy(): void {
        this.dialog.destroy();
    }

    private renderHint(): void {
        const raw = this.input.value.trim();
        const parsed = parseTimeframe(raw);
        if (!raw) {
            this.hint.textContent = 'e.g. 15, 4h, D, 3M';
            delete this.hint.dataset.invalid;
        } else if (parsed.valid) {
            this.hint.textContent = parsed.label ?? '';
            delete this.hint.dataset.invalid;
        } else {
            this.hint.textContent = 'Not a timeframe';
            this.hint.dataset.invalid = '1';
        }
    }
}
