// Order-flow readings derived from the tape: per-bar delta and its running total.
export { registerDelta, deltaDescriptor } from './DeltaIndicator';
export { registerCvd, cvdDescriptor } from './CvdIndicator';
export { TapeIndicator, tapeAvailable } from './TapeIndicator';
export { ANCHOR_OPTIONS, anchorStart, crossesAnchor, parseAnchor } from './anchors';
export type { CumulativeAnchor } from './anchors';
