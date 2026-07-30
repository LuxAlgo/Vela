// The UI kit's view of the icon registry: the icons themselves are pure string data in
// `core/icons` (shared with the renderer's own chrome), and this module adds the one DOM
// helper the kit and the widget consume them through.

import { iconMarkup } from '../core/icons';

export { iconMarkup, registerIcon, svg16, svg24, svg24Solid } from '../core/icons';

/** A ready-to-insert element rendering the icon (empty span when unknown). */
export function iconEl(id: string, doc: Document = document): HTMLElement {
    const span = doc.createElement('span');
    span.className = 'vela-icon';
    span.setAttribute('aria-hidden', 'true');
    const svg = iconMarkup(id);
    if (svg) span.innerHTML = svg;
    return span;
}
