import { describe, it, expect } from 'vitest';
import { DrawingInteraction } from '../src/renderers/native/drawings/DrawingInteraction';
import { createProjector } from '../src/renderers/native/drawings/Projector';
import { effectiveSnapMode } from '../src/renderers/native/core/InputController';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { createDrawing, DEFAULT_DRAWING_COLOR, MAX_PATH_POINTS, type Drawing, type DrawingIntent, type DrawingStyle, type DrawingTypeKey, type Projector } from '../src/core/drawings';

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

describe('DrawingInteraction: snapCursor (measure-ruler magnet)', () => {
    it('strong magnet returns the snapped pixel and sets the ring', () => {
        const h = harness(null);
        // (13, 88) → raw {time:13, price:12} → snapped {10, 10} → pixel (10, 90)
        expect(h.it.snapCursor(13, 88, 'strong')).toEqual({ x: 10, y: 90 });
        expect(h.it.snapMarker()).toEqual({ point: { time: 10, price: 10 }, paneId: 'price' });
    });

    it('off magnet returns the raw pixel and shows no ring', () => {
        const h = harness(null);
        expect(h.it.snapCursor(13, 88, 'off')).toEqual({ x: 13, y: 88 });
        expect(h.it.snapMarker()).toBeNull();
    });

    it('weak magnet snaps only within the cursor radius', () => {
        const near = harness(null);
        expect(near.it.snapCursor(11, 89, 'weak')).toEqual({ x: 10, y: 90 });
        expect(near.it.snapMarker()).toEqual({ point: { time: 10, price: 10 }, paneId: 'price' });

        const far = harness(null);
        expect(far.it.snapCursor(15, 85, 'weak')).toEqual({ x: 15, y: 85 });
        expect(far.it.snapMarker()).toBeNull();
    });

    it('clearSnapMarker drops the ring', () => {
        const h = harness(null);
        h.it.snapCursor(13, 88, 'strong');
        expect(h.it.snapMarker()).not.toBeNull();
        h.it.clearSnapMarker();
        expect(h.it.snapMarker()).toBeNull();
    });
});

