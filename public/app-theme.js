(() => {
  const STORAGE_KEY = "rentel.theme";
  const MOBILE_STYLE_ID = "rentel-mobile-helpers";
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
