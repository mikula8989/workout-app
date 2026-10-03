const $ = (s) => document.querySelector(s);
const homeView = $("#homeView"), sessionView = $("#sessionView"), doneView = $("#doneView");

let PROGRAM = null;
let currentDayKey = null;
let steps = [];
let stepIndex = 0;
let stepRemaining = 0;
let stepElapsed = 0;
let totalRemaining = 1800;
let timerId = null;
let running = false;
let soundEnabled = true;
let wakeLock = null;
let deferredPrompt = null;
let sessionHistorySnapshot = {};
const WEEK = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const ABBR = ["M","T","W","T","F","S","S"];
const PROGRESS_HISTORY_KEY = "workoutProgressHistoryV1";
const PROGRESS_DRAFT_KEY = "workoutProgressDraftV1";
const SESSION_LOG_KEY = "workoutSessionLogV2";
const GYM_LOG_KEY = "workoutGymLogV1";
const TOP_PRIORITIES = ["quads","biceps","triceps","hips","posture"];
const BALANCE_TAGS = ["quads","biceps","triceps","hips","posture","hamstrings","glutes","back","shoulders","core"];
const PRIORITY_RANK = {quads:0,biceps:0,triceps:0,hips:0,posture:0,hamstrings:1,glutes:1,back:1,shoulders:1,core:2,skill:2,conditioning:3,mobility:3};
let sessionActualSec = [];
let sessionTotalSec = 1800;
let pendingReview = null;
let adaptiveInfo = null;
let useNormalToday = false;

