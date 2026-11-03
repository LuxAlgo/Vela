// The controller ↔ view bridge for Zag-machine components. HEADLESS-FIRST: a component's
// controller is a running Zag machine (framework-agnostic state/behavior/ARIA); the vanilla
// view subscribes and projects api props onto its own DOM via `spreadProps`. A future
// `vela/react` reuses the SAME machines through Zag's React adapter and swaps only the view.
import { VanillaMachine, normalizeProps, spreadProps } from '@zag-js/vanilla';
import type { Machine, MachineSchema, Service } from '@zag-js/core';

export { normalizeProps, spreadProps };

/** The MachineHandle for a given machine definition (package schemas aren't exported —
 *  infer them from the machine value: `HandleOf<typeof tooltip.machine>`). */
export type HandleOf<M> = M extends Machine<infer T extends MachineSchema> ? MachineHandle<T> : never;

export interface MachineHandle<T extends MachineSchema> {
    service: Service<T>;
    /** Re-run the view projection now (e.g. after external DOM swaps). */
    flush(): void;
    stop(): void;
}

/** Start a machine and keep `render(service)` in sync with every transition.
 *  `render` runs once immediately (initial projection) and on each machine notification. */
export function runMachine<T extends MachineSchema>(
    machine: Machine<T>,
    props: Partial<T['props']> | (() => Partial<T['props']>),
    render: (service: Service<T>) => void,
): MachineHandle<T> {
    const m = new VanillaMachine(machine, props);
    const unsub = m.subscribe(render);
    m.start();
    render(m.service);
    return {
        service: m.service,
        flush: () => render(m.service),
        stop: () => {
            unsub();
            m.stop();
        },
    };
}

let uid = 0;
/** Unique ids for machine instances (Zag keys its DOM lookups on them). */
export function nextUid(prefix: string): string {
    return `${prefix}-${++uid}`;
}
