import type { SettingsField, SettingsSchema } from '../schema';
import { BrushStroke } from './Freehand';

/**
 * The highlighter's editable cosmetics — a translucent marker, so it exposes only
 * color (its alpha is the highlight's opacity, set via the color picker) and a wide
 * stroke width. No dash/text: a marker is always a solid, wide, see-through swath.
 */
const HIGHLIGHTER_FIELDS: SettingsField[] = [
    { path: 'style.lineColor', label: 'Color', kind: 'color', group: 'line' },
    { path: 'style.lineWidth', label: 'Width', kind: 'number', min: 4, max: 60, step: 1, group: 'line' },
];

/**
 * A highlighter stroke: a wide, translucent freehand swath (like a marker over text),
 * painted as one round-capped path so a stroke reads as a single continuous highlight.
 * Behaves like {@link Freehand} for placement/movement; differs only in style + paint.
 */
export class Highlighter extends BrushStroke {
    readonly type = 'highlighter' as const;

    override schema(): SettingsSchema {
        return { fields: HIGHLIGHTER_FIELDS };
    }
}
