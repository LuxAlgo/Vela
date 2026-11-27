// @vitest-environment jsdom
// The settings of a tool registered with `defineDrawing`: read-only result rows, a price field
// with a unit switch, fields grouped in sections of their own, fields that ask for a place on
// the quick bar, and the level editor on the tool's own levels.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { LINE_FIELDS, createDrawing, defineDrawing, deserializeDrawing, type Drawing, type ShapeDrawing } from '../src/core/drawings';
import { DARK_THEME } from '../src/core/theme';
import { DrawingSettingsPopup, sharedPaths, type SettingsActions, type SettingsPatch } from '../src/renderers/native/drawings/DrawingSettingsPopup';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
    Element.prototype.scrollIntoView ??= function () {};
});

const disposers: Array<() => void> = [];
afterEach(() => {
    document.body.replaceChildren();
    for (const dispose of disposers.splice(0)) dispose();
});

/** The dialog machine opens and closes on its own tick; wait for it. */
const settled = () => new Promise<void>((r) => setTimeout(r, 50));

const propsOf = <P>(d: Drawing): P => (d as unknown as ShapeDrawing<P & Record<string, unknown>>).props;

/** A chart stand-in that, like the renderer, replaces the drawing with a fresh copy after
 *  every edit. */
function setup(drawing: Drawing, opts: { priceDecimals?: number } = {}) {
    const host = document.createElement('div');
    document.body.append(host);
    const popup = new DrawingSettingsPopup(host, DARK_THEME, { chartBarMs: () => 5 * 60_000, timeZone: () => 'UTC', priceDecimals: () => opts.priceDecimals ?? null });
    let live = drawing;
    const patches: SettingsPatch[] = [];
    const actions: SettingsActions = {
        resolve: () => live,
        patch: (p) => {
            patches.push(p);
            live.applySettings(p);
            live = deserializeDrawing(live.serialize())!;
        },
        setLocked: () => {},
        reorder: () => {},
        duplicate: () => {},
        resetSettings: () => {},
        remove: () => {},
    };
    popup.open([drawing], null, actions);
    const $ = <T extends Element = HTMLElement>(sel: string): T | null => host.querySelector<T>(sel);
    const $$ = <T extends Element = HTMLElement>(sel: string): T[] => [...host.querySelectorAll<T>(sel)];
    const openPanel = async (): Promise<void> => {
        $<HTMLButtonElement>('.vela-dpop [data-tip="Settings"]')!.click();
        await settled();
    };
    const row = (label: string): HTMLElement => $$('.vela-dsp-row').find((r) => r.querySelector('.vela-dsp-lab')?.textContent === label)!;
    /** The number field of a row (a switch holds a checkbox too). */
    const field = (label: string): HTMLInputElement => row(label).querySelector<HTMLInputElement>('input:not([type="checkbox"])')!;
    const typeIn = (label: string, value: string): void => {
        const input = field(label);
        input.value = value;
        input.dispatchEvent(new Event('blur'));
    };
    return { host, popup, actions, patches, live: () => live, $, $$, openPanel, row, field, typeIn };
}

/** The options a row's unit switch offers, and a pick among them. */
function unitSwitch(row: HTMLElement) {
    const root = row.querySelector<HTMLElement>('.vela-dsp-unit [title$=" unit"]');
    const listed = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-slot~="select-item"]')];
    /** The list's rows, opening it unless it already is (a second press would close it). */
    const options = (): HTMLElement[] => {
        if (listed().length === 0) root!.querySelector('button')!.click();
        return listed();
    };
    return {
        root,
        labels: (): string[] => options().map((o) => o.textContent ?? ''),
        pick: (label: string): void => options().find((o) => o.textContent === label)!.click(),
        value: (): string => root!.querySelector('[data-slot~="select-value"]')?.textContent ?? '',
    };
}

const ANCHORS = [
    { time: Date.UTC(2026, 0, 5, 10), price: 100 },
    { time: Date.UTC(2026, 0, 5, 14), price: 100 },
];

