/**
 * Compatibility shim for older MCP clients (spec 2025-03-26) that look for
 * authorization-server metadata on the MCP server's own origin. We relay
 * noegos-auth's metadata verbatim; all endpoints in it are absolute URLs on
 * the auth server, so the client ends up talking to noegos-auth directly.
 */
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

let cached: { body: string; at: number } | null = null;

export const GET: RequestHandler = async ({ fetch }) => {
	const authUrl = env.AUTH_URL || 'http://localhost:5173';
	if (!cached || Date.now() - cached.at > 3600_000) {
		const res = await fetch(`${authUrl}/.well-known/oauth-authorization-server`);
		if (!res.ok) return new Response('Authorization server unavailable', { status: 502 });
		cached = { body: await res.text(), at: Date.now() };
	}
	return new Response(cached.body, {
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' }
	});
};
