import {
  initNotesModule,
  renderNotesPanel,
  getNotesData,
  getNoteGroupsData,
  getInfoNotesData,
  setNotesData,
  addOrUpdateInfoNote,
  deleteInfoNote,
  requestNotificationPermissionManual
} from "./notes.js";
import {
  initReportsModule,
  openReportsView,
  closeReportsView
} from "./reports.js";

const CLIENT_ID = "247986753605-ntjp9tt0vshhsobo3kk2fd3dkqud7puv.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "ButceArsiv";
const STATE_FILE_NAME = "hesap_kalemleri.json";

const STORAGE_PERIOD_KEY = "butce_selected_period_month";
const STORAGE_REGISTERED_PERIODS_KEY = "butce_registered_periods_v1";
const STORAGE_KALEM_KEY = "butce_hesap_kalemleri_v4";
const STORAGE_PERIOD_DATA_KEY = "butce_period_entries_v2";
const STORAGE_CARDS_KEY = "butce_credit_cards_v2";
const STORAGE_CC_ITEMS_KEY = "butce_cc_items_v1";
const STORAGE_MAAS_KEY = "butce_maas_kayitlari_v1";
const STORAGE_YATIRIM_KEY = "butce_yatirim_durumu_v1";
const STORAGE_YATIRIM_GECMIS_KEY = "butce_yatirim_gecmis_v1";
const STORAGE_BORCLAR_KEY = "butce_borclar_v1";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

let accessToken = null;
let folderId = null;
let stateFileId = null;
let activePanelId = null;
let autoSyncTimer = null;
let editingKalemId = null;
let editingMaasIdx = null;
let editingYatirimIdx = null;
let editingBorcIdx = null;
let editingBnIdx = null;
let anaBorclarAcik = false;
let deferredInstallPrompt = null;

let registeredPeriods = [];
let kalemler = [];
let periodEntriesMap = {};
let creditCards = [];
let ccItems = [];
let maasKayitlari = [];
let yatirimDurumu = {
  dolar: 0, euro: 0, nakit: 0, altin: 0, diger: 0,
  kurlar: { dolar: "", euro: "", nakit: "", altin: "", diger: "" },
  acik: true
};
let yatirimGecmis = [];
let borclarListesi = [];
let draftSubItems = [];

const topButtons = Array.from(document.querySelectorAll(".top-btn[data-panel]"));
const drawerCards = Array.from(document.querySelectorAll(".drawer-card"));
const closeButtons = Array.from(document.querySelectorAll("[data-close]"));
const btnInstallApp = document.getElementById("btnInstallApp");
const btnEnableNotify = document.getElementById("btnEnableNotify");

const periodSelect = document.getElementById("periodMonth");
const btnNewMonth = document.getElementById("btnNewMonth");
const btnDeleteMonth = document.getElementById("btnDeleteMonth");
const btnDriveConnect = document.getElementById("btnDriveConnect");
const btnDriveSync = document.getElementById("btnDriveSync");
const driveStatus = document.getElementById("driveStatus");

const kalemDrawerTitle = document.getElementById("kalemDrawerTitle");
const kalemForm = document.getElementById("kalemForm");
const kalemFlow = document.getElementById("kalemFlow");
const kalemName = document.getElementById("kalemName");
const kalemAmount = document.getElementById("kalemAmount");
const kalemMode = document.getElementById("kalemMode");
const kalemInstallments = document.getElementById("kalemInstallments");
const kalemTargetPeriod = document.getElementById("kalemTargetPeriod");
const btnSaveKalem = document.getElementById("btnSaveKalem");
const btnCancelKalemEdit = document.getElementById("btnCancelKalemEdit");
const btnAddDraftSub = document.getElementById("btnAddDraftSub");
const draftSubList = document.getElementById("draftSubList");
const kalemMasterList = document.getElementById("kalemMasterList");

const newCardBankInput = document.getElementById("newCardBankInput");
const btnAddCard = document.getElementById("btnAddCard");
const ccSelect = document.getElementById("ccSelect");
const ccTargetKalemSelect = document.getElementById("ccTargetKalemSelect");
const btnDeleteCard = document.getElementById("btnDeleteCard");
const ccExpenseForm = document.getElementById("ccExpenseForm");
const ccExpDesc = document.getElementById("ccExpDesc");
const ccExpAmount = document.getElementById("ccExpAmount");
const ccExpInstallments = document.getElementById("ccExpInstallments");
const ccExpDate = document.getElementById("ccExpDate");
const ccExpenseTableBody = document.getElementById("ccExpenseTableBody");
const ccPeriodTotalLabel = document.getElementById("ccPeriodTotalLabel");
const ccLinkedStatusLabel = document.getElementById("ccLinkedStatusLabel");
const ccFutureInstallmentsList = document.getElementById("ccFutureInstallmentsList");

const expenseSheetFrame = document.getElementById("expenseSheetFrame");
const expenseTableBody = document.getElementById("expenseTableBody");
const incomeSheetFrame = document.getElementById("incomeSheetFrame");
const incomeTableBody = document.getElementById("incomeTableBody");

function getCurrentMonthValue() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getTodayDateValue() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function monthToIndex(ym) {
  if (!ym || !ym.includes("-")) return 0;
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

function indexToMonth(idx) {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function isValidYM(ym) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || "").trim());
}

function formatPeriodOptionLabel(ym) {
  if (!isValidYM(ym)) return ym;
  const [y, m] = ym.split("-");
  const monthNames = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
  ];
  const mName = monthNames[Number(m) - 1] || m;
  return `${ym} (${mName} ${y})`;
}

function parseMoneyInput(raw) {
  if (raw === null || raw === undefined) return NaN;
  const str = String(raw).trim().replace(/\s+/g, "");
  if (!str) return NaN;
  if (str.includes(",")) {
    return Number(str.replace(/\./g, "").replace(",", "."));
  }
  const dotParts = str.split(".");
  if (dotParts.length > 2) {
    return Number(str.replace(/\./g, ""));
  }
  return Number(str);
}

function preserveRawText(val) {
  if (val === null || val === undefined || String(val).trim() === "") return "";
  return String(val);
}

function formatDisplayAmountInput(raw) {
  const rawStr = preserveRawText(raw);
  if (!rawStr) return "";
  const num = parseMoneyInput(rawStr);
  if (Number.isNaN(num)) return rawStr;
  const hasDecimalPart = /[.,]\d*[1-9]/.test(rawStr) || /[.,]0+$/.test(rawStr);
  if (hasDecimalPart) {
    const decMatch = rawStr.match(/[.,](\d+)/);
    const decCount = decMatch ? Math.min(decMatch[1].length, 4) : 2;
    return num.toLocaleString("tr-TR", {
      minimumFractionDigits: decCount,
      maximumFractionDigits: decCount
    });
  }
  return num.toLocaleString("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4
  });
}

function formatTL(val) {
  const num = typeof val === "number" ? val : parseMoneyInput(val);
  return `${Number(Number.isNaN(num) ? 0 : num).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} TL`;
}

