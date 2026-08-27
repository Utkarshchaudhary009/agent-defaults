import { pgTable, text } from "drizzle-orm/pg-core";

/**
 * Phase 1 placeholder schema.
 *
 * This table exists only so the migration toolchain (`drizzle-kit generate`
 * + `drizzle-kit migrate`) has a concrete artifact to emit and apply end to
 * end. It is infrastructure metadata — not domain data. Phase 2 will replace
 * or extend this file with the real core data model.
 */
export const schemaMeta = pgTable("schema_meta", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});
