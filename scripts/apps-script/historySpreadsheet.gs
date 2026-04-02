/**
 * Rentel History Spreadsheet Sync
 *
 * Run setRentelConfig(baseUrl, techUsername, techPassword) once, then use:
 * - setupHistoryLayout()
 * - syncHistoryFromRender()
 */

const RENTEL_CONFIG_KEYS = {
  baseUrl: "RENTEL_BASE_URL",
  techUsername: "RENTEL_TECH_USERNAME",
  techPassword: "RENTEL_TECH_PASSWORD",
};

/**
 * Optional fallback config:
 * Put your Render values here if you want copy/paste setup with no prompts.
 */
const RENTEL_DEFAULT_CONFIG = {
  baseUrl: "https://YOUR-RENDER-APP.onrender.com",
  techUsername: "YOUR_TECH_USERNAME",
  techPassword: "YOUR_TECH_PASSWORD",
};

const HISTORY_SHEETS = {
  postRentalInspections: {
    name: "Post Rental Inspections",
    headers: [
      "Submitted At",
      "Queue Created At",
      "Unit #",
      "Inventory ID",
      "Asset Type",
      "Asset Description",
      "Tech",
      "Issue Description",
      "Damage Description",
      "Damage Photos",
      "Inspection Submission ID",
      "Queue Entry ID",
      "Flagged Item",
      "Flagged Option",
    ],
    dateColumns: [1, 2],
  },
  damages: {
    name: "Damages",
    headers: [
      "Date/Time",
      "Unit #",
      "Asset Type",
      "Action",
      "Details",
      "Tech",
      "Unit Hours",
      "Labor Hours",
      "Inventory ID",
      "Repair Entry ID",
    ],
    dateColumns: [1],
    numberColumns: [7, 8],
  },
  service: {
    name: "Service",
    headers: [
      "Date/Time",
      "Unit #",
      "Asset Type",
      "Details",
      "Tech",
      "Hours",
      "Inventory ID",
      "Service Entry ID",
    ],
    dateColumns: [1],
    numberColumns: [6],
  },
  repair: {
    name: "Repair",
    headers: [
      "Date/Time",
      "Unit #",
      "Asset Type",
      "Action",
      "Details",
      "Tech",
      "Unit Hours",
      "Labor Hours",
      "Inventory ID",
      "Repair Entry ID",
    ],
    dateColumns: [1],
    numberColumns: [7, 8],
  },
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Rentel History")
    .addItem("Setup Layout", "setupHistoryLayout")
    .addItem("Sync From Render", "syncHistoryFromRender")
    .addSeparator()
    .addItem("Save Config From Script", "saveRentelConfigFromScript")
    .addItem("Set Config (Code)", "setRentelConfigFromCodeSample")
    .addItem("Prompt Config", "promptRentelConfig")
    .addToUi();
}

/**
 * Stores Render + tech login settings in Script Properties.
 */
function setRentelConfig(baseUrl, techUsername, techPassword) {
  const cleanBaseUrl = normalizeBaseUrl_(baseUrl);
  const cleanUsername = toText_(techUsername);
  const cleanPassword = toText_(techPassword);

  if (!cleanBaseUrl || !cleanUsername || !cleanPassword) {
    throw new Error(
      "setRentelConfig requires baseUrl, techUsername, and techPassword.",
    );
  }

  PropertiesService.getScriptProperties().setProperties({
    [RENTEL_CONFIG_KEYS.baseUrl]: cleanBaseUrl,
    [RENTEL_CONFIG_KEYS.techUsername]: cleanUsername,
    [RENTEL_CONFIG_KEYS.techPassword]: cleanPassword,
  });
}

/**
 * Interactive config helper so you can set credentials without editing code.
 */
function promptRentelConfig() {
  const ui = SpreadsheetApp.getUi();
  const baseUrlResp = ui.prompt(
    "Rentel Config",
    "Enter your Render base URL (example: https://your-app.onrender.com):",
    ui.ButtonSet.OK_CANCEL,
  );
  if (baseUrlResp.getSelectedButton() !== ui.Button.OK) return;

  const userResp = ui.prompt(
    "Rentel Config",
    "Enter your Rentel tech username:",
    ui.ButtonSet.OK_CANCEL,
  );
  if (userResp.getSelectedButton() !== ui.Button.OK) return;

  const passResp = ui.prompt(
    "Rentel Config",
    "Enter your Rentel tech password:",
    ui.ButtonSet.OK_CANCEL,
  );
  if (passResp.getSelectedButton() !== ui.Button.OK) return;

  setRentelConfig(
    baseUrlResp.getResponseText(),
    userResp.getResponseText(),
    passResp.getResponseText(),
  );
  SpreadsheetApp.getActive().toast("Rentel config saved.", "Rentel History", 5);
}

