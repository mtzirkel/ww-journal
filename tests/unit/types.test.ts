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
	it('can be constructed with all fields including optional id', () => {
		// Requirement: JournalEntry with id (existing record) must be valid
		const entry: JournalEntry = {
			id: 1,
			date: '2024-06-01',
			riverId: 42,
			flow: 450,
			description: 'Great run, medium water',
			tripId: null,
			createdAt: '2024-06-01T18:00:00Z',
			updatedAt: '2024-06-01T18:00:00Z',
			syncStatus: 'local'
		};

		expect(entry.id).toBe(1);
		expect(entry.riverId).toBe(42);
		expect(entry.flow).toBe(450);
	});

	it('can be constructed without id (new, unsaved entry)', () => {
		// Requirement: new entries before Dexie assigns an auto-increment id
		// must be valid — id is optional
		const entry: JournalEntry = {
			date: '2024-06-15',
			riverId: 7,
			flow: 820,
			description: 'High water flush',
			tripId: null,
			createdAt: '2024-06-15T14:00:00Z',
			updatedAt: '2024-06-15T14:00:00Z',
			syncStatus: 'pending'
		};

		expect(entry.id).toBeUndefined();
		expect(entry.date).toBe('2024-06-15');
	});

	it('syncStatus accepts all three valid states', () => {
		// Requirement: the PWA offline sync system uses these three states to track
		// what needs to be synced to the server when connectivity is restored
		const statuses: JournalEntry['syncStatus'][] = ['local', 'synced', 'pending'];

		for (const status of statuses) {
			const entry: JournalEntry = {
				date: '2024-01-01',
				riverId: 1,
				flow: 100,
				description: '',
				tripId: null,
				createdAt: '',
				updatedAt: '',
				syncStatus: status
			};
			expect(entry.syncStatus).toBe(status);
		}
	});

	it('date is stored as a string (ISO date), not a Date object', () => {
		// Requirement: Dexie/IndexedDB date indexing works best with ISO strings;
		// storing as Date objects creates serialization issues
		const entry: JournalEntry = {
			date: '2024-06-01',
			riverId: 1,
			flow: 500,
			description: 'test',
			tripId: null,
			createdAt: '2024-06-01T00:00:00Z',
			updatedAt: '2024-06-01T00:00:00Z',
			syncStatus: 'local'
		};

		expect(typeof entry.date).toBe('string');
		expect(typeof entry.createdAt).toBe('string');
	});
});
