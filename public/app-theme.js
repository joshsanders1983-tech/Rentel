(() => {
  const STORAGE_KEY = "rentel.theme";
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

  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) applyTheme(cached);
    else applyTheme("dark");
  } catch {
    applyTheme("dark");
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
