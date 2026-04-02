(() => {
  const STORAGE_KEY = "rentel.theme";
  const MOBILE_STYLE_ID = "rentel-mobile-helpers";
  const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504, 522, 524]);
  const FETCH_RETRY_DELAYS_MS = [450, 1_200, 2_500];
  const RENDER_KEEPALIVE_INTERVAL_MS = 4 * 60 * 1_000;
  const THEMES = {
    dark: {
      "--bg": "#0f1419",
      "--panel": "#1a2332",
      "--text": "#e7ecf3",
      "--muted": "#8b9cb3",
      "--accent": "#3d9cf5",
      "--border": "#2a3647",
      "--err": "#f06b6b",
    },
    light: {
      "--bg": "#f3f5f8",
      "--panel": "#ffffff",
      "--text": "#16212f",
      "--muted": "#5f7088",
      "--accent": "#2d7ed6",
      "--border": "#d3dbe7",
      "--err": "#c63d3d",
    },
  };

  function normalizeTheme(value) {
    return value === "light" ? "light" : "dark";
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function parseFetchMethod(input, init) {
    if (init && typeof init.method === "string" && init.method) {
      return init.method.toUpperCase();
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      return String(input.method || "GET").toUpperCase();
    }
    return "GET";
  }

  function parseFetchUrl(input) {
    if (typeof input === "string") return input;
    if (typeof URL !== "undefined" && input instanceof URL) return input.toString();
    if (typeof Request !== "undefined" && input instanceof Request) return input.url;
    return "";
  }

  function isAbortError(err) {
    return Boolean(err && typeof err === "object" && err.name === "AbortError");
  }

  function maybeInstallFetchResilience() {
    if (typeof window.fetch !== "function") return;
    if (window.__rentelFetchPatched) return;

    const nativeFetch = window.fetch.bind(window);
    window.__rentelFetchPatched = true;

    window.fetch = async (input, init) => {
      const method = parseFetchMethod(input, init);
      const isIdempotent = method === "GET" || method === "HEAD";
      if (!isIdempotent) {
        return nativeFetch(input, init);
      }

      let absoluteUrl = "";
      try {
        absoluteUrl = new URL(parseFetchUrl(input), window.location.href).toString();
      } catch {
        absoluteUrl = "";
      }
      const isSameOrigin =
        absoluteUrl && new URL(absoluteUrl).origin === window.location.origin;
      if (!isSameOrigin) {
        return nativeFetch(input, init);
      }

      let lastError = null;
      let lastResponse = null;

      for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          const requestInput =
            typeof Request !== "undefined" && input instanceof Request
              ? input.clone()
              : input;
          const response = await nativeFetch(requestInput, init);
          const shouldRetryStatus = RETRYABLE_HTTP_STATUSES.has(response.status);
          if (!shouldRetryStatus) {
            return response;
          }
          lastResponse = response;
        } catch (err) {
          if (isAbortError(err)) {
            throw err;
          }
          lastError = err;
        }

        if (attempt >= FETCH_RETRY_DELAYS_MS.length) {
          break;
        }
        await sleep(FETCH_RETRY_DELAYS_MS[attempt]);
      }

      if (lastResponse) {
        return lastResponse;
      }
      throw lastError || new Error("Request failed");
    };
  }

  function startRenderKeepalive() {
    const host = String(window.location.hostname || "").toLowerCase();
    if (!host.endsWith(".onrender.com")) return;

    const ping = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/health", {
        cache: "no-store",
        credentials: "same-origin",
      }).catch(() => {
        // Ignore keepalive failures while Render wakes up.
      });
    };

    ping();
    setInterval(ping, RENDER_KEEPALIVE_INTERVAL_MS);
  }

  function applyTheme(theme) {
    const normalized = normalizeTheme(theme);
    const vars = THEMES[normalized];
    const root = document.documentElement;
    Object.keys(vars).forEach((name) => {
      root.style.setProperty(name, vars[name]);
    });
    root.setAttribute("data-theme", normalized);
    try {
      localStorage.setItem(STORAGE_KEY, normalized);
    } catch {
      // Ignore localStorage failures.
    }
    return normalized;
  }

  function ensureMobileHelpers() {
    if (document.getElementById(MOBILE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = MOBILE_STYLE_ID;
    style.textContent = `
      img, svg {
        max-width: 100%;
        height: auto;
      }
      .top-nav .nav-link {
        align-items: center;
        justify-content: center;
        text-align: center;
      }
      .table-scroll {
        width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      .table-scroll > table {
        min-width: 620px;
      }
      .table-scroll > table.mobile-cards-table {
        min-width: 0;
      }
      @media (max-width: 1024px) {
        .layout-row,
        .techs-two-col {
          grid-template-columns: 1fr !important;
        }
        .grid-4 {
          grid-template-columns: repeat(2, minmax(150px, 1fr)) !important;
        }
        .grid-2 {
          grid-template-columns: 1fr !important;
        }
        .card-tech-entry {
          width: 100% !important;
          max-width: none !important;
        }
      }
      @media (max-width: 760px) {
        main {
          padding: 12px !important;
        }
        header {
          padding: 12px 14px !important;
        }
        .card {
          padding: 12px !important;
        }
        .field-grid,
        .grid,
        .grid-2,
        .grid-4,
        .inspect-grid,
        .layout-row {
          grid-template-columns: 1fr !important;
        }
        .btn,
        button,
        .nav-link,
        input,
        select,
        textarea {
          min-height: 42px !important;
          font-size: 16px !important;
        }
        .modal {
          width: 100% !important;
          max-width: 100% !important;
          max-height: 92vh !important;
        }
        .modal-actions {
          flex-wrap: wrap !important;
        }
        .modal-actions .btn,
        .modal-actions button {
          flex: 1 1 140px;
        }
      }
      @media (max-width: 560px) {
        .top-nav {
          flex-wrap: nowrap;
          overflow-x: auto;
          padding-bottom: 4px;
        }
        .top-nav .nav-link-admin {
          margin-left: 0;
        }
        .top-nav .nav-link {
          min-width: 88px;
          padding-left: 10px;
          padding-right: 10px;
        }
        .table-scroll > table {
          min-width: 520px;
        }
      }
    `;
    document.head.appendChild(style);

    const tables = Array.from(document.querySelectorAll("table"));
    for (const table of tables) {
      const parent = table.parentElement;
      if (!parent || parent.classList.contains("table-scroll")) continue;
      const wrapper = document.createElement("div");
      wrapper.className = "table-scroll";
      parent.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
  }

  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) applyTheme(cached);
    else applyTheme("dark");
  } catch {
    applyTheme("dark");
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        ensureMobileHelpers();
      },
      { once: true },
    );
  } else {
    ensureMobileHelpers();
  }

  maybeInstallFetchResilience();
  startRenderKeepalive();

  fetch("/api/admin/public-settings", { credentials: "same-origin" })
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      if (!payload || typeof payload.theme !== "string") return;
      const applied = applyTheme(payload.theme);
      window.RentelTheme = {
        getCurrentTheme: () => applied,
        applyTheme,
      };
    })
    .catch(() => {
      // Keep cached/default theme on errors.
    });

  window.RentelTheme = window.RentelTheme || {
    getCurrentTheme: () =>
      normalizeTheme(document.documentElement.getAttribute("data-theme") || "dark"),
    applyTheme,
  };
})();
