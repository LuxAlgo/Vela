import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndicatorRow, IndicatorPickerOptions } from '../src/widget/indicator-picker';
import { IndicatorPicker } from '../src/widget/indicator-picker';

// These tests exercise the picker's DOM and callbacks without bringing up Zag's
// dialog state machine.
vi.mock('../src/ui/components/dialog', () => ({
    Dialog: class MockDialog {
        private readonly host: HTMLElement;
        private readonly onOpenChange?: (open: boolean) => void;
        private readonly body: HTMLElement;

        constructor(options: {
            host?: HTMLElement;
            content?: (body: HTMLElement) => void;
            onOpenChange?: (open: boolean) => void;
        }) {
            this.host = options.host ?? document.body;
            this.onOpenChange = options.onOpenChange;
            this.body = this.host.ownerDocument.createElement('div');
            options.content?.(this.body);
            this.host.appendChild(this.body);
        }

        show(): void {
            this.onOpenChange?.(true);
        }

        hide(): void {
            this.onOpenChange?.(false);
        }

        destroy(): void {
            this.body.remove();
        }
    },
}));

describe('IndicatorPicker native category configuration', () => {
    let dom: JSDOM;
    let host: HTMLElement;
    let picker: IndicatorPicker | undefined;

    const native: IndicatorRow = {
        name: 'EMA 20',
        category: 'Built-in',
        native: true,
        nativeType: 'ema',
    };
    const manifestRows: IndicatorRow[] = [
        { name: 'RSI', category: 'Momentum', language: 'pine' },
        { name: 'ATR', category: 'Volatility', language: 'pine' },
    ];

    beforeEach(() => {
        dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
            url: 'http://localhost/',
        });
        vi.stubGlobal('document', dom.window.document);
        vi.stubGlobal('Document', dom.window.Document);
        vi.stubGlobal('Node', dom.window.Node);
        vi.stubGlobal('CSS', { escape: (value: string) => value });
        host = dom.window.document.createElement('div');
        dom.window.document.body.appendChild(host);
    });

    afterEach(() => {
        picker?.destroy();
        picker = undefined;
        dom.window.close();
        vi.unstubAllGlobals();
    });

    function mount(
        library: readonly IndicatorRow[],
        onChart: readonly IndicatorRow[] = [],
        config: Partial<IndicatorPickerOptions> = {},
    ): { onAdd: ReturnType<typeof vi.fn>; onRemove: ReturnType<typeof vi.fn> } {
        const onAdd = vi.fn<(libraryIndex: number) => void>();
        const onRemove = vi.fn<(instanceIndex: number) => void>();
        picker = new IndicatorPicker({
            host,
            library: () => library,
            onChart: () => onChart,
            onAdd,
            onRemove,
            ...config,
        });
        picker.open();
        return { onAdd, onRemove };
    }

    function groupLabels(): string[] {
        return Array.from(host.querySelectorAll('.vela-ip-list > .vela-ip-group'))
            .map((element) => element.textContent ?? '');
    }

    function libraryRow(name: string): HTMLElement {
        const row = Array.from(host.querySelectorAll<HTMLElement>('.vela-ip-row[data-library]'))
            .find((element) => element.querySelector('.vela-ip-name')?.textContent === name);
        if (!row) throw new Error(`Could not find library row: ${name}`);
        return row;
    }

    function onChartRow(name: string): HTMLElement {
        const row = Array.from(host.querySelectorAll<HTMLElement>('.vela-ip-oncard .vela-ip-row'))
            .find((element) => element.querySelector('.vela-ip-name')?.textContent === name);
        if (!row) throw new Error(`Could not find on-chart row: ${name}`);
        return row;
    }

    it('uses the native row category as the default heading and native badge', () => {
        mount([native, ...manifestRows], [native]);

        expect(groupLabels()).toEqual(['Built-in', 'Momentum', 'Volatility']);
        expect(onChartRow('EMA 20').querySelector('.vela-ip-badge')?.textContent).toBe('Built-in');
    });

    it('uses nativeCategory for both the native group heading and its on-chart badge', () => {
        mount([native, ...manifestRows], [native], { nativeCategory: 'Built-in Studies' });

        expect(groupLabels()).toEqual(['Built-in Studies', 'Momentum', 'Volatility']);
        expect(onChartRow('EMA 20').querySelector('.vela-ip-badge')?.textContent).toBe('Built-in Studies');
    });

    it('hides native library entries and the native badge when nativeCategory is false, while keeping on-chart removal available', () => {
        const { onRemove } = mount([native, ...manifestRows], [native], { nativeCategory: false });

        expect(groupLabels()).toEqual(['Momentum', 'Volatility']);
        expect(host.querySelector('.vela-ip-row[data-library] .vela-ip-name')?.textContent).toBe('RSI');
        expect(host.querySelector('.vela-ip-row[data-library]')?.textContent).not.toContain('EMA 20');

        const activeNativeRow = onChartRow('EMA 20');
        expect(activeNativeRow.querySelector('.vela-ip-badge')).toBeNull();
        const removeButton = activeNativeRow.querySelector<HTMLButtonElement>('.vela-ip-trash');
        expect(removeButton).not.toBeNull();
        removeButton!.click();
        expect(onRemove).toHaveBeenCalledWith(0);
    });

    it('renders manifest categories before the native category when order is manifest-first', () => {
        mount([native, ...manifestRows], [], {
            nativeCategory: 'Core Indicators',
            order: 'manifest-first',
        });

        expect(groupLabels()).toEqual(['Momentum', 'Volatility', 'Core Indicators']);
    });

    it('keeps each row’s original library index after changing display order', () => {
        const library = [native, { name: 'Host RSI', category: 'Host', language: 'pine' }];
        const { onAdd } = mount(library, [], { order: 'manifest-first' });

        libraryRow('Host RSI').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        expect(onAdd).toHaveBeenCalledOnce();
        expect(onAdd).toHaveBeenCalledWith(1);
    });

    it('shows the empty-manifest message when every library row is hidden', () => {
        mount([native], [], { nativeCategory: false });

        expect(host.querySelector('.vela-ip-empty')?.textContent).toBe('No indicators in the manifest.');
    });
});
