import type { VelaTheme } from '../../../core/options';
import type { DrawingTypeKey, SnapMode } from '../../../core/drawings';
import type { ToolbarDefinition, ToolGroup, ToolSection } from '../../../core/drawings';
import { CHROME_BORDER_COLOR } from '../core/chartConfig';

/** Cosmetic/placement options — defaults reproduce the in-renderer docked bar exactly. */
export interface DrawingToolbarOptions {
    /** Border/divider color. Default: the chrome divider color. */
    borderColor?: string;
    /** Bar width in px. In docked (`'absolute'`) use it MUST match the host renderer's
     *  left-gutter reservation (NativeRenderer's `LEFT_GUTTER_W`, 44). Default 44. */
    width?: number;
    /** `'absolute'` (default): pinned over the renderer's left gutter. `'static'`: a
     *  normal column child — a workspace docks ONE shared bar in its own layout. */
    dock?: 'absolute' | 'static';
}

/**
 * The vertical drawing toolbar (renderer chrome), docked as a flush bar in the left gutter. Each
 * {@link ToolGroup} is a cell: clicking the icon arms the group's last-used tool; a chevron beside
 * it — its own hover target, revealed on cell hover — opens a flyout listing the group's tools. A
 * cursor button returns to select/idle; measure/eraser modes sit at the bottom, and the magnet is a
 * cell whose chevron opens an Off/Weak/Strong menu (its icon toggles the last-used strength on/off).
 * Below the magnet, a stay-in-drawing-mode toggle keeps tools armed after each placement.
 * Hover and active tints are CSS-driven (`:hover` + `[data-active]`) so they never lag. Tooltips
 * appear after a 2s hover. Pure vanilla DOM on the host (a `pointer-events:auto` island).
 */
export class DrawingToolbar {
    private readonly root: HTMLDivElement;
    private def: ToolbarDefinition = { groups: [] };
    private active: DrawingTypeKey | null = null;
    private readonly lastUsed = new Map<string, DrawingTypeKey>();
    /** FAVORITE tool types (core-authoritative; pushed via setFavorites). */
    private favorites = new Set<DrawingTypeKey>();
    /** Star elements of the currently open flyout, by tool type (live-updated, never stale). */
    private readonly starEls = new Map<DrawingTypeKey, HTMLElement>();
    private flyout: HTMLDivElement | null = null;
    private flyoutOwnerId: string | null = null; // group id (or MAGNET_ID) whose flyout is open
    private flyoutCell: HTMLElement | null = null; // the cell the open flyout is anchored to
    private readonly groupCells = new Map<string, HTMLElement>(); // the composite cell (hover/active bg + flyout anchor)
    private readonly groupIcons = new Map<string, HTMLButtonElement>(); // the icon button inside each cell
    private cursorBtn: HTMLButtonElement | null = null;
    private magnetCell: HTMLElement | null = null;
    private magnetIcon: HTMLButtonElement | null = null;
    private magnetMode: SnapMode = 'off';
    private lastMagnetOn: SnapMode = 'weak'; // strength restored when the magnet icon toggles back on
    private measureBtn: HTMLButtonElement | null = null;
    private measureActive = false;
    private eraserBtn: HTMLButtonElement | null = null;
    private eraserActive = false;
    private stayBtn: HTMLButtonElement | null = null;
    private stayActive = false;
    private visible = false;
    private readonly tipText = new WeakMap<HTMLElement, string>(); // per-anchor tooltip text (magnet's changes with mode)
    private tooltipEl: HTMLDivElement | null = null;
    private tooltipTimer: number | null = null;

    private readonly borderColor: string;
    private readonly width: number;
    private readonly dock: 'absolute' | 'static';

    constructor(
        private readonly host: HTMLElement,
        private theme: VelaTheme,
        private readonly onArm: (type: DrawingTypeKey | null) => void,
        private readonly onMagnet: (mode: SnapMode) => void = () => {},
        private readonly onMeasure: () => void = () => {},
        private readonly onEraser: () => void = () => {},
        private readonly onToggleFavorite: (type: DrawingTypeKey, on: boolean) => void = () => {},
        private readonly onStayMode: (on: boolean) => void = () => {},
        options: DrawingToolbarOptions = {},
    ) {
        this.borderColor = options.borderColor ?? CHROME_BORDER_COLOR;
        this.width = options.width ?? 44;
        this.dock = options.dock ?? 'absolute';
        ensureStyles();
        this.root = document.createElement('div');
        this.styleRoot();
        host.appendChild(this.root);
    }