/**
 * Saves config from RENTEL_DEFAULT_CONFIG constants above.
 */
function saveRentelConfigFromScript() {
  const cfg = RENTEL_DEFAULT_CONFIG || {};
  const baseUrl = toText_(cfg.baseUrl);
  const techUsername = toText_(cfg.techUsername);
  const techPassword = toText_(cfg.techPassword);
  if (
    !baseUrl ||
    !techUsername ||
    !techPassword ||
    isPlaceholderValue_(baseUrl) ||
    isPlaceholderValue_(techUsername) ||
    isPlaceholderValue_(techPassword)
  ) {
    throw new Error(
      "Update RENTEL_DEFAULT_CONFIG first, then run Save Config From Script again.",
    );
  }
  setRentelConfig(baseUrl, techUsername, techPassword);
  SpreadsheetApp.getActive().toast("Config saved from script constants.", "Rentel History", 5);
}

/**
 * Helper so you can run one function and edit values inline.
 */
function setRentelConfigFromCodeSample() {
  setRentelConfig(
    "https://YOUR-RENDER-APP.onrender.com",
    "YOUR_TECH_USERNAME",
    "YOUR_TECH_PASSWORD",
  );
}

/**
 * Creates/updates the 4 history sheets and writes header rows.
 */
function setupHistoryLayout() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureAllHistorySheets_(ss);
  SpreadsheetApp.getActive().toast("History layout is ready.", "Rentel History", 5);
}

/**
 * Pulls data from your Render-hosted Rentel API and rewrites all history tabs.
 */
function syncHistoryFromRender() {
  const startedAt = new Date();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureAllHistorySheets_(ss);

  const config = getRentelConfig_();
  const sessionToken = loginTech_(config);

  const inventoryRows = fetchJson_(
    `${config.baseUrl}/api/inventory`,
    sessionToken,
  );
  const inventory = Array.isArray(inventoryRows) ? inventoryRows : [];

  const postRentalPayload = fetchJson_(
    `${config.baseUrl}/api/post-rental-inspections`,
    sessionToken,
  );
  const postRentalEntries = Array.isArray(postRentalPayload) ? postRentalPayload : [];

  const repairHistoryPayloads = fetchUnitHistoryBatch_(
    config.baseUrl,
    sessionToken,
    inventory,
    "repair-history",
  );
  const serviceHistoryPayloads = fetchUnitHistoryBatch_(
    config.baseUrl,
    sessionToken,
    inventory,
    "service-history",
  );

  const postRentalRows = buildPostRentalRows_(postRentalEntries);
  const repairAndDamage = buildRepairAndDamageRows_(repairHistoryPayloads);
  const serviceRows = buildServiceRows_(serviceHistoryPayloads);

  writeSheetRows_(
    ss,
    HISTORY_SHEETS.postRentalInspections,
    postRentalRows,
  );
  writeSheetRows_(ss, HISTORY_SHEETS.damages, repairAndDamage.damages);
  writeSheetRows_(ss, HISTORY_SHEETS.service, serviceRows);
  writeSheetRows_(ss, HISTORY_SHEETS.repair, repairAndDamage.repair);

  const seconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
  SpreadsheetApp.getActive().toast(
    `Sync complete in ${seconds}s | Post Rental: ${postRentalRows.length}, Damages: ${repairAndDamage.damages.length}, Service: ${serviceRows.length}, Repair: ${repairAndDamage.repair.length}`,
    "Rentel History",
    8,
  );
}

function ensureAllHistorySheets_(ss) {
  const defs = Object.keys(HISTORY_SHEETS).map((key) => HISTORY_SHEETS[key]);
  defs.forEach((def) => ensureHistorySheet_(ss, def));
}

function ensureHistorySheet_(ss, def) {
  const sheet = getOrCreateSheet_(ss, def.name);
  const maxCols = sheet.getMaxColumns();
  if (maxCols < def.headers.length) {
    sheet.insertColumnsAfter(maxCols, def.headers.length - maxCols);
  }

  sheet
    .getRange(1, 1, 1, def.headers.length)
    .setValues([def.headers])
    .setFontWeight("bold")
    .setBackground("#d9e1f2")
    .setWrap(true);
  sheet.setFrozenRows(1);
}

function writeSheetRows_(ss, def, rows) {
  const sheet = getOrCreateSheet_(ss, def.name);
  ensureHistorySheet_(ss, def);

  const rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, 1, rowCount, def.headers.length).clearContent();

  if (rows.length > 0) {
    const neededRows = rows.length + 1;
    if (sheet.getMaxRows() < neededRows) {
      sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());
    }
    sheet.getRange(2, 1, rows.length, def.headers.length).setValues(rows);

    applyColumnFormats_(sheet, def, rows.length);
  }

  sheet.autoResizeColumns(1, def.headers.length);
}

