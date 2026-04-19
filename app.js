const STORAGE_KEY = "operation-log-entries";
const SNAPSHOT_STORAGE_KEY = "operation-log-entry-snapshots";
const DB_NAME = "operation-log-db";
const DB_VERSION = 1;
const DB_STORE_NAME = "entryState";
const DB_STATE_ID = "main";
const OCR_NOTE_PREFIX = "Source OCR:";
const MAX_SNAPSHOTS = 5;
const GOOGLE_DRIVE_DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";
const GOOGLE_SHEETS_DISCOVERY_DOC = "https://sheets.googleapis.com/$discovery/rest?version=v4";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DRIVE_FILE_ID_STORAGE_KEY = "operation-log-drive-file-id";
const DRIVE_FOLDER_ID_STORAGE_KEY = "operation-log-drive-folder-id";
const TESSERACT_CDN_URL = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/6.0.1/tesseract.min.js";
const SHEET_HEADER_ROW = [[
  "Entry ID",
  "Saved At",
  "Operation Date",
  "Patient Name",
  "Hospital Number",
  "Procedure",
  "My Role",
  "Diagnosis",
  "Notes",
]];

const form = document.getElementById("patient-form");
const formTitle = document.getElementById("formTitle");
const formHint = document.getElementById("formHint");
const submitBtn = document.getElementById("submitBtn");
const resetBtn = document.getElementById("resetBtn");
const searchInput = document.getElementById("searchInput");
const exportBtn = document.getElementById("exportBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const importFile = document.getElementById("importFile");
const cameraInput = document.getElementById("cameraInput");
const photoInput = document.getElementById("photoInput");
const photoPreview = document.getElementById("photoPreview");
const previewEmpty = document.getElementById("previewEmpty");
const photoStatus = document.getElementById("photoStatus");
const storageStatus = document.getElementById("storageStatus");
const driveStatus = document.getElementById("driveStatus");
const extractedText = document.getElementById("extractedText");
const applyExtractedBtn = document.getElementById("applyExtractedBtn");
const driveSignInBtn = document.getElementById("driveSignInBtn");
const driveSyncBtn = document.getElementById("driveSyncBtn");
const driveSignOutBtn = document.getElementById("driveSignOutBtn");
const entriesBody = document.getElementById("entriesBody");
const entriesTable = document.getElementById("entriesTable");
const tableWrap = entriesTable.parentElement;
const emptyState = document.getElementById("emptyState");
const groupedLog = document.getElementById("groupedLog");
const groupedViewBtn = document.getElementById("groupedViewBtn");
const tableViewBtn = document.getElementById("tableViewBtn");
const categoryFilters = document.getElementById("categoryFilters");
const rowTemplate = document.getElementById("rowTemplate");
const totalCases = document.getElementById("totalCases");
const monthCases = document.getElementById("monthCases");
const caseMixChart = document.getElementById("caseMixChart");
const caseMixLegend = document.getElementById("caseMixLegend");
const caseMixCaption = document.getElementById("caseMixCaption");
const surgeonLeaderboard = document.getElementById("surgeonLeaderboard");
const surgeonCaption = document.getElementById("surgeonCaption");
const volumeTimeline = document.getElementById("volumeTimeline");
const volumeCaption = document.getElementById("volumeCaption");

let entries = [];
let lastExtractedRecord = null;
let previewObjectUrl = "";
let isProcessingPhoto = false;
let currentLogView = "grouped";
let activeCategoryFilter = "All";
let tokenClient = null;
let googleClientReady = false;
let googleIdentityReady = false;
let driveAccessToken = "";
let driveSyncInFlight = false;
let pendingDriveSyncReason = "";
let tesseractLoaderPromise = null;
let pendingSheetEntries = [];
let sheetSyncInFlight = false;
let sheetHeaderEnsured = false;

initApp();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const isNewEntry = !form.entryId.value;

  const entry = {
    id: form.entryId.value || crypto.randomUUID(),
    patientName: form.patientName.value.trim(),
    patientId: form.patientId.value.trim(),
    procedure: form.procedure.value.trim(),
    operationDate: form.operationDate.value,
    myRole: form.myRole.value || "",
    diagnosis: form.diagnosis.value.trim(),
    notes: form.notes.value.trim(),
    createdAt: form.entryId.value ? findExistingCreatedAt(form.entryId.value) : new Date().toISOString(),
  };

  if (form.entryId.value) {
    entries = entries.map((currentEntry) => currentEntry.id === entry.id ? entry : currentEntry);
  } else {
    entries.unshift(entry);
  }

  entries.sort(compareByOperationDateDesc);
  persistEntries();
  if (isNewEntry) {
    scheduleSheetAppend(entry, "New patient saved");
  }
  renderEntries(searchInput.value);
  clearPhotoCapture();
  resetForm();
});

resetBtn.addEventListener("click", () => {
  window.setTimeout(resetForm, 0);
});

searchInput.addEventListener("input", () => {
  renderEntries(searchInput.value);
});

groupedViewBtn.addEventListener("click", () => {
  currentLogView = "grouped";
  renderEntries(searchInput.value);
});

tableViewBtn.addEventListener("click", () => {
  currentLogView = "table";
  renderEntries(searchInput.value);
});

cameraInput.addEventListener("change", handlePhotoSelection);
photoInput.addEventListener("change", handlePhotoSelection);

extractedText.addEventListener("input", () => {
  lastExtractedRecord = extractedText.value.trim() ? parseRecordFromText(extractedText.value) : null;
  syncApplyButtonState();
});

applyExtractedBtn.addEventListener("click", () => {
  const rawText = extractedText.value.trim();
  if (!rawText) {
    updatePhotoStatus("Upload or type extracted text first, then apply it to the form.", "warning");
    return;
  }

  const record = parseRecordFromText(rawText);
  lastExtractedRecord = record;
  applyRecordToForm(record, rawText);
  updatePhotoStatus("The extracted information has been applied to the form. Please review it before saving.", "success");
});

exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `operation-log-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

exportCsvBtn.addEventListener("click", () => {
  const header = [
    "Operation Date",
    "Patient Name",
    "Patient ID",
    "Procedure",
    "My Role",
    "Diagnosis",
    "Notes",
  ];

  const rows = entries.map((entry) => [
    entry.operationDate,
    entry.patientName,
    entry.patientId,
    entry.procedure,
    entry.myRole || "",
    entry.diagnosis || "",
    entry.notes || "",
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `operation-log-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

importFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const imported = JSON.parse(text);

    if (!Array.isArray(imported)) {
      throw new Error("Imported file must contain a list of entries.");
    }

    entries = imported
      .filter(isValidEntry)
      .map((entry) => normalizeEntry(entry))
      .sort(compareByOperationDateDesc);

    persistEntries();
    renderEntries(searchInput.value);
    resetForm();
  } catch (error) {
    window.alert(`Import failed: ${error.message}`);
  } finally {
    importFile.value = "";
  }
});

entriesBody.addEventListener("click", handleLogAction);
groupedLog.addEventListener("click", handleLogAction);
driveSignInBtn.addEventListener("click", handleDriveSignIn);
driveSyncBtn.addEventListener("click", () => {
  scheduleDriveSync("Manual sync");
});
driveSignOutBtn.addEventListener("click", handleDriveSignOut);

async function initApp() {
  resetForm();
  syncApplyButtonState();
  updatePhotoStatus(
    supportsTextDetector()
      ? "Ready to read a theatre list or sticker. Review the extracted text before saving."
      : "Ready to read a theatre list or sticker. On this device, OCR may take a few extra seconds while the browser loads the text reader."
  );

  const restoredState = await loadBestAvailableState();
  entries = restoredState.entries
    .map((entry) => normalizeEntry(entry))
    .filter(isValidEntry)
    .sort(compareByOperationDateDesc);

  renderEntries();
  updateStorageStatus(
    restoredState.updatedAt
      ? `Saved locally in multiple browser stores. Latest recorded save: ${formatTimestamp(restoredState.updatedAt)}.`
      : "No saved entries yet. New cases will be stored locally in browser storage and a backup mirror."
  );

  if (restoredState.source && restoredState.source !== "local+indexeddb") {
    persistEntries();
  }

  initializeDriveSync();
}

async function handlePhotoSelection(event) {
  const [file] = event.target.files || [];
  if (!file || isProcessingPhoto) {
    return;
  }

  setPhotoProcessingState(true);
  showPreview(file);
  updatePhotoStatus("Reading the image and trying to extract text...", "warning");

  try {
    const rawText = await extractTextFromImage(file);
    extractedText.value = rawText;
    lastExtractedRecord = parseRecordFromText(rawText);
    syncApplyButtonState();
    applyRecordToForm(lastExtractedRecord, rawText);
    updatePhotoStatus("Image processed. The form was prefilled with the detected information.", "success");
  } catch (error) {
    lastExtractedRecord = null;
    extractedText.value = "";
    syncApplyButtonState();
    updatePhotoStatus(error.message, "error");
  } finally {
    cameraInput.value = "";
    photoInput.value = "";
    setPhotoProcessingState(false);
  }
}

function handleLogAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const row = button.closest("tr");
  const entryId = button.dataset.entryId || row?.dataset.entryId;
  if (!entryId) {
    return;
  }

  if (button.dataset.action === "edit") {
    const selectedEntry = entries.find((entry) => entry.id === entryId);
    if (selectedEntry) {
      populateForm(selectedEntry);
    }
    return;
  }

  entries = entries.filter((entry) => entry.id !== entryId);
  persistEntries();
  renderEntries(searchInput.value);

  if (form.entryId.value === entryId) {
    resetForm();
  }
}

async function extractTextFromImage(file) {
  if (supportsTextDetector()) {
    try {
      return await extractTextWithTextDetector(file);
    } catch (error) {
      const fallbackText = await extractTextWithTesseract(file, error);
      if (fallbackText) {
        return fallbackText;
      }
      throw error;
    }
  }

  return extractTextWithTesseract(file);
}

async function extractTextWithTextDetector(file) {
  const detector = new window.TextDetector();
  const bitmap = await createImageBitmap(file);

  try {
    const blocks = await detector.detect(bitmap);
    const lines = blocks
      .flatMap((block) => {
        const text = block.rawValue || "";
        return text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
      })
      .filter((line, index, array) => array.indexOf(line) === index);

    const rawText = lines.join("\n").trim();
    if (!rawText) {
      throw new Error("I could not find readable text in that image. Try a sharper, closer photo with better lighting.");
    }

    return rawText;
  } finally {
    bitmap.close();
  }
}

async function extractTextWithTesseract(file, priorError = null) {
  const tesseract = await loadTesseractLibrary();
  const processedImage = await prepareImageForOcr(file);
  const worker = await tesseract.createWorker("eng");

  try {
    const result = await worker.recognize(processedImage);
    const rawText = (result?.data?.text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");

    if (!rawText) {
      throw new Error("I could not find readable text in that image. Try a closer photo with stronger lighting and less glare.");
    }

    return rawText;
  } catch (error) {
    if (priorError) {
      throw new Error(`The browser OCR fallback also failed. Native scan: ${priorError.message}. Fallback scan: ${error.message}`);
    }

    throw error;
  } finally {
    if (typeof worker.terminate === "function") {
      await worker.terminate();
    }

    if (processedImage.startsWith("blob:")) {
      URL.revokeObjectURL(processedImage);
    }
  }
}

function loadTesseractLibrary() {
  if (window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }

  if (tesseractLoaderPromise) {
    return tesseractLoaderPromise;
  }

  tesseractLoaderPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${TESSERACT_CDN_URL}"]`);

    if (existingScript && window.Tesseract) {
      resolve(window.Tesseract);
      return;
    }

    const script = existingScript || document.createElement("script");
    script.src = TESSERACT_CDN_URL;
    script.defer = true;

    script.addEventListener("load", () => {
      if (window.Tesseract) {
        resolve(window.Tesseract);
        return;
      }

      reject(new Error("The OCR library loaded, but the browser could not start it."));
    }, { once: true });

    script.addEventListener("error", () => {
      reject(new Error("The browser could not load the OCR library. Check that the device has internet access."));
    }, { once: true });

    if (!existingScript) {
      document.head.appendChild(script);
    }
  });

  return tesseractLoaderPromise;
}

