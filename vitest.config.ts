import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
		isolate: true,
		include: ['tests/**/*.test.ts']
	},
	resolve: {
		alias: {
			// SvelteKit path aliases — resolved manually since vitest runs outside
			// the SvelteKit build pipeline
			$lib: path.resolve('./src/lib'),
			// $env/dynamic/private is a SvelteKit virtual module; stub it so tests
			// can set env values without a running SvelteKit server
			'$env/dynamic/private': path.resolve('./tests/__fixtures__/env-dynamic.ts')
		}
	}
});
