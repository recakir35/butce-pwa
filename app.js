import { initNotesModule, formatMoneyTR } from "./notes.js";

const STORAGE_KEY = "butce_takip_state_v1";
const DRIVE_FILE_NAME = "hesap_kalemleri.json";
const DRIVE_FOLDER_NAME = "ButceArsiv";
const DRIVE_CLIENT_ID = "247986753605-ntjp9tt0vshhsobo3kk2fd3dkqud7puv.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

let driveAccessToken = null;
let tokenClient = null;
let driveConnected = false;
let autoSyncTimer = null;
let notesApi = null;
let notificationsEnabled = true;

let editingExpenseId = null;
let editingIncomeId = null;
let editingCcId = null;

function createEmptyState() {
  return {
    periods: {
      "2026-11": {
        expenses: [],
        incomes: []
      }
    },
    creditCards: [],
    notes: [],
    noteGroupsList: ["Genel", "Fatura", "Kredi Kartı", "Araç", "Aile", "Diğer"],
    activePeriod: "2026-11"
  };
}

let appState = createEmptyState();

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyState();
    const parsed = JSON.parse(raw);
    return {
      ...createEmptyState(),
      ...parsed,
      periods: parsed.periods && typeof parsed.periods === "object" ? parsed.periods : createEmptyState().periods,
      creditCards: Array.isArray(parsed.creditCards)
        ? parsed.creditCards
        : Array.isArray(parsed.cards)
          ? parsed.cards
          : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      noteGroupsList: Array.isArray(parsed.noteGroupsList)
        ? parsed.noteGroupsList
        : ["Genel", "Fatura", "Kredi Kartı", "Araç", "Aile", "Diğer"]
    };
  } catch {
    return createEmptyState();
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
}

function getAvailablePeriods(state, basePeriod) {
  const set = new Set(Object.keys((state && state.periods) || {}));
  const seed = basePeriod || (state && state.activePeriod) || "2026-11";
  const match = /^(\d{4})-(\d{2})$/.exec(seed);
  const year = match ? Number(match[1]) : 2026;
  const month = match ? Number(match[2]) : 11;

  for (let i = 0; i <= 6; i++) {
    const m = ((month - 1 + i) % 12) + 1;
    const y = year + Math.floor((month - 1 + i) / 12);
    set.add(`${y}-${String(m).padStart(2, "0")}`);
  }
  return Array.from(set).sort();
}

function setDriveStatus(text, isOk) {
  const el = document.getElementById("driveStatusText");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("connected", Boolean(isOk));
}

function getInstallmentAmount(card) {
  return Number(card?.monthlyInstallment ?? card?.installmentAmount ?? card?.amount ?? 0) || 0;
}

function getCreditCardMonthlyTotal(period) {
  const cards = Array.isArray(appState.creditCards) ? appState.creditCards : [];
  return cards
    .filter((c) => !c.period || c.period === period)
    .reduce((sum, c) => sum + getInstallmentAmount(c), 0);
}

