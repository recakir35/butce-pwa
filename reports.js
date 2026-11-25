let dataProviderFn = () => ({
  registeredPeriods: [],
  kalemler: [],
  periodEntriesMap: {},
  creditCards: [],
  ccItems: [],
  notes: []
});

let onOpenFn = () => {};
let onCloseFn = () => {};
let isReportsOpen = false;

function escapeRepHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTL(val) {
  return `${Number(val || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} TL`;
}

function monthToIdx(ym) {
  if (!ym || !ym.includes("-")) return 0;
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

function idxToMonth(idx) {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function isKalemActive(item, period, flow) {
  const flowOk =
    item.flow === "both" ||
    (flow === "expense" && item.flow === "expense") ||
    (flow === "income" && item.flow === "income");
  if (!flowOk) return false;

  const startYM = item.startPeriod || period;
  const [, selM] = period.split("-").map(Number);
  const [, startM] = startYM.split("-").map(Number);
  const selIdx = monthToIdx(period);
  const startIdx = monthToIdx(startYM);

  if (item.mode === "this_month" || item.mode === "scheduled") {
    return period === startYM;
  }
  if (item.mode === "yearly") {
    return selIdx >= startIdx && selM === startM;
  }
  if (item.mode === "installment") {
    const cnt = Math.max(1, Number(item.installments) || 1);
    const step = selIdx - startIdx + 1;
    return step >= 1 && step <= cnt;
  }
  if (item.mode === "fixed") {
    return selIdx >= startIdx;
  }
  return false;
}

function getCcMatch(ccItem, period) {
  const selIdx = monthToIdx(period);
  const startIdx = monthToIdx(ccItem.startPeriod || period);
  const cnt = Math.max(1, Number(ccItem.installments) || 1);
  const step = selIdx - startIdx + 1;
  if (step < 1 || step > cnt) return null;
  const totalAmt = Number(ccItem.totalAmount) || 0;
  return {
    step,
    count: cnt,
    amount: totalAmt / cnt
  };
}

function computePeriodFlowSummary(period, flow, state) {
  const pData = state.periodEntriesMap[period] || { overrides: {}, subOverrides: {} };
  const overrides = pData.overrides || {};
  const subOverrides = pData.subOverrides || {};

  const syncedCardMap = {};
  if (flow === "expense") {
    for (const card of state.creditCards || []) {
      if (!card.linkedKalemId) continue;
      const cardTotal = (state.ccItems || [])
        .filter((x) => x.cardId === card.id)
        .reduce((s, x) => {
          const m = getCcMatch(x, period);
          return s + (m ? m.amount : 0);
        }, 0);
      syncedCardMap[card.linkedKalemId] = (syncedCardMap[card.linkedKalemId] || 0) + cardTotal;
    }
  }

  let total = 0;
  let paid = 0;
  const byKalem = [];

  for (const item of state.kalemler || []) {
    if (!isKalemActive(item, period, flow)) continue;
    const key = `${item.id}__${flow}`;
    const ov = overrides[key] || {};
    const subs = Array.isArray(item.subItems) ? item.subItems : [];
    const hasSubs = subs.length > 0;
    const hasCard = flow === "expense" && Object.prototype.hasOwnProperty.call(syncedCardMap, item.id);

    let amt = 0;
    let itemPaid = 0;

    if (hasSubs) {
      for (const s of subs) {
        const sOvKey = `${s.subId}__${flow}`;
        const sOv = subOverrides[sOvKey] || {};
        const raw = sOv.amount !== undefined ? sOv.amount : s.fixedAmount;
        const n = parseFloat(raw);
        const val = Number.isNaN(n) ? 0 : n;
        amt += val;
        if (sOv.paid) itemPaid += val;
      }
    } else if (hasCard) {
      amt = syncedCardMap[item.id] || 0;
      if (ov.paid) itemPaid = amt;
    } else {
      const raw = ov.amount !== undefined ? ov.amount : item.defaultAmount;
      const n = parseFloat(raw);
      amt = Number.isNaN(n) ? 0 : n;
      if (ov.paid) itemPaid = amt;
    }

    total += amt;
    paid += itemPaid;
    byKalem.push({
      kalemId: item.id,
      kalemName: item.name,
      amount: amt,
      paid: itemPaid,
      remaining: Math.max(0, amt - itemPaid)
    });
  }

  return {
    total,
    paid,
    remaining: Math.max(0, total - paid),
    byKalem
  };
}

function getFilteredPeriods(state) {
  const all = [...(state.registeredPeriods || [])].sort();
  if (!all.length) return [];

  const fromEl = document.getElementById("reportPeriodFrom");
  const toEl = document.getElementById("reportPeriodTo");
  let fromYM = fromEl?.value || all[0];
  let toYM = toEl?.value || all[all.length - 1];

  if (monthToIdx(fromYM) > monthToIdx(toYM)) {
    const tmp = fromYM;
    fromYM = toYM;
    toYM = tmp;
  }

  return all.filter((p) => monthToIdx(p) >= monthToIdx(fromYM) && monthToIdx(p) <= monthToIdx(toYM));
}

function buildGroupedBarSvg(labels, seriesList, height = 240) {
  if (!labels.length) {
    return `<div class="item-meta">Grafik için veri bulunmuyor.</div>`;
  }

  const maxVal = Math.max(
    1,
    ...seriesList.flatMap((s) => s.values.map((v) => Math.max(0, Number(v) || 0)))
  );

  const barWidth = 22;
  const groupGap = 24;
  const seriesGap = 6;
  const leftPad = 64;
  const rightPad = 24;
  const topPad = 20;
  const bottomPad = 44;

  const groupWidth = seriesList.length * barWidth + (seriesList.length - 1) * seriesGap;
  const plotHeight = height - topPad - bottomPad;
  const svgWidth = Math.max(460, leftPad + rightPad + labels.length * (groupWidth + groupGap));

  let gridLines = "";
  for (let i = 0; i <= 4; i++) {
    const ratio = i / 4;
    const y = topPad + plotHeight - ratio * plotHeight;
    const tickVal = Math.round(maxVal * ratio);
    gridLines += `
      <line x1="${leftPad}" y1="${y.toFixed(1)}" x2="${svgWidth - rightPad}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-dasharray="3,3" />
      <text x="${leftPad - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#64748b">${tickVal.toLocaleString("tr-TR")}</text>
    `;
  }

  let barsSvg = "";
  labels.forEach((lbl, gIdx) => {
    const gx = leftPad + gIdx * (groupWidth + groupGap);

    seriesList.forEach((s, sIdx) => {
      const val = Math.max(0, Number(s.values[gIdx]) || 0);
      const bh = (val / maxVal) * plotHeight;
      const bx = gx + sIdx * (barWidth + seriesGap);
      const by = topPad + plotHeight - bh;

      barsSvg += `
        <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barWidth}" height="${Math.max(0, bh).toFixed(1)}" rx="3" fill="${s.color}">
          <title>${escapeRepHtml(lbl)} · ${escapeRepHtml(s.name)}: ${fmtTL(val)}</title>
        </rect>
      `;
    });

    const centerX = gx + groupWidth / 2;
    barsSvg += `
      <text x="${centerX.toFixed(1)}" y="${height - 14}" text-anchor="middle" font-size="11" font-weight="600" fill="#334155">${escapeRepHtml(lbl)}</text>
    `;
  });

  const legendHtml = seriesList
    .map(
      (s) => `
      <span class="report-legend-item">
        <span class="report-swatch" style="background:${s.color};"></span>
        <span>${escapeRepHtml(s.name)}</span>
      </span>
    `
    )
    .join("");

  return `
    <div class="report-legend">${legendHtml}</div>
    <svg width="${svgWidth}" height="${height}" viewBox="0 0 ${svgWidth} ${height}" role="img">
      ${gridLines}
      <line x1="${leftPad}" y1="${topPad + plotHeight}" x2="${svgWidth - rightPad}" y2="${topPad + plotHeight}" stroke="#94a3b8" />
      ${barsSvg}
    </svg>
  `;
}

function renderReportContent() {
  const canvasEl = document.getElementById("reportOutputCanvas");
  if (!canvasEl) return;

  const state = dataProviderFn();
  const type = document.getElementById("reportTypeSelect")?.value || "month_compare";
  const flowFilter = document.getElementById("reportFlowFilter")?.value || "all";
  const periods = getFilteredPeriods(state);

  if (!periods.length) {
    canvasEl.innerHTML = `<div class="report-empty-state">Raporlanacak kayıtlı dönem bulunamadı.</div>`;
    return;
  }

  if (type === "month_compare") {
    const rows = periods.map((p) => {
      const inc = computePeriodFlowSummary(p, "income", state).total;
      const exp = computePeriodFlowSummary(p, "expense", state).total;
      return { period: p, income: inc, expense: exp, net: inc - exp };
    });

    const totInc = rows.reduce((s, r) => s + r.income, 0);
    const totExp = rows.reduce((s, r) => s + r.expense, 0);
    const totNet = totInc - totExp;

    const series = [];
    if (flowFilter !== "expense") series.push({ name: "Gelir", color: "#16a34a", values: rows.map((r) => r.income) });
    if (flowFilter !== "income") series.push({ name: "Gider", color: "#dc2626", values: rows.map((r) => r.expense) });
    series.push({ name: "Net", color: "#1d4ed8", values: rows.map((r) => Math.max(0, r.net)) });

    canvasEl.innerHTML = `
      <div class="report-kpi-grid">
        <div class="report-kpi-box"><div class="report-kpi-label">Toplam Gelir</div><div class="report-kpi-value">${fmtTL(totInc)}</div></div>
        <div class="report-kpi-box"><div class="report-kpi-label">Toplam Gider</div><div class="report-kpi-value">${fmtTL(totExp)}</div></div>
        <div class="report-kpi-box"><div class="report-kpi-label">Net Bakiye</div><div class="report-kpi-value">${fmtTL(totNet)}</div></div>
      </div>
      <div class="report-chart-card">
        <h3 class="report-chart-title">Ay - Ay Karşılaştırma Grafiği</h3>
        ${buildGroupedBarSvg(rows.map((r) => r.period), series)}
      </div>
      <div class="sheet-frame" style="min-height:auto;">
        <table class="excel-table">
          <thead><tr><th>Dönem</th><th>Gelir</th><th>Gider</th><th>Net</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (r) => `
              <tr>
                <td><strong>${escapeRepHtml(r.period)}</strong></td>
                <td style="text-align:right;">${fmtTL(r.income)}</td>
                <td style="text-align:right;">${fmtTL(r.expense)}</td>
                <td style="text-align:right; font-weight:700;">${fmtTL(r.net)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  if (type === "year_compare") {
    const yearMap = {};
    for (const p of periods) {
      const yr = p.slice(0, 4);
      if (!yearMap[yr]) yearMap[yr] = { year: yr, income: 0, expense: 0, months: 0 };
      yearMap[yr].income += computePeriodFlowSummary(p, "income", state).total;
      yearMap[yr].expense += computePeriodFlowSummary(p, "expense", state).total;
      yearMap[yr].months += 1;
    }
    const years = Object.values(yearMap).sort((a, b) => a.year.localeCompare(b.year));

    const series = [];
    if (flowFilter !== "expense") series.push({ name: "Yıllık Gelir", color: "#16a34a", values: years.map((y) => y.income) });
    if (flowFilter !== "income") series.push({ name: "Yıllık Gider", color: "#dc2626", values: years.map((y) => y.expense) });

    canvasEl.innerHTML = `
      <div class="report-chart-card">
        <h3 class="report-chart-title">Yıl - Yıl Karşılaştırma Grafiği</h3>
        ${buildGroupedBarSvg(years.map((y) => y.year), series)}
      </div>
      <div class="sheet-frame" style="min-height:auto;">
        <table class="excel-table">
          <thead><tr><th>Yıl</th><th>Dönem Sayısı</th><th>Toplam Gelir</th><th>Toplam Gider</th><th>Net</th></tr></thead>
          <tbody>
            ${years
              .map(
                (y) => `
              <tr>
                <td><strong>${escapeRepHtml(y.year)}</strong></td>
                <td>${y.months} ay</td>
                <td style="text-align:right;">${fmtTL(y.income)}</td>
                <td style="text-align:right;">${fmtTL(y.expense)}</td>
                <td style="text-align:right; font-weight:700;">${fmtTL(y.income - y.expense)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  if (type === "category_breakdown") {
    const flows = flowFilter === "all" ? ["expense", "income"] : [flowFilter];
    const aggMap = {};

    for (const p of periods) {
      for (const fl of flows) {
        const sum = computePeriodFlowSummary(p, fl, state);
        for (const k of sum.byKalem) {
          const mapKey = `${k.kalemId}__${fl}`;
          if (!aggMap[mapKey]) {
            aggMap[mapKey] = {
              name: k.kalemName,
              flowLabel: fl === "income" ? "Gelir" : "Gider",
              total: 0
            };
          }
          aggMap[mapKey].total += k.amount;
        }
      }
    }

    const list = Object.values(aggMap).sort((a, b) => b.total - a.total);
    canvasEl.innerHTML = `
      <div class="report-chart-card">
        <h3 class="report-chart-title">Kalem Bazlı Toplam Dağılım Grafiği</h3>
        ${buildGroupedBarSvg(
          list.map((x) => `${x.name} (${x.flowLabel})`),
          [{ name: "Toplam Tutar", color: "#0f766e", values: list.map((x) => x.total) }]
        )}
      </div>
      <div class="sheet-frame" style="min-height:auto;">
        <table class="excel-table">
          <thead><tr><th>Hesap Kalemi</th><th>Tür</th><th>Seçili Aralık Toplamı</th></tr></thead>
          <tbody>
            ${list
              .map(
                (x) => `
              <tr>
                <td><strong>${escapeRepHtml(x.name)}</strong></td>
                <td>${escapeRepHtml(x.flowLabel)}</td>
                <td style="text-align:right; font-weight:700;">${fmtTL(x.total)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  if (type === "payment_status") {
    const rows = periods.map((p) => {
      const exp = computePeriodFlowSummary(p, "expense", state);
      return { period: p, total: exp.total, paid: exp.paid, rem: exp.remaining };
    });

    const totAll = rows.reduce((s, r) => s + r.total, 0);
    const totPaid = rows.reduce((s, r) => s + r.paid, 0);
    const totRem = rows.reduce((s, r) => s + r.rem, 0);

    canvasEl.innerHTML = `
      <div class="report-kpi-grid">
        <div class="report-kpi-box"><div class="report-kpi-label">Toplam Gider</div><div class="report-kpi-value">${fmtTL(totAll)}</div></div>
        <div class="report-kpi-box"><div class="report-kpi-label">Ödenen</div><div class="report-kpi-value">${fmtTL(totPaid)}</div></div>
        <div class="report-kpi-box"><div class="report-kpi-label">Kalan</div><div class="report-kpi-value">${fmtTL(totRem)}</div></div>
      </div>
      <div class="report-chart-card">
        <h3 class="report-chart-title">Ödenen vs. Kalan Gider Grafiği</h3>
        ${buildGroupedBarSvg(rows.map((r) => r.period), [
          { name: "Ödenen", color: "#16a34a", values: rows.map((r) => r.paid) },
          { name: "Kalan", color: "#dc2626", values: rows.map((r) => r.rem) }
        ])}
      </div>
      <div class="sheet-frame" style="min-height:auto;">
        <table class="excel-table">
          <thead><tr><th>Dönem</th><th>Toplam Gider</th><th>Ödenen</th><th>Kalan</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (r) => `
              <tr>
                <td><strong>${escapeRepHtml(r.period)}</strong></td>
                <td style="text-align:right;">${fmtTL(r.total)}</td>
                <td style="text-align:right;">${fmtTL(r.paid)}</td>
                <td style="text-align:right; font-weight:700;">${fmtTL(r.rem)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  if (type === "cc_installments") {
    const cards = state.creditCards || [];
    const items = state.ccItems || [];
    const baseYM = periods[periods.length - 1];
    const baseIdx = monthToIdx(baseYM);
    const projMonths = [];
    for (let i = 0; i < 6; i++) {
      projMonths.push(idxToMonth(baseIdx + i));
    }

    const cardSeries = cards.map((c, idx) => {
      const palette = ["#1d4ed8", "#9333ea", "#ea580c", "#0d9488", "#be123c"];
      return {
        name: c.bankName,
        color: palette[idx % palette.length],
        values: projMonths.map((ym) =>
          items
            .filter((it) => it.cardId === c.id)
            .reduce((s, it) => {
              const m = getCcMatch(it, ym);
              return s + (m ? m.amount : 0);
            }, 0)
        )
      };
    });

    canvasEl.innerHTML = `
      <div class="report-chart-card">
        <h3 class="report-chart-title">6 Dönemlik Kredi Kartı Taksit Projeksiyonu (${escapeRepHtml(baseYM)} İtibarıyla)</h3>
        ${
          cardSeries.length
            ? buildGroupedBarSvg(projMonths, cardSeries)
            : `<div class="item-meta">Kayıtlı kredi kartı bulunmuyor.</div>`
        }
      </div>
      <div class="sheet-frame" style="min-height:auto;">
        <table class="excel-table">
          <thead>
            <tr>
              <th>Dönem</th>
              ${cards.map((c) => `<th>${escapeRepHtml(c.bankName)}</th>`).join("")}
              <th>Toplam</th>
            </tr>
          </thead>
          <tbody>
            ${projMonths
              .map((ym, mIdx) => {
                const rowSum = cardSeries.reduce((s, cs) => s + (cs.values[mIdx] || 0), 0);
                return `
                  <tr>
                    <td><strong>${escapeRepHtml(ym)}</strong></td>
                    ${cardSeries
                      .map((cs) => `<td style="text-align:right;">${fmtTL(cs.values[mIdx] || 0)}</td>`)
                      .join("")}
                    <td style="text-align:right; font-weight:700;">${fmtTL(rowSum)}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  if (type === "notes_summary") {
    const allNotes = state.notes || [];
    const filteredNotes = allNotes.filter(
      (n) => !n.period || periods.includes(n.period)
    );
    const doneCount = filteredNotes.filter((n) => n.done).length;
    const openCount = filteredNotes.length - doneCount;

    const groupCounts = {};
    for (const n of filteredNotes) {
      const g = n.group || "Genel";
      groupCounts[g] = (groupCounts[g] || 0) + 1;
    }
    const groupKeys = Object.keys(groupCounts);

    canvasEl.innerHTML = `
      <div class="report-kpi-grid">
        <div class="report-kpi-box"><div class="report-kpi-label">Toplam Not</div><div class="report-kpi-value">${filteredNotes.length}</div></div>
        <div class="report-kpi-box"><div class="report-kpi-label">Yapılan</div><div class="report-kpi-value">${doneCount}</div></div>
        <div class="report-kpi-box"><div class="report-kpi-label">Bekleyen</div><div class="report-kpi-value">${openCount}</div></div>
      </div>
      <div class="report-chart-card">
        <h3 class="report-chart-title">Not Grubu Dağılımı</h3>
        ${
          groupKeys.length
            ? buildGroupedBarSvg(groupKeys, [
                { name: "Not Sayısı", color: "#2563eb", values: groupKeys.map((g) => groupCounts[g]) }
              ], 200)
            : `<div class="item-meta">Bu aralıkta not bulunmuyor.</div>`
        }
      </div>
      <div class="sheet-frame" style="min-height:auto;">
        <table class="excel-table">
          <thead><tr><th>Not</th><th>Grup</th><th>Dönem</th><th>Son Tarih</th><th>Durum</th></tr></thead>
          <tbody>
            ${
              filteredNotes.length
                ? filteredNotes
                    .map(
                      (n) => `
                  <tr>
                    <td>${escapeRepHtml(n.text)}</td>
                    <td>${escapeRepHtml(n.group || "Genel")}</td>
                    <td>${escapeRepHtml(n.period || "Genel")}</td>
                    <td>${escapeRepHtml(n.dueDate || "-")}</td>
                    <td>${n.done ? "Yapıldı" : "Bekliyor"}</td>
                  </tr>`
                    )
                    .join("")
                : `<tr><td colspan="5" class="item-meta">Not bulunmuyor.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;
  }
}

function populatePeriodSelects() {
  const state = dataProviderFn();
  const periods = [...(state.registeredPeriods || [])].sort();
  const fromEl = document.getElementById("reportPeriodFrom");
  const toEl = document.getElementById("reportPeriodTo");
  if (!fromEl || !toEl) return;

  if (!periods.length) {
    fromEl.innerHTML = `<option value="">-</option>`;
    toEl.innerHTML = `<option value="">-</option>`;
    return;
  }

  const prevFrom = fromEl.value;
  const prevTo = toEl.value;
  const opts = periods.map((p) => `<option value="${escapeRepHtml(p)}">${escapeRepHtml(p)}</option>`).join("");
  fromEl.innerHTML = opts;
  toEl.innerHTML = opts;

  fromEl.value = periods.includes(prevFrom) ? prevFrom : periods[0];
  toEl.value = periods.includes(prevTo) ? prevTo : periods[periods.length - 1];
}

export function clearReportCanvas() {
  const canvasEl = document.getElementById("reportOutputCanvas");
  if (!canvasEl) return;
  canvasEl.innerHTML = `<div class="report-empty-state">Rapor alanı boş. Üstten rapor türünü ve aralığı seçip <strong>Rapor Oluştur</strong> butonuna basın.</div>`;
}

export function openReportsView() {
  isReportsOpen = true;
  const viewEl = document.getElementById("reportsView");
  const workspaceEl = document.getElementById("budgetWorkspace");
  const btnOpenEl = document.getElementById("btnOpenReports");

  if (viewEl) viewEl.classList.add("open");
  if (workspaceEl) workspaceEl.style.display = "none";
  if (btnOpenEl) btnOpenEl.classList.add("active");

  populatePeriodSelects();
  clearReportCanvas();
  onOpenFn();
}

export function closeReportsView() {
  if (!isReportsOpen) return;
  isReportsOpen = false;
  const viewEl = document.getElementById("reportsView");
  const workspaceEl = document.getElementById("budgetWorkspace");
  const btnOpenEl = document.getElementById("btnOpenReports");

  if (viewEl) viewEl.classList.remove("open");
  if (workspaceEl) workspaceEl.style.display = "";
  if (btnOpenEl) btnOpenEl.classList.remove("active");

  clearReportCanvas();
  onCloseFn();
}

export function initReportsModule({ getReportData, onReportsOpen, onReportsClose } = {}) {
  if (typeof getReportData === "function") dataProviderFn = getReportData;
  if (typeof onReportsOpen === "function") onOpenFn = onReportsOpen;
  if (typeof onReportsClose === "function") onCloseFn = onReportsClose;

  const btnOpen = document.getElementById("btnOpenReports");
  const btnBack = document.getElementById("btnBackToBudget");
  const btnGenerate = document.getElementById("btnGenerateReport");
  const btnClear = document.getElementById("btnClearReport");

  if (btnOpen) {
    btnOpen.addEventListener("click", () => {
      if (isReportsOpen) {
        closeReportsView();
      } else {
        openReportsView();
      }
    });
  }

  if (btnBack) {
    btnBack.addEventListener("click", () => {
      closeReportsView();
    });
  }

  if (btnGenerate) {
    btnGenerate.addEventListener("click", () => {
      renderReportContent();
    });
  }

  if (btnClear) {
    btnClear.addEventListener("click", () => {
      clearReportCanvas();
    });
  }

  clearReportCanvas();
}