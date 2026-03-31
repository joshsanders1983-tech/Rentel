import type { NextFunction, Request, Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma.js";

const TECH_COOKIE_NAME = "rentel_tech_session";
const DEFAULT_TECH_NAME = "Tech";
const DEFAULT_TECH_USERNAME = "Tech";
const DEFAULT_TECH_PASSWORD = "Tech";
const TECH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

type StoredTechSession = {
  technicianId: string;
  username: string;
  techName: string;
  expiresAt: number;
};

type TechnicianSessionIdentity = {
  technicianId: string;
  username: string;
  techName: string;
};

const techSessions = new Map<string, StoredTechSession>();

type TechnicianRow = {
  id: string;
  techName: string;
  username: string;
  password: string;
  active: boolean | number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function parseCookies(rawCookieHeader: string | undefined): Record<string, string> {
  if (!rawCookieHeader) return {};

  return rawCookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const eqIndex = part.indexOf("=");
      if (eqIndex <= 0) return acc;

      const key = part.slice(0, eqIndex).trim();
      const value = part.slice(eqIndex + 1).trim();
      if (!key) return acc;

      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function normalizeTechUsername(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeTechPassword(value: unknown): string {
  return String(value ?? "");
}

function normalizeTechName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function resolveTechDisplayName(techName: unknown, username: unknown): string {
  const normalizedTechName = normalizeTechName(techName);
  if (normalizedTechName) return normalizedTechName;
  const normalizedUsername = normalizeTechUsername(username);
  if (normalizedUsername) return normalizedUsername;
  return DEFAULT_TECH_NAME;
}

function normalizeActiveValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function normalizeDateValue(value: Date | string): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.valueOf()) ? parsed : new Date();
}

function readTechSessionToken(req: Request): string {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[TECH_COOKIE_NAME] || "";
}

function readStoredSession(token: string): StoredTechSession | null {
  if (!token) return null;
  const existing = techSessions.get(token);
  if (!existing) return null;
  if (!Number.isFinite(existing.expiresAt) || existing.expiresAt <= Date.now()) {
    techSessions.delete(token);
    return null;
  }
  return existing;
}

function clearSessionsForTechnician(technicianId: string): void {
  const targetId = String(technicianId || "").trim();
  if (!targetId) return;
  for (const [token, session] of techSessions.entries()) {
    if (session.technicianId === targetId) {
      techSessions.delete(token);
    }
  }
}

async function ensureDefaultTechnician(): Promise<void> {
  const countRows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*) AS count FROM "Technician"
  `;
  const count = Number(countRows[0]?.count ?? 0);
  if (count > 0) return;
  const nowIso = new Date().toISOString();
  const id = `tech_${randomBytes(12).toString("hex")}`;
  try {
    await prisma.$executeRaw`
      INSERT INTO "Technician" ("id", "techName", "username", "password", "active", "createdAt", "updatedAt")
      VALUES (${id}, ${DEFAULT_TECH_NAME}, ${DEFAULT_TECH_USERNAME}, ${DEFAULT_TECH_PASSWORD}, 1, ${nowIso}, ${nowIso})
    `;
  } catch {
    // Another request may have seeded the default technician first.
  }
}

function rowToTechnicianAccount(row: TechnicianRow): TechnicianAccount {
  return {
    id: row.id,
    techName: resolveTechDisplayName(row.techName, row.username),
    username: normalizeTechUsername(row.username),
    password: normalizeTechPassword(row.password),
    active: normalizeActiveValue(row.active),
    createdAt: normalizeDateValue(row.createdAt),
    updatedAt: normalizeDateValue(row.updatedAt),
  };
}

async function getTechnicianById(id: string): Promise<TechnicianAccount | null> {
  const rows = await prisma.$queryRaw<TechnicianRow[]>`
    SELECT "id", "techName", "username", "password", "active", "createdAt", "updatedAt"
    FROM "Technician"
    WHERE "id" = ${id}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return rowToTechnicianAccount(row);
}

export type TechnicianAccount = {
  id: string;
  techName: string;
  username: string;
  password: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function listTechnicians(): Promise<TechnicianAccount[]> {
  await ensureDefaultTechnician();
  const rows = await prisma.$queryRaw<TechnicianRow[]>`
    SELECT "id", "techName", "username", "password", "active", "createdAt", "updatedAt"
    FROM "Technician"
    ORDER BY "techName" COLLATE NOCASE ASC, "username" COLLATE NOCASE ASC
  `;
  return rows.map(rowToTechnicianAccount);
}

export async function createTechnician(
  techNameInput: unknown,
  usernameInput: unknown,
  passwordInput: unknown,
): Promise<TechnicianAccount> {
  const techName = normalizeTechName(techNameInput);
  const username = normalizeTechUsername(usernameInput);
  const password = normalizeTechPassword(passwordInput);

  if (!techName || !username || !password) {
    throw new Error("Tech name, username, and password are required.");
  }

  const existing = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id"
    FROM "Technician"
    WHERE "username" = ${username}
    LIMIT 1
  `;
  if (existing.length > 0) {
    throw new Error("That username is already in use.");
  }

  const nowIso = new Date().toISOString();
  const id = `tech_${randomBytes(12).toString("hex")}`;
  await prisma.$executeRaw`
    INSERT INTO "Technician" ("id", "techName", "username", "password", "active", "createdAt", "updatedAt")
    VALUES (${id}, ${techName}, ${username}, ${password}, 1, ${nowIso}, ${nowIso})
  `;
  const created = await getTechnicianById(id);
  if (!created) {
    throw new Error("Failed to create technician.");
  }
  return created;
}

export async function updateTechnician(
  technicianIdInput: unknown,
  techNameInput: unknown,
  usernameInput: unknown,
  passwordInput: unknown,
): Promise<TechnicianAccount> {
  const technicianId = String(technicianIdInput ?? "").trim();
  const techName = normalizeTechName(techNameInput);
  const username = normalizeTechUsername(usernameInput);
  const password = normalizeTechPassword(passwordInput);

  if (!technicianId) {
    throw new Error("Technician id is required.");
  }
  if (!techName || !username || !password) {
    throw new Error("Tech name, username, and password are required.");
  }

  const existingById = await getTechnicianById(technicianId);
  if (!existingById) {
    throw new Error("Technician not found.");
  }

  const usernameTaken = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id"
    FROM "Technician"
    WHERE "username" = ${username}
      AND "id" <> ${technicianId}
    LIMIT 1
  `;
  if (usernameTaken.length > 0) {
    throw new Error("That username is already in use.");
  }

  const nowIso = new Date().toISOString();
  await prisma.$executeRaw`
    UPDATE "Technician"
    SET
      "techName" = ${techName},
      "username" = ${username},
      "password" = ${password},
      "active" = 1,
      "updatedAt" = ${nowIso}
    WHERE "id" = ${technicianId}
  `;
  clearSessionsForTechnician(technicianId);
  const updated = await getTechnicianById(technicianId);
  if (!updated) {
    throw new Error("Technician not found.");
  }
  return updated;
}

export async function authenticateTechnician(
  usernameInput: unknown,
  passwordInput: unknown,
): Promise<TechnicianSessionIdentity | null> {
  await ensureDefaultTechnician();

  const username = normalizeTechUsername(usernameInput);
  const password = normalizeTechPassword(passwordInput);
  if (!username || !password) return null;

  const matches = await prisma.$queryRaw<TechnicianRow[]>`
    SELECT "id", "techName", "username", "password", "active", "createdAt", "updatedAt"
    FROM "Technician"
    WHERE "username" = ${username}
      AND "active" = 1
    LIMIT 1
  `;
  const firstMatch = matches[0];
  if (!firstMatch) return null;
  const technician = rowToTechnicianAccount(firstMatch);
  if (!safeEqual(password, technician.password)) return null;

  return {
    technicianId: technician.id,
    username: technician.username,
    techName: resolveTechDisplayName(technician.techName, technician.username),
  };
}

export function createTechSession(identity: TechnicianSessionIdentity): string {
  const token = randomBytes(32).toString("hex");
  techSessions.set(token, {
    technicianId: String(identity.technicianId || "").trim(),
    username: normalizeTechUsername(identity.username),
    techName: resolveTechDisplayName(identity.techName, identity.username),
    expiresAt: Date.now() + TECH_SESSION_MAX_AGE_SECONDS * 1000,
  });
  return token;
}

export function getTechSession(req: Request): TechnicianSessionIdentity | null {
  const token = readTechSessionToken(req);
  const stored = readStoredSession(token);
  if (!stored) return null;
  return {
    technicianId: stored.technicianId,
    username: stored.username,
    techName: stored.techName,
  };
}

export function isTechAuthenticated(req: Request): boolean {
  return Boolean(getTechSession(req));
}

export function setTechSessionCookie(res: Response, token: string): void {
  res.setHeader(
    "Set-Cookie",
    `${TECH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TECH_SESSION_MAX_AGE_SECONDS}`,
  );
}

export function clearTechSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `${TECH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

export function clearCurrentTechSession(req: Request, res: Response): void {
  const token = readTechSessionToken(req);
  if (token) {
    techSessions.delete(token);
  }
  clearTechSessionCookie(res);
}

export function requireTech(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isTechAuthenticated(req)) {
    res.status(403).json({ error: "Tech authentication required." });
    return;
  }
  next();
}
