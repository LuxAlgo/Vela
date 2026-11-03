// One tooltip configuration for ALL of Vela's chrome — the kit tooltips the widget builds
// (topbar, bottom bar, status line) and the renderer's own inline-styled chrome tooltips
// (drawing toolbar, axis scale buttons, legend, in-chart dialogs). Pure module state, like
// the other registries: configure it at import time, before any shell is built.

/**
 * What a STRUCTURED tooltip describes — the data Vela hands to a {@link TooltipRenderer}.
 *
 * `id` is stable and dotted, `<surface>.<control>`:
 * - `topbar.symbol` · `topbar.timeframe` · `topbar.style` · `topbar.layout` ·
 *   `topbar.indicators` · `topbar.undo` · `topbar.redo` · `topbar.screenshot` ·
 *   `topbar.alerts` · `topbar.panel.<panelId>` (a side-panel toggle)
 * - `action.<actionId>` — a contributed topbar action (`registerWidgetAction`)
 * - `bottombar.timezone` · `bottombar.settings`
 * - `statusline.market` · `statusline.show-chart`
 * - `drawing.<typeKey>` — a drawing tool: a toolbar group cell (the tool it arms) and its
 *   flyout row
 * - `drawing-toolbar.<control>` — `cursor`, `magnet`, `measure`, `eraser`, `stay`, `sync`,
 *   `collapse`; the magnet flyout rows are `drawing-toolbar.magnet.<off|weak|strong>`
 * - `axis.auto` · `axis.log` — the price scale's A / L buttons
 * - `legend.fold` · `legend.visibility` · `legend.settings` · `legend.move` ·
 *   `legend.remove` · `legend.action.<actionId>` · `legend.callout.<calloutId>`
 * - `dialog.close`
 *
 * A host's own kit `Tooltip` built with a `TooltipInfo` content carries whatever id it chose.
 */
export interface TooltipInfo {
    /** Stable id of the control, e.g. `'topbar.style'`, `'action.<actionId>'`, `'drawing.<typeKey>'`. */
    id: string;
    /** The control's name — the one line a tooltip without a description shows. */
    title: string;
    /** One short sentence on what the control does. */
    description?: string;
    /** SVG markup of the control's icon, when it has one. */
    icon?: string;
    /** Pre-formatted shortcut hint, e.g. `'Alt+T'`. */
    shortcut?: string;
}

/**
 * Builds a structured tooltip's content, placed inside Vela's tooltip frame (background,
 * border, padding, placement). Return a FRESH node per call — the same node appended to two
 * tooltips moves between them. `null`/`undefined` keeps Vela's default content for that
 * tooltip: the title, plus a muted description line when there is one.
 */
export type TooltipRenderer = (info: TooltipInfo) => Node | null | undefined;

export interface TooltipConfig {
    /**
     * Hover delay, in ms, before ANY tooltip Vela creates opens — the kit tooltips of the
     * widget chrome and the renderer's chrome tooltips alike. Unset, each keeps its own
     * default (kit tooltips open at once, chrome tooltips after 700 ms, the ⓘ hints after
     * 250 ms). A kit `Tooltip` constructed with an explicit `openDelay` keeps it. `null`
     * restores the per-tooltip defaults.
     */
    openDelay?: number | null;
    /** Content hook for structured tooltips (see {@link TooltipRenderer}). `null` restores the default content. */
    render?: TooltipRenderer | null;
}

let openDelay: number | null = null;
let render: TooltipRenderer | null = null;

/**
 * Configure every tooltip Vela creates. Merges into the current configuration: an omitted
 * field keeps its value, `null` resets it. Kit tooltips read the delay and build their
 * content when constructed, so configure at import time, before any shell is built;
 * chrome tooltips read both each time they open.
 */
export function configureTooltips(config: TooltipConfig): void {
    const ms = config.openDelay;
    if (ms === null) openDelay = null;
    else if (typeof ms === 'number' && Number.isFinite(ms)) openDelay = Math.max(0, ms);
    else if (ms !== undefined) console.warn('[vela] configureTooltips: `openDelay` must be a number of milliseconds or null — ignored.');
    const fn = config.render;
    if (fn === null || typeof fn === 'function') render = fn;
    else if (fn !== undefined) console.warn('[vela] configureTooltips: `render` must be a function or null — ignored.');
}

/** The current configuration (unset fields are `null`). */
export function tooltipConfig(): { openDelay: number | null; render: TooltipRenderer | null } {
    return { openDelay, render };
}

/** The delay a tooltip opens after: the configured one, else the tooltip's own default. */
export function tooltipOpenDelay(fallback: number): number {
    return openDelay ?? fallback;
}

// The two-line default. Kit tooltips style it through their stylesheet (the classes);
// renderer chrome carries no stylesheet, so it gets the same values inline. The description
// sizes to its own text: an absolutely placed tip beside a narrow host (the drawing toolbar)
// would otherwise shrink-wrap it to its longest word.
const TITLE_INLINE = 'font-weight:600;';
const DESC_INLINE =
    'margin-top:2px;width:max-content;max-width:260px;white-space:normal;color:var(--vela-fg-muted);' +
    'font-size:var(--vela-font-size-sm);line-height:1.35;';

/**
 * A structured tooltip's content: the configured renderer's node, else the default — the
 * bare title (exactly a one-line tip) or, with a description, the title over a muted
 * description line. `inline` styles the default for chrome that carries no stylesheet.
 */
export function tooltipContent(info: TooltipInfo, doc: Document, inline = false): Node {
    if (render) {
        try {
            const custom = render(info);
            if (custom) return custom;
        } catch (err) {
            console.warn(`[vela] tooltip renderer failed for "${info.id}" — showing the default content.`, err);
        }
    }
    if (!info.description) return doc.createTextNode(info.title);
    const root = doc.createElement('div');
    root.className = 'vela-tooltip-rich';
    const title = doc.createElement('div');
    title.className = 'vela-tooltip-title';
    title.textContent = info.title;
    const desc = doc.createElement('div');
    desc.className = 'vela-tooltip-desc';
    desc.textContent = info.description;
    if (inline) {
        title.style.cssText = TITLE_INLINE;
        desc.style.cssText = DESC_INLINE;
    }
    root.append(title, desc);
    return root;
}
