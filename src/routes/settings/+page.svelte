<script lang="ts">
	import { sync, syncStore, rebuildLocalData } from '$lib/sync.svelte.js';
	import { ACTIVITIES } from '$lib/activity.js';
	import { getFavoriteActivities, setFavoriteActivities, activityUsage } from '$lib/db/index.js';
	import { onMount } from 'svelte';

	let favorites = $state<string[]>([]);
	let favoritesLoaded = $state(false);

	async function loadFavorites() {
		const chosen = await getFavoriteActivities();
		if (chosen && chosen.length > 0) {
			favorites = chosen;
		} else {
			const used = await activityUsage();
			favorites = used.length > 0 ? used : ['paddle'];
		}
		favoritesLoaded = true;
	}

	async function toggleFavorite(type: string) {
		// Keep at least one pinned — an empty picker would strand the user.
		const next = favorites.includes(type)
			? favorites.filter((t) => t !== type)
			: [...favorites, type];
		if (next.length === 0) return;
		favorites = next;
		await setFavoriteActivities(next);
	}

	let rebuilding = $state(false);
	let rebuildError = $state<string | null>(null);
	let rebuildDone = $state(false);

	async function doRebuild() {
		rebuilding = true;
		rebuildError = null;
		rebuildDone = false;
		try {
			await rebuildLocalData();
			rebuildDone = true;
		} catch (err) {
			rebuildError = err instanceof Error ? err.message : String(err);
		} finally {
			rebuilding = false;
		}
	}

	let { data } = $props();
	let persistGranted = $state<boolean | null>(null);

	onMount(async () => {
		await syncStore.refreshPendingCount();
		await loadFavorites();
		if (navigator.storage?.persisted) {
			persistGranted = await navigator.storage.persisted();
		}
	});

	async function requestPersist() {
		if (navigator.storage?.persist) {
			persistGranted = await navigator.storage.persist();
		}
	}

	function relativeTime(iso: string | null): string {
		if (!iso) return 'never';
		const ms = Date.now() - new Date(iso).getTime();
		const sec = Math.floor(ms / 1000);
		if (sec < 60) return `${sec}s ago`;
		const min = Math.floor(sec / 60);
		if (min < 60) return `${min}m ago`;
		const hr = Math.floor(min / 60);
		if (hr < 24) return `${hr}h ago`;
		const days = Math.floor(hr / 24);
		return `${days}d ago`;
	}
</script>

<h1 class="text-3xl font-bold mb-6">Settings</h1>

<div class="card bg-base-100 shadow mb-4">
	<div class="card-body">
		<h2 class="card-title">Account</h2>
		{#if data.user}
			<p>Signed in as <strong>{data.user.username}</strong></p>
		{/if}
	</div>
</div>

<div class="card bg-base-100 shadow mb-4">
	<div class="card-body">
		<h2 class="card-title">Sync</h2>
		<div class="space-y-2 text-sm">
			<div class="flex justify-between">
				<span class="text-base-content/60">Status</span>
				<span class="font-medium">
					{#if syncStore.state === 'syncing'}
						<span class="loading loading-spinner loading-xs"></span> Syncing...
					{:else if syncStore.state === 'error'}
						<span class="text-error">Error</span>
					{:else if syncStore.state === 'offline'}
						Offline
					{:else if syncStore.pendingCount > 0}
						{syncStore.pendingCount} unsynced
					{:else}
						<span class="text-success">All synced</span>
					{/if}
				</span>
			</div>
			<div class="flex justify-between">
				<span class="text-base-content/60">Last sync</span>
				<span>{relativeTime(syncStore.lastSyncedAt)}</span>
			</div>
			{#if syncStore.lastError}
				<div class="alert alert-error text-xs mt-2">
					<span>{syncStore.lastError}</span>
				</div>
			{/if}
		</div>
		<button class="btn btn-primary btn-sm mt-4" disabled={syncStore.state === 'syncing'} onclick={() => sync()}>
			Sync Now
		</button>
	</div>
</div>

<div class="card bg-base-100 shadow mb-4">
	<div class="card-body">
		<h2 class="card-title">Local Storage</h2>
		<p class="text-sm text-base-content/60">
			Your journal data is stored locally on this device and synced to the server. Persistent storage prevents your browser from evicting the local copy under storage pressure.
			This matters most on <strong>mobile browsers</strong> (especially iOS Safari) which can aggressively clear site data. Desktop browsers rarely evict data.
		</p>
		<div class="flex justify-between items-center mt-2">
			<span class="text-sm">
				{#if persistGranted === true}
					<span class="text-success">✓ Persistent storage granted</span>
				{:else if persistGranted === false}
					<span class="text-warning">⚠ Not granted</span>
				{:else}
					Checking...
				{/if}
			</span>
			{#if persistGranted === false}
				<button class="btn btn-sm btn-outline" onclick={requestPersist}>Request</button>
			{/if}
		</div>
	</div>
</div>

<div class="card bg-base-100 shadow mb-4">
	<div class="card-body">
		<h2 class="card-title">Activities</h2>
		<p class="text-base-content/70 text-sm">
			Pinned activities show at the top when logging a day. The rest stay tucked
			behind “More”. Saved on this device only.
		</p>
		{#if favoritesLoaded}
			<div class="flex flex-wrap gap-2 mt-2">
				{#each ACTIVITIES as a (a.type)}
					<button
						type="button"
						class="btn btn-sm {favorites.includes(a.type) ? 'btn-primary' : 'btn-outline'}"
						aria-pressed={favorites.includes(a.type)}
						onclick={() => toggleFavorite(a.type)}
					>
						{a.icon}
						{a.label}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<div class="card bg-base-100 shadow mb-4">
	<div class="card-body">
		<h2 class="card-title">Data</h2>

		<p class="text-base-content/70 text-sm">
			Rebuild this device's copy from the server. Everything local is synced up first,
			and nothing is cleared unless that succeeds.
		</p>

		{#if rebuildError}
			<div class="alert alert-error mt-2">
				<span>{rebuildError}</span>
			</div>
		{/if}
		{#if rebuildDone}
			<div class="alert alert-success mt-2">
				<span>Local data rebuilt from the server.</span>
			</div>
		{/if}

		<button
			class="btn btn-outline btn-sm mt-3 w-fit"
			disabled={rebuilding || syncStore.state === 'syncing'}
			onclick={doRebuild}
		>
			{#if rebuilding}
				<span class="loading loading-spinner loading-xs"></span> Rebuilding...
			{:else}
				Sync &amp; rebuild local data
			{/if}
		</button>

		<p class="text-base-content/50 text-sm mt-4">Export/import coming in Phase 6</p>
	</div>
</div>

<div class="card bg-base-100 shadow">
	<div class="card-body">
		<h2 class="card-title">Garmin Connect</h2>
		<p class="text-base-content/50 text-sm">GPS tracks and heart rate — coming in Phase 5</p>
	</div>
</div>
