CREATE TABLE `late_plate_meal_defaults` (
	`id` text PRIMARY KEY NOT NULL,
	`meal` text NOT NULL,
	`cutoff` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `late_plate_meal_defaults_meal_unique` ON `late_plate_meal_defaults` (`meal`);
