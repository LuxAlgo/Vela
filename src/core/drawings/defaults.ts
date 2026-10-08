import type { Drawing } from './Drawing';
import type { DrawingStyle, DrawingText } from './style';
import { defaultText } from './style';
import { clonePlain } from './document';
import { BEARISH, BULLISH, NEUTRAL } from '../palette';

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

/** A named, saved look for one tool (a "style"): applied, it sets the same settings a
 *  remembered default does — style, text styling and per-type settings. */
export interface DrawingToolTemplate {
    name: string;
    settings: DrawingToolDefaults;
}

/** Longest template name kept (a label, not a note). */
const TEMPLATE_NAME_MAX = 60;

/** Coerce an untrusted list into templates: named, de-duplicated by name (last wins, in
 *  first-seen position), with valid settings. */
export function sanitizeToolTemplates(raw: unknown): DrawingToolTemplate[] {
    if (!Array.isArray(raw)) return [];
    const byName = new Map<string, DrawingToolTemplate>();
    for (const entry of raw) {
        if (entry == null || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const name = typeof e.name === 'string' ? e.name.trim().slice(0, TEMPLATE_NAME_MAX) : '';
        const settings = sanitizeToolDefaults(e.settings);
        if (name && settings) byName.set(name, { name, settings });
    }
    return [...byName.values()];
}

const LINE_TOOLS = new Set(['trendline', 'ray', 'extendedline', 'hline', 'hray', 'vline', 'crossline', 'infoline', 'trendangle']);
const AREA_TOOLS = new Set(['box', 'rotatedrect', 'ellipse', 'circle', 'triangle', 'parallelchannel', 'disjointchannel', 'flattopbottom']);
const BULL = BULLISH;
const BEAR = BEARISH;
const MUTED = NEUTRAL;

/** The looks every chart offers for a tool before the user saves any of their own. */
export function builtinToolTemplates(type: string): DrawingToolTemplate[] {
    if (LINE_TOOLS.has(type)) {
        return [
            { name: 'Support', settings: { style: { lineColor: BULL, lineWidth: 2, lineStyle: 'solid' } } },
            { name: 'Resistance', settings: { style: { lineColor: BEAR, lineWidth: 2, lineStyle: 'solid' } } },
            { name: 'Projection', settings: { style: { lineColor: MUTED, lineWidth: 1, lineStyle: 'dashed' } } },
        ];
    }
    if (AREA_TOOLS.has(type)) {
        return [
            { name: 'Demand', settings: { style: { lineColor: BULL, fillColor: `${BULL}26` } } },
            { name: 'Supply', settings: { style: { lineColor: BEAR, fillColor: `${BEAR}26` } } },
        ];
    }
    return [];
}
