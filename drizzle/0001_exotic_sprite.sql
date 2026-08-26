CREATE TABLE `late_plate_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`meal` text NOT NULL,
	`cutoff` text,
	`closed` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `late_plate_settings_date_meal_unique` ON `late_plate_settings` (`date`,`meal`);--> statement-breakpoint
CREATE TABLE `late_plates` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`date` text NOT NULL,
	`meal` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`note` text,
	`reason` text,
	`requested_at` integer NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `late_plates_member_meal_unique` ON `late_plates` (`member_id`,`date`,`meal`);--> statement-breakpoint
CREATE INDEX `late_plates_date_idx` ON `late_plates` (`date`,`meal`);
