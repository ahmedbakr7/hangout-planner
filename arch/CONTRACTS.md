# CONTRACTS — slice 001 core plan loop

Accepted with `decisions/ADR-0001-stack.md`. These are the only HTTP routes, tables, and external calls for this slice. There is no public event.

JSON objects use the field names below. Unknown request fields are ignored. Missing required fields are `validation_failed`.

## Error envelope

Every 400, 401, 403, 404, 409, 429, and 503 body is:

```json
{
  "error": {
    "code": "validation_failed",
    "reason": "field_frozen",
    "message": "English log text, not product chrome.",
    "fields": [{ "path": "title", "code": "required" }]
  }
}
```

`fields` is always an array. `reason` is omitted when the code is enough. `message` is for logs. Chrome comes from catalogs keyed by `code`, `reason`, and `fields[].code`.

| HTTP | `code` | `reason` |
|---|---|---|
| 400 | `validation_failed` | omitted |
| 401 | `unauthenticated` | `missing_session` or `bad_credentials` |
| 403 | `forbidden` | `csrf`, `organizer_only`, `not_cohort` |
| 404 | `not_found` | omitted, or `account_not_found` on invite |
| 409 | `conflict` | `email_taken`, `field_frozen`, `plan_locked`, `responses_closed`, `not_proposed`, `not_blocked`, `not_locked`, `attempt_in_progress`, `not_an_alternative`, `route_unavailable`, `organizer_cannot_join`, `cannot_invite_self`, `plan_full` |
| 429 | `rate_limited` | omitted |
| 503 | `upstream` | omitted |

Field codes: `required`, `too_long`, `not_positive`, `below_min`, `above_max`, `end_before_start`, `bad_timezone`, `bad_currency`, `bad_email`, `bad_time`, `outside_window`, `not_one`, `frozen`, `unknown`.

A 404 body is the envelope only. It carries no other plan's title, people, or places.

POST, PUT, PATCH, and DELETE without header `X-HP-Request: 1` return 403 `csrf` and write nothing.

## Identifiers, money, time, text

- Ids are `prefix_` plus 22 lowercase base32 characters: `acc_`, `pln_`, `win_`, `stp_`, `opt_`, `prt_`, `inv_`.
- Join token is `jt_` plus 43 unpadded base64url characters. It is the capability in `/join/{token}`.
- Money on the wire is `{ "amount_minor": <integer>, "currency": "EGP" }`. `amount_minor` is ≥ 1 and ≤ 100000000000. Currency is `EGP`, `USD`, `SAR`, or `AED`, each exponent 2.
- Local dates are `YYYY-MM-DD`. Local times are `HH:MM` (24-hour). A plan time the product shows is `{ "local_date", "local_time", "timezone" }` with an IANA `timezone`. Clients show that wall time and the zone name.
- Text limits after trim: title 1–80, step name 1–60, option label 1–40, display name 1–40. Password is 8–72 characters and is not trimmed. Email is trimmed, lowercased, ≤ 254 characters, one `@`, and a dot in the domain.
- Caps: 1–7 windows, 1–6 steps, 2–4 options per step, threshold 1–100, 100 participants per plan.
- A window is one civil date. `end_local` is strictly after `start_local`. Both are on that date. A window does not cross midnight.
- Display names compare for collision after trim and Unicode casefold. The distinguisher is four characters from `abcdefghjkmnpqrstuvwxyz23456789`, assigned once, unique among participants and pending invitations on that plan.

People lists (`participants`, invitation sent rows, cohort) include `display_name` and `distinguisher`. The UI shows the distinguisher only when another row in that same list has the same display name. Organizer name on a preview is a display name without a distinguisher. No list includes an email, a phone number, or a starting point.

## Authn

| Cookie | Who | Grants |
|---|---|---|
| `hp_session` | account | the account's id |
| `hp_guest` | anonymous participant session | the participants created by this browser |
| `hp_link` | browser that opened a join token | read preview and, when locked, confirmed, for those plans |

Cookies are httpOnly, SameSite=Lax, Path=/, 30-day sliding expiry. `Secure` when `HP_COOKIE_SECURE=1`. The database stores SHA-256 of the cookie token, except the join token on the plan, which is stored so the organizer can keep showing the link.

