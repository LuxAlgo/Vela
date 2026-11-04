// The gallery's data components: stats, keycaps, an empty state, a table, a sparkline, a donut,
// the three charts and a hover card, on sample trading figures.
import { t } from '@luxalgo/vela-ui';
import { createBarChart } from '@luxalgo/vela-ui/bar-chart';
import { createDataTable } from '@luxalgo/vela-ui/data-table';
import { createDonut } from '@luxalgo/vela-ui/donut';
import { createEmpty } from '@luxalgo/vela-ui/empty';
import { attachHoverCard } from '@luxalgo/vela-ui/hover-card';
import { shortcutKeys } from '@luxalgo/vela-ui/kbd';
import { createLineChart } from '@luxalgo/vela-ui/line-chart';
import { createScatterChart } from '@luxalgo/vela-ui/scatter-chart';
import { createSparkline } from '@luxalgo/vela-ui/sparkline';
import { createStat, toneOf } from '@luxalgo/vela-ui/stat';
import { createButton } from '../src/ui';

interface Trade {
    id: string;
    symbol: string;
    side: 'Long' | 'Short';
    pnl: number;
    bars: number;
}

const TRADES: Trade[] = [
    { id: '1', symbol: 'BTCUSDT', side: 'Long', pnl: 412.5, bars: 18 },
    { id: '2', symbol: 'ETHUSDT', side: 'Short', pnl: -120.25, bars: 7 },
    { id: '3', symbol: 'SOLUSDT', side: 'Long', pnl: 88, bars: 31 },
    { id: '4', symbol: 'BNBUSDT', side: 'Short', pnl: 0, bars: 4 },
];

const box = (w: string, h: string, child: HTMLElement): HTMLElement => {
    const el = document.createElement('div');
    el.style.width = w;
    el.style.height = h;
    el.append(child);
    return el;
};

export function dataGallery(row: (label: string, ...children: HTMLElement[]) => void, host: HTMLElement): void {
    const net = TRADES.reduce((a, r) => a + r.pnl, 0);
    row('stat', createStat({ label: 'Net P&L', value: net.toFixed(2), tone: toneOf(net), sub: `${TRADES.length} trades` }).el, createStat({ label: 'Worst trade', value: '-120.25', tone: 'loss' }).el, createStat({ label: 'Open orders' }).el);
    row('kbd', ...shortcutKeys('Ctrl+Shift+K'));
    row('empty', box('320px', 'auto', createEmpty({ icon: 'bell', title: 'No alerts yet', description: 'Create one from the chart or the alerts panel.', action: createButton({ text: 'New alert', variant: 'outline', size: 'sm' }).el }).el));

    const table = createDataTable<Trade>({
        columns: [
            { id: 'symbol', header: 'Symbol', cell: (r) => r.symbol, sort: (r) => r.symbol },
            { id: 'side', header: 'Side', cell: (r) => r.side },
            { id: 'bars', header: 'Bars', title: 'Bars held', align: 'end', cell: (r) => r.bars, sort: (r) => r.bars },
            { id: 'pnl', header: 'P&L', align: 'end', cell: (r) => r.pnl.toFixed(2), sort: (r) => r.pnl, tone: (r) => (r.pnl > 0 ? 'profit' : r.pnl < 0 ? 'loss' : 'muted') },
        ],
        rowKey: (r) => r.id,
        sort: { column: 'pnl', dir: 'desc' },
    });
    table.setRows(TRADES);
    row('data-table', box('420px', '150px', table.el));

    const sparks = document.createElement('span');
    sparks.append(createSparkline({ values: [10, 11, 10.5, 12, 11.8, 13] }).el, createSparkline({ values: [13, 12.6, 12.9, 11.7, 11.2], area: true, baseline: 12.4, width: 96, height: 28 }).el);
    row('sparkline', sparks);
    row('donut', createDonut({ segments: [{ value: 2, label: 'Wins', color: t.profit.var }, { value: 1, label: 'Losses', color: t.loss.var }, { value: 1, label: 'Even', color: t.fg.muted.var }], center: '67%', caption: 'win rate' }).el);

    const bars = createBarChart({ axes: true, axisTitle: 'P&L' });
    row('bar-chart', box('420px', '160px', bars.el));
    bars.setData([12, -8, 25, 4, -15, 31, 9].map((value, i) => ({ label: `D${i + 1}`, value })), [{ at: 3.5, color: t.accent.var }]);

    const line = createLineChart({ axes: true, yFormat: (v) => v.toFixed(0) });
    row('line-chart', box('420px', '160px', line.el));
    line.setData([0, 40, 25, 70, 55, 90, 120].map((y, x) => ({ x, y })));

    const scatter = createScatterChart({ xTitle: 'Bars held', yTitle: 'P&L' });
    row('scatter-chart', box('420px', '200px', scatter.el));
    scatter.setData(TRADES.map((r) => ({ x: r.bars, y: r.pnl, color: r.pnl >= 0 ? t.profit.var : t.loss.var })), [{ x: 0, y: 40 }, { x: 32, y: 160 }]);

    const trigger = createButton({ text: 'Hover me', variant: 'outline', size: 'sm' }).el;
    attachHoverCard(trigger, () => ({ title: 'Long position', icon: 'bell', shortcut: 'Alt+L', description: 'Draws a long trade with its target and stop.', hint: 'Shift-click to keep the tool' }), { host, openDelay: 150 });
    row('hover-card', trigger);
}
