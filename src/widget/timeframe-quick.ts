// Timeframe quick entry — the "type a number to change timeframe" dialog. Opens seeded
// with the first typed character; shows a live human hint from the timeframe grammar;
// Enter applies the canonical value.
import { msg } from '../core/i18n/message';
import { textOf } from '../core/i18n/text';
import type { MessageLike, Translator } from '../core/i18n/types';
import { Dialog } from '@luxalgo/vela-ui/dialog';
import { injectStyles } from '@luxalgo/vela-ui/styles';
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

const TEXT = {
    title: msg('widget.timeframeQuick.title', 'Change timeframe'),
    // The codes are what the field accepts, typed as is in every language.
    example: msg('widget.timeframeQuick.example', 'e.g. 15, 4H, D, 3M'),
    invalid: msg('widget.timeframeQuick.invalid', 'Not a timeframe'),
};

export interface TimeframeQuickOptions {
    onApply: (canonical: string) => void;
    onOpenChange?: (open: boolean) => void;
    host?: HTMLElement;
    /** The shell's translator. Absent: English. */
    i18n?: Translator;
}

export class TimeframeQuick {
    private readonly dialog: Dialog;
    private readonly input: HTMLInputElement;
    private readonly hint: HTMLElement;
    private readonly i18n: Translator | null;

    private t(text: MessageLike): string {
        return textOf(this.i18n, text);
    }

    constructor(opts: TimeframeQuickOptions) {
        this.i18n = opts.i18n ?? null;
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.input = doc.createElement('input');
        this.input.className = 'vela-tq-input';
        this.input.setAttribute('spellcheck', 'false');
        this.hint = doc.createElement('div');
        this.hint.className = 'vela-tq-hint';
        this.dialog = new Dialog({
            title: this.t(TEXT.title),
            host: opts.host,
            draggable: true,
            closeOnInteractOutside: true,
            content: (body) => body.append(this.input, this.hint),
            onOpenChange: (open) => opts.onOpenChange?.(open),
        });
        this.input.addEventListener('input', () => {
            const { selectionStart, selectionEnd } = this.input;
            this.input.value = this.input.value.toUpperCase();
            this.input.setSelectionRange(selectionStart, selectionEnd);
            this.renderHint();
        });
        this.input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const parsed = parseTimeframe(this.input.value);
            if (parsed.valid && parsed.canonical !== undefined) {
                this.close();
                opts.onApply(parsed.canonical);
            }
        });
    }

    /** The dialog's title in the shell's language, re-read on every open. */
    relabel(): void {
        this.dialog.titleEl.textContent = this.t(TEXT.title);
    }

    open(seed = ''): void {
        this.relabel();
        this.dialog.show();
        this.input.value = seed.toUpperCase();
        this.renderHint();
        setTimeout(() => {
            this.input.focus();
            this.input.setSelectionRange(this.input.value.length, this.input.value.length);
        }, 0);
    }

    get isOpen(): boolean {
        return this.dialog.open;
    }

    /** Text typed at the entry that never reached its field: closed, it opens seeded
     *  with the text; open (the field takes focus a tick after the dialog does, and a
     *  fast typist's next key lands in that tick), it extends the entry. */
    type(text: string): void {
        if (!this.isOpen) {
            this.open(text);
            return;
        }
        this.input.value += text.toUpperCase();
        this.renderHint();
    }

    close(): void {
        this.dialog.hide();
    }

    destroy(): void {
        this.dialog.destroy();
    }

    private renderHint(): void {
        const raw = this.input.value.trim();
        const parsed = parseTimeframe(raw, this.i18n);
        if (!raw) {
            this.hint.textContent = this.t(TEXT.example);
            delete this.hint.dataset.invalid;
        } else if (parsed.valid) {
            this.hint.textContent = parsed.label ?? '';
            delete this.hint.dataset.invalid;
        } else {
            this.hint.textContent = this.t(TEXT.invalid);
            this.hint.dataset.invalid = '1';
        }
    }
}
