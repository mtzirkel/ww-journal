import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 30_000,
	retries: 0,
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'on-first-retry',
		// Use system chromium — Playwright's bundled one won't install on this OS
		channel: 'chromium',
		launchOptions: {
			executablePath: '/usr/bin/chromium',
			args: ['--no-sandbox', '--disable-setuid-sandbox']
		}
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	webServer: {
		command: 'npm run build && npm run preview',
		url: 'http://localhost:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 60_000
	}
});