function renderPeriodSelect() {
  const selectEl = document.getElementById("periodSelect");
  if (!selectEl) return;

  const periods = getAvailablePeriods(appState, appState.activePeriod);
  if (!appState.activePeriod || !periods.includes(appState.activePeriod)) {
    appState.activePeriod = periods[0] || "2026-11";
  }

  selectEl.innerHTML = "";
  periods.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    if (p === appState.activePeriod) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

function renderExpensesAndIncomes() {
  const expBody = document.getElementById("expenseTableBody");
  const ccBody = document.getElementById("ccTableBody");
  const incBody = document.getElementById("incomeTableBody");
  const ccTotalEl = document.getElementById("ccMonthlyInstallmentTotal");

  const period = appState.activePeriod || "2026-11";
  if (!appState.periods[period]) {
    appState.periods[period] = { expenses: [], incomes: [] };
  }

  const periodData = appState.periods[period];
  const expenses = Array.isArray(periodData.expenses) ? periodData.expenses : [];
  const incomes = Array.isArray(periodData.incomes) ? periodData.incomes : [];
  const cards = Array.isArray(appState.creditCards) ? appState.creditCards : [];

  let totalExpense = 0;
  let totalPaid = 0;
  let totalUnpaid = 0;

  if (expBody) {
    expBody.innerHTML = "";
    expenses.forEach((item) => {
      const amt = Number(item.amount) || 0;
      totalExpense += amt;
      if (item.paid) totalPaid += amt;
      else totalUnpaid += amt;

      const tr = document.createElement("tr");
      tr.className = item.paid ? "paid-row" : "unpaid-row";

      const nameTd = document.createElement("td");
      nameTd.textContent = item.name || "";

      const amtTd = document.createElement("td");
      amtTd.className = "num";
      amtTd.textContent = `${formatMoneyTR(amt)} TL`;

      const dueTd = document.createElement("td");
      dueTd.textContent = item.dueDate || "-";

      const noteTd = document.createElement("td");
      noteTd.textContent = item.note || "-";

      const statusTd = document.createElement("td");
      const statusBtn = document.createElement("button");
      statusBtn.type = "button";
      statusBtn.className = item.paid ? "success" : "danger";
      statusBtn.textContent = item.paid ? "Ödendi" : "Ödenmedi";
      statusBtn.addEventListener("click", () => {
        item.paid = !item.paid;
        saveLocalState();
        renderAll(true);
      });
      statusTd.appendChild(statusBtn);

      const actTd = document.createElement("td");
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "secondary";
      editBtn.textContent = "Düzenle";
      editBtn.addEventListener("click", () => openExpenseModal(item));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "danger";
      delBtn.style.marginLeft = "6px";
      delBtn.textContent = "Sil";
      delBtn.addEventListener("click", () => {
        periodData.expenses = expenses.filter((x) => x.id !== item.id);
        saveLocalState();
        renderAll(true);
      });

      actTd.appendChild(editBtn);
      actTd.appendChild(delBtn);

      tr.appendChild(nameTd);
      tr.appendChild(amtTd);
      tr.appendChild(dueTd);
      tr.appendChild(noteTd);
      tr.appendChild(statusTd);
      tr.appendChild(actTd);
      expBody.appendChild(tr);
    });

    const sumTr = document.createElement("tr");
    sumTr.className = "summary-row";
    sumTr.innerHTML = `
      <td>Toplam Gider (Ödenen: ${formatMoneyTR(totalPaid)} TL | Ödenmedi: ${formatMoneyTR(totalUnpaid)} TL)</td>
      <td class="num">${formatMoneyTR(totalExpense)} TL</td>
      <td colspan="4"></td>
    `;
    expBody.appendChild(sumTr);
  }

  const ccTotal = getCreditCardMonthlyTotal(period);
  if (ccTotalEl) {
    ccTotalEl.textContent = `${formatMoneyTR(ccTotal)} TL`;
  }

  if (ccBody) {
    ccBody.innerHTML = "";
    const filteredCards = cards.filter((c) => !c.period || c.period === period);
    filteredCards.forEach((card) => {
      const inst = getInstallmentAmount(card);
      const tr = document.createElement("tr");
      tr.className = card.paid ? "paid-row" : "unpaid-row";

      const titleTd = document.createElement("td");
      titleTd.textContent = card.cardName || card.description || "Kredi Kartı";

      const perTd = document.createElement("td");
      perTd.textContent = card.period || period;

      const amtTd = document.createElement("td");
      amtTd.className = "num";
      amtTd.textContent = `${formatMoneyTR(inst)} TL`;

      const stTd = document.createElement("td");
      const stBtn = document.createElement("button");
      stBtn.type = "button";
      stBtn.className = card.paid ? "success" : "danger";
      stBtn.textContent = card.paid ? "Ödendi" : "Ödenmedi";
      stBtn.addEventListener("click", () => {
        card.paid = !card.paid;
        saveLocalState();
        renderAll(true);
      });
      stTd.appendChild(stBtn);

      const actTd = document.createElement("td");
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "secondary";
      editBtn.textContent = "Düzenle";
      editBtn.addEventListener("click", () => openCcModal(card));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "danger";
      delBtn.style.marginLeft = "6px";
      delBtn.textContent = "Sil";
      delBtn.addEventListener("click", () => {
        appState.creditCards = cards.filter((x) => x.id !== card.id);
        saveLocalState();
        renderAll(true);
      });

      actTd.appendChild(editBtn);
      actTd.appendChild(delBtn);

      tr.appendChild(titleTd);
      tr.appendChild(perTd);
      tr.appendChild(amtTd);
      tr.appendChild(stTd);
      tr.appendChild(actTd);
      ccBody.appendChild(tr);
    });
  }

  let totalIncome = 0;
  if (incBody) {
    incBody.innerHTML = "";
    incomes.forEach((item) => {
      const amt = Number(item.amount) || 0;
      totalIncome += amt;

      const tr = document.createElement("tr");
      const nameTd = document.createElement("td");
      nameTd.textContent = item.name || "";

      const amtTd = document.createElement("td");
      amtTd.className = "num";
      amtTd.textContent = `${formatMoneyTR(amt)} TL`;

      const noteTd = document.createElement("td");
      noteTd.textContent = item.note || "-";

      const actTd = document.createElement("td");
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "secondary";
      editBtn.textContent = "Düzenle";
      editBtn.addEventListener("click", () => openIncomeModal(item));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "danger";
      delBtn.style.marginLeft = "6px";
      delBtn.textContent = "Sil";
      delBtn.addEventListener("click", () => {
        periodData.incomes = incomes.filter((x) => x.id !== item.id);
        saveLocalState();
        renderAll(true);
      });

      actTd.appendChild(editBtn);
      actTd.appendChild(delBtn);

      tr.appendChild(nameTd);
      tr.appendChild(amtTd);
      tr.appendChild(noteTd);
      tr.appendChild(actTd);
      incBody.appendChild(tr);
    });

    const netTr = document.createElement("tr");
    netTr.className = "summary-row";
    netTr.innerHTML = `
      <td>Toplam Gelir / Net Durum</td>
      <td class="num">${formatMoneyTR(totalIncome)} TL</td>
      <td colspan="2">Net: ${formatMoneyTR(totalIncome - totalExpense - ccTotal)} TL</td>
    `;
    incBody.appendChild(netTr);
  }

  const reportContent = document.getElementById("reportSummaryContent");
  if (reportContent) {
    reportContent.innerHTML = `
      <p><strong>Dönem:</strong> ${period}</p>
      <p><strong>Toplam Gelir:</strong> ${formatMoneyTR(totalIncome)} TL</p>
      <p><strong>Toplam Gider:</strong> ${formatMoneyTR(totalExpense)} TL (Ödenen: ${formatMoneyTR(totalPaid)} TL | Ödenmedi: ${formatMoneyTR(totalUnpaid)} TL)</p>
      <p><strong>Kredi Kartı Taksit Toplamı:</strong> ${formatMoneyTR(ccTotal)} TL</p>
      <p><strong>Kalan Net Bakiye:</strong> ${formatMoneyTR(totalIncome - totalExpense - ccTotal)} TL</p>
    `;
  }
}

function openExpenseModal(item = null) {
  editingExpenseId = item ? item.id : null;
  document.getElementById("expenseModalTitle").textContent = item ? "Gider Düzenle" : "Yeni Gider Ekle";
  document.getElementById("expNameInput").value = item?.name || "";
  document.getElementById("expAmountInput").value = item?.amount ?? "";
  document.getElementById("expDueDateInput").value = item?.dueDate || "";
  document.getElementById("expNoteInput").value = item?.note || "";
  document.getElementById("expenseModal").classList.add("open");
}

function closeExpenseModal() {
  editingExpenseId = null;
  document.getElementById("expenseModal").classList.remove("open");
}

function openIncomeModal(item = null) {
  editingIncomeId = item ? item.id : null;
  document.getElementById("incomeModalTitle").textContent = item ? "Gelir Düzenle" : "Yeni Gelir Ekle";
  document.getElementById("incNameInput").value = item?.name || "";
  document.getElementById("incAmountInput").value = item?.amount ?? "";
  document.getElementById("incNoteInput").value = item?.note || "";
  document.getElementById("incomeModal").classList.add("open");
}

function closeIncomeModal() {
  editingIncomeId = null;
  document.getElementById("incomeModal").classList.remove("open");
}

function openCcModal(card = null) {
  editingCcId = card ? card.id : null;
  document.getElementById("ccModalTitle").textContent = card ? "Kredi Kartı Taksiti Düzenle" : "Yeni Kredi Kartı Taksiti Ekle";
  document.getElementById("ccNameInput").value = card?.cardName || card?.description || "";
  document.getElementById("ccPeriodInput").value = card?.period || appState.activePeriod || "2026-11";
  document.getElementById("ccAmountInput").value = card ? getInstallmentAmount(card) : "";
  document.getElementById("ccModal").classList.add("open");
}

function closeCcModal() {
  editingCcId = null;
  document.getElementById("ccModal").classList.remove("open");
}

function renderAll(triggerSync = false) {
  renderPeriodSelect();
  renderExpensesAndIncomes();
  if (notesApi) {
    notesApi.renderNotes(appState.activePeriod, true);
  }
  if (triggerSync && driveConnected) {
    scheduleAutoDriveSync();
  }
}

async function ensureFolderId() {
  const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${driveAccessToken}` }
  });
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${driveAccessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder"
    })
  });
  const created = await createRes.json();
  return created.id;
}

async function loadRemoteStateIfExists() {
  if (!driveAccessToken) return;
  const folderId = await ensureFolderId();
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and '${folderId}' in parents and trashed=false`);
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${driveAccessToken}` }
  });
  const listData = await listRes.json();

  if (listData.files && listData.files.length > 0) {
    const fileId = listData.files[0].id;
    const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${driveAccessToken}` }
    });
    const remoteJson = await contentRes.json();
    if (remoteJson && typeof remoteJson === "object") {
      appState = {
        ...createEmptyState(),
        ...remoteJson,
        creditCards: Array.isArray(remoteJson.creditCards)
          ? remoteJson.creditCards
          : Array.isArray(remoteJson.cards)
            ? remoteJson.cards
            : []
      };
      saveLocalState();
    }
  }
}

