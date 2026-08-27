import { describe, expect, it } from "vitest";
import { createApp } from "../app";

describe("GET /health", () => {
	it("returns 200 with {\"status\":\"ok\"} JSON", async () => {
		const app = createApp();

		const response = await app.request("/health");

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain(
			"application/json",
		);
		expect(await response.json()).toEqual({ status: "ok" });
	});

	it("returns a machine-readable JSON error for unknown routes", async () => {
		const app = createApp();

		const response = await app.request("/nope");

		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain(
			"application/json",
		);
		expect(await response.json()).toEqual({
			error: { code: "NOT_FOUND", message: "Resource not found" },
		});
	});
});
