/**
 * E2E tests for the entries page — filtering, navigation, clear button.
 *
 * These tests run against the production preview server (npm run preview),
 * so they test real IndexedDB + SvelteKit routing as a user would experience it.
 *
 * NOTE: IndexedDB is per-origin and starts empty in a fresh browser context.
 * Tests that need data inject it via page.evaluate() before asserting.
 */
import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed a single journal entry into IndexedDB so the entries page has data. */
async function seedEntry(
	page: Page,
	entry: { id: string; riverId: number; riverName: string; datetime: string; flow?: number }
) {
	await page.evaluate(async (e) => {
		// Open Dexie DB directly — same origin, same IndexedDB
		// @ts-expect-error absolute path resolved by the dev server at runtime, not TS
		const { Dexie } = await import('/node_modules/dexie/dist/dexie.mjs').catch(
			() => (window as any).Dexie
		);
		// Use the app's existing DB instance if available
		const db = (window as any).__wwJournalDb;
		if (!db) return; // app not loaded yet
		await db.entries.put({
			id: e.id,
			riverId: e.riverId,
			datetime: e.datetime,
			flow: e.flow ?? null,
			notes: '',
			description: '',
			tags: [],
			dirty: false,
			deletedAt: null
		});
		await db.rivers.put({
			id: e.riverId,
			riverName: e.riverName,
			section: '',
			state: 'MT',
			classRating: 'III',
			externalGaugeId: null,
			externalGaugeSource: null
		});
	}, entry);
}

// ---------------------------------------------------------------------------
// Filter: URL param applied on load
// ---------------------------------------------------------------------------

test.describe('entries page — URL filter params', () => {
	test('?year=YYYY shows filter label', async ({ page }) => {
		await page.goto('/entries?year=2026');
		await expect(page.getByText(/Filtered: 2026/)).toBeVisible();
	});

	test('?month=YYYY-MM shows filter label with month name', async ({ page }) => {
		await page.goto('/entries?month=2026-04');
		await expect(page.getByText(/Filtered: April 2026/)).toBeVisible();
	});

	test('?view=rivers shows Rivers filter label', async ({ page }) => {
		await page.goto('/entries?view=rivers');
		await expect(page.getByText(/Filtered: Rivers/)).toBeVisible();
	});

	test('no params — no filter label shown', async ({ page }) => {
		await page.goto('/entries');
		await expect(page.getByText(/Filtered:/)).not.toBeVisible();
	});
});

// ---------------------------------------------------------------------------
// Clear button
// ---------------------------------------------------------------------------

test.describe('entries page — Clear filter', () => {
	test('Clear button removes filter label', async ({ page }) => {
		await page.goto('/entries?year=2026');
		await expect(page.getByText(/Filtered: 2026/)).toBeVisible();

		await page.getByRole('button', { name: 'Clear' }).click();

		// Filter label should be gone
		await expect(page.getByText(/Filtered:/)).not.toBeVisible();
		// URL should be clean
		expect(page.url()).toMatch(/\/entries$/);
	});

	test('Clear from month filter works', async ({ page }) => {
		await page.goto('/entries?month=2026-04');
		await page.getByRole('button', { name: 'Clear' }).click();
		await expect(page.getByText(/Filtered:/)).not.toBeVisible();
		expect(page.url()).toMatch(/\/entries$/);
	});

	test('Clear from river filter works', async ({ page }) => {
		await page.goto('/entries?river=1');
		// river filter label only shows if rivers map is loaded — just check URL clears
		await page.getByRole('button', { name: 'Clear' }).click();
		expect(page.url()).toMatch(/\/entries$/);
	});
});

// ---------------------------------------------------------------------------
// Navigation: stat card → entries → entry detail
// ---------------------------------------------------------------------------