/** A long position: a target and a stop stored as prices, and the ratio they make. */
function position(entry = 100): Drawing {
    disposers.push(
        defineDrawing<{ stop: number; target: number }>({
            type: 'test.position',
            label: 'Test position',
            props: { stop: 90, target: 120 },
            settings: [
                { path: 'props.target', label: 'Target', kind: 'number', step: 0.01, unit: { base: 'anchors.0.price' } },
                { path: 'props.stop', label: 'Stop', kind: 'number', step: 0.01, unit: { base: 'anchors.0.price' } },
                { path: 'results.rr', label: 'Risk / reward', kind: 'readout' },
                { path: 'results.none', label: 'Missing', kind: 'readout' },
            ],
            shapes: () => [],
            readout: (d) => {
                const at = d.anchors[0]?.price ?? 0;
                return [{ key: 'rr', label: 'Risk / reward', value: ((d.props.target - at) / (at - d.props.stop)).toFixed(2) }];
            },
        }),
    );
    return createDrawing('test.position', { id: 'p', paneId: 'price', anchors: ANCHORS.map((a) => ({ ...a, price: entry })) })!;
}

describe('a read-only result row', () => {
    it('shows the value at its path with no control, and follows the drawing', async () => {
        const s = setup(position());
        await s.openPanel();
        const out = (label: string): string | null | undefined => s.row(label).querySelector('.vela-dsp-out')?.textContent;
        expect(out('Risk / reward')).toBe('2.00');
        expect(s.row('Risk / reward').querySelector('input, button, select')).toBeNull();
        expect(out('Missing')).toBe('–');

        // A handle dragged on the chart while the panel is open.
        s.actions.patch({ 'props.target': 130 });
        s.popup.syncPanel();
        expect(out('Risk / reward')).toBe('3.00');

        // An edit made in the panel itself.
        s.typeIn('Target', '110');
        expect(out('Risk / reward')).toBe('1.00');
        expect(s.patches.some((p) => Object.keys(p).some((k) => k.startsWith('results.')))).toBe(false);
        s.popup.destroy();
    });

    it('is no setting: the quick bar and a multi-selection leave it out', () => {
        const d = position();
        expect(sharedPaths([d])).toEqual(new Set(['props.target', 'props.stop']));
        const s = setup(d);
        expect(s.$('.vela-dpop [data-quick]')).toBeNull();
        s.popup.destroy();
    });
});

describe('a price field with a unit switch', () => {
    it('shows the price as points, percent or ticks from the reference, and writes a price back', async () => {
        const s = setup(position(), { priceDecimals: 2 });
        await s.openPanel();
        const target = (): number => propsOf<{ target: number }>(s.live()).target;
        const unit = unitSwitch(s.row('Target'));
        expect(unit.labels()).toEqual(['Price', 'Points', 'Percent', 'Ticks']);
        expect(Number(s.field('Target').value)).toBe(120);

        unit.pick('Points');
        expect(Number(s.field('Target').value)).toBe(20);
        expect(s.patches).toEqual([]); // a unit change edits nothing
        s.typeIn('Target', '30');
        expect(target()).toBe(130);

        unit.pick('Percent');
        expect(Number(s.field('Target').value)).toBe(30);
        s.typeIn('Target', '-5');
        expect(target()).toBe(95);

        unit.pick('Ticks');
        expect(Number(s.field('Target').value)).toBe(-500);
        s.typeIn('Target', '250');
        expect(target()).toBe(102.5);

        unit.pick('Price');
        expect(Number(s.field('Target').value)).toBe(102.5);
        // The unit is the row's: the other field still reads as a price, and nothing of it is saved.
        expect(Number(s.field('Stop').value)).toBe(90);
        expect(s.live().serialize().props).toEqual({ stop: 90, target: 102.5 });
        s.popup.destroy();
    });

    it("reads to the symbol's price increment, without rewriting the stored price", async () => {
        const s = setup(position(), { priceDecimals: 2 });
        s.actions.patch({ 'props.target': 120.123456 });
        s.patches.length = 0;
        await s.openPanel();
        const unit = unitSwitch(s.row('Target'));
        expect(s.field('Target').value).toBe('120.12');
        unit.pick('Points');
        expect(s.field('Target').value).toBe('20.12');
        unit.pick('Percent');
        expect(s.field('Target').value).toBe('20.1235');
        unit.pick('Ticks');
        expect(s.field('Target').value).toBe('2012.35');
        // Looking at the value in another unit, or leaving the field as it reads, is no edit.
        s.field('Target').dispatchEvent(new Event('blur'));
        expect(s.patches).toEqual([]);
        expect(propsOf<{ target: number }>(s.live()).target).toBe(120.123456);
        s.popup.destroy();
    });

    it('follows the reference price when it moves', async () => {
        const s = setup(position());
        await s.openPanel();
        unitSwitch(s.row('Stop')).pick('Points');
        expect(Number(s.field('Stop').value)).toBe(-10);
        s.actions.patch({ 'anchors.0.price': 95 });
        s.popup.syncPanel();
        expect(Number(s.field('Stop').value)).toBe(-5);
        expect(propsOf<{ stop: number }>(s.live()).stop).toBe(90);
        s.popup.destroy();
    });

    it('leaves ticks out without a tick size, and percent out against a reference of zero', async () => {
        const noTick = setup(position());
        await noTick.openPanel();
        expect(unitSwitch(noTick.row('Target')).labels()).toEqual(['Price', 'Points', 'Percent']);
        noTick.popup.destroy();
        document.body.replaceChildren();

        const zero = setup(position(0), { priceDecimals: 2 });
        await zero.openPanel();
        expect(unitSwitch(zero.row('Target')).labels()).toEqual(['Price', 'Points', 'Ticks']);
        zero.popup.destroy();
    });

    it('reads as the price again when the reference drops to zero under a percent', async () => {
        const s = setup(position());
        await s.openPanel();
        const unit = unitSwitch(s.row('Target'));
        unit.pick('Percent');
        expect(Number(s.field('Target').value)).toBe(20);
        s.actions.patch({ 'anchors.0.price': 0 });
        s.popup.syncPanel();
        expect(s.field('Target').value).toBe('120');
        expect(unit.value()).toBe('Price');
        s.popup.destroy();
    });
});

