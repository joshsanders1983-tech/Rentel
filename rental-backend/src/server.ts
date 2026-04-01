import "./loadEnv.js";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { isDefaultAdminPasswordInUse } from "./lib/adminAuth.js";
import { evaluateMaintenanceRulesForAllUnits } from "./lib/maintenanceAutomation.js";
import { isTechAuthenticated } from "./lib/techAuth.js";
import { apiAdminRouter } from "./routes/admin.js";
import { apiAssetsRouter } from "./routes/assets.js";
import { apiInventoryRouter } from "./routes/inventory.js";
import { apiInventoryStatusOptionsRouter } from "./routes/inventoryStatusOptions.js";
import { apiInspectionsRouter } from "./routes/inspections.js";
import { apiMaintenanceAutomationRouter } from "./routes/maintenanceAutomation.js";
import { apiReservationsRouter } from "./routes/reservations.js";
import { apiTechAuthRouter } from "./routes/techAuth.js";
import { migrateReservationsFromJsonFileIfNeeded } from "./lib/reservationsState.js";
import { isSupabaseJsConfigured } from "./lib/supabaseClient.js";

await migrateReservationsFromJsonFileIfNeeded();

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const brandingLogoPath =
  process.env.BRANDING_LOGO_PATH ||
  "C:\\Users\\Josh\\.cursor\\projects\\j-Rentel\\assets\\c__Users_Josh_AppData_Roaming_Cursor_User_workspaceStorage_b1d138578e147fd13d7993d6e7d0ce8c_images_ChatGPT_Image_Mar_31__2026__12_49_03_PM-1a92ac9c-c06a-4e6c-9189-d85ef0d2f861.png";

const app = express();
const port = Number(process.env.PORT) || 4000;
const MAINTENANCE_BACKSTOP_INTERVAL_MS = 24 * 60 * 60 * 1000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "rental-backend",
    time: new Date().toISOString(),
    supabaseJs: isSupabaseJsConfigured() ? "configured" : "not_configured",
  });
});

app.get("/branding/logo", (_req, res) => {
  if (!existsSync(brandingLogoPath)) {
    res.status(404).json({ error: "Branding logo not found." });
    return;
  }
  res.type("png");
  createReadStream(brandingLogoPath).pipe(res);
});

app.use("/api/assets", apiAssetsRouter);
app.use("/api/inventory", apiInventoryRouter);
app.use("/api/inventory-status-options", apiInventoryStatusOptionsRouter);
app.use("/api/inspections", apiInspectionsRouter);
app.use("/api/maintenance-automation", apiMaintenanceAutomationRouter);
app.use("/api/reservations", apiReservationsRouter);
app.use("/api/tech-auth", apiTechAuthRouter);
app.use("/api/admin", apiAdminRouter);

app.use((req, res, next) => {
  if (req.path === "/techs.html") {
    if (!isTechAuthenticated(req)) {
      res.redirect("/techs-login");
      return;
    }
  }
  next();
});

app.use(express.static(publicDir));

app.get("/", (_req, res) => {
  res.sendFile(join(publicDir, "dashboard.html"));
});

app.get("/dashboard", (_req, res) => {
  res.sendFile(join(publicDir, "dashboard.html"));
});

app.get("/reservations", (_req, res) => {
  res.sendFile(join(publicDir, "reservations.html"));
});

app.get("/on-rent", (_req, res) => {
  res.sendFile(join(publicDir, "on-rent.html"));
});

app.get("/returned", (_req, res) => {
  res.sendFile(join(publicDir, "returned.html"));
});

app.get("/inventory", (_req, res) => {
  res.sendFile(join(publicDir, "index.html"));
});

app.get("/maintenance", (_req, res) => {
  res.redirect("/techs");
});

app.get("/admin", (_req, res) => {
  res.sendFile(join(publicDir, "admin.html"));
});

app.get("/techs-login", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (isTechAuthenticated(req)) {
    res.redirect("/techs");
    return;
  }
  res.sendFile(join(publicDir, "tech-login.html"));
});

app.get("/techs", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!isTechAuthenticated(req)) {
    res.redirect("/techs-login");
    return;
  }
  res.sendFile(join(publicDir, "techs.html"));
});

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  },
);

const server = app.listen(port, () => {
  console.log(`Rental backend running on http://localhost:${port}`);
  console.log(`Open http://localhost:${port}/ in your browser for Dashboard.`);
  if (isDefaultAdminPasswordInUse()) {
    console.warn(
      "ADMIN_PASSWORD is not set. Using default admin password 'admin'. Set ADMIN_PASSWORD in .env.",
    );
  }
  const runMaintenanceBackstop = async (source: string) => {
    try {
      await evaluateMaintenanceRulesForAllUnits();
      console.log(`[maintenance-automation] Rule recheck completed (${source}).`);
    } catch (err) {
      console.error(`[maintenance-automation] Rule recheck failed (${source}).`, err);
    }
  };

  void runMaintenanceBackstop("startup");
  const backstopTimer = setInterval(() => {
    void runMaintenanceBackstop("daily-backstop");
  }, MAINTENANCE_BACKSTOP_INTERVAL_MS);
  backstopTimer.unref();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Change PORT in .env.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
