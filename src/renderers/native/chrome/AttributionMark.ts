// The in-chart ATTRIBUTION mark — the LuxAlgo logomark at the bottom-left of the plot,
// expanding its wordmark on hover and linking to the project. Rendered by DEFAULT on every
// chart. Per the NOTICE file, products may disable it (`renderer.set('attribution', false)`)
// ONLY if they display an equivalent visible attribution elsewhere in their UI.

import { LUXALGO_SYMBOL_URL, LUXALGO_WORDMARK_URL } from './luxalgo-logos';

/** Where the mark links — the canonical project page. */
export const ATTRIBUTION_URL = 'https://luxalgo.com/vela';

const STYLE_ID = 'vela-attribution-styles';
const CSS = `
.vela-attribution {
    text-decoration: none;
    display: flex;
    align-items: center;
    /* Gutter, wordmark size and offset below are the brand lockup's own ratios,
       measured off the official horizontal logo: gutter 0.157, wordmark height
       0.966, and wordmark 0.109 LOWER than the symbol — box-centering the two
       reads wrong because the symbol's ink hangs low and the wordmark descends. */
    gap: 4px;
}
.vela-attribution .vela-attr-symbol {
    height: 28px;
    width: auto;
    flex: none;
    display: block;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.45));
}
.vela-attribution .vela-attr-wordmark {
    max-width: 0;
    overflow: hidden;
    opacity: 0;
    display: flex;
    align-items: center;
    /* Offset here, not on the image: the clip box must not crop the descender. */
    position: relative;
    top: 3px;
    transform: translateX(-8px);
    transition: max-width 0.3s ease, opacity 0.25s ease, transform 0.3s ease;
    flex: none;
}
.vela-attribution .vela-attr-wordmark img {
    height: 27px;
    width: auto;
    display: block;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.45));
}
.vela-attribution:hover .vela-attr-wordmark {
    max-width: 240px;
    opacity: 1;
    transform: translateX(0);
}`;

function ensureStyles(doc: Document): void {
    let s = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!s) {
        s = doc.createElement('style');
        s.id = STYLE_ID;
        doc.head.appendChild(s);
    }
    s.textContent = CSS;
}

/** Build the mark element (an anchor; the caller owns absolute positioning).
 *  `color` is retained for call-site compatibility; the brand PNGs are white. */
export function createAttributionMark(doc: Document, _color: string): HTMLAnchorElement {
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
        pointerEvents: 'auto',
        cursor: 'pointer',
    });
    const symbol = doc.createElement('img');
    symbol.className = 'vela-attr-symbol';
    symbol.src = LUXALGO_SYMBOL_URL;
    symbol.alt = '';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.draggable = false;
    const wordmark = doc.createElement('span');
    wordmark.className = 'vela-attr-wordmark';
    const wordmarkImg = doc.createElement('img');
    wordmarkImg.src = LUXALGO_WORDMARK_URL;
    wordmarkImg.alt = 'LuxAlgo';
    wordmarkImg.draggable = false;
    wordmark.appendChild(wordmarkImg);
    a.append(symbol, wordmark);
    return a;
}
