import { stableSeriesId, type IdentifiableKind } from '../../core/model/identity';

/**
 * Assigns content-addressed, edit-stable ids within one indicator instance,
 * disambiguating same-title plots by ordinal. Not PineTS `_callsiteId` (a
 * transpile-order counter that renumbers on edits).
 */
export class IdentityMap {
    private readonly ordinals = new Map<string, number>();

    next(instanceId: string, kind: IdentifiableKind, title: string): string {
        const bucket = `${kind}:${title.trim().toLowerCase()}`;
        const ordinal = this.ordinals.get(bucket) ?? 0;
        this.ordinals.set(bucket, ordinal + 1);
        return stableSeriesId({ instanceId, kind, title, ordinal });
    }
}
