// Object tree — a docked side panel listing everything on the chart, grouped by pane. Each
// pane block names itself and carries its ops (move, collapse, maximize); inside it sits the
// pane's whole stack — its drawings, its indicators and, in the main pane, the candles — as
// ONE column ordered front-first, so the list reads top-to-bottom as "what draws in front of
// what". On a renderer whose drawings share the series' draw-order space, a drawing takes a
// slot anywhere in that column: over everything, under the candles, between two indicators.
// Rows carry eye / lock / remove actions.
//
// The layout itself lives in `object-tree-model.ts` — this file pulls a snapshot off the
// chart, hands it over, and paints the result. Kept in sync via the chart's event bus, and
// rebound to each new chart instance after a widget rebuild.
import type { Vela } from '../Vela';
import type { IndicatorHandle } from '../core/IndicatorHandle';
import type { SerializedDrawing } from '../core/drawings/Drawing';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { Menu, type MenuItemDescriptor } from '../ui/components/menu';
import { tickerIconEl } from './symbol-icon';
import { parseSymbol } from '../data/ProviderRegistry';
import {
    assignToGroup,
    buildTree,
    canGroup,
    drawingLabel,
    drawingMeta,
    groupOf,
    groupState,
    groupTokenIndex,
    nextGroupName,
    paneRows,
    paneTokens,
    placeTokens,
    pruneGroups,
    removeFromGroups,
    stackWrites,
    tokenIndexOfSlot,
    tokensEqual,
    treeIsEmpty,
    zStackBounds,
    PRICE_PANE_ID,
    type DrawGroup,
    type DrawUnit,
    type IndicatorRow,
    type StackToken,
    type TreePane,
    type TreeRow,
    type TreeSnapshot,
} from './object-tree-model';
import { SidePanel } from './side-panel';

const STYLE_ID = 'vela-widget-objtree';
const CSS = `
/* One pane's block. The transparent border reserves the drop-target outline. */
.vela-ot-pane {
    border: 1px solid transparent;
    border-radius: 6px;
    margin: 2px 0;
}
.vela-ot-panehead { display: flex; align-items: center; gap: 2px; padding: 5px 6px; }
.vela-ot-panename {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vela-fg-muted);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
.vela-ot-panesep { height: 1px; background: var(--vela-border); margin: 6px 8px; }

.vela-ot-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 6px;
    border-radius: 6px;
    cursor: default;
}
.vela-ot-row:hover { background: var(--vela-hover); }
.vela-ot-row > .vela-icon { color: var(--vela-fg-muted); width: 14px; height: 14px; font-size: 14px; justify-content: center; flex: none; }
/* Drawing glyphs come from the type registry at toolbar scale — bring them down to row size. */
.vela-ot-row > .vela-icon svg { width: 14px; height: 14px; }
.vela-ot-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-ot-row[data-hidden] .vela-ot-name,
.vela-ot-row[data-hidden] > .vela-icon { opacity: 0.45; }
/* Two different states, and both can be true at once: "picked" is what the panel has selected
   (the group/duplicate candidates), "selected" mirrors what the CHART has selected. */
.vela-ot-row[data-picked] { background: var(--vela-active); }
.vela-ot-row[data-picked] .vela-ot-name { color: var(--vela-fg-bright); }
.vela-ot-row[data-selected] { box-shadow: inset 2px 0 0 var(--vela-accent); }
.vela-ot-avatar {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--vela-fg-on-fill);
    font-size: 10px;
    font-weight: 700;
}
/* "scale": this indicator draws against its own price scale, not the pane's. */
.vela-ot-tag {
    flex: none;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vela-fg-muted);
    background: var(--vela-hover);
    border-radius: 3px;
    padding: 1px 4px;
}
/* One row's actions, kept in a tight cluster: they read as one control group, and the row's
   own wider gap stays between the label and them. */
.vela-ot-acts { display: flex; align-items: center; gap: 0; flex: none; }
.vela-ot-btn {
    all: unset;
    cursor: pointer;
    flex: none;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    color: var(--vela-fg-muted);
    font-size: 12px;
    visibility: hidden;
}
.vela-ot-row:hover .vela-ot-btn,
.vela-ot-panehead:hover .vela-ot-btn { visibility: visible; }
/* An engaged action stays out: hidden and locked are states, and a state the user can only
   see by hovering is a state they will not find. */
.vela-ot-row .vela-ot-btn[data-engaged] { visibility: visible; color: var(--vela-fg); }
.vela-ot-btn:hover:not(:disabled) { background: var(--vela-active); color: var(--vela-fg-bright); }
.vela-ot-btn:disabled { opacity: 0.35; cursor: default; }
.vela-ot-empty { padding: 20px 10px; text-align: center; color: var(--vela-fg-muted); font-size: 12px; }

/* ── drawing groups ── */
/* One top-level entry in a pane's drawing list: a lone drawing, or a whole group block. No
   border of its own — units stack flush, so consecutive highlighted rows read as one block; the
   drop-into-group outline is drawn inside the box instead (see the drag-and-drop rules). */
.vela-ot-unit { border-radius: 6px; }
/* Adjacent picked rows merge into one contiguous highlight: the shared edge loses its rounding. */
.vela-ot-unit:has(> .vela-ot-row[data-picked]) + .vela-ot-unit > .vela-ot-row[data-picked] { border-top-left-radius: 0; border-top-right-radius: 0; }
.vela-ot-unit:has(+ .vela-ot-unit > .vela-ot-row[data-picked]) > .vela-ot-row[data-picked] { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.vela-ot-row[data-row-kind='group'] > .vela-icon { width: 12px; font-size: 11px; }
/* A member sits indented under its group's header. */
.vela-ot-subrow { padding-left: 26px; }
.vela-ot-rename {
    flex: 1;
    min-width: 0;
    padding: 1px 4px;
    border: 1px solid var(--vela-accent);
    border-radius: var(--vela-radius-sm);
    background: var(--vela-surface-elev);
    color: var(--vela-fg-bright);
    font: inherit;
}
/* The selection bar. Always there — the actions it holds are the panel's, not a row's, so they
   stay in place and simply go dim until a drawing is selected. It stays put at the top of the
   list while the list scrolls under it, so they never scroll out of reach. */
.vela-ot-selbar {
    position: sticky;
    top: -8px;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 2px;
    margin: -8px -8px 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--vela-border);
    background: var(--vela-bg);
}
.vela-ot-selcount { flex: 1; min-width: 0; color: var(--vela-fg-muted); font-size: 11px; }
.vela-ot-selbar .vela-ot-btn { visibility: visible; width: 24px; height: 22px; }
.vela-ot-selbar .vela-ot-btn[data-icon='group'] .vela-icon { width: 16px; height: 16px; font-size: 16px; }

/* ── drag-and-drop ── */
.vela-ot-row[data-drag] { cursor: grab; }
.vela-ot .vela-panel-body[data-dragging] .vela-ot-row[data-drag] { cursor: grabbing; }
/* The row in flight fades: the ghost under the pointer is the thing being moved. */
.vela-ot-row[data-source] { opacity: 0.4; }
/* Buttons would only invite a click that a drag is about to swallow. */
.vela-ot .vela-panel-body[data-dragging] .vela-ot-btn { visibility: hidden; }

/* The band between two pane blocks: a hairline at rest, a bright bar when dropping there
   would open a new pane. Doubles as the plain separator when dragging isn't available. */
.vela-ot-gap { position: relative; height: 11px; border-radius: 3px; margin: 0 8px; }
.vela-ot-gap::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: var(--vela-border);
    transform: translateY(-50%);
}
.vela-ot-gap[data-drop] { height: 4px; background: var(--vela-fg-bright); }
.vela-ot-gap[data-drop]::before { display: none; }
/* A whole container accepts the drop: merging into a pane, or a pane with no drawings yet.
   The pane block's transparent border reserves the room for this outline; a group unit has no
   border to color, so it draws the same line as an inset outline (no layout footprint). */
.vela-ot [data-drop='target'] { border-color: var(--vela-fg-bright); background: var(--vela-hover); }
.vela-ot-unit[data-drop='target'] { outline: 1px solid var(--vela-fg-bright); outline-offset: -1px; }
/* Where a reorder would insert. */
.vela-ot [data-drop='before'] { box-shadow: inset 0 2px 0 var(--vela-fg-bright); }
.vela-ot [data-drop='after'] { box-shadow: inset 0 -2px 0 var(--vela-fg-bright); }

.vela-ot-ghost {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    max-width: 220px;
    padding: 3px 10px;
    border: 1px solid var(--vela-fg-bright);
    border-radius: var(--vela-radius-sm);
    background: var(--vela-surface-overlay);
    color: var(--vela-fg);
    box-shadow: var(--vela-shadow);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
`;