`GET /v1/me` and the account create/sign-in responses are the only payloads that include the caller's email.

## Authz

Evaluate in this order. The first match wins. Anyone else who asks about a plan gets 404.

1. **Organizer** — `hp_session` account equals `plans.organizer_account_id`.
2. **Participant** — that account has a participant row, or `hp_guest` owns one on this plan.
3. **Invited** — that account has an invitation row.
4. **Link reader** — `hp_link` includes this plan, or the request is to `/v1/join/{token}` with this plan's token.

Organizer actions (create is "any account"): structural edit, invite, swap, retry, lock, organizer plan read. A participant who tries one gets 403 `organizer_only` when they are allowed to know the plan. A stranger gets 404.

The organizing account is never inserted as a participant.

## HTTP

### POST /v1/accounts

Authz: no session required.

```json
{ "email": "nour@example.com", "password": "a-secret-pass", "display_name": "Nour" }
```

201 sets `hp_session` and returns `{ "account": { "id", "email", "display_name" } }`. 409 `email_taken`. 400 on invalid fields. Failure sets no cookie and creates no account.

### POST /v1/sessions

Authz: no session required. Body `{ "email", "password" }`.

200 returns the same account object and sets `hp_session`. Unknown email and wrong password are both 401 `bad_credentials`. No cookie on failure.

### DELETE /v1/sessions

Authz: account, or already signed out. 204 clears `hp_session`. Idempotent.

### GET /v1/me

Authz: account. 200 `{ "account": { "id", "email", "display_name" } }`. 401 `missing_session` otherwise, including a guest-only browser.

### GET /v1/currencies

Authz: account.

```json
{
  "currencies": [
    { "code": "EGP", "exponent": 2 },
    { "code": "USD", "exponent": 2 },
    { "code": "SAR", "exponent": 2 },
    { "code": "AED", "exponent": 2 }
  ]
}
```

### POST /v1/plans

Authz: account. Creates a plan in `collecting` with `answered_count` 0 and a new join token. The caller becomes the organizer, not a participant.

```json
{
  "title": "Thursday in Maadi",
  "timezone": "Africa/Cairo",
  "windows": [{ "local_date": "2026-10-02", "start_local": "18:00", "end_local": "23:00" }],
  "budget": { "amount_minor": 50000, "currency": "EGP" },
  "steps": [{ "name": "Dinner", "options": ["Koshary", "Grills"] }],
  "threshold": 3
}
```