    /** Flush vertical bar pinned to the left gutter (full height, right border, no card chrome). The
     *  hover/active tint colors are published as CSS variables so the scoped stylesheet can drive
     *  every hover/active state without any per-frame JS. */
    private styleRoot(): void {
        const t = this.theme;
        // Docked (default): pinned over the renderer's left gutter — width must match
        // NativeRenderer's LEFT_GUTTER_W. Static: a normal column child (a workspace's
        // shared bar) — the host's own layout places it.
        const placement = this.dock === 'absolute'
            ? `position:absolute;left:0;top:0;height:100%;width:${this.width}px;z-index:21;`
            : `position:relative;height:100%;width:${this.width}px;flex:none;`;
        this.root.style.cssText =
            placement +
            `display:${this.visible ? 'flex' : 'none'};flex-direction:column;gap:4px;` +
            `padding:6px 0;box-sizing:border-box;background:${t.background};border-right:1px solid ${this.borderColor};color:${t.textColor};` + // no h-padding → buttons span the bar width
            `pointer-events:auto;overflow-y:auto;overflow-x:hidden;` +
            `--vela-dtb-hover:${withAlpha(t.textColor, HOVER_A)};--vela-dtb-active:${withAlpha(t.textColor, ACTIVE_A)};--vela-dtb-item-hover:${withAlpha(t.textColor, ITEM_HOVER_A)};--vela-dtb-hover-fg:${t.textColor};`;
    }

    setDefinition(def: ToolbarDefinition): void {
        this.def = def;
        for (const g of def.groups) {
            const first = g.tools[0];
            if (first && !this.lastUsed.has(g.id)) this.lastUsed.set(g.id, first.type);
        }
        this.rebuild();
    }

    /** Reflect the core's favorite set. An OPEN flyout updates its stars IN PLACE — starring
     *  is a side action, so it must never close the menu the user is still browsing. */
    setFavorites(types: readonly DrawingTypeKey[]): void {
        this.favorites = new Set(types);
        for (const [type, el] of this.starEls) this.paintStar(el, type);
    }

    /** Paint one star for the current favorite state (filled + gold, or outline). */
    private paintStar(el: HTMLElement, type: DrawingTypeKey): void {
        const on = this.favorites.has(type);
        el.classList.toggle('vela-fav', on);
        el.setAttribute('aria-label', on ? 'Remove from favorites' : 'Add to favorites');
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
        el.innerHTML = sizedIcon(on ? STAR_FILLED_ICON : STAR_ICON);
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        this.root.style.display = visible ? 'flex' : 'none';
    }

    setActiveTool(type: DrawingTypeKey | null): void {
        this.active = type;
        if (type) {
            const group = this.def.groups.find((g) => g.tools.some((t) => t.type === type));
            if (group) {
                this.lastUsed.set(group.id, type);
                this.paintGroupIcon(group);
            }
        }
        this.closeFlyout();
        this.clearTooltip();
        this.highlight();
    }

    setTheme(theme: VelaTheme): void {
        this.theme = theme;
        this.styleRoot();
        this.rebuild();
    }

    destroy(): void {
        this.closeFlyout();
        this.clearTooltip();
        this.root.remove();
    }

    // ── internals ──
    private rebuild(): void {
        this.root.replaceChildren();
        this.groupCells.clear();
        this.groupIcons.clear();
        this.cursorBtn = this.makeButton(CURSOR_ICON, 'Cursor', () => this.onArm(null));
        this.root.appendChild(this.cursorBtn);
        if (this.def.groups.length > 0) this.root.appendChild(this.divider());
        for (const g of this.def.groups) {
            const cell = this.makeGroupCell(g);
            this.root.appendChild(cell);
            this.paintGroupIcon(g);
        }
        // Measure ruler + eraser + magnet — renderer-local modes, not persistent-drawing tools.
        this.root.appendChild(this.divider());
        this.measureBtn = this.makeButton(RULER_ICON, 'Measure', () => this.onMeasure());
        this.root.appendChild(this.measureBtn);
        this.eraserBtn = this.makeButton(ERASER_ICON, 'Eraser (click/drag to delete)', () => this.onEraser());
        this.root.appendChild(this.eraserBtn);
        this.root.appendChild(this.makeMagnetCell());
        this.stayBtn = this.makeButton(STAY_ICON, 'Stay in drawing mode', () => this.toggleStay());
        this.root.appendChild(this.stayBtn);
        this.paintMeasure();
        this.paintEraser();
        this.paintMagnet();
        this.paintStay();
        this.highlight();
    }

