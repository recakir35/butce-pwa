const STORAGE_NOTES_KEY = "butce_notes_v2";
const STORAGE_NOTE_GROUPS_KEY = "butce_note_groups_v1";
const STORAGE_FIRED_REMINDERS_KEY = "butce_fired_reminders_v1";

const DEFAULT_NOTE_GROUPS = [
  "Genel",
  "Fatura & Ödeme",
  "Bütçe & Plan",
  "Kredi Kartı",
  "Aile"
];

const REPEAT_SORT_ORDER = {
  daily: 1,
  weekly: 2,
  monthly: 3,
  yearly: 4,
  none: 5
};

let notesList = []; // [ { id, text, group, period, dueDate, reminderAt, repeat, done, createdLabel, yearlySpawned } ]
let noteGroupsList = [...DEFAULT_NOTE_GROUPS];
let firedRemindersMap = {}; // { [noteId]: fireKey }
let reminderIntervalId = null;
let editingNoteId = null;

let getActivePeriodFn = () => "";
let getRegisteredPeriodsFn = () => [];
let onChangeCallbackFn = () => {};

function escapeNoteHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function repeatLabel(repeat) {
  if (repeat === "daily") return "Günlük";
  if (repeat === "weekly") return "Haftalık";
  if (repeat === "monthly") return "Aylık";
  if (repeat === "yearly") return "Yıllık";
  return "Tek Seferlik";
}

function compareNotesByRepeatAndGroup(a, b) {
  const repA = REPEAT_SORT_ORDER[a.repeat || "none"] ?? 99;
  const repB = REPEAT_SORT_ORDER[b.repeat || "none"] ?? 99;
  if (repA !== repB) return repA - repB;

  const grpA = String(a.group || "Genel");
  const grpB = String(b.group || "Genel");
  const grpCmp = grpA.localeCompare(grpB, "tr", { sensitivity: "base" });
  if (grpCmp !== 0) return grpCmp;

  const remA = a.reminderAt || a.dueDate || "9999-99-99";
  const remB = b.reminderAt || b.dueDate || "9999-99-99";
  return remA.localeCompare(remB);
}

