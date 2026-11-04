// Vela's own chrome CSS (the widget's bars, panels, drawers, dialogs and the renderer's DOM
// controls) sits in one cascade layer: above the kit's components, below Pro and a theme's
// restyles, and under any CSS a host writes without a layer.
import { injectLayerOrder, injectStyles } from '@luxalgo/vela-ui/styles';

/** `css` inside the chrome's layer, for CSS that does not write its own. */
export function chromeLayer(css: string): string {
    return `@layer vela.chrome {\n${css}\n}`;
}

/** Inject a chrome stylesheet once per root. The CSS writes its layer itself
 *  (`css\`@layer vela.chrome { … }\``), so stylelint sees it. */
export function injectChromeStyles(id: string, css: string, root: Document | ShadowRoot = document): HTMLStyleElement | null {
    injectLayerOrder(root);
    return injectStyles(id, css, root);
}
