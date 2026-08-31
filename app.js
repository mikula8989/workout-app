
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
const WEEK = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const ABBR = ["M","T","W","T","F","S","S"];

function fmt(sec){
  sec = Math.max(0, Math.round(sec));
  return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
}
function dayKeyFromToday(){
  const js = new Date().getDay(); // 0 Sun
  return WEEK[(js + 6) % 7];
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

function applyOverrides(base, overrides){
  if(!overrides) return base;
  const mergedDays = {...(base.days || {})};
  for(const [key, dayOverride] of Object.entries(overrides.days || {})){
    mergedDays[key] = {...(mergedDays[key] || {}), ...dayOverride};
  }
  return {...base, ...overrides, days: mergedDays};
}

async function loadOptionalOverrides(path){
  try{
    const res = await fetch(path, {cache:"no-store"});
    if(!res.ok) return null;
    return await res.json();
  }catch(_){
    return null;
  }
}

async function loadProgram(){
  try{
    const res = await fetch("./program.json", {cache:"no-store"});
    PROGRAM = await res.json();

    // Content overrides can replace a whole day or only selected day fields.
    // This keeps the app code stable while allowing programme and gym changes independently.
    PROGRAM = applyOverrides(PROGRAM, await loadOptionalOverrides("./program-overrides.json"));
    PROGRAM = applyOverrides(PROGRAM, await loadOptionalOverrides("./gym-overrides.json"));
  }catch(e){
    const cached = localStorage.getItem("workoutProgram");
    if(cached) PROGRAM = JSON.parse(cached);
    else throw e;
  }
  localStorage.setItem("workoutProgram", JSON.stringify(PROGRAM));
  currentDayKey = dayKeyFromToday();
  renderHome();
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
  renderTimers();
}
function togglePause(){
  running=!running;
  $("#pauseBtn").textContent=running ? "Pause" : "Resume";
}
async function finishSession(){
  running=false; clearInterval(timerId); timerId=null; totalRemaining=0; renderTimers(); beep("done");
  if(wakeLock){ try{ await wakeLock.release(); }catch(e){} wakeLock=null; }
  sessionView.classList.add("hidden"); doneView.classList.remove("hidden");
}
async function exitSession(){
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
