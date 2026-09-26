CREATE TYPE "plan_state" AS ENUM('collecting', 'blocked', 'proposed', 'locked');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guest_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"account_id" text NOT NULL,
	"distinguisher" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_plan_id_account_id_unique" UNIQUE("plan_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "link_session_plans" (
	"link_session_id" text NOT NULL,
	"plan_id" text NOT NULL,
	CONSTRAINT "link_session_plans_pk" PRIMARY KEY("link_session_id","plan_id")
);
--> statement-breakpoint
CREATE TABLE "link_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "link_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"account_id" text,
	"guest_session_id" text,
	"display_name" text NOT NULL,
	"distinguisher" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_account_xor_guest" CHECK ((account_id IS NULL) <> (guest_session_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "plan_options" (
	"id" text PRIMARY KEY NOT NULL,
	"step_id" text NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"position" integer NOT NULL,
	"local_date" date NOT NULL,
	"start_local" text NOT NULL,
	"end_local" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"organizer_account_id" text NOT NULL,
	"title" text NOT NULL,
	"timezone" text NOT NULL,
	"budget_amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"threshold" integer NOT NULL,
	"answered_count" integer DEFAULT 0 NOT NULL,
	"state" "plan_state" NOT NULL,
	"join_token" text NOT NULL,
	"attempt_lock" boolean DEFAULT false NOT NULL,
	"attempt_lock_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	CONSTRAINT "plans_join_token_unique" UNIQUE("join_token")
);
--> statement-breakpoint
CREATE TABLE "proposal_alternatives" (
	"proposal_id" text NOT NULL,
	"step_id" text NOT NULL,
	"position" integer NOT NULL,
	"google_place_id" text NOT NULL,
	CONSTRAINT "proposal_alternatives_pk" PRIMARY KEY("proposal_id","step_id","position")
);
--> statement-breakpoint
CREATE TABLE "proposal_candidates" (
	"proposal_id" text NOT NULL,
	"step_id" text NOT NULL,
	"google_place_id" text NOT NULL,
	"place_name" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	CONSTRAINT "proposal_candidates_pk" PRIMARY KEY("proposal_id","step_id","google_place_id")
);
--> statement-breakpoint
CREATE TABLE "proposal_cohort" (
	"proposal_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"attending" boolean NOT NULL,
	CONSTRAINT "proposal_cohort_pk" PRIMARY KEY("proposal_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "proposal_legs" (
	"proposal_id" text NOT NULL,
	"from_step_id" text NOT NULL,
	"to_step_id" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	CONSTRAINT "proposal_legs_pk" PRIMARY KEY("proposal_id","from_step_id","to_step_id")
);
--> statement-breakpoint
CREATE TABLE "proposal_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"block_time" boolean NOT NULL,
	"block_budget" boolean NOT NULL,
	"block_venue_data" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_steps" (
	"proposal_id" text NOT NULL,
	"step_id" text NOT NULL,
	"option_id" text NOT NULL,
	"google_place_id" text NOT NULL,
	"place_name" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "proposal_steps_pk" PRIMARY KEY("proposal_id","step_id")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"local_date" date NOT NULL,
	"local_time" text NOT NULL,
	"fairness_warning" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_plan_id_unique" UNIQUE("plan_id")
);
--> statement-breakpoint
CREATE TABLE "response_picks" (
	"participant_id" text NOT NULL,
	"step_id" text NOT NULL,
	"option_id" text NOT NULL,
	CONSTRAINT "response_picks_pk" PRIMARY KEY("participant_id","step_id")
);
--> statement-breakpoint
CREATE TABLE "response_windows" (
	"participant_id" text NOT NULL,
	"window_id" text NOT NULL,
	"kind" text NOT NULL,
	"earliest_local" text,
	"latest_local" text,
	CONSTRAINT "response_windows_pk" PRIMARY KEY("participant_id","window_id"),
	CONSTRAINT "response_windows_kind" CHECK (kind IN ('busy', 'free'))
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"participant_id" text PRIMARY KEY NOT NULL,
	"start_google_place_id" text,
	"start_name" text,
	"start_lat" double precision,
	"start_lng" double precision,
	"complete" boolean NOT NULL,
	"first_completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "step_signals" (
	"proposal_id" text NOT NULL,
	"step_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"signal" text NOT NULL,
	CONSTRAINT "step_signals_pk" PRIMARY KEY("proposal_id","step_id","participant_id"),
	CONSTRAINT "step_signals_signal" CHECK (signal IN ('like', 'dislike'))
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_session_plans" ADD CONSTRAINT "link_session_plans_link_session_id_link_sessions_id_fk" FOREIGN KEY ("link_session_id") REFERENCES "link_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_session_plans" ADD CONSTRAINT "link_session_plans_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_options" ADD CONSTRAINT "plan_options_step_id_plan_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "plan_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_windows" ADD CONSTRAINT "plan_windows_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_organizer_account_id_accounts_id_fk" FOREIGN KEY ("organizer_account_id") REFERENCES "accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_alternatives" ADD CONSTRAINT "proposal_alternatives_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_alternatives" ADD CONSTRAINT "proposal_alternatives_step_id_plan_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "plan_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_candidates" ADD CONSTRAINT "proposal_candidates_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_candidates" ADD CONSTRAINT "proposal_candidates_step_id_plan_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "plan_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_cohort" ADD CONSTRAINT "proposal_cohort_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_cohort" ADD CONSTRAINT "proposal_cohort_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_legs" ADD CONSTRAINT "proposal_legs_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_legs" ADD CONSTRAINT "proposal_legs_from_step_id_plan_steps_id_fk" FOREIGN KEY ("from_step_id") REFERENCES "plan_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_legs" ADD CONSTRAINT "proposal_legs_to_step_id_plan_steps_id_fk" FOREIGN KEY ("to_step_id") REFERENCES "plan_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_runs" ADD CONSTRAINT "proposal_runs_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_steps" ADD CONSTRAINT "proposal_steps_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_steps" ADD CONSTRAINT "proposal_steps_step_id_plan_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "plan_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_steps" ADD CONSTRAINT "proposal_steps_option_id_plan_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "plan_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_picks" ADD CONSTRAINT "response_picks_participant_id_responses_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "responses"("participant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_picks" ADD CONSTRAINT "response_picks_step_id_plan_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "plan_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_picks" ADD CONSTRAINT "response_picks_option_id_plan_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "plan_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_windows" ADD CONSTRAINT "response_windows_participant_id_responses_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "responses"("participant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_windows" ADD CONSTRAINT "response_windows_window_id_plan_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "plan_windows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_signals" ADD CONSTRAINT "step_signals_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_signals" ADD CONSTRAINT "step_signals_step_id_plan_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "plan_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_signals" ADD CONSTRAINT "step_signals_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participants_plan_id_account_id_uidx" ON "participants" USING btree ("plan_id","account_id") WHERE account_id IS NOT NULL;