import { CalloutBase } from './CalloutBase';

/**
 * A signpost: a sign plate (anchor[1]) on a pole rising from a pinned level (anchor[0], marked by a
 * nub). Reuses the two-anchor rig (pin the base, drag the sign); only the painter differs.
 */
export class Signpost extends CalloutBase {
    readonly type = 'signpost' as const;

    protected override defaultLabel(): string {
        return 'Signpost';
    }
}
