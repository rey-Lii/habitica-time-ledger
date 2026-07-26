const DEFAULT_CATEGORIES = [
  "Career", "Research", "Clinical", "Learning", "Health", "Life", "Rest", "Unassigned"
];

const DEFAULT_STATE = {
  settings: {
    userId: "",
    apiToken: "",
    clientId: "",
    theme: "dark",
    applyToSimilar: true
  },
  categories: DEFAULT_CATEGORIES,
  tasks: [],
  mappings: {},
  mappingTemplates: {},
  activities: [],
  lastSyncAt: null,
  recentEventKeys: [],
  recentScoreSignals: []
};

const CATEGORY_RULES = [
  { pattern: /投递|套磁|申请|岗位|职位|\bpi\b|application|phd|博士|cover\s*letter|邮件/i, category: "Career", project: "PhD Applications" },
  { pattern: /paper|论文|模型|代码|coding|mci|adni|nacc|refine|表格|manuscript|research/i, category: "Research", project: "Research" },
  { pattern: /跟诊|病历|病例|临床|门诊|clinical|medicine|医学/i, category: "Clinical", project: "Clinical Work" },
  { pattern: /学习|study|read|reading|english|language|课程|复习/i, category: "Learning", project: "Learning" },
  { pattern: /健身|跑步|run|exercise|脊柱|拉伸|饮食|减肥|健康|睡眠|漱口/i, category: "Health", project: "Health" },
  { pattern: /洗脸|护肤|梳头|收拾|房子|家务|猫|personal\s*care/i, category: "Life", project: "Personal Care" },
  { pattern: /休息|娱乐|游戏|放松|rest|break/i, category: "Rest", project: "Rest" }
];

chrome.runtime.onInstalled.addListener(async () => {
  await initializeStore();
  chrome.alarms.create("ledger-sync-hint", { periodInMinutes: 30 });
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeStore();
  chrome.alarms.create("ledger-sync-hint", { periodInMinutes: 30 });
  await updateBadge();
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "ledger-sync-hint") await updateBadge();
});

chrome.storage.onChanged.addListener(() => updateBadge());