describe('DrawingInteraction: Shift angle snap (45° steps)', () => {
    // fake projector is linear (x = time, y = 100 − price), so pixel angles map 1:1 to
    // time/price deltas: horizontal = equal prices, 45° = |Δtime| == |Δprice|.

    it('shift while placing locks the ghost to the nearest 45° ray (near-horizontal → flat)', () => {
        const h = harness('trendline');
        h.it.down(10, 90); // p1 → {time:10, price:10}
        h.it.move(50, 85, 'off', true); // ~7° off horizontal → snaps flat, radius preserved
        const ghost = h.it.ghost()!;
        expect(ghost.anchors[1]!.price).toBeCloseTo(10, 6);
        expect(ghost.anchors[1]!.time).toBeCloseTo(10 + Math.hypot(40, 5), 6);
    });

    it('a diagonal cursor snaps to the 45° ray (|Δtime| == |Δprice|)', () => {
        const h = harness('trendline');
        h.it.down(10, 90);
        h.it.move(45, 60, 'off', true); // ~40.6° up → snaps to 45°
        const p2 = h.it.ghost()!.anchors[1]!;
        expect(p2.time - 10).toBeCloseTo(p2.price - 10, 6);
        expect(p2.price).toBeGreaterThan(10);
    });

    it('a shift-click commits the snapped anchor and bypasses the magnet', () => {
        const h = harness('trendline');
        h.it.down(10, 90);
        h.it.move(47, 92, 'strong', true); // shift → magnet skipped, no ring
        expect(h.it.snapMarker()).toBeNull();
        h.it.down(47, 92, 'strong', true); // near-horizontal → flat at p1's price
        const create = h.intents.find((i) => i.kind === 'create');
        expect(create?.kind === 'create' && create.doc.anchors[1]!.price).toBeCloseTo(10, 6);
    });

    it('shift while dragging a line endpoint re-locks its angle around the other anchor', () => {
        const d = createDrawing('trendline', { id: 'dw-1', paneId: 'price', anchors: [{ time: 10, price: 10 }, { time: 50, price: 50 }] })!;
        const h = harness(null, [d]);
        h.setHovered('dw-1');
        h.it.down(50, 50); // grab handle p2 (px of anchor 1)
        h.it.move(90, 85, 'off', true); // ~4° below horizontal from p1 → snaps flat
        h.it.up(90, 85);
        const edit = h.intents.find((i) => i.kind === 'edit');
        expect(edit?.kind === 'edit' && edit.doc.anchors[0]).toEqual({ time: 10, price: 10 }); // pivot untouched
        expect(edit?.kind === 'edit' && edit.doc.anchors[1]!.price).toBeCloseTo(10, 6);
    });

    it('shift leaves non-line tools alone (raw cursor)', () => {
        const h = harness('datepricerange');
        h.it.down(10, 90);
        h.it.move(40, 80, 'off', true); // not a segment tool → no angle lock
        expect(h.it.ghost()!.anchors[1]).toEqual({ time: 40, price: 20 });
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

    it('ctrl-click (no move) toggles selection on release, without opening settings', () => {
        const h = harness(null, [hline()]);
        h.it.down(50, 70, 'strong', false, true); // Ctrl → strong magnet AND the selection modifier
        expect(h.intents).toHaveLength(0); // nothing until the release decides click vs drag
        h.it.up(51, 71); // within the slop → a click
        expect(h.intents).toEqual([{ kind: 'select', ids: ['dw-1'], additive: true }]);
        expect(h.settings).toHaveLength(0);
    });
});

describe('DrawingInteraction: marquee (Ctrl/Cmd-drag on the empty plot)', () => {
    // fake projector: x = time, y = 100 − price
    const inside = () => createDrawing('trendline', { id: 'dw-1', paneId: 'price', anchors: [{ time: 20, price: 80 }, { time: 40, price: 60 }] })!; // px (20,20)→(40,40)
    const outside = () => createDrawing('trendline', { id: 'dw-2', paneId: 'price', anchors: [{ time: 150, price: 20 }, { time: 180, price: 10 }] })!; // px (150,80)→(180,90)
    const crossing = () => createDrawing('hline', { id: 'dw-3', paneId: 'price', anchors: [{ time: 0, price: 70 }] })!; // full-width line at y=30

    it('starts only when idle with no tool armed, and claims the gesture', () => {
        const armed = harness('trendline');
        expect(armed.it.beginMarquee(5, 5)).toBe(false);
        const h = harness(null, [inside()]);
        expect(h.it.claim(100, 90)).toBe(false); // empty space → the host decides (pan vs marquee)
        expect(h.it.beginMarquee(100, 90)).toBe(true);
        expect(h.it.claim(100, 90)).toBe(true); // in flight → the drawings layer owns the moves
        expect(h.it.marqueeRect()).toEqual({ x: 100, y: 90, w: 0, h: 0 });
    });

    it('release selects every visible drawing whose bounds touch the box (a line crossing it too)', () => {
        const h = harness(null, [inside(), outside(), crossing()]);
        h.it.beginMarquee(10, 10);
        h.it.move(60, 50); // sweep (10,10)→(60,50)
        expect(h.it.marqueeRect()).toEqual({ x: 10, y: 10, w: 50, h: 40 });
        h.it.up(60, 50);
        expect(h.it.marqueeRect()).toBeNull();
        expect(h.intents).toEqual([{ kind: 'select', ids: ['dw-1', 'dw-3'] }]); // dw-2 sits far right
    });

    it('a sweep dragged up-left normalizes, and hidden drawings are never picked', () => {
        const hidden = inside();
        hidden.visible = false;
        const h = harness(null, [hidden, crossing()]);
        h.it.beginMarquee(60, 50);
        h.it.move(10, 10);
        h.it.up(10, 10);
        expect(h.intents).toEqual([{ kind: 'select', ids: ['dw-3'] }]);
    });

    it('adds to the existing selection (union) and stays silent when nothing new is touched', () => {
        const h = harness(null, [inside(), outside()]);
        h.setSelected(['dw-2']);
        h.it.beginMarquee(10, 10);
        h.it.move(60, 50);
        h.it.up(60, 50);
        expect(h.intents).toEqual([{ kind: 'select', ids: ['dw-2', 'dw-1'] }]); // dw-2 kept, dw-1 added
        h.intents.length = 0;
        h.setSelected(['dw-1', 'dw-2']);
        h.it.beginMarquee(10, 10);
        h.it.move(60, 50);
        h.it.up(60, 50); // both already selected → no intent
        expect(h.intents).toHaveLength(0);
    });

    it('a box within the slop selects nothing; Escape cancels a sweep', () => {
        const h = harness(null, [inside()]);
        h.it.beginMarquee(30, 30);
        h.it.move(32, 31);
        h.it.up(32, 31); // a twitch, not a sweep — even though the box touches dw-1
        expect(h.intents).toHaveLength(0);
        h.it.beginMarquee(10, 10);
        h.it.move(60, 50);
        expect(h.it.cancel()).toBe(true);
        expect(h.it.marqueeRect()).toBeNull();
        h.it.up(60, 50);
        expect(h.intents).toHaveLength(0);
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

    it('a long position click-move-click → 3 anchors, target above the entry (drag higher = profit)', () => {
        const h = harness('position');
        h.it.down(20, 60); // entry (price 40)
        h.it.move(40, 40);
        h.it.down(40, 40); // target above the entry (price 60) → long (profit up)
        const create = h.intents.find((i) => i.kind === 'create');
        expect(create?.kind === 'create' && create.doc.anchors).toHaveLength(3);
        if (create?.kind === 'create') {
            const [entry, stop, target] = create.doc.anchors;
            expect(target!.price).toBeGreaterThan(entry!.price); // reward above → long
            expect(stop!.price).toBeLessThan(entry!.price); // stop opposite, below
        }
    });

    it('placing the target the other way flips to short (drag lower = profit)', () => {
        const h = harness('position');
        h.it.down(20, 60); // entry (price 40)
        h.it.move(40, 80);
        h.it.down(40, 80); // target below the entry (price 20) → short (profit down)
        const create = h.intents.find((i) => i.kind === 'create');
        if (create?.kind === 'create') {
            const [entry, stop, target] = create.doc.anchors;
            expect(target!.price).toBeLessThan(entry!.price); // reward below → short
            expect(stop!.price).toBeGreaterThan(entry!.price); // stop opposite, above
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

    it('freehand: a marathon stroke keeps capturing past the path cap (the trail thins, never freezes)', () => {
        const h = harness('freehand');
        h.it.down(0, 50);
        const samples = MAX_PATH_POINTS + 200; // enough 5px steps to overflow the cap
        for (let i = 1; i <= samples; i++) h.it.move(i * 5, 50);
        h.it.up(samples * 5, 50);
        const create = h.intents.find((i) => i.kind === 'create');
        expect(create?.kind).toBe('create');
        if (create?.kind === 'create') {
            expect(create.doc.anchors.length).toBeLessThanOrEqual(MAX_PATH_POINTS);
            // The tail of the stroke — drawn AFTER the cap was first hit — made it into
            // the committed path instead of being silently discarded.
            const last = create.doc.anchors[create.doc.anchors.length - 1]!;
            expect(last.time).toBeGreaterThan(MAX_PATH_POINTS * 5);
        }
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

    it('body-dragging a drawing that is part of a multi-selection moves the whole selection (one edit-many)', () => {
        const a = trend();
        const b = hline(); // y = 70
        const locked = createDrawing('hline', { id: 'dw-3', paneId: 'price', anchors: [{ time: 10, price: 80 }] })!;
        locked.locked = true;
        const h = harness(null, [a, b, locked]);
        h.setSelected(['dw-1', 'dw-2', 'dw-3']);
        h.it.down(20, 80); // press the trend line's body (clear of the hline at y=70)
        h.it.move(30, 75); // dt=+10, dp=+5
        expect(b.anchors).toEqual([{ time: 20, price: 35 }]); // the rider follows live
        expect(locked.anchors).toEqual([{ time: 10, price: 80 }]); // a locked member stays put
        h.it.up(30, 75);
        const many = h.intents.find((i) => i.kind === 'edit-many');
        expect(many?.kind === 'edit-many' && many.docs.map((d) => d.id)).toEqual(['dw-1', 'dw-2']);
        expect(many?.kind === 'edit-many' && many.docs[0]!.anchors).toEqual([{ time: 20, price: 15 }, { time: 60, price: 55 }]);
        expect(h.intents.some((i) => i.kind === 'edit')).toBe(false);
    });

    it('a handle drag of a multi-selected drawing reshapes only that one', () => {
        const a = trend();
        const b = hline();
        const h = harness(null, [a, b]);
        h.setSelected(['dw-1', 'dw-2']);
        h.it.down(10, 90); // grab the trend line's p1 handle
        h.it.move(15, 85);
        h.it.up(15, 85);
        expect(b.anchors).toEqual([{ time: 10, price: 30 }]);
        expect(h.intents.map((i) => i.kind)).toEqual(['edit']);
    });

    it('Escape during a group drag restores every member', () => {
        const a = trend();
        const b = hline();
        const h = harness(null, [a, b]);
        h.setSelected(['dw-1', 'dw-2']);
        h.it.down(20, 80);
        h.it.move(30, 75);
        expect(h.it.cancel()).toBe(true);
        expect(a.anchors).toEqual([{ time: 10, price: 10 }, { time: 50, price: 50 }]);
        expect(b.anchors).toEqual([{ time: 10, price: 30 }]);
        expect(h.intents).toHaveLength(0);
    });
});

describe('DrawingInteraction: Ctrl/Cmd-drag duplicates', () => {
    const trend = () =>
        createDrawing('trendline', { id: 'dw-1', paneId: 'price', anchors: [{ time: 10, price: 10 }, { time: 50, price: 50 }] })!;
    const hline = () => createDrawing('hline', { id: 'dw-2', paneId: 'price', anchors: [{ time: 10, price: 30 }] })!;

    it('a Ctrl-drag of the body moves a COPY and commits it on release; the source never moves', () => {
        const d = trend();
        const h = harness(null, [d]);
        h.it.down(30, 70, 'strong', false, true); // Ctrl held (strong magnet is its other meaning)
        expect(h.it.dragClones()).toBeNull(); // nothing is copied until the press becomes a drag
        h.it.move(40, 65);
        const clones = h.it.dragClones()!;
        expect(clones).toHaveLength(1);
        expect(clones[0]!.anchors).toEqual([{ time: 20, price: 15 }, { time: 60, price: 55 }]); // the copy follows
        expect(d.anchors).toEqual([{ time: 10, price: 10 }, { time: 50, price: 50 }]); // the source stays
        h.it.up(40, 65);
        expect(h.it.dragClones()).toBeNull();
        expect(h.intents).toHaveLength(1);
        const clone = h.intents[0]!;
        expect(clone.kind).toBe('clone');
        if (clone.kind === 'clone') {
            expect(clone.docs).toHaveLength(1);
            expect(clone.docs[0]!.type).toBe('trendline');
            expect(clone.docs[0]!.anchors).toEqual([{ time: 20, price: 15 }, { time: 60, price: 55 }]);
        }
        expect(h.settings).toHaveLength(0);
    });

    it('Ctrl-dragging a member of a multi-selection copies the whole selection', () => {
        const a = trend();
        const b = hline();
        const h = harness(null, [a, b]);
        h.setSelected(['dw-1', 'dw-2']);
        h.it.down(20, 80, 'off', false, true); // the trend line's body, clear of the hline
        h.it.move(30, 75);
        h.it.up(30, 75);
        const clone = h.intents.find((i) => i.kind === 'clone');
        expect(clone?.kind === 'clone' && clone.docs.map((d) => d.type)).toEqual(['trendline', 'hline']);
        expect(clone?.kind === 'clone' && clone.docs[1]!.anchors).toEqual([{ time: 20, price: 35 }]);
        expect(b.anchors).toEqual([{ time: 10, price: 30 }]); // sources untouched
    });

    it('Ctrl on a HANDLE keeps its resize meaning (no copy)', () => {
        const d = trend();
        const h = harness(null, [d]);
        h.setHovered('dw-1');
        h.it.down(10, 90, 'off', false, true); // grab p1 with Ctrl held
        h.it.move(15, 85);
        expect(h.it.dragClones()).toBeNull();
        h.it.up(15, 85);
        expect(h.intents.map((i) => i.kind)).toEqual(['edit']);
        expect(d.anchors[0]).toEqual({ time: 15, price: 15 });
    });

    it('Escape during a Ctrl-drag leaves nothing behind and the source untouched', () => {
        const d = trend();
        const h = harness(null, [d]);
        h.it.down(30, 70, 'off', false, true);
        h.it.move(40, 65);
        expect(h.it.cancel()).toBe(true);
        expect(h.it.dragClones()).toBeNull();
        expect(d.anchors).toEqual([{ time: 10, price: 10 }, { time: 50, price: 50 }]);
        h.it.up(40, 65);
        expect(h.intents).toHaveLength(0);
    });

    it('a locked drawing is never copied by a Ctrl-drag (the press stays a click → toggle)', () => {
        const d = trend();
        d.locked = true;
        const h = harness(null, [d]);
        h.it.down(30, 70, 'off', false, true);
        h.it.move(40, 65);
        expect(h.it.dragClones()).toBeNull();
        h.it.up(40, 65);
        expect(h.intents).toEqual([{ kind: 'select', ids: ['dw-1'], additive: true }]);
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
