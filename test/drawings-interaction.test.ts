import { describe, it, expect } from 'vitest';
import { DrawingInteraction } from '../src/renderers/native/drawings/DrawingInteraction';
import { createProjector } from '../src/renderers/native/drawings/Projector';
import { effectiveSnapMode } from '../src/renderers/native/core/InputController';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { createDrawing, DEFAULT_DRAWING_COLOR, type Drawing, type DrawingIntent, type DrawingStyle, type DrawingTypeKey, type Projector } from '../src/core/drawings';

/** Linear projector: x = time, y = 100 − price, single pane 'price'. */
function fakeProjector(): Projector {
    return {
        xOf: (t) => t,
        yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
        pxToPoint: (x, y) => ({ time: x, price: 100 - y }),
        paneIdAtY: () => 'price',
        width: 200,
        height: 100,
    };
}

function harness(tool: DrawingTypeKey | null, drawings: Drawing[] = []) {
    let active = tool;
    let hovered: string | null = null;
    let lastStyle: DrawingStyle | undefined;
    const selected = new Set<string>();
    const intents: DrawingIntent[] = [];
    const settings: Array<[string, number, number]> = [];
    let changes = 0;
    const it = new DrawingInteraction({
        projector: fakeProjector,
        activeTool: () => active,
        drawings: () => drawings,
        hoveredId: () => hovered,
        selectedIds: () => selected,
        emit: (i) => intents.push(i),
        changed: () => (changes += 1),
        openSettings: (id, x, y) => settings.push([id, x, y]),
        // fake "candle snap": round both axes to the nearest 10. In weak mode, only snap when the
        // snapped pixel is within 2px of the cursor (fake projector: x=time, y=100−price).
        snap: (pt, _paneId, mode, cursorPx) => {
            const snapped = { time: Math.round(pt.time / 10) * 10, price: Math.round(pt.price / 10) * 10 };
            if (mode === 'weak' && cursorPx) {
                const dist = Math.hypot(snapped.time - cursorPx.x, 100 - snapped.price - cursorPx.y);
                if (dist > 2) return { time: pt.time, price: pt.price };
            }
            return snapped;
        },
        lastStyle: () => lastStyle,
    });
    return {
        it,
        intents,
        settings,
        setTool: (t: DrawingTypeKey | null) => (active = t),
        setHovered: (s: string | null) => (hovered = s),
        setLastStyle: (s: DrawingStyle | undefined) => (lastStyle = s),
        setSelected: (ids: string[]) => {
            selected.clear();
            for (const id of ids) selected.add(id);
        },
        changes: () => changes,
    };
}