    /** A cell: a full-width icon button (arms/toggles the primary action) plus, when
     *  {@link opts.multi} is set, a chevron button absolutely pinned to the right. The icon spans the
     *  whole cell so its glyph stays centered in the bar (aligned with the single-icon buttons); the
     *  hover/active tint lives on a centered square (`.vela-dtb-hit`) that hugs the glyph, not the whole
     *  row. The chevron is its own hover target — revealed on cell hover, tinted only on its own hover. */
    private makeCell(
        label: string,
        opts: { iconSvg?: string; multi: boolean; onIcon: () => void; onArrow?: () => void },
    ): { cell: HTMLDivElement; icon: HTMLButtonElement; arrow: HTMLButtonElement | null } {
        const cell = document.createElement('div');
        cell.className = 'vela-dtb-cell';
        const icon = document.createElement('button');
        icon.type = 'button';
        icon.className = 'vela-dtb-icon';
        icon.setAttribute('aria-label', label);
        if (opts.iconSvg) icon.innerHTML = hitHtml(opts.iconSvg);
        icon.addEventListener('click', opts.onIcon);
        cell.appendChild(icon);
        let arrow: HTMLButtonElement | null = null;
        if (opts.multi && opts.onArrow) {
            const onArrow = opts.onArrow;
            arrow = document.createElement('button'); // its own hover target, hidden until the cell is hovered (CSS)
            arrow.type = 'button';
            arrow.className = 'vela-dtb-arrow';
            arrow.setAttribute('aria-label', `${label} — more`);
            arrow.innerHTML = arrowHitHtml(ARROW_ICON);
            arrow.addEventListener('click', (e) => {
                e.stopPropagation();
                onArrow();
            });
            cell.appendChild(arrow);
        }
        cell.addEventListener('mouseenter', () => this.armTooltip(cell, this.tipText.get(cell) ?? label));
        cell.addEventListener('mouseleave', () => this.clearTooltip());
        return { cell, icon, arrow };
    }

    private makeGroupCell(g: ToolGroup): HTMLElement {
        const multi = g.tools.length > 1;
        const { cell, icon } = this.makeCell(g.label, {
            multi,
            onIcon: () => this.onGroupIconClick(g),
            onArrow: multi ? () => this.onArrowClick(g) : undefined,
        });
        this.groupCells.set(g.id, cell);
        this.groupIcons.set(g.id, icon);
        return cell;
    }

    private makeMagnetCell(): HTMLElement {
        const { cell, icon } = this.makeCell('Magnet snap', {
            iconSvg: MAGNET_ICON,
            multi: true,
            onIcon: () => this.toggleMagnet(),
            onArrow: () => this.onMagnetArrowClick(),
        });
        this.magnetCell = cell;
        this.magnetIcon = icon;
        return cell;
    }

    /** Clicking the icon arms the group's last-used tool (it does NOT open the flyout). */
    private onGroupIconClick(group: ToolGroup): void {
        const type = this.lastUsed.get(group.id) ?? group.tools[0]?.type;
        if (type) this.onArm(type);
    }

    /** Clicking the chevron toggles the group's flyout (same group → close; another → switch). */
    private onArrowClick(group: ToolGroup): void {
        const wasOpen = this.flyoutOwnerId === group.id;
        this.closeFlyout();
        if (!wasOpen) this.openGroupFlyout(group);
    }

    /** The magnet icon toggles the last-used strength on/off; the chevron opens the strength menu. */
    private toggleMagnet(): void {
        this.applyMagnet(this.magnetMode === 'off' ? this.lastMagnetOn : 'off');
    }

