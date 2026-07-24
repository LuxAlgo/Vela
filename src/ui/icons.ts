// Icon registry — self-contained inline SVGs (stroke = currentColor, 16×16 viewBox),
// no icon font, no CDN. Components look icons up by id; plugins register theirs through
// the same API (e.g. a chart type's `icon` markup is registered as `style-<id>`).

const registry = new Map<string, string>();

/** Register (or replace) an icon's raw `<svg>` markup under an id. */
export function registerIcon(id: string, svg: string): void {
    registry.set(id, svg);
}

/** The raw `<svg>` markup for an id, or null. */
export function iconMarkup(id: string): string | null {
    return registry.get(id) ?? null;
}

/** A ready-to-insert element rendering the icon (empty span when unknown). */
export function iconEl(id: string, doc: Document = document): HTMLElement {
    const span = doc.createElement('span');
    span.className = 'vela-icon';
    span.setAttribute('aria-hidden', 'true');
    const svg = registry.get(id);
    if (svg) span.innerHTML = svg;
    return span;
}

const S = (body: string): string =>
    `<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

// ── chart-type icons (style-<id>) ──
registerIcon(
    'style-candles',
    S('<path d="M4.5 2v2M4.5 12v2M11.5 2v1.5M11.5 11v3"/><rect x="2.8" y="4" width="3.4" height="8" rx="0.6" fill="currentColor" fill-opacity="0.25"/><rect x="9.8" y="3.5" width="3.4" height="7.5" rx="0.6" fill="currentColor"/>'),
);
registerIcon(
    'style-bars',
    S('<path d="M4.5 2.5v11M2.5 5h2M4.5 11h2"/><path d="M11.5 2.5v11M9.5 4.5h2M11.5 10.5h2"/>'),
);
registerIcon('style-line', S('<path d="M1.5 11.5 5.5 7l3 2.5 5-6"/>'));
registerIcon(
    'style-area',
    S('<path d="M1.5 11.5 5.5 7l3 2.5 5-6"/><path d="M1.5 11.5 5.5 7l3 2.5 5-6V13.5h-12z" fill="currentColor" fill-opacity="0.25" stroke="none"/>'),
);
registerIcon(
    'style-baseline',
    S('<path d="M1.5 8h13" stroke-dasharray="2 2"/><path d="M2 10.5 5.5 8.7l3 1.2 4.5-2" opacity="0.6"/><path d="M2 5.5 5.5 4l3 2 4.5-1.5"/>'),
);
registerIcon(
    'style-heikinashi',
    S('<path d="M4.5 3.5v1M4.5 11v1.5M11.5 3v1M11.5 10.5v2"/><rect x="2.8" y="4.5" width="3.4" height="6.5" rx="1.4" fill="currentColor" fill-opacity="0.25"/><rect x="9.8" y="4" width="3.4" height="6.5" rx="1.4" fill="currentColor"/>'),
);

// ── widget chrome icons ──
registerIcon('indicators', S('<path d="M1.5 12.5 5 7l2.5 3.5L11 4l3.5 5"/><circle cx="11" cy="4" r="1.4" fill="currentColor" stroke="none"/>'));
registerIcon(
    'objects',
    S('<path d="M8 1.8 14 5 8 8.2 2 5z"/><path d="M2 8l6 3.2L14 8" opacity="0.7"/><path d="M2 11l6 3.2 6-3.2" opacity="0.4"/>'),
);
registerIcon('clock', S('<circle cx="8" cy="8" r="6.2"/><path d="M8 4.8V8l2.4 1.6"/>'));
registerIcon('datawindow', S('<rect x="1.8" y="2.5" width="12.4" height="11" rx="1.5"/><path d="M4.5 5.5h4M4.5 8h7M4.5 10.5h5.5"/>'));
registerIcon('camera', S('<path d="M5.5 4 6.5 2.5h3L10.5 4h3A1 1 0 0 1 14.5 5v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><circle cx="8" cy="8.5" r="2.6"/>'));
registerIcon('gear', S('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4"/>'));
registerIcon('search', S('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>'));
registerIcon('bell', S('<path d="M8 2a4 4 0 0 0-4 4v2.5L2.5 11v1h11v-1L12 8.5V6a4 4 0 0 0-4-4z"/><path d="M6.5 13.5a1.5 1.5 0 0 0 3 0"/>'));
