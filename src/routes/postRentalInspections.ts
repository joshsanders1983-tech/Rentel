import { Router } from "express";
import { createSign } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireTech } from "../lib/techAuth.js";

export const apiPostRentalInspectionsRouter = Router();

const DEFAULT_SPREADSHEET_ID = "1amsUbJfgmT6b_A0CSym9BOpQlsx8vTFuoX1zgOeqPw4";
const DEFAULT_SHEET_GID = 0;
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";

type StoredPostRentalInspectionRow = {
  id: string;
  inspectionSubmissionId: string;
  inventoryId: string;
  unitNumberSnapshot: string;
  assetTypeSnapshot: string | null;
  assetDescriptionSnapshot: string | null;
  techNameSnapshot: string | null;
  submittedAt: Date;
  issueDescription: string | null;
  damageDescription: string | null;
  damagePhotosJson: Prisma.JsonValue;
  flaggedItemsJson: Prisma.JsonValue;
  createdAt: Date;
};

type PostRentalFlaggedItem = {
  label: string;
  selectedOption: string;
};

type OffloadSettingsRow = {
  offloadPostRentalInspectionsLocation: string | null;
};

type ResolvedOffloadConfig = {
  spreadsheetId: string;
  sheetGid: number;
  googleSheetsClientEmail: string;
  googleSheetsPrivateKey: string;
};

function parseSpreadsheetLocation(
  rawLocation: string,
): { spreadsheetId: string; sheetGid: number | null } | null {
  const location = String(rawLocation || "").trim();
  if (!location) return null;
  const directIdMatch = location.match(/^[A-Za-z0-9-_]{20,}$/);
  if (directIdMatch) {
    return { spreadsheetId: directIdMatch[0], sheetGid: null };
  }
  try {
    const url = new URL(location);
    const pathMatch = url.pathname.match(/\/spreadsheets\/d\/([A-Za-z0-9-_]+)/);
    const spreadsheetId = pathMatch?.[1] || "";
    if (!spreadsheetId) return null;
    const gidRaw = url.searchParams.get("gid");
    const parsedGid = gidRaw === null ? Number.NaN : Number(gidRaw);
    return {
      spreadsheetId,
      sheetGid: Number.isInteger(parsedGid) && parsedGid >= 0 ? parsedGid : null,
    };
  } catch {
    return null;
  }
}

async function loadOffloadConfig(): Promise<ResolvedOffloadConfig> {
  const rows = await prisma.$queryRaw<OffloadSettingsRow[]>`
    SELECT
      "offloadPostRentalInspectionsLocation"
    FROM "AppSettings"
    WHERE "id" = 'default'
    LIMIT 1
  `;
  const row = rows[0];
  const locationParsed = parseSpreadsheetLocation(
    row?.offloadPostRentalInspectionsLocation ? String(row.offloadPostRentalInspectionsLocation) : "",
  );
  const envSheetId = process.env.POST_RENTAL_INSPECTIONS_SHEET_ID?.trim() || "";
  const spreadsheetId = locationParsed?.spreadsheetId || envSheetId || DEFAULT_SPREADSHEET_ID;

  const envGidRaw = process.env.POST_RENTAL_INSPECTIONS_SHEET_GID?.trim() || "";
  const envGidParsed = Number(envGidRaw);
  const envGid =
    Number.isInteger(envGidParsed) && envGidParsed >= 0 ? envGidParsed : null;
  const sheetGid = locationParsed?.sheetGid ?? envGid ?? DEFAULT_SHEET_GID;

  const envClientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim() || "";
  const envPrivateKeyRaw = process.env.GOOGLE_SHEETS_PRIVATE_KEY || "";
  const envPrivateKey = envPrivateKeyRaw.replace(/\\n/g, "\n").trim();

  return {
    spreadsheetId,
    sheetGid,
    googleSheetsClientEmail: envClientEmail,
    googleSheetsPrivateKey: envPrivateKey,
  };
}

function parseFlaggedItems(raw: Prisma.JsonValue): PostRentalFlaggedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PostRentalFlaggedItem[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const label = String(record.label ?? "").trim();
    const selectedOption = String(record.selectedOption ?? "").trim();
    if (!label || !selectedOption) continue;
    out.push({ label, selectedOption });
  }
  return out;
}

function parseDamagePhotos(raw: Prisma.JsonValue): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    const photo = String(value ?? "").trim();
    if (!photo) continue;
    out.push(photo);
  }
  return out;
}

