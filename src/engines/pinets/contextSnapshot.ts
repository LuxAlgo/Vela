// Build the NEUTRAL, serializable EngineContextSnapshot from a PineTS run context.
// Same narrow-contract philosophy as PineRun.ts: we read a few known fields and
// deep-copy only what survives structured cloning — live references never escape.
import type { EngineContextSnapshot, ContextSelect } from '../../core/ports/ScriptingEngine';
import { normalizeContext } from './normalizeContext';

interface RawCtx {
    fullContext?: RawCtx;
    idx?: unknown;
    length?: unknown;
    params?: Record<string, unknown>;
    const?: Record<string, unknown>;
    var?: Record<string, unknown>;
    let?: Record<string, unknown>;
    result?: unknown;
    warnings?: Array<{ message?: unknown; method?: unknown; bar?: unknown }>;
}

/** Deep-copy a value if it survives structured cloning; undefined otherwise. */
function cloneable(v: unknown): unknown {
    try {
        return structuredClone(v);
    } catch {
        return undefined;
    }
}

/** Serializable subset of a variables bucket (functions/Series/cycles are dropped). */
function pickVars(bucket: Record<string, unknown> | undefined, into: Record<string, unknown>, prefix: string): void {
    if (!bucket) return;
    for (const [k, v] of Object.entries(bucket)) {
        if (k.startsWith('_')) continue;
        const c = cloneable(v);
        if (c !== undefined) into[prefix ? `${prefix}.${k}` : k] = c;
    }
}

export function snapshotFromCtx(ctx: unknown, phase: EngineContextSnapshot['phase'], select?: ContextSelect): EngineContextSnapshot {
    const c = (ctx ?? {}) as RawCtx;
    const root = c.fullContext ?? c;
    const want = (k: keyof EngineContextSnapshot): boolean => !select || select.includes(k);
    const run = want('meta') || want('plots') ? normalizeContext(ctx as never) : null;

    const plots: EngineContextSnapshot['plots'] = {};
    if (run && want('plots')) {
        for (const p of run.plots) {
            if (p.key.startsWith('__')) continue; // engine-internal channels (drawings buffers)
            plots[p.key] = p.data.map((pt) => ({ time: pt.time, value: cloneable(pt.value) ?? null }));
        }
    }
    const variables: Record<string, unknown> = {};
    if (want('variables')) {
        pickVars(root.params, variables, 'params');
        pickVars(root.const, variables, 'const');
        pickVars(root.var, variables, 'var');
        pickVars(root.let, variables, 'let');
    }
    const barIndexRaw = typeof root.idx === 'number' ? root.idx : typeof root.length === 'number' ? root.length - 1 : -1;
    return {
        language: 'pine',
        phase,
        barIndex: barIndexRaw,
        meta: run && want('meta')
            ? { title: run.meta.title, overlay: run.meta.overlay, precision: run.meta.precision, shorttitle: run.meta.shorttitle }
            : { title: '', overlay: false },
        plots,
        variables,
        result: want('result') ? (cloneable(root.result) ?? null) : null,
        warnings: want('warnings')
            ? (root.warnings ?? []).map((w) => ({ message: String(w.message ?? ''), method: typeof w.method === 'string' ? w.method : undefined, bar: Number(w.bar ?? 0) }))
            : [],
    };
}
