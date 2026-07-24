// The in-chart ATTRIBUTION mark — the LuxAlgo logomark at the bottom-left of the plot,
// expanding its wordmark on hover and linking to the project. Rendered by DEFAULT on every
// chart. Per the NOTICE file, products may disable it (`renderer.set('attribution', false)`)
// ONLY if they display an equivalent visible attribution elsewhere in their UI.

/** Where the mark links — the canonical project page. */
export const ATTRIBUTION_URL = 'https://luxalgo.com/vela';

const STYLE_ID = 'vela-attribution-styles';

function ensureStyles(doc: Document): void {
    if (doc.getElementById(STYLE_ID)) return;
    const s = doc.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
.vela-attribution { text-decoration: none; }
.vela-attribution .vela-attr-text {
    max-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font: 700 15px -apple-system, Segoe UI, sans-serif;
    letter-spacing: 0.4px;
    opacity: 0;
    transform: translateX(-6px);
    transition: max-width 0.3s ease, opacity 0.25s ease, transform 0.3s ease;
}
.vela-attribution:hover .vela-attr-text {
    max-width: 120px;
    opacity: 1;
    transform: translateX(4px);
}`;
    doc.head.appendChild(s);
}

/** Build the mark element (an anchor; the caller owns absolute positioning). */
export function createAttributionMark(doc: Document, color: string): HTMLAnchorElement {
    ensureStyles(doc);
    const a = doc.createElement('a');
    a.className = 'vela-attribution';
    a.href = ATTRIBUTION_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'Charting by Vela';
    a.setAttribute('aria-label', 'Charting by Vela');
    Object.assign(a.style, {
        position: 'absolute',
        zIndex: '6',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        color,
        pointerEvents: 'auto',
        cursor: 'pointer',
    });
    a.innerHTML =
        '<svg viewBox="0 0 45 40" width="26" height="23" style="flex:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45))" aria-hidden="true">' +
        '<g fill="currentColor"><path d="m40.25 38 4.58-7.998L28.802 2l-16.03 28 9.16-.001 6.87-12z"/>' +
        '<path d="M34.525 32.002 9.33 31.997 27.655 0h-9.158L.18 31.993 4.759 40h34.347z"/></g></svg>' +
        '<span class="vela-attr-text">Vela</span>';
    return a;
}