function formatSignedTL(val) {
  const parsed = typeof val === "number" ? val : parseMoneyInput(val);
  const num = Number.isNaN(parsed) ? 0 : parsed;
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} TL`;
}

function fmtNum(val, decimals = 2) {
  const n = parseMoneyInput(val);
  return Number(Number.isNaN(n) ? 0 : n).toLocaleString("tr-TR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function modeLabel(mode, item = null) {
  if (mode === "fixed") return "Sabit (Her Ay)";
  if (mode === "installment") {
    const cnt = item?.installments ? `${item.installments} ay` : "";
    return cnt ? `Taksitli (${cnt})` : "Taksitli";
  }
  if (mode === "yearly") return "Yıllık";
  if (mode === "scheduled") return "İleri / Belirli Ay";
  if (mode === "this_month") return "Sadece Seçili Ay";
  return mode;
}

function flowLabel(flow) {
  if (flow === "both") return "Gelir/Gider";
  if (flow === "income") return "Gelir";
  return "Gider";
}

function normalizeKalemList(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map((k) => ({
    ...k,
    subItems: Array.isArray(k.subItems) ? k.subItems : []
  }));
}

function normalizeRegisteredPeriods(rawPeriods, entriesMap, fallbackSavedPeriod) {
  const set = new Set();
  if (Array.isArray(rawPeriods)) {
    for (const p of rawPeriods) {
      if (isValidYM(p)) set.add(p);
    }
  }
  if (entriesMap && typeof entriesMap === "object") {
    for (const k of Object.keys(entriesMap)) {
      if (isValidYM(k)) set.add(k);
    }
  }
  if (!set.size) {
    set.add(isValidYM(fallbackSavedPeriod) ? fallbackSavedPeriod : getCurrentMonthValue());
  }
  return Array.from(set).sort();
}

function normalizeYatirimDurumu(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const k = d.kurlar && typeof d.kurlar === "object" ? d.kurlar : {};
  return {
    dolar: Number(parseMoneyInput(d.dolar)) || 0,
    euro: Number(parseMoneyInput(d.euro)) || 0,
    nakit: Number(parseMoneyInput(d.nakit)) || 0,
    altin: Number(parseMoneyInput(d.altin)) || 0,
    diger: Number(parseMoneyInput(d.diger)) || 0,
    kurlar: {
      dolar: preserveRawText(k.dolar),
      euro: preserveRawText(k.euro),
      nakit: preserveRawText(k.nakit),
      altin: preserveRawText(k.altin),
      diger: preserveRawText(k.diger)
    },
    acik: d.acik !== false
  };
}

function recalculateYatirimFromHistory() {
  const curKurlar = yatirimDurumu.kurlar || { dolar: "", euro: "", nakit: "", altin: "", diger: "" };
  const curAcik = yatirimDurumu.acik !== false;
  let d = 0, e = 0, n = 0, a = 0, di = 0;

  for (const g of yatirimGecmis) {
    d += Number(parseMoneyInput(g.dolar)) || 0;
    e += Number(parseMoneyInput(g.euro)) || 0;
    n += Number(parseMoneyInput(g.nakit)) || 0;
    a += Number(parseMoneyInput(g.altin)) || 0;
    di += Number(parseMoneyInput(g.diger)) || 0;
  }

  yatirimDurumu = {
    dolar: d,
    euro: e,
    nakit: n,
    altin: a,
    diger: di,
    kurlar: curKurlar,
    acik: curAcik
  };
}

function loadStateFromStorage() {
  try {
    const curKalem = localStorage.getItem(STORAGE_KALEM_KEY);
    kalemler = curKalem !== null ? normalizeKalemList(JSON.parse(curKalem || "[]")) : [];
  } catch {
    kalemler = [];
  }

  try {
    periodEntriesMap = JSON.parse(localStorage.getItem(STORAGE_PERIOD_DATA_KEY) || "{}");
  } catch {
    periodEntriesMap = {};
  }

  try {
    creditCards = JSON.parse(localStorage.getItem(STORAGE_CARDS_KEY) || "[]");
  } catch {
    creditCards = [];
  }

  try {
    ccItems = JSON.parse(localStorage.getItem(STORAGE_CC_ITEMS_KEY) || "[]");
  } catch {
    ccItems = [];
  }

  try {
    maasKayitlari = JSON.parse(localStorage.getItem(STORAGE_MAAS_KEY) || "[]");
    if (!Array.isArray(maasKayitlari)) maasKayitlari = [];
  } catch {
    maasKayitlari = [];
  }

  try {
    yatirimDurumu = normalizeYatirimDurumu(JSON.parse(localStorage.getItem(STORAGE_YATIRIM_KEY) || "{}"));
  } catch {
    yatirimDurumu = {
      dolar: 0, euro: 0, nakit: 0, altin: 0, diger: 0,
      kurlar: { dolar: "", euro: "", nakit: "", altin: "", diger: "" },
      acik: true
    };
  }

  try {
    yatirimGecmis = JSON.parse(localStorage.getItem(STORAGE_YATIRIM_GECMIS_KEY) || "[]");
    if (!Array.isArray(yatirimGecmis)) yatirimGecmis = [];
  } catch {
    yatirimGecmis = [];
  }

  try {
    borclarListesi = JSON.parse(localStorage.getItem(STORAGE_BORCLAR_KEY) || "[]");
    if (!Array.isArray(borclarListesi)) borclarListesi = [];
  } catch {
    borclarListesi = [];
  }

  let savedReg = [];
  try {
    savedReg = JSON.parse(localStorage.getItem(STORAGE_REGISTERED_PERIODS_KEY) || "[]");
  } catch {
    savedReg = [];
  }
  const savedSel = localStorage.getItem(STORAGE_PERIOD_KEY);
  registeredPeriods = normalizeRegisteredPeriods(savedReg, periodEntriesMap, savedSel);
  localStorage.setItem(STORAGE_REGISTERED_PERIODS_KEY, JSON.stringify(registeredPeriods));
}

function saveAllLocalState() {
  localStorage.setItem(STORAGE_REGISTERED_PERIODS_KEY, JSON.stringify(registeredPeriods));
  localStorage.setItem(STORAGE_KALEM_KEY, JSON.stringify(kalemler));
  localStorage.setItem(STORAGE_PERIOD_DATA_KEY, JSON.stringify(periodEntriesMap));
  localStorage.setItem(STORAGE_CARDS_KEY, JSON.stringify(creditCards));
  localStorage.setItem(STORAGE_CC_ITEMS_KEY, JSON.stringify(ccItems));
  localStorage.setItem(STORAGE_MAAS_KEY, JSON.stringify(maasKayitlari));
  localStorage.setItem(STORAGE_YATIRIM_KEY, JSON.stringify(yatirimDurumu));
  localStorage.setItem(STORAGE_YATIRIM_GECMIS_KEY, JSON.stringify(yatirimGecmis));
  localStorage.setItem(STORAGE_BORCLAR_KEY, JSON.stringify(borclarListesi));
  scheduleAutoDriveSync();
}

function renderPeriodDropdown(preferredPeriod = null) {
  if (!registeredPeriods.length) {
    registeredPeriods = [getCurrentMonthValue()];
  }
  registeredPeriods = Array.from(new Set(registeredPeriods)).sort();

  const currentVal = preferredPeriod || periodSelect.value || localStorage.getItem(STORAGE_PERIOD_KEY);
  periodSelect.innerHTML = registeredPeriods
    .map((ym) => `<option value="${ym}">${formatPeriodOptionLabel(ym)}</option>`)
    .join("");

  const activeYM = registeredPeriods.includes(currentVal)
    ? currentVal
    : registeredPeriods[registeredPeriods.length - 1];

  periodSelect.value = activeYM;
  localStorage.setItem(STORAGE_PERIOD_KEY, activeYM);

  if (!editingKalemId) {
    kalemTargetPeriod.value = activeYM;
  }

  renderNotesPanel();
}

function getPeriodData(period) {
  if (!periodEntriesMap[period]) {
    periodEntriesMap[period] = { overrides: {}, subOverrides: {} };
  }
  if (!periodEntriesMap[period].overrides) periodEntriesMap[period].overrides = {};
  if (!periodEntriesMap[period].subOverrides) periodEntriesMap[period].subOverrides = {};
  return periodEntriesMap[period];
}

function getCcItemForPeriod(ccItem, selectedPeriod) {
  const selIdx = monthToIndex(selectedPeriod);
  const startIdx = monthToIndex(ccItem.startPeriod || selectedPeriod);
  const count = Math.max(1, Number(ccItem.installments) || 1);
  const step = selIdx - startIdx + 1;
  if (step < 1 || step > count) return null;
  const totalAmt = Number(ccItem.totalAmount) || 0;
  return {
    ...ccItem,
    step,
    count,
    installmentAmount: totalAmt / count,
    statusText: count > 1 ? `${step}/${count}. Taksit` : "Tek Çekim"
  };
}

function getCardPeriodTotal(period, cardId) {
  return ccItems
    .filter((x) => x.cardId === cardId)
    .reduce((sum, item) => {
      const match = getCcItemForPeriod(item, period);
      return sum + (match ? match.installmentAmount : 0);
    }, 0);
}

function getSyncedCardAmountsForPeriod(period) {
  const syncedByKalemId = {};
  for (const card of creditCards) {
    if (!card.linkedKalemId) continue;
    const total = getCardPeriodTotal(period, card.id);
    syncedByKalemId[card.linkedKalemId] = (syncedByKalemId[card.linkedKalemId] || 0) + total;
  }
  return syncedByKalemId;
}

function isKalemActiveInPeriod(item, selectedPeriod, targetFlow) {
  const allowedByFlow =
    item.flow === "both" ||
    (targetFlow === "expense" && item.flow === "expense") ||
    (targetFlow === "income" && item.flow === "income");
  if (!allowedByFlow) return { active: false, metaText: "" };

  const selYM = selectedPeriod;
  const startYM = item.startPeriod || selectedPeriod;
  const [, selM] = selYM.split("-").map(Number);
  const [, startM] = startYM.split("-").map(Number);
  const selIdx = monthToIndex(selYM);
  const startIdx = monthToIndex(startYM);

  if (item.mode === "this_month" || item.mode === "scheduled") {
    if (selYM !== startYM) return { active: false, metaText: "" };
    return { active: true, metaText: item.mode === "scheduled" ? `Planlı (${startYM})` : "Sadece Seçili Ay" };
  }
  if (item.mode === "yearly") {
    if (selIdx < startIdx || selM !== startM) return { active: false, metaText: "" };
    return { active: true, metaText: `Yıllık (${String(startM).padStart(2, "0")}. Ay)` };
  }
  if (item.mode === "installment") {
    const count = Math.max(1, Number(item.installments) || 1);
    const step = selIdx - startIdx + 1;
    if (step < 1 || step > count) return { active: false, metaText: "" };
    return { active: true, metaText: `${step}/${count}. Taksit` };
  }
  if (item.mode === "fixed") {
    if (selIdx < startIdx) return { active: false, metaText: "" };
    return { active: true, metaText: "Sabit" };
  }
  return { active: false, metaText: "" };
}

function initializeNewMonthData(targetPeriod) {
  const pData = getPeriodData(targetPeriod);
  const syncedCardMap = getSyncedCardAmountsForPeriod(targetPeriod);

  for (const flow of ["expense", "income"]) {
    for (const item of kalemler) {
      const status = isKalemActiveInPeriod(item, targetPeriod, flow);
      if (!status.active) continue;

      const key = `${item.id}__${flow}`;
      const subDefinitions = Array.isArray(item.subItems) ? item.subItems : [];
      const hasChildren = subDefinitions.length > 0;

      if (hasChildren) {
        let subSum = 0;
        for (const sub of subDefinitions) {
          const subOvKey = `${sub.subId}__${flow}`;
          const fixedSubAmt = sub.fixedAmount !== undefined && sub.fixedAmount !== null ? String(sub.fixedAmount) : "";
          const n = parseMoneyInput(fixedSubAmt);
          if (!Number.isNaN(n)) subSum += n;
          if (!pData.subOverrides[subOvKey]) {
            pData.subOverrides[subOvKey] = { amount: fixedSubAmt, note: "", dueDate: "", paid: false };
          }
        }
        if (!pData.overrides[key]) {
          pData.overrides[key] = { amount: String(subSum), note: "", dueDate: "", paid: false };
        }
      } else {
        const hasSyncedCard = flow === "expense" && Object.prototype.hasOwnProperty.call(syncedCardMap, item.id);
        let initialAmount = "";
        if (hasSyncedCard) {
          initialAmount = String(syncedCardMap[item.id]);
        } else if (item.defaultAmount !== null && item.defaultAmount !== undefined) {
          initialAmount = String(item.defaultAmount);
        }
        if (!pData.overrides[key]) {
          pData.overrides[key] = { amount: initialAmount, note: "", dueDate: "", paid: false };
        }
      }
    }
  }
}

function handleCreateNewMonth() {
  const sorted = [...registeredPeriods].sort();
  const latestYM = sorted[sorted.length - 1] || periodSelect.value || getCurrentMonthValue();
  const suggestedYM = indexToMonth(monthToIndex(latestYM) + 1);
  const inputYM = prompt("Oluşturulacak yeni dönemi (YYYY-AA formatında) girin:", suggestedYM);
  if (inputYM === null) return;
  const trimmed = inputYM.trim();
  if (!isValidYM(trimmed)) {
    alert("Geçersiz dönem formatı. Lütfen YYYY-AA şeklinde girin (ör. 2026-12).");
    return;
  }
  if (!registeredPeriods.includes(trimmed)) {
    registeredPeriods.push(trimmed);
    registeredPeriods.sort();
    initializeNewMonthData(trimmed);
    saveAllLocalState();
  }
  renderPeriodDropdown(trimmed);
  renderPeriodTables();
}

function handleDeleteSelectedMonth() {
  const targetYM = periodSelect.value;
  if (!targetYM) return;
  if (!confirm(`"${formatPeriodOptionLabel(targetYM)}" dönemine ait kayıtlar silinecek. Devam edilsin mi?`)) return;
  const typedConfirm = prompt(`Onaylamak için silinecek dönemi (${targetYM}) yazın:`);
  if (typedConfirm === null || typedConfirm.trim() !== targetYM) {
    alert("Dönem adı eşleşmediği için silme iptal edildi.");
    return;
  }
  delete periodEntriesMap[targetYM];
  registeredPeriods = registeredPeriods.filter((p) => p !== targetYM);
  if (!registeredPeriods.length) registeredPeriods = [getCurrentMonthValue()];
  const nextSelected = registeredPeriods[registeredPeriods.length - 1];
  saveAllLocalState();
  renderPeriodDropdown(nextSelected);
  renderPeriodTables();
}

function renderDraftSubList() {
  if (!draftSubItems.length) {
    draftSubList.innerHTML = `<div class="item-meta">Alt kalem eklenmedi. Tek kalem yeterli ise boş bırakabilirsiniz.</div>`;
    return;
  }
  draftSubList.innerHTML = draftSubItems
    .map(
      (s, idx) => `
      <div class="draft-sub-row" data-draft-idx="${idx}">
        <input type="text" class="draft-sub-name" value="${escapeHtml(s.name)}" placeholder="Alt kalem adı" />
        <input type="number" step="any" class="draft-sub-amount" value="${escapeHtml(s.fixedAmount)}" placeholder="Her ay sabit tutar" />
        <button type="button" class="del-btn" data-remove-draft-idx="${idx}">Sil</button>
      </div>
    `
    )
    .join("");
}

function syncDraftFromDom() {
  const rows = Array.from(draftSubList.querySelectorAll(".draft-sub-row"));
  draftSubItems = rows.map((row, idx) => ({
    subId: draftSubItems[idx]?.subId || `sub_${Date.now()}_${idx}`,
    name: row.querySelector(".draft-sub-name")?.value || "",
    fixedAmount: row.querySelector(".draft-sub-amount")?.value || ""
  }));
}

function resetKalemForm() {
  editingKalemId = null;
  kalemDrawerTitle.textContent = "Hesap Kalemi Ekle / Yönet";
  btnSaveKalem.textContent = "Kalemi Ekle";
  btnCancelKalemEdit.style.display = "none";
  kalemForm.reset();
  kalemInstallments.style.display = "none";
  kalemTargetPeriod.value = periodSelect.value || getCurrentMonthValue();
  draftSubItems = [];
  renderDraftSubList();
}

function startEditingKalem(id) {
  const item = kalemler.find((k) => k.id === id);
  if (!item) return;
  editingKalemId = item.id;
  kalemDrawerTitle.textContent = `Kalemi Düzenle: ${item.name}`;
  btnSaveKalem.textContent = "Değişiklikleri Kaydet";
  btnCancelKalemEdit.style.display = "inline-block";
  kalemFlow.value = item.flow;
  kalemName.value = item.name;
  kalemAmount.value = item.defaultAmount !== null && item.defaultAmount !== undefined ? String(item.defaultAmount) : "";
  kalemMode.value = item.mode;
  kalemInstallments.style.display = item.mode === "installment" ? "block" : "none";
  kalemInstallments.value = item.installments ? String(item.installments) : "";
  kalemTargetPeriod.value = item.startPeriod || periodSelect.value || getCurrentMonthValue();
  draftSubItems = (item.subItems || []).map((s) => ({
    subId: s.subId,
    name: s.name || "",
    fixedAmount: s.fixedAmount !== undefined && s.fixedAmount !== null ? String(s.fixedAmount) : ""
  }));
  renderDraftSubList();
}

function renderMasterList() {
  if (!kalemler.length) {
    kalemMasterList.innerHTML = `<div class="item-meta">Henüz hesap kalemi eklenmedi.</div>`;
    return;
  }
  const rowsHtml = kalemler
    .map((item) => {
      const extraInfo =
        item.mode === "yearly" || item.mode === "scheduled" || item.mode === "this_month"
          ? ` (${item.startPeriod})`
          : "";
      const hasAmt = item.defaultAmount !== null && item.defaultAmount !== undefined && String(item.defaultAmount).trim() !== "";
      const amtText = hasAmt ? formatTL(item.defaultAmount) : "Aylık girilecek";
      const subRowsHtml = (item.subItems || [])
        .map(
          (s) => `
          <tr class="sub-item-row">
            <td style="padding-left: 28px;">↳ ${escapeHtml(s.name || "(İsimsiz Alt Kalem)")}</td>
            <td><span class="badge">Alt Kalem</span></td>
            <td>Sabit / Aylık</td>
            <td style="text-align: right;">${escapeHtml(s.fixedAmount ? formatTL(s.fixedAmount) : "Aylık girilecek")}</td>
            <td style="text-align: right;"></td>
          </tr>
        `
        )
        .join("");
      return `
        <tr>
          <td><strong>${escapeHtml(item.name)}</strong></td>
          <td>${escapeHtml(flowLabel(item.flow))}</td>
          <td>${escapeHtml(modeLabel(item.mode, item) + extraInfo)}</td>
          <td style="text-align: right;"><strong>${escapeHtml(amtText)}</strong></td>
          <td style="text-align: right; white-space: nowrap;">
            <button type="button" class="edit-btn" data-edit-kalem-id="${item.id}">Düzenle</button>
            <button type="button" class="del-btn" data-delete-kalem-id="${item.id}">Sil</button>
          </td>
        </tr>
        ${subRowsHtml}
      `;
    })
    .join("");

  kalemMasterList.innerHTML = `
    <div class="sheet-frame" style="min-height: auto; margin-top: 12px;">
      <table class="excel-table">
        <thead>
          <tr>
            <th>Hesap Kalemi</th><th>Tür</th><th>Tekrar / Dönem</th>
            <th style="text-align: right;">Varsayılan Tutar</th><th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function populateCcKalemSelect() {
  const prevTarget = ccTargetKalemSelect.value;
  ccTargetKalemSelect.innerHTML =
    `<option value="">-- Bağlı Hesap Kalemi Seçin --</option>` +
    kalemler.map((k) => `<option value="${k.id}">${escapeHtml(k.name)}</option>`).join("");
  const activeCard = creditCards.find((c) => c.id === ccSelect.value) || creditCards[0];
  if (activeCard && activeCard.linkedKalemId) {
    ccTargetKalemSelect.value = activeCard.linkedKalemId;
  } else if (prevTarget) {
    ccTargetKalemSelect.value = prevTarget;
  }
}