describe('DrawingInteraction: placing', () => {
    it('a 2-anchor trend line places over two clicks + a moving ghost', () => {
        const h = harness('trendline');
        h.it.down(10, 90); // p1 → price 10
        expect(h.it.isPlacing()).toBe(true);
        expect(h.it.ghost()).toBeNull(); // no cursor yet
        h.it.move(40, 60); // cursor → ghost appears
        expect(h.it.ghost()).not.toBeNull();
        h.it.down(40, 60); // p2 → finalize
        expect(h.it.isPlacing()).toBe(false);
        const create = h.intents.find((i) => i.kind === 'create');
        expect(create).toBeDefined();
        if (create?.kind === 'create') {
            expect(create.doc.type).toBe('trendline');
            expect(create.doc.anchors).toHaveLength(2);
            expect(create.doc.anchors[0]).toEqual({ time: 10, price: 10 });
        }
        expect(h.intents.some((i) => i.kind === 'tool-finished')).toBe(true);
    });

    it('the placement ghost previews the last-used style, not the type default', () => {
        const h = harness('trendline');
        h.setLastStyle({ lineColor: '#ff0000', lineWidth: 4, lineStyle: 'dashed' });
        h.it.down(10, 90); // p1
        h.it.move(40, 60); // cursor → ghost appears
        const ghost = h.it.ghost();
        expect(ghost).not.toBeNull();
        expect(ghost!.style.lineColor).toBe('#ff0000');
        expect(ghost!.style.lineWidth).toBe(4);
        expect(ghost!.style.lineStyle).toBe('dashed');
    });

    it('falls back to the type default color when no last-used style exists', () => {
        const h = harness('trendline');
        h.it.down(10, 90);
        h.it.move(40, 60);
        const ghost = h.it.ghost();
        expect(ghost).not.toBeNull();
        expect(ghost!.style.lineColor).toBe(DEFAULT_DRAWING_COLOR);
    });

    it('exposes control-circle markers for the points placed so far while placing', () => {
        const proj = fakeProjector();
        const h = harness('pitchfork');
        expect(h.it.placingMarkers(proj)).toBeNull(); // nothing placed yet
        h.it.down(10, 90); // place the pivot → immediately visible (before the shape can render)
        expect(h.it.placingMarkers(proj)).toEqual([[10, 90]]);
        h.it.move(40, 60);
        h.it.down(40, 60); // place the 2nd anchor
        expect(h.it.placingMarkers(proj)).toEqual([[10, 90], [40, 60]]);
        h.it.move(40, 20);
        h.it.down(40, 20); // 3rd anchor finalizes → no longer placing
        expect(h.it.placingMarkers(proj)).toBeNull();
    });

    it('a 1-anchor hline finalizes on the first click', () => {
        const h = harness('hline');
        h.it.down(50, 70); // price 30
        expect(h.it.isPlacing()).toBe(false);
        const create = h.intents.find((i) => i.kind === 'create');
        expect(create?.kind === 'create' && create.doc.anchors).toHaveLength(1);
    });

    it('parallel channel width tracks the cursor (no jump-open) after the sloped baseline is set', () => {
        const h = harness('parallelchannel');
        h.it.down(0, 100); // p1 → {time:0, price:0}
        h.it.move(50, 50); // ghost trendline toward p2
        h.it.down(50, 50); // p2 → {time:50, price:50} (a sloped baseline)
        expect(h.it.isPlacing()).toBe(true);

        // Cursor ON the baseline (its own time) → the channel stays collapsed (offset 0),
        // whatever the cursor's time. Raw-cursor math would have opened it by ~half the span.
        h.it.move(50, 50); // on the baseline at p2
        expect(h.it.ghost()!.anchors[2]).toEqual({ time: 25, price: 25 }); // midpoint price, offset 0
        h.it.move(10, 90); // still on the baseline, but near p1
        expect(h.it.ghost()!.anchors[2]).toEqual({ time: 25, price: 25 }); // unchanged → no jump

        // Move 8 above the baseline near p2 → the parallel line sits 8 above (tracks the cursor).
        h.it.move(50, 42); // {time:50, price:58}; baseline there = 50 → gap +8
        expect(h.it.ghost()!.anchors[2]).toEqual({ time: 25, price: 33 }); // midprice 25 + 8

        h.it.down(50, 42); // commit
        expect(h.it.isPlacing()).toBe(false);
        const create = h.intents.find((i) => i.kind === 'create');
        expect(create?.kind === 'create' && create.doc.anchors).toEqual([
            { time: 0, price: 0 },
            { time: 50, price: 50 },
            { time: 25, price: 33 },
        ]);
    });

    it('Escape cancels an in-progress placement', () => {
        const h = harness('trendline');
        h.it.down(10, 90);
        expect(h.it.cancel()).toBe(true);
        expect(h.it.isPlacing()).toBe(false);
        expect(h.intents.some((i) => i.kind === 'tool-finished')).toBe(true);
        expect(h.intents.some((i) => i.kind === 'create')).toBe(false);
    });

    it('strong magnet snaps placed anchors + exposes a ring marker', () => {
        const h = harness('trendline');
        h.it.down(13, 88, 'strong'); // raw {time:13, price:12} → snapped {10,10}
        h.it.move(47, 64, 'strong'); // raw {time:47, price:36} → snapped {50,40}, ring marker set
        expect(h.it.snapMarker()).toEqual({ point: { time: 50, price: 40 }, paneId: 'price' });
        h.it.down(47, 64, 'strong'); // finalize at snapped p2
        const create = h.intents.find((i) => i.kind === 'create');
        expect(create?.kind === 'create' && create.doc.anchors).toEqual([
            { time: 10, price: 10 },
            { time: 50, price: 40 },
        ]);
        expect(h.it.snapMarker()).toBeNull(); // cleared on finalize
    });

    it('off magnet never snaps and shows no ring', () => {
        const h = harness('trendline');
        h.it.down(13, 88); // mode defaults to 'off'
        h.it.move(47, 64);
        expect(h.it.snapMarker()).toBeNull();
    });

    it('weak magnet snaps only within the cursor radius (else no snap, no ring)', () => {
        const near = harness('trendline');
        near.it.down(11, 89, 'weak'); // snapped {10,10} sits ~1.4px from the cursor → snaps
        near.it.move(11, 89, 'weak');
        expect(near.it.snapMarker()).toEqual({ point: { time: 10, price: 10 }, paneId: 'price' });

        const far = harness('trendline');
        far.it.move(15, 85, 'weak'); // nearest grid {20,20} is ~7px away → no snap, no ring
        expect(far.it.snapMarker()).toBeNull();
    });
});

