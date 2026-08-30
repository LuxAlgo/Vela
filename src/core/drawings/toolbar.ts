import type { DrawingTypeKey } from './Drawing';
import { drawingTypes, getDrawingType } from './registry';

/**
 * Inert, renderer-neutral toolbar data. The core builds it from the type registry;
 * the renderer paints a vertical bar where each {@link ToolGroup} is one button with
 * a flyout listing its {@link ToolDefinition}s. One tool is armed
 * at a time across all groups.
 */
export interface ToolDefinition {
    type: DrawingTypeKey;
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

/** A developer-supplied explicit group (just type keys; the registry fills the rest). */
export interface ToolbarGroupConfig {
    id: string;
    label: string;
    tools: DrawingTypeKey[];
}

/** Public `options.drawings` shape. `true` = default toolbar; object = customize. */
export type DrawingsOption =
    | boolean
    | {
          toolbar?: boolean;
          tools?: DrawingTypeKey[];
          groups?: ToolbarGroupConfig[];
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

type SectionSource = { label: string; registryGroup: string } | { label: string; types: readonly DrawingTypeKey[] };

interface ToolbarGroupLayout {
    id: string;
    label: string;
    sections: readonly SectionSource[];
}

/** Canonical toolbar layout — seven top-level buttons, each with labelled flyout sections. */
const TOOLBAR_LAYOUT: readonly ToolbarGroupLayout[] = [
    {
        id: 'lines-channels-pitchforks',
        label: 'Lines',
        sections: [
            { label: 'Lines', registryGroup: 'lines' },
            { label: 'Channels', registryGroup: 'channels' },
            { label: 'Pitchforks', registryGroup: 'pitchforks' },
        ],
    },
    {
        id: 'fibonacci-gann',
        label: 'Fibonacci',
        sections: [
            { label: 'Fibonacci', types: FIBONACCI_TYPES },
            { label: 'Gann', types: GANN_TYPES },
            { label: 'Geometry', types: GEOMETRY_TYPES },
        ],
    },
    {
        id: 'patterns-waves-harmonics',
        label: 'Patterns',
        sections: [
            { label: 'Patterns', types: PATTERN_TYPES },
            { label: 'Elliott Waves', types: ELLIOTT_TYPES },
            { label: 'Harmonics', types: HARMONIC_TYPES },
        ],
    },
    {
        id: 'measurements',
        label: 'Measurements',
        sections: [
            { label: 'Measurements', types: MEASUREMENT_TYPES },
            { label: 'Volume', types: VOLUME_TYPES },
        ],
    },
    {
        id: 'brushes-arrows-shapes',
        label: 'Shapes',
        sections: [
            { label: 'Brushes', types: BRUSH_TYPES },
            { label: 'Arrows', types: ARROW_TYPES },
            { label: 'Shapes', types: SHAPE_TYPES },
        ],
    },
    {
        id: 'text',
        label: 'Text',
        sections: [{ label: 'Text', types: TEXT_TYPES }],
    },
    {
        id: 'icons',
        label: 'Icons',
        sections: [{ label: 'Icons', types: ICON_TYPES }],
    },
];

/** Resolve a type key to a {@link ToolDefinition}, or null if unregistered. */
function toolFor(type: DrawingTypeKey): ToolDefinition | null {
    const meta = getDrawingType(type);
    return meta ? { type: meta.type, label: meta.label, icon: meta.icon } : null;
}

/** Index registered tools by their declared registry group (registration order preserved). */
function toolsByRegistryGroup(allowed?: ReadonlySet<DrawingTypeKey>): Map<string, ToolDefinition[]> {
    const byGroup = new Map<string, ToolDefinition[]>();
    for (const meta of drawingTypes()) {
        if (allowed && !allowed.has(meta.type)) continue;
        const tool = { type: meta.type, label: meta.label, icon: meta.icon };
        if (!byGroup.has(meta.group)) byGroup.set(meta.group, []);
        byGroup.get(meta.group)!.push(tool);
    }
    return byGroup;
}

function resolveSection(source: SectionSource, byGroup: Map<string, ToolDefinition[]>, toolMap: Map<DrawingTypeKey, ToolDefinition>): ToolDefinition[] {
    if ('registryGroup' in source) return byGroup.get(source.registryGroup) ?? [];
    return source.types.map((type) => toolMap.get(type)).filter((t): t is ToolDefinition => t != null);
}

/** Build the canonical seven-group toolbar, optionally restricted to a type subset. */
function assembleToolbar(allowed?: ReadonlySet<DrawingTypeKey>): ToolbarDefinition {
    const byGroup = toolsByRegistryGroup(allowed);
    const toolMap = new Map<DrawingTypeKey, ToolDefinition>();
    for (const tools of byGroup.values()) {
        for (const tool of tools) toolMap.set(tool.type, tool);
    }

    const groups: ToolGroup[] = [];
    for (const layout of TOOLBAR_LAYOUT) {
        const sections: ToolSection[] = [];
        const flat: ToolDefinition[] = [];
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
function groupTools(tools: readonly DrawingTypeKey[]): ToolbarDefinition {
    const allowed = new Set<DrawingTypeKey>();
    for (const type of tools) {
        if (getDrawingType(type)) allowed.add(type);
    }
    return assembleToolbar(allowed);
}

/** Build explicit groups from developer config (drops unregistered/empty entries). */
function resolveGroups(groups: readonly ToolbarGroupConfig[]): ToolbarDefinition {
    const out: ToolGroup[] = [];
    for (const g of groups) {
        const tools = g.tools.map(toolFor).filter((t): t is ToolDefinition => t != null);
        if (tools.length > 0) out.push({ id: g.id, label: g.label, tools });
    }
    return { groups: out };
}

/** The default toolbar — every registered type, grouped into the canonical seven-button layout. */
export function defaultToolbar(): ToolbarDefinition {
    return assembleToolbar();
}

/**
 * Resolve `options.drawings` into a concrete toolbar definition + initial visibility.
 * Default (undefined) ⇒ toolbar VISIBLE; `false` ⇒ subsystem available but toolbar hidden
 * (headless use still works via `chart.drawings.add(...)`); object ⇒ `toolbar ?? true`.
 */
export function buildToolbar(option: DrawingsOption | undefined): { definition: ToolbarDefinition; visible: boolean } {
    if (option === false) return { definition: defaultToolbar(), visible: false };
    if (option === undefined || option === true) return { definition: defaultToolbar(), visible: true };
    const visible = option.toolbar ?? true;
    if (option.groups) return { definition: resolveGroups(option.groups), visible };
    if (option.tools) return { definition: groupTools(option.tools), visible };
    return { definition: defaultToolbar(), visible };
}
