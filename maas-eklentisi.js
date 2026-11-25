(() => {
  const MAAS_KEY = "butce_maas_kayitlari_v1";
  const YATIRIM_KEY = "butce_yatirim_durumu_v1";
  const YATIRIM_GECMIS_KEY = "butce_yatirim_gecmis_v1";

  const parseNum = (val) => {
    if (typeof val === "number") return Number.isFinite(val) ? val : 0;
    const raw = String(val ?? "").trim();
    if (!raw) return 0;
    // Hem virgullu hem noktalı girisi dogru oku
    const normalized =
      raw.includes(",") && raw.includes(".")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(",", ".");
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : 0;
  };

  const fmt = (val, decimals = 2) =>
    Number(val || 0).toLocaleString("tr-TR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  function oncekiAy(yyyymm) {
    if (!/^\d{4}-\d{2}$/.test(yyyymm || "")) return "";
    const [y, m] = yyyymm.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function maasKayitlariOku() {
    try {
      const data = JSON.parse(localStorage.getItem(MAAS_KEY) || "[]");
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function maasKayitlariYaz(list) {
    localStorage.setItem(MAAS_KEY, JSON.stringify(list));
  }

  function yatirimOku() {
    try {
      const data = JSON.parse(localStorage.getItem(YATIRIM_KEY) || "{}");
      return {
        dolar: parseNum(data.dolar),
        euro: parseNum(data.euro),
        nakit: parseNum(data.nakit),
        altin: parseNum(data.altin),
        diger: parseNum(data.diger),
        acik: data.acik !== false,
      };
    } catch {
      return { dolar: 0, euro: 0, nakit: 0, altin: 0, diger: 0, acik: true };
    }
  }

  function yatirimYaz(obj) {
    localStorage.setItem(YATIRIM_KEY, JSON.stringify(obj));
  }

  function yatirimGecmisOku() {
    try {
      const data = JSON.parse(localStorage.getItem(YATIRIM_GECMIS_KEY) || "[]");
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function yatirimGecmisYaz(list) {
    localStorage.setItem(YATIRIM_GECMIS_KEY, JSON.stringify(list));
  }

  // 1. Gider ve Gelir kalemlerinde sondaki sifirlari silmeyi engelle
  function tutarAlanlariniKoru() {
    const inputs = document.querySelectorAll("table input, .kalem-satir input, .satir input, input[type='number'], input[type='text']");
    inputs.forEach((inp) => {
      if (inp.closest("#maasModal") || inp.closest("#yatirimModal") || inp.closest("#maasKurModal")) return;
      if (inp.type === "month" || inp.type === "date" || inp.type === "checkbox" || inp.type === "radio") return;

      const labelText = (inp.closest("tr, div, label")?.textContent || "").toLowerCase();
      const isAmountLike =
        inp.type === "number" ||
        inp.inputMode === "decimal" ||
        /tutar|gelir|gider|miktar|bakiye|maaş/i.test(labelText);

      if (!isAmountLike) return;
      if (inp.dataset.sifirKorumaAktif === "1") return;
      inp.dataset.sifirKorumaAktif = "1";

      // Kullanici ne yazdiysa odaklanmada veya cikista sondaki sifirlarini kirpma
      inp.addEventListener("focus", () => {
        inp.dataset.kullaniciDegeri = inp.value;
      });

      inp.addEventListener("input", () => {
        inp.dataset.kullaniciDegeri = inp.value;
      });

      inp.addEventListener("blur", () => {
        if (inp.dataset.kullaniciDegeri !== undefined && inp.value !== inp.dataset.kullaniciDegeri) {
          inp.value = inp.dataset.kullaniciDegeri;
        }
      });
    });
  }

  // Mevcut veya eksik DOM bilesenlerini olustur
  function bilesenleriHazirla() {
    if (!document.getElementById("maasEkStil")) {
      const style = document.createElement("style");
      style.id = "maasEkStil";
      style.textContent = `
        #maasViewSection { max-width: 1440px; margin: 12px auto 28px auto; padding: 0 16px; }
        .maas-kart, .yatirim-kart { background: #fff; border: 1px solid #dbe4f0; border-radius: 10px; padding: 16px; margin-bottom: 14px; box-shadow: 0 2px 8px rgba(15,23,42,0.04); }
        .maas-ust, .yatirim-ust { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
        .maas-buton-grup { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .btn-mavi { background: #2563eb; color: #fff; border: none; padding: 8px 14px; border-radius: 6px; font-weight: 600; cursor: pointer; }
        .btn-mor { background: #0f766e; color: #fff; border: none; padding: 8px 14px; border-radius: 6px; font-weight: 600; cursor: pointer; }
        .btn-gri { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; }
        .btn-yesil { background: #16a34a; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; }
        .ortak-modal { position: fixed; inset: 0; background: rgba(15,23,42,0.5); display: flex; align-items: center; justify-content: center; z-index: 99999; }
        .ortak-modal[hidden] { display: none !important; }
        .ortak-modal-kutu { background: #fff; color: #0f172a; width: min(780px, 95vw); max-height: 90vh; overflow-y: auto; border-radius: 10px; padding: 18px 20px; box-shadow: 0 16px 40px rgba(0,0,0,0.28); }
        .ortak-modal-baslik { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 14px; }
        .form-izgara { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
        .form-izgara label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; }
        .form-izgara input, .form-izgara select { padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 5px; font-size: 14px; }
        .form-izgara input[readonly] { background: #f8fafc; font-weight: 700; }
        .donusum-kutu { margin-top: 14px; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; }
        .donusum-kutu h4 { margin: 0 0 10px 0; font-size: 14px; }
        .ozet-serit { display: flex; gap: 16px; flex-wrap: wrap; background: #eff6ff; border: 1px solid #bfdbfe; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-weight: 600; }
        .tiklanabilir-maas { cursor: pointer; text-decoration: underline; text-decoration-style: dotted; color: #1d4ed8; }
      `;
      document.head.appendChild(style);
    }

    // Maas sekme ve yatirimlar bolumu
    if (!document.getElementById("maasViewSection")) {
      const sec = document.createElement("section");
      sec.id = "maasViewSection";
      sec.hidden = true;
      sec.style.display = "none";
      sec.innerHTML = `
        <div class="maas-kart">
          <div class="maas-ust">
            <h2>Maaş Listesi</h2>
            <div class="maas-buton-grup">
              <button type="button" id="btnYeniMaasAc" class="btn-mavi">+ Yeni Maaş</button>
              <button type="button" id="btnYatirimlarAc" class="btn-mor">Yatırımlar</button>
            </div>
          </div>
          <div class="sheet-frame">
            <table class="excel-table" id="maasExcelTablosu">
              <thead>
                <tr>
                  <th>Dönem Ay</th><th>SGK</th><th>Ceza</th><th>Yatan</th><th>Ek</th><th>Elden</th>
                  <th>Hakediş</th><th>Maaş</th><th>DLR Kur</th><th>Nakit</th><th>İşlem</th>
                </tr>
              </thead>
              <tbody id="maasExcelBody"></tbody>
              <tfoot id="maasExcelFoot"></tfoot>
            </table>
          </div>
        </div>

        <div id="yatirimAltBolum" class="yatirim-kart">
          <div class="yatirim-ust">
            <h3>Yatırımlar Özeti</h3>
            <div class="maas-buton-grup">
              <button type="button" id="btnYatirimDetayToggle" class="btn-gri">Kapat</button>
            </div>
          </div>
          <div id="yatirimDetayIcerik">
            <div class="ozet-serit" id="yatirimOzetSerit"></div>
            <div class="sheet-frame">
              <table class="excel-table" id="yatirimGecmisTablosu">
                <thead>
                  <tr><th>Tarih</th><th>İşlem</th><th>Detay</th><th>Dolar Farkı</th><th>Nakit Farkı</th><th>Altın Farkı</th></tr>
                </thead>
                <tbody id="yatirimGecmisBody"></tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(sec);
    }

    // Yeni Maas Modal
    if (!document.getElementById("maasModal")) {
      const m = document.createElement("div");
      m.id = "maasModal";
      m.className = "ortak-modal";
      m.hidden = true;
      m.style.display = "none";
      m.innerHTML = `
        <div class="ortak-modal-kutu">
          <div class="ortak-modal-baslik">
            <h3>Yeni Maaş Kaydı</h3>
            <button type="button" id="btnCloseMaasModal" class="btn-gri">✕</button>
          </div>
          <form id="maasForm" class="form-izgara">
            <label>Dönem Ay <input type="month" id="maasDonem" required /></label>
            <label>SGK <input type="number" step="0.01" id="maasSgk" value="0" /></label>
            <label>Ceza <input type="number" step="0.01" id="maasCeza" value="0" /></label>
            <label>Yatan <input type="number" step="0.01" id="maasYatan" value="0" /></label>
            <label>Ek <input type="number" step="0.01" id="maasEk" value="0" /></label>
            <label>Elden <input type="number" step="0.01" id="maasElden" value="0" /></label>
            <label>Hakediş (Oto) <input type="text" id="maasHakedis" readonly /></label>
            <label>Maaş (Oto) <input type="text" id="maasNet" readonly /></label>
            <label>DLR Kur <input type="number" step="0.0001" id="maasKur" value="1" /></label>
            <label>Nakit (Oto) <input type="text" id="maasNakit" readonly /></label>
            <div style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
              <button type="button" id="btnCancelMaasModal" class="btn-gri">İptal</button>
              <button type="submit" class="btn-yesil">Kaydet</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(m);
    }

    // Yatirimlar Modal (Giris/Cikis, Manuel Dolar/Euro/Nakit/Altin, Toplam, Otomatik Donusum)
    if (!document.getElementById("yatirimModal")) {
      const ym = document.createElement("div");
      ym.id = "yatirimModal";
      ym.className = "ortak-modal";
      ym.hidden = true;
      ym.style.display = "none";
      ym.innerHTML = `
        <div class="ortak-modal-kutu">
          <div class="ortak-modal-baslik">
            <h3>Yatırımlar Giriş / Çıkış & Dönüşüm</h3>
            <button type="button" id="btnCloseYatirimModal" class="btn-gri">✕</button>
          </div>
          <div class="ozet-serit" id="modalYatirimMevcut"></div>
          <form id="yatirimForm">
            <div class="form-izgara">
              <label>İşlem Türü
                <select id="yatIslemTipi">
                  <option value="giris">Yeni Yatırım Girişi (+)</option>
                  <option value="cikis">Yatırım Çıkışı (-)</option>
                </select>
              </label>
              <label>Dolar ($) <input type="number" step="0.01" id="yatDolar" value="0" /></label>
              <label>Euro (€) <input type="number" step="0.01" id="yatEuro" value="0" /></label>
              <label>Nakit (₺) <input type="number" step="0.01" id="yatNakit" value="0" /></label>
              <label>Altın (gr) <input type="number" step="0.01" id="yatAltin" value="0" /></label>
              <label>Diğer <input type="number" step="0.01" id="yatDiger" value="0" /></label>
              <label>Girilen Kalemler Toplamı (Oto) <input type="text" id="yatGirilenToplam" readonly /></label>
              <label>Yeni Yatırımların Toplamı (Oto) <input type="text" id="yatYeniToplam" readonly /></label>
            </div>

            <div class="donusum-kutu">
              <h4>Otomatik Dönüşüm (Dolar → Nakit veya Nakit → Altın)</h4>
              <div class="form-izgara">
                <label>Dönüşüm Yönü
                  <select id="donusumYon">
                    <option value="yok">Dönüşüm Yapma</option>
                    <option value="usd_to_nakit">Dolardan Nakite Dönüştür ($ → ₺)</option>
                    <option value="nakit_to_altin">Nakiti Altına Çevir (₺ → gr)</option>
                  </select>
                </label>
                <label>Çevrilecek Miktar <input type="number" step="0.01" id="donusumMiktar" value="0" /></label>
                <label>Kur / Gram Fiyatı <input type="number" step="0.0001" id="donusumKur" value="1" /></label>
                <label>Dönüşüm Sonucu (Oto) <input type="text" id="donusumSonuc" readonly /></label>
              </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:14px;">
              <button type="button" id="btnCancelYatirimModal" class="btn-gri">Kapat</button>
              <button type="submit" class="btn-yesil">Uygula ve Kaydet</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(ym);
    }

    // Ana ekranda "Maas" yazisina tiklaninca acilan Kur -> Toplam -> Ana Maas + Yatirim Dolar Dusum Modal
    if (!document.getElementById("maasKurModal")) {
      const km = document.createElement("div");
      km.id = "maasKurModal";
      km.className = "ortak-modal";
      km.hidden = true;
      km.style.display = "none";
      km.innerHTML = `
        <div class="ortak-modal-kutu">
          <div class="ortak-modal-baslik">
            <h3>Önceki Ay Maaş (Dolar) → Kur ile Maaşa Ekle</h3>
            <button type="button" id="btnCloseMaasKurModal" class="btn-gri">✕</button>
          </div>
          <form id="maasKurForm" class="form-izgara">
            <label>Önceki Dönem <input type="text" id="mkOncekiDonem" readonly /></label>
            <label>Önceki Ay Maaş (Dolar $) <input type="number" step="0.01" id="mkOncekiDolar" readonly /></label>
            <label>Kur (₺ / $) <input type="number" step="0.0001" id="mkKur" value="0" placeholder="Kur girin" /></label>
            <label id="mkToplamAlan" style="display:none;">Toplam Tutar (Oto) <input type="text" id="mkToplamTutar" readonly /></label>
            <div style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
              <button type="button" id="btnCancelMaasKurModal" class="btn-gri">İptal</button>
              <button type="submit" class="btn-yesil">Tamam</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(km);
    }
  }

  function yatirimlariCiz() {
    const y = yatirimOku();
    const toplamVarlik = y.dolar + y.euro + y.nakit + y.altin + y.diger;
    const ozetHtml = `
      <span>Yatırımların Toplamı: <strong>${fmt(toplamVarlik)}</strong></span>
      <span>Dolar ($): <strong>${fmt(y.dolar)}</strong></span>
      <span>Euro (€): <strong>${fmt(y.euro)}</strong></span>
      <span>Nakit (₺): <strong>${fmt(y.nakit)}</strong></span>
      <span>Altın (gr): <strong>${fmt(y.altin)}</strong></span>
      <span>Diğer: <strong>${fmt(y.diger)}</strong></span>
    `;

    const ozetEl = document.getElementById("yatirimOzetSerit");
    const modalOzetEl = document.getElementById("modalYatirimMevcut");
    if (ozetEl) ozetEl.innerHTML = ozetHtml;
    if (modalOzetEl) modalOzetEl.innerHTML = ozetHtml;

    const altBolum = document.getElementById("yatirimAltBolum");
    const detayIcerik = document.getElementById("yatirimDetayIcerik");
    const toggleBtn = document.getElementById("btnYatirimDetayToggle");
    if (altBolum) {
      const maasKart = document.querySelector("#maasViewSection .maas-kart");
      if (maasKart && maasKart.nextElementSibling !== altBolum) {
        maasKart.insertAdjacentElement("afterend", altBolum);
      }
      if (detayIcerik) detayIcerik.style.display = y.acik ? "block" : "none";
      if (toggleBtn) toggleBtn.textContent = y.acik ? "Kapat" : "Aç";
    }

    const gecmisBody = document.getElementById("yatirimGecmisBody");
    if (gecmisBody) {
      const gecmis = yatirimGecmisOku();
      gecmisBody.innerHTML = gecmis.length
        ? gecmis
            .slice()
            .reverse()
            .map(
              (g) => `<tr>
                <td>${g.tarih}</td>
                <td>${g.islem}</td>
                <td>${g.detay}</td>
                <td>${fmt(g.dolarFark)}</td>
                <td>${fmt(g.nakitFark)}</td>
                <td>${fmt(g.altinFark)}</td>
              </tr>`
            )
            .join("")
        : `<tr><td colspan="6" style="text-align:center;color:#64748b;">Henüz yatırım hareketi yok.</td></tr>`;
    }
  }

  function yatirimFormHesapla() {
    const y = yatirimOku();
    const isaret = document.getElementById("yatIslemTipi")?.value === "cikis" ? -1 : 1;
    const d = parseNum(document.getElementById("yatDolar")?.value);
    const e = parseNum(document.getElementById("yatEuro")?.value);
    const n = parseNum(document.getElementById("yatNakit")?.value);
    const a = parseNum(document.getElementById("yatAltin")?.value);
    const di = parseNum(document.getElementById("yatDiger")?.value);

    const girilenToplam = d + e + n + a + di;
    const yon = document.getElementById("donusumYon")?.value || "yok";
    const donMiktar = parseNum(document.getElementById("donusumMiktar")?.value);
    const donKur = parseNum(document.getElementById("donusumKur")?.value);

    let donSonuc = 0;
    let dFark = isaret * d;
    let eFark = isaret * e;
    let nFark = isaret * n;
    let aFark = isaret * a;
    let diFark = isaret * di;

    if (yon === "usd_to_nakit" && donMiktar > 0 && donKur > 0) {
      donSonuc = donMiktar * donKur;
      dFark -= donMiktar;
      nFark += donSonuc;
    } else if (yon === "nakit_to_altin" && donMiktar > 0 && donKur > 0) {
      donSonuc = donMiktar / donKur;
      nFark -= donMiktar;
      aFark += donSonuc;
    }

    const yeniDolar = y.dolar + dFark;
    const yeniEuro = y.euro + eFark;
    const yeniNakit = y.nakit + nFark;
    const yeniAltin = y.altin + aFark;
    const yeniDiger = y.diger + diFark;
    const yeniToplam = yeniDolar + yeniEuro + yeniNakit + yeniAltin + yeniDiger;

    const elGirTop = document.getElementById("yatGirilenToplam");
    const elYeniTop = document.getElementById("yatYeniToplam");
    const elDonSonuc = document.getElementById("donusumSonuc");
    if (elGirTop) elGirTop.value = fmt(girilenToplam);
    if (elYeniTop) elYeniTop.value = fmt(yeniToplam);
    if (elDonSonuc) elDonSonuc.value = yon === "yok" ? "-" : fmt(donSonuc, 4);

    return {
      isaret,
      girilenToplam,
      yon,
      donMiktar,
      donKur,
      donSonuc,
      dFark,
      eFark,
      nFark,
      aFark,
      diFark,
      yeniDurum: {
        dolar: yeniDolar,
        euro: yeniEuro,
        nakit: yeniNakit,
        altin: yeniAltin,
        diger: yeniDiger,
        acik: true,
      },
    };
  }

  function anaMaasInputBul() {
    const satirlar = Array.from(document.querySelectorAll("tr"));
    const maasSatiri = satirlar.find((tr) => {
      const ilk = tr.querySelector("td, th");
      if (!ilk) return false;
      return /^Maaş\b/i.test((ilk.textContent || "").replace(/\s+/g, " ").trim());
    });
    return maasSatiri ? maasSatiri.querySelector("input") : null;
  }

  // Ana ekrandaki "Maas" yazisina tiklanabilir ozellik ekle
  function anaEkranMaasYazisiniBagla() {
    const satirlar = Array.from(document.querySelectorAll("tr"));
    satirlar.forEach((tr) => {
      const ilk = tr.querySelector("td, th");
      if (!ilk || ilk.dataset.maasTikBagli === "1") return;
      const metin = (ilk.textContent || "").replace(/\s+/g, " ").trim();
      if (/^Maaş\b/i.test(metin)) {
        ilk.dataset.maasTikBagli = "1";
        ilk.classList.add("tiklanabilir-maas");
        ilk.title = "Önceki ayın Dolar maaşını kur ile hesaplayıp eklemek için tıklayın";
        ilk.addEventListener("click", () => {
          const donemSel = document.querySelector("select");
          const aktifDonem = donemSel ? donemSel.value : "";
          const prevDonem = oncekiAy(aktifDonem);
          const kayitlar = maasKayitlariOku();
          const prevKayitlar = prevDonem ? kayitlar.filter((k) => k.donem === prevDonem) : [];
          // Onceki ay kaydi varsa onun dolar/maas tutarini, yoksa son kaydi baz al
          const kaynak = prevKayitlar.length ? prevKayitlar : kayitlar.slice(-1);
          const oncekiDolar = kaynak.reduce((s, r) => s + parseNum(r.maas), 0);

          const elPrevDonem = document.getElementById("mkOncekiDonem");
          const elPrevDolar = document.getElementById("mkOncekiDolar");
          const elKur = document.getElementById("mkKur");
          const elAlan = document.getElementById("mkToplamAlan");
          const elTop = document.getElementById("mkToplamTutar");
          const modal = document.getElementById("maasKurModal");

          if (elPrevDonem) elPrevDonem.value = prevDonem || (kaynak[0]?.donem || "-");
          if (elPrevDolar) elPrevDolar.value = oncekiDolar.toFixed(2);
          if (elKur) elKur.value = "";
          if (elAlan) elAlan.style.display = "none";
          if (elTop) elTop.value = "";
          if (modal) {
            modal.hidden = false;
            modal.style.display = "flex";
            elKur?.focus();
          }
        });
      }
    });
  }

  function maasKurHesapla() {
    const dolar = parseNum(document.getElementById("mkOncekiDolar")?.value);
    const kur = parseNum(document.getElementById("mkKur")?.value);
    const alan = document.getElementById("mkToplamAlan");
    const topEl = document.getElementById("mkToplamTutar");

    if (kur > 0) {
      const toplam = dolar * kur;
      if (alan) alan.style.display = "flex";
      if (topEl) topEl.value = fmt(toplam);
      return { dolar, kur, toplam };
    } else {
      if (alan) alan.style.display = "none";
      if (topEl) topEl.value = "";
      return { dolar, kur: 0, toplam: 0 };
    }
  }

  function maasTablosunuCiz() {
    const body = document.getElementById("maasExcelBody");
    const foot = document.getElementById("maasExcelFoot");
    if (!body || !foot) return;

    const list = maasKayitlariOku();
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#64748b;padding:16px;">Henüz maaş kaydı yok.</td></tr>';
      foot.innerHTML = "";
      return;
    }

    let tSgk = 0, tCeza = 0, tYatan = 0, tEk = 0, tElden = 0, tHak = 0, tMaas = 0, tNakit = 0;
    body.innerHTML = list
      .map((r, i) => {
        tSgk += parseNum(r.sgk);
        tCeza += parseNum(r.ceza);
        tYatan += parseNum(r.yatan);
        tEk += parseNum(r.ek);
        tElden += parseNum(r.elden);
        tHak += parseNum(r.hakedis);
        tMaas += parseNum(r.maas);
        tNakit += parseNum(r.nakit);
        return `<tr>
          <td>${r.donem || "-"}</td>
          <td>${fmt(r.sgk)}</td>
          <td>${fmt(r.ceza)}</td>
          <td>${fmt(r.yatan)}</td>
          <td>${fmt(r.ek)}</td>
          <td>${fmt(r.elden)}</td>
          <td><strong>${fmt(r.hakedis)}</strong></td>
          <td><strong>${fmt(r.maas)}</strong></td>
          <td>${fmt(r.kur, 4)}</td>
          <td><strong>${fmt(r.nakit)}</strong></td>
          <td><button type="button" class="maas-sil-btn" data-idx="${i}">Sil</button></td>
        </tr>`;
      })
      .join("");

    foot.innerHTML = `<tr>
      <td>TOPLAM</td><td>${fmt(tSgk)}</td><td>${fmt(tCeza)}</td><td>${fmt(tYatan)}</td>
      <td>${fmt(tEk)}</td><td>${fmt(tElden)}</td><td>${fmt(tHak)}</td><td>${fmt(tMaas)}</td>
      <td>-</td><td>${fmt(tNakit)}</td><td></td>
    </tr>`;
  }

  function ustMenuyeButonEkle() {
    if (document.getElementById("btnMaasTab")) return;
    const notlarBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      /^Notlar\b/i.test((b.textContent || "").trim())
    );
    const hesapBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      /Hesap Kalemi/i.test(b.textContent || "")
    );
    const refBtn = notlarBtn || hesapBtn;
    if (!refBtn || !refBtn.parentElement) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "btnMaasTab";
    btn.textContent = "Maaş";
    btn.className = (hesapBtn ? hesapBtn.className : refBtn.className)
      .replace(/\b(active|is-active|selected)\b/g, "")
      .trim();
    refBtn.insertAdjacentElement("afterend", btn);
  }

  function maasSekmesiAcKapat(zorlaKapat = false) {
    const view = document.getElementById("maasViewSection");
    const btn = document.getElementById("btnMaasTab");
    if (!view) return;

    const isOpen = !view.hidden && view.style.display !== "none";
    if (zorlaKapat || isOpen) {
      view.hidden = true;
      view.style.display = "none";
      if (btn) btn.classList.remove("active", "is-active", "selected");
      return;
    }

    const bar = btn?.parentElement;
    if (bar) {
      bar.querySelectorAll("button").forEach((b) => {
        if (b !== btn) b.classList.remove("active", "is-active", "selected");
      });
      if (bar.parentElement && bar.nextElementSibling !== view) {
        bar.parentElement.insertBefore(view, bar.nextElementSibling);
      }
    }
    if (btn) btn.classList.add("active");
    view.hidden = false;
    view.style.display = "block";
    maasTablosunuCiz();
    yatirimlariCiz();
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    if (btn.id === "btnMaasTab") {
      e.preventDefault();
      maasSekmesiAcKapat(false);
      return;
    }

    if (btn.id === "btnYeniMaasAc") {
      e.preventDefault();
      const modal = document.getElementById("maasModal");
      const donemEl = document.getElementById("maasDonem");
      const sel = document.querySelector("select");
      if (donemEl && sel && /^\d{4}-\d{2}$/.test(sel.value)) donemEl.value = sel.value;
      if (modal) {
        modal.hidden = false;
        modal.style.display = "flex";
      }
      return;
    }

    if (btn.id === "btnCloseMaasModal" || btn.id === "btnCancelMaasModal") {
      const modal = document.getElementById("maasModal");
      if (modal) {
        modal.hidden = true;
        modal.style.display = "none";
      }
      return;
    }

    // Yatirimlar butonu (+ Yeni Maas butonunun yaninda)
    if (btn.id === "btnYatirimlarAc") {
      e.preventDefault();
      const ym = document.getElementById("yatirimModal");
      yatirimlariCiz();
      yatirimFormHesapla();
      if (ym) {
        ym.hidden = false;
        ym.style.display = "flex";
      }
      return;
    }

    if (btn.id === "btnCloseYatirimModal" || btn.id === "btnCancelYatirimModal") {
      const ym = document.getElementById("yatirimModal");
      if (ym) {
        ym.hidden = true;
        ym.style.display = "none";
      }
      return;
    }

    if (btn.id === "btnYatirimDetayToggle") {
      const y = yatirimOku();
      y.acik = !y.acik;
      yatirimYaz(y);
      yatirimlariCiz();
      return;
    }

    if (btn.id === "btnCloseMaasKurModal" || btn.id === "btnCancelMaasKurModal") {
      const km = document.getElementById("maasKurModal");
      if (km) {
        km.hidden = true;
        km.style.display = "none";
      }
      return;
    }

    if (btn.classList.contains("maas-sil-btn")) {
      const idx = Number(btn.dataset.idx);
      const list = maasKayitlariOku();
      list.splice(idx, 1);
      maasKayitlariYaz(list);
      maasTablosunuCiz();
      return;
    }

    if (!btn.closest("#maasViewSection") && !btn.closest(".ortak-modal")) {
      maasSekmesiAcKapat(true);
    }
  });

  document.addEventListener("input", (e) => {
    const id = e.target?.id || "";
    if (["maasSgk", "maasCeza", "maasYatan", "maasEk", "maasElden", "maasKur"].includes(id)) {
      const sgk = parseNum(document.getElementById("maasSgk")?.value);
      const ceza = parseNum(document.getElementById("maasCeza")?.value);
      const yatan = parseNum(document.getElementById("maasYatan")?.value);
      const ek = parseNum(document.getElementById("maasEk")?.value);
      const elden = parseNum(document.getElementById("maasElden")?.value);
      const kur = parseNum(document.getElementById("maasKur")?.value);
      const hak = sgk + ceza + yatan + ek + elden;
      const maas = hak - sgk - ceza;
      const nakit = kur * maas;
      if (document.getElementById("maasHakedis")) document.getElementById("maasHakedis").value = fmt(hak);
      if (document.getElementById("maasNet")) document.getElementById("maasNet").value = fmt(maas);
      if (document.getElementById("maasNakit")) document.getElementById("maasNakit").value = fmt(nakit);
    }

    if (
      ["yatIslemTipi", "yatDolar", "yatEuro", "yatNakit", "yatAltin", "yatDiger", "donusumYon", "donusumMiktar", "donusumKur"].includes(id)
    ) {
      yatirimFormHesapla();
    }

    if (id === "mkKur") {
      maasKurHesapla();
    }
  });

  document.addEventListener("change", (e) => {
    const id = e.target?.id || "";
    if (["yatIslemTipi", "donusumYon"].includes(id)) {
      yatirimFormHesapla();
    }
  });

  document.addEventListener("submit", (e) => {
    const formId = e.target?.id || "";

    if (formId === "maasForm") {
      e.preventDefault();
      const sgk = parseNum(document.getElementById("maasSgk")?.value);
      const ceza = parseNum(document.getElementById("maasCeza")?.value);
      const yatan = parseNum(document.getElementById("maasYatan")?.value);
      const ek = parseNum(document.getElementById("maasEk")?.value);
      const elden = parseNum(document.getElementById("maasElden")?.value);
      const kur = parseNum(document.getElementById("maasKur")?.value);
      const hakedis = sgk + ceza + yatan + ek + elden;
      const maas = hakedis - sgk - ceza;
      const nakit = kur * maas;
      const donem = document.getElementById("maasDonem")?.value || "";

      const list = maasKayitlariOku();
      list.push({ donem, sgk, ceza, yatan, ek, elden, hakedis, maas, kur, nakit });
      maasKayitlariYaz(list);
      maasTablosunuCiz();

      const modal = document.getElementById("maasModal");
      if (modal) {
        modal.hidden = true;
        modal.style.display = "none";
      }
      e.target.reset();
      if (document.getElementById("maasKur")) document.getElementById("maasKur").value = "1";
    }

    if (formId === "yatirimForm") {
      e.preventDefault();
      const hesap = yatirimFormHesapla();
      yatirimYaz(hesap.yeniDurum);

      const gecmis = yatirimGecmisOku();
      gecmis.push({
        tarih: new Date().toLocaleString("tr-TR"),
        islem: hesap.isaret < 0 ? "Yatırım Çıkışı" : "Yatırım Girişi",
        detay:
          hesap.yon === "usd_to_nakit"
            ? `$${fmt(hesap.donMiktar)} → ₺${fmt(hesap.donSonuc)} (Kur: ${hesap.donKur})`
            : hesap.yon === "nakit_to_altin"
            ? `₺${fmt(hesap.donMiktar)} → ${fmt(hesap.donSonuc, 4)} gr Altın`
            : `Manuel Toplam: ${fmt(hesap.girilenToplam)}`,
        dolarFark: hesap.dFark,
        nakitFark: hesap.nFark,
        altinFark: hesap.aFark,
      });
      yatirimGecmisYaz(gecmis);
      yatirimlariCiz();

      const ym = document.getElementById("yatirimModal");
      if (ym) {
        ym.hidden = true;
        ym.style.display = "none";
      }
      e.target.reset();
    }

    if (formId === "maasKurForm") {
      e.preventDefault();
      const { dolar, kur, toplam } = maasKurHesapla();
      if (kur <= 0 || toplam <= 0) return;

      // 1. Ana formdaki Maas tutarina ilave et
      const anaInput = anaMaasInputBul();
      if (anaInput) {
        const mevcutTutar = parseNum(anaInput.value);
        const yeniTutar = mevcutTutar + toplam;
        anaInput.value = anaInput.type === "number" ? String(yeniTutar) : fmt(yeniTutar);
        anaInput.dataset.kullaniciDegeri = anaInput.value;
        anaInput.dispatchEvent(new Event("input", { bubbles: true }));
        anaInput.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // 2. Yatirimdaki Dolardan eksilt
      const y = yatirimOku();
      y.dolar = y.dolar - dolar;
      yatirimYaz(y);

      const gecmis = yatirimGecmisOku();
      gecmis.push({
        tarih: new Date().toLocaleString("tr-TR"),
        islem: "Maaş Kur Aktarımı",
        detay: `$${fmt(dolar)} × ${kur} = ${fmt(toplam)} ana maaşa eklendi`,
        dolarFark: -dolar,
        nakitFark: 0,
        altinFark: 0,
      });
      yatirimGecmisYaz(gecmis);
      yatirimlariCiz();

      const km = document.getElementById("maasKurModal");
      if (km) {
        km.hidden = true;
        km.style.display = "none";
      }
    }
  });

  bilesenleriHazirla();
  ustMenuyeButonEkle();
  anaEkranMaasYazisiniBagla();
  tutarAlanlariniKoru();
  maasTablosunuCiz();
  yatirimlariCiz();

  const mo = new MutationObserver(() => {
    ustMenuyeButonEkle();
    anaEkranMaasYazisiniBagla();
    tutarAlanlariniKoru();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();