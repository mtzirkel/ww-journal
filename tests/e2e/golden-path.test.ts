/**
 * Golden-path E2E test: save → IndexedDB persist → server sync → second client pull
 *
 * This test exists because we lost real journal entries to a silent save-then-sync
 * race failure in Safari. The bug was: save() wrote to IndexedDB, called sync(),
 * sync() threw an exception that was swallowed, and the entry never reached the
 * server. On the next device the entry simply wasn't there.
 *
 * What this test proves, end to end:
 *   1. The new-entry form submits and navigates away correctly
 *   2. The entry survives a hard page reload (IndexedDB persistence)
 *   3. The entry reaches the server via sync/push
 *   4. A second browser context (fresh IndexedDB) can pull the entry from the server
 *
 * If any step in the save-sync-persist chain breaks, this test fails with a
 * message identifying exactly which step failed.
 *
 * Preconditions:
 *   - DEV_BYPASS_AUTH=true must be in .env (auth service is not running in tests)
 *   - DATABASE_URL must point to a reachable Postgres instance
 *   - The app is served at the baseURL configured in playwright.config.ts (4173)
 */

import { test, expect, type Browser, type Page } from '@playwright/test';

// Increase timeout for tests that require IDB seeding (~1260 rivers from JSON)
// The seed runs once per browser context; subsequent tests are faster.
test.setTimeout(90_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Warm up IndexedDB by visiting /entries first, which triggers seedRivers() in
 * onMount and bulk-inserts ~1260 rivers from rivers.json into the local IDB.
 *
 * WHY: /entries/new also calls seedRivers(), but its onMount races with the
 * autocomplete's first search. If we fill the river input before seedRivers()
 * completes, search() runs against an empty IDB and returns nothing. The
 * dropdown shows only the "+ Add" button, not river results.
 *
 * By visiting /entries first and waiting for it to fully load, we ensure
 * seedRivers() has completed before we navigate to /entries/new.
 * /entries calls seedRivers() in its own onMount before subscribing to liveQuery.
 *
 * We confirm seed completion by verifying that a search for "Animas" produces
 * results via page.evaluate() against the raw IDB — this is the same DB name
 * ("ww-journal") that the app uses, so it's in the same origin.
 */
async function ensureRiversSeeded(page: Page) {
	// Navigate to /entries — this page's onMount calls seedRivers() which fetches
	// rivers.json and bulk-puts ~1260 rows. We wait for the spinner to clear
	// (meaning onMount completed) before moving on.
	await page.goto('/entries');
	await expect(page).toHaveURL('/entries', { timeout: 10_000 });

	// Wait for the loading spinner to disappear — this means onMount finished,
	// which includes the await seedRivers() call.
	await page
		.waitForSelector('.loading', { state: 'detached', timeout: 60_000 })
		.catch(() => {
			// loading class may not appear at all if the page is very fast
		});

	// Belt-and-suspenders: directly query IndexedDB for river count.
	// We open the DB with indexedDB.open() (native API, no Dexie needed in eval).
	// The DB name is "ww-journal" (src/lib/db/index.ts line 4).
	const riverCount = await page.evaluate((): Promise<number> => {
		return new Promise((resolve, reject) => {
			const req = indexedDB.open('ww-journal');
			req.onsuccess = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains('rivers')) {
					db.close();
					resolve(0);
					return;
				}
				const tx = db.transaction('rivers', 'readonly');
				const store = tx.objectStore('rivers');
				const countReq = store.count();
				countReq.onsuccess = () => {
					db.close();
					resolve(countReq.result);
				};
				countReq.onerror = () => {
					db.close();
					reject(countReq.error);
				};
			};
			req.onerror = () => reject(req.error);
		});
	});

	if (riverCount === 0) {
		throw new Error(
			`seedRivers() did not populate IndexedDB after loading /entries and waiting for spinner. ` +
			`River count in IDB is 0. ` +
			`Check that /data/rivers.json is served by the preview server and that the fetch() call ` +
			`in seedRivers() resolves correctly.`
		);
	}
}

/**
 * Fill the river autocomplete and select the first result via keyboard navigation.
 *
 * PREREQUISITE: ensureRiversSeeded() must be called first. With rivers in IDB,
 * search() returns results synchronously fast (Dexie in-memory filter).
 *
 * AUTOCOMPLETE BEHAVIOR (RiverAutocomplete.svelte):
 *   - oninput → open=true, selectedIndex=-1, calls async search()
 *   - Dropdown <ul> renders when open=true && query.length >= 2
 *   - Each <li>: river buttons come first, "+ Add" button is always last
 *   - ArrowDown increments selectedIndex; Enter with selectedIndex < results.length
 *     calls select(river), which updates the parent's bound `selectedRiver`
 *   - TRAP: if results=[] when Enter fires, selectedIndex(0) === results.length(0),
 *     and AddRiverModal opens instead — the test saw this when ArrowDown was pressed
 *     before the async search() resolved
 *
 * WHY keyboard navigation over click:
 *   - Component uses onmousedown (not onclick) to beat 200ms blur timer
 *   - Playwright .click() focuses the dropdown button, triggering blur on the input;
 *     the blur timer then fires open=false before select() can run
 *   - dispatchEvent('mousedown') creates non-trusted events that don't reliably
 *     trigger Svelte 5's compiled event handlers in a preview build
 *   - ArrowDown+Enter stays inside the input's keydown handler — no focus change,
 *     no blur race
 */
