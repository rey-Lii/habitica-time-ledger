let state = null;
let selectedDate = new Date();
let breakdownMode = "category";

init();

async function init() {
  document.getElementById("themeBtn").onclick = toggleTheme;
  document.getElementById("syncBtn").onclick = syncNow;
  document.getElementById("settingsBtn").onclick = () => send("openSettings");
  document.getElementById("prevDay").onclick = () => shiftDay(-1);
  document.getElementById("nextDay").onclick = () => shiftDay(1);
  document.getElementById("categoryTab").onclick = () => setBreakdown("category");
  document.getElementById("projectTab").onclick = () => setBreakdown("project");
  document.getElementById("modal").addEventListener("click", event => {
    if (event.target.id === "modal") closeModal();
  });
  chrome.storage.onChanged.addListener(() => refresh());
  await refresh();
}

async function refresh() {
  state = await send("getState");
  applyTheme(state.settings.theme);
  updateThemeButton();
  render();
}

function render() {
  const key = dateKey(selectedDate.getTime());
  const items = (state.activities || []).filter(item => dateKey(item.completedAt) === key);
  const assigned = items.filter(item => !item.pending);
  const pending = items.filter(item => item.pending);
  const total = assigned.reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0);
  const categoryCount = new Set(assigned.map(item => item.category).filter(Boolean)).size;

  document.getElementById("dateLabel").textContent = isToday(selectedDate) ? "Today" : selectedDate.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  document.getElementById("accuracyLabel").textContent = `${assigned.length} logged${pending.length ? ` · ${pending.length} need setup` : ""}`;
  document.getElementById("nextDay").disabled = isToday(selectedDate);
  document.getElementById("syncLabel").textContent = state.lastSyncAt ? `Task sync ${new Date(state.lastSyncAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}` : "Not synced yet";

  const cards = [
    { label:"Activity time", value:formatMinutes(total), detail:"from completions", icon:"◷", color:"#8b5cf6" },
    { label:"Completions", value:items.length, detail:pending.length ? `${pending.length} need setup` : "all captured", icon:"✓", color:"#3b82f6" },
    { label:"Active hours", value:countActiveHours(assigned), detail:"hours with activity", icon:"▥", color:"#14b8a6" },
    { label:"Categories", value:categoryCount, detail:"used today", icon:"●", color:"#f59e0b" }
  ];
  document.getElementById("summary").innerHTML = cards.map(card => `<div class="summary-card" style="--card-color:${card.color};--soft:${hexToRgba(card.color,.13)}"><div class="summary-top"><span class="summary-icon">${card.icon}</span>${card.label}</div><strong>${card.value}</strong><small>${card.detail}</small></div>`).join("");

  renderTimeline(assigned);
  renderBreakdown(assigned);
  renderActivities(items);
}

function renderTimeline(items) {
  const timeline = buildHourlyTimeline(items);
  const box = document.getElementById("timeline");
  const overlap = timeline.filter(row => row.total > 60.01).length;
  const badge = document.getElementById("overlapBadge");
  if (overlap) { badge.textContent = `${overlap} overlapping hour${overlap > 1 ? "s" : ""}`; badge.classList.remove("hidden"); }
  else badge.classList.add("hidden");

  const activeRows = timeline.filter(row => row.total > 0);
  if (!activeRows.length) {
    box.innerHTML = emptyState("No activity yet", "Complete a configured task in Habitica to build your timeline.");
    return;
  }
  const minHour = Math.max(0, activeRows[0].hour - 1);
  const maxHour = Math.min(23, activeRows[activeRows.length - 1].hour + 1);
  const visible = timeline.filter(row => row.hour >= minHour && row.hour <= maxHour);
  box.innerHTML = visible.map(row => {
    const scale = Math.max(60, row.total);
    const segments = row.parts.map(part => `<div class="hour-segment" style="width:${part.minutes / scale * 100}%;background:${categoryColor(part.category)}" title="${escapeHtml(part.category)} · ${Math.round(part.minutes)} min"></div>`).join("");
    return `<div class="hour-row"><div class="hour-label">${String(row.hour).padStart(2,"0")}:00–${String(row.hour + 1).padStart(2,"0")}:00</div><div class="hour-track">${segments}</div><div class="hour-total">${Math.round(row.total)}m</div></div>`;
  }).join("");
}

