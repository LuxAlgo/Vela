import { describe, it, expect, vi } from 'vitest';
import { TypedEventBus } from '../src/core/events/EventBus';
import type { VelaEventMap } from '../src/core/events/types';
import { DrawingController } from '../src/core/drawings/DrawingController';
import { DrawingsControl } from '../src/core/DrawingsControl';
import { buildToolbar } from '../src/core/drawings';
import type { IDrawingsRendererPort, DrawingIntent, SerializedDrawing } from '../src/core/drawings';
import type { IChartRenderer } from '../src/core/ports/IChartRenderer';

class FakePort implements IDrawingsRendererPort {
    toolbar: unknown = null;
    visible = false;
    synced: SerializedDrawing[] = [];
    activeTool: string | null | undefined = undefined;
    activeToolStyle: SerializedDrawing['style'] | undefined = undefined;
    selection: string | null = null;
    selectionIds: string[] = [];
    private cb: ((i: DrawingIntent) => void) | null = null;
    setToolbar(def: unknown): void {
        this.toolbar = def;
    }
    showToolbar(v: boolean): void {
        this.visible = v;
    }
    syncDrawings(docs: readonly SerializedDrawing[]): void {
        this.synced = [...docs];
    }
    setActiveTool(t: string | null, lastStyle?: SerializedDrawing['style']): void {
        this.activeTool = t;
        this.activeToolStyle = lastStyle;
    }
    setSelection(ids: readonly string[]): void {
        this.selectionIds = [...ids];
        this.selection = ids[0] ?? null;
    }
    favoritesPushed: string[][] = [];
    setFavorites(types: readonly string[]): void {
        this.favoritesPushed.push([...types]);
    }
    shortcutsPushed: Array<Record<string, string>> = [];
    setToolShortcuts(map: Readonly<Record<string, string>>): void {
        this.shortcutsPushed.push({ ...map });
    }
    snapModes: string[] = [];
    setSnapMode(mode: string): void {
        this.snapModes.push(mode);
    }
    stayModes: boolean[] = [];
    setStayMode(on: boolean): void {
        this.stayModes.push(on);
    }
    modes: Array<string | null> = [];
    setMode(mode: string | null): void {
        this.modes.push(mode);
    }
    settingsOpenedFor: string | null = null;
    openSettings(id: string): void {
        this.settingsOpenedFor = id;
    }
    /** Assigned per test to emulate a renderer whose drawings share the series' z space. */
    stackRange?: (paneId: string) => { front: number; back: number };
    onDrawingIntent(cb: (i: DrawingIntent) => void): () => void {
        this.cb = cb;
        return () => (this.cb = null);
    }
    fire(i: DrawingIntent): void {
        this.cb?.(i);
    }
}

function fakeRenderer(userDrawings: boolean, port?: IDrawingsRendererPort): IChartRenderer {
    return { capabilities: { userDrawings }, userDrawingsPort: port } as unknown as IChartRenderer;
}

function setup(userDrawings = true, option?: Parameters<typeof buildToolbar>[0]) {
    const port = new FakePort();
    const events = new TypedEventBus<VelaEventMap>();
    const seen: Array<[string, string | null]> = [];
    for (const ev of ['drawing:created', 'drawing:edited', 'drawing:selected', 'drawing:removed', 'drawing:settings'] as const) {
        events.on(ev, (e) => seen.push([ev, e.id]));
    }
    const ctrl = new DrawingController(fakeRenderer(userDrawings, userDrawings ? port : undefined), events, option);
    return { port, events, seen, ctrl };
}

const HLINE_DOC: SerializedDrawing = {
    id: 'renderer-temp',
    type: 'hline',
    paneId: 'price',
    anchors: [{ time: 1000, price: 25000 }],
    style: { lineColor: '#fff', lineWidth: 1, lineStyle: 'solid' },
    locked: false,
    visible: true,
    zIndex: 0,
    createdAt: 0,
};