async function prepareImageForOcr(file) {
  const bitmap = await createImageBitmap(file);
  const longestSide = Math.max(bitmap.width, bitmap.height);
  const scale = longestSide < 1800 ? 1800 / longestSide : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = width;
  canvas.height = height;

  context.filter = "grayscale(1) contrast(1.25) brightness(1.08)";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const value = data[index];
    const normalized = value > 168 ? 255 : value < 88 ? 0 : value;
    data[index] = normalized;
    data[index + 1] = normalized;
    data[index + 2] = normalized;
  }

  context.putImageData(imageData, 0, 0);

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The browser could not prepare the image for OCR."));
        return;
      }

      resolve(URL.createObjectURL(blob));
    }, "image/png");
  });
}

function showPreview(file) {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
  }

  previewObjectUrl = URL.createObjectURL(file);
  photoPreview.src = previewObjectUrl;
  photoPreview.hidden = false;
  previewEmpty.hidden = true;
}

function clearPhotoCapture() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = "";
  }

  photoPreview.removeAttribute("src");
  photoPreview.hidden = true;
  previewEmpty.hidden = false;
  extractedText.value = "";
  cameraInput.value = "";
  photoInput.value = "";
  lastExtractedRecord = null;
  syncApplyButtonState();
  updatePhotoStatus(
    supportsTextDetector()
      ? "Ready to read a theatre list or sticker. Review the extracted text before saving."
      : "Ready to read a theatre list or sticker. On this device, OCR may take a few extra seconds while the browser loads the text reader."
  );
}

function setPhotoProcessingState(isProcessing) {
  isProcessingPhoto = isProcessing;
  applyExtractedBtn.disabled = isProcessing || !extractedText.value.trim();
  cameraInput.disabled = isProcessing;
  photoInput.disabled = isProcessing;
  submitBtn.disabled = isProcessing;
  exportBtn.disabled = isProcessing;
  exportCsvBtn.disabled = isProcessing;
  resetBtn.disabled = isProcessing;
  applyExtractedBtn.textContent = isProcessing ? "Reading..." : "Apply To Form";
}

function parseRecordFromText(rawText) {
  const cleanedText = rawText.replace(/\r/g, "").trim();
  const lines = cleanedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    patientName: findLabeledValue(lines, ["patient name", "name", "patient"]) || findLikelyName(lines),
    patientId: findLabeledValue(lines, ["hospital number", "hospital no", "mrn", "patient id", "file no", "folder no"])
      || findLikelyPatientId(cleanedText),
    procedure: findLabeledValue(lines, ["procedure", "operation", "op", "surgery"]) || findLikelyProcedure(lines),
    operationDate: normalizeDateValue(
      findLabeledValue(lines, ["date", "operation date", "op date"]) || findLikelyDate(cleanedText)
    ),
    myRole: "",
    diagnosis: findLabeledValue(lines, ["diagnosis", "dx", "indication"]) || "",
    notes: cleanedText,
  };
}

function applyRecordToForm(record, rawText) {
  form.patientName.value = chooseBetterValue(form.patientName.value, record.patientName);
  form.patientId.value = chooseBetterValue(form.patientId.value, record.patientId);
  form.procedure.value = chooseBetterValue(form.procedure.value, record.procedure);
  form.diagnosis.value = chooseBetterValue(form.diagnosis.value, record.diagnosis);

  if (record.operationDate) {
    form.operationDate.value = record.operationDate;
  }

  form.notes.value = mergeNotes(form.notes.value, rawText);
}

function chooseBetterValue(currentValue, nextValue) {
  const current = currentValue.trim();
  const next = (nextValue || "").trim();

  if (!next) {
    return current;
  }

  if (!current) {
    return next;
  }

  return next.length > current.length ? next : current;
}

function mergeNotes(existingNotes, rawText) {
  const cleanedExisting = stripOcrBlock(existingNotes.trim());
  const cleanedOcr = rawText.trim();

  if (!cleanedOcr) {
    return cleanedExisting;
  }

  const combined = cleanedExisting
    ? `${cleanedExisting}\n\n${OCR_NOTE_PREFIX}\n${cleanedOcr}`
    : `${OCR_NOTE_PREFIX}\n${cleanedOcr}`;

  return combined.slice(0, 500);
}

function stripOcrBlock(notes) {
  const index = notes.indexOf(OCR_NOTE_PREFIX);
  return index >= 0 ? notes.slice(0, index).trim() : notes;
}

function supportsTextDetector() {
  return "TextDetector" in window;
}

function updatePhotoStatus(message, tone = "") {
  photoStatus.textContent = message;
  photoStatus.className = "support-copy";

  if (tone === "success") {
    photoStatus.classList.add("status-success");
  }

  if (tone === "warning") {
    photoStatus.classList.add("status-warning");
  }

  if (tone === "error") {
    photoStatus.classList.add("status-error");
  }
}

function updateStorageStatus(message, tone = "") {
  storageStatus.textContent = message;
  storageStatus.className = "storage-status";

  if (tone === "success") {
    storageStatus.classList.add("status-success");
  }

  if (tone === "warning") {
    storageStatus.classList.add("status-warning");
  }

  if (tone === "error") {
    storageStatus.classList.add("status-error");
  }
}

function syncApplyButtonState() {
  applyExtractedBtn.disabled = isProcessingPhoto || !extractedText.value.trim();
}

function initializeDriveSync() {
  if (!isHostedOrigin()) {
    updateDriveStatus(
      "Google cloud sync needs this app to run from a real web address like localhost or HTTPS. It cannot sign in from file://.",
      "warning"
    );
    syncDriveButtons();
    return;
  }

  if (!hasGoogleDriveConfig()) {
    updateDriveStatus(
      "Google cloud sync is ready for setup. Add your Google OAuth client ID and API key in config.js, then host the app.",
      "warning"
    );
    syncDriveButtons();
    return;
  }

  waitForGoogleLibraries()
    .then(async () => {
      await initializeGoogleApiClient();
      initializeGoogleTokenClient();
      updateDriveStatus(
        hasGoogleSheetsConfig()
          ? "Google backup and spreadsheet sync are ready. Connect your Google account to mirror the logbook online and append new patients into Sheets."
          : "Google Drive backup is ready. Connect your Google account to mirror the logbook online after each save.",
        "success"
      );
      syncDriveButtons();
    })
    .catch((error) => {
      updateDriveStatus(`Google Drive libraries did not finish loading: ${error.message}`, "error");
      syncDriveButtons();
    });
}

