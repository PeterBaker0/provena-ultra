-- Full text search support over the application-maintained search_text column.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS item_search_fts_idx ON "item" USING GIN (to_tsvector('english', coalesce(search_text, '')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS item_search_trgm_idx ON "item" USING GIN (search_text gin_trgm_ops);
