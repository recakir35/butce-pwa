const DEFAULT_GROUPS = ["Genel", "Fatura", "Kredi Kartı", "Araç", "Aile", "Diğer"];

export function formatMoneyTR(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return "0,00";
  return num.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function getRepeatRank(repeat) {
  const order = {
    "Tek Seferlik": 1,
    "Haftalık": 2,
    "Aylık": 3,
    "Yıllık": 4
  };
  return order[repeat] ?? 99;
}

export function sortRemindersByRepeatAndGroup(list) {
  return [...(list || [])].sort((a, b) => {
    const repA = getRepeatRank(a.repeat);
    const repB = getRepeatRank(b.repeat);
    if (repA !== repB) return repA - repB;

    const grpA = String(a.group || "Genel");
    const grpB = String(b.group || "Genel");
    const grpCmp = grpA.localeCompare(grpB, "tr");
    if (grpCmp !== 0) return grpCmp;

    const dtA = String(a.remindAt || a.dueDate || "");
    const dtB = String(b.remindAt || b.dueDate || "");
    return dtA.localeCompare(dtB, "tr");
  });
}

export function initNotesModule({ getState, setState, onAfterChange, getAvailablePeriods }) {
  const periodSelectEl = document.getElementById("notePeriodSelect");
  const groupSelectEl = document.getElementById("noteGroupSelect");
  const customGroupInputEl = document.getElementById("noteCustomGroupInput");
  const repeatSelectEl = document.getElementById("noteRepeatSelect");
  const remindAtInputEl = document.getElementById("noteRemindAtInput");
  const titleInputEl = document.getElementById("noteTitleInput");
  const addBtnEl = document.getElementById("addNoteBtn");
  const tbodyEl = document.getElementById("notesTableBody");
  const sortInfoEl = document.getElementById("noteSortInfo");

  function populateGroups() {
    if (!groupSelectEl) return;
    const state = getState();
    const savedGroups = Array.isArray(state.noteGroupsList) ? state.noteGroupsList : [];
    const merged = Array.from(new Set([...DEFAULT_GROUPS, ...savedGroups]));

    const currentVal = groupSelectEl.value || "Genel";
    groupSelectEl.innerHTML = "";
    merged.forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      groupSelectEl.appendChild(opt);
    });
    groupSelectEl.value = merged.includes(currentVal) ? currentVal : "Genel";
  }

  function populatePeriods(activePeriod) {
    if (!periodSelectEl) return;
    const state = getState();
    const periods = typeof getAvailablePeriods === "function"
      ? getAvailablePeriods(state, activePeriod)
      : Object.keys(state.periods || {});

    const currentVal = periodSelectEl.value || activePeriod || "";
    periodSelectEl.innerHTML = "";
    periods.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      periodSelectEl.appendChild(opt);
    });

    if (currentVal && periods.includes(currentVal)) {
      periodSelectEl.value = currentVal;
    } else if (activePeriod && periods.includes(activePeriod)) {
      periodSelectEl.value = activePeriod;
    } else if (periods.length > 0) {
      periodSelectEl.value = periods[periods.length - 1];
    }
  }

  function renderNotes(activePeriod, isDriveConnected) {
    if (!tbodyEl) return;
    if (!isDriveConnected) {
      tbodyEl.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;">Drive bağlanılmadan veri gösterilmez.</td></tr>`;
      return;
    }

    const state = getState();
    populateGroups();
    populatePeriods(activePeriod);

    const selectedPeriod = periodSelectEl?.value || activePeriod;
    const allNotes = Array.isArray(state.notes) ? state.notes : [];

    const filtered = allNotes.filter((n) => {
      const nPeriod = n.period || (n.remindAt ? String(n.remindAt).slice(0, 7) : activePeriod);
      return !selectedPeriod || nPeriod === selectedPeriod;
    });

    const sorted = sortRemindersByRepeatAndGroup(filtered);

    if (sortInfoEl) {
      sortInfoEl.textContent = `Sıralama: Tekrar → Grup (${sorted.length} hatırlatma)`;
    }

    if (sorted.length === 0) {
      tbodyEl.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;">Seçili dönem (${selectedPeriod || "-"}) için hatırlatma bulunmuyor.</td></tr>`;
      return;
    }

    tbodyEl.innerHTML = "";
    sorted.forEach((item) => {
      const tr = document.createElement("tr");
      if (!item.done) {
        tr.classList.add("unpaid-row");
      }

      const grpTd = document.createElement("td");
      grpTd.textContent = item.group || "Genel";

      const repTd = document.createElement("td");
      repTd.textContent = item.repeat || "Tek Seferlik";

      const perTd = document.createElement("td");
      perTd.textContent = item.period || (item.remindAt ? String(item.remindAt).slice(0, 7) : "-");

      const titleTd = document.createElement("td");
      titleTd.textContent = item.text || "";

      const timeTd = document.createElement("td");
      timeTd.textContent = item.remindAt ? item.remindAt.replace("T", " ") : "-";

      const actTd = document.createElement("td");
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = item.done ? "secondary" : "success";
      toggleBtn.textContent = item.done ? "Geri Al" : "Tamamla";
      toggleBtn.addEventListener("click", () => {
        const nextState = getState();
        nextState.notes = (nextState.notes || []).map((n) =>
          n.id === item.id ? { ...n, done: !n.done } : n
        );
        setState(nextState);
        if (typeof onAfterChange === "function") onAfterChange();
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "danger";
      delBtn.style.marginLeft = "6px";
      delBtn.textContent = "Sil";
      delBtn.addEventListener("click", () => {
        const nextState = getState();
        nextState.notes = (nextState.notes || []).filter((n) => n.id !== item.id);
        setState(nextState);
        if (typeof onAfterChange === "function") onAfterChange();
      });

      actTd.appendChild(toggleBtn);
      actTd.appendChild(delBtn);

      tr.appendChild(grpTd);
      tr.appendChild(repTd);
      tr.appendChild(perTd);
      tr.appendChild(titleTd);
      tr.appendChild(timeTd);
      tr.appendChild(actTd);

      tbodyEl.appendChild(tr);
    });
  }

  function addNote(activePeriod) {
    if (!isDriveReady()) return;
    const text = String(titleInputEl?.value || "").trim();
    if (!text) return;

    const customGrp = String(customGroupInputEl?.value || "").trim();
    const chosenGroup = customGrp || groupSelectEl?.value || "Genel";
    const repeatVal = repeatSelectEl?.value || "Tek Seferlik";
    const remindAtVal = remindAtInputEl?.value || "";
    const targetPeriod = periodSelectEl?.value
      || (remindAtVal ? remindAtVal.slice(0, 7) : "")
      || activePeriod;

    const state = getState();
    const groups = new Set([...DEFAULT_GROUPS, ...(state.noteGroupsList || []), chosenGroup]);
    state.noteGroupsList = Array.from(groups);

    const newNote = {
      id: "note_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      text,
      group: chosenGroup,
      repeat: repeatVal,
      remindAt: remindAtVal,
      period: targetPeriod,
      done: false,
      notifiedKeys: []
    };

    state.notes = [...(state.notes || []), newNote];
    setState(state);

    if (titleInputEl) titleInputEl.value = "";
    if (customGroupInputEl) customGroupInputEl.value = "";
    if (typeof onAfterChange === "function") onAfterChange();
  }

  let isDriveReady = () => false;

  if (addBtnEl) {
    addBtnEl.addEventListener("click", () => {
      const currentPeriod = periodSelectEl?.value || "";
      addNote(currentPeriod);
    });
  }

  if (periodSelectEl) {
    periodSelectEl.addEventListener("change", () => {
      if (typeof onAfterChange === "function") onAfterChange(false);
    });
  }

  return {
    renderNotes,
    populatePeriods,
    populateGroups,
    setDriveReadyGetter(fn) {
      isDriveReady = fn;
    }
  };
}
