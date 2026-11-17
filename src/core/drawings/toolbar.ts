import { msg } from '../i18n/message';
import type { DrawingTypeKey } from './Drawing';
import { textOf } from '../i18n/text';
import type { MessageLike, Translator } from '../i18n/types';
import { drawingTypeEntries, drawingTypeEntry } from './registry';

/**
 * Inert, renderer-neutral toolbar data. The core builds it from the type registry;
 * the renderer paints a vertical bar where each {@link ToolGroup} is one button with
 * a flyout listing its {@link ToolDefinition}s. One tool is armed
 * at a time across all groups.
 */
export interface ToolDefinition {
    type: DrawingTypeKey;
    /** The tool's name, in the language the definition was built for. */
    label: string;
    /** Inline SVG markup (no DOM). */
    icon: string;
}

/** A labelled subsection inside a toolbar group's flyout (e.g. "Fibonacci" within Fibonacci & Gann). */
export interface ToolSection {
    label: string;
    tools: ToolDefinition[];
}

export interface ToolGroup {
    id: string;
    label: string;
    tools: ToolDefinition[];
    /** When set, the flyout renders non-clickable headers between sections. */
    sections?: ToolSection[];
}

export interface ToolbarDefinition {
    groups: ToolGroup[];
}

/** A toolbar whose labels are still messages: what the chart keeps, and reads in its
 *  language whenever it hands the toolbar out ({@link resolveToolbar}). */
type ToolSource = Omit<ToolDefinition, 'label'> & { label: MessageLike };
type ToolSectionSource = { label: MessageLike; tools: ToolSource[] };
type ToolGroupSource = Omit<ToolGroup, 'label' | 'tools' | 'sections'> & { label: MessageLike; tools: ToolSource[]; sections?: ToolSectionSource[] };
export interface ToolbarSource {
    groups: ToolGroupSource[];
}

/** A developer-supplied explicit group (just type keys; the registry fills the rest). */
export interface ToolbarGroupConfig {
    id: string;
    /** The group's name; a message (`msg()`) reads in the chart's language. */
    label: MessageLike;
    tools: DrawingTypeKey[];
}

/** Public `options.drawings` shape. `true` = default toolbar; object = customize. */
export type DrawingsOption =
    | boolean
    | {
          toolbar?: boolean;
          tools?: DrawingTypeKey[];
          groups?: ToolbarGroupConfig[];
          /**
           * The drawings belong to the chart's SYMBOL: switching to another symbol removes
           * them all (a timeframe or session change keeps them). Default false: drawings
           * stay on the chart across symbols. They are removed as the switch starts, with
           * the undo history, and `drawing:replaced` stands in for a `drawing:removed` per
           * drawing, so a host that keeps a document per symbol saves on the drawing events
           * and loads the new symbol's document on `market:changed`. Also set at runtime
           * with `chart.drawings.setClearOnSymbolChange()`.
           */
          clearOnSymbolChange?: boolean;
      };

const FIBONACCI_TYPES: DrawingTypeKey[] = [
    'fibretracement',
    'fibextension',
    'fibextensiontrend',
    'fibfan',
    'fibtimezones',
    'fibchannel',
    'fibspeedfan',
    'trendfibtime',
    'fibcircles',
    'fibarcs',
    'fibwedge',
    'fibspiral',
];

const PRICE_ACTION_TYPES: DrawingTypeKey[] = ['fairvaluegap', 'orderblock', 'liquidity'];

const GANN_TYPES: DrawingTypeKey[] = ['gannfan', 'gannbox', 'gannsquare'];

const GEOMETRY_TYPES: DrawingTypeKey[] = ['dedekind', 'sonic', 'supersonic', 'goldensonic', 'goldensupersonic'];

const PATTERN_TYPES: DrawingTypeKey[] = ['xabcd', 'abcd', 'headshoulders'];
const ELLIOTT_TYPES: DrawingTypeKey[] = ['elliottimpulse', 'elliottcorrection'];
const HARMONIC_TYPES: DrawingTypeKey[] = ['gartley', 'bat', 'butterfly', 'crab', 'shark', 'cypher'];

const MEASUREMENT_TYPES: DrawingTypeKey[] = ['position', 'datepricerange', 'magnifier'];
const VOLUME_TYPES: DrawingTypeKey[] = ['anchoredvwap', 'fixedrangevp'];

const BRUSH_TYPES: DrawingTypeKey[] = ['freehand', 'highlighter'];
const ARROW_TYPES: DrawingTypeKey[] = ['arrow', 'arrowmarkup', 'arrowmarkdown'];
const SHAPE_TYPES: DrawingTypeKey[] = ['box', 'ellipse', 'triangle', 'polyline', 'circle', 'rotatedrect', 'path', 'arc', 'curve'];

