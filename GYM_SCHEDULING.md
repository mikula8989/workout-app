# Flexible gym scheduling (v20)

## Main rules
- Monday and Thursday remain **Gym A** and **Gym B** template definitions, not obligatory calendar gym days.
- Home screen "I'm going to the gym today" marks the current local calendar date as **planned**. The A/B selector defaults to alternating after the last **completed** gym session, but the user can change it.
- The user can mark the gym visit **completed** on the same day, use a small **log yesterday's gym** recovery action if they forgot to check in, or answer the next-open confirmation prompt for an earlier planned date (up to seven days). Planned gym is *not credited* in the 14-day balance until confirmed.
- A planned or completed gym session changes that day's gym exercise list and prepares a lower-fatigue morning. Next-day preview and actual next-day morning replace demanding overlapping exercises with safe mobility. The morning length remains unchanged.
- If a planned gym visit is cancelled/skipped, it is not credited and does not cause next-day recovery.
- The 14-day coverage dashboard counts **confirmed completed** exercise-category exposures per calendar day; partial morning steps count as a half exposure. If no completed history exists, coverage is shown as not yet collected, not as "missed."
- On safe non-gym mornings, the app may trade up to nine minutes of replaceable movement blocks for under-covered priorities, without changing session duration. Sunday stays light.
- Ab Wheel morning blocks remain protected (Monday and Thursday), as requested; no recovery adjustment removes them.
- Historic `workoutGymLogV1` and `workoutSessionLogV2` data remain readable. No migration or wiping of local progress.

## Data format

`localStorage.workoutGymLogV1` is an object keyed by **local date** (YYYY-MM-DD):
```json
{
  "2026-11-22": {
    "dayKey": "sunday",
    "templateKey": "A",
    "status": "planned",
    "coverage": {"quads": 3, "back": 2.5},
    "label": "Gym A — Quads + Back",
    "loggedAt": "2026-11-22T10:00:00.000Z"
  }
}
```
Possible statuses: `planned`, `done`, `skipped`. A/B template metadata are derived from the two existing gym plans in `gym-overrides.json`.

## Checking behavior
- Sunday planned/done Gym A → Monday preview and active Monday get post-gym recovery, without Monday phantom Gym A.
- Friday Gym A → Saturday heavy quads/upper work replaced by mobility, but time remains 29 min.
- Any weekday can host Gym A/B, including both original fixed weekdays and new days.
- No real gym check-in → no gym marked as done; Monday and Thursday default workout descriptions are cleaned of obsolete "gym later" hints.
- Service worker v20 precaches existing exercise illustrations and all app resources for offline use.
