// Adaptive weekly training layer.
// Tracks confirmed training, lets any calendar day become a gym day,
// and adjusts mornings for recovery and 14-day strength/mobility balance.

const ADAPT_SESSION_LOG_KEY = "workoutSessionLogV2";
const ADAPT_GYM_LOG_KEY = "workoutGymLogV1";
const ADAPT_TOP_PRIORITIES = ["quads","biceps","triceps","hips","hip_flexion","lateral_core","adductors","posture"];
const ADAPT_BALANCE_TAGS = ["quads","biceps","triceps","hips","hip_flexion","lateral_core","adductors","posture","hamstrings","glutes","back","shoulders","core","mobility"];
const ADAPT_PRIORITY_RANK = {quads:0,biceps:0,triceps:0,hips:0,hip_flexion:0,lateral_core:0,adductors:0,posture:0,hamstrings:1,glutes:1,back:1,shoulders:1,core:2,skill:2,conditioning:3,mobility:3};

let adaptSessionActualSec = [];
let adaptSessionTotalSec = 1800;
let adaptPendingReview = null;
let adaptInfo = null;
let adaptUseNormalToday = false;
// Keep the user’s unconfirmed A/B selection across renderHome() redraws.
let adaptSelectedGymType = null;

function adaptDateKeyForOffset(offsetDays){
  const d=new Date();
  d.setHours(12,0,0,0);
  d.setDate(d.getDate()+offsetDays);
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
  return y+"-"+m+"-"+day;
}
function adaptDayKeyForDateKey(key){
  const d=new Date(key+"T12:00:00");
  return WEEK[(d.getDay()+6)%7];
}
function adaptWeekStartKey(){
  const d=new Date();
  d.setHours(12,0,0,0);
  d.setDate(d.getDate()-((d.getDay()+6)%7));
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
  return y+"-"+m+"-"+day;
}

