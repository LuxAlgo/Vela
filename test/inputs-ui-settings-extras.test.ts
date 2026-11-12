// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DARK_THEME } from '../src/core/theme';
import type { InputSchema, InputValue } from '../src/core/model/inputs';
import { IndicatorInputsDialog, type IndicatorDialogRow, type InputsUIChange } from '../src/renderers/shared/IndicatorInputsDialog';
import { isPopoverOpen } from '@luxalgo/vela-ui/popover';
import { fieldSection } from '@luxalgo/vela-ui/field';

/** The strategy property an engine sends for its execution modes. */
const EXECUTION: InputSchema = {
    key: 'script_execution',
    title: 'Script execution',
    type: 'string',
    defval: 'On bar close',
    options: ['On bar close', 'On order fill', 'On realtime bar tick'],
    multiple: { separator: ', ', locked: ['On bar close'] },
    group: 'Detalization and execution',
};

const settle = () => new Promise((r) => setTimeout(r, 0));

let dialog: IndicatorInputsDialog | null = null;
let changes: InputsUIChange[] = [];

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

beforeEach(() => {
    if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
        (globalThis as { CSS?: unknown }).CSS = { ...(globalThis as { CSS?: object }).CSS, escape: (s: string) => s };
    }
    changes = [];
});

afterEach(() => {
    dialog?.close();
    dialog = null;
    document.body.replaceChildren();
    vi.useRealTimers();
});

function openDialog(rows: { inputs?: InputSchema[]; values?: Record<string, InputValue>; props?: InputSchema[]; propValues?: Record<string, InputValue> }, mobile = false): IndicatorDialogRow {
    const host = document.createElement('div');
    document.body.appendChild(host);
    dialog = new IndicatorInputsDialog({
        container: host,
        theme: () => DARK_THEME,
        mobile: () => mobile,
        dialogHost: () => host,
        symbolPicker: () => null,
        onChange: (c) => changes.push(c),
        onBackdropClose: () => {},
    });
    const row: IndicatorDialogRow = {
        id: 'ind',
        title: 'Test',
        inputs: rows.inputs ?? [],
        values: rows.values ?? {},
        props: rows.props ?? [],
        propValues: rows.propValues ?? {},
    };
    dialog.open(row);
    return row;
}

const field = (key: string) => document.getElementById(`vela-inp-ind-${key}`) as HTMLButtonElement;
const shown = (key: string) => field(key).querySelector('.vela-ind-multi-value')!.textContent;
const rows = () => [...document.querySelectorAll<HTMLElement>('.vela-ind-multi-row')];
const boxOf = (row: HTMLElement) => row.querySelector('input') as HTMLInputElement;
const labelOf = (row: HTMLElement) => row.querySelector('.vela-ind-multi-label')!.textContent;

