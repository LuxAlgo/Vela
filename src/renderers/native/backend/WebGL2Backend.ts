import type { VelaTheme } from '../../../core/options';
import type { OHLCV } from '../../../core/model/ohlcv';
import type { IndicatorModel } from '../../../core/model/indicator';
import type { Fill, Background, PriceLine } from '../../../core/model/scene';
import type { SeriesSpec, LineLikeSeries, CandleSeries, LineStyle, CandleBarColor } from '../../../core/model/series';
import { isLineLikeSeries } from '../../../core/model/series';
import type { CoordinateSystem } from '../core/CoordinateSystem';
import type { SceneGraph, PaneNode } from '../core/SceneGraph';
import { candleTier, wickWidth, candleGeometry } from './candle-lod';
import { BASELINE_TOP_LINE, BASELINE_BOTTOM_LINE, BASELINE_FILL_ALPHA, BASELINE_FILL_ALPHA_FAR, withAlpha as cssWithAlpha, effectiveCandlePaint } from '../core/chartConfig';
import type { IRenderBackend } from './IRenderBackend';
import { Batch, type RGBA } from './gl/Batch';
import { parseColor } from './gl/color';

const VERT_SRC = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aColor;
layout(location=2) in vec2 aEdge;   // (signed perpendicular distance from line center, half-width)
uniform vec2 uRes;
out vec4 vColor;
out vec2 vEdge;
void main() {
    vec2 clip = vec2(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0);
    gl_Position = vec4(clip, 0.0, 1.0);
    vColor = aColor;
    vEdge = aEdge;
}`;

// Flat color for solid geometry (edgeHalf < 0); for line quads, feather the edge analytically:
// coverage falls off over ~1 device pixel (fwidth) around the half-width, independent of MSAA.
const FRAG_SRC = `#version 300 es
precision highp float;
in vec4 vColor;
in vec2 vEdge;
out vec4 frag;
void main() {
    if (vEdge.y < 0.0) { frag = vColor; return; }
    float aa = fwidth(vEdge.x);
    float cov = clamp((vEdge.y - abs(vEdge.x)) / max(aa, 1e-4) + 0.5, 0.0, 1.0);
    frag = vec4(vColor.rgb, vColor.a * cov);
}`;

// Fullscreen-quad shader for the glow post-process: a separable 5-tap Gaussian
// blur when uDir != 0, or a passthrough × intensity (the additive composite) when
// uDir == 0.
const SCREEN_VERT = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const SCREEN_FRAG = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;        // blur direction (texel step); (0,0) = composite passthrough
uniform float uIntensity;
out vec4 frag;
void main() {
    if (uDir.x == 0.0 && uDir.y == 0.0) {
        frag = texture(uTex, vUv) * uIntensity;
        return;
    }
    vec2 o1 = uDir * 1.3846153846;
    vec2 o2 = uDir * 3.2307692308;
    vec4 sum = texture(uTex, vUv) * 0.2270270270;
    sum += texture(uTex, vUv + o1) * 0.3162162162;
    sum += texture(uTex, vUv - o1) * 0.3162162162;
    sum += texture(uTex, vUv + o2) * 0.0702702703;
    sum += texture(uTex, vUv - o2) * 0.0702702703;
    frag = sum;
}`;

const DASH: Record<string, readonly [number, number] | null> = {
    solid: null,
    dashed: [6, 4],
    dotted: [2, 3],
};

/** Triangle-fan segment count for a round line join/cap of half-width `hw` (round enough, not over-tessellated). */
function joinSegments(hw: number): number {
    return Math.max(6, Math.min(20, Math.round(hw * 4)));
}

/**
 * Hand-rolled WebGL2 GEOMETRY backend (L0). Same `IRenderBackend` seam as the
 * canvas2d backend: it consumes the retained scene + coordinate system and draws
 * bgcolor + fills + candles + series + hline — everything else stays on canvas2d
 * layers: axes, drawings and the crosshair on the chrome/cursor layers above, the
 * grid + session highlights on the backdrop canvas below (BackdropRenderer).
 *
 * Design: ONE per-vertex-color triangle pipeline. Every primitive decomposes into
 * colored triangles (rects, quads, line-quads, fans) in CSS-pixel space; a vertical
 * gradient is just a quad with different top/bottom vertex colors. Geometry is built
 * each frame culled to the visible bar range (bounded by visible bars, not total)
 * and drawn per pane with gl.scissor. Selected at runtime when WebGL2 is available;
 * the canvas2d backend is the permanent fallback.
 */
export class WebGL2Backend implements IRenderBackend {
    readonly kind = 'webgl2' as const;
    modelAlpha = 1;
    candleBodyAlpha = 1;
    candleStructureAlpha = 1;
    candleBodyScale = 1;
    /** Set by the renderer; invoked after a context restore to request a repaint. */
    onNeedsRedraw: (() => void) | null = null;
    /** Set by the renderer; invoked when the GL context is permanently unusable
     *  (a restore couldn't reinitialize) so it can fall back to canvas2d. */
    onContextFailed: (() => void) | null = null;
    /** Neon glow/bloom intensity for line series (0 = off). Set by the renderer. */
    glow = 0;

    private canvas: HTMLCanvasElement | null = null;
    private gl: WebGL2RenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private vao: WebGLVertexArrayObject | null = null;
    private vbo: WebGLBuffer | null = null;
    private uRes: WebGLUniformLocation | null = null;
    private readonly batch = new Batch();
    private contextLost = false;

    // glow/bloom post-process (lazy; only when glow > 0)
    private screenProgram: WebGLProgram | null = null;
    private uTex: WebGLUniformLocation | null = null;
    private uDir: WebGLUniformLocation | null = null;
    private uIntensity: WebGLUniformLocation | null = null;
    private quadVao: WebGLVertexArrayObject | null = null;
    private quadVbo: WebGLBuffer | null = null;
    private fboA: WebGLFramebuffer | null = null;
    private texA: WebGLTexture | null = null;
    private fboB: WebGLFramebuffer | null = null;
    private texB: WebGLTexture | null = null;
    private fboW = 0;
    private fboH = 0;
    private readonly glowBatch = new Batch();
    /** One texture per user-drawing interleave layer, keyed by its (stable, reused) canvas;
     *  re-uploaded every data frame — the layer repaints with the scene. */
    private readonly sliceTex = new Map<HTMLCanvasElement, WebGLTexture>();

    private readonly onLost = (e: Event): void => {
        e.preventDefault(); // keep the context recoverable
        this.contextLost = true;
    };
    private readonly onRestored = (): void => {
        this.contextLost = false;
        if (this.initGL()) this.onNeedsRedraw?.();
        else this.onContextFailed?.(); // couldn't rebuild the program → renderer swaps to canvas2d
    };

