import { Router } from "express";
import {
  clearAdminSessionCookie,
  isAdminAuthenticated,
  isDefaultAdminPasswordInUse,
  requireAdmin,
  setAdminSessionCookie,
  verifyAdminPassword,
} from "../lib/adminAuth.js";
import { prisma } from "../lib/prisma.js";

export const apiAdminRouter = Router();

type SettingsRow = {
  theme: string;
  logoMime: string | null;
};

function normalizeTheme(input: unknown): "dark" | "light" | null {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (value === "dark" || value === "light") return value;
  return null;
}

async function getSettingsRow(): Promise<SettingsRow> {
  const rows = await prisma.$queryRaw<SettingsRow[]>`
    SELECT "theme", "logoMime"
    FROM "AppSettings"
    WHERE "id" = 'default'
    LIMIT 1
  `;
  if (rows[0]) return rows[0];
  await prisma.$executeRaw`
    INSERT INTO "AppSettings" ("id", "theme")
    VALUES ('default', 'dark')
    ON CONFLICT ("id") DO NOTHING
  `;
  return { theme: "dark", logoMime: null };
}

apiAdminRouter.get("/session", (req, res) => {
  res.json({
    authenticated: isAdminAuthenticated(req),
    defaultPasswordInUse: isDefaultAdminPasswordInUse(),
  });
});

apiAdminRouter.get("/public-settings", async (_req, res) => {
  const row = await getSettingsRow();
  const theme = normalizeTheme(row.theme) || "dark";
  res.json({ theme });
});

apiAdminRouter.get("/settings", requireAdmin, async (_req, res) => {
  const row = await getSettingsRow();
  const theme = normalizeTheme(row.theme) || "dark";
  res.json({
    theme,
    hasLogo: Boolean(row.logoMime),
    logoMime: row.logoMime || null,
  });
});

apiAdminRouter.patch("/settings/theme", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const theme = normalizeTheme(body.theme);
  if (!theme) {
    res.status(400).json({ error: "Theme must be dark or light." });
    return;
  }
  await prisma.$executeRaw`
    INSERT INTO "AppSettings" ("id", "theme")
    VALUES ('default', ${theme})
    ON CONFLICT ("id")
    DO UPDATE SET "theme" = EXCLUDED."theme", "updatedAt" = CURRENT_TIMESTAMP
  `;
  res.json({ ok: true, theme });
});

apiAdminRouter.post("/settings/logo", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl.trim() : "";
  const matches = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!matches) {
    res.status(400).json({ error: "Logo must be a PNG, JPG, GIF, or WEBP image." });
    return;
  }
  const rawMimeMatch = matches[1];
  const base64Match = matches[2];
  if (!rawMimeMatch || !base64Match) {
    res.status(400).json({ error: "Invalid logo payload." });
    return;
  }
  const rawMime = rawMimeMatch.toLowerCase();
  const logoMime = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
  const buffer = Buffer.from(base64Match, "base64");
  if (buffer.length === 0) {
    res.status(400).json({ error: "Uploaded logo is empty." });
    return;
  }
  if (buffer.length > 5 * 1024 * 1024) {
    res.status(400).json({ error: "Logo must be 5MB or smaller." });
    return;
  }
  await prisma.$executeRaw`
    INSERT INTO "AppSettings" ("id", "theme", "logoMime", "logoBytes")
    VALUES ('default', 'dark', ${logoMime}, ${buffer})
    ON CONFLICT ("id")
    DO UPDATE SET
      "logoMime" = EXCLUDED."logoMime",
      "logoBytes" = EXCLUDED."logoBytes",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
  res.status(201).json({ ok: true, logoMime });
});

apiAdminRouter.delete("/settings/logo", requireAdmin, async (_req, res) => {
  await prisma.$executeRaw`
    INSERT INTO "AppSettings" ("id", "theme", "logoMime", "logoBytes")
    VALUES ('default', 'dark', NULL, NULL)
    ON CONFLICT ("id")
    DO UPDATE SET
      "logoMime" = NULL,
      "logoBytes" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
  `;
  res.status(204).send();
});

apiAdminRouter.post("/login", (req, res) => {
  const body = req.body as Record<string, unknown>;
  const password = typeof body.password === "string" ? body.password : "";

  if (!password) {
    res.status(400).json({ error: "Password is required." });
    return;
  }

  if (!verifyAdminPassword(password)) {
    res.status(401).json({ error: "Invalid admin password." });
    return;
  }

  setAdminSessionCookie(res);
  res.json({ ok: true });
});

apiAdminRouter.post("/logout", (_req, res) => {
  clearAdminSessionCookie(res);
  res.status(204).send();
});