describe('IndicatorInputsDialog — multi-select string input', () => {
    it('shows the checked options in the closed field, the locked one included', () => {
        openDialog({ props: [EXECUTION] });
        expect(field('script_execution').tagName).toBe('BUTTON');
        expect(shown('script_execution')).toBe('On bar close');
    });

    it('reads a stored value through the options: order, locked items, unknown fragments', () => {
        openDialog({ props: [EXECUTION], propValues: { script_execution: 'On realtime bar tick, Nowhere' } });
        expect(shown('script_execution')).toBe('On bar close, On realtime bar tick');
    });

    it('shows each checked option by its display label, joined by the separator', () => {
        openDialog({
            inputs: [{
                key: 'modes',
                title: 'Modes',
                type: 'string',
                defval: 'b|a',
                options: ['a', 'b', 'c'],
                multiple: { separator: '|' },
                display: { options: { a: 'Alpha', b: 'Beta' } },
            }],
        });
        expect(shown('modes')).toBe('Alpha|Beta');
        field('modes').click();
        expect(rows().map(labelOf)).toEqual(['Alpha', 'Beta', 'c']);
    });

    it('lists the options as checkboxes, the locked one checked and disabled', async () => {
        openDialog({ props: [EXECUTION] });
        field('script_execution').click();
        await settle();
        const list = rows();
        expect(list.map(labelOf)).toEqual(['On bar close', 'On order fill', 'On realtime bar tick']);
        expect(list.map((r) => boxOf(r).checked)).toEqual([true, false, false]);
        expect(boxOf(list[0]!).disabled).toBe(true);
        expect(list[0]!.querySelector('[data-scope="switch"]')!.hasAttribute('data-disabled')).toBe(true);
        expect(boxOf(list[1]!).disabled).toBe(false);
        // A locked option cannot be cleared.
        boxOf(list[0]!).click();
        await settle();
        expect(boxOf(list[0]!).checked).toBe(true);
        expect(changes).toEqual([]);
    });

    it('emits the joined value on each toggle and stays open for the next one', async () => {
        const row = openDialog({ props: [EXECUTION] });
        field('script_execution').click();
        await settle();
        boxOf(rows()[1]!).click();
        await settle();
        expect(changes[changes.length - 1]).toEqual({ indicatorId: 'ind', key: 'script_execution', value: 'On bar close, On order fill', kind: 'prop' });
        expect(row.propValues.script_execution).toBe('On bar close, On order fill');
        expect(shown('script_execution')).toBe('On bar close, On order fill');
        expect(isPopoverOpen()).toBe(true);

        // A click on the option's label toggles it too.
        (rows()[2]!.querySelector('.vela-ind-multi-label') as HTMLElement).click();
        await settle();
        expect(changes[changes.length - 1]?.value).toBe('On bar close, On order fill, On realtime bar tick');

        boxOf(rows()[1]!).click();
        await settle();
        expect(changes[changes.length - 1]?.value).toBe('On bar close, On realtime bar tick');
        expect(shown('script_execution')).toBe('On bar close, On realtime bar tick');
        expect(isPopoverOpen()).toBe(true);

        // The field closes it again.
        field('script_execution').click();
        expect(isPopoverOpen()).toBe(false);
        expect(rows()).toHaveLength(0);
    });

    it('works from the keyboard: arrows open and move, Enter toggles, Escape closes', async () => {
        openDialog({ inputs: [{ ...EXECUTION, group: undefined }] });
        await new Promise((r) => setTimeout(r, 50)); // the dialog's own opening focus lands first
        const trigger = field('script_execution');
        trigger.focus();
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        await settle();
        expect(isPopoverOpen()).toBe(true);
        // The locked option is skipped: focus lands on the first one the user can change.
        expect(document.activeElement).toBe(boxOf(rows()[1]!));
        const key = (k: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        key('ArrowDown');
        expect(document.activeElement).toBe(boxOf(rows()[2]!));
        key('Enter');
        await settle();
        expect(changes[changes.length - 1]).toEqual({ indicatorId: 'ind', key: 'script_execution', value: 'On bar close, On realtime bar tick' });
        key('ArrowDown');
        expect(document.activeElement).toBe(boxOf(rows()[1]!));
        key('Escape');
        expect(isPopoverOpen()).toBe(false);
        expect(document.activeElement).toBe(trigger);
        expect(dialog!.isOpen()).toBe(true);
    });

    it('leaves inputs without `multiple` on the single select', () => {
        openDialog({ inputs: [{ key: 'mode', title: 'Mode', type: 'string', defval: 'On bar close', options: ['On bar close', 'On order fill'] }] });
        expect(field('mode').getAttribute('data-slot')).toBe('select-trigger');
        expect(document.querySelector('.vela-ind-multi-trigger')).toBeNull();
    });
});

describe('IndicatorInputsDialog — dropdown width', () => {
    const sizerLines = (key: string) =>
        [...field(key).closest('.vela-ind-hug')!.querySelectorAll('.vela-ind-hug-sizer > span')].map((s) => s.textContent);

    it('sizes a select to its longest display label instead of the fixed 100px column', () => {
        openDialog({
            inputs: [
                { key: 'mode', title: 'Mode', type: 'string', defval: 'a', options: ['a', 'b'], display: { options: { a: 'On bar close', b: 'On every realtime tick' } } },
                { key: 'len', title: 'Length', type: 'int', defval: 14 },
            ],
        });
        const hug = field('mode').closest('.vela-ind-hug') as HTMLElement;
        expect(hug).not.toBeNull();
        expect(hug.parentElement!.classList.contains('vela-field-cell')).toBe(true);
        expect(hug.parentElement!.style.width).toBe('');
        expect(sizerLines('mode')).toEqual(['On bar close', 'On every realtime tick']);
        // Number fields keep their 100px column.
        const len = document.getElementById('vela-inp-ind-len')!.closest('[data-slot="number-input"]') as HTMLElement;
        expect(len.parentElement!.style.width).toBe('100px');
        // Never narrower than that column, shrinkable down to it when the row runs out of room.
        const sheet = document.getElementById('vela-ind-dialog-styles')!.textContent!;
        expect(sheet).toMatch(/\.vela-ind-hug\{display:grid;grid-template-columns:minmax\(0,1fr\);min-width:100px;\}/);
    });

    it('sizes a multi-select to the value with every option checked', () => {
        openDialog({ props: [EXECUTION] });
        expect(sizerLines('script_execution')).toEqual(['On bar close, On order fill, On realtime bar tick']);
    });

    it('sizes source, timeframe and inline selects the same way', () => {
        openDialog({
            inputs: [
                { key: 'src', title: 'Source', type: 'source', defval: 'close' },
                { key: 'tf', title: 'Timeframe', type: 'timeframe', defval: '' },
                { key: 'on', title: '', type: 'bool', defval: true, inline: 'x' },
                { key: 'kind', title: 'Kind', type: 'string', defval: 'Simple', options: ['Simple', 'Exponential moving average'], inline: 'x' },
            ],
        });
        expect(sizerLines('src')).toContain('volume');
        expect(sizerLines('tf')).toContain('45 minutes');
        expect(sizerLines('kind')).toEqual(['Simple', 'Exponential moving average']);
        expect(field('kind').closest('.vela-ind-hug')!.parentElement!.classList.contains('vela-field-inline-item')).toBe(true);
    });

    it('stops at half the screen on mobile, where labels share the row', () => {
        openDialog({ props: [EXECUTION] }, true);
        expect(field('script_execution').closest('.vela-ind-hug')!.hasAttribute('data-mobile')).toBe(true);
    });
});

describe('IndicatorInputsDialog — help mark on a section heading', () => {
    const heading = (text: string) =>
        [...document.querySelectorAll<HTMLElement>('[data-slot~="field-section"]')].find((h) => h.textContent === text)!;
    const markOf = (h: HTMLElement) => h.querySelector<HTMLElement>('.vela-hint');

    it('shows no mark without groupHelp', () => {
        openDialog({ props: [EXECUTION] });
        expect(markOf(heading('Detalization and execution'))).toBeNull();
    });

    it('shows the text as the tooltip and the accessible name', async () => {
        vi.useFakeTimers();
        openDialog({ props: [{ ...EXECUTION, groupHelp: { text: 'How orders fill.' } }] });
        const mark = markOf(heading('Detalization and execution'))!;
        expect(mark.tagName).toBe('SPAN');
        expect(mark.getAttribute('aria-label')).toBe('How orders fill.');
        expect(mark.innerHTML).toContain('<svg');
        const enter = new Event('pointerenter');
        Object.defineProperty(enter, 'pointerType', { value: 'mouse' });
        mark.dispatchEvent(enter);
        vi.advanceTimersByTime(300);
        const tips = [...document.querySelectorAll<HTMLElement>('div')].filter((d) => d.textContent === 'How orders fill.' && d.style.position === 'absolute');
        expect(tips).toHaveLength(1);
    });

    it('links an https URL into a new tab that cannot reach back', () => {
        openDialog({ props: [{ ...EXECUTION, groupHelp: { text: 'Broker emulator', url: 'https://example.com/help' } }] });
        const mark = markOf(heading('Detalization and execution'))! as HTMLAnchorElement;
        expect(mark.tagName).toBe('A');
        expect(mark.href).toBe('https://example.com/help');
        expect(mark.target).toBe('_blank');
        expect(mark.rel).toBe('noopener noreferrer');
    });

    it('names a link that has no text', () => {
        openDialog({ props: [{ ...EXECUTION, groupHelp: { url: 'http://example.com/' } }] });
        const mark = markOf(heading('Detalization and execution'))!;
        expect(mark.tagName).toBe('A');
        expect(mark.getAttribute('aria-label')).toBe('Help');
    });

    it('never links any other scheme', () => {
        openDialog({
            inputs: [
                { key: 'a', title: 'A', type: 'int', defval: 1, group: 'One', groupHelp: { text: 'Tip', url: 'javascript:alert(1)' } },
                { key: 'b', title: 'B', type: 'int', defval: 1, group: 'Two', groupHelp: { url: 'java\tscript:alert(1)' } },
                { key: 'c', title: 'C', type: 'int', defval: 1, group: 'Three', groupHelp: { url: 'data:text/html,hi' } },
            ],
        });
        expect(document.querySelector('a.vela-hint')).toBeNull();
        expect(markOf(heading('One'))!.getAttribute('aria-label')).toBe('Tip');
        expect(markOf(heading('Two'))).toBeNull();
        expect(markOf(heading('Three'))).toBeNull();
    });

    it('takes the first input of the group that carries one', () => {
        openDialog({
            inputs: [
                { key: 'a', title: 'A', type: 'int', defval: 1, group: 'G' },
                { key: 'b', title: 'B', type: 'int', defval: 1, group: 'G', groupHelp: { text: 'First' } },
                { key: 'c', title: 'C', type: 'int', defval: 1, group: 'G', groupHelp: { text: 'Second' } },
                { key: 'd', title: 'D', type: 'int', defval: 1, groupHelp: { text: 'Ungrouped' } },
            ],
        });
        const marks = [...document.querySelectorAll<HTMLElement>('.vela-hint')];
        expect(marks.map((m) => m.getAttribute('aria-label'))).toEqual(['First']);
        expect(markOf(heading('G'))).toBe(marks[0]);
    });
});

describe('fieldSection — info element', () => {
    it('places the element after the heading text', () => {
        const mark = document.createElement('span');
        const el = fieldSection('Broker emulator', { variant: 'inputs', info: mark });
        expect(el.textContent).toBe('Broker emulator');
        expect(el.lastChild).toBe(mark);
        expect(el.hasAttribute('data-info')).toBe(true);
        expect(fieldSection('Plain').hasAttribute('data-info')).toBe(false);
    });
});
