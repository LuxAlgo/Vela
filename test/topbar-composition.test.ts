// The topbar composition resolver (src/widget/topbar-composition.ts): defaults,
// dedupe, visibility, and pinned-action extraction. DOM-free — node env; the Topbar's
// actual assembly under a composition is verified in the browser (playground probes).
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    resolveTopbarComposition,
    topbarHas,
    pinnedTopbarActionIds,
    TOPBAR_DEFAULT_LEFT,
    TOPBAR_DEFAULT_RIGHT,
    TOPBAR_BUILTIN_IDS,
} from '../src/widget/topbar-composition';
import { registerWidgetAction, unregisterWidgetAction, topbarActionOverride, widgetActions, OVERRIDABLE_TOPBAR_IDS } from '../src/widget/contributions';

describe('resolveTopbarComposition', () => {
    it('no option (or empty) resolves to the default composition, both sides', () => {
        for (const opt of [undefined, {}]) {
            const comp = resolveTopbarComposition(opt);
            expect(comp.left).toEqual([...TOPBAR_DEFAULT_LEFT]);
            expect(comp.right).toEqual([...TOPBAR_DEFAULT_RIGHT]);
        }
    });

    it('a declared side is taken verbatim; the other keeps its default', () => {
        const comp = resolveTopbarComposition({ right: ['alerts', 'mytool.screenshot.open'] });
        expect(comp.left).toEqual([...TOPBAR_DEFAULT_LEFT]);
        expect(comp.right).toEqual(['alerts', 'mytool.screenshot.open']);
        // An explicit list is the side's complete contract — omitted ids are OUT.
        expect(topbarHas(comp, 'screenshot')).toBe(false);
        expect(topbarHas(comp, 'panels')).toBe(false);
    });

    it('an empty declared side renders nothing there', () => {
        const comp = resolveTopbarComposition({ left: [] });
        expect(comp.left).toEqual([]);
        expect(comp.right).toEqual([...TOPBAR_DEFAULT_RIGHT]);
    });

    it('duplicates keep their FIRST occurrence — left before right', () => {
        const comp = resolveTopbarComposition({ left: ['symbol', 'alerts', 'symbol'], right: ['alerts', 'screenshot'] });
        expect(comp.left).toEqual(['symbol', 'alerts']);
        expect(comp.right).toEqual(['screenshot']); // 'alerts' already claimed by left
    });

    it('empty-string entries are dropped', () => {
        expect(resolveTopbarComposition({ left: ['', 'symbol'] }).left).toEqual(['symbol']);
    });
});

describe('pinnedTopbarActionIds', () => {
    it('extracts exactly the non-built-in entries, across both sides', () => {
        const comp = resolveTopbarComposition({
            left: ['symbol', 'vela-pro.indicator-menu.open', 'undo-redo'],
            right: ['mytool.screenshot.open', 'alerts'],
        });
        expect(pinnedTopbarActionIds(comp)).toEqual(['vela-pro.indicator-menu.open', 'mytool.screenshot.open']);
    });

    it('the default composition pins nothing (every default entry is a built-in)', () => {
        const comp = resolveTopbarComposition();
        expect(pinnedTopbarActionIds(comp)).toEqual([]);
        for (const id of [...comp.left, ...comp.right]) expect(TOPBAR_BUILTIN_IDS).toContain(id);
    });
});

describe('built-in slot overrides (registerWidgetAction under a built-in id)', () => {
    afterEach(() => {
        for (const id of ['indicators', 'screenshot']) unregisterWidgetAction(id);
        vi.restoreAllMocks();
    });

    it('an action registered under an overridable id becomes the slot override', () => {
        const desc = { id: 'indicators', target: 'topbar', label: 'Indicators', run: () => undefined } as const;
        const off = registerWidgetAction(desc);
        expect(topbarActionOverride('indicators')).toBe(desc);
        off();
        expect(topbarActionOverride('indicators')).toBeUndefined();
    });

    it('a composite built-in id is REFUSED with a warning — never registered', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const off = registerWidgetAction({ id: 'symbol', target: 'topbar', label: 'Nope', run: () => undefined });
        expect(warn).toHaveBeenCalledOnce();
        expect(widgetActions('topbar').some((a) => a.id === 'symbol')).toBe(false);
        expect(topbarActionOverride('symbol')).toBeUndefined();
        off(); // the returned no-op disposer must be safe to call
    });

    it('only the documented simple-button slots are overridable', () => {
        expect([...OVERRIDABLE_TOPBAR_IDS]).toEqual(['indicators', 'screenshot']);
        for (const id of OVERRIDABLE_TOPBAR_IDS) expect(TOPBAR_BUILTIN_IDS).toContain(id);
        // a non-built-in id is never reported as an override, even when registered
        registerWidgetAction({ id: 'vendor.tool', target: 'topbar', label: 'T', run: () => undefined });
        expect(topbarActionOverride('vendor.tool')).toBeUndefined();
        unregisterWidgetAction('vendor.tool');
    });
});