const REFRESH_EVENTS = [
    'indicator:added',
    'indicator:removed',
    'indicator:moved',
    'indicator:visibility',
    'pane:changed',
    'drawing:created',
    'drawing:edited',
    'drawing:removed',
] as const;

/** How far a press has to travel before it counts as a drag rather than a click. */
const DRAG_SLOP = 4;

/** What is being dragged. Mirrors a row's `data-row-kind`. */
type DragKind = 'price' | 'indicator' | 'drawing' | 'group';

/** What dropping at the current pointer would do, resolved from the rendered geometry. */
type Drop =
    /** Open a fresh pane in the band between two blocks. */
    | { kind: 'newPane'; before: string | undefined; after: string | undefined; el: HTMLElement }
    /** Join an existing pane, leaving its internal order alone. */
    | { kind: 'merge'; paneId: string; el: HTMLElement }
    /** Take a slot in a pane's stack — the ONE front-first column of drawings, indicators and
     *  (on the main pane) the candles. For a drawing, a different pane also re-panes it. */
    | { kind: 'slot'; paneId: string; slot: number; els: HTMLElement[]; el: HTMLElement }
    /** Join a group, at a slot among its members. */
    | { kind: 'intoGroup'; paneId: string; groupId: string; memberSlot: number; subrows: HTMLElement[]; el: HTMLElement };

/** A press on a draggable row, live until the pointer is released. */
interface DragSession {
    kind: DragKind;
    /** The dragged object's id — null for the candles, which have none. */
    id: string | null;
    fromPane: string;
    label: string;
    startX: number;
    startY: number;
    /** False until the pointer clears `DRAG_SLOP`; a press that never does stays a click. */
    active: boolean;
    ghost: HTMLElement | null;
    drop: Drop | null;
    onMove: (e: PointerEvent) => void;
    onUp: () => void;
    /** The pointer was taken away from us (a touch turning into a gesture, a lost capture) —
     *  there is no drop position to trust, so the session is abandoned. */
    onCancel: () => void;
}

/** Insertion index in a vertical stack: the first element whose midpoint is below `y`. */
function insertionSlot(els: readonly HTMLElement[], y: number): number {
    for (let i = 0; i < els.length; i += 1) {
        const r = els[i]!.getBoundingClientRect();
        if (y < r.top + r.height / 2) return i;
    }
    return els.length;
}

/** One action button on a row or pane head. */
interface RowAction {
    icon: string;
    title: string;
    /** The state this action would undo is currently on — the row is hidden, or locked. Actions
     *  otherwise appear on hover, which would leave that state invisible at rest, so an engaged
     *  one stays out and reads as a badge. */
    engaged?: boolean;
    /** Offered but not available — shown dimmed, with `title` explaining why. */
    disabled?: boolean;
    run: () => void;
}

/** What a single render pass needs: the chart plus the lookups it would otherwise redo per row. */
interface Pass {
    chart: Vela;
    handle: (id: string) => IndicatorHandle | undefined;
    /** Whether the main pane's stacking can be reordered on this renderer. */
    stackable: boolean;
    /** Whether indicators can move between panes on this renderer. */
    repanable: boolean;
    /** Whether drawings share the series' draw-order space — a drawing can then take any slot
     *  in its pane's stack, under the candles or between two indicators. */
    interleave: boolean;
    panes: TreePane[];
}

/**
 * Assembles menu descriptors together with the callbacks their ids fire. The kit menu reports
 * a selected id and the tree's entries are per-object, so the mapping is built fresh on each
 * right-click. Ids are unique across nesting levels, since a submenu leaf reports to the root.
 */
class MenuBuilder {
    readonly actions = new Map<string, () => void>();
    private seq = 0;

    entry(label: string, icon: string | undefined, run: () => void, separatorBefore = false): MenuItemDescriptor {
        const id = this.next();
        this.actions.set(id, run);
        return { id, label, icon, separatorBefore };
    }

    submenu(label: string, icon: string | undefined, submenu: readonly MenuItemDescriptor[], separatorBefore = false): MenuItemDescriptor {
        return { id: this.next(), label, icon, submenu, separatorBefore };
    }

    private next(): string {
        this.seq += 1;
        return `ot${this.seq}`;
    }
}

export class ObjectTree extends SidePanel {
    private chart: Vela | null = null;
    /** What the CHART has selected — every member of a multi-selection, mirrored as rows. */
    private selectedDrawings = new Set<string>();
    private symbolName = '';
    /** The raw (possibly venue-prefixed) symbol — what icon resolution routes on. */
    private symbolRaw = '';
    /** Drawing bundles — a view-side grouping, held for the panel's lifetime and never persisted.
     *  Kept per chart because a workspace points this one panel at whichever chart is active, and
     *  each chart's bundles have to survive the switch. */
    private readonly groupsPerChart = new WeakMap<Vela, DrawGroup[]>();
    /** Group ids currently folded shut. Ids are never reused, so entries left behind by a group
     *  that is gone are inert and can outlive it. */
    private collapsed = new Set<string>();
    /** Drawings picked IN THE PANEL — what the selection bar and "group selection" act on. */
    private picked = new Set<string>();
    /** The group showing its rename field, if any. */
    private renaming: string | null = null;
    /** Set while the panel pushes its pick to the chart, so the `drawing:selected` that comes
     *  back is recognised as our own echo instead of a fresh chart-side selection. */
    private syncingSelection = false;
    private groupSeq = 0;
    private unsubs: Array<() => void> = [];

    private get groups(): DrawGroup[] {
        return (this.chart === null ? undefined : this.groupsPerChart.get(this.chart)) ?? [];
    }

    private set groups(next: DrawGroup[]) {
        if (this.chart) this.groupsPerChart.set(this.chart, next);
    }
    /** The last render's model, kept so a right-click reads the same state the rows show. */
    private pass: Pass | null = null;
    private menu: Menu | null = null;
    private menuActions = new Map<string, () => void>();
    private drag: DragSession | null = null;

    constructor(
        host: HTMLElement,
        /** The price row's avatar icon URL for a raw symbol — routed by the shell to the
         *  owning provider's `resolveSymbolIcon`. Absent ⇒ the initials badge. */
        private readonly iconFor?: (symbol: string) => string | undefined,
    ) {
        super(host, 'Object tree', 'vela-ot');
        injectStyles(STYLE_ID, CSS, host.ownerDocument);

        this.body.addEventListener('contextmenu', (e) => this.onContextMenu(e));
        this.body.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    }

    override toggle(open = this.el.hidden): void {
        super.toggle(open);
        if (open) this.refresh();
    }

    setSymbol(symbol: string): void {
        // Bare ticker — the tree labels the price series, not its routing venue. The
        // RAW form is kept beside it: icon resolution routes through the venue.
        this.symbolRaw = symbol;
        this.symbolName = parseSymbol(symbol).ticker;
    }