function renderCreditCardPanel() {
  const selectedPeriod = periodSelect.value || getCurrentMonthValue();
  const prevSelectedCardId = ccSelect.value;
  if (!creditCards.length) {
    ccSelect.innerHTML = `<option value="">Kart eklenmedi</option>`;
    ccExpenseTableBody.innerHTML = `<tr><td colspan="6" class="item-meta">Önce yukarıdan bir banka/kart adı ekleyip "+ Kart / Banka Ekle" butonuna basın.</td></tr>`;
    ccPeriodTotalLabel.textContent = "Seçili Ay Kart Toplamı: 0,00 TL";
    ccLinkedStatusLabel.textContent = "Hesap Kalemi: Kart eklenmedi";
    ccFutureInstallmentsList.innerHTML = `<span class="item-meta">Kart bulunmuyor.</span>`;
    return;
  }
  ccSelect.innerHTML = creditCards.map((c) => `<option value="${c.id}">${escapeHtml(c.bankName)}</option>`).join("");
  const activeCard = creditCards.find((c) => c.id === prevSelectedCardId) || creditCards[0];
  ccSelect.value = activeCard.id;
  ccTargetKalemSelect.value = activeCard.linkedKalemId || "";

  const activeInPeriod = ccItems
    .filter((x) => x.cardId === activeCard.id)
    .map((item) => ({ raw: item, match: getCcItemForPeriod(item, selectedPeriod) }))
    .filter((x) => x.match !== null);

  ccExpenseTableBody.innerHTML = !activeInPeriod.length
    ? `<tr><td colspan="6" class="item-meta">${selectedPeriod} döneminde ${escapeHtml(activeCard.bankName)} kartında aktif işlem/taksit yok.</td></tr>`
    : activeInPeriod
        .map(
          ({ raw, match }) => `
          <tr>
            <td>${escapeHtml(raw.startPeriod)} (${escapeHtml(raw.date || "-")})</td>
            <td>${escapeHtml(raw.desc)}</td>
            <td style="text-align:right;">${formatTL(raw.totalAmount)}</td>
            <td><span class="badge">${escapeHtml(match.statusText)}</span></td>
            <td style="text-align:right; font-weight:700;">${formatTL(match.installmentAmount)}</td>
            <td style="text-align:center;"><button type="button" class="del-btn" data-delete-cc-item="${raw.id}">Sil</button></td>
          </tr>
        `
        )
        .join("");

  const periodTotal = getCardPeriodTotal(selectedPeriod, activeCard.id);
  const linkedKalem = kalemler.find((k) => k.id === activeCard.linkedKalemId);
  ccPeriodTotalLabel.textContent = `${selectedPeriod} / ${activeCard.bankName} Bu Ay Toplam: ${formatTL(periodTotal)}`;
  ccLinkedStatusLabel.textContent = linkedKalem
    ? `Bağlı Hesap Kalemi: ${linkedKalem.name} (${selectedPeriod} tutarı otomatik güncellenir)`
    : "Hesap Kalemi: Bağlı değil";

  const baseIdx = monthToIndex(selectedPeriod);
  const futureChips = [];
  for (let offset = 1; offset <= 6; offset++) {
    const futureYM = indexToMonth(baseIdx + offset);
    const futureTotal = getCardPeriodTotal(futureYM, activeCard.id);
    if (futureTotal > 0) {
      futureChips.push(`<div class="future-chip"><strong>${futureYM}:</strong> ${formatTL(futureTotal)}</div>`);
    }
  }
  ccFutureInstallmentsList.innerHTML = futureChips.length
    ? futureChips.join("")
    : `<span class="item-meta">Sonraki 6 ay için planlı taksit görünmüyor.</span>`;
}

function buildGroupEntriesForFlow(selectedPeriod, targetFlow) {
  const pData = getPeriodData(selectedPeriod);
  const syncedCardMap = targetFlow === "expense" ? getSyncedCardAmountsForPeriod(selectedPeriod) : {};
  const groups = [];

  for (const item of kalemler) {
    const status = isKalemActiveInPeriod(item, selectedPeriod, targetFlow);
    if (!status.active) continue;

    const key = `${item.id}__${targetFlow}`;
    const savedOverride = pData.overrides[key] || {};
    const subDefinitions = Array.isArray(item.subItems) ? item.subItems : [];
    const hasChildren = subDefinitions.length > 0;

    const children = subDefinitions.map((sub) => {
      const subOvKey = `${sub.subId}__${targetFlow}`;
      const subOv = pData.subOverrides[subOvKey] || {};
      const defaultSubAmt = sub.fixedAmount !== undefined && sub.fixedAmount !== null ? String(sub.fixedAmount) : "";
      const amountVal = subOv.amount !== undefined ? subOv.amount : defaultSubAmt;
      return {
        subId: sub.subId,
        subOvKey,
        kalemId: item.id,
        name: sub.name || "",
        note: subOv.note || "",
        amount: amountVal,
        dueDate: subOv.dueDate || "",
        paid: Boolean(subOv.paid)
      };
    });

    const hasSyncedCard = targetFlow === "expense" && Object.prototype.hasOwnProperty.call(syncedCardMap, item.id);
    let parentAmount = "";
    let allChildrenPaid = false;

    if (hasChildren) {
      const subSum = children.reduce((acc, c) => {
        const n = parseMoneyInput(c.amount);
        return acc + (Number.isNaN(n) ? 0 : n);
      }, 0);
      parentAmount = String(subSum);
      allChildrenPaid = children.every((c) => Boolean(c.paid));
    } else if (hasSyncedCard) {
      parentAmount = String(syncedCardMap[item.id]);
    } else if (savedOverride.amount !== undefined) {
      parentAmount = savedOverride.amount;
    } else if (item.defaultAmount !== null && item.defaultAmount !== undefined) {
      parentAmount = String(item.defaultAmount);
    }

    groups.push({
      parent: {
        key,
        kalemId: item.id,
        kalemName: item.name,
        metaText: hasSyncedCard ? `${status.metaText} · Karttan Otomatik` : status.metaText,
        hasChildren,
        allChildrenPaid,
        isSyncedFromCard: hasSyncedCard,
        note: savedOverride.note || "",
        amount: parentAmount,
        dueDate: savedOverride.dueDate || "",
        paid: hasChildren ? allChildrenPaid : Boolean(savedOverride.paid)
      },
      children
    });
  }
  return groups;
}

function openMaasKurModalForRow() {
  const modal = document.getElementById("maasKurModal");
  const elMevcutDolar = document.getElementById("mkMevcutDolar");
  const elKur = document.getElementById("mkKur");
  const elIslemDolar = document.getElementById("mkIslemDolar");
  const elTop = document.getElementById("mkToplamTutar");

  if (elMevcutDolar) elMevcutDolar.value = preserveRawText(yatirimDurumu.dolar ?? 0) || "0";
  if (elKur) elKur.value = preserveRawText(yatirimDurumu.kurlar?.dolar || "");
  if (elIslemDolar) elIslemDolar.value = "";
  if (elTop) elTop.value = "";
  hesaplaMaasKurTutar();
  if (modal) {
    modal.style.display = "flex";
    elKur?.focus();
  }
}

function hesaplaMaasKurTutar() {
  const kur = Number(parseMoneyInput(document.getElementById("mkKur")?.value)) || 0;
  const islemDolar = Number(parseMoneyInput(document.getElementById("mkIslemDolar")?.value)) || 0;
  const tutar = kur * islemDolar;
  const topEl = document.getElementById("mkToplamTutar");
  if (topEl) {
    topEl.value = kur > 0 && islemDolar > 0 ? fmtNum(tutar) : "";
  }
  return { kur, islemDolar, tutar };
}

function getBorcCinsToplamlari() {
  const map = new Map();
  for (const b of borclarListesi) {
    const cins = String(b.cins || "TL").trim() || "TL";
    const key = cins.toLowerCase();
    const miktar = Number(parseMoneyInput(b.miktar)) || 0;
    const prev = map.get(key) || { label: cins, toplam: 0 };
    prev.toplam += miktar;
    map.set(key, prev);
  }
  return Array.from(map.values());
}

