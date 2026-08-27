import { afterEach, describe, expect, it } from "vitest";
import { EnvValidationError, loadEnv } from "./env";

const BASE_ENV = {
	DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/agent_defaults",
};

function envWith(
	extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
	return {
		...process.env,
		...BASE_ENV,
		HOST: undefined,
		PORT: undefined,
		NODE_ENV: undefined,
		...extra,
	};
}

describe("loadEnv", () => {
	afterEach(() => {
		delete process.env.DATABASE_URL;
		delete process.env.HOST;
		delete process.env.PORT;
		delete process.env.NODE_ENV;
	});

	it("applies defaults for optional variables", () => {
		const env = loadEnv(envWith());

		expect(env.DATABASE_URL).toBe(BASE_ENV.DATABASE_URL);
		expect(env.HOST).toBe("127.0.0.1");
		expect(env.PORT).toBe(3000);
		expect(env.NODE_ENV).toBe("development");
	});

	it("accepts valid postgres and postgresql URL schemes", () => {
		expect(() =>
			loadEnv(envWith({ DATABASE_URL: "postgres://u:p@db.internal:5432/x" })),
		).not.toThrow();
	});

	it.each([
		["missing DATABASE_URL", { DATABASE_URL: undefined }],
		["empty DATABASE_URL", { DATABASE_URL: "" }],
		["non-postgres scheme", { DATABASE_URL: "mysql://user:pass@host/db" }],
		["garbage value", { DATABASE_URL: "not-a-connection-string" }],
	])("rejects %s", (_label, overrides) => {
		expect(() => loadEnv(envWith(overrides))).toThrow(EnvValidationError);
	});

	it("never leaks the failing DATABASE_URL value in the error", () => {
		const secret = "postgresql://user:supersecret@localhost:5432/db";

		let thrown: unknown;
		try {
			loadEnv(envWith({ DATABASE_URL: secret.replace("postgresql:", "mysql:") }));
			thrown = null;
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(EnvValidationError);
		const message =
			thrown instanceof Error ? thrown.message : String(thrown);
		expect(message).not.toContain(secret);
		expect(message).not.toContain("supersecret");
		expect(message).not.toContain("localhost:5432/db");
		expect(message.toLowerCase()).toContain("database_url");
	});

	it("rejects non-numeric PORT", () => {
		expect(() =>
			loadEnv(envWith({ PORT: "three-thousand" })),
		).toThrow(EnvValidationError);
	});

	it("rejects out-of-range PORT", () => {
		expect(() => loadEnv(envWith({ PORT: "70000" }))).toThrow(
			EnvValidationError,
		);
	});

	it("coerces numeric PORT strings and accepts enum NODE_ENV values", () => {
		const env = loadEnv(envWith({ PORT: "8080", NODE_ENV: "production" }));

		expect(env.PORT).toBe(8080);
		expect(env.NODE_ENV).toBe("production");
	});

	it("rejects invalid NODE_ENV values", () => {
		expect(() =>
			loadEnv(envWith({ NODE_ENV: "staging" })),
		).toThrow(EnvValidationError);
	});

	it("validates against arbitrary source objects, not just process.env", () => {
		const env = loadEnv({
			DATABASE_URL:
				"postgresql://tester:not-printed@example.test:5432/testdb",
			PORT: "4000",
		});

		expect(env.HOST).toBe("127.0.0.1");
		expect(env.PORT).toBe(4000);
	});
});
