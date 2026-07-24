import { Drawing, type DrawingTypeKey, type SerializedDrawing } from './Drawing';
import type { DrawingStyle } from './style';
import { DEFAULT_DRAWING_COLOR } from './style';
import { TrendLine } from './types/TrendLine';
import { HorizontalLine } from './types/HorizontalLine';
import { Ray } from './types/Ray';
import { ExtendedLine } from './types/ExtendedLine';
import { VerticalLine } from './types/VerticalLine';
import { HorizontalRay } from './types/HorizontalRay';
import { CrossLine } from './types/CrossLine';
import { InfoLine } from './types/InfoLine';
import { TrendAngle } from './types/TrendAngle';
import { Box } from './types/Box';
import { TextLabel } from './types/TextLabel';
import { Note } from './types/Note';
import { PriceLabel } from './types/PriceLabel';
import { Callout } from './types/Callout';
import { PriceNote } from './types/PriceNote';
import { Comment } from './types/Comment';
import { Signpost } from './types/Signpost';
import { ParallelChannel } from './types/ParallelChannel';
import { DisjointChannel } from './types/DisjointChannel';
import { FlatTopBottom } from './types/FlatTopBottom';
import { RegressionChannel } from './types/RegressionChannel';
import { AnchoredVwap } from './types/AnchoredVwap';
import { FixedRangeVolumeProfile } from './types/FixedRangeVolumeProfile';
import { Pitchfork } from './types/Pitchfork';
import { SchiffPitchfork } from './types/SchiffPitchfork';
import { ModifiedSchiffPitchfork } from './types/ModifiedSchiffPitchfork';
import { InsidePitchfork } from './types/InsidePitchfork';
import { Arrow } from './types/Arrow';
import { Ellipse } from './types/Ellipse';
import { Triangle } from './types/Triangle';
import { Polyline } from './types/Polyline';
import { Freehand } from './types/Freehand';
import { Highlighter } from './types/Highlighter';
import { Circle } from './types/Circle';
import { RotatedRect } from './types/RotatedRect';
import { Path } from './types/Path';
import { Arc } from './types/Arc';
import { Curve } from './types/Curve';
import { ArrowMarkUp, ArrowMarkDown } from './types/ArrowMark';
import { FlagMark, IconStamp } from './types/GlyphStamp';
import { FibRetracement } from './types/FibRetracement';
import { FibExtension } from './types/FibExtension';
import { FibExtensionTrend } from './types/FibExtensionTrend';
import { FibFan } from './types/FibFan';
import { FibTimeZones } from './types/FibTimeZones';
import { FibChannel } from './types/FibChannel';
import { FibSpeedFan } from './types/FibSpeedFan';
import { TrendFibTime } from './types/TrendFibTime';
import { FibCircles } from './types/FibCircles';
import { FibArcs } from './types/FibArcs';
import { FibWedge } from './types/FibWedge';
import { FibSpiral } from './types/FibSpiral';
import { GannFan } from './types/GannFan';
import { GannBox } from './types/GannBox';
import { GannSquare } from './types/GannSquare';
import { DedekindTessellation } from './types/DedekindTessellation';
import { Sonic, Supersonic } from './types/MachFigure';
import { GoldenSonic, GoldenSupersonic } from './types/GoldenMach';
import { XABCD } from './types/XABCD';
import { ABCDPattern } from './types/ABCDPattern';
import { ElliottImpulse } from './types/ElliottImpulse';
import { ElliottCorrection } from './types/ElliottCorrection';
import { HeadShoulders } from './types/HeadShoulders';
import { Gartley } from './types/Gartley';
import { Bat } from './types/Bat';
import { Butterfly } from './types/Butterfly';
import { Crab } from './types/Crab';
import { Shark } from './types/Shark';
import { Cypher } from './types/Cypher';
import { DatePriceRange } from './types/DatePriceRange';
import { PositionTool } from './types/PositionTool';