// Habitica's web client scores tasks through /tasks/:id/score/:direction.
// Watching the completed request gives us the exact task ID without touching Habitica's UI.
chrome.webRequest.onCompleted.addListener(
  details => {
    if (details.statusCode < 200 || details.statusCode >= 300) return;
    handleScoreRequest(details).catch(() => {});
  },
  { urls: [
    "https://habitica.com/api/v3/tasks/*/score/*",
    "https://*.habitica.com/api/v3/tasks/*/score/*",
    "https://habitica.com/api/v4/tasks/*/score/*",
    "https://*.habitica.com/api/v4/tasks/*/score/*"
  ] }
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(data => sendResponse({ ok: true, data }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

async function initializeStore() {
  const current = await chrome.storage.local.get(null);
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULT_STATE)) {
    if (current[key] === undefined) patch[key] = value;
  }

  const oldSettings = current.settings || {};
  patch.settings = {
    ...DEFAULT_STATE.settings,
    ...oldSettings,
    theme: oldSettings.theme === "light" ? "light" : "dark"
  };

  if (current.mappings) {
    const migrated = {};
    for (const [taskId, mapping] of Object.entries(current.mappings)) {
      migrated[taskId] = normalizeMapping({
        category: mapping.category || mapping.domain || "Unassigned",
        project: mapping.project || "",
        durationMinutes: mapping.durationMinutes,
        configured: mapping.configured,
        suggested: mapping.suggested,
        updatedAt: mapping.updatedAt
      });
    }
    patch.mappings = migrated;
  }

  if (current.activities) {
    patch.activities = current.activities.map(normalizeActivity);
  }

  // Preserve task setup independently from Habitica task IDs. To-Dos receive a
  // new ID when deleted and recreated, so exact-name and optional stem templates
  // let the replacement task inherit its previous category, project and minutes.
  const templates = { ...(current.mappingTemplates || {}) };
  const migratedMappings = patch.mappings || current.mappings || {};
  for (const task of current.tasks || []) {
    const mapping = normalizeMapping(migratedMappings[task.id]);
    if (!mapping.configured) continue;
    templates[exactTemplateKey(task)] = { ...mapping, suggested: true };
    if (patch.settings.applyToSimilar) {
      const stem = taskStem(task.text);
      if (stem.length >= 2) templates[stemTemplateKey(task)] = { ...mapping, suggested: true };
    }
  }
  patch.mappingTemplates = templates;

  await chrome.storage.local.set(patch);
}

async function handleMessage(message) {
  switch (message.action) {
    case "getState": return buildState();
    case "saveSettings": return saveSettings(message.settings || {});
    case "setTheme": return setTheme(message.theme);
    case "syncTasks": return syncTasks();
    case "saveTaskMapping": return saveTaskMapping(message.taskId, message.mapping || {}, Boolean(message.applySimilar));
    case "recordWebAction": return recordWebAction(message.event || {});
    case "updateActivity": return updateActivity(message.activityId, message.patch || {});
    case "deleteActivity": return deleteActivity(message.activityId);
    case "clearActivities": return clearActivities();
    case "openDashboard":
      await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
      return true;
    case "openSettings":
      await chrome.runtime.openOptionsPage();
      return true;
    default: throw new Error(`Unknown action: ${message.action}`);
  }
}

async function buildState() {
  const store = await chrome.storage.local.get(null);
  return {
    settings: { ...DEFAULT_STATE.settings, ...(store.settings || {}) },
    categories: store.categories || DEFAULT_CATEGORIES,
    tasks: store.tasks || [],
    mappings: store.mappings || {},
    activities: (store.activities || []).map(normalizeActivity),
    lastSyncAt: store.lastSyncAt || null
  };
}

async function saveSettings(settings) {
  const current = (await chrome.storage.local.get("settings")).settings || DEFAULT_STATE.settings;
  const next = { ...DEFAULT_STATE.settings, ...current, ...settings };
  if (next.userId && !next.clientId) next.clientId = `${next.userId}-habitica-time-ledger`;
  next.theme = next.theme === "light" ? "light" : "dark";
  await chrome.storage.local.set({ settings: next });
  return next;
}

async function setTheme(theme) {
  return saveSettings({ theme: theme === "light" ? "light" : "dark" });
}

async function habiticaRequest(path, settings) {
  if (!settings?.userId || !settings?.apiToken) {
    throw new Error("Connect your Habitica account in Settings first.");
  }
  const clientId = settings.clientId || `${settings.userId}-habitica-time-ledger`;
  const response = await fetch(`https://habitica.com/api/v3${path}`, {
    headers: {
      "X-API-User": settings.userId,
      "X-API-Key": settings.apiToken,
      "X-Client": clientId,
      "Accept": "application/json"
    }
  });
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error(`Habitica returned an unreadable response (HTTP ${response.status}).`); }
  if (!response.ok || !payload.success) {
    throw new Error(payload.message || payload.error || `Habitica API error ${response.status}`);
  }
  return payload.data;
}

