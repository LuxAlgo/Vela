import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './test/browser',
    testMatch: '**/*.spec.ts',
    fullyParallel: true,
    workers: 1,
    forbidOnly: true,
    retries: 0,
    timeout: 30_000,
    expect: { timeout: 8_000 },
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        browserName: 'chromium',
        baseURL: 'http://127.0.0.1:5191',
        viewport: { width: 1280, height: 800 },
        reducedMotion: 'reduce',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: 'npm run playground -- --host 127.0.0.1 --port 5191',
        url: 'http://127.0.0.1:5191/browser-fixture.html',
        reuseExistingServer: false,
    },
});