function renderBorclarPanel() {
  const cinsToplamlari = getBorcCinsToplamlari();
  const cinsOzetText = cinsToplamlari.length
    ? cinsToplamlari.map((t) => `${t.label}: ${fmtNum(t.toplam)} ${t.label}`).join(" · ")
    : "Borç yok";

  const cinsDiv = document.getElementById("borcCinsToplamlari");
  if (cinsDiv) {
    cinsDiv.innerHTML = cinsToplamlari.length
      ? cinsToplamlari
          .map((t) => `<span class="badge">Toplam ${escapeHtml(t.label)}: ${fmtNum(t.toplam)} ${escapeHtml(t.label)}</span>`)
          .join("")
      : `<span class="item-meta">Henüz borç kaydı yok.</span>`;
  }

  const listeBody = document.getElementById("borclarListeBody");
  if (listeBody) {
    listeBody.innerHTML = borclarListesi.length
      ? borclarListesi
          .map(
            (b, idx) => `
            <tr>
              <td><strong>${escapeHtml(b.kime)}</strong></td>
              <td style="text-align:right;"><strong>${fmtNum(b.miktar)}</strong></td>
              <td><span class="badge">${escapeHtml(b.cins)}</span></td>
              <td>${escapeHtml(b.aciklama || "-")}</td>
              <td style="text-align:center; white-space:nowrap;">
                <button type="button" class="edit-btn" data-edit-borc-idx="${idx}">Düzelt</button>
                <button type="button" class="del-btn" data-delete-borc-idx="${idx}">Sil</button>
              </td>
            </tr>
          `
          )
          .join("")
      : `<tr><td colspan="5" class="item-meta">Henüz borç kaydı yok.</td></tr>`;
  }

  const badgeEl = document.getElementById("anaBorclarOzetBadge");
  if (badgeEl) {
    badgeEl.textContent = cinsOzetText;
  }

  const ayrintiEl = document.getElementById("anaBorclarAyrinti");
  if (ayrintiEl) {
    ayrintiEl.style.display = anaBorclarAcik ? "block" : "none";
    if (!borclarListesi.length) {
      ayrintiEl.innerHTML = `<div class="item-meta">Kayıtlı borç bulunmuyor.</div>`;
    } else {
      ayrintiEl.innerHTML = `
        <div style="margin-bottom:8px; font-weight:600;">Cinsine Göre Toplam Borçlar: ${escapeHtml(cinsOzetText)}</div>
        ${borclarListesi
          .map(
            (b) => `
            <div style="padding:6px 0; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
              <div>
                <strong>${escapeHtml(b.kime)}</strong> — <strong>${fmtNum(b.miktar)} ${escapeHtml(b.cins)}</strong>
                ${b.aciklama ? `<span class="item-meta">(${escapeHtml(b.aciklama)})</span>` : ""}
              </div>
              <span class="badge">${escapeHtml(b.cins)}</span>
            </div>
          `
          )
          .join("")}
      `;
    }
  }
}

function openBorcModal(editIdx = null) {
  editingBorcIdx = typeof editIdx === "number" ? editIdx : null;
  const modal = document.getElementById("borcModal");
  const baslik = document.getElementById("borcModalBaslik");
  const btnKaydet = document.getElementById("btnBorcKaydet");
  const form = document.getElementById("borcForm");

  if (editingBorcIdx !== null && borclarListesi[editingBorcIdx]) {
    const b = borclarListesi[editingBorcIdx];
    if (baslik) baslik.textContent = "Borç Kaydını Düzelt";
    if (btnKaydet) btnKaydet.textContent = "Güncelle";
    document.getElementById("borcKime").value = b.kime || "";
    document.getElementById("borcMiktar").value = preserveRawText(b.miktar ?? "");
    document.getElementById("borcCins").value = b.cins || "TL";
    document.getElementById("borcAciklama").value = b.aciklama || "";
  } else {
    if (baslik) baslik.textContent = "Borç Ekle";
    if (btnKaydet) btnKaydet.textContent = "Kaydet";
    form?.reset();
    document.getElementById("borcCins").value = "TL";
  }

  if (modal) modal.style.display = "flex";
}

function renderPeriodTables() {
  const selectedPeriod = periodSelect.value || getCurrentMonthValue();
  populateCcKalemSelect();
  renderCreditCardPanel();
  renderNotesPanel();
  renderMaasAndYatirimPanel();
  renderBorclarPanel();

  const expenseGroups = buildGroupEntriesForFlow(selectedPeriod, "expense");
  const incomeGroups = buildGroupEntriesForFlow(selectedPeriod, "income");

  let incomeTotal = 0;
  for (const grp of incomeGroups) {
    const numAmt = parseMoneyInput(grp.parent.amount);
    if (!Number.isNaN(numAmt)) incomeTotal += numAmt;
  }

  let expenseTotal = 0;
  let expensePaidTotal = 0;

  if (!expenseGroups.length) {
    expenseSheetFrame.classList.add("empty");
    expenseTableBody.innerHTML = `
      <tr><td colspan="5" class="item-meta">Bu dönem için gider kalemi bulunmuyor.</td></tr>
      <tr class="summary-row"><td>Toplam Gider</td><td style="text-align:right;">${formatTL(0)}</td><td colspan="3"></td></tr>
      <tr class="summary-row paid-summary"><td>Ödenen</td><td style="text-align:right;">${formatTL(0)}</td><td colspan="3"></td></tr>
      <tr class="summary-row rem-summary"><td>Kalan</td><td style="text-align:right;">${formatTL(0)}</td><td colspan="3"></td></tr>
    `;
  } else {
    expenseSheetFrame.classList.remove("empty");
    const htmlRows = [];

    for (const grp of expenseGroups) {
      const p = grp.parent;
      const numAmt = parseMoneyInput(p.amount);
      const validAmt = Number.isNaN(numAmt) ? 0 : numAmt;
      expenseTotal += validAmt;

      let parentPaidForRow = false;
      if (p.hasChildren) {
        let childSum = 0;
        let childPaidSum = 0;
        for (const ch of grp.children) {
          const chAmt = parseMoneyInput(ch.amount);
          const validChAmt = Number.isNaN(chAmt) ? 0 : chAmt;
          childSum += validChAmt;
          if (ch.paid) {
            childPaidSum += validChAmt;
            expensePaidTotal += validChAmt;
          }
        }
        parentPaidForRow = grp.children.length > 0 && childPaidSum >= childSum && childSum > 0;
      } else {
        parentPaidForRow = Boolean(p.paid);
        if (parentPaidForRow) expensePaidTotal += validAmt;
      }

      const parentLocked = p.hasChildren || p.isSyncedFromCard;
      const parentUnpaidClass = !parentPaidForRow ? "unpaid-expense-row" : "";
      const isMaasKalemi = /^maaş$/i.test(String(p.kalemName || "").trim());

      const paidCellHtml = p.hasChildren
        ? `<span class="item-meta">${p.allChildrenPaid ? "Tümü Ödendi" : "Alt kalemden"}</span>`
        : `<label class="paid-box">
             <input type="checkbox" class="field-paid" ${p.paid ? "checked" : ""} />
             <span>${p.paid ? "Ödendi" : "Ödenmedi"}</span>
           </label>`;

      htmlRows.push(`
        <tr class="parent-row ${p.hasChildren ? "parent-has-children" : ""} ${parentUnpaidClass}" data-key="${p.key}" data-kalem-id="${p.kalemId}" data-flow="expense">
          <td>
            <strong class="${isMaasKalemi ? "maas-click-label" : ""}" style="${isMaasKalemi ? "cursor:pointer; text-decoration:underline; text-decoration-style:dotted; color:#1d4ed8;" : ""}">${escapeHtml(p.kalemName)}</strong>
            <span class="badge">${escapeHtml(p.metaText)}</span>
          </td>
          <td>
            <input type="text" inputmode="decimal" class="cell-input num field-amount" data-raw-amount="${escapeHtml(preserveRawText(p.amount))}" value="${escapeHtml(formatDisplayAmountInput(p.amount))}" placeholder="0,00" ${parentLocked ? "readonly" : ""} />
          </td>
          <td><input type="date" class="cell-input date field-due" value="${escapeHtml(p.dueDate)}" /></td>
          <td><input type="text" class="cell-input desc field-note" value="${escapeHtml(p.note)}" placeholder="Açıklama..." /></td>
          <td>${paidCellHtml}</td>
        </tr>
      `);

      for (const ch of grp.children) {
        const childUnpaidClass = !ch.paid ? "unpaid-expense-row" : "";
        htmlRows.push(`
          <tr class="child-row ${childUnpaidClass}" data-sub-ov-key="${ch.subOvKey}" data-kalem-id="${ch.kalemId}" data-flow="expense">
            <td><div class="child-indent"><span>↳</span><span>${escapeHtml(ch.name || "(İsimsiz Alt Kalem)")}</span></div></td>
            <td><input type="text" inputmode="decimal" class="cell-input num field-sub-amount" data-raw-amount="${escapeHtml(preserveRawText(ch.amount))}" value="${escapeHtml(formatDisplayAmountInput(ch.amount))}" placeholder="0,00" /></td>
            <td><input type="date" class="cell-input date field-sub-due" value="${escapeHtml(ch.dueDate)}" /></td>
            <td><input type="text" class="cell-input desc field-sub-note" value="${escapeHtml(ch.note)}" placeholder="Açıklama..." /></td>
            <td>
              <label class="paid-box">
                <input type="checkbox" class="field-sub-paid" ${ch.paid ? "checked" : ""} />
                <span>${ch.paid ? "Ödendi" : "Ödenmedi"}</span>
              </label>
            </td>
          </tr>
        `);
      }
    }

    const remainingTotal = Math.max(0, expenseTotal - expensePaidTotal);
    htmlRows.push(`
      <tr class="summary-row"><td>Toplam Gider</td><td style="text-align:right;">${formatTL(expenseTotal)}</td><td colspan="3"></td></tr>
      <tr class="summary-row paid-summary"><td>Ödenen</td><td style="text-align:right;">${formatTL(expensePaidTotal)}</td><td colspan="3"></td></tr>
      <tr class="summary-row rem-summary"><td>Kalan</td><td style="text-align:right;">${formatTL(remainingTotal)}</td><td colspan="3"></td></tr>
    `);
    expenseTableBody.innerHTML = htmlRows.join("");
  }

  const netProfitLoss = incomeTotal - expenseTotal;
  const pnlLabel = netProfitLoss >= 0 ? "Kar / Zarar (Net Kar)" : "Kar / Zarar (Net Zarar)";
  const pnlClass = netProfitLoss >= 0 ? "profit-row" : "loss-row";

  if (!incomeGroups.length) {
    incomeSheetFrame.classList.add("empty");
    incomeTableBody.innerHTML = `
      <tr><td colspan="3" class="item-meta">Bu dönem için gelir kalemi bulunmuyor.</td></tr>
      <tr class="summary-row"><td>Toplam Gelir</td><td style="text-align:right;">${formatTL(0)}</td><td></td></tr>
      <tr class="summary-row ${pnlClass}"><td>${pnlLabel}</td><td style="text-align:right;">${formatSignedTL(netProfitLoss)}</td><td></td></tr>
    `;
  } else {
    incomeSheetFrame.classList.remove("empty");
    const htmlRows = [];

    for (const grp of incomeGroups) {
      const p = grp.parent;
      const isMaasKalemi = /^maaş$/i.test(String(p.kalemName || "").trim());

      htmlRows.push(`
        <tr class="parent-row ${p.hasChildren ? "parent-has-children" : ""}" data-key="${p.key}" data-kalem-id="${p.kalemId}" data-flow="income">
          <td>
            <strong class="${isMaasKalemi ? "maas-click-label" : ""}" style="${isMaasKalemi ? "cursor:pointer; text-decoration:underline; text-decoration-style:dotted; color:#1d4ed8;" : ""}">${escapeHtml(p.kalemName)}</strong>
            <span class="badge">${escapeHtml(p.metaText)}</span>
          </td>
          <td>
            <input type="text" inputmode="decimal" class="cell-input num field-amount" data-raw-amount="${escapeHtml(preserveRawText(p.amount))}" value="${escapeHtml(formatDisplayAmountInput(p.amount))}" placeholder="0,00" ${p.hasChildren ? "readonly" : ""} />
          </td>
          <td><input type="text" class="cell-input desc field-note" value="${escapeHtml(p.note)}" placeholder="Açıklama..." /></td>
        </tr>
      `);

      for (const ch of grp.children) {
        htmlRows.push(`
          <tr class="child-row" data-sub-ov-key="${ch.subOvKey}" data-kalem-id="${ch.kalemId}" data-flow="income">
            <td><div class="child-indent"><span>↳</span><span>${escapeHtml(ch.name || "(İsimsiz Alt Kalem)")}</span></div></td>
            <td><input type="text" inputmode="decimal" class="cell-input num field-sub-amount" data-raw-amount="${escapeHtml(preserveRawText(ch.amount))}" value="${escapeHtml(formatDisplayAmountInput(ch.amount))}" placeholder="0,00" /></td>
            <td><input type="text" class="cell-input desc field-sub-note" value="${escapeHtml(ch.note)}" placeholder="Açıklama..." /></td>
          </tr>
        `);
      }
    }

    htmlRows.push(`
      <tr class="summary-row"><td>Toplam Gelir</td><td style="text-align:right;">${formatTL(incomeTotal)}</td><td></td></tr>
      <tr class="summary-row ${pnlClass}"><td>${pnlLabel}</td><td style="text-align:right;">${formatSignedTL(netProfitLoss)}</td><td></td></tr>
    `);
    incomeTableBody.innerHTML = htmlRows.join("");
  }
}