/** What a drawing type contributes to the toolbar + factory (renderer-neutral). */
export interface DrawingTypeMeta {
    type: DrawingTypeKey;
    /** Toolbar group id (e.g. `'lines'`, `'shapes'`, `'annotations'`). */
    group: string;
    label: string;
    /** Inline SVG markup for the toolbar button — no DOM, renderer paints it. */
    icon: string;
    defaultStyle: DrawingStyle;
    /** Build an instance from a (partial) serialized record. Serves create + deserialize. */
    create(init: Partial<SerializedDrawing> & { paneId: string }): Drawing;
}

const REGISTRY = new Map<string, DrawingTypeMeta>();

/** Register (or replace) a drawing type. Built-ins register at module load; new
 *  types (fibs/patterns) call this — no base/port/facade change. */
export function registerDrawingType(meta: DrawingTypeMeta): void {
    REGISTRY.set(meta.type, meta);
}

export function getDrawingType(type: string): DrawingTypeMeta | undefined {
    return REGISTRY.get(type);
}

export function drawingTypes(): DrawingTypeMeta[] {
    return [...REGISTRY.values()];
}

/** Build a fresh drawing of `type` on `paneId`, seeding the type's default style. */
export function createDrawing(type: DrawingTypeKey, init: Partial<SerializedDrawing> & { paneId: string }): Drawing | null {
    const meta = REGISTRY.get(type);
    if (!meta) return null;
    // Merge any caller style onto the type's default so a partial override keeps the
    // rest (e.g. a box keeps its default fill when only the line color is set), and an
    // absent/undefined style doesn't clobber the default.
    const style = { ...meta.defaultStyle, ...(init.style ?? {}) };
    return meta.create({ ...init, style });
}

/**
 * Restore a drawing's cosmetics + type extras to the type's factory defaults.
 * Keeps identity / geometry / lock / visibility / z-order, and preserves typed
 * text content (`text.value`) when the type seeds a text block.
 */
export function resetDrawingSettings(drawing: Drawing): void {
    const fresh = createDrawing(drawing.type, { paneId: drawing.paneId });
    if (!fresh) return;
    drawing.style = { ...fresh.style };
    const keptValue = drawing.text?.value;
    if (fresh.text) {
        drawing.text = { ...fresh.text };
        if (keptValue !== undefined) drawing.text.value = keptValue;
    } else {
        // Drop lazily-created text styling (e.g. measure-box label color/size).
        drawing.text = undefined;
    }
    const props = fresh.serialize().props;
    if (props !== undefined) drawing.applyProps(props);
}

/** Rehydrate a {@link Drawing} from a plain record, or null for an unknown type. */
export function deserializeDrawing(doc: SerializedDrawing): Drawing | null {
    const meta = REGISTRY.get(doc.type);
    return meta ? meta.create(doc) : null;
}

// ── built-in lean-core types ──
const LINE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="19" x2="20" y2="5"/></svg>';
const HLINE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/></svg>';

registerDrawingType({
    type: 'trendline',
    group: 'lines',
    label: 'Trend Line',
    icon: LINE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new TrendLine(init),
});

registerDrawingType({
    type: 'hline',
    group: 'lines',
    label: 'Horizontal Line',
    icon: HLINE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'dashed' },
    create: (init) => new HorizontalLine(init),
});

const RAY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="20" x2="21" y2="6"/><circle cx="3" cy="20" r="1.6" fill="currentColor"/></svg>';
const BOX_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>';
const TEXT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 6h14M12 6v13"/></svg>';

registerDrawingType({
    type: 'ray',
    group: 'lines',
    label: 'Ray',
    icon: RAY_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new Ray(init),
});

const EXTLINE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19 19 5"/><path d="M5 19 8.5 19M5 19 5 15.5"/><path d="M19 5 15.5 5M19 5 19 8.5"/></svg>';
const VLINE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="3" x2="12" y2="21"/></svg>';
const HRAY_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="21" y2="12"/><circle cx="5" cy="12" r="1.6" fill="currentColor"/></svg>';
const CROSSLINE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/></svg>';
const INFOLINE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 20 4"/><rect x="9" y="9" width="9" height="6" rx="1"/></svg>';
const TRENDANGLE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 20 6"/><path d="M4 20 15 20"/><path d="M11 20a7 7 0 0 0-2-4.9"/></svg>';