const TEXT_TYPES: DrawingTypeKey[] = ['text', 'callout', 'note', 'pricenote', 'comment', 'pricelabel', 'signpost'];
const ICON_TYPES: DrawingTypeKey[] = ['flagmark', 'iconstamp'];

type SectionSource = { label: MessageLike; registryGroup: string } | { label: MessageLike; types: readonly DrawingTypeKey[] };

interface ToolbarGroupLayout {
    id: string;
    label: MessageLike;
    sections: readonly SectionSource[];
}

/** Canonical toolbar layout — seven top-level buttons, each with labelled flyout sections. */
const TOOLBAR_LAYOUT: readonly ToolbarGroupLayout[] = [
    {
        id: 'lines-channels-pitchforks',
        label: msg('drawing.toolbar.group.linesChannelsPitchforks', 'Lines'),
        sections: [
            { label: msg('drawing.toolbar.section.lines', 'Lines'), registryGroup: 'lines' },
            { label: msg('drawing.toolbar.section.channels', 'Channels'), registryGroup: 'channels' },
            { label: msg('drawing.toolbar.section.pitchforks', 'Pitchforks'), registryGroup: 'pitchforks' },
        ],
    },
    {
        id: 'fibonacci-gann',
        label: msg('drawing.toolbar.group.fibonacciGann', 'Fibonacci'),
        sections: [
            { label: msg('drawing.toolbar.section.fibonacci', 'Fibonacci'), types: FIBONACCI_TYPES },
            { label: msg('drawing.toolbar.section.priceAction', 'Price Action'), types: PRICE_ACTION_TYPES },
            { label: msg('drawing.toolbar.section.gann', 'Gann'), types: GANN_TYPES },
            { label: msg('drawing.toolbar.section.geometry', 'Geometry'), types: GEOMETRY_TYPES },
        ],
    },
    {
        id: 'patterns-waves-harmonics',
        label: msg('drawing.toolbar.group.patternsWavesHarmonics', 'Patterns'),
        sections: [
            { label: msg('drawing.toolbar.section.patterns', 'Patterns'), types: PATTERN_TYPES },
            { label: msg('drawing.toolbar.section.elliottWaves', 'Elliott Waves'), types: ELLIOTT_TYPES },
            { label: msg('drawing.toolbar.section.harmonics', 'Harmonics'), types: HARMONIC_TYPES },
        ],
    },
    {
        id: 'measurements',
        label: msg('drawing.toolbar.group.measurements', 'Measurements'),
        sections: [
            { label: msg('drawing.toolbar.section.measurements', 'Measurements'), types: MEASUREMENT_TYPES },
            { label: msg('drawing.toolbar.section.volume', 'Volume'), types: VOLUME_TYPES },
        ],
    },
    {
        id: 'brushes-arrows-shapes',
        label: msg('drawing.toolbar.group.brushesArrowsShapes', 'Shapes'),
        sections: [
            { label: msg('drawing.toolbar.section.brushes', 'Brushes'), types: BRUSH_TYPES },
            { label: msg('drawing.toolbar.section.arrows', 'Arrows'), types: ARROW_TYPES },
            { label: msg('drawing.toolbar.section.shapes', 'Shapes'), types: SHAPE_TYPES },
        ],
    },
    {
        id: 'text',
        label: msg('drawing.toolbar.group.text', 'Text'),
        sections: [{ label: msg('drawing.toolbar.section.text', 'Text'), types: TEXT_TYPES }],
    },
    {
        id: 'icons',
        label: msg('drawing.toolbar.group.icons', 'Icons'),
        sections: [{ label: msg('drawing.toolbar.section.icons', 'Icons'), types: ICON_TYPES }],
    },
];

/** Resolve a type key to a {@link ToolSource}, or null if unregistered. */
function toolFor(type: DrawingTypeKey): ToolSource | null {
    const meta = drawingTypeEntry(type);
    return meta ? { type: meta.type, label: meta.label, icon: meta.icon } : null;
}

/** Index registered tools by their declared registry group (registration order preserved). */
function toolsByRegistryGroup(allowed?: ReadonlySet<DrawingTypeKey>): Map<string, ToolSource[]> {
    const byGroup = new Map<string, ToolSource[]>();
    for (const meta of drawingTypeEntries()) {
        if (allowed && !allowed.has(meta.type)) continue;
        const tool = { type: meta.type, label: meta.label, icon: meta.icon };
        if (!byGroup.has(meta.group)) byGroup.set(meta.group, []);
        byGroup.get(meta.group)!.push(tool);
    }
    return byGroup;
}