function waitForGoogleLibraries() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const poll = () => {
      if (window.gapi?.load) {
        googleClientReady = true;
      }

      if (window.google?.accounts?.oauth2) {
        googleIdentityReady = true;
      }

      if (googleClientReady && googleIdentityReady) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > 12000) {
        reject(new Error("Timed out while waiting for Google scripts"));
        return;
      }

      window.setTimeout(poll, 150);
    };

    poll();
  });
}

async function initializeGoogleApiClient() {
  await new Promise((resolve, reject) => {
    window.gapi.load("client", {
      callback: resolve,
      onerror: () => reject(new Error("Could not load Google API client")),
      timeout: 10000,
      ontimeout: () => reject(new Error("Google API client load timed out")),
    });
  });

  await window.gapi.client.init({
    apiKey: getDriveConfig().googleApiKey,
    discoveryDocs: [GOOGLE_DRIVE_DISCOVERY_DOC, GOOGLE_SHEETS_DISCOVERY_DOC],
  });
}

function initializeGoogleTokenClient() {
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: getDriveConfig().googleClientId,
    scope: `${GOOGLE_DRIVE_SCOPE} ${GOOGLE_SHEETS_SCOPE}`,
    callback: async (tokenResponse) => {
      if (tokenResponse?.error) {
        updateDriveStatus(`Google sign-in failed: ${tokenResponse.error}`, "error");
        syncDriveButtons();
        return;
      }

      driveAccessToken = tokenResponse.access_token || "";
      window.gapi.client.setToken({ access_token: driveAccessToken });
      updateDriveStatus(
        hasGoogleSheetsConfig()
          ? "Google connected. Drive backups are active, and new patients will be appended to your spreadsheet."
          : "Google Drive connected. New entries will sync automatically after each save.",
        "success"
      );
      syncDriveButtons();
      scheduleDriveSync("Initial Google Drive connection");
      flushPendingSheetEntries();
    },
  });
}

function handleDriveSignIn() {
  if (!tokenClient) {
    initializeDriveSync();
    return;
  }

  tokenClient.requestAccessToken({ prompt: driveAccessToken ? "" : "consent" });
}

function handleDriveSignOut() {
  if (driveAccessToken && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(driveAccessToken, () => {});
  }

  driveAccessToken = "";
  window.gapi?.client?.setToken?.(null);
  updateDriveStatus("Google cloud sync disconnected. Local saving still works, but Drive and spreadsheet sync are paused.", "warning");
  syncDriveButtons();
}

function hasGoogleDriveConfig() {
  const config = getDriveConfig();
  return Boolean(config.googleClientId && config.googleApiKey);
}

function getDriveConfig() {
  return window.OPERATION_LOG_CONFIG || {};
}

function isHostedOrigin() {
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

function isDriveSyncAvailable() {
  return isHostedOrigin() && hasGoogleDriveConfig() && tokenClient && window.gapi?.client?.drive;
}

function hasGoogleSheetsConfig() {
  const config = getDriveConfig();
  return Boolean(config.googleSpreadsheetId);
}

function isDriveSignedIn() {
  return Boolean(driveAccessToken);
}

function syncDriveButtons() {
  driveSignInBtn.disabled = !isHostedOrigin() || !hasGoogleDriveConfig() || !tokenClient || driveSyncInFlight;
  driveSyncBtn.disabled = !isDriveSyncAvailable() || !isDriveSignedIn() || driveSyncInFlight;
  driveSignOutBtn.disabled = !isDriveSignedIn() || driveSyncInFlight;
  driveSyncBtn.textContent = driveSyncInFlight ? "Syncing..." : "Sync Now";
}

function updateDriveStatus(message, tone = "") {
  driveStatus.textContent = message;
  driveStatus.className = "storage-status sync-status";

  if (tone === "success") {
    driveStatus.classList.add("status-success");
  }

  if (tone === "warning") {
    driveStatus.classList.add("status-warning");
  }

  if (tone === "error") {
    driveStatus.classList.add("status-error");
  }
}

function scheduleSheetAppend(entry, reason = "New patient saved") {
  if (!hasGoogleSheetsConfig()) {
    return;
  }

  pendingSheetEntries.push({ entry, reason });
  flushPendingSheetEntries();
}

async function flushPendingSheetEntries() {
  if (
    sheetSyncInFlight ||
    !pendingSheetEntries.length ||
    !isDriveSignedIn() ||
    !window.gapi?.client?.sheets
  ) {
    return;
  }

  sheetSyncInFlight = true;

  try {
    await ensureSheetTabAndHeader();

    while (pendingSheetEntries.length) {
      const { entry, reason } = pendingSheetEntries[0];
      await appendEntryToSheet(entry);
      pendingSheetEntries.shift();
      updateDriveStatus(
        `${reason}. Drive backup is active and the spreadsheet was updated ${formatTimestamp(new Date().toISOString())}.`,
        "success"
      );
    }
  } catch (error) {
    updateDriveStatus(`Drive backup may still work, but spreadsheet sync failed: ${error.message}`, "error");
  } finally {
    sheetSyncInFlight = false;
  }
}

async function ensureSheetTabAndHeader() {
  if (!hasGoogleSheetsConfig()) {
    return;
  }

  const config = getDriveConfig();
  const spreadsheetId = config.googleSpreadsheetId;
  const sheetName = config.googleSheetName || "Cases";
  const spreadsheet = await window.gapi.client.sheets.spreadsheets.get({
    spreadsheetId,
    includeGridData: false,
  });

  const existingTitles = (spreadsheet.result.sheets || []).map((sheet) => sheet.properties?.title);
  if (!existingTitles.includes(sheetName)) {
    await window.gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetName,
            },
          },
        },
      ],
    });
  }

  if (sheetHeaderEnsured) {
    return;
  }

  const headerRange = `${sheetName}!A1:I1`;
  const headerResponse = await window.gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange,
  });

  const hasHeader = Array.isArray(headerResponse.result.values) && headerResponse.result.values[0]?.[0] === "Entry ID";
  if (!hasHeader) {
    await window.gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: headerRange,
      valueInputOption: "RAW",
      values: SHEET_HEADER_ROW,
    });
  }

  sheetHeaderEnsured = true;
}