    /** Whether a usable WebGL2 context was acquired. */
    get ok(): boolean {
        return this.gl !== null;
    }

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        // alpha:true keeps the canvas transparent where nothing is drawn, so a layer behind it (the
        // reveal-layer background) shows through; the chart background is painted by the wrapper element.
        // antialias smooths line-quad + polygon edges. premultipliedAlpha:TRUE is REQUIRED: the SRC_ALPHA
        // over-blend writes PREMULTIPLIED pixels (rgb·a) to the framebuffer, so the compositor must be
        // told so — otherwise it re-applies alpha and double-darkens every semi-transparent pixel
        // (faint fills, and a darkened line-AA feather that reads as jaggies). Matches canvas2d exactly.
        this.gl = canvas.getContext('webgl2', { alpha: true, antialias: true, depth: false, stencil: false, premultipliedAlpha: true });
        if (!this.gl) return;
        if (!this.initGL()) {
            this.gl = null; // shaders/program failed → ok=false → renderer uses canvas2d
            return;
        }
        // Attach loss/restore handling only once a usable program exists (so a
        // discarded backend never leaves listeners behind).
        canvas.addEventListener('webglcontextlost', this.onLost, false);
        canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    }

    /** (Re)compile the program + buffers. Returns false (and frees any partial GL
     *  objects) on failure, so both mount and a context-restore can react. */
    private initGL(): boolean {
        const gl = this.gl;
        if (!gl) return false;
        // Drop any stale glow handles (a context-loss invalidated them) so they're rebuilt.
        this.screenProgram = null;
        this.quadVao = null;
        this.quadVbo = null;
        this.fboA = this.fboB = null;
        this.texA = this.texB = null;
        this.fboW = this.fboH = 0;
        this.sliceTex.clear(); // context-lost handles are invalid; textures re-upload on demand
        const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
        const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
        const prog = gl.createProgram();
        if (!vs || !fs || !prog) {
            if (vs) gl.deleteShader(vs);
            if (fs) gl.deleteShader(fs);
            if (prog) gl.deleteProgram(prog);
            return false;
        }
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            gl.deleteProgram(prog);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            return false;
        }
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        this.program = prog;
        this.uRes = gl.getUniformLocation(prog, 'uRes');
        this.vbo = gl.createBuffer();
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        const stride = 8 * 4;
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 2 * 4);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * 4);
        gl.bindVertexArray(null);
        // Glow is optional — if its program/quad can't be built, disable it but keep
        // the base backend working.
        if (this.glow > 0 && !this.ensureScreenPipeline()) this.glow = 0;
        return true;
    }

    /** Compile the screen-quad program + fullscreen quad, shared by the glow post-process and
     *  the user-drawing interleave layers. Idempotent; FBOs (glow-only) are created lazily. */
    private ensureScreenPipeline(): boolean {
        if (this.screenProgram && this.quadVao) return true;
        const gl = this.gl;
        if (!gl) return false;
        const vs = compile(gl, gl.VERTEX_SHADER, SCREEN_VERT);
        const fs = compile(gl, gl.FRAGMENT_SHADER, SCREEN_FRAG);
        const prog = gl.createProgram();
        if (!vs || !fs || !prog) {
            if (vs) gl.deleteShader(vs);
            if (fs) gl.deleteShader(fs);
            if (prog) gl.deleteProgram(prog);
            return false;
        }
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            gl.deleteProgram(prog);
            return false;
        }
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        this.screenProgram = prog;
        this.uTex = gl.getUniformLocation(prog, 'uTex');
        this.uDir = gl.getUniformLocation(prog, 'uDir');
        this.uIntensity = gl.getUniformLocation(prog, 'uIntensity');
        this.quadVbo = gl.createBuffer();
        this.quadVao = gl.createVertexArray();
        gl.bindVertexArray(this.quadVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        return true;
    }

    /** (Re)allocate the two half-res ping-pong FBOs to the given size. */
    private ensureFbos(gl: WebGL2RenderingContext, w: number, h: number): boolean {
        if (this.fboA && this.fboW === w && this.fboH === h) return true;
        this.deleteFbos(gl);
        const make = (): { tex: WebGLTexture | null; fbo: WebGLFramebuffer | null } => {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
            return { tex, fbo };
        };
        const a = make();
        const b = make();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.texA = a.tex;
        this.fboA = a.fbo;
        this.texB = b.tex;
        this.fboB = b.fbo;
        this.fboW = w;
        this.fboH = h;
        return !!(this.fboA && this.fboB);
    }

    private deleteFbos(gl: WebGL2RenderingContext): void {
        if (this.fboA) gl.deleteFramebuffer(this.fboA);
        if (this.fboB) gl.deleteFramebuffer(this.fboB);
        if (this.texA) gl.deleteTexture(this.texA);
        if (this.texB) gl.deleteTexture(this.texB);
        this.fboA = this.fboB = null;
        this.texA = this.texB = null;
        this.fboW = this.fboH = 0;
    }

    render(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme): void {
        const gl = this.gl;
        const canvas = this.canvas;
        if (!gl || !canvas || !this.program || this.contextLost || gl.isContextLost()) return;

        const dpr = coords.dpr;
        const dataW = coords.width;

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.disable(gl.SCISSOR_TEST);
        // Transparent clear: the wrapper paints the chart background, so a reveal
        // layer behind this canvas shows through wherever no geometry is drawn.
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const n = coords.barCount;
        if (n === 0) return;
        const vr = coords.visibleLogicalRange();
        const i0 = Math.max(0, Math.floor(vr.from));
        const i1 = Math.min(n - 1, Math.ceil(vr.to));
        if (i1 < i0) return;

        // Blend/scissor are enabled once; the program/VAO/uniform bindings live in each pane's
        // `flush`, since an interleave-layer quad swaps them mid-pane anyway.
        gl.enable(gl.BLEND);
        gl.enable(gl.SCISSOR_TEST);

        const barColorMap = mergeBarColors(scene.indicators);
        const panes = scene.orderedPanes();
        const liveSlices = new Set<HTMLCanvasElement>();
        for (const pane of panes) {
            const b = this.batch;
            b.reset();
            // Pane scissor up-front: geometry flushes AND interleave-layer quads clip to it.
            const topDev = Math.round(pane.bounds.top * dpr);
            const botDev = Math.round((pane.bounds.top + pane.bounds.height) * dpr);
            gl.scissor(0, canvas.height - botDev, Math.round(dataW * dpr), botDev - topDev);
            // Draw whatever geometry accumulated so far — called at each interleave point (a
            // texture quad has to land BETWEEN geometry draws) and once at the pane's end. The
            // quad pass swaps program/VAO/blend, so every flush rebinds the geometry pipeline.
            const flush = (): void => {
                if (b.vertexCount === 0) return;
                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.useProgram(this.program);
                gl.bindVertexArray(this.vao);
                gl.uniform2f(this.uRes, canvas.width / dpr, canvas.height / dpr);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
                gl.bufferData(gl.ARRAY_BUFFER, b.view, gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLES, 0, b.vertexCount);
                b.reset();
            };
            // User-drawing interleave layers, prepainted by the renderer: each composites just
            // before the series carrying its `beforeZ` — under the candles, between indicators.
            const slices = pane.collapsed ? [] : (scene.drawingSlices.get(pane.id) ?? []);
            let si = 0;
            const drawSlicesUpTo = (z: number): void => {
                for (; si < slices.length && slices[si]!.beforeZ <= z; si += 1) {
                    flush();
                    if (this.drawSliceTexture(gl, slices[si]!.canvas)) liveSlices.add(slices[si]!.canvas);
                }
            };
            // z-order within the batch (painter's): bg, then the candles + each indicator's
            // fills + series interleaved by `scene.candleZ`/per-indicator z, then hlines.
            // (The grid + session highlights live on the renderer's backdrop canvas below.)
            b.alpha = 1;
            // A collapsed pane is a legend-only strip: no plots (legend + separator are chrome).
            if (!pane.collapsed) {
                const models = scene.orderedIndicatorsForPane(pane.id);
                const isPrice = pane.kind === 'price';
                // Merged (own-scale) indicators draw against their own price window inside the pane.
                const effPane = (m: IndicatorModel): PaneNode => {
                    const sc = scene.scaleFor(m, pane);
                    return sc === pane.scale ? pane : { ...pane, scale: sc };
                };
                b.alpha = this.modelAlpha; // indicator models fade in after the intro; candles/grid stay opaque
                // Behind everything: bgcolor spans — Pine keeps the background under every
                // layer regardless of stacking. Own (non-force_overlay) spans on each
                // model's pane; force_overlay spans on the price pane (Pine semantics —
                // mirrors the chrome's overlay-drawing routing). Fills are NOT here: they
                // paint inside the z loop at their model's slot.
                for (const m of models) for (const bgSpan of m.backgrounds) if (bgSpan.overlay !== true) this.emitBackground(b, bgSpan, pane, coords);
                if (isPrice) {
                    for (const m of scene.indicators.values()) {
                        for (const bgSpan of m.backgrounds) if (bgSpan.overlay === true) this.emitBackground(b, bgSpan, pane, coords);
                    }
                }
                // When the price is hidden, the candle layer is skipped entirely (overlays still draw).
                const drawCandles = isPrice && !scene.candlesHidden;
                let candleDrawn = false;
                for (const m of models) {
                    if (drawCandles && !candleDrawn && scene.zOf(m.id) >= scene.candleZ) {
                        drawSlicesUpTo(scene.candleZ);
                        b.alpha = this.candleStructureAlpha; // baseline; emitCandles sets body vs structure per-element
                        this.emitPriceSeries(b, scene, i0, i1, coords, pane, theme, barColorMap, dataW);
                        candleDrawn = true;
                    }
                    drawSlicesUpTo(scene.zOf(m.id));
                    b.alpha = this.modelAlpha;
                    // Model data is index-aligned from the model's ANCHOR bar (offset 0 = whole-chart).
                    const off = scene.offsetOf(m.id);
                    const mp = effPane(m);
                    // Fills paint at the model's z slot, under its own series — a band between
                    // two plots sits behind the plot lines, and the whole model moves as one
                    // unit when its object-tree row is reordered.
                    for (const f of m.fills) if (f.overlay !== true) this.emitFill(b, m, f, mp, coords, i0, i1, off);
                    for (const s of m.series) if (s.overlay !== true) this.emitSeries(b, s, mp, coords, i0, i1, theme, off);
                }
                if (drawCandles && !candleDrawn) {
                    drawSlicesUpTo(scene.candleZ);
                    b.alpha = this.candleStructureAlpha;
                    this.emitPriceSeries(b, scene, i0, i1, coords, pane, theme, barColorMap, dataW);
                }
                b.alpha = this.modelAlpha;
                // force_overlay content from EVERY indicator paints on the price pane, at the
                // top of its series stack, against the master price scale — fills first so a
                // forced band still sits under the forced plot lines.
                if (isPrice) {
                    for (const m of scene.indicators.values()) {
                        const off = scene.offsetOf(m.id);
                        for (const f of m.fills) if (f.overlay === true) this.emitFill(b, m, f, pane, coords, i0, i1, off);
                    }
                    for (const m of scene.indicators.values()) {
                        const off = scene.offsetOf(m.id);
                        for (const s of m.series) if (s.overlay === true) this.emitSeries(b, s, pane, coords, i0, i1, theme, off);
                    }
                }
                // Stack-top slices: the topmost indicator's drawings, force_overlay drawings,
                // and layers bound to a hidden/removed series — above the forced series too,
                // since drawings always paint over their own plots.
                drawSlicesUpTo(Infinity);
                for (const m of models) { const mp = effPane(m); for (const pl of m.priceLines) this.emitHline(b, pl, mp, coords, dataW, theme); }
                b.alpha = 1;
            }
            flush();
        }
        gl.disable(gl.SCISSOR_TEST);
        // Drop textures whose layer disappeared this frame (the canvas cache in the drawings
        // controller prunes the same way, so this stays a handful of entries).
        for (const [cv, tex] of this.sliceTex) {
            if (!liveSlices.has(cv)) {
                gl.deleteTexture(tex);
                this.sliceTex.delete(cv);
            }
        }

        // Build the glow program on first use: it's compiled in initGL only when glow starts > 0,
        // so a runtime toggle (off → on) must compile it lazily here — otherwise the bloom never
        // appears until the next full backend (re)init. Disable glow if it can't compile.
        if (this.glow > 0 && !this.screenProgram && !this.ensureScreenPipeline()) this.glow = 0;
        if (this.glow > 0 && this.screenProgram) {
            this.glowBatch.alpha = this.modelAlpha; // the glow of faded series fades too
            this.renderGlow(gl, scene, coords, i0, i1);
        }
    }

    /**
     * Neon bloom: re-render the line series into a half-res FBO, blur it (separable
     * Gaussian, ping-pong), then additively composite the halo over the sharp scene.
     */
    private renderGlow(gl: WebGL2RenderingContext, scene: SceneGraph, coords: CoordinateSystem, i0: number, i1: number): void {
        const canvas = this.canvas!;
        const hw = Math.max(1, canvas.width >> 1);
        const hh = Math.max(1, canvas.height >> 1);
        if (!this.ensureFbos(gl, hw, hh)) return;
        const dpr = coords.dpr;
        const dataW = coords.width;

        // ── glow-source pass: the neon lines into fboA (half-res) ──
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
        gl.viewport(0, 0, hw, hh);
        gl.disable(gl.SCISSOR_TEST);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.uniform2f(this.uRes, canvas.width / dpr, canvas.height / dpr);
        gl.enable(gl.SCISSOR_TEST);
        for (const pane of scene.orderedPanes()) {
            const b = this.glowBatch;
            b.reset();
            this.emitGlowSources(b, scene, pane, coords, i0, i1);
            if (b.vertexCount === 0) continue;
            const topH = Math.round(pane.bounds.top * dpr * 0.5);
            const botH = Math.round((pane.bounds.top + pane.bounds.height) * dpr * 0.5);
            gl.scissor(0, hh - botH, Math.round(dataW * dpr * 0.5), botH - topH);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
            gl.bufferData(gl.ARRAY_BUFFER, b.view, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, b.vertexCount);
        }
        gl.disable(gl.SCISSOR_TEST);

        // ── separable blur: fboA --H--> fboB --V--> fboA ──
        gl.useProgram(this.screenProgram);
        gl.bindVertexArray(this.quadVao);
        gl.uniform1i(this.uTex, 0);
        gl.uniform1f(this.uIntensity, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
        gl.bindTexture(gl.TEXTURE_2D, this.texA);
        gl.uniform2f(this.uDir, 1 / hw, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
        gl.bindTexture(gl.TEXTURE_2D, this.texB);
        gl.uniform2f(this.uDir, 0, 1 / hh);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // ── composite the blurred glow additively over the screen ──
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindTexture(gl.TEXTURE_2D, this.texA);
        gl.uniform2f(this.uDir, 0, 0); // composite (passthrough × intensity)
        gl.uniform1f(this.uIntensity, this.glow);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindVertexArray(null);
    }

    /** Composite one user-drawing interleave layer: upload its canvas (premultiplied, y-flipped —
     *  the framebuffer holds premultiplied pixels, see mount) and draw it as a fullscreen quad
     *  through the screen pipeline. The pane scissor is already set, so it clips to the pane.
     *  Returns false when the screen pipeline can't compile — the layer is skipped, not fatal. */
    private drawSliceTexture(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement): boolean {
        if (!this.ensureScreenPipeline() || !this.screenProgram) return false;
        let tex = this.sliceTex.get(canvas) ?? null;
        if (!tex) {
            tex = gl.createTexture();
            if (!tex) return false;
            this.sliceTex.set(canvas, tex);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas); // fresh pixels — the layer repaints with the scene
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.useProgram(this.screenProgram);
        gl.bindVertexArray(this.quadVao);
        gl.uniform1i(this.uTex, 0);
        gl.uniform2f(this.uDir, 0, 0); // passthrough (no blur)
        gl.uniform1f(this.uIntensity, 1);
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
        return true;
    }

    /** The "neon" elements that glow: line/area/step lines + point markers (not candles/fills/bars).
     *  Routing mirrors the main pass: own series per pane, force_overlay series on the price pane. */
    private emitGlowSources(b: Batch, scene: SceneGraph, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number): void {
        const emitOne = (s: SeriesSpec, off: number): void => {
            if (!isLineLikeSeries(s) || s.visible === false) return;
            if (s.kind === 'histogram' || s.kind === 'columns') return;
            if (s.kind === 'circles' || s.kind === 'cross') this.emitPointMarkers(b, s, pane, coords, i0, i1, off);
            else this.emitPolyline(b, s, pane, coords, i0, i1, s.kind === 'step', off);
        };
        for (const m of scene.indicatorsForPane(pane.id)) {
            const off = scene.offsetOf(m.id);
            for (const s of m.series) if (s.overlay !== true) emitOne(s, off);
        }
        if (pane.kind === 'price') {
            for (const m of scene.indicators.values()) {
                const off = scene.offsetOf(m.id);
                for (const s of m.series) if (s.overlay === true) emitOne(s, off);
            }
        }
    }

    destroy(): void {
        const gl = this.gl;
        if (this.canvas) {
            this.canvas.removeEventListener('webglcontextlost', this.onLost);
            this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
        }
        if (gl) {
            if (this.program) gl.deleteProgram(this.program);
            if (this.vbo) gl.deleteBuffer(this.vbo);
            if (this.vao) gl.deleteVertexArray(this.vao);
            if (this.screenProgram) gl.deleteProgram(this.screenProgram);
            if (this.quadVbo) gl.deleteBuffer(this.quadVbo);
            if (this.quadVao) gl.deleteVertexArray(this.quadVao);
            for (const tex of this.sliceTex.values()) gl.deleteTexture(tex);
            this.sliceTex.clear();
            this.deleteFbos(gl);
            // Release the CONTEXT itself, not just its resources: browsers cap live
            // WebGL contexts per page (~16) and reclaim destroyed ones LAZILY. Without
            // an explicit loseContext(), chart create/destroy cycles (SPA navigation,
            // workspace layout churn) evict the OLDEST context — which can be a
            // still-visible chart's. Our own listeners are already detached above.
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
        this.gl = null;
        this.canvas = null;
        this.program = null;
        this.vao = null;
        this.vbo = null;
        this.screenProgram = null;
    }

    // ── geometry emit (mirrors Canvas2dBackend, in CSS-px space) ──
    private emitBackground(b: Batch, bg: Background, pane: PaneNode, coords: CoordinateSystem): void {
        const x1 = coords.timeToX(bg.from);
        const x2 = coords.timeToX(bg.to);
        if (x2 < 0 || x1 > coords.width || x2 <= x1) return;
        b.rect(x1, pane.bounds.top, x2 - x1, pane.bounds.height, parseColor(bg.color));
    }

    private emitFill(b: Batch, model: IndicatorModel, fill: Fill, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const from = findPoints(model, fill.fromSeriesId);
        const to = findPoints(model, fill.toSeriesId);
        if (!from || !to) return;
        for (let i = Math.max(1, i0); i <= i1; i += 1) {
            const a0 = from[i - 1 - off];
            const b0 = to[i - 1 - off];
            const a1 = from[i - off];
            const b1 = to[i - off];
            if (!a0 || !b0 || !a1 || !b1 || a0.value === null || b0.value === null || a1.value === null || b1.value === null) continue;
            const xPrev = coords.logicalToX(i - 1);
            const xCur = coords.logicalToX(i);
            const tPrev = coords.priceToY(a0.value, pane.scale, pane.bounds);
            const bPrev = coords.priceToY(b0.value, pane.scale, pane.bounds);
            const tCur = coords.priceToY(a1.value, pane.scale, pane.bounds);
            const bCur = coords.priceToY(b1.value, pane.scale, pane.bounds);
            // Style by the LEFT/head column (matches FillPrimitive's run-head convention).
            const grad = fill.gradient?.[i - 1 - off];
            if (grad) {
                const yTop = coords.priceToY(grad.topValue, pane.scale, pane.bounds);
                const yBot0 = coords.priceToY(grad.bottomValue, pane.scale, pane.bounds);
                const yBot = yBot0 === yTop ? yTop + 1 : yBot0; // match canvas2d's degenerate nudge
                const tc = parseColor(grad.topColor);
                const bc = parseColor(grad.bottomColor);
                const span = yBot - yTop;
                const at = (y: number): RGBA => lerpColor(tc, bc, clamp01((y - yTop) / span));
                // quad corners: TL(xPrev,tPrev) TR(xCur,tCur) BR(xCur,bCur) BL(xPrev,bPrev)
                b.quad4(xPrev, tPrev, at(tPrev), xCur, tCur, at(tCur), xCur, bCur, at(bCur), xPrev, bPrev, at(bPrev));
            } else {
                const color = fill.colors ? fill.colors[i - 1 - off] : fill.color;
                if (!color) continue;
                b.quad(xPrev, tPrev, xCur, tCur, xCur, bCur, xPrev, bPrev, parseColor(color));
            }
        }
    }

    // ── base price series (chart type) — mirrors Canvas2dBackend.drawPriceSeries ──
    private emitPriceSeries(
        b: Batch,
        scene: SceneGraph,
        i0: number,
        i1: number,
        coords: CoordinateSystem,
        pane: PaneNode,
        theme: VelaTheme,
        barColors: ReadonlyMap<number, string>,
        dataW: number,
    ): void {
        if (scene.basePainting === 'none') return; // plugin style fully replaces the price series
        const bars = scene.bars;
        const st = scene.style;
        switch (scene.priceStyle) {
            case 'bars':
                this.emitBars(b, bars, i0, i1, coords, pane, st.bars.upColor ?? theme.upColor, st.bars.downColor ?? theme.downColor, barColors);
                return;
            case 'line':
                this.emitPriceLine(b, bars, i0, i1, coords, pane, parseColor(st.line.color ?? theme.upColor), st.line.width);
                return;
            case 'area': {
                const lineColor = st.area.lineColor ?? theme.upColor;
                this.emitPriceArea(b, bars, i0, i1, coords, pane, parseColor(st.area.topColor ?? lineColor), parseColor(st.area.bottomColor ?? 'rgba(0,0,0,0)'));
                this.emitPriceLine(b, bars, i0, i1, coords, pane, parseColor(lineColor), st.area.width);
                return;
            }
            case 'baseline':
                this.emitBaseline(b, bars, i0, i1, coords, pane, scene, theme, dataW);
                return;
            default: // 'candles' + candle-drawn styles (a plugin style may fade candles to reveal its
                // order-flow layer) and 'heikinashi' (the bars themselves arrive already transformed)
                this.emitCandles(b, scene, bars, i0, i1, coords, pane, theme, barColors);
        }
    }

    /** OHLC bars: high-low stick + left open tick + right close tick (no body). */
    private emitBars(b: Batch, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, up: string, down: string, barColors: ReadonlyMap<number, string>): void {
        const spacing = coords.bodySpacing();
        const tier = candleTier(spacing);
        if (tier === 'aggregate') {
            this.emitCandlesAggregated(b, bars, i0, i1, coords, pane, up, down, barColors);
            return;
        }
        const tickW = Math.max(1, Math.round(spacing * 0.35));
        const drawTicks = tier === 'full';
        for (let i = i0; i <= i1; i += 1) {
            const bar = bars[i];
            if (!bar || bar.high <= bar.low) continue;
            const c = parseColor(barColors.get(bar.time) ?? (bar.close >= bar.open ? up : down));
            const x = Math.round(coords.logicalToX(i));
            const hY = coords.priceToY(bar.high, pane.scale, pane.bounds);
            const lY = coords.priceToY(bar.low, pane.scale, pane.bounds);
            b.rect(x - 0.5, hY, 1, lY - hY, c);
            if (drawTicks) {
                const oY = coords.priceToY(bar.open, pane.scale, pane.bounds);
                const cY = coords.priceToY(bar.close, pane.scale, pane.bounds);
                b.rect(x - tickW, oY - 0.5, tickW, 1, c);
                b.rect(x, cY - 0.5, tickW, 1, c);
            }
        }
    }

    /** Close-price line (also the top stroke of the area style). */
    private emitPriceLine(b: Batch, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, c: RGBA, width: number): void {
        const hw = Math.max(1, width) / 2;
        const segs = joinSegments(hw);
        let have = false;
        let px = 0;
        let py = 0;
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const bar = bars[i];
            if (!bar) {
                have = false;
                continue;
            }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(bar.close, pane.scale, pane.bounds);
            if (have) b.seg(px, py, x, y, width, c);
            b.circle(x, y, hw, c, segs); // round join at each vertex (round cap at run ends) — no faceted kinks
            px = x;
            py = y;
            have = true;
        }
    }

    /** Filled area under the close line: per-bar quads gradient `top` (at the line) →
     *  `bottom` (at the pane floor). Defaults fade the line color out (bottom transparent). */
    private emitPriceArea(b: Batch, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, top: RGBA, bottom: RGBA): void {
        const baseY = pane.bounds.top + pane.bounds.height;
        const run: Array<{ x: number; y: number }> = [];
        let minY = Infinity;
        const flush = (): void => {
            if (run.length >= 2) {
                const span = baseY - minY;
                const at = (y: number): RGBA => lerpColor(top, bottom, span < 1e-6 ? 0 : clamp01((y - minY) / span));
                for (let k = 1; k < run.length; k += 1) {
                    const a = run[k - 1]!;
                    const c = run[k]!;
                    b.quad4(a.x, a.y, at(a.y), c.x, c.y, at(c.y), c.x, baseY, bottom, a.x, baseY, bottom);
                }
            }
            run.length = 0;
            minY = Infinity;
        };
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const bar = bars[i];
            if (!bar) {
                flush();
                continue;
            }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(bar.close, pane.scale, pane.bounds);
            run.push({ x, y });
            if (y < minY) minY = y;
        }
        flush();
    }

    /**
     * Baseline style: per-segment fill quads down to the baseline, up color above /
     * down color below. Each area is a two-stop gradient — the near-line fill far from
     * the baseline blending to the fainter near-baseline fill at it. A dashed baseline
     * marker + the per-segment line on top.
     */
    private emitBaseline(b: Batch, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, scene: SceneGraph, theme: VelaTheme, dataW: number): void {
        const baseline = scene.baselinePriceFor(pane.scale);
        const baseY = coords.priceToY(baseline, pane.scale, pane.bounds);
        const bs = scene.style.baseline;
        const topLineStr = bs.topLineColor ?? BASELINE_TOP_LINE;
        const bottomLineStr = bs.bottomLineColor ?? BASELINE_BOTTOM_LINE;
        const topLine = parseColor(topLineStr);
        const bottomLine = parseColor(bottomLineStr);
        const topFill = parseColor(bs.topFillColor ?? cssWithAlpha(topLineStr, BASELINE_FILL_ALPHA));
        const topFill2 = parseColor(bs.topFillColor2 ?? cssWithAlpha(topLineStr, BASELINE_FILL_ALPHA_FAR));
        const bottomFill = parseColor(bs.bottomFillColor ?? cssWithAlpha(bottomLineStr, BASELINE_FILL_ALPHA));
        const bottomFill2 = parseColor(bs.bottomFillColor2 ?? cssWithAlpha(bottomLineStr, BASELINE_FILL_ALPHA_FAR));
        const pts: Array<{ x: number; y: number }> = [];
        for (let i = Math.max(0, i0 - 1); i <= i1; i += 1) {
            const bar = bars[i];
            if (!bar) continue;
            pts.push({ x: coords.logicalToX(i), y: coords.priceToY(bar.close, pane.scale, pane.bounds) });
        }
        if (pts.length < 2) return;
        const top = pane.bounds.top;
        const bottom = pane.bounds.top + pane.bounds.height;
        // The near-baseline fill for a vertex's side (used at the baseline edge of the quad).
        const farFill = (y: number): RGBA => (y <= baseY ? topFill2 : bottomFill2);
        // Fill at a line vertex: blend the near-baseline → near-line fill by how far the
        // close sits from the baseline (matches canvas2d's clipped two-stop gradient).
        const sideFill = (y: number): RGBA => {
            const above = y <= baseY;
            const region = above ? baseY - top : bottom - baseY;
            const t = region > 0 ? clamp01(Math.abs(y - baseY) / region) : 0;
            return lerpColor(above ? topFill2 : bottomFill2, above ? topFill : bottomFill, t);
        };
        for (let k = 1; k < pts.length; k += 1) {
            const a = pts[k - 1]!;
            const c = pts[k]!;
            // Split the fill AT the baseline crossing (mirrors the stroke split below): a
            // single quad down to the baseline would straddle both sides and bleed one
            // side's fill color onto the other. Each half is a triangle wholly on its side.
            if ((a.y <= baseY) !== (c.y <= baseY) && c.y !== a.y) {
                const t = (baseY - a.y) / (c.y - a.y);
                const xCross = a.x + (c.x - a.x) * t;
                b.tri(a.x, a.y, sideFill(a.y), xCross, baseY, farFill(a.y), a.x, baseY, farFill(a.y));
                b.tri(xCross, baseY, farFill(c.y), c.x, c.y, sideFill(c.y), c.x, baseY, farFill(c.y));
            } else {
                b.quad4(a.x, a.y, sideFill(a.y), c.x, c.y, sideFill(c.y), c.x, baseY, farFill(c.y), a.x, baseY, farFill(a.y));
            }
        }
        b.dashedSeg(0, baseY, dataW, baseY, 1, parseColor(scene.style.borderColor ?? theme.borderColor), DASH.dashed ?? null);
        for (let k = 1; k < pts.length; k += 1) {
            const a = pts[k - 1]!;
            const c = pts[k]!;
            const aUp = a.y <= baseY;
            const cUp = c.y <= baseY;
            // Split the segment AT the baseline so each side is colored correctly — a
            // segment must never be the up color below the baseline (or vice versa).
            if (aUp !== cUp && c.y !== a.y) {
                const t = (baseY - a.y) / (c.y - a.y);
                const xCross = a.x + (c.x - a.x) * t;
                b.seg(a.x, a.y, xCross, baseY, bs.width, aUp ? topLine : bottomLine);
                b.seg(xCross, baseY, c.x, c.y, bs.width, cUp ? topLine : bottomLine);
            } else {
                b.seg(a.x, a.y, c.x, c.y, bs.width, aUp ? topLine : bottomLine);
            }
        }
    }

    private emitCandles(b: Batch, scene: SceneGraph, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, theme: VelaTheme, barColors: ReadonlyMap<number, string>): void {
        const spacing = coords.bodySpacing();
        const tier = candleTier(spacing);
        // A candle-based plugin style paints with its OWN cosmetics (unset keys inherit
        // the shared candles block); built-ins pass through untouched.
        const paint = effectiveCandlePaint(scene.style.candle, scene.candleOverride, theme.upColor, theme.downColor);
        if (tier === 'aggregate') {
            this.emitCandlesAggregated(b, bars, i0, i1, coords, pane, paint.up, paint.down, barColors);
            return;
        }
        const drawBody = tier === 'full';
        const up = paint.up;
        const down = paint.down;
        const cs = paint.candle;
        // When a fading style drops the body below the structure, draw a body outline even
        // if no border is configured — so the candle keeps a visible (hollow) skeleton.
        const fading = this.candleStructureAlpha > this.candleBodyAlpha + 0.001;
        for (let i = i0; i <= i1; i += 1) {
            const bar = bars[i];
            if (!bar || bar.high <= bar.low) continue; // skip zero-range candles (e.g. the intro reveal's un-started state)
            // Wick + body snapped to the device grid as one unit, so the wick is always
            // dead-center in the body and the gap between candles stays uniform.
            const g = candleGeometry(coords.logicalToX(i), spacing, coords.dpr, this.candleBodyScale);
            const isUp = bar.close >= bar.open;
            const dir = isUp ? up : down;
            const bc = barColors.get(bar.time);
            const bodyColorStr = bc ?? dir;
            const c = parseColor(bodyColorStr);
            // Body geometry up front so the wick can be clipped to it when the body is hollow.
            let bodyTop = 0;
            let bodyH = 0;
            if (drawBody) {
                const oY = coords.priceToY(bar.open, pane.scale, pane.bounds);
                const cY = coords.priceToY(bar.close, pane.scale, pane.bounds);
                bodyTop = Math.min(oY, cY);
                bodyH = Math.max(1, Math.abs(cY - oY));
            }
            if (cs.wickVisible) {
                const hY = coords.priceToY(bar.high, pane.scale, pane.bounds);
                const lY = coords.priceToY(bar.low, pane.scale, pane.bounds);
                b.alpha = this.candleStructureAlpha;
                // barcolor() recolors only the BODY (TV semantics): the wick keeps the
                // direction color while a body is drawn. At stick-only zoom the stick IS
                // the candle, so it keeps the barcolor tint.
                const wCol = parseColor((isUp ? cs.wickUpColor : cs.wickDownColor) ?? (drawBody ? dir : bodyColorStr));
                if (drawBody) {
                    // Draw the wick only outside the body, so it never shows through it — including
                    // hollow bodies and semi-transparent fills.
                    b.rect(g.wickX, hY, g.wickW, Math.max(0, bodyTop - hY), wCol);
                    b.rect(g.wickX, bodyTop + bodyH, g.wickW, Math.max(0, lY - (bodyTop + bodyH)), wCol);
                } else {
                    b.rect(g.wickX, hY, g.wickW, lY - hY, wCol);
                }
            }
            if (drawBody) {
                if (cs.bodyVisible) {
                    b.alpha = this.candleBodyAlpha;
                    b.rect(g.bodyX, bodyTop, g.bodyW, bodyH, c);
                }
                // The border strictly follows its visibility setting — barcolor() never
                // forces one. An unconfigured border color inherits the body color, so a
                // barcolored body gets a matching tinted border, not a direction-colored
                // outline.
                if (cs.borderVisible || (fading && cs.bodyVisible)) {
                    b.alpha = this.candleStructureAlpha;
                    const bord = cs.borderVisible ? parseColor((isUp ? cs.borderUpColor : cs.borderDownColor) ?? bodyColorStr) : c;
                    // Inset by half the stroke so the border stays inside the body's
                    // snapped footprint (mirrors the canvas2d backend).
                    const bw = Math.max(0, g.bodyW - 1);
                    const bh = Math.max(0, bodyH - 1);
                    b.rectStroke(g.bodyX + 0.5, bodyTop + 0.5, bw, bh, 1, bord);
                }
            }
        }
    }

    /**
     * Sub-pixel LOD (mirrors Canvas2dBackend.drawCandlesAggregated): bucket bars
     * sharing a rounded pixel column into one high-low stick → draw cost bounded by
     * screen width, not bar count. Bucket color follows first-open→last-close.
     */
    private emitCandlesAggregated(b: Batch, bars: OHLCV[], i0: number, i1: number, coords: CoordinateSystem, pane: PaneNode, up: string, down: string, barColors: ReadonlyMap<number, string>): void {
        let px = NaN;
        let lo = Infinity;
        let hi = -Infinity;
        let openV = 0;
        let closeV = 0;
        let headTime = 0;
        let active = false;
        const flush = (): void => {
            if (!active) return;
            const c = parseColor(barColors.get(headTime) ?? (closeV >= openV ? up : down));
            const hY = coords.priceToY(hi, pane.scale, pane.bounds);
            const lY = coords.priceToY(lo, pane.scale, pane.bounds);
            b.rect(px - 0.5, hY, 1, lY - hY, c);
        };
        for (let i = i0; i <= i1; i += 1) {
            const bar = bars[i];
            if (!bar || bar.high <= bar.low) continue;
            const x = Math.round(coords.logicalToX(i));
            if (!active || x !== px) {
                flush();
                px = x;
                lo = bar.low;
                hi = bar.high;
                openV = bar.open;
                headTime = bar.time;
                active = true;
            } else {
                if (bar.low < lo) lo = bar.low;
                if (bar.high > hi) hi = bar.high;
            }
            closeV = bar.close;
        }
        flush();
    }

    private emitSeries(b: Batch, spec: SeriesSpec, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, theme: VelaTheme, off = 0): void {
        if (spec.kind === 'candle' || spec.kind === 'bar') {
            this.emitPlotCandles(b, spec, pane, coords, i0, i1, theme, off);
            return;
        }
        if (!isLineLikeSeries(spec) || spec.visible === false) return;
        switch (spec.kind) {
            case 'histogram':
            case 'columns':
                this.emitHistogram(b, spec, pane, coords, i0, i1, off);
                break;
            case 'area':
                this.emitArea(b, spec, pane, coords, i0, i1, off);
                this.emitPolyline(b, spec, pane, coords, i0, i1, false, off);
                break;
            case 'circles':
            case 'cross':
                this.emitPointMarkers(b, spec, pane, coords, i0, i1, off);
                break;
            case 'step':
                this.emitPolyline(b, spec, pane, coords, i0, i1, true, off);
                break;
            default:
                this.emitPolyline(b, spec, pane, coords, i0, i1, false, off);
        }
    }

    private emitPolyline(b: Batch, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, step: boolean, off = 0): void {
        const w = Math.max(1, s.style.width);
        const hw = w / 2;
        const pattern = DASH[s.style.lineStyle] ?? null;
        // Round joins/caps for solid straight lines only — the butt-capped segments otherwise leave a
        // hard notch/kink at every vertex (visible when zoomed in). Dashed + step keep their corners.
        const rounded = !pattern && !step;
        const segs = joinSegments(hw);
        let have = false;
        for (let i = Math.max(1, i0 - 1); i <= i1; i += 1) {
            const p = s.points[i - off];
            const pv = s.points[i - 1 - off];
            if (!p || p.value === null || !pv || pv.value === null) { have = false; continue; }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            const px = coords.logicalToX(i - 1);
            const py = coords.priceToY(pv.value, pane.scale, pane.bounds);
            const c = parseColor(p.color ?? s.style.color);
            if (step) {
                b.dashedSeg(px, py, x, py, w, c, pattern);
                b.dashedSeg(x, py, x, y, w, c, pattern);
            } else {
                b.dashedSeg(px, py, x, y, w, c, pattern);
            }
            if (rounded) {
                if (!have) b.circle(px, py, hw, parseColor(pv.color ?? s.style.color), segs); // cap at a run's start
                b.circle(x, y, hw, c, segs); // round join at this vertex (cap at a run's end)
            }
            have = true;
        }
    }

    private emitArea(b: Batch, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const baseY = pane.bounds.top + pane.bounds.height;
        const base = parseColor(s.style.color);
        // Per contiguous run: a baseline→line band with a top-color → transparent fade
        // (gradient via per-vertex alpha; matches the canvas2d minY→baseY gradient).
        let run: Array<{ x: number; y: number }> = [];
        let minY = Infinity;
        const flush = (): void => {
            if (run.length < 1) {
                run = [];
                minY = Infinity;
                return;
            }
            const span = baseY - minY;
            const at = (y: number): RGBA => fadeAlpha(base, span < 1e-6 ? 0 : clamp01((y - minY) / span));
            for (let k = 1; k < run.length; k += 1) {
                const a = run[k - 1]!;
                const c = run[k]!;
                // quad: line-top (a, c) down to baseline — top verts faded by y, base verts transparent.
                b.quad4(a.x, a.y, at(a.y), c.x, c.y, at(c.y), c.x, baseY, ZERO, a.x, baseY, ZERO);
            }
            run = [];
            minY = Infinity;
        };
        for (let i = i0; i <= i1; i += 1) {
            const p = s.points[i - off];
            if (!p || p.value === null) {
                flush();
                continue;
            }
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            run.push({ x, y });
            if (y < minY) minY = y;
        }
        flush();
    }

    private emitHistogram(b: Batch, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const spacing = coords.bodySpacing();
        const w = Math.max(1, (s.kind === 'columns' ? 0.7 : 0.8) * spacing);
        const half = w / 2;
        const base = s.style.base ?? 0;
        const baseY = coords.priceToY(base, pane.scale, pane.bounds);
        for (let i = i0; i <= i1; i += 1) {
            const p = s.points[i - off];
            if (!p || p.value === null) continue;
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            b.rect(x - half, Math.min(baseY, y), w, Math.max(1, Math.abs(y - baseY)), parseColor(p.color ?? s.style.color));
        }
    }

    private emitPointMarkers(b: Batch, s: LineLikeSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, off = 0): void {
        const r = Math.max(1.5, s.style.width);
        for (let i = i0; i <= i1; i += 1) {
            const p = s.points[i - off];
            if (!p || p.value === null) continue;
            const x = coords.logicalToX(i);
            const y = coords.priceToY(p.value, pane.scale, pane.bounds);
            const c = parseColor(p.color ?? s.style.color);
            if (s.kind === 'cross') {
                b.seg(x - r, y, x + r, y, 1, c);
                b.seg(x, y - r, x, y + r, 1, c);
            } else {
                b.circle(x, y, r, c, Math.max(16, Math.ceil(r * 2))); // smoother at larger radii
            }
        }
    }

    private emitPlotCandles(b: Batch, s: CandleSeries, pane: PaneNode, coords: CoordinateSystem, i0: number, i1: number, theme: VelaTheme, off = 0): void {
        const spacing = coords.bodySpacing();
        const up = s.style?.up ?? theme.upColor;
        const down = s.style?.down ?? theme.downColor;
        const isBar = s.kind === 'bar';
        const half = Math.max(0.5, Math.floor(spacing * 0.7) / 2);
        const tickW = Math.max(1, Math.round(spacing * 0.35));
        for (let i = i0; i <= i1; i += 1) {
            const bar = s.bars[i - off];
            if (!bar) continue;
            const bc: CandleBarColor | null | undefined = s.barColors?.[i - off];
            const body = parseColor(bc?.color ?? (bar.close >= bar.open ? up : down));
            const x = Math.round(coords.logicalToX(i));
            const hY = coords.priceToY(bar.high, pane.scale, pane.bounds);
            const lY = coords.priceToY(bar.low, pane.scale, pane.bounds);
            const oY = coords.priceToY(bar.open, pane.scale, pane.bounds);
            const cY = coords.priceToY(bar.close, pane.scale, pane.bounds);
            if (isBar) {
                b.rect(x - 0.5, hY, 1, lY - hY, body);
                b.rect(x - tickW, oY - 0.5, tickW, 1, body);
                b.rect(x, cY - 0.5, tickW, 1, body);
                continue;
            }
            const wDev = Math.max(1, Math.round(wickWidth(spacing) * coords.dpr));
            const wx = (Math.round(x * coords.dpr) - (wDev >> 1)) / coords.dpr;
            b.rect(wx, hY, wDev / coords.dpr, lY - hY, parseColor(bc?.wickColor ?? bc?.color ?? (bar.close >= bar.open ? up : down)));
            const top = Math.min(oY, cY);
            const h = Math.max(1, Math.abs(cY - oY));
            b.rect(x - half, top, half * 2, h, body);
            if (bc?.borderColor) {
                const bord = parseColor(bc.borderColor);
                b.rect(x - half, top, half * 2, 1, bord);
                b.rect(x - half, top + h - 1, half * 2, 1, bord);
                b.rect(x - half, top, 1, h, bord);
                b.rect(x + half - 1, top, 1, h, bord);
            }
        }
    }

    private emitHline(b: Batch, pl: PriceLine, pane: PaneNode, coords: CoordinateSystem, dataW: number, theme: VelaTheme): void {
        const y = Math.round(coords.priceToY(pl.price, pane.scale, pane.bounds));
        if (y < pane.bounds.top || y > pane.bounds.top + pane.bounds.height) return;
        b.dashedSeg(0, y, dataW, y, pl.width ?? 1, parseColor(pl.color ?? theme.textColor), DASH[pl.lineStyle ?? 'solid'] ?? null);
    }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
    }
    return sh;
}