function resolveSection(source: SectionSource, byGroup: Map<string, ToolSource[]>, toolMap: Map<DrawingTypeKey, ToolSource>): ToolSource[] {
    if ('registryGroup' in source) return byGroup.get(source.registryGroup) ?? [];
    return source.types.map((type) => toolMap.get(type)).filter((t): t is ToolSource => t != null);
}

/** Build the canonical seven-group toolbar, optionally restricted to a type subset. */
function assembleToolbar(allowed?: ReadonlySet<DrawingTypeKey>): ToolbarSource {
    const byGroup = toolsByRegistryGroup(allowed);
    const toolMap = new Map<DrawingTypeKey, ToolSource>();
    for (const tools of byGroup.values()) {
        for (const tool of tools) toolMap.set(tool.type, tool);
    }

    const groups: ToolGroupSource[] = [];
    for (const layout of TOOLBAR_LAYOUT) {
        const sections: ToolSectionSource[] = [];
        const flat: ToolSource[] = [];
        for (const source of layout.sections) {
            const tools = resolveSection(source, byGroup, toolMap);
            if (tools.length === 0) continue;
            sections.push({ label: source.label, tools });
            flat.push(...tools);
        }
        if (flat.length === 0) continue;
        groups.push({
            id: layout.id,
            label: layout.label,
            tools: flat,
            sections: sections.length > 0 ? sections : undefined,
        });
    }
    return { groups };
}

/** Group a flat list of type keys into the canonical seven-group layout (drops unregistered types). */
function groupTools(tools: readonly DrawingTypeKey[]): ToolbarSource {
    const allowed = new Set<DrawingTypeKey>();
    for (const type of tools) {
        if (drawingTypeEntry(type)) allowed.add(type);
    }
    return assembleToolbar(allowed);
}

/** Build explicit groups from developer config (drops unregistered/empty entries). */
function resolveGroups(groups: readonly ToolbarGroupConfig[]): ToolbarSource {
    const out: ToolGroupSource[] = [];
    for (const g of groups) {
        const tools = g.tools.map(toolFor).filter((t): t is ToolSource => t != null);
        if (tools.length > 0) out.push({ id: g.id, label: g.label, tools });
    }
    return { groups: out };
}

/** The toolbar with every label read in `i18n`'s language (English without one). A tool
 *  listed both in its group and in a section stays one object. */
export function resolveToolbar(source: ToolbarSource, i18n?: Translator | null): ToolbarDefinition {
    const tools = new Map<ToolSource, ToolDefinition>();
    const tool = (t: ToolSource): ToolDefinition => {
        let out = tools.get(t);
        if (!out) {
            out = { type: t.type, label: textOf(i18n, t.label), icon: t.icon };
            tools.set(t, out);
        }
        return out;
    };
    return {
        groups: source.groups.map((g) => ({
            id: g.id,
            label: textOf(i18n, g.label),
            tools: g.tools.map(tool),
            sections: g.sections?.map((s) => ({ label: textOf(i18n, s.label), tools: s.tools.map(tool) })),
        })),
    };
}

/** The default toolbar — every registered type, grouped into the canonical seven-button
 *  layout, labelled in `i18n`'s language (English without one). */
export function defaultToolbar(i18n?: Translator | null): ToolbarDefinition {
    return resolveToolbar(assembleToolbar(), i18n);
}

/**
 * Resolve `options.drawings` into a concrete toolbar definition + initial visibility.
 * Default (undefined) ⇒ toolbar VISIBLE; `false` ⇒ subsystem available but toolbar hidden
 * (headless use still works via `chart.drawings.add(...)`); object ⇒ `toolbar ?? true`.
 */
export function buildToolbar(option: DrawingsOption | undefined, i18n?: Translator | null): { definition: ToolbarDefinition; visible: boolean } {
    const { definition, visible } = toolbarSource(option);
    return { definition: resolveToolbar(definition, i18n), visible };
}

/** {@link buildToolbar} with the labels still messages, for a chart to read in its language. */
export function toolbarSource(option: DrawingsOption | undefined): { definition: ToolbarSource; visible: boolean } {
    if (option === false) return { definition: assembleToolbar(), visible: false };
    if (option === undefined || option === true) return { definition: assembleToolbar(), visible: true };
    const visible = option.toolbar ?? true;
    if (option.groups) return { definition: resolveGroups(option.groups), visible };
    if (option.tools) return { definition: groupTools(option.tools), visible };
    return { definition: assembleToolbar(), visible };
}
