import { describe, expect, it, vi } from 'vitest';
import { createDrawing, type Drawing, type DrawingIntent, type Projector } from '../src/core/drawings';
import type { VelaTheme } from '../src/core/options';
import { DrawingInteraction } from '../src/renderers/native/drawings/DrawingInteraction';
import { drawingsIntersectingRect, plotRect, rectsIntersect } from '../src/renderers/native/drawings/DrawingHitTester';
import { DrawingPainter } from '../src/renderers/native/drawings/DrawingPainter';
import { UserDrawingController } from '../src/renderers/native/drawings/UserDrawingController';

function projector(panes = false): Projector {
    return {
        xOf: (time) => time,
        yOf: (price, paneId) => (paneId === 'gone' ? null : 100 - price),
        pxToPoint: (x, y) => ({ time: x, price: 100 - y }),
        paneIdAtY: (y) => (y < 60 ? 'price' : 'study'),
        paneRect: panes
            ? (paneId) => paneId === 'price'
                ? { top: 0, height: 60 }
                : paneId === 'study'
                    ? { top: 60, height: 40 }
                    : paneId === 'hidden'
                        ? { top: 60, height: 0 }
                        : null
            : undefined,
        width: 200,
        height: 100,
    };
}

function line(id: string, paneId: string, x1: number, y1: number, x2: number, y2: number): Drawing {
    return createDrawing('trendline', {
        id,
        paneId,
        anchors: [
            { time: x1, price: 100 - y1 },
            { time: x2, price: 100 - y2 },
        ],
    })!;
}

function harness(drawings: Drawing[]) {
    const intents: DrawingIntent[] = [];
    const selected = new Set<string>();
    let changes = 0;
    const interaction = new DrawingInteraction({
        projector,
        activeTool: () => null,
        drawings: () => drawings,
        hoveredId: () => null,
        selectedIds: () => selected,
        emit: (intent) => intents.push(intent),
        changed: () => { changes += 1; },
        openSettings: () => {},
        snap: (point) => point,
        lastStyle: () => undefined,
    });
    return { interaction, intents, selected, changes: () => changes };
}

describe('drawing marquee geometry', () => {
    it('normalizes reverse drags, clips to the plot, and treats edge contact as intersection', () => {
        expect(plotRect(220, 120, -10, -20, projector())).toEqual({ x: 0, y: 0, w: 200, h: 100 });
        expect(plotRect(80, 70, 20, 10, projector())).toEqual({ x: 20, y: 10, w: 60, h: 60 });
        expect(rectsIntersect({ x: 0, y: 0, w: 20, h: 20 }, { x: 20, y: 20, w: 0, h: 0 })).toBe(true);
    });

    it.each([
        [20, 10, 80, 70],
        [80, 10, 20, 70],
        [20, 70, 80, 10],
        [80, 70, 20, 10],
    ])('normalizes a drag from (%d,%d) to (%d,%d)', (x1, y1, x2, y2) => {
        expect(plotRect(x1, y1, x2, y2, projector())).toEqual({ x: 20, y: 10, w: 60, h: 60 });
    });

    it('returns visible, finite, projectable hits in paint order and clips each drawing to its pane', () => {
        const a = line('a', 'price', 10, 10, 30, 30);
        const b = line('b', 'study', 20, 70, 40, 90);
        const outsidePane = line('outside-pane', 'price', 20, 70, 40, 80);
        const hiddenDrawing = line('hidden-drawing', 'study', 20, 70, 40, 80);
        hiddenDrawing.visible = false;
        const hiddenPane = line('hidden-pane', 'hidden', 20, 70, 40, 80);
        const gonePane = line('gone-pane', 'gone', 20, 70, 40, 80);
        const invalid = line('invalid', 'price', 20, 20, 40, 40);
        invalid.bounds = () => ({ x: NaN, y: 0, w: 10, h: 10 });
        const drawings = [a, b, outsidePane, hiddenDrawing, hiddenPane, gonePane, invalid];

        expect(drawingsIntersectingRect(drawings, { x: 25, y: 20, w: 10, h: 60 }, projector(true))).toEqual(['a', 'b']);
    });
});

describe('DrawingInteraction marquee', () => {
    it('stays pending until moved, then paints a clipped rectangle and commits one replacement intent', () => {
        const h = harness([
            line('back', 'price', 20, 20, 40, 40),
            line('front', 'price', 60, 40, 90, 20),
            line('miss', 'price', 130, 20, 150, 40),
        ]);
        expect(h.interaction.startMarquee(100, 80, false)).toBe(true);
        expect(h.interaction.marqueeRect()).toBeNull();
        expect(h.intents).toEqual([]);

        h.interaction.moveMarquee(10, -20);
        expect(h.interaction.marqueeRect()).toEqual({ x: 10, y: 0, w: 90, h: 80 });
        expect(h.intents).toEqual([]); // selection does not change during the preview

        expect(h.interaction.finishMarquee(10, -20)).toBe(true);
        expect(h.intents).toEqual([{ kind: 'select', ids: ['back', 'front'] }]);
        expect(h.interaction.marqueeRect()).toBeNull();
    });

    it('latches additive union and its base selection at pointer-down without toggling hits', () => {
        const h = harness([
            line('base', 'price', 150, 10, 170, 20),
            line('already-hit', 'price', 20, 20, 40, 40),
            line('new-hit', 'price', 50, 20, 70, 40),
        ]);
        h.selected.add('base');
        h.selected.add('already-hit');
        h.interaction.startMarquee(10, 10, true);
        h.selected.clear(); // live selection changes do not redefine the gesture
        h.interaction.moveMarquee(80, 50);
        h.interaction.finishMarquee(80, 50);

        expect(h.intents).toEqual([{ kind: 'select', ids: ['base', 'already-hit', 'new-hit'] }]);
    });

    it('cancels pending and visible marquees without emitting a selection intent', () => {
        const pending = harness([]);
        pending.interaction.startMarquee(10, 10, false);
        expect(pending.interaction.cancel()).toBe(true);
        expect(pending.intents).toEqual([]);

        const active = harness([]);
        active.interaction.startMarquee(10, 10, false);
        active.interaction.moveMarquee(50, 50);
        expect(active.interaction.cancelMarquee()).toBe(true);
        expect(active.intents).toEqual([]);
        expect(active.interaction.marqueeRect()).toBeNull();
    });
});