/* Flexible gym calendar: Monday/Thursday are template locations, not fixed appointments. */
const ADAPT_GYM_TEMPLATES = Object.freeze({
  A:{dayKey:"monday",coverage:{quads:1,back:1,hamstrings:.6,glutes:.7,biceps:.3,shoulders:.4,conditioning:1}},
  B:{dayKey:"thursday",coverage:{quads:1,back:1,hamstrings:1,glutes:.5,biceps:.3,shoulders:.5,posture:1,conditioning:1}}
});
const ADAPT_TARGETS_14 = Object.freeze({
  quads:4,biceps:4,triceps:4,hips:6,hip_flexion:4,lateral_core:4,
  adductors:4,posture:6,hamstrings:3,glutes:3,back:4,shoulders:4,core:4,
  mobility:9,conditioning:2
});
const ADAPT_GYM_RECOVERY_TAGS = ["quads","hamstrings","glutes","back","shoulders"];
const ADAPT_RECOVERY_STEPS = [
  {title:"90/90 hip switches",details:"Slow hip rotations, easy range; switch sides evenly.",equipment:["Exercise mat"]},
  {title:"Open book",details:"Gentle upper-back rotation on both sides. Relax shoulders.",equipment:["Exercise mat"]},
  {title:"Ankle rocks",details:"Slow ankle mobility, keep heel planted; change legs halfway.",equipment:["Wall"]},
  {title:"Hamstring sweeps",details:"Relaxed dynamic hamstring mobility. Do not force the stretch.",equipment:["Exercise mat"]},
  {title:"Chin tucks",details:"Light neck retraction and slow breathing; no strain.",equipment:["Exercise mat"]},
  {title:"Wall slides",details:"Easy shoulder blade motion in a pain-free range.",equipment:["Wall"]},
  {title:"Calm 360° breathing",details:"Breathe softly into lower ribs and belly without bracing.",equipment:["Exercise mat"]},
  {title:"Yoga Flow B — spine + side body",details:"Slow spinal and side-body mobility, no loaded stretching.",equipment:["Exercise mat"]},
  {title:"Cossack squat / adductor mobility",details:"Easy supported lateral shifts, stay above painful depth.",equipment:["Stable support"]},
  {title:"Band External Rotation",details:"Very light shoulder control, stop if pinching.",equipment:["Light resistance band"]}
];
function adaptDateForDayKey(dayKey){
  let offset=WEEK.indexOf(dayKey)-WEEK.indexOf(dayKeyFromToday());
  if(offset<0) offset+=7; // Weekday tabs preview the next occurrence, including across Sunday.
  return adaptDateKeyForOffset(offset);
}
function adaptDaysBetween(older,newer){
  const a=new Date(older+"T12:00:00"),b=new Date(newer+"T12:00:00");
  return Math.round((b.getTime()-a.getTime())/86400000);
}
function adaptGymLog(date){
  return readJson(ADAPT_GYM_LOG_KEY,{})[date] || null;
}
function adaptGymTemplateKey(log){
  if(log && ADAPT_GYM_TEMPLATES[log.templateKey]) return log.templateKey;
  return log && log.dayKey==="thursday" ? "B" : "A"; // Old records had no templateKey.
}
function adaptGymTemplate(key){
  const info=ADAPT_GYM_TEMPLATES[key] || ADAPT_GYM_TEMPLATES.A;
  const plan=PROGRAM?.days?.[info.dayKey]?.gymPlan || null;
  return {key:key,label:plan?.title || "Gym "+key,coverage:{...info.coverage},gymPlan:plan};
}
function adaptGymEntry(date){
  const log=adaptGymLog(date);
  if(!log || !["planned","done"].includes(log.status)) return null;
  return {log:log,template:adaptGymTemplate(adaptGymTemplateKey(log))};
}
function adaptSuggestedGymType(){
  const gyms=readJson(ADAPT_GYM_LOG_KEY,{});
  const completed=Object.keys(gyms).filter(d=>d<localDateKey() && gyms[d]?.status==="done").sort();
  if(!completed.length) return "A";
  return adaptGymTemplateKey(gyms[completed[completed.length-1]])==="A" ? "B" : "A";
}
function adaptSetGymToday(willGo,chosenType){
  const date=localDateKey(), logs=readJson(ADAPT_GYM_LOG_KEY,{});
  if(!willGo) delete logs[date];
  else{
    const prior=logs[date] || {};
    const templateKey=ADAPT_GYM_TEMPLATES[chosenType] ? chosenType : (ADAPT_GYM_TEMPLATES[prior.templateKey] ? prior.templateKey : adaptSuggestedGymType());
    logs[date]={...prior,dayKey:dayKeyFromToday(),templateKey:templateKey,
      status:prior.status==="done" ? "done" : "planned",
      coverage:{...adaptGymTemplate(templateKey).coverage},
      label:adaptGymTemplate(templateKey).label,loggedAt:new Date().toISOString()};
  }
  writeJson(ADAPT_GYM_LOG_KEY,logs);
  if(willGo) adaptSelectedGymType=ADAPT_GYM_TEMPLATES[chosenType] ? chosenType : adaptGymTemplateKey(logs[date]);
  else adaptSelectedGymType=null;
  adaptUseNormalToday=false;
  renderHome();
}
function adaptMarkGymDoneToday(){
  const date=localDateKey(),logs=readJson(ADAPT_GYM_LOG_KEY,{});
  const prior=logs[date];
  if(!prior || !["planned","done"].includes(prior.status)) return;
  prior.status="done";
  prior.coverage={...adaptGymTemplate(adaptGymTemplateKey(prior)).coverage};
  prior.loggedAt=new Date().toISOString();
  writeJson(ADAPT_GYM_LOG_KEY,logs);
  adaptUseNormalToday=false;
  renderHome();
}
function adaptToggleYesterdayGym(chosenType){
  const date=adaptDateKeyForOffset(-1),logs=readJson(ADAPT_GYM_LOG_KEY,{});
  if(logs[date]?.status==="done") delete logs[date];
  else{
    const templateKey=ADAPT_GYM_TEMPLATES[chosenType] ? chosenType : adaptSuggestedGymType();
    const template=adaptGymTemplate(templateKey);
    logs[date]={dayKey:adaptDayKeyForDateKey(date),templateKey,status:"done",
      coverage:{...template.coverage},label:template.label,loggedAt:new Date().toISOString()};
  }
  writeJson(ADAPT_GYM_LOG_KEY,logs);
  adaptUseNormalToday=false;
  renderHome();
}
function adaptGymRecovery(date){
  const entry=adaptGymEntry(date);
  if(entry) return {kind:"today",tags:new Set(ADAPT_GYM_RECOVERY_TAGS.filter(t=>(entry.template.coverage[t]||0)>.2)),label:entry.template.label};
  const gyms=readJson(ADAPT_GYM_LOG_KEY,{});
  const earlier=Object.keys(gyms).filter(d=>adaptDaysBetween(d,date)===1 && ["done","planned"].includes(gyms[d]?.status));
  if(earlier.length){
    const template=adaptGymTemplate(adaptGymTemplateKey(gyms[earlier[0]]));
    return {kind:"yesterday",tags:new Set(ADAPT_GYM_RECOVERY_TAGS.filter(t=>(template.coverage[t]||0)>.2)),label:template.label};
  }
  return null;
}
function adaptWithGymCalendar(base,dayKey,date){
  const gym=adaptGymEntry(date);
  const clean={...base};
  clean.focus=String(base.focus||"").replace(/\s*\(gym[^)]*\)/ig,"").trim();
  clean.gymPlan=gym ? gym.template.gymPlan : null;
  clean.later=gym ? (gym.log.status==="done" ? "✓ Gym completed: " : "🏋 Gym planned: ")+gym.template.label : "";
  return clean;
}
function adaptIsDemanding(step){
  if(!step || step.type==="rest") return false;
  const t=String(step.title||"").toLowerCase();
  if(/breathing|chin tuck|wall slide|90\/90|ankle rock|open book|hamstring sweep|yoga flow|chair pose|warrior|side angle|goddess|mobility|band external rotation|face pull|prone y|snow angel|seated straight-leg lift/.test(t)) return false;
  return /ab wheel|turkish get|windmill|db |dumbbell|step.up|split squat|hack squat|pull.up|leg press|leg extension|leg curl|pike push|handstand|l.sit|side plank|copenhagen|bear.plank|suitcase|reverse crunch|straight.leg lift|hip lifts|glute bridge|march|squat|deadlift|row|push.up|thruster/i.test(t);
}
function adaptRecoveryDay(base,recovery){
  if(!recovery) return {day:base,added:[],removed:[]};
  const used=new Set((base.steps||[]).map(s=>String(s.title||"").toLowerCase()));
  const added=[],removed=[];
  const newSteps=(base.steps||[]).map(step=>{
    if(!adaptIsDemanding(step)) return {...step};
    const tags=adaptStepMeta(step).tags;
    const overlap=tags.some(t=>recovery.tags.has(t));
    const gymDayExtra=recovery.kind==="today" && /turkish get|thruster|handstand|step.up|split squat|goblet squat|db romanian deadlift/.test(String(step.title).toLowerCase());
    // Direct biceps/triceps remain home-only priorities: gym has no direct arm training.
    if(recovery.kind==="today" && tags.some(t=>t==="biceps"||t==="triceps")) return {...step};
    // Preserve the two programmed ab-wheel sessions even when gym days move.
    if(!overlap && !gymDayExtra) return {...step};
    const choice=ADAPT_RECOVERY_STEPS.find(c=>!used.has(c.title.toLowerCase())) || ADAPT_RECOVERY_STEPS[added.length%ADAPT_RECOVERY_STEPS.length];
    used.add(choice.title.toLowerCase());
    removed.push(step.title);
    added.push(choice.title);
    return {...choice,type:"work",slotSec:step.slotSec,adaptive:true,recovery:true};
  });
  const equipment=[...new Set([...(base.equipment||[]),...newSteps.flatMap(s=>s.equipment||[])])];
  return {day:{...base,equipment,steps:newSteps,focus:(recovery.kind==="today"?"Gym-day lighter morning · ":"Post-gym recovery · ")+base.focus},added,removed};
}
function adaptRollingCoverage(){
  const today=localDateKey(),start=adaptDateKeyForOffset(-13);
  const sessions=readJson(ADAPT_SESSION_LOG_KEY,{}),gyms=readJson(ADAPT_GYM_LOG_KEY,{});
  const allDates=[...new Set([...Object.keys(sessions),...Object.keys(gyms)])].filter(d=>d>=start && d<=today).sort();
  const completedDates=allDates.filter(d=>Boolean(sessions[d]?.steps?.length) || gyms[d]?.status==="done");
  const hasHistory=completedDates.length>0;
  const elapsed=hasHistory ? Math.max(7,Math.min(14,adaptDaysBetween(completedDates[0],today)+1)) : 0;
  const credit={};Object.keys(ADAPT_TARGETS_14).forEach(t=>credit[t]=0);
  for(const date of allDates){
    const daily={};
    const session=sessions[date];
    if(session && Array.isArray(session.steps)){
      for(const step of session.steps){
        const completion=step.status==="full" ? 1 : step.status==="partial" ? .5 : 0;
        if(!completion || step.protected && /breath|pelvic floor/.test(String(step.title).toLowerCase())) continue;
        const tags=step.adaptiveFor?.length ? step.adaptiveFor : (step.tags||adaptStepMeta(step).tags);
        for(const tag of tags) if(tag in credit) daily[tag]=Math.max(daily[tag]||0,completion);
      }
    }
    const gym=gyms[date];
    if(gym?.status==="done"){
      const coverage=gym.coverage && Object.keys(gym.coverage).length ? gym.coverage : adaptGymTemplate(adaptGymTemplateKey(gym)).coverage;
      for(const [tag,value] of Object.entries(coverage)){
        const key=tag==="cardio" ? "conditioning" : tag;
        if(key in credit) daily[key]=Math.max(daily[key]||0,Math.min(1,Number(value)||0));
      }
    }
    for(const [tag,value] of Object.entries(daily)) credit[tag]+=value;
  }
  const targets={},debt={};
  for(const [tag,target] of Object.entries(ADAPT_TARGETS_14)){
    targets[tag]=hasHistory ? Math.max(1,Math.round(target*elapsed/14*10)/10) : 0;
    debt[tag]=hasHistory ? Math.max(0,targets[tag]-credit[tag]) : 0;
  }
  return {credit,targets,debt,hasHistory,elapsed,windowDays:14,completedDays:completedDates.length};
}
function adaptRenderGymToday(){
  const card=document.getElementById("gymFlexCard");
  if(!card) return;
  const isToday=currentDayKey===dayKeyFromToday();
  const note=document.getElementById("gymFlexNote");
  const btn=document.getElementById("gymTodayToggle");
  const done=document.getElementById("gymTodayDoneBtn");
  const select=document.getElementById("gymTemplateSelect");
  const details=document.getElementById("gymFlexDetails");
  const yesterdayBtn=document.getElementById("gymYesterdayToggle");
  card.classList.toggle("not-today",!isToday);
  btn.disabled=!isToday;
  select.disabled=!isToday;
  if(yesterdayBtn){
    yesterdayBtn.disabled=!isToday;
    const yesterdayLog=adaptGymLog(adaptDateKeyForOffset(-1));
    yesterdayBtn.textContent=yesterdayLog?.status==="done" ? "↩ Undo yesterday’s gym" : "+ Log yesterday’s gym";
  }
  const entry=adaptGymEntry(localDateKey());
  const suggested=adaptSuggestedGymType();
  // For an unplanned day, display the user’s tentative choice rather than resetting to the suggestion.
  const type=entry ? entry.template.key : (adaptSelectedGymType || suggested);
  select.value=type;
  btn.textContent=entry ? (entry.log.status==="done" ? "↩ Undo gym check-in" : "✕ Cancel today's gym") : "🏋 I'm going to the gym today";
  btn.classList.toggle("selected",!!entry);
  done.classList.toggle("hidden",!isToday || !entry || entry.log.status==="done");
  const recent=adaptGymRecovery(localDateKey());
  if(!isToday){
    note.textContent="Select today's tab to change your gym attendance.";
    details.textContent="";
  }else if(entry){
    note.textContent=entry.log.status==="done" ? "Gym confirmed. Its workload counts toward your rolling balance." : "Gym scheduled today. Morning workout and tomorrow's recovery will adapt. Confirm after training.";
    details.textContent=entry.template.label+" · "+(entry.log.status==="done"?"Completed":"Planned");
  }else{
    note.textContent="Monday and Thursday are suggestions only. Mark any day you actually plan to go.";
    details.textContent=recent?.kind==="yesterday" ? "Recovery today after "+recent.label+"." : "Suggested next session: "+adaptGymTemplate(suggested).label;
  }
}