async function syncTasks() {
  const store = await chrome.storage.local.get(["settings", "tasks", "mappings", "mappingTemplates", "activities", "recentEventKeys"]);
  const settings = store.settings || {};
  const syncedAt = Date.now();
  const tagData = await habiticaRequest("/user?userFields=tags", settings);
  const tagMap = {};
  for (const tag of tagData?.tags || []) {
    const id = String(tag.id || tag._id || "");
    if (id) tagMap[id] = stripHtml(String(tag.name || "").trim());
  }

  const data = await habiticaRequest("/tasks/user", settings);
  const oldTasks = store.tasks || [];
  const oldById = Object.fromEntries(oldTasks.map(task => [task.id, task]));
  const tasks = (Array.isArray(data) ? data : [])
    .filter(task => ["habit", "daily", "todo"].includes(task.type))
    .map(task => ({
      id: String(task.id || task._id || ""),
      text: stripHtml(String(task.text || "").trim()),
      type: task.type,
      completed: Boolean(task.completed),
      value: Number.isFinite(Number(task.value)) ? Number(task.value) : null,
      tags: (task.tags || []).map(id => tagMap[String(id)] || String(id)),
      firstSeenAt: oldById[String(task.id || task._id || "")]?.firstSeenAt || syncedAt,
      syncedAt
    }))
    .filter(task => task.id && task.text)
    .sort(taskSort);

  const mappings = { ...(store.mappings || {}) };
  const mappingTemplates = { ...(store.mappingTemplates || {}) };
  for (const task of tasks) {
    if (!mappings[task.id]) {
      const copied = findTemplateMapping(task, mappingTemplates, settings.applyToSimilar)
        || findSimilarConfiguredMapping(task, tasks, mappings);
      mappings[task.id] = copied || suggestMapping(task);
    } else {
      mappings[task.id] = normalizeMapping(mappings[task.id]);
    }
  }

  let activities = (store.activities || []).map(normalizeActivity);
  let added = 0;
  let removed = 0;

  // A manual sync doubles as a recovery path when a webpage event was missed.
  // We only compare tasks that were present in the previous snapshot, so the first
  // sync never imports a backlog of old completed tasks.
  for (const task of tasks) {
    const old = oldById[task.id];
    if (!old) continue;

    if (task.type === "daily" || task.type === "todo") {
      if (!old.completed && task.completed) {
        const result = addActivityForTask({
          activities,
          task,
          mapping: mappings[task.id],
          occurredAt: syncedAt,
          source: "habitica-sync",
          timeAccuracy: "sync-detected",
          eventKey: `sync:${task.id}:${localDateKey(syncedAt)}:complete`
        });
        activities = result.activities;
        if (result.added) added += 1;
      } else if (old.completed && !task.completed) {
        const result = removeLatestTaskActivity(activities, task.id);
        activities = result.activities;
        if (result.removed) removed += 1;
      }
    } else if (task.type === "habit" && old.value !== null && task.value !== null && task.value > old.value + 0.000001) {
      const result = addActivityForTask({
        activities,
        task,
        mapping: mappings[task.id],
        occurredAt: syncedAt,
        source: "habitica-sync",
        timeAccuracy: "sync-detected",
        eventKey: `sync:${task.id}:${syncedAt}:habit-up`
      });
      activities = result.activities;
      if (result.added) added += 1;
    }
  }

  await chrome.storage.local.set({ tasks, mappings, mappingTemplates, activities, lastSyncAt: syncedAt });
  await updateBadge();
  return {
    count: tasks.length,
    assigned: tasks.filter(task => mappings[task.id]?.configured).length,
    added,
    removed,
    tasks
  };
}

async function handleScoreRequest(details) {
  let parsed;
  try { parsed = new URL(details.url); }
  catch { return; }
  const match = parsed.pathname.match(/\/api\/v(?:3|4)\/tasks\/([^/]+)\/score\/(up|down)\/?$/i);
  if (!match) return;
  const taskId = decodeURIComponent(match[1]);
  const direction = match[2].toLowerCase();
  await recordScoreAction({
    taskId,
    direction,
    occurredAt: Date.now(),
    requestId: details.requestId
  });
}

