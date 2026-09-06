import { test as base, expect, type Page, type Locator } from '@playwright/test';
import type {} from '../../playground/browser-fixture';

export const test = base.extend<{ app: Page }>({
    app: async ({ page }, use, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto('/browser-fixture.html');
        await expect.poll(() => page.evaluate(() => window.fixture?.ready)).toBe(true);
        await expect.poll(() => page.evaluate(() => window.fixture.paint().bullish)).toBeGreaterThan(100);
        try {
            await use(page);
        } finally {
            if (testInfo.status !== testInfo.expectedStatus) {
                await testInfo.attach('fixture-at-failure', { body: await page.screenshot(), contentType: 'image/png' });
            }
            await page.evaluate(() => window.fixture?.destroy());
            await expect(page.locator('#chart canvas')).toHaveCount(0);
            await expect(page.locator('.vela-dialog-positioner, .vela-dialog-backdrop, .vela-popover')).toHaveCount(0);
            expect(await page.evaluate(() => window.fixture?.subscribers ?? 0)).toBe(0);
            expect(errors, 'browser console errors and unhandled exceptions').toEqual([]);
        }
    },
});
export { expect };

export async function expectPaintedSurface(locator: Locator) {
    await expect(locator).toBeVisible();
    const style = await locator.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const css = getComputedStyle(element);
        return { width: rect.width, height: rect.height, background: css.backgroundColor, opacity: css.opacity };
    });
    expect(style.width).toBeGreaterThan(0);
    expect(style.height).toBeGreaterThan(0);
    expect(style.background).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
    expect(Number(style.opacity)).toBeGreaterThan(0);
}
