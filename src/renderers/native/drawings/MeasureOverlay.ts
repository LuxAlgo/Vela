import type { VelaTheme } from '../../../core/options';
import type { Projector } from '../../../core/drawings';
import { formatDuration } from '../../../core/drawings';

/** Signed value with 2 decimals (e.g. "+12.34"). */
function signed(n: number): string {
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

const UP = '#0ecb81';
const DOWN = '#f6465d';
const DRAG_SLOP = 3;

type MeasureState = 'idle' | 'measuring' | 'finished';

/**
 * The transient ruler — NOT a persistent drawing. Click to start,
 * move (no button) to size, click again to finish (or press-drag-release in one go);
 * it shows a direction-tinted box + a mid dashed crosshair + a directional arrow + a
 * label (Δprice/%, bars, duration), and is cleared on the next press / pan / zoom.
 *
 * Coordinates are kept in MEDIA PIXELS — the overlay never survives a viewport change
 * (it is cleared on pan/zoom), so it needs no reprojection; data values for the label
 * are read off the live projector at paint time.
 */
export class MeasureOverlay {
    private state: MeasureState = 'idle';
    private start: { x: number; y: number } | null = null;
    private end: { x: number; y: number } | null = null;
    private pressX = 0;
    private pressY = 0;

    isActive(): boolean {
        return this.state !== 'idle';
    }
    isFinished(): boolean {
        return this.state === 'finished';
    }

    /** A press: begin the measurement, or finish it on the second click. */
    down(x: number, y: number): void {
        if (this.state === 'measuring') {
            this.end = { x, y };
            this.state = 'finished';
            return;
        }
        this.start = { x, y };
        this.end = { x, y };
        this.pressX = x;
        this.pressY = y;
        this.state = 'measuring';
    }

    move(x: number, y: number): void {
        if (this.state === 'measuring') this.end = { x, y };
    }

    /** A release: finish if the press was actually dragged (press-drag-release), else wait
     *  for the second click (click-move-click). */
    up(x: number, y: number): void {
        if (this.state === 'measuring' && Math.hypot(x - this.pressX, y - this.pressY) > DRAG_SLOP) {
            this.end = { x, y };
            this.state = 'finished';
        }
    }

    clear(): void {
        this.state = 'idle';
        this.start = null;
        this.end = null;
    }

    paint(ctx: CanvasRenderingContext2D, proj: Projector, theme: VelaTheme): void {
        if (!this.start || !this.end) return;
        const { x: x1, y: y1 } = this.start;
        const { x: x2, y: y2 } = this.end;
        const paneId = proj.paneIdAtY(y1) ?? proj.paneIdAtY(y2);
        if (!paneId) return;
        const p1 = proj.pxToPoint(x1, y1, paneId);
        const p2 = proj.pxToPoint(x2, y2, paneId);
        const priceDiff = p2.price - p1.price;
        const pct = p1.price !== 0 ? (priceDiff / p1.price) * 100 : 0;
        const bars = proj.barsBetween ? Math.round(proj.barsBetween(p1.time, p2.time)) : null;
        const up = priceDiff >= 0;
        const color = up ? UP : DOWN;
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const top = Math.min(y1, y2);
        const bot = Math.max(y1, y2);
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;

        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = color;
        ctx.fillRect(left, top, right - left, bot - top);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(midX, y1);
        ctx.lineTo(midX, y2);
        ctx.moveTo(x1, midY);
        ctx.lineTo(x2, midY);
        ctx.stroke();
        ctx.setLineDash([]);
        // a filled arrow at the destination edge, pointing the way price moved
        const ay = up ? top : bot;
        const dir = up ? 1 : -1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(midX, ay);
        ctx.lineTo(midX - 5, ay + dir * 7);
        ctx.lineTo(midX + 5, ay + dir * 7);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        this.paintLabel(ctx, proj, theme, midX, top, bot, color, [
            `${signed(priceDiff)} (${signed(pct)}%)`,
            bars != null ? `${bars} bars · ${formatDuration(p2.time - p1.time)}` : formatDuration(p2.time - p1.time),
        ]);
    }

    /** A bordered, two-line label centered under the box (flipped above if it would overflow). */
    private paintLabel(
        ctx: CanvasRenderingContext2D,
        proj: Projector,
        theme: VelaTheme,
        midX: number,
        boxTop: number,
        boxBot: number,
        color: string,
        lines: string[],
    ): void {
        ctx.save();
        ctx.font = `12px ${theme.fontFamily}`;
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
        const lh = 16;
        const h = lines.length * lh + 8;
        let y = boxBot + 8;
        if (y + h > proj.height) y = boxTop - h - 8;
        const x = midX - w / 2;
        ctx.fillStyle = theme.background;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const r = 4;
        ctx.roundRect(x, y, w, h, r);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = theme.textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        lines.forEach((line, i) => ctx.fillText(line, midX, y + 8 + lh / 2 + i * lh));
        ctx.restore();
    }
}
