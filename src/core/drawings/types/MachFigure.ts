import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import { distToSegment, handleAt } from '../hittest';
import type { FibLevel } from './FibRatios';
import { cycleLevels, LEVEL_CYCLE } from '../levelPalette';

/** Wave-count presets for the linear Mach construction. */
export const MACH_WAVE_COUNT_OPTIONS = [3, 4, 5, 6, 8, 10, 12] as const;

/** Mach-number presets for the supersonic cone (M > 1). */
export const MACH_NUMBER_OPTIONS = [1.5, 2, 2.5, 3, 4, 5] as const;

const DEFAULT_WAVES = 6;
const DEFAULT_MACH = 2;

/** Default linear circle steps 1…12 (ratio = radius / R). */
export function linearMachLevels(enabledCount = DEFAULT_WAVES): FibLevel[] {
    return [...cycleLevels(LEVEL_CYCLE.length, enabledCount)];
}

function sanitizeLevel(v: unknown): FibLevel | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Partial<FibLevel>;
    if (typeof o.ratio !== 'number' || typeof o.color !== 'string') return null;
    return {
        ratio: o.ratio,
        color: o.color,
        enabled: o.enabled !== false,
        ...(typeof o.label === 'string' && o.label ? { label: o.label } : {}),
    };
}

export interface MachCircle {
    cx: number;
    cy: number;
    r: number;
    color: string;
    /** Radius / R — painted beside the circle. */
    ratio: number;
}

export interface MachGeom {
    /** Pixel midpoint of the user-drawn diameter (center of the first/newest circle). */
    c0x: number;
    c0y: number;
    /** Pixel radius of the first circle (= half the drawn diameter). */
    R: number;
    /** Unit expansion direction (first click → second click along the diameter). */
    fx: number;
    fy: number;
    /** Shock origin / nose (on the first-click side of the first circle). */
    noseX: number;
    noseY: number;
    circles: MachCircle[];
    /**
     * Envelope rays from the nose. Sonic: one shock-front segment (perpendicular wall).
     * Supersonic: two Mach-cone generators.
     */
    rays: Array<[number, number, number, number]>;
}

/**
 * Shared Mach wavefront construction (Huygens circles along a flight path).
 *
 * Two anchors are the **diameter endpoints of the first (newest) circle**. Placement
 * order sets the expansion direction: first click → second click. Each enabled level
 * is a circle with radius `ratio · R`; the gear panel edits per-circle color / enabled.
 */
/** Shared schema field: toggle on-chart ratio labels beside each circle. */
export const SHOW_RATIOS_FIELD = {
    path: 'showRatios',
    label: 'Show ratios',
    kind: 'boolean' as const,
    group: 'behavior' as const,
};

