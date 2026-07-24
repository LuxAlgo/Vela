export type EventHandler<T> = (payload: T) => void;

/** Minimal typed pub/sub. Handler errors are isolated (logged, never thrown). */
export class TypedEventBus<Events extends Record<string, unknown>> {
    private readonly handlers = new Map<keyof Events, Set<EventHandler<unknown>>>();

    on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
        let set = this.handlers.get(event);
        if (!set) {
            set = new Set();
            this.handlers.set(event, set);
        }
        const bucket = set;
        bucket.add(handler as EventHandler<unknown>);
        return () => {
            bucket.delete(handler as EventHandler<unknown>);
        };
    }

    off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
        this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
    }

    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
        const set = this.handlers.get(event);
        if (!set) return;
        for (const handler of set) {
            try {
                handler(payload);
            } catch (err) {
                console.error(`[vela] event handler error for "${String(event)}"`, err);
            }
        }
    }

    clear(): void {
        this.handlers.clear();
    }
}
