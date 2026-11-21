// The gallery's lists and sections: a replay slider, a panel's drawers and a list's group
// headers, list rows, sort buttons over a small watchlist, and a journal's month of P&L.
import { createBadge } from '@luxalgo/vela-ui/badge';
import { createButton } from '@luxalgo/vela-ui/button';
import { createCollapsible, type CollapsibleHandle } from '@luxalgo/vela-ui/collapsible';
import { createItem, createItemGroup } from '@luxalgo/vela-ui/item';
import { createMonthGrid, type MonthGridDay } from '@luxalgo/vela-ui/month-grid';
import { createSlider } from '@luxalgo/vela-ui/slider';
import { createSortButton, type SortButtonHandle, type SortDirection } from '@luxalgo/vela-ui/sort-button';

type Row = (label: string, ...children: HTMLElement[]) => void;

const div = (style: string, ...children: (Node | string)[]): HTMLDivElement => {
    const el = document.createElement('div');
    el.style.cssText = style;
    el.append(...children);
    return el;
};
const span = (text: string, style = ''): HTMLSpanElement => {
    const el = document.createElement('span');
    el.textContent = text;
    el.style.cssText = style;
    return el;
};
const muted = 'color: var(--vela-fg-muted); font-size: 11px; font-variant-numeric: tabular-nums;';
const tone = (n: number): string => `color: var(--vela-${n > 0 ? 'profit' : n < 0 ? 'loss' : 'fg-muted'});`;
const avatar = (letter: string, hue: number): HTMLElement =>
    span(letter, `display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:hsl(${hue} 70% 45%);color:var(--vela-fg-on-fill);font-size:12px;font-weight:600;`);
const iconButton = (icon: string, label: string): HTMLElement => createButton({ icon, label, variant: 'ghost', size: 'icon-xs' }).el;

export function sliderGallery(row: Row): void {
    const steps = 200;
    const first = Date.UTC(2026, 0, 2);
    const last = Date.UTC(2026, 10, 6);
    const day = (step: number): string => new Date(first + ((last - first) * step) / steps).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const preview = span('', muted);
    const committed = span('', muted);
    const paint = (v: number, done: boolean): void => {
        preview.textContent = `Dragging ${day(v)}`;
        if (done) committed.textContent = `Seeked to ${day(v)}`;
    };
    const slider = createSlider({ min: 0, max: steps, defaultValue: 120, label: 'Replay position', valueText: day, onValueChange: (v) => paint(v, false), onValueCommit: (v) => paint(v, true) });
    paint(120, true);
    row('replay', div('width:320px;display:flex;flex-direction:column;gap:6px;', slider.el, div('display:flex;justify-content:space-between;', span(day(0), muted), span(day(steps), muted)), div('display:flex;gap:12px;', preview, committed)));

    const opacity = span('35%', muted);
    const fine = createSlider({ min: 0, max: 1, step: 0.01, defaultValue: 0.35, label: 'Opacity', valueText: (v) => `${Math.round(v * 100)}%`, onValueChange: (v) => (opacity.textContent = `${Math.round(v * 100)}%`) });
    row('steps', div('width:240px;display:flex;align-items:center;gap:10px;', fine.el, opacity));
    row('disabled', div('width:240px;', createSlider({ defaultValue: 70, disabled: true, label: 'Disabled' }).el));
    row('vertical', div('height:96px;', createSlider({ defaultValue: 30, orientation: 'vertical', label: 'Volume' }).el));
}

