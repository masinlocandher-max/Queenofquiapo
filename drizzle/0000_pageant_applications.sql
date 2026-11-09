CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reference` text NOT NULL,
	`request_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`storage_key` text NOT NULL,
	`submitted_at` text NOT NULL,
	`legal_name` text NOT NULL,
	`female_name` text NOT NULL,
	`email` text NOT NULL,
	`mobile` text NOT NULL,
	`locality` text NOT NULL,
	`height_cm` real NOT NULL,
	`bust_in` real NOT NULL,
	`waist_in` real NOT NULL,
	`hips_in` real NOT NULL,
	`talent` text NOT NULL,
	`experience` text NOT NULL,
	`motivation` text NOT NULL,
	`consent_version` text NOT NULL,
	`portrait_type` text NOT NULL,
	`swimsuit_type` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_reference` ON `applications` (`reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `applications_request_key` ON `applications` (`request_key`);