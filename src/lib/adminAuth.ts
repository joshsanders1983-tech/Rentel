import type { NextFunction, Request, Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";

const ADMIN_COOKIE_NAME = "rentel_admin_session";
const DEFAULT_ADMIN_PASSWORD = "admin";
const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours
const adminSessionToken = randomBytes(32).toString("hex");

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

function configuredAdminPassword(): string {
  return process.env.ADMIN_PASSWORD?.trim() || DEFAULT_ADMIN_PASSWORD;
}

export function isDefaultAdminPasswordInUse(): boolean {
  return !process.env.ADMIN_PASSWORD?.trim();
}

export function verifyAdminPassword(password: string): boolean {
  return safeEqual(password, configuredAdminPassword());
}

export function isAdminAuthenticated(req: Request): boolean {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[ADMIN_COOKIE_NAME] || "";
  return safeEqual(token, adminSessionToken);
}

export function setAdminSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(adminSessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}`,
  );
}

export function clearAdminSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isAdminAuthenticated(req)) {
    res.status(403).json({ error: "Admin authentication required." });
    return;
  }
  next();
}