function applyColumnFormats_(sheet, def, dataRows) {
  if (Array.isArray(def.dateColumns)) {
    def.dateColumns.forEach((col) => {
      sheet
        .getRange(2, col, dataRows, 1)
        .setNumberFormat("yyyy-mm-dd hh:mm:ss");
    });
  }
  if (Array.isArray(def.numberColumns)) {
    def.numberColumns.forEach((col) => {
      sheet.getRange(2, col, dataRows, 1).setNumberFormat("0.0");
    });
  }
}

function buildPostRentalRows_(entries) {
  const rows = [];
  entries.forEach((entry) => {
    const base = [
      toDateOrBlank_(entry.submittedAt),
      toDateOrBlank_(entry.createdAt),
      toText_(entry.unitNumber),
      toText_(entry.inventoryId),
      toText_(entry.assetType),
      toText_(entry.assetDescription),
      toText_(entry.techName),
      toText_(entry.issueDescription),
      toText_(entry.damageDescription),
      joinTextArray_(entry.damagePhotos, " | "),
      toText_(entry.inspectionSubmissionId),
      toText_(entry.id),
    ];

    const flaggedItems = Array.isArray(entry.flaggedItems) ? entry.flaggedItems : [];
    if (flaggedItems.length === 0) {
      rows.push(base.concat(["", ""]));
      return;
    }

    flaggedItems.forEach((flagged) => {
      rows.push(
        base.concat([
          toText_(flagged && flagged.label),
          toText_(flagged && flagged.selectedOption),
        ]),
      );
    });
  });

  return sortByDateDesc_(rows, 0);
}

function buildRepairAndDamageRows_(historyPayloads) {
  const repair = [];
  const damages = [];

  historyPayloads.forEach((payload) => {
    const entries = Array.isArray(payload && payload.entries) ? payload.entries : [];
    const unitNumber = toText_(payload && payload.unitNumber);
    const assetType = toText_(payload && payload.assetType);
    const inventoryId = toText_(payload && payload.inventoryId);

    entries.forEach((entry) => {
      const row = [
        toDateOrBlank_(entry.createdAt),
        unitNumber,
        assetType,
        toText_(entry.action),
        toText_(entry.details),
        toText_(entry.techName),
        toNumberOrBlank_(entry.repairHours),
        toNumberOrBlank_(entry.laborHours),
        inventoryId,
        toText_(entry.id),
      ];

      if (isDamageInspectionDownEntry_(entry)) {
        damages.push(row);
      }
      if (!isInspectionDrivenRepairEntry_(entry)) {
        repair.push(row);
      }
    });
  });

  return {
    damages: sortByDateDesc_(damages, 0),
    repair: sortByDateDesc_(repair, 0),
  };
}

function buildServiceRows_(historyPayloads) {
  const rows = [];
  historyPayloads.forEach((payload) => {
    const entries = Array.isArray(payload && payload.entries) ? payload.entries : [];
    const unitNumber = toText_(payload && payload.unitNumber);
    const assetType = toText_(payload && payload.assetType);
    const inventoryId = toText_(payload && payload.inventoryId);

    entries.forEach((entry) => {
      rows.push([
        toDateOrBlank_(entry.createdAt),
        unitNumber,
        assetType,
        toText_(entry.details),
        toText_(entry.techName),
        toNumberOrBlank_(entry.repairHours),
        inventoryId,
        toText_(entry.id),
      ]);
    });
  });
  return sortByDateDesc_(rows, 0);
}

function fetchUnitHistoryBatch_(baseUrl, sessionToken, inventoryRows, endpointSuffix) {
  const rows = Array.isArray(inventoryRows) ? inventoryRows : [];
  const requests = rows
    .map((row) => {
      const inventoryId = toText_(row && row.id);
      if (!inventoryId) return null;
      return {
        url: `${baseUrl}/api/inventory/${encodeURIComponent(inventoryId)}/${endpointSuffix}`,
        method: "get",
        headers: buildAuthHeaders_(sessionToken),
        muteHttpExceptions: true,
      };
    })
    .filter(Boolean);

  if (requests.length === 0) return [];

  const payloads = [];
  const chunkSize = 50;
  for (let i = 0; i < requests.length; i += chunkSize) {
    const chunk = requests.slice(i, i + chunkSize);
    const responses = UrlFetchApp.fetchAll(chunk);
    responses.forEach((resp) => {
      const code = resp.getResponseCode();
      const text = resp.getContentText();
      if (code < 200 || code >= 300) {
        throw new Error(
          `History fetch failed (${endpointSuffix}) [${code}]: ${text || "No response body"}`,
        );
      }
      payloads.push(safeParseJson_(text));
    });
  }
  return payloads;
}