function formatDateTimeTr(dtStr) {
  if (!dtStr) return "";
  const d = new Date(dtStr);
  if (Number.isNaN(d.getTime())) return dtStr;
  return d.toLocaleString("tr-TR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function toLocalDatetimeInputValue(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  const hh = String(dateObj.getHours()).padStart(2, "0");
  const mm = String(dateObj.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function addYearsToPeriod(periodStr, yearsToAdd = 1) {
  if (!periodStr) return "";
  const match = /^(\d{4})-(\d{2})$/.exec(String(periodStr).trim());
  if (!match) return periodStr;
  const nextYear = Number(match[1]) + yearsToAdd;
  return `${nextYear}-${match[2]}`;
}

function addYearsToDateInput(dateStr, yearsToAdd = 1) {
  if (!dateStr) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).trim());
  if (!match) return dateStr;
  const targetYear = Number(match[1]) + yearsToAdd;
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Şubat 29 gibi durumlarda ay taşmasını önle
  const clamped = new Date(targetYear, month, 0).getDate();
  const safeDay = Math.min(day, clamped);
  return `${targetYear}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function addYearsToDatetimeInput(dtStr, yearsToAdd = 1) {
  if (!dtStr) return "";
  const d = new Date(dtStr);
  if (Number.isNaN(d.getTime())) return dtStr;
  const next = new Date(d.getTime());
  next.setFullYear(next.getFullYear() + yearsToAdd);
  return toLocalDatetimeInputValue(next);
}

function computeNextReminderValue(currentReminderStr, repeat) {
  const base = new Date(currentReminderStr);
  if (Number.isNaN(base.getTime())) return "";

  const next = new Date(base.getTime());
  if (repeat === "daily") {
    next.setDate(next.getDate() + 1);
  } else if (repeat === "weekly") {
    next.setDate(next.getDate() + 7);
  } else if (repeat === "monthly") {
    next.setMonth(next.getMonth() + 1);
  } else if (repeat === "yearly") {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    return "";
  }
  return toLocalDatetimeInputValue(next);
}

function getCurrentOrActiveMonth() {
  const activePeriod = getActivePeriodFn();
  if (activePeriod && /^\d{4}-(0[1-9]|1[0-2])$/.test(activePeriod)) {
    return activePeriod;
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function addMonthsToYM(ym, offsetMonths) {
  const [y, m] = ym.split("-").map(Number);
  const totalIdx = y * 12 + (m - 1) + offsetMonths;
  const ny = Math.floor(totalIdx / 12);
  const nm = (totalIdx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function saveNotesLocal() {
  localStorage.setItem(STORAGE_NOTES_KEY, JSON.stringify(notesList));
  localStorage.setItem(STORAGE_NOTE_GROUPS_KEY, JSON.stringify(noteGroupsList));
  localStorage.setItem(STORAGE_FIRED_REMINDERS_KEY, JSON.stringify(firedRemindersMap));
  onChangeCallbackFn();
}

export async function requestNotificationPermissionManual() {
  if (typeof Notification === "undefined") {
    alert("Bu tarayıcı bildirim özelliğini desteklemiyor.");
    return "unsupported";
  }
  if (Notification.permission === "granted") {
    return "granted";
  }
  try {
    const perm = await Notification.requestPermission();
    return perm;
  } catch {
    return Notification.permission;
  }
}

export function loadNotesFromStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_NOTES_KEY) || "[]");
    notesList = Array.isArray(raw)
      ? raw.map((n) => ({ ...n, done: Boolean(n.done), yearlySpawned: Boolean(n.yearlySpawned) }))
      : [];
  } catch {
    notesList = [];
  }

  try {
    const rawGroups = JSON.parse(localStorage.getItem(STORAGE_NOTE_GROUPS_KEY) || "[]");
    const mergedGroups = new Set([
      ...DEFAULT_NOTE_GROUPS,
      ...(Array.isArray(rawGroups) ? rawGroups : []),
      ...notesList.map((n) => n.group).filter(Boolean)
    ]);
    noteGroupsList = Array.from(mergedGroups);
  } catch {
    noteGroupsList = [...DEFAULT_NOTE_GROUPS];
  }

  try {
    firedRemindersMap = JSON.parse(localStorage.getItem(STORAGE_FIRED_REMINDERS_KEY) || "{}");
  } catch {
    firedRemindersMap = {};
  }
}

export function getNotesData() {
  return notesList;
}

export function getNoteGroupsData() {
  return noteGroupsList;
}

export function setNotesData(remoteNotes, remoteGroups = null) {
  if (Array.isArray(remoteNotes)) {
    notesList = remoteNotes.map((n) => ({
      ...n,
      done: Boolean(n.done),
      yearlySpawned: Boolean(n.yearlySpawned)
    }));
    localStorage.setItem(STORAGE_NOTES_KEY, JSON.stringify(notesList));
  }
  const merged = new Set([
    ...DEFAULT_NOTE_GROUPS,
    ...noteGroupsList,
    ...(Array.isArray(remoteGroups) ? remoteGroups : []),
    ...notesList.map((n) => n.group).filter(Boolean)
  ]);
  noteGroupsList = Array.from(merged);
  localStorage.setItem(STORAGE_NOTE_GROUPS_KEY, JSON.stringify(noteGroupsList));
  renderNotesPanel();
}

function registerNoteGroupIfNew(groupName) {
  const clean = String(groupName || "").trim();
  if (!clean) return "Genel";
  if (!noteGroupsList.some((g) => g.toLowerCase() === clean.toLowerCase())) {
    noteGroupsList.push(clean);
  }
  return clean;
}

function renderNoteGroupDatalist() {
  const dlEl = document.getElementById("noteGroupList");
  if (!dlEl) return;
  dlEl.innerHTML = noteGroupsList
    .map((g) => `<option value="${escapeNoteHtml(g)}"></option>`)
    .join("");
}

export function syncNotePeriodOptions() {
  const periodSelectEl = document.getElementById("notePeriodSelect");
  if (!periodSelectEl) return;

  const activePeriod = getActivePeriodFn();
  const basePeriod = getCurrentOrActiveMonth();
  const futurePeriods = [];
  for (let i = 1; i <= 24; i++) {
    futurePeriods.push(addMonthsToYM(basePeriod, i));
  }

  const periods = Array.from(
    new Set([
      ...(getRegisteredPeriodsFn() || []),
      ...(activePeriod ? [activePeriod] : []),
      ...futurePeriods,
      ...notesList.map((n) => n.period).filter(Boolean)
    ])
  ).sort();

  const prevVal = periodSelectEl.value;
  const optionsHtml =
    `<option value="">Genel (Dönemsiz)</option>` +
    periods.map((p) => `<option value="${escapeNoteHtml(p)}">${escapeNoteHtml(p)}</option>`).join("");

  periodSelectEl.innerHTML = optionsHtml;

  if (prevVal !== "" && periods.includes(prevVal)) {
    periodSelectEl.value = prevVal;
  } else if (prevVal === "") {
    periodSelectEl.value = editingNoteId ? "" : activePeriod || "";
  } else {
    periodSelectEl.value = activePeriod || "";
  }
}

function ensureNoteEditControls() {
  const formEl = document.getElementById("noteForm");
  if (!formEl) return null;

  let cancelBtn = document.getElementById("btnCancelNoteEdit");
  if (!cancelBtn) {
    cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.id = "btnCancelNoteEdit";
    cancelBtn.className = "secondary-btn";
    cancelBtn.textContent = "İptal";
    cancelBtn.style.display = "none";
    formEl.appendChild(cancelBtn);

    cancelBtn.addEventListener("click", () => {
      resetNoteForm();
    });
  }

  const submitBtn = formEl.querySelector('button[type="submit"]');
  return { formEl, submitBtn, cancelBtn };
}

function resetNoteForm() {
  editingNoteId = null;
  const controls = ensureNoteEditControls();
  const textEl = document.getElementById("noteTextInput");
  const groupEl = document.getElementById("noteGroupInput");
  const periodEl = document.getElementById("notePeriodSelect");
  const dueEl = document.getElementById("noteDueDateInput");
  const reminderEl = document.getElementById("noteReminderAtInput");
  const repeatEl = document.getElementById("noteRepeatSelect");

  if (textEl) textEl.value = "";
  if (groupEl) groupEl.value = "";
  if (dueEl) dueEl.value = "";
  if (reminderEl) reminderEl.value = "";
  if (repeatEl) repeatEl.value = "none";
  if (periodEl) {
    const activePeriod = getActivePeriodFn();
    periodEl.value = activePeriod || "";
  }

  if (controls?.submitBtn) controls.submitBtn.textContent = "Not Ekle";
  if (controls?.cancelBtn) controls.cancelBtn.style.display = "none";
}

function startEditingNote(noteId) {
  const target = notesList.find((n) => n.id === noteId);
  if (!target) return;

  editingNoteId = target.id;
  syncNotePeriodOptions();

  const textEl = document.getElementById("noteTextInput");
  const groupEl = document.getElementById("noteGroupInput");
  const periodEl = document.getElementById("notePeriodSelect");
  const dueEl = document.getElementById("noteDueDateInput");
  const reminderEl = document.getElementById("noteReminderAtInput");
  const repeatEl = document.getElementById("noteRepeatSelect");
  const controls = ensureNoteEditControls();

  if (textEl) textEl.value = target.text || "";
  if (groupEl) groupEl.value = target.group || "Genel";
  if (periodEl) {
    if (target.period && !Array.from(periodEl.options).some((o) => o.value === target.period)) {
      const opt = document.createElement("option");
      opt.value = target.period;
      opt.textContent = target.period;
      periodEl.appendChild(opt);
    }
    periodEl.value = target.period || "";
  }
  if (dueEl) dueEl.value = target.dueDate || "";
  if (reminderEl) reminderEl.value = target.reminderAt || "";
  if (repeatEl) repeatEl.value = target.repeat || "none";

  if (controls?.submitBtn) controls.submitBtn.textContent = "Güncelle";
  if (controls?.cancelBtn) controls.cancelBtn.style.display = "inline-block";

  if (textEl) textEl.focus();
}

function spawnNextYearNoteIfNeeded(note) {
  if (!note || !note.done) return;
  if (note.repeat !== "yearly") return;
  if (note.yearlySpawned) return;

  const sourcePeriod = note.period || getActivePeriodFn() || getCurrentOrActiveMonth();
  const nextPeriod = addYearsToPeriod(sourcePeriod, 1);
  const nextDueDate = addYearsToDateInput(note.dueDate, 1);
  const nextReminderAt = addYearsToDatetimeInput(note.reminderAt, 1);

  const alreadyExists = notesList.some(
    (other) =>
      other.id !== note.id &&
      other.text === note.text &&
      (other.group || "Genel") === (note.group || "Genel") &&
      (other.period || "") === nextPeriod &&
      (other.reminderAt || "") === nextReminderAt &&
      !other.done
  );

  note.yearlySpawned = true;

  if (!alreadyExists) {
    notesList.unshift({
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: note.text,
      group: note.group || "Genel",
      period: nextPeriod,
      dueDate: nextDueDate,
      reminderAt: nextReminderAt,
      repeat: "yearly",
      done: false,
      yearlySpawned: false,
      createdLabel: new Date().toLocaleDateString("tr-TR")
    });
  }
}

export function renderPeriodNotesTable() {
  const tbodyEl = document.getElementById("periodNotesTableBody");
  const frameEl = document.getElementById("periodNotesSheetFrame");
  const badgeEl = document.getElementById("periodNotesTitleBadge");
  if (!tbodyEl) return;

  const activePeriod = getActivePeriodFn();
  if (badgeEl) {
    badgeEl.textContent = activePeriod || "Genel";
  }

  const filtered = (
    activePeriod
      ? notesList.filter((n) => !n.period || n.period === activePeriod)
      : [...notesList]
  ).sort(compareNotesByRepeatAndGroup);

  if (!filtered.length) {
    if (frameEl) frameEl.classList.add("empty");
    tbodyEl.innerHTML = `
      <tr>
        <td colspan="3" class="item-meta">Bu dönem için not bulunmuyor.</td>
      </tr>
    `;
    return;
  }

  if (frameEl) frameEl.classList.remove("empty");

  tbodyEl.innerHTML = filtered
    .map((n) => {
      const groupBadge = n.group ? `<span class="badge">${escapeNoteHtml(n.group)}</span>` : "";
      const periodBadge = n.period
        ? `<span class="badge">${escapeNoteHtml(n.period)}</span>`
        : `<span class="badge">Genel</span>`;
      const repBadge = `<span class="badge">${escapeNoteHtml(repeatLabel(n.repeat))}</span>`;
      const textClass = n.done ? "note-done-text" : "";

      return `
        <tr data-period-note-id="${escapeNoteHtml(n.id)}">
          <td>
            <span class="${textClass}">${escapeNoteHtml(n.text)}</span>
            ${groupBadge}
            ${periodBadge}
            ${repBadge}
          </td>
          <td>${escapeNoteHtml(n.dueDate || "-")}</td>
          <td>
            <label class="paid-box">
              <input type="checkbox" class="field-note-done" ${n.done ? "checked" : ""} />
              <span>${n.done ? "Yapıldı" : "Yapılmadı"}</span>
            </label>
          </td>
        </tr>
      `;
    })
    .join("");
}

export function renderNotesPanel() {
  ensureNoteEditControls();
  renderNoteGroupDatalist();
  syncNotePeriodOptions();
  renderPeriodNotesTable();

  const listEl = document.getElementById("notesList");
  const periodLabelEl = document.getElementById("notesActivePeriodLabel");
  if (!listEl) return;

  const activePeriod = getActivePeriodFn();
  if (periodLabelEl) {
    periodLabelEl.textContent = activePeriod
      ? `Dönem: ${activePeriod} (ve İleri Dönemler)`
      : "Tüm Dönemler";
  }

  const filtered = (
    activePeriod
      ? notesList.filter((n) => !n.period || n.period >= activePeriod)
      : [...notesList]
  ).sort(compareNotesByRepeatAndGroup);

  if (!filtered.length) {
    listEl.innerHTML = `<div class="item-meta">Bu dönem için kayıtlı not bulunmuyor.</div>`;
    return;
  }

  listEl.innerHTML = filtered
    .map((n) => {
      const groupText = n.group || "Genel";
      const periodText = n.period || "Genel";
      const statusText = n.done ? "Yapıldı" : "Bekliyor";
      const dueText = n.dueDate ? `Son Tarih: ${escapeNoteHtml(n.dueDate)}` : "";
      const remText = n.reminderAt
        ? `Hatırlatma: ${escapeNoteHtml(formatDateTimeTr(n.reminderAt))}`
        : "";
      const repText = `Tekrar: ${escapeNoteHtml(repeatLabel(n.repeat))}`;
      const metaParts = [dueText, remText, repText].filter(Boolean).join(" · ");

      return `
        <div class="note-card" data-note-id="${escapeNoteHtml(n.id)}">
          <div class="note-card-top">
            <span class="badge">${escapeNoteHtml(groupText)}</span>
            <span class="badge">${escapeNoteHtml(periodText)}</span>
            <span class="badge">${statusText}</span>
          </div>
          <div class="note-card-body ${n.done ? "note-done-text" : ""}">${escapeNoteHtml(n.text)}</div>
          ${metaParts ? `<div class="note-card-meta">${metaParts}</div>` : ""}
          <div class="note-card-footer">
            <span class="item-meta">${escapeNoteHtml(n.createdLabel || "")}</span>
            <div class="row-actions">
              <button type="button" class="edit-btn" data-edit-note-id="${escapeNoteHtml(n.id)}">Düzenle</button>
              <button type="button" class="del-btn" data-delete-note-id="${escapeNoteHtml(n.id)}">Sil</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

async function triggerNoteReminder(note) {
  const title = `Hatırlatma (${note.group || "Not"})`;
  const body = `${note.text}${note.dueDate ? ` — Son Tarih: ${note.dueDate}` : ""}`;

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && typeof reg.showNotification === "function") {
          await reg.showNotification(title, {
            body,
            tag: note.id,
            renotify: true,
            vibrate: [200, 100, 200]
          });
          return;
        }
      }
      new Notification(title, { body });
      return;
    } catch {
      // Fallback aşağıda
    }
  }

  alert(`${title}\n${body}`);
}

