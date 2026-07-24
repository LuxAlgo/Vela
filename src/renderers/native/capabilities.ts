import type { RendererCapabilities } from '../../core/ports/IChartRenderer';

/**
 * What the native renderer supports. Updated as phases land — P0 declares the
 * eventual target so capability-gated core logic behaves; features not yet
 * drawn are simply blank until their phase ships (tracked behind the playground
 * renderer toggle, with LwC as the parity oracle).
 */
export const NATIVE_CAPABILITIES: RendererCapabilities = {
    panes: true,
    paneManagement: true, // move/merge indicators, reorder + collapse/maximize panes
    fills: 'native', // first-class band primitive (no per-frame polygon rebuild)
    bgcolor: 'native',
    hline: 'native',
    markers: true,
    barcolor: 'native', // per-bar candle color channel
    perPointColor: true, // per-point color as a first-class attribute (no series split)
    drawings: true,
    userDrawings: true, // interactive drawing tools (toolbar + hit-test + handles)
    tables: true, // reuses the DOM TableOverlay
    inputsUI: true, // reuses the DOM InputsUI
};

/** Whether the environment can create a WebGL2 context (probed once on a throwaway canvas). */
let webgl2Probe: boolean | null = null;
export function supportsWebGL2(): boolean {
    if (webgl2Probe !== null) return webgl2Probe;
    try {
        const c = document.createElement('canvas');
        webgl2Probe = !!c.getContext('webgl2');
    } catch {
        webgl2Probe = false;
    }
    return webgl2Probe;
}