    /** (Re)bind to a chart instance — called after every widget rebuild. */
    onChart(chart: Vela): void {
        this.detach();
        this.chart = chart;
        for (const ev of REFRESH_EVENTS) {
            this.unsubs.push(chart.on(ev, () => this.refresh()));
        }
        // Selection both stores and repaints, in that order: a refresh triggered before the id
        // is recorded would paint the previous selection and never come back to fix it.
        this.unsubs.push(
            chart.on('drawing:selected', ({ ids }) => {
                this.selectedDrawings = new Set(ids);
                // A selection made on the chart takes over the panel's pick — all of it, so a
                // marquee or Ctrl-click selection on the chart lights up every row it covers. Our
                // own echo does not, or pushing a pick would just replace it with itself mid-render.
                if (!this.syncingSelection) this.picked = new Set(ids);
                this.refresh();
            }),
        );
        this.refresh();
    }

    override destroy(): void {
        this.detach();
        this.endDrag(false); // a drag in flight has nothing left to drop onto
        this.menu?.destroy();
        this.menu = null;
        super.destroy();
    }

    private detach(): void {
        for (const u of this.unsubs) u();
        this.unsubs = [];
        this.chart = null;
    }

    /** Read the chart into the layout's input. Every chart query happens here, once a pass. */
    private snapshot(chart: Vela, handle: (id: string) => IndicatorHandle | undefined): TreeSnapshot {
        const stackable = chart.renderer.supports('seriesOrder') && chart.renderer.supports('candleZOrder');
        return {
            panes: chart.panes.list(),
            indicatorVisible: (id) => handle(id)?.visible !== false,
            handleTitle: (id) => handle(id)?.title,
            stackable,
            interleave: stackable && chart.drawings.supported && chart.renderer.capabilities.drawingDepth === true,
            zOrder: stackable ? ((chart.renderer.get('seriesOrder') as Array<{ id: string; z: number }> | undefined) ?? []) : [],
            candleZ: stackable ? Number(chart.renderer.get('candleZOrder')) || 0 : 0,
            priceLabel: this.symbolName || 'Price',
            priceVisible: chart.renderer.get('candleVisible') !== false,
            drawings: chart.drawings.supported ? chart.drawings.all() : [],
            groups: this.groups,
        };
    }

    /**
     * Repaint because something changed — unless the panel is mid-interaction. A live drag
     * resolves drops against the rows as currently rendered, and a rename lives in an input
     * that a repaint would destroy mid-word. Both end by painting themselves.
     */
    private refresh(): void {
        if (this.drag?.active === true || this.renaming !== null) return;
        this.render();
    }

    private render(): void {
        if (this.el.hidden || !this.chart) return;
        const chart = this.chart;
        this.prune(chart);
        const byId = new Map(chart.indicators().map((h) => [h.id, h]));
        const snap = this.snapshot(chart, (id) => byId.get(id));
        const panes = buildTree(snap);
        const pass: Pass = { chart, handle: (id) => byId.get(id), stackable: snap.stackable, repanable: chart.panes.supported, interleave: snap.interleave, panes };
        this.pass = pass;
        this.body.replaceChildren();

        const doc = this.el.ownerDocument;
        this.body.appendChild(this.selectionBar(pass));
        panes.forEach((pane, i) => {
            // Never a band above the first block — the price pane stays pinned to the top.
            if (i > 0) this.body.appendChild(this.gapEl(pass, panes[i - 1]!.id, pane.id));
            this.body.appendChild(this.paneBlock(pass, pane));
        });
        // A band below the last block opens a pane at the bottom.
        const last = panes[panes.length - 1];
        if (last && pass.repanable) this.body.appendChild(this.gapEl(pass, last.id, undefined));

        if (treeIsEmpty(panes)) {
            const empty = doc.createElement('div');
            empty.className = 'vela-ot-empty';
            empty.textContent = 'Add an indicator or a drawing to populate the tree';
            this.body.appendChild(empty);
        }
    }

    /** What the panel itself can do to the selected drawings: bundle them into a group, or
     *  duplicate all of them. Always in place, dim until there is a selection to act on. */
    private selectionBar(pass: Pass): HTMLElement {
        const doc = this.el.ownerDocument;
        const bar = doc.createElement('div');
        bar.className = 'vela-ot-selbar';
        const ids = [...this.picked];
        const groupable = canGroup(ids, this.groups);
        bar.appendChild(
            this.btn({
                icon: 'group',
                title: ids.length === 0 ? 'Group the selected drawings' : groupable ? `Group ${ids.length === 1 ? 'this drawing' : 'these drawings'}` : 'Already in a group',
                disabled: !groupable,
                run: () => this.makeGroup(ids),
            }),
        );
        bar.appendChild(
            this.btn({
                icon: 'clone',
                title: ids.length === 0 ? 'Duplicate the selected drawings' : 'Duplicate',
                disabled: ids.length === 0,
                run: () => {
                    for (const id of ids) this.cloneInto(pass, id);
                    this.render();
                },
            }),
        );
        const count = doc.createElement('span');
        count.className = 'vela-ot-selcount';
        count.textContent = ids.length > 1 ? `${ids.length} selected` : '';
        bar.appendChild(count);
        return bar;
    }

    /** The band between two pane blocks. With re-paning available it is a drop zone that opens
     *  a fresh pane there; otherwise it is just the separator. `before`/`after` name the panes
     *  it sits between (either end is open at the edges of the list). */
    private gapEl(pass: Pass, after: string | undefined, before: string | undefined): HTMLElement {
        const el = this.el.ownerDocument.createElement('div');
        if (!pass.repanable) {
            el.className = 'vela-ot-panesep';
            return el;
        }
        el.className = 'vela-ot-gap';
        if (before !== undefined) el.dataset.before = before;
        if (after !== undefined) el.dataset.after = after;
        return el;
    }

    /**
     * A pane, read top to bottom as front to back: ONE column holding its drawings, its
     * indicators and (in the main pane) the candles, in draw order. Every child of the stack
     * element is one slot, so a drop position is read straight off the rendered geometry.
     */
    private paneBlock(pass: Pass, pane: TreePane): HTMLElement {
        const doc = this.el.ownerDocument;
        const block = doc.createElement('div');
        block.className = 'vela-ot-pane';
        block.dataset.pane = pane.id;
        block.dataset.kind = pane.kind;
        block.appendChild(this.paneHead(pass, pane));
        const stack = doc.createElement('div');
        stack.className = 'vela-ot-stack';
        for (const item of pane.items) {
            stack.appendChild(item.kind === 'row' ? this.rowEl(pass, pane, item.row) : this.unitEl(pass, pane, item.unit));
        }
        block.appendChild(stack);
        return block;
    }

    /** One top-level drawing entry: a lone drawing's row, or a group block — its header plus,
     *  unfolded, a member row for each drawing it holds. */
    private unitEl(pass: Pass, pane: TreePane, unit: DrawUnit): HTMLElement {
        const doc = this.el.ownerDocument;
        const wrap = doc.createElement('div');
        wrap.className = 'vela-ot-unit';
        if (unit.kind === 'draw') {
            wrap.appendChild(this.drawRow(pass, unit.drawing));
        } else {
            wrap.dataset.group = unit.group.id;
            wrap.appendChild(this.groupRow(pass, pane, unit.group));
            if (!this.collapsed.has(unit.group.id)) {
                for (const m of unit.members) wrap.appendChild(this.drawRow(pass, m, true));
            }
        }
        return wrap;
    }

