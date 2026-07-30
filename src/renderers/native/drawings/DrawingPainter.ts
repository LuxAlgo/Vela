import type { Drawing, Projector, DrawingStyle } from '../../../core/drawings';
import { SegmentDrawing, FibRatios, RadialFib, FibSpiral, GannSquare, GANN_SQUARE_ARCS, DedekindTessellation, MachFigure, MeasureBox, PositionTool, PatternDrawing, CalloutBase, Callout, Comment, PriceNote, Signpost, Note, PriceLabel, ArrowMark, GlyphStamp, RegressionChannel, AnchoredVwap, FixedRangeVolumeProfile, lineSegmentIntersection, effectiveFillColor, VALID_FILL, INVALID_FILL, DEFAULT_DRAWING_COLOR } from '../../../core/drawings';
import type { VelaTheme } from '../../../core/options';
import { dashPattern, extendEndpoints, namedFontSize } from '../../shared/drawing-geometry';
import { BEARISH, BULLISH, NEUTRAL, SLATE, SLATE_DEEP } from '../../../core/palette';
import { withAlpha } from '../../../core/color';
import { valueDecimals } from '../chrome/ticks';

const HANDLE_RADIUS = 4.5; // px radius of the round drag handles
/** Handle chrome is fixed (not the drawing's line color) so tools with atypical accents —
 *  e.g. regression gray / FRVP green — still match every other drawing's anchors. */
const HANDLE_BORDER = DEFAULT_DRAWING_COLOR;
const HANDLE_FILL = withAlpha(NEUTRAL, 0.55);
const GHOST_ALPHA = 0.7;
/** Info badges (regression R², measure deltas) float over CHART CONTENT of any color, so
 *  they keep a fixed dark plate instead of a themed surface. */
const BADGE_FILL = SLATE_DEEP;
const BADGE_STROKE = SLATE;

/**
 * Paints user drawings onto the L1.5 canvas. The caller has already applied the DPR
 * transform + cleared, so everything here is in media px. Dispatches by `type`;
 * geometry comes from each drawing's pure `handlePoints`/anchors via the
 * {@link Projector}. Strokes/fonts reuse the shared Pine-drawing helpers so user
 * drawings match engine-drawn ones exactly.
 */
export class DrawingPainter {
    /** Paint every visible drawing, then selection handles for each highlighted id.
     *  Each drawing is clipped to its own pane's rect (and skipped entirely while that pane
     *  is hidden — collapsed, or zeroed by another pane's maximize) so panes stay separated. */
    paintAll(
        ctx: CanvasRenderingContext2D,
        drawings: readonly Drawing[],
        proj: Projector,
        theme: VelaTheme,
        highlightIds: ReadonlySet<string>,
    ): void {
        for (const d of drawings) {
            if (!d.visible) continue;
            this.paintClipped(ctx, d, proj, () => this.paintOne(ctx, d, proj, theme));
        }
        this.paintHighlights(ctx, drawings, proj, highlightIds);
    }

    /** Selection handles alone, for drawings whose body was painted elsewhere: the ones sent
     *  behind the series paint on the layer under the data, and handles left down there would be
     *  buried under the candles — you could not see what you had grabbed. */
    paintHighlights(ctx: CanvasRenderingContext2D, drawings: readonly Drawing[], proj: Projector, highlightIds: ReadonlySet<string>): void {
        if (highlightIds.size === 0) return;
        for (const d of drawings) {
            if (d.visible && highlightIds.has(d.id)) {
                this.paintClipped(ctx, d, proj, () => this.paintHandles(ctx, d.handlePoints(proj)));
            }
        }
    }