function buildHourlyTimeline(items) {
  const rows = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, categoryMap: new Map(), parts: [] }));
  for (const item of items) {
    const start = Number(item.blockStartAt ?? item.estimatedStartAt);
    const end = Number(item.completedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    let cursor = start;
    while (cursor < end) {
      const d = new Date(cursor);
      const boundary = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const segmentEnd = Math.min(end, boundary);
      if (dateKey(cursor) === dateKey(selectedDate.getTime())) {
        const minutes = (segmentEnd - cursor) / 60000;
        const row = rows[d.getHours()];
        row.total += minutes;
        row.categoryMap.set(item.category, (row.categoryMap.get(item.category) || 0) + minutes);
      }
      cursor = segmentEnd;
    }
  }
  for (const row of rows) {
    row.parts = [...row.categoryMap.entries()].map(([category, minutes]) => ({ category, minutes })).sort((a,b) => b.minutes-a.minutes);
  }
  return rows;
}

function renderBreakdown(items) {
  const rows = aggregate(items, breakdownMode).filter(row => row.name && row.name !== "Unassigned");
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  document.getElementById("breakdownTitle").textContent = breakdownMode === "category" ? "Category breakdown" : "Project breakdown";
  const box = document.getElementById("breakdown");
  box.innerHTML = rows.length ? rows.slice(0, 8).map((row, index) => {
    const category = breakdownMode === "category" ? row.name : projectColorCategory(row.name, items, index);
    const color = categoryColor(category);
    return `<div class="breakdown-row"><div class="breakdown-label"><span class="color-dot" style="background:${color};--dot-soft:${hexToRgba(color,.14)}"></span><div class="breakdown-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</div></div><div class="track"><div class="fill" style="width:${total ? row.value / total * 100 : 0}%;background:${color}"></div></div><div class="breakdown-value">${formatMinutes(row.value)}</div></div>`;
  }).join("") : emptyState("Nothing to compare", "Your category bars will appear after the first captured completion.");
}

function projectColorCategory(project, items, index) {
  const match = items.find(item => (item.project || "No project") === project);
  return match?.category || ["Career","Research","Clinical","Learning","Health","Life","Rest"][index % 7];
}

function aggregate(items, key) {
  const map = new Map();
  for (const item of items) {
    const name = key === "project" ? (item.project || "No project") : (item.category || "Unassigned");
    map.set(name, (map.get(name) || 0) + Number(item.durationMinutes || 0));
  }
  return [...map.entries()].map(([name,value]) => ({name,value})).sort((a,b) => b.value-a.value);
}

function renderActivities(items) {
  const box = document.getElementById("activityList");
  const sorted = [...items].sort((a,b) => b.completedAt-a.completedAt);
  box.innerHTML = sorted.length ? sorted.map(item => {
    const color = categoryColor(item.category);
    const source = item.timeAccuracy === "exact-completion" ? "Web exact" : "Synced";
    const sourceClass = item.timeAccuracy === "exact-completion" ? "exact" : "";
    return `<div class="activity-row"><div class="activity-time">${formatTime(item.completedAt)}</div><div class="activity-name-wrap"><span class="color-dot" style="background:${color};--dot-soft:${hexToRgba(color,.14)}"></span><div class="activity-name ${item.pending ? "pending" : ""}" title="${escapeHtml(item.taskName)}">${escapeHtml(item.taskName)}${item.pending ? " · needs setup" : ""}</div></div><div class="activity-path">${escapeHtml(item.category)}${item.project ? ` / ${escapeHtml(item.project)}` : ""}</div><div class="activity-duration">${item.pending ? "—" : formatMinutes(item.durationMinutes)}</div><span class="source-pill ${sourceClass}">${source}</span><button class="edit" data-id="${escapeHtml(item.id)}">⋯</button></div>`;
  }).join("") : emptyState("No completions recorded", "Keep using Habitica normally. Captured tasks will appear here.");
  box.querySelectorAll(".edit").forEach(button => button.onclick = () => openActivityModal(button.dataset.id));
}

