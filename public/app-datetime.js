(function () {
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  /** @param {string} ymd */
  function formatDisplayDateYmd(ymd) {
    const s = String(ymd || "").trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return s || "-";
    return `${m[2]}/${m[3]}/${m[1]}`;
  }

  /** @param {string} hm HH:MM 24h */
  function formatDisplayTimeHm(hm) {
    const s = String(hm || "").trim();
    const match = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!match) return s || "-";
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return s || "-";
    const ap = hh >= 12 ? "p" : "a";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${pad2(mm)}${ap}`;
  }

  /** @param {Date|string|number} value */
  function formatDisplayDateInstant(value) {
    const dt = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dt.getTime())) return "-";
    return `${pad2(dt.getMonth() + 1)}/${pad2(dt.getDate())}/${dt.getFullYear()}`;
  }

  /** @param {Date|string|number} value */
  function formatDisplayTimeInstant(value) {
    const dt = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dt.getTime())) return "-";
    const hh = dt.getHours();
    const mm = dt.getMinutes();
    const ap = hh >= 12 ? "p" : "a";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${pad2(mm)}${ap}`;
  }

  /** @param {Date|string|number} value */
  function formatDisplayDateTimeInstant(value) {
    const d = formatDisplayDateInstant(value);
    const t = formatDisplayTimeInstant(value);
    if (d === "-" || t === "-") return "-";
    return `${d} ${t}`;
  }

  /** @param {string} dateText @param {string} timeText */
  function formatDisplayDateTimeParts(dateText, timeText) {
    const dp = String(dateText || "").trim();
    const tp = String(timeText || "").trim();
    const d = dp ? formatDisplayDateYmd(dp) : "";
    const t = tp ? formatDisplayTimeHm(tp) : "";
    if (!d && !t) return "-";
    if (!d) return t;
    if (!t) return d;
    return `${d} ${t}`;
  }

  window.RentelDateTime = {
    formatDisplayDateYmd,
    formatDisplayTimeHm,
    formatDisplayDateInstant,
    formatDisplayTimeInstant,
    formatDisplayDateTimeInstant,
    formatDisplayDateTimeParts,
  };
})();
