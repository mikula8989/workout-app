# Workout App v2

GitHub Pages URL:
`https://mikula8989.github.io/workout-app/`

Current behavior:
- Opens automatically on today's weekday.
- Lets you inspect other days manually.
- Shows equipment + full exercise sequence before Start.
- Every morning session is exactly 30:00.
- Each exercise has a reserved time slot, even when the exercise itself is rep-based.
- Automatic sounds/vibration at transitions.
- Distinct soft triple chirp every 60 seconds during work blocks.
- Start requests Fullscreen and Screen Wake Lock where Android/Chrome supports it.
- Installable as a PWA.
- Works offline after first successful load.

## v2 changes
- Added a distinct **60-second audio cue** so side changes / set changes do not require looking at the screen.
- Main exercise/transition sound remains different from the minute marker.
- Added richer in-session instructions: **SETUP / FEEL / AVOID / 1-MIN CUE**.
- Clarified Sunday mobility technique, especially:
  - 360° breathing position and neutral low back
  - hip-flexor stretch
  - ankle rocks / knee-to-wall
- Added `program-overrides.json` as a lightweight data layer. This lets future workout/content changes be deployed without replacing the entire base program file.
