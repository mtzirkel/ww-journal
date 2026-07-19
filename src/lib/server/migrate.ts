import { sql } from './sql.js';

let migrated = false;

export async function migrate() {
	if (migrated) return;

	// Rivers — shared across users. Integer ID preserved from Django export.
	// User-added rivers get auto-assigned IDs starting at 100000.
	await sql`
		CREATE TABLE IF NOT EXISTS rivers (
			id INTEGER PRIMARY KEY,
			river_name TEXT NOT NULL,
			section TEXT,
			state TEXT NOT NULL,
			aw_id TEXT,
			class_rating TEXT,
			aw_gauge_id INTEGER,
			external_gauge_source TEXT,
			external_gauge_id TEXT,
			gauge_min NUMERIC,
			gauge_max NUMERIC,
			lat NUMERIC,
			lon NUMERIC,
			alt_name TEXT,
			abstract TEXT,
			created_by_user_id TEXT,
			created_at TIMESTAMPTZ DEFAULT now(),
			updated_at TIMESTAMPTZ DEFAULT now(),
			deleted_at TIMESTAMPTZ
		)
	`;

	await sql`CREATE INDEX IF NOT EXISTS rivers_updated_at ON rivers(updated_at)`;
	await sql`CREATE INDEX IF NOT EXISTS rivers_external_gauge ON rivers(external_gauge_id)`;

	// Trips — per user. UUID for cross-device sync safety.
	await sql`
		CREATE TABLE IF NOT EXISTS trips (
			id UUID PRIMARY KEY,
			user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			start_date DATE,
			end_date DATE,
			created_at TIMESTAMPTZ NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL,
			deleted_at TIMESTAMPTZ
		)
	`;

	await sql`CREATE INDEX IF NOT EXISTS trips_user_updated ON trips(user_id, updated_at)`;

	// Entries — per user. UUID for cross-device sync safety.
	await sql`
		CREATE TABLE IF NOT EXISTS entries (
			id UUID PRIMARY KEY,
			user_id TEXT NOT NULL,
			river_id INTEGER NOT NULL,
			trip_id UUID,
			date DATE NOT NULL,
			flow NUMERIC NOT NULL DEFAULT 0,
			description TEXT DEFAULT '',
			tags JSONB DEFAULT '[]'::jsonb,
			created_at TIMESTAMPTZ NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL,
			deleted_at TIMESTAMPTZ
		)
	`;

	await sql`CREATE INDEX IF NOT EXISTS entries_user_updated ON entries(user_id, updated_at)`;
	await sql`CREATE INDEX IF NOT EXISTS entries_user_date ON entries(user_id, date DESC)`;
	await sql`CREATE INDEX IF NOT EXISTS entries_user_trip ON entries(user_id, trip_id)`;

	// Add datetime column if it doesn't exist (migration for existing installs)
	await sql`
		ALTER TABLE entries ADD COLUMN IF NOT EXISTS datetime TIMESTAMPTZ
	`;
	// Backfill: set datetime from date at noon UTC for rows that have none
	await sql`
		UPDATE entries SET datetime = (date::text || 'T12:00:00.000Z')::timestamptz WHERE datetime IS NULL
	`;

	// Tag categories — per user.
	await sql`
		CREATE TABLE IF NOT EXISTS tag_categories (
			id UUID PRIMARY KEY,
			user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			icon TEXT DEFAULT '🏷',
			values JSONB DEFAULT '[]'::jsonb,
			created_at TIMESTAMPTZ NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL,
			deleted_at TIMESTAMPTZ
		)
	`;

	await sql`CREATE INDEX IF NOT EXISTS tag_categories_user_updated ON tag_categories(user_id, updated_at)`;

	// --- Multi-activity support ---
	// Entries are no longer paddling-only. activity_type discriminates; the
	// envelope carries cross-sport metrics; details holds sport-specific extras.
	// river_id/flow stay as real columns (indexed, joined against rivers) and are
	// mapped into details.paddle by the sync layer.
	await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS activity_type TEXT NOT NULL DEFAULT 'paddle'`;
	await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS title TEXT`;
	await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS place TEXT`;
	await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS lat NUMERIC`;
	await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS lon NUMERIC`;
	await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS distance NUMERIC`;
	await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS duration_seconds INTEGER`;
	await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS elevation_gain NUMERIC`;
	await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb`;

	// Paddle-only fields are no longer universal.
	await sql`ALTER TABLE entries ALTER COLUMN river_id DROP NOT NULL`;
	await sql`ALTER TABLE entries ALTER COLUMN flow DROP NOT NULL`;
	await sql`ALTER TABLE entries ALTER COLUMN flow DROP DEFAULT`;

	await sql`CREATE INDEX IF NOT EXISTS entries_user_activity ON entries(user_id, activity_type)`;

	migrated = true;
}