/** Build only the keyboard-facing slice of the real controller. Its constructor owns
 * DOM-heavy toolbar and popup views, while handleKey itself depends on these explicit
 * state collaborators. */
function keyboardController(fields: Record<string, unknown>): UserDrawingController {
    const controller = Object.create(UserDrawingController.prototype) as Record<string, unknown>;
    Object.assign(controller, {
        textEditor: null,
        popup: { isOpen: () => false, close: () => {} },
        measureMode: false,
        selectedIds: new Set<string>(),
        hoveredId: null,
        drawings: [],
        intentCb: null,
        ...fields,
    });
    return controller as unknown as UserDrawingController;
}

describe('UserDrawingController marquee keyboard routing', () => {
    it('resolves a sub-slop marquee as an ordinary empty click that clears selection', () => {
        const cancelMarquee = vi.fn();
        const clearSelection = vi.fn();
        const controller = keyboardController({
            interaction: { cancelMarquee },
            clearSelection,
        });

        controller.marqueeClick();

        expect(cancelMarquee).toHaveBeenCalledOnce();
        expect(clearSelection).toHaveBeenCalledOnce();
    });

    it('refuses a settings-popup delete when the drawing is locked after the popup opens', () => {
        const drawing = line('locked-live', 'price', 10, 10, 20, 20);
        let remove: (() => void) | undefined;
        const intents: DrawingIntent[] = [];
        const controller = keyboardController({
            drawings: [drawing],
            deps: { projector: () => projector(), theme: () => ({ background: '#000' }) },
            popup: {
                open: (_drawing: Drawing, _anchor: unknown, actions: { remove(): void }) => { remove = actions.remove; },
                close: vi.fn(),
                isOpen: () => false,
            },
            intentCb: (intent: DrawingIntent) => intents.push(intent),
        });
        controller.openSettings(drawing.id);
        drawing.locked = true;

        remove!();

        expect(intents.filter((intent) => intent.kind === 'delete')).toEqual([]);
    });

    it('routes Escape through the active marquee cancel without changing the existing selection', () => {
        const h = harness([line('kept', 'price', 10, 10, 20, 20)]);
        h.selected.add('kept');
        h.interaction.startMarquee(30, 30, true);
        h.interaction.moveMarquee(80, 80);
        const controller = keyboardController({
            interaction: h.interaction,
            selectedIds: h.selected,
            drawings: [],
        });

        expect(controller.handleKey({ key: 'Escape', target: null } as unknown as KeyboardEvent)).toBe(true);
        expect(h.interaction.marqueeRect()).toBeNull();
        expect([...h.selected]).toEqual(['kept']);
        expect(h.intents).toEqual([]);
    });

    it('routes Delete with selected unlocked IDs while retaining locked selections', () => {
        const first = line('first', 'price', 10, 10, 20, 20);
        const locked = line('locked', 'price', 30, 10, 40, 20);
        const second = line('second', 'price', 50, 10, 60, 20);
        locked.locked = true;
        const intents: DrawingIntent[] = [];
        const close = vi.fn();
        const selectedIds = new Set(['locked', 'second', 'first']);
        const controller = keyboardController({
            popup: { isOpen: () => false, close },
            interaction: { cancel: () => false },
            selectedIds,
            drawings: [first, locked, second],
            intentCb: (intent: DrawingIntent) => intents.push(intent),
        });

        expect(controller.handleKey({ key: 'Delete', target: null } as unknown as KeyboardEvent)).toBe(true);
        expect(intents).toEqual([{ kind: 'delete', ids: ['second', 'first'] }]);
        expect([...selectedIds]).toEqual(['locked', 'second', 'first']);
        expect(close).toHaveBeenCalledOnce();
    });
});

describe('DrawingPainter marquee', () => {
    it('paints a theme-aware fill and dashed selection outline at the supplied rectangle', () => {
        const fills: Array<{ args: number[]; style: string }> = [];
        const strokes: Array<{ args: number[]; style: string }> = [];
        const dashes: number[][] = [];
        let fillStyle = '';
        let strokeStyle = '';
        const context = {
            get fillStyle() { return fillStyle; },
            set fillStyle(value: string) { fillStyle = value; },
            get strokeStyle() { return strokeStyle; },
            set strokeStyle(value: string) { strokeStyle = value; },
            lineWidth: 0,
            save() {},
            restore() {},
            setLineDash(dash: number[]) { dashes.push(dash); },
            fillRect(...args: number[]) { fills.push({ args, style: fillStyle }); },
            strokeRect(...args: number[]) { strokes.push({ args, style: strokeStyle }); },
        } as unknown as CanvasRenderingContext2D;
        const theme = { textColor: '#ffffff' } as VelaTheme;

        new DrawingPainter().paintMarquee(context, { x: 10, y: 20, w: 30, h: 40 }, theme);

        expect(fills).toEqual([{ args: [10, 20, 30, 40], style: 'rgba(255,255,255,0.08)' }]);
        expect(strokes).toEqual([{ args: [10, 20, 30, 40], style: '#38c0fd' }]);
        expect(dashes).toEqual([[4, 3]]);
    });
});
