import { Hono } from "hono";
import { healthRoutes } from "./routes/health";

/**
 * Build the Hono application.
 *
 * Route handlers stay thin; domain behavior lives in services/modules.
 * Future API surfaces are versioned under /v1 per AGENTS.md.
 */
export function createApp(): Hono {
	const app = new Hono();

	app.route("/", healthRoutes());

	// Stable machine-readable errors (AGENTS.md §6):
	app.notFound((c) =>
		c.json(
			{ error: { code: "NOT_FOUND", message: "Resource not found" } },
			404,
		),
	);

	app.onError((_error, c) =>
		c.json(
			{
				error: {
					code: "INTERNAL_SERVER_ERROR",
					message: "Internal server error",
				},
			},
			500,
		),
	);

	// Future versioned API surface:
	// app.route("/v1", ...)

	return app;
}


