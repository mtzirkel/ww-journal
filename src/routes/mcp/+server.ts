/**
 * MCP endpoint (Streamable HTTP, stateless, JSON responses).
 * Auth: OAuth 2.1 bearer token from noegos-auth, audience = <origin>/mcp.
 * Unauthenticated requests get 401 + WWW-Authenticate pointing at the
 * protected-resource metadata, which is how MCP clients discover the login.
 */
import type { RequestHandler } from './$types';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { env } from '$env/dynamic/private';
import { verifyAccessToken, mcpResourceUrl, type McpPrincipal } from '$lib/server/auth.js';
import { buildMcpServer } from '$lib/server/mcp.js';

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
	'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id'
};

function unauthorized(origin: string, error?: 'invalid_token' | 'insufficient_scope'): Response {
	const meta = `${origin}/.well-known/oauth-protected-resource/mcp`;
	const parts = [`Bearer resource_metadata="${meta}"`];
	if (error) parts.push(`error="${error}"`);
	return new Response(JSON.stringify({ error: error ?? 'unauthorized', resource_metadata: meta }), {
		status: 401,
		headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': parts.join(', '), ...CORS }
	});
}

async function authenticate(request: Request, url: URL): Promise<McpPrincipal | Response> {
	const header = request.headers.get('authorization') ?? '';
	const m = /^Bearer\s+(.+)$/i.exec(header);
	if (!m) {
		if (env.DEV_BYPASS_AUTH === 'true') {
			return { userId: env.DEV_USER_ID || 'dev-user', username: 'dev', clientId: null, scopes: ['read', 'write'] };
		}
		return unauthorized(url.origin);
	}
	const principal = await verifyAccessToken(m[1].trim(), mcpResourceUrl(url.origin));
	return principal ?? unauthorized(url.origin, 'invalid_token');
}

const handle: RequestHandler = async ({ request, url }) => {
	const auth = await authenticate(request, url);
	if (auth instanceof Response) return auth;

	const server = buildMcpServer(auth);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined, // stateless
		enableJsonResponse: true
	});
	await server.connect(transport);
	try {
		const res = await transport.handleRequest(request);
		const headers = new Headers(res.headers);
		for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
		return new Response(res.body, { status: res.status, headers });
	} finally {
		// stateless: nothing to keep between requests
		void server.close().catch(() => {});
	}
};

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS: RequestHandler = async () => new Response(null, { status: 204, headers: CORS });
