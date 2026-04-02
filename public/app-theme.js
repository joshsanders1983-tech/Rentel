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
        --plate-base-a: #222f40;
        --plate-base-b: #151f2c;
        --plate-shadow: rgba(0, 0, 0, 0.38);
        --plate-hi: rgba(255, 255, 255, 0.2);
        position: relative;
        isolation: isolate;
        overflow: hidden;
        background: linear-gradient(150deg, var(--plate-base-a) 0%, var(--plate-base-b) 58%, var(--accent) 220%);
        border-bottom: 1px solid var(--border);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), inset 0 -1px 0 rgba(0, 0, 0, 0.42);
      }
      html[data-theme="light"] body > header {
        --plate-base-a: #edf3fb;
        --plate-base-b: #d6e2f0;
        --plate-shadow: rgba(30, 54, 86, 0.2);
        --plate-hi: rgba(255, 255, 255, 0.72);
        background: linear-gradient(150deg, var(--plate-base-a) 0%, var(--plate-base-b) 58%, #aacbf1 220%);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), inset 0 -1px 0 rgba(34, 55, 84, 0.18);
      }
      body > header::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: 0.92;
        background:
          repeating-linear-gradient(
            -27deg,
            transparent 0 18px,
            var(--plate-hi) 18px 22px,
            rgba(255, 255, 255, 0.05) 22px 27px,
            var(--plate-shadow) 27px 31px,
            transparent 31px 62px
          ),
          repeating-linear-gradient(
            -27deg,
            transparent 0 18px,
            rgba(255, 255, 255, 0.11) 18px 22px,
            rgba(255, 255, 255, 0.03) 22px 27px,
            rgba(0, 0, 0, 0.25) 27px 31px,
            transparent 31px 62px
          );
        background-size: 124px 64px, 124px 64px;
        background-position: 0 0, 62px 32px;
      }
      html[data-theme="light"] body > header::before {
        opacity: 0.88;
      }
      body > header::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background:
          linear-gradient(176deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0) 38%),
          linear-gradient(6deg, rgba(0, 0, 0, 0) 45%, rgba(0, 0, 0, 0.25) 100%),
          repeating-linear-gradient(104deg, rgba(255, 255, 255, 0.07) 0 1px, rgba(255, 255, 255, 0) 1px 14px);
      }
      html[data-theme="light"] body > header::after {
        background:
          linear-gradient(176deg, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0) 42%),
          linear-gradient(8deg, rgba(23, 44, 78, 0) 46%, rgba(23, 44, 78, 0.12) 100%),
          repeating-linear-gradient(104deg, rgba(255, 255, 255, 0.2) 0 1px, rgba(255, 255, 255, 0) 1px 14px);
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
