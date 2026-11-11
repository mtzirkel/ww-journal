/**
 * MCP server for the Whitewater Journal. One instance per request (stateless
 * Streamable HTTP); the caller is identified by an OAuth access token from
 * noegos-auth (see src/routes/mcp/+server.ts).
 *
 * Scopes: `read` for lookups, `write` for anything that changes the journal.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpPrincipal } from './auth.js';
import {
	ACTIVITY_TYPES,
	findRivers,
	listEntries,
	getEntry,
	createEntry,
	updateEntry,
	listTrips,
	createTrip,
	listTagCategories,
	getRiverConditions
} from './journal.js';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function ok(data: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] };
}

function err(message: string): ToolResult {
	return { content: [{ type: 'text', text: message }], isError: true };
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const tag = z.object({ category: z.string().min(1).max(50), value: z.string().min(1).max(100) });

const INSTRUCTIONS = `Whitewater Journal: the user's personal log of river days (paddling) and other outdoor activities.
- Before logging a river day, call find_river to get the river id; if several sections match, ask which one.
- Confirm the details (river/section, date, flow, notes) with the user before calling create_entry or update_entry.
- If flow is omitted on a paddle/fish entry with a USGS gauge, the journal fills it from USGS for that date.
- People who came along go in tags with category "People".`;

export function buildMcpServer(principal: McpPrincipal): McpServer {
	const server = new McpServer(
		{ name: 'ww-journal', title: 'Whitewater Journal', version: '1.0.0' },
		{ instructions: INSTRUCTIONS }
	);
	const can = (scope: 'read' | 'write') => principal.scopes.includes(scope);
	const uid = principal.userId;

	const guard =
		<A,>(scope: 'read' | 'write', fn: (args: A) => Promise<ToolResult>) =>
		async (args: A): Promise<ToolResult> => {
			if (!can(scope)) return err(`This connection lacks the "${scope}" scope. Reconnect and allow ${scope} access.`);
			try {
				return await fn(args);
			} catch (e) {
				return err(e instanceof Error ? e.message : String(e));
			}
		};

	// ------------------------------------------------------------- read

	server.registerTool(
		'find_river',
		{
			title: 'Find river',
			description:
				'Search the journal\'s river/section catalog by name, section, alt name or state (e.g. "skykomish index", "gauley WV"). Returns ids for create_entry and gauge info.',
			inputSchema: { query: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).optional() },
			annotations: { readOnlyHint: true }
		},
		guard('read', async ({ query, limit }: { query: string; limit?: number }) => ok(await findRivers(query, limit ?? 10)))
	);

	server.registerTool(
		'get_river_conditions',
		{
			title: 'River conditions',
			description: 'Current flow, runnable range and recent readings for a journal river (USGS gauges).',
			inputSchema: { river_id: z.number().int() },
			annotations: { readOnlyHint: true, openWorldHint: true }
		},
		guard('read', async ({ river_id }: { river_id: number }) => {
			const r = await getRiverConditions(river_id);
			return r ? ok(r) : err(`River ${river_id} not found`);
		})
	);

	server.registerTool(
		'list_entries',
		{
			title: 'List journal entries',
			description: 'The user\'s journal entries, newest first, optionally filtered.',
			inputSchema: {
				from: date.optional(),
				to: date.optional(),
				river_id: z.number().int().optional(),
				activity_type: z.enum(ACTIVITY_TYPES).optional(),
				trip_id: z.string().uuid().optional(),
				limit: z.number().int().min(1).max(200).optional()
			},
			annotations: { readOnlyHint: true }
		},
		guard(
			'read',
			async (a: { from?: string; to?: string; river_id?: number; activity_type?: string; trip_id?: string; limit?: number }) =>
				ok(
					await listEntries(uid, {
						from: a.from,
						to: a.to,
						riverId: a.river_id,
						activityType: a.activity_type,
						tripId: a.trip_id,
						limit: a.limit
					})
				)
		)
	);

	server.registerTool(
		'get_entry',
		{
			title: 'Get journal entry',
			description: 'One journal entry by id.',
			inputSchema: { id: z.string().uuid() },
			annotations: { readOnlyHint: true }
		},
		guard('read', async ({ id }: { id: string }) => {
			const e = await getEntry(uid, id);
			return e ? ok(e) : err('Entry not found');
		})
	);

	server.registerTool(
		'list_trips',
		{
			title: 'List trips',
			description: 'The user\'s trips (multi-day groupings of entries).',
			inputSchema: {},
			annotations: { readOnlyHint: true }
		},
		guard('read', async () => ok(await listTrips(uid)))
	);

	server.registerTool(
		'list_tag_categories',
		{
			title: 'List tag categories',
			description: 'Tag categories and known values (e.g. People, Boat, Conditions) to reuse when tagging entries.',
			inputSchema: {},
			annotations: { readOnlyHint: true }
		},
		guard('read', async () => ok(await listTagCategories(uid)))
	);

	// ------------------------------------------------------------- write

	server.registerTool(
		'create_entry',
		{
			title: 'Log a journal entry',
			description:
				'Create a journal entry. For river days use activity_type "paddle" (or "fish") and a river_id from find_river. Confirm details with the user first.',
			inputSchema: {
				activity_type: z.enum(ACTIVITY_TYPES).default('paddle'),
				date,
				time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Local HH:MM, defaults to 12:00'),
				river_id: z.number().int().optional(),
				flow: z.number().nonnegative().optional().describe('Flow in the gauge\'s unit (usually cfs). Omit to auto-fill from USGS.'),
				title: z.string().max(200).optional(),
				description: z.string().max(10000).optional().describe('Notes: who, what happened, lines, carnage, etc.'),
				place: z.string().max(200).optional().describe('Free-text location when there is no river_id'),
				trip_id: z.string().uuid().optional(),
				tags: z.array(tag).max(50).optional(),
				distance: z.number().nonnegative().optional().describe('Miles'),
				duration_minutes: z.number().nonnegative().optional()
			},
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
		},
		guard(
			'write',
			async (a: {
				activity_type: (typeof ACTIVITY_TYPES)[number];
				date: string;
				time?: string;
				river_id?: number;
				flow?: number;
				title?: string;
				description?: string;
				place?: string;
				trip_id?: string;
				tags?: Array<{ category: string; value: string }>;
				distance?: number;
				duration_minutes?: number;
			}) => {
				const r = await createEntry(uid, {
					activityType: a.activity_type,
					date: a.date,
					time: a.time,
					riverId: a.river_id,
					flow: a.flow,
					title: a.title,
					description: a.description,
					place: a.place,
					tripId: a.trip_id,
					tags: a.tags,
					distance: a.distance,
					durationMinutes: a.duration_minutes
				});
				return ok({ created: r.entry, flow_source: r.flowSource });
			}
		)
	);

	server.registerTool(
		'update_entry',
		{
			title: 'Edit a journal entry',
			description: 'Change fields on an existing entry. Only the fields you pass are changed. Set deleted=true to delete.',
			inputSchema: {
				id: z.string().uuid(),
				date: date.optional(),
				time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
				river_id: z.number().int().optional(),
				flow: z.number().nonnegative().optional(),
				title: z.string().max(200).optional(),
				description: z.string().max(10000).optional(),
				place: z.string().max(200).optional(),
				trip_id: z.string().uuid().or(z.literal('')).optional(),
				tags: z.array(tag).max(50).optional().describe('Replaces all tags'),
				distance: z.number().nonnegative().optional(),
				duration_minutes: z.number().nonnegative().optional(),
				deleted: z.boolean().optional()
			},
			annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
		},
		guard(
			'write',
			async (a: {
				id: string;
				date?: string;
				time?: string;
				river_id?: number;
				flow?: number;
				title?: string;
				description?: string;
				place?: string;
				trip_id?: string;
				tags?: Array<{ category: string; value: string }>;
				distance?: number;
				duration_minutes?: number;
				deleted?: boolean;
			}) =>
				ok(
					await updateEntry(uid, a.id, {
						date: a.date,
						time: a.time,
						riverId: a.river_id,
						flow: a.flow,
						title: a.title,
						description: a.description,
						place: a.place,
						tripId: a.trip_id,
						tags: a.tags,
						distance: a.distance,
						durationMinutes: a.duration_minutes,
						deleted: a.deleted
					})
				)
		)
	);

	server.registerTool(
		'create_trip',
		{
			title: 'Create a trip',
			description: 'Create a trip to group several days (e.g. "Seattle truck run, Nov 2026").',
			inputSchema: {
				name: z.string().min(1).max(200),
				description: z.string().max(5000).optional(),
				start_date: date.optional(),
				end_date: date.optional()
			},
			annotations: { readOnlyHint: false, destructiveHint: false }
		},
		guard('write', async (a: { name: string; description?: string; start_date?: string; end_date?: string }) =>
			ok(await createTrip(uid, { name: a.name, description: a.description, startDate: a.start_date, endDate: a.end_date }))
		)
	);

	return server;
}
