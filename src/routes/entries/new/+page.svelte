<h1 class="text-3xl font-bold mb-6">Log a River Day</h1>

<div class="card bg-base-100 shadow">
	<div class="card-body">
		<div class="form-control mb-4">
			<label class="label" for="river">
				<span class="label-text">River</span>
			</label>
			<input type="text" id="river" class="input input-bordered" placeholder="Search rivers..." />
		</div>

		<div class="grid grid-cols-2 gap-4 mb-4">
			<div class="form-control">
				<label class="label" for="date">
					<span class="label-text">Date</span>
				</label>
				<input type="date" id="date" class="input input-bordered" />
			</div>
			<div class="form-control">
				<label class="label" for="flow">
					<span class="label-text">Flow (CFS)</span>
				</label>
				<input type="number" id="flow" class="input input-bordered" placeholder="0" />
			</div>
		</div>

		<div class="form-control mb-6">
			<label class="label" for="description">
				<span class="label-text">Notes</span>
			</label>
			<textarea id="description" class="textarea textarea-bordered" rows="4" placeholder="How was the run?"></textarea>
		</div>

		<button class="btn btn-primary w-full" disabled>Save Entry (Phase 2)</button>
	</div>
</div>
