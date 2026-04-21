# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: entries.test.ts >> dashboard stat cards >> Rivers card links to /entries?view=rivers
- Location: tests/e2e/entries.test.ts:185:2

# Error details

```
Error: locator.getAttribute: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('link', { name: /Rivers/i })

```

# Test source

```ts
  88  | 
  89  | 		// Filter label should be gone
  90  | 		await expect(page.getByText(/Filtered:/)).not.toBeVisible();
  91  | 		// URL should be clean
  92  | 		expect(page.url()).toMatch(/\/entries$/);
  93  | 	});
  94  | 
  95  | 	test('Clear from month filter works', async ({ page }) => {
  96  | 		await page.goto('/entries?month=2026-04');
  97  | 		await page.getByRole('button', { name: 'Clear' }).click();
  98  | 		await expect(page.getByText(/Filtered:/)).not.toBeVisible();
  99  | 		expect(page.url()).toMatch(/\/entries$/);
  100 | 	});
  101 | 
  102 | 	test('Clear from river filter works', async ({ page }) => {
  103 | 		await page.goto('/entries?river=1');
  104 | 		// river filter label only shows if rivers map is loaded — just check URL clears
  105 | 		await page.getByRole('button', { name: 'Clear' }).click();
  106 | 		expect(page.url()).toMatch(/\/entries$/);
  107 | 	});
  108 | });
  109 | 
  110 | // ---------------------------------------------------------------------------
  111 | // Navigation: stat card → entries → entry detail
  112 | // ---------------------------------------------------------------------------
  113 | 
  114 | test.describe('entries page — navigation to entry detail', () => {
  115 | 	test('entry card links to /entries/[id]', async ({ page }) => {
  116 | 		// Navigate to entries list (unfiltered)
  117 | 		await page.goto('/entries');
  118 | 		// Wait for loaded state (spinner gone)
  119 | 		await page.waitForSelector('.loading', { state: 'detached', timeout: 10_000 }).catch(() => {});
  120 | 
  121 | 		// If there are entry cards, click the first one
  122 | 		const entryCard = page.locator('a[href^="/entries/"]').first();
  123 | 		const count = await entryCard.count();
  124 | 
  125 | 		if (count > 0) {
  126 | 			const href = await entryCard.getAttribute('href');
  127 | 			await entryCard.click();
  128 | 			await expect(page).toHaveURL(/\/entries\/[^/]+$/);
  129 | 		} else {
  130 | 			// No entries — just verify the "Log a Day" CTA is present
  131 | 			await expect(page.getByRole('link', { name: 'Log a Day' })).toBeVisible();
  132 | 		}
  133 | 	});
  134 | 
  135 | 	test('entry card links to detail from filtered view', async ({ page }) => {
  136 | 		await page.goto('/entries?year=2026');
  137 | 		await page.waitForSelector('.loading', { state: 'detached', timeout: 10_000 }).catch(() => {});
  138 | 
  139 | 		const entryCard = page.locator('a[href^="/entries/"]').first();
  140 | 		const count = await entryCard.count();
  141 | 
  142 | 		if (count > 0) {
  143 | 			await entryCard.click();
  144 | 			await expect(page).toHaveURL(/\/entries\/[^/]+$/);
  145 | 		}
  146 | 	});
  147 | 
  148 | 	test('entry card links to detail from river-filtered view', async ({ page }) => {
  149 | 		await page.goto('/entries?river=1');
  150 | 		await page.waitForSelector('.loading', { state: 'detached', timeout: 10_000 }).catch(() => {});
  151 | 
  152 | 		const entryCard = page.locator('a[href^="/entries/"]').first();
  153 | 		if (await entryCard.count() > 0) {
  154 | 			await entryCard.click();
  155 | 			await expect(page).toHaveURL(/\/entries\/[^/]+$/);
  156 | 		}
  157 | 	});
  158 | });
  159 | 
  160 | // ---------------------------------------------------------------------------
  161 | // Dashboard stat cards
  162 | // ---------------------------------------------------------------------------
  163 | 
  164 | test.describe('dashboard stat cards', () => {
  165 | 	test('Total Days card links to /entries', async ({ page }) => {
  166 | 		await page.goto('/');
  167 | 		const link = page.getByRole('link', { name: /Total Days/i });
  168 | 		await expect(link).toHaveAttribute('href', '/entries');
  169 | 	});
  170 | 
  171 | 	test('This Year card links to /entries?year=', async ({ page }) => {
  172 | 		await page.goto('/');
  173 | 		const link = page.getByRole('link', { name: /This Year/i });
  174 | 		const href = await link.getAttribute('href');
  175 | 		expect(href).toMatch(/\/entries\?year=\d{4}/);
  176 | 	});
  177 | 
  178 | 	test('This Month card links to /entries?month=', async ({ page }) => {
  179 | 		await page.goto('/');
  180 | 		const link = page.getByRole('link', { name: /This Month/i });
  181 | 		const href = await link.getAttribute('href');
  182 | 		expect(href).toMatch(/\/entries\?month=\d{4}-\d{2}/);
  183 | 	});
  184 | 
  185 | 	test('Rivers card links to /entries?view=rivers', async ({ page }) => {
  186 | 		await page.goto('/');
  187 | 		const link = page.getByRole('link', { name: /Rivers/i });
> 188 | 		const href = await link.getAttribute('href');
      |                           ^ Error: locator.getAttribute: Target page, context or browser has been closed
  189 | 		expect(href).toContain('/entries?view=rivers');
  190 | 	});
  191 | 
  192 | 	test('clicking This Year card lands on filtered entries page', async ({ page }) => {
  193 | 		await page.goto('/');
  194 | 		const link = page.getByRole('link', { name: /This Year/i });
  195 | 		await link.click();
  196 | 		await expect(page).toHaveURL(/\/entries\?year=\d{4}/);
  197 | 		await expect(page.getByText(/Filtered: \d{4}/)).toBeVisible();
  198 | 	});
  199 | 
  200 | 	test('clicking This Month card lands on filtered entries page', async ({ page }) => {
  201 | 		await page.goto('/');
  202 | 		const link = page.getByRole('link', { name: /This Month/i });
  203 | 		await link.click();
  204 | 		await expect(page).toHaveURL(/\/entries\?month=/);
  205 | 		await expect(page.getByText(/Filtered:/)).toBeVisible();
  206 | 	});
  207 | });
  208 | 
  209 | // ---------------------------------------------------------------------------
  210 | // Rivers view
  211 | // ---------------------------------------------------------------------------
  212 | 
  213 | test.describe('rivers view', () => {
  214 | 	test('?view=rivers shows rivers heading and no entry cards', async ({ page }) => {
  215 | 		await page.goto('/entries?view=rivers');
  216 | 		await page.waitForSelector('.loading', { state: 'detached', timeout: 10_000 }).catch(() => {});
  217 | 		// No individual entry cards (those link to /entries/[id])
  218 | 		// The rivers view shows river cards that link to /entries?river=
  219 | 		const entryDetailLinks = page.locator('a[href^="/entries/"]');
  220 | 		await expect(entryDetailLinks).toHaveCount(0);
  221 | 	});
  222 | 
  223 | 	test('river card in rivers view navigates to filtered list', async ({ page }) => {
  224 | 		await page.goto('/entries?view=rivers');
  225 | 		await page.waitForSelector('.loading', { state: 'detached', timeout: 10_000 }).catch(() => {});
  226 | 
  227 | 		const riverCard = page.locator('a[href*="entries?river="]').first();
  228 | 		if (await riverCard.count() > 0) {
  229 | 			await riverCard.click();
  230 | 			await expect(page).toHaveURL(/\/entries\?river=\d+/);
  231 | 		}
  232 | 	});
  233 | });
  234 | 
  235 | // ---------------------------------------------------------------------------
  236 | // New entry form
  237 | // ---------------------------------------------------------------------------
  238 | 
  239 | test.describe('new entry form', () => {
  240 | 	test('navigates to /entries/new', async ({ page }) => {
  241 | 		await page.goto('/entries');
  242 | 		await page.getByRole('link', { name: '+ Log a Day' }).click();
  243 | 		await expect(page).toHaveURL('/entries/new');
  244 | 	});
  245 | 
  246 | 	test('Log a Day button visible on entries page', async ({ page }) => {
  247 | 		await page.goto('/entries');
  248 | 		await expect(page.getByRole('link', { name: '+ Log a Day' })).toBeVisible();
  249 | 	});
  250 | });
  251 | 
```