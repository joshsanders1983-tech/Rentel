import { Router } from "express";
import {
  clearAdminSessionCookie,
  isAdminAuthenticated,
  isDefaultAdminPasswordInUse,
  setAdminSessionCookie,
  verifyAdminPassword,
} from "../lib/adminAuth.js";

export const apiAdminRouter = Router();

apiAdminRouter.get("/session", (req, res) => {
  res.json({
    authenticated: isAdminAuthenticated(req),
    defaultPasswordInUse: isDefaultAdminPasswordInUse(),
  });
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