201 returns the organizer plan (below) plus `"join_path": "/join/jt_…"`. 400 identifies each invalid field and creates no row. The create form sends `EGP` unless the organizer picked another listed currency. The timezone is whatever the client sends (the form fills it from the organizer's environment).

### GET /v1/plans

Authz: account. Plans this account organizes, `updated_at` descending, at most 100.

```json
{
  "plans": [
    { "id": "pln_…", "title": "Thursday in Maadi", "answered_count": 1, "threshold": 3, "state": "collecting" }
  ],
  "truncated": false
}
```

Empty is `{ "plans": [], "truncated": false }`. No plan they only joined. No other account's plan.

### GET /v1/plans/{planId}

Authz: organizer. 409 `plan_locked` when locked (the confirmed route is the read). 403 `organizer_only` for a participant, invited account, or link reader.

```json
{
  "id": "pln_…",
  "title": "Thursday in Maadi",
  "state": "collecting",
  "timezone": "Africa/Cairo",
  "windows": [{ "id": "win_…", "local_date": "2026-10-02", "start_local": "18:00", "end_local": "23:00" }],
  "budget": { "amount_minor": 50000, "currency": "EGP" },
  "steps": [{ "id": "stp_…", "name": "Dinner", "options": [{ "id": "opt_…", "label": "Koshary" }] }],
  "threshold": 3,
  "answered_count": 1,
  "in_progress_count": 2,
  "participants": [
    { "id": "prt_…", "display_name": "Nour", "distinguisher": "a3k9", "status": "answered" }
  ],
  "editable": {
    "title": true,
    "timezone": false,
    "windows": false,
    "budget": "raise",
    "currency": false,
    "threshold": "lower",
    "steps": false
  }
}
```

`status` is `answered` or `in_progress`. `in_progress_count` is participants minus `answered_count`. Order is participant `created_at`, then id. No starting points, step picks, or itinerary.

`editable.budget` is `any`, `raise`, or `frozen`. `editable.threshold` is `any`, `lower`, or `frozen`.

| State | Answers | Editable |
|---|---|---|
| `collecting` | 0 | title, timezone, windows, steps, currency; budget `any`; threshold `any` |
| `collecting` | ≥ 1 | title; budget `raise`; threshold `lower`; the rest frozen |
| `blocked` | any | title; budget `raise`; the rest frozen |
| `proposed` | any | title; the rest frozen |

While `collecting`, `answered_count` is below the threshold. The count can sit above the threshold once the plan has left `collecting`.

### PATCH /v1/plans/{planId}

Authz: organizer. Not locked (409 `plan_locked`). Body is any subset of the create fields. Present `windows` replaces every window. Present `steps` replaces every step and option and assigns new ids. Omitted keys stay.

A frozen key, a budget that is not a legal change, a currency change while currency is frozen, or a threshold outside the current mode returns 409 `field_frozen` and writes nothing. `budget: "raise"` requires the same currency and a strictly greater `amount_minor`. `threshold: "lower"` requires an integer ≥ `answered_count` and ≤ the stored threshold. `threshold: "any"` allows any integer 1–100.

200 returns the organizer plan. When this PATCH lowers the threshold onto `answered_count` while `collecting`, or raises the budget while `blocked`, the request then runs a proposal attempt and the returned plan includes the new `state`.

### GET /v1/plans/{planId}/opening

Authz: organizer, participant, or invited account.

```json
{
  "plan_id": "pln_…",
  "next": "respond",
  "preview": null
}
```

`next` is `organizer`, `respond`, `proposal`, `confirmed`, or `join`.

| Caller | State | `next` |
|---|---|---|
| Organizer | not locked | `organizer` |
| Organizer | locked | `confirmed` |
| Participant | `collecting` or `blocked` | `respond` |
| Participant | `proposed` | `proposal` |
| Participant | locked | `confirmed` |
| Invited, not a participant | not locked | `join` |
| Invited, not a participant | locked | `confirmed` |

`preview` is the join preview object when `next` is `join`, otherwise `null`.

### GET /v1/plans/{planId}/invite

Authz: organizer. 409 `plan_locked` when locked.

```json
{
  "join_path": "/join/jt_…",
  "invitations": [
    { "display_name": "Hana", "distinguisher": "k7m2", "status": "invited" }
  ]
}
```

`join_path` is stable for the life of the plan. Status is `invited` (no participant yet), `joined` (participant, response not complete), or `answered` (response complete). One row per account, `created_at` ascending. Sending again does not add a row.

### POST /v1/plans/{planId}/invitations

Authz: organizer. Not locked. Body `{ "email": "hana@example.com" }`.

200 returns the one sent-list row for that account. Creates the invitation when missing, and reuses the participant distinguisher when that account already joined. Does not change `answered_count`.

404 `account_not_found` when no account has that email. 400 when the email shape is invalid. 409 `cannot_invite_self` for the organizer's own email. 409 `plan_locked` when locked. Those failures add no row.

### GET /v1/invitations

Authz: account. Invitations for this account, `created_at` descending, at most 100.

```json
{
  "invitations": [
    { "plan_id": "pln_…", "title": "Thursday in Maadi", "organizer_display_name": "Omar" }
  ],
  "truncated": false
}
```

One row per plan. A second invite does not add a second row.

### GET /v1/join/{token}

Authz: possession of the token. Unknown token is 404. Success attaches the plan to `hp_link`.

Same body shape as opening. Also:

- Organizer of this plan: `next` is `organizer` or `confirmed`. No participant is created.
- This account or this guest session is already a participant: their `next`, no second participant.
- Locked, and the caller is not those: `next` is `confirmed`, `preview` null.
- Otherwise `next` is `join` and `preview` is:

```json
{
  "title": "Thursday in Maadi",
  "organizer_display_name": "Omar",
  "timezone": "Africa/Cairo",
  "windows": [{ "local_date": "2026-10-02", "start_local": "18:00", "end_local": "23:00" }],
  "budget": { "amount_minor": 50000, "currency": "EGP" },
  "step_names": ["Dinner", "Coffee"]
}
```

Preview omits option labels, counts, threshold, statuses, starting points, and any itinerary.

### POST /v1/join/{token}

Authz: the token. 409 `plan_locked` when locked (no participant created). 409 `organizer_cannot_join` when the session is the organizer. 409 `plan_full` when the plan already has 100 participants.

Body is `{ "kind": "account" }` or `{ "kind": "anonymous", "display_name": "Nour" }`.

- `account` requires `hp_session`. 401 `missing_session` otherwise. Display name is the account's display name. If that account is already a participant, 200 returns that participant and creates none.
- `anonymous` requires a display name, 1–40 after trim. It asks for no password. The same `hp_guest` and plan return the existing participant (200). A new guest session creates a new participant (201) even when the display name matches someone else.

```json
{
  "participant": { "id": "prt_…", "display_name": "Nour", "distinguisher": "a3k9" },
  "next": "respond"
}
```

`next` follows the participant row of the opening table. 201 sets or extends `hp_guest`.

### POST /v1/plans/{planId}/join

Authz: invited account that is not yet a participant, or an account that already is (200, same participant). Body `{ "kind": "account" }` only. Anonymous join is the token route. Same 409s as token join for locked, organizer, and full. 201 or 200 uses the account display name. This route does not return the join token.

### GET /v1/plans/{planId}/response

Authz: participant. While `proposed`, 409 `responses_closed`. While `locked`, 409 `plan_locked`. Otherwise 200:

```json
{
  "plan_state": "collecting",
  "budget": { "amount_minor": 50000, "currency": "EGP" },
  "timezone": "Africa/Cairo",
  "windows": [{ "id": "win_…", "local_date": "2026-10-02", "start_local": "18:00", "end_local": "23:00" }],
  "steps": [{ "id": "stp_…", "name": "Dinner", "options": [{ "id": "opt_…", "label": "Koshary" }] }],
  "response": {
    "complete": false,
    "windows": [{ "window_id": "win_…", "kind": "free", "earliest_local": "18:30", "latest_local": "21:00" }],
    "start": null,
    "picks": [{ "step_id": "stp_…", "option_id": "opt_…" }]
  }
}
```

`start` is `null` or `{ "name": "Maadi, Cairo" }`. No coordinates and no place id. The payload has no answered count, threshold, other participants, or other starting points. `kind` is `busy` or `free`. A busy window has no earliest or latest.

### PUT /v1/plans/{planId}/response

Authz: participant. Closed states use the same 409s as GET. The body replaces the caller's draft:

```json
{
  "windows": [{ "window_id": "win_…", "kind": "busy" }],
  "start_place_id": "ChIJ…",
  "picks": [{ "step_id": "stp_…", "option_id": "opt_…" }]
}
```

`start_place_id` may be omitted. A present id is resolved with Place Details. The server stores the place id, `displayName.text`, latitude, and longitude. Coordinates are not returned. Details failure is 503 `upstream` and writes nothing.

A provided window must be valid: the id belongs to this plan, `busy` has no times, `free` has earliest and latest with window start ≤ earliest < latest ≤ window end. A provided pick's option must belong to that step. Anything else is 400 and writes nothing.

The draft is **complete** when every window is present and valid, a start is stored, and every step has exactly one pick. Otherwise it is incomplete.

- Incomplete caller and an incomplete but valid body: 200, `complete: false`, count unchanged.
- Incomplete caller and a complete body: 200, `complete: true`, `first_completion: true` the first time only. That first time increments `answered_count` by one in the same transaction as the write.
- Complete caller and a complete valid body: 200, `complete: true`, `first_completion: false`, count unchanged. The stored answers are replaced.
- Complete caller and a body that is not complete, or any invalid body: 400, the stored complete response stays.

200 body:

```json
{ "complete": true, "first_completion": true, "plan_state": "collecting" }
```

`plan_state` is the state after this request, including an attempt this completion triggered. The body has no answered count and no threshold.

When this first completion makes `answered_count` equal the threshold, the request runs a proposal attempt after the response commits, then returns the resulting `plan_state` (`proposed` or `blocked`). A save while `blocked` does not run an attempt.

### GET /v1/plans/{planId}/place-searches

Authz: participant, and only while `collecting` or `blocked`. Query `q` is 1–80 characters after trim. 400 when missing.

```json
{ "results": [{ "google_place_id": "ChIJ…", "name": "Maadi, Cairo" }] }
```

At most 5 results. Empty `results` is 200. No coordinates and no prices. 30 calls per participant per rolling hour, then 429. Google failure is 503 `upstream`. While `proposed`, 409 `responses_closed`. While `locked`, 409 `plan_locked`. This route is the start search. Venue search is not a public route.

### GET /v1/plans/{planId}/proposal

Authz: organizer while the plan is not locked, or a participant while `proposed`.

Organizer while `collecting`:

```json
{ "state": "collecting", "block": null, "proposal": null }
```

Organizer while `blocked`:

```json
{
  "state": "blocked",
  "block": { "time": false, "budget": true, "venue_data": false },
  "proposal": null
}
```

`block` booleans are always all three. A participant while `collecting` or `blocked` gets 409 `not_proposed`. Locked is 409 `plan_locked` for both.

Organizer while `proposed` gets `block: null` and a proposal. `alternatives`, `like_count`, and `dislike_count` are organizer-only. `my_signal` is omitted.

Cohort participant while `proposed` gets the itinerary, no `alternatives`, no counts, and `my_signal` of `like`, `dislike`, or `unset`.

A joined participant outside the stored cohort gets the same itinerary with no `alternatives`, no counts, and no `my_signal`.

```json
{
  "state": "proposed",
  "block": null,
  "proposal": {
    "time": { "local_date": "2026-10-02", "local_time": "18:30", "timezone": "Africa/Cairo" },
    "attending_count": 2,
    "cohort_size": 3,
    "cohort": [
      { "display_name": "Nour", "distinguisher": "a3k9", "attending": true }
    ],
    "fairness_warning": false,
    "steps": [
      {
        "step_id": "stp_…",
        "name": "Dinner",
        "option_label": "Koshary",
        "place": { "name": "Abu Tarek", "amount_minor": 12000, "currency": "EGP" },
        "like_count": 1,
        "dislike_count": 0,
        "my_signal": "like",
        "alternatives": [
          { "google_place_id": "ChIJ…", "name": "Koshary El Tahrir", "amount_minor": 9000, "currency": "EGP" }
        ]
      }
    ],
    "legs": [{ "from_step_id": "stp_a", "to_step_id": "stp_b", "duration_seconds": 840 }]
  }
}
```

`attending_count` is how many cohort members can make the time. The attendance sentence calls that set everyone only when `attending_count` equals `cohort_size`. That sentence is chrome. Cohort lists every stored member, attending or not. `fairness_warning` true means the warning chrome, which talks about travel time and includes no amount and no currency. `duration_seconds` is an integer ≥ 1. A proposed plan has one leg between each consecutive pair. `alternatives` has 0–3 entries. Zero alternatives means the UI says there is no alternative and the current place stays.

### POST /v1/plans/{planId}/proposal-attempts

Authz: organizer, state `blocked`. Otherwise 409 `not_blocked` or `plan_locked`. Runs an attempt with whoever is complete now. 200 returns the proposal document (organizer shape). 409 `attempt_in_progress` when a run is already in flight. Each run inserts `proposal_runs`. 20 runs per plan per rolling hour; this route then returns 429 and does not change the plan. A completion or budget-raise that finds the hour already full does not call Google, finishes as `venue_data`, and still returns 200 for the write that already committed.

### POST /v1/plans/{planId}/steps/{stepId}/swap

Authz: organizer, state `proposed`. Body `{ "google_place_id": "ChIJ…" }`.

The id must be one of that step's stored alternatives. Otherwise 409 `not_an_alternative` and the proposal stays. Success replaces that step's place, refreshes the legs that touch that step, refreshes `fairness_warning`, deletes signals on that step, and replaces that step's alternatives from the remaining stored pool. The time and the other steps' places stay. Their alternative lists stay. 200 returns the organizer proposal document. Like count and dislike count are 0. A cohort member's `my_signal` on that step is `unset`.

If a touched leg cannot be routed, 409 `route_unavailable` and the previous place, legs, signals, and alternatives stay.

### PUT /v1/plans/{planId}/steps/{stepId}/signal

Authz: a participant who is in the stored cohort, state `proposed`. Others who can know the plan get 403 `not_cohort` (including the organizer and a non-cohort participant). Body `{ "signal": "like" }` with `like`, `dislike`, or `unset`.

200 `{ "signal": "unset" }`. One signal per member per step. `unset` deletes the row. The time, places, and cohort do not change. The response has no counts.

### POST /v1/plans/{planId}/lock

Authz: organizer, state `proposed`. 200 returns the confirmed document and sets state `locked`. `collecting` and `blocked` are 409 `not_proposed`. Already locked is 409 `plan_locked`. There is no unlock route.

### GET /v1/plans/{planId}/confirmed

Authz: organizer, participant, invited account, or link reader. Not locked: 409 `not_locked` for those callers, 404 for anyone else. Locked 200:

```json
{
  "plan_id": "pln_…",
  "title": "Thursday in Maadi",
  "state": "locked",
  "time": { "local_date": "2026-10-02", "local_time": "18:30", "timezone": "Africa/Cairo" },
  "steps": [
    { "step_id": "stp_…", "place_name": "Abu Tarek", "amount_minor": 12000, "currency": "EGP" }
  ],
  "legs": [{ "from_step_id": "stp_a", "to_step_id": "stp_b", "duration_seconds": 840 }],
  "cohort": [{ "display_name": "Nour", "distinguisher": "a3k9" }]
}
```

Omits option labels, signals, starting points, budget editing, threshold, and invite send. Writes of response, swap, signal, or structure while locked return 409 `plan_locked` and leave this outing in place.

## Proposal attempt

Runs only from:

- `PUT` response, when a first completion makes `answered_count` equal the threshold
- `PATCH` plan, when the threshold is lowered onto `answered_count` while `collecting`, or the budget is raised while `blocked`
- `POST` proposal-attempts while `blocked`

The cohort is the set of participants whose response is complete when the run starts. While `proposed`, that set is frozen on the proposal row. A retry while `blocked` takes whoever is complete at the retry. An empty cohort stores no proposal: state `blocked`, `time: true`, `budget: false`, `venue_data: false`, and no Google calls.

The run locks the plan row with `attempt_lock`. The triggering request waits up to 20s to take that lock, then runs. If the lock is still held, the response is 409 `attempt_in_progress`. The triggering write is already committed, so the client refetches the plan. A lock older than 20s may be taken over. `HP_PROPOSAL_ENABLED=0` skips Google and finishes as `venue_data`.

### Time

For each window, instants start at `start_local` and step 15 minutes while the instant is strictly before `end_local`. A member covers an instant when that window is `free` and `earliest_local` ≤ instant ≤ `latest_local`. Busy covers nothing. The chosen time is the earliest instant with the greatest coverage. Coverage 0 is time-blocked: `block.time` true, and no clock time is stored.

Worked grid: window 18:00–19:00 yields 18:00, 18:15, 18:30, 18:45. A free 18:00–18:30 and B free 18:30–19:00 both cover 18:30. That instant is the unique maximum (2) and is the proposal time. A busy member adds no instant.

The attempt still evaluates places when the time is blocked, so time and budget can both be true.

### Places

For each step, rank its labels by cohort pick count descending, then by option position ascending. For a label, call Places `places:searchText` with `textQuery` equal to the stored label, `languageCode` from the organizer's `hp_locale` (`en` if unset), `pageSize` 20, and a circle bias at the centroid of cohort start coordinates. Centroid is the arithmetic mean of latitudes and of longitudes. First radius 15000 meters, and if that returns no eligible place, one more call at 40000 meters.

Soft `regionCode` only, not a hard country filter: `Africa/Cairo` → `EG`, `Asia/Riyadh` → `SA`, `Asia/Dubai` → `AE`, otherwise omit.

Field mask: `places.id,places.displayName,places.location,places.priceRange`.

A place is eligible when it has a location and `priceRange.startPrice` whose `currencyCode` equals the plan currency. The amount is `startPrice` only:

Every v1 currency has exponent 2, so:

`amount_minor = units * 100 + nanos / 10000000`

`units` and `nanos` are integers, `nanos` ≥ 0, and `nanos` is divisible by 10000000. Division is exact integer division. Otherwise the place is dropped. `amount_minor` must be ≥ 1, ≤ the plan budget, and ≤ the money cap. `priceLevel` never qualifies. `endPrice` is ignored.

The first label that yields at least one eligible place is the step's label. That place's option label is that label, including after a later swap. Keep the eligible places closest to the centroid, then by place id, up to 5. Those five are the step's pool and are stored.

No eligible place on any label, after successful searches, sets `block.budget`. A Places error or timeout sets `block.venue_data` and does not claim budget. Both time and budget can be true together. `venue_data` means the other two flags stay false for the parts that did not finish.

### Routes and chain

Skip routing unless time is chosen and every step has a pool. `travelMode` is `DRIVE`, `routingPreference` is `TRAFFIC_UNAWARE`, waypoints are lat/lng. Duration is the returned `duration` floored to integer seconds. A missing status, a condition other than `ROUTE_EXISTS`, or a duration under 1 second drops that combination. Do not store 0.

If the step count is ≤ 4, score every combination of one pool place per step. If the step count is 5 or 6, walk left to right. The first step takes the pool place closest to the centroid. Each later step calls the matrix for the previous chosen place against that step's pool, then takes the smallest duration, tie-break smaller place id.

Member trip `T_i` is seconds from their start to the first place, plus the between-place legs. Median `M`: sort `T` ascending; if the count is odd, the middle value; if even, `(T[n/2 - 1] + T[n/2] + 1) // 2`. Member `i` is unfair when `T_i > M + 1200` and `2 * T_i > 3 * M`. A chain is fair when nobody is unfair.

Prefer a fair chain. Among fair chains, pick the smallest sum of between-place durations, then the lexicographically smallest place-id sequence. If every chain is unfair, pick the smallest (`max(T_i) - M`), then the same place-id tie-break, and set `fairness_warning`. A fair chain stores `fairness_warning` false. Personal `T_i` values are not in the API. If every combination lacks a duration, `block.venue_data` and no proposal.

A full chain stores state `proposed`, the time, the cohort with `attending` per member, each step's place and amount, the legs, and the pool. Alternatives for a step are the other pool places, substituted into the chosen chain, ordered by the same chain key, at most 3.

Worked fairness: trips 600, 720, and 2400 seconds. Median is 720. 2400 > 720 + 1200 and `2 * 2400 > 3 * 720`, so the warning is on. Trips 600 and 720: median `(600 + 720 + 1) // 2` = 660. 720 is not greater than 660 + 1200, so the warning is off.

### Swap pool

Swap does not call Places again. It uses the stored pool. New alternatives for the swapped step are recomputed from that pool excluding the new current place. Other steps' alternative rows stay as stored at proposal time.

## Events

None. Do not add a bus, a websocket, or a domain event for this slice.

## Tables

| Table | Columns |
|---|---|
| `accounts` | id, email unique, password_hash, display_name, created_at |
| `sessions` | id, account_id, token_hash unique, expires_at |
| `plans` | id, organizer_account_id, title, timezone, budget_amount_minor, currency, threshold, answered_count, state, join_token unique, attempt_lock, attempt_lock_at, created_at, updated_at, locked_at |
| `plan_windows` | id, plan_id, position, local_date, start_local, end_local |
| `plan_steps` | id, plan_id, position, name |
| `plan_options` | id, step_id, position, label |
| `participants` | id, plan_id, account_id null, guest_session_id null, display_name, distinguisher, created_at. Exactly one of account_id and guest_session_id. Unique (plan_id, account_id) where account_id is set |
| `guest_sessions` | id, token_hash unique, expires_at |
| `responses` | participant_id pk, start_google_place_id null, start_name null, start_lat null, start_lng null, complete, first_completed_at null |
| `response_windows` | participant_id, window_id, kind, earliest_local null, latest_local null |
| `response_picks` | participant_id, step_id, option_id |
| `invitations` | id, plan_id, account_id, distinguisher, created_at. Unique (plan_id, account_id) |
| `link_sessions` | id, token_hash unique, expires_at |
| `link_session_plans` | link_session_id, plan_id, primary key of both |
| `proposal_runs` | id, plan_id, started_at, outcome, block_time, block_budget, block_venue_data |
| `proposals` | id, plan_id unique, local_date, local_time, fairness_warning, created_at |
| `proposal_cohort` | proposal_id, participant_id, attending |
| `proposal_steps` | proposal_id, step_id, option_id, google_place_id, place_name, amount_minor |
| `proposal_legs` | proposal_id, from_step_id, to_step_id, duration_seconds |
| `proposal_candidates` | proposal_id, step_id, google_place_id, place_name, amount_minor, latitude, longitude |
| `proposal_alternatives` | proposal_id, step_id, position, google_place_id |
| `step_signals` | proposal_id, step_id, participant_id, signal. Signal is `like` or `dislike`. Absent row is unset |

`answered_count` equals the number of responses with `complete` true. `first_completed_at` is set once, when that participant first becomes complete. State `proposed` or `locked` implies one `proposals` row. State `locked` is that stored outing. No delete route and no delete of these rows in this slice.

## External Google

Server only. Header `X-Goog-Api-Key`. Never a wildcard field mask.

| Call | Request |
|---|---|
| Places text search | `POST https://places.googleapis.com/v1/places:searchText` |
| Place Details | `GET https://places.googleapis.com/v1/places/{placeId}` |
| Routes matrix | `POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix` |

Start search and start details use mask `places.id,places.displayName,places.location` (details: `id,displayName,location`). They do not request `priceRange`. Start search uses the participant's locale and the same region bias as venues, with no location circle required. Venue mask includes `places.priceRange`.

Route field mask: `originIndex,destinationIndex,status,condition,duration`. One matrix of cohort starts × the first step's pool stays ≤ 625 elements because the participant cap is 100 and the pool is at most 5. Between-step pairs are batched the same way. v1 does not chunk past 625; a need to chunk is a new ADR.

Tests use fakes. No unit or handler test calls these hosts.

## Screens

Locale cookie, not a path prefix. The copied link is `/join/{token}`.

| Surface | Path |
|---|---|
| Home | `/` |
| Account gate | `/account` |
| Create | `/plans/new` |
| Organizer plan | `/plans/{planId}` |
| Invite | `/plans/{planId}/invite` |
| In-app join | `/plans/{planId}/join` |
| Invitations | `/invitations` |
| Share link | `/join/{token}` |
| Response | `/plans/{planId}/respond` |
| Proposal | `/plans/{planId}/proposal` |
| Confirmed | `/plans/{planId}/confirmed` |

The page asks opening or `GET /v1/join/{token}` and renders the matching path. A direct hit on the wrong path redirects to `next`. Strangers get the not-found state for that open, with no other plan's data.

`/account?next=` accepts only `/`, `/plans/new`, `/invitations`, or `/join/{token}`. Any other value is ignored and the gate returns home after sign-in. Signed-out create sends the person to the gate with `next=/plans/new`. The gate offers a way back to join without an account when `next` is a join path.

## UI-only

No HTTP contract beyond the fields above:

- Chrome in Arabic and English, RTL for Arabic, English fallback string inside RTL (F-001-1, F-001-2, N-001-1).
- Language control. Switching it keeps unsaved create, invite, join, and response input (F-001-4).
- Create's timezone starts from `Intl.DateTimeFormat().resolvedOptions().timeZone` and stays editable (F-001-13).
- Copying the link. On clipboard failure the link text stays visible (N-001-19).
- Block, wait, and fairness sentences. Waiting is `text-muted`. Time block, budget block, and venue-data error are `danger`. Fairness is `warning` and includes no money. Both time and budget sentences show together when both flags are true. A missing duration is not rendered as zero (N-001-9, N-001-10, F-001-30).
- Like and dislike counts render as the none copy when both are 0.
- Distinguisher visibility on collision (N-001-5).
- Attribution sentence may name Google Places and Google Maps routing (F-001-41). No vendor widget and no map image.
- No native-app install step (N-001-16).
- Home load failure and plan load failure use `danger` and retry. Empty home is `text-muted`, distinct from the error (N-001-14, N-001-15).