function adaptStepMeta(step){
  const t=(step && step.title ? step.title : "").toLowerCase();
  const tags=[];
  let protectedStep=false;
  if(t.includes("360° breathing") || t.includes("pelvic floor")){ tags.push("core"); protectedStep=true; }
  if(t.includes("deep core + control primer")){ tags.push("core"); protectedStep=true; }
  if(t.includes("chin tuck") || t.includes("wall slide") || t.includes("y–t–w") || t.includes("y-t-w") || t.includes("reverse snow angel") || t.includes("face pull") || t.includes("deep squat + overhead reach")) tags.push("posture");
  if(t.includes("90/90") || t.includes("hip airplane") || t.includes("glute bridge") || t.includes("copenhagen") || t.includes("side plank leg raise") || t.includes("reverse lunge") || t.includes("half-kneeling") || t.includes("turkish get-up") || t.includes("deep squat + overhead reach")) tags.push("hips");
  if(t.includes("curl")) tags.push("biceps");
  if(t.includes("triceps") || t.includes("close-grip")) tags.push("triceps");
  if(t.includes("goblet squat") || t.includes("split squat") || t.includes("step-up") || t.includes("hack squat") || t.includes("leg press") || t.includes("leg extension") || t.includes("cyclist squat") || t.includes("reverse lunge") || t.includes("thruster")) tags.push("quads");
  if(t.includes("glute bridge") || t.includes("split squat") || t.includes("step-up") || t.includes("deadlift") || t.includes("back extension") || t.includes("reverse lunge") || t.includes("thruster")) tags.push("glutes");
  if(t.includes("hamstring curl") || t.includes("romanian deadlift") || t.includes("deadlift") || t.includes("back extension")) tags.push("hamstrings");
  if(t.includes("pull-up") || t.includes("pull up") || t.includes("row") || t.includes("pulldown")) tags.push("back");
  if(t.includes("lateral raise") || t.includes("shoulder press") || t.includes("pike push") || t.includes("handstand") || t.includes("rear-delt") || t.includes("halo") || t.includes("thruster") || t.includes("turkish get-up") || t.includes("deep squat + overhead reach")) tags.push("shoulders");
  if(t.includes("dead bug") || t.includes("dead-bug") || t.includes("hollow") || t.includes("reverse crunch") || t.includes("l-sit") || t.includes("ab wheel") || t.includes("turkish get-up")) tags.push("core");
  if(t.includes("handstand") || t.includes("l-sit")) tags.push("skill");
  if(t.includes("burpee") || t.includes("conditioning") || t.includes("mountain climber") || t.includes("thruster")) tags.push("conditioning");
  if(t.includes("stretch") || t.includes("forward fold") || t.includes("hamstring sweep") || t.includes("ankle rock") || t.includes("open book") || t.includes("yoga") || t.includes("chair pose") || t.includes("warrior") || t.includes("goddess") || t.includes("star pose") || t.includes("halo") || t.includes("deep squat + overhead reach")) tags.push("mobility");
  if(t.includes("90/90") || t.includes("hip airplane") || t.includes("cossack")) tags.push("mobility");
  if(t.includes("band external rotation")) tags.push("posture","shoulders");
  if(t.includes("windmill")) tags.push("hips","hamstrings","shoulders","core","mobility");
  if(t.includes("clean → front-rack reverse lunge") || t.includes("clean -> front-rack reverse lunge")) tags.push("core","conditioning");
  if(t.includes("bear-plank db drag")) tags.push("hips","shoulders","core","conditioning");
  if(t.includes("suitcase march")) tags.push("hips","core","conditioning");
  if(t.includes("band-resisted standing march") || t.includes("seated bent-knee hip lifts") || t.includes("seated straight-leg lift") || t.includes("l-sit")) tags.push("hip_flexion");
  if(t.includes("side plank") || t.includes("bear-plank db drag") || t.includes("windmill")) tags.push("lateral_core");
  if(t.includes("copenhagen") || t.includes("adductor") || t.includes("cossack")) tags.push("adductors");
  if(t.includes("ab wheel") || t.includes("seated straight-leg lift") || t.includes("hamstring sweep") || t.includes("yoga flow a")) protectedStep=true;
  if(t.includes("single-leg glute bridge")) tags.push("glutes","hips","core");
  const unique=[...new Set(tags)];
  const priority=unique.length ? Math.min(...unique.map(x=>ADAPT_PRIORITY_RANK[x]===undefined?3:ADAPT_PRIORITY_RANK[x])) : 3;
  return {tags:unique,priority:priority,protected:protectedStep};
}
function adaptDebtWeight(tag){
  if(ADAPT_TOP_PRIORITIES.includes(tag)) return 1;
  if(["hamstrings","glutes","back","shoulders"].includes(tag)) return .75;
  if(tag==="core") return .45;
  return .25;
}
function adaptGymPlanForDay(dayKey,date){
  const entry=adaptGymEntry(date || adaptDateForDayKey(dayKey));
  return entry ? {label:entry.template.label,coverage:entry.template.coverage} : null;
}
function adaptCalculateDebt(){
  return adaptRollingCoverage().debt;
}
function adaptBalanceLabel(value){
  if(value>=1.5) return ["Missing work","missing"];
  if(value>=.45) return ["Needs attention","attention"];
  return ["On plan","ok"];
}
function adaptRenderWeeklyBalance(){
  const wrap=document.getElementById("weeklyBalanceList");
  if(!wrap) return;
  const balance=adaptRollingCoverage();
  const text=document.getElementById("balanceExplanation");
  if(text) text.textContent=balance.hasHistory ?
    "Rolling 14-day view · "+balance.completedDays+" training days logged · only confirmed work counts" :
    "No confirmed training logged yet. Finish a morning workout or confirm a gym visit to start tracking.";
  wrap.innerHTML=ADAPT_BALANCE_TAGS.map(tag=>{
    const value=balance.credit[tag]||0, goal=balance.targets[tag]||0;
    const state=balance.hasHistory ? adaptBalanceLabel(Math.max(0,goal-value)) : ["Waiting for logs","ok"];
    const name=tag.split("_").map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(" ");
    const amount=balance.hasHistory ? Math.round(value*10)/10+" / "+goal+" days" : "—";
    return '<div class="balance-row"><strong>'+name+'</strong><span class="balance-count">'+amount+'</span><span class="balance-state '+state[1]+'">'+state[0]+'</span></div>';
  }).join("");
}
function adaptYesterdayPerformedTitles(){
  const logs=readJson(ADAPT_SESSION_LOG_KEY,{});
  const log=logs[adaptDateKeyForOffset(-1)];
  return new Set(((log && log.steps) || []).filter(s=>s.status!=="skipped").map(s=>s.title.toLowerCase()));
}
function adaptHasPlannedTag(dayKey,tag,includeGym){
  const day=PROGRAM && PROGRAM.days ? PROGRAM.days[dayKey] : null;
  if(!day) return false;
  if((day.steps||[]).some(s=>s.type!=="rest" && adaptStepMeta(s).tags.includes(tag))) return true;
  if(includeGym!==false){
    const g=adaptGymPlanForDay(dayKey);
    if(g && g.coverage && g.coverage[tag]) return true;
  }
  return false;
}
function adaptReplacementLibrary(){
  return {
    quads:[
      {title:"Short-Stance DB Split Squat",type:"work",slotSec:300,details:"2 × 8–10 / leg. Short stance, upright torso, let the front knee travel forward comfortably. Keep 2–3 RIR and avoid grinding.",adaptiveFor:["quads"],equipment:["2 dumbbells"]},
      {title:"Goblet Squat",type:"work",slotSec:300,details:"3 × 10–15. Hold one dumbbell at the chest. Use comfortable depth, controlled lowering and 2–3 RIR.",adaptiveFor:["quads"],equipment:["1 dumbbell"]},
      {title:"Stable Step-Ups",type:"work",slotSec:300,details:"2 × 8–10 / leg. Use a genuinely stable low step/platform, not an unstable chair. Drive through the working leg and minimise push-off from the floor.",adaptiveFor:["quads"],equipment:["2 dumbbells","Stable step/platform"]}
    ],
    biceps:[
      {title:"Hammer Curl",type:"work",slotSec:240,details:"3 × 10–15. Clean reps, elbows quiet, about 1–2 RIR.",adaptiveFor:["biceps"],equipment:["2 dumbbells"]},
      {title:"Alternating DB Curl",type:"work",slotSec:240,details:"3 × 8–12 / arm. Supinate strongly, no torso swing, about 1–2 RIR.",adaptiveFor:["biceps"],equipment:["2 dumbbells"]}
    ],
    triceps:[
      {title:"DB Overhead Triceps Extension",type:"work",slotSec:240,details:"3 × 8–15. Get a controlled stretch behind the head, keep breathing and stop 1–2 reps before grinding.",adaptiveFor:["triceps"],equipment:["1 dumbbell"]},
      {title:"Close-Grip DB Floor Press",type:"work",slotSec:240,details:"3 × 8–15. Keep elbows relatively close and press smoothly. Stop around 1–2 RIR.",adaptiveFor:["triceps"],equipment:["2 dumbbells","Exercise mat"]}
    ],
    hips:[
      {title:"Supported Hip Airplanes",type:"work",slotSec:180,details:"2 × 5–6 controlled reps / side. Light hand support, slow pelvis open/close, standing knee controlled.",adaptiveFor:["hips"],equipment:["Stable support"]},
      {title:"Knee-Supported Copenhagen Plank",type:"work",slotSec:180,details:"Two sets of 10–15 s / side. Use the short-lever knee-supported version and keep the pelvis controlled.",adaptiveFor:["hips"],equipment:["Stable bench/table"]}
    ],
    hip_flexion:[
      {title:"Band-Resisted Standing March",type:"work",slotSec:180,details:"2 × 8–10/side with a light band; pause 2 sec; stop before cramp-like fatigue.",adaptiveFor:["hip_flexion"],equipment:["Resistance band"]}
    ],
    lateral_core:[
      {title:"Knee-Supported Side Plank Hold",type:"work",slotSec:180,details:"Two gentle 15–20-sec holds/side; steady pelvis, no spinal rotation.",adaptiveFor:["lateral_core"],equipment:["Exercise mat"]}
    ],
    adductors:[
      {title:"Side-Lying Adductor Raise",type:"work",slotSec:180,details:"2 × 8–12/side with a slow lowering phase; comfortable range only.",adaptiveFor:["adductors"],equipment:["Exercise mat"]}
    ],
    posture:[
      {title:"Prone Y–T–W",type:"work",slotSec:180,details:"2 controlled rounds. Move from the shoulder blades; do not chase height.",adaptiveFor:["posture"],equipment:["Exercise mat"]},
      {title:"Reverse Snow Angels",type:"work",slotSec:180,details:"2 × 10 slow reps. Keep ribs controlled and avoid shrugging.",adaptiveFor:["posture"],equipment:["Exercise mat"]}
    ],
    hamstrings:[
      {title:"DB Romanian Deadlift",type:"work",slotSec:300,details:"3 × 8–12. Hinge from the hips, keep the dumbbells close and finish with 2–3 RIR.",adaptiveFor:["hamstrings"],equipment:["2 dumbbells"]}
    ],
    glutes:[
      {title:"Single-Leg DB RDL",type:"work",slotSec:300,details:"3 × 8–10 / side. Keep hips square and use the opposite hand from the standing leg.",adaptiveFor:["glutes"],equipment:["1 dumbbell"]}
    ],
    back:[
      {title:"One-Arm DB Row",type:"work",slotSec:300,details:"3 × 8–12 / side. Brace on a stable support, pull the elbow toward the hip, 2–3 RIR.",adaptiveFor:["back"],equipment:["1 dumbbell","Stable support"]}
    ],
    shoulders:[
      {title:"DB Lateral Raise",type:"work",slotSec:220,details:"3 × 12–20. Controlled lowering and no swinging.",adaptiveFor:["shoulders"],equipment:["2 dumbbells"]}
    ],
    core:[
      {title:"Dead-Bug Heel Taps",type:"work",slotSec:180,details:"2–3 controlled sets. Keep breathing and regress if the abdomen domes/cones.",adaptiveFor:["core"],equipment:["Exercise mat"]}
    ]
  };
}
function adaptPickCandidate(tag,usedTitles,yesterdayTitles){
  const list=adaptReplacementLibrary()[tag] || [];
  return list.find(x=>!usedTitles.has(x.title.toLowerCase()) && !yesterdayTitles.has(x.title.toLowerCase())) || null;
}

