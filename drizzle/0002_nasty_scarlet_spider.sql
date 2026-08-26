ALTER TABLE `late_plates` ADD `flags` text;--> statement-breakpoint
ALTER TABLE `late_plates` ADD `flags_other` text;--> statement-breakpoint
ALTER TABLE `late_plates` ADD `acknowledged_at` integer;--> statement-breakpoint
ALTER TABLE `late_plates` ADD `acknowledged_by` text;--> statement-breakpoint
ALTER TABLE `members` ADD `dietary_flags` text;--> statement-breakpoint
ALTER TABLE `members` ADD `dietary_other` text;
