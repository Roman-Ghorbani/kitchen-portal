ALTER TABLE "assignments" ALTER COLUMN "multiplier" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "multiplier" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "points_awarded" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "members" ALTER COLUMN "points" SET DATA TYPE double precision;