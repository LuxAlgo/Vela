// The workspace playground page: a 4-cell VelaWorkspace on live Binance data with the
// worker Pine engine — the multi-chart surface exercised straight from src/ (HMR).
// A floating picker switches layouts (the shared topbar dropdown lands with the chrome).
import { VelaWorkspace, layouts } from '../src/workspace';
import { PineWorkerEngine } from '../src';
import { BinanceProvider } from '../src/data/providers/binance';

const ws = new VelaWorkspace('#workspace', {
    layout: '4',
    cells: {
        c1: { symbol: 'BTCUSDT', timeframe: '60' },
        c2: { symbol: 'ETHUSDT', timeframe: '15' },
        c3: { symbol: 'SOLUSDT', timeframe: '240' },
        c4: { symbol: 'BNBUSDT', timeframe: 'D' },
    },
    defaults: { symbol: 'BTCUSDT', timeframe: '60' },
    providers: { binance: () => new BinanceProvider() },
    engines: { pine: () => new PineWorkerEngine() },
    live: true,
    theme: 'dark',
});

// Temporary layout picker until the shared topbar lands: bottom-left floating select.
const picker = document.createElement('select');
picker.style.cssText =
    'position:fixed;left:10px;bottom:10px;z-index:100;background:#1c1d20;color:#d1d4dc;border:1px solid #2a2b30;border-radius:4px;padding:4px 8px;font:12px system-ui;';
for (const def of layouts()) {
    const opt = document.createElement('option');
    opt.value = def.id;
    opt.textContent = `${def.label} (${def.id})`;
    if (def.id === ws.layout.id) opt.selected = true;
    picker.appendChild(opt);
}
picker.addEventListener('change', () => ws.setLayout(picker.value));
ws.on('layout:changed', ({ layout }) => {
    picker.value = layout;
});
document.body.appendChild(picker);

// Handy for poking around from the browser console (and for the automated probes).
(window as unknown as { __ws: VelaWorkspace }).__ws = ws;
