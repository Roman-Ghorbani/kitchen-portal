CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`slot_id` text NOT NULL,
	`member_id` text NOT NULL,
	`status` text DEFAULT 'assigned' NOT NULL,
	`covered_by_member_id` text,
	`multiplier` real DEFAULT 1 NOT NULL,
	`is_makeup` integer DEFAULT false NOT NULL,
	`rationale` text,
	`settled_at` integer,
	`points_awarded` real DEFAULT 0 NOT NULL,
	`debt_awarded` integer DEFAULT 0 NOT NULL,
	`settled_recipient_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`slot_id`) REFERENCES `slots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`covered_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`settled_recipient_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `assignments_member_idx` ON `assignments` (`member_id`);--> statement-breakpoint
CREATE INDEX `assignments_slot_idx` ON `assignments` (`slot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assignments_slot_member_unique` ON `assignments` (`slot_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`actor_member_id` text,
	`actor_name` text,
	`summary` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `events_entity_idx` ON `events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `events_actor_idx` ON `events` (`actor_member_id`);--> statement-breakpoint
CREATE INDEX `events_created_idx` ON `events` (`created_at`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`class_year` text NOT NULL,
	`points` real DEFAULT 0 NOT NULL,
	`makeup_debt` integer DEFAULT 0 NOT NULL,
	`exempt` integer DEFAULT false NOT NULL,
	`exempt_reason` text,
	`exempt_notes` text,
	`pin_hash` text,
	`last_served_date` text,
	`slack_user_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `members_year_idx` ON `members` (`class_year`);--> statement-breakpoint
CREATE INDEX `members_priority_idx` ON `members` (`points`,`last_served_date`);--> statement-breakpoint
CREATE TABLE `semesters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`meal_days` text NOT NULL,
	`slot_sizes` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slots` (
	`id` text PRIMARY KEY NOT NULL,
	`week_id` text NOT NULL,
	`date` text NOT NULL,
	`meal` text NOT NULL,
	`size` integer NOT NULL,
	`cover_bounty` real DEFAULT 1 NOT NULL,
	FOREIGN KEY (`week_id`) REFERENCES `weeks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slots_week_date_meal_unique` ON `slots` (`week_id`,`date`,`meal`);--> statement-breakpoint
CREATE INDEX `slots_date_idx` ON `slots` (`date`);--> statement-breakpoint
CREATE TABLE `standing_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`semester_id` text NOT NULL,
	`day_index` integer NOT NULL,
	`note` text,
	`scope` text DEFAULT 'semester' NOT NULL,
	`expires_on` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`semester_id`) REFERENCES `semesters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `standing_conflict_unique` ON `standing_conflicts` (`member_id`,`semester_id`,`day_index`);--> statement-breakpoint
CREATE TABLE `weeks` (
	`id` text PRIMARY KEY NOT NULL,
	`semester_id` text NOT NULL,
	`week_start` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`seed` text NOT NULL,
	`posted_at` integer,
	`locks_at` integer,
	`locked_at` integer,
	`is_bootstrap` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`semester_id`) REFERENCES `semesters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weeks_semester_start_unique` ON `weeks` (`semester_id`,`week_start`);