async function syncAllToDrive() {
  if (!driveAccessToken || !driveConnected) return;
  const folderId = await ensureFolderId();
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and '${folderId}' in parents and trashed=false`);
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${driveAccessToken}` }
  });
  const listData = await listRes.json();
  const existingId = listData.files && listData.files.length > 0 ? listData.files[0].id : null;

  const metadata = {
    name: DRIVE_FILE_NAME,
    mimeType: "application/json",
    ...(existingId ? {} : { parents: [folderId] })
  };

  const boundary = "-------314159265358979323846";
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(appState, null, 2)}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

  const method = existingId ? "PATCH" : "POST";
  await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${driveAccessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });

  const now = new Date().toLocaleTimeString("tr-TR");
  setDriveStatus(`Drive: Bağlandı (${now})`, true);
}

function scheduleAutoDriveSync() {
  if (!driveConnected) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    syncAllToDrive().catch(() => {});
  }, 800);
}

function ensureTokenClient() {
  if (tokenClient) return true;
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    setDriveStatus("Drive servisi yükleniyor...", false);
    return false;
  }

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: DRIVE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: async (resp) => {
      if (resp && resp.access_token) {
        driveAccessToken = resp.access_token;
        driveConnected = true;
        setDriveStatus("Drive: Bağlandı", true);
        try {
          await loadRemoteStateIfExists();
        } catch {}
        renderAll(false);
      } else {
        driveConnected = false;
        driveAccessToken = null;
        setDriveStatus("Drive: Bağlanamadı", false);
      }
    }
  });
  return true;
}

