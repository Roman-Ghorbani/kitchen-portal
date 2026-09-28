CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_throttle` (
	`key` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_failure_at` integer
);
--> statement-breakpoint
CREATE TABLE `enrollment_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `enrollment_codes_member_idx` ON `enrollment_codes` (`member_id`);--> statement-breakpoint
CREATE TABLE `kiosk_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`pairing_code_hash` text,
	`pairing_expires_at` integer,
	`secret_hash` text,
	`paired_at` integer,
	`last_seen_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `menus` (
	`date` text PRIMARY KEY NOT NULL,
	`lunch` text NOT NULL,
	`dinner` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `events` ADD `actor_role` text;--> statement-breakpoint
CREATE INDEX `events_action_idx` ON `events` (`action`);--> statement-breakpoint
ALTER TABLE `members` ADD `session_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Menus used to live inside the TV console's JSON blob (tv_settings), which
-- 0012 drops. Move every day that has anything on it into its own row.
INSERT INTO `menus` (`date`, `lunch`, `dinner`, `updated_at`)
SELECT m.`key`,
       coalesce(json_extract(m.`value`, '$.lunch'), '[]'),
       coalesce(json_extract(m.`value`, '$.dinner'), '[]'),
       unixepoch()
FROM `tv_settings` t, json_each(t.`config`, '$.menus') m
WHERE m.`key` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
--> statement-breakpoint
-- The Senior Week menu password used to live inside the TV console's JSON blob,
-- which 0012 drops. Carry it across marked `plain`; lib/senior-menu-auth.ts
-- re-hashes it with scrypt the first time somebody signs in with it.
INSERT INTO `app_settings` (`key`, `value`, `updated_at`)
SELECT 'seniorMenu.passwordHash',
       json_quote('plain$' || json_extract(`config`, '$.seniorMenuPassword')),
       unixepoch()
FROM `tv_settings`
WHERE json_extract(`config`, '$.seniorMenuPassword') IS NOT NULL
  AND trim(json_extract(`config`, '$.seniorMenuPassword')) <> ''
LIMIT 1;
--> statement-breakpoint
-- Backfill who-acted for the history written before actor_role existed. From
-- here on every writer sets it explicitly.
UPDATE `events` SET `actor_role` = CASE
  WHEN `actor_member_id` IS NOT NULL THEN 'brother'
  WHEN `actor_name` LIKE 'Kitchen tablet%' OR `actor_name` LIKE 'Chef%' THEN 'kiosk'
  WHEN `actor_name` IS NULL OR `actor_name` = 'scheduler' OR `actor_name` LIKE '%smoke%' THEN 'system'
  ELSE 'manager'
END
WHERE `actor_role` IS NULL;
