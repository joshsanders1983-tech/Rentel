(() => {
  const STORAGE_KEY = "rentel.theme";
  const HEADER_STYLE_ID = "rentel-header-plate";
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

  function ensureHeaderPlateStyles() {
    if (document.getElementById(HEADER_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = HEADER_STYLE_ID;
    style.textContent = `
      body > header {
        position: relative;
        isolation: isolate;
        overflow: hidden;
        background: linear-gradient(160deg, var(--panel) 0%, #121a26 62%, var(--accent) 185%);
        border-bottom: 1px solid var(--border);
        box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      }
      html[data-theme="light"] body > header {
        background: linear-gradient(160deg, #f7fbff 0%, #dde8f6 62%, #b9d7f8 185%);
        box-shadow: inset 0 -1px 0 rgba(22, 33, 47, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.65);
      }
      body > header::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: 0.75;
        background:
          repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.14) 0 1px, rgba(255, 255, 255, 0) 1px 30px),
          repeating-linear-gradient(-45deg, rgba(0, 0, 0, 0.3) 0 1px, rgba(0, 0, 0, 0) 1px 30px);
      }
      html[data-theme="light"] body > header::before {
        opacity: 0.45;
        background:
          repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.75) 0 1px, rgba(255, 255, 255, 0) 1px 30px),
          repeating-linear-gradient(-45deg, rgba(23, 44, 78, 0.14) 0 1px, rgba(23, 44, 78, 0) 1px 30px);
      }
      body > header::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(165deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0) 42%, rgba(0, 0, 0, 0.28) 100%);
      }
      html[data-theme="light"] body > header::after {
        background: linear-gradient(165deg, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0) 50%, rgba(23, 44, 78, 0.08) 100%);
      }
      body > header > * {
        position: relative;
        z-index: 1;
      }
      body > header h1 {
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.28);
      }
      html[data-theme="light"] body > header h1 {
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
      }
    `;
    document.head.appendChild(style);
  }

  function ensureMobileHelpers() {
    if (document.getElementById(MOBILE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = MOBILE_STYLE_ID;
    style.textContent = `
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
        min-width: 640px;
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
        .btn {
          min-height: 40px;
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
        ensureHeaderPlateStyles();
        ensureMobileHelpers();
      },
      { once: true },
    );
  } else {
    ensureHeaderPlateStyles();
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
