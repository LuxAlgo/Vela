import { describe, expect, it } from 'vitest';
import { InputController, matchesFreePan } from '../src/renderers/native/core/InputController';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type { FreePanEvent } from '../src/core/options';

const press = (over: Partial<FreePanEvent> = {}): FreePanEvent => ({
    button: 0,
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse',
    ...over,
});

describe('freePan', () => {
    it('matches plain drag, modifier presets, and custom button/chord predicates while ignoring touch', () => {
        expect(matchesFreePan(false, press())).toBe(false);
        expect(matchesFreePan(true, press())).toBe(true);
        expect(matchesFreePan(true, press({ altKey: true }))).toBe(false);
        expect(matchesFreePan(true, press({ pointerType: 'touch' }))).toBe(false);
        expect(matchesFreePan('alt', press({ altKey: true }))).toBe(true);
        expect(matchesFreePan('shift', press({ shiftKey: true }))).toBe(true);
        expect(matchesFreePan('mod', press({ ctrlKey: true }))).toBe(true);
        expect(matchesFreePan((e) => e.button === 4, press({ button: 4 }))).toBe(true);
    });

    it('unlocks price pan only after drag slop, leaves plain clicks and middle-click delete alone', () => {
        const coords = new CoordinateSystem();
        coords.setSize(400, 300, 1);
        coords.setBars([1, 2, 3, 4, 5].map((i) => i * 60_000));
        let manual = false;
        let pannedDy = 0;
        let deleted = 0;
        let clicked = 0;
        const listeners = new Map<string, (e: unknown) => void>();
        const fakeEl = {
            addEventListener: (t: string, fn: (e: unknown) => void) => listeners.set(t, fn),
            removeEventListener: () => {},
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
            setPointerCapture: () => {},
            releasePointerCapture: () => {},
        } as unknown as HTMLElement;

        const ctrl = new InputController({
            getCoords: () => coords,
            apply: (vp) => coords.setViewport(vp),
            zoomTo: () => {},
            fling: () => {},
            onPointerMove: () => {},
            onClick: () => { clicked += 1; },
            beginPriceScale: () => {},
            priceScaleBy: () => {},
            beginPricePan: (_y, unlock) => {
                if (unlock) manual = true;
                return manual;
            },
            pricePanBy: (dy) => { pannedDy = dy; },
            resetPriceScale: () => {},
            dataDblClick: () => {},
            paneSeparatorAt: () => false,
            beginPaneResize: () => {},
            paneResizeBy: () => {},
            resetPaneSize: () => {},
            resetView: () => {},
            drawingsDeleteAt: () => { deleted += 1; return true; },
        });
        ctrl.freePan = 'alt';
        ctrl.attach(fakeEl);
        const emit = (type: string, e: Record<string, unknown>) => listeners.get(type)?.({ pointerId: 1, pointerType: 'mouse', button: 0, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, timeStamp: 10, preventDefault: () => {}, ...e });

        // Plain click with Alt held: below slop → never unlocks manual scale.
        emit('pointerdown', { clientX: 100, clientY: 100, altKey: true });
        emit('pointermove', { clientX: 101, clientY: 101, altKey: true });
        emit('pointerup', { clientX: 101, clientY: 101, altKey: true });
        expect(manual).toBe(false);
        expect(clicked).toBe(1);

        // Middle-click still deletes immediately on press.
        emit('pointerdown', { clientX: 100, clientY: 100, button: 1 });
        expect(deleted).toBe(1);

        // Alt + drag past slop unlocks manual scale and pans vertically.
        emit('pointerdown', { clientX: 100, clientY: 100, altKey: true });
        emit('pointermove', { clientX: 120, clientY: 135, altKey: true });
        emit('pointerup', { clientX: 120, clientY: 135, altKey: true });
        expect(manual).toBe(true);
        expect(pannedDy).toBe(35);
    });

    it('round-trips through renderer features and ChartConfig while preserving custom triggers', () => {
        const r = new NativeRenderer();
        r.applyFeature('freePan', 'alt');
        expect(r.readFeature('freePan')).toBe('alt');
        expect(r.getConfig().priceScale.freePan).toBe(true);

        r.applyConfig({ priceScale: { freePan: false } });
        expect(r.readFeature('freePan')).toBe(false);

        r.applyConfig({ priceScale: { freePan: true } });
        expect(r.readFeature('freePan')).toBe('alt');

        r.applyFeature('freePan', true);
        expect(r.readFeature('freePan')).toBe(true);
    });
});