function adaptBuildDay(dayKey){
  const source=PROGRAM?.days?.[dayKey];
  if(!source) return source;
  const date=adaptDateForDayKey(dayKey);
  const template=adaptWithGymCalendar(source,dayKey,date);
  const isToday=date===localDateKey();
  if(isToday) adaptInfo=null;
  // Never rewrite the displayed routine after its completion has already been logged.
  if(isToday && readJson(ADAPT_SESSION_LOG_KEY,{})[date]) return template;
  if(isToday && adaptUseNormalToday) return template;
  const recovery=adaptGymRecovery(date);
  const lighter=adaptRecoveryDay(template,recovery);
  let day=lighter.day;
  if(isToday && recovery && lighter.removed.length){
    adaptInfo={
      tags:[...recovery.tags],added:lighter.added,removed:lighter.removed,
      reason:(recovery.kind==="today"?"Gym today: lighter morning. ":"Yesterday's gym: muscle recovery. ")+recovery.label
    };
  }
  if(!isToday || recovery || dayKey==="sunday") return day;
  const completed=readJson(ADAPT_SESSION_LOG_KEY,{});
  if(completed[date]) return day;
  return adaptAdaptForCoverage(day,dayKey,date);
}
function adaptAdaptForCoverage(base,dayKey,date){
  const balance=adaptRollingCoverage();
  if(!balance.hasHistory) return base;
  const debt=balance.debt;
  const usedTitles=new Set((base.steps||[]).filter(s=>s.type!=="rest").map(s=>s.title.toLowerCase()));
  const yesterdayTitles=adaptYesterdayPerformedTitles();
  const sessionLogs=readJson(ADAPT_SESSION_LOG_KEY,{});
  const previous=sessionLogs[adaptDateKeyForOffset(-1)]?.steps||[];
  const yesterdayTags=new Set(previous.filter(s=>s.status!=="skipped" && !s.protected).flatMap(s=>s.tags||[]));
  const candidates=[];
  let budget=540; // Rebalance at most nine minutes of a 25–30-minute morning.
  const tomorrow=WEEK[(WEEK.indexOf(dayKey)+1)%7];
  const ordered=Object.keys(debt).filter(tag=>debt[tag]>=.8 && ADAPT_PRIORITY_RANK[tag]!==undefined)
    .sort((a,b)=>(ADAPT_PRIORITY_RANK[a]||0)-(ADAPT_PRIORITY_RANK[b]||0) || (debt[b]-debt[a]));
  for(const tag of ordered){
    if(candidates.length>=2 || budget<180) break;
    if(yesterdayTags.has(tag)) continue;
    if(adaptHasPlannedTag(dayKey,tag,false)) continue;
    if(adaptHasPlannedTag(tomorrow,tag,true)) continue;
    const candidate=adaptPickCandidate(tag,usedTitles,yesterdayTitles);
    if(!candidate || candidate.slotSec>budget) continue;
    candidates.push({...candidate,adaptive:true});
    usedTitles.add(candidate.title.toLowerCase());
    budget-=candidate.slotSec;
  }
  if(!candidates.length) return base;
  const groups=[],pendingRest=[];
  (base.steps||[]).forEach((s,i)=>{
    if(s.type==="rest"){pendingRest.push(i);return;}
    const meta=adaptStepMeta(s), inds=pendingRest.concat([i]);
    groups.push({indices:inds,sec:inds.reduce((sum,j)=>sum+Number(base.steps[j].slotSec||0),0),meta,title:s.title});
    pendingRest.length=0;
  });
  const removable=groups.filter(g=>!g.meta.protected && g.meta.priority>0 && !g.meta.tags.some(tag=>candidates.some(c=>c.adaptiveFor?.includes(tag))))
    .sort((a,b)=>b.meta.priority-a.meta.priority || b.sec-a.sec);
  let insertedSec=candidates.reduce((sum,s)=>sum+s.slotSec,0), removedSec=0;
  const removed=[];
  for(const group of removable){
    if(removedSec>=insertedSec) break;
    removed.push(group);
    removedSec+=group.sec;
  }
  while(candidates.length && candidates.reduce((sum,s)=>sum+s.slotSec,0)>removedSec) candidates.pop();
  if(!candidates.length) return base;
  insertedSec=candidates.reduce((sum,s)=>sum+s.slotSec,0);
  const removeIndexes=new Set(removed.flatMap(g=>g.indices));
  const kept=(base.steps||[]).filter((_,i)=>!removeIndexes.has(i)).map(s=>({...s}));
  const diff=removedSec-insertedSec;
  const filler=[];
  const used=new Set([...kept,...candidates].map(s=>String(s.title||"").toLowerCase()));
  let extra=diff;
  for(const gentle of ADAPT_RECOVERY_STEPS){
    if(extra<90) break;
    if(used.has(gentle.title.toLowerCase())) continue;
    const slotSec=Math.min(180,extra);
    filler.push({...gentle,type:"work",slotSec,adaptive:true,recovery:true});
    used.add(gentle.title.toLowerCase());
    extra-=slotSec;
  }
  if(extra>0) candidates[0].slotSec+=extra;
  const newSteps=kept.slice(0,1).concat(candidates,filler,kept.slice(1));
  const target=base.totalSec || base.steps.reduce((sum,s)=>sum+Number(s.slotSec||0),0);
  const total=newSteps.reduce((sum,s)=>sum+Number(s.slotSec||0),0);
  if(total!==target) candidates[candidates.length-1].slotSec+=target-total;
  const equipment=[...new Set([...(base.equipment||[]),...candidates.flatMap(s=>s.equipment||[]),...filler.flatMap(s=>s.equipment||[])])];
  adaptInfo={
    tags:[...new Set(candidates.flatMap(c=>c.adaptiveFor||[]))],
    added:[...candidates,...filler].map(c=>c.title),
    removed:removed.map(g=>g.title),
    reason:"14-day balance: adding undertrained categories"
  };
  return {...base,focus:"Balanced · "+base.focus,equipment,steps:newSteps,totalSec:target};
}

