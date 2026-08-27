import { z } from "zod";

/**
 * Runtime environment configuration.
 *
 * Secrets (e.g. DATABASE_URL) are parsed here but NEVER stringified into
 * error messages or logs. Validation failures report only the variable name
 * and what was wrong, never the value that failed validation.
 */

export type NodeEnv = "development" | "production" | "test";

const databaseUrlSchema = z
	.string()
	.min(1, "DATABASE_URL is required")
	.refine((value) => {
		try {
			const url = new URL(value);
			return (
				url.protocol === "postgresql:" || url.protocol === "postgres:"
			);
		} catch {
			return false;
		}
	}, "DATABASE_URL must be a valid PostgreSQL connection string");

const envSchema = z.object({
	DATABASE_URL: databaseUrlSchema,
	HOST: z.string().min(1).default("127.0.0.1"),
	PORT: z.coerce
		.number()
		.int("PORT must be an integer")
		.min(1, "PORT must be between 1 and 65535")
		.max(65535, "PORT must be between 1 and 65535")
		.default(3000),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
});

export type Env = z.infer<typeof envSchema>;

/** Thrown when environment validation fails; message lists issues without values. */
export class EnvValidationError extends Error {
	constructor(issues: { path: string; message: string }[]) {
		const lines = issues.map(
			(issue) => `- ${issue.path}: ${issue.message}`,
		);
		super(`Invalid environment configuration:\n${lines.join("\n")}`);
		this.name = "EnvValidationError";
	}
}

function toIssueList(error: z.ZodError): { path: string; message: string }[] {
	return error.issues.map((issue) => ({
		path: issue.path.join(".") || "(root)",
		message: issue.message,
	}));
}

/**
 * Parse and validate environment variables from the given source
 * (defaults to process.env). Fails fast with a clear, secret-free message.
 */
export function loadEnv(
	source: Record<string, string | undefined> = process.env,
): Env {
	const result = envSchema.safeParse(source);
	if (!result.success) {
		throw new EnvValidationError(toIssueList(result.error));
	}
	return result.data;
}