async function recordScoreAction({ taskId, direction, occurredAt, requestId }) {
  let store = await chrome.storage.local.get(["tasks", "mappings", "activities", "recentEventKeys", "recentScoreSignals"]);
  let tasks = store.tasks || [];
  let task = tasks.find(item => item.id === taskId);

  // A newly created or recreated To-Do may be scored before the user manually
  // presses Sync. Refresh the task list once, then continue recording the exact
  // web completion. Name templates will restore its previous setup automatically.
  if (!task) {
    try {
      await syncTasks();
      store = await chrome.storage.local.get(["tasks", "mappings", "activities", "recentEventKeys", "recentScoreSignals"]);
      tasks = store.tasks || [];
      task = tasks.find(item => item.id === taskId);
    } catch {
      // Keep the event handler silent; manual Sync remains available as recovery.
    }
  }
  if (!task) return { ignored: true, reason: "task-not-synced" };

  const action = scoreDirectionToAction(task.type, direction);
  if (action === "ignore") return { ignored: true, reason: "habit-down" };

  const now = Number(occurredAt || Date.now());
  const signal = { taskId, action, at: now };
  const recentScoreSignals = cleanRecentSignals(store.recentScoreSignals, now);
  recentScoreSignals.push(signal);

  const eventKey = `webrequest:${requestId || `${taskId}:${direction}:${now}`}`;
  const result = applyTaskAction({
    activities: (store.activities || []).map(normalizeActivity),
    recentEventKeys: store.recentEventKeys || [],
    task,
    mapping: store.mappings?.[task.id],
    action,
    occurredAt: now,
    source: "habitica-web",
    timeAccuracy: "exact-completion",
    eventKey
  });

  const updatedTasks = tasks.map(item => {
    if (item.id !== task.id || item.type === "habit") return item;
    return { ...item, completed: action === "complete", syncedAt: now };
  });

  await chrome.storage.local.set({
    activities: result.activities,
    recentEventKeys: result.recentEventKeys,
    recentScoreSignals,
    tasks: updatedTasks
  });
  await updateBadge();
  return result;
}

function scoreDirectionToAction(type, direction) {
  if (type === "habit") return direction === "up" ? "complete" : "ignore";
  return direction === "up" ? "complete" : "undo";
}

async function recordWebAction(event) {
  const store = await chrome.storage.local.get(["tasks", "mappings", "activities", "recentEventKeys", "recentScoreSignals"]);
  const occurredAt = Number(event.occurredAt || Date.now());
  const action = event.action;

  // This DOM listener is only a fallback. If the exact network score request was
  // already observed, ignore the less reliable text-based event.
  const recentScoreSignals = cleanRecentSignals(store.recentScoreSignals, occurredAt);
  if (recentScoreSignals.some(item => item.action === action && Math.abs(occurredAt - item.at) < 5000)) {
    await chrome.storage.local.set({ recentScoreSignals });
    return { ignored: true, reason: "network-event-already-recorded" };
  }

  const task = resolveTask(event, store.tasks || []);
  if (!task) throw new Error("Could not match this Habitica task. Use Sync Now and refresh Habitica.");

  const result = applyTaskAction({
    activities: (store.activities || []).map(normalizeActivity),
    recentEventKeys: store.recentEventKeys || [],
    task,
    mapping: store.mappings?.[task.id],
    action,
    occurredAt,
    source: "habitica-web-fallback",
    timeAccuracy: "exact-completion",
    eventKey: `fallback:${task.id}:${action}:${Math.floor(occurredAt / 5000)}`
  });

  await chrome.storage.local.set({
    activities: result.activities,
    recentEventKeys: result.recentEventKeys,
    recentScoreSignals
  });
  await updateBadge();
  return result;
}

function applyTaskAction({ activities, recentEventKeys, task, mapping, action, occurredAt, source, timeAccuracy, eventKey }) {
  const cleanKeys = (recentEventKeys || []).filter(item => occurredAt - item.at < 30000);
  if (cleanKeys.some(item => item.key === eventKey)) {
    return { activities, recentEventKeys: cleanKeys, ignored: true, reason: "duplicate-event" };
  }
  cleanKeys.push({ key: eventKey, at: occurredAt });

  if (action === "undo") {
    const result = removeLatestTaskActivity(activities, task.id);
    return { ...result, recentEventKeys: cleanKeys };
  }

  const result = addActivityForTask({
    activities,
    task,
    mapping,
    occurredAt,
    source,
    timeAccuracy,
    eventKey
  });
  return { ...result, recentEventKeys: cleanKeys };
}

