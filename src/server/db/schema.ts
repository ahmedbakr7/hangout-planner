import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const planStateEnum = pgEnum("plan_state", [
  "collecting",
  "blocked",
  "proposed",
  "locked",
]);

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

const moneyMinor = (name: string) => bigint(name, { mode: "number" });

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamptz("expires_at").notNull(),
});

export const guestSessions = pgTable("guest_sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamptz("expires_at").notNull(),
});

export const linkSessions = pgTable("link_sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamptz("expires_at").notNull(),
});

export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  organizerAccountId: text("organizer_account_id")
    .notNull()
    .references(() => accounts.id),
  title: text("title").notNull(),
  timezone: text("timezone").notNull(),
  budgetAmountMinor: moneyMinor("budget_amount_minor").notNull(),
  currency: text("currency").notNull(),
  threshold: integer("threshold").notNull(),
  answeredCount: integer("answered_count").notNull().default(0),
  state: planStateEnum("state").notNull(),
  joinToken: text("join_token").notNull().unique(),
  attemptLock: boolean("attempt_lock").notNull().default(false),
  attemptLockAt: timestamptz("attempt_lock_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  lockedAt: timestamptz("locked_at"),
});

export const planWindows = pgTable("plan_windows", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id),
  position: integer("position").notNull(),
  localDate: date("local_date", { mode: "string" }).notNull(),
  startLocal: text("start_local").notNull(),
  endLocal: text("end_local").notNull(),
});

export const planSteps = pgTable("plan_steps", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id),
  position: integer("position").notNull(),
  name: text("name").notNull(),
});

export const planOptions = pgTable("plan_options", {
  id: text("id").primaryKey(),
  stepId: text("step_id")
    .notNull()
    .references(() => planSteps.id),
  position: integer("position").notNull(),
  label: text("label").notNull(),
});

export const participants = pgTable(
  "participants",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    accountId: text("account_id").references(() => accounts.id),
    guestSessionId: text("guest_session_id").references(() => guestSessions.id),
    displayName: text("display_name").notNull(),
    distinguisher: text("distinguisher").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "participants_account_xor_guest",
      sql`(account_id IS NULL) <> (guest_session_id IS NULL)`,
    ),
    uniqueIndex("participants_plan_id_account_id_uidx")
      .on(t.planId, t.accountId)
      .where(sql`account_id IS NOT NULL`),
  ],
);

export const responses = pgTable("responses", {
  participantId: text("participant_id")
    .primaryKey()
    .references(() => participants.id),
  startGooglePlaceId: text("start_google_place_id"),
  startName: text("start_name"),
  startLat: doublePrecision("start_lat"),
  startLng: doublePrecision("start_lng"),
  complete: boolean("complete").notNull(),
  firstCompletedAt: timestamptz("first_completed_at"),
});

export const responseWindows = pgTable(
  "response_windows",
  {
    participantId: text("participant_id")
      .notNull()
      .references(() => responses.participantId),
    windowId: text("window_id")
      .notNull()
      .references(() => planWindows.id),
    kind: text("kind").notNull(),
    earliestLocal: text("earliest_local"),
    latestLocal: text("latest_local"),
  },
  (t) => [
    primaryKey({
      name: "response_windows_pk",
      columns: [t.participantId, t.windowId],
    }),
    check(
      "response_windows_kind",
      sql`kind IN ('busy', 'free')`,
    ),
  ],
);

export const responsePicks = pgTable(
  "response_picks",
  {
    participantId: text("participant_id")
      .notNull()
      .references(() => responses.participantId),
    stepId: text("step_id")
      .notNull()
      .references(() => planSteps.id),
    optionId: text("option_id")
      .notNull()
      .references(() => planOptions.id),
  },
  (t) => [
    primaryKey({
      name: "response_picks_pk",
      columns: [t.participantId, t.stepId],
    }),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    distinguisher: text("distinguisher").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("invitations_plan_id_account_id_unique").on(t.planId, t.accountId),
  ],
);

export const linkSessionPlans = pgTable(
  "link_session_plans",
  {
    linkSessionId: text("link_session_id")
      .notNull()
      .references(() => linkSessions.id),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
  },
  (t) => [
    primaryKey({
      name: "link_session_plans_pk",
      columns: [t.linkSessionId, t.planId],
    }),
  ],
);

export const proposalRuns = pgTable("proposal_runs", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id),
  startedAt: timestamptz("started_at").notNull(),
  outcome: text("outcome").notNull(),
  blockTime: boolean("block_time").notNull(),
  blockBudget: boolean("block_budget").notNull(),
  blockVenueData: boolean("block_venue_data").notNull(),
});

export const proposals = pgTable("proposals", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .unique()
    .references(() => plans.id),
  localDate: date("local_date", { mode: "string" }).notNull(),
  localTime: text("local_time").notNull(),
  fairnessWarning: boolean("fairness_warning").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const proposalCohort = pgTable(
  "proposal_cohort",
  {
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposals.id),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id),
    attending: boolean("attending").notNull(),
  },
  (t) => [
    primaryKey({
      name: "proposal_cohort_pk",
      columns: [t.proposalId, t.participantId],
    }),
  ],
);

export const proposalSteps = pgTable(
  "proposal_steps",
  {
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposals.id),
    stepId: text("step_id")
      .notNull()
      .references(() => planSteps.id),
    optionId: text("option_id")
      .notNull()
      .references(() => planOptions.id),
    googlePlaceId: text("google_place_id").notNull(),
    placeName: text("place_name").notNull(),
    amountMinor: moneyMinor("amount_minor").notNull(),
  },
  (t) => [
    primaryKey({
      name: "proposal_steps_pk",
      columns: [t.proposalId, t.stepId],
    }),
  ],
);

export const proposalLegs = pgTable(
  "proposal_legs",
  {
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposals.id),
    fromStepId: text("from_step_id")
      .notNull()
      .references(() => planSteps.id),
    toStepId: text("to_step_id")
      .notNull()
      .references(() => planSteps.id),
    durationSeconds: integer("duration_seconds").notNull(),
  },
  (t) => [
    primaryKey({
      name: "proposal_legs_pk",
      columns: [t.proposalId, t.fromStepId, t.toStepId],
    }),
  ],
);

export const proposalCandidates = pgTable(
  "proposal_candidates",
  {
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposals.id),
    stepId: text("step_id")
      .notNull()
      .references(() => planSteps.id),
    googlePlaceId: text("google_place_id").notNull(),
    placeName: text("place_name").notNull(),
    amountMinor: moneyMinor("amount_minor").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
  },
  (t) => [
    primaryKey({
      name: "proposal_candidates_pk",
      columns: [t.proposalId, t.stepId, t.googlePlaceId],
    }),
  ],
);

export const proposalAlternatives = pgTable(
  "proposal_alternatives",
  {
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposals.id),
    stepId: text("step_id")
      .notNull()
      .references(() => planSteps.id),
    position: integer("position").notNull(),
    googlePlaceId: text("google_place_id").notNull(),
  },
  (t) => [
    primaryKey({
      name: "proposal_alternatives_pk",
      columns: [t.proposalId, t.stepId, t.position],
    }),
  ],
);

export const stepSignals = pgTable(
  "step_signals",
  {
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposals.id),
    stepId: text("step_id")
      .notNull()
      .references(() => planSteps.id),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id),
    signal: text("signal").notNull(),
  },
  (t) => [
    primaryKey({
      name: "step_signals_pk",
      columns: [t.proposalId, t.stepId, t.participantId],
    }),
    check("step_signals_signal", sql`signal IN ('like', 'dislike')`),
  ],
);