describe('DrawingInteraction: selection + claim', () => {
    const hline = () => createDrawing('hline', { id: 'dw-1', paneId: 'price', anchors: [{ time: 10, price: 30 }] })!;

    it('claims when armed, when placing, or over a drawing — yields on empty space', () => {
        const armed = harness('trendline');
        expect(armed.it.claim(5, 5)).toBe(true); // armed → always

        const idle = harness(null, [hline()]); // hline at y=70
        expect(idle.it.claim(50, 70)).toBe(true); // over the drawing
        expect(idle.it.claim(50, 10)).toBe(false); // empty space → pan
    });

    it('a click on a drawing opens its settings; an empty press does nothing', () => {
        const h = harness(null, [hline()]);
        h.it.down(50, 70);
        h.it.up(50, 70); // click (no move) on the hline
        expect(h.settings).toEqual([['dw-1', 50, 70]]); // settings popup requested
        h.it.down(50, 10);
        h.it.up(50, 10); // click on empty space → no press captured, no settings
        expect(h.settings).toHaveLength(1);
    });

    it('shift-click toggles selection (additive) without dragging or opening settings', () => {
        const h = harness(null, [hline()]);
        h.it.down(50, 70, 'off', true); // shift-click the hline (no magnet)
        const sel = h.intents.find((i) => i.kind === 'select');
        expect(sel?.kind === 'select' && sel.ids).toEqual(['dw-1']);
        expect(sel?.kind === 'select' && sel.additive).toBe(true);
        h.it.up(50, 70);
        expect(h.settings).toHaveLength(0); // shift-click is selection-only
    });
});

describe('DrawingInteraction: click-move-click placement (measurement / position)', () => {
    it('a measurement box is placed click → move → click (2 anchors)', () => {
        const h = harness('datepricerange');
        h.it.down(10, 90); // click the first corner
        h.it.move(40, 60); // move freely (live preview)
        expect(h.it.isPlacing()).toBe(true);
        expect(h.intents.some((i) => i.kind === 'create')).toBe(false); // nothing until the 2nd click
        h.it.down(40, 60); // click the opposite corner → finalize
        const create = h.intents.find((i) => i.kind === 'create');
        expect(create?.kind === 'create' && create.doc.type).toBe('datepricerange');
        expect(create?.kind === 'create' && create.doc.anchors).toHaveLength(2);
    });

    it('a long position click-move-click → 3 anchors, target above the entry (stop below = long)', () => {
        const h = harness('position');
        h.it.down(20, 60); // entry (price 40)
        h.it.move(40, 80);
        h.it.down(40, 80); // stop below the entry (price 20) → long
        const create = h.intents.find((i) => i.kind === 'create');
        expect(create?.kind === 'create' && create.doc.anchors).toHaveLength(3);
        if (create?.kind === 'create') {
            const [entry, , target] = create.doc.anchors;
            expect(target!.price).toBeGreaterThan(entry!.price); // reward above → long
        }
    });

    it('placing the stop the other way flips to short (target below entry)', () => {
        const h = harness('position');
        h.it.down(20, 60); // entry (price 40)
        h.it.move(40, 40);
        h.it.down(40, 40); // stop above the entry (price 60) → short
        const create = h.intents.find((i) => i.kind === 'create');
        if (create?.kind === 'create') {
            const [entry, , target] = create.doc.anchors;
            expect(target!.price).toBeLessThan(entry!.price); // reward below → short
        }
    });

    it('a degenerate second click (≈ the entry) drops a default position box (3 anchors)', () => {
        const h = harness('position');
        h.it.down(30, 50); // entry
        h.it.down(30, 50); // second click ≈ the entry → default R:R box
        const create = h.intents.find((i) => i.kind === 'create');
        expect(create?.kind === 'create' && create.doc.anchors).toHaveLength(3);
    });

    it('a single click leaves a range placing (waiting for the second click)', () => {
        const h = harness('datepricerange');
        h.it.down(10, 90); // one click → still placing, nothing committed yet
        expect(h.it.isPlacing()).toBe(true);
        expect(h.intents.some((i) => i.kind === 'create')).toBe(false);
    });
});

