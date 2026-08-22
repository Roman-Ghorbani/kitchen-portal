ALTER TABLE "assignments" ADD COLUMN "points_awarded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "debt_awarded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "settled_recipient_id" uuid;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_settled_recipient_id_members_id_fk" FOREIGN KEY ("settled_recipient_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;