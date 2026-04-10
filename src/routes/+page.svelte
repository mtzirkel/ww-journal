<script lang="ts">
	let { data } = $props();
</script>

<h1 class="text-3xl font-bold mb-6">Dashboard</h1>

<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
	<div class="stat bg-base-100 rounded-xl shadow">
		<div class="stat-title">Total Days</div>
		<div class="stat-value text-primary">--</div>
	</div>
	<div class="stat bg-base-100 rounded-xl shadow">
		<div class="stat-title">This Year</div>
		<div class="stat-value">--</div>
	</div>
	<div class="stat bg-base-100 rounded-xl shadow">
		<div class="stat-title">This Month</div>
		<div class="stat-value">--</div>
	</div>
	<div class="stat bg-base-100 rounded-xl shadow">
		<div class="stat-title">Rivers</div>
		<div class="stat-value">--</div>
	</div>
</div>

<div class="card bg-base-100 shadow">
	<div class="card-body">
		<h2 class="card-title">Days per River</h2>
		<p class="text-base-content/50">Chart coming in Phase 2</p>
	</div>
</div>
