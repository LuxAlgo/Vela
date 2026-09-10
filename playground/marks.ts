// Sample timeline marks for the playground pages — the `chart.marks` surface exercised end
// to end: a dividends cluster and a split stacked on one bar (hover the deck, or tap it on
// touch, to fan them out), an earnings panel, a release with a custom icon whose details
// load on click, an ungrouped note, an event-only mark (no popup — only `mark:click`), and
// a scheduled one near the right edge. Marks are pinned to TIMES, spread over the chart's
// visible range when applied, so they land on any timeframe: switch timeframes and watch
// them re-snap onto the containing bars and fold together as bars widen — the three news
// items sit 15 minutes apart: three glyphs on a 5m or 15m chart, one cluster from 1h up.
import type { Vela, TimelineMark } from '../src';
import { registerIcon, svg16 } from '../src/ui';

// Marks reference icons by id — the host registers the SVG once; a mark never carries markup.
registerIcon('play.rocket', svg16('<path d="M9.5 2.5c1.8 0 3.5 1.7 4 4.5l-4 4-4-4c.5-2.8 2.2-4.5 4-4.5z"/><path d="M5.5 7 3 9.5l2 .5.5 2L8 9.5"/>'));

/** Charts whose `mark:click` is already echoed to the console (re-applying never double-subscribes). */
const wired = new WeakSet<Vela>();

/** Spread the sample marks over `chart`'s visible range — call once the chart is ready. */
export function addSampleMarks(chart: Vela): void {
    const range = chart.getVisibleRange();
    if (!range) return;
    const span = range.to - range.from;
    const at = (fraction: number): number => Math.round(range.from + span * fraction);

    const marks: TimelineMark[] = [
        {
            id: 'note-1',
            time: at(0.2),
            title: 'Note',
            glyph: { shape: 'circle', color: '#787b86', letter: 'i' },
            tooltip: 'An ungrouped note',
            content: { text: 'Ungrouped marks have no checkbox in settings — they always show.' },
        },
        {
            id: 'alert-1',
            time: at(0.3),
            glyph: { shape: 'diamond', color: '#e0b400', letter: '!' },
            tooltip: 'Event-only mark — see the console',
            // No content: a click only emits `mark:click` (the host owns the UI).
        },
        {
            id: 'div-1',
            time: at(0.42),
            title: 'Dividends',
            group: 'dividends',
            glyph: { shape: 'circle', color: '#2962ff', letter: 'D' },
            tooltip: 'Dividend · 0.01',
            content: {
                panel: {
                    items: [
                        { type: 'field', label: 'Ex-dividend date', value: "Tue 11 Jun '24" },
                        { type: 'field', label: 'Amount', value: '0.01' },
                        { type: 'field', label: 'Payment date', value: "Fri 28 Jun '24" },
                        { type: 'button', label: 'More dividends', primary: true, run: () => console.log('[marks] more dividends') },
                    ],
                },
            },
        },
        {
            id: 'div-2',
            time: at(0.42) + 1000, // the same bar as div-1 on any timeframe ⇒ one cluster glyph listing both
            title: 'Special dividend',
            group: 'dividends',
            glyph: { color: '#2962ff', letter: 'D' },
            content: { text: 'Special dividend of 0.25, declared the same session.' },
        },
        {
            id: 'split-1',
            time: at(0.42), // another group on that bar ⇒ a deck that fans out on hover / tap
            title: 'Stock split',
            group: 'splits',
            glyph: { shape: 'square', color: '#ff9800', letter: 'S' },
            tooltip: 'Split 10:1',
            content: {
                // HTML is sanitized: the script never runs, the link opens in a new tab.
                html: '<b>10-for-1 split</b><br>Effective <i>10 Jun 2024</i> · <a href="https://example.com/filing">Filing</a><script>alert("never")</script>',
            },
        },
        {
            id: 'earn-1',
            time: at(0.63),
            title: 'Earnings · Q1',
            group: 'earnings',
            glyph: { shape: 'diamond', color: '#089981', letter: 'E' },
            tooltip: 'Earnings call',
            content: {
                panel: {
                    items: [
                        { type: 'field', label: 'EPS', value: '6.12 (est. 5.59)' },
                        { type: 'field', label: 'Revenue', value: '26.0B (est. 24.6B)' },
                        { type: 'text', text: 'Beat on both lines; guidance raised for Q2.' },
                        { type: 'button', label: 'Transcript', run: () => console.log('[marks] transcript') },
                        { type: 'button', label: 'Dismiss', run: () => undefined },
                    ],
                },
            },
        },
        ...[0, 1, 2].map(
            (i): TimelineMark => ({
                id: `news-${i + 1}`,
                time: at(0.72) + i * 15 * 60_000, // 15 minutes apart: one cluster on 1h, three glyphs on 15m
                title: `News ${i + 1}/3`,
                group: 'news',
                glyph: { shape: 'circle', color: '#26a69a', letter: 'N' },
                tooltip: `News item ${i + 1}`,
                content: {
                    text: ['Regulator opens a consultation on listing rules.', 'The exchange schedules its quarterly fee review.', 'Market-maker program extended through Q4.'][i]!,
                },
            }),
        ),
        {
            id: 'rel-1',
            time: at(0.8),
            title: 'Release v2.4',
            group: 'releases',
            glyph: { shape: 'pin', color: '#7e57c2', icon: 'play.rocket' },
            tooltip: 'Release — details load on click',
            content: async () => {
                await new Promise((resolve) => setTimeout(resolve, 600)); // fetched on demand
                return { html: '<p>Deployed <code>v2.4.0</code> to production.</p><p>Rollout: 100% of regions.</p>' };
            },
        },
        {
            id: 'sched-1',
            time: at(0.985),
            title: 'Scheduled',
            glyph: { shape: 'pin', color: '#0ea5e9', letter: 'M' },
            tooltip: 'Maintenance window',
            content: { text: 'Exchange maintenance window (announced). Past the newest bar a mark sits on the projected grid.' },
        },
    ];

    chart.marks
        .defineGroup({ id: 'dividends', label: 'Dividends' })
        .defineGroup({ id: 'splits', label: 'Splits' })
        .defineGroup({ id: 'earnings', label: 'Earnings' })
        .defineGroup({ id: 'news', label: 'News' })
        .defineGroup({ id: 'releases', label: 'Releases' })
        .set(marks);

    if (!wired.has(chart)) {
        wired.add(chart);
        chart.on('mark:click', (e) => console.log('[marks] click', e));
    }
}