    /** Run `paint` clipped to the drawing's pane rect; a hidden pane (height 0) paints nothing. */
    private paintClipped(ctx: CanvasRenderingContext2D, d: Drawing, proj: Projector, paint: () => void): void {
        if (!proj.paneRect) { paint(); return; } // projector exposes no pane geometry → unclipped
        const rect = proj.paneRect(d.paneId);
        if (!rect || rect.height <= 0) return; // pane gone or hidden → nothing to paint
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, rect.top, proj.width, rect.height);
        ctx.clip();
        paint();
        ctx.restore();
    }

    /** Paint the in-progress drawing (during placing) at reduced opacity. */
    paintGhost(ctx: CanvasRenderingContext2D, ghost: Drawing, proj: Projector, theme: VelaTheme): void {
        ctx.globalAlpha = GHOST_ALPHA;
        // Two-time-anchor tools (regression channel, fixed-range VP) preview their TIME SPAN while
        // placing (two vertical guides + a connecting line) rather than the finished shape.
        if (ghost instanceof RegressionChannel || ghost instanceof FixedRangeVolumeProfile) {
            this.paintTimeSpanGhost(ctx, ghost, proj);
        } else this.paintOne(ctx, ghost, proj, theme);
        ctx.globalAlpha = 1;
    }

    /** Placement preview for two time-anchor tools: a full-height dashed vertical guide at each
     *  anchor (the left/right time bounds) + a line from the first anchor to the cursor. */
    private paintTimeSpanGhost(ctx: CanvasRenderingContext2D, d: RegressionChannel | FixedRangeVolumeProfile, proj: Projector): void {
        const a = d.anchors[0];
        const b = d.anchors[1];
        if (!a) return;
        // Neutral gray guides (same as the regression channel midline) — not the tool's accent color.
        const color = d instanceof RegressionChannel ? d.reg?.midColor || NEUTRAL : NEUTRAL;
        const guide = (time: number): void => {
            const x = proj.xOf(time);
            ctx.save();
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.6 * ctx.globalAlpha;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, proj.height);
            ctx.stroke();
            ctx.restore();
        };
        guide(a.time);
        if (b) guide(b.time);
        const ya = proj.yOf(a.price, d.paneId);
        const yb = b ? proj.yOf(b.price, d.paneId) : null;
        const pts: Array<[number, number]> = [];
        if (ya != null) pts.push([proj.xOf(a.time), ya]);
        if (b && yb != null) {
            // the connecting line (first anchor → cursor)
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(proj.xOf(a.time), ya ?? yb);
            ctx.lineTo(proj.xOf(b.time), yb);
            ctx.stroke();
            ctx.restore();
            pts.push([proj.xOf(b.time), yb]);
        }
        this.paintHandles(ctx, pts);
    }

    /** A hollow ring marking the candle point the magnet (Ctrl) will snap the next anchor to. */
    paintSnapRing(ctx: CanvasRenderingContext2D, x: number, y: number, theme: VelaTheme): void {
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = theme.textColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    private paintOne(ctx: CanvasRenderingContext2D, d: Drawing, proj: Projector, theme: VelaTheme): void {
        if (d.type === 'highlighter' && d instanceof SegmentDrawing) {
            this.paintHighlighter(ctx, d, proj);
            this.paintLabel(ctx, d, proj, theme);
            return;
        }
        if (d instanceof SegmentDrawing) {
            this.paintSegments(ctx, d, proj);
            if (d.type === 'path') {
                const pts = d.handlePoints(proj); // a path ends in an arrowhead along its last segment
                if (pts.length >= 2) this.paintArrowhead(ctx, pts[pts.length - 2]!, pts[pts.length - 1]!, d.style);
            }
            this.paintLabel(ctx, d, proj, theme);
            return;
        }
        if (d instanceof ArrowMark) {
            this.paintArrowMark(ctx, d, proj);
            this.paintLabel(ctx, d, proj, theme);
            return;
        }
        if (d instanceof GlyphStamp) {
            this.paintGlyphStamp(ctx, d, proj, theme);
            this.paintLabel(ctx, d, proj, theme);
            return;
        }
        if (d instanceof RadialFib) {
            this.paintRadialFib(ctx, d, proj, theme);
            this.paintLabel(ctx, d, proj, theme);
            return;
        }
        if (d instanceof FibSpiral) {
            this.paintFibSpiral(ctx, d, proj);
            this.paintLabel(ctx, d, proj, theme);
            return;
        }
        if (d instanceof DedekindTessellation) {
            this.paintDedekind(ctx, d, proj);
            this.paintLabel(ctx, d, proj, theme);
            return;
        }
        if (d instanceof MachFigure) {
            this.paintMachFigure(ctx, d, proj, theme);
            this.paintLabel(ctx, d, proj, theme);
            return;
        }
        if (d instanceof GannSquare) {
            this.paintFibRatios(ctx, d, proj, theme); // grid + Gann angle fan (straight entry lines)
            this.paintGannArcs(ctx, d, proj); // concentric quarter-ellipse arcs from the origin corner
            this.paintLabel(ctx, d, proj, theme);
            return;
        }
        if (d instanceof FibRatios) {
            this.paintFibRatios(ctx, d, proj, theme);
            this.paintLabel(ctx, d, proj, theme);
            return;
        }
        if (d instanceof MeasureBox) {
            this.paintMeasureBox(ctx, d, proj, theme);
            return;
        }
        if (d instanceof PositionTool) {
            this.paintPosition(ctx, d, proj, theme);
            return;
        }
        if (d instanceof RegressionChannel) {
            this.paintRegressionChannel(ctx, d, proj, theme);
            this.paintLabel(ctx, d, proj, theme);
            return;
        }
        if (d instanceof AnchoredVwap) {
            this.paintAnchoredVwap(ctx, d, proj);
            this.paintLabel(ctx, d, proj, theme);
            return;
        }
        if (d instanceof FixedRangeVolumeProfile) {
            this.paintFixedRangeVp(ctx, d, proj);
            this.paintLabel(ctx, d, proj, theme);
            return;
        }
        if (d instanceof PatternDrawing) {
            this.paintPattern(ctx, d, proj, theme);
            return;
        }
        if (d instanceof Comment) {
            this.paintComment(ctx, d, proj, theme);
            return;
        }
        if (d instanceof PriceNote) {
            this.paintPriceNote(ctx, d, proj, theme);
            return;
        }
        if (d instanceof Signpost) {
            this.paintSignpost(ctx, d, proj, theme);
            return;
        }
        if (d instanceof Callout) {
            this.paintCallout(ctx, d, proj, theme);
            return;
        }
        if (d instanceof Note) {
            this.paintNote(ctx, d, proj, theme);
            return;
        }
        if (d instanceof PriceLabel) {
            this.paintPriceLabel(ctx, d, proj, theme);
            return;
        }
        switch (d.type) {
            case 'hline': {
                const pts = d.handlePoints(proj);
                if (pts.length === 0) return;
                this.stroke(ctx, d.style, () => {
                    ctx.moveTo(0, pts[0]![1]);
                    ctx.lineTo(proj.width, pts[0]![1]);
                });
                break;
            }
            case 'trendline':
            case 'arrow': {
                const pts = d.handlePoints(proj);
                if (pts.length < 2) return;
                this.stroke(ctx, d.style, () => {
                    ctx.moveTo(pts[0]![0], pts[0]![1]);
                    ctx.lineTo(pts[1]![0], pts[1]![1]);
                });
                if (d.style.arrowRight) this.paintArrowhead(ctx, pts[0]!, pts[1]!, d.style);
                if (d.style.arrowLeft) this.paintArrowhead(ctx, pts[1]!, pts[0]!, d.style);
                break;
            }
            case 'ellipse': {
                const pts = d.handlePoints(proj);
                if (pts.length < 2) return;
                const cx = (pts[0]![0] + pts[1]![0]) / 2;
                const cy = (pts[0]![1] + pts[1]![1]) / 2;
                const rx = Math.abs(pts[1]![0] - pts[0]![0]) / 2;
                const ry = Math.abs(pts[1]![1] - pts[0]![1]) / 2;
                if (d.style.fillColor) {
                    ctx.save();
                    ctx.fillStyle = d.style.fillColor; // alpha lives in the fill color itself

                    ctx.beginPath();
                    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                }
                this.applyStroke(ctx, d.style);
                ctx.beginPath();
                ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                break;
            }
            case 'ray': {
                const pts = d.handlePoints(proj);
                if (pts.length < 2) return;
                const [ex1, ey1, ex2, ey2] = extendEndpoints(pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1], 'right', proj.width, proj.height);
                this.stroke(ctx, d.style, () => {
                    ctx.moveTo(ex1, ey1);
                    ctx.lineTo(ex2, ey2);
                });
                break;
            }
            case 'extendedline': {
                const pts = d.handlePoints(proj);
                if (pts.length < 2) return;
                const [ex1, ey1, ex2, ey2] = extendEndpoints(pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1], 'both', proj.width, proj.height);
                this.stroke(ctx, d.style, () => {
                    ctx.moveTo(ex1, ey1);
                    ctx.lineTo(ex2, ey2);
                });
                break;
            }
            case 'vline': {
                const pts = d.handlePoints(proj);
                if (pts.length === 0) return;
                this.stroke(ctx, d.style, () => {
                    ctx.moveTo(pts[0]![0], 0);
                    ctx.lineTo(pts[0]![0], proj.height);
                });
                break;
            }
            case 'hray': {
                const pts = d.handlePoints(proj);
                if (pts.length === 0) return;
                this.stroke(ctx, d.style, () => {
                    ctx.moveTo(pts[0]![0], pts[0]![1]);
                    ctx.lineTo(proj.width, pts[0]![1]);
                });
                break;
            }
            case 'crossline': {
                const pts = d.handlePoints(proj);
                if (pts.length === 0) return;
                this.stroke(ctx, d.style, () => {
                    ctx.moveTo(0, pts[0]![1]); // horizontal arm — full width
                    ctx.lineTo(proj.width, pts[0]![1]);
                    ctx.moveTo(pts[0]![0], 0); // vertical arm — full height
                    ctx.lineTo(pts[0]![0], proj.height);
                });
                break;
            }
            case 'infoline':
                this.paintInfoLine(ctx, d, proj);
                break;
            case 'trendangle':
                this.paintTrendAngle(ctx, d, proj, theme);
                break;
            case 'circle': {
                const pts = d.handlePoints(proj);
                if (pts.length < 2) return;
                const cx = pts[0]![0];
                const cy = pts[0]![1];
                const r = Math.hypot(pts[1]![0] - cx, pts[1]![1] - cy);
                if (r < 1) return;
                if (d.style.fillColor) {
                    ctx.save();
                    ctx.fillStyle = d.style.fillColor; // alpha lives in the fill color itself
                    ctx.beginPath();
                    ctx.arc(cx, cy, r, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                }
                this.applyStroke(ctx, d.style);
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                break;
            }
            case 'box': {
                const pts = d.handlePoints(proj);
                if (pts.length < 2) return;
                const x = Math.min(pts[0]![0], pts[1]![0]);
                const y = Math.min(pts[0]![1], pts[1]![1]);
                const w = Math.abs(pts[1]![0] - pts[0]![0]);
                const h = Math.abs(pts[1]![1] - pts[0]![1]);
                if (d.style.fillColor) {
                    ctx.save();
                    ctx.fillStyle = d.style.fillColor; // alpha lives in the fill color itself

                    ctx.fillRect(x, y, w, h);
                    ctx.restore();
                }
                this.applyStroke(ctx, d.style);
                ctx.strokeRect(x, y, w, h);
                ctx.setLineDash([]);
                break;
            }
            default:
                break; // text has no geometry — its label is drawn below
        }
        this.paintLabel(ctx, d, proj, theme); // every drawing can carry an optional label
    }

    /** Draw a drawing's optional text label at a type-appropriate anchor (multi-line aware). */
    private paintLabel(ctx: CanvasRenderingContext2D, d: Drawing, proj: Projector, theme: VelaTheme): void {
        const text = d.text;
        if (!text || !text.value) return;
        const layout = labelLayout(d, proj);
        if (!layout) return;
        const fs = namedFontSize(text.size);
        ctx.font = `${text.bold ? 'bold ' : ''}${text.italic ? 'italic ' : ''}${fs}px ${theme.fontFamily}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = layout.align;
        ctx.fillStyle = text.color ?? theme.textColor;
        const lh = fs * 1.4;
        text.value.split('\n').forEach((line, i) => ctx.fillText(line, layout.x, layout.top + i * lh));
        ctx.textAlign = 'left';
    }

    /** Paint any Fibonacci tool from its resolved entry lines: optional fill bands, then each
     *  colored line with its auto-number + optional centered custom label (both per-tool sized). */
    private paintFibRatios(ctx: CanvasRenderingContext2D, d: FibRatios, proj: Projector, theme: VelaTheme): void {
        const lines = d.entryLines(proj);
        if (!lines || lines.length === 0) return;
        for (const band of d.fillBands(proj)) {
            ctx.save();
            ctx.globalAlpha = 0.06 * ctx.globalAlpha;
            ctx.fillStyle = band.color;
            ctx.fillRect(band.x, band.y, band.w, band.h);
            ctx.restore();
        }
        ctx.textBaseline = 'middle';
        const numFont = `${namedFontSize(d.numbersSize)}px ${theme.fontFamily}`;
        const lblFont = `${namedFontSize(d.labelsSize)}px ${theme.fontFamily}`;
        for (const l of lines) {
            this.stroke(ctx, { ...d.style, lineColor: l.color }, () => {
                ctx.moveTo(l.x1, l.y1);
                ctx.lineTo(l.x2, l.y2);
            });
            ctx.fillStyle = l.color;
            ctx.font = numFont;
            ctx.textAlign = l.numberAlign;
            ctx.fillText(l.numberText, l.numberX, l.numberY);
            if (l.label) {
                ctx.font = lblFont;
                ctx.textAlign = 'center';
                ctx.fillText(l.label, l.labelX, l.labelY);
            }
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    /** Paint a concentric-ring fib tool (circles / arcs / wedge): each enabled level as an arc of
     *  radius R0·ratio over the tool's angular sweep, plus any bounding lines + a ratio label per ring. */
    private paintRadialFib(ctx: CanvasRenderingContext2D, d: RadialFib, proj: Projector, theme: VelaTheme): void {
        const g = d.radial(proj);
        if (g && g.R0 >= 1) {
            const font = `${namedFontSize(d.numbersSize)}px ${theme.fontFamily}`;
            const mid = (g.a0 + g.a1) / 2;
            ctx.textBaseline = 'middle';
            for (const lv of d.levels) {
                if (!lv.enabled) continue;
                const r = g.R0 * lv.ratio;
                if (r < 0.5) continue;
                this.applyStroke(ctx, { ...d.style, lineColor: lv.color });
                ctx.beginPath();
                ctx.arc(g.cx, g.cy, r, g.a0, g.a1);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = lv.color;
                ctx.font = font;
                ctx.textAlign = 'left';
                ctx.fillText(String(lv.ratio), g.cx + Math.cos(mid) * r + 3, g.cy + Math.sin(mid) * r);
            }
            ctx.textBaseline = 'alphabetic';
            ctx.textAlign = 'left';
        }
        for (const b of d.boundingLines(proj)) {
            this.stroke(ctx, d.style, () => {
                ctx.moveTo(b[0], b[1]);
                ctx.lineTo(b[2], b[3]);
            });
        }
    }

    /** Paint a Gann square's concentric quarter-ellipse arcs, centered on the origin corner and
     *  sized as fractions of the box (so they match its pixel aspect). */
    private paintGannArcs(ctx: CanvasRenderingContext2D, d: GannSquare, proj: Projector): void {
        const g = d.arcGeom(proj);
        if (!g || Math.abs(g.bx) < 1 || Math.abs(g.py) < 1) return;
        const N = 24; // samples per quarter
        for (const arc of GANN_SQUARE_ARCS) {
            this.applyStroke(ctx, { ...d.style, lineColor: arc.color });
            ctx.beginPath();
            for (let i = 0; i <= N; i += 1) {
                const t = (i / N) * (Math.PI / 2);
                const x = g.ox + arc.k * g.bx * Math.cos(t);
                const y = g.oy + arc.k * g.py * Math.sin(t);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    /** Paint a Fibonacci spiral as a sampled polyline. */
    private paintFibSpiral(ctx: CanvasRenderingContext2D, d: FibSpiral, proj: Projector): void {
        const pts = d.spiralPoints(proj);
        if (!pts || pts.length < 2) return;
        this.stroke(ctx, d.style, () => {
            ctx.moveTo(pts[0]![0], pts[0]![1]);
            for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i]![0], pts[i]![1]);
        });
    }

    /** Paint a Mach wavefront figure (sonic wall or supersonic cone) + the Huygens circles. */
    private paintMachFigure(ctx: CanvasRenderingContext2D, d: MachFigure, proj: Projector, theme: VelaTheme): void {
        const g = d.geom(proj);
        if (!g) return;
        for (const c of g.circles) {
            this.applyStroke(ctx, { ...d.style, lineColor: c.color });
            ctx.beginPath();
            ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
            ctx.stroke();
        }
        // Envelope (shock wall or Mach-cone generators) slightly stronger, in the line color.
        this.applyStroke(ctx, d.style);
        ctx.lineWidth = d.style.lineWidth + 0.5;
        for (const r of g.rays) {
            ctx.beginPath();
            ctx.moveTo(r[0], r[1]);
            ctx.lineTo(r[2], r[3]);
            ctx.stroke();
        }
        // Nose marker
        ctx.beginPath();
        ctx.arc(g.noseX, g.noseY, Math.max(2.5, d.style.lineWidth + 1.5), 0, Math.PI * 2);
        ctx.fillStyle = d.style.lineColor;
        ctx.fill();
        ctx.setLineDash([]);
        // Ratio labels sit just outside each circle along the expansion direction.
        if (d.showRatios !== false) {
            const font = `${namedFontSize('small')}px ${theme.fontFamily}`;
            ctx.font = font;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            for (const c of g.circles) {
                const lx = c.cx + g.fx * c.r + 4;
                const ly = c.cy + g.fy * c.r;
                ctx.fillStyle = c.color;
                ctx.fillText(formatMachRatio(c.ratio), lx, ly);
            }
            ctx.textBaseline = 'alphabetic';
            ctx.textAlign = 'left';
        }
    }

    /** Paint a Dedekind tessellation: box border + clipped semicircles/verticals (modular tiling). */
    private paintDedekind(ctx: CanvasRenderingContext2D, d: DedekindTessellation, proj: Projector): void {
        const box = d.box(proj);
        const geoms = d.geodesics(proj);
        if (!box || !geoms) return;
        const { left, right, top, bot } = box;
        // Light border so the user-defined range stays visible.
        ctx.save();
        this.applyStroke(ctx, d.style);
        ctx.globalAlpha *= 0.45;
        ctx.strokeRect(left, top, right - left, bot - top);
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, right - left, bot - top);
        ctx.clip();
        this.applyStroke(ctx, d.style);
        for (const g of geoms) {
            ctx.beginPath();
            if (g.kind === 'vline') {
                ctx.moveTo(g.x, g.y0);
                ctx.lineTo(g.x, g.y1);
            } else {
                // Clockwise π→0 on a y-down canvas sweeps the upper semicircle (into the box).
                ctx.arc(g.cx, g.cy, g.r, Math.PI, 0, false);
            }
            ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
    }

    /** Paint a measurement box: a direction-tinted (green up / red down) shaded rect with a
     *  centered, multi-line label of the computed price/time deltas. */
    private paintMeasureBox(ctx: CanvasRenderingContext2D, d: MeasureBox, proj: Projector, theme: VelaTheme): void {
        const pts = d.handlePoints(proj);
        if (pts.length < 2) return;
        const x = Math.min(pts[0]![0], pts[1]![0]);
        const y = Math.min(pts[0]![1], pts[1]![1]);
        const w = Math.abs(pts[1]![0] - pts[0]![0]);
        const h = Math.abs(pts[1]![1] - pts[0]![1]);
        const color = d.isUp() ? BULLISH : BEARISH;
        ctx.save();
        ctx.globalAlpha = 0.12 * ctx.globalAlpha;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        ctx.setLineDash(dashPattern(d.style.lineStyle, d.style.lineWidth));
        ctx.strokeStyle = color;
        ctx.lineWidth = d.style.lineWidth;
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        const lines = d.measureLabel(proj);
        const fs = namedFontSize(d.text?.size ?? 'normal');
        ctx.fillStyle = d.text?.color ?? theme.textColor;
        ctx.font = `${fs}px ${theme.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lh = Math.round(fs * 1.35);
        const startY = y + h / 2 - ((lines.length - 1) * lh) / 2;
        lines.forEach((line, i) => ctx.fillText(line, x + w / 2, startY + i * lh));
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    /** Paint a position tool: a green reward zone (entry↔target) + red risk zone (entry↔stop),
     *  the three level lines, and a `DIR · R:R` + target/stop % label. */
    private paintPosition(ctx: CanvasRenderingContext2D, d: PositionTool, proj: Projector, theme: VelaTheme): void {
        const L = d.layout(proj);
        if (!L) return;
        const { x1, x2, ey, sy, ty } = L;
        const w = x2 - x1;
        const GREEN = BULLISH;
        const RED = BEARISH;
        const zone = (yA: number, yB: number, color: string): void => {
            ctx.save();
            ctx.globalAlpha = 0.13 * ctx.globalAlpha;
            ctx.fillStyle = color;
            ctx.fillRect(x1, Math.min(yA, yB), w, Math.abs(yB - yA));
            ctx.restore();
        };
        zone(ey, ty, GREEN); // reward
        zone(ey, sy, RED); // risk
        const line = (y: number, color: string): void =>
            this.stroke(ctx, { ...d.style, lineColor: color }, () => {
                ctx.moveTo(x1, y);
                ctx.lineTo(x2, y);
            });
        line(ty, GREEN);
        line(sy, RED);
        line(ey, d.style.lineColor); // entry — accent
        const cx = x1 + w / 2;
        ctx.fillStyle = theme.textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `12px ${theme.fontFamily}`;
        ctx.fillText(`${d.directionLabel()}  ·  R:R ${d.rr().toFixed(2)}`, cx, Math.min(ey, sy, ty) - 9);
        ctx.font = `11px ${theme.fontFamily}`;
        ctx.fillText(`Target +${d.rewardPct().toFixed(2)}%`, cx, (ey + ty) / 2);
        ctx.fillText(`Stop −${d.riskPct().toFixed(2)}%`, cx, (ey + sy) / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    /** Paint a linear-regression channel: the two shaded bands (mid→upper, mid→lower), the three
     *  lines (upper/mid/lower, each with its own color + dash), and the R² readout at the start. */
    private paintRegressionChannel(ctx: CanvasRenderingContext2D, d: RegressionChannel, proj: Projector, theme: VelaTheme): void {
        const L = d.layout(proj);
        if (!L) return;
        const s = d.reg;
        const quad = (color: string, y0: number, y1: number, yy0: number, yy1: number): void => {
            ctx.save();
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(L.x0, y0);
            ctx.lineTo(L.x1, y1);
            ctx.lineTo(L.x1, yy1);
            ctx.lineTo(L.x0, yy0);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        };
        quad(s.upperFill, L.midY0, L.midY1, L.upperY0, L.upperY1); // mid → upper (green by default)
        quad(s.lowerFill, L.midY0, L.midY1, L.lowerY0, L.lowerY1); // mid → lower (red by default)
        const line = (color: string, lineStyle: RegressionChannel['reg']['midStyle'], y0: number, y1: number): void =>
            this.stroke(ctx, { lineColor: color, lineWidth: d.style.lineWidth, lineStyle }, () => {
                ctx.moveTo(L.x0, y0);
                ctx.lineTo(L.x1, y1);
            });
        line(s.upperColor, s.upperStyle, L.upperY0, L.upperY1);
        line(s.lowerColor, s.lowerStyle, L.lowerY0, L.lowerY1);
        line(s.midColor, s.midStyle, L.midY0, L.midY1);
        if (L.showR2) {
            const txt = `R² ${Math.round(L.r2 * 100)}%`;
            ctx.font = `11px ${theme.fontFamily}`;
            const tw = ctx.measureText(txt).width;
            const pad = 5;
            const gap = 4;
            const boxW = tw + pad * 2;
            const bx = L.x0 - gap - boxW; // badge sits left of the channel start, not inside it
            const by = L.midY0 - 9;
            ctx.save();
            ctx.globalAlpha = 0.9 * ctx.globalAlpha;
            roundRect(ctx, bx, by - 8, boxW, 16, 3);
        ctx.fillStyle = BADGE_FILL;
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = theme.textColor;
        ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(txt, bx + pad, by);
            ctx.textBaseline = 'alphabetic';
        }
    }

    /** Paint a fixed-range volume profile: horizontal histogram rows (up/down split) anchored to
     *  the left or right of the time span, optional VAH / VAL / POC levels across the range, and
     *  optional developing POC / VA polylines. Recomputes from the two anchors on every paint. */
    private paintFixedRangeVp(ctx: CanvasRenderingContext2D, d: FixedRangeVolumeProfile, proj: Projector): void {
        const L = d.layout(proj);
        if (!L) return;
        const s = d.frvp;
        const { profile, maxW, anchorX, grow, yEdges } = L;
        if (profile.maxTotal <= 0 || maxW <= 0) return;

        for (let k = 0; k < profile.rows.length; k += 1) {
            const row = profile.rows[k]!;
            const total = row.up + row.down;
            if (total <= 0) continue;
            // yEdges[k] = lower price bound; canvas y grows downward so the top edge is the higher index.
            const yA = yEdges[k]!;
            const yB = yEdges[k + 1]!;
            const yTop = Math.min(yA, yB);
            const h = Math.max(1, Math.abs(yB - yA) - 1);
            const w = (total / profile.maxTotal) * maxW;
            const upW = (row.up / total) * w;
            const inVa = k >= profile.vaFrom && k <= profile.vaTo;
            const upColor = inVa ? s.vaUpColor : s.upColor;
            const downColor = inVa ? s.vaDownColor : s.downColor;
            const x0 = grow === 1 ? anchorX : anchorX - w;
            if (upW > 0) {
                ctx.fillStyle = upColor;
                ctx.fillRect(x0, yTop, upW, h);
            }
            if (w - upW > 0) {
                ctx.fillStyle = downColor;
                ctx.fillRect(x0 + upW, yTop, w - upW, h);
            }
        }

        const w = d.style.lineWidth;
        const hLine = (show: boolean, color: string, style: DrawingStyle['lineStyle'], y: number | null): void => {
            if (!show || y == null || isTransparent(color)) return;
            this.stroke(ctx, { lineColor: color, lineWidth: w, lineStyle: style }, () => {
                ctx.moveTo(L.x0, y);
                ctx.lineTo(L.x1, y);
            });
        };
        hLine(s.showVah, s.vahColor, s.vahStyle, L.vahY);
        hLine(s.showVal, s.valColor, s.valStyle, L.valY);
        hLine(s.showPoc, s.pocColor, s.pocStyle, L.pocY);

        // Developing levels sit on top of the histogram so they stay readable.
        const devW = Math.max(1, w);
        if (s.showDevelopingPoc) {
            this.strokePolyline(ctx, L.developingPoc, {
                lineColor: s.developingPocColor,
                lineWidth: devW,
                lineStyle: s.developingPocStyle,
            });
        }
        if (s.showDevelopingVa) {
            const devStyle = { lineColor: s.developingVaColor, lineWidth: devW, lineStyle: s.developingVaStyle };
            this.strokePolyline(ctx, L.developingVaHigh, devStyle);
            this.strokePolyline(ctx, L.developingVaLow, devStyle);
        }
    }

    /** Paint an anchored VWAP: the shaded band between the upper/lower σ curves, the two band
     *  edges (transparent by default), then the VWAP midline on top. All three are polylines that
     *  recompute from the anchor time forward, so the shape follows the bars live. */
    private paintAnchoredVwap(ctx: CanvasRenderingContext2D, d: AnchoredVwap, proj: Projector): void {
        const L = d.layout(proj);
        if (!L) return;
        const s = d.vwap;
        const w = d.style.lineWidth;
        if (L.upper.length >= 2 && s.bandFill) {
            ctx.save();
            ctx.fillStyle = s.bandFill; // opacity lives in the fill color's own alpha
            ctx.beginPath();
            ctx.moveTo(L.upper[0]![0], L.upper[0]![1]);
            for (let i = 1; i < L.upper.length; i += 1) ctx.lineTo(L.upper[i]![0], L.upper[i]![1]);
            for (let i = L.lower.length - 1; i >= 0; i -= 1) ctx.lineTo(L.lower[i]![0], L.lower[i]![1]);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        this.strokePolyline(ctx, L.upper, { lineColor: s.upperColor, lineWidth: w, lineStyle: s.upperStyle });
        this.strokePolyline(ctx, L.lower, { lineColor: s.lowerColor, lineWidth: w, lineStyle: s.lowerStyle });
        this.strokePolyline(ctx, L.mid, { lineColor: s.midColor, lineWidth: w, lineStyle: s.midStyle });
    }

    /** Stroke a connected polyline with a line style (dash + width + color). Skips fully-transparent
     *  colors so the default (hidden) band edges cost nothing. */
    private strokePolyline(ctx: CanvasRenderingContext2D, pts: ReadonlyArray<[number, number]>, style: DrawingStyle): void {
        if (pts.length < 2 || isTransparent(style.lineColor)) return;
        this.stroke(ctx, style, () => {
            ctx.moveTo(pts[0]![0], pts[0]![1]);
            for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i]![0], pts[i]![1]);
        });
    }

    /** Paint a callout as a speech bubble: a rounded text box with a tapered triangular tail
     *  flush on the box edge facing the target, its apex at the target point. */
    private paintCallout(ctx: CanvasRenderingContext2D, d: Callout, proj: Projector, theme: VelaTheme): void {
        this.paintBubble(ctx, d, proj, theme, 5); // squared-off corners
    }

    /** A Comment is a Callout with fully-rounded (balloon) corners. */
    private paintComment(ctx: CanvasRenderingContext2D, d: Comment, proj: Projector, theme: VelaTheme): void {
        this.paintBubble(ctx, d, proj, theme, 999); // clamped to min(w,h)/2 → a rounded balloon
    }

    private paintBubble(ctx: CanvasRenderingContext2D, d: CalloutBase, proj: Projector, theme: VelaTheme, maxRadius: number): void {
        const p = d.points(proj);
        if (!p) return;
        const tx = p[0][0];
        const ty = p[0][1];
        const cx = p[1][0];
        const cy = p[1][1];
        const text = d.text;
        const fs = namedFontSize(text?.size ?? 'normal');
        ctx.font = `${text?.bold ? 'bold ' : ''}${text?.italic ? 'italic ' : ''}${fs}px ${theme.fontFamily}`;
        const lines = (text?.value ?? '').split('\n');
        const tw = Math.max(8, ...lines.map((l) => ctx.measureText(l).width));
        const padX = 9;
        const padY = 6;
        const lh = Math.round(fs * 1.4);
        const w = tw + padX * 2;
        const h = lines.length * lh + padY * 2;
        const x = cx - w / 2;
        const y = cy - h / 2;
        const hw = w / 2;
        const hh = h / 2;
        const dx = tx - cx;
        const dy = ty - cy;
        const r = Math.min(maxRadius, w / 2, h / 2);

        // The tail: which box edge it exits, where along that edge, and its apex at the target —
        // only when the target is outside the box.
        let tail: { edge: 'top' | 'right' | 'bottom' | 'left'; at: number; apex: [number, number]; half: number } | null = null;
        if (Math.abs(dx) > hw || Math.abs(dy) > hh) {
            const half = Math.max(6, Math.min(w, h) * 0.18);
            if (Math.abs(dx) / hw >= Math.abs(dy) / hh) {
                const ex = dx > 0 ? x + w : x;
                const at = Math.max(y + r + half, Math.min(y + h - r - half, cy + (dy * (ex - cx)) / (dx || 1)));
                tail = { edge: dx > 0 ? 'right' : 'left', at, apex: [tx, ty], half };
            } else {
                const ey = dy > 0 ? y + h : y;
                const at = Math.max(x + r + half, Math.min(x + w - r - half, cx + (dx * (ey - cy)) / (dy || 1)));
                tail = { edge: dy > 0 ? 'bottom' : 'top', at, apex: [tx, ty], half };
            }
        }

        // One continuous outline for the box + tail, so the border never crosses the tail base
        // (the pointer side is "open" — the path detours out to the apex and back).
        ctx.save();
        ctx.fillStyle = effectiveFillColor(d, theme) ?? theme.background; // alpha lives in the fill color itself
        calloutBubblePath(ctx, x, y, w, h, r, tail);
        ctx.fill();
        ctx.restore();
        this.applyStroke(ctx, d.style);
        calloutBubblePath(ctx, x, y, w, h, r, tail);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = text?.color ?? theme.textColor;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        lines.forEach((line, i) => ctx.fillText(line, x + padX, y + padY + i * lh));
    }

    /** Shared text-box body for the note/signpost plates: a rounded filled+stroked rect with
     *  multi-line text, anchored at (x, y) top-left. Returns nothing. */
    private paintTextPlate(ctx: CanvasRenderingContext2D, d: Drawing, theme: VelaTheme, x: number, y: number, w: number, h: number, lines: string[], lh: number, padX: number, padY: number): void {
        ctx.save();
        ctx.fillStyle = effectiveFillColor(d, theme) ?? theme.background;
        roundRect(ctx, x, y, w, h, 5);
        ctx.fill();
        ctx.restore();
        this.applyStroke(ctx, d.style);
        roundRect(ctx, x, y, w, h, 5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = d.text?.color ?? theme.textColor;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        lines.forEach((line, i) => ctx.fillText(line, x + padX, y + padY + i * lh));
    }

    /** Measure a drawing's text into wrapped lines + a box size at its named font. */
    private measureText(ctx: CanvasRenderingContext2D, d: Drawing, theme: VelaTheme, fallback: string): { lines: string[]; tw: number; fs: number; lh: number } {
        const text = d.text;
        const fs = namedFontSize(text?.size ?? 'normal');
        ctx.font = `${text?.bold ? 'bold ' : ''}${text?.italic ? 'italic ' : ''}${fs}px ${theme.fontFamily}`;
        const lines = (text?.value || fallback).split('\n');
        const tw = Math.max(8, ...lines.map((l) => ctx.measureText(l).width));
        return { lines, tw, fs, lh: Math.round(fs * 1.4) };
    }

    /** A Note: free text on a rounded plate anchored at the point (top-left). */
    private paintNote(ctx: CanvasRenderingContext2D, d: Note, proj: Projector, theme: VelaTheme): void {
        const pts = d.handlePoints(proj);
        if (!pts.length) return;
        const [ax, ay] = pts[0]!;
        const { lines, tw, lh } = this.measureText(ctx, d, theme, 'Note');
        const padX = 8;
        const padY = 5;
        this.paintTextPlate(ctx, d, theme, ax, ay, tw + padX * 2, lines.length * lh + padY * 2, lines, lh, padX, padY);
    }

    /** A Price Note: a box joined to the pinned point by a leader + a dot, showing that point's
     *  auto-formatted price (not free text). */
    private paintPriceNote(ctx: CanvasRenderingContext2D, d: PriceNote, proj: Projector, theme: VelaTheme): void {
        const p = d.points(proj);
        const a = d.anchors[0];
        if (!p || !a) return;
        const [tx, ty] = p[0];
        const [cx, cy] = p[1];
        const priceStr = formatPriceTag(a.price);
        const text = d.text;
        const fs = namedFontSize(text?.size ?? 'normal');
        ctx.font = `${text?.bold ? 'bold ' : ''}${text?.italic ? 'italic ' : ''}${fs}px ${theme.fontFamily}`;
        const padX = 9;
        const padY = 6;
        const w = ctx.measureText(priceStr).width + padX * 2;
        const h = Math.round(fs * 1.4) + padY * 2;
        const x = cx - w / 2;
        const y = cy - h / 2;
        this.stroke(ctx, d.style, () => {
            ctx.moveTo(tx, ty);
            ctx.lineTo(cx, cy);
        });
        ctx.fillStyle = d.style.lineColor;
        ctx.beginPath();
        ctx.arc(tx, ty, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.fillStyle = effectiveFillColor(d, theme) ?? theme.background;
        roundRect(ctx, x, y, w, h, 5);
        ctx.fill();
        ctx.restore();
        this.applyStroke(ctx, d.style);
        roundRect(ctx, x, y, w, h, 5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = text?.color ?? '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(priceStr, cx, cy + 0.5);
    }

    /** A Signpost: a sign plate on a pole rising from a pinned level (a base nub). */
    private paintSignpost(ctx: CanvasRenderingContext2D, d: Signpost, proj: Projector, theme: VelaTheme): void {
        const p = d.points(proj);
        if (!p) return;
        const [bx, by] = p[0];
        const [sx, sy] = p[1];
        const { lines, tw, lh } = this.measureText(ctx, d, theme, 'Signpost');
        const padX = 9;
        const padY = 6;
        const w = tw + padX * 2;
        const h = lines.length * lh + padY * 2;
        this.stroke(ctx, d.style, () => {
            ctx.moveTo(bx, by);
            ctx.lineTo(sx, sy);
        });
        ctx.fillStyle = d.style.lineColor;
        ctx.beginPath();
        ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
        ctx.fill();
        this.paintTextPlate(ctx, d, theme, sx - w / 2, sy - h / 2, w, h, lines, lh, padX, padY);
    }

    /** A Price Label: a left-pointing tag at the anchor showing the auto-formatted price. */
    private paintPriceLabel(ctx: CanvasRenderingContext2D, d: PriceLabel, proj: Projector, theme: VelaTheme): void {
        const pts = d.handlePoints(proj);
        const a = d.anchors[0];
        if (!pts.length || !a) return;
        const [ax, ay] = pts[0]!;
        const priceStr = formatPriceTag(a.price);
        const text = d.text;
        const fs = namedFontSize(text?.size ?? 'normal');
        ctx.font = `${text?.bold ? 'bold ' : ''}${text?.italic ? 'italic ' : ''}${fs}px ${theme.fontFamily}`;
        const tw = ctx.measureText(priceStr).width;
        const padX = 8;
        const padY = 4;
        const ptr = 6; // left pointer width
        const w = tw + padX * 2;
        const h = Math.round(fs * 1.4) + padY * 2;
        const y = ay - h / 2;
        const fill = effectiveFillColor(d, theme) ?? theme.background;
        ctx.save();
        ctx.fillStyle = fill;
        ctx.beginPath(); // pointer triangle from the anchor pixel
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + ptr, ay - 5);
        ctx.lineTo(ax + ptr, ay + 5);
        ctx.closePath();
        ctx.fill();
        roundRect(ctx, ax + ptr, y, w, h, 4);
        ctx.fill();
        ctx.restore();
        this.applyStroke(ctx, d.style);
        roundRect(ctx, ax + ptr, y, w, h, 4);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = text?.color ?? '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(priceStr, ax + ptr + padX, ay + 0.5);
    }

    /** Paint a pattern: optional tinted body triangles, the labelled polyline, an extended
     *  neckline (head & shoulders), and consecutive-leg ratios (harmonic patterns). */
    private paintPattern(ctx: CanvasRenderingContext2D, d: PatternDrawing, proj: Projector, theme: VelaTheme): void {
        const pts = d.handlePoints(proj);
        if (pts.length < 2) return;
        const valid = d.valid(); // harmonic validity (null for plain patterns)
        // shared resolution (so the settings swatch matches): explicit fillColor wins, else the
        // validity tint / line-color wash. The user color carries its own alpha; the wash stays light.
        const fillColor = effectiveFillColor(d, theme) ?? d.style.lineColor;
        const fillAlpha = d.style.fillColor ? 1 : 0.1;
        for (const [i, j, k] of d.fillTriangles()) {
            const a = pts[i];
            const b = pts[j];
            const c = pts[k];
            if (!a || !b || !c) continue;
            ctx.save();
            ctx.globalAlpha = fillAlpha * ctx.globalAlpha;
            ctx.fillStyle = fillColor;
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.lineTo(c[0], c[1]);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        this.stroke(ctx, d.style, () => {
            ctx.moveTo(pts[0]![0], pts[0]![1]);
            for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i]![0], pts[i]![1]);
        });
        const nl = d.necklineIndices();
        if (nl) {
            const a = pts[nl[0]];
            const b = pts[nl[1]];
            const n = pts.length;
            if (a && b && n >= 2) {
                // clip the neckline to where it crosses the first (start→LS) and last (RS→end) legs,
                // falling back to the troughs themselves when a leg doesn't reach the neckline.
                const left = lineSegmentIntersection(a[0], a[1], b[0], b[1], pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1]) ?? a;
                const right = lineSegmentIntersection(a[0], a[1], b[0], b[1], pts[n - 2]![0], pts[n - 2]![1], pts[n - 1]![0], pts[n - 1]![1]) ?? b;
                this.stroke(ctx, { ...d.style, lineStyle: 'dashed' }, () => {
                    ctx.moveTo(left[0], left[1]);
                    ctx.lineTo(right[0], right[1]);
                });
            }
        }
        const labels = d.vertexLabels();
        ctx.fillStyle = theme.textColor;
        ctx.font = `bold 12px ${theme.fontFamily}`;
        ctx.textAlign = 'center';
        pts.forEach((p, i) => {
            const lbl = labels[i];
            if (!lbl) return;
            const ny = ((pts[i - 1]?.[1] ?? p[1]) + (pts[i + 1]?.[1] ?? p[1])) / 2;
            const above = p[1] <= ny; // a local peak → label above, a trough → below
            ctx.textBaseline = above ? 'bottom' : 'top';
            ctx.fillText(lbl, p[0], above ? p[1] - 7 : p[1] + 7);
        });
        if (d.legRatios()) {
            ctx.font = `11px ${theme.fontFamily}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (let i = 2; i < pts.length; i += 1) {
                const r = d.ratioAt(i);
                const a = pts[i - 1];
                const b = pts[i];
                if (r == null || !a || !b) continue;
                const ok = d.ratioOk(i); // green in-band / red out / theme color when no rule
                ctx.fillStyle = ok === true ? VALID_FILL : ok === false ? INVALID_FILL : theme.textColor;
                ctx.fillText(r.toFixed(3), (a[0] + b[0]) / 2 + 6, (a[1] + b[1]) / 2);
            }
        }
        const name = d.patternName(); // harmonic name + ✓/✗ badge at the completion point (D)
        if (name && pts.length >= 2) {
            const dPt = pts[pts.length - 1]!;
            const prev = pts[pts.length - 2];
            const above = prev ? dPt[1] <= prev[1] : false; // D a peak → label above, else below
            ctx.font = `bold 12px ${theme.fontFamily}`;
            ctx.fillStyle = valid === false ? INVALID_FILL : VALID_FILL;
            ctx.textAlign = 'center';
            ctx.textBaseline = above ? 'bottom' : 'top';
            ctx.fillText(`${name} ${valid ? '✓' : '✗'}`, dPt[0], above ? dPt[1] - 22 : dPt[1] + 22);
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    /** Paint a highlighter: the captured path as ONE wide, round-capped translucent swath. Drawing
     *  it as a single continuous stroke (not per-segment) keeps a stroke's overlaps from compounding
     *  alpha, so it reads as one even highlight — the see-through comes from the color's own alpha. */
    private paintHighlighter(ctx: CanvasRenderingContext2D, d: SegmentDrawing, proj: Projector): void {
        const g = d.geometry(proj);
        if (!g || g.segments.length === 0) return;
        ctx.save();
        ctx.strokeStyle = d.style.lineColor; // alpha lives in the color itself
        ctx.lineWidth = d.style.lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);
        ctx.beginPath();
        const first = g.segments[0]!;
        ctx.moveTo(first[0], first[1]);
        for (const s of g.segments) ctx.lineTo(s[2], s[3]);
        ctx.stroke();
        ctx.restore();
    }

    /** Paint a multi-line drawing (channel/pitchfork): optional fill polygon, then each line. */
    private paintSegments(ctx: CanvasRenderingContext2D, d: SegmentDrawing, proj: Projector): void {
        const g = d.geometry(proj);
        if (!g) return;
        if (g.fill && g.fill.length >= 3 && d.style.fillColor) {
            ctx.save();
            ctx.fillStyle = d.style.fillColor; // alpha lives in the fill color itself
            ctx.beginPath();
            ctx.moveTo(g.fill[0]![0], g.fill[0]![1]);
            for (let i = 1; i < g.fill.length; i += 1) ctx.lineTo(g.fill[i]![0], g.fill[i]![1]);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        for (const s of g.segments) {
            this.stroke(ctx, d.style, () => {
                ctx.moveTo(s[0], s[1]);
                ctx.lineTo(s[2], s[3]);
            });
        }
    }

    /** Paint an info line: the segment + a midpoint box reading price change, percent, and bar count
     *  (green when up, red when down). */
    private paintInfoLine(ctx: CanvasRenderingContext2D, d: Drawing, proj: Projector): void {
        const pts = d.handlePoints(proj);
        if (pts.length < 2) return;
        const [x1, y1] = pts[0]!;
        const [x2, y2] = pts[1]!;
        this.stroke(ctx, d.style, () => {
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
        });
        const a = d.anchors[0];
        const b = d.anchors[1];
        if (!a || !b) return;
        const priceChange = b.price - a.price;
        const pct = a.price !== 0 ? (priceChange / a.price) * 100 : 0;
        const bars = proj.barsBetween ? Math.abs(Math.round(proj.barsBetween(a.time, b.time))) : 0;
        const sign = priceChange >= 0 ? '+' : '';
        const txt = `${sign}${priceChange.toFixed(2)} (${sign}${pct.toFixed(2)}%)  ${bars} bars`;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        ctx.font = '11px monospace';
        const bw = ctx.measureText(txt).width + 12;
        const bh = 18;
        const bx = mx - 2;
        const by = my - bh - 4; // sits just above the midpoint
        ctx.save();
        ctx.globalAlpha = 0.9 * ctx.globalAlpha;
        roundRect(ctx, bx, by, bw, bh, 3);
        ctx.fillStyle = BADGE_FILL;
        ctx.fill();
        ctx.strokeStyle = BADGE_STROKE;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = priceChange >= 0 ? BULLISH : BEARISH;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, bx + 6, by + bh / 2);
        ctx.textBaseline = 'alphabetic';
    }

    /** Paint a trend angle: the segment + a faint dashed baseline, an arc, and a degree readout at
     *  the start anchor. The angle is the on-screen (pixel) inclination, so it changes with zoom. */
    private paintTrendAngle(ctx: CanvasRenderingContext2D, d: Drawing, proj: Projector, theme: VelaTheme): void {
        const pts = d.handlePoints(proj);
        if (pts.length < 2) return;
        const [x1, y1] = pts[0]!;
        const [x2, y2] = pts[1]!;
        this.stroke(ctx, d.style, () => {
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
        });
        const dx = x2 - x1;
        const dy = y2 - y1;
        const angleRad = Math.atan2(-dy, dx); // screen Y is inverted → negate for a natural angle
        const angleDeg = angleRad * (180 / Math.PI);
        const arcR = Math.min(30, Math.hypot(dx, dy) * 0.3);
        const color = d.style.lineColor;
        // faint dashed horizontal baseline (the 0° reference)
        ctx.save();
        ctx.globalAlpha = 0.4 * ctx.globalAlpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + Math.max(Math.abs(dx), arcR + 20), y1);
        ctx.stroke();
        ctx.restore();
        ctx.setLineDash([]);
        // the angle arc, swept from the baseline to the line
        if (arcR > 1) {
            const end = -angleRad; // canvas-space angle of the line
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(x1, y1, arcR, Math.min(0, end), Math.max(0, end));
            ctx.stroke();
        }
        ctx.fillStyle = color;
        ctx.font = `11px ${theme.fontFamily}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(`${angleDeg.toFixed(1)}°`, x1 + arcR + 6, y1 + (dy < 0 ? -14 : 2));
    }

    /** Paint a fixed-size arrow marker as a filled glyph at its anchor. */
    private paintArrowMark(ctx: CanvasRenderingContext2D, d: ArrowMark, proj: Projector): void {
        const g = d.glyphPoints(proj);
        if (!g || g.length < 3) return;
        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = d.style.lineColor;
        ctx.beginPath();
        ctx.moveTo(g[0]![0], g[0]![1]);
        for (let i = 1; i < g.length; i += 1) ctx.lineTo(g[i]![0], g[i]![1]);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    /** A glyph/icon stamp: a fixed-pixel unicode symbol centered on the anchor (tints with the
     *  stamp color; emoji render in their own color). */
    private paintGlyphStamp(ctx: CanvasRenderingContext2D, d: GlyphStamp, proj: Projector, theme: VelaTheme): void {
        const c = d.center(proj);
        if (!c) return;
        ctx.save();
        ctx.setLineDash([]);
        ctx.font = `${d.sizePx()}px ${theme.fontFamily}`;
        ctx.fillStyle = d.style.lineColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.glyph, c[0], c[1]);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
    }

    /** A filled triangular arrowhead at `to`, pointing along the `from`→`to` direction. */
    private paintArrowhead(ctx: CanvasRenderingContext2D, from: readonly [number, number], to: readonly [number, number], style: DrawingStyle): void {
        const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
        const len = Math.max(9, style.lineWidth * 3.5);
        const spread = Math.PI / 7;
        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = style.lineColor;
        ctx.beginPath();
        ctx.moveTo(to[0], to[1]);
        ctx.lineTo(to[0] - len * Math.cos(ang - spread), to[1] - len * Math.sin(ang - spread));
        ctx.lineTo(to[0] - len * Math.cos(ang + spread), to[1] - len * Math.sin(ang + spread));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    /** Stroke a path with the drawing's line style (dash + width + color), then reset the dash. */
    private stroke(ctx: CanvasRenderingContext2D, style: DrawingStyle, path: () => void): void {
        this.applyStroke(ctx, style);
        ctx.beginPath();
        path();
        ctx.stroke();
        ctx.setLineDash([]);
    }

    private applyStroke(ctx: CanvasRenderingContext2D, style: DrawingStyle): void {
        ctx.strokeStyle = style.lineColor;
        ctx.lineWidth = style.lineWidth;
        ctx.setLineDash(dashPattern(style.lineStyle, style.lineWidth));
    }

    /** Round selection/placement handles — blue ring + gray fill (shared chrome, not the
     *  drawing's line color). */
    paintHandles(ctx: CanvasRenderingContext2D, points: ReadonlyArray<readonly [number, number]>): void {
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5;
        for (const [x, y] of points) {
            ctx.beginPath();
            ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = HANDLE_FILL;
            ctx.fill();
            ctx.strokeStyle = HANDLE_BORDER;
            ctx.stroke();
        }
    }
}

/** True when a color is fully transparent (8-digit hex `…00` or an `rgba(…,0)`) — so we can
 *  skip stroking hidden band edges entirely. */
function isTransparent(color: string): boolean {
    const c = color.trim().toLowerCase();
    if (/^#[0-9a-f]{8}$/.test(c)) return c.endsWith('00');
    const m = /rgba?\([^)]*,\s*([\d.]+)\s*\)$/.exec(c);
    return m ? parseFloat(m[1]!) === 0 : false;
}

/** Format a price for a Price Label tag — decimals scaled to the magnitude, with grouping. */
function formatPriceTag(p: number): string {
    const d = valueDecimals(p);
    return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Begin a rounded-rectangle path (arcTo-based, no `ctx.roundRect` dependency). */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** Where a drawing's label sits: first-line top-left + horizontal alignment, per type. */
/**
 * Trace a callout's speech-bubble outline as ONE continuous path: the rounded rectangle, but on
 * the tail's edge the path detours out to the apex and back — so the border never crosses the
 * tail's base (the pointer side stays open). Used for both the fill and the stroke.
 */
function calloutBubblePath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    tail: { edge: 'top' | 'right' | 'bottom' | 'left'; at: number; apex: [number, number]; half: number } | null,
): void {
    const seg = (edge: 'top' | 'right' | 'bottom' | 'left', ex: number, ey: number): void => {
        if (tail && tail.edge === edge) {
            const [ax, ay] = tail.apex;
            if (edge === 'top') {
                ctx.lineTo(tail.at - tail.half, y);
                ctx.lineTo(ax, ay);
                ctx.lineTo(tail.at + tail.half, y);
            } else if (edge === 'bottom') {
                ctx.lineTo(tail.at + tail.half, y + h);
                ctx.lineTo(ax, ay);
                ctx.lineTo(tail.at - tail.half, y + h);
            } else if (edge === 'right') {
                ctx.lineTo(x + w, tail.at - tail.half);
                ctx.lineTo(ax, ay);
                ctx.lineTo(x + w, tail.at + tail.half);
            } else {
                ctx.lineTo(x, tail.at + tail.half);
                ctx.lineTo(ax, ay);
                ctx.lineTo(x, tail.at - tail.half);
            }
        }
        ctx.lineTo(ex, ey);
    };
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    seg('top', x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    seg('right', x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    seg('bottom', x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    seg('left', x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

/** Compact ratio text for Mach circle labels (trim trailing zeros). */
function formatMachRatio(ratio: number): string {
    if (!Number.isFinite(ratio)) return '';
    const rounded = Math.round(ratio * 1000) / 1000;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function labelLayout(d: Drawing, proj: Projector): { x: number; top: number; align: CanvasTextAlign } | null {
    const text = d.text;
    if (!text) return null;
    const pts = d.handlePoints(proj);
    const lines = text.value.split('\n').length;
    const lh = namedFontSize(text.size) * 1.4;
    switch (d.type) {
        case 'text':
            return pts[0] ? { x: pts[0][0] + 2, top: pts[0][1] + 2, align: 'left' } : null;
        case 'hline':
            return pts[0] ? { x: pts[0][0] + 8, top: pts[0][1] - 4 - lh * lines, align: 'left' } : null; // above the line
        case 'trendline':
        case 'ray':
        case 'extendedline':
        case 'infoline':
        case 'trendangle': {
            if (pts.length < 2) return null;
            return { x: (pts[0]![0] + pts[1]![0]) / 2, top: (pts[0]![1] + pts[1]![1]) / 2 - 6 - lh * lines, align: 'center' };
        }
        case 'box': {
            if (pts.length < 2) return null;
            return { x: (pts[0]![0] + pts[1]![0]) / 2, top: (pts[0]![1] + pts[1]![1]) / 2 - (lh * lines) / 2, align: 'center' };
        }
        default:
            return pts[0] ? { x: pts[0][0], top: pts[0][1], align: 'left' } : null;
    }
}