const ZERO: RGBA = [0, 0, 0, 0];

function clamp01(t: number): number {
    return t < 0 ? 0 : t > 1 ? 1 : t;
}

function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

function fadeAlpha(c: RGBA, t: number): RGBA {
    // Fade toward transparent BLACK (rgb + alpha → 0) to match canvas2d's
    // createLinearGradient(color → 'rgba(0,0,0,0)') area fill.
    const k = 1 - t;
    return [c[0] * k, c[1] * k, c[2] * k, c[3] * k];
}

function findPoints(model: IndicatorModel, seriesId: string): LineLikeSeries['points'] | null {
    const s = model.series.find((x) => x.id === seriesId);
    return s && isLineLikeSeries(s) ? s.points : null;
}

const EMPTY_BARCOLORS: ReadonlyMap<number, string> = new Map();

function mergeBarColors(indicators: Map<string, IndicatorModel>): ReadonlyMap<number, string> {
    let any = false;
    for (const m of indicators.values()) {
        if (m.barColors && m.barColors.length > 0) {
            any = true;
            break;
        }
    }
    if (!any) return EMPTY_BARCOLORS;
    const map = new Map<number, string>();
    for (const m of indicators.values()) {
        if (m.barColors) for (const bc of m.barColors) map.set(bc.time, bc.color);
    }
    return map;
}
