// Saved styles: a tool's named looks (line, label and per-type settings) that the settings panel
// applies in one click. They are listed per tool, replaced by name, and round-trip through
// `toolTemplates()` / `setToolTemplates()` so a host can keep them.
import { describe, it, expect } from 'vitest';
import { TypedEventBus } from '../src/core/events/EventBus';
import type { VelaEventMap } from '../src/core/events/types';
import { DrawingController } from '../src/core/drawings/DrawingController';
import { builtinToolTemplates, captureToolDefaults, createDrawing, type DrawingIntent, type DrawingToolTemplate, type IDrawingsRendererPort } from '../src/core/drawings';
import type { IChartRenderer } from '../src/core/ports/IChartRenderer';

class FakePort implements IDrawingsRendererPort {
    pushed: Partial<Record<string, DrawingToolTemplate[]>> = {};
    private cb: ((i: DrawingIntent) => void) | null = null;
    setToolbar(): void {}
    showToolbar(): void {}
    syncDrawings(): void {}
    setActiveTool(): void {}
    setSelection(): void {}
    openSettings(): void {}
    setToolTemplates(map: Partial<Record<string, DrawingToolTemplate[]>>): void {
        this.pushed = map;
    }
    onDrawingIntent(cb: (i: DrawingIntent) => void): () => void {
        this.cb = cb;
        return () => (this.cb = null);
    }
    fire(i: DrawingIntent): void {
        this.cb?.(i);
    }
}

function setup() {
    const port = new FakePort();
    const events = new TypedEventBus<VelaEventMap>();
    const renderer = { capabilities: { userDrawings: true }, userDrawingsPort: port } as unknown as IChartRenderer;
    const ctrl = new DrawingController(renderer, events, undefined);
    const announced: string[] = [];
    events.on('drawing:templates', ({ type }) => announced.push(type));
    return { port, ctrl, announced };
}

const RED = { style: { lineColor: '#ff0000', lineWidth: 3 } };
const BLUE = { style: { lineColor: '#0000ff' } };

describe('saved styles for a drawing tool', () => {
    it('a style saved from the settings panel is listed for its tool and shown in the panel', () => {
        const { port, ctrl, announced } = setup();
        port.fire({ kind: 'template-save', type: 'trendline', name: 'Weekly', settings: RED });
        expect(ctrl.toolTemplates()).toEqual({ trendline: [{ name: 'Weekly', settings: RED }] });
        expect(port.pushed.trendline).toEqual([{ name: 'Weekly', settings: RED }]);
        expect(announced).toEqual(['trendline']);
    });

    it('saving under a name already in use replaces that style', () => {
        const { ctrl } = setup();
        ctrl.saveToolTemplate('trendline', 'Weekly', RED);
        ctrl.saveToolTemplate('trendline', 'Daily', BLUE);
        ctrl.saveToolTemplate('trendline', 'Weekly', BLUE);
        expect(ctrl.toolTemplates().trendline?.map((t) => [t.name, t.settings.style?.lineColor])).toEqual([
            ['Daily', '#0000ff'],
            ['Weekly', '#0000ff'],
        ]);
    });

    it('deleting a style removes only that one', () => {
        const { port, ctrl } = setup();
        ctrl.saveToolTemplate('box', 'Demand', RED);
        ctrl.saveToolTemplate('box', 'Supply', BLUE);
        port.fire({ kind: 'template-remove', type: 'box', name: 'Demand' });
        expect(ctrl.toolTemplates().box?.map((t) => t.name)).toEqual(['Supply']);
        ctrl.removeToolTemplate('box', 'Supply');
        expect(ctrl.toolTemplates()).toEqual({});
    });

    it('a style without a name is not saved', () => {
        const { ctrl } = setup();
        ctrl.saveToolTemplate('trendline', '   ', RED);
        expect(ctrl.toolTemplates()).toEqual({});
    });

    it('the saved styles round-trip to another chart, dropping unknown tools and malformed entries', () => {
        const a = setup();
        a.ctrl.saveToolTemplate('trendline', 'Weekly', RED);
        const saved = JSON.parse(JSON.stringify(a.ctrl.toolTemplates()));

        const b = setup();
        b.ctrl.setToolTemplates({ ...saved, notatool: [{ name: 'x', settings: RED }], box: [{ name: '' }, 'junk', { name: 'Ok', settings: BLUE }] });
        expect(b.ctrl.toolTemplates()).toEqual({ trendline: [{ name: 'Weekly', settings: RED }], box: [{ name: 'Ok', settings: BLUE }] });
        expect(b.announced.sort()).toEqual(['box', 'trendline']);
    });

    it('a saved fib style keeps its levels', () => {
        const fib = createDrawing('fibretracement', { paneId: 'price', anchors: [{ time: 0, price: 1 }, { time: 1, price: 2 }] })!;
        fib.applyProps({ levels: [{ ratio: 0.705, color: '#123456', enabled: true }] });
        const { ctrl } = setup();
        ctrl.saveToolTemplate('fibretracement', 'OTE only', captureToolDefaults(fib));
        expect(ctrl.toolTemplates().fibretracement?.[0]?.settings.props?.levels).toEqual([{ ratio: 0.705, color: '#123456', enabled: true }]);
    });
});

describe('ready-made styles', () => {
    it('line tools offer support, resistance and projection looks', () => {
        for (const type of ['trendline', 'hline', 'ray']) expect(builtinToolTemplates(type).map((t) => t.name)).toEqual(['Support', 'Resistance', 'Projection']);
    });

    it('area tools offer demand and supply looks', () => {
        for (const type of ['box', 'parallelchannel']) expect(builtinToolTemplates(type).map((t) => t.name)).toEqual(['Demand', 'Supply']);
    });
});
