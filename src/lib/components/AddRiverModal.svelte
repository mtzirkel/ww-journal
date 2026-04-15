<script lang="ts">
	import { db } from '$lib/db/index.js';
	import type { River } from '$lib/types.js';

	let {
		initialName = '',
		onclose,
		onsave
	}: {
		initialName?: string;
		onclose: () => void;
		onsave: (river: River) => void;
	} = $props();

	let riverName = $state(initialName);
	let section = $state('');
	let riverState = $state('');
	let classRating = $state('');
	let externalGaugeId = $state('');
	let saving = $state(false);

	const states = [
		'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
		'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
		'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
	];

	const classRatings = ['I', 'I-II', 'II', 'II-III', 'III', 'III-IV', 'IV', 'IV-V', 'V', 'V+'];

	async function save() {
		if (!riverName.trim() || !riverState) return;
		saving = true;

		const maxId = await db.rivers.orderBy('id').last();
		const newId = (maxId?.id ?? 10000) + 1;

		const now = new Date().toISOString();
		const river: River = {
			id: newId,
			riverName: riverName.trim(),
			section: section.trim() || null,
			state: riverState,
			awId: null,
			classRating: classRating || null,
			awGaugeId: null,
			externalGaugeSource: externalGaugeId.trim() ? 'usgs' : null,
			externalGaugeId: externalGaugeId.trim() || null,
			gaugeMin: null,
			gaugeMax: null,
			lat: null,
			lon: null,
			altName: null,
			abstract: null,
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			dirty: true
		};

		await db.rivers.add(river);
		saving = false;
		onsave(river);
	}
</script>

<div class="modal modal-open">
	<div class="modal-box">
		<h3 class="font-bold text-lg mb-4">Add New River</h3>

		<div class="form-control mb-3">
			<label class="label" for="river-name"><span class="label-text">River Name</span></label>
			<input type="text" id="river-name" class="input input-bordered w-full" bind:value={riverName} placeholder="e.g. Blackfoot" required />
		</div>

		<div class="form-control mb-3">
			<label class="label" for="section"><span class="label-text">Section (optional)</span></label>
			<input type="text" id="section" class="input input-bordered w-full" bind:value={section} placeholder="e.g. Alberton Gorge" />
		</div>

		<div class="grid grid-cols-2 gap-3 mb-3">
			<div class="form-control">
				<label class="label" for="state"><span class="label-text">State</span></label>
				<select id="state" class="select select-bordered w-full" bind:value={riverState} required>
					<option value="">Select...</option>
					{#each states as s}
						<option value={s}>{s}</option>
					{/each}
				</select>
			</div>
			<div class="form-control">
				<label class="label" for="class"><span class="label-text">Class</span></label>
				<select id="class" class="select select-bordered w-full" bind:value={classRating}>
					<option value="">Unknown</option>
					{#each classRatings as c}
						<option value={c}>{c}</option>
					{/each}
				</select>
			</div>
		</div>

		<div class="form-control mb-6">
			<label class="label" for="gauge"><span class="label-text">USGS Gauge ID (optional)</span></label>
			<input type="text" id="gauge" class="input input-bordered w-full" bind:value={externalGaugeId} placeholder="e.g. 12056500" />
			<label class="label">
				<span class="label-text-alt text-base-content/40">Find gauge IDs at waterdata.usgs.gov</span>
			</label>
		</div>

		<div class="modal-action">
			<button class="btn btn-ghost" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={!riverName.trim() || !riverState || saving} onclick={save}>
				{saving ? 'Saving...' : 'Add River'}
			</button>
		</div>
	</div>
	<div class="modal-backdrop" onclick={onclose}></div>
</div>
