// Browser global build (window.Vela) — batteries-included: the full public
// API plus the bundled providers, as one self-contained IIFE for script-tag
// usage and the playground. The npm entry (`./index`) stays lean.
export * from './index';
export { BinanceProvider } from './data/providers/binance';
export { HyperliquidProvider } from './data/providers/hyperliquid';
export { CoinbaseProvider } from './data/providers/coinbase';
// The drawing color picker — reused by the widget UI for its chart/indicator
// color settings so they share the exact same swatch+opacity control as drawings.
export { buildColorPicker, splitColor, combineColor } from './ui/components/color-picker';
