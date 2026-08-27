import { Hono } from "hono";

/** Health-check route: GET /health -> {"status":"ok"} */
export function healthRoutes(): Hono {
	const app = new Hono();

	app.get("/health", (c) => c.json({ status: "ok" }));

	return app;
}
