# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: entries.test.ts >> entries page — navigation to entry detail >> entry card links to /entries/[id]
- Location: tests/e2e/entries.test.ts:115:2

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('link', { name: 'Log a Day' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('link', { name: 'Log a Day' })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - link "NoEgos Auth" [ref=e6] [cursor=pointer]:
      - /url: /
    - link "Login" [ref=e8] [cursor=pointer]:
      - /url: /login
  - main [ref=e9]:
    - generic [ref=e11]:
      - heading "Sign In" [level=2] [ref=e12]
      - generic [ref=e13]:
        - generic [ref=e14]:
          - generic [ref=e16]: Username
          - textbox "Username" [ref=e17]
        - generic [ref=e18]:
          - generic [ref=e20]: Authenticator Code
          - textbox "Authenticator Code" [ref=e21]:
            - /placeholder: "000000"
        - button "Sign In" [ref=e22] [cursor=pointer]
      - generic [ref=e23]: OR
      - link "Request Access" [ref=e24] [cursor=pointer]:
        - /url: /request-access
```

# Test source

```ts
  31  | 			riverId: e.riverId,
  32  | 			datetime: e.datetime,
  33  | 			flow: e.flow ?? null,
  34  | 			notes: '',
  35  | 			description: '',
  36  | 			tags: [],
  37  | 			dirty: false,
  38  | 			deletedAt: null
  39  | 		});
  40  | 		await db.rivers.put({
  41  | 			id: e.riverId,
  42  | 			riverName: e.riverName,
  43  | 			section: '',
  44  | 			state: 'MT',
  45  | 			classRating: 'III',
  46  | 			externalGaugeId: null,
  47  | 			externalGaugeSource: null
  48  | 		});
  49  | 	}, entry);
  50  | }
  51  | 
  52  | // ---------------------------------------------------------------------------
  53  | // Filter: URL param applied on load
  54  | // ---------------------------------------------------------------------------
  55  | 
  56  | test.describe('entries page — URL filter params', () => {
  57  | 	test('?year=YYYY shows filter label', async ({ page }) => {
  58  | 		await page.goto('/entries?year=2026');
  59  | 		await expect(page.getByText(/Filtered: 2026/)).toBeVisible();
  60  | 	});
  61  | 
  62  | 	test('?month=YYYY-MM shows filter label with month name', async ({ page }) => {
  63  | 		await page.goto('/entries?month=2026-04');
  64  | 		await expect(page.getByText(/Filtered: April 2026/)).toBeVisible();
  65  | 	});
  66  | 
  67  | 	test('?view=rivers shows Rivers filter label', async ({ page }) => {
  68  | 		await page.goto('/entries?view=rivers');
  69  | 		await expect(page.getByText(/Filtered: Rivers/)).toBeVisible();
  70  | 	});
  71  | 
  72  | 	test('no params — no filter label shown', async ({ page }) => {
  73  | 		await page.goto('/entries');
  74  | 		await expect(page.getByText(/Filtered:/)).not.toBeVisible();
  75  | 	});
  76  | });
  77  | 
  78  | // ---------------------------------------------------------------------------
  79  | // Clear button
  80  | // ---------------------------------------------------------------------------
  81  | 
  82  | test.describe('entries page — Clear filter', () => {
  83  | 	test('Clear button removes filter label', async ({ page }) => {
  84  | 		await page.goto('/entries?year=2026');
  85  | 		await expect(page.getByText(/Filtered: 2026/)).toBeVisible();
  86  | 
  87  | 		await page.getByRole('button', { name: 'Clear' }).click();
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
> 131 | 			await expect(page.getByRole('link', { name: 'Log a Day' })).toBeVisible();
      |                                                                ^ Error: expect(locator).toBeVisible() failed
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
  188 | 		const href = await link.getAttribute('href');
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
```