async function appendEntryToSheet(entry) {
  const config = getDriveConfig();
  const spreadsheetId = config.googleSpreadsheetId;
  const sheetName = config.googleSheetName || "Cases";
  const notesWithoutOcr = stripOcrBlock(entry.notes || "");

  await window.gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:I`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    resource: {
      values: [[
        entry.id,
        entry.createdAt || new Date().toISOString(),
        entry.operationDate || "",
        entry.patientName || "",
        entry.patientId || "",
        entry.procedure || "",
        entry.myRole || "",
        entry.diagnosis || "",
        notesWithoutOcr,
      ]],
    },
  });
}

function scheduleDriveSync(reason) {
  pendingDriveSyncReason = reason;

  if (driveSyncInFlight || !isDriveSignedIn() || !isDriveSyncAvailable()) {
    syncDriveButtons();
    return;
  }

  performDriveSync();
}

async function performDriveSync() {
  if (!pendingDriveSyncReason || driveSyncInFlight || !isDriveSignedIn() || !isDriveSyncAvailable()) {
    syncDriveButtons();
    return;
  }

  const syncReason = pendingDriveSyncReason;
  pendingDriveSyncReason = "";
  driveSyncInFlight = true;
  syncDriveButtons();

  try {
    const fileId = await ensureDriveBackupFile();
    await uploadDriveFile(fileId, buildDriveSyncPayload());
    updateDriveStatus(
      `${syncReason} complete. Google Drive backup updated ${formatTimestamp(new Date().toISOString())}.`,
      "success"
    );
  } catch (error) {
    updateDriveStatus(`Local save worked, but Google Drive sync failed: ${error.message}`, "error");
  } finally {
    driveSyncInFlight = false;
    syncDriveButtons();

    if (pendingDriveSyncReason) {
      performDriveSync();
    }
  }
}

function buildDriveSyncPayload() {
  return JSON.stringify(
    {
      app: getDriveConfig().googleAppName || "Operation Log",
      exportedAt: new Date().toISOString(),
      totalEntries: entries.length,
      entries,
    },
    null,
    2
  );
}

async function ensureDriveBackupFile() {
  const config = getDriveConfig();
  const cachedFileId = localStorage.getItem(DRIVE_FILE_ID_STORAGE_KEY);
  const folderId = await ensureDriveFolder(config.driveFolderName);

  if (cachedFileId) {
    try {
      await window.gapi.client.drive.files.get({
        fileId: cachedFileId,
        fields: "id, name",
      });
      return cachedFileId;
    } catch {
      localStorage.removeItem(DRIVE_FILE_ID_STORAGE_KEY);
    }
  }

  const escapedFileName = escapeDriveQueryValue(config.driveFileName || "operation-log-sync.json");
  const folderClause = folderId ? `'${folderId}' in parents and ` : "";
  const searchResponse = await window.gapi.client.drive.files.list({
    q: `${folderClause}name='${escapedFileName}' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 1,
  });

  const existingFile = searchResponse.result.files?.[0];
  if (existingFile?.id) {
    localStorage.setItem(DRIVE_FILE_ID_STORAGE_KEY, existingFile.id);
    return existingFile.id;
  }

  const metadata = {
    name: config.driveFileName || "operation-log-sync.json",
    mimeType: "application/json",
  };

  if (folderId) {
    metadata.parents = [folderId];
  }

  const created = await createDriveFile(metadata, buildDriveSyncPayload());
  localStorage.setItem(DRIVE_FILE_ID_STORAGE_KEY, created.id);
  return created.id;
}

async function ensureDriveFolder(folderName) {
  if (!folderName) {
    return "";
  }

  const cachedFolderId = localStorage.getItem(DRIVE_FOLDER_ID_STORAGE_KEY);
  if (cachedFolderId) {
    try {
      await window.gapi.client.drive.files.get({
        fileId: cachedFolderId,
        fields: "id, name",
      });
      return cachedFolderId;
    } catch {
      localStorage.removeItem(DRIVE_FOLDER_ID_STORAGE_KEY);
    }
  }

  const escapedFolderName = escapeDriveQueryValue(folderName);
  const response = await window.gapi.client.drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${escapedFolderName}' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 1,
  });

  const existingFolder = response.result.files?.[0];
  if (existingFolder?.id) {
    localStorage.setItem(DRIVE_FOLDER_ID_STORAGE_KEY, existingFolder.id);
    return existingFolder.id;
  }

  const createdFolder = await createDriveFile({
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
  });

  localStorage.setItem(DRIVE_FOLDER_ID_STORAGE_KEY, createdFolder.id);
  return createdFolder.id;
}

