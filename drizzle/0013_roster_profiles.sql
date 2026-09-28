ALTER TABLE `members` ADD `rotation` text DEFAULT 'dinner' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `room` text;--> statement-breakpoint
ALTER TABLE `members` ADD `pledge_class` text;--> statement-breakpoint
ALTER TABLE `members` ADD `manager_notes` text;--> statement-breakpoint
CREATE INDEX `members_rotation_idx` ON `members` (`rotation`);--> statement-breakpoint
-- Until now class year decided the meal: juniors lunch, sophomores dinner.
-- Carry that over as each brother's crew, so nothing about who is drawn for
-- what changes on the day this ships. From here the two are independent.
UPDATE `members` SET `rotation` = CASE `class_year` WHEN 'junior' THEN 'lunch' ELSE 'dinner' END;
