import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Standalone from vite.config.ts: mixing the sveltekit plugin's vite
// dependency with vitest's own bundled vite in one defineConfig call
// produces conflicting Plugin<> type instantiations that break `svelte-check`.
// Strategy/replay code only ever imports plain TypeScript via the $lib alias
// (never SvelteKit runtime modules like $app/* or $env/*), so a manual alias
// is enough — no need for the full sveltekit plugin here.
export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
