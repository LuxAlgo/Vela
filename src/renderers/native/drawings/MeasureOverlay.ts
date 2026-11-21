import type { VelaTheme } from '../../../core/options';
import type { DrawingPoint, Projector } from '../../../core/drawings';
import { msg } from '../../../core/i18n/message';
import { localizeNumberText } from '../../../core/i18n/text';
import { englishTranslator } from '../../../core/i18n/translator';
import type { Translator } from '../../../core/i18n/types';

const TEXT = {
    priceChange: msg('drawing.ruler.priceChange', '{change} ({percent}%)'),
    barsAndDuration: msg('drawing.ruler.barsAndDuration', '{count, plural, one {{bars} bar} other {{bars} bars}}, {duration}'),
};
import { BEARISH, BULLISH } from '../../../core/palette';

/** Signed value with 2 decimals (e.g. "+12.34"). */
function signed(n: number): string {
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

// The ruler's direction tint is fixed, not the theme's candle colors: it must stay readable
// over candles of any user-chosen color.
const UP = BULLISH;
const DOWN = BEARISH;
const DRAG_SLOP = 3;

type MeasureState = 'idle' | 'measuring' | 'finished';

/**
 * The transient ruler — NOT a persistent drawing. Click to start,
 * move (no button) to size, click again to finish (or press-drag-release in one go);
 * it shows a direction-tinted box + a mid dashed crosshair + a directional arrow + a
 * label (Δprice/%, bars, duration). A finished ruler is cleared on the next press, wheel
 * pan or zoom.
 *
 * Both ends are kept as DATA points (time + price on the pane the ruler started in) and
 * projected to pixels at paint time, so the ruler stays on the candles it measures when
 * the chart moves under it: a wheel or trackpad pan between the two clicks, a new bar
 * scrolling the chart, the price scale rescaling. Pointer input arrives in media pixels
 * and is converted through the live projector as it lands.
 */
export class MeasureOverlay {
    private state: MeasureState = 'idle';
    /** The pane the ruler measures in (where it started); null when it started off every pane. */
    private paneId: string | null = null;
    private start: DrawingPoint | null = null;
    private end: DrawingPoint | null = null;
    private pressX = 0;
    private pressY = 0;

    /** `projector` reads the chart's CURRENT projector: pixels in and out go through it. */
    constructor(private readonly projector: () => Projector) {}

    isActive(): boolean {
        return this.state !== 'idle';
    }
    isFinished(): boolean {
        return this.state === 'finished';
    }

    /** The data point under a media-pixel position, on the ruler's pane. */
    private toPoint(x: number, y: number): DrawingPoint | null {
        if (this.paneId == null) return null;
        const p = this.projector().pxToPoint(x, y, this.paneId);
        return { time: p.time, price: p.price };
    }

    /** A data point's media-pixel position through `proj`, or null when its pane is gone. */
    private toPx(proj: Projector, p: DrawingPoint): { x: number; y: number } | null {
        if (this.paneId == null) return null;
        const y = proj.yOf(p.price, this.paneId);
        return y == null ? null : { x: proj.xOf(p.time), y };
    }

    /** A press: begin the measurement, or finish it on the second click.
     *  `x,y` are the raw cursor (drag-slop vs click-move-click). `gx,gy` are the
     *  graphic endpoints — magnet-snapped when the magnet is on, else the same as `x,y`. */
    down(x: number, y: number, gx = x, gy = y): void {
        if (this.state === 'measuring') {
            this.end = this.toPoint(gx, gy) ?? this.end;
            this.state = 'finished';
            return;
        }
        this.paneId = this.projector().paneIdAtY(gy);
        this.start = this.toPoint(gx, gy);
        this.end = this.start;
        this.pressX = x;
        this.pressY = y;
        this.state = 'measuring';
    }

    /** Size the in-progress ruler. `x,y` are the graphic (magnet-snapped) cursor. */
    move(x: number, y: number): void {
        if (this.state === 'measuring') this.end = this.toPoint(x, y) ?? this.end;
    }

    /** A release: finish if the press was actually dragged (press-drag-release), else wait
     *  for the second click (click-move-click). `x,y` are the raw cursor (slop); `gx,gy`
     *  are the graphic end (magnet-snapped when the magnet is on). */
    up(x: number, y: number, gx = x, gy = y): void {
        if (this.state === 'measuring' && Math.hypot(x - this.pressX, y - this.pressY) > DRAG_SLOP) {
            this.end = this.toPoint(gx, gy) ?? this.end;
            this.state = 'finished';
        }
    }

    /** Current graphic endpoints in media pixels (projected now), or null when idle. */
    points(): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
        if (!this.start || !this.end) return null;
        const proj = this.projector();
        const start = this.toPx(proj, this.start);
        const end = this.toPx(proj, this.end);
        return start && end ? { start, end } : null;
    }

    clear(): void {
        this.state = 'idle';
        this.paneId = null;
        this.start = null;
        this.end = null;
    }

    paint(ctx: CanvasRenderingContext2D, proj: Projector, theme: VelaTheme, i18n: Translator = englishTranslator()): void {
        if (!this.start || !this.end) return;
        const a = this.toPx(proj, this.start);
        const b = this.toPx(proj, this.end);
        if (!a || !b) return;
        const { x: x1, y: y1 } = a;
        const { x: x2, y: y2 } = b;
        const p1 = this.start;
        const p2 = this.end;
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

        const duration = i18n.format.duration(p2.time - p1.time, { style: 'span', surface: 'drawing' });
        this.paintLabel(ctx, proj, theme, midX, top, bot, color, [
            i18n.t(TEXT.priceChange, { change: localizeNumberText(signed(priceDiff), i18n), percent: localizeNumberText(signed(pct), i18n) }),
            bars != null ? i18n.t(TEXT.barsAndDuration, { count: bars, bars: localizeNumberText(String(bars), i18n), duration }) : duration,
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
