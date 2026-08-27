import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Create a postgres.js connection and a Drizzle instance bound to it.
 *
 * `prepare: false` is required for Neon / pooled connection strings
 * (PgBouncer-style pools do not support prepared statements).
 */
export function createDb(url: string): { sql: postgres.Sql; db: Database } {
	const sql = postgres(url, {
		prepare: false,
		max: 10,
		idle_timeout: 30,
		connect_timeout: 10,
	});
	return { sql, db: drizzle(sql, { schema }) };
}