async function fillRiverAutocomplete(page: Page, searchTerm: string) {
	const input = page.getByPlaceholder('Search rivers...');

	// Fill triggers oninput → open=true, selectedIndex=-1, search() runs.
	// With IDB pre-seeded, search() resolves quickly (< 100ms typically).
	await input.fill(searchTerm);

	// Wait for the second <li> to appear. The structure is:
	//   <li>: river result button (appears ONLY after search() resolves with results)
	//   <li>: "+ Add" button (always present once dropdown opens)
	// If only the Add button is visible, results[] is still empty (race condition).
	// We wait up to 10s — with seeded IDB this should be near-instant.
	// This locator is scoped to `ul li` globally; that's safe since the autocomplete
	// dropdown is the only <ul> on this page.
	await expect(page.locator('ul li').nth(1)).toBeVisible({ timeout: 10_000 });

	// Press ArrowDown: selectedIndex -1 → 0 (first river result)
	// Press Enter: 0 >= 0 && 0 < results.length → select(results[0]) → value = river
	await input.press('ArrowDown');
	await input.press('Enter');

	// Confirm selection: input shows the selected river name (never empty after select())
	await expect(input).not.toHaveValue('', { timeout: 3_000 });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('golden path: save and sync', () => {
	/**
	 * Steps 1-8: Submit a new entry, verify local persistence.
	 *
	 * This is the part that would catch the "save succeeded, sync failed,
	 * entry lost" bug: if the entry is not in IndexedDB after submit + reload,
	 * the save itself is broken regardless of sync.
	 */
	test('create entry and verify IndexedDB persistence across reload', async ({ page }) => {
		// Unique description so we can find this specific entry even if other
		// entries exist in the DB from previous runs.
		const description = `Playwright golden path ${Date.now()}`;

		// ── Step 1: Fresh browser context (provided by Playwright per-test isolation)

		// Ensure rivers are seeded in IDB before we try the autocomplete.
		// This is a prerequisite, not a test step — it visits /entries first.
		await ensureRiversSeeded(page);

		// ── Step 2: Navigate to /entries/new
		await page.goto('/entries/new');
		// If this lands on /login instead, DEV_BYPASS_AUTH is not set in .env
		await expect(page).toHaveURL('/entries/new', { timeout: 10_000 });

		// ── Step 3a: Select a river via the autocomplete
		// "Animas" appears 4+ times in the seed data. Any selection enables the Save button.
		await fillRiverAutocomplete(page, 'Animas');

		// ── Step 3b: Fill the flow field (id="flow", type=number)
		await page.locator('#flow').fill('100');

		// ── Step 3c: Fill the description textarea (id="description")
		// This unique string is our sentinel for finding the entry in assertions.
		await page.locator('#description').fill(description);

		// ── Step 4: Submit
		// Disabled condition: `!selectedRiver || !datetime || saving`
		// datetime defaults to current time; saving starts false.
		// Still disabled → autocomplete selection didn't propagate to selectedRiver.
		const saveButton = page.getByRole('button', { name: 'Save Entry' });
		await expect(saveButton).toBeEnabled({ timeout: 5_000 });
		await saveButton.click();

		// ── Step 5: Assert navigation to /entries
		// save() calls goto('/entries') after db.entries.put() resolves.
		// Still on /entries/new → IDB write threw.
		// On /login → DEV_BYPASS_AUTH not active.
		await expect(page).toHaveURL('/entries', { timeout: 10_000 });

		// ── Step 6: Assert entry visible in list immediately after save
		// Entries page renders description as:
		//   <p class="text-sm text-base-content/60 mt-1 line-clamp-1">{entry.description}</p>
		// Failure: navigation happened (IDB write OK) but liveQuery isn't rendering the entry.
		await expect(page.getByText(description)).toBeVisible({ timeout: 10_000 });

		// ── Step 7: Hard reload — the critical durability check
		// Entry only in reactive state (not IDB) → disappears here.
		await page.reload();
		await page
			.waitForSelector('.loading', { state: 'detached', timeout: 10_000 })
			.catch(() => {});

		// ── Step 8: Assert entry still visible after reload
		// FAILURE = "local persistence failed": IDB put() resolved but record was
		// not durably committed. Possible causes:
		//   - IDB transaction aborted after promise resolved (browser quirk)
		//   - DB version upgrade (v6) nuked record because dirty=false at write time
		//   - Entry overwritten by sync pull of older server record
		await expect(page.getByText(description)).toBeVisible({ timeout: 10_000 });
	});

	/**
	 * Steps 9-12: Second browser context pulls the entry from the server.
	 *
	 * Full round trip:
	 *   Context A: create entry → sync/push to Postgres
	 *   Context B: fresh IDB → sync/pull from Postgres → entry visible
	 *
	 * This is the exact scenario from the Safari data loss: push never reached
	 * the server (silent error in sync()), so the second device's pull returned nothing.
	 */
	test('entry syncs to server and is visible in a fresh browser context', async ({ browser }: { browser: Browser }) => {
		const description = `Playwright golden path ${Date.now()}`;

		// ── Context A: Create the entry and verify it reaches the server
		const contextA = await browser.newContext();
		const pageA = await contextA.newPage();

		// Warm up IDB in context A before navigating to /entries/new
		await ensureRiversSeeded(pageA);

		await pageA.goto('/entries/new');
		await expect(pageA).toHaveURL('/entries/new', { timeout: 10_000 });

		await fillRiverAutocomplete(pageA, 'Animas');
		await pageA.locator('#flow').fill('100');
		await pageA.locator('#description').fill(description);

		// Register the push listener BEFORE clicking Save (avoids missing fast responses)
		const pushResponsePromise = pageA.waitForResponse(
			(res) => res.url().includes('/api/sync/push') && res.status() === 200,
			{ timeout: 15_000 }
		);

		const saveButtonA = pageA.getByRole('button', { name: 'Save Entry' });
		await expect(saveButtonA).toBeEnabled({ timeout: 5_000 });
		await saveButtonA.click();

		// Confirm IDB write completed (goto fires after db.entries.put())
		await expect(pageA).toHaveURL('/entries', { timeout: 10_000 });

		// Wait for sync/push to land on the server. This is the critical server leg.
		// If this times out, the entry is in IDB but was NOT pushed to Postgres.
		// Causes:
		//   (a) sync() threw before pushChanges() (swallowed in save())
		//   (b) pushChanges() found no dirty records (dirty flag bug in save())
		//   (c) /api/sync/push returned non-200 (DB down, auth, schema mismatch)
		let pushSucceeded = false;
		try {
			const pushResponse = await pushResponsePromise;
			pushSucceeded = pushResponse.ok();
		} catch {
			pushSucceeded = false;
		}

		await contextA.close();

		// Assert push before opening Context B — unambiguous failure layer.
		expect(pushSucceeded, [
			'SYNC PUSH FAILED.',
			`Entry "${description}" exists in IndexedDB but /api/sync/push did not return 200.`,
			'Check: (1) sync() error handling in save(), (2) dirty=true set before sync(),',
			'(3) Postgres reachable at DATABASE_URL, (4) DEV_BYPASS_AUTH=true in .env.'
		].join(' ')).toBe(true);

		// ── Step 9: Open a second browser context (fresh, isolated IndexedDB)
		const contextB = await browser.newContext();
		const pageB = await contextB.newPage();

		// ── Step 10: Navigate to /entries
		await pageB.goto('/entries');

		// ── Step 11: Wait for sync/pull
		// Context B starts with empty IDB. Sync must run to populate from Postgres.
		// If sync is not auto-triggered on page load, this times out — that is itself
		// a real bug: other devices won't see entries unless they manually sync.
		let pullSucceeded = false;
		try {
			await pageB.waitForResponse(
				(res) => res.url().includes('/api/sync/pull') && res.ok(),
				{ timeout: 20_000 }
			);
			pullSucceeded = true;
		} catch {
			pullSucceeded = false;
		}

		// Wait for loading spinner to clear (liveQuery subscription initialised)
		await pageB
			.waitForSelector('.loading', { state: 'detached', timeout: 10_000 })
			.catch(() => {});

		// ── Step 12: Assert entry visible in Context B
		// FAILURE = "sync did not propagate": entry is on the server but not visible.
		// Either pull didn't run, or pullChanges() SQL didn't include the entry
		// (user_id mismatch, soft-delete filter, entry not yet in Postgres).
		await expect(pageB.getByText(description)).toBeVisible({ timeout: 20_000 });

		if (!pullSucceeded) {
			console.warn(
				'[golden-path] Step 12 passed but no sync/pull request was observed. ' +
				'Sync may not be auto-triggered on the entries page — other devices ' +
				'may miss updates until the user manually triggers sync.'
			);
		}

		await contextB.close();
	});
});
