// Callout-bubble CONTROLLER — the declarative vocabulary (and its pure projection
// rules) for a small tinted status bubble whose click deploys a panel of text and
// action buttons. No DOM: the vanilla view (or a future React one) projects these.

/** One block of a deployed callout panel — plain text, or a button running a caller action. */
export type CalloutPanelItem =
    | { type: 'text'; text: string }
    | {
          type: 'button';
          label: string;
          /** Emphasized (selection-colored) button — the panel's main action. */
          primary?: boolean;
          /** Close the panel after `run` (default true — an action answers the panel). */
          close?: boolean;
          run(): void;
      };

/** The deployed panel: an optional heading over ordered text/button blocks. */
export interface CalloutPanel {
    title?: string;
    items: CalloutPanelItem[];
}

/** What dresses the bubble itself (the panel is what the click deploys). */
export interface CalloutBubbleSpec {
    /** Icon id in the icon registry (`registerIcon`), centered in the bubble. */
    icon: string;
    /** Bubble fill — any CSS color, token expressions included. */
    background: string;
    /** Icon ink (default: `currentColor` inherited from the slot). */
    color?: string;
    /** Accessible name. Callers typically show the same text in their own tooltip. */
    label: string;
    /** Deployed panel — presence makes the bubble clickable. */
    panel?: CalloutPanel;
}

/** Whether activating a panel button also closes the panel (defaults to yes). */
export function closesPanel(item: Extract<CalloutPanelItem, { type: 'button' }>): boolean {
    return item.close !== false;
}

/** A panel row as the view lays it out: one text block, or a run of adjacent buttons. */
export type CalloutPanelRow =
    | { type: 'text'; text: string }
    | { type: 'buttons'; buttons: Array<Extract<CalloutPanelItem, { type: 'button' }>> };

/**
 * Group a panel's ordered items into layout rows: consecutive buttons share one row
 * (the common "text above, actions below" shape falls out naturally), text blocks
 * stand alone. Pure — unit-tested apart from the DOM.
 */
export function calloutPanelRows(items: CalloutPanelItem[]): CalloutPanelRow[] {
    const rows: CalloutPanelRow[] = [];
    for (const item of items) {
        if (item.type === 'text') {
            rows.push({ type: 'text', text: item.text });
            continue;
        }
        const last = rows[rows.length - 1];
        if (last && last.type === 'buttons') last.buttons.push(item);
        else rows.push({ type: 'buttons', buttons: [item] });
    }
    return rows;
}