registerDrawingType({
    type: 'extendedline',
    group: 'lines',
    label: 'Extended Line',
    icon: EXTLINE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new ExtendedLine(init),
});

registerDrawingType({
    type: 'vline',
    group: 'lines',
    label: 'Vertical Line',
    icon: VLINE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new VerticalLine(init),
});

registerDrawingType({
    type: 'hray',
    group: 'lines',
    label: 'Horizontal Ray',
    icon: HRAY_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new HorizontalRay(init),
});

registerDrawingType({
    type: 'crossline',
    group: 'lines',
    label: 'Cross Line',
    icon: CROSSLINE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new CrossLine(init),
});

registerDrawingType({
    type: 'infoline',
    group: 'lines',
    label: 'Info Line',
    icon: INFOLINE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new InfoLine(init),
});

registerDrawingType({
    type: 'trendangle',
    group: 'lines',
    label: 'Trend Angle',
    icon: TRENDANGLE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new TrendAngle(init),
});

registerDrawingType({
    type: 'box',
    group: 'shapes',
    label: 'Rectangle',
    icon: BOX_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}26` },
    create: (init) => new Box(init),
});

registerDrawingType({
    type: 'text',
    group: 'annotations',
    label: 'Text',
    icon: TEXT_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new TextLabel(init),
});

const CALLOUT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-5 5v-5H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>';

registerDrawingType({
    type: 'callout',
    group: 'annotations',
    label: 'Callout',
    icon: CALLOUT_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}d9` },
    create: (init) => new Callout(init),
});

const SA = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const NOTE_ICON = `<svg viewBox="0 0 24 24" ${SA}><path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-4 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M8 8.5h8M8 12h5"/></svg>`;
const PRICE_NOTE_ICON = `<svg viewBox="0 0 24 24" ${SA}><rect x="10" y="4.5" width="11" height="8" rx="1.5"/><path d="M10 8.5 4 16"/><circle cx="3.5" cy="16.5" r="1.6" fill="currentColor" stroke="none"/></svg>`;
const COMMENT_ICON = `<svg viewBox="0 0 24 24" ${SA}><path d="M5 4.5h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-7l-4 4v-4H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z"/></svg>`;
const PRICE_LABEL_ICON = `<svg viewBox="0 0 24 24" ${SA}><path d="M3 12 7 8h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7Z"/><path d="M10.5 12.5h6" stroke-width="1.4"/></svg>`;
const SIGNPOST_ICON = `<svg viewBox="0 0 24 24" ${SA}><path d="M12 11.5V21"/><rect x="5" y="4" width="14" height="7" rx="1"/><path d="M9 7.5h6"/></svg>`;

registerDrawingType({
    type: 'note',
    group: 'annotations',
    label: 'Note',
    icon: NOTE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}d9` },
    create: (init) => new Note(init),
});

registerDrawingType({
    type: 'pricenote',
    group: 'annotations',
    label: 'Price Note',
    icon: PRICE_NOTE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}d9` },
    create: (init) => new PriceNote(init),
});

registerDrawingType({
    type: 'comment',
    group: 'annotations',
    label: 'Comment',
    icon: COMMENT_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}d9` },
    create: (init) => new Comment(init),
});

registerDrawingType({
    type: 'pricelabel',
    group: 'annotations',
    label: 'Price Label',
    icon: PRICE_LABEL_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}d9` },
    create: (init) => new PriceLabel(init),
});

registerDrawingType({
    type: 'signpost',
    group: 'annotations',
    label: 'Signpost',
    icon: SIGNPOST_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}d9` },
    create: (init) => new Signpost(init),
});

// ── lines & channels ──
const PARALLEL_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="16" x2="21" y2="8"/><line x1="3" y1="21" x2="21" y2="13"/></svg>';
const DISJOINT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="7" x2="21" y2="10"/><line x1="3" y1="18" x2="21" y2="14"/></svg>';
const PITCHFORK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="4" cy="12" r="1.6" fill="currentColor"/><line x1="4" y1="12" x2="10" y2="12"/><line x1="10" y1="6" x2="10" y2="18"/><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/></svg>';

registerDrawingType({
    type: 'parallelchannel',
    group: 'channels',
    label: 'Parallel Channel',
    icon: PARALLEL_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}1a` },
    create: (init) => new ParallelChannel(init),
});

