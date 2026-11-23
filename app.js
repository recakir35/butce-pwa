import {
  initNotesModule,
  renderNotesPanel,
  getNotesData,
  getNoteGroupsData,
  setNotesData,
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

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

let accessToken = null;
let folderId = null;
let stateFileId = null;
let activePanelId = null;
let autoSyncTimer = null;
let editingKalemId = null;
let deferredInstallPrompt = null;

// Kayıtlı aylar listesi: ["2026-11", "2026-12", ...]
let registeredPeriods = [];

// kalemler: [ { id, flow, name, defaultAmount, mode, installments, startPeriod, subItems: [ { subId, name, fixedAmount } ] } ]
let kalemler = [];
let periodEntriesMap = {}; // { "YYYY-MM": { overrides: { [key]: { amount, note, dueDate, paid } }, subOverrides: { [subOvKey]: { amount, note, dueDate, paid } } } }
let creditCards = [];
let ccItems = [];

// Hesap Kalemi formunda o an düzenlenen alt kalem taslakları
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

// Hesap Kalemi Form & Liste
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

// Kredi Kartları Elemanları
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

// Ana Tablolar
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
    "Ocak",
    "Şubat",
    "Mart",
    "Nisan",
    "Mayıs",
    "Haziran",
    "Temmuz",
    "Ağustos",
    "Eylül",
    "Ekim",
    "Kasım",
    "Aralık"
  ];
  const mName = monthNames[Number(m) - 1] || m;
  return `${ym} (${mName} ${y})`;
}

function formatTL(val) {
  return `${Number(val || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} TL`;
}

function formatSignedTL(val) {
  const num = Number(val || 0);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} TL`;
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

function loadStateFromStorage() {
  try {
    const curKalem = localStorage.getItem(STORAGE_KALEM_KEY);
    if (curKalem !== null) {
      kalemler = normalizeKalemList(JSON.parse(curKalem || "[]"));
    } else {
      const oldKalem =
        localStorage.getItem("butce_hesap_kalemleri_v3") ||
        localStorage.getItem("butce_hesap_kalemleri_v2") ||
        localStorage.getItem("butce_hesap_kalemleri_v1");
      const parsedOld = oldKalem ? JSON.parse(oldKalem) : [];
      const oldSubMap = JSON.parse(localStorage.getItem("butce_sub_items_by_kalem_v1") || "{}");

      kalemler = normalizeKalemList(parsedOld).map((k) => {
        if (k.subItems.length) return k;
        const collected = [];
        for (const flowKey of ["expense", "income"]) {
          const list = oldSubMap[`${k.id}__${flowKey}`];
          if (Array.isArray(list)) {
            for (const s of list) {
              const vals = Object.values(s.amountByPeriod || {});
              const lastAmt = vals.length ? vals[vals.length - 1] : "";
              collected.push({
                subId: s.subId || `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: s.name || "",
                fixedAmount: lastAmt !== "" && lastAmt !== undefined ? String(lastAmt) : ""
              });
            }
          }
        }
        return { ...k, subItems: collected };
      });
      localStorage.setItem(STORAGE_KALEM_KEY, JSON.stringify(kalemler));
    }
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
    periodEntriesMap[period] = {
      overrides: {},
      subOverrides: {}
    };
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
  const installmentAmount = totalAmt / count;

  return {
    ...ccItem,
    step,
    count,
    installmentAmount,
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
    return {
      active: true,
      metaText: item.mode === "scheduled" ? `Planlı (${startYM})` : "Sadece Seçili Ay"
    };
  }

  if (item.mode === "yearly") {
    if (selIdx < startIdx) return { active: false, metaText: "" };
    if (selM !== startM) return { active: false, metaText: "" };
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
          const fixedSubAmt =
            sub.fixedAmount !== undefined && sub.fixedAmount !== null && sub.fixedAmount !== ""
              ? String(sub.fixedAmount)
              : "";
          const n = parseFloat(fixedSubAmt);
          if (!Number.isNaN(n)) subSum += n;

          if (!pData.subOverrides[subOvKey]) {
            pData.subOverrides[subOvKey] = {
              amount: fixedSubAmt,
              note: "",
              dueDate: "",
              paid: false
            };
          }
        }

        if (!pData.overrides[key]) {
          pData.overrides[key] = {
            amount: String(subSum),
            note: "",
            dueDate: "",
            paid: false
          };
        }
      } else {
        const hasSyncedCard =
          flow === "expense" && Object.prototype.hasOwnProperty.call(syncedCardMap, item.id);
        let initialAmount = "";
        if (hasSyncedCard) {
          initialAmount = String(syncedCardMap[item.id]);
        } else if (item.defaultAmount !== null && item.defaultAmount !== undefined) {
          initialAmount = String(item.defaultAmount);
        }

        if (!pData.overrides[key]) {
          pData.overrides[key] = {
            amount: initialAmount,
            note: "",
            dueDate: "",
            paid: false
          };
        }
      }
    }
  }
}

