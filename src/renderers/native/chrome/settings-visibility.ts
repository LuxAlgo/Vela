// The settings-dialog VISIBILITY POLICY — pure logic behind `settings: { hidden }`.
//
// Every tab, group, and row the dialog renders carries a stable hierarchical id
// (dot-separated, kebab-case). The policy is a flat list of ids to hide; an id hides
// its whole subtree, and hiding is presentation-only — hidden values keep being
// stored, delivered, and applied. Default: everything visible.
//
// Id derivation is IMPLICIT so contributors need no extra wiring:
// - built-in tabs/groups/rows: the static ids stamped by `SettingsDialog.open`
//   (enumerated in BUILTIN_SETTINGS_IDS below — keep the two in sync);
// - chart-type SDK sections: `type:<typeId>` for the tab, the row's own bag key for
//   value rows, the label's slug for headings/headers, the title's slug for
//   subsections;
// - host sections: the section/row `id` field when given, else the title/label slug.
//
// Kept free of DOM so the policy is unit-testable under the node environment.
import { chartTypes, normalizeSettingsRow, type SettingsRowDescriptor } from '../../../chart-types/registry';
import { hasOwnCandlePaint } from '../core/chartConfig';

export type { SettingsVisibilityPolicy } from '../../../core/options';

/** Kebab-case slug of a display label — the implicit id of label-only elements. */
export function settingsIdSlug(label: string): string {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** True when `id` — or any of its dot-path ancestors — is in the hidden set. */
export function settingsIdHidden(id: string, hidden: ReadonlySet<string>): boolean {
    if (hidden.size === 0) return false;
    let path = id;
    for (;;) {
        if (hidden.has(path)) return true;
        const cut = path.lastIndexOf('.');
        if (cut < 0) return false;
        path = path.slice(0, cut);
    }
}

/**
 * The implicit id of one chart-type settings row: the boolean toggle's key for
 * composite rows, else the first stored key (that key already being the row's stable
 * persistence contract), else the label's slug (headings/headers, key-less rows).
 */
export function settingsRowId(r: SettingsRowDescriptor): string {
    if (r.kind === 'heading' || r.kind === 'header') return settingsIdSlug(r.label);
    const n = normalizeSettingsRow(r);
    if (n.toggle) return n.toggle.key;
    for (const c of n.controls) {
        if (c.kind !== 'hint') return c.key;
    }
    return settingsIdSlug(n.label);
}

/**
 * Drop the hidden rows of a chart-type section, `scope` being the id prefix
 * (`type:<typeId>`). Hiding a `heading` drops its whole group (every row up to the
 * next heading); hiding a `header` drops its subgroup (up to the next header or
 * heading). Gates (`when`) and value delivery are untouched — callers must still SEED
 * from the unfiltered rows so conditions keep reading their defaults.
 */
export function filterHiddenRows(
    rows: readonly SettingsRowDescriptor[],
    scope: string,
    hidden: ReadonlySet<string>,
): SettingsRowDescriptor[] {
    if (hidden.size === 0) return [...rows];
    const out: SettingsRowDescriptor[] = [];
    let skipGroup = false;
    let skipSub = false;
    for (const r of rows) {
        const id = `${scope}.${settingsRowId(r)}`;
        if (r.kind === 'heading') {
            skipGroup = settingsIdHidden(id, hidden);
            skipSub = false;
            if (!skipGroup) out.push(r);
            continue;
        }
        if (r.kind === 'header') {
            if (skipGroup) continue;
            skipSub = settingsIdHidden(id, hidden);
            if (!skipSub) out.push(r);
            continue;
        }
        if (skipGroup || skipSub || settingsIdHidden(id, hidden)) continue;
        out.push(r);
    }
    return out;
}

/** The structural slice of a host row this module needs (no callbacks). */
export interface HostRowIdSource {
    kind: string;
    label: string;
    /** Explicit stable id — labels are display text; set this to survive renames. */
    id?: string;
}

/** The structural slice of a host section this module needs. */
export interface HostSectionIdSource {
    title: string;
    rows: readonly HostRowIdSource[];
    id?: string;
}

/** A host section's id: the explicit `id` when given, else the title's slug. */
export function hostSectionId(s: HostSectionIdSource): string {
    return s.id ?? settingsIdSlug(s.title);
}

/** A host row's leaf id: the explicit `id` when given, else the label's slug. */
export function hostRowId(r: HostRowIdSource): string {
    return r.id ?? settingsIdSlug(r.label);
}

/**
 * Drop the hidden rows of a host section (same semantics as {@link filterHiddenRows}:
 * hiding a `heading` drops every row up to the next heading).
 */
export function filterHiddenHostRows<T extends HostRowIdSource>(
    rows: readonly T[],
    scope: string,
    hidden: ReadonlySet<string>,
): T[] {
    if (hidden.size === 0) return [...rows];
    const out: T[] = [];
    let skipGroup = false;
    for (const r of rows) {
        const id = `${scope}.${hostRowId(r)}`;
        if (r.kind === 'heading') {
            skipGroup = settingsIdHidden(id, hidden);
            if (!skipGroup) out.push(r);
            continue;
        }
        if (skipGroup || settingsIdHidden(id, hidden)) continue;
        out.push(r);
    }
    return out;
}

/**
 * The BUILT-IN ids `SettingsDialog.open` stamps — tab, then its groups, then their
 * rows. Must match the `sid(...)` literals in the dialog; the catalog test guards the
 * obvious drifts (shape, prefixes), the browser probe the rest.
 */
export const BUILTIN_SETTINGS_IDS: readonly string[] = [
    'symbol',
    'symbol.type',
    'symbol.style.candles',
    'symbol.style.candles.body',
    'symbol.style.candles.borders',
    'symbol.style.candles.wick',
    'symbol.style.candles.spacing',
    'symbol.style.bars',
    'symbol.style.bars.up-color',
    'symbol.style.bars.down-color',
    'symbol.style.bars.spacing',
    'symbol.style.line',
    'symbol.style.line.color',
    'symbol.style.line.width',
    'symbol.style.area',
    'symbol.style.area.line-color',
    'symbol.style.area.width',
    'symbol.style.area.top-fill',
    'symbol.style.area.bottom-fill',
    'symbol.style.baseline',
    'symbol.style.baseline.top-line',
    'symbol.style.baseline.bottom-line',
    'symbol.style.baseline.fill-top',
    'symbol.style.baseline.fill-bottom',
    'symbol.style.baseline.base-level',
    'symbol.style.baseline.width',
    'symbol.timezone',
    'scales',
    'scales.price-scale',
    'scales.price-scale.mode',
    'scales.price-scale.invert',
    'scales.price-scale.last-price-line',
    'scales.price-scale.last-price-label',
    'scales.price-scale.countdown',
    'scales.price-scale.axis-labels',
    'scales.price-scale.border-color',
    'scales.crosshair',
    'scales.crosshair.color',
    'scales.crosshair.width',
    'scales.crosshair.style',
    'canvas',
    'canvas.background',
    'canvas.background.color',
    'canvas.background.text-color',
    'canvas.background.text-size',
    'canvas.background.pane-separator',
    'canvas.grid',
    'canvas.grid.vertical',
    'canvas.grid.horizontal',
    'canvas.theme',
];

/**
 * Every addressable setting id of a chart instance: the built-ins, the registered
 * chart types' sections (rows enumerated across flat rows, instances, and
 * subsections), and the given host sections. The discovery surface behind
 * `chart.renderer.listSettingsIds()` — hosts enumerate this instead of reading
 * contributor source.
 */
export function settingsIdCatalog(hostSections: readonly HostSectionIdSource[]): string[] {
    const ids = new Set<string>(BUILTIN_SETTINGS_IDS);
    for (const def of chartTypes()) {
        // A plugin style painting its own candles gets the per-style cosmetics group
        // in the Symbol tab (settings section or not) — same row set as the built-in.
        if (hasOwnCandlePaint(def.id)) {
            const style = `symbol.style.${def.id}`;
            for (const leaf of ['', '.body', '.borders', '.wick', '.spacing']) ids.add(style + leaf);
        }
        const section = def.settings;
        if (!section) continue;
        const scope = `type:${def.id}`;
        ids.add(scope);
        const addRows = (rows: readonly SettingsRowDescriptor[]): void => {
            for (const r of rows) ids.add(`${scope}.${settingsRowId(r)}`);
        };
        if (section.rows) addRows(section.rows);
        for (const inst of section.instances ?? []) addRows(inst.rows);
        for (const sub of section.subsections ?? []) {
            ids.add(`${scope}.${settingsIdSlug(sub.title)}`);
            addRows(sub.rows);
        }
    }
    for (const hs of hostSections) {
        const scope = hostSectionId(hs);
        ids.add(scope);
        for (const r of hs.rows) ids.add(`${scope}.${hostRowId(r)}`);
    }
    return [...ids];
}