function loginTech_(config) {
  const url = `${config.baseUrl}/api/tech-auth/login`;
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      username: config.techUsername,
      password: config.techPassword,
    }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const text = response.getContentText();
  const payload = safeParseJson_(text);
  if (code < 200 || code >= 300) {
    throw new Error(
      `Tech login failed [${code}]: ${toText_((payload && payload.error) || text)}`,
    );
  }

  const token = toText_(payload && payload.sessionToken);
  if (!token) {
    throw new Error("Tech login succeeded but no session token was returned.");
  }
  return token;
}

function fetchJson_(url, sessionToken) {
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: buildAuthHeaders_(sessionToken),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error(`GET ${url} failed [${code}]: ${text || "No response body"}`);
  }
  return safeParseJson_(text);
}

function buildAuthHeaders_(sessionToken) {
  return {
    Authorization: `Bearer ${sessionToken}`,
    Accept: "application/json",
  };
}

function getRentelConfig_() {
  const props = PropertiesService.getScriptProperties();
  let baseUrl = normalizeBaseUrl_(props.getProperty(RENTEL_CONFIG_KEYS.baseUrl));
  let techUsername = toText_(props.getProperty(RENTEL_CONFIG_KEYS.techUsername));
  let techPassword = toText_(props.getProperty(RENTEL_CONFIG_KEYS.techPassword));

  if (!baseUrl || !techUsername || !techPassword) {
    const fallbackBase = toText_(RENTEL_DEFAULT_CONFIG.baseUrl);
    const fallbackUser = toText_(RENTEL_DEFAULT_CONFIG.techUsername);
    const fallbackPass = toText_(RENTEL_DEFAULT_CONFIG.techPassword);
    if (
      fallbackBase &&
      fallbackUser &&
      fallbackPass &&
      !isPlaceholderValue_(fallbackBase) &&
      !isPlaceholderValue_(fallbackUser) &&
      !isPlaceholderValue_(fallbackPass)
    ) {
      baseUrl = normalizeBaseUrl_(fallbackBase);
      techUsername = fallbackUser;
      techPassword = fallbackPass;
    }
  }

  if (!baseUrl || !techUsername || !techPassword) {
    throw new Error(
      "Missing config. Update RENTEL_DEFAULT_CONFIG at the top of the script, or run Prompt Config / setRentelConfig(...), then try again.",
    );
  }

  return {
    baseUrl: baseUrl,
    techUsername: techUsername,
    techPassword: techPassword,
  };
}

function getOrCreateSheet_(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

function safeParseJson_(text) {
  if (!text) return null;
  return JSON.parse(text);
}

function normalizeBaseUrl_(value) {
  const base = toText_(value).replace(/\/+$/, "");
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) {
    throw new Error("RENTEL_BASE_URL must start with http:// or https://");
  }
  return base;
}

function isPlaceholderValue_(value) {
  const text = toText_(value).toUpperCase();
  if (!text) return true;
  return text.indexOf("YOUR_") >= 0 || text.indexOf("YOUR-") >= 0;
}

function toText_(value) {
  return String(value == null ? "" : value).trim();
}

function toDateOrBlank_(value) {
  const text = toText_(value);
  if (!text) return "";
  const dt = new Date(text);
  return Number.isNaN(dt.getTime()) ? "" : dt;
}

function toNumberOrBlank_(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : "";
}

function joinTextArray_(value, separator) {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => toText_(item))
    .filter((item) => item !== "")
    .join(separator);
}

function sortByDateDesc_(rows, dateIndex) {
  return rows.sort((a, b) => {
    const aVal = a[dateIndex];
    const bVal = b[dateIndex];
    const aTime = aVal instanceof Date ? aVal.getTime() : 0;
    const bTime = bVal instanceof Date ? bVal.getTime() : 0;
    return bTime - aTime;
  });
}

/**
 * Same detection used in techs.html: DOWN + details containing "Damaged:"
 */
function isDamageInspectionDownEntry_(entry) {
  const action = toText_(entry && entry.action).toUpperCase();
  if (action !== "DOWN") return false;
  const details = String((entry && entry.details) || "");
  return /(^|[|\n])\s*Damaged\s*:/i.test(details);
}

/**
 * Same filtering logic used in backend and techs.html for inspection-derived events.
 */
function isInspectionDrivenRepairEntry_(entry) {
  const action = toText_(entry && entry.action).toUpperCase();
  const details = toText_(entry && entry.details);
  if (!details) return false;

  if (
    action === "COMPLETE" &&
    /^inspection completed and unit returned to available\.?$/i.test(details)
  ) {
    return true;
  }

  if (
    action === "DOWN" &&
    (/(^|[|\n])\s*Damaged\s*:/i.test(details) ||
      /(^|[|\n])\s*Needs attention\s*:/i.test(details) ||
      /^inspection result moved this unit to down\.?$/i.test(details))
  ) {
    return true;
  }

  return false;
}