function buildFlaggedItemsFromSubmissionResults(
  results: Array<{
    labelSnapshot: string;
    selectedNeedsAttention: boolean;
    selectedDamaged: boolean;
  }>,
): PostRentalFlaggedItem[] {
  const flagged: PostRentalFlaggedItem[] = [];
  for (const result of results) {
    const label = String(result.labelSnapshot || "").trim();
    if (!label) continue;
    if (result.selectedNeedsAttention) {
      flagged.push({ label, selectedOption: "Needs attention" });
      continue;
    }
    if (result.selectedDamaged) {
      flagged.push({ label, selectedOption: "Damaged" });
    }
  }
  return flagged;
}

async function backfillPostRentalInspectionQueue(): Promise<number> {
  const [existingRows, flaggedSubmissions] = await Promise.all([
    prisma.postRentalInspection.findMany({
      select: { inspectionSubmissionId: true },
    }),
    prisma.inspectionSubmission.findMany({
      where: {
        itemResults: {
          some: {
            OR: [{ selectedNeedsAttention: true }, { selectedDamaged: true }],
          },
        },
      },
      include: {
        inventory: {
          include: { asset: true },
        },
        itemResults: {
          select: {
            labelSnapshot: true,
            selectedNeedsAttention: true,
            selectedDamaged: true,
          },
        },
      },
      orderBy: { submittedAt: "desc" },
    }),
  ]);

  const existingSubmissionIds = new Set(
    existingRows
      .map((row) => String(row.inspectionSubmissionId || "").trim())
      .filter(Boolean),
  );

  const rowsToCreate: Array<{
    inspectionSubmissionId: string;
    inventoryId: string;
    unitNumberSnapshot: string;
    assetTypeSnapshot: string | null;
    assetDescriptionSnapshot: string | null;
    techNameSnapshot: string | null;
    submittedAt: Date;
    issueDescription: string | null;
    damageDescription: string | null;
    damagePhotosJson: Prisma.InputJsonValue;
    flaggedItemsJson: Prisma.InputJsonValue;
  }> = [];

  for (const submission of flaggedSubmissions) {
    const submissionId = String(submission.id || "").trim();
    if (!submissionId || existingSubmissionIds.has(submissionId)) continue;

    const flaggedItems = buildFlaggedItemsFromSubmissionResults(submission.itemResults || []);
    if (flaggedItems.length === 0) continue;

    rowsToCreate.push({
      inspectionSubmissionId: submissionId,
      inventoryId: submission.inventoryId,
      unitNumberSnapshot: submission.inventory.unitNumber,
      assetTypeSnapshot: submission.inventory.asset?.type ?? null,
      assetDescriptionSnapshot: submission.inventory.asset?.description ?? null,
      techNameSnapshot: submission.submittedByTechName ?? null,
      submittedAt: submission.submittedAt,
      issueDescription: null,
      damageDescription: null,
      damagePhotosJson: [] as Prisma.InputJsonValue,
      flaggedItemsJson: flaggedItems as unknown as Prisma.InputJsonValue,
    });
  }

  if (rowsToCreate.length === 0) {
    return 0;
  }

  const created = await prisma.postRentalInspection.createMany({
    data: rowsToCreate,
    skipDuplicates: true,
  });
  return Number(created.count || 0);
}

function toBase64UrlJson(value: object): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function getGoogleSheetsAccessToken(config: ResolvedOffloadConfig): Promise<string> {
  const clientEmail = config.googleSheetsClientEmail;
  const privateKey = config.googleSheetsPrivateKey;

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Google Sheets credentials are not configured. Set GOOGLE_SHEETS_CLIENT_EMAIL and GOOGLE_SHEETS_PRIVATE_KEY in environment variables.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = toBase64UrlJson({ alg: "RS256", typ: "JWT" });
  const claimSet = toBase64UrlJson({
    iss: clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_AUDIENCE,
    iat: now,
    exp: now + 3600,
  });
  const unsignedJwt = `${header}.${claimSet}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(privateKey, "base64url");
  const jwt = `${unsignedJwt}.${signature}`;

  const tokenRes = await fetch(GOOGLE_TOKEN_AUDIENCE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const tokenText = await tokenRes.text();
  let tokenData: { access_token?: string; error_description?: string; error?: string } = {};
  try {
    tokenData = tokenText ? (JSON.parse(tokenText) as typeof tokenData) : {};
  } catch {
    tokenData = {};
  }
  if (!tokenRes.ok || !tokenData.access_token) {
    const errDetail = tokenData.error_description || tokenData.error || tokenText || "unknown error";
    throw new Error(`Failed to authenticate with Google Sheets: ${errDetail}`);
  }
  return tokenData.access_token;
}

async function resolveSheetTitle(
  spreadsheetId: string,
  sheetGid: number,
  accessToken: string,
): Promise<string> {
  const metadataRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,title))`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const metadataText = await metadataRes.text();
  let metadata: {
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
      };
    }>;
  } = {};
  try {
    metadata = metadataText ? (JSON.parse(metadataText) as typeof metadata) : {};
  } catch {
    metadata = {};
  }
  if (!metadataRes.ok) {
    throw new Error(
      `Failed to read spreadsheet metadata: ${metadataText || metadataRes.statusText || "request failed"}`,
    );
  }

  const sheets = Array.isArray(metadata.sheets) ? metadata.sheets : [];
  const matchedByGid = sheets.find((sheet) => sheet.properties?.sheetId === sheetGid);
  const firstSheet = sheets[0];
  const title = (matchedByGid?.properties?.title || firstSheet?.properties?.title || "").trim();
  if (!title) {
    throw new Error("No worksheet tab found in the target spreadsheet.");
  }
  return title;
}