registerDrawingType({
    type: 'disjointchannel',
    group: 'channels',
    label: 'Disjoint Channel',
    icon: DISJOINT_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}1a` },
    create: (init) => new DisjointChannel(init),
});

const FLATTOP_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="18" x2="21" y2="11"/></svg>';

registerDrawingType({
    type: 'flattopbottom',
    group: 'channels',
    label: 'Flat Top/Bottom',
    icon: FLATTOP_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}1a` },
    create: (init) => new FlatTopBottom(init),
});

const REGRESSION_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="8" x2="21" y2="4"/><line x1="3" y1="16" x2="21" y2="12"/><line x1="3" y1="12" x2="21" y2="8" stroke-dasharray="3 3"/></svg>';

registerDrawingType({
    type: 'regressionchannel',
    group: 'channels',
    label: 'Linear Regression',
    icon: REGRESSION_ICON,
    defaultStyle: { lineColor: '#787b86', lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new RegressionChannel(init),
});

registerDrawingType({
    type: 'pitchfork',
    group: 'pitchforks',
    label: 'Pitchfork',
    icon: PITCHFORK_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new Pitchfork(init),
});

const SCHIFF_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="4" cy="8" r="1.6" fill="currentColor"/><line x1="4" y1="8" x2="10" y2="12"/><line x1="10" y1="6" x2="10" y2="18"/><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/></svg>';
const MODSCHIFF_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="9" r="1.6" fill="currentColor"/><line x1="6" y1="9" x2="10" y2="12"/><line x1="10" y1="6" x2="10" y2="18"/><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/></svg>';
const INSIDE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="12" x2="10" y2="12"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="10" y1="8" x2="21" y2="8"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="16" x2="21" y2="16"/></svg>';

registerDrawingType({
    type: 'schiffpitchfork',
    group: 'pitchforks',
    label: 'Schiff Pitchfork',
    icon: SCHIFF_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new SchiffPitchfork(init),
});

registerDrawingType({
    type: 'modifiedschiffpitchfork',
    group: 'pitchforks',
    label: 'Modified Schiff Pitchfork',
    icon: MODSCHIFF_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new ModifiedSchiffPitchfork(init),
});

registerDrawingType({
    type: 'insidepitchfork',
    group: 'pitchforks',
    label: 'Inside Pitchfork',
    icon: INSIDE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new InsidePitchfork(init),
});

// ── shapes & annotations ──
const ARROW_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>';
const ELLIPSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="9" ry="6"/></svg>';
const TRIANGLE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 4 20 19 4 19Z"/></svg>';

registerDrawingType({
    type: 'arrow',
    group: 'shapes',
    label: 'Arrow',
    icon: ARROW_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid', arrowRight: true },
    create: (init) => new Arrow(init),
});

registerDrawingType({
    type: 'ellipse',
    group: 'shapes',
    label: 'Ellipse',
    icon: ELLIPSE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}1a` },
    create: (init) => new Ellipse(init),
});

registerDrawingType({
    type: 'triangle',
    group: 'shapes',
    label: 'Triangle',
    icon: TRIANGLE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}1a` },
    create: (init) => new Triangle(init),
});

const POLYLINE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 10 13 14 21 5"/></svg>';
const FREEHAND_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 12 17 4.5a2.12 2.12 0 0 1 3 3L12.5 15"/><path d="M7 14a3 3 0 0 0-3 3c0 1.3-1.2 1.5-1.5 2 .8.9 2 1.5 3.5 1.5a3.5 3.5 0 0 0 3.5-3.5 3 3 0 0 0-2.5-3Z"/></svg>';
const HIGHLIGHTER_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11 15 5l4 4-6 6H9Z"/><path d="M9 15l-2 2"/><path d="M4 21h6"/></svg>';

