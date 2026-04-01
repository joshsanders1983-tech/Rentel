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
    document.addEventListener("DOMContentLoaded", ensureMobileHelpers, { once: true });
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