    private onMagnetArrowClick(): void {
        const wasOpen = this.flyoutOwnerId === MAGNET_ID;
        this.closeFlyout();
        if (!wasOpen) this.openMagnetFlyout();
    }

    /** Set the magnet mode, notify the renderer, and repaint (used by the menu + icon toggle). */
    private applyMagnet(mode: SnapMode): void {
        this.magnetMode = mode;
        if (mode !== 'off') this.lastMagnetOn = mode;
        this.onMagnet(mode);
        this.paintMagnet();
        this.highlight();
    }

    /** Reflect the magnet mode externally (e.g. if set programmatically) without notifying back. */
    setMagnetMode(mode: SnapMode): void {
        this.magnetMode = mode;
        if (mode !== 'off') this.lastMagnetOn = mode;
        this.paintMagnet();
        this.highlight();
    }

    /** Highlight the Measure ruler button while the transient ruler is armed. */
    setMeasureActive(active: boolean): void {
        this.measureActive = active;
        this.paintMeasure();
        this.highlight();
    }

    private paintMeasure(): void {
        const b = this.measureBtn;
        if (!b) return;
        b.dataset.active = this.measureActive ? '1' : '';
    }

    /** Highlight the Eraser button while erase mode is active. */
    setEraserActive(active: boolean): void {
        this.eraserActive = active;
        this.paintEraser();
        this.highlight();
    }

    private paintEraser(): void {
        const b = this.eraserBtn;
        if (!b) return;
        b.dataset.active = this.eraserActive ? '1' : '';
    }

    private paintMagnet(): void {
        const cell = this.magnetCell;
        const icon = this.magnetIcon;
        if (!cell || !icon) return;
        const label = this.magnetMode === 'off' ? 'Off' : this.magnetMode === 'weak' ? 'Weak' : 'Strong';
        this.tipText.set(cell, `Magnet snap: ${label}`);
        const on = this.magnetMode !== 'off';
        cell.dataset.active = on ? '1' : '';
        icon.style.opacity = on ? '1' : '0.5';
    }

    /** Toggle stay-in-drawing-mode on/off and notify the renderer. */
    private toggleStay(): void {
        this.stayActive = !this.stayActive;
        this.onStayMode(this.stayActive);
        this.paintStay();
    }

    /** Reflect stay-in-drawing-mode externally without notifying back. */
    setStayMode(on: boolean): void {
        this.stayActive = on;
        this.paintStay();
    }

    private paintStay(): void {
        const b = this.stayBtn;
        if (!b) return;
        b.dataset.active = this.stayActive ? '1' : '';
        b.style.opacity = this.stayActive ? '1' : '0.5';
    }

    // ── flyout ──
    /** Create the positioned flyout panel anchored to a cell, register it as open, and start the
     *  outside-dismiss. Callers fill it with items. */
    private beginFlyout(ownerId: string, cell: HTMLElement): HTMLDivElement {
        const t = this.theme;
        const fly = document.createElement('div');
        fly.className = 'vela-dtb-flyout';
        // square LEFT corners (butts flush against the bar), rounded RIGHT corners; no left border so the seam is invisible
        fly.style.cssText =
            `position:absolute;z-index:23;display:flex;flex-direction:column;gap:2px;padding:4px;border-radius:0 8px 8px 0;` +
            // same soft tint as the selected button (opaque) so the bar → menu reads as one region
            `background:${blend(t.background, t.textColor, ACTIVE_A)};border:1px solid ${this.borderColor};border-left:none;box-shadow:4px 6px 18px rgba(0,0,0,0.4);pointer-events:auto;` +
            `overflow-y:auto;overscroll-behavior:contain;` +
            `--vela-dtb-item-hover:${withAlpha(t.textColor, ITEM_HOVER_A)};`;
        this.host.appendChild(fly);
        const r = cell.getBoundingClientRect();
        const rootR = this.root.getBoundingClientRect();
        const hostR = this.host.getBoundingClientRect();
        // start 1px inside the bar's right edge, covering its border so the menu connects seamlessly
        // to the (full-width) selected button — no dark gap, no border seam.
        const top = r.top - hostR.top;
        fly.style.left = `${rootR.right - hostR.left - 1}px`;
        fly.style.top = `${top}px`;
        // Cap height to the remaining space in the host so long tool lists scroll instead of clipping.
        fly.style.maxHeight = `${Math.max(120, hostR.height - top - 8)}px`;
        this.flyout = fly;
        this.flyoutOwnerId = ownerId;
        this.flyoutCell = cell;
        cell.classList.add('vela-open'); // keep the opening cell highlighted (+ square its right corners) while open
        this.highlight();
        // dismiss on the next OUTSIDE press; this click's pointerdown already fired, so add synchronously
        document.addEventListener('pointerdown', this.onOutside);
        return fly;
    }