async function uploadDriveFile(fileId, payload) {
  const config = getDriveConfig();
  const metadata = {
    name: config.driveFileName || "operation-log-sync.json",
    mimeType: "application/json",
  };

  const boundary = `operation-log-${Date.now()}`;
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    "Content-Type: application/json\r\n\r\n" +
    `${payload}\r\n` +
    `--${boundary}--`;

  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${driveAccessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`);
  }
}

async function createDriveFile(metadata, payload = "") {
  const boundary = `operation-log-${Date.now()}`;
  const contentType = metadata.mimeType === "application/vnd.google-apps.folder" ? "text/plain" : "application/json";
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n` +
    `${payload}\r\n` +
    `--${boundary}--`;

  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${driveAccessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Create failed with status ${response.status}`);
  }

  return response.json();
}

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function loadBestAvailableState() {
  const localState = readStateFromLocalStorage();
  const indexedDbState = await readStateFromIndexedDb();
  const snapshotState = readLatestSnapshot();
  const candidates = [localState, indexedDbState, snapshotState].filter(Boolean);

  if (candidates.length === 0) {
    return { entries: [], updatedAt: "", source: "" };
  }

  const winner = candidates.sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())[0];

  return {
    entries: Array.isArray(winner.entries) ? winner.entries.filter(isValidEntry) : [],
    updatedAt: winner.updatedAt || "",
    source: winner.source || "",
  };
}

function readStateFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        entries: parsed.filter(isValidEntry),
        updatedAt: inferUpdatedAt(parsed),
        source: "legacy-local-storage",
      };
    }

    if (isStatePayload(parsed)) {
      return {
        entries: parsed.entries.filter(isValidEntry),
        updatedAt: parsed.updatedAt,
        source: "local+indexeddb",
      };
    }
  } catch {
    return null;
  }

  return null;
}

function readLatestSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }

    const validSnapshots = parsed.filter(isStatePayload);
    if (validSnapshots.length === 0) {
      return null;
    }

    return {
      ...validSnapshots.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0],
      source: "snapshot",
    };
  } catch {
    return null;
  }
}

async function persistEntries() {
  const payload = {
    entries,
    updatedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    storeSnapshot(payload);
    await writeStateToIndexedDb(payload);
    updateStorageStatus(
      `Saved locally in browser storage, IndexedDB mirror, and restore snapshots. Latest save: ${formatTimestamp(payload.updatedAt)}.`,
      "success"
    );
    scheduleDriveSync("Automatic backup after save");
  } catch {
    updateStorageStatus(
      "The app could not confirm every backup layer. Export a JSON backup now before closing the page.",
      "error"
    );
  }
}

function storeSnapshot(payload) {
  const snapshots = readAllSnapshots()
    .filter((snapshot) => snapshot.updatedAt !== payload.updatedAt)
    .slice(0, MAX_SNAPSHOTS - 1);

  snapshots.unshift(payload);
  localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshots));
}

function readAllSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStatePayload) : [];
  } catch {
    return [];
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DB_STORE_NAME)) {
        database.createObjectStore(DB_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStateFromIndexedDb() {
  if (!("indexedDB" in window)) {
    return null;
  }

  try {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(DB_STORE_NAME, "readonly");
      const store = transaction.objectStore(DB_STORE_NAME);
      const request = store.get(DB_STATE_ID);

      request.onsuccess = () => {
        const result = request.result;
        resolve(isStatePayload(result) ? { ...result, source: "local+indexeddb" } : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function writeStateToIndexedDb(payload) {
  if (!("indexedDB" in window)) {
    return;
  }

  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DB_STORE_NAME, "readwrite");
    const store = transaction.objectStore(DB_STORE_NAME);
    store.put(payload, DB_STATE_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function isStatePayload(value) {
  return value && Array.isArray(value.entries) && typeof value.updatedAt === "string";
}

function inferUpdatedAt(entryList) {
  return entryList[0]?.createdAt || new Date().toISOString();
}

function normalizeEntry(entry) {
  const inferredRole = entry.myRole || inferRoleFromLegacyEntry(entry);
  return {
    ...entry,
    myRole: inferredRole,
    diagnosis: entry.diagnosis || "",
    notes: entry.notes || "",
    createdAt: entry.createdAt || new Date().toISOString(),
  };
}

function inferRoleFromLegacyEntry(entry) {
  if (entry.leadSurgeon) {
    return "Lead surgeon";
  }

  if (entry.assistantSurgeon) {
    return "Assistant";
  }

  return "";
}

function renderEntries(query = "") {
  const normalizedQuery = query.trim().toLowerCase();
  const categorizedEntries = entries
    .map((entry) => ({
      ...entry,
      caseCategory: categorizeProcedure(entry.procedure, entry.diagnosis),
    }))
    .filter((entry) => {
      const combined = [
        entry.patientName,
        entry.patientId,
        entry.procedure,
        entry.myRole,
        entry.diagnosis,
        entry.notes,
        entry.caseCategory,
      ].join(" ").toLowerCase();

      return combined.includes(normalizedQuery);
    });

  const availableCategories = buildAvailableCategories(categorizedEntries);
  if (!availableCategories.includes(activeCategoryFilter)) {
    activeCategoryFilter = "All";
  }

  renderCategoryFilters(availableCategories, normalizedQuery);

  const visibleEntries = activeCategoryFilter === "All"
    ? categorizedEntries
    : categorizedEntries.filter((entry) => entry.caseCategory === activeCategoryFilter);

  renderTableEntries(visibleEntries);
  renderGroupedEntries(visibleEntries);
  renderInfographics(visibleEntries);
  updateLogView();

  const hasRows = visibleEntries.length > 0;
  emptyState.hidden = hasRows;
  renderStats();
}

function renderTableEntries(visibleEntries) {
  entriesBody.innerHTML = "";

  visibleEntries.forEach((entry) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.entryId = entry.id;
    row.querySelector("[data-field='operationDate']").textContent = formatDate(entry.operationDate);
    row.querySelector("[data-field='patientName']").textContent = entry.patientName;
    row.querySelector("[data-field='patientId']").textContent = entry.patientId;
    row.querySelector("[data-field='procedure']").textContent = entry.procedure;
    row.querySelector("[data-field='myRole']").textContent = entry.myRole || "-";
    row.querySelector("[data-field='notes']").textContent = entry.notes || "No notes";
    entriesBody.appendChild(row);
  });
}

function renderGroupedEntries(visibleEntries) {
  groupedLog.innerHTML = "";

  const groupedByCategory = visibleEntries.reduce((accumulator, entry) => {
    if (!accumulator[entry.caseCategory]) {
      accumulator[entry.caseCategory] = [];
    }
    accumulator[entry.caseCategory].push(entry);
    return accumulator;
  }, {});

  Object.entries(groupedByCategory)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .forEach(([category, categoryEntries]) => {
      const groupNode = document.createElement("section");
      groupNode.className = "case-group";

      const latestDate = categoryEntries[0]?.operationDate || "";
      groupNode.innerHTML = `
        <div class="case-group-header">
          <div>
            <p class="eyebrow">${category}</p>
            <h3>${category} Cases</h3>
            <p class="case-group-meta">${categoryEntries.length} logged case${categoryEntries.length === 1 ? "" : "s"} in this group</p>
          </div>
          <div class="group-summary">
            <span class="summary-pill">Most recent ${formatDate(latestDate)}</span>
          </div>
        </div>
      `;

      const groupedByProcedure = categoryEntries.reduce((accumulator, entry) => {
        const bucketKey = normalizeProcedureKey(entry.procedure);
        if (!accumulator[bucketKey]) {
          accumulator[bucketKey] = {
            title: entry.procedure || "Unspecified procedure",
            entries: [],
          };
        }
        accumulator[bucketKey].entries.push(entry);
        return accumulator;
      }, {});

      Object.values(groupedByProcedure)
        .sort((left, right) => right.entries.length - left.entries.length || left.title.localeCompare(right.title))
        .forEach((bucket) => {
          const bucketNode = document.createElement("div");
          bucketNode.className = "procedure-bucket";

          const latestBucketDate = bucket.entries[0]?.operationDate || "";
          bucketNode.innerHTML = `
            <div class="bucket-header">
              <div>
                <h4>${bucket.title || "Unspecified procedure"}</h4>
                <p class="bucket-meta">${bucket.entries.length} similar case${bucket.entries.length === 1 ? "" : "s"} logged</p>
              </div>
              <span class="summary-pill">Latest ${formatDate(latestBucketDate)}</span>
            </div>
          `;

          const listNode = document.createElement("div");
          listNode.className = "case-list";

          bucket.entries.forEach((entry) => {
            const rowNode = document.createElement("div");
            rowNode.className = "case-row";
            rowNode.innerHTML = `
              <div class="case-row-main">
                <span class="case-row-title">${entry.patientName}</span>
                <span class="case-row-meta">${formatDate(entry.operationDate)} | ${entry.patientId}</span>
                <div class="case-row-tags">
                  ${entry.myRole ? `<span class="tag">${entry.myRole}</span>` : ""}
                  ${entry.diagnosis ? `<span class="tag">${entry.diagnosis}</span>` : ""}
                </div>
              </div>
              <div class="case-row-actions">
                <button class="ghost-btn" type="button" data-action="edit" data-entry-id="${entry.id}">Edit</button>
                <button class="danger-btn" type="button" data-action="delete" data-entry-id="${entry.id}">Delete</button>
              </div>
            `;
            listNode.appendChild(rowNode);
          });

          bucketNode.appendChild(listNode);
          groupNode.appendChild(bucketNode);
        });

      groupedLog.appendChild(groupNode);
    });
}

function renderCategoryFilters(categories, normalizedQuery) {
  categoryFilters.innerHTML = "";

  categories.forEach((category) => {
    const count = entries.filter((entry) => {
      const entryCategory = categorizeProcedure(entry.procedure, entry.diagnosis);
      const combined = [
        entry.patientName,
        entry.patientId,
        entry.procedure,
        entry.myRole,
        entry.diagnosis,
        entry.notes,
        entryCategory,
      ].join(" ").toLowerCase();

      const matchesSearch = combined.includes(normalizedQuery);
      return category === "All" ? matchesSearch : matchesSearch && entryCategory === category;
    }).length;

    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-chip${category === activeCategoryFilter ? " is-active" : ""}`;
    button.textContent = category === "All" ? `All Cases (${count})` : `${category} (${count})`;
    button.addEventListener("click", () => {
      activeCategoryFilter = category;
      renderEntries(searchInput.value);
    });
    categoryFilters.appendChild(button);
  });
}