function adaptGetDisplayDay(){
  return adaptBuildDay(currentDayKey);
}
function adaptRenderCard(){
  const card=document.getElementById("adaptiveCard");
  if(!card) return;
  if(currentDayKey!==dayKeyFromToday() || !adaptInfo){
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  document.getElementById("adaptiveReason").textContent=adaptInfo.reason;
  document.getElementById("adaptiveChanges").innerHTML=
    '<div><strong>Added</strong><br>'+adaptInfo.added.join(" · ")+'</div>'+
    '<div><strong>Moved out today</strong><br>'+(adaptInfo.removed.length?adaptInfo.removed.join(" · "):"Nothing")+'</div>';
  document.getElementById("normalWorkoutBtn").textContent=adaptUseNormalToday?"Use adapted workout":"Use normal workout";
}
renderHome = function(){
  const day=adaptGetDisplayDay();
  $("#dayTitle").textContent=day.label;
  $("#focusText").textContent=day.focus;
  const heroTime=document.querySelector(".hero-card .big-time");
  if(heroTime) heroTime.textContent=fmt(day.totalSec || day.steps.reduce((sum,s)=>sum+Number(s.slotSec||0),0));
  $("#laterText").textContent=day.later ? day.later : "";
  $("#laterText").style.display=day.later ? "block" : "none";
  $("#exerciseCount").textContent=nonRestSteps(day).length+" blocks";
  $("#equipmentList").innerHTML=(day.equipment||[]).map(x=>'<span class="chip">'+x+'</span>').join("");
  $("#previewList").innerHTML=day.steps.map(s=>{
    if(s.type==="rest") return '<li class="rest-preview">'+s.title+' · '+fmt(s.slotSec)+'</li>';
    const badge=s.adaptive ? ' <span class="adaptive-badge">ADDED</span>' : "";
    return '<li><strong>'+s.title+'</strong>'+badge+' <span class="muted">· '+fmt(s.slotSec)+'</span><br><span class="muted tiny">'+(s.details||"")+'</span></li>';
  }).join("");
  renderGymPlan(day);
  adaptRenderGymToday();
  $("#startBtn").textContent="START "+fmt(day.totalSec || day.steps.reduce((sum,s)=>sum+(s.slotSec||0),0));
  adaptRenderCard();
  adaptRenderWeeklyBalance();
  renderDayTabs();
  document.querySelectorAll("#dayTabs .day-tab").forEach((tab,index)=>{
    const date=adaptDateForDayKey(WEEK[index]);
    const entry=adaptGymEntry(date);
    if(!entry) return;
    tab.textContent+=" ●";
    tab.classList.add("gym-day-mark",entry.log.status==="done"?"gym-day-done":"gym-day-planned");
    tab.title+=(entry.log.status==="done"?" · Gym completed":" · Gym planned");
  });
};
function adaptPendingGymPrompt(){
  const today=localDateKey(),gyms=readJson(ADAPT_GYM_LOG_KEY,{});
  const dates=Object.keys(gyms).filter(d=>d<today && adaptDaysBetween(d,today)<=7 && gyms[d]?.status==="planned").sort();
  if(!dates.length) return null;
  const date=dates[0], log=gyms[date], plan=adaptGymTemplate(adaptGymTemplateKey(log));
  return {date,dayKey:log.dayKey||adaptDayKeyForDateKey(date),plan};
}
function adaptMaybeShowGymPrompt(){
  const pending=adaptPendingGymPrompt(), modal=document.getElementById("gymPrompt");
  if(!modal) return;
  if(!pending){modal.classList.add("hidden");return;}
  modal.dataset.date=pending.date;
  modal.dataset.day=pending.dayKey;
  document.getElementById("gymPromptTitle").textContent="Did you go to the gym?";
  document.getElementById("gymPromptText").textContent=pending.date+" · "+pending.plan.label+". Confirm actual attendance so the next workouts recover properly.";
  modal.classList.remove("hidden");
}
function adaptSaveGymAnswer(went){
  const modal=document.getElementById("gymPrompt"),date=modal?.dataset?.date;
  if(!date) return;
  const logs=readJson(ADAPT_GYM_LOG_KEY,{}),prior=logs[date]||{};
  const template=adaptGymTemplate(adaptGymTemplateKey(prior));
  logs[date]={...prior,dayKey:prior.dayKey||adaptDayKeyForDateKey(date),templateKey:template.key,
    status:went?"done":"skipped",coverage:{...template.coverage},label:template.label,loggedAt:new Date().toISOString()};
  writeJson(ADAPT_GYM_LOG_KEY,logs);
  modal.classList.add("hidden");
  adaptUseNormalToday=false;
  renderHome();
  adaptMaybeShowGymPrompt();
}
function adaptRenderSessionReview(){
  const wrap=document.getElementById("sessionReviewList");
  if(!wrap) return;
  adaptPendingReview=(steps||[]).map((s,i)=>{
    if(s.type==="rest") return null;
    const scheme=repScheme(s);
    let status=null;
    if(scheme){
      const drafts=readJson(PROGRESS_DRAFT_KEY,{});
      const d=drafts[draftKey(currentDayKey,s.title)];
      const completed=((d && d.reps)||[]).filter(v=>Number(v)>0).length;
      status=completed>=scheme.sets ? "full" : completed>0 ? "partial" : null;
    }
    if(!status){
      const actual=Math.min(Number(s.slotSec||0),Number(adaptSessionActualSec[i]||0));
      const ratio=s.slotSec ? actual/s.slotSec : 0;
      status=ratio>=.8 ? "full" : ratio>=.15 ? "partial" : "skipped";
    }
    const meta=adaptStepMeta(s);
    return {title:s.title,status:status,actualSec:Math.min(Number(s.slotSec||0),Number(adaptSessionActualSec[i]||0)),plannedSec:Number(s.slotSec||0),tags:meta.tags,protected:meta.protected,adaptiveFor:s.adaptiveFor||[],adaptive:!!s.adaptive};
  }).filter(Boolean);

  wrap.innerHTML=adaptPendingReview.map((r,ri)=>{
    return '<div class="review-row" data-review="'+ri+'">'+
      '<div class="review-copy"><strong>'+r.title+'</strong><span class="tiny muted">'+fmt(r.actualSec)+' / '+fmt(r.plannedSec)+'</span></div>'+
      '<div class="review-status">'+
        '<button class="review-choice '+(r.status==="full"?"active":"")+'" data-status="full">✓ Full</button>'+
        '<button class="review-choice '+(r.status==="partial"?"active":"")+'" data-status="partial">◐ Partial</button>'+
        '<button class="review-choice '+(r.status==="skipped"?"active":"")+'" data-status="skipped">✕ Skip</button>'+
      '</div></div>';
  }).join("");
  wrap.querySelectorAll(".review-choice").forEach(btn=>{
    btn.onclick=()=>{
      const row=btn.closest(".review-row");
      const ri=Number(row.dataset.review);
      adaptPendingReview[ri].status=btn.dataset.status;
      row.querySelectorAll(".review-choice").forEach(x=>x.classList.toggle("active",x===btn));
    };
  });
}
function adaptSaveSessionReview(){
  if(!adaptPendingReview) return;
  const logs=readJson(ADAPT_SESSION_LOG_KEY,{});
  logs[localDateKey()]={
    dayKey:currentDayKey,
    savedAt:new Date().toISOString(),
    adaptive:adaptPendingReview.some(x=>x.adaptive),
    steps:adaptPendingReview.map(x=>({title:x.title,status:x.status,actualSec:x.actualSec,plannedSec:x.plannedSec,tags:x.tags,protected:x.protected,adaptiveFor:x.adaptiveFor}))
  };
  writeJson(ADAPT_SESSION_LOG_KEY,logs);
  commitCompletedProgressForDay();
  adaptPendingReview=null;
  adaptUseNormalToday=false;
  exitSession();
  renderHome();
}
function adaptFinalizeCurrentVisit(){
  if(!steps || !steps[stepIndex]) return;
  adaptSessionActualSec[stepIndex]=(adaptSessionActualSec[stepIndex]||0)+Math.max(0,stepElapsed||0);
  stepElapsed=0;
}
commitCompletedProgressForDay = function(){
  const drafts=readJson(PROGRESS_DRAFT_KEY,{});
  const history=readJson(PROGRESS_HISTORY_KEY,{});
  const prefix=localDateKey()+"::"+currentDayKey+"::";
  Object.entries(drafts).forEach(entry=>{
    const dKey=entry[0], draft=entry[1];
    if(!dKey.startsWith(prefix)) return;
    const title=dKey.slice(prefix.length);
    const step=(steps||[]).find(s=>s.title===title) || ((PROGRAM.days[currentDayKey] && PROGRAM.days[currentDayKey].steps)||[]).find(s=>s.title===title);
    const scheme=repScheme(step);
    if(!scheme) return;
    const reps=(draft.reps||[]).map(Number);
    if(reps.length!==scheme.sets || reps.some(v=>!Number.isFinite(v) || v<=0)) return;
    history[exerciseKey(currentDayKey,title)]={date:localDateKey(),weight:draft.weight||"",reps:reps};
  });
  writeJson(PROGRESS_HISTORY_KEY,history);
};
startSession = async function(){
  setupAudio();
  sessionHistorySnapshot=readJson(PROGRESS_HISTORY_KEY,{});
  const day=adaptGetDisplayDay();
  steps=day.steps.map(s=>Object.assign({},s));
  adaptSessionActualSec=Array(steps.length).fill(0);
  stepIndex=0;
  stepRemaining=steps[0].slotSec;
  stepElapsed=0;
  adaptSessionTotalSec=day.totalSec || steps.reduce((a,b)=>a+b.slotSec,0);
  totalRemaining=adaptSessionTotalSec;
  homeView.classList.add("hidden"); doneView.classList.add("hidden"); sessionView.classList.remove("hidden");
  await requestFullscreen();
  await requestWakeLock();
  running=true;
  $("#pauseBtn").textContent="Pause";
  renderStep();
  clearInterval(timerId);
  timerId=setInterval(tick,1000);
};
advanceStep = function(){
  adaptFinalizeCurrentVisit();
  if(stepIndex>=steps.length-1){
    finishSession(false,true);
    return;
  }
  stepIndex++;
  stepRemaining=steps[stepIndex].slotSec;
  stepElapsed=0;
  beep(steps[stepIndex].type==="rest" ? "rest" : "next");
  renderStep();
};
previousStep = function(){
  if(stepIndex<=0) return;
  adaptFinalizeCurrentVisit();
  totalRemaining+=(steps[stepIndex].slotSec-stepRemaining);
  stepIndex--;
  stepRemaining=steps[stepIndex].slotSec;
  stepElapsed=0;
  renderStep();
};
skipStep = function(){
  totalRemaining-=stepRemaining;
  if(totalRemaining<0) totalRemaining=0;
  advanceStep();
};
renderTimers = function(){
  $("#stepTimer").textContent=fmt(stepRemaining);
  $("#totalLeft").textContent=fmt(totalRemaining);
  const total=adaptSessionTotalSec || 1800;
  $("#overallBar").style.width=Math.min(100,Math.max(0,(1-totalRemaining/total)*100))+"%";
};
finishSession = async function(early,alreadyFinalized){
  if(!alreadyFinalized) adaptFinalizeCurrentVisit();
  running=false;
  clearInterval(timerId);
  timerId=null;
  if(!early){ totalRemaining=0; renderTimers(); beep("done"); }
  if(wakeLock){ try{ await wakeLock.release(); }catch(e){} wakeLock=null; }
  sessionView.classList.add("hidden");
  doneView.classList.remove("hidden");
  adaptRenderSessionReview();
};

function adaptBindUI(){
  const normal=document.getElementById("normalWorkoutBtn");
  const yes=document.getElementById("gymYesBtn");
  const no=document.getElementById("gymNoBtn");
  if(normal) normal.onclick=()=>{ adaptUseNormalToday=!adaptUseNormalToday; renderHome(); };
  if(yes) yes.onclick=()=>adaptSaveGymAnswer(true);
  if(no) no.onclick=()=>adaptSaveGymAnswer(false);
  const todayBtn=document.getElementById("gymTodayToggle");
  const doneBtn=document.getElementById("gymTodayDoneBtn");
  const templateSelect=document.getElementById("gymTemplateSelect");
  const yesterdayBtn=document.getElementById("gymYesterdayToggle");
  if(yesterdayBtn) yesterdayBtn.onclick=()=>{
    if(currentDayKey===dayKeyFromToday()) adaptToggleYesterdayGym(templateSelect?.value);
  };
  if(todayBtn) todayBtn.onclick=()=>{
    if(currentDayKey!==dayKeyFromToday()) return;
    const log=adaptGymEntry(localDateKey());
    adaptSetGymToday(!log,templateSelect?.value);
  };
  if(doneBtn) doneBtn.onclick=adaptMarkGymDoneToday;
  if(templateSelect) templateSelect.onchange=()=>{
    if(currentDayKey!==dayKeyFromToday()) return;
    adaptSelectedGymType=templateSelect.value;
    if(adaptGymEntry(localDateKey())) adaptSetGymToday(true,adaptSelectedGymType);
    else adaptRenderGymToday();
  };
  $("#startBtn").onclick=startSession;
  $("#nextBtn").onclick=skipStep;
  $("#prevBtn").onclick=previousStep;
  $("#exitBtn").onclick=()=>finishSession(true,false);
  $("#doneBtn").onclick=adaptSaveSessionReview;
}
adaptBindUI();

(function adaptBoot(){
  if(PROGRAM){
    renderHome();
    adaptMaybeShowGymPrompt();
    return;
  }
  setTimeout(adaptBoot,120);
})();
