import { describe, it, expect } from 'vitest';
import { mapInputs, type RawPineInput } from '../src/engines/pinets/inputsMeta';

/** A raw PineTS input meta, with the fields `mapInputs` reads (rest defaulted). */
function raw(partial: Partial<RawPineInput>): RawPineInput {
    return { type: 'int', varId: 'x', title: 'X', ...partial };
}

describe('mapInputs — PineTS input meta → InputSchema', () => {
    it('preserves the specialized input types instead of collapsing them to string', () => {
        const out = mapInputs([
            raw({ type: 'price', defval: 0 }),
            raw({ type: 'time', defval: 0 }),
            raw({ type: 'session', defval: '0900-1600' }),
            raw({ type: 'timeframe', defval: 'D' }),
            raw({ type: 'symbol', defval: 'NASDAQ:AAPL' }),
            raw({ type: 'text_area', defval: 'Some text...' }),
        ]);
        expect(out.map((o) => o.type)).toEqual(['price', 'time', 'session', 'timeframe', 'symbol', 'text_area']);
    });

    it('keeps the core types mapping (int/float/bool/source/color/string)', () => {
        const out = mapInputs([
            raw({ type: 'int' }),
            raw({ type: 'float' }),
            raw({ type: 'bool' }),
            raw({ type: 'source' }),
            raw({ type: 'color' }),
            raw({ type: 'string' }),
            raw({ type: 'enum' }),
            raw({ type: undefined }),
        ]);
        expect(out.map((o) => o.type)).toEqual(['int', 'float', 'bool', 'source', 'color', 'string', 'string', 'string']);
    });

    it('coerces price/time defaults to numbers and string-y types to strings', () => {
        const [price, time, session, sym] = mapInputs([
            raw({ type: 'price', defval: 12.5 }),
            raw({ type: 'time', defval: 1700000000000 }),
            raw({ type: 'session', defval: '0900-1600' }),
            raw({ type: 'symbol', defval: 'NASDAQ:AAPL' }),
        ]);
        expect(price!.defval).toBe(12.5);
        expect(time!.defval).toBe(1700000000000);
        expect(session!.defval).toBe('0900-1600');
        expect(sym!.defval).toBe('NASDAQ:AAPL');
    });

    it('resolves bare Pine color-constant defaults (color.teal / teal) to hex', () => {
        const out = mapInputs([
            raw({ type: 'color', defval: 'color.teal' }),
            raw({ type: 'color', defval: 'color.red' }),
            raw({ type: 'color', defval: 'teal' }),
            raw({ type: 'color', defval: 'Color.GRAY' }), // case-insensitive
        ]);
        expect(out.map((o) => o.defval)).toEqual(['#089981', '#F23645', '#089981', '#787B86']);
    });

    it('passes already-resolved color defaults through unchanged (hex, hex8, rgb/rgba)', () => {
        const out = mapInputs([
            raw({ type: 'color', defval: '#F23645' }),
            raw({ type: 'color', defval: '#F2364580' }),
            raw({ type: 'color', defval: 'rgba(8, 153, 129, 0.5)' }),
        ]);
        expect(out.map((o) => o.defval)).toEqual(['#F23645', '#F2364580', 'rgba(8, 153, 129, 0.5)']);
    });

    it('promotes an untyped input(color.red) — emitted as a string — to a color input', () => {
        // The untyped `input(color.red, …)` form reaches us as type 'string' with the
        // unresolved qualified path as its default; in Pine it IS a color input.
        const out = mapInputs([
            raw({ type: 'string', defval: 'color.red' }),
            raw({ type: undefined, defval: 'color.teal' }),
        ]);
        expect(out.map((o) => [o.type, o.defval])).toEqual([
            ['color', '#F23645'],
            ['color', '#089981'],
        ]);
    });

    it('leaves genuine string inputs alone (bare names, unknown constants, other types)', () => {
        const out = mapInputs([
            raw({ type: 'string', defval: 'red' }), // bare name — could be a real string default
            raw({ type: 'string', defval: 'color.notacolor' }),
            raw({ type: 'string', defval: 'Best' }),
            raw({ type: 'bool', defval: 'color.red' }), // explicit non-string type never promotes
        ]);
        expect(out.map((o) => [o.type, o.defval])).toEqual([
            ['string', 'red'],
            ['string', 'color.notacolor'],
            ['string', 'Best'],
            ['bool', true],
        ]);
    });

    it('carries options, bounds, group, inline and tooltip through', () => {
        const [o] = mapInputs([
            raw({ type: 'string', defval: 'Default', options: ['Default', 'Option 1'], group: 'G', inline: 'row', tooltip: 'T', minval: 1, maxval: 9, step: 2 }),
        ]);
        expect(o).toMatchObject({ type: 'string', defval: 'Default', options: ['Default', 'Option 1'], group: 'G', inline: 'row', tooltip: 'T', min: 1, max: 9, step: 2 });
    });
});