describe('DrawingController (enabled)', () => {
    it('pushes the toolbar + initial visibility on construction', () => {
        const { port } = setup(true, true);
        expect(port.toolbar).not.toBeNull();
        expect(port.visible).toBe(true);
        const dflt = setup(true, undefined);
        expect(dflt.port.visible).toBe(true); // option undefined ⇒ toolbar visible by default
        const off = setup(true, false);
        expect(off.port.visible).toBe(false); // option false ⇒ toolbar hidden (explicit opt-out)
    });

    it('arms/disarms a tool through the port', () => {
        const { port, ctrl } = setup();
        ctrl.setTool('trendline');
        expect(port.activeTool).toBe('trendline');
        ctrl.setTool(null);
        expect(port.activeTool).toBeNull();
    });

    it('add() creates + syncs + emits', () => {
        const { port, ctrl, seen } = setup();
        const d = ctrl.add('hline', { paneId: 'price', anchors: [{ time: 1, price: 2 }] });
        expect(d).not.toBeNull();
        expect(port.synced.length).toBe(1);
        expect(port.synced[0]!.type).toBe('hline');
        expect(seen).toContainEqual(['drawing:created', d!.id]);
    });

    it('select() drives the port selection + emits drawing:selected (host UI → chart)', () => {
        const { port, ctrl, seen } = setup();
        port.fire({ kind: 'create', doc: HLINE_DOC });
        const id = ctrl.all()[0]!.id;
        ctrl.select([id]);
        expect(port.selectionIds).toEqual([id]);
        expect(seen).toContainEqual(['drawing:selected', id]);
        ctrl.select([]); // clearing selection propagates too
        expect(port.selectionIds).toEqual([]);
        expect(seen).toContainEqual(['drawing:selected', null]);
    });

    it('openSettings() forwards to the port (opens the on-chart popup)', () => {
        const { port, ctrl } = setup();
        port.fire({ kind: 'create', doc: HLINE_DOC });
        const id = ctrl.all()[0]!.id;
        ctrl.openSettings(id);
        expect(port.settingsOpenedFor).toBe(id);
    });

    it('turns a create intent into a store-owned drawing (renderer id is replaced)', () => {
        const { port, ctrl, seen } = setup();
        port.fire({ kind: 'create', doc: HLINE_DOC });
        expect(port.synced.length).toBe(1);
        const id = port.synced[0]!.id;
        expect(id).toBe('dw-1'); // store assigns the id, not the renderer's 'renderer-temp'
        expect(seen).toContainEqual(['drawing:created', 'dw-1']);
        expect(ctrl.all()[0]!.anchors[0]!.price).toBe(25000);
        // creation no longer auto-selects (selection follows the settings popup / hover)
        expect(seen.some((e) => e[0] === 'drawing:selected')).toBe(false);
    });

    it('edit / select / delete intents mutate + emit', () => {
        const { port, ctrl, seen } = setup();
        port.fire({ kind: 'create', doc: HLINE_DOC });
        const id = ctrl.all()[0]!.id;
        port.fire({ kind: 'edit', doc: { ...HLINE_DOC, id, anchors: [{ time: 1, price: 30000 }] } });
        expect(ctrl.all()[0]!.anchors[0]!.price).toBe(30000);
        expect(seen).toContainEqual(['drawing:edited', id]);
        port.fire({ kind: 'select', ids: [] });
        expect(port.selection).toBeNull();
        port.fire({ kind: 'delete', ids: [id] });
        expect(ctrl.all().length).toBe(0);
        expect(seen).toContainEqual(['drawing:removed', id]);
    });

    it('settings + tool-finished intents', () => {
        const { port, ctrl, seen } = setup();
        ctrl.setTool('trendline');
        port.fire({ kind: 'tool-finished', type: 'trendline' });
        expect(port.activeTool).toBeNull(); // one-shot disarm
        port.fire({ kind: 'settings', id: 'x' });
        expect(seen).toContainEqual(['drawing:settings', 'x']);
    });

    it('brush stays armed after a stroke (not one-shot)', () => {
        const { port, ctrl } = setup();
        ctrl.setTool('freehand');
        port.fire({ kind: 'tool-finished', type: 'freehand' });
        expect(ctrl.getTool()).toBe('freehand'); // keeps drawing without re-picking the tool
        expect(port.activeTool).toBe('freehand');
    });

    it('highlighter stays armed after a stroke (same as brush)', () => {
        const { port, ctrl } = setup();
        ctrl.setTool('highlighter');
        port.fire({ kind: 'tool-finished', type: 'highlighter' });
        expect(ctrl.getTool()).toBe('highlighter');
        expect(port.activeTool).toBe('highlighter');
    });

    it('stay-in-drawing-mode keeps a one-shot tool armed after placement', () => {
        const { port, ctrl } = setup();
        ctrl.setStayMode(true);
        ctrl.setTool('trendline');
        port.fire({ kind: 'tool-finished', type: 'trendline' });
        expect(ctrl.getTool()).toBe('trendline');
        expect(port.activeTool).toBe('trendline');
        // Turning it off restores one-shot disarm.
        ctrl.setStayMode(false);
        port.fire({ kind: 'tool-finished', type: 'trendline' });
        expect(ctrl.getTool()).toBeNull();
    });
});

