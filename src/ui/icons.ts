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

// ── disclosure, row actions and menu verbs (side panels, nested menus) ──
registerIcon('chevron-right', S('<path d="m6 3.5 4.5 4.5L6 12.5"/>'));
registerIcon('chevron-down', S('<path d="M3.5 6 8 10.5 12.5 6"/>'));
registerIcon('eye', S('<path d="M1.5 8s2.5-4.2 6.5-4.2S14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>'));
registerIcon('eye-off', S('<path d="M1.5 8s2.5-4.2 6.5-4.2S14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" opacity="0.45"/><path d="m3 13 10-10"/>'));
registerIcon('lock', S('<rect x="3.2" y="7" width="9.6" height="6.6" rx="1.2"/><path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7"/>'));
registerIcon('unlock', S('<rect x="3.2" y="7" width="9.6" height="6.6" rx="1.2"/><path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.7-.7"/>'));
registerIcon('trash', S('<path d="M2.5 4.5h11M6.5 2.5h3M5.6 4.5l.5 9a1 1 0 0 0 1 .9h1.8a1 1 0 0 0 1-.9l.5-9M6.9 7v4.4M9.1 7v4.4"/>'));
registerIcon('group', S('<path d="M1.8 4.5V2.4a.6.6 0 0 1 .6-.6h2.1M11.5 1.8h2.1a.6.6 0 0 1 .6.6v2.1M14.2 11.5v2.1a.6.6 0 0 1-.6.6h-2.1M4.5 14.2H2.4a.6.6 0 0 1-.6-.6v-2.1"/><rect x="4" y="4" width="4.2" height="4.2" rx="0.7"/><rect x="7.8" y="7.8" width="4.2" height="4.2" rx="0.7"/>'));
registerIcon('ungroup', S('<rect x="1.6" y="1.6" width="6.2" height="6.2" rx="0.9"/><rect x="8.2" y="8.2" width="6.2" height="6.2" rx="0.9" stroke-dasharray="2 1.5"/>'));
registerIcon('clone', S('<rect x="5.5" y="5.5" width="9" height="9" rx="1.2"/><path d="M11 5.5v-3a1 1 0 0 0-1-1H2.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1h3"/>'));
registerIcon('arrow-up', S('<path d="M8 13.2V3M4.2 6.8 8 3l3.8 3.8"/>'));
registerIcon('arrow-down', S('<path d="M8 2.8V13M4.2 9.2 8 13l3.8-3.8"/>'));
registerIcon('move-vertical', S('<path d="M8 2.5v11M5 5.5 8 2.5l3 3M5 10.5l3 3 3-3"/>'));
registerIcon('pen', S('<path d="m10.8 2.2 3 3-8 8-3.6.6.6-3.6z"/><path d="m9.2 3.8 3 3"/>'));
registerIcon('wave', S('<path d="M1.5 10.4c1.6 0 1.9-4.8 3.4-4.8s1.8 4.8 3.4 4.8 1.8-4.8 3.4-4.8 1.6 4.8 2.8 4.8"/>'));
registerIcon('folder-plus', S('<path d="M1.6 4.4a1 1 0 0 1 1-1h2.7l1.3 1.7h6.8a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.8a1 1 0 0 1-1-1z"/><path d="M8 7.6v3.6M6.2 9.4h3.6"/>'));
registerIcon('folder-minus', S('<path d="M1.6 4.4a1 1 0 0 1 1-1h2.7l1.3 1.7h6.8a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.8a1 1 0 0 1-1-1z"/><path d="M6.2 9.4h3.6"/>'));
registerIcon('collapse', S('<path d="M3 8h10"/>'));
registerIcon('expand', S('<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.4"/><path d="M8 5.4v5.2M5.4 8h5.2"/>'));
registerIcon('maximize', S('<path d="M2.5 6V3a.5.5 0 0 1 .5-.5h3M10 2.5h3a.5.5 0 0 1 .5.5v3M13.5 10v3a.5.5 0 0 1-.5.5h-3M6 13.5H3a.5.5 0 0 1-.5-.5v-3"/>'));
registerIcon('restore', S('<path d="M6.2 2.5v3.7H2.5M9.8 13.5V9.8h3.7M13.5 6.2H9.8V2.5M2.5 9.8h3.7v3.7"/>'));