export function collapsibleGallery(row: Row): void {
    // A journal's two drawers: opening one closes the other.
    const trades = createItemGroup({
        items: [
            createItem({ title: 'BTCUSDT', description: 'Long · 14:32', meta: span('+412.50', tone(1)), size: 'sm', onSelect: () => {} }),
            createItem({ title: 'ETHUSDT', description: 'Short · 11:05', meta: span('-120.25', tone(-1)), size: 'sm', onSelect: () => {} }),
        ],
    });
    const drawers: CollapsibleHandle[] = [];
    const drawer = (title: string, count: number, content: Node, open: boolean): CollapsibleHandle => {
        const c = createCollapsible({
            title,
            count,
            content,
            defaultOpen: open,
            onOpenChange: (on) => {
                for (const other of drawers) if (other !== c) other.setOpen(!on);
            },
        });
        drawers.push(c);
        return c;
    };
    row('default', div('width:320px;border:1px solid var(--vela-border);border-radius:8px;padding:4px;', drawer('Trades', 2, trades.el, true).el, drawer('Notes', 3, span('Waited for the retest before adding.', 'display:block;padding:8px 12px;font-size:12px;'), false).el));

    const group = (title: string, names: string[], open: boolean): HTMLElement =>
        createCollapsible({ variant: 'label', title, count: names.length, defaultOpen: open, content: createItemGroup({ items: names.map((n) => createItem({ title: n, size: 'sm', onSelect: () => {} })) }).el }).el;
    row('label', div('width:320px;', group('Oscillators', ['RSI', 'Stochastic', 'MACD'], true), group('Volume', ['VWAP', 'OBV'], false)));

    // A template's row folds out what it carries, from a chevron among its actions.
    const chevron = createButton({ icon: 'chevron-down', label: 'Show the indicators', variant: 'ghost', size: 'icon-xs' });
    const tags = div('display:flex;flex-wrap:wrap;gap:4px;padding:2px 10px 10px 48px;', ...['EMA 21', 'VWAP', 'RSI 14'].map((n) => createBadge({ text: n, variant: 'secondary' }).el));
    const fold = createCollapsible({ trigger: chevron.el, content: tags, onOpenChange: (on) => (chevron.el.style.transform = on ? 'rotate(180deg)' : '') });
    const template = createItem({
        media: avatar('S', 210),
        title: 'Scalping setup',
        description: '3 indicators · edited yesterday',
        actions: [createButton({ variant: 'favorite', size: 'icon-xs', label: 'Favorite', defaultPressed: true }).el, chevron.el],
        onSelect: () => {},
    });
    row('host trigger', div('width:320px;', template.el, fold.el));
}

export function itemGallery(row: Row): void {
    const quote = (last: string, change: number): HTMLElement[] => [span(last), span(`${change > 0 ? '+' : ''}${change.toFixed(2)}%`, `${tone(change)}min-width:52px;`)];
    const watch = createItemGroup({
        separated: true,
        label: 'Watchlist',
        items: [
            createItem({ media: avatar('B', 35), title: 'BTCUSDT', description: 'Bitcoin / TetherUS', meta: quote('64,210.5', 1.24), actions: iconButton('close', 'Remove BTCUSDT'), revealActions: true, selected: true, onSelect: () => {} }),
            createItem({ media: avatar('E', 250), title: 'ETHUSDT', description: 'Ethereum / TetherUS', meta: quote('3,180.2', -0.85), actions: iconButton('close', 'Remove ETHUSDT'), revealActions: true, onSelect: () => {} }),
            createItem({ media: avatar('S', 160), title: 'SOLUSDT', description: 'Solana / TetherUS', meta: quote('142.7', 0), actions: iconButton('close', 'Remove SOLUSDT'), revealActions: true, onSelect: () => {} }),
        ],
    });
    row('watchlist', div('width:380px;', watch.el));

    const alertTitle = (name: string, active: boolean): HTMLElement => {
        const t = span(name, 'display:inline-flex;align-items:center;gap:8px;');
        t.append(createBadge({ text: active ? 'Active' : 'Paused', variant: active ? 'up' : 'secondary' }).el);
        return t;
    };
    const tools = (): HTMLElement[] => [iconButton('pen', 'Edit'), iconButton('trash', 'Delete')];
    const alerts = createItemGroup({
        separated: true,
        items: [
            createItem({ title: alertTitle('BTC breakout', true), description: 'BTCUSDT · Crossing 65,000 · Once', actions: tools(), revealActions: true, onSelect: () => {} }),
            createItem({ title: alertTitle('ETH pullback', false), description: 'ETHUSDT · Crossing down 3,000 · Every time', actions: tools(), revealActions: true, onSelect: () => {} }),
        ],
    });
    row('alerts', div('width:380px;', alerts.el));
    row(
        'variants',
        div(
            'width:380px;display:flex;flex-direction:column;gap:6px;',
            createItem({ media: 'bell', title: 'Outline', description: 'Bordered', variant: 'outline' }).el,
            createItem({ media: 'bell', title: 'Muted', description: 'On a sunken fill', variant: 'muted' }).el,
            createItem({ title: 'Compact', description: 'Long · 14:32', meta: span('+88.00', tone(1)), size: 'sm', onSelect: () => {} }).el,
            createItem({ title: 'Disabled', description: 'Expired', disabled: true, onSelect: () => {} }).el,
        ),
    );
}

