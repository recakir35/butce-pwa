import { initNotesModule, formatMoneyTR } from "./notes.js";

const STORAGE_KEY = "butce_takip_state_v1";
const DRIVE_FILE_NAME = "hesap_kalemleri.json";
const DRIVE_FOLDER_NAME = "ButceArsiv";
const DRIVE_CLIENT_ID = window.GOOGLE_DRIVE_CLIENT_ID || "BURAYA_KENDI_CLIENT_ID_YAZIN";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

let driveAccessToken = null;
let tokenClient = null;
let driveConnected = false;
let autoSyncTimer = null;
let notesApi = null;

function createEmptyState() {
  return {
    periods: {
      "2026-11": {
        expenses: [
          { id: "e1", name: "Kira", amount: 18500, dueDate: "2026-11-25", note: "Ev kirası", paid: false },
          { id: "e2", name: "Elektrik", amount: 1450.75, dueDate: "2026-11-20", note: "Aylık fatura", paid: true }
        ],
        incomes: [
          { id: "i1", name: "Maaş", amount: 65000, note: "Ana gelir" }
        ]
      }
    },
    creditCards: [
      { id: "cc1", cardName: "Bonus Kart", description: "Laptop Taksit", monthlyInstallment: 4250, period: "2026-11", paid: false },
      { id: "cc2", cardName: "World Kart", description: "Beyaz Eşya Taksit", monthlyInstallment: 2750.5, period: "2026-11", paid: false }
    ],
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
      creditCards: Array.isArray(parsed.creditCards) ? parsed.creditCards : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      noteGroupsList: Array.isArray(parsed.noteGroupsList) ? parsed.noteGroupsList : ["Genel", "Fatura", "Kredi Kartı", "Araç", "Aile", "Diğer"]
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

function setGateMessage(msg) {
  const gateStatus = document.getElementById("driveGateStatus");
  if (gateStatus) gateStatus.textContent = msg;
}

function setDriveStatus(text, isOk) {
  const el = document.getElementById("driveStatusText");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("connected", Boolean(isOk));
}

function applyStrictDriveLock() {
  const gateEl = document.getElementById("driveGate");
  const workspaceEl = document.getElementById("appWorkspace");

  if (!driveConnected) {
    if (gateEl) gateEl.classList.remove("hidden");
    if (workspaceEl) workspaceEl.classList.add("hidden");

    const expBody = document.getElementById("expenseTableBody");
    const incBody = document.getElementById("incomeTableBody");
    const noteBody = document.getElementById("notesTableBody");
    const ccTotalEl = document.getElementById("ccMonthlyInstallmentTotal");
    const periodSel = document.getElementById("periodSelect");

    if (expBody) expBody.innerHTML = "";
    if (incBody) incBody.innerHTML = "";
    if (noteBody) noteBody.innerHTML = "";
    if (ccTotalEl) ccTotalEl.textContent = "0,00 TL";
    if (periodSel) periodSel.innerHTML = "";
    return;
  }

  if (gateEl) gateEl.classList.add("hidden");
  if (workspaceEl) workspaceEl.classList.remove("hidden");
}

function getCreditCardMonthlyTotal(period) {
  const cards = Array.isArray(appState.creditCards) ? appState.creditCards : [];
  return cards
    .filter((c) => !c.period || c.period === period)
    .reduce((sum, c) => sum + (Number(c.monthlyInstallment) || 0), 0);
}

function renderPeriodSelect() {
  const selectEl = document.getElementById("periodSelect");
  if (!selectEl || !driveConnected) return;

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
  if (!driveConnected) return;

  const expBody = document.getElementById("expenseTableBody");
  const incBody = document.getElementById("incomeTableBody");
  const ccTotalEl = document.getElementById("ccMonthlyInstallmentTotal");

  const period = appState.activePeriod || "2026-11";
  if (!appState.periods[period]) {
    appState.periods[period] = { expenses: [], incomes: [] };
  }

  const periodData = appState.periods[period];
  const expenses = Array.isArray(periodData.expenses) ? periodData.expenses : [];
  const incomes = Array.isArray(periodData.incomes) ? periodData.incomes : [];

  let totalExpense = 0;
  let totalPaid = 0;
  let totalUnpaid = 0;

  if (expBody) {
    expBody.innerHTML = "";
    expenses.forEach((item) => {
      const amt = Number(item.amount) || 0;
      totalExpense += amt;
      if (item.paid) {
        totalPaid += amt;
      } else {
        totalUnpaid += amt;
      }

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

      tr.appendChild(nameTd);
      tr.appendChild(amtTd);
      tr.appendChild(dueTd);
      tr.appendChild(noteTd);
      tr.appendChild(statusTd);
      expBody.appendChild(tr);
    });

    const sumTr = document.createElement("tr");
    sumTr.className = "summary-row";
    sumTr.innerHTML = `
      <td>Toplam Gider (Ödenen: ${formatMoneyTR(totalPaid)} TL | Ödenmedi: ${formatMoneyTR(totalUnpaid)} TL)</td>
      <td class="num">${formatMoneyTR(totalExpense)} TL</td>
      <td colspan="3"></td>
    `;
    expBody.appendChild(sumTr);
  }

  if (ccTotalEl) {
    const ccTotal = getCreditCardMonthlyTotal(period);
    ccTotalEl.textContent = `${formatMoneyTR(ccTotal)} TL`;
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

      tr.appendChild(nameTd);
      tr.appendChild(amtTd);
      tr.appendChild(noteTd);
      incBody.appendChild(tr);
    });

    const netTr = document.createElement("tr");
    netTr.className = "summary-row";
    netTr.innerHTML = `
      <td>Toplam Gelir / Net Durum</td>
      <td class="num">${formatMoneyTR(totalIncome)} TL</td>
      <td>Net: ${formatMoneyTR(totalIncome - totalExpense)} TL</td>
    `;
    incBody.appendChild(netTr);
  }
}