function handleCreateNewMonth() {
  const sorted = [...registeredPeriods].sort();
  const latestYM = sorted[sorted.length - 1] || periodSelect.value || getCurrentMonthValue();
  const suggestedYM = indexToMonth(monthToIndex(latestYM) + 1);

  const inputYM = prompt(
    "Oluşturulacak yeni dönemi (YYYY-AA formatında) girin:\n(Sabit kalemler, bitmemiş taksitler ve kredi kartları otomatik aktarılacaktır)",
    suggestedYM
  );

  if (inputYM === null) return;
  const trimmed = inputYM.trim();

  if (!isValidYM(trimmed)) {
    alert("Geçersiz dönem formatı. Lütfen YYYY-AA şeklinde girin (ör. 2026-12).");
    return;
  }

  if (registeredPeriods.includes(trimmed)) {
    alert(`${trimmed} dönemi zaten kayıtlı. İlgili döneme geçiş yapılıyor.`);
    renderPeriodDropdown(trimmed);
    renderPeriodTables();
    return;
  }

  registeredPeriods.push(trimmed);
  registeredPeriods.sort();
  initializeNewMonthData(trimmed);
  saveAllLocalState();
  renderPeriodDropdown(trimmed);
  renderPeriodTables();
}

function handleDeleteSelectedMonth() {
  const targetYM = periodSelect.value;
  if (!targetYM) return;

  const firstConfirm = confirm(
    `DİKKAT: "${formatPeriodOptionLabel(targetYM)}" dönemine ait tüm gelir/gider girişleri ve kayıtlar kalıcı olarak silinecek.\n\nDevam etmek istiyor musunuz?`
  );
  if (!firstConfirm) return;

  const typedConfirm = prompt(
    `Güvenlik Onayı: Silme işlemini tamamlamak için silinecek dönemi (${targetYM}) aynen yazın:`
  );
  if (typedConfirm === null || typedConfirm.trim() !== targetYM) {
    alert("Dönem adı eşleşmediği için silme işlemi iptal edildi.");
    return;
  }

  delete periodEntriesMap[targetYM];
  registeredPeriods = registeredPeriods.filter((p) => p !== targetYM);

  if (!registeredPeriods.length) {
    const fallback = getCurrentMonthValue();
    registeredPeriods = [fallback];
  }

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
        <input
          type="text"
          class="draft-sub-name"
          value="${escapeHtml(s.name)}"
          placeholder="Alt kalem adı (ör. Oğlumun Telefonu)"
        />
        <input
          type="number"
          step="0.01"
          class="draft-sub-amount"
          value="${escapeHtml(s.fixedAmount)}"
          placeholder="Her ay sabit tutar"
        />
        <button type="button" class="del-btn" data-remove-draft-idx="${idx}">Sil</button>
      </div>
    `
    )
    .join("");
}

function syncDraftFromDom() {
  const rows = Array.from(draftSubList.querySelectorAll(".draft-sub-row"));
  draftSubItems = rows.map((row, idx) => {
    const prevId = draftSubItems[idx]?.subId || `sub_${Date.now()}_${idx}`;
    return {
      subId: prevId,
      name: row.querySelector(".draft-sub-name")?.value || "",
      fixedAmount: row.querySelector(".draft-sub-amount")?.value || ""
    };
  });
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
  kalemAmount.value =
    item.defaultAmount !== null && item.defaultAmount !== undefined ? String(item.defaultAmount) : "";
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

  kalemMasterList.innerHTML = kalemler
    .map((item) => {
      const extraInfo =
        item.mode === "yearly" || item.mode === "scheduled" || item.mode === "this_month"
          ? `${item.startPeriod}`
          : "";
      const defaultAmtText =
        item.defaultAmount !== null && item.defaultAmount !== undefined && item.defaultAmount !== ""
          ? `Sabit/Varsayılan: ${formatTL(item.defaultAmount)}`
          : "Tutar aylık girilecek";

      const subList = item.subItems || [];
      const subPreviewHtml = subList.length
        ? `<div class="kalem-sub-preview">
            ${subList
              .map(
                (s) =>
                  `<div>↳ <strong>${escapeHtml(s.name || "(İsimsiz Alt Kalem)")}</strong>: ${
                    s.fixedAmount !== "" && s.fixedAmount !== undefined
                      ? `${formatTL(s.fixedAmount)} / ay`
                      : "Aylık girilecek"
                  }</div>`
              )
              .join("")}
          </div>`
        : "";

      return `
        <div class="kalem-row-item">
          <div class="kalem-row-top">
            <div>
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <span class="badge">${flowLabel(item.flow)}</span>
                <span class="badge">${modeLabel(item.mode, item)}${extraInfo ? ` · ${extraInfo}` : ""}</span>
              </div>
              <div class="item-meta">${defaultAmtText}</div>
            </div>
            <div class="row-actions">
              <button type="button" class="edit-btn" data-edit-kalem-id="${item.id}">Düzenle</button>
              <button type="button" class="del-btn" data-delete-kalem-id="${item.id}">Sil</button>
            </div>
          </div>
          ${subPreviewHtml}
        </div>
      `;
    })
    .join("");
}

function populateCcKalemSelect() {
  const prevTarget = ccTargetKalemSelect.value;
  ccTargetKalemSelect.innerHTML =
    `<option value="">-- Bağlı Hesap Kalemi Seçin --</option>` +
    kalemler
      .map((k) => `<option value="${k.id}">${escapeHtml(k.name)}</option>`)
      .join("");

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
    ccExpenseTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="item-meta">Önce yukarıdan bir banka/kart adı ekleyip "+ Kart / Banka Ekle" butonuna basın.</td>
      </tr>
    `;
    ccPeriodTotalLabel.textContent = "Seçili Ay Kart Toplamı: 0,00 TL";
    ccLinkedStatusLabel.textContent = "Hesap Kalemi: Kart eklenmedi";
    ccFutureInstallmentsList.innerHTML = `<span class="item-meta">Kart bulunmuyor.</span>`;
    return;
  }

  ccSelect.innerHTML = creditCards
    .map((c) => `<option value="${c.id}">${escapeHtml(c.bankName)}</option>`)
    .join("");

  const activeCard = creditCards.find((c) => c.id === prevSelectedCardId) || creditCards[0];
  ccSelect.value = activeCard.id;
  ccTargetKalemSelect.value = activeCard.linkedKalemId || "";

  const cardAllItems = ccItems.filter((x) => x.cardId === activeCard.id);
  const activeInPeriod = cardAllItems
    .map((item) => ({ raw: item, match: getCcItemForPeriod(item, selectedPeriod) }))
    .filter((x) => x.match !== null);

  if (!activeInPeriod.length) {
    ccExpenseTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="item-meta">${selectedPeriod} döneminde ${escapeHtml(activeCard.bankName)} kartında aktif işlem/taksit yok.</td>
      </tr>
    `;
  } else {
    ccExpenseTableBody.innerHTML = activeInPeriod
      .map(
        ({ raw, match }) => `
        <tr>
          <td>${escapeHtml(raw.startPeriod)} (${escapeHtml(raw.date || "-")})</td>
          <td>${escapeHtml(raw.desc)}</td>
          <td style="text-align:right;">${formatTL(raw.totalAmount)}</td>
          <td><span class="badge">${escapeHtml(match.statusText)}</span></td>
          <td style="text-align:right; font-weight:700;">${formatTL(match.installmentAmount)}</td>
          <td style="text-align:center;">
            <button type="button" class="del-btn" data-delete-cc-item="${raw.id}">Sil</button>
          </td>
        </tr>
      `
      )
      .join("");
  }

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
      futureChips.push(
        `<div class="future-chip"><strong>${futureYM}:</strong> ${formatTL(futureTotal)}</div>`
      );
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
      const defaultSubAmt =
        sub.fixedAmount !== undefined && sub.fixedAmount !== null && sub.fixedAmount !== ""
          ? String(sub.fixedAmount)
          : "";
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

    const hasSyncedCard =
      targetFlow === "expense" && Object.prototype.hasOwnProperty.call(syncedCardMap, item.id);

    let parentAmount = "";
    let allChildrenPaid = false;

    if (hasChildren) {
      const subSum = children.reduce((acc, c) => {
        const n = parseFloat(c.amount);
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

function renderPeriodTables() {
  const selectedPeriod = periodSelect.value || getCurrentMonthValue();
  populateCcKalemSelect();
  renderCreditCardPanel();
  renderNotesPanel();

  const expenseGroups = buildGroupEntriesForFlow(selectedPeriod, "expense");
  const incomeGroups = buildGroupEntriesForFlow(selectedPeriod, "income");

  let incomeTotal = 0;
  for (const grp of incomeGroups) {
    const numAmt = parseFloat(grp.parent.amount);
    if (!Number.isNaN(numAmt)) incomeTotal += numAmt;
  }

  let expenseTotal = 0;
  let expensePaidTotal = 0;

  if (!expenseGroups.length) {
    expenseSheetFrame.classList.add("empty");
    expenseTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="item-meta">Bu dönem için gider kalemi bulunmuyor.</td>
      </tr>
      <tr class="summary-row">
        <td>Toplam Gider</td>
        <td style="text-align:right;">${formatTL(0)}</td>
        <td colspan="3"></td>
      </tr>
      <tr class="summary-row paid-summary">
        <td>Ödenen</td>
        <td style="text-align:right;">${formatTL(0)}</td>
        <td colspan="3"></td>
      </tr>
      <tr class="summary-row rem-summary">
        <td>Kalan</td>
        <td style="text-align:right;">${formatTL(0)}</td>
        <td colspan="3"></td>
      </tr>
    `;
  } else {
    expenseSheetFrame.classList.remove("empty");
    const htmlRows = [];

    for (const grp of expenseGroups) {
      const p = grp.parent;
      const numAmt = parseFloat(p.amount);
      const validAmt = Number.isNaN(numAmt) ? 0 : numAmt;
      expenseTotal += validAmt;

      if (p.hasChildren) {
        for (const ch of grp.children) {
          const chAmt = parseFloat(ch.amount);
          if (!Number.isNaN(chAmt) && ch.paid) {
            expensePaidTotal += chAmt;
          }
        }
      } else if (p.paid) {
        expensePaidTotal += validAmt;
      }

      const parentLocked = p.hasChildren || p.isSyncedFromCard;

      const paidCellHtml = p.hasChildren
        ? `<span class="item-meta">${p.allChildrenPaid ? "Tümü Ödendi" : "Alt kalemden"}</span>`
        : `<label class="paid-box">
             <input type="checkbox" class="field-paid" ${p.paid ? "checked" : ""} />
             <span>${p.paid ? "Ödendi" : "Ödenmedi"}</span>
           </label>`;

      htmlRows.push(`
        <tr
          class="parent-row ${p.hasChildren ? "parent-has-children" : ""}"
          data-key="${p.key}"
          data-kalem-id="${p.kalemId}"
          data-flow="expense"
        >
          <td>
            <strong>${escapeHtml(p.kalemName)}</strong>
            <span class="badge">${escapeHtml(p.metaText)}</span>
          </td>
          <td>
            <input
              type="number"
              step="0.01"
              class="cell-input num field-amount"
              value="${escapeHtml(p.amount)}"
              placeholder="0,00"
              ${parentLocked ? "readonly" : ""}
            />
          </td>
          <td>
            <input type="date" class="cell-input date field-due" value="${escapeHtml(p.dueDate)}" />
          </td>
          <td>
            <input
              type="text"
              class="cell-input desc field-note"
              value="${escapeHtml(p.note)}"
              placeholder="Açıklama..."
            />
          </td>
          <td>${paidCellHtml}</td>
        </tr>
      `);

      for (const ch of grp.children) {
        htmlRows.push(`
          <tr
            class="child-row"
            data-sub-ov-key="${ch.subOvKey}"
            data-kalem-id="${ch.kalemId}"
            data-flow="expense"
          >
            <td>
              <div class="child-indent">
                <span>↳</span>
                <span>${escapeHtml(ch.name || "(İsimsiz Alt Kalem)")}</span>
              </div>
            </td>
            <td>
              <input
                type="number"
                step="0.01"
                class="cell-input num field-sub-amount"
                value="${escapeHtml(ch.amount)}"
                placeholder="0,00"
              />
            </td>
            <td>
              <input type="date" class="cell-input date field-sub-due" value="${escapeHtml(ch.dueDate)}" />
            </td>
            <td>
              <input
                type="text"
                class="cell-input desc field-sub-note"
                value="${escapeHtml(ch.note)}"
                placeholder="Açıklama..."
              />
            </td>
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
      <tr class="summary-row">
        <td>Toplam Gider</td>
        <td style="text-align:right;">${formatTL(expenseTotal)}</td>
        <td colspan="3"></td>
      </tr>
      <tr class="summary-row paid-summary">
        <td>Ödenen</td>
        <td style="text-align:right;">${formatTL(expensePaidTotal)}</td>
        <td colspan="3"></td>
      </tr>
      <tr class="summary-row rem-summary">
        <td>Kalan</td>
        <td style="text-align:right;">${formatTL(remainingTotal)}</td>
        <td colspan="3"></td>
      </tr>
    `);

    expenseTableBody.innerHTML = htmlRows.join("");
  }

  const netProfitLoss = incomeTotal - expenseTotal;
  const pnlLabel = netProfitLoss >= 0 ? "Kar / Zarar (Net Kar)" : "Kar / Zarar (Net Zarar)";
  const pnlClass = netProfitLoss >= 0 ? "profit-row" : "loss-row";

  if (!incomeGroups.length) {
    incomeSheetFrame.classList.add("empty");
    incomeTableBody.innerHTML = `
      <tr>
        <td colspan="3" class="item-meta">Bu dönem için gelir kalemi bulunmuyor.</td>
      </tr>
      <tr class="summary-row">
        <td>Toplam Gelir</td>
        <td style="text-align:right;">${formatTL(0)}</td>
        <td></td>
      </tr>
      <tr class="summary-row ${pnlClass}">
        <td>${pnlLabel}</td>
        <td style="text-align:right;">${formatSignedTL(netProfitLoss)}</td>
        <td></td>
      </tr>
    `;
  } else {
    incomeSheetFrame.classList.remove("empty");
    const htmlRows = [];

    for (const grp of incomeGroups) {
      const p = grp.parent;

      htmlRows.push(`
        <tr
          class="parent-row ${p.hasChildren ? "parent-has-children" : ""}"
          data-key="${p.key}"
          data-kalem-id="${p.kalemId}"
          data-flow="income"
        >
          <td>
            <strong>${escapeHtml(p.kalemName)}</strong>
            <span class="badge">${escapeHtml(p.metaText)}</span>
          </td>
          <td>
            <input
              type="number"
              step="0.01"
              class="cell-input num field-amount"
              value="${escapeHtml(p.amount)}"
              placeholder="0,00"
              ${p.hasChildren ? "readonly" : ""}
            />
          </td>
          <td>
            <input
              type="text"
              class="cell-input desc field-note"
              value="${escapeHtml(p.note)}"
              placeholder="Açıklama..."
            />
          </td>
        </tr>
      `);

      for (const ch of grp.children) {
        htmlRows.push(`
          <tr
            class="child-row"
            data-sub-ov-key="${ch.subOvKey}"
            data-kalem-id="${ch.kalemId}"
            data-flow="income"
          >
            <td>
              <div class="child-indent">
                <span>↳</span>
                <span>${escapeHtml(ch.name || "(İsimsiz Alt Kalem)")}</span>
              </div>
            </td>
            <td>
              <input
                type="number"
                step="0.01"
                class="cell-input num field-sub-amount"
                value="${escapeHtml(ch.amount)}"
                placeholder="0,00"
              />
            </td>
            <td>
              <input
                type="text"
                class="cell-input desc field-sub-note"
                value="${escapeHtml(ch.note)}"
                placeholder="Açıklama..."
              />
            </td>
          </tr>
        `);
      }
    }

    htmlRows.push(`
      <tr class="summary-row">
        <td>Toplam Gelir</td>
        <td style="text-align:right;">${formatTL(incomeTotal)}</td>
        <td></td>
      </tr>
      <tr class="summary-row ${pnlClass}">
        <td>${pnlLabel}</td>
        <td style="text-align:right;">${formatSignedTL(netProfitLoss)}</td>
        <td></td>
      </tr>
    `);

    incomeTableBody.innerHTML = htmlRows.join("");
  }
}

function updateRowValueFromDom(tr, shouldRerender = true) {
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

    pData.subOverrides[subOvKey] = {
      note: noteEl ? noteEl.value : prev.note ?? "",
      amount: amtEl ? amtEl.value : prev.amount ?? "",
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

  pData.overrides[key] = {
    note: noteEl ? noteEl.value : prev.note ?? "",
    amount: amountEl ? amountEl.value : prev.amount ?? "",
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

// --- PWA Kurulum & Bildirim İzinleri ---
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
    if (btnInstallApp) {
      btnInstallApp.style.display = "inline-block";
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (btnInstallApp) {
      btnInstallApp.style.display = "none";
    }
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

// --- Google Drive Entegrasyonu ---
function connectGoogleDrive(forceConsent = false) {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      driveStatus.textContent = "Drive: Auth servisi yüklenmedi";
      reject(new Error("Auth servisi yüklenmedi"));
      return;
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (response) => {
        if (response.error) {
          driveStatus.textContent = `Drive: Hata (${response.error})`;
          reject(new Error(response.error));
          return;
        }
        accessToken = response.access_token;
        driveStatus.textContent = "Drive: Bağlandı";
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
  if (!res.ok) {
    throw new Error(`Drive API (${res.status}): ${await res.text()}`);
  }
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
  if (Array.isArray(remote.notes) || Array.isArray(remote.noteGroups)) {
    setNotesData(remote.notes || [], remote.noteGroups || null);
  }

  registeredPeriods = normalizeRegisteredPeriods(
    remote.registeredPeriods,
    periodEntriesMap,
    periodSelect.value
  );
  localStorage.setItem(STORAGE_REGISTERED_PERIODS_KEY, JSON.stringify(registeredPeriods));

  renderPeriodDropdown(periodSelect.value);
  renderMasterList();
  renderPeriodTables();
}

async function syncAllToDrive() {
  if (!accessToken) {
    driveStatus.textContent = "Drive: Otomatik kayıt için Drive Bağlan'a basın";
    return;
  }

  driveStatus.textContent = "Drive: Otomatik kaydediliyor...";
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
    notes: getNotesData(),
    noteGroups: getNoteGroupsData()
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
  driveStatus.textContent = `Drive: Otomatik kaydedildi (${nowTime})`;
}

function scheduleAutoDriveSync() {
  if (!accessToken) return;
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  driveStatus.textContent = "Drive: Kaydedilecek...";
  autoSyncTimer = setTimeout(() => {
    syncAllToDrive().catch((err) => {
      driveStatus.textContent = `Drive: Kayıt hatası (${err.message})`;
    });
  }, 800);
}

// --- Olay Dinleyicileri ---
kalemMode.addEventListener("change", () => {
  kalemInstallments.style.display = kalemMode.value === "installment" ? "block" : "none";
  if (kalemMode.value !== "installment") {
    kalemInstallments.value = "";
  }
});

btnAddDraftSub.addEventListener("click", () => {
  syncDraftFromDom();
  draftSubItems.push({
    subId: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    fixedAmount: ""
  });
  renderDraftSubList();
});

draftSubList.addEventListener("click", (e) => {
  const idxAttr = e.target.dataset.removeDraftIdx;
  if (idxAttr === undefined) return;
  syncDraftFromDom();
  draftSubItems.splice(Number(idxAttr), 1);
  renderDraftSubList();
});

btnCancelKalemEdit.addEventListener("click", () => {
  resetKalemForm();
});

kalemForm.addEventListener("submit", (e) => {
  e.preventDefault();
  syncDraftFromDom();

  const name = kalemName.value.trim();
  const rawAmt = kalemAmount.value.trim();
  const defaultAmount = rawAmt === "" ? null : Number(rawAmt);
  const flow = kalemFlow.value;
  const mode = kalemMode.value;
  const installments =
    mode === "installment" ? Math.max(1, Number(kalemInstallments.value) || 1) : null;
  const startPeriod = kalemTargetPeriod.value || periodSelect.value || getCurrentMonthValue();

  const cleanedSubItems = draftSubItems
    .map((s) => ({
      subId: s.subId,
      name: s.name.trim(),
      fixedAmount: s.fixedAmount.trim()
    }))
    .filter((s) => s.name !== "" || s.fixedAmount !== "");

  if (!name) return;
  if (defaultAmount !== null && Number.isNaN(defaultAmount)) return;

  if (editingKalemId) {
    const idx = kalemler.findIndex((k) => k.id === editingKalemId);
    if (idx !== -1) {
      kalemler[idx] = {
        ...kalemler[idx],
        flow,
        name,
        defaultAmount,
        mode,
        installments,
        startPeriod,
        subItems: cleanedSubItems
      };
    }
    resetKalemForm();
  } else {
    kalemler.push({
      id: `klm_${Date.now()}`,
      flow,
      name,
      defaultAmount,
      mode,
      installments,
      startPeriod,
      subItems: cleanedSubItems
    });
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

  if (editingKalemId === delId) {
    resetKalemForm();
  }
  kalemler = kalemler.filter((item) => item.id !== delId);
  creditCards = creditCards.map((c) => (c.linkedKalemId === delId ? { ...c, linkedKalemId: "" } : c));
  saveAllLocalState();
  renderMasterList();
  renderPeriodTables();
});

btnAddCard.addEventListener("click", () => {
  const bankName = newCardBankInput.value.trim();
  if (!bankName) return;

  const newCard = {
    id: `cc_${Date.now()}`,
    bankName,
    linkedKalemId: kalemler[0]?.id || ""
  };

  creditCards.push(newCard);
  newCardBankInput.value = "";
  saveAllLocalState();
  renderPeriodTables();
  ccSelect.value = newCard.id;
  renderCreditCardPanel();
});

ccSelect.addEventListener("change", () => {
  renderCreditCardPanel();
});

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
  const totalAmount = Number(ccExpAmount.value);
  const installments = Math.max(1, Number(ccExpInstallments.value) || 1);
  const dateVal = ccExpDate.value || getTodayDateValue();
  const startPeriod =
    dateVal && dateVal.length >= 7
      ? dateVal.slice(0, 7)
      : periodSelect.value || getCurrentMonthValue();

  if (!desc || Number.isNaN(totalAmount)) return;

  ccItems.push({
    id: `ccitem_${Date.now()}`,
    cardId,
    desc,
    totalAmount,
    installments,
    startPeriod,
    date: dateVal
  });

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

function handleTableInputChange(e) {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const isNoteField =
    e.target.classList.contains("field-note") || e.target.classList.contains("field-sub-note");
  updateRowValueFromDom(tr, !isNoteField);
}

expenseTableBody.addEventListener("change", handleTableInputChange);
incomeTableBody.addEventListener("change", handleTableInputChange);

topButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    togglePanel(btn.dataset.panel);
  });
});

closeButtons.forEach((btn) => {
  btn.addEventListener("click", closeAllPanels);
});

btnDriveConnect.addEventListener("click", async () => {
  try {
    await connectGoogleDrive(true);
    await loadRemoteStateIfExists();
    await syncAllToDrive();
  } catch (err) {
    driveStatus.textContent = `Drive: Hata (${err.message})`;
  }
});

btnDriveSync.addEventListener("click", () => {
  syncAllToDrive().catch((err) => {
    driveStatus.textContent = `Drive: Hata (${err.message})`;
  });
});

initPwaFeatures();
ccExpDate.value = getTodayDateValue();
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
    notes: getNotesData()
  }),
  onReportsOpen: () => {
    closeAllPanels();
  }
});
renderDraftSubList();
renderMasterList();
renderPeriodTables();