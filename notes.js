const STORAGE_NOTES_KEY = "butce_notes_v1";
const STORAGE_NOTE_GROUPS_KEY = "butce_note_groups_v1";
const STORAGE_INFO_NOTES_KEY = "butce_info_notes_v1";
const STORAGE_NOTIFIED_MAP_KEY = "butce_notified_reminders_v1";

let notesData = [];
let noteGroupsData = ["Genel", "Ödeme", "Hatırlatma", "Takip"];
let infoNotesData = [];
let notifiedMap = {};
let hooks = {
  getActivePeriod: () => "",
  getRegisteredPeriods: () => [],
  onNotesChange: () => {}
};

const noteForm = document.getElementById("noteForm");
const noteTextInput = document.getElementById("noteTextInput");
const noteGroupInput = document.getElementById("noteGroupInput");
const noteGroupList = document.getElementById("noteGroupList");
const notePeriodSelect = document.getElementById("notePeriodSelect");
const noteDueDateInput = document.getElementById("noteDueDateInput");
const noteReminderAtInput = document.getElementById("noteReminderAtInput");
const noteRepeatSelect = document.getElementById("noteRepeatSelect");
const noteLinkedInfoSelect = document.getElementById("noteLinkedInfoSelect");
const notesTableBody = document.getElementById("notesTableBody");
const notesActivePeriodLabel = document.getElementById("notesActivePeriodLabel");

const periodNotesTableBody = document.getElementById("periodNotesTableBody");
const periodNotesTitleBadge = document.getElementById("periodNotesTitleBadge");

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadNotesFromStorage() {
  try {
    notesData = JSON.parse(localStorage.getItem(STORAGE_NOTES_KEY) || "[]");
    if (!Array.isArray(notesData)) notesData = [];
  } catch {
    notesData = [];
  }

  try {
    const savedGroups = JSON.parse(localStorage.getItem(STORAGE_NOTE_GROUPS_KEY) || "[]");
    if (Array.isArray(savedGroups) && savedGroups.length) {
      noteGroupsData = Array.from(new Set([...noteGroupsData, ...savedGroups.filter(Boolean)]));
    }
  } catch {}

  try {
    infoNotesData = JSON.parse(localStorage.getItem(STORAGE_INFO_NOTES_KEY) || "[]");
    if (!Array.isArray(infoNotesData)) infoNotesData = [];
  } catch {
    infoNotesData = [];
  }

  try {
    notifiedMap = JSON.parse(localStorage.getItem(STORAGE_NOTIFIED_MAP_KEY) || "{}");
    if (!notifiedMap || typeof notifiedMap !== "object") notifiedMap = {};
  } catch {
    notifiedMap = {};
  }
}

function saveNotesToStorage() {
  localStorage.setItem(STORAGE_NOTES_KEY, JSON.stringify(notesData));
  localStorage.setItem(STORAGE_NOTE_GROUPS_KEY, JSON.stringify(noteGroupsData));
  localStorage.setItem(STORAGE_INFO_NOTES_KEY, JSON.stringify(infoNotesData));
  localStorage.setItem(STORAGE_NOTIFIED_MAP_KEY, JSON.stringify(notifiedMap));
  hooks.onNotesChange();
}

export function getNotesData() {
  return notesData;
}

export function getNoteGroupsData() {
  return noteGroupsData;
}

export function getInfoNotesData() {
  return infoNotesData;
}

export function setNotesData(nextNotes, nextGroups = null, nextInfoNotes = null) {
  notesData = Array.isArray(nextNotes) ? nextNotes : [];
  if (Array.isArray(nextGroups) && nextGroups.length) {
    noteGroupsData = Array.from(new Set(["Genel", ...nextGroups.filter(Boolean)]));
  }
  if (Array.isArray(nextInfoNotes)) {
    infoNotesData = nextInfoNotes;
  }
  localStorage.setItem(STORAGE_NOTES_KEY, JSON.stringify(notesData));
  localStorage.setItem(STORAGE_NOTE_GROUPS_KEY, JSON.stringify(noteGroupsData));
  localStorage.setItem(STORAGE_INFO_NOTES_KEY, JSON.stringify(infoNotesData));
  renderNotesPanel();
}

