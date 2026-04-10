/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

import { build, files, version } from '$service-worker';

const CACHE = `ww-journal-${version}`;
const ASSETS = [...build, ...files];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
	async function addFilesToCache() {
		const cache = await caches.open(CACHE);
		await cache.addAll(ASSETS);
	}
	event.waitUntil(addFilesToCache());
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
	async function deleteOldCaches() {
		for (const key of await caches.keys()) {
			if (key !== CACHE) await caches.delete(key);
		}
	}
	event.waitUntil(deleteOldCaches());
});

// Fetch: cache-first for assets, network-first for pages/API
self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);

	// Skip auth service requests
	if (url.origin !== self.location.origin) return;

	// Skip API routes — always network
	if (url.pathname.startsWith('/api/')) return;

	async function respond() {
		const cache = await caches.open(CACHE);

		// Cache-first for static assets
		if (ASSETS.includes(url.pathname)) {
			const cached = await cache.match(event.request);
			if (cached) return cached;
		}

		// Network-first for pages
		try {
			const response = await fetch(event.request);
			if (response.status === 200) {
				cache.put(event.request, response.clone());
			}
			return response;
		} catch {
			// Offline fallback
			const cached = await cache.match(event.request);
			if (cached) return cached;
			return new Response('Offline', { status: 503 });
		}
	}

	event.respondWith(respond());
});

// Background sync for pending entries
self.addEventListener('sync', (event: ExtendableEvent & { tag?: string }) => {
	if (event.tag === 'sync-entries') {
		// Will be implemented in Phase 3
	}
});
