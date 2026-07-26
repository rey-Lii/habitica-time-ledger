(() => {
  const CARD_SELECTOR = ".task-wrapper .task, .task-wrapper > .task, .task.type_habit, .task.type_daily, .task.type_todo";
  let state = null;
  let scanTimer = null;

  refreshState();
  observeTasks();
  document.addEventListener("click", captureHabiticaAction, true);
  chrome.storage.onChanged.addListener(() => refreshState());

  async function refreshState() {
    try {
      state = await call("getState");
      decorateTasks();
    } catch {
      // A page refresh reconnects the content script after an extension reload.
    }
  }

  function observeTasks() {
    const observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(decorateTasks, 120);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function decorateTasks() {
    if (!state?.tasks?.length) return;
    const groups = groupTasks(state.tasks);
    const seen = new Map();
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
      const type = typeFromCard(card);
      const title = taskTitle(card);
      if (!type || !title) continue;
      const key = `${type}::${title.toLowerCase()}`;
      const index = seen.get(key) || 0;
      seen.set(key, index + 1);
      const task = (groups.get(key) || [])[index] || (groups.get(key) || [])[0];
      if (task) card.dataset.htlTaskId = task.id;
    }
  }

  function groupTasks(tasks) {
    const map = new Map();
    for (const task of tasks) {
      const key = `${task.type}::${normalizeText(task.text).toLowerCase()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(task);
    }
    return map;
  }

  function captureHabiticaAction(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const card = target.closest(CARD_SELECTOR);
    if (!card) return;

    const type = typeFromCard(card);
    const title = taskTitle(card);
    const taskId = card.dataset.htlTaskId || "";
    if (!type || !title) return;

    let action = null;
    if (type === "habit") {
      const positive = target.closest(".habit-control-positive-enabled, .habit-control.positive, .habit-control");
      if (!positive || !positive.closest(".left-control")) return;
      const leftControl = positive.closest(".left-control");
      const allLeftControls = [...card.querySelectorAll(":scope > .d-flex > .left-control, .left-control")];
      if (allLeftControls.length > 1 && leftControl === allLeftControls[allLeftControls.length - 1]) return;
      action = "complete";
    } else {
      const control = target.closest(".daily-todo-control, [role='checkbox'].task-control");
      if (!control) return;
      const wasCompleted = Boolean(control.querySelector(".display-check-icon")) || control.getAttribute("aria-checked") === "true";
      action = wasCompleted ? "undo" : "complete";
    }

    const occurredAt = Date.now();
    // The network observer normally records the exact task ID. This delayed DOM
    // event is a fallback for browser builds where webRequest is unavailable.
    setTimeout(() => {
      call("recordWebAction", {
        event: { taskId, taskName: title, taskType: type, action, occurredAt }
      }).catch(() => {});
    }, 1100);
  }

  function taskTitle(card) {
    return normalizeText(
      card.querySelector(".task-title")?.textContent ||
      card.querySelector("h3.markdown")?.textContent ||
      card.querySelector(".task-content h3")?.textContent || ""
    );
  }

  function typeFromCard(card) {
    if (card.classList.contains("type_habit") || card.closest(".type_habit")) return "habit";
    if (card.classList.contains("type_daily") || card.closest(".type_daily")) return "daily";
    if (card.classList.contains("type_todo") || card.closest(".type_todo")) return "todo";
    return null;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  async function call(action, payload = {}) {
    const response = await chrome.runtime.sendMessage({ action, ...payload });
    if (!response?.ok) throw new Error(response?.error || "Time Ledger error");
    return response.data;
  }
})();
