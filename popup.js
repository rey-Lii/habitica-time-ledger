const app = document.getElementById("app");
let state = null;

init();

async function init() {
  document.getElementById("settingsBtn").addEventListener("click", () => send("openSettings"));
  document.getElementById("dashboardBtn").addEventListener("click", () => send("openDashboard"));
  document.getElementById("syncBtn").addEventListener("click", syncNow);
  document.getElementById("themeBtn").addEventListener("click", toggleTheme);
  await refresh();
}

async function refresh() {
  try {
    state = await send("getState");
    applyTheme(state.settings.theme);
    updateThemeButton();
    render();
  } catch (error) {
    app.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

function render() {
  const connected = Boolean(state.settings.userId && state.settings.apiToken);
  if (!connected) {
    app.innerHTML = `<div class="notice"><strong>Connect Habitica</strong>Add your User ID and API Token once.<br><button id="setup" class="primary" style="margin-top:10px">Open settings</button></div>`;
    document.getElementById("setup").onclick = () => send("openSettings");
    return;
  }

  const today = dateKey();
  const items = (state.activities || []).filter(item => dateKey(item.completedAt) === today);
  const assigned = items.filter(item => !item.pending);
  const pending = items.filter(item => item.pending);
  const total = assigned.reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0);
  const categoryRows = aggregate(assigned, "category").slice(0, 5);
  const categoryCount = new Set(assigned.map(item => item.category)).size;

  app.innerHTML = `
    <section class="card">
      <div class="hero"><div><div class="eyebrow">Today</div><div class="big">${formatMinutes(total)}</div><div class="sub">activity time</div></div><div class="pulse">◷</div></div>
      <div class="metric-grid">
        <div class="metric"><strong>${items.length}</strong><span>Completions</span></div>
        <div class="metric"><strong>${activeHours(assigned)}</strong><span>Active hours</span></div>
        <div class="metric"><strong>${categoryCount}</strong><span>Categories</span></div>
      </div>
    </section>
    <section class="card">
      <div class="section-title"><span>Categories</span><span class="${pending.length ? "pending" : "ready"}">${pending.length ? `${pending.length} need setup` : "Web capture ready"}</span></div>
      <div class="bars">${categoryRows.length ? categoryRows.map(row => barRow(row, total)).join("") : `<div class="notice">Complete a configured Habitica task to see activity here.</div>`}</div>
    </section>
    <div class="status">${state.lastSyncAt ? `Task sync ${new Date(state.lastSyncAt).toLocaleString()}` : "Tasks have not been synced yet."}</div>`;
}

function aggregate(items, key) {
  const map = new Map();
  for (const item of items) {
    const name = item[key] || "Unassigned";
    map.set(name, (map.get(name) || 0) + Number(item.durationMinutes || 0));
  }
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function barRow(row, total) {
  const width = total ? Math.max(2, row.value / total * 100) : 0;
  const color = categoryColor(row.name);
  return `<div class="bar-row"><div class="bar-name" title="${escapeHtml(row.name)}"><span class="dot" style="background:${color}"></span>${escapeHtml(row.name)}</div><div class="track"><div class="fill" style="width:${width}%;background:${color}"></div></div><div class="bar-value">${formatMinutes(row.value)}</div></div>`;
}

function activeHours(items) {
  const set = new Set();
  for (const item of items) {
    if (Number(item.durationMinutes || 0) <= 0) continue;
    const start = new Date(item.blockStartAt ?? item.estimatedStartAt);
    const end = new Date(item.completedAt);
    for (let t = new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()).getTime(); t <= end.getTime(); t += 3600000) {
      const d = new Date(t);
      set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`);
    }
  }
  return set.size;
}

async function syncNow() {
  const button = document.getElementById("syncBtn");
  button.textContent = "…";
  button.disabled = true;
  try {
    const result = await send("syncTasks");
    await refresh();
    if (result.added) button.title = `${result.added} completion${result.added > 1 ? "s" : ""} recovered`;
  } catch (error) { app.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`; }
  finally { button.textContent = "↻"; button.disabled = false; }
}

async function toggleTheme() {
  const next = state.settings.theme === "light" ? "dark" : "light";
  await send("setTheme", { theme: next });
  state.settings.theme = next;
  applyTheme(next);
  updateThemeButton();
}

function updateThemeButton() {
  document.getElementById("themeBtn").textContent = state.settings.theme === "light" ? "☾" : "☀";
}
