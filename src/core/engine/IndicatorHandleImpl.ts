import type { IndicatorHandle, IndicatorEventMap } from '../IndicatorHandle';
import type { InputSchema, InputValue } from '../model/inputs';
import type { ContextSelect, EngineContextSnapshot } from '../ports/ScriptingEngine';
import type { MoveTarget } from '../options';
import { TypedEventBus } from '../events/EventBus';

/** Callback surface the handle uses to drive the orchestrator. */
export interface IndicatorController {
    getIndicatorContext(id: string, select?: ContextSelect): Promise<EngineContextSnapshot | null>;
    applyInputs(id: string, values: Record<string, InputValue>): void;
    removeIndicator(id: string): void;
    setVisible(id: string, visible: boolean): void;
    moveIndicator(id: string, target: MoveTarget): void;
}

/** Concrete `IndicatorHandle` returned by `addIndicator`. */
export class IndicatorHandleImpl implements IndicatorHandle {
    readonly id: string;
    title: string;
    private schema: InputSchema[] = [];
    private visibleState = true;
    private readonly bus = new TypedEventBus<IndicatorEventMap>();

    constructor(
        id: string,
        title: string,
        private readonly controller: IndicatorController,
    ) {
        this.id = id;
        this.title = title;
    }

    get inputs(): readonly InputSchema[] {
        return this.schema;
    }

    get visible(): boolean {
        return this.visibleState;
    }

    setInput(key: string, value: InputValue): void {
        this.controller.applyInputs(this.id, { [key]: value });
    }

    setInputs(values: Record<string, InputValue>): void {
        this.controller.applyInputs(this.id, values);
    }

    setVisible(visible: boolean): void {
        this.controller.setVisible(this.id, visible);
    }

    moveTo(target: MoveTarget): void {
        this.controller.moveIndicator(this.id, target);
    }

    on<K extends keyof IndicatorEventMap>(event: K, handler: (payload: IndicatorEventMap[K]) => void): () => void {
        return this.bus.on(event, handler);
    }

    context(select?: ContextSelect): Promise<EngineContextSnapshot | null> {
        return this.controller.getIndicatorContext(this.id, select);
    }

    remove(): void {
        this.controller.removeIndicator(this.id);
    }

    // ── internal (used by the orchestrator) ──────────────────────
    setSchema(schema: InputSchema[]): void {
        this.schema = schema;
    }

    /** Sync the public `visible` getter when the orchestrator changes visibility (API or legend eye). */
    setVisibleState(visible: boolean): void {
        this.visibleState = visible;
    }

    emit<K extends keyof IndicatorEventMap>(event: K, payload: IndicatorEventMap[K]): void {
        this.bus.emit(event, payload);
    }
}