describe('fields that name a section', () => {
    function sectioned(): Drawing {
        disposers.push(
            defineDrawing({
                type: 'test.sections',
                label: 'Test sections',
                props: { plain: 2, mode: 'x', only: true, amount: 1, up: '#ff0000', upStyle: 'solid' },
                settings: [
                    { path: 'props.plain', label: 'Plain', kind: 'number' },
                    { path: 'props.mode', label: 'Mode', kind: 'select', section: 'Behavior', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] },
                    { path: 'props.amount', label: 'Amount', kind: 'number', section: 'Sizing' },
                    { path: 'props.only', label: 'Only in X', kind: 'boolean', section: 'Behavior', when: { path: 'props.mode', in: ['x'] } },
                    { path: 'props.up', label: 'Upper line color', kind: 'color', section: 'Sizing' },
                    { path: 'props.upStyle', label: 'Upper line style', kind: 'lineStyle', section: 'Sizing' },
                ],
                shapes: () => [],
            }),
        );
        return createDrawing('test.sections', { id: 's', paneId: 'price', anchors: ANCHORS })!;
    }
    const labels = (block: Element): string[] => [...block.querySelectorAll('.vela-dsp-lab')].map((l) => l.textContent ?? '');

    it('get a titled block each, right after the tool\'s own options, in the order the sections first appear', async () => {
        const s = setup(sectioned());
        await s.openPanel();
        const blocks = s.$$('.vela-dsp-scroll > *');
        const own = blocks.find((b) => labels(b).includes('Plain'))!;
        expect(own.querySelector('.vela-dsp-h')).toBeNull();
        expect(labels(own)).toEqual(['Plain']);

        const behavior = own.nextElementSibling!;
        const sizing = behavior.nextElementSibling!;
        expect([behavior, sizing].map((b) => [b.className, b.querySelector('.vela-dsp-h')?.textContent])).toEqual([
            ['vela-dsp-block', 'Behavior'],
            ['vela-dsp-block', 'Sizing'],
        ]);
        expect(labels(behavior)).toEqual(['Mode', 'Only in X']);
        // A color and its line style still share one row inside a section.
        expect(labels(sizing)).toEqual(['Amount', 'Upper line']);
        expect(s.$$('.vela-dsp-h').map((h) => h.textContent)).toEqual(['Behavior', 'Sizing']);
        s.popup.destroy();
    });

    it('keep their conditions and write to their own paths', async () => {
        const s = setup(sectioned());
        await s.openPanel();
        expect(s.row('Only in X').hidden).toBe(false);
        s.actions.patch({ 'props.mode': 'y' });
        s.popup.syncPanel();
        expect(s.row('Only in X').hidden).toBe(true);
        s.typeIn('Amount', '7');
        expect(propsOf<{ amount: number }>(s.live()).amount).toBe(7);
        s.popup.destroy();
    });
});

