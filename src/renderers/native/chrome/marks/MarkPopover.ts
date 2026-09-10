// The timeline-mark POPUP: the kit Popover anchored on a glyph of the canvas lane,
// deploying every mark of the clicked cluster as a scrollable run of sections — each
// its title over its content (escaped text, allowlisted HTML, or a structured panel of
// fields and buttons). Lazy content resolves as its section scrolls into view, so a
// cluster of many marks costs one fetch per entry actually looked at. The glyph is
// canvas pixels, not DOM, so an invisible anchor element inside the plot stands in as
// the popover's trigger; the renderer moves it as the glyph moves (pan/zoom).
import type { VelaTheme } from '../../../../core/options';
import type { MarkContent, MarkContentSource, MarkPanelItem } from '../../../../core/marks/types';
import { Popover } from '../../../../ui/components/popover';
import { CALLOUT_CSS, CALLOUT_STYLE_ID } from '../../../../ui/components/callout-bubble';
import { injectStyles } from '../../../../ui/styles';
import { sanitizeHtml } from '../../../../ui/sanitize-html';
import type { MarkCluster } from './layout';

const MARKS_STYLE_ID = 'vela-marks-popover';
const MARKS_CSS = `
.vela-marks-panel { padding: 0; gap: 0; min-width: 220px; max-width: 320px; max-height: 320px; overflow-y: auto; overscroll-behavior: contain; }
.vela-marks-section { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; }
.vela-marks-section + .vela-marks-section { border-top: 1px solid var(--vela-border); }
.vela-marks-field { display: flex; justify-content: space-between; gap: 16px; line-height: 1.45; }
.vela-marks-field-label { color: var(--vela-fg-muted); }
.vela-marks-field-value { color: var(--vela-fg-bright); text-align: right; font-variant-numeric: tabular-nums; }
.vela-marks-html { color: var(--vela-fg); line-height: 1.45; overflow-wrap: anywhere; }
.vela-marks-html p { margin: 0 0 6px; }
.vela-marks-html p:last-child { margin-bottom: 0; }
.vela-marks-html a { color: var(--vela-accent); }
.vela-marks-html img { max-width: 100%; height: auto; }
.vela-marks-html table { border-collapse: collapse; }
.vela-marks-html td, .vela-marks-html th { padding: 2px 6px; border: 1px solid var(--vela-border); }
.vela-marks-html pre, .vela-marks-html code { font-family: var(--vela-font-mono, monospace); font-size: 0.92em; }
.vela-marks-loading, .vela-marks-error { color: var(--vela-fg-muted); font-style: italic; }
`;

export interface MarkPopoverDeps {
    /** The positioned plot element — the anchor lives in it. */
    plot: HTMLElement;
    /** Where the popup portals: the host's dialog root when it set one, else the plot. */
    host: () => HTMLElement;
    /** Live theme, read at open time. */
    theme: () => VelaTheme;
    /** The cluster whose popup shows changed — its key while one is open, null once it closed (the glyph paints "active" meanwhile). */
    onOpenChange?: (key: string | null) => void;
}

/** A glyph's box in plot space (center + size). */
export interface MarkGlyphRect {
    x: number;
    y: number;
    size: number;
}

export class MarkPopover {
    private readonly anchor: HTMLDivElement;
    private pop: Popover | null = null;
    private openKey: string | null = null;
    /** Bumped per open/close — a lazy content resolving after its popup went away is dropped. */
    private generation = 0;
    /**
     * The cluster whose popup was open when the current pointer press began. The anchor is
     * hit-transparent (the glyph is canvas pixels), so the shell's outside-dismiss closes the
     * popup on pointerdown; the click the renderer derives from the same pointerup must then
     * read as "close", not reopen that cluster. Captured on the document ahead of the shell's
     * (deferred) listener, cleared once the release has dispatched.
     */
    private pressKey: string | null = null;
    private readonly onPress = (): void => {
        if (this.openKey === null) return;
        this.pressKey = this.openKey;
        const doc = this.deps.plot.ownerDocument;
        const clear = (): void => void setTimeout(() => (this.pressKey = null), 0);
        doc.addEventListener('pointerup', clear, { capture: true, once: true });
        doc.addEventListener('pointercancel', clear, { capture: true, once: true });
    };

