// The chart context menus (src/widget/context-menu-model.ts): what each right-click zone
// offers, which item is checked, and the renderer writes a selection implies — including
// the per-pane price scales. Pure functions over plain objects, so this runs in node.
import { describe, it, expect } from 'vitest';
import {
    bodyItems,
    composeMenu,
    CONTEXT_MENU_BUILTIN_ORDER,
    invertWrite,
    paneScaleAt,
    priceAxisItems,
    scaleChoiceOf,
    scaleWrites,
    settingsSectionOf,
    timeAxisItems,
    type PaneScaleInfo,
    type PriceAxisState,
} from '../src/widget/context-menu-model';
import type { MenuItemDescriptor } from '../src/ui/components/menu';
import { TIMEZONES } from '../src/widget/timezones';

function pane(id: string, kind: 'price' | 'study', top: number, height: number, extra: Partial<PaneScaleInfo> = {}): PaneScaleInfo {
    return { id, kind, top, height, mode: 'price', log: false, invert: false, ...extra };
}

const AXIS_STATE: PriceAxisState = {
    auto: true,
    invert: false,
    choice: 'regular',
    axisLabels: true,
    priceLabel: true,
    countdown: false,
    priceLine: true,
};

describe('paneScaleAt', () => {
    const panes = [pane('price', 'price', 0, 300), pane('p2', 'study', 300, 100)];

    it('maps a click y to the pane whose band contains it', () => {
        expect(paneScaleAt(panes, 10)?.id).toBe('price');
        expect(paneScaleAt(panes, 299)?.id).toBe('price');
        expect(paneScaleAt(panes, 300)?.id).toBe('p2');
        expect(paneScaleAt(panes, 399)?.id).toBe('p2');
    });

    it('falls back to the first pane out of band, and to null without per-pane scales', () => {
        expect(paneScaleAt(panes, 5000)?.id).toBe('price');
        expect(paneScaleAt([], 10)).toBeNull();
    });
});

describe('price-scale choice', () => {
    it('log wins over the mode — the four choices are one exclusive group', () => {
        expect(scaleChoiceOf({ mode: 'price', log: false })).toBe('regular');
        expect(scaleChoiceOf({ mode: 'percent', log: false })).toBe('percent');
        expect(scaleChoiceOf({ mode: 'indexed', log: false })).toBe('indexed');
        expect(scaleChoiceOf({ mode: 'percent', log: true })).toBe('log');
    });

    it('picking one choice clears the others on the main scale', () => {
        expect(scaleWrites('percent', null)).toEqual([
            ['scaleMode', 'percent'],
            ['logScale', false],
        ]);
        expect(scaleWrites('log', null)).toEqual([
            ['scaleMode', 'price'],
            ['logScale', true],
        ]);
        expect(scaleWrites('indexed', pane('price', 'price', 0, 100))).toEqual([
            ['scaleMode', 'indexed'],
            ['logScale', false],
        ]);
    });

    it('a study pane is targeted pane-scoped, so panes never affect each other', () => {
        expect(scaleWrites('log', pane('p2', 'study', 300, 100))).toEqual([
            ['scaleMode', { pane: 'p2', mode: 'price' }],
            ['logScale', { pane: 'p2', value: true }],
        ]);
    });

    it('invert follows the same main-scale / per-pane split', () => {
        expect(invertWrite(true, null)).toEqual(['invertScale', true]);
        expect(invertWrite(false, pane('price', 'price', 0, 100))).toEqual(['invertScale', false]);
        expect(invertWrite(true, pane('p2', 'study', 0, 100))).toEqual(['invertScale', { pane: 'p2', value: true }]);
    });
});

describe('price-axis menu', () => {
    it('offers auto, invert, the four scale modes, the Labels/Levels submenus and settings', () => {
        const items = priceAxisItems(AXIS_STATE);
        expect(items.map((i) => i.label)).toEqual([
            'Auto (fits data to screen)',
            'Invert scale',
            'Regular',
            'Percent',
            'Indexed to 100',
            'Logarithmic',
            'Labels',
            'Levels',
            'More settings…',
        ]);
        expect(items.filter((i) => i.separatorBefore).map((i) => i.label)).toEqual(['Regular', 'Labels', 'More settings…']);
        expect(items.find((i) => i.label === 'Labels')?.submenu?.map((i) => i.label)).toEqual(['Price axis labels', 'Last price label', 'Countdown to bar close']);
        expect(items.find((i) => i.label === 'Levels')?.submenu?.map((i) => i.id)).toEqual(['toggle:currentPriceLine']);
    });

    it('check marks track the state — exactly one scale mode at a time', () => {
        const items = priceAxisItems({ ...AXIS_STATE, auto: false, invert: true, choice: 'indexed' });
        expect(items.find((i) => i.id === 'auto')?.checked).toBe(false);
        expect(items.find((i) => i.id === 'invert')?.checked).toBe(true);
        expect(items.filter((i) => i.id.startsWith('scale:') && i.checked).map((i) => i.id)).toEqual(['scale:indexed']);
    });

    it('the submenu toggles mirror the label/level feature states', () => {
        const items = priceAxisItems({ ...AXIS_STATE, axisLabels: false, countdown: true, priceLine: false });
        const labels = items.find((i) => i.id === 'labels')!.submenu!;
        expect(labels.find((i) => i.id === 'toggle:axisLabels')?.checked).toBe(false);
        expect(labels.find((i) => i.id === 'toggle:priceLabel')?.checked).toBe(true);
        expect(labels.find((i) => i.id === 'toggle:countdown')?.checked).toBe(true);
        expect(items.find((i) => i.id === 'levels')!.submenu![0]!.checked).toBe(false);
    });
});

