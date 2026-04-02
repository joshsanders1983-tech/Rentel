import { Router } from "express";
import { requireAdmin } from "../lib/adminAuth.js";
import {
  authenticateTechnician,
  clearCurrentTechSession,
  createTechSession,
  createTechnician,
  deleteTechnician,
  getTechSession,
  listTechnicians,
  requireTech,
  setTechSessionCookie,
  updateTechnician,
} from "../lib/techAuth.js";

export const apiTechAuthRouter = Router();

apiTechAuthRouter.get("/session", (req, res) => {
  const activeSession = getTechSession(req);
  res.json({
    authenticated: Boolean(activeSession),
    technicianId: activeSession ? activeSession.technicianId : "",
    techName: activeSession ? activeSession.techName : "",
    username: activeSession ? activeSession.username : "",
  });
});

apiTechAuthRouter.post("/login", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username.trim() || !password) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }

  const identity = await authenticateTechnician(username, password);
  if (!identity) {
    res.status(401).json({ error: "Invalid tech username or password." });
    return;
  }

  const token = createTechSession(identity);
  setTechSessionCookie(res, token);
  res.json({
    ok: true,
    sessionToken: token,
    technicianId: identity.technicianId,
    techName: identity.techName,
    username: identity.username,
    tokenType: "Bearer",
  });
});

apiTechAuthRouter.post("/logout", (req, res) => {
  clearCurrentTechSession(req, res);
  res.status(204).send();
});

apiTechAuthRouter.get("/technicians", requireAdmin, async (_req, res) => {
  const technicians = await listTechnicians();
  res.json(technicians);
});

/** Display names for maintenance task assignment (no passwords). */
apiTechAuthRouter.get("/technician-directory", requireTech, async (_req, res) => {
  const technicians = await listTechnicians();
  res.json(
    technicians.map((t) => ({
      id: t.id,
      techName: t.techName,
      username: t.username,
    })),
  );
});

apiTechAuthRouter.post("/technicians", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  try {
    const created = await createTechnician(
      body.techName,
      body.username,
      body.password,
    );
    res.status(201).json(created);
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : "";
    res.status(400).json({
      error: message || "Tech name, username, and password are required.",
    });
  }
});

apiTechAuthRouter.patch("/technicians/:id", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  try {
    const updated = await updateTechnician(
      req.params.id,
      body.techName,
      body.username,
      body.password,
    );
    res.json(updated);
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : "";
    const lowered = message.toLowerCase();
    if (lowered.includes("not found")) {
      res.status(404).json({ error: message || "Technician not found." });
      return;
    }
    res.status(400).json({
      error: message || "Tech name, username, and password are required.",
    });
  }
});

apiTechAuthRouter.delete("/technicians/:id", requireAdmin, async (req, res) => {
  try {
    await deleteTechnician(req.params.id);
    res.status(204).send();
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : "";
    const lowered = message.toLowerCase();
    if (lowered.includes("not found")) {
      res.status(404).json({ error: message || "Technician not found." });
      return;
    }
    res.status(400).json({ error: message || "Unable to delete technician." });
  }
});