function handleConnectClick() {
  if (!ensureTokenClient()) return;
  tokenClient.requestAccessToken({ prompt: "consent" });
}

document.addEventListener("DOMContentLoaded", () => {
  appState = loadLocalState();
  setDriveStatus("Drive: Yerel Mod", false);

  notesApi = initNotesModule({
    getState: () => appState,
    setState: (next) => {
      appState = next;
      saveLocalState();
    },
    getAvailablePeriods,
    onAfterChange: (shouldSync = true) => {
      renderAll(shouldSync);
    }
  });
  notesApi.setDriveReadyGetter(() => true);

  document.getElementById("driveConnectBtn")?.addEventListener("click", handleConnectClick);

  document.getElementById("driveSyncNowBtn")?.addEventListener("click", () => {
    if (!driveConnected) return handleConnectClick();
    syncAllToDrive();
  });

  document.getElementById("driveReloadBtn")?.addEventListener("click", async () => {
    if (!driveConnected) return handleConnectClick();
    await loadRemoteStateIfExists();
    renderAll(false);
  });

  document.getElementById("toggleReportBtn")?.addEventListener("click", () => {
    document.getElementById("reportSection")?.classList.toggle("hidden");
  });

  document.getElementById("toggleNotifyBtn")?.addEventListener("click", (e) => {
    notificationsEnabled = !notificationsEnabled;
    e.target.textContent = notificationsEnabled ? "Bildirimler Açık" : "Bildirimler Kapalı";
  });

  document.getElementById("addPeriodBtn")?.addEventListener("click", () => {
    const input = prompt("Yeni dönem girin (YYYY-AA, örn: 2026-12):", appState.activePeriod || "2026-12");
    if (!input) return;
    const clean = input.trim();
    if (!/^\d{4}-\d{2}$/.test(clean)) return;
    if (!appState.periods[clean]) {
      appState.periods[clean] = { expenses: [], incomes: [] };
    }
    appState.activePeriod = clean;
    saveLocalState();
    renderAll(true);
  });

  document.getElementById("deletePeriodBtn")?.addEventListener("click", () => {
    const p = appState.activePeriod;
    if (!p || !appState.periods[p]) return;
    if (!confirm(`${p} dönemini silmek istiyor musunuz?`)) return;
    delete appState.periods[p];
    const remaining = Object.keys(appState.periods).sort();
    appState.activePeriod = remaining[0] || "2026-11";
    if (!appState.periods[appState.activePeriod]) {
      appState.periods[appState.activePeriod] = { expenses: [], incomes: [] };
    }
    saveLocalState();
    renderAll(true);
  });

  document.getElementById("openAddExpenseBtn")?.addEventListener("click", () => openExpenseModal(null));
  document.getElementById("cancelExpenseBtn")?.addEventListener("click", closeExpenseModal);
  document.getElementById("saveExpenseBtn")?.addEventListener("click", () => {
    const name = document.getElementById("expNameInput").value.trim();
    const amount = Number(document.getElementById("expAmountInput").value) || 0;
    const dueDate = document.getElementById("expDueDateInput").value;
    const note = document.getElementById("expNoteInput").value.trim();
    if (!name) return;

    const period = appState.activePeriod || "2026-11";
    if (!appState.periods[period]) appState.periods[period] = { expenses: [], incomes: [] };
    const list = appState.periods[period].expenses;

    if (editingExpenseId) {
      const target = list.find((x) => x.id === editingExpenseId);
      if (target) {
        target.name = name;
        target.amount = amount;
        target.dueDate = dueDate;
        target.note = note;
      }
    } else {
      list.push({
        id: "exp_" + Date.now(),
        name,
        amount,
        dueDate,
        note,
        paid: false
      });
    }

    saveLocalState();
    closeExpenseModal();
    renderAll(true);
  });

  document.getElementById("openAddIncomeBtn")?.addEventListener("click", () => openIncomeModal(null));
  document.getElementById("cancelIncomeBtn")?.addEventListener("click", closeIncomeModal);
  document.getElementById("saveIncomeBtn")?.addEventListener("click", () => {
    const name = document.getElementById("incNameInput").value.trim();
    const amount = Number(document.getElementById("incAmountInput").value) || 0;
    const note = document.getElementById("incNoteInput").value.trim();
    if (!name) return;

    const period = appState.activePeriod || "2026-11";
    if (!appState.periods[period]) appState.periods[period] = { expenses: [], incomes: [] };
    const list = appState.periods[period].incomes;

    if (editingIncomeId) {
      const target = list.find((x) => x.id === editingIncomeId);
      if (target) {
        target.name = name;
        target.amount = amount;
        target.note = note;
      }
    } else {
      list.push({
        id: "inc_" + Date.now(),
        name,
        amount,
        note
      });
    }

    saveLocalState();
    closeIncomeModal();
    renderAll(true);
  });

  document.getElementById("openAddCcBtn")?.addEventListener("click", () => openCcModal(null));
  document.getElementById("cancelCcBtn")?.addEventListener("click", closeCcModal);
  document.getElementById("saveCcBtn")?.addEventListener("click", () => {
    const cardName = document.getElementById("ccNameInput").value.trim();
    const period = document.getElementById("ccPeriodInput").value.trim() || appState.activePeriod || "2026-11";
    const monthlyInstallment = Number(document.getElementById("ccAmountInput").value) || 0;
    if (!cardName) return;

    if (!Array.isArray(appState.creditCards)) appState.creditCards = [];
    if (editingCcId) {
      const target = appState.creditCards.find((x) => x.id === editingCcId);
      if (target) {
        target.cardName = cardName;
        target.period = period;
        target.monthlyInstallment = monthlyInstallment;
      }
    } else {
      appState.creditCards.push({
        id: "cc_" + Date.now(),
        cardName,
        period,
        monthlyInstallment,
        paid: false
      });
    }

    saveLocalState();
    closeCcModal();
    renderAll(true);
  });

  document.getElementById("periodSelect")?.addEventListener("change", (e) => {
    appState.activePeriod = e.target.value;
    saveLocalState();
    renderAll(false);
  });

  renderAll(false);
});
