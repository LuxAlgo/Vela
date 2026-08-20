// The shared base-asset heuristic + the bundled crypto providers' icon resolvers —
// the provider owns the icon-source knowledge (resolveSymbolIcon), the shells only render.
import { describe, it, expect } from 'vitest';
import { baseOf, ledgerCryptoIconUrl } from '../src/data/symbol-base';
import { BinanceProvider } from '../src/data/providers/binance/BinanceProvider';
import { CoinbaseProvider } from '../src/data/providers/coinbase/CoinbaseProvider';
import { HyperliquidProvider } from '../src/data/providers/hyperliquid/HyperliquidProvider';

describe('baseOf', () => {
    it('prefers the description first segment, strips Perpetual, falls back to de-suffixed ticker', () => {
        expect(baseOf({ ticker: 'BTCUSDT', description: 'BTC / USDT' })).toBe('BTC');
        expect(baseOf({ ticker: 'BTCUSDT.P', description: 'BTC / USDT Perpetual' })).toBe('BTC');
        expect(baseOf({ ticker: 'ETHUSDT' })).toBe('ETH');
        expect(baseOf({ ticker: 'SOL-USD' })).toBe('SOL');
        expect(baseOf({ ticker: 'USDT' })).toBe('USDT'); // never emptied
    });
});

describe('ledgerCryptoIconUrl', () => {
    it('uppercases and URL-encodes the base; empty ⇒ undefined', () => {
        expect(ledgerCryptoIconUrl('btc')).toBe('https://crypto-icons.ledger.com/BTC.png');
        expect(ledgerCryptoIconUrl('')).toBeUndefined();
        expect(ledgerCryptoIconUrl('  ')).toBeUndefined();
    });
});

describe('bundled crypto providers predefine resolveSymbolIcon (Ledger CDN)', () => {
    it.each([
        ['binance', new BinanceProvider()],
        ['coinbase', new CoinbaseProvider()],
        ['hyperliquid', new HyperliquidProvider()],
    ] as const)('%s resolves from the descriptor base', (_name, p) => {
        expect(p.resolveSymbolIcon({ ticker: 'BTCUSDT', description: 'BTC / USDT' })).toBe('https://crypto-icons.ledger.com/BTC.png');
        expect(p.resolveSymbolIcon({ ticker: 'ETH-USD' })).toBe('https://crypto-icons.ledger.com/ETH.png');
    });
});
