# Surface: Response

Who: a joined participant while the plan is `collecting` or `blocked`. The organizer's own answers are not collected here (`[DECISION: organizer-not-in-cohort]`).
Spec: F-001-3, F-001-8, F-001-20, F-001-21, F-001-22, F-001-23, N-001-6, N-001-7, N-001-17, N-001-18.
`[DECISION: free-subrange]`, `[DECISION: single-preference]`, `[DECISION: start-by-search]`, `[DECISION: start-private]`, `[DECISION: answers-editable-until-proposed]`.

While `proposed`, a joined person opens the proposal surface instead. While `locked`, they open the confirmed surface.

Direction follows the UI language (`design/DESIGN.md`).

## Empty

Nothing saved. Every organizer day window is unanswered. Starting point is unset and labeled approximate. Each step shows its name and its 2 to 4 labels, with none selected. The plan budget and currency are visible as context. Answered count, threshold, other participants, and other starting points are absent.

The same session can leave and return to this empty or in-progress response (F-001-39).

## Error

Save failed. Entered values remain. Answered count is unchanged (N-001-6). Message uses `danger`.

A save that would mark complete with a time outside the window, a latest at or before earliest, a missing start, or a step without its one label stays incomplete and identifies those fields (N-001-7).

## Loaded

Incomplete save: the participant's status for the organizer is `in progress`. Fields stay editable. Their confirmed start name is visible to them when set.

Complete save: status for the organizer is `answered`. The answered count has increased once for this participant. Fields stay editable while `collecting` or `blocked`. Editing a complete response keeps the count. The summary shows, for each window, busy or the free sub-range; the starting place name; and the chosen label per step.

Start is chosen by confirming a search result. No map image is required. The place name is not shown on organizer, proposal, join, or confirmed surfaces.

Option labels appear as the organizer wrote them.
