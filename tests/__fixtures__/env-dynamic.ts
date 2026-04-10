// Stub for $env/dynamic/private — used by vitest when running outside the SvelteKit
// build pipeline. Tests that need different values override this via vi.mock().
export const env = {
	DEV_BYPASS_AUTH: 'false',
	AUTH_URL: 'http://localhost:5173',
	AUTH_APP_SLUG: 'ww-journal'
};