function addActivityForTask({ activities, task, mapping, occurredAt, source, timeAccuracy, eventKey }) {
  if (eventKey && activities.some(item => item.eventKey === eventKey)) {
    return { activities, added: false, ignored: true, reason: "event-key-exists" };
  }

  if (task.type !== "habit") {
    const day = localDateKey(occurredAt);
    const existing = activities.some(item => item.taskId === task.id && localDateKey(item.completedAt) === day);
    if (existing) return { activities, added: false, ignored: true, reason: "already-recorded" };
  }

  const normalizedMapping = normalizeMapping(mapping);
  let activity = {
    id: crypto.randomUUID(),
    eventKey: eventKey || "",
    taskId: task.id,
    taskName: task.text,
    taskType: task.type,
    category: "Unassigned",
    project: "",
    durationMinutes: null,
    completedAt: occurredAt,
    blockStartAt: occurredAt,
    source,
    timeAccuracy,
    pending: true,
    createdAt: Date.now()
  };
  if (normalizedMapping.configured) activity = applyMappingToActivity(activity, normalizedMapping);
  return { activities: [activity, ...activities].slice(0, 15000), activity, added: true, pending: activity.pending };
}

function removeLatestTaskActivity(activities, taskId) {
  const index = activities.findIndex(item => item.taskId === taskId);
  if (index < 0) return { activities, removed: false };
  return { activities: activities.filter((_, i) => i !== index), removed: true };
}

function cleanRecentSignals(signals, now) {
  return (signals || []).filter(item => now - item.at < 15000);
}

function stripHtml(value) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function taskSort(a, b) {
  const order = { todo: 1, daily: 2, habit: 3 };
  return (order[a.type] - order[b.type]) || a.text.localeCompare(b.text, "en");
}

function normalizeMapping(mapping = {}) {
  const duration = mapping.durationMinutes;
  const parsedDuration = duration === null || duration === "" || duration === undefined ? null : Number(duration);
  return {
    category: DEFAULT_CATEGORIES.includes(mapping.category) ? mapping.category : (mapping.domain || "Unassigned"),
    project: String(mapping.project || "").trim(),
    durationMinutes: Number.isFinite(parsedDuration) ? Math.max(0, parsedDuration) : null,
    configured: Boolean(mapping.configured && Number.isFinite(parsedDuration) && (DEFAULT_CATEGORIES.includes(mapping.category) ? mapping.category : (mapping.domain || "Unassigned")) !== "Unassigned"),
    suggested: Boolean(mapping.suggested),
    updatedAt: mapping.updatedAt || Date.now()
  };
}

function normalizeActivity(activity = {}) {
  const completedAt = Number(activity.completedAt || Date.now());
  const duration = activity.durationMinutes === null || activity.durationMinutes === undefined
    ? null
    : Math.max(0, Math.round(Number(activity.durationMinutes) || 0));
  return {
    ...activity,
    completedAt,
    durationMinutes: duration,
    blockStartAt: Number(activity.blockStartAt ?? activity.estimatedStartAt ?? (duration === null ? completedAt : completedAt - duration * 60000)),
    pending: Boolean(activity.pending)
  };
}

function suggestMapping(task) {
  const haystack = `${task.text} ${(task.tags || []).join(" ")}`;
  let category = "Unassigned";
  let project = "";

  for (const tag of task.tags || []) {
    const exact = DEFAULT_CATEGORIES.find(item => item.toLowerCase() === String(tag).toLowerCase());
    if (exact && exact !== "Unassigned") {
      category = exact;
      break;
    }
  }

  if (category === "Unassigned") {
    const rule = CATEGORY_RULES.find(item => item.pattern.test(haystack));
    if (rule) {
      category = rule.category;
      project = rule.project;
    }
  }

  const durationMinutes = parseDuration(task.text);
  return {
    category,
    project,
    durationMinutes,
    configured: category !== "Unassigned" && durationMinutes !== null,
    suggested: true,
    updatedAt: Date.now()
  };
}

