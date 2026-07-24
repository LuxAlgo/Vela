/**
 * The NARROW contract `src/engines/pinets/` owns of what it reads from a PineTS run.
 * Deliberately not `import`ed from PineTS's `Context` type — PineTS can add,
 * rename, or reshape anything outside these fields and only this folder changes.
 */
export interface PinePlotPoint {
    time: number; // epoch ms (PineTS `openTime`)
    value: number | number[] | boolean | null;
    options?: Record<string, unknown>;
}

export interface PinePlot {
    key: string;
    title?: string;
    style?: string;
    options: Record<string, unknown>;
    data: PinePlotPoint[];
    /** fill() references to other plot keys. */
    plot1?: string;
    plot2?: string;
}

export interface PineRunMeta {
    title: string;
    overlay: boolean;
    precision?: number;
    shorttitle?: string;
    format?: string;
}

export interface PineRun {
    meta: PineRunMeta;
    plots: PinePlot[];
}

export function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