function hesaplaMaasForm() {
  const sgk = Number(parseMoneyInput(document.getElementById("maasSgk")?.value)) || 0;
  const ceza = Number(parseMoneyInput(document.getElementById("maasCeza")?.value)) || 0;
  const yatan = Number(parseMoneyInput(document.getElementById("maasYatan")?.value)) || 0;
  const ek = Number(parseMoneyInput(document.getElementById("maasEk")?.value)) || 0;
  const elden = Number(parseMoneyInput(document.getElementById("maasElden")?.value)) || 0;
  const kurRaw = document.getElementById("maasKur")?.value ?? "1";
  const kur = Number(parseMoneyInput(kurRaw)) || 0;
  const hakedis = sgk + ceza + yatan + ek + elden;
  const maas = hakedis - sgk - ceza;
  const nakit = kur * maas;
  if (document.getElementById("maasHakedis")) document.getElementById("maasHakedis").value = fmtNum(hakedis);
  if (document.getElementById("maasNet")) document.getElementById("maasNet").value = fmtNum(maas);
  if (document.getElementById("maasNakit")) document.getElementById("maasNakit").value = fmtNum(nakit);
  return { sgk, ceza, yatan, ek, elden, kurRaw: preserveRawText(kurRaw), kur, hakedis, maas, nakit };
}

function openMaasModal(editIdx = null) {
  editingMaasIdx = typeof editIdx === "number" ? editIdx : null;
  const modal = document.getElementById("maasModal");
  const baslik = document.getElementById("maasModalBaslik");
  const btnKaydet = document.getElementById("btnMaasKaydet");
  const form = document.getElementById("maasForm");

  if (editingMaasIdx !== null && maasKayitlari[editingMaasIdx]) {
    const r = maasKayitlari[editingMaasIdx];
    if (baslik) baslik.textContent = "Maaş Kaydını Güncelle";
    if (btnKaydet) btnKaydet.textContent = "Güncelle";
    document.getElementById("maasDonem").value = r.donem || "";
    document.getElementById("maasSgk").value = preserveRawText(r.sgk ?? 0) || "0";
    document.getElementById("maasCeza").value = preserveRawText(r.ceza ?? 0) || "0";
    document.getElementById("maasYatan").value = preserveRawText(r.yatan ?? 0) || "0";
    document.getElementById("maasEk").value = preserveRawText(r.ek ?? 0) || "0";
    document.getElementById("maasElden").value = preserveRawText(r.elden ?? 0) || "0";
    document.getElementById("maasKur").value = preserveRawText(r.kurRaw ?? r.kur ?? 1) || "1";
  } else {
    if (baslik) baslik.textContent = "Yeni Maaş Kaydı";
    if (btnKaydet) btnKaydet.textContent = "Kaydet";
    form?.reset();
    document.getElementById("maasDonem").value = periodSelect.value || getCurrentMonthValue();
    document.getElementById("maasKur").value = "1";
  }

  hesaplaMaasForm();
  if (modal) modal.style.display = "flex";
}

function openYatirimModal(editIdx = null) {
  editingYatirimIdx = typeof editIdx === "number" ? editIdx : null;
  const ym = document.getElementById("yatirimModal");
  const baslik = document.getElementById("yatirimModalBaslik");
  const btnKaydet = document.getElementById("btnYatirimKaydet");
  const form = document.getElementById("yatirimForm");

  if (editingYatirimIdx !== null && yatirimGecmis[editingYatirimIdx]) {
    const g = yatirimGecmis[editingYatirimIdx];
    if (baslik) baslik.textContent = "Yatırım Kaydını Düzelt";
    if (btnKaydet) btnKaydet.textContent = "Güncelle";
    const isCikis = (Number(g.dolar) || 0) < 0 || (Number(g.euro) || 0) < 0 || (Number(g.nakit) || 0) < 0 || (Number(g.altin) || 0) < 0 || (Number(g.diger) || 0) < 0;
    const mul = isCikis ? -1 : 1;
    document.getElementById("yatIslemTipi").value = isCikis ? "cikis" : "giris";
    document.getElementById("yatDolar").value = String(Math.abs(Number(g.dolar) || 0) * (isCikis && (Number(g.dolar) || 0) >= 0 ? 1 : (Number(g.dolar) || 0) * mul));
    document.getElementById("yatEuro").value = String(Math.abs(Number(g.euro) || 0));
    document.getElementById("yatNakit").value = String(Math.abs(Number(g.nakit) || 0));
    document.getElementById("yatAltin").value = String(Math.abs(Number(g.altin) || 0));
    document.getElementById("yatDiger").value = String(Math.abs(Number(g.diger) || 0));
    document.getElementById("donusumYon").value = g.donusumYon || "yok";
    document.getElementById("donusumMiktar").value = String(g.donusumMiktar || 0);
    document.getElementById("donusumKur").value = preserveRawText(g.donusumKur || "1") || "1";
  } else {
    if (baslik) baslik.textContent = "Yatırımlar Giriş / Çıkış & Dönüşüm";
    if (btnKaydet) btnKaydet.textContent = "Uygula ve Kaydet";
    form?.reset();
    document.getElementById("donusumKur").value = "1";
  }

  renderMaasAndYatirimPanel();
  hesaplaYatirimForm();
  if (ym) ym.style.display = "flex";
}

function renderMaasAndYatirimPanel() {
  const body = document.getElementById("maasExcelBody");
  const foot = document.getElementById("maasExcelFoot");
  if (body && foot) {
    if (!maasKayitlari.length) {
      body.innerHTML = `<tr><td colspan="11" class="item-meta">Henüz maaş kaydı yok. "+ Yeni Maaş" butonundan ekleyebilirsiniz.</td></tr>`;
      foot.innerHTML = "";
    } else {
      let tSgk = 0, tCeza = 0, tYatan = 0, tEk = 0, tElden = 0, tHak = 0, tMaas = 0, tNakit = 0;
      body.innerHTML = maasKayitlari
        .map((r, idx) => {
          tSgk += Number(parseMoneyInput(r.sgk)) || 0;
          tCeza += Number(parseMoneyInput(r.ceza)) || 0;
          tYatan += Number(parseMoneyInput(r.yatan)) || 0;
          tEk += Number(parseMoneyInput(r.ek)) || 0;
          tElden += Number(parseMoneyInput(r.elden)) || 0;
          tHak += Number(parseMoneyInput(r.hakedis)) || 0;
          tMaas += Number(parseMoneyInput(r.maas)) || 0;
          tNakit += Number(parseMoneyInput(r.nakit)) || 0;
          const kurGosterim = preserveRawText(r.kurRaw ?? r.kur ?? "0") || "0";
          return `
            <tr>
              <td>${escapeHtml(r.donem || "-")}</td>
              <td style="text-align:right;">${fmtNum(r.sgk)}</td>
              <td style="text-align:right;">${fmtNum(r.ceza)}</td>
              <td style="text-align:right;">${fmtNum(r.yatan)}</td>
              <td style="text-align:right;">${fmtNum(r.ek)}</td>
              <td style="text-align:right;">${fmtNum(r.elden)}</td>
              <td style="text-align:right;"><strong>${fmtNum(r.hakedis)}</strong></td>
              <td style="text-align:right;"><strong>${fmtNum(r.maas)}</strong></td>
              <td style="text-align:right;">${escapeHtml(kurGosterim)}</td>
              <td style="text-align:right;"><strong>${fmtNum(r.nakit)}</strong></td>
              <td style="text-align:center; white-space:nowrap;">
                <button type="button" class="edit-btn" data-edit-maas-idx="${idx}">Güncelle</button>
                <button type="button" class="del-btn" data-delete-maas-idx="${idx}">Sil</button>
              </td>
            </tr>
          `;
        })
        .join("");
      foot.innerHTML = `
        <tr class="summary-row">
          <td>TOPLAM</td>
          <td style="text-align:right;">${fmtNum(tSgk)}</td>
          <td style="text-align:right;">${fmtNum(tCeza)}</td>
          <td style="text-align:right;">${fmtNum(tYatan)}</td>
          <td style="text-align:right;">${fmtNum(tEk)}</td>
          <td style="text-align:right;">${fmtNum(tElden)}</td>
          <td style="text-align:right;">${fmtNum(tHak)}</td>
          <td style="text-align:right;">${fmtNum(tMaas)}</td>
          <td>-</td>
          <td style="text-align:right;">${fmtNum(tNakit)}</td>
          <td></td>
        </tr>
      `;
    }
  }

  const y = yatirimDurumu;
  const kurlar = y.kurlar || {};
  const keys = ["dolar", "euro", "nakit", "altin", "diger"];
  let toplamTlYatirim = 0;

  for (const key of keys) {
    const val = Number(y[key]) || 0;
    const kurStr = preserveRawText(kurlar[key]);
    const kurNum = Number(parseMoneyInput(kurStr));
    const hasKur = kurStr !== "" && !Number.isNaN(kurNum) && kurNum > 0;
    const tlVal = hasKur ? val * kurNum : (key === "nakit" ? val : 0);
    if (hasKur || key === "nakit") {
      toplamTlYatirim += tlVal;
    }

    const degerEl = document.getElementById(`ozet${key.charAt(0).toUpperCase() + key.slice(1)}Deger`);
    const tlEl = document.getElementById(`ozet${key.charAt(0).toUpperCase() + key.slice(1)}Tl`);
    const inputEl = document.querySelector(`.yat-kur-girdi[data-kur-key="${key}"]`);

    if (degerEl) degerEl.textContent = fmtNum(val);
    if (tlEl) tlEl.textContent = hasKur ? `(${fmtNum(tlVal)} TL)` : "";
    if (inputEl && document.activeElement !== inputEl) {
      inputEl.value = kurStr;
    }
  }

  const toplamTlEl = document.getElementById("yatirimToplamTlSerit");
  if (toplamTlEl) {
    toplamTlEl.textContent = `Toplam TL Yatırım: ${fmtNum(toplamTlYatirim)} TL`;
  }

  const modalOzetEl = document.getElementById("modalYatirimMevcut");
  if (modalOzetEl) {
    modalOzetEl.innerHTML = `
      <span>Dolar ($): <strong>${fmtNum(y.dolar)}</strong></span>
      <span>Euro (€): <strong>${fmtNum(y.euro)}</strong></span>
      <span>Nakit (₺): <strong>${fmtNum(y.nakit)}</strong></span>
      <span>Altın (gr): <strong>${fmtNum(y.altin)}</strong></span>
      <span>Diğer: <strong>${fmtNum(y.diger)}</strong></span>
      <span>Toplam TL Yatırım: <strong>${fmtNum(toplamTlYatirim)} TL</strong></span>
    `;
  }

  const detayIcerik = document.getElementById("yatirimDetayIcerik");
  const toggleBtn = document.getElementById("btnYatirimDetayToggle");
  if (detayIcerik) detayIcerik.style.display = y.acik ? "block" : "none";
  if (toggleBtn) toggleBtn.textContent = y.acik ? "Kapat" : "Aç";

  const gecmisBody = document.getElementById("yatirimGecmisBody");
  if (gecmisBody) {
    gecmisBody.innerHTML = yatirimGecmis.length
      ? yatirimGecmis
          .map(
            (g, idx) => `
            <tr>
              <td>${escapeHtml(g.tarih)}</td>
              <td>${escapeHtml(g.islem)}</td>
              <td>${escapeHtml(g.detay)}</td>
              <td style="text-align:right;">${fmtNum(g.dolar)}</td>
              <td style="text-align:right;">${fmtNum(g.euro)}</td>
              <td style="text-align:right;">${fmtNum(g.nakit)}</td>
              <td style="text-align:right;">${fmtNum(g.altin)}</td>
              <td style="text-align:right;">${fmtNum(g.diger)}</td>
              <td style="text-align:center; white-space:nowrap;">
                <button type="button" class="edit-btn" data-edit-yatirim-idx="${idx}">Düzelt</button>
                <button type="button" class="del-btn" data-delete-yatirim-idx="${idx}">Sil</button>
              </td>
            </tr>
          `
          )
          .join("")
      : `<tr><td colspan="9" class="item-meta">Henüz yatırım kaydı yok.</td></tr>`;
  }
}

