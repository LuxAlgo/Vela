// A tool's remembered settings: the next drawing of a type starts from the last one the user
// styled — its style, its text styling and its per-type settings — and the set round-trips
// through `toolDefaults()` / `setToolDefaults()` so a host can keep it across reloads.
import { describe, it, expect } from 'vitest';
import { TypedEventBus } from '../src/core/events/EventBus';
import type { VelaEventMap } from '../src/core/events/types';
import { DrawingController } from '../src/core/drawings/DrawingController';
import type { DrawingIntent, DrawingToolDefaults, IDrawingsRendererPort, SerializedDrawing } from '../src/core/drawings';
import type { IChartRenderer } from '../src/core/ports/IChartRenderer';

class FakePort implements IDrawingsRendererPort {
    activeDefaults: DrawingToolDefaults | undefined;
    private cb: ((i: DrawingIntent) => void) | null = null;
    setToolbar(): void {}
    showToolbar(): void {}
    syncDrawings(): void {}
    setActiveTool(_t: string | null, _style?: SerializedDrawing['style'], defaults?: DrawingToolDefaults): void {
        this.activeDefaults = defaults;
    }
    setSelection(): void {}
    openSettings(): void {}
    onDrawingIntent(cb: (i: DrawingIntent) => void): () => void {
        this.cb = cb;
        return () => (this.cb = null);
    }
    fire(i: DrawingIntent): void {
        this.cb?.(i);
    }
}

function setup(supported = true) {
    const port = new FakePort();
    const events = new TypedEventBus<VelaEventMap>();
    const renderer = { capabilities: { userDrawings: supported }, userDrawingsPort: supported ? port : undefined } as unknown as IChartRenderer;
    const ctrl = new DrawingController(renderer, events, undefined);
    const announced: string[] = [];
    events.on('drawing:defaults', ({ type }) => announced.push(type));
    return { port, ctrl, announced };
}

const ANCHORS = [
    { time: 1000, price: 10 },
    { time: 2000, price: 20 },
];

function placed(type: SerializedDrawing['type'], extra: Partial<SerializedDrawing> = {}): SerializedDrawing {
    return {
        id: 'renderer-temp',
        type,
        paneId: 'price',
        anchors: ANCHORS,
        style: { lineColor: '#2962ff', lineWidth: 2, lineStyle: 'solid' },
        locked: false,
        visible: true,
        zIndex: 0,
        createdAt: 0,
        ...extra,
    };
}

describe('a tool remembers its settings for the next drawing', () => {
    it('a trend line drawn after a styled one keeps its color, width and label styling, but not its words', () => {
        const { port, ctrl } = setup();
        port.fire({ kind: 'create', doc: placed('trendline') });
        const first = ctrl.all()[0]!;
        port.fire({
            kind: 'edit',
            doc: {
                ...first,
                style: { lineColor: '#ff0000', lineWidth: 3, lineStyle: 'dashed' },
                text: { value: 'Weekly support', color: '#00ff00', size: 'large', hAlign: 'left', vAlign: 'top', bold: true },
            },
        });
        port.fire({ kind: 'create', doc: placed('trendline') });
        const next = ctrl.all()[1]!;
        expect(next.style).toMatchObject({ lineColor: '#ff0000', lineWidth: 3, lineStyle: 'dashed' });
        expect(next.text).toMatchObject({ color: '#00ff00', size: 'large', bold: true });
        expect(next.text?.value).toBe('');
    });

    it('a fib drawn after a customized one keeps its levels and direction', () => {
        const { port, ctrl } = setup();
        port.fire({ kind: 'create', doc: placed('fibretracement') });
        const first = ctrl.all()[0]!;
        const levels = [
            { ratio: 0, color: '#111111', enabled: true },
            { ratio: 0.705, color: '#222222', enabled: true },
            { ratio: 1, color: '#333333', enabled: false },
        ];
        port.fire({ kind: 'edit', doc: { ...first, props: { ...first.props, levels, reverse: true } } });
        port.fire({ kind: 'create', doc: placed('fibretracement') });
        const next = ctrl.all()[1]!;
        expect(next.props?.levels).toEqual(levels);
        expect(next.props?.reverse).toBe(true);
    });

    it('styling several drawings at once sets the default for each of their tools', () => {
        const { port, ctrl } = setup();
        port.fire({ kind: 'create', doc: placed('trendline') });
        port.fire({ kind: 'create', doc: placed('box') });
        const [line, box] = ctrl.all();
        port.fire({
            kind: 'edit-many',
            docs: [
                { ...line!, style: { ...line!.style, lineColor: '#abcdef' } },
                { ...box!, style: { ...box!.style, lineColor: '#abcdef' } },
            ],
        });
        expect(ctrl.add('trendline', { anchors: ANCHORS })!.style.lineColor).toBe('#abcdef');
        expect(ctrl.add('box', { anchors: ANCHORS })!.style.lineColor).toBe('#abcdef');
    });

    it('an explicit style passed to add() still wins over the remembered one', () => {
        const { ctrl } = setup();
        ctrl.add('trendline', { anchors: ANCHORS, style: { lineColor: '#ff0000', lineWidth: 4 } });
        const next = ctrl.add('trendline', { anchors: ANCHORS, style: { lineColor: '#00ff00' } })!;
        expect(next.style.lineColor).toBe('#00ff00');
        expect(next.style.lineWidth).toBe(4);
    });

    it('arming a tool hands the renderer its whole remembered settings for the placement preview', () => {
        const { port, ctrl } = setup();
        const d = ctrl.add('fibretracement', { anchors: ANCHORS })!;
        ctrl.update(d.id, { props: { levels: [{ ratio: 0.5, color: '#123456', enabled: true }] } });
        ctrl.setTool('fibretracement');
        expect(port.activeDefaults?.props?.levels).toEqual([{ ratio: 0.5, color: '#123456', enabled: true }]);
    });
});

