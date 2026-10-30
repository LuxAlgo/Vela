// Badge CONTROLLER — tone and shape of a short status label or count. No DOM.
import type { PartProps } from '../../headless';

/** `neutral` (default), `accent` (the theme's accent), `up` / `down` (the market colors). */
export type BadgeTone = 'neutral' | 'accent' | 'up' | 'down';

export interface BadgeControllerOptions {
    tone?: BadgeTone;
    /** A round count pill (`3`, `9+`) rather than a label. */
    count?: boolean;
}

export interface BadgeController {
    readonly tone: BadgeTone;
    setTone(tone: BadgeTone): void;
    rootProps(): PartProps;
}

export function badgeController(opts: BadgeControllerOptions = {}): BadgeController {
    let tone = opts.tone ?? 'neutral';
    return {
        get tone() {
            return tone;
        },
        setTone(v) {
            tone = v;
        },
        rootProps: () => ({ 'data-tone': tone, 'data-count': opts.count === true }),
    };
}