function hesaplaYatirimForm() {
  const isaret = document.getElementById("yatIslemTipi")?.value === "cikis" ? -1 : 1;
  const d = Number(parseMoneyInput(document.getElementById("yatDolar")?.value)) || 0;
  const e = Number(parseMoneyInput(document.getElementById("yatEuro")?.value)) || 0;
  const n = Number(parseMoneyInput(document.getElementById("yatNakit")?.value)) || 0;
  const a = Number(parseMoneyInput(document.getElementById("yatAltin")?.value)) || 0;
  const di = Number(parseMoneyInput(document.getElementById("yatDiger")?.value)) || 0;

  const yon = document.getElementById("donusumYon")?.value || "yok";
  const donMiktar = Number(parseMoneyInput(document.getElementById("donusumMiktar")?.value)) || 0;
  const donKurRaw = preserveRawText(document.getElementById("donusumKur")?.value) || "1";
  const donKur = Number(parseMoneyInput(donKurRaw)) || 0;

  let donSonuc = 0;
  let dNet = isaret * d;
  let eNet = isaret * e;
  let nNet = isaret * n;
  let aNet = isaret * a;
  let diNet = isaret * di;

  if (yon === "usd_to_nakit" && donMiktar > 0 && donKur > 0) {
    donSonuc = donMiktar * donKur;
    dNet -= donMiktar;
    nNet += donSonuc;
  } else if (yon === "nakit_to_altin" && donMiktar > 0 && donKur > 0) {
    donSonuc = donMiktar / donKur;
    nNet -= donMiktar;
    aNet += donSonuc;
  }

  const elSonuc = document.getElementById("donusumSonuc");
  if (elSonuc) elSonuc.value = yon === "yok" ? "-" : fmtNum(donSonuc, 4);

  return { isaret, yon, donMiktar, donKurRaw, donKur, donSonuc, dNet, eNet, nNet, aNet, diNet };
}

function updateRowValueFromDom(tr, shouldRerender = true, preserveAmount = false) {
  const selectedPeriod = periodSelect.value || getCurrentMonthValue();
  const pData = getPeriodData(selectedPeriod);

  if (tr.classList.contains("child-row")) {
    const subOvKey = tr.dataset.subOvKey;
    if (!subOvKey) return;
    const prev = pData.subOverrides[subOvKey] || {};
    const noteEl = tr.querySelector(".field-sub-note");
    const amtEl = tr.querySelector(".field-sub-amount");
    const dueEl = tr.querySelector(".field-sub-due");
    const paidEl = tr.querySelector(".field-sub-paid");

    const nextAmount = preserveAmount
      ? (prev.amount ?? "")
      : (amtEl ? (amtEl.dataset.rawAmount !== undefined ? amtEl.dataset.rawAmount : amtEl.value) : (prev.amount ?? ""));

    pData.subOverrides[subOvKey] = {
      note: noteEl ? noteEl.value : prev.note ?? "",
      amount: nextAmount,
      dueDate: dueEl ? dueEl.value : prev.dueDate ?? "",
      paid: paidEl ? paidEl.checked : Boolean(prev.paid)
    };
    saveAllLocalState();
    if (shouldRerender) renderPeriodTables();
    return;
  }

  const key = tr.dataset.key;
  if (!key) return;
  const prev = pData.overrides[key] || {};
  const noteEl = tr.querySelector(".field-note");
  const amountEl = tr.querySelector(".field-amount");
  const dueEl = tr.querySelector(".field-due");
  const paidEl = tr.querySelector(".field-paid");

  const nextAmount = preserveAmount
    ? (prev.amount ?? "")
    : (amountEl ? (amountEl.dataset.rawAmount !== undefined ? amountEl.dataset.rawAmount : amountEl.value) : (prev.amount ?? ""));

  pData.overrides[key] = {
    note: noteEl ? noteEl.value : prev.note ?? "",
    amount: nextAmount,
    dueDate: dueEl ? dueEl.value : prev.dueDate ?? "",
    paid: paidEl ? paidEl.checked : Boolean(prev.paid)
  };
  saveAllLocalState();
  if (shouldRerender) renderPeriodTables();
}

function togglePanel(panelId) {
  closeReportsView();
  const isSameOpen = activePanelId === panelId;
  activePanelId = isSameOpen ? null : panelId;

  drawerCards.forEach((card) => {
    card.classList.toggle("open", card.id === activePanelId);
  });

  topButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.panel === activePanelId);
  });

  if (activePanelId === "panel-notlar") {
    renderNotesPanel();
  } else if (activePanelId === "panel-maas") {
    renderMaasAndYatirimPanel();
    renderBorclarPanel();
  }
}

function closeAllPanels() {
  activePanelId = null;
  drawerCards.forEach((card) => card.classList.remove("open"));
  topButtons.forEach((btn) => btn.classList.remove("active"));
}

function initPeriodMonth() {
  const savedPeriod = localStorage.getItem(STORAGE_PERIOD_KEY);
  renderPeriodDropdown(savedPeriod);

  periodSelect.addEventListener("change", () => {
    if (!periodSelect.value) return;
    localStorage.setItem(STORAGE_PERIOD_KEY, periodSelect.value);
    if (!editingKalemId) {
      kalemTargetPeriod.value = periodSelect.value;
    }
    renderPeriodTables();
    renderNotesPanel();
  });

  btnNewMonth.addEventListener("click", handleCreateNewMonth);
  btnDeleteMonth.addEventListener("click", handleDeleteSelectedMonth);
}

function syncNotifyButtonState() {
  if (!btnEnableNotify) return;
  if (typeof Notification === "undefined") {
    btnEnableNotify.style.display = "none";
    return;
  }
  if (Notification.permission === "granted") {
    btnEnableNotify.textContent = "Bildirimler Açık";
    btnEnableNotify.classList.add("active");
  } else {
    btnEnableNotify.textContent = "Bildirim İzni";
    btnEnableNotify.classList.remove("active");
  }
}

function initPwaFeatures() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (btnInstallApp) btnInstallApp.style.display = "inline-block";
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (btnInstallApp) btnInstallApp.style.display = "none";
  });

  if (btnInstallApp) {
    btnInstallApp.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => {});
      deferredInstallPrompt = null;
      btnInstallApp.style.display = "none";
    });
  }

  syncNotifyButtonState();
  if (btnEnableNotify) {
    btnEnableNotify.addEventListener("click", async () => {
      await requestNotificationPermissionManual();
      syncNotifyButtonState();
    });
  }
}

function connectGoogleDrive(forceConsent = false) {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      if (driveStatus) driveStatus.textContent = "Drive: Auth servisi yüklenmedi";
      reject(new Error("Auth servisi yüklenmedi"));
      return;
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (response) => {
        if (response.error) {
          if (driveStatus) driveStatus.textContent = `Drive: Hata (${response.error})`;
          reject(new Error(response.error));
          return;
        }
        accessToken = response.access_token;
        if (driveStatus) driveStatus.textContent = "Drive: Bağlandı";
        resolve(accessToken);
      }
    });

    tokenClient.requestAccessToken({ prompt: forceConsent || !accessToken ? "consent" : "" });
  });
}

async function driveFetch(url, options = {}) {
  const token = accessToken || (await connectGoogleDrive(false));
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Drive API (${res.status}): ${await res.text()}`);
  return res;
}

async function ensureDriveFolder() {
  if (folderId) return folderId;
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const res = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`);
  const data = await res.json();
  if (data.files?.length) {
    folderId = data.files[0].id;
    return folderId;
  }
  const createRes = await driveFetch(`${DRIVE_API}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
  });
  const created = await createRes.json();
  folderId = created.id;
  return folderId;
}

async function loadRemoteStateIfExists() {
  const fId = await ensureDriveFolder();
  const q = encodeURIComponent(
    `name='${STATE_FILE_NAME}' and '${fId}' in parents and trashed=false`
  );
  const res = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`);
  const data = await res.json();
  const found = data.files?.[0];
  if (!found) return;

  stateFileId = found.id;
  const mediaRes = await driveFetch(`${DRIVE_API}/files/${stateFileId}?alt=media`);
  const remote = await mediaRes.json();

  if (Array.isArray(remote.items) && remote.items.length) {
    kalemler = normalizeKalemList(remote.items);
    localStorage.setItem(STORAGE_KALEM_KEY, JSON.stringify(kalemler));
  }
  if (remote.periodEntries && Object.keys(remote.periodEntries).length) {
    periodEntriesMap = remote.periodEntries;
    localStorage.setItem(STORAGE_PERIOD_DATA_KEY, JSON.stringify(periodEntriesMap));
  }
  if (Array.isArray(remote.creditCards) && remote.creditCards.length) {
    creditCards = remote.creditCards;
    localStorage.setItem(STORAGE_CARDS_KEY, JSON.stringify(creditCards));
  }
  if (Array.isArray(remote.ccItems) && remote.ccItems.length) {
    ccItems = remote.ccItems;
    localStorage.setItem(STORAGE_CC_ITEMS_KEY, JSON.stringify(ccItems));
  }
  if (Array.isArray(remote.maasKayitlari)) {
    maasKayitlari = remote.maasKayitlari;
    localStorage.setItem(STORAGE_MAAS_KEY, JSON.stringify(maasKayitlari));
  }
  if (remote.yatirimDurumu && typeof remote.yatirimDurumu === "object") {
    yatirimDurumu = normalizeYatirimDurumu(remote.yatirimDurumu);
    localStorage.setItem(STORAGE_YATIRIM_KEY, JSON.stringify(yatirimDurumu));
  }
  if (Array.isArray(remote.yatirimGecmis)) {
    yatirimGecmis = remote.yatirimGecmis;
    localStorage.setItem(STORAGE_YATIRIM_GECMIS_KEY, JSON.stringify(yatirimGecmis));
  }
  if (Array.isArray(remote.borclarListesi)) {
    borclarListesi = remote.borclarListesi;
    localStorage.setItem(STORAGE_BORCLAR_KEY, JSON.stringify(borclarListesi));
  }
  if (Array.isArray(remote.notes) || Array.isArray(remote.noteGroups) || Array.isArray(remote.infoNotes)) {
    setNotesData(remote.notes || [], remote.noteGroups || null, remote.infoNotes || null);
  }

  registeredPeriods = normalizeRegisteredPeriods(remote.registeredPeriods, periodEntriesMap, periodSelect.value);
  localStorage.setItem(STORAGE_REGISTERED_PERIODS_KEY, JSON.stringify(registeredPeriods));

  renderPeriodDropdown(periodSelect.value);
  renderMasterList();
  renderPeriodTables();
}

