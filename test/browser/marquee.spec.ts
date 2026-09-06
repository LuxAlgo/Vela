import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

async function drawings(page: Page) {
    const plot = await page.evaluate(() => window.fixture.plot());
    const point = (x: number, y: number) => ({ x: plot.x + plot.width * x, y: plot.y + plot.height * y });
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.fixture.ws.chart.drawings.setTool('box'));
        const start = point(0.2 + i * 0.18, 0.35);
        const end = point(0.28 + i * 0.18, 0.5);
        await page.mouse.click(start.x, start.y);
        await page.mouse.click(end.x, end.y);
        await expect.poll(() => page.evaluate(() => window.fixture.ws.chart.drawings.all().length)).toBe(i + 1);
    }
    const ids = await page.evaluate(() => {
        const chart = window.fixture.ws.chart;
        const ids = chart.drawings.all().map(drawing => drawing.id);
        chart.drawings.lock(ids[2]!, true);
        chart.drawings.select(null);
        return ids;
    });
    return { point, ids };
}

async function startDrag(page: Page, start: { x: number; y: number }, end: { x: number; y: number }, modifier = 'Control', union = false) {
    await page.keyboard.down(modifier);
    if (union) await page.keyboard.down('Shift');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await expect.poll(() => page.evaluate(() => window.fixture.marquee?.w ?? 0)).toBeGreaterThan(50);
    await expect.poll(() => page.evaluate(() => window.fixture.marquee?.h ?? 0)).toBeGreaterThan(50);
    // This strip is inside the marquee and above every fixture drawing.
    await expect.poll(() => page.evaluate(() => window.fixture.marqueeInk())).toBeGreaterThan(100);
}
async function release(page: Page, modifier = 'Control', union = false) {
    await page.mouse.up();
    await page.keyboard.up(modifier);
    if (union) await page.keyboard.up('Shift');
}

for (const [name, left, top, modifier] of [
    ['down-right Ctrl', true, true, 'Control'],
    ['up-left Cmd', false, false, 'Meta'],
    ['up-right Ctrl', true, false, 'Control'],
    ['down-left Cmd', false, true, 'Meta'],
] as const) {
    test(`marquee ${name} selects boxes without panning and preserves locked drawings through delete/undo`, async ({ app: page }) => {
        const { point, ids } = await drawings(page);
        const before = await page.evaluate(() => window.fixture.viewport());
        await startDrag(page, point(left ? 0.12 : 0.72, top ? 0.25 : 0.6), point(left ? 0.72 : 0.12, top ? 0.6 : 0.25), modifier);
        expect(await page.evaluate(() => window.fixture.viewport())).toEqual(before);
        await release(page, modifier);
        await expect.poll(() => page.evaluate(() => window.fixture.selected)).toEqual(ids);
        expect(await page.evaluate(() => window.fixture.marquee)).toBeNull();
        expect(await page.evaluate(() => window.fixture.viewport())).toEqual(before);
        await page.keyboard.press('Delete');
        await expect.poll(() => page.evaluate(() => window.fixture.ws.chart.drawings.all().map(d => d.id))).toEqual([ids[2]]);
        await page.keyboard.press('Control+z');
        await expect.poll(() => page.evaluate(() => window.fixture.ws.chart.drawings.all().map(d => d.id))).toEqual(ids);
    });
}

test('Shift unions the selection; Escape cancels a later marquee without changing selection or viewport', async ({ app: page }) => {
    const { point, ids } = await drawings(page);
    await page.evaluate(id => window.fixture.ws.chart.drawings.select(id), ids[2]!);
    await startDrag(page, point(0.12, 0.25), point(0.49, 0.6), 'Control', true);
    await release(page, 'Control', true);
    await expect.poll(() => page.evaluate(() => window.fixture.selected)).toEqual([ids[2], ids[0], ids[1]]);
    const before = await page.evaluate(() => ({ viewport: window.fixture.viewport(), selected: window.fixture.selected }));
    await startDrag(page, point(0.12, 0.25), point(0.49, 0.6));
    await page.keyboard.press('Escape');
    await release(page);
    expect(await page.evaluate(() => window.fixture.marquee)).toBeNull();
    expect(await page.evaluate(() => ({ viewport: window.fixture.viewport(), selected: window.fixture.selected }))).toEqual(before);
});


test('pointer cancellation removes the marquee and preserves selection and viewport', async ({ app: page }) => {
    const { point, ids } = await drawings(page);
    await page.evaluate(id => window.fixture.ws.chart.drawings.select(id), ids[2]!);
    const before = await page.evaluate(() => ({ viewport: window.fixture.viewport(), selected: window.fixture.selected }));
    await startDrag(page, point(0.12, 0.25), point(0.49, 0.6));
    // Playwright drives the drag; dispatch the browser cancellation signal because
    // its mouse API has no OS-level cancel operation.
    await page.getByRole('application').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true });
    await release(page);
    expect(await page.evaluate(() => window.fixture.marquee)).toBeNull();
    expect(await page.evaluate(() => ({ viewport: window.fixture.viewport(), selected: window.fixture.selected }))).toEqual(before);
});