describe('time-axis menu', () => {
    it('lists UTC, the exchange rule, then every other timezone, and checks the active one', () => {
        const items = timeAxisItems('Europe/Paris');
        expect(items.map((i) => i.id)).toEqual(['timezone', 'settings:Scales and lines']);
        const zones = items[0]!.submenu!;
        expect(zones).toHaveLength(TIMEZONES.length + 1);
        expect(zones.slice(0, 2).map((z) => z.id)).toEqual(['tz:Etc/UTC', 'tz:exchange']);
        expect(zones.filter((z) => z.checked).map((z) => z.id)).toEqual(['tz:Europe/Paris']);
        expect(zones.find((z) => z.id === 'tz:Asia/Tokyo')?.label).toBe('(UTC+9) Tokyo');
    });

    it("a renderer's bare 'UTC' checks the same row as 'Etc/UTC'", () => {
        for (const tz of ['UTC', 'Etc/UTC']) {
            expect(timeAxisItems(tz)[0]!.submenu!.filter((z) => z.checked).map((z) => z.id)).toEqual(['tz:Etc/UTC']);
        }
    });

    it('the exchange row reads plain "Exchange" (a rule, no offset) and checks under the rule', () => {
        const zones = timeAxisItems('exchange')[0]!.submenu!;
        expect(zones.filter((z) => z.checked).map((z) => z.id)).toEqual(['tz:exchange']);
        expect(zones[1]!.label).toBe('Exchange');
        // A fixed zone active: the exchange row is offered but not checked.
        expect(timeAxisItems('Europe/Paris')[0]!.submenu![1]!.checked).toBe(false);
    });
});

describe('chart-body menu', () => {
    it('keeps the removals visible but disabled when there is nothing to remove', () => {
        const empty = bodyItems({ drawings: 0, indicators: 0 });
        expect(empty.map((i) => i.id)).toEqual(['reset-view', 'remove-drawings', 'remove-indicators', 'settings:Canvas']);
        expect(empty.filter((i) => i.disabled).map((i) => i.id)).toEqual(['remove-drawings', 'remove-indicators']);

        const full = bodyItems({ drawings: 2, indicators: 1 });
        expect(full.some((i) => i.disabled)).toBe(false);
    });

    it('every row carries an icon; the axis menus stay text-only beside their check marks', () => {
        expect(bodyItems({ drawings: 0, indicators: 0 }).map((i) => [i.id, i.icon])).toEqual([
            ['reset-view', 'reset'],
            ['remove-drawings', 'eraser'],
            ['remove-indicators', 'indicators'],
            ['settings:Canvas', 'gear'],
        ]);
        expect(priceAxisItems(AXIS_STATE).some((i) => i.icon)).toBe(false);
        expect(timeAxisItems('Etc/UTC').some((i) => i.icon)).toBe(false);
    });
});

