// @vitest-environment jsdom
// A dialog's close button is an icon, so it carries its name for screen readers: "Close",
// or the caller's translation of it.
import { describe, it, expect, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { Dialog } from '@luxalgo/vela-ui/dialog';

afterEach(() => {
    document.body.replaceChildren();
});

const closeButton = (dialog: Dialog): HTMLButtonElement => {
    const button = dialog.panel.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]');
    expect(button).not.toBeNull();
    return button!;
};

describe('a dialog close button', () => {
    it('is named Close', () => {
        const dialog = new Dialog({ title: 'Settings', host: document.body });
        expect(closeButton(dialog).getAttribute('aria-label')).toBe('Close');
        dialog.destroy();
    });

    const french = { t: (m: string | { id: string; defaultMessage: string }) => (typeof m === 'string' ? m : m.id === 'ui.dialog.close' ? 'Fermer' : m.defaultMessage) };

    it('takes its name from the translator it is given', () => {
        const dialog = new Dialog({ title: 'Réglages', host: document.body, i18n: french });
        expect(closeButton(dialog).getAttribute('aria-label')).toBe('Fermer');
        dialog.destroy();
    });

    it('follows a language that changes while the dialog lives', () => {
        const dialog = new Dialog({ title: 'Settings', host: document.body });
        dialog.setI18n(french);
        expect(closeButton(dialog).getAttribute('aria-label')).toBe('Fermer');
        dialog.setI18n(null);
        expect(closeButton(dialog).getAttribute('aria-label')).toBe('Close');
        dialog.destroy();
    });
});