    constructor(private readonly deps: MarkPopoverDeps) {
        const doc = deps.plot.ownerDocument;
        injectStyles(CALLOUT_STYLE_ID, CALLOUT_CSS, doc);
        injectStyles(MARKS_STYLE_ID, MARKS_CSS, doc);
        this.anchor = doc.createElement('div');
        this.anchor.className = 'vela-marks-anchor';
        Object.assign(this.anchor.style, { position: 'absolute', pointerEvents: 'none', left: '0', top: '0', width: '0', height: '0' });
        deps.plot.appendChild(this.anchor);
        doc.addEventListener('pointerdown', this.onPress, true);
    }

    /** The cluster key the open popup belongs to, or null. */
    get key(): string | null {
        return this.openKey;
    }

    open(cluster: MarkCluster, rect: MarkGlyphRect): void {
        if (this.pressKey === cluster.key) return; // this press already closed that popup — the click toggles it off
        this.close();
        this.place(rect);
        const gen = ++this.generation;
        this.openKey = cluster.key;
        this.pop = new Popover({
            trigger: this.anchor,
            host: this.deps.host(),
            theme: this.deps.theme(),
            gap: 8,
            align: 'center', // centered on the glyph
            fadeMs: 120, // a short, discreet fade in and out
            className: 'vela-marks-pop',
            content: (body) => this.build(body, cluster, gen),
            onClose: () => {
                // Outside click / Escape — the shell closed itself; forget it unless a newer one replaced it.
                if (this.generation === gen) {
                    this.openKey = null;
                    this.pop = null;
                    this.deps.onOpenChange?.(null);
                }
            },
        });
        this.pop.show();
        this.deps.onOpenChange?.(cluster.key);
    }

    /** Follow the anchor glyph after a repaint; `null` (glyph gone — hidden, scrolled off, marks replaced) closes. */
    track(rect: MarkGlyphRect | null): void {
        if (!this.pop) return;
        if (!rect) {
            this.close();
            return;
        }
        this.place(rect);
        this.pop.reposition();
    }

    close(): void {
        const pop = this.pop;
        const wasOpen = this.openKey !== null;
        this.pop = null;
        this.openKey = null;
        this.generation++; // bumped before destroy(): the shell's own onClose then sees a stale generation
        pop?.destroy();
        if (wasOpen) this.deps.onOpenChange?.(null);
    }

    destroy(): void {
        this.close();
        this.deps.plot.ownerDocument.removeEventListener('pointerdown', this.onPress, true);
        this.anchor.remove();
    }

    private place(rect: MarkGlyphRect): void {
        Object.assign(this.anchor.style, {
            left: `${rect.x - rect.size / 2}px`,
            top: `${rect.y - rect.size / 2}px`,
            width: `${rect.size}px`,
            height: `${rect.size}px`,
        });
    }

    private build(body: HTMLElement, cluster: MarkCluster, gen: number): void {
        const doc = body.ownerDocument;
        const root = doc.createElement('div');
        root.className = 'vela-callout-panel vela-marks-panel';
        const pending: Array<{ el: HTMLElement; resolve: () => void }> = [];
        for (const mark of cluster.marks) {
            const section = doc.createElement('section');
            section.className = 'vela-marks-section';
            if (mark.title) {
                const title = doc.createElement('div');
                title.className = 'vela-callout-title';
                title.textContent = mark.title;
                section.appendChild(title);
            }
            const content = mark.content;
            if (typeof content === 'function') {
                const slot = doc.createElement('div');
                slot.className = 'vela-marks-loading';
                slot.textContent = 'Loading…';
                section.appendChild(slot);
                pending.push({ el: section, resolve: () => this.resolveLazy(content, slot, gen) });
            } else if (content !== undefined) {
                this.renderContent(section, content);
            }
            if (section.childElementCount > 0) root.appendChild(section);
        }
        body.appendChild(root);
        if (pending.length > 0) scheduleLazy(root, pending);
    }

