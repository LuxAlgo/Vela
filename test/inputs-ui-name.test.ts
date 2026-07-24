import { describe, it, expect } from 'vitest';
import { nameOf } from '../src/renderers/shared/InputsUI';
import type { InputSchema } from '../src/core/model/inputs';

/** A minimal InputSchema with the fields `nameOf` reads. */
function input(partial: Partial<InputSchema>): InputSchema {
    return { key: 'intrabarTf', title: '', type: 'timeframe', defval: '1', ...partial };
}

describe('nameOf — settings-dialog input label', () => {
    it('renders no label for an explicitly empty title (inline companion control)', () => {
        // Regression: `input.timeframe('1', '', inline='intrabar')` must NOT surface its key
        // (`intrabarTf`) as the label — an empty title means "no label".
        expect(nameOf(input({ title: '' }))).toBe('');
    });

    it('capitalizes the first letter of a provided title', () => {
        expect(nameOf(input({ title: 'source' }))).toBe('Source');
        expect(nameOf(input({ title: 'Intrabar Precision' }))).toBe('Intrabar Precision');
    });

    it('shows the key-derived title that mapInputs substitutes when a title was omitted', () => {
        // `mapInputs` fills `title` with the varId when Pine omits it, so a non-empty title here
        // (even if it equals the key) is shown as-is.
        expect(nameOf(input({ title: 'intrabarTf' }))).toBe('IntrabarTf');
    });
});