function updateLogView() {
  const showGrouped = currentLogView === "grouped";
  groupedLog.hidden = !showGrouped;
  entriesTable.hidden = showGrouped;
  tableWrap.hidden = showGrouped;
  groupedViewBtn.classList.toggle("is-active", showGrouped);
  tableViewBtn.classList.toggle("is-active", !showGrouped);
}

function renderStats() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  totalCases.textContent = String(entries.length);
  monthCases.textContent = String(entries.filter((entry) => entry.operationDate.startsWith(currentMonth)).length);
}

function renderInfographics(visibleEntries) {
  renderCaseMixInfographic(visibleEntries);
  renderSurgeonInfographic(visibleEntries);
  renderVolumeInfographic(visibleEntries);
}

function renderCaseMixInfographic(visibleEntries) {
  caseMixChart.innerHTML = "";
  caseMixLegend.innerHTML = "";

  if (visibleEntries.length === 0) {
    caseMixCaption.textContent = "No cases yet";
    return;
  }

  const categoryCounts = Array.from(
    visibleEntries.reduce((map, entry) => {
      map.set(entry.caseCategory, (map.get(entry.caseCategory) || 0) + 1);
      return map;
    }, new Map()).entries()
  ).sort((left, right) => right[1] - left[1]);

  caseMixCaption.textContent = `${categoryCounts.length} category${categoryCounts.length === 1 ? "" : "ies"} represented`;

  categoryCounts.forEach(([category, count], index) => {
    const percent = (count / visibleEntries.length) * 100;
    const color = chartColor(index);

    const segment = document.createElement("div");
    segment.className = "stacked-segment";
    segment.style.width = `${Math.max(percent, 3)}%`;
    segment.style.background = color;
    segment.title = `${category}: ${count}`;
    caseMixChart.appendChild(segment);

    const legend = document.createElement("div");
    legend.className = "legend-item";
    legend.innerHTML = `
      <div class="legend-row">
        <span class="legend-label"><span class="legend-dot" style="background:${color}"></span>${category}</span>
        <strong>${count}</strong>
      </div>
    `;
    caseMixLegend.appendChild(legend);
  });
}

function renderSurgeonInfographic(visibleEntries) {
  surgeonLeaderboard.innerHTML = "";

  const surgeons = Array.from(
    visibleEntries.reduce((map, entry) => {
      const key = entry.myRole || "Unassigned";
      map.set(key, (map.get(key) || 0) + 1);
      return map;
    }, new Map()).entries()
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);

  if (surgeons.length === 0) {
    surgeonCaption.textContent = "No roles yet";
    return;
  }

  surgeonCaption.textContent = `${surgeons.length} role${surgeons.length === 1 ? "" : "s"} shown`;
  const maxCount = surgeons[0][1] || 1;

  surgeons.forEach(([surgeon, count]) => {
    const row = document.createElement("div");
    row.className = "leaderboard-item";
    row.innerHTML = `
      <div class="leaderboard-row">
        <span class="leaderboard-label">${surgeon}</span>
        <strong>${count}</strong>
      </div>
      <div class="mini-bar-track">
        <div class="mini-bar-fill" style="width:${(count / maxCount) * 100}%"></div>
      </div>
    `;
    surgeonLeaderboard.appendChild(row);
  });
}