async function appendRowsToSheet(
  spreadsheetId: string,
  sheetTitle: string,
  accessToken: string,
  rows: string[][],
): Promise<void> {
  const range = `${sheetTitle}!A1`;
  const appendUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const appendRes = await fetch(appendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      majorDimension: "ROWS",
      values: rows,
    }),
  });
  if (!appendRes.ok) {
    const text = await appendRes.text();
    throw new Error(`Failed to append rows to Google Sheet: ${text || appendRes.statusText}`);
  }
}

function buildExportRows(entry: StoredPostRentalInspectionRow): string[][] {
  const flaggedItems = parseFlaggedItems(entry.flaggedItemsJson);
  const damagePhotos = parseDamagePhotos(entry.damagePhotosJson).join(" | ");
  const submittedAtIso = entry.submittedAt.toISOString();
  const createdAtIso = entry.createdAt.toISOString();
  const baseColumns = [
    submittedAtIso,
    createdAtIso,
    entry.unitNumberSnapshot,
    entry.inventoryId,
    entry.assetTypeSnapshot || "",
    entry.assetDescriptionSnapshot || "",
    entry.techNameSnapshot || "",
    entry.issueDescription || "",
    entry.damageDescription || "",
    damagePhotos,
    entry.inspectionSubmissionId,
    entry.id,
  ];

  if (flaggedItems.length === 0) {
    return [[...baseColumns, "", ""]];
  }
  return flaggedItems.map((item) => [...baseColumns, item.label, item.selectedOption]);
}

apiPostRentalInspectionsRouter.get("/", requireTech, async (_req, res) => {
  try {
    await backfillPostRentalInspectionQueue();

    const rows = (await prisma.postRentalInspection.findMany({
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    })) as StoredPostRentalInspectionRow[];

    res.json(
      rows.map((row) => ({
        id: row.id,
        inspectionSubmissionId: row.inspectionSubmissionId,
        inventoryId: row.inventoryId,
        unitNumber: row.unitNumberSnapshot,
        assetType: row.assetTypeSnapshot || "",
        assetDescription: row.assetDescriptionSnapshot || "",
        techName: row.techNameSnapshot || "",
        submittedAt: row.submittedAt,
        createdAt: row.createdAt,
        issueDescription: row.issueDescription || "",
        damageDescription: row.damageDescription || "",
        damagePhotos: parseDamagePhotos(row.damagePhotosJson),
        flaggedItems: parseFlaggedItems(row.flaggedItemsJson),
      })),
    );
  } catch (err) {
    console.error("[post-rental-inspections] GET / failed:", err);
    res.status(500).json({ error: "Failed to load post rental inspections." });
  }
});

apiPostRentalInspectionsRouter.post("/offload", requireTech, async (_req, res) => {
  try {
    const rows = (await prisma.postRentalInspection.findMany({
      orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
    })) as StoredPostRentalInspectionRow[];
    if (rows.length === 0) {
      res.json({
        ok: true,
        exportedEntries: 0,
        exportedRows: 0,
        message: "No post rental inspection entries to offload.",
      });
      return;
    }

    const offloadConfig = await loadOffloadConfig();
    const spreadsheetId = offloadConfig.spreadsheetId;
    const sheetGid = offloadConfig.sheetGid;
    const accessToken = await getGoogleSheetsAccessToken(offloadConfig);
    const sheetTitle = await resolveSheetTitle(spreadsheetId, sheetGid, accessToken);
    const exportRows = rows.flatMap((row) => buildExportRows(row));

    await appendRowsToSheet(spreadsheetId, sheetTitle, accessToken, exportRows);
    await prisma.postRentalInspection.deleteMany({
      where: {
        id: {
          in: rows.map((row) => row.id),
        },
      },
    });

    res.json({
      ok: true,
      exportedEntries: rows.length,
      exportedRows: exportRows.length,
      spreadsheetId,
      sheetTitle,
    });
  } catch (err) {
    console.error("[post-rental-inspections] POST /offload failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error:
        message && message.length > 0 && message.length < 400
          ? message
          : "Failed to offload post rental inspections.",
    });
  }
});