describe('DrawingInteraction: variable + freehand placement', () => {
    it('polyline: clicks add vertices; a double-click drops the dup and finalizes', () => {
        const h = harness('polyline');
        h.it.down(10, 90); // v1
        h.it.move(40, 60);
        h.it.down(40, 60); // v2
        h.it.move(70, 90);
        h.it.down(70, 90); // v3
        expect(h.it.isPlacing()).toBe(true); // variable → keeps going
        h.it.down(70, 90); // the 2nd click of a double-click (duplicate)
        expect(h.it.finishPlacing(true)).toBe(true);
        const create = h.intents.find((i) => i.kind === 'create');
        expect(create?.kind === 'create' && create.doc.type).toBe('polyline');
        expect(create?.kind === 'create' && create.doc.anchors.length).toBe(3); // the duplicate was dropped
    });

    it('freehand: press + drag captures a path; release finalizes', () => {
        const h = harness('freehand');
        h.it.down(10, 90); // start
        h.it.move(30, 70);
        h.it.move(50, 50);
        h.it.move(70, 30); // drag → sampled points
        expect(h.it.isPlacing()).toBe(true);
        h.it.up(70, 30); // release → finalize
        const create = h.intents.find((i) => i.kind === 'create');
        expect(create?.kind === 'create' && create.doc.type).toBe('freehand');
        expect(create?.kind === 'create' && (create.doc.anchors.length >= 3)).toBe(true);
    });

    it('freehand: a bare click with no drag keeps nothing', () => {
        const h = harness('freehand');
        h.it.down(10, 90);
        h.it.up(10, 90); // never moved → discard
        expect(h.intents.some((i) => i.kind === 'create')).toBe(false);
        expect(h.intents.some((i) => i.kind === 'tool-finished')).toBe(true);
    });
});

