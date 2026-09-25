# Surface: Create plan

Who: a signed-in organizer.
Spec: F-001-1 through F-001-8, F-001-12, F-001-13, F-001-14, N-001-1, N-001-2, N-001-4, N-001-16.
`[DECISION: create-is-one-form]`, `[DECISION: options-are-labels]`, `[DECISION: option-count]`, `[DECISION: one-plan-timezone]`, `[DECISION: currency-is-data]`.

A signed-out open of this surface is the account gate instead of the form (F-001-9).

Direction follows the UI language (`design/DESIGN.md`). Section order: title, when, budget, steps, threshold.

## Empty

Form ready, nothing submitted. Title blank. Timezone filled from the organizer's environment and editable, name visible. No day window until the organizer adds one. Currency is EGP, changeable to another list entry. Budget blank. No step until the organizer adds one. A new step starts with empty name and room for 2 to 4 label fields. Threshold blank. Primary action is create (`accent`). The form is not yet valid.

## Error

Invalid submit: no plan is created, the surface stays here, and each invalid field is identified. Covered cases include empty title, missing timezone, no window, end time at or before start, budget that is not a positive amount, threshold below 1, no step, a step with fewer than 2 or more than 4 labels, and a blank label.

Save failure: entered values stay, including steps already added. Message uses `danger`. No navigation to an organizer plan.

## Loaded

The form is interactive with the EGP default and the environment timezone visible. Successful submit leaves this surface and opens the new plan on the organizer plan surface in `collecting`, answered count 0.

Option labels are text fields. This surface has no venue search and no map.
