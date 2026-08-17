import { describe, it, expect } from 'vitest';
import { tabInputs, DEFAULT_INPUT_TAB, INPUT_DIALOG_GAP_PX, inputDialogBodyStyle } from '../src/renderers/shared/InputsUI';
import type { InputSchema } from '../src/core/model/inputs';

/** A minimal InputSchema with the fields `tabInputs` reads. */
function input(key: string, tab?: string): InputSchema {
    return { key, title: key, type: 'int', defval: 1, ...(tab !== undefined ? { tab } : {}) };
}

describe('tabInputs — settings-dialog tab partition', () => {
    it('puts every input on the default "Inputs" tab when none declares a tab', () => {
        const tabs = tabInputs([input('a'), input('b')]);
        expect(tabs).toHaveLength(1);
        expect(tabs[0]!.name).toBe(DEFAULT_INPUT_TAB);
        expect(tabs[0]!.inputs.map((i) => i.key)).toEqual(['a', 'b']);
    });

    it('leads with the default tab and follows with declared tabs in first-seen order', () => {
        const tabs = tabInputs([
            input('s1', 'Style'),
            input('a'),
            input('v1', 'Visibility'),
            input('s2', 'Style'),
        ]);
        expect(tabs.map((t) => t.name)).toEqual([DEFAULT_INPUT_TAB, 'Style', 'Visibility']);
        expect(tabs[1]!.inputs.map((i) => i.key)).toEqual(['s1', 's2']);
    });

    it('merges an explicit tab="Inputs" with the default tab', () => {
        const tabs = tabInputs([input('a', 'Inputs'), input('b')]);
        expect(tabs).toHaveLength(1);
        expect(tabs[0]!.inputs.map((i) => i.key)).toEqual(['a', 'b']);
    });

    it('treats an empty tab name as unset (default tab)', () => {
        const tabs = tabInputs([input('a', '')]);
        expect(tabs).toHaveLength(1);
        expect(tabs[0]!.name).toBe(DEFAULT_INPUT_TAB);
    });

    it('omits the default tab entirely when every input declares another tab', () => {
        const tabs = tabInputs([input('s1', 'Style'), input('s2', 'Style')]);
        expect(tabs.map((t) => t.name)).toEqual(['Style']);
    });
});

describe('inputDialogBodyStyle — settings-dialog row rhythm', () => {
    it('packs rows at the start so a flex-grown mobile body keeps the 16px gap', () => {
        const style = inputDialogBodyStyle(true);
        expect(style).toContain('align-content:start');
        expect(style).toContain(`row-gap:${INPUT_DIALOG_GAP_PX}px`);
        expect(style).toContain('flex:1 1 auto');
        expect(style).toContain('grid-template-columns:minmax(0,1fr) auto');
    });

    it('uses the same packed rhythm on desktop (content-sized card, same 16px gap)', () => {
        const style = inputDialogBodyStyle(false);
        expect(style).toContain('align-content:start');
        expect(style).toContain(`row-gap:${INPUT_DIALOG_GAP_PX}px`);
        expect(style).toContain('grid-template-columns:max-content 1fr');
    });
});