async function syncAllToDrive() {
  if (!accessToken) {
    if (driveStatus) driveStatus.textContent = "Drive: Otomatik kayıt için Drive Bağlan'a basın";
    return;
  }

  if (driveStatus) driveStatus.textContent = "Drive: Otomatik kaydediliyor...";
  const fId = await ensureDriveFolder();

  if (!stateFileId) {
    const q = encodeURIComponent(
      `name='${STATE_FILE_NAME}' and '${fId}' in parents and trashed=false`
    );
    const res = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`);
    const data = await res.json();
    stateFileId = data.files?.[0]?.id || null;
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    registeredPeriods,
    items: kalemler,
    periodEntries: periodEntriesMap,
    creditCards,
    ccItems,
    maasKayitlari,
    yatirimDurumu,
    yatirimGecmis,
    borclarListesi,
    notes: getNotesData(),
    noteGroups: getNoteGroupsData(),
    infoNotes: getInfoNotesData()
  };

  const metadata = stateFileId
    ? { name: STATE_FILE_NAME, mimeType: "application/json" }
    : { name: STATE_FILE_NAME, mimeType: "application/json", parents: [fId] };

  const boundary = "-------314159265358979323846";
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload, null, 2)}\r\n` +
    `--${boundary}--`;

  const url = stateFileId
    ? `${UPLOAD_API}/files/${stateFileId}?uploadType=multipart`
    : `${UPLOAD_API}/files?uploadType=multipart`;
  const method = stateFileId ? "PATCH" : "POST";

  const saveRes = await driveFetch(url, {
    method,
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  const saved = await saveRes.json();
  stateFileId = saved.id;

  const nowTime = new Date().toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  if (driveStatus) driveStatus.textContent = `Drive: Otomatik kaydedildi (${nowTime})`;
}

function scheduleAutoDriveSync() {
  if (!accessToken) return;
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  if (driveStatus) driveStatus.textContent = "Drive: Kaydedilecek...";
  autoSyncTimer = setTimeout(() => {
    syncAllToDrive().catch((err) => {
      if (driveStatus) driveStatus.textContent = `Drive: Kayıt hatası (${err.message})`;
    });
  }, 800);
}

// --- Olay Dinleyicileri ---
kalemMode.addEventListener("change", () => {
  kalemInstallments.style.display = kalemMode.value === "installment" ? "block" : "none";
  if (kalemMode.value !== "installment") kalemInstallments.value = "";
});

btnAddDraftSub.addEventListener("click", () => {
  syncDraftFromDom();
  draftSubItems.push({ subId: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: "", fixedAmount: "" });
  renderDraftSubList();
});

draftSubList.addEventListener("click", (e) => {
  const idxAttr = e.target.dataset.removeDraftIdx;
  if (idxAttr === undefined) return;
  syncDraftFromDom();
  draftSubItems.splice(Number(idxAttr), 1);
  renderDraftSubList();
});

btnCancelKalemEdit.addEventListener("click", resetKalemForm);

kalemForm.addEventListener("submit", (e) => {
  e.preventDefault();
  syncDraftFromDom();

  const name = kalemName.value.trim();
  const rawAmt = kalemAmount.value.trim();
  const defaultAmount = rawAmt === "" ? null : parseMoneyInput(rawAmt);
  const flow = kalemFlow.value;
  const mode = kalemMode.value;
  const installments = mode === "installment" ? Math.max(1, Number(kalemInstallments.value) || 1) : null;
  const startPeriod = kalemTargetPeriod.value || periodSelect.value || getCurrentMonthValue();

  const cleanedSubItems = draftSubItems
    .map((s) => ({ subId: s.subId, name: s.name.trim(), fixedAmount: s.fixedAmount.trim() }))
    .filter((s) => s.name !== "" || s.fixedAmount !== "");

  if (!name || (defaultAmount !== null && Number.isNaN(defaultAmount))) return;

  if (editingKalemId) {
    const idx = kalemler.findIndex((k) => k.id === editingKalemId);
    if (idx !== -1) {
      kalemler[idx] = { ...kalemler[idx], flow, name, defaultAmount, mode, installments, startPeriod, subItems: cleanedSubItems };
    }
    resetKalemForm();
  } else {
    kalemler.push({ id: `klm_${Date.now()}`, flow, name, defaultAmount, mode, installments, startPeriod, subItems: cleanedSubItems });
    kalemName.value = "";
    kalemAmount.value = "";
    kalemInstallments.value = "";
    draftSubItems = [];
    renderDraftSubList();
  }

  saveAllLocalState();
  renderMasterList();
  renderPeriodTables();
});

kalemMasterList.addEventListener("click", (e) => {
  const editId = e.target.dataset.editKalemId;
  if (editId) {
    startEditingKalem(editId);
    return;
  }
  const delId = e.target.dataset.deleteKalemId;
  if (!delId) return;
  if (editingKalemId === delId) resetKalemForm();
  kalemler = kalemler.filter((item) => item.id !== delId);
  creditCards = creditCards.map((c) => (c.linkedKalemId === delId ? { ...c, linkedKalemId: "" } : c));
  saveAllLocalState();
  renderMasterList();
  renderPeriodTables();
});

btnAddCard.addEventListener("click", () => {
  const bankName = newCardBankInput.value.trim();
  if (!bankName) return;
  const newCard = { id: `cc_${Date.now()}`, bankName, linkedKalemId: kalemler[0]?.id || "" };
  creditCards.push(newCard);
  newCardBankInput.value = "";
  saveAllLocalState();
  renderPeriodTables();
  ccSelect.value = newCard.id;
  renderCreditCardPanel();
});

ccSelect.addEventListener("change", renderCreditCardPanel);

btnDeleteCard.addEventListener("click", () => {
  const cardId = ccSelect.value;
  if (!cardId) return;
  creditCards = creditCards.filter((c) => c.id !== cardId);
  ccItems = ccItems.filter((item) => item.cardId !== cardId);
  saveAllLocalState();
  renderPeriodTables();
});

ccTargetKalemSelect.addEventListener("change", () => {
  const card = creditCards.find((c) => c.id === ccSelect.value);
  if (!card) return;
  card.linkedKalemId = ccTargetKalemSelect.value || "";
  saveAllLocalState();
  renderPeriodTables();
});

ccExpenseForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const cardId = ccSelect.value;
  if (!cardId) {
    alert("Önce bir banka/kart ekleyin.");
    return;
  }
  const desc = ccExpDesc.value.trim();
  const totalAmount = parseMoneyInput(ccExpAmount.value);
  const installments = Math.max(1, Number(ccExpInstallments.value) || 1);
  const dateVal = ccExpDate.value || getTodayDateValue();
  const startPeriod = dateVal && dateVal.length >= 7 ? dateVal.slice(0, 7) : periodSelect.value || getCurrentMonthValue();
  if (!desc || Number.isNaN(totalAmount)) return;

  ccItems.push({ id: `ccitem_${Date.now()}`, cardId, desc, totalAmount, installments, startPeriod, date: dateVal });
  ccExpDesc.value = "";
  ccExpAmount.value = "";
  ccExpInstallments.value = "1";
  saveAllLocalState();
  renderPeriodTables();
});

ccExpenseTableBody.addEventListener("click", (e) => {
  const itemId = e.target.dataset.deleteCcItem;
  if (!itemId) return;
  ccItems = ccItems.filter((x) => x.id !== itemId);
  saveAllLocalState();
  renderPeriodTables();
});

function isAmountInput(el) {
  return el?.classList?.contains("field-amount") || el?.classList?.contains("field-sub-amount");
}

function handleTableInputFocus(e) {
  if (!isAmountInput(e.target)) return;
  const raw = e.target.dataset.rawAmount ?? e.target.value;
  e.target.value = preserveRawText(raw);
}

function handleTableInputChange(e) {
  const tr = e.target.closest("tr");
  if (!tr) return;
  if (isAmountInput(e.target)) {
    const rawVal = preserveRawText(e.target.value);
    e.target.dataset.rawAmount = rawVal;
    e.target.value = formatDisplayAmountInput(rawVal);
  }
  const isPaidCheckbox = e.target.classList.contains("field-paid") || e.target.classList.contains("field-sub-paid");
  const isNoteField = e.target.classList.contains("field-note") || e.target.classList.contains("field-sub-note");
  updateRowValueFromDom(tr, !isNoteField, isPaidCheckbox);
}

expenseTableBody.addEventListener("focusin", handleTableInputFocus);
incomeTableBody.addEventListener("focusin", handleTableInputFocus);
expenseTableBody.addEventListener("change", handleTableInputChange);
incomeTableBody.addEventListener("change", handleTableInputChange);

document.addEventListener("click", (e) => {
  const maasLabel = e.target.closest(".maas-click-label");
  if (maasLabel) {
    e.preventDefault();
    openMaasKurModalForRow();
    return;
  }

  if (e.target.id === "btnNormalNotAc" || e.target.id === "btnNormalNotKapat") {
    const kutu = document.getElementById("normalNotFormKutu");
    if (kutu) {
      const acik = kutu.style.display === "block";
      kutu.style.display = acik ? "none" : "block";
      if (!acik) document.getElementById("noteTextInput")?.focus();
    }
    return;
  }

  if (e.target.id === "btnYeniMaasAc") {
    openMaasModal(null);
    return;
  }

  const editMaasIdx = e.target.dataset?.editMaasIdx;
  if (editMaasIdx !== undefined) {
    openMaasModal(Number(editMaasIdx));
    return;
  }

  if (e.target.id === "btnCloseMaasModal" || e.target.id === "btnCancelMaasModal") {
    editingMaasIdx = null;
    const modal = document.getElementById("maasModal");
    if (modal) modal.style.display = "none";
    return;
  }

  if (e.target.id === "btnYatirimlarAc") {
    openYatirimModal(null);
    return;
  }

  const editYatIdx = e.target.dataset?.editYatirimIdx;
  if (editYatIdx !== undefined) {
    openYatirimModal(Number(editYatIdx));
    return;
  }

  const delYatIdx = e.target.dataset?.deleteYatirimIdx;
  if (delYatIdx !== undefined) {
    yatirimGecmis.splice(Number(delYatIdx), 1);
    recalculateYatirimFromHistory();
    saveAllLocalState();
    renderMaasAndYatirimPanel();
    return;
  }

  if (e.target.id === "btnCloseYatirimModal" || e.target.id === "btnCancelYatirimModal") {
    editingYatirimIdx = null;
    const ym = document.getElementById("yatirimModal");
    if (ym) ym.style.display = "none";
    return;
  }

  if (e.target.id === "btnYatirimDetayToggle") {
    yatirimDurumu.acik = yatirimDurumu.acik === false;
    saveAllLocalState();
    renderMaasAndYatirimPanel();
    return;
  }

  if (e.target.id === "btnBorclarAc") {
    openBorcModal(null);
    return;
  }

  if (e.target.id === "btnCloseBorcModal" || e.target.id === "btnCancelBorcModal") {
    editingBorcIdx = null;
    const bm = document.getElementById("borcModal");
    if (bm) bm.style.display = "none";
    return;
  }

  const editBorcIdx = e.target.dataset?.editBorcIdx;
  if (editBorcIdx !== undefined) {
    openBorcModal(Number(editBorcIdx));
    return;
  }

  const delBorcIdx = e.target.dataset?.deleteBorcIdx;
  if (delBorcIdx !== undefined) {
    borclarListesi.splice(Number(delBorcIdx), 1);
    saveAllLocalState();
    renderBorclarPanel();
    return;
  }

  if (e.target.closest("#anaBorclarBaslik")) {
    anaBorclarAcik = !anaBorclarAcik;
    renderBorclarPanel();
    return;
  }

  if (e.target.id === "btnBilgiNotlariAc") {
    const bolum = document.getElementById("bilgiNotlariBolum");
    if (bolum) bolum.style.display = bolum.style.display === "none" ? "block" : "none";
    return;
  }

  if (e.target.id === "btnBilgiNotlariKapat") {
    const bolum = document.getElementById("bilgiNotlariBolum");
    if (bolum) bolum.style.display = "none";
    return;
  }

  const editBnIdx = e.target.dataset?.editBnIdx;
  if (editBnIdx !== undefined) {
    const idx = Number(editBnIdx);
    const list = getInfoNotesData();
    if (list[idx]) {
      editingBnIdx = idx;
      document.getElementById("bnNotInput").value = list[idx].not || "";
      document.getElementById("bnKategoriInput").value = list[idx].kategori || "";
      document.getElementById("bnTarihInput").value = list[idx].tarih || "";
      document.getElementById("btnBnKaydet").textContent = "Bilgi Notunu Güncelle";
      document.getElementById("btnBnIptal").style.display = "inline-block";
    }
    return;
  }

  if (e.target.id === "btnBnIptal") {
    editingBnIdx = null;
    document.getElementById("bilgiNotForm")?.reset();
    document.getElementById("btnBnKaydet").textContent = "Bilgi Notu Ekle";
    document.getElementById("btnBnIptal").style.display = "none";
    return;
  }

  const delBnIdx = e.target.dataset?.deleteBnIdx;
  if (delBnIdx !== undefined) {
    deleteInfoNote(Number(delBnIdx));
    return;
  }

  if (e.target.id === "btnCloseMaasKurModal" || e.target.id === "btnCancelMaasKurModal") {
    const km = document.getElementById("maasKurModal");
    if (km) km.style.display = "none";
    return;
  }

  const delMaasIdx = e.target.dataset?.deleteMaasIdx;
  if (delMaasIdx !== undefined) {
    maasKayitlari.splice(Number(delMaasIdx), 1);
    saveAllLocalState();
    renderMaasAndYatirimPanel();
  }
});

document.addEventListener("input", (e) => {
  const id = e.target?.id || "";
  if (["maasSgk", "maasCeza", "maasYatan", "maasEk", "maasElden", "maasKur"].includes(id)) {
    hesaplaMaasForm();
  }

  if (["yatDolar", "yatEuro", "yatNakit", "yatAltin", "yatDiger", "donusumMiktar", "donusumKur"].includes(id)) {
    hesaplaYatirimForm();
  }

  if (e.target?.classList?.contains("yat-kur-girdi")) {
    const kurKey = e.target.dataset.kurKey;
    if (kurKey) {
      if (!yatirimDurumu.kurlar) yatirimDurumu.kurlar = {};
      yatirimDurumu.kurlar[kurKey] = preserveRawText(e.target.value);
      saveAllLocalState();
      renderMaasAndYatirimPanel();
    }
  }

  if (id === "mkKur" || id === "mkIslemDolar") {
    hesaplaMaasKurTutar();
  }
});

document.addEventListener("change", (e) => {
  const id = e.target?.id || "";
  if (["yatIslemTipi", "donusumYon"].includes(id)) {
    hesaplaYatirimForm();
  }
});

document.addEventListener("submit", (e) => {
  const formId = e.target?.id || "";

  if (formId === "borcForm") {
    e.preventDefault();
    const kime = document.getElementById("borcKime")?.value.trim() || "";
    const miktarRaw = document.getElementById("borcMiktar")?.value.trim() || "";
    const miktarNum = Number(parseMoneyInput(miktarRaw));
    const cins = document.getElementById("borcCins")?.value.trim() || "TL";
    const aciklama = document.getElementById("borcAciklama")?.value.trim() || "";

    if (!kime || Number.isNaN(miktarNum)) return;

    const kayit = { kime, miktar: miktarNum, miktarRaw, cins, aciklama };
    if (editingBorcIdx !== null && borclarListesi[editingBorcIdx]) {
      borclarListesi[editingBorcIdx] = kayit;
    } else {
      borclarListesi.push(kayit);
    }

    editingBorcIdx = null;
    saveAllLocalState();
    renderBorclarPanel();
    const bm = document.getElementById("borcModal");
    if (bm) bm.style.display = "none";
    e.target.reset();
  }

  if (formId === "bilgiNotForm") {
    e.preventDefault();
    const not = document.getElementById("bnNotInput")?.value.trim() || "";
    const kategori = document.getElementById("bnKategoriInput")?.value.trim() || "Genel";
    const tarih = document.getElementById("bnTarihInput")?.value || "";
    if (!not) return;

    addOrUpdateInfoNote({ not, kategori, tarih }, editingBnIdx);
    editingBnIdx = null;
    e.target.reset();
    document.getElementById("btnBnKaydet").textContent = "Bilgi Notu Ekle";
    document.getElementById("btnBnIptal").style.display = "none";
  }

  if (formId === "maasForm") {
    e.preventDefault();
    const { sgk, ceza, yatan, ek, elden, kurRaw, kur, hakedis, maas, nakit } = hesaplaMaasForm();
    const donem = document.getElementById("maasDonem")?.value || "";
    const kayit = { donem, sgk, ceza, yatan, ek, elden, hakedis, maas, kur, kurRaw, nakit };

    if (editingMaasIdx !== null && maasKayitlari[editingMaasIdx]) {
      maasKayitlari[editingMaasIdx] = kayit;
    } else {
      maasKayitlari.push(kayit);
    }

    editingMaasIdx = null;
    saveAllLocalState();
    renderMaasAndYatirimPanel();

    const modal = document.getElementById("maasModal");
    if (modal) modal.style.display = "none";
    e.target.reset();
    if (document.getElementById("maasKur")) document.getElementById("maasKur").value = "1";
  }

  if (formId === "yatirimForm") {
    e.preventDefault();
    const hesap = hesaplaYatirimForm();
    const satir = {
      tarih: editingYatirimIdx !== null && yatirimGecmis[editingYatirimIdx]
        ? yatirimGecmis[editingYatirimIdx].tarih
        : new Date().toLocaleString("tr-TR"),
      islem: hesap.isaret < 0 ? "Yatırım Çıkışı" : "Yatırım Girişi",
      detay:
        hesap.yon === "usd_to_nakit"
          ? `$${fmtNum(hesap.donMiktar)} → ₺${fmtNum(hesap.donSonuc)} (Kur: ${hesap.donKurRaw})`
          : hesap.yon === "nakit_to_altin"
          ? `₺${fmtNum(hesap.donMiktar)} → ${fmtNum(hesap.donSonuc, 4)} gr Altın (Kur: ${hesap.donKurRaw})`
          : "Yatırım Kaydı",
      dolar: hesap.dNet,
      euro: hesap.eNet,
      nakit: hesap.nNet,
      altin: hesap.aNet,
      diger: hesap.diNet,
      donusumYon: hesap.yon,
      donusumMiktar: hesap.donMiktar,
      donusumKur: hesap.donKurRaw
    };

    if (editingYatirimIdx !== null && yatirimGecmis[editingYatirimIdx]) {
      yatirimGecmis[editingYatirimIdx] = satir;
    } else {
      yatirimGecmis.push(satir);
    }

    editingYatirimIdx = null;
    recalculateYatirimFromHistory();
    saveAllLocalState();
    renderMaasAndYatirimPanel();

    const ym = document.getElementById("yatirimModal");
    if (ym) ym.style.display = "none";
    e.target.reset();
  }

  if (formId === "maasKurForm") {
    e.preventDefault();
    const { kur, islemDolar, tutar } = hesaplaMaasKurTutar();
    if (kur <= 0 || islemDolar <= 0 || tutar <= 0) return;

    yatirimGecmis.push({
      tarih: new Date().toLocaleString("tr-TR"),
      islem: "Maaş Dolar Bozumu",
      detay: `$${fmtNum(islemDolar)} × ${preserveRawText(document.getElementById("mkKur")?.value)} = ${fmtNum(tutar)} maaşa eklendi`,
      dolar: -islemDolar,
      euro: 0,
      nakit: 0,
      altin: 0,
      diger: 0
    });
    recalculateYatirimFromHistory();

    const activePeriod = periodSelect.value || getCurrentMonthValue();
    const pData = getPeriodData(activePeriod);
    const maasKalem = kalemler.find((k) => /^maaş$/i.test(String(k.name || "").trim()));
    if (maasKalem) {
      const flow = maasKalem.flow === "expense" ? "expense" : "income";
      const key = `${maasKalem.id}__${flow}`;
      const prevOv = pData.overrides[key] || {};
      const mevcut = Number(parseMoneyInput(prevOv.amount ?? maasKalem.defaultAmount)) || 0;
      const yeniTutar = mevcut + tutar;
      pData.overrides[key] = { ...prevOv, amount: String(yeniTutar) };
    }

    saveAllLocalState();
    renderPeriodTables();
    const km = document.getElementById("maasKurModal");
    if (km) km.style.display = "none";
  }
});

topButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    togglePanel(btn.dataset.panel);
  });
});

