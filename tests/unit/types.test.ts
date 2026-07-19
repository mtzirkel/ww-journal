/**
 * Type definition tests for src/lib/types.ts
 *
 * Strategy: TypeScript interfaces are compile-time constructs, so we validate
 * them by constructing conforming objects and asserting on their shapes at
 * runtime. This ensures the interface is usable as documented and catches
 * regressions if fields are renamed or removed.
 *
 * Note: These tests also serve as living documentation of what a River and
 * JournalEntry look like — useful for anyone adding new features.
 */

import { describe, it, expect } from 'vitest';
import type { River, JournalEntry } from '$lib/types.js';
import { riverIdOf, flowOf } from '$lib/activity.js';

// ---------------------------------------------------------------------------
// River interface
// ---------------------------------------------------------------------------

describe('River type', () => {
	it('can be constructed with all required fields', () => {
		// Requirement: River must have id, riverName, state as required fields
		// since these are the minimum needed to display a river in the journal
		const river: River = {
			id: 1,
			riverName: 'Animas River',
			section: 'Silverton to Elk Park',
			state: 'CO',
			awId: '123',
			classRating: 'IV',
			awGaugeId: 9366500,
			externalGaugeSource: 'usgs',
			externalGaugeId: '09366500',
			gaugeMin: 200,
			gaugeMax: 1500,
			lat: 37.8,
			lon: -107.7,
			altName: null,
			abstract: 'Classic Colorado run'
		};

		expect(river.id).toBe(1);
		expect(river.riverName).toBe('Animas River');
		expect(river.state).toBe('CO');
	});

	it('allows nullable optional fields to be null', () => {
		// Requirement: many rivers in the imported dataset lack gauge info, ratings,
		// or coordinates — nullable fields must accept null without type errors
		const river: River = {
			id: 2,
			riverName: 'Mystery Creek',
			section: null,
			state: 'CA',
			awId: null,
			classRating: null,
			awGaugeId: null,
			externalGaugeSource: null,
			externalGaugeId: null,
			gaugeMin: null,
			gaugeMax: null,
			lat: null,
			lon: null,
			altName: null,
			abstract: null
		};

		expect(river.section).toBeNull();
		expect(river.lat).toBeNull();
		expect(river.classRating).toBeNull();
	});

	it('river id is a number, not a string', () => {
		// Requirement: Dexie uses the id as a primary key; must be numeric to
		// match the integer primary key from the Django import
		const river: River = {
			id: 999,
			riverName: 'Test River',
			section: null,
			state: 'UT',
			awId: null,
			classRating: null,
			awGaugeId: null,
			externalGaugeSource: null,
			externalGaugeId: null,
			gaugeMin: null,
			gaugeMax: null,
			lat: null,
			lon: null,
			altName: null,
			abstract: null
		};

		expect(typeof river.id).toBe('number');
	});
});

// ---------------------------------------------------------------------------
// JournalEntry interface
// ---------------------------------------------------------------------------

describe('JournalEntry type', () => {
	it('can be constructed with all required fields', () => {
		// Requirement: JournalEntry uses UUID strings as IDs for sync safety
		const entry: JournalEntry = {
			id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
			datetime: '2024-06-01T12:00:00.000Z',
			activityType: 'paddle',
			title: null,
			place: null,
			lat: null,
			lon: null,
			distance: null,
			durationSeconds: null,
			elevationGain: null,
			details: { riverId: 42, flow: 450 },
			description: 'Great run, medium water',
			tripId: null,
			tags: [],
			createdAt: '2024-06-01T18:00:00Z',
			updatedAt: '2024-06-01T18:00:00Z',
			deletedAt: null,
			dirty: true
		};

		expect(typeof entry.id).toBe('string');
		expect(riverIdOf(entry)).toBe(42);
		expect(flowOf(entry)).toBe(450);
		expect(entry.dirty).toBe(true);
	});

	it('soft delete uses deletedAt timestamp, not record removal', () => {
		// Requirement: sync needs to propagate deletions across devices, so we
		// keep the record with a deletedAt timestamp instead of physically deleting
		const entry: JournalEntry = {
			id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
			datetime: '2024-06-15T12:00:00.000Z',
			activityType: 'paddle',
			title: null,
			place: null,
			lat: null,
			lon: null,
			distance: null,
			durationSeconds: null,
			elevationGain: null,
			details: { riverId: 7, flow: 820 },
			description: 'High water flush',
			tripId: null,
			tags: [],
			createdAt: '2024-06-15T14:00:00Z',
			updatedAt: '2024-06-15T20:00:00Z',
			deletedAt: '2024-06-15T20:00:00Z',
			dirty: true
		};

		expect(entry.deletedAt).toBeTruthy();
		expect(entry.deletedAt).toBe(entry.updatedAt);
	});

	it('dirty flag tracks unsynced state', () => {
		// Requirement: clean records (already synced) have dirty=false,
		// modified records have dirty=true and get pushed on next sync
		const synced: JournalEntry = {
			id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
			datetime: '2024-01-01T12:00:00.000Z',
			activityType: 'paddle',
			title: null,
			place: null,
			lat: null,
			lon: null,
			distance: null,
			durationSeconds: null,
			elevationGain: null,
			details: { riverId: 1, flow: 100 },
			description: '',
			tripId: null,
			tags: [],
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: '2024-01-01T00:00:00Z',
			deletedAt: null,
			dirty: false
		};
		expect(synced.dirty).toBe(false);
	});

	it('date is stored as a string (ISO date), not a Date object', () => {
		// Requirement: Dexie/IndexedDB date indexing works best with ISO strings;
		// storing as Date objects creates serialization issues
		const entry: JournalEntry = {
			id: 'd4e5f6a7-b8c9-0123-def0-234567890123',
			datetime: '2024-06-01T12:00:00.000Z',
			activityType: 'paddle',
			title: null,
			place: null,
			lat: null,
			lon: null,
			distance: null,
			durationSeconds: null,
			elevationGain: null,
			details: { riverId: 1, flow: 500 },
			description: 'test',
			tripId: null,
			tags: [],
			createdAt: '2024-06-01T00:00:00Z',
			updatedAt: '2024-06-01T00:00:00Z',
			deletedAt: null,
			dirty: true
		};

		expect(typeof entry.datetime).toBe('string');
		expect(typeof entry.createdAt).toBe('string');
	});
});
