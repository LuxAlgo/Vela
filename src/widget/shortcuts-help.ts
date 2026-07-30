// Shortcuts help — a dialog listing every registered keymap binding, grouped by
// category, with platform-formatted chords. Driven entirely by `KeymapManager.bindings()`
// (plugin-registered bindings appear automatically).
import type { KeymapManager } from '../ui/keymap';
import { Dialog } from '../ui/components/dialog';
import { injectStyles } from '../ui/styles';

const STYLE_ID = 'vela-widget-shortcuts';
const CSS = `
.vela-sh-cat {
    color: var(--vela-fg-muted);
    font-size: var(--vela-font-size-sm);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: var(--vela-space-2) 0 var(--vela-space-1);
}
.vela-sh-row { display: flex; align-items: center; gap: var(--vela-space-3); padding: 3px 0; }
.vela-sh-label { flex: 1; }
.vela-sh-keys { display: flex; gap: 4px; }
.vela-sh-key {
    background: var(--vela-surface-overlay);
    border: 1px solid var(--vela-border-soft);
    border-radius: var(--vela-radius-sm);
    padding: 1px 7px;
    font-size: var(--vela-font-size-sm);
    font-variant-numeric: tabular-nums;
}
.vela-sh-static { color: var(--vela-fg-muted); font-size: var(--vela-font-size-sm); margin-top: var(--vela-space-2); }
`;

export class ShortcutsHelp {
    private readonly dialog: Dialog;
    private readonly list: HTMLElement;
    private readonly keymap: KeymapManager;

    constructor(keymap: KeymapManager, host?: HTMLElement, onOpenChange?: (open: boolean) => void) {
        this.keymap = keymap;
        const doc = (host ?? document.body).ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.list = doc.createElement('div');
        this.dialog = new Dialog({
            title: 'Keyboard shortcuts',
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
        for (const b of this.keymap.bindings()) {
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
        addCategory('Mouse');
        addRow('Scroll through history', ['Shift+Scroll']);
        addRow('Measure from the press point', ['Shift+Click']);
        addRow('Delete the drawing under the cursor', ['Middle-click']);
        // The two type-to-act routes live outside the keymap (any-printable routing).
        const s = doc.createElement('div');
        s.className = 'vela-sh-static';
        s.textContent = 'Typing a letter opens the symbol search; typing a digit opens the timeframe entry.';
        this.list.appendChild(s);
    }
}
