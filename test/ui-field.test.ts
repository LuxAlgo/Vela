import { describe, expect, it } from 'vitest';
import { fieldGridColumns, FIELD_GAP_PX } from '../src/ui/components/field/controller';
import { textAreaController } from '../src/ui/components/text-area/controller';
import { glyphSelectController, widthFieldOptions, WIDTH_FIELD_OPTIONS } from '../src/ui/components/glyph-select/controller';

describe('fieldGridColumns', () => {
    it('gives leftover space to the inputs control column', () => {
        expect(fieldGridColumns('inputs', false)).toBe('max-content 1fr');
        expect(fieldGridColumns('inputs', true)).toBe('minmax(0,1fr) auto');
    });

    it('hugs both settings columns on desktop', () => {
        expect(fieldGridColumns('settings', false)).toBe('max-content max-content');
        expect(fieldGridColumns('settings', true)).toBe('minmax(0,1fr) max-content');
    });

    it('keeps the 16px settings rhythm', () => {
        expect(FIELD_GAP_PX).toBe(16);
    });
});

describe('textAreaController', () => {
    it('commits a new value and skips a no-op', () => {
        const seen: string[] = [];
        const c = textAreaController({ value: 'a', onChange: (v) => seen.push(v) });
        expect(c.commit('a')).toBeNull();
        expect(c.commit('b')).toBe('b');
        expect(seen).toEqual(['b']);
        c.sync('c');
        expect(c.value).toBe('c');
        expect(seen).toEqual(['b']);
    });
});

describe('glyphSelectController', () => {
    it('picks without emitting on setValue', () => {
        const seen: number[] = [];
        const c = glyphSelectController({
            options: widthFieldOptions(),
            value: 2,
            onChange: (v) => seen.push(v),
        });
        expect(WIDTH_FIELD_OPTIONS).toEqual([1, 2, 3, 4, 5]);
        c.setValue(4);
        expect(c.value).toBe(4);
        expect(seen).toEqual([]);
        expect(c.pick(3)).toBe(3);
        expect(seen).toEqual([3]);
        expect(c.optionOf(1)?.label).toBe('1px');
    });
});
