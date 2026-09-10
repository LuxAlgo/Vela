// The timeline-mark model (src/core/marks/MarksController) and its facade
// (src/core/MarksControl): the store, the renderer push, the click re-emission, the
// group-visibility seam, and the inert path on a renderer without the capability.
import { describe, it, expect, vi } from 'vitest';
import { TypedEventBus } from '../src/core/events/EventBus';
import type { VelaEventMap } from '../src/core/events/types';
import { MarksController } from '../src/core/marks/MarksController';
import { MarksControl } from '../src/core/MarksControl';
import type { MarkClickEvent, MarkGroup, TimelineMark } from '../src/core/marks/types';
import type { IChartRenderer } from '../src/core/ports/IChartRenderer';
import { defaultMarksState, mergeMarksState } from '../src/renderers/shared/marks-state';

function fakeRenderer(opts: { capable?: boolean } = {}) {
    const capable = opts.capable !== false;
    const pushes: Array<{ marks: TimelineMark[]; groups: MarkGroup[] }> = [];
    const features: Array<[string, unknown]> = [];
    let clickCb: ((e: MarkClickEvent) => void) | null = null;
    let state = defaultMarksState();
    const renderer = {
        name: 'fake',
        capabilities: { timelineMarks: capable },
        features: capable ? ['marks'] : [],
        setTimelineMarks: capable ? (marks: readonly TimelineMark[], groups: readonly MarkGroup[]) => pushes.push({ marks: [...marks], groups: [...groups] }) : undefined,
        onMarkClick: (cb: (e: MarkClickEvent) => void) => {
            clickCb = cb;
            return () => {
                clickCb = null;
            };
        },
        applyFeature: (key: string, value: unknown) => {
            features.push([key, value]);
            if (key === 'marks') state = mergeMarksState(state, value);
        },
        readFeature: (key: string) => (capable && key === 'marks' ? state : undefined),
    } as unknown as IChartRenderer;
    return { renderer, pushes, features, click: (e: MarkClickEvent) => clickCb?.(e), subscribed: () => clickCb !== null };
}

const T = Date.UTC(2024, 5, 11);
const mark = (id: string, extra: Partial<TimelineMark> = {}): TimelineMark => ({ id, time: T, glyph: { color: '#2962ff', letter: 'D' }, ...extra });

describe('MarksController', () => {
    it('pushes marks + group definitions to the renderer on every change, in insertion order', () => {
        const { renderer, pushes } = fakeRenderer();
        const ctrl = new MarksController(renderer, new TypedEventBus<VelaEventMap>());
        expect(ctrl.supported).toBe(true);
        ctrl.add(mark('b'));
        ctrl.add(mark('a'));
        ctrl.defineGroup({ id: 'dividends', label: 'Dividends' });
        expect(pushes).toHaveLength(3);
        expect(pushes[2]!.marks.map((m) => m.id)).toEqual(['b', 'a']);
        expect(pushes[2]!.groups).toEqual([{ id: 'dividends', label: 'Dividends' }]);
        // Re-adding an id replaces it in place.
        ctrl.add(mark('b', { title: 'B2' }));
        expect(pushes[3]!.marks.map((m) => `${m.id}:${m.title ?? ''}`)).toEqual(['b:B2', 'a:']);
        ctrl.remove('b');
        expect(pushes[4]!.marks.map((m) => m.id)).toEqual(['a']);
        ctrl.set([mark('x'), mark('y')]);
        expect(pushes[5]!.marks.map((m) => m.id)).toEqual(['x', 'y']);
        ctrl.clear();
        expect(pushes[6]!.marks).toEqual([]);
        ctrl.clear(); // already empty — no push
        expect(pushes).toHaveLength(7);
    });

    it('hands out copies and rejects marks it could not place or draw', () => {
        const { renderer } = fakeRenderer();
        const ctrl = new MarksController(renderer, new TypedEventBus<VelaEventMap>());
        ctrl.add(mark('a'));
        const copy = ctrl.all()[0]!;
        copy.glyph.color = 'red';
        expect(ctrl.all()[0]!.glyph.color).toBe('#2962ff');
        expect(() => ctrl.add({ ...mark('bad'), time: Number.NaN })).toThrow(/finite/);
        expect(() => ctrl.add({ ...mark(''), id: '' })).toThrow(/id/);
        expect(() => ctrl.add({ id: 'g', time: T } as unknown as TimelineMark)).toThrow(/glyph/);
        expect(() => ctrl.defineGroup({ id: '', label: 'x' })).toThrow(/id/);
    });

    it('re-emits the renderer’s glyph clicks as `mark:click` and unsubscribes on destroy', () => {
        const fake = fakeRenderer();
        const events = new TypedEventBus<VelaEventMap>();
        const seen: MarkClickEvent[] = [];
        events.on('mark:click', (e) => seen.push(e));
        const ctrl = new MarksController(fake.renderer, events);
        expect(fake.subscribed()).toBe(true);
        fake.click({ id: 'a', ids: ['a', 'b'], time: T, group: 'dividends' });
        expect(seen).toEqual([{ id: 'a', ids: ['a', 'b'], time: T, group: 'dividends' }]);
        ctrl.destroy();
        expect(fake.subscribed()).toBe(false);
    });

    it('routes group visibility through the renderer’s `marks` feature, with the group default as fallback', () => {
        const { renderer, features } = fakeRenderer();
        const ctrl = new MarksController(renderer, new TypedEventBus<VelaEventMap>());
        ctrl.defineGroup({ id: 'quiet', label: 'Quiet', visible: false });
        expect(ctrl.isGroupVisible('quiet')).toBe(false); // declared default
        expect(ctrl.isGroupVisible('other')).toBe(true); // unknown ⇒ visible
        ctrl.setGroupVisible('quiet', true);
        expect(features).toEqual([['marks', { groups: { quiet: true } }]]);
        expect(ctrl.isGroupVisible('quiet')).toBe(true); // the stored choice wins over the default
    });

    it('stays inert on a renderer without the capability: the model fills, nothing is pushed, the setter warns', () => {
        const { renderer, pushes, features } = fakeRenderer({ capable: false });
        const ctrl = new MarksController(renderer, new TypedEventBus<VelaEventMap>());
        expect(ctrl.supported).toBe(false);
        ctrl.add(mark('a'));
        expect(ctrl.all().map((m) => m.id)).toEqual(['a']);
        expect(pushes).toHaveLength(0);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        ctrl.setGroupVisible('x', false);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(features).toHaveLength(0);
        expect(ctrl.isGroupVisible('x')).toBe(true);
        warn.mockRestore();
    });
});

describe('MarksControl (chart.marks)', () => {
    it('chains and mirrors the controller', () => {
        const { renderer, pushes } = fakeRenderer();
        const control = new MarksControl(new MarksController(renderer, new TypedEventBus<VelaEventMap>()));
        const out = control.defineGroup({ id: 'g', label: 'G' }).add(mark('a', { group: 'g' })).add(mark('b'));
        expect(out).toBe(control);
        expect(control.supported).toBe(true);
        expect(control.all().map((m) => m.id)).toEqual(['a', 'b']);
        expect(control.groups()).toEqual([{ id: 'g', label: 'G' }]);
        control.remove('a').clear();
        expect(pushes[pushes.length - 1]!.marks).toEqual([]);
        control.setGroupVisible('g', false);
        expect(control.isGroupVisible('g')).toBe(false);
        expect(control.setGroupVisible('g')).toBe(control); // default: show
        expect(control.isGroupVisible('g')).toBe(true);
    });
});