function exactTemplateKey(task) {
  return `exact::${task.type}::${normalizeText(task.text).toLowerCase()}`;
}

function stemTemplateKey(task) {
  return `stem::${task.type}::${taskStem(task.text)}`;
}

function findTemplateMapping(task, templates, allowSimilar) {
  const exact = normalizeMapping(templates?.[exactTemplateKey(task)]);
  if (exact.configured) return { ...exact, suggested: true, updatedAt: Date.now() };
  if (!allowSimilar) return null;
  const stem = taskStem(task.text);
  if (stem.length < 2) return null;
  const similar = normalizeMapping(templates?.[stemTemplateKey(task)]);
  return similar.configured ? { ...similar, suggested: true, updatedAt: Date.now() } : null;
}

function findSimilarConfiguredMapping(task, tasks, mappings) {
  const stem = taskStem(task.text);
  if (!stem || stem.length < 2) return null;
  for (const other of tasks) {
    if (other.id === task.id || other.type !== task.type || taskStem(other.text) !== stem) continue;
    const mapping = normalizeMapping(mappings[other.id]);
    if (mapping.configured) return { ...mapping, suggested: true, updatedAt: Date.now() };
  }
  return null;
}

function taskStem(text) {
  return stripHtml(String(text || ""))
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .replace(/\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|min|m|小时|小時|分鐘|分钟)/gi, "")
    .replace(/[零一二两三四五六七八九十百]+\s*(?:分鐘|分钟)/g, "")
    .replace(/[ #№_-]*\d+(?:\.\d+)?\s*$/g, "")
    .trim();
}

function parseDuration(text) {
  const value = String(text || "").toLowerCase();
  let match = value.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h|小时|小時)/i);
  if (match) return Math.max(0, Math.round(Number(match[1]) * 60));
  match = value.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|min|m|分钟|分鐘)/i);
  if (match) return Math.max(0, Math.round(Number(match[1])));
  match = value.match(/([零一二两三四五六七八九十百]+)\s*(?:分钟|分鐘)/);
  if (match) return chineseNumber(match[1]);
  return null;
}

function chineseNumber(text) {
  const map = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (!text) return 0;
  if (text === "十") return 10;
  if (text === "百") return 100;
  if (text.includes("百")) {
    const [a, rest = ""] = text.split("百");
    return (map[a] || 1) * 100 + chineseNumber(rest || "零");
  }
  if (text.includes("十")) {
    const [a, b] = text.split("十");
    return (a ? (map[a] || 0) : 1) * 10 + (b ? (map[b] || 0) : 0);
  }
  return [...text].reduce((sum, char) => sum * 10 + (map[char] ?? 0), 0);
}