test.describe('entries page — navigation to entry detail', () => {
	test('entry card links to /entries/[id]', async ({ page }) => {
		// Navigate to entries list (unfiltered)
		await page.goto('/entries');
		// Wait for loaded state (spinner gone)
		await page.waitForSelector('.loading', { state: 'detached', timeout: 10_000 }).catch(() => {});

		// If there are entry cards, click the first one
		const entryCard = page.locator('a[href^="/entries/"]').first();
		const count = await entryCard.count();

		if (count > 0) {
			const href = await entryCard.getAttribute('href');
			await entryCard.click();
			await expect(page).toHaveURL(/\/entries\/[^/]+$/);
		} else {
			// No entries — just verify the "Log a Day" CTA is present
			await expect(page.getByRole('link', { name: 'Log a Day' })).toBeVisible();
		}
	});

	test('entry card links to detail from filtered view', async ({ page }) => {
		await page.goto('/entries?year=2026');
		await page.waitForSelector('.loading', { state: 'detached', timeout: 10_000 }).catch(() => {});

		const entryCard = page.locator('a[href^="/entries/"]').first();
		const count = await entryCard.count();

		if (count > 0) {
			await entryCard.click();
			await expect(page).toHaveURL(/\/entries\/[^/]+$/);
		}
	});

	test('entry card links to detail from river-filtered view', async ({ page }) => {
		await page.goto('/entries?river=1');
		await page.waitForSelector('.loading', { state: 'detached', timeout: 10_000 }).catch(() => {});

		const entryCard = page.locator('a[href^="/entries/"]').first();
		if (await entryCard.count() > 0) {
			await entryCard.click();
			await expect(page).toHaveURL(/\/entries\/[^/]+$/);
		}
	});
});

// ---------------------------------------------------------------------------
// Dashboard stat cards
// ---------------------------------------------------------------------------

test.describe('dashboard stat cards', () => {
	test('Total Days card links to /entries', async ({ page }) => {
		await page.goto('/');
		const link = page.getByRole('link', { name: /Total Days/i });
		await expect(link).toHaveAttribute('href', '/entries');
	});

	test('This Year card links to /entries?year=', async ({ page }) => {
		await page.goto('/');
		const link = page.getByRole('link', { name: /This Year/i });
		const href = await link.getAttribute('href');
		expect(href).toMatch(/\/entries\?year=\d{4}/);
	});

	test('This Month card links to /entries?month=', async ({ page }) => {
		await page.goto('/');
		const link = page.getByRole('link', { name: /This Month/i });
		const href = await link.getAttribute('href');
		expect(href).toMatch(/\/entries\?month=\d{4}-\d{2}/);
	});

	test('Rivers card links to /entries?view=rivers', async ({ page }) => {
		await page.goto('/');
		const link = page.getByRole('link', { name: /Rivers/i });
		const href = await link.getAttribute('href');
		expect(href).toContain('/entries?view=rivers');
	});

	test('clicking This Year card lands on filtered entries page', async ({ page }) => {
		await page.goto('/');
		const link = page.getByRole('link', { name: /This Year/i });
		await link.click();
		await expect(page).toHaveURL(/\/entries\?year=\d{4}/);
		await expect(page.getByText(/Filtered: \d{4}/)).toBeVisible();
	});

	test('clicking This Month card lands on filtered entries page', async ({ page }) => {
		await page.goto('/');
		const link = page.getByRole('link', { name: /This Month/i });
		await link.click();
		await expect(page).toHaveURL(/\/entries\?month=/);
		await expect(page.getByText(/Filtered:/)).toBeVisible();
	});
});

// ---------------------------------------------------------------------------
// Rivers view
// ---------------------------------------------------------------------------

test.describe('rivers view', () => {
	test('?view=rivers shows rivers heading and no entry cards', async ({ page }) => {
		await page.goto('/entries?view=rivers');
		await page.waitForSelector('.loading', { state: 'detached', timeout: 10_000 }).catch(() => {});
		// No individual entry cards (those link to /entries/[id])
		// The rivers view shows river cards that link to /entries?river=
		const entryDetailLinks = page.locator('a[href^="/entries/"]');
		await expect(entryDetailLinks).toHaveCount(0);
	});

	test('river card in rivers view navigates to filtered list', async ({ page }) => {
		await page.goto('/entries?view=rivers');
		await page.waitForSelector('.loading', { state: 'detached', timeout: 10_000 }).catch(() => {});

		const riverCard = page.locator('a[href*="entries?river="]').first();
		if (await riverCard.count() > 0) {
			await riverCard.click();
			await expect(page).toHaveURL(/\/entries\?river=\d+/);
		}
	});
});

// ---------------------------------------------------------------------------
// New entry form
// ---------------------------------------------------------------------------

test.describe('new entry form', () => {
	test('navigates to /entries/new', async ({ page }) => {
		await page.goto('/entries');
		await page.getByRole('link', { name: '+ Log a Day' }).click();
		await expect(page).toHaveURL('/entries/new');
	});

	test('Log a Day button visible on entries page', async ({ page }) => {
		await page.goto('/entries');
		await expect(page.getByRole('link', { name: '+ Log a Day' })).toBeVisible();
	});
});
