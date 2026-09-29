// Tape aggregation: the pure footprint book plus the shared reader that fills it from a
// provider's trade history and live stream.
export {
    createBook,
    levelSizeFor,
    levelIndex,
    levelPrice,
    barTimeAt,
    foldTrades,
    pruneBefore,
    clearBar,
    readBar,
    readBars,
    footprintImbalances,
    cumulativeDeltaBars,
} from './footprint';
export type { FootprintBook, BarAcc, ImbalanceOptions } from './footprint';
export { TapeSource } from './TapeSource';
export type { TapeAccess, TapeSourceOptions } from './TapeSource';
export { acquireTapeSource, leasedTapeSources } from './shared';
export type { SharedTapeOptions, TapeLease } from './shared';
