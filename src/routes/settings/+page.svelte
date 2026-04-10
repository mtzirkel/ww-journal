<script lang="ts">
	let { data } = $props();
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
		<h2 class="card-title">Data</h2>
		<p class="text-base-content/50 text-sm">Export/import coming in Phase 6</p>
	</div>
</div>

<div class="card bg-base-100 shadow">
	<div class="card-body">
		<h2 class="card-title">Garmin Connect</h2>
		<p class="text-base-content/50 text-sm">GPS tracks and heart rate — coming in Phase 5</p>
	</div>
</div>