describe('DrawingController (disabled / LwC)', () => {
    it('is inert for interactive ops but still persists', () => {
        const { ctrl } = setup(false);
        expect(ctrl.supported).toBe(false);
        expect(ctrl.add('hline', {})).toBeNull(); // no renderer support → no create
        expect(() => ctrl.setTool('trendline')).not.toThrow();
        // persistence still round-trips (data is core-owned)
        ctrl.fromJSON({
            version: 1,
            drawings: [{ ...HLINE_DOC, id: 'dw-9' }],
        });
        expect(ctrl.all().length).toBe(1);
        expect(ctrl.toJSON().drawings[0]!.id).toBe('dw-9');
    });
});

describe('DrawingsControl facade (warn-and-no-op)', () => {
    it('warns on interactive methods when unsupported, still round-trips JSON', () => {
        const { ctrl } = setup(false);
        const facade = new DrawingsControl(ctrl);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(facade.supported).toBe(false);
        expect(facade.add('hline')).toBeNull();
        facade.setTool('trendline').showToolbar(true);
        expect(warn).toHaveBeenCalled();
        facade.fromJSON({ version: 1, drawings: [{ ...HLINE_DOC, id: 'dw-3' }] });
        expect(facade.toJSON().drawings[0]!.id).toBe('dw-3');
        warn.mockRestore();
    });
});