describe('remembered settings are announced and can be saved and restored', () => {
    it('a settings change is announced; moving the drawing is not', () => {
        const { port, ctrl, announced } = setup();
        port.fire({ kind: 'create', doc: placed('trendline') });
        expect(announced).toEqual(['trendline']); // placed in a non-factory color: remembered
        announced.length = 0;
        const d = ctrl.all()[0]!;
        port.fire({ kind: 'edit', doc: { ...d, anchors: [ANCHORS[0]!, { time: 3000, price: 30 }] } });
        expect(announced).toEqual([]);
        port.fire({ kind: 'edit', doc: { ...d, style: { ...d.style, lineWidth: 4 } } });
        expect(announced).toEqual(['trendline']);
    });

    it('a drawing left on its factory look remembers nothing, so factory changes still reach the user', () => {
        const { ctrl, announced } = setup();
        const d = ctrl.add('fibretracement', { anchors: ANCHORS })!;
        expect(ctrl.toolDefaults()).toEqual({});
        expect(announced).toEqual([]);
        const factory = d.serialize();
        ctrl.update(d.id, { style: { ...factory.style, lineWidth: 3 } });
        expect(Object.keys(ctrl.toolDefaults())).toEqual(['fibretracement']);
        ctrl.update(d.id, { style: factory.style }); // styled back to the factory look
        expect(ctrl.toolDefaults()).toEqual({});
    });

    it('toolDefaults() round-trips through setToolDefaults() on another chart', () => {
        const a = setup();
        a.ctrl.add('trendline', { anchors: ANCHORS, style: { lineColor: '#ff0000' } });
        const saved = JSON.parse(JSON.stringify(a.ctrl.toolDefaults()));

        const b = setup();
        b.ctrl.setToolDefaults(saved);
        expect(b.announced).toEqual(['trendline']);
        expect(b.ctrl.add('trendline', { anchors: ANCHORS })!.style.lineColor).toBe('#ff0000');
    });

    it('restoring the same set again announces nothing', () => {
        const { ctrl, announced } = setup();
        const saved = { trendline: { style: { lineColor: '#ff0000' } } };
        ctrl.setToolDefaults(saved);
        announced.length = 0;
        ctrl.setToolDefaults(JSON.parse(JSON.stringify(saved)));
        expect(announced).toEqual([]);
    });

    it('unknown tools and malformed entries are dropped from a restored set', () => {
        const { ctrl } = setup();
        ctrl.setToolDefaults({ trendline: { style: { lineColor: '#ff0000' } }, notatool: { style: {} }, box: 'junk', hline: [1, 2] });
        expect(Object.keys(ctrl.toolDefaults())).toEqual(['trendline']);
    });

    it('resetting a tool sends its next drawing back to the factory defaults', () => {
        const { ctrl } = setup();
        const factory = ctrl.add('trendline', { anchors: ANCHORS })!.style.lineColor;
        ctrl.add('trendline', { anchors: ANCHORS, style: { lineColor: '#ff0000' } });
        ctrl.resetToolDefaults('trendline');
        expect(ctrl.add('trendline', { anchors: ANCHORS })!.style.lineColor).toBe(factory);
    });

    it('a chart without interactive drawings still saves and restores the set', () => {
        const { ctrl } = setup(false);
        ctrl.setToolDefaults({ trendline: { style: { lineColor: '#ff0000' } } });
        expect(ctrl.toolDefaults()).toEqual({ trendline: { style: { lineColor: '#ff0000' } } });
    });
});
