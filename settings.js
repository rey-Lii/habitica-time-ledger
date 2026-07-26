let state = null;
const statusBox = document.getElementById("status");

init();

async function init() {
  document.getElementById("dashboardBtn").onclick = () => send("openDashboard");
  document.getElementById("themeBtn").onclick = toggleTheme;
  document.getElementById("saveSettings").onclick = saveConnection;
  document.getElementById("sync").onclick = syncTasks;
  document.getElementById("taskSearch").oninput = renderTasks;
  document.getElementById("statusFilter").onchange = renderTasks;
  document.getElementById("applySimilar").onchange = savePreference;
  document.getElementById("clearActivities").onclick = clearActivities;
  chrome.storage.onChanged.addListener(() => refresh(false));
  await refresh(true);
}

async function refresh(fillConnection) {
  state = await send("getState");
  applyTheme(state.settings.theme);
  updateThemeButton();
  document.getElementById("applySimilar").checked = Boolean(state.settings.applyToSimilar);
  if (fillConnection) {
    document.getElementById("userId").value = state.settings.userId || "";
    document.getElementById("apiToken").value = state.settings.apiToken || "";
    document.getElementById("clientId").value = state.settings.clientId || "";
  }
  renderStats();
  renderTasks();
}

function renderStats() {
  const configured = state.tasks.filter(task => state.mappings[task.id]?.configured).length;
  const needsSetup = Math.max(0, state.tasks.length - configured);
  const captured = state.activities.length;
  const stats = [
    {label:"Synced tasks",value:state.tasks.length,color:"#3b82f6"},
    {label:"Configured",value:configured,color:"#8b5cf6"},
    {label:"Needs setup",value:needsSetup,color:"#f59e0b"}
  ];
  document.getElementById("setupStats").innerHTML = stats.map(x => `<div class="stat" style="--soft:${categorySoftFromHex(x.color)}"><span>${x.label}</span><strong>${x.value}</strong></div>`).join("");
  if (captured && !statusBox.textContent) statusBox.textContent = `${captured} completions captured`;
}

async function saveConnection() {
  try {
    const settings = await send("saveSettings", { settings: {
      userId: document.getElementById("userId").value.trim(),
      apiToken: document.getElementById("apiToken").value.trim(),
      clientId: document.getElementById("clientId").value.trim(),
      applyToSimilar: document.getElementById("applySimilar").checked
    }});
    document.getElementById("clientId").value = settings.clientId || "";
    showStatus("Connection saved");
  } catch (error) { showStatus(error.message); }
}

async function savePreference() {
  await send("saveSettings", { settings: { applyToSimilar: document.getElementById("applySimilar").checked } });
}

async function syncTasks() {
  await saveConnection();
  const button = document.getElementById("sync");
  button.disabled = true;
  button.textContent = "Syncing…";
  try {
    const result = await send("syncTasks");
    await refresh(false);
    const changeText = result.added || result.removed ? ` · ${result.added} added · ${result.removed} removed` : "";
    showStatus(`${result.count} tasks synced · ${result.assigned} configured${changeText}`);
  } catch (error) { showStatus(error.message); }
  finally { button.disabled = false; button.textContent = "Sync Habitica"; }
}

function renderTasks() {
  if (!state) return;
  const query = document.getElementById("taskSearch").value.trim().toLowerCase();
  const filter = document.getElementById("statusFilter").value;
  const tasks = state.tasks.filter(task => {
    const mapping = state.mappings[task.id];
    const assigned = Boolean(mapping?.configured);
    if (filter === "assigned" && !assigned) return false;
    if (filter === "unassigned" && assigned) return false;
    return `${task.text} ${(task.tags || []).join(" ")}`.toLowerCase().includes(query);
  });

  const box = document.getElementById("taskList");
  box.innerHTML = tasks.length ? tasks.map(task => taskRow(task)).join("") : `<div class="empty">No matching tasks. Sync Habitica or change the filter.</div>`;
  box.querySelectorAll(".task-row").forEach(row => bindRow(row));
}

function taskRow(task) {
  const m = state.mappings[task.id] || { category:"Unassigned", project:"", durationMinutes:null, configured:false };
  const color = categoryColor(m.category);
  return `<div class="task-row" data-id="${escapeHtml(task.id)}"><div class="task-main"><span class="task-dot" style="background:${color};--dot-soft:${categorySoftColor(m.category,.14)}"></span><div class="task-copy"><div class="task-title" title="${escapeHtml(task.text)}">${escapeHtml(task.text)}</div><div class="task-meta">${typeLabel(task.type)}${task.tags?.length ? ` · ${task.tags.map(escapeHtml).join(" · ")}` : ""}</div></div></div><select class="category">${state.categories.map(x => `<option ${x===m.category?"selected":""}>${escapeHtml(x)}</option>`).join("")}</select><input class="project" value="${escapeHtml(m.project || "")}" placeholder="Optional"><input class="minutes" type="number" min="0" max="1440" value="${m.durationMinutes ?? ""}" placeholder="0"><button class="save ${m.configured ? "assigned" : ""}">${m.configured ? "Saved" : "Save"}</button></div>`;
}

function bindRow(row) {
  const category = row.querySelector(".category");
  category.onchange = () => {
    const dot = row.querySelector(".task-dot");
    dot.style.background = categoryColor(category.value);
    dot.style.setProperty("--dot-soft", categorySoftColor(category.value,.14));
  };
  row.querySelector(".save").onclick = async () => {
    const button = row.querySelector(".save");
    try {
      const result = await send("saveTaskMapping", { taskId: row.dataset.id, mapping: { category: category.value, project: row.querySelector(".project").value.trim(), durationMinutes: row.querySelector(".minutes").value }, applySimilar: document.getElementById("applySimilar").checked });
      const configured = result.mapping.configured;
      button.textContent = configured ? (result.updatedCount > 1 ? `Saved ${result.updatedCount}` : "Saved") : "Needs category";
      button.classList.toggle("assigned", configured);
      setTimeout(() => refresh(false), 700);
    } catch (error) { showStatus(error.message); }
  };
}

async function clearActivities() {
  if (!confirm("Clear all captured activity? Task setup and Habitica credentials will stay.")) return;
  await send("clearActivities");
  showStatus("Activity history cleared");
}

async function toggleTheme() {
  const next = state.settings.theme === "light" ? "dark" : "light";
  await send("setTheme", { theme: next });
  state.settings.theme = next;
  applyTheme(next);
  updateThemeButton();
}

function categorySoftFromHex(hex){const v=hex.replace("#","");const r=parseInt(v.slice(0,2),16),g=parseInt(v.slice(2,4),16),b=parseInt(v.slice(4,6),16);return `rgba(${r},${g},${b},.13)`;}
function updateThemeButton(){ document.getElementById("themeBtn").textContent=state.settings.theme==="light"?"☾":"☀"; }
function showStatus(message){ statusBox.textContent=message; clearTimeout(showStatus.timer); showStatus.timer=setTimeout(()=>{statusBox.textContent="";},3500); }