    /** The pane's name plus its ops: a study pane can move in the stack and collapse; every
     *  pane can be maximized. */
    private paneHead(pass: Pass, pane: TreePane): HTMLElement {
        const doc = this.el.ownerDocument;
        const { chart } = pass;
        const head = doc.createElement('div');
        head.className = 'vela-ot-panehead';
        const name = doc.createElement('span');
        name.className = 'vela-ot-panename';
        name.textContent = pane.label;
        name.title = pane.label;
        head.appendChild(name);
        if (!chart.panes.supported) return head;
        const acts = doc.createElement('span');
        acts.className = 'vela-ot-acts';
        head.appendChild(acts);
        const op = (icon: string, title: string, run: () => void): void => {
            acts.appendChild(this.btn({ icon, title, run }));
        };
        if (pane.kind !== 'price') {
            if (pane.order > 1) op('arrow-up', 'Move pane up', () => chart.panes.move(pane.id, 'up'));
            if (pane.order < pass.panes.length - 1) op('arrow-down', 'Move pane down', () => chart.panes.move(pane.id, 'down'));
            op(pane.collapsed ? 'expand' : 'collapse', pane.collapsed ? 'Expand pane' : 'Collapse pane', () => chart.panes.collapse(pane.id, !pane.collapsed));
        }
        op(pane.maximized ? 'restore' : 'maximize', pane.maximized ? 'Restore panes' : 'Maximize pane', () => chart.panes.maximize(pane.maximized ? null : pane.id));
        return head;
    }

    private rowEl(pass: Pass, pane: TreePane, row: TreeRow): HTMLElement {
        const doc = this.el.ownerDocument;
        const { chart } = pass;
        if (row.kind === 'price') {
            const base = this.symbolName.replace(/[-_/]?(USDT|USDC|USD1|USDS|BUSD|USD|EUR|PERP)$/i, '') || this.symbolName;
            const icon = tickerIconEl(doc, base || 'P', this.symbolName || 'Price', 'vela-ot-avatar', this.symbolRaw ? this.iconFor?.(this.symbolRaw) : undefined);
            const el = this.row(icon, row.label, row.visible, [
                {
                    icon: row.visible ? 'eye' : 'eye-off',
                    title: row.visible ? 'Hide' : 'Show',
                    engaged: !row.visible,
                    run: () => {
                        chart.renderer.set('candleVisible', !row.visible);
                        this.refresh();
                    },
                },
            ]);
            el.dataset.rowKind = 'price';
            el.dataset.pane = pane.id;
            // The candles can only be restacked — they never leave the main pane.
            if (pass.stackable) {
                el.dataset.drag = '1';
                el.title = 'Drag to change what draws in front';
            }
            return el;
        }
        const handle = pass.handle(row.id);
        const el = this.row(
            iconEl('indicators', doc),
            row.label,
            row.visible,
            [
                {
                    icon: row.visible ? 'eye' : 'eye-off',
                    title: row.visible ? 'Hide' : 'Show',
                    engaged: !row.visible,
                    run: () => {
                        handle?.setVisible(!row.visible);
                        this.refresh();
                    },
                },
                {
                    icon: 'trash',
                    title: 'Remove',
                    run: () => {
                        handle?.remove();
                        this.refresh();
                    },
                },
            ],
            row.ownScale ? 'scale' : undefined,
        );
        el.dataset.rowKind = 'indicator';
        el.dataset.id = row.id;
        el.dataset.pane = pane.id;
        if (pass.repanable || pass.stackable) {
            el.dataset.drag = '1';
            el.title = pass.repanable ? 'Drag to another pane, or between panes for a new one' : 'Drag to change what draws in front';
        }
        return el;
    }

