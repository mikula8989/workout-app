# Exercise illustrations

All illustrations in this directory are original, locally stored, 16:9 landscape WebP files (1120 × 630). Most show the movement phases side by side, left to right; static poses show one larger figure. The user can tap any active-workout illustration to enlarge it, and gym-plan cards have a view button.

To add a new exercise:
1. Create a clear horizontal 16:9 illustration in this style, ideally with starting and ending positions side by side.
2. Save it here as a descriptive lowercase snake_case filename, e.g. `new_movement.webp`.
3. Add a mapping from the lowercased exercise title to its file slug in `EXERCISE_IMAGE_FILES` near the top of `app.js`, or supply an explicit `image` URL on the step object.
4. Add the path to `EXERCISE_IMAGES` in `service-worker.js` and increment the cache version for offline use.
5. Verify the illustration shows the actual movement and is accurate for both sides.

Images are served by the app from `./assets/exercises/` with no runtime third-party image dependencies. All current normal/adaptive training movements and gym exercises have an illustration (except equipment-transition/rest blocks).
