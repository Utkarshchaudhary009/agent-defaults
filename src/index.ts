import { serve } from "bun";
import { createApp } from "./app";
import { EnvValidationError, loadEnv } from "./config/env";

try {
	const env = loadEnv();
	const server = serve({
		hostname: env.HOST,
		port: env.PORT,
		fetch: createApp().fetch,
	});
	console.log(`Server listening on http://${server.hostname}:${server.port}`);
} catch (error) {
	if (error instanceof EnvValidationError) {
		// Fail fast; message lists issues without leaking secret values.
		console.error(error.message);
		process.exit(1);
	}
	throw error;
}

