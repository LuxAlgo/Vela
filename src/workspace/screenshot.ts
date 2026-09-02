// Layout screenshot compositing — PURE geometry + a thin canvas blit.
//
// Each cell already knows how to rasterize itself (`renderer.screenshotCanvas()`).
// The workspace chrome's job is to place those rasters onto one PNG in the same
// positions the grid shows, with the seam color in the gaps. Hidden cells
// (maximized siblings) are dropped before they get here.

/** A cell's box in CSS pixels, origin at the grid's top-left. */
export interface LayoutShotTile {
    source: CanvasImageSource;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The grid's CSS box + the device-pixel scale of the export. */
export interface LayoutShotFrame {
    width: number;
    height: number;
    dpr: number;
    /** Computed background of the grid — paints the visible seams. */
    gapColor: string;
}

/** Pixel dest of a CSS tile, rounded so adjacent cells share an edge (no 1px gap). */
export function destRect(
    tile: Pick<LayoutShotTile, 'x' | 'y' | 'width' | 'height'>,
    dpr: number,
): { dx: number; dy: number; dw: number; dh: number } {
    const dx = Math.round(tile.x * dpr);
    const dy = Math.round(tile.y * dpr);
    return {
        dx,
        dy,
        dw: Math.round((tile.x + tile.width) * dpr) - dx,
        dh: Math.round((tile.y + tile.height) * dpr) - dy,
    };
}

/** CSS tiles for every cell that is on screen (not hidden, non-zero box). */
export function tilesFromCellRects(
    grid: { left: number; top: number; width: number; height: number },
    cells: ReadonlyArray<{ hidden?: boolean; left: number; top: number; width: number; height: number }>,
): Array<Pick<LayoutShotTile, 'x' | 'y' | 'width' | 'height'>> {
    if (grid.width <= 0 || grid.height <= 0) return [];
    const tiles: Array<Pick<LayoutShotTile, 'x' | 'y' | 'width' | 'height'>> = [];
    for (const c of cells) {
        if (c.hidden || c.width <= 0 || c.height <= 0) continue;
        tiles.push({ x: c.left - grid.left, y: c.top - grid.top, width: c.width, height: c.height });
    }
    return tiles;
}

/**
 * Composite `tiles` onto a canvas the size of the grid and return a PNG data URL.
 * Empty / zero-size frames, or a tile list that painted nothing, return null.
 */
export function compositeLayoutScreenshot(
    doc: Document,
    frame: LayoutShotFrame,
    tiles: readonly LayoutShotTile[],
): string | null {
    if (frame.width <= 0 || frame.height <= 0 || tiles.length === 0) return null;
    const dpr = frame.dpr > 0 ? frame.dpr : 1;
    const out = doc.createElement('canvas');
    out.width = Math.max(1, Math.round(frame.width * dpr));
    out.height = Math.max(1, Math.round(frame.height * dpr));
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = frame.gapColor;
    ctx.fillRect(0, 0, out.width, out.height);
    let painted = 0;
    for (const tile of tiles) {
        if (tile.width <= 0 || tile.height <= 0) continue;
        const { dx, dy, dw, dh } = destRect(tile, dpr);
        if (dw <= 0 || dh <= 0) continue;
        ctx.drawImage(tile.source, dx, dy, dw, dh);
        painted += 1;
    }
    if (painted === 0) return null;
    return out.toDataURL('image/png');
}

/** Fire a PNG download in `doc` (the same `<a download>` the cell screenshot uses). */
export function triggerPngDownload(doc: Document, url: string, filename: string): void {
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
}
