import type { Drawing } from './Drawing';
import type { DrawingStyle, DrawingText } from './style';
import { defaultText } from './style';
import { clonePlain } from './document';

/**
 * A tool's remembered settings — what the next drawing of that type starts from. Captured
 * from the last drawing of the type the user styled: its style, its text styling (never the
 * words themselves) and its per-type settings (`props`: fib levels, position sizing, profile
 * rows…). Geometry, lock, visibility and depth are per-drawing and never carried over.
 */
export interface DrawingToolDefaults {
    style?: Partial<DrawingStyle>;
    text?: Partial<Omit<DrawingText, 'value'>>;
    props?: Record<string, unknown>;
}

/** The settings a drawing would hand to the next one of its type. */
export function captureToolDefaults(d: Drawing): DrawingToolDefaults {
    const out: DrawingToolDefaults = { style: { ...d.style } };
    if (d.text) {
        const { value: _value, ...styling } = d.text;
        out.text = styling;
    }
    const props = d.serialize().props;
    if (props !== undefined) out.props = clonePlain(props);
    return out;
}

/** Start `d` from a tool's remembered settings (keeps its geometry and any typed text). */
export function applyToolDefaults(d: Drawing, defaults: DrawingToolDefaults | undefined): void {
    if (!defaults) return;
    if (defaults.style) d.style = { ...d.style, ...defaults.style };
    if (defaults.text) d.text = { ...(d.text ?? defaultText()), ...defaults.text, value: d.text?.value ?? '' };
    if (defaults.props) d.applyProps(clonePlain(defaults.props));
}

/** Whether two remembered settings are the same (cheap: both are plain JSON). */
export function sameToolDefaults(a: DrawingToolDefaults | undefined, b: DrawingToolDefaults | undefined): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Coerce an untrusted value (a persisted document) into remembered settings, or null. Only the
 *  object shapes are checked here: each drawing type validates its own props when it reads them,
 *  the same lenient contract `fromJSON` keeps. */
export function sanitizeToolDefaults(raw: unknown): DrawingToolDefaults | null {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const obj = (v: unknown): Record<string, unknown> | undefined => (v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
    const out: DrawingToolDefaults = {};
    const style = obj(r.style);
    if (style) out.style = style as Partial<DrawingStyle>;
    const text = obj(r.text);
    if (text) {
        const { value: _value, ...styling } = text;
        out.text = styling as DrawingToolDefaults['text'];
    }
    const props = obj(r.props);
    if (props) out.props = props;
    return out.style || out.text || out.props ? out : null;
}