    private openGroupFlyout(group: ToolGroup): void {
        const cell = this.groupCells.get(group.id);
        if (!cell) return;
        const fly = this.beginFlyout(group.id, cell);
        const sections: ToolSection[] = group.sections ?? [{ label: '', tools: group.tools }];
        for (let si = 0; si < sections.length; si++) {
            const section = sections[si]!;
            if (section.label) {
                if (si > 0) fly.appendChild(this.flyoutSeparator());
                fly.appendChild(this.flyoutHeader(section.label));
            }
            for (const tool of section.tools) {
                fly.appendChild(
                    this.makeFlyoutItem({
                        icon: tool.icon,
                        label: tool.label,
                        selected: tool.type === this.active,
                        onSelect: () => this.onArm(tool.type),
                        favorite: {
                            type: tool.type,
                            toggle: () => this.onToggleFavorite(tool.type, !this.favorites.has(tool.type)),
                        },
                    }),
                );
            }
        }
    }

    private openMagnetFlyout(): void {
        const cell = this.magnetCell;
        if (!cell) return;
        const fly = this.beginFlyout(MAGNET_ID, cell);
        fly.appendChild(this.flyoutHeader('Magnet'));
        const modes: readonly [SnapMode, string][] = [
            ['off', 'Off'],
            ['weak', 'Weak'],
            ['strong', 'Strong'],
        ];
        for (const [mode, label] of modes) {
            fly.appendChild(
                this.makeFlyoutItem({
                    label,
                    selected: mode === this.magnetMode,
                    onSelect: () => {
                        this.applyMagnet(mode);
                        this.closeFlyout();
                    },
                }),
            );
        }
    }

    private flyoutHeader(text: string): HTMLElement {
        const t = this.theme;
        const header = document.createElement('div');
        header.textContent = text.toUpperCase();
        header.style.cssText =
            `padding:6px 12px 2px 8px;font:11px ${t.fontFamily};font-weight:600;letter-spacing:0.04em;` +
            `color:${withAlpha(t.textColor, 0.45)};user-select:none;`;
        return header;
    }

    private flyoutSeparator(): HTMLElement {
        const div = document.createElement('div');
        div.style.cssText = `height:1px;margin:4px 8px;background:${this.borderColor};`;
        return div;
    }

