const CACHE = "workout-app-v23-gym-template-selector-fix";
const SHELL = ["./program.json","./adaptive.js","./","./index.html","./style.css","./app.js","./manifest.json","./icon-192.png","./icon-512.png","./program-overrides.json","./gym-overrides.json","./poses/chair_pose.jpg","./poses/warrior_ii.jpg","./poses/reverse_warrior.jpg","./poses/extended_side_angle.jpg","./poses/goddess_squat.jpg","./poses/wide_leg_forward_fold.jpg","./poses/star_pose.jpg","./poses/yoga_pose_sprite_full.webp","./poses/yoga_pose_sprite_clean.webp"];
const EXERCISE_IMAGES = [
  "./assets/exercises/ab_wheel.webp",
  "./assets/exercises/adductor_raise.webp",
  "./assets/exercises/ankle_rocks.webp",
  "./assets/exercises/back_extension.webp",
  "./assets/exercises/band_external_rotation.webp",
  "./assets/exercises/band_march.webp",
  "./assets/exercises/bear_plank_drag.webp",
  "./assets/exercises/breathing.webp",
  "./assets/exercises/cardio_bike.webp",
  "./assets/exercises/chair_pose.webp",
  "./assets/exercises/chest_supported_row.webp",
  "./assets/exercises/chin_tucks.webp",
  "./assets/exercises/close_grip_pushups.webp",
  "./assets/exercises/copenhagen_short.webp",
  "./assets/exercises/cossack_squat.webp",
  "./assets/exercises/db_halo.webp",
  "./assets/exercises/db_rdl.webp",
  "./assets/exercises/db_windmill.webp",
  "./assets/exercises/deadbug_heeltaps.webp",
  "./assets/exercises/deep_squat_reach.webp",
  "./assets/exercises/extended_side_angle.webp",
  "./assets/exercises/facepull_external_rotation.webp",
  "./assets/exercises/floor_press.webp",
  "./assets/exercises/goblet_squat.webp",
  "./assets/exercises/goddess_squat.webp",
  "./assets/exercises/hack_squat.webp",
  "./assets/exercises/half_kneeling_press.webp",
  "./assets/exercises/hammer_curl.webp",
  "./assets/exercises/hamstring_sweeps.webp",
  "./assets/exercises/handstand.webp",
  "./assets/exercises/hip_90_90.webp",
  "./assets/exercises/hip_airplanes.webp",
  "./assets/exercises/lateral_raise.webp",
  "./assets/exercises/leg_extension.webp",
  "./assets/exercises/leg_press.webp",
  "./assets/exercises/low_stepups.webp",
  "./assets/exercises/negative_pullup.webp",
  "./assets/exercises/one_arm_db_row.webp",
  "./assets/exercises/open_book.webp",
  "./assets/exercises/overhead_triceps.webp",
  "./assets/exercises/pike_pushups.webp",
  "./assets/exercises/prone_ytw.webp",
  "./assets/exercises/pullover_deadbug.webp",
  "./assets/exercises/pullup.webp",
  "./assets/exercises/reverse_crunch.webp",
  "./assets/exercises/reverse_snow_angels.webp",
  "./assets/exercises/seated_ham_curl.webp",
  "./assets/exercises/seated_knee_lift.webp",
  "./assets/exercises/seated_straight_leg_lift.webp",
  "./assets/exercises/sideplank_leg_raise.webp",
  "./assets/exercises/single_leg_rdl.webp",
  "./assets/exercises/split_squat.webp",
  "./assets/exercises/split_squat_v2.webp",
  "./assets/exercises/suitcase_march.webp",
  "./assets/exercises/supinating_curl.webp",
  "./assets/exercises/thruster.webp",
  "./assets/exercises/triceps_kickback.webp",
  "./assets/exercises/tuck_lsit.webp",
  "./assets/exercises/turkish_getup.webp",
  "./assets/exercises/wall_slides.webp",
  "./assets/exercises/warrior_ii.webp",
  "./assets/exercises/yoga_flow_a.webp",
  "./assets/exercises/yoga_flow_b.webp"
];
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(async c=>{
    await c.addAll(SHELL);
    // Prefetch small landscape WebP assets for airplane-mode workouts. One failed image never breaks installation.
    for(let i=0;i<EXERCISE_IMAGES.length;i+=8){
      await Promise.allSettled(EXERCISE_IMAGES.slice(i,i+8).map(path=>c.add(path)));
    }
  }));
});
self.addEventListener("activate", e => e.waitUntil(
  Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),
    self.clients.claim()
  ])
));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  const networkFirst =
    e.request.mode === "navigate" ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/adaptive.js") ||
    url.pathname.endsWith("/style.css") ||
    url.pathname.endsWith("/program.json") ||
    url.pathname.endsWith("/program-overrides.json") ||
    url.pathname.endsWith("/gym-overrides.json");

  if(networkFirst){
    e.respondWith(
      fetch(e.request).then(r=>{
        const copy=r.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
        return r;
      }).catch(()=>caches.match(e.request))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(cached=>cached || fetch(e.request)));
});