async function saveTaskMapping(taskId, mapping, applySimilar) {
  const store = await chrome.storage.local.get(["tasks", "mappings", "mappingTemplates", "activities", "settings"]);
  const tasks = store.tasks || [];
  const task = tasks.find(item => item.id === taskId);
  if (!task) throw new Error("Task not found. Sync Habitica and try again.");

  const duration = Number(mapping.durationMinutes);
  if (!Number.isFinite(duration) || duration < 0 || duration > 1440) {
    throw new Error("Minutes must be between 0 and 1440.");
  }
  const normalized = {
    category: DEFAULT_CATEGORIES.includes(mapping.category) ? mapping.category : "Unassigned",
    project: String(mapping.project || "").trim(),
    durationMinutes: Math.round(duration),
    configured: (DEFAULT_CATEGORIES.includes(mapping.category) ? mapping.category : "Unassigned") !== "Unassigned",
    suggested: false,
    updatedAt: Date.now()
  };

  const mappings = { ...(store.mappings || {}), [taskId]: normalized };
  const mappingTemplates = { ...(store.mappingTemplates || {}) };
  const useSimilar = applySimilar || Boolean(store.settings?.applyToSimilar);
  mappingTemplates[exactTemplateKey(task)] = { ...normalized, suggested: true };
  if (useSimilar) {
    const stem = taskStem(task.text);
    if (stem.length >= 2) mappingTemplates[stemTemplateKey(task)] = { ...normalized, suggested: true };
  }
  const updatedIds = [taskId];
  if (useSimilar) {
    const stem = taskStem(task.text);
    if (stem.length >= 2) {
      for (const other of tasks) {
        if (other.id !== taskId && other.type === task.type && taskStem(other.text) === stem) {
          mappings[other.id] = { ...normalized, updatedAt: Date.now() };
          updatedIds.push(other.id);
        }
      }
    }
  }

  const activities = (store.activities || []).map(normalizeActivity).map(activity => {
    if (!updatedIds.includes(activity.taskId) || !activity.pending) return activity;
    const selected = mappings[activity.taskId] || normalized;
    return applyMappingToActivity(activity, selected);
  });

  await chrome.storage.local.set({ mappings, mappingTemplates, activities });
  await updateBadge();
  return { mapping: normalized, updatedCount: updatedIds.length };
}

function applyMappingToActivity(activity, mapping) {
  const durationMinutes = Math.max(0, Math.round(Number(mapping.durationMinutes || 0)));
  return {
    ...activity,
    category: mapping.category || "Unassigned",
    project: mapping.project || "",
    durationMinutes,
    blockStartAt: activity.completedAt - durationMinutes * 60000,
    pending: false
  };
}

function resolveTask(event, tasks) {
  if (event.taskId) {
    const direct = tasks.find(task => task.id === event.taskId);
    if (direct) return direct;
  }
  const normalizedText = normalizeText(event.taskName).toLowerCase();
  const candidates = tasks.filter(task => task.type === event.taskType && normalizeText(task.text).toLowerCase() === normalizedText);
  return candidates.length === 1 ? candidates[0] : null;
}

function normalizeText(value) {
  return stripHtml(String(value || "")).replace(/\s+/g, " ").trim();
}

function localDateKey(timestamp) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function updateActivity(activityId, patch) {
  const store = await chrome.storage.local.get("activities");
  let found = false;
  const activities = (store.activities || []).map(normalizeActivity).map(activity => {
    if (activity.id !== activityId) return activity;
    found = true;
    const completedAt = patch.completedAt !== undefined ? Number(patch.completedAt) : activity.completedAt;
    const durationMinutes = patch.durationMinutes !== undefined
      ? Math.max(0, Math.round(Number(patch.durationMinutes)))
      : Number(activity.durationMinutes || 0);
    if (!Number.isFinite(completedAt) || !Number.isFinite(durationMinutes)) throw new Error("Invalid activity values.");
    return {
      ...activity,
      category: patch.category || activity.category,
      project: patch.project !== undefined ? String(patch.project).trim() : activity.project,
      durationMinutes,
      completedAt,
      blockStartAt: completedAt - durationMinutes * 60000,
      pending: false,
      editedAt: Date.now()
    };
  });
  if (!found) throw new Error("Activity not found.");
  await chrome.storage.local.set({ activities });
  return true;
}

async function deleteActivity(activityId) {
  const store = await chrome.storage.local.get("activities");
  await chrome.storage.local.set({ activities: (store.activities || []).filter(item => item.id !== activityId) });
  await updateBadge();
  return true;
}

async function clearActivities() {
  await chrome.storage.local.set({ activities: [] });
  await updateBadge();
  return true;
}

async function updateBadge() {
  const store = await chrome.storage.local.get("activities");
  const pending = (store.activities || []).filter(item => item.pending).length;
  await chrome.action.setBadgeText({ text: pending ? String(Math.min(pending, 99)) : "" });
  if (pending) await chrome.action.setBadgeBackgroundColor({ color: "#8B5CF6" });
}
