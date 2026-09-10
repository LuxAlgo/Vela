// Timeline marks — the public model behind `chart.marks`: host-supplied events pinned
// to a moment in time (a dividend, a split, an earnings call, a deployment) and shown
// as small glyphs on a lane at the bottom of the plot, each opening a detail popup on
// click. Renderer-agnostic: nothing here knows how a glyph is painted.
import type { Millis } from '../model/time';

/** The built-in glyph outlines. */
export type MarkShape = 'circle' | 'square' | 'diamond' | 'pin';

/**
 * How a mark looks on the lane: a colored token carrying either a short letter or a
 * registered icon (`registerIcon` from `vela/ui` — an id, never inline markup, so a mark
 * payload can come from data without ever carrying SVG). `icon` wins over `letter`
 * when both are given; the symbol's ink is auto-contrasted against `color`.
 */
export interface MarkGlyph {
    /** Token outline (default `'circle'`). */
    shape?: MarkShape;
    /** Token fill — any CSS color. */
    color: string;
    /** One or two characters drawn inside the token (`'D'`, `'E'`, `'!'`). */
    letter?: string;
    /** Icon id from the icon registry, drawn inside the token. */
    icon?: string;
}

/** One row of a structured panel — the callout vocabulary plus a label/value field. */
export type MarkPanelItem =
    | { type: 'text'; text: string }
    | { type: 'field'; label: string; value: string }
    | {
          type: 'button';
          label: string;
          /** Emphasized (selection-colored) button — the panel's main action. */
          primary?: boolean;
          /** Close the popup after `run` (default true). */
          close?: boolean;
          run(): void;
      };

/**
 * What the popup shows for one mark: plain text (escaped), HTML (sanitized through an
 * allowlist — scripts, styles, frames, event handlers and `javascript:` URLs never
 * reach the page), or a structured panel of rows and buttons.
 */
export type MarkContent = { text: string } | { html: string } | { panel: { items: MarkPanelItem[] } };

/** A content value, or a thunk resolved when the popup needs it (details fetched on click). */
export type MarkContentSource = MarkContent | (() => MarkContent | Promise<MarkContent>);

/** One timeline mark. */
export interface TimelineMark {
    /** Stable id — re-adding an id replaces the mark. */
    id: string;
    /**
     * The moment the mark belongs to, epoch-ms. The glyph never sits at this exact pixel:
     * it centers on the bar whose span contains the time (a time falling in a gap — a
     * weekend, a closed session — goes to the first bar that follows; one past the newest
     * bar projects onto the extrapolated grid in the right whitespace).
     */
    time: Millis;
    /** Popup heading — shown above the content whatever its form. */
    title?: string;
    glyph: MarkGlyph;
    /** Hover text on the glyph. */
    tooltip?: string;
    /**
     * The visibility group the mark belongs to (`'dividends'`, `'splits'`). Marks of one
     * group that land on the same bar cluster into one glyph; groups get a checkbox each
     * in the chart settings (the Events tab). Define the display label with
     * `chart.marks.defineGroup`; an undefined group shows its capitalized id.
     */
    group?: string;
    /** Popup content. Without it a click only emits `mark:click` — the host owns the UI. */
    content?: MarkContentSource;
}

/** A visibility group's presentation (see {@link TimelineMark.group}). */
export interface MarkGroup {
    id: string;
    /** The settings checkbox label (`'Dividends'`). */
    label: string;
    /** Default visibility before the user toggles it (default true). A persisted choice wins. */
    visible?: boolean;
}

/** The `mark:click` payload — every mark under the clicked glyph (a cluster lists them all). */
export interface MarkClickEvent {
    /** The cluster's first mark (earliest time, then insertion order). */
    id: string;
    /** Every mark in the clicked cluster, in cluster order. */
    ids: string[];
    /** The first mark's time, epoch-ms. */
    time: Millis;
    /** The cluster's group, when its marks belong to one. */
    group?: string;
}
