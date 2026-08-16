import { describe, it, expect } from 'vitest';
import { splitColor, combineColor } from '../src/ui/components/color-picker';

describe('color picker color math', () => {
    it('splitColor parses #RRGGBB, #RRGGBBAA, #RGB and rgba()', () => {
        expect(splitColor('#38c0fd')).toEqual({ hex6: '#38c0fd', alpha: 1 });
        const a = splitColor('#38c0fd80');
        expect(a.hex6).toBe('#38c0fd');
        expect(a.alpha).toBeCloseTo(128 / 255, 3);
        expect(splitColor('#0af')).toEqual({ hex6: '#00aaff', alpha: 1 });
        const r = splitColor('rgba(56, 192, 253, 0.5)');
        expect(r.hex6).toBe('#38c0fd');
        expect(r.alpha).toBeCloseTo(0.5, 3);
    });

    it('combineColor → #RRGGBB when opaque, #RRGGBBAA otherwise', () => {
        expect(combineColor('#38c0fd', 1)).toBe('#38c0fd');
        expect(combineColor('#38c0fd', 0.5)).toBe('#38c0fd80'); // 0.5·255 = 128 = 0x80
        expect(combineColor('#38c0fd', 0.35)).toBe('#38c0fd59'); // 0.35·255 ≈ 89 = 0x59
        expect(combineColor('#38c0fd', 0)).toBe('#38c0fd00');
    });
});
