import { test, expect } from './fixtures';

test('hiding the price series persists through reload while indicators and drawings stay painted', async ({ app: page }) => {
    await page.evaluate(() => window.fixture.addDrawing());
    await expect.poll(() => page.evaluate(() => window.fixture.paint().indicator)).toBeGreaterThan(20);
    await expect.poll(() => page.evaluate(() => window.fixture.paint().drawings)).toBeGreaterThan(100);
    await page.locator('.vela-statusline').click({ button: 'right', position: { x: 80, y: 12 } });
    await page.getByRole('menuitem', { name: 'Hide chart', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.fixture.paint().bullish + window.fixture.paint().bearish)).toBe(0);
    const hidden = await page.evaluate(() => window.fixture.paint());
    expect(hidden.indicator).toBeGreaterThan(20);
    expect(hidden.drawings).toBeGreaterThan(100);
    expect(hidden.chrome).toBeGreaterThan(100);
    await expect.poll(() => page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('vela-browser-fixture') ?? '{}');
        return saved.charts?.[0]?.rendererConfig?.series?.visible;
    })).toBe(false);
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.fixture?.ready)).toBe(true);
    await expect(page.getByRole('button', { name: 'Show chart', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.fixture.paint().bullish + window.fixture.paint().bearish)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.fixture.paint().indicator)).toBeGreaterThan(20);
    await expect.poll(() => page.evaluate(() => window.fixture.paint().drawings)).toBeGreaterThan(100);
    await page.getByRole('button', { name: 'Show chart', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.fixture.paint().bullish)).toBeGreaterThan(100);
});