describe('fields that ask for the quick bar', () => {
    function quick(id: string, on = true, count = 3): Drawing {
        disposers.push(
            defineDrawing({
                type: 'test.quick',
                label: 'Test quick',
                props: { tint: '#ff0000', on: true, mode: 'a', dash: 'solid', count: 3, note: 'hi', quiet: 1 },
                settings: [
                    ...LINE_FIELDS.map((f) => ({ ...f, quick: true })),
                    { path: 'props.tint', label: 'Tint', kind: 'color', quick: true },
                    { path: 'props.on', label: 'Extend', kind: 'boolean', quick: true },
                    { path: 'props.mode', label: 'Mode', kind: 'select', quick: true, options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] },
                    { path: 'props.dash', label: 'Dash', kind: 'lineStyle', quick: true },
                    { path: 'props.count', label: 'Count', kind: 'number', min: 1, max: 9, step: 1, quick: true },
                    { path: 'props.note', label: 'Note', kind: 'text', quick: true },
                    { path: 'results.none', label: 'Result', kind: 'readout', quick: true },
                    { path: 'props.quiet', label: 'Quiet', kind: 'number' },
                ],
                shapes: () => [],
            }),
        );
        return createDrawing('test.quick', { id, paneId: 'price', anchors: ANCHORS, props: { tint: '#ff0000', on, mode: 'a', dash: 'solid', count, note: 'hi', quiet: 1 } })!;
    }
    const quickPaths = (host: HTMLElement): Array<string | undefined> => [...host.querySelectorAll<HTMLElement>('.vela-dpop [data-quick]')].map((el) => el.dataset.quick);

    it('get a control by kind after the bar\'s own, and edit through the same patch', () => {
        const s = setup(quick('q'));
        // No text field, no read-only row, no field that did not ask, no second line control.
        expect(quickPaths(s.host)).toEqual(['props.tint', 'props.on', 'props.mode', 'props.dash', 'props.count']);
        expect(s.$$('.vela-dpop [data-tip="Line color"]')).toHaveLength(1);
        const at = (path: string): HTMLElement => s.$(`.vela-dpop [data-quick="${path}"]`)!;
        const follows = (a: Element, b: Element): boolean => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        expect(follows(s.$('.vela-dpop [data-tip="Line style"]')!, at('props.tint'))).toBe(true);
        expect(follows(at('props.count'), s.$('.vela-dpop [data-tip="Settings"]')!)).toBe(true);
        expect(at('props.tint').dataset.tip).toBe('Tint');

        const toggle = at('props.on');
        expect([toggle.textContent, toggle.dataset.active]).toEqual(['Extend', '1']);
        toggle.click();
        expect(toggle.dataset.active).toBe('0');
        expect(s.patches).toEqual([{ 'props.on': false }]);

        at('props.mode').click();
        s.$$<HTMLButtonElement>('.vela-dpop-item').find((i) => i.textContent === 'Beta')!.click();
        at('props.dash').click();
        s.$$<HTMLButtonElement>('.vela-dpop-item').find((i) => i.textContent === 'Dashed')!.click();
        const count = at('props.count').querySelector('input')!;
        count.value = '5';
        count.dispatchEvent(new Event('blur'));
        expect(propsOf(s.live())).toMatchObject({ on: false, mode: 'b', dash: 'dashed', count: 5 });
        s.popup.destroy();
    });

    it('show on a multi-selection only when every drawing has the field, mixed where they differ', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const patches: SettingsPatch[] = [];
        const a = quick('a', true, 3);
        const b = quick('b', false, 4);
        const actions: SettingsActions = { resolve: () => a, patch: (p) => void patches.push(p), setLocked: () => {}, reorder: () => {}, duplicate: () => {}, resetSettings: () => {}, remove: () => {} };
        const popup = new DrawingSettingsPopup(host, DARK_THEME);
        popup.open([a, b], null, actions);
        expect(quickPaths(host)).toEqual(['props.tint', 'props.on', 'props.mode', 'props.dash', 'props.count']);
        const toggle = host.querySelector<HTMLElement>('[data-quick="props.on"]')!;
        expect(toggle.dataset.active).toBe('mixed');
        expect(host.querySelector<HTMLInputElement>('[data-quick="props.count"] input')!.placeholder).toBe('—');
        toggle.click();
        expect(patches).toEqual([{ 'props.on': true }]);

        popup.open([a, createDrawing('hline', { id: 'h', paneId: 'price', anchors: ANCHORS.slice(0, 1) })!], null, actions);
        expect(host.querySelector('.vela-dpop')).not.toBeNull();
        expect(quickPaths(host)).toEqual([]);
        popup.destroy();
    });
});