function renderVolumeInfographic(visibleEntries) {
  volumeTimeline.innerHTML = "";

  const monthBuckets = buildRecentMonthBuckets(6);
  visibleEntries.forEach((entry) => {
    const key = entry.operationDate.slice(0, 7);
    if (monthBuckets[key]) {
      monthBuckets[key] += 1;
    }
  });

  const values = Object.values(monthBuckets);
  const maxValue = Math.max(...values, 1);
  volumeCaption.textContent = "Last 6 months";

  Object.entries(monthBuckets).forEach(([monthKey, count]) => {
    const monthNode = document.createElement("div");
    monthNode.className = "timeline-month";
    const height = count === 0 ? 8 : Math.max((count / maxValue) * 100, 12);
    monthNode.innerHTML = `
      <div class="timeline-value">${count}</div>
      <div class="timeline-bar-wrap">
        <div class="timeline-bar" style="height:${height}%"></div>
      </div>
      <div class="timeline-label">${formatMonthKey(monthKey)}</div>
    `;
    volumeTimeline.appendChild(monthNode);
  });
}

function populateForm(entry) {
  form.entryId.value = entry.id;
  form.patientName.value = entry.patientName;
  form.patientId.value = entry.patientId;
  form.procedure.value = entry.procedure;
  form.operationDate.value = entry.operationDate;
  if (entry.myRole === "Lead surgeon") {
    form.roleLead.checked = true;
  } else if (entry.myRole === "Assistant") {
    form.roleAssistant.checked = true;
  }
  form.diagnosis.value = entry.diagnosis || "";
  form.notes.value = entry.notes || "";

  formTitle.textContent = "Edit Operated Patient";
  formHint.textContent = "You are updating an existing entry.";
  submitBtn.textContent = "Update Entry";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  form.reset();
  form.entryId.value = "";
  form.operationDate.valueAsDate = new Date();
  if (form.roleLead) {
    form.roleLead.checked = false;
  }
  if (form.roleAssistant) {
    form.roleAssistant.checked = false;
  }
  formTitle.textContent = "Add Operated Patient";
  formHint.textContent = "Fields marked with * are required.";
  submitBtn.textContent = "Save Entry";
}

function compareByOperationDateDesc(left, right) {
  return right.operationDate.localeCompare(left.operationDate);
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "unknown time"
    : new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
}

function findExistingCreatedAt(entryId) {
  return entries.find((entry) => entry.id === entryId)?.createdAt || new Date().toISOString();
}

function isValidEntry(entry) {
  return (
    entry &&
    typeof entry.patientName === "string" &&
    typeof entry.patientId === "string" &&
    typeof entry.procedure === "string" &&
    typeof entry.operationDate === "string"
  );
}

function findLabeledValue(lines, labels) {
  for (const line of lines) {
    const normalized = line.toLowerCase();
    for (const label of labels) {
      if (normalized.startsWith(`${label}:`) || normalized.startsWith(`${label} `)) {
        return line.slice(line.toLowerCase().indexOf(label) + label.length).replace(/^[:\s-]+/, "").trim();
      }
    }
  }

  return "";
}

function findLikelyName(lines) {
  return lines.find((line) => /^[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,3}$/.test(line)) || "";
}

function findLikelyPatientId(text) {
  const match = text.match(/\b(?:MRN|ID|HOSPITAL\s*(?:NO|NUMBER)|FILE\s*(?:NO|NUMBER)|FOLDER\s*(?:NO|NUMBER))[:\s#-]*([A-Z0-9\/-]{4,})\b/i);
  return match ? match[1] : "";
}

function findLikelyProcedure(lines) {
  const keywords = ["ectomy", "plasty", "otomy", "repair", "excision", "append", "lapar", "arthro", "fusion"];
  return lines.find((line) => keywords.some((keyword) => line.toLowerCase().includes(keyword))) || "";
}

function findLikelyDate(text) {
  const match = text.match(/\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})\b/);
  return match ? match[1] : "";
}

function normalizeDateValue(value) {
  if (!value) {
    return "";
  }

  const text = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parts = text.split(/[\/.-]/).map((part) => part.trim());
  if (parts.length !== 3) {
    return "";
  }

  if (parts[0].length === 4) {
    const [year, month, day] = parts;
    return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  let [day, month, year] = parts;
  if (year.length === 2) {
    year = `${Number(year) > 50 ? "19" : "20"}${year}`;
  }

  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function escapeCsvCell(value) {
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

function buildAvailableCategories(categorizedEntries) {
  const categories = new Set(["All"]);
  categorizedEntries.forEach((entry) => categories.add(entry.caseCategory));
  return Array.from(categories);
}

function categorizeProcedure(procedure = "", diagnosis = "") {
  const combined = `${procedure} ${diagnosis}`.toLowerCase();
  const rules = [
    ["Orthopedic", ["hip", "knee", "femur", "fracture", "arthro", "spine", "tibia", "ankle", "shoulder"]],
    ["General Surgery", ["append", "lapar", "hernia", "chole", "bowel", "colon", "breast", "thyroid", "abscess"]],
    ["ENT", ["tonsil", "sinus", "ear", "mastoid", "sept", "adenoid", "laryng"]],
    ["Urology", ["prostate", "bladder", "ureter", "kidney", "orch", "cystoscopy", "neph"]],
    ["Gynecology", ["ovary", "uter", "c-section", "caes", "hyst", "salping", "myom"]],
    ["Cardiothoracic", ["cardiac", "thorac", "cabg", "lung", "stern", "valve"]],
    ["Neurosurgery", ["crani", "brain", "neuro", "ventric", "spinal cord"]],
    ["Vascular", ["vascular", "fistula", "aneurysm", "bypass", "endarterectomy"]],
    ["Ophthalmology", ["cataract", "retina", "cornea", "ocular"]],
  ];

  for (const [category, keywords] of rules) {
    if (keywords.some((keyword) => combined.includes(keyword))) {
      return category;
    }
  }

  return "Other";
}

function normalizeProcedureKey(procedure = "") {
  return procedure.trim().toLowerCase().replace(/\s+/g, " ") || "unspecified procedure";
}

function chartColor(index) {
  const colors = [
    "#0071e3",
    "#34aadc",
    "#30b0c7",
    "#6e8efb",
    "#7d7aff",
    "#3cb371",
    "#ff9f0a",
    "#ff6b6b",
  ];
  return colors[index % colors.length];
}

function buildRecentMonthBuckets(monthCount) {
  const buckets = {};
  const cursor = new Date();
  cursor.setDate(1);

  for (let index = monthCount - 1; index >= 0; index -= 1) {
    const date = new Date(cursor.getFullYear(), cursor.getMonth() - index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    buckets[key] = 0;
  }

  return buckets;
}

function formatMonthKey(monthKey) {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat(undefined, { month: "short" }).format(date);
}
