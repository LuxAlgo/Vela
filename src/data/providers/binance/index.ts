// Public entry for the from-scratch Binance data provider, published as the
// `vela/providers/binance` subpath. No provider is bundled into the main
// entry — register this one explicitly:
//   import { BinanceProvider } from 'vela/providers/binance';
//   chart.data.registerProvider('binance', new BinanceProvider());
export { BinanceProvider } from './BinanceProvider';
export type { SymbolDescriptor, ProviderInfo, DataProvider } from '../../../core/ports/DataProvider';
