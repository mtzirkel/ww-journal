import postgres from 'postgres';
import { env } from '$env/dynamic/private';

function createConnection() {
	const url = env.DATABASE_URL || '';
	// Support Unix socket connections (peer auth, no password)
	if (url.includes('host=') || url.includes('/var/run')) {
		const params = new URLSearchParams(url.replace(/^postgres:\/\/\?/, ''));
		return postgres({
			host: params.get('host') || '/var/run/postgresql',
			port: parseInt(params.get('port') || '5432'),
			database: params.get('database') || 'ww_journal',
			username: params.get('user') || undefined,
			onnotice: () => {}
		});
	}
	return postgres(url, { onnotice: () => {} });
}

export const sql = createConnection();