describe('DrawingController — editing foundation', () => {
    it('undo/redo round-trips create intents', () => {
        const { port, ctrl } = setup();
        port.fire({ kind: 'create', doc: HLINE_DOC });
        port.fire({ kind: 'create', doc: HLINE_DOC });
        expect(ctrl.all().length).toBe(2);
        expect(ctrl.canUndo()).toBe(true);
        ctrl.undo();
        expect(ctrl.all().length).toBe(1);
        ctrl.undo();
        expect(ctrl.all().length).toBe(0);
        expect(ctrl.canUndo()).toBe(false);
        ctrl.redo();
        ctrl.redo();
        expect(ctrl.all().length).toBe(2);
    });

    it('a single edit is one undo entry (drawing survives, anchors revert)', () => {
        const { port, ctrl } = setup();
        port.fire({ kind: 'create', doc: HLINE_DOC });
        const id = ctrl.all()[0]!.id;
        port.fire({ kind: 'edit', doc: { ...HLINE_DOC, id, anchors: [{ time: 1, price: 99999 }] } });
        expect(ctrl.all()[0]!.anchors[0]!.price).toBe(99999);
        ctrl.undo();
        expect(ctrl.all().length).toBe(1);
        expect(ctrl.all()[0]!.anchors[0]!.price).toBe(25000);
    });

    it('edit-many coalesces into one undo entry', () => {
        const { port, ctrl } = setup();
        port.fire({ kind: 'create', doc: HLINE_DOC });
        port.fire({ kind: 'create', doc: HLINE_DOC });
        const [a, b] = ctrl.all().map((d) => d.id);
        port.fire({
            kind: 'edit-many',
            docs: [
                { ...HLINE_DOC, id: a!, anchors: [{ time: 1, price: 1 }] },
                { ...HLINE_DOC, id: b!, anchors: [{ time: 1, price: 2 }] },
            ],
        });
        expect(ctrl.all().map((d) => d.anchors[0]!.price)).toEqual([1, 2]);
        ctrl.undo(); // one undo reverts BOTH
        expect(ctrl.all().map((d) => d.anchors[0]!.price)).toEqual([25000, 25000]);
    });

    it('duplicate clones with a fresh id, selects the clone, emits created, and is one undo step', () => {
        const { port, ctrl, seen } = setup();
        port.fire({ kind: 'create', doc: HLINE_DOC });
        const id = ctrl.all()[0]!.id;
        seen.length = 0;
        const clones = ctrl.duplicate([id]);
        expect(ctrl.all().length).toBe(2);
        expect(clones[0]!.id).not.toBe(id);
        expect(port.selectionIds).toEqual([clones[0]!.id]);
        expect(seen).toContainEqual(['drawing:created', clones[0]!.id]);
        ctrl.undo();
        expect(ctrl.all().map((d) => d.id)).toEqual([id]);
    });

    it('clone intent: commits the given (moved) docs as fresh copies, source untouched, one undo step', () => {
        const { port, ctrl, seen } = setup();
        port.fire({ kind: 'create', doc: HLINE_DOC });
        const src = ctrl.all()[0]!;
        seen.length = 0;
        // The end of a Ctrl-drag: the renderer hands over the source's twin, already translated.
        port.fire({ kind: 'clone', docs: [{ ...src, anchors: [{ time: 2000, price: 26000 }] }] });
        expect(ctrl.all().length).toBe(2);
        const clone = ctrl.all().find((d) => d.id !== src.id)!;
        expect(clone.anchors[0]).toEqual({ time: 2000, price: 26000 });
        expect(clone.zIndex).toBe(src.zIndex); // keeps its source's depth
        expect(ctrl.all().find((d) => d.id === src.id)!.anchors[0]).toEqual({ time: 1000, price: 25000 }); // source never moved
        expect(port.selectionIds).toEqual([clone.id]); // the copy becomes the selection
        expect(seen).toContainEqual(['drawing:created', clone.id]);
        ctrl.undo();
        expect(ctrl.all().map((d) => d.id)).toEqual([src.id]);
    });

    it('copy is silent; paste creates fresh drawings', () => {
        const { ctrl, seen } = setup();
        const d = ctrl.add('hline', { anchors: [{ time: 1, price: 1 }] })!;
        seen.length = 0;
        ctrl.copy([d.id]);
        expect(seen.length).toBe(0); // copy touches nothing observable
        expect(ctrl.all().length).toBe(1);
        const pasted = ctrl.paste();
        expect(ctrl.all().length).toBe(2);
        expect(pasted[0]!.id).not.toBe(d.id);
        expect(seen).toContainEqual(['drawing:created', pasted[0]!.id]);
    });

    it('generalized select: additive toggles membership; primary is ids[0]', () => {
        const { port, ctrl, seen } = setup();
        port.fire({ kind: 'create', doc: HLINE_DOC });
        port.fire({ kind: 'create', doc: HLINE_DOC });
        const [a, b] = ctrl.all().map((d) => d.id);
        port.fire({ kind: 'select', ids: [a!] });
        expect(port.selectionIds).toEqual([a]);
        seen.length = 0;
        port.fire({ kind: 'select', ids: [b!], additive: true });
        expect(port.selectionIds).toEqual([a, b]);
        expect(seen).toContainEqual(['drawing:selected', a]); // primary = first selected
        port.fire({ kind: 'select', ids: [a!], additive: true }); // toggle a back off
        expect(port.selectionIds).toEqual([b]);
    });

    it('last-used style seeds the next drawing of the same type; explicit overrides', () => {
        const { ctrl } = setup();
        ctrl.add('hline', { anchors: [{ time: 1, price: 1 }], style: { lineColor: '#ff0000' } });
        const second = ctrl.add('hline', { anchors: [{ time: 1, price: 2 }] });
        expect(second!.style.lineColor).toBe('#ff0000'); // inherited
        const third = ctrl.add('hline', { anchors: [{ time: 1, price: 3 }], style: { lineColor: '#00ff00' } });
        expect(third!.style.lineColor).toBe('#00ff00'); // explicit wins
    });

    it('a freshly drawn shape inherits the last-used style of its type', () => {
        const { port, ctrl } = setup();
        port.fire({ kind: 'create', doc: HLINE_DOC });
        const id = ctrl.all()[0]!.id;
        port.fire({ kind: 'edit', doc: { ...HLINE_DOC, id, style: { lineColor: '#ff0000', lineWidth: 1, lineStyle: 'solid' } } });
        port.fire({ kind: 'create', doc: HLINE_DOC }); // HLINE_DOC is #fff, but should inherit #ff0000
        expect(ctrl.all()[1]!.style.lineColor).toBe('#ff0000');
    });

    it('re-arming a tool pushes its last-used style to the renderer (seeds the placement preview)', () => {
        const { port, ctrl } = setup();
        port.fire({ kind: 'create', doc: HLINE_DOC });
        const id = ctrl.all()[0]!.id;
        port.fire({ kind: 'edit', doc: { ...HLINE_DOC, id, style: { lineColor: '#ff0000', lineWidth: 3, lineStyle: 'dashed' } } });
        ctrl.setTool('hline');
        expect(port.activeTool).toBe('hline');
        expect(port.activeToolStyle).toEqual({ lineColor: '#ff0000', lineWidth: 3, lineStyle: 'dashed' });
        ctrl.setTool(null); // disarming carries no style
        expect(port.activeToolStyle).toBeUndefined();
    });

    it('setLocked / setVisible emit drawing:edited — hosts persist and mirror off that event', () => {
        const { port, ctrl, seen } = setup();
        port.fire({ kind: 'create', doc: HLINE_DOC });
        const id = ctrl.all()[0]!.id;
        seen.length = 0;
        ctrl.setLocked(id, true);
        ctrl.setVisible(id, false);
        expect(ctrl.all()[0]).toMatchObject({ locked: true, visible: false });
        expect(seen.filter((e) => e[0] === 'drawing:edited')).toEqual([
            ['drawing:edited', id],
            ['drawing:edited', id],
        ]);
    });

    it('a drawing sent under the series (a z below the stack) survives a save/restore and is undoable', () => {
        const { port, ctrl } = setup();
        const d = ctrl.add('hline', { anchors: [{ time: 1, price: 1 }] })!;
        expect(ctrl.all()[0]!.zIndex).toBeGreaterThan(0); // no shared z space on this port ⇒ over the other drawings
        ctrl.update(d.id, { zIndex: -3 });
        expect(ctrl.all()[0]!.zIndex).toBe(-3);
        expect(port.synced.find((x) => x.id === d.id)!.zIndex).toBe(-3); // the renderer is told
        const doc = ctrl.toJSON();
        ctrl.fromJSON(doc);
        expect(ctrl.all()[0]!.zIndex).toBe(-3); // persisted, not a session value
        ctrl.update(d.id, { zIndex: 9 });
        ctrl.undo();
        expect(ctrl.all()[0]!.zIndex).toBe(-3);
    });

    it('add() can place a drawing under the series in one step, via an explicit z', () => {
        const { port, ctrl } = setup();
        const d = ctrl.add('hline', { anchors: [{ time: 1, price: 1 }], zIndex: -5 })!;
        expect(ctrl.all()[0]!.zIndex).toBe(-5);
        expect(port.synced.find((x) => x.id === d.id)!.zIndex).toBe(-5);
        ctrl.undo();
        expect(ctrl.all().length).toBe(0); // one undo step, not two
    });

    it('a new drawing starts just under the price; front/back clear the whole series stack', () => {
        const { port, ctrl } = setup();
        // The renderer's stack: an indicator raised to z 40, the candles at 0, the back at -6.
        port.stackRange = (paneId: string) => (paneId === 'price' ? { front: 40, back: -6, price: 0 } : { front: 0, back: 0 });
        const d = ctrl.add('hline', { anchors: [{ time: 1, price: 1 }] })!;
        expect(d.zIndex).toBeLessThan(0); // under the candles — the price reads on top of it
        expect(d.zIndex).toBeGreaterThan(-6); // but not sent behind the rest of the stack
        ctrl.sendToBack(d.id);
        expect(ctrl.all()[0]!.zIndex).toBeLessThan(-6); // undercuts the whole stack
        ctrl.bringToFront(d.id);
        expect(ctrl.all()[0]!.zIndex).toBeGreaterThan(40); // clears the raised indicator, not just other drawings
    });

    it('a series-covering tool (magnifier) starts ABOVE the whole series stack', () => {
        const { port, ctrl } = setup();
        port.stackRange = (paneId: string) => (paneId === 'price' ? { front: 40, back: -6, price: 0 } : { front: 0, back: 0 });
        const d = ctrl.add('magnifier', {
            anchors: [
                { time: 0, price: 1 },
                { time: 1, price: 2 },
            ],
        })!;
        // Its opaque inset replaces the candles' pixels — under the stack it would be buried.
        expect(d.zIndex).toBeGreaterThan(40);
    });

    it('without a price key a new drawing starts just under the pane\'s top series (a study pane)', () => {
        const { port, ctrl } = setup();
        port.stackRange = () => ({ front: 3, back: 1 });
        const d = ctrl.add('hline', { paneId: 'pane-1', anchors: [{ time: 1, price: 1 }] })!;
        expect(d.zIndex).toBeLessThan(3);
        expect(d.zIndex).toBeGreaterThan(2);
    });

    it('a duplicate keeps its source\'s depth instead of jumping to the front', () => {
        const { ctrl } = setup();
        const d = ctrl.add('hline', { anchors: [{ time: 1, price: 1 }], zIndex: -4 })!;
        const clone = ctrl.duplicate([d.id])[0]!;
        expect(clone.zIndex).toBe(-4);
        // Tying its source, the clone paints just in front of it (insertion order breaks the tie).
        expect(ctrl.all().map((x) => x.id)).toEqual([d.id, clone.id]);
    });

    it('programmatic CRUD are atomic undo steps', () => {
        const { ctrl } = setup();
        const d = ctrl.add('hline', { anchors: [{ time: 1, price: 1 }] })!;
        ctrl.update(d.id, { locked: true });
        expect(ctrl.all()[0]!.locked).toBe(true);
        ctrl.undo();
        expect(ctrl.all()[0]!.locked).toBe(false); // update reverted
        ctrl.undo();
        expect(ctrl.all().length).toBe(0); // add reverted
    });
});

