CREATE TYPE "public"."assignment_status" AS ENUM('assigned', 'flagged', 'covered', 'no-show', 'excused');--> statement-breakpoint
CREATE TYPE "public"."class_year" AS ENUM('sophomore', 'junior');--> statement-breakpoint
CREATE TYPE "public"."conflict_scope" AS ENUM('semester', 'temporary');--> statement-breakpoint
CREATE TYPE "public"."exempt_reason" AS ENUM('officer', 'medical', 'off-campus', 'other');--> statement-breakpoint
CREATE TYPE "public"."meal" AS ENUM('lunch', 'dinner');--> statement-breakpoint
CREATE TYPE "public"."week_status" AS ENUM('draft', 'posted', 'locked', 'complete');--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "assignment_status" DEFAULT 'assigned' NOT NULL,
	"covered_by_member_id" uuid,
	"multiplier" integer DEFAULT 1 NOT NULL,
	"is_makeup" boolean DEFAULT false NOT NULL,
	"rationale" jsonb,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"actor_member_id" uuid,
	"actor_name" text,
	"summary" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"class_year" "class_year" NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"makeup_debt" integer DEFAULT 0 NOT NULL,
	"exempt" boolean DEFAULT false NOT NULL,
	"exempt_reason" "exempt_reason",
	"exempt_notes" text,
	"pin_hash" text,
	"last_served_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semesters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"meal_days" jsonb NOT NULL,
	"slot_sizes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_id" uuid NOT NULL,
	"date" date NOT NULL,
	"meal" "meal" NOT NULL,
	"size" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standing_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"day_index" integer NOT NULL,
	"note" text,
	"scope" "conflict_scope" DEFAULT 'semester' NOT NULL,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"semester_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" "week_status" DEFAULT 'draft' NOT NULL,
	"seed" text NOT NULL,
	"posted_at" timestamp with time zone,
	"locks_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"is_bootstrap" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_covered_by_member_id_members_id_fk" FOREIGN KEY ("covered_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_conflicts" ADD CONSTRAINT "standing_conflicts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_conflicts" ADD CONSTRAINT "standing_conflicts_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_member_idx" ON "assignments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "assignments_slot_idx" ON "assignments" USING btree ("slot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_slot_member_unique" ON "assignments" USING btree ("slot_id","member_id");--> statement-breakpoint
CREATE INDEX "events_entity_idx" ON "events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "events_actor_idx" ON "events" USING btree ("actor_member_id");--> statement-breakpoint
CREATE INDEX "events_created_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "members_year_idx" ON "members" USING btree ("class_year");--> statement-breakpoint
CREATE INDEX "members_priority_idx" ON "members" USING btree ("points","last_served_date");--> statement-breakpoint
CREATE UNIQUE INDEX "slots_week_date_meal_unique" ON "slots" USING btree ("week_id","date","meal");--> statement-breakpoint
CREATE INDEX "slots_date_idx" ON "slots" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "standing_conflict_unique" ON "standing_conflicts" USING btree ("member_id","semester_id","day_index");--> statement-breakpoint
CREATE UNIQUE INDEX "weeks_semester_start_unique" ON "weeks" USING btree ("semester_id","week_start");