function renderAll(triggerSync = false) {
  applyStrictDriveLock();
  if (!driveConnected) return;

  renderPeriodSelect();
  renderExpensesAndIncomes();
  if (notesApi) {
    notesApi.renderNotes(appState.activePeriod, true);
  }
  if (triggerSync) {
    scheduleAutoDriveSync();
  }
}

async function ensureFolderId() {
  const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${driveAccessToken}` }
  });
  const data = await res.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

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
        ...remoteJson
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
  if (!DRIVE_CLIENT_ID || DRIVE_CLIENT_ID === "BURAYA_KENDI_CLIENT_ID_YAZIN") {
    setGateMessage("Hata: app.js içinde DRIVE_CLIENT_ID tanımlanmamış.");
    return false;
  }
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    setGateMessage("Google giriş servisi yükleniyor, lütfen 1-2 saniye bekleyip tekrar basın.");
    return false;
  }

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: DRIVE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: async (resp) => {
      if (resp && resp.access_token) {
        driveAccessToken = resp.access_token;
        driveConnected = true;
        appState = loadLocalState();
        setDriveStatus("Drive: Bağlandı", true);
        setGateMessage("Drive bağlantısı kuruldu, veriler yükleniyor...");
        try {
          await loadRemoteStateIfExists();
        } catch {
          // Uzak dosya yoksa yerel veri ile devam edilir
        }
        renderAll(false);
      } else {
        driveConnected = false;
        driveAccessToken = null;
        setGateMessage("Drive bağlantısı tamamlanmadı. Devam etmek için Drive Bağlan'a basın.");
        renderAll(false);
      }
    }
  });
  return true;
}

function handleConnectClick() {
  if (!ensureTokenClient()) return;
  try {
    tokenClient.requestAccessToken({ prompt: "consent" });
  } catch (err) {
    setGateMessage(`Bağlantı penceresi açılamadı: ${err?.message || err}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  appState = loadLocalState();
  driveConnected = false;
  applyStrictDriveLock();

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
  notesApi.setDriveReadyGetter(() => driveConnected);

  document.getElementById("driveConnectBtn")?.addEventListener("click", handleConnectClick);

  document.getElementById("driveSyncNowBtn")?.addEventListener("click", () => {
    if (!driveConnected) {
      handleConnectClick();
      return;
    }
    syncAllToDrive();
  });

  document.getElementById("periodSelect")?.addEventListener("change", (e) => {
    if (!driveConnected) return;
    appState.activePeriod = e.target.value;
    saveLocalState();
    renderAll(false);
  });

  window.addEventListener("load", () => {
    setTimeout(() => {
      ensureTokenClient();
    }, 300);
  });
});