export function checkDueReminders() {
  const now = new Date();
  let changed = false;

  for (const note of notesList) {
    if (note.done || !note.reminderAt) continue;

    const remDate = new Date(note.reminderAt);
    if (Number.isNaN(remDate.getTime())) continue;

    if (now >= remDate) {
      const fireKey = `${note.id}__${note.reminderAt}`;
      if (firedRemindersMap[note.id] === fireKey) continue;

      firedRemindersMap[note.id] = fireKey;
      triggerNoteReminder(note);

      if (note.repeat && note.repeat !== "none") {
        const nextRem = computeNextReminderValue(note.reminderAt, note.repeat);
        if (nextRem) {
          note.reminderAt = nextRem;
          delete firedRemindersMap[note.id];
        }
      }
      changed = true;
    }
  }

  if (changed) {
    saveNotesLocal();
    renderNotesPanel();
  }
}

export function initNotesModule({ getActivePeriod, getRegisteredPeriods, onNotesChange } = {}) {
  if (typeof getActivePeriod === "function") getActivePeriodFn = getActivePeriod;
  if (typeof getRegisteredPeriods === "function") getRegisteredPeriodsFn = getRegisteredPeriods;
  if (typeof onNotesChange === "function") onChangeCallbackFn = onNotesChange;

  loadNotesFromStorage();
  ensureNoteEditControls();

  const formEl = document.getElementById("noteForm");
  const textEl = document.getElementById("noteTextInput");
  const groupEl = document.getElementById("noteGroupInput");
  const periodEl = document.getElementById("notePeriodSelect");
  const dueEl = document.getElementById("noteDueDateInput");
  const reminderEl = document.getElementById("noteReminderAtInput");
  const repeatEl = document.getElementById("noteRepeatSelect");
  const listEl = document.getElementById("notesList");
  const periodNotesBodyEl = document.getElementById("periodNotesTableBody");

  if (formEl && textEl) {
    formEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = textEl.value.trim();
      if (!text) return;

      const group = registerNoteGroupIfNew(groupEl?.value || "Genel");
      const period = periodEl ? periodEl.value : getActivePeriodFn();
      const dueDate = dueEl ? dueEl.value : "";
      const reminderAt = reminderEl ? reminderEl.value : "";
      const repeat = repeatEl ? repeatEl.value : "none";

      if (reminderAt && typeof Notification !== "undefined" && Notification.permission === "default") {
        await requestNotificationPermissionManual();
      }

      if (editingNoteId) {
        const idx = notesList.findIndex((n) => n.id === editingNoteId);
        if (idx !== -1) {
          const prev = notesList[idx];
          const repeatChangedToYearly = repeat === "yearly" && prev.repeat !== "yearly";
          notesList[idx] = {
            ...prev,
            text,
            group,
            period,
            dueDate,
            reminderAt,
            repeat,
            yearlySpawned: repeatChangedToYearly ? false : prev.yearlySpawned
          };
          if (notesList[idx].done && repeat === "yearly") {
            spawnNextYearNoteIfNeeded(notesList[idx]);
          }
        }
        resetNoteForm();
      } else {
        const createdLabel = new Date().toLocaleDateString("tr-TR");
        notesList.unshift({
          id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          text,
          group,
          period,
          dueDate,
          reminderAt,
          repeat,
          done: false,
          yearlySpawned: false,
          createdLabel
        });

        textEl.value = "";
        if (dueEl) dueEl.value = "";
        if (reminderEl) reminderEl.value = "";
        if (repeatEl) repeatEl.value = "none";
      }

      saveNotesLocal();
      renderNotesPanel();
    });
  }

  if (listEl) {
    listEl.addEventListener("click", (e) => {
      const editId = e.target.dataset.editNoteId;
      if (editId) {
        startEditingNote(editId);
        return;
      }

      const noteId = e.target.dataset.deleteNoteId;
      if (!noteId) return;
      if (editingNoteId === noteId) {
        resetNoteForm();
      }
      notesList = notesList.filter((n) => n.id !== noteId);
      delete firedRemindersMap[noteId];
      saveNotesLocal();
      renderNotesPanel();
    });
  }

  if (periodNotesBodyEl) {
    periodNotesBodyEl.addEventListener("change", (e) => {
      if (!e.target.classList.contains("field-note-done")) return;
      const tr = e.target.closest("tr");
      const noteId = tr?.dataset.periodNoteId;
      if (!noteId) return;
      const targetNote = notesList.find((n) => n.id === noteId);
      if (!targetNote) return;

      targetNote.done = e.target.checked;
      if (targetNote.done && targetNote.repeat === "yearly") {
        spawnNextYearNoteIfNeeded(targetNote);
      }

      saveNotesLocal();
      renderNotesPanel();
    });
  }

  renderNotesPanel();
  checkDueReminders();

  if (reminderIntervalId) clearInterval(reminderIntervalId);
  reminderIntervalId = setInterval(checkDueReminders, 30000);
}