interface Quote {
    symbol: string;
    last: number;
    change: number;
}

const QUOTES: Quote[] = [
    { symbol: 'BTCUSDT', last: 64210.5, change: 1.24 },
    { symbol: 'ETHUSDT', last: 3180.2, change: -0.85 },
    { symbol: 'SOLUSDT', last: 142.7, change: 3.1 },
    { symbol: 'XRPUSDT', last: 0.52, change: -2.4 },
];

export function sortGallery(row: Row): void {
    // The header's columns are the rows' meta cells: the same widths, the same gap.
    const cell = (text: string, style = ''): HTMLElement => span(text, `width:84px;text-align:end;${style}`);
    const list = createItemGroup({ separated: true });
    let current: { col: keyof Quote; dir: SortDirection } | null = { col: 'change', dir: 'desc' };
    const buttons = new Map<keyof Quote, SortButtonHandle>();
    const header = (col: keyof Quote, label: string, first: SortDirection, align: 'start' | 'end'): HTMLElement => {
        const b = createSortButton({
            label,
            align,
            firstDirection: first,
            title: `Sort by ${label}`,
            direction: current?.col === col ? current.dir : null,
            onSortChange: (dir) => {
                current = dir ? { col, dir } : null;
                for (const [c, other] of buttons) if (c !== col) other.setDirection(null);
                paint();
            },
        });
        buttons.set(col, b);
        return b.el;
    };
    const paint = (): void => {
        const rows = [...QUOTES];
        if (current) {
            const { col, dir } = current;
            rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'asc' ? 1 : -1));
        }
        list.setItems(rows.map((q) => createItem({ title: q.symbol, size: 'sm', onSelect: () => {}, meta: [cell(q.last.toLocaleString('en-US')), cell(`${q.change > 0 ? '+' : ''}${q.change.toFixed(2)}%`, tone(q.change))] })));
    };
    const head = div(
        'display:grid;grid-template-columns:1fr 84px 84px;align-items:center;column-gap:8px;height:28px;padding:0 9px;',
        header('symbol', 'Symbol', 'asc', 'start'),
        header('last', 'Last', 'desc', 'end'),
        header('change', 'Day %', 'desc', 'end'),
    );
    paint();
    row('watchlist', div('width:320px;border:1px solid var(--vela-border);border-radius:8px;padding:4px 0;', head, list.el));
}

export function monthGallery(row: Row): void {
    const days: Record<string, MonthGridDay> = {};
    const pnl = [412.5, -120.25, 0, 88, 260.4, -45.1, 1240, -310.75, 64.2, 158, -22.4, 305.6, -98.3, 0, 47.9, 512.25, -205];
    let i = 0;
    for (let d = 2; d <= 27; d++) {
        const date = `2026-11-${String(d).padStart(2, '0')}`;
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
        if (weekday === 0 || weekday === 6 || d === 13) continue;
        const v = pnl[i++ % pnl.length]!;
        const trades = 1 + (i % 4);
        days[date] = { value: `${v > 0 ? '+' : ''}${v.toFixed(2)}`, detail: `${trades} trade${trades > 1 ? 's' : ''}`, tone: v > 0 ? 'profit' : v < 0 ? 'loss' : 'neutral' };
    }
    const opened = span('Press a day, or walk them with the arrow keys.', muted);
    const grid = createMonthGrid({ month: '2026-11', days, today: '2026-11-06', onSelect: (date) => (opened.textContent = `Opened ${date}`) });
    const label = span('November 2026', 'font-size:13px;font-weight:600;color:var(--vela-fg-bright);flex:1;');
    const months = ['October 2026', 'November 2026', 'December 2026'];
    let at = 1;
    const step = (d: -1 | 1): void => {
        at = Math.max(0, Math.min(2, at + d));
        grid.setMonth(`2026-${String(10 + at).padStart(2, '0')}`);
        label.textContent = months[at]!;
    };
    const nav = div(
        'display:flex;align-items:center;gap:2px;margin-bottom:8px;',
        label,
        createButton({ icon: 'chevron-left', label: 'Previous month', variant: 'ghost', size: 'icon-xs', onClick: () => step(-1) }).el,
        createButton({ icon: 'chevron-right', label: 'Next month', variant: 'ghost', size: 'icon-xs', onClick: () => step(1) }).el,
    );
    row('journal', div('width:420px;', nav, grid.el, div('margin-top:8px;', opened)));
}