describe('DrawingController — undo on the disabled / LwC controller', () => {
    it('records + reverts even without renderer support', () => {
        const { ctrl } = setup(false);
        ctrl.fromJSON({ version: 1, drawings: [{ ...HLINE_DOC, id: 'dw-1' }] });
        ctrl.update('dw-1', { style: { lineColor: '#123456', lineWidth: 1, lineStyle: 'solid' } });
        expect(ctrl.all()[0]!.style.lineColor).toBe('#123456');
        expect(ctrl.canUndo()).toBe(true);
        ctrl.undo();
        expect(ctrl.all()[0]!.style.lineColor).toBe('#fff'); // original from HLINE_DOC
    });
});

describe('buildToolbar grouping', () => {
    it('default toolbar groups registered types into seven canonical buttons with flyout sections', () => {
        const { definition, visible } = buildToolbar(true);
        expect(visible).toBe(true);

        expect(definition.groups.map((g) => g.id)).toEqual([
            'lines-channels-pitchforks',
            'fibonacci-gann',
            'patterns-waves-harmonics',
            'measurements',
            'brushes-arrows-shapes',
            'text',
            'icons',
        ]);

        const linesGroup = definition.groups.find((g) => g.id === 'lines-channels-pitchforks');
        expect(linesGroup?.label).toBe('Lines');
        expect(linesGroup?.sections?.map((s) => s.label)).toEqual(['Lines', 'Channels', 'Pitchforks']);
        expect(linesGroup?.sections?.find((s) => s.label === 'Lines')?.tools.map((t) => t.type).sort()).toEqual([
            'crossline',
            'extendedline',
            'hline',
            'hray',
            'infoline',
            'ray',
            'trendangle',
            'trendline',
            'vline',
        ]);
        expect(linesGroup?.sections?.find((s) => s.label === 'Channels')?.tools.map((t) => t.type)).toEqual([
            'parallelchannel',
            'disjointchannel',
            'flattopbottom',
            'regressionchannel',
        ]);
        expect(linesGroup?.sections?.find((s) => s.label === 'Pitchforks')?.tools.map((t) => t.type)).toEqual([
            'pitchfork',
            'schiffpitchfork',
            'modifiedschiffpitchfork',
            'insidepitchfork',
        ]);

        const fibGroup = definition.groups.find((g) => g.id === 'fibonacci-gann');
        expect(fibGroup?.sections?.map((s) => s.label)).toEqual(['Fibonacci', 'Gann', 'Geometry']);
        expect(fibGroup?.sections?.find((s) => s.label === 'Gann')?.tools.map((t) => t.type)).toEqual(['gannfan', 'gannbox', 'gannsquare']);
        expect(fibGroup?.sections?.find((s) => s.label === 'Geometry')?.tools.map((t) => t.type)).toEqual([
            'dedekind',
            'sonic',
            'supersonic',
            'goldensonic',
            'goldensupersonic',
        ]);

        const patternsGroup = definition.groups.find((g) => g.id === 'patterns-waves-harmonics');
        expect(patternsGroup?.sections?.map((s) => s.label)).toEqual(['Patterns', 'Elliott Waves', 'Harmonics']);
        expect(patternsGroup?.sections?.find((s) => s.label === 'Harmonics')?.tools.map((t) => t.type)).toEqual([
            'gartley',
            'bat',
            'butterfly',
            'crab',
            'shark',
            'cypher',
        ]);

        const shapesGroup = definition.groups.find((g) => g.id === 'brushes-arrows-shapes');
        expect(shapesGroup?.sections?.map((s) => s.label)).toEqual(['Brushes', 'Arrows', 'Shapes']);
        expect(shapesGroup?.sections?.find((s) => s.label === 'Brushes')?.tools.map((t) => t.type)).toEqual(['freehand', 'highlighter']);
        expect(shapesGroup?.sections?.find((s) => s.label === 'Arrows')?.tools.map((t) => t.type)).toEqual([
            'arrow',
            'arrowmarkup',
            'arrowmarkdown',
        ]);

        const textGroup = definition.groups.find((g) => g.id === 'text');
        expect(textGroup?.sections?.[0]?.tools.map((t) => t.type)).toEqual([
            'text',
            'callout',
            'note',
            'pricenote',
            'comment',
            'pricelabel',
            'signpost',
        ]);

        const iconsGroup = definition.groups.find((g) => g.id === 'icons');
        expect(iconsGroup?.sections?.[0]?.tools.map((t) => t.type)).toEqual(['flagmark', 'iconstamp']);

        const measureGroup = definition.groups.find((g) => g.id === 'measurements');
        expect(measureGroup?.label).toBe('Measurements');
        expect(measureGroup?.tools.map((t) => t.type)).toEqual(expect.arrayContaining(['datepricerange', 'position']));
        // Long/Short Position is the group's default (tools[0] arms when the button is clicked directly).
        expect(measureGroup?.tools[0]?.type).toBe('position');
        expect(measureGroup?.sections?.find((s) => s.label === 'Measurements')?.tools.map((t) => t.type)).toEqual(['position', 'datepricerange', 'magnifier']);
    });
    it('explicit groups resolve type keys + drop unknown ones', () => {
        const { definition } = buildToolbar({
            groups: [
                { id: 'lines', label: 'Lines', tools: ['trendline'] },
                { id: 'fib', label: 'Fibonacci', tools: ['fib-retracement' as never] }, // unregistered → empty → dropped
            ],
        });
        expect(definition.groups.map((g) => g.id)).toEqual(['lines']);
        expect(definition.groups[0]!.tools[0]!.label).toBe('Trend Line');
    });
    it('a tools subset auto-groups by declared group', () => {
        const { definition } = buildToolbar({ tools: ['hline'] });
        expect(definition.groups).toHaveLength(1);
        expect(definition.groups[0]!.tools[0]!.type).toBe('hline');
    });
});