closeButtons.forEach((btn) => {
  btn.addEventListener("click", closeAllPanels);
});

if (btnDriveConnect) {
  btnDriveConnect.addEventListener("click", async () => {
    try {
      await connectGoogleDrive(true);
      await loadRemoteStateIfExists();
      await syncAllToDrive();
    } catch (err) {
      if (driveStatus) driveStatus.textContent = `Drive: Hata (${err.message})`;
    }
  });
}

if (btnDriveSync) {
  btnDriveSync.addEventListener("click", () => {
    syncAllToDrive().catch((err) => {
      if (driveStatus) driveStatus.textContent = `Drive: Hata (${err.message})`;
    });
  });
}

initPwaFeatures();
if (ccExpDate) ccExpDate.value = getTodayDateValue();
loadStateFromStorage();
initPeriodMonth();
initNotesModule({
  getActivePeriod: () => periodSelect.value || "",
  getRegisteredPeriods: () => registeredPeriods,
  onNotesChange: () => scheduleAutoDriveSync()
});
initReportsModule({
  getReportData: () => ({
    registeredPeriods,
    kalemler,
    periodEntriesMap,
    creditCards,
    ccItems,
    maasKayitlari,
    yatirimDurumu,
    yatirimGecmis,
    borclarListesi,
    notes: getNotesData(),
    infoNotes: getInfoNotesData()
  }),
  onReportsOpen: () => {
    closeAllPanels();
  }
});
renderDraftSubList();
renderMasterList();
renderPeriodTables();