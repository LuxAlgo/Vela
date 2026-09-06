import type { Page } from '@playwright/test';
import { test, expect, expectPaintedSurface } from './fixtures';

async function externalDialogHost(page: Page) {
    await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'external-dialog-host';
        host.className = 'vela-ui';
        host.style.cssText = 'position:fixed;inset:0;z-index:100;';
        const source = document.querySelector<HTMLElement>('.vela-workspace')!;
        for (const name of Array.from(source.style)) {
            if (name.startsWith('--vela-')) host.style.setProperty(name, source.style.getPropertyValue(name));
        }
        document.body.append(host);
        window.fixture.ws.chart.renderer.set('dialogHost', host);
    });
}

test('native media changes update a visible external settings dialog and its open Select', async ({ app: page }) => {
    await externalDialogHost(page);
    await page.evaluate(() => window.fixture.ws.chart.renderer.openSettings());
    const panel = page.locator('#external-dialog-host .vela-dialog--settings');
    await expectPaintedSurface(panel);
    const button = panel.locator('.vela-sd-btn').first();
    await panel.evaluate(element => { element.style.transitionDuration = '2s'; element.style.animationDuration = '2s'; });
    await button.evaluate(element => { element.style.transitionDuration = '2s'; element.style.animationDuration = '2s'; });
    for (const element of [panel, button]) {
        await expect(element).toHaveCSS('transition-duration', '0s');
        await expect(element).toHaveCSS('animation-duration', '0s');
    }
    await button.focus();
    await expect(button).toBeFocused();
    const select = panel.locator('.vela-select-trigger').first();
    await select.click();
    const popover = page.locator('.vela-popover.vela-select-list');
    await expectPaintedSurface(popover);
    expect(await popover.evaluate(element => element.parentElement === document.body)).toBe(true);
    await popover.evaluate(element => { element.style.transitionDuration = '2s'; element.style.animationDuration = '2s'; });
    for (const reducedMotion of ['no-preference', 'reduce', 'no-preference'] as const) {
        await page.emulateMedia({ reducedMotion });
        const reduced = reducedMotion === 'reduce';
        await expect.poll(() => page.evaluate(() => window.fixture.ws.chart.reducedMotion)).toBe(reduced);
        for (const element of [panel, button, popover]) {
            await expect(element).toHaveCSS('transition-duration', reduced ? '0s' : '2s');
            await expect(element).toHaveCSS('animation-duration', reduced ? '0s' : '2s');
        }
        await expectPaintedSurface(popover);
        expect(await page.locator('#external-dialog-host').getAttribute('data-vela-motion')).toBeNull();
    }
});

test('explicit animation options override native reduced-motion preference', async ({ app: page }) => {
    await page.goto('/browser-fixture.html?animations=true');
    await expect.poll(() => page.evaluate(() => window.fixture?.ready)).toBe(true);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    expect(await page.evaluate(() => window.fixture.ws.chart.reducedMotion)).toBe(false);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => window.fixture.ws.chart.reducedMotion)).toBe(false);
});


test('indicator inputs opened through the legend compute zero motion while staying usable', async ({ app: page }) => {
    await externalDialogHost(page);
    // The external host only receives input when it contains an open dialog.
    await page.locator('#external-dialog-host').evaluate(element => { element.style.pointerEvents = 'none'; });
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await page.getByText('Golden average', { exact: true }).hover();
    await settings.click();
    const panel = page.locator('#external-dialog-host .vela-ind-dialog');
    await expectPaintedSurface(panel);
    await panel.evaluate(element => { element.style.transitionDuration = '2s'; element.style.animationDuration = '2s'; });
    await expect(panel).toHaveCSS('transition-duration', '0s');
    await expect(panel).toHaveCSS('animation-duration', '0s');
    const input = panel.getByRole('spinbutton').first();
    await input.fill('5');
    await expect(input).toHaveValue('5');
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
});

test('reduced-motion wheel zoom changes the viewport in the wheel event turn', async ({ app: page }) => {
    const before = await page.evaluate(() => window.fixture.viewport());
    const chart = page.getByRole('application');
    await chart.evaluate(element => {
        element.addEventListener('wheel', () => {
            element.setAttribute('data-wheel-viewport', JSON.stringify(window.fixture.viewport()));
        }, { once: true });
    });
    const plot = await page.evaluate(() => window.fixture.plot());
    await page.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.7);
    await page.mouse.wheel(0, -120);
    await expect(chart).toHaveAttribute('data-wheel-viewport');
    const during = JSON.parse((await chart.getAttribute('data-wheel-viewport'))!);
    expect(during).not.toEqual(before);
    const after = await page.evaluate(async () => {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return window.fixture.viewport();
    });
    expect(after).toEqual(during);
});
