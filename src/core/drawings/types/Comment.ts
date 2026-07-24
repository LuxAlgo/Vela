import { CalloutBase } from './CalloutBase';

/** A rounded speech balloon pointing at a target — a softer-cornered Callout variant. */
export class Comment extends CalloutBase {
    readonly type = 'comment' as const;

    protected override defaultLabel(): string {
        return 'Comment';
    }
}
