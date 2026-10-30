// Badge CONTROLLER — variant and shape of a short status label or count. No DOM.
import type { PartProps } from '../../headless';

/** `default` = filled with the selection color; `secondary` = a neutral tint; `outline` =
 *  bordered; `destructive` = tinted with the danger color; `up` / `down` = tinted with the
 *  market colors. */
export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive' | 'up' | 'down';

export interface BadgeControllerOptions {
    /** Default `default`. */
    variant?: BadgeVariant;
    /** A round count pill (`3`, `9+`) rather than a label. */
    count?: boolean;
}

export interface BadgeController {
    readonly variant: BadgeVariant;
    setVariant(variant: BadgeVariant): void;
    rootProps(): PartProps;
}

export function badgeController(opts: BadgeControllerOptions = {}): BadgeController {
    let variant = opts.variant ?? 'default';
    return {
        get variant() {
            return variant;
        },
        setVariant(v) {
            variant = v;
        },
        rootProps: () => ({ 'data-slot': 'badge', 'data-variant': variant, 'data-count': opts.count === true }),
    };
}