    private resolveLazy(source: Exclude<MarkContentSource, MarkContent>, slot: HTMLElement, gen: number): void {
        let result: Promise<MarkContent>;
        try {
            result = Promise.resolve(source());
        } catch (err) {
            result = Promise.reject(err instanceof Error ? err : new Error(String(err)));
        }
        void result.then(
            (content) => {
                if (gen !== this.generation) return;
                const section = slot.parentElement;
                if (!section) return;
                slot.remove();
                this.renderContent(section, content);
                this.pop?.reposition(); // the panel grew — keep it inside the viewport
            },
            () => {
                if (gen !== this.generation) return;
                slot.className = 'vela-marks-error';
                slot.textContent = 'Couldn’t load this entry.';
            },
        );
    }

    private renderContent(section: HTMLElement, content: MarkContent): void {
        const doc = section.ownerDocument;
        if (!content || typeof content !== 'object') return;
        if ('text' in content) {
            const text = doc.createElement('div');
            text.className = 'vela-callout-text';
            text.textContent = String(content.text);
            section.appendChild(text);
            return;
        }
        if ('html' in content) {
            const html = doc.createElement('div');
            html.className = 'vela-marks-html';
            html.appendChild(sanitizeHtml(String(content.html), doc));
            section.appendChild(html);
            return;
        }
        if ('panel' in content && content.panel && Array.isArray(content.panel.items)) {
            let actions: HTMLElement | null = null; // consecutive buttons share one row
            for (const item of content.panel.items as MarkPanelItem[]) {
                if (!item || typeof item !== 'object') continue;
                if (item.type === 'button') {
                    if (!actions) {
                        actions = doc.createElement('div');
                        actions.className = 'vela-callout-actions';
                        section.appendChild(actions);
                    }
                    const btn = doc.createElement('button');
                    btn.type = 'button';
                    btn.className = 'vela-callout-btn' + (item.primary ? ' vela-callout-btn-primary' : '');
                    btn.textContent = item.label;
                    btn.addEventListener('click', () => {
                        item.run();
                        if (item.close !== false) this.close();
                    });
                    actions.appendChild(btn);
                    continue;
                }
                actions = null;
                if (item.type === 'text') {
                    const text = doc.createElement('div');
                    text.className = 'vela-callout-text';
                    text.textContent = item.text;
                    section.appendChild(text);
                } else if (item.type === 'field') {
                    const row = doc.createElement('div');
                    row.className = 'vela-marks-field';
                    const label = doc.createElement('span');
                    label.className = 'vela-marks-field-label';
                    label.textContent = item.label;
                    const value = doc.createElement('span');
                    value.className = 'vela-marks-field-value';
                    value.textContent = item.value;
                    row.append(label, value);
                    section.appendChild(row);
                }
            }
        }
    }
}

/** Resolve each pending section as it scrolls into the panel's view (all at once where the observer is unavailable). */
function scheduleLazy(scroller: HTMLElement, pending: Array<{ el: HTMLElement; resolve: () => void }>): void {
    if (typeof IntersectionObserver === 'undefined') {
        for (const p of pending) p.resolve();
        return;
    }
    const io = new IntersectionObserver(
        (entries) => {
            for (const e of entries) {
                if (!e.isIntersecting) continue;
                const p = pending.find((q) => q.el === e.target);
                if (!p) continue;
                io.unobserve(e.target);
                p.resolve();
            }
        },
        { root: scroller },
    );
    for (const p of pending) io.observe(p.el);
}