registerDrawingType({
    type: 'polyline',
    group: 'shapes',
    label: 'Polyline',
    icon: POLYLINE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new Polyline(init),
});

registerDrawingType({
    type: 'freehand',
    group: 'shapes',
    label: 'Brush',
    icon: FREEHAND_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new Freehand(init),
});

registerDrawingType({
    type: 'highlighter',
    group: 'shapes',
    label: 'Highlighter',
    icon: HIGHLIGHTER_ICON,
    // A marker: wide + translucent by default (the alpha in the color is the highlight's see-through).
    defaultStyle: { lineColor: '#ff5d0059', lineWidth: 14, lineStyle: 'solid' },
    create: (init) => new Highlighter(init),
});

const CIRCLE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>';
const ROTRECT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 14 9.5 5 19 10 14.5 19 Z"/></svg>';
const PATH_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19 9 11 13 14 17 8 20 4"/><path d="M17.2 5.5 20 4 19.4 7.1"/></svg>';
const ARC_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 17a8 8 0 0 1 16 0"/><path d="M4 17 20 17"/></svg>';
const CURVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 18Q12 1 20 14"/></svg>';
const ARROW_UP_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5 12 19"/><path d="M6 11 12 5 18 11"/></svg>';
const ARROW_DOWN_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5 12 19"/><path d="M6 13 12 19 18 13"/></svg>';

registerDrawingType({
    type: 'circle',
    group: 'shapes',
    label: 'Circle',
    icon: CIRCLE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}1a` },
    create: (init) => new Circle(init),
});

registerDrawingType({
    type: 'rotatedrect',
    group: 'shapes',
    label: 'Rotated Rectangle',
    icon: ROTRECT_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}26` },
    create: (init) => new RotatedRect(init),
});

registerDrawingType({
    type: 'path',
    group: 'shapes',
    label: 'Path',
    icon: PATH_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new Path(init),
});

registerDrawingType({
    type: 'arc',
    group: 'shapes',
    label: 'Arc',
    icon: ARC_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid', fillColor: `${DEFAULT_DRAWING_COLOR}26` },
    create: (init) => new Arc(init),
});

registerDrawingType({
    type: 'curve',
    group: 'shapes',
    label: 'Curve',
    icon: CURVE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new Curve(init),
});

