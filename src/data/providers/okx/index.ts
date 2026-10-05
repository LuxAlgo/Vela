// Public entry for the from-scratch OKX data provider, published as the
// `vela/providers/okx` subpath. No provider is bundled into the main
// entry — register this one explicitly:
//   import { OkxProvider } from 'vela/providers/okx';
//   chart.data.registerProvider('okx', new OkxProvider());
export { OkxProvider } from './OkxProvider';
export type { SymbolDescriptor, ProviderInfo, DataProvider } from '../../../core/ports/DataProvider';