    /** A flyout row: optional leading icon, label, and a trailing check when it's the selected entry.
     *  Hover tint is CSS (`.vela-dtb-item:hover`), so navigating the menu stays smooth. */
    private makeFlyoutItem(opts: {
        icon?: string;
        label: string;
        selected?: boolean;
        onSelect: () => void;
        /** Star toggle (tool rows only — mode rows have no favorites). */
        favorite?: { type: DrawingTypeKey; toggle: () => void };
    }): HTMLButtonElement {
        const t = this.theme;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'vela-dtb-item';
        item.setAttribute('aria-label', opts.label);
        item.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 10px 5px 8px;cursor:pointer;color:${t.textColor};border-radius:4px;font:13px ${t.fontFamily};white-space:nowrap;min-width:148px;`;
        if (opts.icon) {
            const icon = document.createElement('span');
            icon.style.cssText = 'width:18px;height:18px;display:flex;align-items:center;justify-content:center;flex:none;';
            icon.innerHTML = sizedIcon(opts.icon);
            item.appendChild(icon);
        }
        const label = document.createElement('span');
        label.textContent = opts.label;
        label.style.cssText = 'flex:1 1 auto;text-align:left;';
        item.appendChild(label);
        if (opts.favorite) {
            const star = document.createElement('span');
            star.className = 'vela-dtb-star';
            star.setAttribute('role', 'button');
            this.paintStar(star, opts.favorite.type);
            this.starEls.set(opts.favorite.type, star);
            // Swallow the WHOLE pointer sequence: the row arms its tool on click, and a
            // pointerdown that starts on the star must never reach it (nor the flyout's
            // outside-dismiss listener).
            for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup'] as const) {
                star.addEventListener(ev, (e) => e.stopPropagation());
            }
            star.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                opts.favorite!.toggle();
            });
            item.appendChild(star);
        }
        const check = document.createElement('span');
        check.style.cssText = 'width:14px;height:14px;display:flex;align-items:center;justify-content:center;flex:none;';
        if (opts.selected) check.innerHTML = sizedIcon(CHECK_ICON);
        item.appendChild(check);
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            opts.onSelect();
        });
        return item;
    }

    private readonly onOutside = (e: PointerEvent): void => {
        const target = e.target as Node;
        // presses inside the toolbar (arrows/cells) are handled by their own click handlers — don't
        // dismiss here, or an arrow's pointerdown would close the flyout before its click can toggle it.
        if (this.flyout && !this.flyout.contains(target) && !this.root.contains(target)) this.closeFlyout();
    };

    private closeFlyout(): void {
        this.starEls.clear();
        if (this.flyout) {
            this.flyout.remove();
            this.flyout = null;
            this.flyoutCell?.classList.remove('vela-open');
            this.flyoutCell = null;
            this.flyoutOwnerId = null;
            document.removeEventListener('pointerdown', this.onOutside);
            this.highlight();
        }
    }

    private paintGroupIcon(group: ToolGroup): void {
        const iconBtn = this.groupIcons.get(group.id);
        if (!iconBtn) return;
        const type = this.lastUsed.get(group.id) ?? group.tools[0]?.type;
        const tool = group.tools.find((t) => t.type === type) ?? group.tools[0];
        iconBtn.innerHTML = hitHtml(tool?.icon ?? '');
    }

    /** Reconcile active tints from state (armed group / open flyout / cursor / modes). Active is a
     *  `data-active` attribute the stylesheet paints — no inline background, so hover never sticks. */
    private highlight(): void {
        const activeGroup = this.active ? this.def.groups.find((g) => g.tools.some((t) => t.type === this.active)) : null;
        for (const [id, cell] of this.groupCells) {
            const on = id === activeGroup?.id; // armed group only — flyout-open tints the chevron via vela-open
            cell.dataset.active = on ? '1' : '';
        }
        if (this.cursorBtn) this.cursorBtn.dataset.active = this.active == null && !this.measureActive && !this.eraserActive ? '1' : '';
        this.paintMeasure();
        this.paintEraser();
        this.paintMagnet();
        this.paintStay();
    }

    private makeButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vela-dtb-btn';
        btn.setAttribute('aria-label', title); // not `title` — we render our own 2s-dwell tooltip
        this.tipText.set(btn, title);
        if (icon) btn.innerHTML = hitHtml(icon);
        btn.addEventListener('mouseenter', () => this.armTooltip(btn, this.tipText.get(btn) ?? title));
        btn.addEventListener('mouseleave', () => this.clearTooltip());
        btn.addEventListener('click', onClick);
        return btn;
    }

    // ── 2-second dwell tooltip (a rounded chip beside the tool, our own — not the native title) ──
    private armTooltip(anchor: HTMLElement, text: string): void {
        this.clearTooltip();
        if (!text) return;
        this.tooltipTimer = window.setTimeout(() => this.showTooltip(anchor, text), 2000);
    }

    private clearTooltip(): void {
        if (this.tooltipTimer != null) {
            clearTimeout(this.tooltipTimer);
            this.tooltipTimer = null;
        }
        if (this.tooltipEl) {
            this.tooltipEl.remove();
            this.tooltipEl = null;
        }
    }

    private showTooltip(anchor: HTMLElement, text: string): void {
        const t = this.theme;
        const tip = document.createElement('div');
        tip.textContent = text;
        tip.style.cssText =
            `position:absolute;z-index:25;background:${t.background};border:1px solid ${this.borderColor};color:${t.textColor};` +
            `border-radius:6px;padding:4px 9px;font:12px ${t.fontFamily};white-space:nowrap;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,0.35);`;
        this.host.appendChild(tip);
        const r = anchor.getBoundingClientRect();
        const hostR = this.host.getBoundingClientRect();
        tip.style.left = `${r.right - hostR.left + 8}px`;
        tip.style.top = `${r.top - hostR.top + (r.height - tip.offsetHeight) / 2}px`;
        this.tooltipEl = tip;
    }

    private divider(): HTMLElement {
        const d = document.createElement('div');
        d.style.cssText = `width:24px;height:1px;margin:2px auto;flex:none;background:${this.borderColor};`;
        return d;
    }
}

const MAGNET_ID = '__magnet__';

const STYLE_ID = 'vela-drawing-toolbar-styles';
/** Inject the scoped CSS that inline styles can't express: the centered hit-square that carries the
 *  hover/active tint (so the highlight hugs the icon rather than filling the row), the chevron's own
 *  hover target, and the chevron reveal — all `:hover`/`[data-active]`-driven and transitioned so
 *  state changes never lag or stick. Colors come from CSS variables on the root (set in
 *  {@link DrawingToolbar.styleRoot}). Idempotent — one shared sheet for all toolbars. */
function ensureStyles(): void {
    if (typeof document === 'undefined') return;
    let s = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!s) {
        s = document.createElement('style');
        s.id = STYLE_ID;
        document.head.appendChild(s);
    }
    s.textContent = `
.vela-dtb-hit{width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:background .12s ease,color .12s ease;}
.vela-dtb-hit--arrow{width:11px;height:22px;}
.vela-dtb-btn{position:relative;width:100%;height:30px;flex:none;display:flex;align-items:center;justify-content:center;cursor:pointer;color:inherit;background:transparent;border:none;padding:0;}
.vela-dtb-btn:hover .vela-dtb-hit{background:var(--vela-dtb-hover);}
.vela-dtb-btn[data-active='1'] .vela-dtb-hit{background:var(--vela-dtb-active);}
.vela-dtb-cell{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:30px;}
.vela-dtb-icon{flex:none;width:26px;height:30px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:inherit;cursor:pointer;padding:0;}
.vela-dtb-cell[data-active='1'] .vela-dtb-icon .vela-dtb-hit{background:var(--vela-dtb-active);}
.vela-dtb-arrow{position:absolute;right:1px;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:inherit;cursor:pointer;padding:0;opacity:0;pointer-events:none;transition:opacity .12s ease,color .12s ease;}
.vela-dtb-cell:hover .vela-dtb-arrow,.vela-dtb-icon:hover~.vela-dtb-arrow,.vela-dtb-cell.vela-open .vela-dtb-arrow{opacity:1;pointer-events:auto;}
.vela-dtb-arrow:hover{color:var(--vela-dtb-hover-fg,inherit);}
.vela-dtb-icon:hover .vela-dtb-hit,.vela-dtb-arrow:hover .vela-dtb-hit{background:var(--vela-dtb-hover);}
.vela-dtb-cell.vela-open .vela-dtb-arrow .vela-dtb-hit{background:var(--vela-dtb-active);}
.vela-dtb-cell.vela-open .vela-dtb-arrow:hover .vela-dtb-hit{background:var(--vela-dtb-hover);}
.vela-dtb-item{background:transparent;border:none;transition:background .1s ease;}
.vela-dtb-item:hover{background:var(--vela-dtb-item-hover);}
.vela-dtb-star{width:26px;height:22px;margin:-3px -5px -3px 0;padding:3px 5px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:none;opacity:0;color:inherit;border-radius:4px;transition:opacity .1s ease,color .1s ease,background .1s ease;}
.vela-dtb-star svg{width:16px;height:16px;}
.vela-dtb-item:hover .vela-dtb-star{opacity:.55;}
.vela-dtb-star:hover{opacity:1 !important;background:var(--vela-dtb-item-hover);}
.vela-dtb-star.vela-fav{opacity:.95;color:#e0b400;}
/* Thin thumb-only scrollbar. Avoid scrollbar-width in Chromium — it disables ::-webkit-scrollbar. */
@supports not selector(::-webkit-scrollbar){
.vela-dtb-flyout{scrollbar-width:thin;scrollbar-color:rgba(148,163,184,0.35) transparent;}
}
.vela-dtb-flyout::-webkit-scrollbar{width:4px;}
.vela-dtb-flyout::-webkit-scrollbar-button{display:none;width:0;height:0;}
.vela-dtb-flyout::-webkit-scrollbar-track,.vela-dtb-flyout::-webkit-scrollbar-track-piece,.vela-dtb-flyout::-webkit-scrollbar-corner{background:transparent;}
.vela-dtb-flyout::-webkit-scrollbar-thumb{background:rgba(148,163,184,0.4);border-radius:4px;}
.vela-dtb-flyout::-webkit-scrollbar-thumb:hover{background:rgba(148,163,184,0.6);}`;
}

const CURSOR_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l6 16 2-6 6-2z"/></svg>';
const RULER_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 15.3 8.7 2.7a1 1 0 0 0-1.4 0L2.7 7.3a1 1 0 0 0 0 1.4l12.6 12.6a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/></svg>';
const MAGNET_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/></svg>';
/** Pen with a padlock — stay-in-drawing-mode (tools remain armed after each placement). */
const STAY_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.8 4.2a2.1 2.1 0 0 1 3 3L8.5 15.5l-3.5 1 1-3.5Z"/><rect x="13" y="14.5" width="8" height="6" rx="1.2"/><path d="M15 14.5v-1.6a2 2 0 0 1 4 0v1.6"/></svg>';
const ERASER_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4L13 5a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L12 20"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>';
/** A right-pointing chevron for the group/magnet flyout arrow (beside the icon). */
const ARROW_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
/** A check mark for the selected entry in a flyout (e.g. the current magnet strength). */
const CHECK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const STAR_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg>';
const STAR_FILLED_ICON =
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg>';

/** Force an inline SVG icon to fill its 18px slot. */
function sizedIcon(svg: string): string {
    return svg.replace('<svg ', '<svg width="100%" height="100%" ');
}

/** Wrap an SVG in a centered, fixed-size span (default 18px) so it sits consistently in a button. */
function iconSpan(svg: string, size = 18): string {
    if (!svg) return '';
    return `<span style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">${sizedIcon(svg)}</span>`;
}

/** A button's inner content: the glyph inside a centered square (`.vela-dtb-hit`) that carries the
 *  hover/active highlight, so the tint hugs the icon instead of stretching across the whole row. */
function hitHtml(svg: string, iconSize = 18): string {
    return `<span class="vela-dtb-hit">${iconSpan(svg, iconSize)}</span>`;
}

/** The chevron's inner content: same hover/active tint as the icon hit, in a narrow pill beside it. */
function arrowHitHtml(svg: string): string {
    return `<span class="vela-dtb-hit vela-dtb-hit--arrow">${iconSpan(svg, 11)}</span>`;
}

// Toolbar highlight alphas (a foreground tint over the dark bar/menu). The selected button + the
// flyout share ACTIVE_A (kept light) so they read as one continuous region; the flyout item hover
// (ITEM_HOVER_A) is stronger so it stands clearly apart when navigating the menu.
const HOVER_A = 0.06; // hover hint on an idle button
const ACTIVE_A = 0.1; // selected button + flyout base (the soft continuation tint)
const ITEM_HOVER_A = 0.16; // flyout item hover (the navigation highlight)

function rgbOf(color: string): [number, number, number] | null {
    const hex = /^#([0-9a-f]{6})$/i.exec(color);
    if (hex) {
        const n = parseInt(hex[1]!, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const rgb = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(color);
    return rgb ? [parseFloat(rgb[1]!), parseFloat(rgb[2]!), parseFloat(rgb[3]!)] : null;
}

/** A foreground color at a given alpha (for hover/active backgrounds across themes). */
function withAlpha(color: string, alpha: number): string {
    const c = rgbOf(color) ?? [148, 163, 184];
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

/** An OPAQUE mix of `fg` into `base` at `alpha` — so the flyout's solid bg matches a button's
 *  translucent active tint (both resolve to the same color → visual continuity bar → menu). */
function blend(base: string, fg: string, alpha: number): string {
    const b = rgbOf(base) ?? [13, 17, 23];
    const f = rgbOf(fg) ?? [148, 163, 184];
    const mix = (i: number): number => Math.round(b[i]! + (f[i]! - b[i]!) * alpha);
    return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}