registerDrawingType({
    type: 'arrowmarkup',
    group: 'shapes',
    label: 'Arrow Mark Up',
    icon: ARROW_UP_ICON,
    defaultStyle: { lineColor: '#0ecb81', lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new ArrowMarkUp(init),
});

registerDrawingType({
    type: 'arrowmarkdown',
    group: 'shapes',
    label: 'Arrow Mark Down',
    icon: ARROW_DOWN_ICON,
    defaultStyle: { lineColor: '#f6465d', lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new ArrowMarkDown(init),
});

// ── stamps (single-click glyph markers) ──
const FLAG_MARK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 5h11l-2.5 3.5L17 12H6" fill="currentColor" stroke="none"/></svg>';
const ICON_STAMP_ICON =
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="m12 3 2.6 5.8 6.4.6-4.8 4.2 1.4 6.2L12 16.9 6.4 19.8 7.8 13.6 3 9.4l6.4-.6Z"/></svg>';

registerDrawingType({
    type: 'flagmark',
    group: 'stamps',
    label: 'Flag',
    icon: FLAG_MARK_ICON,
    defaultStyle: { lineColor: '#2962ff', lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new FlagMark(init),
});

registerDrawingType({
    type: 'iconstamp',
    group: 'stamps',
    label: 'Icon',
    icon: ICON_STAMP_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new IconStamp(init),
});

// ── fibonacci ──
const FIB_RETRACE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="3" y1="5" x2="21" y2="5"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="3" y1="14" x2="21" y2="14"/><line x1="3" y1="19" x2="21" y2="19"/></svg>';

const FIB_EXTEND_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="11" x2="21" y2="11"/><line x1="3" y1="15" x2="14" y2="15"/><line x1="3" y1="20" x2="14" y2="20"/></svg>';

registerDrawingType({
    type: 'fibretracement',
    group: 'fibonacci',
    label: 'Fib Retracement',
    icon: FIB_RETRACE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new FibRetracement(init),
});

registerDrawingType({
    type: 'fibextension',
    group: 'fibonacci',
    label: 'Fib Extension',
    icon: FIB_EXTEND_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new FibExtension(init),
});

const FIB_TREND_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17 9 8l4 5 8-9"/><path d="M13 5h8v6" opacity="0.6"/></svg>';

registerDrawingType({
    type: 'fibextensiontrend',
    group: 'fibonacci',
    label: 'Trend-Based Fib Extension',
    icon: FIB_TREND_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new FibExtensionTrend(init),
});

const FIB_FAN_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20 20 5M4 20 21 11M4 20 21 17M4 20 20 20"/></svg>';
const FIB_TZ_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 5v14M6 5v14M11 5v14M19 5v14"/></svg>';

registerDrawingType({
    type: 'fibfan',
    group: 'fibonacci',
    label: 'Fib Fan',
    icon: FIB_FAN_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new FibFan(init),
});

registerDrawingType({
    type: 'fibtimezones',
    group: 'fibonacci',
    label: 'Fib Time Zones',
    icon: FIB_TZ_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'dashed' },
    create: (init) => new FibTimeZones(init),
});

const FIB_CHANNEL_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 18 18 9M5 21 20 12M6 13 21 4"/></svg>';
const FIB_SPEEDFAN_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4 20 20M4 4 20 12M4 4 12 20M4 4 20 4M4 4 4 20"/></svg>';
const FIB_TRENDTIME_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 19 9 8M9 8 12 5v14M14 5v14M18 5v14M21 5v14"/></svg>';

registerDrawingType({
    type: 'fibchannel',
    group: 'fibonacci',
    label: 'Fib Channel',
    icon: FIB_CHANNEL_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new FibChannel(init),
});

registerDrawingType({
    type: 'fibspeedfan',
    group: 'fibonacci',
    label: 'Fib Speed Resistance Fan',
    icon: FIB_SPEEDFAN_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new FibSpeedFan(init),
});

registerDrawingType({
    type: 'trendfibtime',
    group: 'fibonacci',
    label: 'Trend-Based Fib Time',
    icon: FIB_TRENDTIME_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'dashed' },
    create: (init) => new TrendFibTime(init),
});

const FIB_CIRCLES_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="10"/></svg>';
const FIB_ARCS_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 21a6 6 0 0 1 6-6"/><path d="M3 21a11 11 0 0 1 11-11"/><path d="M3 21a16 16 0 0 1 16-16"/></svg>';
const FIB_WEDGE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 20 20 8M4 20 20 18"/><path d="M9 18a6 6 0 0 1 4.5-4.6"/><path d="M6 19.5a10 10 0 0 1 8-7.8"/></svg>';
const FIB_SPIRAL_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M13 12a2 2 0 1 1-2-2 4 4 0 0 1 4 4 6 6 0 0 1-9 5.2 9 9 0 0 1 .5-15"/></svg>';

registerDrawingType({
    type: 'fibcircles',
    group: 'fibonacci',
    label: 'Fib Circles',
    icon: FIB_CIRCLES_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new FibCircles(init),
});

registerDrawingType({
    type: 'fibarcs',
    group: 'fibonacci',
    label: 'Fib Speed Resistance Arcs',
    icon: FIB_ARCS_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new FibArcs(init),
});

registerDrawingType({
    type: 'fibwedge',
    group: 'fibonacci',
    label: 'Fib Wedge',
    icon: FIB_WEDGE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new FibWedge(init),
});

registerDrawingType({
    type: 'fibspiral',
    group: 'fibonacci',
    label: 'Fib Spiral',
    icon: FIB_SPIRAL_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new FibSpiral(init),
});

// ── gann ──
const GANN_FAN_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 20 20M4 20 20 13M4 20 20 6M4 20 15 4M4 20 9 4M4 20 4 4"/></svg>';
const GANN_BOX_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h16M12 4v16M4 4 20 20" opacity="0.6"/></svg>';

registerDrawingType({
    type: 'gannfan',
    group: 'fibonacci',
    label: 'Gann Fan',
    icon: GANN_FAN_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new GannFan(init),
});

registerDrawingType({
    type: 'gannbox',
    group: 'fibonacci',
    label: 'Gann Box',
    icon: GANN_BOX_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new GannBox(init),
});

const GANN_SQUARE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 20 20 4M4 20 20 12M4 20 12 4" opacity="0.7"/><path d="M4 20a16 16 0 0 1 16-16" opacity="0.5"/></svg>';

registerDrawingType({
    type: 'gannsquare',
    group: 'fibonacci',
    label: 'Gann Square',
    icon: GANN_SQUARE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new GannSquare(init),
});

const DEDEKIND_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' +
    '<path d="M2 20h20"/><path d="M4 20a8 8 0 0 1 16 0" opacity="0.9"/>' +
    '<path d="M6 20a4 4 0 0 1 8 0" opacity="0.75"/><path d="M10 20a2 2 0 0 1 4 0" opacity="0.6"/>' +
    '<path d="M8 20v-6M12 20v-9M16 20v-6" opacity="0.45"/>' +
    '</svg>';

registerDrawingType({
    type: 'dedekind',
    group: 'geometry',
    label: 'Dedekind Tessellation',
    icon: DEDEKIND_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new DedekindTessellation(init),
});

const SONIC_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' +
    '<circle cx="16" cy="12" r="5" opacity="0.55"/><circle cx="13" cy="12" r="3.5" opacity="0.75"/><circle cx="10.5" cy="12" r="2"/>' +
    '<path d="M8 4v16"/>' +
    '</svg>';

const SUPERSONIC_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="17" cy="12" r="4.5" opacity="0.45"/><circle cx="13" cy="12" r="3" opacity="0.7"/><circle cx="10" cy="12" r="1.6"/>' +
    '<path d="M6 12 16 5M6 12 16 19"/>' +
    '</svg>';

registerDrawingType({
    type: 'sonic',
    group: 'geometry',
    label: 'Sonic',
    icon: SONIC_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new Sonic(init),
});

registerDrawingType({
    type: 'supersonic',
    group: 'geometry',
    label: 'Supersonic',
    icon: SUPERSONIC_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new Supersonic(init),
});

const GOLDEN_SONIC_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' +
    '<circle cx="16" cy="12" r="5" opacity="0.4"/><circle cx="13" cy="12" r="3.2" opacity="0.65"/><circle cx="10.8" cy="12" r="1.8"/>' +
    '<path d="M8 4v16"/><path d="M15 8.5h2M12.5 10h2" opacity="0.5"/>' +
    '</svg>';

const GOLDEN_SUPERSONIC_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="17" cy="12" r="4.5" opacity="0.4"/><circle cx="12.5" cy="12" r="2.8" opacity="0.65"/><circle cx="9.8" cy="12" r="1.4"/>' +
    '<path d="M6 12 16 5M6 12 16 19"/>' +
    '</svg>';

registerDrawingType({
    type: 'goldensonic',
    group: 'geometry',
    label: 'Golden Sonic',
    icon: GOLDEN_SONIC_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new GoldenSonic(init),
});

registerDrawingType({
    type: 'goldensupersonic',
    group: 'geometry',
    label: 'Golden Supersonic',
    icon: GOLDEN_SUPERSONIC_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new GoldenSupersonic(init),
});

// ── patterns ──
const ZZ = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const XABCD_ICON = `<svg viewBox="0 0 24 24" ${ZZ}><path d="M3 18 7 8 11 14 15 6 20 16"/></svg>`;
const ABCD_ICON = `<svg viewBox="0 0 24 24" ${ZZ}><path d="M4 17 9 7 14 15 20 5"/></svg>`;
const ELLIOTT_IMPULSE_ICON = `<svg viewBox="0 0 24 24" ${ZZ}><path d="M3 19 8 9 12 13 17 5 21 9"/></svg>`;
const ELLIOTT_CORRECTION_ICON = `<svg viewBox="0 0 24 24" ${ZZ}><path d="M4 7 11 16 20 9"/></svg>`;
const HEAD_SHOULDERS_ICON = `<svg viewBox="0 0 24 24" ${ZZ}><path d="M3 18 6 12 9 16 12 5 15 16 18 12 21 18"/></svg>`;

registerDrawingType({
    type: 'xabcd',
    group: 'patterns',
    label: 'XABCD Pattern',
    icon: XABCD_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new XABCD(init),
});

registerDrawingType({
    type: 'abcd',
    group: 'patterns',
    label: 'ABCD Pattern',
    icon: ABCD_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new ABCDPattern(init),
});

registerDrawingType({
    type: 'elliottimpulse',
    group: 'patterns',
    label: 'Elliott Impulse Wave (1-5)',
    icon: ELLIOTT_IMPULSE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new ElliottImpulse(init),
});

registerDrawingType({
    type: 'elliottcorrection',
    group: 'patterns',
    label: 'Elliott Correction Wave (ABC)',
    icon: ELLIOTT_CORRECTION_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new ElliottCorrection(init),
});

registerDrawingType({
    type: 'headshoulders',
    group: 'patterns',
    label: 'Head & Shoulders',
    icon: HEAD_SHOULDERS_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new HeadShoulders(init),
});

// Named harmonics (XABCD with validated Fibonacci bands) — share an XABCD-shaped icon; the label names them.
const HARMONIC_ICON = `<svg viewBox="0 0 24 24" ${ZZ}><path d="M3 17 7 6 12 14 17 5 21 16"/><path d="M3 17 21 16" opacity="0.45"/></svg>`;
const harmonic = { group: 'patterns' as const, icon: HARMONIC_ICON, defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' as const } };

registerDrawingType({ type: 'gartley', label: 'Gartley', ...harmonic, create: (init) => new Gartley(init) });
registerDrawingType({ type: 'bat', label: 'Bat', ...harmonic, create: (init) => new Bat(init) });
registerDrawingType({ type: 'butterfly', label: 'Butterfly', ...harmonic, create: (init) => new Butterfly(init) });
registerDrawingType({ type: 'crab', label: 'Crab', ...harmonic, create: (init) => new Crab(init) });
registerDrawingType({ type: 'shark', label: 'Shark', ...harmonic, create: (init) => new Shark(init) });
registerDrawingType({ type: 'cypher', label: 'Cypher', ...harmonic, create: (init) => new Cypher(init) });

// ── measurement ──
const MEASURE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="6" width="16" height="12" rx="1"/><path d="M4 18 20 6" opacity="0.5"/></svg>';

registerDrawingType({
    type: 'datepricerange',
    group: 'measure',
    label: 'Date & Price Range',
    icon: MEASURE_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new DatePriceRange(init),
});

// ── positions ──
const POSITION_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="7" rx="1" stroke="#0ecb81"/><rect x="4" y="13" width="16" height="7" rx="1" stroke="#f6465d"/></svg>';

registerDrawingType({
    type: 'position',
    group: 'measure',
    label: 'Long/Short Position',
    icon: POSITION_ICON,
    defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new PositionTool(init),
});

// ── anchored VWAP ──
const VWAP_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="3" x2="5" y2="21"/><path d="M5 16c4 0 5-9 8-9s3 5 8 3"/></svg>';

registerDrawingType({
    type: 'anchoredvwap',
    group: 'measure',
    label: 'Anchored VWAP',
    icon: VWAP_ICON,
    defaultStyle: { lineColor: '#5b9cf6', lineWidth: 2, lineStyle: 'solid' },
    create: (init) => new AnchoredVwap(init),
});

// ── fixed-range volume profile ──
const FRVP_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16"/><path d="M4 8h10"/><path d="M4 12h14"/><path d="M4 16h8"/><path d="M4 20h12"/></svg>';

registerDrawingType({
    type: 'fixedrangevp',
    group: 'measure',
    label: 'Fixed Range Volume Profile',
    icon: FRVP_ICON,
    defaultStyle: { lineColor: '#089981', lineWidth: 1, lineStyle: 'solid' },
    create: (init) => new FixedRangeVolumeProfile(init),
});