export function addOrUpdateInfoNote(item, editIdx = null) {
  const kat = String(item.kategori || "Genel").trim() || "Genel";
  if (!noteGroupsData.includes(kat)) {
    noteGroupsData.push(kat);
  }
  const kayit = {
    id: editIdx !== null && infoNotesData[editIdx]?.id ? infoNotesData[editIdx].id : `bn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    not: String(item.not || "").trim(),
    kategori: kat,
    tarih: String(item.tarih || "").trim()
  };
  if (editIdx !== null && infoNotesData[editIdx]) {
    infoNotesData[editIdx] = kayit;
  } else {
    infoNotesData.push(kayit);
  }
  saveNotesToStorage();
  renderNotesPanel();
}

export function deleteInfoNote(idx) {
  const removed = infoNotesData[idx];
  infoNotesData.splice(idx, 1);
  if (removed?.id) {
    notesData = notesData.map((n) => (n.linkedInfoId === removed.id ? { ...n, linkedInfoId: "" } : n));
  }
  saveNotesToStorage();
  renderNotesPanel();
}

function renderGroupOptions() {
  if (noteGroupList) {
    noteGroupList.innerHTML = noteGroupsData.map((g) => `<option value="${escapeHtml(g)}"></option>`).join("");
  }
}

function renderLinkedInfoOptions() {
  if (!noteLinkedInfoSelect) return;
  const cur = noteLinkedInfoSelect.value;
  noteLinkedInfoSelect.innerHTML =
    `<option value="">Bilgi Notu Entegre Et (Opsiyonel)</option>` +
    infoNotesData
      .map((bn) => `<option value="${escapeHtml(bn.id)}">[${escapeHtml(bn.kategori)}] ${escapeHtml(bn.not.slice(0, 40))}</option>`)
      .join("");
  noteLinkedInfoSelect.value = cur;
}

function renderNotePeriodOptions() {
  if (!notePeriodSelect) return;
  const prevVal = notePeriodSelect.value;
  const activePeriod = hooks.getActivePeriod();
  const periods = hooks.getRegisteredPeriods();
  const options = [`<option value="">Genel (Dönemsiz)</option>`];
  for (const p of periods) {
    options.push(`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`);
  }
  notePeriodSelect.innerHTML = options.join("");
  if (prevVal && periods.includes(prevVal)) {
    notePeriodSelect.value = prevVal;
  } else if (activePeriod) {
    notePeriodSelect.value = activePeriod;
  }
}

function formatReminderLabel(remAt) {
  if (!remAt) return "";
  const d = new Date(remAt);
  if (Number.isNaN(d.getTime())) return remAt;
  return d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function repeatLabel(rep) {
  if (rep === "daily") return "Günlük";
  if (rep === "weekly") return "Haftalık";
  if (rep === "monthly") return "Aylık";
  if (rep === "yearly") return "Yıllık";
  return "-";
}

function getNextOccurrence(dateStr, repeat) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  if (repeat === "daily") d.setDate(d.getDate() + 1);
  else if (repeat === "weekly") d.setDate(d.getDate() + 7);
  else if (repeat === "monthly") d.setMonth(d.getMonth() + 1);
  else if (repeat === "yearly") d.setFullYear(d.getFullYear() + 1);
  else return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function requestNotificationPermissionManual() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    await Notification.requestPermission().catch(() => {});
  }
}

function checkDueReminders() {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const now = Date.now();
  let changed = false;

  for (const note of notesData) {
    if (note.done || !note.reminderAt) continue;
    const targetTime = new Date(note.reminderAt).getTime();
    if (Number.isNaN(targetTime) || targetTime > now) continue;

    const notifyKey = `${note.id}__${note.reminderAt}`;
    if (notifiedMap[notifyKey]) continue;

    try {
      new Notification("Bütçe & Not Hatırlatması", {
        body: note.text,
        tag: notifyKey
      });
    } catch {}

    notifiedMap[notifyKey] = true;
    changed = true;

    if (note.repeat && note.repeat !== "none") {
      const nextRem = getNextOccurrence(note.reminderAt, note.repeat);
      if (nextRem) {
        note.reminderAt = nextRem;
      }
    }
  }

  if (changed) {
    saveNotesToStorage();
    renderNotesPanel();
  }
}

function renderBilgiNotlariList() {
  const listeBody = document.getElementById("bilgiNotlariListe");
  if (!listeBody) return;
  if (!infoNotesData.length) {
    listeBody.innerHTML = `<tr><td colspan="4" class="item-meta">Henüz bilgi notu eklenmedi.</td></tr>`;
    return;
  }
  listeBody.innerHTML = infoNotesData
    .map(
      (bn, idx) => `
      <tr>
        <td><strong>${escapeHtml(bn.not)}</strong></td>
        <td><span class="badge">${escapeHtml(bn.kategori)}</span></td>
        <td>${escapeHtml(bn.tarih || "-")}</td>
        <td style="text-align:center; white-space:nowrap;">
          <button type="button" class="edit-btn" data-edit-bn-idx="${idx}">Düzelt</button>
          <button type="button" class="del-btn" data-delete-bn-idx="${idx}">Sil</button>
        </td>
      </tr>
    `
    )
    .join("");
}

export function renderNotesPanel() {
  const activePeriod = hooks.getActivePeriod() || "";
  renderGroupOptions();
  renderLinkedInfoOptions();
  renderNotePeriodOptions();
  renderBilgiNotlariList();

  if (notesActivePeriodLabel) {
    notesActivePeriodLabel.textContent = activePeriod ? `Aktif Dönem: ${activePeriod}` : "Tüm Notlar";
  }

  if (notesTableBody) {
    if (!notesData.length) {
      notesTableBody.innerHTML = `<tr><td colspan="9" class="item-meta">Henüz not eklenmedi.</td></tr>`;
    } else {
      notesTableBody.innerHTML = notesData
        .map((n) => {
          const linkedInfo = n.linkedInfoId ? infoNotesData.find((b) => b.id === n.linkedInfoId) : null;
          const detailRowHtml = linkedInfo
            ? `<tr id="noteInfoDetailRow_${escapeHtml(n.id)}" style="display:none; background:#eff6ff;">
                 <td colspan="9" style="padding:8px 14px; border-left:3px solid #1d4ed8;">
                   <strong>Entegre Bilgi Notu:</strong> ${escapeHtml(linkedInfo.not)}
                   | <strong>Kategori:</strong> ${escapeHtml(linkedInfo.kategori)}
                   ${linkedInfo.tarih ? `| <strong>Tarih:</strong> ${escapeHtml(linkedInfo.tarih)}` : ""}
                 </td>
               </tr>`
            : "";

          return `
            <tr data-note-id="${escapeHtml(n.id)}">
              <td style="text-align:center;">
                <input type="checkbox" class="note-check" ${n.done ? "checked" : ""} />
              </td>
              <td>
                <span class="note-click-detail" data-note-detail-id="${escapeHtml(n.id)}" style="${n.done ? "text-decoration:line-through; opacity:0.65;" : ""} ${linkedInfo ? "cursor:pointer; color:#1d4ed8; font-weight:600; text-decoration:underline; text-decoration-style:dotted;" : ""}">${escapeHtml(n.text)}</span>
              </td>
              <td><span class="badge">${escapeHtml(n.group || "Genel")}</span></td>
              <td>${escapeHtml(n.period || "Genel")}</td>
              <td>${escapeHtml(n.dueDate || "-")}</td>
              <td>${escapeHtml(n.reminderAt ? formatReminderLabel(n.reminderAt) : "-")}</td>
              <td>${escapeHtml(repeatLabel(n.repeat))}</td>
              <td>${linkedInfo ? `<span class="badge">${escapeHtml(linkedInfo.kategori)}</span>` : "-"}</td>
              <td style="text-align:center;">
                <button type="button" class="del-btn note-delete" data-delete-note-id="${escapeHtml(n.id)}">Sil</button>
              </td>
            </tr>
            ${detailRowHtml}
          `;
        })
        .join("");
    }
  }

  renderPeriodNotesWidget(activePeriod);
}

function renderPeriodNotesWidget(activePeriod) {
  if (!periodNotesTableBody) return;
  if (periodNotesTitleBadge) {
    periodNotesTitleBadge.textContent = activePeriod || "";
  }

  const filtered = notesData.filter((n) => !n.period || n.period === activePeriod);
  if (!filtered.length) {
    periodNotesTableBody.innerHTML = `<tr><td colspan="3" class="item-meta">Bu dönem için not bulunmuyor.</td></tr>`;
    return;
  }

  periodNotesTableBody.innerHTML = filtered
    .map((n) => {
      const linkedInfo = n.linkedInfoId ? infoNotesData.find((b) => b.id === n.linkedInfoId) : null;
      return `
        <tr data-note-id="${escapeHtml(n.id)}">
          <td>
            <span class="note-click-detail" data-note-detail-id="${escapeHtml(n.id)}" style="${n.done ? "text-decoration:line-through; opacity:0.65;" : ""} ${linkedInfo ? "cursor:pointer; color:#1d4ed8; text-decoration:underline; text-decoration-style:dotted;" : ""}">${escapeHtml(n.text)}</span>
            ${linkedInfo ? `<div style="font-size:12px; color:#334155; margin-top:4px;">↳ [${escapeHtml(linkedInfo.kategori)}] ${escapeHtml(linkedInfo.not)} ${linkedInfo.tarih ? `(${escapeHtml(linkedInfo.tarih)})` : ""}</div>` : ""}
          </td>
          <td>${escapeHtml(n.dueDate || "-")}</td>
          <td>
            <label class="paid-box">
              <input type="checkbox" class="period-note-check" ${n.done ? "checked" : ""} />
              <span>${n.done ? "Yapıldı" : "Bekliyor"}</span>
            </label>
          </td>
        </tr>
      `;
    })
    .join("");
}

export function initNotesModule(customHooks = {}) {
  hooks = { ...hooks, ...customHooks };
  loadNotesFromStorage();
  renderNotesPanel();

  if (noteForm) {
    noteForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = noteTextInput?.value.trim() || "";
      if (!text) return;

      const group = noteGroupInput?.value.trim() || "Genel";
      if (!noteGroupsData.includes(group)) {
        noteGroupsData.push(group);
      }

      notesData.unshift({
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text,
        group,
        period: notePeriodSelect?.value || "",
        dueDate: noteDueDateInput?.value || "",
        reminderAt: noteReminderAtInput?.value || "",
        repeat: noteRepeatSelect?.value || "none",
        linkedInfoId: noteLinkedInfoSelect?.value || "",
        done: false
      });

      if (noteTextInput) noteTextInput.value = "";
      if (noteDueDateInput) noteDueDateInput.value = "";
      if (noteReminderAtInput) noteReminderAtInput.value = "";
      if (noteRepeatSelect) noteRepeatSelect.value = "none";
      if (noteLinkedInfoSelect) noteLinkedInfoSelect.value = "";

      saveNotesToStorage();
      renderNotesPanel();
    });
  }

  if (notesTableBody) {
    notesTableBody.addEventListener("change", (e) => {
      if (!e.target.classList.contains("note-check")) return;
      const tr = e.target.closest("[data-note-id]");
      const id = tr?.dataset.noteId;
      const target = notesData.find((n) => n.id === id);
      if (!target) return;
      target.done = e.target.checked;
      saveNotesToStorage();
      renderNotesPanel();
    });

    notesTableBody.addEventListener("click", (e) => {
      const detailTrigger = e.target.closest("[data-note-detail-id]");
      if (detailTrigger) {
        const noteId = detailTrigger.dataset.noteDetailId;
        const row = document.getElementById(`noteInfoDetailRow_${noteId}`);
        if (row) {
          row.style.display = row.style.display === "none" ? "table-row" : "none";
        }
        return;
      }

      const delId = e.target.dataset.deleteNoteId;
      if (!delId) return;
      notesData = notesData.filter((n) => n.id !== delId);
      saveNotesToStorage();
      renderNotesPanel();
    });
  }

  if (periodNotesTableBody) {
    periodNotesTableBody.addEventListener("change", (e) => {
      if (!e.target.classList.contains("period-note-check")) return;
      const tr = e.target.closest("[data-note-id]");
      const id = tr?.dataset.noteId;
      const target = notesData.find((n) => n.id === id);
      if (!target) return;
      target.done = e.target.checked;
      saveNotesToStorage();
      renderNotesPanel();
    });
  }

  checkDueReminders();
  setInterval(checkDueReminders, 30000);
}