describe('the level editor on a registered tool', () => {
    interface Level {
        ratio: number;
        color: string;
        enabled: boolean;
    }
    function levelled(): Drawing {
        disposers.push(
            defineDrawing<{ levels: Level[]; numbersSize: string }>({
                type: 'test.levels',
                label: 'Test levels',
                levels: true,
                props: {
                    numbersSize: 'large',
                    levels: [
                        { ratio: 0, color: '#111111', enabled: true },
                        { ratio: 0.5, color: '#222222', enabled: true },
                        { ratio: 1, color: '#333333', enabled: false },
                    ],
                },
                settings: [...LINE_FIELDS, { path: 'showRatios', label: 'Show ratios', kind: 'boolean' }],
                shapes: () => [],
            }),
        );
        return createDrawing('test.levels', { id: 'l', paneId: 'price', anchors: ANCHORS })!;
    }
    const levels = (d: Drawing): Level[] => propsOf<{ levels: Level[] }>(d).levels;

    it('switches a level, retypes its ratio and recolors it in the tool\'s own props', async () => {
        const s = setup(levelled());
        await s.openPanel();
        const cells = (): HTMLElement[] => s.$$('.vela-dsp-lv-c');
        expect(cells()).toHaveLength(3);
        expect(cells().map((c) => c.hasAttribute('data-off'))).toEqual([false, false, true]);

        cells()[0]!.querySelector<HTMLButtonElement>('.vela-switch')!.click();
        expect(levels(s.live())[0]!.enabled).toBe(false);
        cells()[2]!.querySelector<HTMLButtonElement>('.vela-switch')!.click();
        expect(levels(s.live())[2]!.enabled).toBe(true);

        // Any number is a ratio here: below zero, and zero itself.
        const ratio = (i: number): HTMLInputElement => cells()[i]!.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!;
        ratio(1).value = '-0.25';
        ratio(1).dispatchEvent(new Event('blur'));
        ratio(2).value = '0';
        ratio(2).dispatchEvent(new Event('blur'));
        expect(levels(s.live()).map((l) => l.ratio)).toEqual([0, -0.25, 0]);

        cells()[1]!.querySelector<HTMLButtonElement>('.vela-color-field')!.click();
        const pick = document.querySelector<HTMLButtonElement>('.vela-color-field-pop button[data-c]')!;
        pick.focus();
        pick.click();
        expect(levels(s.live())[1]!.color.toLowerCase()).toBe(pick.dataset.c!.toLowerCase());
        expect(s.patches.map((p) => Object.keys(p)[0])).toEqual(['levels.0.enabled', 'levels.2.enabled', 'levels.1.ratio', 'levels.2.ratio', 'levels.1.color']);
        s.popup.destroy();
    });

    it('gets nothing of the built-in levelled tools: its own fields stay, their size controls do not come', async () => {
        const s = setup(levelled());
        expect(s.$('.vela-dpop [data-tip="Numbers size"]')).toBeNull();
        expect(s.$('.vela-dpop [data-tip="Label size"]')).toBeNull();
        await s.openPanel();
        expect(s.row('Show ratios')).toBeDefined();
        expect(s.row('Numbers')).toBeUndefined();
        expect(s.row('Labels')).toBeUndefined();
        s.popup.destroy();
        document.body.replaceChildren();

        // The built-in tools keep theirs: a retracement has both sizes, a Mach figure neither.
        const fib = setup(createDrawing('fibretracement', { id: 'f', paneId: 'price', anchors: ANCHORS })!);
        expect(fib.$('.vela-dpop [data-tip="Numbers size"]')).not.toBeNull();
        expect(fib.$('.vela-dpop [data-tip="Label size"]')).not.toBeNull();
        await fib.openPanel();
        expect(fib.row('Numbers')).toBeDefined();
        expect(fib.row('Labels')).toBeDefined();
        fib.popup.destroy();
        document.body.replaceChildren();
        const sonic = setup(createDrawing('sonic', { id: 'm', paneId: 'price', anchors: ANCHORS })!);
        expect(sonic.$('.vela-dpop [data-tip="Numbers size"]')).toBeNull();
        await sonic.openPanel();
        expect(sonic.$$('.vela-dsp-lv-c').length).toBeGreaterThan(0);
        expect(sonic.row('Show ratios')).toBeUndefined();
        sonic.popup.destroy();
    });
});
