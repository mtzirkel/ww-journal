/**
 * RFC 9728 protected resource metadata. Served at both
 * /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/mcp
 * (MCP clients try the path-suffixed form first).
 */
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { mcpResourceUrl } from '$lib/server/auth.js';

export const GET: RequestHandler = async ({ url, params }) => {
	if (params.rest && params.rest !== 'mcp') return new Response('Not found', { status: 404 });
	const body = {
		resource: mcpResourceUrl(url.origin),
		authorization_servers: [env.AUTH_URL || 'http://localhost:5173'],
		scopes_supported: ['read', 'write'],
		bearer_methods_supported: ['header'],
		resource_name: 'Whitewater Journal',
		resource_documentation: 'https://github.com/mtzirkel/ww-journal#connect-your-agent'
	};
	return new Response(JSON.stringify(body), {
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'public, max-age=3600',
			'Access-Control-Allow-Origin': '*'
		}
	});
};
