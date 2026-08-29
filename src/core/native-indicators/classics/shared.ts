import type { InputSchema } from '../../model/inputs';
import { SERIES_LINE } from '../../palette';
import { SOURCES } from './math';

/** Input-schema builders and small color utilities shared by the catalog families. */

export function lengthInput(defval: number, key = 'length', title = 'Length', max = 5000): InputSchema {
    return { key, title, type: 'int', defval, min: 1, max, step: 1 };
}

export function sourceInput(defval: string = 'Close'): InputSchema {
    return { key: 'source', title: 'Source', type: 'string', defval, options: SOURCES };
}

export function colorInput(defval: string = SERIES_LINE, title = 'Color', key = 'color'): InputSchema {
    return { key, title, type: 'color', defval };
}

/** Soft band tint derived from a line ink (alpha applied over a 6-digit hex). */
export function withAlpha(hex: string, alpha = 0.08): string {
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return hex;
    const a = Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${m[1]!}${a}`;
}
