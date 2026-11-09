// Shortcuts help — a dialog listing every registered keymap binding, grouped by
// category, with platform-formatted chords. Driven entirely by `KeymapManager.bindings()`
// (plugin-registered bindings appear automatically).
import type { KeymapManager } from '../ui/keymap';
import { Dialog } from '@luxalgo/vela-ui/dialog';
import { injectChromeStyles } from '../ui/chromeStyles';
import { msg } from '../core/i18n/message';
import { englishTranslator } from '../core/i18n/translator';
import type { MessageLike, Translator } from '../core/i18n/types';
import { css } from '@luxalgo/vela-ui/css';
import { t } from '@luxalgo/vela-ui/t';

const TEXT = {
    title: msg('widget.shortcuts.title', 'Keyboard shortcuts'),
    mouse: msg('widget.shortcuts.mouse', 'Mouse'),
    scroll: msg('widget.shortcuts.scrollHistory', 'Scroll through history'),
    scrollKeys: msg('widget.shortcuts.scrollHistoryKeys', 'Shift+Scroll'),
    measure: msg('widget.shortcuts.measure', 'Measure from the press point'),
    measureKeys: msg('widget.shortcuts.measureKeys', 'Shift+Click'),
    erase: msg('widget.shortcuts.deleteDrawing', 'Delete the drawing under the cursor'),
    eraseKeys: msg('widget.shortcuts.deleteDrawingKeys', 'Middle-click'),
    typing: msg('widget.shortcuts.typing', 'Typing a letter or 0 opens the symbol search; typing a digit from 1 to 9 opens the timeframe entry.'),
};

const STYLE_ID = 'vela-widget-shortcuts';
const CSS = css`@layer vela.chrome {

.vela-sh-cat {
    color: ${t.fg.muted};
    font-size: ${t.fontSize.sm};
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: ${t.space[2]} 0 ${t.space[1]};
}
.vela-sh-row { display: flex; align-items: center; gap: ${t.space[3]}; padding: 3px 0; }
.vela-sh-label { flex: 1; }
.vela-sh-keys { display: flex; gap: 4px; }
.vela-sh-key {
    background: ${t.surface.overlay};
    border: 1px solid ${t.border.soft};
    border-radius: ${t.radius.sm};
    padding: 1px 7px;
    font-size: ${t.fontSize.sm};
    font-variant-numeric: tabular-nums;
}
.vela-sh-static { color: ${t.fg.muted}; font-size: ${t.fontSize.sm}; margin-top: ${t.space[2]}; }

}`;

export class ShortcutsHelp {
    private readonly dialog: Dialog;
    private readonly list: HTMLElement;
    private readonly keymap: KeymapManager;

    private readonly i18n: () => Translator;

    /** `i18n` returns the shell's current translator; the panel reads it each time it opens. */
    constructor(keymap: KeymapManager, host?: HTMLElement, onOpenChange?: (open: boolean) => void, i18n?: () => Translator) {
        this.keymap = keymap;
        this.i18n = i18n ?? englishTranslator;
        const doc = (host ?? document.body).ownerDocument;
        injectChromeStyles(STYLE_ID, CSS, doc);
        this.list = doc.createElement('div');
        this.dialog = new Dialog({
            title: this.i18n().t(TEXT.title),
            i18n: this.i18n(),
            host,
            closeOnInteractOutside: true,
            content: (body) => body.appendChild(this.list),
            onOpenChange: (open) => {
                if (open) this.refresh();
                onOpenChange?.(open);
            },
        });
    }

    open(): void {
        this.dialog.show();
    }

    close(): void {
        this.dialog.hide();
    }

    destroy(): void {
        this.dialog.destroy();
    }

    private refresh(): void {
        const doc = this.list.ownerDocument;
        const i18n = this.i18n();
        const t = (m: MessageLike): string => i18n.t(m);
        this.dialog.titleEl.textContent = t(TEXT.title);
        this.dialog.setI18n(i18n);
        this.list.replaceChildren();
        const addCategory = (text: string): void => {
            const cat = doc.createElement('div');
            cat.className = 'vela-sh-cat';
            cat.textContent = text;
            this.list.appendChild(cat);
        };
        const addRow = (label: string, keys: readonly string[]): void => {
            const row = doc.createElement('div');
            row.className = 'vela-sh-row';
            const l = doc.createElement('span');
            l.className = 'vela-sh-label';
            l.textContent = label;
            const ks = doc.createElement('span');
            ks.className = 'vela-sh-keys';
            for (const key of keys) {
                const k = doc.createElement('span');
                k.className = 'vela-sh-key';
                k.textContent = key;
                ks.appendChild(k);
            }
            row.append(l, ks);
            this.list.appendChild(row);
        };
        const byCategory = new Map<string, ReturnType<KeymapManager['bindings']>>();
        for (const b of this.keymap.bindings(i18n)) {
            const bucket = byCategory.get(b.category) ?? [];
            bucket.push(b);
            byCategory.set(b.category, bucket);
        }
        for (const [category, bindings] of byCategory) {
            addCategory(category);
            for (const b of bindings) addRow(b.label, b.display);
        }
        // Pointer gestures live outside the keymap — list them like bindings so the
        // panel stays the one complete reference.
        addCategory(t(TEXT.mouse));
        addRow(t(TEXT.scroll), [t(TEXT.scrollKeys)]);
        addRow(t(TEXT.measure), [t(TEXT.measureKeys)]);
        addRow(t(TEXT.erase), [t(TEXT.eraseKeys)]);
        // The two type-to-act routes live outside the keymap (any-printable routing).
        const s = doc.createElement('div');
        s.className = 'vela-sh-static';
        s.textContent = t(TEXT.typing);
        this.list.appendChild(s);
    }
}
