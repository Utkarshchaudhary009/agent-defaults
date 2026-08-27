import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;

if (!url || !/^postgres(ql)?:\/\//.test(url)) {
	throw new Error(
		"DATABASE_URL is not configured; set it in the environment or .env before running drizzle-kit.",
	);
}

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dbCredentials: {
		url,
	},
});