function fmt(sec){
  sec = Math.max(0, Math.round(sec));
  return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
}
function dayKeyFromToday(){
  const js = new Date().getDay();
  return WEEK[(js + 6) % 7];
}
function localDateKey(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function readJson(key, fallback={}){
  try{ return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch(_){ return fallback; }
}
function writeJson(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch(_){}
}
function exerciseKey(dayKey, title){
  return `${dayKey}::${title}`;
}
function draftKey(dayKey, title){
  return `${localDateKey()}::${exerciseKey(dayKey,title)}`;
}
function nonRestSteps(day){
  return day.steps.filter(s => s.type !== "rest");
}
function renderDayTabs(){
  const wrap = $("#dayTabs"); wrap.innerHTML = "";
  WEEK.forEach((d,i)=>{
    const b = document.createElement("button");
    b.className = "day-tab" + (d === currentDayKey ? " active" : "");
    b.textContent = ABBR[i];
    b.title = PROGRAM.days[d].label;
    b.onclick = ()=>{ currentDayKey=d; renderHome(); };
    wrap.appendChild(b);
  });
}
function renderHome(){
  const day = PROGRAM.days[currentDayKey];
  $("#dayTitle").textContent = day.label;
  $("#focusText").textContent = day.focus;
  $("#laterText").textContent = day.later ? day.later : "";
  $("#laterText").style.display = day.later ? "block" : "none";
  $("#exerciseCount").textContent = `${nonRestSteps(day).length} blocks`;
  $("#equipmentList").innerHTML = day.equipment.map(x=>`<span class="chip">${x}</span>`).join("");
  $("#previewList").innerHTML = day.steps.map(s=>{
    if(s.type === "rest") return `<li class="rest-preview">${s.title} · ${fmt(s.slotSec)}</li>`;
    return `<li><strong>${s.title}</strong> <span class="muted">· ${fmt(s.slotSec)}</span><br><span class="muted tiny">${s.details}</span></li>`;
  }).join("");
  renderDayTabs();
}

function mergeProgram(base, patch){
  if(!patch) return base;
  const merged = {...base, ...patch, days:{...(base.days || {})}};
  Object.entries(patch.days || {}).forEach(([key, value])=>{
    merged.days[key] = {...(base.days?.[key] || {}), ...value};
  });
  return merged;
}

async function loadProgram(){
  try{
    const res = await fetch("./program.json", {cache:"no-store"});
    PROGRAM = await res.json();

    for(const file of ["./program-overrides.json", "./gym-overrides.json"]){
      try{
        const overrideRes = await fetch(file, {cache:"no-store"});
        if(overrideRes.ok) PROGRAM = mergeProgram(PROGRAM, await overrideRes.json());
      }catch(_){}
    }
  }catch(e){
    const cached = localStorage.getItem("workoutProgram");
    if(cached) PROGRAM = JSON.parse(cached);
    else throw e;
  }
  localStorage.setItem("workoutProgram", JSON.stringify(PROGRAM));
  currentDayKey = dayKeyFromToday();
  renderHome();
}

function repScheme(step){
  if(step?.progression?.sets && step?.progression?.minReps && step?.progression?.maxReps){
    return {
      sets:Number(step.progression.sets),
      min:Number(step.progression.minReps),
      max:Number(step.progression.maxReps)
    };
  }
  const text = step?.details || "";
  const m = text.match(/(\d+)\s*[×x]\s*(\d+)\s*[–-]\s*(\d+)/i);
  if(!m) return null;
  const after = text.slice((m.index || 0) + m[0].length);
  if(/^\s*s\b/i.test(after)) return null;
  return {sets:Number(m[1]), min:Number(m[2]), max:Number(m[3])};
}

function progressionState(step){
  const scheme = repScheme(step);
  if(!scheme) return null;
  const key = exerciseKey(currentDayKey, step.title);
  const dKey = draftKey(currentDayKey, step.title);
  const drafts = readJson(PROGRESS_DRAFT_KEY, {});
  const previous = sessionHistorySnapshot[key] || null;
  const draft = drafts[dKey] || {
    weight: previous?.weight ?? "",
    reps: Array(scheme.sets).fill("")
  };
  while(draft.reps.length < scheme.sets) draft.reps.push("");
  draft.reps = draft.reps.slice(0, scheme.sets);
  return {scheme, key, dKey, draft, previous};
}

function saveProgressDraft(state){
  const drafts = readJson(PROGRESS_DRAFT_KEY, {});
  drafts[state.dKey] = state.draft;
  writeJson(PROGRESS_DRAFT_KEY, drafts);
}

function progressionMessage(state){
  const reps = state.draft.reps.map(v=>Number(v)).filter(v=>Number.isFinite(v) && v>0);
  const complete = reps.length === state.scheme.sets;
  const allTop = complete && reps.every(v=>v >= state.scheme.max);
  const previousReps = (state.previous?.reps || []).map(Number).filter(v=>Number.isFinite(v) && v>0);
  const prevTotal = previousReps.reduce((a,b)=>a+b,0);
  const todayTotal = reps.reduce((a,b)=>a+b,0);

  if(allTop){
    return {text:`✓ ${state.scheme.max} reps reached on every set. Next session: increase the weight by the smallest practical step.`, ready:true};
  }
  if(previousReps.length === state.scheme.sets){
    if(complete && todayTotal > prevTotal){
      return {text:`Progress: ${todayTotal} total reps vs ${prevTotal} last time. Keep this weight until every set reaches ${state.scheme.max}.`, ready:false};
    }
    return {text:`Goal: beat ${prevTotal} total clean reps at the same weight, even if it is only +1 rep across the whole exercise.`, ready:false};
  }
  return {text:`First tracked session: record every set. Stay around 1–2 RIR and build toward ${state.scheme.max} reps on every set.`, ready:false};
}

function renderProgression(step){
  const box = $("#progressionBox");
  const state = progressionState(step);
  if(!state || step.type === "rest"){
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");
  $("#progressionTarget").textContent = `${state.scheme.sets} sets · target ${state.scheme.min}–${state.scheme.max} reps`;
  $("#progressWeight").value = state.draft.weight ?? "";

  if(state.previous?.reps?.length){
    const w = state.previous.weight ? `${state.previous.weight} kg · ` : "";
    const total = state.previous.reps.map(Number).reduce((a,b)=>a+(Number.isFinite(b)?b:0),0);
    $("#previousPerformance").innerHTML = `<strong>Previous:</strong> ${w}${state.previous.reps.join(" / ")} <span class="muted">(${total} total)</span>`;
  }else{
    $("#previousPerformance").innerHTML = `<strong>Previous:</strong> no tracked session yet`;
  }

  $("#setInputs").style.gridTemplateColumns = `repeat(${Math.min(state.scheme.sets,4)}, minmax(0,1fr))`;
  $("#setInputs").innerHTML = state.draft.reps.map((value,i)=>`
    <label class="set-entry">
      <span>SET ${i+1}</span>
      <input class="set-rep-input" data-set="${i}" type="number" inputmode="numeric" min="0" max="50" step="1" placeholder="–" value="${value}">
    </label>`).join("");

  function refreshGoal(){
    const msg = progressionMessage(state);
    $("#progressionGoal").textContent = msg.text;
    $("#progressionGoal").classList.toggle("ready", msg.ready);
  }

  $("#progressWeight").oninput = (e)=>{
    state.draft.weight = e.target.value;
    saveProgressDraft(state);
    refreshGoal();
  };
  document.querySelectorAll(".set-rep-input").forEach(input=>{
    input.oninput = (e)=>{
      const i = Number(e.target.dataset.set);
      state.draft.reps[i] = e.target.value;
      saveProgressDraft(state);
      refreshGoal();
    };
  });
  refreshGoal();
}

function commitCompletedProgressForDay(){
  const drafts = readJson(PROGRESS_DRAFT_KEY, {});
  const history = readJson(PROGRESS_HISTORY_KEY, {});
  const prefix = `${localDateKey()}::${currentDayKey}::`;
  Object.entries(drafts).forEach(([dKey, draft])=>{
    if(!dKey.startsWith(prefix)) return;
    const title = dKey.slice(prefix.length);
    const step = (steps || []).find(s=>s.title===title) || (PROGRAM.days[currentDayKey]?.steps || []).find(s=>s.title===title);
    const scheme = repScheme(step);
    if(!scheme) return;
    const reps = (draft.reps || []).map(Number);
    if(reps.length !== scheme.sets || reps.some(v=>!Number.isFinite(v) || v<=0)) return;
    history[exerciseKey(currentDayKey,title)] = {
      date:localDateKey(),
      weight:draft.weight || "",
      reps
    };
  });
  writeJson(PROGRESS_HISTORY_KEY, history);
}

function setupAudio(){
  if(!window.audioCtx){
    window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if(window.audioCtx.state === "suspended") window.audioCtx.resume();
}
function beep(kind="next"){
  if(!soundEnabled) return;
  setupAudio();
  const ctx = window.audioCtx;
  const patterns = kind === "minute" ? [[660,0,.065],[660,.10,.065],[660,.20,.065]]
                 : kind === "rest" ? [[500,0,.12]]
                 : kind === "done" ? [[880,0,.12],[980,.16,.12],[1180,.32,.18]]
                 : [[820,0,.10],[980,.14,.12]];
  patterns.forEach(([freq,delay,dur])=>{
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.frequency.value=freq; o.type="sine";
    g.gain.setValueAtTime(0.0001,ctx.currentTime+delay);
    g.gain.exponentialRampToValueAtTime(0.22,ctx.currentTime+delay+.01);
    g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+delay+dur);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime+delay); o.stop(ctx.currentTime+delay+dur+.03);
  });
  if(navigator.vibrate){
    if(kind==="done") navigator.vibrate([120,80,120,80,180]);
    else if(kind==="minute") navigator.vibrate([35,45,35,45,35]);
    else navigator.vibrate([80]);
  }
}

async function requestWakeLock(){
  const status=$("#wakeStatus");
  if("wakeLock" in navigator){
    try{
      wakeLock = await navigator.wakeLock.request("screen");
      status.textContent = "Screen wake lock active";
      wakeLock.addEventListener("release",()=> status.textContent="Screen wake lock released");
    }catch(e){ status.textContent = "Wake lock unavailable — keep screen awake manually"; }
  }else status.textContent = "Wake Lock API not supported on this browser";
}
async function requestFullscreen(){
  try{
    const el=document.documentElement;
    if(el.requestFullscreen && !document.fullscreenElement) await el.requestFullscreen();
  }catch(e){}
}
async function startSession(){
  setupAudio();
  sessionHistorySnapshot = readJson(PROGRESS_HISTORY_KEY, {});
  const day=PROGRAM.days[currentDayKey];
  steps=day.steps;
  stepIndex=0;
  stepRemaining=steps[0].slotSec;
  stepElapsed=0;
  totalRemaining=day.totalSec || steps.reduce((a,b)=>a+b.slotSec,0);
  homeView.classList.add("hidden"); doneView.classList.add("hidden"); sessionView.classList.remove("hidden");
  await requestFullscreen();
  await requestWakeLock();
  running=true;
  $("#pauseBtn").textContent="Pause";
  renderStep();
  clearInterval(timerId);
  timerId=setInterval(tick,1000);
}
function tick(){
  if(!running) return;
  stepRemaining--;
  stepElapsed++;
  totalRemaining--;

  if(steps[stepIndex]?.type === "work" && stepElapsed > 0 && stepElapsed % 60 === 0 && stepRemaining > 0){
    beep("minute");
  }

  if(stepRemaining <= 0){
    advanceStep();
  }else renderTimers();
}
function advanceStep(){
  if(stepIndex >= steps.length-1){
    finishSession(); return;
  }
  stepIndex++;
  stepRemaining=steps[stepIndex].slotSec;
  stepElapsed=0;
  beep(steps[stepIndex].type==="rest" ? "rest" : "next");
  renderStep();
}
function previousStep(){
  if(stepIndex<=0) return;
  totalRemaining += (steps[stepIndex].slotSec - stepRemaining);
  stepIndex--;
  stepRemaining=steps[stepIndex].slotSec;
  stepElapsed=0;
  renderStep();
}
function skipStep(){
  totalRemaining -= stepRemaining;
  if(totalRemaining < 0) totalRemaining = 0;
  advanceStep();
}

const POSE_SPRITE_POS = {
  chair:"0%",
  warrior2:"16.6667%",
  reverse:"33.3333%",
  sideangle:"50%",
  goddess:"66.6667%",
  fold:"83.3333%",
  star:"100%"
};
const MIRRORED_POSES = new Set(["warrior2","reverse","sideangle"]);

function renderPoseGuide(step){
  const box=document.getElementById("poseGuide");
  const art=document.getElementById("poseArt");
  if(!box || !art) return;

  art.innerHTML="";
  art.classList.remove("mirror","exercise-demo-art");
  art.style.backgroundImage="none";
  art.style.backgroundSize="";
  art.style.backgroundRepeat="";
  art.style.backgroundPosition="";
  art.removeAttribute("role");
  art.removeAttribute("aria-label");

  if(step.poseKey && step.type!=="rest"){
    art.style.backgroundImage='url("./poses/yoga_pose_sprite_clean.webp")';
    art.style.backgroundSize="700% 100%";
    art.style.backgroundRepeat="no-repeat";
    art.style.backgroundPosition=(POSE_SPRITE_POS[step.poseKey] || "100%") + " center";
    art.classList.toggle("mirror", step.poseSide==="RIGHT" && MIRRORED_POSES.has(step.poseKey));
    art.setAttribute("role","img");
    art.setAttribute("aria-label",(step.poseLabel || step.title) + (step.poseSide ? " " + step.poseSide : ""));
    document.getElementById("poseGuideName").textContent=step.poseLabel || step.title;
    document.getElementById("poseGuideSide").textContent=step.poseSide || "";
    box.classList.remove("hidden");
    return;
  }

  if(step.demoImage && step.type!=="rest"){
    art.classList.add("exercise-demo-art");
    const img=document.createElement("img");
    img.className="exercise-demo-img";
    img.src=step.demoImage;
    img.alt=step.title + " technique demonstration";
    img.loading="eager";
    img.referrerPolicy="no-referrer";

    if(step.demoUrl){
      const link=document.createElement("a");
      link.className="exercise-demo-link";
      link.href=step.demoUrl;
      link.target="_blank";
      link.rel="noopener noreferrer";
      link.setAttribute("aria-label","Open "+step.title+" demonstration");
      link.appendChild(img);
      art.appendChild(link);
    }else{
      art.appendChild(img);
    }

    document.getElementById("poseGuideName").textContent=step.title;
    document.getElementById("poseGuideSide").textContent=step.demoSource ? step.demoSource + " · tap image" : "Technique demo";
    box.classList.remove("hidden");
    return;
  }

  box.classList.add("hidden");
}

function renderTimers(){
  $("#stepTimer").textContent=fmt(stepRemaining);
  $("#totalLeft").textContent=fmt(totalRemaining);
  const total = PROGRAM.days[currentDayKey].totalSec || 1800;
  $("#overallBar").style.width = `${Math.min(100, Math.max(0, (1-totalRemaining/total)*100))}%`;
}
function renderStep(){
  const s=steps[stepIndex];
  $("#phaseType").textContent = s.type==="rest" ? "REST / TRANSITION" : "WORK";
  $("#stepTitle").textContent=s.title;
  $("#stepDetails").textContent=s.details || "";
  $("#phaseCard").className="phase-card " + (s.type==="rest" ? "rest" : "work");
  $("#nextTitle").textContent=steps[stepIndex+1]?.title || "Session complete";

  const rows = [
    ["setupRow","stepSetup",s.setup],
    ["feelRow","stepFeel",s.feel],
    ["avoidRow","stepAvoid",s.avoid],
    ["minuteRow","stepMinuteCue",s.minuteCue || (s.type==="work" && s.slotSec>=120 ? "60-second time marker: continue, switch side or start the next set as planned." : null)]
  ];
  let any = false;
  rows.forEach(([rowId,textId,value])=>{
    const row=document.getElementById(rowId);
    if(value){
      document.getElementById(textId).textContent=value;
      row.classList.remove("hidden");
      any=true;
    }else{
      row.classList.add("hidden");
    }
  });
  $("#techniqueBox").classList.toggle("hidden", !any || s.type==="rest");
  renderProgression(s);
  renderPoseGuide(s);
  renderTimers();
}
function togglePause(){
  running=!running;
  $("#pauseBtn").textContent=running ? "Pause" : "Resume";
}
async function finishSession(){
  commitCompletedProgressForDay();
  running=false; clearInterval(timerId); timerId=null; totalRemaining=0; renderTimers(); beep("done");
  if(wakeLock){ try{ await wakeLock.release(); }catch(e){} wakeLock=null; }
  sessionView.classList.add("hidden"); doneView.classList.remove("hidden");
}
async function exitSession(){
  commitCompletedProgressForDay();
  running=false; clearInterval(timerId); timerId=null;
  if(wakeLock){ try{ await wakeLock.release(); }catch(e){} wakeLock=null; }
  if(document.fullscreenElement){ try{ await document.exitFullscreen(); }catch(e){} }
  sessionView.classList.add("hidden"); doneView.classList.add("hidden"); homeView.classList.remove("hidden");
}
document.addEventListener("visibilitychange", async ()=>{
  if(document.visibilityState==="visible" && !wakeLock && !sessionView.classList.contains("hidden")) await requestWakeLock();
});
window.addEventListener("beforeinstallprompt",(e)=>{
  e.preventDefault(); deferredPrompt=e; $("#installBtn").classList.remove("hidden");
});
$("#installBtn").addEventListener("click", async ()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $("#installBtn").classList.add("hidden");
});

function dateKeyForOffset(offsetDays){
  const d=new Date();
  d.setHours(12,0,0,0);
  d.setDate(d.getDate()+offsetDays);
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
  return y+"-"+m+"-"+day;
}
function dayKeyForDateKey(key){
  const d=new Date(key+"T12:00:00");
  return WEEK[(d.getDay()+6)%7];
}
function weekStartKey(){
  const d=new Date();
  d.setHours(12,0,0,0);
  const mondayOffset=(d.getDay()+6)%7;
  d.setDate(d.getDate()-mondayOffset);
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
  return y+"-"+m+"-"+day;
}
function stepMeta(step){
  const t=(step?.title || "").toLowerCase();
  const tags=[];
  let protectedStep=false;
  if(t.includes("360° breathing") || t.includes("pelvic floor")){ tags.push("core"); protectedStep=true; }
  if(t.includes("deep core + control primer")){ tags.push("core"); protectedStep=true; }
  if(t.includes("chin tuck") || t.includes("wall slide") || t.includes("y–t–w") || t.includes("y-t-w") || t.includes("reverse snow angel") || t.includes("face pull")) tags.push("posture");
  if(t.includes("90/90") || t.includes("hip airplane") || t.includes("copenhagen") || t.includes("side plank leg raise")) tags.push("hips");
  if(t.includes("curl")) tags.push("biceps");
  if(t.includes("triceps") || t.includes("close-grip")) tags.push("triceps");
  if(t.includes("goblet squat") || t.includes("split squat") || t.includes("step-up") || t.includes("hack squat") || t.includes("leg press") || t.includes("leg extension") || t.includes("cyclist squat")) tags.push("quads");
  if(t.includes("split squat") || t.includes("step-up") || t.includes("deadlift") || t.includes("back extension")) tags.push("glutes");
  if(t.includes("hamstring curl") || t.includes("romanian deadlift") || t.includes("deadlift") || t.includes("back extension")) tags.push("hamstrings");
  if(t.includes("pull-up") || t.includes("pull up") || t.includes("row") || t.includes("pulldown")) tags.push("back");
  if(t.includes("lateral raise") || t.includes("shoulder press") || t.includes("pike push") || t.includes("handstand") || t.includes("rear-delt")) tags.push("shoulders");
  if(t.includes("dead bug") || t.includes("dead-bug") || t.includes("hollow") || t.includes("reverse crunch") || t.includes("l-sit") || t.includes("ab wheel")) tags.push("core");
  if(t.includes("handstand") || t.includes("l-sit")) tags.push("skill");
  if(t.includes("burpee") || t.includes("conditioning") || t.includes("mountain climber") || t.includes("thruster")) tags.push("conditioning");
  if(t.includes("stretch") || t.includes("forward fold") || t.includes("hamstring sweep") || t.includes("ankle rock") || t.includes("open book") || t.includes("yoga") || t.includes("chair pose") || t.includes("warrior") || t.includes("goddess") || t.includes("star pose")) tags.push("mobility");
  const unique=[...new Set(tags)];
  const priority=unique.length ? Math.min(...unique.map(x=>PRIORITY_RANK[x] ?? 3)) : 3;
  return {tags:unique,priority,protected:protectedStep};
}
function debtWeight(tag){
  if(TOP_PRIORITIES.includes(tag)) return 1;
  if(["hamstrings","glutes","back","shoulders"].includes(tag)) return .75;
  if(tag==="core") return .45;
  return .25;
}
function gymPlanForDay(dayKey){
  const later=PROGRAM?.days?.[dayKey]?.later || "";
  if(!/gym/i.test(later)) return null;
  const tx=later.toLowerCase();
  const coverage={};
  if(/hack squat|leg press|cyclist squat|split squat|leg extension/.test(tx)) coverage.quads=3;
  if(/hamstring curl|rdl|romanian|back extension/.test(tx)){ coverage.hamstrings=1.5; coverage.glutes=1; }
  if(/pull-up|pull up|row|face pull/.test(tx)) coverage.back=2;
  if(/face pull|rear-delt/.test(tx)) coverage.posture=.5;
  if(/curl/.test(tx)) coverage.biceps=1;
  if(/triceps|dip/.test(tx)) coverage.triceps=1;
  return {label:later.replace(/^Evening gym:\s*/i,""),coverage};
}
function calculateDebt(){
  const debt={};
  BALANCE_TAGS.forEach(t=>debt[t]=0);
  debt.skill=0; debt.conditioning=0; debt.mobility=0;
  const sessions=readJson(SESSION_LOG_KEY,{});
  const gyms=readJson(GYM_LOG_KEY,{});
  const start=weekStartKey(), end=localDateKey();
  const dates=[...new Set([...Object.keys(sessions),...Object.keys(gyms)])].filter(d=>d>=start && d<=end).sort();
  const sub=(tag,amount)=>{ debt[tag]=Math.max(0,(debt[tag]||0)-amount); };
  const add=(tag,amount)=>{ debt[tag]=Math.min(5,(debt[tag]||0)+amount); };
  dates.forEach(date=>{
    const log=sessions[date];
    if(log?.steps){
      log.steps.forEach(st=>{
        const completion=st.status==="full" ? 1 : st.status==="partial" ? .5 : 0;
        const tags=st.tags || [];
        if(st.adaptiveFor?.length){
          st.adaptiveFor.forEach(tag=>sub(tag,completion));
          return;
        }
        if(st.protected) return;
        tags.forEach(tag=>{
          if(PRIORITY_RANK[tag]===undefined) return;
          const w=debtWeight(tag);
          if(completion>0) sub(tag,completion*w*.8);
          if(completion<1) add(tag,(1-completion)*w);
        });
      });
    }
    const gym=gyms[date];
    if(gym?.coverage){
      Object.entries(gym.coverage).forEach(([tag,amount])=>{
        if(gym.status==="done") sub(tag,Number(amount)||0);
        else if(gym.status==="skipped") add(tag,Number(amount)||0);
      });
    }
  });
  return debt;
}
function balanceLabel(value){
  if(value>=1.5) return ["Missing work","missing"];
  if(value>=.45) return ["Needs attention","attention"];
  return ["On plan","ok"];
}
function renderWeeklyBalance(){
  const wrap=document.getElementById("weeklyBalanceList");
  if(!wrap) return;
  const debt=calculateDebt();
  wrap.innerHTML=BALANCE_TAGS.map(tag=>{
    const state=balanceLabel(debt[tag]||0);
    const name=tag.charAt(0).toUpperCase()+tag.slice(1);
    return '<div class="balance-row"><strong>'+name+'</strong><span class="balance-state '+state[1]+'">'+state[0]+'</span></div>';
  }).join("");
}
function yesterdayPerformedTitles(){
  const logs=readJson(SESSION_LOG_KEY,{});
  const log=logs[dateKeyForOffset(-1)];
  return new Set((log?.steps || []).filter(s=>s.status!=="skipped").map(s=>s.title.toLowerCase()));
}
function hasPlannedTag(dayKey,tag,includeGym=true){
  const day=PROGRAM?.days?.[dayKey];
  if(!day) return false;
  if((day.steps||[]).some(s=>s.type!=="rest" && stepMeta(s).tags.includes(tag))) return true;
  if(includeGym){
    const g=gymPlanForDay(dayKey);
    if(g?.coverage?.[tag]) return true;
  }
  return false;
}
function replacementLibrary(){
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
function pickCandidate(tag,usedTitles,yesterdayTitles){
  const list=replacementLibrary()[tag] || [];
  return list.find(x=>!usedTitles.has(x.title.toLowerCase()) && !yesterdayTitles.has(x.title.toLowerCase())) || null;
}
function buildAdaptiveDay(dayKey){
  adaptiveInfo=null;
  const base=PROGRAM.days[dayKey];
  if(!base) return base;
  if(dayKey!==dayKeyFromToday() || useNormalToday) return base;
  const logs=readJson(SESSION_LOG_KEY,{});
  if(logs[localDateKey()]) return base;

  const debt=calculateDebt();
  const tomorrow=WEEK[(WEEK.indexOf(dayKey)+1)%7];
  const usedTitles=new Set((base.steps||[]).filter(s=>s.type!=="rest").map(s=>s.title.toLowerCase()));
  const yesterdayTitles=yesterdayPerformedTitles();
  const candidates=[];
  let budget=960;

  const ordered=Object.keys(debt).filter(tag=>(debt[tag]||0)>=.45).sort((a,b)=>{
    const ra=PRIORITY_RANK[a] ?? 9, rb=PRIORITY_RANK[b] ?? 9;
    if(ra!==rb) return ra-rb;
    return (debt[b]||0)-(debt[a]||0);
  });

  ordered.forEach(tag=>{
    if(budget<150) return;
    if(hasPlannedTag(dayKey,tag,true)) return;
    if((PRIORITY_RANK[tag] ?? 9)>0 && hasPlannedTag(tomorrow,tag,true)) return;
    if(TOP_PRIORITIES.includes(tag) && hasPlannedTag(tomorrow,tag,true) && (debt[tag]||0)<1.5) return;
    let count=1;
    if(tag==="quads" && debt[tag]>=2) count=Math.min(3,Math.ceil(debt[tag]));
    for(let i=0;i<count;i++){
      const c=pickCandidate(tag,usedTitles,yesterdayTitles);
      if(!c || c.slotSec>budget) break;
      candidates.push({...c,adaptive:true});
      usedTitles.add(c.title.toLowerCase());
      budget-=c.slotSec;
    }
  });
  if(!candidates.length) return base;

  const groups=[];
  let pendingRest=[];
  (base.steps||[]).forEach((s,i)=>{
    if(s.type==="rest"){ pendingRest.push(i); return; }
    const meta=stepMeta(s);
    const inds=[...pendingRest,i];
    groups.push({workIndex:i,indices:inds,sec:inds.reduce((sum,j)=>sum+Number(base.steps[j].slotSec||0),0),meta,title:s.title});
    pendingRest=[];
  });

  let finalInsertedSec=candidates.reduce((a,s)=>a+s.slotSec,0);
  const removable=groups.filter(g=>!g.meta.protected && g.meta.priority>0).sort((a,b)=>{
    if(a.meta.priority!==b.meta.priority) return b.meta.priority-a.meta.priority;
    return b.sec-a.sec;
  });
  const removed=[];
  let removedSec=0;
  for(const g of removable){
    if(removedSec>=finalInsertedSec) break;
    removed.push(g);
    removedSec+=g.sec;
  }
  while(candidates.length && candidates.reduce((a,s)=>a+s.slotSec,0)>removedSec) candidates.pop();
  if(!candidates.length) return base;
  finalInsertedSec=candidates.reduce((a,s)=>a+s.slotSec,0);

  const removeIndexes=new Set(removed.flatMap(g=>g.indices));
  const kept=(base.steps||[]).filter((_,i)=>!removeIndexes.has(i)).map(s=>({...s}));
  const diff=removedSec-finalInsertedSec;
  if(diff>0){
    const each=Math.floor(diff/candidates.length), rem=diff%candidates.length;
    candidates.forEach((s,i)=>s.slotSec+=each+(i<rem?1:0));
  }

  let insertAt=1;
  const newSteps=[...kept.slice(0,insertAt),...candidates,...kept.slice(insertAt)];
  const total=newSteps.reduce((a,s)=>a+Number(s.slotSec||0),0);
  if(total!==1800) candidates[candidates.length-1].slotSec+=1800-total;

  const equipment=[...(base.equipment||[])];
  candidates.flatMap(c=>c.equipment||[]).forEach(x=>{ if(!equipment.includes(x)) equipment.push(x); });
  const tags=[...new Set(candidates.flatMap(c=>c.adaptiveFor||[]))];
  adaptiveInfo={
    tags,
    added:candidates.map(c=>c.title),
    removed:removed.map(g=>g.title),
    reason:"Recovering missed work: "+tags.map(t=>t.charAt(0).toUpperCase()+t.slice(1)).join(" · ")
  };
  return {...base,focus:"Adapted · "+base.focus,equipment,steps:newSteps,totalSec:1800};
}
function getDisplayDay(){
  return buildAdaptiveDay(currentDayKey);
}
function renderAdaptiveCard(){
  const card=document.getElementById("adaptiveCard");
  if(!card) return;
  if(currentDayKey!==dayKeyFromToday() || !adaptiveInfo){
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  document.getElementById("adaptiveReason").textContent=adaptiveInfo.reason;
  document.getElementById("adaptiveChanges").innerHTML=
    '<div><strong>Added</strong><br>'+adaptiveInfo.added.join(" · ")+'</div>'+
    '<div><strong>Moved out today</strong><br>'+(adaptiveInfo.removed.length?adaptiveInfo.removed.join(" · "):"Nothing")+'</div>';
  const btn=document.getElementById("normalWorkoutBtn");
  btn.textContent=useNormalToday ? "Use adapted workout" : "Use normal workout";
}
function renderHome(){
  const day=getDisplayDay();
  $("#dayTitle").textContent = day.label;
  $("#focusText").textContent = day.focus;
  $("#laterText").textContent = day.later ? day.later : "";
  $("#laterText").style.display = day.later ? "block" : "none";
  $("#exerciseCount").textContent = nonRestSteps(day).length+" blocks";
  $("#equipmentList").innerHTML = (day.equipment||[]).map(x=>'<span class="chip">'+x+'</span>').join("");
  $("#previewList").innerHTML = day.steps.map(s=>{
    if(s.type === "rest") return '<li class="rest-preview">'+s.title+' · '+fmt(s.slotSec)+'</li>';
    const badge=s.adaptive ? ' <span class="adaptive-badge">ADDED</span>' : "";
    return '<li><strong>'+s.title+'</strong>'+badge+' <span class="muted">· '+fmt(s.slotSec)+'</span><br><span class="muted tiny">'+(s.details||"")+'</span></li>';
  }).join("");
  renderAdaptiveCard();
  renderWeeklyBalance();
  renderDayTabs();
}
function pendingGymPrompt(){
  const date=dateKeyForOffset(-1);
  const dayKey=dayKeyForDateKey(date);
  const plan=gymPlanForDay(dayKey);
  if(!plan) return null;
  const logs=readJson(GYM_LOG_KEY,{});
  if(logs[date]) return null;
  return {date,dayKey,plan};
}
function maybeShowGymPrompt(){
  const pending=pendingGymPrompt();
  const modal=document.getElementById("gymPrompt");
  if(!modal) return;
  if(!pending){ modal.classList.add("hidden"); return; }
  modal.dataset.date=pending.date;
  modal.dataset.day=pending.dayKey;
  document.getElementById("gymPromptText").textContent=PROGRAM.days[pending.dayKey].label+": "+pending.plan.label;
  modal.classList.remove("hidden");
}
function saveGymAnswer(went){
  const modal=document.getElementById("gymPrompt");
  const date=modal?.dataset.date, dayKey=modal?.dataset.day;
  if(!date || !dayKey) return;
  const plan=gymPlanForDay(dayKey);
  const logs=readJson(GYM_LOG_KEY,{});
  logs[date]={dayKey,status:went?"done":"skipped",coverage:plan?.coverage||{},label:plan?.label||"Gym",loggedAt:new Date().toISOString()};
  writeJson(GYM_LOG_KEY,logs);
  modal.classList.add("hidden");
  useNormalToday=false;
  renderHome();
}
function renderSessionReview(){
  const wrap=document.getElementById("sessionReviewList");
  if(!wrap) return;
  pendingReview=(steps||[]).map((s,i)=>{
    if(s.type==="rest") return null;
    const scheme=repScheme(s);
    let status;
    if(scheme){
      const drafts=readJson(PROGRESS_DRAFT_KEY,{});
      const d=drafts[draftKey(currentDayKey,s.title)];
      const completed=(d?.reps||[]).filter(v=>Number(v)>0).length;
      status=completed>=scheme.sets ? "full" : completed>0 ? "partial" : null;
    }
    if(!status){
      const actual=Math.min(Number(s.slotSec||0),Number(sessionActualSec[i]||0));
      const ratio=s.slotSec ? actual/s.slotSec : 0;
      status=ratio>=.8 ? "full" : ratio>=.15 ? "partial" : "skipped";
    }
    const meta=stepMeta(s);
    return {index:i,title:s.title,status,actualSec:Math.min(Number(s.slotSec||0),Number(sessionActualSec[i]||0)),plannedSec:Number(s.slotSec||0),tags:meta.tags,protected:meta.protected,adaptiveFor:s.adaptiveFor||[],adaptive:!!s.adaptive};
  }).filter(Boolean);

  wrap.innerHTML=pendingReview.map((r,ri)=>
    '<div class="review-row" data-review="'+ri+'">'+
      '<div class="review-copy"><strong>'+r.title+'</strong><span class="tiny muted">'+fmt(r.actualSec)+' / '+fmt(r.plannedSec)+'</span></div>'+
      '<div class="review-status">'+
        '<button class="review-choice '+(r.status==="full"?"active":"")+'" data-status="full">✓ Full</button>'+
        '<button class="review-choice '+(r.status==="partial"?"active":"")+'" data-status="partial">◐ Partial</button>'+
        '<button class="review-choice '+(r.status==="skipped"?"active":"")+'" data-status="skipped">✕ Skip</button>'+
      '</div>'+
    '</div>'
  ).join("");

  wrap.querySelectorAll(".review-choice").forEach(btn=>{
    btn.onclick=()=>{
      const row=btn.closest(".review-row");
      const ri=Number(row.dataset.review);
      pendingReview[ri].status=btn.dataset.status;
      row.querySelectorAll(".review-choice").forEach(x=>x.classList.toggle("active",x===btn));
    };
  });
}
function saveSessionReview(){
  if(!pendingReview) return;
  const logs=readJson(SESSION_LOG_KEY,{});
  logs[localDateKey()]={
    dayKey:currentDayKey,
    savedAt:new Date().toISOString(),
    adaptive:pendingReview.some(x=>x.adaptive),
    steps:pendingReview.map(x=>({title:x.title,status:x.status,actualSec:x.actualSec,plannedSec:x.plannedSec,tags:x.tags,protected:x.protected,adaptiveFor:x.adaptiveFor}))
  };
  writeJson(SESSION_LOG_KEY,logs);
  commitCompletedProgressForDay();
  pendingReview=null;
  useNormalToday=false;
  exitSession();
  renderHome();
}
function finalizeCurrentVisit(){
  if(!steps?.[stepIndex]) return;
  sessionActualSec[stepIndex]=(sessionActualSec[stepIndex]||0)+Math.max(0,stepElapsed||0);
  stepElapsed=0;
}
async function startSession(){
  setupAudio();
  sessionHistorySnapshot = readJson(PROGRESS_HISTORY_KEY, {});
  const day=getDisplayDay();
  steps=day.steps.map(s=>({...s}));
  sessionActualSec=Array(steps.length).fill(0);
  stepIndex=0;
  stepRemaining=steps[0].slotSec;
  stepElapsed=0;
  sessionTotalSec=day.totalSec || steps.reduce((a,b)=>a+b.slotSec,0);
  totalRemaining=sessionTotalSec;
  homeView.classList.add("hidden"); doneView.classList.add("hidden"); sessionView.classList.remove("hidden");
  await requestFullscreen();
  await requestWakeLock();
  running=true;
  $("#pauseBtn").textContent="Pause";
  renderStep();
  clearInterval(timerId);
  timerId=setInterval(tick,1000);
}
function advanceStep(){
  finalizeCurrentVisit();
  if(stepIndex >= steps.length-1){
    finishSession(false,true); return;
  }
  stepIndex++;
  stepRemaining=steps[stepIndex].slotSec;
  stepElapsed=0;
  beep(steps[stepIndex].type==="rest" ? "rest" : "next");
  renderStep();
}
function previousStep(){
  if(stepIndex<=0) return;
  finalizeCurrentVisit();
  totalRemaining += (steps[stepIndex].slotSec - stepRemaining);
  stepIndex--;
  stepRemaining=steps[stepIndex].slotSec;
  stepElapsed=0;
  renderStep();
}
function skipStep(){
  totalRemaining -= stepRemaining;
  if(totalRemaining < 0) totalRemaining = 0;
  advanceStep();
}
function renderTimers(){
  $("#stepTimer").textContent=fmt(stepRemaining);
  $("#totalLeft").textContent=fmt(totalRemaining);
  const total=sessionTotalSec || 1800;
  $("#overallBar").style.width = Math.min(100,Math.max(0,(1-totalRemaining/total)*100))+"%";
}
async function finishSession(early=false,alreadyFinalized=false){
  if(!alreadyFinalized) finalizeCurrentVisit();
  running=false; clearInterval(timerId); timerId=null;
  if(!early){ totalRemaining=0; beep("done"); }
  renderTimers();
  if(wakeLock){ try{ await wakeLock.release(); }catch(e){} wakeLock=null; }
  sessionView.classList.add("hidden"); doneView.classList.remove("hidden");
  renderSessionReview();
}
async function loadProgram(){
  try{
    const res = await fetch("./program.json", {cache:"no-store"});
    PROGRAM = await res.json();
    for(const file of ["./program-overrides.json", "./gym-overrides.json"]){
      try{
        const overrideRes = await fetch(file, {cache:"no-store"});
        if(overrideRes.ok) PROGRAM = mergeProgram(PROGRAM, await overrideRes.json());
      }catch(_){}
    }
  }catch(e){
    const cached = localStorage.getItem("workoutProgram");
    if(cached) PROGRAM = JSON.parse(cached);
    else throw e;
  }
  localStorage.setItem("workoutProgram", JSON.stringify(PROGRAM));
  currentDayKey = dayKeyFromToday();
  renderHome();
  maybeShowGymPrompt();
}
document.getElementById("normalWorkoutBtn").onclick=()=>{
  useNormalToday=!useNormalToday;
  renderHome();
};
document.getElementById("gymYesBtn").onclick=()=>saveGymAnswer(true);
document.getElementById("gymNoBtn").onclick=()=>saveGymAnswer(false);

$("#startBtn").onclick=startSession;
$("#pauseBtn").onclick=togglePause;
$("#nextBtn").onclick=skipStep;
$("#prevBtn").onclick=previousStep;
$("#exitBtn").onclick=()=>finishSession(true,false);
$("#doneBtn").onclick=saveSessionReview;
$("#soundBtn").onclick=()=>{
  soundEnabled=!soundEnabled;
  $("#soundBtn").textContent=soundEnabled ? "Sound on" : "Sound off";
  if(soundEnabled) beep("next");
};

if("serviceWorker" in navigator){
  let swReloaded=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(swReloaded) return;
    swReloaded=true;
    window.location.reload();
  });
  window.addEventListener("load",async ()=>{
    try{
      const reg=await navigator.serviceWorker.register("./service-worker.js");
      await reg.update();
    }catch(_){}
  });
}
loadProgram().catch(err=>{
  document.body.innerHTML=`<main class="app-shell"><h1>Could not load workout data</h1><p>${err}</p></main>`;
});