describe('contributed rows sort together with the built-in ones', () => {
    const BODY = bodyItems({ drawings: 1, indicators: 1 });
    const row = (id: string, order?: number): { item: MenuItemDescriptor; order?: number } => ({ item: { id, label: id }, ...(order !== undefined ? { order } : {}) });
    const ids = (items: MenuItemDescriptor[]): string[] => items.map((i) => i.id);
    /** Ids with a `|` where a separator is drawn. */
    const shape = (items: MenuItemDescriptor[]): string => items.map((i) => (i.separatorBefore ? `| ${i.id}` : i.id)).join(' ');

    it('every built-in row has a documented rank', () => {
        const zones = {
            body: BODY,
            'price-axis': priceAxisItems(AXIS_STATE),
            'time-axis': timeAxisItems('Etc/UTC'),
        } as const;
        for (const [zone, items] of Object.entries(zones) as Array<[keyof typeof zones, MenuItemDescriptor[]]>) {
            const ranks: Record<string, number> = CONTEXT_MENU_BUILTIN_ORDER[zone];
            for (const item of items) expect(ranks[item.id.startsWith('settings') ? 'settings' : item.id], `${zone} ${item.id}`).toBeTypeOf('number');
            expect(Object.keys(ranks)).toHaveLength(items.length);
        }
    });

    it('with nothing contributed, every menu keeps its rows and separators', () => {
        expect(composeMenu('body', BODY, [])).toEqual(BODY.map((i) => ({ ...i, separatorBefore: Boolean(i.separatorBefore) })));
        expect(shape(composeMenu('price-axis', priceAxisItems(AXIS_STATE), []))).toBe(shape(priceAxisItems(AXIS_STATE)));
        expect(shape(composeMenu('time-axis', timeAxisItems('Etc/UTC'), []))).toBe('timezone | settings:Scales and lines');
    });

    it('an action without order lands after the built-in actions and before Settings…', () => {
        expect(shape(composeMenu('body', BODY, [row('a')]))).toBe('reset-view | remove-drawings remove-indicators | a | settings:Canvas');
    });

    it('a negative order leads the menu, separated from the built-in rows', () => {
        expect(shape(composeMenu('body', BODY, [row('copy', -100)]))).toBe('copy | reset-view | remove-drawings remove-indicators | settings:Canvas');
    });

    it('an order between two built-in ranks lands between those rows', () => {
        expect(ids(composeMenu('body', BODY, [row('x', -25), row('y', 1001)]))).toEqual(['reset-view', 'x', 'remove-drawings', 'remove-indicators', 'settings:Canvas', 'y']);
        // Splitting a built-in group separates the action from both halves.
        expect(shape(composeMenu('body', BODY, [row('x', -15)]))).toBe('reset-view | remove-drawings | x | remove-indicators | settings:Canvas');
    });

    it('ties keep registration order, the built-in row first', () => {
        expect(ids(composeMenu('body', BODY, [row('b'), row('a'), row('c', 0)])).slice(3, 6)).toEqual(['b', 'a', 'c']);
        expect(ids(composeMenu('body', BODY, [row('tie', -30)])).slice(0, 2)).toEqual(['reset-view', 'tie']);
        expect(ids(composeMenu('body', BODY, [row('last', 1000)])).slice(-2)).toEqual(['settings:Canvas', 'last']);
    });

    it('consecutive contributed rows form one group, and no separator opens or closes the menu', () => {
        const items = composeMenu('body', BODY, [row('a', -200), row('b', -100), row('c'), row('d')]);
        expect(shape(items)).toBe('a b | reset-view | remove-drawings remove-indicators | c d | settings:Canvas');
        expect(items[0]!.separatorBefore).toBe(false);
        expect(composeMenu('body', [], [row('a'), row('b')]).some((i) => i.separatorBefore)).toBe(false);
    });

    it('the axis menus keep their built-in order and groups, with More settings… at the end', () => {
        const price = composeMenu('price-axis', priceAxisItems(AXIS_STATE), [row('p')]);
        expect(shape(price)).toBe('auto invert | scale:regular scale:percent scale:indexed scale:log | labels levels | p | settings:Scales and lines');
        expect(shape(composeMenu('price-axis', priceAxisItems(AXIS_STATE), [row('lead', -100)]))).toMatch(/^lead \| auto invert \|/);
        expect(shape(composeMenu('time-axis', timeAxisItems('Etc/UTC'), [row('t')]))).toBe('timezone | t | settings:Scales and lines');
    });

    it('rows pass through untouched apart from their separator', () => {
        const item: MenuItemDescriptor = { id: 'action:x', label: 'Copy price', icon: 'clone', separatorBefore: true };
        const [first] = composeMenu('body', BODY, [{ item, order: -100 }]);
        expect(first).toEqual({ id: 'action:x', label: 'Copy price', icon: 'clone', separatorBefore: false });
        expect(composeMenu('body', BODY, [])[3]).toMatchObject({ id: 'settings:Canvas', icon: 'gear', separatorBefore: true });
    });
});

describe('settings items', () => {
    it('each zone opens the dialog tab holding that zone’s own settings', () => {
        const sectionOfLast = (items: MenuItemDescriptor[]): string | undefined => settingsSectionOf(items[items.length - 1]!.id);
        expect(sectionOfLast(bodyItems({ drawings: 0, indicators: 0 }))).toBe('Canvas');
        expect(sectionOfLast(priceAxisItems(AXIS_STATE))).toBe('Scales and lines');
        expect(sectionOfLast(timeAxisItems('Etc/UTC'))).toBe('Scales and lines');
    });

    it('a bare settings id asks for no particular tab', () => {
        expect(settingsSectionOf('settings')).toBeUndefined();
    });
});