describe('DrawingInteraction: dragging', () => {
    const trend = () =>
        createDrawing('trendline', { id: 'dw-1', paneId: 'price', anchors: [{ time: 10, price: 10 }, { time: 50, price: 50 }] })!;
    const hline = () => createDrawing('hline', { id: 'dw-2', paneId: 'price', anchors: [{ time: 10, price: 30 }] })!;

    it('a press that moves past the slop becomes a whole-body drag (no settings popup)', () => {
        const d = trend();
        const h = harness(null, [d]);
        h.it.down(30, 70); // press the body — not a drag yet
        expect(h.it.isDragging()).toBe(false);
        h.it.move(40, 65); // dt=+10, dp=+5 → now dragging
        expect(h.it.isDragging()).toBe(true);
        h.it.up(40, 65);
        const edit = h.intents.find((i) => i.kind === 'edit');
        expect(edit?.kind === 'edit' && edit.doc.anchors).toEqual([
            { time: 20, price: 15 },
            { time: 60, price: 55 },
        ]);
        expect(h.settings).toHaveLength(0); // a drag does NOT open settings
    });

    it('handle drag moves only the grabbed anchor', () => {
        const d = trend();
        const h = harness(null, [d]);
        h.setHovered('dw-1'); // hovering shows handles → its handle is grabbable
        h.it.down(10, 90); // grab handle p1 (pixel of anchor 0)
        h.it.move(15, 85);
        h.it.up(15, 85);
        const edit = h.intents.find((i) => i.kind === 'edit');
        expect(edit?.kind === 'edit' && edit.doc.anchors[0]).toEqual({ time: 15, price: 15 });
        expect(edit?.kind === 'edit' && edit.doc.anchors[1]).toEqual({ time: 50, price: 50 });
    });

    it('grabs an off-body handle of a SELECTED drawing (e.g. an ellipse bounding-box corner)', () => {
        // ellipse box (0,0)→(40,40): corner handle sits at px (40,60), OUTSIDE the curve
        const e = createDrawing('ellipse', { id: 'dw-9', paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 40, price: 40 }] })!;
        const h = harness(null, [e]);
        h.setSelected(['dw-9']); // selected (popup open) but NOT hovered
        h.it.down(40, 60); // press the corner handle off the ellipse body
        h.it.move(45, 55); // drag it
        h.it.up(45, 55);
        const edit = h.intents.find((i) => i.kind === 'edit');
        expect(edit?.kind === 'edit' && edit.doc.anchors[1]).toEqual({ time: 45, price: 45 }); // corner moved → grabbable
    });

    it('a y-only handle (hline) ignores horizontal motion', () => {
        const d = hline();
        const h = harness(null, [d]);
        h.setHovered('dw-2');
        h.it.down(10, 70); // handle of the hline (anchor at price 30 → y=70)
        h.it.move(40, 60); // would change time to 40, but free='y'
        h.it.up(40, 60);
        const edit = h.intents.find((i) => i.kind === 'edit');
        expect(edit?.kind === 'edit' && edit.doc.anchors[0]).toEqual({ time: 10, price: 40 });
    });

    it('a locked drawing opens settings on click but never drags', () => {
        const d = trend();
        d.locked = true;
        const h = harness(null, [d]);
        h.it.down(30, 70);
        h.it.move(40, 65); // locked → ignored, stays a click
        expect(h.it.isDragging()).toBe(false);
        h.it.up(40, 65);
        expect(h.intents.some((i) => i.kind === 'edit')).toBe(false); // never moved
        expect(h.settings).toEqual([['dw-1', 40, 65]]); // click → settings
    });

    it('Escape during a drag restores the original anchors', () => {
        const d = trend();
        const h = harness(null, [d]);
        h.it.down(30, 70);
        h.it.move(40, 65);
        expect(h.it.cancel()).toBe(true);
        expect(d.anchors).toEqual([{ time: 10, price: 10 }, { time: 50, price: 50 }]);
        expect(h.intents.some((i) => i.kind === 'edit')).toBe(false);
    });
});

describe('effectiveSnapMode', () => {
    it('Ctrl/Cmd forces strong; otherwise the sticky toolbar mode wins', () => {
        expect(effectiveSnapMode(true, 'off')).toBe('strong');
        expect(effectiveSnapMode(true, 'weak')).toBe('strong');
        expect(effectiveSnapMode(false, 'off')).toBe('off');
        expect(effectiveSnapMode(false, 'weak')).toBe('weak');
        expect(effectiveSnapMode(false, 'strong')).toBe('strong');
    });
});

describe('createProjector round-trips against the real CoordinateSystem', () => {
    it('pxToPoint → xOf/yOf recovers the pixel (within rounding)', () => {
        const coords = new CoordinateSystem();
        coords.setSize(800, 400, 1);
        coords.setBars([1000, 2000, 3000, 4000, 5000]);
        coords.setViewport({ barSpacing: 12, rightOffset: 3 });
        const proj = createProjector(
            coords,
            () => ({ scale: { min: 0, max: 100 }, bounds: { top: 0, height: 400 } }),
            () => 'price',
        );
        const p = proj.pxToPoint(420, 150, 'price');
        expect(proj.xOf(p.time)).toBeCloseTo(420, 5);
        expect(proj.yOf(p.price, 'price')).toBeCloseTo(150, 5);
    });
});
