CREATE TABLE `recurring_late_plates` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`day_of_week` integer NOT NULL,
	`meal` text NOT NULL,
	`note` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_late_plates_member_day_meal_unique` ON `recurring_late_plates` (`member_id`,`day_of_week`,`meal`);--> statement-breakpoint
CREATE INDEX `recurring_late_plates_member_idx` ON `recurring_late_plates` (`member_id`);