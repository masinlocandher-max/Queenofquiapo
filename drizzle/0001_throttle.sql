CREATE TABLE qoq_throttle (id TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL, hits INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX qoq_throttle_expiry ON qoq_throttle(expires_at);
