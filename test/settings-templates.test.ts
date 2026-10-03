// @vitest-environment jsdom
// The settings footer's Template dropdown: a saved template is the whole config document
// under a name, applying one re-imports it, removing one drops it from the list.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { SettingsDialog } from '../src/renderers/native/chrome/SettingsDialog';
import { DARK_THEME } from '../src/core/theme';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type { ChartConfig } from '../src/renderers/native/core/chartConfig';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
});

/** The dialog's template actions, reached the way the footer menu reaches them. */
interface TemplateActions {
    templateItems(): { id: string; label: string; submenu?: { id: string }[] }[];
    onTemplate(id: string): void;
    writeTemplates(all: Record<string, ChartConfig>): void;
}

function mount(): { dlg: SettingsDialog; acts: TemplateActions; onImport: ReturnType<typeof vi.fn>; config: ChartConfig } {
    const host = document.createElement('div');
    document.body.append(host);
    const dlg = new SettingsDialog(host, DARK_THEME);
    const config = new NativeRenderer().getConfig();
    const onImport = vi.fn();
    dlg.open(
        config,
        () => {},
        onImport,
        () => {},
    );
    return { dlg, acts: dlg as unknown as TemplateActions, onImport, config };
}

describe('settings templates', () => {
    it('starts with only the defaults and save actions', () => {
        const { acts } = mount();
        expect(acts.templateItems().map((i) => i.id)).toEqual(['defaults', 'save']);
    });

    it('a saved template is listed by name and applying it imports the saved document', () => {
        const { acts, onImport, config } = mount();
        const saved = { ...config, layout: { ...config.layout, background: '#123456' } };
        acts.writeTemplates({ Night: saved });

        const ids = acts.templateItems().map((i) => i.id);
        expect(ids).toContain('tpl:Night');
        expect(ids).toContain('remove');

        acts.onTemplate('tpl:Night');
        expect(onImport).toHaveBeenCalledWith(saved);
    });

    it('templates survive a fresh dialog, and removing one drops it from the list', () => {
        const first = mount();
        first.acts.writeTemplates({ A: first.config, B: first.config });
        first.dlg.destroy();

        const { acts } = mount();
        expect(acts.templateItems().map((i) => i.id)).toEqual(['defaults', 'save', 'tpl:A', 'tpl:B', 'remove']);
        acts.onTemplate('rm:A');
        expect(acts.templateItems().map((i) => i.id)).toEqual(['defaults', 'save', 'tpl:B', 'remove']);
    });
});