function openActivityModal(id) {
  const activity = state.activities.find(item => item.id === id);
  if (!activity) return;
  const date = new Date(activity.completedAt);
  const localValue = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}T${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
  document.getElementById("modalCard").innerHTML = `<h3>${escapeHtml(activity.taskName)}</h3><div class="form-grid"><div class="field"><label>Category</label><select id="editCategory">${state.categories.map(x => `<option ${x===activity.category?"selected":""}>${escapeHtml(x)}</option>`).join("")}</select></div><div class="field"><label>Project</label><input id="editProject" value="${escapeHtml(activity.project || "")}"></div><div class="field"><label>Minutes per completion</label><input id="editDuration" type="number" min="0" max="1440" value="${activity.durationMinutes ?? 0}"></div><div class="field"><label>Completion time</label><input id="editTime" type="datetime-local" value="${localValue}"></div></div><div class="modal-actions"><button id="deleteActivity" class="danger">Delete</button><button id="cancelEdit" class="ghost">Cancel</button><button id="saveEdit" class="primary">Save</button></div>`;
  document.getElementById("modal").classList.remove("hidden");
  document.getElementById("cancelEdit").onclick = closeModal;
  document.getElementById("deleteActivity").onclick = async () => { await send("deleteActivity", { activityId:id }); closeModal(); await refresh(); };
  document.getElementById("saveEdit").onclick = async () => {
    await send("updateActivity", { activityId:id, patch:{ category:document.getElementById("editCategory").value, project:document.getElementById("editProject").value, durationMinutes:Number(document.getElementById("editDuration").value), completedAt:new Date(document.getElementById("editTime").value).getTime() } });
    closeModal(); await refresh();
  };
}

function emptyState(title, body) {
  return `<div class="empty"><div class="empty-inner"><div class="empty-dots"><i style="background:#8b5cf6"></i><i style="background:#3b82f6"></i><i style="background:#14b8a6"></i><i style="background:#f59e0b"></i></div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></div></div>`;
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0,2),16), g = parseInt(value.slice(2,4),16), b = parseInt(value.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function closeModal(){ document.getElementById("modal").classList.add("hidden"); }
function setBreakdown(mode){ breakdownMode=mode; document.getElementById("categoryTab").classList.toggle("active",mode==="category"); document.getElementById("projectTab").classList.toggle("active",mode==="project"); render(); }
function shiftDay(delta){ selectedDate.setDate(selectedDate.getDate()+delta); selectedDate.setHours(12,0,0,0); render(); }
function isToday(d){ return dateKey(d.getTime())===dateKey(); }
function countActiveHours(items){ const set=new Set(); for(const item of items){ if(Number(item.durationMinutes||0)<=0)continue; let t=Number(item.blockStartAt ?? item.estimatedStartAt); while(t<=item.completedAt){ const d=new Date(t); set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`); t=new Date(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours()+1).getTime(); }} return set.size; }
async function syncNow(){ const b=document.getElementById("syncBtn"); const old=b.textContent; b.textContent="Syncing…"; b.disabled=true; try{const result=await send("syncTasks");await refresh();b.textContent=result.added?`Added ${result.added}`:"Synced";setTimeout(()=>b.textContent="Sync now",1400);}catch(e){alert(e.message);b.textContent=old;}finally{b.disabled=false;} }
async function toggleTheme(){ const next=state.settings.theme==="light"?"dark":"light"; await send("setTheme",{theme:next}); state.settings.theme=next; applyTheme(next); updateThemeButton(); }
function updateThemeButton(){ document.getElementById("themeBtn").textContent=state.settings.theme==="light"?"☾":"☀"; }