export abstract class MachFigure extends Drawing {
    /** Number of wavefront circles (linear tools); synced to `levels[].enabled`. */
    waveCount!: number;
    /** Per-circle config (ratio / color / enabled) — drives the settings gear. */
    levels!: FibLevel[];
    /** When true, paint each circle's ratio beside it. */
    showRatios!: boolean;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (this.waveCount === undefined) this.waveCount = DEFAULT_WAVES;
        if (this.showRatios === undefined) this.showRatios = true;
        const levelsFromProps = Array.isArray(init.props?.levels);
        if (!this.levels) this.levels = this.defaultLevels().map((l) => ({ ...l }));
        // Linear tools: Waves dropdown owns how many circles are enabled (unless props already set levels).
        if (!levelsFromProps && this.shouldSyncWaveCount()) this.syncLevelsToWaveCount();
    }

    /** Seed levels (ratio = radius / first-circle radius). */
    abstract defaultLevels(): readonly FibLevel[];

    /** Linear Sonic/Supersonic sync `waveCount` → enabled levels; Golden tools return false. */
    protected shouldSyncWaveCount(): boolean {
        return true;
    }

    protected syncLevelsToWaveCount(): void {
        const n = Math.max(1, Math.min(this.levels.length, Math.round(this.waveCount)));
        this.waveCount = n;
        for (let i = 0; i < this.levels.length; i += 1) this.levels[i]!.enabled = i < n;
    }

    /** 1 for sonic; >1 for supersonic (overridden / stored on the leaf). */
    abstract machNumber(): number;

    override editableLevels(): FibLevel[] | null {
        return this.levels;
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        return { min: 2, max: 2, slots: [{ role: 'd1', free: 'both' }, { role: 'd2', free: 'both' }] };
    }

    /** Pixel geometry for the current anchors, or null until both ends resolve. */
    geom(proj: Projector): MachGeom | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const ay = proj.yOf(a.price, this.paneId);
        const by = proj.yOf(b.price, this.paneId);
        if (ay == null || by == null) return null;
        const ax = proj.xOf(a.time);
        const bx = proj.xOf(b.time);
        const c0x = (ax + bx) / 2;
        const c0y = (ay + by) / 2;
        const R = Math.hypot(bx - ax, by - ay) / 2;
        if (R < 1) return null;

        // Expansion follows the diameter stroke (first click → second click): circles grow toward d2.
        let fx = bx - ax;
        let fy = by - ay;
        const flen = Math.hypot(fx, fy);
        if (flen < 1e-9) {
            fx = 1;
            fy = 0;
        } else {
            fx /= flen;
            fy /= flen;
        }

        const active = this.levels
            .filter((l) => l.enabled && l.ratio > 0)
            .slice()
            .sort((p, q) => p.ratio - q.ratio);
        if (active.length === 0) return null;

        const M = Math.max(1, this.machNumber());
        const circles: MachCircle[] = [];
        for (const lv of active) {
            const r = lv.ratio * R;
            circles.push({
                cx: c0x + M * (r - R) * fx,
                cy: c0y + M * (r - R) * fy,
                r,
                color: lv.color,
                ratio: lv.ratio,
            });
        }
        // Nose / shock origin sits on the d1 side of the first circle (ratio 1 → r = R).
        const noseX = c0x - M * R * fx;
        const noseY = c0y - M * R * fy;

        const maxR = circles[circles.length - 1]!.r;
        const rayLen = M * maxR + 2 * R;
        const rays: Array<[number, number, number, number]> = [];
        if (M <= 1 + 1e-9) {
            const px = -fy;
            const py = fx;
            rays.push([noseX - px * rayLen, noseY - py * rayLen, noseX + px * rayLen, noseY + py * rayLen]);
        } else {
            const mu = Math.asin(1 / M);
            const cos = Math.cos(mu);
            const sin = Math.sin(mu);
            const rot = (dx: number, dy: number, s: number): [number, number] => [dx * cos - dy * s * sin, dx * s * sin + dy * cos];
            const [d1x, d1y] = rot(fx, fy, 1);
            const [d2x, d2y] = rot(fx, fy, -1);
            rays.push([noseX, noseY, noseX + d1x * rayLen, noseY + d1y * rayLen]);
            rays.push([noseX, noseY, noseX + d2x * rayLen, noseY + d2y * rayLen]);
        }

        return { c0x, c0y, R, fx, fy, noseX, noseY, circles, rays };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const g = this.geom(proj);
        if (!g) return false;
        for (const c of g.circles) {
            if (Math.abs(Math.hypot(px - c.cx, py - c.cy) - c.r) <= tol) return true;
        }
        return g.rays.some((r) => distToSegment(px, py, r[0], r[1], r[2], r[3]) <= tol);
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return [];
        const ay = proj.yOf(a.price, this.paneId);
        const by = proj.yOf(b.price, this.paneId);
        if (ay == null || by == null) return [];
        return [
            [proj.xOf(a.time), ay],
            [proj.xOf(b.time), by],
        ];
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const g = this.geom(proj);
        if (!g) return null;
        let loX = g.noseX;
        let hiX = g.noseX;
        let loY = g.noseY;
        let hiY = g.noseY;
        for (const c of g.circles) {
            loX = Math.min(loX, c.cx - c.r);
            hiX = Math.max(hiX, c.cx + c.r);
            loY = Math.min(loY, c.cy - c.r);
            hiY = Math.max(hiY, c.cy + c.r);
        }
        for (const r of g.rays) {
            loX = Math.min(loX, r[0], r[2]);
            hiX = Math.max(hiX, r[0], r[2]);
            loY = Math.min(loY, r[1], r[3]);
            hiY = Math.max(hiY, r[1], r[3]);
        }
        return { x: loX, y: loY, w: hiX - loX, h: hiY - loY };
    }

    priceRange(): { min: number; max: number } | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
    }

    /** Sync the Waves dropdown onto `levels[].enabled` (first N on). */
    override applySettings(patch: Record<string, unknown>): void {
        super.applySettings(patch);
        if (Object.prototype.hasOwnProperty.call(patch, 'waveCount') && typeof this.waveCount === 'number') {
            const n = Math.max(1, Math.min(this.levels.length, Math.round(this.waveCount)));
            this.waveCount = n;
            for (let i = 0; i < this.levels.length; i += 1) this.levels[i]!.enabled = i < n;
        }
    }

    schema(): SettingsSchema {
        return {
            fields: [
                ...LINE_FIELDS,
                {
                    path: 'waveCount',
                    label: 'Waves',
                    kind: 'number',
                    min: 3,
                    max: 12,
                    step: 1,
                    group: 'behavior',
                },
                SHOW_RATIOS_FIELD,
                ...TEXT_FIELDS,
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return {
            waveCount: this.waveCount,
            showRatios: this.showRatios,
            levels: this.levels.map((l) => ({ ...l })),
        };
    }

    protected override readProps(props: Record<string, unknown>): void {
        if (typeof props.waveCount === 'number' && Number.isFinite(props.waveCount)) {
            this.waveCount = Math.max(2, Math.min(12, Math.round(props.waveCount)));
        }
        if (typeof props.showRatios === 'boolean') this.showRatios = props.showRatios;
        if (Array.isArray(props.levels)) {
            const parsed = props.levels.map(sanitizeLevel).filter((l): l is FibLevel => l != null);
            if (parsed.length) this.levels = parsed;
        }
    }
}

/** Sonic (M = 1) Mach figure — wavefront circles pile into a perpendicular shock wall. */
export class Sonic extends MachFigure {
    readonly type = 'sonic' as const;

    defaultLevels(): readonly FibLevel[] {
        return linearMachLevels(DEFAULT_WAVES);
    }

    machNumber(): number {
        return 1;
    }
}

/**
 * Supersonic Mach cone — wavefront circles with M > 1; envelope is the cone
 * μ = arcsin(1/M). The first circle's diameter is user-drawn; M is a setting.
 */
export class Supersonic extends MachFigure {
    readonly type = 'supersonic' as const;

    mach!: number;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (this.mach === undefined) this.mach = DEFAULT_MACH;
    }

    defaultLevels(): readonly FibLevel[] {
        return linearMachLevels(DEFAULT_WAVES);
    }

    machNumber(): number {
        return Math.max(1.01, this.mach);
    }

    override schema(): SettingsSchema {
        return {
            fields: [
                ...LINE_FIELDS,
                {
                    path: 'mach',
                    label: 'Mach number',
                    kind: 'number',
                    min: 1.5,
                    max: 5,
                    step: 0.5,
                    group: 'behavior',
                },
                {
                    path: 'waveCount',
                    label: 'Waves',
                    kind: 'number',
                    min: 3,
                    max: 12,
                    step: 1,
                    group: 'behavior',
                },
                SHOW_RATIOS_FIELD,
                ...TEXT_FIELDS,
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { ...super.writeProps(), mach: this.mach };
    }

    protected override readProps(props: Record<string, unknown>): void {
        super.readProps(props);
        if (typeof props.mach === 'number' && Number.isFinite(props.mach)) {
            this.mach = Math.max(1.01, Math.min(20, props.mach));
        }
    }
}
