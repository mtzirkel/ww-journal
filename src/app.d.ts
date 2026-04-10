declare global {
	namespace App {
		interface Locals {
			user?: {
				id: string;
				username: string;
				isAdmin: boolean;
				apps: Array<{ slug: string; name: string; role: string }>;
			};
		}
	}
}

export {};