describe('add() forwards per-type props', () => {
    it('seeds a glyph stamp from init.props', () => {
        const { ctrl } = setup();
        const d = ctrl.add('iconstamp', { paneId: 'price', anchors: [{ time: 0, price: 100 }], props: { glyph: '▲' } });
        expect((d as unknown as { glyph?: string })?.glyph).toBe('▲');
        expect(d?.serialize().props).toMatchObject({ glyph: '▲' });
    });
});

describe('drawing-tool favorites', () => {
    it('setFavorite round-trips, pushes the port, and emits drawing:favorites', () => {
        const { ctrl, port, events } = setup();
        const seen: string[][] = [];
        events.on('drawing:favorites', ({ favorites }) => seen.push(favorites));
        ctrl.setFavorite('trendline', true);
        ctrl.setFavorite('box', true);
        expect(ctrl.favorites()).toEqual(['trendline', 'box']);
        expect(ctrl.isFavorite('trendline')).toBe(true);
        expect(port.favoritesPushed[port.favoritesPushed.length - 1]).toEqual(['trendline', 'box']);
        expect(seen[seen.length - 1]).toEqual(['trendline', 'box']);
        // no-op toggles don't emit
        const n = seen.length;
        ctrl.setFavorite('trendline', true);
        expect(seen.length).toBe(n);
        ctrl.setFavorite('trendline', false);
        expect(ctrl.favorites()).toEqual(['box']);
    });

    it('setToolShortcuts pushes the hint map to the port (display strings pass through untouched)', () => {
        const { ctrl, port } = setup();
        ctrl.setToolShortcuts({ trendline: 'Alt+T', hline: 'Alt+H', vline: 'Alt+V' });
        expect(port.shortcutsPushed).toEqual([{ trendline: 'Alt+T', hline: 'Alt+H', vline: 'Alt+V' }]);
    });

    it('starring NEVER arms a tool (the star is a side action on the flyout row)', () => {
        const { ctrl, port } = setup();
        ctrl.setTool('hline');
        port.activeTool = 'hline';
        port.fire({ kind: 'favorite', type: 'trendline', on: true }); // star a DIFFERENT tool
        expect(ctrl.isFavorite('trendline')).toBe(true);
        expect(ctrl.getTool()).toBe('hline'); // the armed tool is untouched
        expect(port.activeTool).toBe('hline'); // and the renderer was never re-armed
    });

    it('setFavorites bulk-replaces and drops unknown types; the star intent routes', () => {
        const { ctrl, port } = setup();
        ctrl.setFavorites(['hline', 'nope-tool' as never, 'ray']);
        expect(ctrl.favorites()).toEqual(['hline', 'ray']);
        // renderer star click → intent → state
        port.fire({ kind: 'favorite', type: 'box', on: true });
        expect(ctrl.isFavorite('box')).toBe(true);
        port.fire({ kind: 'favorite', type: 'box', on: false });
        expect(ctrl.isFavorite('box')).toBe(false);
    });
});

