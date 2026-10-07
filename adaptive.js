// Adaptive weekly training layer.
// Tracks what was actually completed, asks about yesterday's gym,
// and reshapes today's 30-minute morning session around missed work.

const ADAPT_SESSION_LOG_KEY = "workoutSessionLogV2";
const ADAPT_GYM_LOG_KEY = "workoutGymLogV1";
const ADAPT_TOP_PRIORITIES = ["quads","biceps","triceps","hips","posture"];
const ADAPT_BALANCE_TAGS = ["quads","biceps","triceps","hips","posture","hamstrings","glutes","back","shoulders","core"];
const ADAPT_PRIORITY_RANK = {quads:0,biceps:0,triceps:0,hips:0,posture:0,hamstrings:1,glutes:1,back:1,shoulders:1,core:2,skill:2,conditioning:3,mobility:3};

let adaptSessionActualSec = [];
let adaptSessionTotalSec = 1800;
let adaptPendingReview = null;
let adaptInfo = null;
let adaptUseNormalToday = false;

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
function adaptStepMeta(step){
  const t=(step && step.title ? step.title : "").toLowerCase();
  const tags=[];
  let protectedStep=false;
  if(t.includes("360° breathing") || t.includes("pelvic floor")){ tags.push("core"); protectedStep=true; }
  if(t.includes("deep core + control primer")){ tags.push("core"); protectedStep=true; }
  if(t.includes("chin tuck") || t.includes("wall slide") || t.includes("y–t–w") || t.includes("y-t-w") || t.includes("reverse snow angel") || t.includes("face pull") || t.includes("deep squat + overhead reach")) tags.push("posture");
  if(t.includes("90/90") || t.includes("hip airplane") || t.includes("copenhagen") || t.includes("side plank leg raise") || t.includes("reverse lunge") || t.includes("half-kneeling") || t.includes("turkish get-up") || t.includes("deep squat + overhead reach")) tags.push("hips");
  if(t.includes("curl")) tags.push("biceps");
  if(t.includes("triceps") || t.includes("close-grip")) tags.push("triceps");
  if(t.includes("goblet squat") || t.includes("split squat") || t.includes("step-up") || t.includes("hack squat") || t.includes("leg press") || t.includes("leg extension") || t.includes("cyclist squat") || t.includes("reverse lunge") || t.includes("thruster")) tags.push("quads");
  if(t.includes("split squat") || t.includes("step-up") || t.includes("deadlift") || t.includes("back extension") || t.includes("reverse lunge") || t.includes("thruster")) tags.push("glutes");
  if(t.includes("hamstring curl") || t.includes("romanian deadlift") || t.includes("deadlift") || t.includes("back extension")) tags.push("hamstrings");
  if(t.includes("pull-up") || t.includes("pull up") || t.includes("row") || t.includes("pulldown")) tags.push("back");
  if(t.includes("lateral raise") || t.includes("shoulder press") || t.includes("pike push") || t.includes("handstand") || t.includes("rear-delt") || t.includes("halo") || t.includes("thruster") || t.includes("turkish get-up") || t.includes("deep squat + overhead reach")) tags.push("shoulders");
  if(t.includes("dead bug") || t.includes("dead-bug") || t.includes("hollow") || t.includes("reverse crunch") || t.includes("l-sit") || t.includes("ab wheel") || t.includes("turkish get-up")) tags.push("core");
  if(t.includes("handstand") || t.includes("l-sit")) tags.push("skill");
  if(t.includes("burpee") || t.includes("conditioning") || t.includes("mountain climber") || t.includes("thruster")) tags.push("conditioning");
  if(t.includes("stretch") || t.includes("forward fold") || t.includes("hamstring sweep") || t.includes("ankle rock") || t.includes("open book") || t.includes("yoga") || t.includes("chair pose") || t.includes("warrior") || t.includes("goddess") || t.includes("star pose") || t.includes("halo") || t.includes("deep squat + overhead reach")) tags.push("mobility");
  if(t.includes("windmill")) tags.push("hips","hamstrings","shoulders","core","mobility");
  if(t.includes("clean → front-rack reverse lunge") || t.includes("clean -> front-rack reverse lunge")) tags.push("core","conditioning");
  if(t.includes("bear-plank db drag")) tags.push("hips","shoulders","core","conditioning");
  if(t.includes("suitcase march")) tags.push("hips","core","conditioning");
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
function adaptGymPlanForDay(dayKey){
  const later=PROGRAM && PROGRAM.days && PROGRAM.days[dayKey] ? (PROGRAM.days[dayKey].later || "") : "";
  if(!/gym/i.test(later)) return null;
  const tx=later.toLowerCase();
  const coverage={};
  if(/hack squat|leg press|cyclist squat|split squat|leg extension/.test(tx)) coverage.quads=3;
  if(/hamstring curl|rdl|romanian|back extension/.test(tx)){ coverage.hamstrings=1.5; coverage.glutes=1; }
  if(/pull-up|pull up|row|face pull/.test(tx)) coverage.back=2;
  if(/face pull|rear-delt/.test(tx)) coverage.posture=.5;
  if(/curl/.test(tx)) coverage.biceps=1;
  if(/triceps|dip/.test(tx)) coverage.triceps=1;
  return {label:later.replace(/^Evening gym:\s*/i,""),coverage:coverage};
}
function adaptCalculateDebt(){
  const debt={};
  ADAPT_BALANCE_TAGS.forEach(t=>debt[t]=0);
  debt.skill=0; debt.conditioning=0; debt.mobility=0;
  const sessions=readJson(ADAPT_SESSION_LOG_KEY,{});
  const gyms=readJson(ADAPT_GYM_LOG_KEY,{});
  const start=adaptWeekStartKey(), end=localDateKey();
  const dates=[...new Set([...Object.keys(sessions),...Object.keys(gyms)])].filter(d=>d>=start && d<=end).sort();
  const sub=(tag,amount)=>{ debt[tag]=Math.max(0,(debt[tag]||0)-amount); };
  const add=(tag,amount)=>{ debt[tag]=Math.min(5,(debt[tag]||0)+amount); };
  dates.forEach(date=>{
    const log=sessions[date];
    if(log && log.steps){
      log.steps.forEach(st=>{
        const completion=st.status==="full" ? 1 : st.status==="partial" ? .5 : 0;
        const tags=st.tags || [];
        if(st.adaptiveFor && st.adaptiveFor.length){
          st.adaptiveFor.forEach(tag=>sub(tag,completion));
          return;
        }
        if(st.protected) return;
        tags.forEach(tag=>{
          if(ADAPT_PRIORITY_RANK[tag]===undefined) return;
          const w=adaptDebtWeight(tag);
          if(completion>0) sub(tag,completion*w*.8);
          if(completion<1) add(tag,(1-completion)*w);
        });
      });
    }
    const gym=gyms[date];
    if(gym && gym.coverage){
      Object.entries(gym.coverage).forEach(entry=>{
        const tag=entry[0], amount=Number(entry[1])||0;
        if(gym.status==="done") sub(tag,amount);
        else if(gym.status==="skipped") add(tag,amount);
      });
    }
  });
  return debt;
}
function adaptBalanceLabel(value){
  if(value>=1.5) return ["Missing work","missing"];
  if(value>=.45) return ["Needs attention","attention"];
  return ["On plan","ok"];
}
function adaptRenderWeeklyBalance(){
  const wrap=document.getElementById("weeklyBalanceList");
  if(!wrap) return;
  const debt=adaptCalculateDebt();
  wrap.innerHTML=ADAPT_BALANCE_TAGS.map(tag=>{
    const state=adaptBalanceLabel(debt[tag]||0);
    const name=tag.charAt(0).toUpperCase()+tag.slice(1);
    return '<div class="balance-row"><strong>'+name+'</strong><span class="balance-state '+state[1]+'">'+state[0]+'</span></div>';
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
      {title:"Short-Stance DB Split Squat",type:"work",slotSec:360,details:"3 × 8–12 / leg. Short stance, upright torso, let the front knee travel forward comfortably. Keep 2–3 RIR and avoid grinding.",adaptiveFor:["quads"],equipment:["2 dumbbells"]},
      {title:"Goblet Squat",type:"work",slotSec:300,details:"3 × 10–15. Hold one dumbbell at the chest. Use comfortable depth, controlled lowering and 2–3 RIR.",adaptiveFor:["quads"],equipment:["1 dumbbell"]},
      {title:"Stable Step-Ups",type:"work",slotSec:300,details:"3 × 10–15 / leg. Use a genuinely stable low step/platform, not an unstable chair. Drive through the working leg and minimise push-off from the floor.",adaptiveFor:["quads"],equipment:["2 dumbbells","Stable step/platform"]}
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
      {title:"Knee-Supported Copenhagen Plank",type:"work",slotSec:180,details:"2 × 20–30 s / side. Use the short-lever knee-supported version and keep the pelvis controlled.",adaptiveFor:["hips"],equipment:["Stable bench/table"]}
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
  const base=PROGRAM.days[dayKey];
  if(!base) return base;
  if(dayKey!==dayKeyFromToday()){ adaptInfo=null; return base; }
  if(adaptUseNormalToday) return base;
  adaptInfo=null;
  const logs=readJson(ADAPT_SESSION_LOG_KEY,{});
  if(logs[localDateKey()]) return base;

  const debt=adaptCalculateDebt();
  const tomorrow=WEEK[(WEEK.indexOf(dayKey)+1)%7];
  const usedTitles=new Set((base.steps||[]).filter(s=>s.type!=="rest").map(s=>s.title.toLowerCase()));
  const yesterdayTitles=adaptYesterdayPerformedTitles();
  const candidates=[];
  let budget=960;

  const ordered=Object.keys(debt).filter(tag=>(debt[tag]||0)>=.45).sort((a,b)=>{
    const ra=ADAPT_PRIORITY_RANK[a]===undefined?9:ADAPT_PRIORITY_RANK[a];
    const rb=ADAPT_PRIORITY_RANK[b]===undefined?9:ADAPT_PRIORITY_RANK[b];
    if(ra!==rb) return ra-rb;
    return (debt[b]||0)-(debt[a]||0);
  });

  ordered.forEach(tag=>{
    if(budget<150) return;
    if(adaptHasPlannedTag(dayKey,tag,true)) return;
    if((ADAPT_PRIORITY_RANK[tag]===undefined?9:ADAPT_PRIORITY_RANK[tag])>0 && adaptHasPlannedTag(tomorrow,tag,true)) return;
    if(ADAPT_TOP_PRIORITIES.includes(tag) && adaptHasPlannedTag(tomorrow,tag,true) && (debt[tag]||0)<1.5) return;
    let count=1;
    if(tag==="quads" && debt[tag]>=2) count=Math.min(3,Math.ceil(debt[tag]));
    for(let i=0;i<count;i++){
      const c=adaptPickCandidate(tag,usedTitles,yesterdayTitles);
      if(!c || c.slotSec>budget) break;
      candidates.push(Object.assign({},c,{adaptive:true}));
      usedTitles.add(c.title.toLowerCase());
      budget-=c.slotSec;
    }
  });
  if(!candidates.length) return base;

  const groups=[];
  let pendingRest=[];
  (base.steps||[]).forEach((s,i)=>{
    if(s.type==="rest"){ pendingRest.push(i); return; }
    const meta=adaptStepMeta(s);
    const inds=pendingRest.concat([i]);
    groups.push({indices:inds,sec:inds.reduce((sum,j)=>sum+Number(base.steps[j].slotSec||0),0),meta:meta,title:s.title});
    pendingRest=[];
  });

  let insertedSec=candidates.reduce((a,s)=>a+s.slotSec,0);
  const removable=groups.filter(g=>!g.meta.protected && g.meta.priority>0).sort((a,b)=>{
    if(a.meta.priority!==b.meta.priority) return b.meta.priority-a.meta.priority;
    return b.sec-a.sec;
  });
  const removed=[];
  let removedSec=0;
  for(const g of removable){
    if(removedSec>=insertedSec) break;
    removed.push(g);
    removedSec+=g.sec;
  }
  while(candidates.length && candidates.reduce((a,s)=>a+s.slotSec,0)>removedSec) candidates.pop();
  if(!candidates.length) return base;
  insertedSec=candidates.reduce((a,s)=>a+s.slotSec,0);

  const removeIndexes=new Set(removed.flatMap(g=>g.indices));
  const kept=(base.steps||[]).filter((_,i)=>!removeIndexes.has(i)).map(s=>Object.assign({},s));
  const diff=removedSec-insertedSec;
  if(diff>0){
    const each=Math.floor(diff/candidates.length), rem=diff%candidates.length;
    candidates.forEach((s,i)=>s.slotSec+=each+(i<rem?1:0));
  }
  const newSteps=kept.slice(0,1).concat(candidates,kept.slice(1));
  const total=newSteps.reduce((a,s)=>a+Number(s.slotSec||0),0);
  if(total!==1800) candidates[candidates.length-1].slotSec+=1800-total;

  const equipment=(base.equipment||[]).slice();
  candidates.flatMap(c=>c.equipment||[]).forEach(x=>{ if(!equipment.includes(x)) equipment.push(x); });
  const tags=[...new Set(candidates.flatMap(c=>c.adaptiveFor||[]))];
  adaptInfo={
    tags:tags,
    added:candidates.map(c=>c.title),
    removed:removed.map(g=>g.title),
    reason:"Recovering missed work: "+tags.map(t=>t.charAt(0).toUpperCase()+t.slice(1)).join(" · ")
  };
  return Object.assign({},base,{focus:"Adapted · "+base.focus,equipment:equipment,steps:newSteps,totalSec:1800});
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
  $("#laterText").textContent=day.later ? day.later : "";
  $("#laterText").style.display=day.later ? "block" : "none";
  $("#exerciseCount").textContent=nonRestSteps(day).length+" blocks";
  $("#equipmentList").innerHTML=(day.equipment||[]).map(x=>'<span class="chip">'+x+'</span>').join("");
  $("#previewList").innerHTML=day.steps.map(s=>{
    if(s.type==="rest") return '<li class="rest-preview">'+s.title+' · '+fmt(s.slotSec)+'</li>';
    const badge=s.adaptive ? ' <span class="adaptive-badge">ADDED</span>' : "";
    return '<li><strong>'+s.title+'</strong>'+badge+' <span class="muted">· '+fmt(s.slotSec)+'</span><br><span class="muted tiny">'+(s.details||"")+'</span></li>';
  }).join("");
  adaptRenderCard();
  adaptRenderWeeklyBalance();
  renderDayTabs();
};
function adaptPendingGymPrompt(){
  const date=adaptDateKeyForOffset(-1);
  const dayKey=adaptDayKeyForDateKey(date);
  const plan=adaptGymPlanForDay(dayKey);
  if(!plan) return null;
  const logs=readJson(ADAPT_GYM_LOG_KEY,{});
  if(logs[date]) return null;
  return {date:date,dayKey:dayKey,plan:plan};
}
function adaptMaybeShowGymPrompt(){
  const pending=adaptPendingGymPrompt();
  const modal=document.getElementById("gymPrompt");
  if(!modal) return;
  if(!pending){ modal.classList.add("hidden"); return; }
  modal.dataset.date=pending.date;
  modal.dataset.day=pending.dayKey;
  document.getElementById("gymPromptText").textContent=PROGRAM.days[pending.dayKey].label+": "+pending.plan.label;
  modal.classList.remove("hidden");
}
function adaptSaveGymAnswer(went){
  const modal=document.getElementById("gymPrompt");
  const date=modal && modal.dataset ? modal.dataset.date : null;
  const dayKey=modal && modal.dataset ? modal.dataset.day : null;
  if(!date || !dayKey) return;
  const plan=adaptGymPlanForDay(dayKey);
  const logs=readJson(ADAPT_GYM_LOG_KEY,{});
  logs[date]={dayKey:dayKey,status:went?"done":"skipped",coverage:plan?plan.coverage:{},label:plan?plan.label:"Gym",loggedAt:new Date().toISOString()};
  writeJson(ADAPT_GYM_LOG_KEY,logs);
  modal.classList.add("hidden");
  adaptUseNormalToday=false;
  renderHome();
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
