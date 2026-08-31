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
    const step = (PROGRAM.days[currentDayKey]?.steps || []).find(s=>s.title===title);
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
$("#startBtn").onclick=startSession;
$("#pauseBtn").onclick=togglePause;
$("#nextBtn").onclick=skipStep;
$("#prevBtn").onclick=previousStep;
$("#exitBtn").onclick=exitSession;
$("#doneBtn").onclick=exitSession;
$("#soundBtn").onclick=()=>{
  soundEnabled=!soundEnabled;
  $("#soundBtn").textContent=soundEnabled ? "Sound on" : "Sound off";
  if(soundEnabled) beep("next");
};

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));
}
loadProgram().catch(err=>{
  document.body.innerHTML=`<main class="app-shell"><h1>Could not load workout data</h1><p>${err}</p></main>`;
});