describe('DrawingController — tool/mode seams (the external-toolbar surface)', () => {
    it('setTool emits drawing:tool on CHANGE only (arm, re-arm no-op, tool-finished)', () => {
        const { port, events, ctrl } = setup();
        const tools: Array<string | null> = [];
        events.on('drawing:tool', (e) => tools.push(e.type));

        ctrl.setTool('trendline');
        ctrl.setTool('trendline'); // re-arm same tool → port push, but no duplicate event
        port.fire({ kind: 'tool-finished', type: 'trendline' }); // one-shot → back to pointer
        expect(tools).toEqual(['trendline', null]);
        expect(ctrl.getTool()).toBe(null);
    });

    it('setSnapMode pushes the port command, mirrors, emits — and equal values no-op', () => {
        const { port, events, ctrl } = setup();
        const snaps: string[] = [];
        events.on('drawing:snap', (e) => snaps.push(e.mode));

        ctrl.setSnapMode('strong');
        ctrl.setSnapMode('strong'); // no-op
        expect(port.snapModes).toEqual(['strong']);
        expect(ctrl.getSnapMode()).toBe('strong');
        expect(snaps).toEqual(['strong']);
    });

    it('an in-chart magnet click arrives as a snap-mode intent: mirror + event, echo-safe', () => {
        const { port, events, ctrl } = setup();
        const snaps: string[] = [];
        events.on('drawing:snap', (e) => snaps.push(e.mode));

        port.fire({ kind: 'snap-mode', mode: 'weak' });
        port.fire({ kind: 'snap-mode', mode: 'weak' }); // renderer echo of an equal value → dropped
        expect(ctrl.getSnapMode()).toBe('weak');
        expect(snaps).toEqual(['weak']);
        expect(port.snapModes).toEqual([]); // an intent must never bounce back as a command
    });

    it('setStayMode pushes the port command, mirrors, emits — and equal values no-op', () => {
        const { port, events, ctrl } = setup();
        const stays: boolean[] = [];
        events.on('drawing:stay', (e) => stays.push(e.on));

        ctrl.setStayMode(true);
        ctrl.setStayMode(true); // no-op
        expect(port.stayModes).toEqual([true]);
        expect(ctrl.getStayMode()).toBe(true);
        expect(stays).toEqual([true]);
    });

    it('an in-chart stay-mode click arrives as a stay-mode intent: mirror + event, echo-safe', () => {
        const { port, events, ctrl } = setup();
        const stays: boolean[] = [];
        events.on('drawing:stay', (e) => stays.push(e.on));

        port.fire({ kind: 'stay-mode', on: true });
        port.fire({ kind: 'stay-mode', on: true }); // renderer echo of an equal value → dropped
        expect(ctrl.getStayMode()).toBe(true);
        expect(stays).toEqual([true]);
        expect(port.stayModes).toEqual([]); // an intent must never bounce back as a command
    });

    it('setMode pushes the port command; the renderer intent reports the outcome', () => {
        const { port, events, ctrl } = setup();
        const modes: Array<string | null> = [];
        events.on('drawing:mode', (e) => modes.push(e.mode));

        ctrl.setMode('measure');
        expect(port.modes).toEqual(['measure']);
        expect(ctrl.getMode()).toBe('measure');
        // The renderer applies + echoes the same value — dropped (no duplicate event).
        port.fire({ kind: 'mode', mode: 'measure' });
        // A mutual-exclusion side effect (user armed a tool in-chart) exits the mode.
        port.fire({ kind: 'mode', mode: null });
        expect(ctrl.getMode()).toBe(null);
        expect(modes).toEqual(['measure', null]);
    });

    it('mode/snap/stay setters are inert without a port (headless), like the other interactive ops', () => {
        const { ctrl } = setup(false);
        ctrl.setSnapMode('strong');
        ctrl.setStayMode(true);
        ctrl.setMode('eraser');
        expect(ctrl.getSnapMode()).toBe('off'); // mirrors keep their defaults
        expect(ctrl.getStayMode()).toBe(false);
        expect(ctrl.getMode()).toBe(null);
    });
});
