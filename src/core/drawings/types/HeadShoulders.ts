import { msg } from '../../i18n/message';
import type { MessageLike } from '../../i18n/types';
import { PatternDrawing } from './PatternDrawing';

const LEFT_SHOULDER = msg('drawing.headshoulders.leftShoulder', 'LS');
const HEAD = msg('drawing.headshoulders.head', 'H');
const RIGHT_SHOULDER = msg('drawing.headshoulders.rightShoulder', 'RS');

/**
 * Head & shoulders — 7 points (start, left shoulder, trough, head, trough, right shoulder,
 * end) with the three peaks labelled and an extended neckline through the two troughs.
 */
export class HeadShoulders extends PatternDrawing {
    readonly type = 'headshoulders' as const;

    vertexLabels(): readonly MessageLike[] {
        return ['', LEFT_SHOULDER, '', HEAD, '', RIGHT_SHOULDER, ''];
    }

    override necklineIndices(): readonly [number, number] {
        return [2, 4]; // the two troughs flanking the head
    }
}