    /** A group's header: fold arrow, its name (or the rename field), then actions that apply to
     *  every member at once. Reports "all hidden"/"all locked" rather than a mixed state.
     *
     * The state comes from the whole bundle, not from the members listed under this pane: should
     * a member end up on another pane, the header still speaks for the group its actions affect.
     */
    private groupRow(pass: Pass, pane: TreePane, g: DrawGroup): HTMLElement {
        const doc = this.el.ownerDocument;
        const folded = this.collapsed.has(g.id);
        const members = pass.chart.drawings.all().filter((d) => g.ids.includes(d.id));
        const { allHidden, allLocked } = groupState(members);
        const ids = [...g.ids];
        const el = this.row(iconEl(folded ? 'chevron-right' : 'chevron-down', doc), g.name, !allHidden, [
            {
                icon: allLocked ? 'lock' : 'unlock',
                title: allLocked ? 'Unlock all' : 'Lock all',
                engaged: allLocked,
                run: () => this.setMembers(pass, ids, { locked: !allLocked }),
            },
            {
                icon: allHidden ? 'eye-off' : 'eye',
                title: allHidden ? 'Show all' : 'Hide all',
                engaged: allHidden,
                run: () => this.setMembers(pass, ids, { visible: allHidden }),
            },
            { icon: 'trash', title: 'Remove all', run: () => this.removeGroup(pass, g.id, true) },
        ]);
        el.dataset.rowKind = 'group';
        el.dataset.id = g.id;
        el.dataset.pane = pane.id;
        el.title = `${members.length} drawing${members.length === 1 ? '' : 's'} — drag to move them together`;
        if (this.renaming === g.id) {
            // A row being renamed is a text field, not a handle: dragging it would leave the
            // rename open with the tree frozen behind it.
            const name = el.querySelector('.vela-ot-name');
            const input = doc.createElement('input');
            input.className = 'vela-ot-rename';
            input.value = g.name;
            name?.replaceWith(input);
            // Focus after the row is in the document, or the caret has nothing to land in.
            queueMicrotask(() => {
                input.focus();
                input.select();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.commitRename(g.id, input.value);
                } else if (e.key === 'Escape') {
                    this.renaming = null;
                    this.render();
                } else if (e.key === ' ') e.stopPropagation(); // typing, not a shortcut
            });
            // Clicking away keeps what was typed, the way a rename in a file list does.
            input.addEventListener('blur', () => this.commitRename(g.id, input.value));
        } else {
            el.dataset.drag = '1';
            el.addEventListener('click', () => {
                if (folded) this.collapsed.delete(g.id);
                else this.collapsed.add(g.id);
                this.render();
            });
        }
        return el;
    }

    private drawRow(pass: Pass, d: SerializedDrawing, inGroup = false): HTMLElement {
        const doc = this.el.ownerDocument;
        const { chart } = pass;
        const markup = drawingMeta(d.type).icon;
        let icon: HTMLElement;
        if (markup) {
            icon = doc.createElement('span');
            icon.className = 'vela-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.innerHTML = markup;
        } else {
            icon = iconEl('pen', doc);
        }
        const el = this.row(icon, drawingLabel(d), d.visible, [
            {
                icon: d.locked ? 'lock' : 'unlock',
                title: d.locked ? 'Unlock' : 'Lock',
                engaged: d.locked,
                run: () => {
                    chart.drawings.lock(d.id, !d.locked);
                    this.refresh();
                },
            },
            {
                icon: d.visible ? 'eye' : 'eye-off',
                title: d.visible ? 'Hide' : 'Show',
                engaged: !d.visible,
                run: () => {
                    chart.drawings.show(d.id, !d.visible);
                    this.refresh();
                },
            },
            {
                icon: 'trash',
                title: 'Remove',
                run: () => {
                    chart.drawings.remove(d.id);
                    this.refresh();
                },
            },
        ]);
        el.dataset.rowKind = 'drawing';
        el.dataset.id = d.id;
        el.dataset.pane = d.paneId;
        el.dataset.drag = '1';
        el.title = 'Drag to restack, or onto another pane to move it there';
        if (inGroup) el.classList.add('vela-ot-subrow');
        if (this.selectedDrawings.has(d.id)) el.dataset.selected = '1';
        if (this.picked.has(d.id)) el.dataset.picked = '1';
        el.addEventListener('click', (e) => this.onDrawClick(e, d.id));
        return el;
    }

    /** Clicking a drawing picks it; holding the platform's modifier extends the pick, and
     *  clicking the only picked row clears it. The chart mirrors whatever comes out. */
    private onDrawClick(e: MouseEvent, id: string): void {
        if (e.ctrlKey || e.metaKey) {
            if (this.picked.has(id)) this.picked.delete(id);
            else this.picked.add(id);
        } else if (this.picked.has(id) && this.picked.size === 1) {
            this.picked.clear();
        } else {
            this.picked.clear();
            this.picked.add(id);
        }
        this.selectOnChart([...this.picked]);
        this.render();
    }

    /** Push the panel's pick onto the chart, muting the `drawing:selected` echo it causes. */
    private selectOnChart(ids: readonly string[]): void {
        const chart = this.chart;
        if (!chart?.drawings.supported) return;
        this.syncingSelection = true;
        try {
            chart.drawings.select(ids);
        } finally {
            this.syncingSelection = false;
        }
    }

    /** The shared row shell: icon, name, optional tag, then the action buttons. */
    private row(icon: HTMLElement, label: string, visible: boolean, actions: readonly RowAction[], tag?: string): HTMLElement {
        const doc = this.el.ownerDocument;
        const el = doc.createElement('div');
        el.className = 'vela-ot-row';
        if (!visible) el.dataset.hidden = '1';
        const name = doc.createElement('span');
        name.className = 'vela-ot-name';
        name.textContent = label;
        name.title = label;
        el.append(icon, name);
        if (tag) {
            const t = doc.createElement('span');
            t.className = 'vela-ot-tag';
            t.textContent = tag;
            t.title = 'Draws against its own price scale';
            el.appendChild(t);
        }
        const acts = doc.createElement('span');
        acts.className = 'vela-ot-acts';
        for (const a of actions) acts.appendChild(this.btn(a));
        el.appendChild(acts);
        return el;
    }

    private btn(a: RowAction): HTMLButtonElement {
        const doc = this.el.ownerDocument;
        const b = doc.createElement('button');
        b.className = 'vela-ot-btn';
        b.dataset.icon = a.icon;
        if (a.engaged) b.dataset.engaged = '1';
        if (a.disabled) b.disabled = true;
        b.title = a.title;
        b.appendChild(iconEl(a.icon, doc));
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!a.disabled) a.run();
        });
        return b;
    }

    // ── groups ─────────────────────────────────────────────────────────────
    // A group is the panel's own idea, not the chart's: it bundles drawings so they hide, lock,
    // delete and move as one. It lives as long as the panel does.

    /** Bundle drawings into a fresh group, which takes over the pick. */
    private makeGroup(ids: readonly string[]): void {
        if (!canGroup(ids, this.groups)) return;
        this.groupSeq += 1;
        this.groups = [...this.groups, { id: `grp-${this.groupSeq}`, name: nextGroupName(this.groups), ids: [...ids] }];
        this.picked.clear();
        this.render();
    }

    private commitRename(id: string, value: string): void {
        // Both Enter and losing focus land here, and one rename can raise both.
        if (this.renaming !== id) return;
        const name = value.trim();
        this.groups = this.groups.map((g) => (g.id === id && name !== '' ? { ...g, name } : g));
        this.renaming = null;
        this.render();
    }

    /** Dissolve a group. `withMembers` also deletes the drawings it held. */
    private removeGroup(pass: Pass, id: string, withMembers: boolean): void {
        const g = this.groups.find((x) => x.id === id);
        this.groups = this.groups.filter((x) => x.id !== id);
        this.collapsed.delete(id);
        if (withMembers && g) {
            for (const m of g.ids) this.picked.delete(m);
            pass.chart.drawings.removeMany(g.ids);
        }
        this.render();
    }

    /** Apply one patch to every member of a group as a single undo step. */
    private setMembers(pass: Pass, ids: readonly string[], patch: Partial<SerializedDrawing>): void {
        if (ids.length === 0) return;
        pass.chart.drawings.updateMany(ids.map((id) => ({ id, patch })));
        this.render();
    }

    /** Duplicate a drawing, keeping the copy in the same group as its original — the chart has
     *  no notion of our groups, so the new id has to be spotted and filed here. */
    private cloneInto(pass: Pass, id: string): void {
        const { chart } = pass;
        if (!chart.drawings.supported) return;
        const before = new Set(chart.drawings.all().map((d) => d.id));
        chart.drawings.clone(id);
        const clone = chart.drawings.all().find((d) => !before.has(d.id));
        const g = groupOf(this.groups, id);
        if (g && clone) this.groups = assignToGroup(this.groups, g.id, [clone.id]);
    }

    // ── drag-and-drop ──────────────────────────────────────────────────────
    // Indicator rows move between panes, into a fresh pane, or to a slot in the main pane's
    // stack. The candles restack in place. Drawing rows take a slot among their pane's
    // drawings, and land in another pane's list to move there.

    private onPointerDown(e: PointerEvent): void {
        if (e.button !== 0 || this.drag) return;
        const target = e.target as HTMLElement;
        // Row and pane-head buttons are controls, not drag handles.
        if (target.closest('.vela-ot-btn')) return;
        const rowEl = target.closest<HTMLElement>('.vela-ot-row[data-drag]');
        if (!rowEl) return;
        // The rename field is a text field, not a drag handle.
        if (target.closest('.vela-ot-rename')) return;
        const kind = rowEl.dataset.rowKind;
        if (kind !== 'price' && kind !== 'indicator' && kind !== 'drawing' && kind !== 'group') return;
        const win = this.el.ownerDocument.defaultView;
        if (!win) return;
        const drag: DragSession = {
            kind,
            id: rowEl.dataset.id ?? null,
            fromPane: rowEl.dataset.pane ?? PRICE_PANE_ID,
            label: rowEl.querySelector('.vela-ot-name')?.textContent ?? 'object',
            startX: e.clientX,
            startY: e.clientY,
            active: false,
            ghost: null,
            drop: null,
            onMove: (ev) => this.onDragMove(ev),
            onUp: () => this.endDrag(true),
            onCancel: () => this.endDrag(false),
        };
        this.drag = drag;
        win.addEventListener('pointermove', drag.onMove);
        win.addEventListener('pointerup', drag.onUp);
        win.addEventListener('pointercancel', drag.onCancel);
        e.preventDefault(); // no text selection while dragging a row
    }

    private onDragMove(e: PointerEvent): void {
        const drag = this.drag;
        if (!drag) return;
        if (!drag.active) {
            if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_SLOP) return;
            this.beginDrag(drag);
        }
        if (drag.ghost) {
            drag.ghost.style.left = `${e.clientX + 12}px`;
            drag.ghost.style.top = `${e.clientY + 8}px`;
        }
        drag.drop = this.resolveDrop(drag, e.clientX, e.clientY);
        this.paintDropHint(drag.drop);
    }

    private beginDrag(drag: DragSession): void {
        drag.active = true;
        this.body.dataset.dragging = '1';
        const src = this.sourceRow(drag);
        if (src) src.dataset.source = '1';
        const ghost = this.el.ownerDocument.createElement('div');
        ghost.className = 'vela-ot-ghost';
        ghost.textContent = drag.label;
        // Inside the theme host: a ghost parked on <body> resolves its tokens to nothing.
        this.uiHost().appendChild(ghost);
        drag.ghost = ghost;
    }

    /** The rendered row a session started from — scanned rather than selected, so an id
     *  carrying CSS-special characters needs no escaping. */
    private sourceRow(drag: DragSession): HTMLElement | null {
        for (const el of this.body.querySelectorAll<HTMLElement>('.vela-ot-row')) {
            if (el.dataset.rowKind !== drag.kind) continue;
            if (drag.id === null || el.dataset.id === drag.id) return el;
        }
        return null;
    }

    /** What a drop at this point would do. Measured off the live geometry, which is why a
     *  refresh is suspended for the duration of the drag. */
    private resolveDrop(drag: DragSession, x: number, y: number): Drop | null {
        const pass = this.pass;
        if (!pass) return null;
        // The new-pane bands win: they are deliberately thin and sit between the blocks, so
        // testing them first keeps them reachable.
        if (drag.kind === 'indicator') {
            for (const gap of this.body.querySelectorAll<HTMLElement>('.vela-ot-gap')) {
                const r = gap.getBoundingClientRect();
                if (y >= r.top - 4 && y <= r.bottom + 4 && x >= r.left && x <= r.right) {
                    return { kind: 'newPane', before: gap.dataset.before, after: gap.dataset.after, el: gap };
                }
            }
        }
        for (const block of this.body.querySelectorAll<HTMLElement>('.vela-ot-pane')) {
            const r = block.getBoundingClientRect();
            if (y < r.top || y > r.bottom) continue;
            const paneId = block.dataset.pane ?? PRICE_PANE_ID;
            // The candles never leave the main pane; an indicator on a renderer without editable
            // stacking can only join a pane whole.
            if (drag.kind === 'price' && block.dataset.kind !== 'price') return null;
            if (drag.kind === 'indicator' && !pass.stackable) {
                return paneId === drag.fromPane ? null : { kind: 'merge', paneId, el: block };
            }
            const els = [...(block.querySelector<HTMLElement>(':scope > .vela-ot-stack')?.children ?? [])] as HTMLElement[];
            // A lone drawing held over a group's block joins that group — anywhere else in the
            // column it stays (or becomes) loose. A whole group only ever drops at the top level.
            if (drag.kind === 'drawing') {
                for (const unit of els) {
                    const groupId = unit.dataset.group;
                    if (groupId === undefined) continue;
                    const ur = unit.getBoundingClientRect();
                    if (y < ur.top || y > ur.bottom) continue;
                    const subrows = [...unit.querySelectorAll<HTMLElement>(':scope > .vela-ot-subrow')];
                    return { kind: 'intoGroup', paneId, groupId, memberSlot: insertionSlot(subrows, y), subrows, el: unit };
                }
            }
            let slot = insertionSlot(els, y);
            // Without a shared draw-order space every drawing paints over the series, so its
            // slots stop at the leading drawings — the column can't promise an interleave the
            // renderer won't honor.
            if ((drag.kind === 'drawing' || drag.kind === 'group') && !pass.interleave) {
                const pane = pass.panes.find((p) => p.id === paneId);
                const lead = pane ? pane.items.findIndex((it) => it.kind === 'row') : -1;
                if (lead >= 0) slot = Math.min(slot, lead);
            }
            return { kind: 'slot', paneId, slot, els, el: block };
        }
        return null;
    }

    private paintDropHint(drop: Drop | null): void {
        for (const el of this.body.querySelectorAll<HTMLElement>('[data-drop]')) delete el.dataset.drop;
        if (!drop) return;
        if (drop.kind === 'newPane') {
            drop.el.dataset.drop = 'gap';
            return;
        }
        if (drop.kind === 'merge') {
            drop.el.dataset.drop = 'target';
            return;
        }
        if (drop.kind === 'intoGroup') {
            // The group outlines to say "this is what you are joining", and a line inside says
            // where among its members.
            drop.el.dataset.drop = 'target';
            const at = drop.subrows[drop.memberSlot];
            if (at) at.dataset.drop = 'before';
            else if (drop.subrows.length > 0) drop.subrows[drop.subrows.length - 1]!.dataset.drop = 'after';
            return;
        }
        // A slot drop draws a line at the insertion point — or outlines the whole block when
        // there is nothing to draw a line against.
        const at = drop.els[drop.slot];
        if (drop.els.length === 0) drop.el.dataset.drop = 'target';
        else if (at) at.dataset.drop = 'before';
        else drop.els[drop.els.length - 1]!.dataset.drop = 'after';
    }

    /** Close the session out: `apply` false abandons the move (a cancelled pointer, a teardown). */
    private endDrag(apply: boolean): void {
        const drag = this.drag;
        this.drag = null;
        if (!drag) return;
        const win = this.el.ownerDocument.defaultView;
        win?.removeEventListener('pointermove', drag.onMove);
        win?.removeEventListener('pointerup', drag.onUp);
        win?.removeEventListener('pointercancel', drag.onCancel);
        // A press that never crossed the threshold is a plain click. Leave the DOM as it is so
        // the click that follows still lands on its row — re-rendering here would detach it and
        // silently swallow selecting a drawing.
        if (!drag.active) return;
        drag.ghost?.remove();
        delete this.body.dataset.dragging;
        const src = this.sourceRow(drag);
        if (src) delete src.dataset.source;
        this.paintDropHint(null);
        if (apply && drag.drop) this.applyDrop(drag, drag.drop);
        this.refresh();
    }

    private applyDrop(drag: DragSession, drop: Drop): void {
        const pass = this.pass;
        if (!pass) return;
        const { chart } = pass;
        switch (drop.kind) {
            case 'merge':
                if (drag.id !== null && drop.paneId !== drag.fromPane) {
                    chart.panes.moveIndicator(drag.id, drop.paneId === PRICE_PANE_ID ? 'price' : { pane: drop.paneId });
                }
                return;
            case 'newPane': {
                // An indicator alone in its own pane, dropped on a band touching that pane, has
                // nowhere new to go: the "new" pane would be the one it is already in, rebuilt.
                const from = pass.panes.find((p) => p.id === drag.fromPane);
                const alone = from !== undefined && from.kind !== 'price' && paneRows(from).length <= 1;
                if (alone && (drop.before === drag.fromPane || drop.after === drag.fromPane)) return;
                if (drag.id !== null) chart.panes.moveIndicator(drag.id, { newPane: { before: drop.before, after: drop.after } });
                return;
            }
            case 'slot':
            case 'intoGroup':
                this.applySlotDrop(pass, drag, drop);
                return;
        }
    }

    /**
     * Land a drop in a pane's stack: place the dragged tokens (the candles, an indicator, a
     * drawing, or a group's whole run of drawings) at the measured position, then renormalize
     * the pane's z keys in one sweep — `candleZOrder`/`seriesOrder` for the series, a single
     * `updateMany` (one undo step) for the drawings, re-paning the ones that crossed panes.
     */
    private applySlotDrop(pass: Pass, drag: DragSession, drop: Extract<Drop, { kind: 'slot' | 'intoGroup' }>): void {
        const { chart } = pass;
        const target = pass.panes.find((p) => p.id === drop.paneId);
        if (!target) return;
        const isDrawing = drag.kind === 'drawing' || drag.kind === 'group';
        if (isDrawing && !chart.drawings.supported) return;
        const dragged: StackToken[] =
            drag.kind === 'price'
                ? [{ kind: 'price' }]
                : drag.kind === 'indicator'
                  ? [{ kind: 'indicator', id: drag.id! }]
                  : this.draggedDrawings(pass, drag).map((id) => ({ kind: 'drawing' as const, id }));
        if (dragged.length === 0 || (drag.kind !== 'price' && drag.id === null)) return;
        // An indicator arriving from another pane moves there first; the restack below then
        // assigns its slot. (Drawings re-pane through their own patch instead.)
        if (drag.kind === 'indicator' && drag.fromPane !== drop.paneId) {
            chart.panes.moveIndicator(drag.id!, drop.paneId === PRICE_PANE_ID ? 'price' : { pane: drop.paneId });
        }
        const tokens = paneTokens(target);
        const at = drop.kind === 'intoGroup' ? groupTokenIndex(target, drop.groupId, drop.memberSlot) : tokenIndexOfSlot(target, drop.slot);
        const placed = placeTokens(tokens, dragged, at);
        // Group bookkeeping for a lone drawing: dropped on a group it joins it; dropped at the
        // top level it leaves whatever group held it.
        if (drag.kind === 'drawing') {
            this.groups = drop.kind === 'intoGroup' ? assignToGroup(this.groups, drop.groupId, [drag.id!]) : removeFromGroups(this.groups, [drag.id!]);
        }
        const live = new Map(chart.drawings.all().map((d) => [d.id, d]));
        const draggedIds = new Set(dragged.flatMap((t) => (t.kind === 'drawing' ? [t.id] : [])));
        const repaned = [...draggedIds].some((id) => live.get(id)?.paneId !== drop.paneId);
        // A drag that changes nothing should not cost an undo step — its only effect may have
        // been the group membership just recorded.
        if (tokensEqual(tokens, placed) && !repaned) return;
        this.writeStack(pass, drop.paneId, placed, draggedIds);
    }

    /** Renormalize one pane's z keys from a placed token stack: the series through the
     *  renderer's order settings, the drawings as ONE `updateMany` (a single undo step),
     *  re-paning the dragged ones that arrived from another pane. */
    private writeStack(pass: Pass, paneId: string, placed: readonly StackToken[], draggedIds: ReadonlySet<string>): void {
        const { chart } = pass;
        const live = new Map(chart.drawings.all().map((d) => [d.id, d]));
        const writes = stackWrites(placed);
        if (pass.stackable) {
            if (writes.candleZ !== null) chart.renderer.set('candleZOrder', writes.candleZ);
            for (const s of writes.series) chart.renderer.set('seriesOrder', { id: s.id, z: s.z });
        }
        if (writes.drawings.length > 0) {
            chart.drawings.updateMany(
                writes.drawings.map(({ id, z }) => ({
                    id,
                    patch: { zIndex: z, ...(draggedIds.has(id) && live.get(id)?.paneId !== paneId ? { paneId } : {}) },
                })),
            );
        }
    }

    /** Move a group's whole run to an end of its pane's stack — the menu twin of dragging it
     *  to the top or the bottom of the column. */
    private restackGroup(pass: Pass, g: DrawGroup, edge: 'front' | 'back'): void {
        const member = new Set(g.ids);
        const mine = pass.chart.drawings.all().filter((d) => member.has(d.id));
        const paneId = mine[0]?.paneId ?? PRICE_PANE_ID;
        // Orphaned drawings fold into the price pane's block, so the fallback matches the render.
        const target = pass.panes.find((p) => p.id === paneId) ?? pass.panes.find((p) => p.kind === 'price');
        if (!target || mine.length === 0) return;
        const dragged: StackToken[] = mine.map((d) => ({ kind: 'drawing' as const, id: d.id })).reverse(); // front-first
        const tokens = paneTokens(target);
        const placed = placeTokens(tokens, dragged, edge === 'front' ? 0 : tokens.length);
        if (tokensEqual(tokens, placed)) return;
        this.writeStack(pass, target.id, placed, new Set());
        this.refresh();
    }

    /** The drawings a session moves: a group carries every member, front-most first, so the
     *  bundle keeps its own stacking wherever it lands. */
    private draggedDrawings(pass: Pass, drag: DragSession): string[] {
        if (drag.id === null) return [];
        if (drag.kind !== 'group') return [drag.id];
        const g = this.groups.find((x) => x.id === drag.id);
        if (!g) return [];
        const member = new Set(g.ids);
        // `all()` reports paint order (back to front); everything here works front-first.
        return pass.chart.drawings
            .all()
            .filter((d) => member.has(d.id))
            .map((d) => d.id)
            .reverse();
    }

    // ── context menus ──────────────────────────────────────────────────────
    // Right-clicking a row opens the same actions its buttons expose, plus the ones with no
    // room on a row: re-paning an indicator, and reordering what draws in front.

    private onContextMenu(e: MouseEvent): void {
        const pass = this.pass;
        if (!pass) return;
        const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.vela-ot-row');
        if (!rowEl) return;
        e.preventDefault();
        const b = new MenuBuilder();
        const items = this.itemsForRow(b, pass, rowEl);
        if (items.length === 0) return;
        this.menuActions = b.actions;
        const menu = this.ensureMenu();
        menu.setItems(items);
        menu.openAt(e.clientX, e.clientY);
    }

    private itemsForRow(b: MenuBuilder, pass: Pass, rowEl: HTMLElement): MenuItemDescriptor[] {
        const paneId = rowEl.dataset.pane ?? PRICE_PANE_ID;
        const id = rowEl.dataset.id;
        switch (rowEl.dataset.rowKind) {
            case 'price':
                return this.priceMenu(b, pass);
            case 'indicator': {
                const row = id === undefined ? undefined : this.findIndicatorRow(pass, id);
                return row ? this.indicatorMenu(b, pass, row, paneId) : [];
            }
            case 'drawing': {
                const d = id === undefined ? undefined : pass.chart.drawings.all().find((x) => x.id === id);
                return d ? this.drawingMenu(b, pass, d) : [];
            }
            case 'group': {
                const g = id === undefined ? undefined : this.groups.find((x) => x.id === id);
                return g ? this.groupMenu(b, pass, g) : [];
            }
            default:
                return [];
        }
    }

    /** The nearest kit host, which is where anything floating has to mount: outside it the
     *  theme's custom properties don't resolve and the surface renders unstyled. */
    private uiHost(): HTMLElement {
        return (this.el.closest('.vela-ui') as HTMLElement | null) ?? this.el;
    }

    /** The menu, built on first use — by then the panel is mounted, so the theme host resolves. */
    private ensureMenu(): Menu {
        if (!this.menu) {
            this.menu = new Menu({ host: this.uiHost(), items: [], onSelect: (id) => this.menuActions.get(id)?.() });
        }
        return this.menu;
    }

    private findIndicatorRow(pass: Pass, id: string): IndicatorRow | undefined {
        for (const pane of pass.panes) {
            for (const row of paneRows(pane)) if (row.kind === 'indicator' && row.id === id) return row;
        }
        return undefined;
    }

    private priceMenu(b: MenuBuilder, pass: Pass): MenuItemDescriptor[] {
        const { chart } = pass;
        const visible = chart.renderer.get('candleVisible') !== false;
        const items = [
            b.entry(visible ? 'Hide' : 'Show', visible ? 'eye-off' : 'eye', () => {
                chart.renderer.set('candleVisible', !visible);
                this.refresh();
            }),
        ];
        if (pass.stackable) {
            items.push(
                b.entry('Bring to front', 'arrow-up', () => {
                    chart.renderer.set('candleZOrder', this.stackBounds(pass, PRICE_PANE_ID).top + 1);
                    this.refresh();
                }, true),
            );
            items.push(
                b.entry('Send to back', 'arrow-down', () => {
                    chart.renderer.set('candleZOrder', this.stackBounds(pass, PRICE_PANE_ID).bottom - 1);
                    this.refresh();
                }),
            );
        }
        return items;
    }

    /** The pane's stacking extremes as of now — what a front/back command has to beat. The z
     *  keys are plain numbers, not commands, so the writer beats the extremes itself; with a
     *  shared draw-order space the drawings' keys count too. */
    private stackBounds(pass: Pass, paneId: string): { top: number; bottom: number } {
        const { chart } = pass;
        const drawingZ = pass.interleave
            ? chart.drawings
                  .all()
                  .filter((d) => d.paneId === paneId)
                  .map((d) => d.zIndex)
            : [];
        return zStackBounds(
            ((chart.renderer.get('seriesOrder') as Array<{ id: string; z: number }> | undefined) ?? []),
            Number(chart.renderer.get('candleZOrder')) || 0,
            drawingZ,
        );
    }

    private indicatorMenu(b: MenuBuilder, pass: Pass, row: IndicatorRow, paneId: string): MenuItemDescriptor[] {
        const { chart } = pass;
        const handle = pass.handle(row.id);
        const items = [
            b.entry(row.visible ? 'Hide' : 'Show', row.visible ? 'eye-off' : 'eye', () => {
                handle?.setVisible(!row.visible);
                this.refresh();
            }),
        ];
        // The legend gear's twin — reachable here even where the legend is folded away
        // (mobile) or replaced by the overview chip (multi-chart grids).
        if (chart.renderer.supportsIndicatorSettings) {
            items.push(b.entry('Indicator settings', 'gear', () => chart.renderer.openIndicatorSettings(row.id)));
        }
        if (chart.panes.supported) {
            const moves = this.moveItems(b, pass, row.id, paneId);
            if (moves.length > 0) items.push(b.submenu('Move to', 'move-vertical', moves));
        }
        if (pass.stackable) {
            items.push(b.entry('Bring to front', 'arrow-up', () => chart.renderer.set('seriesOrder', { id: row.id, z: this.stackBounds(pass, paneId).top + 1 }), true));
            items.push(b.entry('Send to back', 'arrow-down', () => chart.renderer.set('seriesOrder', { id: row.id, z: this.stackBounds(pass, paneId).bottom - 1 })));
        }
        items.push(
            b.entry('Remove', 'trash', () => {
                handle?.remove();
                this.refresh();
            }, true),
        );
        return items;
    }

    /** "Move to …" entries for an indicator — only the moves that would change something. */
    private moveItems(b: MenuBuilder, pass: Pass, id: string, fromPane: string): MenuItemDescriptor[] {
        const { chart } = pass;
        const items: MenuItemDescriptor[] = [];
        for (const p of pass.panes) {
            if (p.id === fromPane) continue;
            items.push(b.entry(p.label, undefined, () => chart.panes.moveIndicator(id, p.kind === 'price' ? 'price' : { pane: p.id })));
        }
        // An indicator alone in its own study pane has nowhere new to go: a fresh pane would
        // just be the pane it already has.
        const current = pass.panes.find((p) => p.id === fromPane);
        const alone = current !== undefined && current.kind !== 'price' && paneRows(current).length <= 1;
        if (!alone) {
            if (fromPane !== PRICE_PANE_ID) items.push(b.entry('New pane above', undefined, () => chart.panes.moveIndicator(id, { newPane: { before: fromPane } })));
            items.push(b.entry('New pane below', undefined, () => chart.panes.moveIndicator(id, { newPane: { after: fromPane } })));
        }
        return items;
    }

    private drawingMenu(b: MenuBuilder, pass: Pass, d: SerializedDrawing): MenuItemDescriptor[] {
        const { chart } = pass;
        const items = [
            b.entry(d.visible ? 'Hide' : 'Show', d.visible ? 'eye-off' : 'eye', () => {
                chart.drawings.show(d.id, !d.visible);
                this.refresh();
            }),
            b.entry(d.locked ? 'Unlock' : 'Lock', d.locked ? 'unlock' : 'lock', () => {
                chart.drawings.lock(d.id, !d.locked);
                this.refresh();
            }),
            b.entry('Duplicate', 'clone', () => {
                this.cloneInto(pass, d.id);
                this.render();
            }),
            // Front/back clear the WHOLE stack on a shared-z renderer — over or under the
            // candles and every indicator, not just the other drawings.
            b.entry('Bring to front', 'arrow-up', () => chart.drawings.bringToFront(d.id), true),
            b.entry('Send to back', 'arrow-down', () => chart.drawings.sendToBack(d.id)),
        ];
        items.push(...this.groupingItems(b, d.id));
        items.push(b.entry('Remove', 'trash', () => chart.drawings.remove(d.id), true));
        return items;
    }

    /** The grouping half of a drawing's menu: what it can do about the bundle it is (or isn't)
     *  part of. Only the moves that mean something for this row are offered. */
    private groupingItems(b: MenuBuilder, id: string): MenuItemDescriptor[] {
        const items: MenuItemDescriptor[] = [];
        const mine = groupOf(this.groups, id);
        // A right-click inside a multi-pick acts on the whole pick; on a row outside it, just
        // that row — same rule the platform's file managers use.
        const pick = this.picked.has(id) && this.picked.size > 1 ? [...this.picked] : null;
        if (pick && canGroup(pick, this.groups)) {
            items.push(b.entry(`Group selection (${pick.length})`, 'group', () => this.makeGroup(pick), true));
        } else if (!pick && mine === null) {
            items.push(b.entry('New group', 'group', () => this.makeGroup([id]), true));
        }
        const others = this.groups.filter((g) => g.id !== mine?.id);
        if (!pick && others.length > 0) {
            items.push(
                b.submenu(
                    mine === null ? 'Add to group' : 'Move to group',
                    'folder-plus',
                    others.map((g) =>
                        b.entry(g.name, undefined, () => {
                            this.groups = assignToGroup(this.groups, g.id, [id]);
                            this.render();
                        }),
                    ),
                    items.length === 0,
                ),
            );
        }
        if (mine !== null) {
            items.push(
                b.entry(`Remove from ${mine.name}`, 'folder-minus', () => {
                    this.groups = removeFromGroups(this.groups, [id]);
                    this.render();
                }, items.length === 0),
            );
        }
        return items;
    }

    private groupMenu(b: MenuBuilder, pass: Pass, g: DrawGroup): MenuItemDescriptor[] {
        const ids = [...g.ids];
        const members = pass.chart.drawings.all().filter((d) => g.ids.includes(d.id));
        const { allHidden, allLocked } = groupState(members);
        const items = [
            b.entry('Rename…', 'pen', () => {
                this.renaming = g.id;
                this.render();
            }),
            b.entry(allHidden ? 'Show all' : 'Hide all', allHidden ? 'eye' : 'eye-off', () => this.setMembers(pass, ids, { visible: allHidden }), true),
            b.entry(allLocked ? 'Unlock all' : 'Lock all', allLocked ? 'unlock' : 'lock', () => this.setMembers(pass, ids, { locked: !allLocked })),
            b.entry('Select all', 'group', () => {
                this.picked = new Set(ids);
                this.selectOnChart(ids);
                this.render();
            }),
        ];
        // The whole bundle moves to an end of its pane's stack — over or under the candles and
        // every indicator — as one contiguous run, keeping its internal order.
        if (members.length > 0) {
            items.push(b.entry('Bring all to front', 'arrow-up', () => this.restackGroup(pass, g, 'front')));
            items.push(b.entry('Send all to back', 'arrow-down', () => this.restackGroup(pass, g, 'back')));
        }
        // Ungrouping keeps the drawings; the group is only the panel's bookkeeping.
        items.push(b.entry('Ungroup', 'ungroup', () => this.removeGroup(pass, g.id, false), true));
        items.push(b.entry('Remove all', 'trash', () => this.removeGroup(pass, g.id, true)));
        return items;
    }

    /** Forget everything that refers to a drawing or group the chart no longer has — otherwise a
     *  deleted drawing would keep a group alive, or stay counted in the selection bar. */
    private prune(chart: Vela): void {
        const live = new Set((chart.drawings.supported ? chart.drawings.all() : []).map((d) => d.id));
        for (const id of [...this.picked]) if (!live.has(id)) this.picked.delete(id);
        if (this.groups.length === 0) {
            this.renaming = null;
            return;
        }
        this.groups = pruneGroups(this.groups, live);
        if (this.renaming !== null && !this.groups.some((g) => g.id === this.renaming)) this.renaming = null;
    }
}
