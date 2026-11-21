/**
 * ============================================================================
 *  ระบบบริหารจัดเก็บเงินบำรุงการศึกษา
 *  โรงเรียนวัดเสาหิน จังหวัดเชียงใหม่
 *  เวอร์ชัน 0.1.0 — ระยะที่ 1: โครงสร้างระบบและฐานข้อมูล
 * ============================================================================
 *
 *  วิธีติดตั้ง (ทำครั้งเดียว)
 *   1. เปิด Google Sheets ที่จะใช้เป็นฐานข้อมูล > เมนู ส่วนขยาย > Apps Script
 *   2. ลบโค้ดเดิมในไฟล์ Code.gs ทั้งหมด แล้ววางเนื้อหาไฟล์นี้ทั้งไฟล์ > กด Ctrl+S
 *   3. แถบด้านบน เลือกฟังก์ชัน SetupDatabase > กด "เรียกใช้" (Run) > อนุญาตสิทธิ์
 *   4. กลับไปที่ Google Sheets จะเห็นแท็บชีตของระบบ 15 แท็บ
 *
 *  วิธีอัปเดตเป็นเวอร์ชันใหม่: ทำข้อ 2 และ 3 ซ้ำ (ข้อมูลเดิมไม่หาย)
 *
 *  ห้ามแก้ไขไฟล์นี้โดยตรง: ไฟล์นี้สร้างอัตโนมัติจากโฟลเดอร์ src/ ด้วยคำสั่ง npm run build
 * ============================================================================
 */

// ============================================================================
// ไฟล์ต้นฉบับ: src/Setup.js
// ============================================================================

/**
 * ============================================================================
 *  Setup.gs — ติดตั้งและตรวจสอบโครงสร้างฐานข้อมูล + เมนูใน Google Sheets
 * ----------------------------------------------------------------------------
 *  วิธีใช้ (เจ้าของระบบเท่านั้น)
 *   - ใน Apps Script Editor เลือกฟังก์ชัน SetupDatabase แล้วกด "เรียกใช้ (Run)"
 *   - หรือเปิด Google Sheets → เมนู "ระบบเงินบำรุงการศึกษา" → "1) ติดตั้ง / ตรวจสอบโครงสร้างฐานข้อมูล"
 *
 *  SetupDatabase() รันซ้ำได้อย่างปลอดภัย
 *   - สร้างเฉพาะชีต คอลัมน์ และค่าตั้งค่าที่ยังไม่มี
 *   - ไม่ลบ ไม่ย้าย ไม่เขียนทับข้อมูลเดิม และไม่เปลี่ยนค่าลับที่สร้างไว้แล้ว
 *   - บันทึกผลการติดตั้งทุกครั้งใน AuditLogs
 * ============================================================================
 */

const MENU_TITLE = 'ระบบเงินบำรุงการศึกษา';

/**
 * ติดตั้งหรือตรวจสอบโครงสร้างฐานข้อมูล (ชื่อฟังก์ชันตามข้อกำหนดของโครงการ)
 * วางไว้เป็นฟังก์ชันแรกของไฟล์ เพื่อให้ถูกเลือกไว้ในช่อง "เรียกใช้ (Run)" ของ Apps Script Editor
 * คืนค่ารายงานผล (ไม่มีข้อมูลลับ) และแสดงผลใน "บันทึกการดำเนินการ (Execution log)"
 */
function SetupDatabase() {
  assertOwnerContext_();
  const ss = resolveSetupSpreadsheet_();
  dbUseSpreadsheet_(ss);
  const report = withScriptLock_(function () {
    return setupDatabase_(ss);
  }, LIMITS.SETUP_LOCK_TIMEOUT_MS);
  console.log('ผลการติดตั้งฐานข้อมูล\n' + formatSetupReport_(report));
  return report;
}

/** เพิ่มเมนูเมื่อเปิดไฟล์ Google Sheets (simple trigger) */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(MENU_TITLE)
    .addItem('1) ติดตั้ง / ตรวจสอบโครงสร้างฐานข้อมูล', 'menuSetupDatabase')
    .addItem('2) ตรวจสอบความถูกต้องของประวัติการใช้งาน', 'menuVerifyAuditLog')
    .addToUi();
}

/** เมนู 1: ยืนยันก่อน แล้วติดตั้ง/ตรวจสอบโครงสร้างฐานข้อมูล */
function menuSetupDatabase() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert(
    'ติดตั้ง / ตรวจสอบโครงสร้างฐานข้อมูล',
    'ระบบจะสร้างเฉพาะชีต คอลัมน์ และค่าตั้งค่าที่ยังไม่มี\n' +
    'ไม่ลบหรือแก้ไขข้อมูลเดิม\n\nต้องการดำเนินการต่อหรือไม่',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  try {
    const report = SetupDatabase();
    ui.alert('ผลการติดตั้งฐานข้อมูล', formatSetupReport_(report), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ติดตั้งไม่สำเร็จ', ownerErrorMessage_(e), ui.ButtonSet.OK);
  }
}

/** เมนู 2: ตรวจลูกโซ่ hash ของ AuditLogs (อ่านอย่างเดียว) */
function menuVerifyAuditLog() {
  const ui = SpreadsheetApp.getUi();
  try {
    assertOwnerContext_();
    const result = auditVerifyChain_();
    ui.alert('ผลการตรวจสอบประวัติการใช้งาน', formatAuditVerifyReport_(result), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ตรวจสอบไม่สำเร็จ', ownerErrorMessage_(e), ui.ButtonSet.OK);
  }
}

/**
 * อนุญาตเฉพาะเจ้าของระบบที่สั่งจาก Google Sheets หรือ Apps Script Editor
 * เมื่อเว็บแอปทำงานแบบ "Execute as: Me" ผู้เรียกจากเว็บจะมี activeUser ว่าง
 * หรือไม่ตรงกับ effectiveUser จึงถูกปฏิเสธ
 */
function assertOwnerContext_() {
  let active = '';
  let effective = '';
  try { active = Session.getActiveUser().getEmail() || ''; } catch (e) { active = ''; }
  try { effective = Session.getEffectiveUser().getEmail() || ''; } catch (e) { effective = ''; }
  if (!active || !effective || active.toLowerCase() !== effective.toLowerCase()) {
    throw appError_(ERROR_CODES.FORBIDDEN,
      'คำสั่งนี้ใช้ได้เฉพาะเจ้าของระบบ โดยสั่งจากเมนูใน Google Sheets หรือจาก Apps Script Editor เท่านั้น');
  }
}

function resolveSetupSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.DB_SPREADSHEET_ID);
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw appError_(ERROR_CODES.INTERNAL,
        'เปิดไฟล์ตาม DB_SPREADSHEET_ID ใน Script Properties ไม่ได้ กรุณาตรวจสอบค่านี้ หรือลบค่านี้เพื่อใช้ไฟล์ที่ผูกกับสคริปต์');
    }
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw appError_(ERROR_CODES.INTERNAL,
      'ไม่พบ Google Sheets ที่ผูกกับสคริปต์นี้ กรุณาสร้างสคริปต์จากเมนู ส่วนขยาย > Apps Script ของไฟล์ที่จะใช้เป็นฐานข้อมูล');
  }
  return active;
}

/** ขั้นตอนติดตั้งจริง (ต้องถือ lock อยู่) */
function setupDatabase_(ss) {
  assertLockHeld_();
  const report = {
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    startedAt: nowIso_(),
    schemaVersion: APP.SCHEMA_VERSION,
    propertiesInitialized: [],
    warnings: [],
    sheets: [],
    settingsAdded: [],
    changed: false,
  };

  initScriptProperties_(ss, report);
  SHEET_ORDER.forEach(function (name) {
    report.sheets.push(ensureSheet_(ss, name));
  });
  dbClearCache_();
  ensureDefaultSettings_(report);

  report.changed = report.propertiesInitialized.length > 0 ||
    report.settingsAdded.length > 0 ||
    report.sheets.some(function (s) { return s.action !== 'ok'; });

  auditAppend_([{
    action: AUDIT_ACTIONS.SETUP,
    entity: 'Database',
    entityId: ss.getId(),
    after: summarizeSetupReport_(report),
    note: report.changed ? 'ติดตั้งหรือปรับโครงสร้างฐานข้อมูล' : 'ตรวจสอบโครงสร้างฐานข้อมูล (ไม่มีการเปลี่ยนแปลง)',
  }], ACTORS.OWNER);
  return report;
}

/** สร้างค่าใน Script Properties ที่ยังไม่มี (ไม่เขียนทับค่าเดิมเด็ดขาด โดยเฉพาะ PASSWORD_PEPPER) */
function initScriptProperties_(ss, report) {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP_KEYS.DB_SPREADSHEET_ID)) {
    props.setProperty(PROP_KEYS.DB_SPREADSHEET_ID, ss.getId());
    report.propertiesInitialized.push(PROP_KEYS.DB_SPREADSHEET_ID);
  }
  const mode = props.getProperty(PROP_KEYS.AUTH_MODE);
  if (!mode) {
    props.setProperty(PROP_KEYS.AUTH_MODE, AUTH_MODES.PASSWORD);
    report.propertiesInitialized.push(PROP_KEYS.AUTH_MODE);
  } else if (!AUTH_MODES[mode]) {
    report.warnings.push('ค่า AUTH_MODE ใน Script Properties ไม่ถูกต้อง (ต้องเป็น PASSWORD หรือ GOOGLE)');
  }
  if (!props.getProperty(PROP_KEYS.PASSWORD_PEPPER)) {
    props.setProperty(PROP_KEYS.PASSWORD_PEPPER, newSecretHex_());
    report.propertiesInitialized.push(PROP_KEYS.PASSWORD_PEPPER);
  }
}

/** สร้างชีตหรือเพิ่มคอลัมน์ที่ขาด (ไม่แก้ข้อมูลเดิม) */
function ensureSheet_(ss, name) {
  const schema = getSchema_(name);
  const result = { name: name, label: schema.label, action: 'ok', addedColumns: [], extraColumns: [] };
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name, ss.getSheets().length);
    result.action = 'created';
  }
  ensureColumnCapacity_(sheet, schema.columns.length);

  const header = readHeader_(sheet);
  const nonEmpty = header.filter(function (h) { return h !== ''; });
  if (nonEmpty.length === 0) {
    if (sheet.getLastRow() > 1) {
      throw appError_(ERROR_CODES.INTERNAL,
        'ชีต "' + name + '" มีข้อมูลแต่ไม่มีหัวตาราง ระบบหยุดเพื่อไม่ให้ข้อมูลเดิมเสียหาย กรุณาตรวจสอบชีตนี้ด้วยตนเอง');
    }
    writeHeaderCells_(sheet, schema.columns, 1);
    applyColumnFormats_(sheet, schema.columns, 1);
    if (result.action !== 'created') result.action = 'headers_written';
  } else {
    buildColumnIndex_(header, schema); // ตรวจหัวคอลัมน์ซ้ำ
    const missing = schema.columns.filter(function (c) { return header.indexOf(c.name) === -1; });
    if (missing.length) {
      const startCol = lastNonEmptyIndex_(header) + 2;
      ensureColumnCapacity_(sheet, startCol + missing.length - 1);
      writeHeaderCells_(sheet, missing, startCol);
      applyColumnFormats_(sheet, missing, startCol);
      result.addedColumns = missing.map(function (c) { return c.name; });
      result.action = 'columns_added';
    }
    result.extraColumns = nonEmpty.filter(function (h) { return !schema.columnMap[h]; });
  }
  styleSheet_(sheet, schema);
  return result;
}

function lastNonEmptyIndex_(header) {
  for (let i = header.length - 1; i >= 0; i--) {
    if (header[i] !== '') return i;
  }
  return -1;
}

/** เขียนชื่อคอลัมน์และคำอธิบายภาษาไทย (เป็น note ที่หัวคอลัมน์) */
function writeHeaderCells_(sheet, columns, startCol) {
  const range = sheet.getRange(1, startCol, 1, columns.length);
  range.setNumberFormat('@');
  range.setValues([columns.map(function (c) { return c.name; })]);
  range.setNotes([columns.map(function (c) { return c.note; })]);
}

/** ตั้งรูปแบบทั้งคอลัมน์ (Plain text / จำนวนเงิน / จำนวนเต็ม) สำหรับคอลัมน์ที่สร้างใหม่ */
function applyColumnFormats_(sheet, columns, startCol) {
  const rows = sheet.getMaxRows() - 1;
  if (rows < 1) return;
  columns.forEach(function (col, i) {
    sheet.getRange(2, startCol + i, rows, 1).setNumberFormat(numberFormatFor_(col.type));
  });
}

/** หัวตารางสีกรมท่า ตรึงแถวแรก สีแท็บ และคำเตือนเมื่อแก้ไขชีตด้วยมือ */
function styleSheet_(sheet, schema) {
  const width = Math.max(sheet.getLastColumn(), schema.columns.length);
  sheet.getRange(1, 1, 1, width)
    .setFontWeight('bold')
    .setFontColor(SHEET_HEADER_STYLE.fontColor)
    .setBackground(SHEET_HEADER_STYLE.background)
    .setVerticalAlignment('middle');
  if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
  if (schema.tabColor) sheet.setTabColor(schema.tabColor);
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (!protections.length) {
    const protection = sheet.protect();
    protection.setDescription('ข้อมูลของระบบเงินบำรุงการศึกษา: กรุณาแก้ไขผ่านเว็บแอปเท่านั้น');
    protection.setWarningOnly(true);
  }
}

/** เพิ่มค่าตั้งค่าเริ่มต้นที่ยังไม่มี (ไม่เขียนทับค่าที่ตั้งไว้แล้ว) */
function ensureDefaultSettings_(report) {
  const existing = Object.create(null);
  dbAll_(SHEETS.SCHOOL_SETTINGS).forEach(function (row) { existing[row.SettingKey] = true; });
  const toAdd = SETTINGS_DEFS
    .filter(function (def) { return !existing[def.key]; })
    .map(function (def) {
      return { SettingKey: def.key, Value: defaultSettingValue_(def), Description: def.description };
    });
  if (toAdd.length) {
    dbInsertMany_(SHEETS.SCHOOL_SETTINGS, toAdd, ACTORS.OWNER, { note: 'ค่าเริ่มต้นจากการติดตั้งฐานข้อมูล' });
    report.settingsAdded = toAdd.map(function (r) { return r.SettingKey; });
  }
}

function defaultSettingValue_(def) {
  if (def.key === 'CURRENT_ACADEMIC_YEAR') return String(academicYearOfDate_(todayIso_()));
  return def.defaultValue === null || def.defaultValue === undefined ? '' : String(def.defaultValue);
}

/** สรุปผลแบบย่อสำหรับบันทึกใน AuditLogs */
function summarizeSetupReport_(report) {
  const summary = {
    schemaVersion: report.schemaVersion,
    sheetsCreated: [],
    headersWritten: [],
    columnsAdded: {},
    settingsAdded: report.settingsAdded.slice(),
    propertiesInitialized: report.propertiesInitialized.slice(),
    warnings: report.warnings.slice(),
  };
  report.sheets.forEach(function (s) {
    if (s.action === 'created') summary.sheetsCreated.push(s.name);
    if (s.action === 'headers_written') summary.headersWritten.push(s.name);
    if (s.addedColumns.length) summary.columnsAdded[s.name] = s.addedColumns.slice();
  });
  return summary;
}

/** ข้อความรายงานผลภาษาไทยสำหรับแสดงในกล่องข้อความ */
function formatSetupReport_(report) {
  const created = report.sheets.filter(function (s) { return s.action === 'created'; });
  const headers = report.sheets.filter(function (s) { return s.action === 'headers_written'; });
  const added = report.sheets.filter(function (s) { return s.addedColumns.length > 0; });
  const extra = report.sheets.filter(function (s) { return s.extraColumns.length > 0; });
  const lines = [];
  lines.push('ไฟล์ฐานข้อมูล: ' + report.spreadsheetName);
  lines.push('จำนวนชีตของระบบ: ' + report.sheets.length + ' ชีต');
  lines.push('');
  if (!report.changed) lines.push('โครงสร้างครบถ้วน ไม่มีการเปลี่ยนแปลง');
  if (created.length) lines.push('สร้างชีตใหม่ ' + created.length + ' ชีต: ' + created.map(function (s) { return s.name; }).join(', '));
  if (headers.length) lines.push('เขียนหัวตารางในชีตเดิม: ' + headers.map(function (s) { return s.name; }).join(', '));
  added.forEach(function (s) { lines.push('เพิ่มคอลัมน์ในชีต ' + s.name + ': ' + s.addedColumns.join(', ')); });
  if (report.settingsAdded.length) lines.push('เพิ่มค่าตั้งค่าเริ่มต้น ' + report.settingsAdded.length + ' รายการ');
  if (report.propertiesInitialized.length) {
    lines.push('สร้างค่าระบบใน Script Properties (ไม่แสดงค่า): ' + report.propertiesInitialized.join(', '));
  }
  extra.forEach(function (s) {
    lines.push('หมายเหตุ: ชีต ' + s.name + ' มีคอลัมน์ที่ระบบไม่ได้ใช้ (ไม่ลบ): ' + s.extraColumns.join(', '));
  });
  report.warnings.forEach(function (w) { lines.push('คำเตือน: ' + w); });
  return lines.join('\n');
}

function formatAuditVerifyReport_(result) {
  if (result.ok) {
    return 'ถูกต้อง: ประวัติการใช้งาน ' + result.total + ' รายการ ต่อเนื่องครบถ้วน ไม่พบการแก้ไขหรือลบ';
  }
  const lines = ['พบปัญหา ' + result.problemCount + ' จุด จากประวัติทั้งหมด ' + result.total + ' รายการ', ''];
  result.problems.slice(0, 15).forEach(function (p) {
    lines.push('แถว ' + p.rowNumber + ' (' + p.logId + '): ' + p.label);
  });
  if (result.problemCount > 15) lines.push('... และอื่น ๆ อีก ' + (result.problemCount - 15) + ' จุด');
  lines.push('');
  lines.push('กรุณาตรวจสอบประวัติเวอร์ชันของไฟล์ (ไฟล์ > ประวัติเวอร์ชัน) และแจ้งผู้อำนวยการ');
  return lines.join('\n');
}

/** ข้อความผิดพลาดสำหรับเจ้าของระบบ (แสดงในไฟล์ของเจ้าของเท่านั้น จึงแสดงรายละเอียดได้) */
function ownerErrorMessage_(e) {
  if (isAppError_(e)) return e.userMessage;
  return 'เกิดข้อผิดพลาด: ' + (e && e.message ? e.message : String(e));
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Code.js
// ============================================================================

/**
 * ============================================================================
 *  Code.gs — จุดเข้าของ Web App
 * ----------------------------------------------------------------------------
 *  ระยะที่ 1: แสดงหน้าสถานะ "อยู่ระหว่างติดตั้ง" เท่านั้น ไม่มีข้อมูลใด ๆ
 *  ระยะที่ 2: เปลี่ยนเป็นหน้าเข้าสู่ระบบและแอปเต็มรูปแบบ
 * ============================================================================
 */

function doGet() {
  const html =
    '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><base target="_top"></head>' +
    '<body style="margin:0;font-family:Sarabun,Tahoma,sans-serif;background:#F4F7FB;color:#1F3A5F">' +
    '<div style="max-width:560px;margin:48px auto;padding:24px;background:#FFFFFF;border-radius:12px;' +
    'border-top:6px solid #1F3A5F">' +
    '<h2 style="margin:0 0 4px">' + escapeHtml_(APP.NAME) + '</h2>' +
    '<p style="margin:0;color:#4A6A8F">' + escapeHtml_(APP.SCHOOL_NAME + ' จังหวัด' + APP.PROVINCE) + '</p>' +
    '<p style="margin:24px 0 0">ระบบอยู่ระหว่างการติดตั้ง ยังไม่เปิดให้ใช้งาน</p>' +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Config.js
// ============================================================================

/**
 * ============================================================================
 *  Config.gs — ค่าคงที่และโครงสร้างฐานข้อมูลทั้งหมดของระบบ
 *  ระบบบริหารจัดเก็บเงินบำรุงการศึกษา โรงเรียนวัดเสาหิน จังหวัดเชียงใหม่
 * ----------------------------------------------------------------------------
 *  หลักการของไฟล์นี้
 *   - โครงสร้างชีตทั้งหมดอยู่ใน SCHEMA ที่เดียว โค้ดส่วนอื่นอ้างคอลัมน์ด้วย "ชื่อ"
 *   - ห้ามเปลี่ยนชื่อหรือลบคอลัมน์เดิม ถ้าต้องการคอลัมน์ใหม่ให้เพิ่มต่อท้ายรายการ
 *     แล้วรันเมนู "ติดตั้ง / ตรวจสอบโครงสร้างฐานข้อมูล" ระบบจะเพิ่มคอลัมน์ที่ขาดให้
 *   - ไฟล์นี้มีแต่ข้อมูล ไม่มีโค้ดที่เรียกไฟล์อื่นตอนโหลด จึงวางไฟล์ในลำดับใดก็ได้
 *
 *  ชนิดคอลัมน์ (ใช้ควบคุมการตรวจและการเขียนค่า)
 *   id        รหัสอ้างอิงเฉพาะของแถว (คอลัมน์แรกของทุกชีต)
 *   text      ข้อความ (เก็บแบบ Plain text กันการแปลงอัตโนมัติและสูตร)
 *   enum      ข้อความที่ต้องเป็นค่าในรายการที่กำหนดเท่านั้น
 *   money     จำนวนเงิน (บาท ทศนิยม 2 ตำแหน่ง) ระบบคำนวณภายในเป็นสตางค์
 *   int       จำนวนเต็ม
 *   bool      TRUE / FALSE
 *   date      วันที่ ค.ศ. รูปแบบ yyyy-MM-dd (แสดงผลเป็น พ.ศ. บนหน้าเว็บ)
 *   datetime  วันเวลา ค.ศ. รูปแบบ yyyy-MM-dd HH:mm:ss เขตเวลา Asia/Bangkok
 *   json      ข้อมูลโครงสร้างที่ระบบใช้ภายใน
 * ============================================================================
 */

const APP = Object.freeze({
  NAME: 'ระบบบริหารจัดเก็บเงินบำรุงการศึกษา',
  SCHOOL_NAME: 'โรงเรียนวัดเสาหิน',
  PROVINCE: 'เชียงใหม่',
  VERSION: '0.1.0',
  RELEASE: 'ระยะที่ 1: โครงสร้างระบบและฐานข้อมูล',
  SCHEMA_VERSION: 1,
  TIMEZONE: 'Asia/Bangkok',
});

/** ชื่อค่าใน Script Properties (ที่เก็บความลับ ไม่อยู่ในชีต และไม่ส่งออกไปหน้าเว็บ) */
const PROP_KEYS = Object.freeze({
  DB_SPREADSHEET_ID: 'DB_SPREADSHEET_ID', // รหัสไฟล์ Google Sheets ที่ใช้เป็นฐานข้อมูล
  AUTH_MODE: 'AUTH_MODE',                 // PASSWORD หรือ GOOGLE
  PASSWORD_PEPPER: 'PASSWORD_PEPPER',     // ค่าลับสำหรับแฮชรหัสผ่าน ห้ามแก้หรือลบ
  BACKUP_FOLDER_ID: 'BACKUP_FOLDER_ID',   // โฟลเดอร์สำรองข้อมูล (ระยะที่ 7)
  AUDIT_HEAD: 'AUDIT_HEAD',               // ตำแหน่งและ hash ล่าสุดของ AuditLogs ใช้ตรวจการลบแถวท้ายชีต
});

const AUTH_MODES = Object.freeze({ PASSWORD: 'PASSWORD', GOOGLE: 'GOOGLE' });

const ROLES = Object.freeze({ ADMIN: 'ADMIN', FINANCE: 'FINANCE', DIRECTOR: 'DIRECTOR' });

const ROLE_LABELS = Object.freeze({
  ADMIN: 'ผู้ดูแลระบบ',
  FINANCE: 'เจ้าหน้าที่การเงิน',
  DIRECTOR: 'ผู้อำนวยการ',
});

/** ผู้กระทำที่ไม่ใช่ผู้ใช้ในชีต Users (บันทึกลง AuditLogs) */
const ACTORS = Object.freeze({
  OWNER: Object.freeze({ userId: 'OWNER', username: 'owner', role: 'OWNER' }),
  SYSTEM: Object.freeze({ userId: 'SYSTEM', username: 'system', role: 'SYSTEM' }),
});

const LIMITS = Object.freeze({
  LOCK_TIMEOUT_MS: 20000,       // รอ lock สูงสุดสำหรับการบันทึกทั่วไป
  SETUP_LOCK_TIMEOUT_MS: 30000, // รอ lock สูงสุดสำหรับการติดตั้งฐานข้อมูล
  CELL_MAX_CHARS: 50000,        // ข้อจำกัดของ Google Sheets ต่อ 1 เซลล์
  ROW_CAPACITY_STEP: 200,       // เพิ่มแถวว่างครั้งละกี่แถวเมื่อชีตเต็ม
});

/** สถานะทั้งหมดของระบบ (ค่าที่เก็บในชีตเป็นภาษาอังกฤษ ป้ายภาษาไทยอยู่ใน STATUS_LABELS) */
const STATUS = Object.freeze({
  USER: Object.freeze({ ACTIVE: 'ACTIVE', DISABLED: 'DISABLED' }),
  STUDENT: Object.freeze({ STUDYING: 'STUDYING', TRANSFERRED: 'TRANSFERRED', GRADUATED: 'GRADUATED' }),
  ACADEMIC_YEAR: Object.freeze({ OPEN: 'OPEN', CLOSED: 'CLOSED' }),
  FEE_SETTING: Object.freeze({ ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' }),
  TERM: Object.freeze({ TERM_1: '1', TERM_2: '2', YEAR: 'Y' }),
  ASSESSMENT: Object.freeze({ ACTIVE: 'ACTIVE', CANCELLED: 'CANCELLED' }),
  ADJUSTMENT_TYPE: Object.freeze({ DISCOUNT: 'DISCOUNT', EXEMPTION: 'EXEMPTION' }),
  ADJUSTMENT: Object.freeze({ ACTIVE: 'ACTIVE', REVOKED: 'REVOKED' }),
  PAYMENT: Object.freeze({ ACTIVE: 'ACTIVE', VOIDED: 'VOIDED', REPLACED: 'REPLACED' }),
  ALLOCATION: Object.freeze({ ACTIVE: 'ACTIVE', VOIDED: 'VOIDED' }),
  BOOK: Object.freeze({ REGISTERED: 'REGISTERED', ACTIVE: 'ACTIVE', FULL: 'FULL', CLOSED: 'CLOSED' }),
  RECEIPT_ENTRY: Object.freeze({ USED: 'USED', CANCEL_PENDING: 'CANCEL_PENDING', CANCELLED: 'CANCELLED' }),
  CANCEL_TYPE: Object.freeze({ SPOILED: 'SPOILED', VOID_PAYMENT: 'VOID_PAYMENT' }),
  DECISION: Object.freeze({ PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', WITHDRAWN: 'WITHDRAWN' }),
  REQUEST_TYPE: Object.freeze({
    FEE_ADJUSTMENT: 'FEE_ADJUSTMENT',
    ASSESSMENT_CANCEL: 'ASSESSMENT_CANCEL',
    RECEIPT_CANCEL: 'RECEIPT_CANCEL',
    PAYMENT_CORRECTION: 'PAYMENT_CORRECTION',
    BOOK_CLOSE: 'BOOK_CLOSE',
  }),
  // สถานะการชำระของรายการเรียกเก็บ: ระบบคำนวณจากข้อมูลทุกครั้ง ไม่ได้เก็บไว้ในชีต
  PAY_STATE: Object.freeze({ UNPAID: 'UNPAID', PARTIAL: 'PARTIAL', PAID: 'PAID', EXEMPT: 'EXEMPT', CANCELLED: 'CANCELLED' }),
});

const STATUS_LABELS = Object.freeze({
  USER: { ACTIVE: 'ใช้งาน', DISABLED: 'ปิดการใช้งาน' },
  STUDENT: { STUDYING: 'กำลังศึกษา', TRANSFERRED: 'ย้ายออก', GRADUATED: 'จบการศึกษา' },
  ACADEMIC_YEAR: { OPEN: 'เปิด', CLOSED: 'ปิดแล้ว' },
  FEE_SETTING: { ACTIVE: 'ใช้งาน', INACTIVE: 'ไม่ใช้งาน' },
  TERM: { '1': 'ภาคเรียนที่ 1', '2': 'ภาคเรียนที่ 2', Y: 'ทั้งปีการศึกษา' },
  ASSESSMENT: { ACTIVE: 'มีผล', CANCELLED: 'ยกเลิก' },
  ADJUSTMENT_TYPE: { DISCOUNT: 'ลดหย่อน', EXEMPTION: 'ยกเว้น' },
  ADJUSTMENT: { ACTIVE: 'มีผล', REVOKED: 'เพิกถอน' },
  PAYMENT: { ACTIVE: 'มีผล', VOIDED: 'ยกเลิกใบเสร็จ', REPLACED: 'ถูกแทนด้วยรายการแก้ไข' },
  ALLOCATION: { ACTIVE: 'มีผล', VOIDED: 'ยกเลิก' },
  BOOK: { REGISTERED: 'ลงทะเบียนแล้ว', ACTIVE: 'กำลังใช้', FULL: 'ใช้ครบเล่ม', CLOSED: 'ปิดเล่ม' },
  RECEIPT_ENTRY: { USED: 'ใช้แล้ว', CANCEL_PENDING: 'รออนุมัติยกเลิก', CANCELLED: 'ยกเลิก' },
  CANCEL_TYPE: { SPOILED: 'เขียนผิดหรือชำรุด (ยังไม่บันทึกรับเงิน)', VOID_PAYMENT: 'ยกเลิกใบเสร็จที่บันทึกรับเงินแล้ว' },
  DECISION: { PENDING: 'รออนุมัติ', APPROVED: 'อนุมัติ', REJECTED: 'ไม่อนุมัติ', WITHDRAWN: 'ถอนคำขอ' },
  REQUEST_TYPE: {
    FEE_ADJUSTMENT: 'ลดหย่อน/ยกเว้น',
    ASSESSMENT_CANCEL: 'ยกเลิกรายการเรียกเก็บ',
    RECEIPT_CANCEL: 'ยกเลิกเลขที่ใบเสร็จ',
    PAYMENT_CORRECTION: 'แก้ไขรายการรับเงินที่บันทึกผิด',
    BOOK_CLOSE: 'ปิดเล่มใบเสร็จก่อนใช้ครบเล่ม',
  },
  PAY_STATE: { UNPAID: 'ยังไม่ชำระ', PARTIAL: 'ชำระบางส่วน', PAID: 'ชำระครบ', EXEMPT: 'ได้รับยกเว้น', CANCELLED: 'ยกเลิก' },
});

/** การกระทำที่บันทึกใน AuditLogs */
const AUDIT_ACTIONS = Object.freeze({
  SETUP: 'SETUP',
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  CANCEL: 'CANCEL',
  REQUEST: 'REQUEST',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  IMPORT: 'IMPORT',
  EXPORT: 'EXPORT',
  BACKUP: 'BACKUP',
  RESTORE: 'RESTORE',
  INTEGRITY_CHECK: 'INTEGRITY_CHECK',
});

const SHEETS = Object.freeze({
  USERS: 'Users',
  SCHOOL_SETTINGS: 'SchoolSettings',
  ACADEMIC_YEARS: 'AcademicYears',
  STUDENTS: 'Students',
  ENROLLMENTS: 'Enrollments',
  FEE_SETTINGS: 'FeeSettings',
  FEE_ASSESSMENTS: 'FeeAssessments',
  FEE_ADJUSTMENTS: 'FeeAdjustments',
  PAYMENTS: 'Payments',
  PAYMENT_ALLOCATIONS: 'PaymentAllocations',
  RECEIPT_BOOKS: 'ReceiptBooks',
  RECEIPT_ENTRIES: 'ReceiptEntries',
  RECEIPT_CANCELLATIONS: 'ReceiptCancellations',
  APPROVAL_REQUESTS: 'ApprovalRequests',
  AUDIT_LOGS: 'AuditLogs',
});

/** ลำดับแท็บชีตเมื่อสร้างใหม่ */
const SHEET_ORDER = Object.freeze([
  SHEETS.USERS,
  SHEETS.SCHOOL_SETTINGS,
  SHEETS.ACADEMIC_YEARS,
  SHEETS.STUDENTS,
  SHEETS.ENROLLMENTS,
  SHEETS.FEE_SETTINGS,
  SHEETS.FEE_ASSESSMENTS,
  SHEETS.FEE_ADJUSTMENTS,
  SHEETS.PAYMENTS,
  SHEETS.PAYMENT_ALLOCATIONS,
  SHEETS.RECEIPT_BOOKS,
  SHEETS.RECEIPT_ENTRIES,
  SHEETS.RECEIPT_CANCELLATIONS,
  SHEETS.APPROVAL_REQUESTS,
  SHEETS.AUDIT_LOGS,
]);

const TAB_COLORS = Object.freeze({
  SYSTEM: '#607D8B',
  STUDENT: '#2E86DE',
  FEE: '#1F3A5F',
  RECEIPT: '#0B7285',
  APPROVAL: '#B7791F',
  AUDIT: '#9B2C2C',
});

/** สีหัวตารางในชีต (โทนกรมท่า) */
const SHEET_HEADER_STYLE = Object.freeze({ background: '#1F3A5F', fontColor: '#FFFFFF' });

/** คอลัมน์ที่ระบบบันทึกเองทุกครั้ง ห้ามส่งค่ามาจากโค้ดส่วนอื่น */
const SYSTEM_COLUMNS = Object.freeze(['CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy']);

const STD_CREATED_COLUMNS_ = [
  ['CreatedAt', 'datetime', 'วันเวลาที่สร้างรายการ (ระบบบันทึกอัตโนมัติ)'],
  ['CreatedBy', 'text', 'ชื่อผู้ใช้ที่สร้างรายการ (ระบบบันทึกอัตโนมัติ)'],
];

const STD_UPDATED_COLUMNS_ = [
  ['UpdatedAt', 'datetime', 'วันเวลาที่แก้ไขล่าสุด (ระบบบันทึกอัตโนมัติ)'],
  ['UpdatedBy', 'text', 'ชื่อผู้ใช้ที่แก้ไขล่าสุด (ระบบบันทึกอัตโนมัติ)'],
];

/**
 * โครงสร้างฐานข้อมูล
 *  label       ชื่อภาษาไทยของชีต
 *  idPrefix    คำนำหน้ารหัสอ้างอิงที่ระบบสร้างอัตโนมัติ (null = ผู้เรียกต้องกำหนดรหัสเอง)
 *  columns     [ชื่อคอลัมน์, ชนิด, คำอธิบายภาษาไทย, รายการค่าที่อนุญาต (เฉพาะ enum)]
 *  unique      กฎห้ามซ้ำ { cols, skipStatus (สถานะที่ไม่นับ), message }
 *              ค่าว่างไม่นับว่าซ้ำ และเทียบโดยไม่สนตัวพิมพ์เล็กใหญ่และช่องว่างหัวท้าย
 *  mutable     คอลัมน์ที่แก้ไขได้หลังบันทึก ('*' = ทุกคอลัมน์ยกเว้นรหัสและคอลัมน์ระบบ)
 *              คอลัมน์ที่ไม่อยู่ในรายการ "แก้ไขไม่ได้" ระบบจะปฏิเสธทันที
 *  secret      คอลัมน์ลับ: ซ่อนค่าใน AuditLogs และห้ามส่งออกไปหน้าเว็บ
 *  auditExempt คอลัมน์ที่เปลี่ยนบ่อยและไม่สำคัญ ไม่ต้องบันทึก AuditLogs เมื่อเปลี่ยนเฉพาะคอลัมน์นี้
 *  writeVia    'db' (ค่าเริ่มต้น) หรือ 'audit' (เขียนได้เฉพาะผ่าน auditAppend_)
 */
const SCHEMA = Object.freeze({
  [SHEETS.USERS]: {
    label: 'ผู้ใช้งาน',
    idPrefix: 'USR',
    tabColor: TAB_COLORS.SYSTEM,
    columns: [
      ['UserId', 'id', 'รหัสผู้ใช้ (ระบบสร้างอัตโนมัติ)'],
      ['Username', 'text', 'ชื่อผู้ใช้สำหรับเข้าสู่ระบบ ไม่ซ้ำ ตัวพิมพ์เล็ก เปลี่ยนภายหลังไม่ได้'],
      ['DisplayName', 'text', 'ชื่อ-นามสกุล'],
      ['Position', 'text', 'ตำแหน่ง (ใช้ในช่องลงนามของรายงาน)'],
      ['Email', 'text', 'อีเมล (ใช้เมื่อเข้าสู่ระบบด้วยบัญชี Google ของโรงเรียน)'],
      ['Role', 'enum', 'บทบาท: ADMIN ผู้ดูแลระบบ / FINANCE เจ้าหน้าที่การเงิน / DIRECTOR ผู้อำนวยการ', ROLES],
      ['Status', 'enum', 'สถานะ: ACTIVE ใช้งาน / DISABLED ปิดการใช้งาน', STATUS.USER],
      ['PasswordHash', 'text', 'ค่าแฮชรหัสผ่าน (ห้ามแก้ไขด้วยมือ ระบบไม่ส่งค่านี้ออกไปหน้าเว็บ)'],
      ['MustChangePassword', 'bool', 'TRUE = ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งถัดไป'],
      ['SessionVersion', 'int', 'เลขรุ่นของการเข้าสู่ระบบ เพิ่มขึ้นเมื่อต้องการให้ทุกการเข้าสู่ระบบเดิมของผู้ใช้หมดอายุทันที'],
      ['LastLoginAt', 'datetime', 'วันเวลาเข้าสู่ระบบล่าสุด'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [
      { cols: ['Username'], message: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' },
      { cols: ['Email'], message: 'อีเมลนี้ถูกใช้กับผู้ใช้อื่นแล้ว' },
    ],
    mutable: ['DisplayName', 'Position', 'Email', 'Role', 'Status', 'PasswordHash',
      'MustChangePassword', 'SessionVersion', 'LastLoginAt'],
    secret: ['PasswordHash'],
    auditExempt: ['LastLoginAt'],
  },

  [SHEETS.SCHOOL_SETTINGS]: {
    label: 'ค่าตั้งค่าโรงเรียน',
    idPrefix: null,
    tabColor: TAB_COLORS.SYSTEM,
    columns: [
      ['SettingKey', 'id', 'ชื่อค่าตั้งค่า (ห้ามแก้ไข)'],
      ['Value', 'text', 'ค่าที่ตั้งไว้ (แก้ไขผ่านหน้าเว็บ เมนูตั้งค่า)'],
      ['Description', 'text', 'คำอธิบาย'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [],
    mutable: ['Value', 'Description'],
  },

  [SHEETS.ACADEMIC_YEARS]: {
    label: 'ปีการศึกษา',
    idPrefix: 'AY',
    tabColor: TAB_COLORS.SYSTEM,
    columns: [
      ['AcademicYearId', 'id', 'รหัสปีการศึกษา (ระบบสร้างอัตโนมัติ)'],
      ['Year', 'int', 'ปีการศึกษา (พ.ศ.) เช่น 2569'],
      ['Label', 'text', 'ชื่อที่แสดง เช่น ปีการศึกษา 2569'],
      ['StartDate', 'date', 'วันเริ่มปีการศึกษา (ค.ศ. yyyy-MM-dd)'],
      ['EndDate', 'date', 'วันสิ้นสุดปีการศึกษา (ค.ศ. yyyy-MM-dd)'],
      ['IsCurrent', 'bool', 'TRUE = ปีการศึกษาปัจจุบัน (มีได้ปีเดียว)'],
      ['Status', 'enum', 'OPEN เปิด / CLOSED ปิดแล้ว (ปิดแล้วสร้างรายการเรียกเก็บใหม่ไม่ได้ แต่ยังรับชำระหนี้ค้างได้)', STATUS.ACADEMIC_YEAR],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{ cols: ['Year'], message: 'มีปีการศึกษานี้ในระบบแล้ว' }],
    mutable: ['Label', 'StartDate', 'EndDate', 'IsCurrent', 'Status'],
  },

  [SHEETS.STUDENTS]: {
    label: 'นักเรียน',
    idPrefix: 'STU',
    tabColor: TAB_COLORS.STUDENT,
    columns: [
      ['StudentId', 'id', 'รหัสนักเรียนในระบบ (ระบบสร้างอัตโนมัติ)'],
      ['StudentNo', 'text', 'เลขประจำตัวนักเรียนของโรงเรียน (ไม่ซ้ำ)'],
      ['Prefix', 'text', 'คำนำหน้าชื่อ เช่น ด.ช. ด.ญ.'],
      ['FirstName', 'text', 'ชื่อ'],
      ['LastName', 'text', 'นามสกุล'],
      ['Status', 'enum', 'STUDYING กำลังศึกษา / TRANSFERRED ย้ายออก / GRADUATED จบการศึกษา', STATUS.STUDENT],
      ['StatusDate', 'date', 'วันที่เปลี่ยนสถานะล่าสุด'],
      ['StatusNote', 'text', 'หมายเหตุการเปลี่ยนสถานะ'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{ cols: ['StudentNo'], message: 'เลขประจำตัวนักเรียนนี้มีอยู่ในระบบแล้ว' }],
    mutable: '*',
  },

  [SHEETS.ENROLLMENTS]: {
    label: 'ชั้นเรียนรายปี',
    idPrefix: 'ENR',
    tabColor: TAB_COLORS.STUDENT,
    columns: [
      ['EnrollmentId', 'id', 'รหัสข้อมูลชั้นเรียนรายปี (ระบบสร้างอัตโนมัติ)'],
      ['StudentId', 'text', 'รหัสนักเรียนในระบบ (อ้างอิงชีต Students)'],
      ['AcademicYear', 'int', 'ปีการศึกษา (พ.ศ.)'],
      ['GradeLevel', 'text', 'ระดับชั้น เช่น ป.1'],
      ['Room', 'text', 'ห้อง'],
      ['ClassNo', 'int', 'เลขที่'],
      ['EnrollStatus', 'enum', 'สถานะในปีการศึกษานั้น: STUDYING / TRANSFERRED / GRADUATED', STATUS.STUDENT],
      ['Note', 'text', 'หมายเหตุ'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{ cols: ['StudentId', 'AcademicYear'], message: 'นักเรียนคนนี้มีข้อมูลชั้นเรียนในปีการศึกษานี้แล้ว' }],
    mutable: '*',
  },

  [SHEETS.FEE_SETTINGS]: {
    label: 'อัตราเงินบำรุงการศึกษา',
    idPrefix: 'FEE',
    tabColor: TAB_COLORS.FEE,
    columns: [
      ['FeeSettingId', 'id', 'รหัสอัตราเงินบำรุง (ระบบสร้างอัตโนมัติ)'],
      ['AcademicYear', 'int', 'ปีการศึกษา (พ.ศ.)'],
      ['Term', 'enum', 'ภาคเรียน: 1 / 2 / Y = ทั้งปีการศึกษา', STATUS.TERM],
      ['GradeLevel', 'text', 'ระดับชั้น'],
      ['Amount', 'money', 'จำนวนเงินต่อคน (บาท) แก้ไม่ได้หลังสร้างรายการเรียกเก็บแล้ว'],
      ['StartDate', 'date', 'วันเริ่มเรียกเก็บ'],
      ['DueDate', 'date', 'วันครบกำหนดชำระ'],
      ['Description', 'text', 'คำอธิบาย'],
      ['ApprovalRef', 'text', 'เลขที่และวันที่ของหนังสือหรือมติที่อนุมัติอัตรานี้ (เช่น มติคณะกรรมการสถานศึกษา)'],
      ['Status', 'enum', 'ACTIVE ใช้งาน / INACTIVE ไม่ใช้งาน', STATUS.FEE_SETTING],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{
      cols: ['AcademicYear', 'Term', 'GradeLevel'],
      message: 'มีอัตราเงินบำรุงของปีการศึกษา ภาคเรียน และระดับชั้นนี้แล้ว',
    }],
    // Amount แก้ได้ที่ชั้นข้อมูล แต่ระยะที่ 4 จะห้ามแก้เมื่อมีรายการเรียกเก็บแล้ว
    mutable: ['Amount', 'StartDate', 'DueDate', 'Description', 'ApprovalRef', 'Status'],
  },

  [SHEETS.FEE_ASSESSMENTS]: {
    label: 'รายการเรียกเก็บรายบุคคล',
    idPrefix: 'ASM',
    tabColor: TAB_COLORS.FEE,
    columns: [
      ['AssessmentId', 'id', 'รหัสรายการเรียกเก็บ (ระบบสร้างอัตโนมัติ)'],
      ['StudentId', 'text', 'รหัสนักเรียนในระบบ'],
      ['EnrollmentId', 'text', 'รหัสข้อมูลชั้นเรียนรายปี'],
      ['FeeSettingId', 'text', 'รหัสอัตราเงินบำรุง'],
      ['AcademicYear', 'int', 'ปีการศึกษา (พ.ศ.)'],
      ['Term', 'enum', 'ภาคเรียน', STATUS.TERM],
      ['GradeLevel', 'text', 'ระดับชั้น ณ วันที่สร้างรายการ'],
      ['Room', 'text', 'ห้อง ณ วันที่สร้างรายการ'],
      ['GrossAmount', 'money', 'ยอดเรียกเก็บก่อนลดหย่อน (บาท) แก้ไขไม่ได้'],
      ['DueDate', 'date', 'วันครบกำหนดชำระ'],
      ['Status', 'enum', 'ACTIVE มีผล / CANCELLED ยกเลิก', STATUS.ASSESSMENT],
      ['CancelReason', 'text', 'เหตุผลการยกเลิก'],
      ['CancelledAt', 'datetime', 'วันเวลาที่ยกเลิก'],
      ['CancelledBy', 'text', 'ผู้ยกเลิก'],
      ['ApprovalRequestId', 'text', 'รหัสคำขออนุมัติที่เกี่ยวข้อง'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{
      cols: ['StudentId', 'FeeSettingId'],
      skipStatus: [STATUS.ASSESSMENT.CANCELLED],
      message: 'นักเรียนคนนี้มีรายการเรียกเก็บของอัตรานี้แล้ว',
    }],
    mutable: ['Status', 'CancelReason', 'CancelledAt', 'CancelledBy', 'ApprovalRequestId'],
  },

  [SHEETS.FEE_ADJUSTMENTS]: {
    label: 'ลดหย่อน/ยกเว้น',
    idPrefix: 'ADJ',
    tabColor: TAB_COLORS.FEE,
    columns: [
      ['AdjustmentId', 'id', 'รหัสรายการลดหย่อน/ยกเว้น (ระบบสร้างอัตโนมัติ)'],
      ['AssessmentId', 'text', 'รหัสรายการเรียกเก็บ'],
      ['StudentId', 'text', 'รหัสนักเรียนในระบบ'],
      ['Type', 'enum', 'DISCOUNT ลดหย่อน / EXEMPTION ยกเว้น', STATUS.ADJUSTMENT_TYPE],
      ['Amount', 'money', 'จำนวนเงินที่ลดหรือยกเว้น (บาท) แก้ไขไม่ได้'],
      ['Reason', 'text', 'เหตุผล'],
      ['ReferenceDoc', 'text', 'เอกสารอ้างอิง เช่น เลขที่หนังสือขอยกเว้นหรือประกาศของโรงเรียน'],
      ['Status', 'enum', 'ACTIVE มีผล / REVOKED เพิกถอน', STATUS.ADJUSTMENT],
      ['RequestedBy', 'text', 'ผู้ขอ (เจ้าหน้าที่การเงิน)'],
      ['ApprovedBy', 'text', 'ผู้อนุมัติ (ว่าง = ไม่ต้องอนุมัติตามการตั้งค่า)'],
      ['ApprovalRequestId', 'text', 'รหัสคำขออนุมัติ'],
      ['RevokedAt', 'datetime', 'วันเวลาที่เพิกถอน'],
      ['RevokedBy', 'text', 'ผู้เพิกถอน'],
      ['RevokeReason', 'text', 'เหตุผลการเพิกถอน'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [],
    mutable: ['Status', 'RevokedAt', 'RevokedBy', 'RevokeReason'],
  },

  [SHEETS.PAYMENTS]: {
    label: 'การรับชำระเงิน',
    idPrefix: 'PAY',
    tabColor: TAB_COLORS.FEE,
    columns: [
      ['PaymentId', 'id', 'รหัสการรับเงิน (ระบบสร้างอัตโนมัติ)'],
      ['RequestKey', 'text', 'รหัสคำขอจากหน้าเว็บ ใช้กันการบันทึกซ้ำ'],
      ['StudentId', 'text', 'รหัสนักเรียนในระบบ'],
      ['PaymentDate', 'date', 'วันที่รับเงิน'],
      ['Amount', 'money', 'จำนวนเงินที่รับจริง (บาท) แก้ไขไม่ได้'],
      ['Channel', 'text', 'ช่องทางการรับเงิน'],
      ['ChannelRef', 'text', 'เลขอ้างอิง เช่น เลขรายการโอน'],
      ['ReceiptBookId', 'text', 'รหัสเล่มใบเสร็จ'],
      ['ReceiptBookNo', 'text', 'เลขเล่มใบเสร็จ'],
      ['ReceiptNo', 'int', 'เลขที่ใบเสร็จ'],
      ['ReceiptEntryId', 'text', 'รหัสรายการในทะเบียนคุมใบเสร็จ'],
      ['ReceivedByName', 'text', 'ผู้รับเงิน'],
      ['Note', 'text', 'หมายเหตุ'],
      ['Status', 'enum', 'ACTIVE มีผล / VOIDED ยกเลิกใบเสร็จ / REPLACED ถูกแทนด้วยรายการแก้ไข', STATUS.PAYMENT],
      ['VoidReason', 'text', 'เหตุผลการยกเลิกหรือการแก้ไข'],
      ['VoidedAt', 'datetime', 'วันเวลาที่ยกเลิกหรือแก้ไข'],
      ['VoidedBy', 'text', 'ผู้ยกเลิกหรือแก้ไข'],
      ['ReplacesPaymentId', 'text', 'รหัสการรับเงินเดิมที่รายการนี้แก้ไขแทน'],
      ['ReplacedByPaymentId', 'text', 'รหัสการรับเงินใหม่ที่แก้ไขแทนรายการนี้'],
      ['ApprovalRequestId', 'text', 'รหัสคำขออนุมัติที่เกี่ยวข้อง'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [
      { cols: ['RequestKey'], message: 'รายการนี้ถูกบันทึกไปแล้ว (ระบบป้องกันการกดบันทึกซ้ำ)' },
      {
        cols: ['ReceiptBookId', 'ReceiptNo'],
        skipStatus: [STATUS.PAYMENT.VOIDED, STATUS.PAYMENT.REPLACED],
        message: 'เลขที่ใบเสร็จนี้ผูกกับการรับเงินที่ยังมีผลอยู่แล้ว',
      },
    ],
    mutable: ['Status', 'VoidReason', 'VoidedAt', 'VoidedBy', 'ReplacedByPaymentId', 'ApprovalRequestId'],
  },

  [SHEETS.PAYMENT_ALLOCATIONS]: {
    label: 'การตัดชำระ',
    idPrefix: 'ALC',
    tabColor: TAB_COLORS.FEE,
    columns: [
      ['AllocationId', 'id', 'รหัสการตัดชำระ (ระบบสร้างอัตโนมัติ)'],
      ['PaymentId', 'text', 'รหัสการรับเงิน'],
      ['AssessmentId', 'text', 'รหัสรายการเรียกเก็บที่ตัดชำระ'],
      ['StudentId', 'text', 'รหัสนักเรียนในระบบ'],
      ['AcademicYear', 'int', 'ปีการศึกษาของรายการเรียกเก็บ (พ.ศ.)'],
      ['Amount', 'money', 'จำนวนเงินที่ตัดชำระ (บาท) แก้ไขไม่ได้'],
      ['Status', 'enum', 'ACTIVE มีผล / VOIDED ยกเลิก', STATUS.ALLOCATION],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{
      cols: ['PaymentId', 'AssessmentId'],
      skipStatus: [STATUS.ALLOCATION.VOIDED],
      message: 'การรับเงินครั้งนี้ตัดชำระรายการนี้ไปแล้ว',
    }],
    mutable: ['Status'],
  },

  [SHEETS.RECEIPT_BOOKS]: {
    label: 'ทะเบียนเล่มใบเสร็จ',
    idPrefix: 'BOOK',
    tabColor: TAB_COLORS.RECEIPT,
    columns: [
      ['BookId', 'id', 'รหัสเล่มใบเสร็จ (ระบบสร้างอัตโนมัติ)'],
      ['BookNo', 'text', 'เลขเล่มตามเล่มจริง (ไม่ซ้ำ)'],
      ['StartNo', 'int', 'เลขที่เริ่มต้นของเล่ม'],
      ['EndNo', 'int', 'เลขที่สิ้นสุดของเล่ม'],
      ['ReceivedDate', 'date', 'วันที่ได้รับเล่ม'],
      ['StartUseDate', 'date', 'วันที่เริ่มใช้'],
      ['ClosedDate', 'date', 'วันที่ปิดเล่ม'],
      ['ResponsibleUserId', 'text', 'รหัสผู้ใช้ของผู้รับผิดชอบ'],
      ['ResponsibleName', 'text', 'ชื่อผู้รับผิดชอบ'],
      ['Status', 'enum', 'REGISTERED ลงทะเบียนแล้ว / ACTIVE กำลังใช้ / FULL ใช้ครบเล่ม / CLOSED ปิดเล่ม', STATUS.BOOK],
      ['CloseReason', 'text', 'เหตุผลการปิดเล่ม'],
      ['Note', 'text', 'หมายเหตุ'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{ cols: ['BookNo'], message: 'เลขเล่มนี้ลงทะเบียนไว้แล้ว' }],
    // เลขเล่ม/ช่วงเลขที่ แก้ได้ที่ชั้นข้อมูล แต่ระยะที่ 4 จะอนุญาตเฉพาะเล่มที่ยังไม่เคยใช้
    mutable: ['BookNo', 'StartNo', 'EndNo', 'ReceivedDate', 'StartUseDate', 'ClosedDate',
      'ResponsibleUserId', 'ResponsibleName', 'Status', 'CloseReason', 'Note'],
  },

  [SHEETS.RECEIPT_ENTRIES]: {
    label: 'ทะเบียนคุมเลขที่ใบเสร็จ',
    idPrefix: 'RCE',
    tabColor: TAB_COLORS.RECEIPT,
    columns: [
      ['EntryId', 'id', 'รหัสรายการทะเบียนคุมใบเสร็จ (ระบบสร้างอัตโนมัติ)'],
      ['BookId', 'text', 'รหัสเล่มใบเสร็จ'],
      ['BookNo', 'text', 'เลขเล่ม'],
      ['ReceiptNo', 'int', 'เลขที่ใบเสร็จ'],
      ['Status', 'enum', 'USED ใช้แล้ว / CANCEL_PENDING รออนุมัติยกเลิก / CANCELLED ยกเลิก', STATUS.RECEIPT_ENTRY],
      ['PaymentId', 'text', 'รหัสการรับเงินที่ผูกอยู่ (ว่าง = ยกเลิกก่อนบันทึกรับเงิน)'],
      ['ReceiptDate', 'date', 'วันที่ในใบเสร็จ'],
      ['Amount', 'money', 'จำนวนเงินในใบเสร็จ (บาท)'],
      ['StudentId', 'text', 'รหัสนักเรียนในระบบ'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{ cols: ['BookId', 'ReceiptNo'], message: 'เลขที่ใบเสร็จนี้ถูกบันทึกในทะเบียนคุมแล้ว ใช้ซ้ำไม่ได้' }],
    // PaymentId/ReceiptDate/Amount/StudentId เปลี่ยนได้เฉพาะกรณี "แก้ไขรายการบันทึกผิด" ที่ได้รับอนุมัติ
    mutable: ['Status', 'PaymentId', 'ReceiptDate', 'Amount', 'StudentId'],
  },

  [SHEETS.RECEIPT_CANCELLATIONS]: {
    label: 'ประวัติการยกเลิกเลขที่ใบเสร็จ',
    idPrefix: 'RCX',
    tabColor: TAB_COLORS.RECEIPT,
    columns: [
      ['CancellationId', 'id', 'รหัสการยกเลิก (ระบบสร้างอัตโนมัติ) ผู้ขอ = CreatedBy, เวลาที่ขอ = CreatedAt'],
      ['EntryId', 'text', 'รหัสรายการทะเบียนคุมใบเสร็จ'],
      ['BookId', 'text', 'รหัสเล่มใบเสร็จ'],
      ['BookNo', 'text', 'เลขเล่ม'],
      ['ReceiptNo', 'int', 'เลขที่ใบเสร็จ'],
      ['CancelType', 'enum', 'SPOILED เขียนผิดหรือชำรุด / VOID_PAYMENT ยกเลิกใบเสร็จที่บันทึกรับเงินแล้ว', STATUS.CANCEL_TYPE],
      ['PaymentId', 'text', 'รหัสการรับเงินที่เกี่ยวข้อง'],
      ['Amount', 'money', 'จำนวนเงินในใบเสร็จที่ยกเลิก (บาท)'],
      ['Reason', 'text', 'เหตุผลการยกเลิก'],
      ['Status', 'enum', 'PENDING รออนุมัติ / APPROVED อนุมัติ / REJECTED ไม่อนุมัติ / WITHDRAWN ถอนคำขอ', STATUS.DECISION],
      ['DecidedBy', 'text', 'ผู้พิจารณา'],
      ['DecidedAt', 'datetime', 'วันเวลาที่พิจารณา'],
      ['DecisionNote', 'text', 'ความเห็นของผู้พิจารณา'],
      ['ApprovalRequestId', 'text', 'รหัสคำขออนุมัติ'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [],
    mutable: ['Status', 'DecidedBy', 'DecidedAt', 'DecisionNote', 'ApprovalRequestId'],
  },

  [SHEETS.APPROVAL_REQUESTS]: {
    label: 'คำขออนุมัติ',
    idPrefix: 'APR',
    tabColor: TAB_COLORS.APPROVAL,
    columns: [
      ['RequestId', 'id', 'รหัสคำขออนุมัติ (ระบบสร้างอัตโนมัติ) ผู้ขอ = CreatedBy, เวลาที่ขอ = CreatedAt'],
      ['RequestType', 'enum', 'ประเภทคำขอ', STATUS.REQUEST_TYPE],
      ['RefId', 'text', 'รหัสรายการที่ขออนุมัติ'],
      ['StudentId', 'text', 'รหัสนักเรียนที่เกี่ยวข้อง'],
      ['Summary', 'text', 'สรุปคำขอ'],
      ['PayloadJson', 'json', 'รายละเอียดคำขอ (ระบบใช้ ห้ามแก้ไขด้วยมือ)'],
      ['Reason', 'text', 'เหตุผลของผู้ขอ'],
      ['Status', 'enum', 'PENDING รออนุมัติ / APPROVED อนุมัติ / REJECTED ไม่อนุมัติ / WITHDRAWN ถอนคำขอ', STATUS.DECISION],
      ['DecidedBy', 'text', 'ผู้พิจารณา'],
      ['DecidedAt', 'datetime', 'วันเวลาที่พิจารณา'],
      ['DecisionNote', 'text', 'ความเห็นของผู้พิจารณา'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [],
    mutable: ['Status', 'DecidedBy', 'DecidedAt', 'DecisionNote'],
  },

  [SHEETS.AUDIT_LOGS]: {
    label: 'ประวัติการใช้งาน',
    idPrefix: 'LOG',
    tabColor: TAB_COLORS.AUDIT,
    writeVia: 'audit',
    columns: [
      ['LogId', 'id', 'รหัสประวัติ (ระบบสร้างอัตโนมัติ)'],
      ['Timestamp', 'datetime', 'วันเวลา'],
      ['UserId', 'text', 'รหัสผู้ใช้'],
      ['Username', 'text', 'ชื่อผู้ใช้'],
      ['Role', 'text', 'บทบาทขณะทำรายการ'],
      ['Action', 'enum', 'การกระทำ', AUDIT_ACTIONS],
      ['Entity', 'text', 'ชีตหรือหมวดข้อมูล'],
      ['EntityId', 'text', 'รหัสรายการ'],
      ['BeforeJson', 'json', 'ค่าเดิม (เฉพาะคอลัมน์ที่เปลี่ยน)'],
      ['AfterJson', 'json', 'ค่าใหม่'],
      ['Note', 'text', 'หมายเหตุ'],
      ['PrevHash', 'text', 'ค่า hash ของแถวก่อนหน้า'],
      ['Hash', 'text', 'ค่า hash ของแถวนี้ ใช้ตรวจว่ามีการแก้ไขหรือลบประวัติหรือไม่'],
    ],
    unique: [],
    mutable: [],
  },
});

/**
 * ค่าตั้งค่าเริ่มต้นใน SchoolSettings (SetupDatabase เพิ่มเฉพาะรายการที่ยังไม่มี ไม่เขียนทับค่าเดิม)
 * type: text | int | bool | list (คั่นด้วยจุลภาค) | year (ปีการศึกษา พ.ศ.)
 */
const SETTINGS_DEFS = Object.freeze([
  { key: 'SCHOOL_NAME', type: 'text', defaultValue: 'โรงเรียนวัดเสาหิน', description: 'ชื่อโรงเรียน (ใช้ในหัวเอกสาร)' },
  { key: 'SCHOOL_ADDRESS', type: 'text', defaultValue: '', description: 'ที่อยู่โรงเรียน (ใช้ในหัวเอกสาร)' },
  { key: 'SCHOOL_PROVINCE', type: 'text', defaultValue: 'เชียงใหม่', description: 'จังหวัด' },
  { key: 'SCHOOL_AFFILIATION', type: 'text', defaultValue: '', description: 'หน่วยงานต้นสังกัด (กรอกตามจริง)' },
  { key: 'DIRECTOR_NAME', type: 'text', defaultValue: '', description: 'ชื่อผู้อำนวยการ (ใช้ในช่องลงนาม)' },
  { key: 'DIRECTOR_POSITION', type: 'text', defaultValue: 'ผู้อำนวยการโรงเรียนวัดเสาหิน', description: 'ตำแหน่งผู้อำนวยการ (ใช้ในช่องลงนาม)' },
  { key: 'FINANCE_OFFICER_NAME', type: 'text', defaultValue: '', description: 'ชื่อเจ้าหน้าที่การเงิน (ใช้ในช่องลงนาม)' },
  { key: 'FINANCE_OFFICER_POSITION', type: 'text', defaultValue: 'เจ้าหน้าที่การเงิน', description: 'ตำแหน่งเจ้าหน้าที่การเงิน (ใช้ในช่องลงนาม)' },
  { key: 'CURRENT_ACADEMIC_YEAR', type: 'year', defaultValue: null, description: 'ปีการศึกษาปัจจุบัน (พ.ศ.) ค่าเริ่มต้นคำนวณจากวันที่ติดตั้ง' },
  { key: 'GRADE_LEVELS', type: 'list', defaultValue: 'อ.1,อ.2,อ.3,ป.1,ป.2,ป.3,ป.4,ป.5,ป.6', description: 'ระดับชั้นที่เปิดสอน คั่นด้วยจุลภาค เรียงจากชั้นต่ำไปสูง (ใช้เลื่อนชั้น)' },
  { key: 'PAYMENT_CHANNELS', type: 'list', defaultValue: 'เงินสด,โอนเงินเข้าบัญชีโรงเรียน', description: 'ช่องทางการรับเงิน คั่นด้วยจุลภาค' },
  { key: 'APPROVAL_FEE_ADJUSTMENT', type: 'bool', defaultValue: 'TRUE', description: 'การลดหย่อน/ยกเว้น ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'APPROVAL_ASSESSMENT_CANCEL', type: 'bool', defaultValue: 'TRUE', description: 'การยกเลิกรายการเรียกเก็บ ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'APPROVAL_RECEIPT_CANCEL', type: 'bool', defaultValue: 'TRUE', description: 'การยกเลิกเลขที่ใบเสร็จ ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'APPROVAL_PAYMENT_CORRECTION', type: 'bool', defaultValue: 'TRUE', description: 'การแก้ไขรายการรับเงินที่บันทึกผิด ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'APPROVAL_BOOK_CLOSE', type: 'bool', defaultValue: 'TRUE', description: 'การปิดเล่มใบเสร็จก่อนใช้ครบเล่ม ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'RECEIPT_LOW_WARNING', type: 'int', defaultValue: '5', min: 0, max: 100, description: 'แจ้งเตือนเมื่อเลขที่ใบเสร็จในเล่มที่กำลังใช้เหลือน้อยกว่าหรือเท่ากับจำนวนนี้' },
  { key: 'RECEIPT_STRICT_SEQUENCE', type: 'bool', defaultValue: 'TRUE', description: 'TRUE = ต้องใช้เลขที่ถัดไปเท่านั้น ถ้าจะข้ามเลขต้องยกเลิกเลขนั้นพร้อมเหตุผลก่อน (ค่าที่แนะนำ) / FALSE = ใช้เลขอื่นในเล่มได้แต่ต้องยืนยันคำเตือนเลขขาดช่วง' },
  { key: 'SESSION_IDLE_MINUTES', type: 'int', defaultValue: '30', min: 5, max: 240, description: 'ไม่ใช้งานเกินกี่นาทีจึงต้องเข้าสู่ระบบใหม่' },
  { key: 'SESSION_MAX_HOURS', type: 'int', defaultValue: '8', min: 1, max: 12, description: 'อายุสูงสุดของการเข้าสู่ระบบแต่ละครั้ง (ชั่วโมง)' },
  { key: 'LOGIN_MAX_ATTEMPTS', type: 'int', defaultValue: '5', min: 3, max: 20, description: 'จำนวนครั้งที่ใส่รหัสผ่านผิดได้ก่อนถูกล็อกชั่วคราว' },
  { key: 'LOGIN_LOCK_MINUTES', type: 'int', defaultValue: '15', min: 5, max: 1440, description: 'ระยะเวลาล็อกชั่วคราวเมื่อใส่รหัสผ่านผิดเกินกำหนด (นาที)' },
  { key: 'BACKUP_RETENTION', type: 'int', defaultValue: '60', min: 7, max: 365, description: 'จำนวนไฟล์สำรองข้อมูลรายวันที่เก็บไว้ (ไม่นับไฟล์วันแรกของเดือนซึ่งเก็บถาวร)' },
]);

// ============================================================================
// ไฟล์ต้นฉบับ: src/Shared.js
// ============================================================================

/**
 * ============================================================================
 *  Shared.gs — ฟังก์ชันจัดรูปแบบที่ใช้ร่วมกันทั้งฝั่ง Server และหน้าเว็บ
 * ----------------------------------------------------------------------------
 *  ฟังก์ชันในรายการ SHARED_CLIENT_FUNCTIONS_ จะถูกคัดลอกซอร์สโค้ดไปใช้ในหน้าเว็บด้วย
 *  (ระยะที่ 2) เพื่อให้การแสดงตัวเลขเงินและวันที่ตรงกันทุกจุด กฎของไฟล์นี้:
 *   1. ห้ามเรียกบริการของ Apps Script (SpreadsheetApp, Utilities ฯลฯ)
 *   2. ห้ามอ้างตัวแปรนอกฟังก์ชัน ยกเว้นฟังก์ชันอื่นในไฟล์นี้
 *   3. ไม่โยน error ให้คืนค่าที่บอกผลแทน
 * ============================================================================
 */

/**
 * ตรวจรูปแบบวันที่ ค.ศ. yyyy-MM-dd และเป็นวันที่มีอยู่จริง
 * จำกัดปีไว้ที่ 1990–2400 เพื่อจับกรณีกรอกปี พ.ศ. ลงในช่อง ค.ศ. โดยไม่ตั้งใจ (เช่น 2569)
 */
function isValidIsoDate_(value) {
  if (typeof value !== 'string') return false;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  var y = Number(m[1]);
  var mo = Number(m[2]);
  var d = Number(m[3]);
  if (y < 1990 || y > 2400 || mo < 1 || mo > 12 || d < 1) return false;
  var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= days;
}

/** ตรวจรูปแบบวันเวลา yyyy-MM-dd HH:mm:ss */
function isValidIsoDateTime_(value) {
  if (typeof value !== 'string') return false;
  var m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m) return false;
  return isValidIsoDate_(m[1]) && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4]) < 60;
}

/**
 * แสดงวันที่เป็นภาษาไทย พ.ศ.
 *  style ไม่ระบุ  → 21 พฤศจิกายน 2569
 *  'short'       → 21 พ.ย. 2569
 *  'numeric'     → 21/11/2569
 */
function formatThaiDate_(iso, style) {
  var LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  if (iso === null || iso === undefined || iso === '') return '';
  var text = String(iso);
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!m || !isValidIsoDate_(m[0])) return text;
  var y = Number(m[1]);
  var mo = Number(m[2]);
  var d = Number(m[3]);
  var be = y + 543;
  if (style === 'short') return d + ' ' + SHORT[mo - 1] + ' ' + be;
  if (style === 'numeric') return m[3] + '/' + m[2] + '/' + be;
  return d + ' ' + LONG[mo - 1] + ' ' + be;
}

/** แสดงวันเวลาเป็นภาษาไทย เช่น 21 พฤศจิกายน 2569 เวลา 08:05 น. */
function formatThaiDateTime_(iso, style) {
  if (iso === null || iso === undefined || iso === '') return '';
  var text = String(iso);
  var m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/.exec(text);
  if (!m) return formatThaiDate_(text, style);
  return formatThaiDate_(m[1], style) + ' เวลา ' + m[2] + ':' + m[3] + ' น.';
}

/**
 * แปลงจำนวนเงิน (ตัวเลข หรือข้อความ เช่น "1,000.50" "1000 บาท") เป็นสตางค์ (จำนวนเต็ม)
 * คืนค่า { ok: true, satang } หรือ { ok: false, error }
 *  error: EMPTY ไม่ได้กรอก / FORMAT รูปแบบไม่ใช่ตัวเลข / DECIMALS ทศนิยมเกิน 2 ตำแหน่ง / RANGE ค่าใหญ่ผิดปกติ
 */
function parseMoneyToSatang_(value) {
  var MAX_SATANG = 100000000000; // 1,000 ล้านบาท: กันค่าผิดปกติ
  if (value === null || value === undefined || value === '') return { ok: false, error: 'EMPTY' };
  if (typeof value === 'number') {
    if (!isFinite(value)) return { ok: false, error: 'FORMAT' };
    var scaled = value * 100;
    var rounded = Math.round(scaled);
    // ยอมรับความคลาดเคลื่อนของทศนิยมแบบ floating point แต่ไม่ยอมรับหลักที่ 3
    if (Math.abs(scaled - rounded) > 0.001) return { ok: false, error: 'DECIMALS' };
    if (Math.abs(rounded) > MAX_SATANG) return { ok: false, error: 'RANGE' };
    return { ok: true, satang: rounded === 0 ? 0 : rounded };
  }
  if (typeof value !== 'string') return { ok: false, error: 'FORMAT' };
  var text = value.replace(/บาท/g, '').replace(/[\s,]/g, '');
  if (text === '') return { ok: false, error: 'EMPTY' };
  var m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text);
  if (!m) return { ok: false, error: 'FORMAT' };
  var frac = m[3] || '';
  if (frac.length > 2) {
    if (!/^0*$/.test(frac.slice(2))) return { ok: false, error: 'DECIMALS' };
    frac = frac.slice(0, 2);
  }
  var intDigits = m[2].replace(/^0+(?=\d)/, '');
  if (intDigits.length > 10) return { ok: false, error: 'RANGE' };
  var satang = Number(intDigits) * 100 + Number((frac + '00').slice(0, 2));
  if (satang > MAX_SATANG) return { ok: false, error: 'RANGE' };
  if (m[1] === '-' && satang !== 0) satang = -satang;
  return { ok: true, satang: satang };
}

/** แสดงจำนวนเงินจากสตางค์ เช่น 100050 → "1,000.50" (withUnit = true → "1,000.50 บาท") */
function formatSatang_(satang, withUnit) {
  var n = Number(satang);
  if (satang === null || satang === undefined || satang === '' || !isFinite(n)) return '';
  n = Math.round(n);
  var negative = n < 0;
  var abs = Math.abs(n);
  var baht = Math.floor(abs / 100);
  var st = abs % 100;
  var bahtText = String(baht).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  var text = (negative ? '-' : '') + bahtText + '.' + (st < 10 ? '0' : '') + st;
  return withUnit ? text + ' บาท' : text;
}

/**
 * จำนวนเงินเป็นตัวอักษรภาษาไทย (จากสตางค์) เช่น 150050 → "หนึ่งพันห้าร้อยบาทห้าสิบสตางค์"
 * ใช้ "เอ็ด" เมื่อหลักหน่วยเป็น 1 และมีหลักที่สูงกว่า (สิบเอ็ด หนึ่งร้อยเอ็ด หนึ่งล้านเอ็ด)
 */
function bahtText_(satang) {
  var DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  var PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

  // อ่านตัวเลข 1–999,999 (hasHigher = มีหลักล้านขึ้นไปอยู่ข้างหน้า)
  function readGroup(n, hasHigher) {
    var digits = String(n).split('');
    var len = digits.length;
    var out = '';
    for (var i = 0; i < len; i++) {
      var d = Number(digits[i]);
      var place = len - 1 - i;
      if (d === 0) continue;
      if (place === 0) {
        var higher = hasHigher;
        for (var j = 0; j < i; j++) if (digits[j] !== '0') higher = true;
        out += (d === 1 && higher) ? 'เอ็ด' : DIGITS[d];
      } else if (place === 1) {
        out += (d === 1 ? '' : (d === 2 ? 'ยี่' : DIGITS[d])) + 'สิบ';
      } else {
        out += DIGITS[d] + PLACES[place];
      }
    }
    return out;
  }

  function readNumber(n) {
    if (n === 0) return DIGITS[0];
    var millions = Math.floor(n / 1000000);
    var rest = n % 1000000;
    var out = '';
    if (millions > 0) out += readNumber(millions) + 'ล้าน';
    if (rest > 0) out += readGroup(rest, millions > 0);
    return out;
  }

  var n = Number(satang);
  if (satang === null || satang === undefined || satang === '' || !isFinite(n) || Math.round(n) !== n) return '';
  if (n === 0) return 'ศูนย์บาทถ้วน';
  var negative = n < 0;
  var abs = Math.abs(n);
  var baht = Math.floor(abs / 100);
  var st = abs % 100;
  var text = '';
  if (baht > 0) text += readNumber(baht) + 'บาท';
  text += st === 0 ? 'ถ้วน' : readNumber(st) + 'สตางค์';
  return (negative ? 'ลบ' : '') + text;
}

/**
 * ปีการศึกษา (พ.ศ.) โดยประมาณจากวันที่ ค.ศ.: พ.ค.–ธ.ค. = ปีเดียวกัน, ม.ค.–เม.ย. = ปีก่อนหน้า
 * ใช้เป็นค่าเริ่มต้นเท่านั้น ปีการศึกษาจริงกำหนดในหน้าตั้งค่า
 */
function academicYearOfDate_(iso) {
  var m = /^(\d{4})-(\d{2})/.exec(String(iso === null || iso === undefined ? '' : iso));
  if (!m) return null;
  var be = Number(m[1]) + 543;
  return Number(m[2]) >= 5 ? be : be - 1;
}

/**
 * ปีงบประมาณ (พ.ศ.) ของวันที่ ค.ศ. นับ 1 ตุลาคม – 30 กันยายน
 * เช่น 2026-10-01 → 2570, 2026-09-30 → 2569 (ใช้กับทะเบียนคุมใบเสร็จและรายงานรับเงินรายปีงบประมาณ)
 */
function fiscalYearOfDate_(iso) {
  var m = /^(\d{4})-(\d{2})/.exec(String(iso === null || iso === undefined ? '' : iso));
  if (!m) return null;
  var be = Number(m[1]) + 543;
  return Number(m[2]) >= 10 ? be + 1 : be;
}

/** รายชื่อฟังก์ชันที่จะคัดลอกไปใช้ในหน้าเว็บ */
const SHARED_CLIENT_FUNCTIONS_ = [
  'isValidIsoDate_',
  'isValidIsoDateTime_',
  'formatThaiDate_',
  'formatThaiDateTime_',
  'parseMoneyToSatang_',
  'formatSatang_',
  'bahtText_',
  'academicYearOfDate_',
  'fiscalYearOfDate_',
];

/** ซอร์สโค้ดของฟังก์ชันที่ใช้ร่วมกัน สำหรับฝังลงในหน้าเว็บ (ระยะที่ 2) */
function sharedClientSource_() {
  const fns = {
    isValidIsoDate_: isValidIsoDate_,
    isValidIsoDateTime_: isValidIsoDateTime_,
    formatThaiDate_: formatThaiDate_,
    formatThaiDateTime_: formatThaiDateTime_,
    parseMoneyToSatang_: parseMoneyToSatang_,
    formatSatang_: formatSatang_,
    bahtText_: bahtText_,
    academicYearOfDate_: academicYearOfDate_,
    fiscalYearOfDate_: fiscalYearOfDate_,
  };
  return SHARED_CLIENT_FUNCTIONS_.map(function (name) { return String(fns[name]); }).join('\n\n');
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Utils.js
// ============================================================================

/**
 * ============================================================================
 *  Utils.gs — ฟังก์ชันช่วยฝั่ง Server
 *  ข้อผิดพลาด / เวลา / เงิน / รหัสอ้างอิง / แฮช / ทำความสะอาดข้อความ / ตรวจข้อมูลนำเข้า
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// ข้อผิดพลาด
// ---------------------------------------------------------------------------

const ERROR_CODES = Object.freeze({
  VALIDATION: 'VALIDATION',           // ข้อมูลที่กรอกไม่ถูกต้อง
  UNAUTHENTICATED: 'UNAUTHENTICATED', // ยังไม่ได้เข้าสู่ระบบ หรือหมดอายุ
  FORBIDDEN: 'FORBIDDEN',             // ไม่มีสิทธิ์
  NOT_FOUND: 'NOT_FOUND',             // ไม่พบข้อมูล
  CONFLICT: 'CONFLICT',               // ข้อมูลซ้ำหรือขัดแย้งกับข้อมูลล่าสุด
  LOCK_TIMEOUT: 'LOCK_TIMEOUT',       // มีผู้ใช้อื่นกำลังบันทึก
  INTERNAL: 'INTERNAL',               // ข้อผิดพลาดของระบบ
});

/**
 * สร้างข้อผิดพลาดที่ "ปลอดภัยต่อการแสดงผู้ใช้"
 * message ต้องเป็นภาษาไทยที่ผู้ใช้อ่านเข้าใจ และห้ามมีข้อมูลลับ
 */
function appError_(code, message, details) {
  const err = new Error(message);
  err.name = 'AppError';
  err.code = ERROR_CODES[code] ? code : ERROR_CODES.INTERNAL;
  err.userMessage = message;
  if (details !== undefined) err.details = details;
  return err;
}

function isAppError_(e) {
  return !!e && e.name === 'AppError' && typeof e.code === 'string';
}

/** ข้อความที่แสดงให้ผู้ใช้เว็บเห็นได้ (ไม่เปิดเผยรายละเอียดภายในของข้อผิดพลาดอื่น) */
function safeErrorMessage_(e) {
  if (isAppError_(e)) return e.userMessage;
  return 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่ หากยังพบปัญหาให้แจ้งผู้ดูแลระบบ';
}

// ---------------------------------------------------------------------------
// เวลา (เขตเวลา Asia/Bangkok)
// ---------------------------------------------------------------------------

/** เวลาปัจจุบัน (แยกเป็นฟังก์ชันเพื่อให้ชุดทดสอบกำหนดเวลาได้) */
function now_() {
  return new Date();
}

function dateToIso_(date) {
  return Utilities.formatDate(date, APP.TIMEZONE, 'yyyy-MM-dd');
}

function dateToIsoDateTime_(date) {
  return Utilities.formatDate(date, APP.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

/** วันเวลาปัจจุบัน yyyy-MM-dd HH:mm:ss */
function nowIso_() {
  return dateToIsoDateTime_(now_());
}

/** วันที่ปัจจุบัน yyyy-MM-dd */
function todayIso_() {
  return dateToIso_(now_());
}

// ---------------------------------------------------------------------------
// เงิน: คำนวณภายในเป็นสตางค์ (จำนวนเต็ม) เสมอ
// ---------------------------------------------------------------------------

/** แปลงจำนวนเงินเป็นสตางค์ ถ้าไม่ถูกต้องจะโยน VALIDATION พร้อมข้อความภาษาไทย */
function toSatang_(value, label) {
  const name = label || 'จำนวนเงิน';
  const result = parseMoneyToSatang_(value);
  if (result.ok) return result.satang;
  const messages = {
    EMPTY: 'กรุณากรอก' + name,
    FORMAT: name + 'ต้องเป็นตัวเลข',
    DECIMALS: name + 'มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง',
    RANGE: name + 'มีค่ามากผิดปกติ',
  };
  throw appError_(ERROR_CODES.VALIDATION, messages[result.error] || (name + 'ไม่ถูกต้อง'));
}

/** สตางค์ → บาท (ตัวเลขสำหรับเก็บในชีต) */
function satangToBaht_(satang) {
  return satang / 100;
}

// ---------------------------------------------------------------------------
// รหัสอ้างอิง และค่าสุ่ม
// ---------------------------------------------------------------------------

let ISSUED_IDS_ = Object.create(null);

/**
 * สร้างรหัสอ้างอิงรูปแบบ คำนำหน้า-ปปปปดดววชชนนวว-XXXXXX เช่น PAY-20261121143015-A7F3C2
 * อ่านง่าย เรียงตามเวลา และไม่ซ้ำในการทำงานครั้งเดียวกัน
 * (Db.gs ตรวจซ้ำกับข้อมูลในชีตอีกชั้นหนึ่งภายใต้ lock)
 */
function newId_(prefix) {
  for (let i = 0; i < 20; i++) {
    const id = prefix + '-' + Utilities.formatDate(now_(), APP.TIMEZONE, 'yyyyMMddHHmmss') + '-' + randomHex_(6);
    if (!ISSUED_IDS_[id]) {
      ISSUED_IDS_[id] = true;
      return id;
    }
  }
  throw appError_(ERROR_CODES.INTERNAL, 'สร้างรหัสอ้างอิงไม่สำเร็จ กรุณาลองใหม่');
}

/** ตัวอักษรฐานสิบหก (ตัวพิมพ์ใหญ่) แบบสุ่ม */
function randomHex_(length) {
  let text = '';
  while (text.length < length) text += Utilities.getUuid().replace(/-/g, '');
  return text.slice(0, length).toUpperCase();
}

/** ค่าลับแบบสุ่มความยาว 64 ตัวอักษรฐานสิบหก (256 บิต) */
function newSecretHex_() {
  return sha256Hex_(Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + String(now_().getTime()));
}

// ---------------------------------------------------------------------------
// แฮช
// ---------------------------------------------------------------------------

function bytesToHex_(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytesToHex_(bytes);
}

// ---------------------------------------------------------------------------
// ข้อความ
// ---------------------------------------------------------------------------

/**
 * ทำความสะอาดข้อความที่ผู้ใช้กรอก/นำเข้า
 *  - ลบอักขระมองไม่เห็น (zero-width) ที่มักติดมากับการคัดลอกจากเว็บหรือ Excel
 *  - ลบอักขระควบคุม (เก็บขึ้นบรรทัดใหม่ได้เมื่อ multiline = true)
 *  - ลบเครื่องหมาย ' นำหน้า (Google Sheets ใช้เป็นสัญลักษณ์พิเศษ)
 *  - ตัดช่องว่างหัวท้าย และยุบช่องว่างซ้ำในข้อความบรรทัดเดียว
 */
function cleanText_(value, multiline) {
  if (value === null || value === undefined) return '';
  let s = String(value).normalize('NFC').replace(/[​-‍⁠﻿]/g, '');
  if (multiline) {
    s = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  } else {
    s = s.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/ {2,}/g, ' ');
  }
  s = s.trim().replace(/^'+/, '').trim();
  return s;
}

/** escape อักขระพิเศษของ HTML ก่อนนำข้อความไปแสดงในหน้าเว็บ */
function escapeHtml_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** รายการค่าจาก enum (object หรือ array) */
function enumValues_(source) {
  if (Array.isArray(source)) return source.slice();
  return Object.keys(source).map(function (k) { return source[k]; });
}

// ---------------------------------------------------------------------------
// ตรวจข้อมูลนำเข้า (ใช้ใน service ทุกตัว ข้อความผิดพลาดเป็นภาษาไทย)
// ---------------------------------------------------------------------------

function validationError_(message) {
  return appError_(ERROR_CODES.VALIDATION, message);
}

function isBlankInput_(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * ข้อความ
 * options: { optional, min, max (ค่าเริ่มต้น 200), multiline, pattern, patternMessage }
 */
function requireText_(value, label, options) {
  const opt = options || {};
  if (isBlankInput_(value)) {
    if (opt.optional) return '';
    throw validationError_('กรุณากรอก' + label);
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw validationError_(label + 'ไม่ถูกต้อง');
  const text = cleanText_(value, opt.multiline);
  if (text === '') {
    if (opt.optional) return '';
    throw validationError_('กรุณากรอก' + label);
  }
  const max = opt.max || 200;
  if (text.length > max) throw validationError_(label + 'ยาวเกิน ' + max + ' ตัวอักษร');
  if (opt.min && text.length < opt.min) throw validationError_(label + 'ต้องมีอย่างน้อย ' + opt.min + ' ตัวอักษร');
  if (opt.pattern && !opt.pattern.test(text)) throw validationError_(opt.patternMessage || (label + 'มีรูปแบบไม่ถูกต้อง'));
  return text;
}

/** ค่าต้องอยู่ในรายการที่กำหนด */
function requireEnum_(value, allowed, label, options) {
  const opt = options || {};
  const values = enumValues_(allowed);
  if (isBlankInput_(value)) {
    if (opt.optional) return '';
    throw validationError_('กรุณาเลือก' + label);
  }
  const text = String(value).trim();
  if (values.indexOf(text) === -1) throw validationError_(label + 'ไม่ถูกต้อง');
  return text;
}

/** จำนวนเต็ม options: { optional, min, max } */
function requireInt_(value, label, options) {
  const opt = options || {};
  if (isBlankInput_(value)) {
    if (opt.optional) return null;
    throw validationError_('กรุณากรอก' + label);
  }
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(n)) throw validationError_(label + 'ต้องเป็นจำนวนเต็ม');
  if (opt.min !== undefined && n < opt.min) throw validationError_(label + 'ต้องไม่น้อยกว่า ' + opt.min);
  if (opt.max !== undefined && n > opt.max) throw validationError_(label + 'ต้องไม่มากกว่า ' + opt.max);
  return n;
}

/**
 * จำนวนเงิน คืนค่าเป็นสตางค์
 * options: { optional, allowZero, allowNegative, maxSatang }
 */
function requireMoney_(value, label, options) {
  const opt = options || {};
  if (isBlankInput_(value)) {
    if (opt.optional) return null;
    throw validationError_('กรุณากรอก' + label);
  }
  const satang = toSatang_(value, label);
  if (satang < 0 && !opt.allowNegative) throw validationError_(label + 'ต้องไม่ติดลบ');
  if (satang === 0 && !opt.allowZero) throw validationError_(label + 'ต้องมากกว่า 0');
  if (opt.maxSatang !== undefined && satang > opt.maxSatang) {
    throw validationError_(label + 'ต้องไม่เกิน ' + formatSatang_(opt.maxSatang, true));
  }
  return satang;
}

/** วันที่ ค.ศ. yyyy-MM-dd */
function requireIsoDate_(value, label, options) {
  const opt = options || {};
  if (isBlankInput_(value)) {
    if (opt.optional) return '';
    throw validationError_('กรุณาระบุ' + label);
  }
  const text = String(value).trim();
  if (!isValidIsoDate_(text)) throw validationError_(label + 'ไม่ถูกต้อง');
  return text;
}

/** ค่าจริง/เท็จ */
function requireBool_(value, label) {
  if (value === true || value === false) return value;
  const text = String(value === null || value === undefined ? '' : value).trim().toUpperCase();
  if (text === 'TRUE') return true;
  if (text === 'FALSE' || text === '') return false;
  throw validationError_(label + 'ไม่ถูกต้อง');
}

/** รหัสอ้างอิงที่ระบบสร้าง เช่น requireId_(x, 'STU', 'รหัสนักเรียน') */
function requireId_(value, prefix, label) {
  const text = isBlankInput_(value) ? '' : String(value).trim();
  const pattern = new RegExp('^' + prefix + '-\\d{14}-[0-9A-F]{6}$');
  if (!pattern.test(text)) throw validationError_(label + 'ไม่ถูกต้อง');
  return text;
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Db.js
// ============================================================================

/**
 * ============================================================================
 *  Db.gs — ชั้นเข้าถึงข้อมูล (Repository) บน Google Sheets
 * ----------------------------------------------------------------------------
 *  กฎที่ไฟล์นี้บังคับใช้กับทุกชีต
 *   1. อ่านและเขียนโดยอ้าง "ชื่อคอลัมน์" จากหัวตาราง ไม่อ้างเลขคอลัมน์
 *   2. การเขียนทุกครั้งต้องอยู่ภายใน withScriptLock_() ไม่เช่นนั้นจะ error ทันที
 *   3. ไม่มีฟังก์ชันลบแถว: ข้อมูลเปลี่ยนสถานะได้ แต่ไม่หายไปจากชีต
 *   4. แก้ไขได้เฉพาะคอลัมน์ที่ SCHEMA อนุญาต (mutable) จำนวนเงินที่บันทึกแล้วแก้ไม่ได้
 *   5. ทุกการเพิ่มและแก้ไขบันทึก AuditLogs อัตโนมัติ ภายใต้ lock เดียวกัน
 *   6. ตรวจข้อมูลซ้ำตามกฎ unique ของ SCHEMA ทุกครั้งก่อนเขียน
 *   7. ตรวจชนิดข้อมูลทุกค่าก่อนเขียน และกันสูตร (formula injection)
 *
 *  ฟังก์ชันทั้งหมดลงท้ายด้วย _ จึงเรียกจากหน้าเว็บโดยตรงไม่ได้
 * ============================================================================
 */

let DB_SPREADSHEET_ = null;          // Spreadsheet ฐานข้อมูลที่เปิดแล้วในการทำงานครั้งนี้
let DB_TABLES_ = Object.create(null); // ข้อมูลชีตที่อ่านแล้ว (ล้างทุกครั้งที่ได้ lock)
let DB_LOCK_DEPTH_ = 0;              // > 0 = กำลังถือ lock อยู่
let SCHEMA_CACHE_ = Object.create(null);

const SETUP_HINT_ = 'กรุณาให้เจ้าของระบบเปิด Google Sheets แล้วเลือกเมนู "ระบบเงินบำรุงการศึกษา > 1) ติดตั้ง / ตรวจสอบโครงสร้างฐานข้อมูล"';

// ---------------------------------------------------------------------------
// โครงสร้างชีต
// ---------------------------------------------------------------------------

/** โครงสร้างของชีตที่แปลงให้ใช้งานง่าย (อ่านจาก SCHEMA ใน Config.gs) */
function getSchema_(name) {
  if (SCHEMA_CACHE_[name]) return SCHEMA_CACHE_[name];
  if (!Object.prototype.hasOwnProperty.call(SCHEMA, name)) {
    throw appError_(ERROR_CODES.INTERNAL, 'ไม่รู้จักชีต "' + name + '"');
  }
  const def = SCHEMA[name];
  const columns = def.columns.map(function (t) {
    return { name: t[0], type: t[1], note: t[2] || '', values: t[3] ? enumValues_(t[3]) : null };
  });
  const columnMap = Object.create(null);
  columns.forEach(function (c) { columnMap[c.name] = c; });
  const idColumn = columns[0].name;
  let mutable = def.mutable || [];
  if (mutable === '*') {
    mutable = columns.map(function (c) { return c.name; }).filter(function (n) {
      return n !== idColumn && SYSTEM_COLUMNS.indexOf(n) === -1;
    });
  }
  const schema = {
    name: name,
    label: def.label,
    idColumn: idColumn,
    idPrefix: def.idPrefix || null,
    tabColor: def.tabColor || null,
    writeVia: def.writeVia || 'db',
    columns: columns,
    columnNames: columns.map(function (c) { return c.name; }),
    columnMap: columnMap,
    mutableSet: toFlagSet_(mutable),
    auditExemptSet: toFlagSet_(def.auditExempt || []),
    unique: def.unique || [],
    secret: (def.secret || []).slice(),
  };
  SCHEMA_CACHE_[name] = schema;
  return schema;
}

function toFlagSet_(list) {
  const set = Object.create(null);
  list.forEach(function (k) { set[k] = true; });
  return set;
}

// ---------------------------------------------------------------------------
// การเชื่อมต่อ Spreadsheet
// ---------------------------------------------------------------------------

/** Spreadsheet ฐานข้อมูล (จาก Script Properties: DB_SPREADSHEET_ID หรือไฟล์ที่ผูกสคริปต์อยู่) */
function db_() {
  if (DB_SPREADSHEET_) return DB_SPREADSHEET_;
  const id = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.DB_SPREADSHEET_ID);
  let ss = null;
  if (id) {
    try {
      ss = SpreadsheetApp.openById(id);
    } catch (e) {
      throw appError_(ERROR_CODES.INTERNAL, 'เปิดไฟล์ฐานข้อมูลไม่ได้ (DB_SPREADSHEET_ID ไม่ถูกต้องหรือไม่มีสิทธิ์เข้าถึง) ' + SETUP_HINT_);
    }
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) throw appError_(ERROR_CODES.INTERNAL, 'ยังไม่ได้ติดตั้งฐานข้อมูล ' + SETUP_HINT_);
  DB_SPREADSHEET_ = ss;
  return ss;
}

/** กำหนด Spreadsheet ที่จะใช้ (ใช้ตอนติดตั้งและกู้คืนข้อมูล) */
function dbUseSpreadsheet_(ss) {
  DB_SPREADSHEET_ = ss;
  dbClearCache_();
}

/** ล้างข้อมูลที่อ่านค้างไว้ในหน่วยความจำ ครั้งถัดไปจะอ่านจากชีตใหม่ */
function dbClearCache_() {
  DB_TABLES_ = Object.create(null);
  auditResetState_();
}

function dbForgetTable_(name) {
  delete DB_TABLES_[name];
}

function dbSheet_(name) {
  const sheet = db_().getSheetByName(name);
  if (!sheet) throw appError_(ERROR_CODES.INTERNAL, 'ไม่พบชีต "' + name + '" ' + SETUP_HINT_);
  return sheet;
}

// ---------------------------------------------------------------------------
// Lock: ทุกการเขียนต้องผ่านที่นี่
// ---------------------------------------------------------------------------

/**
 * ทำงาน fn ภายใต้ Script Lock (ผู้ใช้ทุกคนต่อคิวกัน ทีละรายการ)
 *  - หลังได้ lock จะล้างข้อมูลที่อ่านค้างไว้ เพื่อให้เห็นข้อมูลล่าสุดของผู้ใช้อื่นเสมอ
 *  - ก่อนปล่อย lock จะสั่ง flush ให้การเขียนลงชีตเสร็จสมบูรณ์
 *  - เรียกซ้อนกันได้ (ถ้าถือ lock อยู่แล้วจะทำงานต่อทันที)
 */
function withScriptLock_(fn, timeoutMs) {
  if (DB_LOCK_DEPTH_ > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs || LIMITS.LOCK_TIMEOUT_MS)) {
    throw appError_(ERROR_CODES.LOCK_TIMEOUT, 'ขณะนี้มีผู้ใช้อื่นกำลังบันทึกข้อมูล กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
  }
  DB_LOCK_DEPTH_ = 1;
  try {
    dbClearCache_();
    return fn();
  } finally {
    try {
      SpreadsheetApp.flush();
    } finally {
      DB_LOCK_DEPTH_ = 0;
      lock.releaseLock();
      // ถ้าเกิดข้อผิดพลาดกลางทาง ข้อมูลในหน่วยความจำอาจไม่ตรงกับชีต จึงล้างทิ้งเสมอ
      dbClearCache_();
    }
  }
}

function isLockHeld_() {
  return DB_LOCK_DEPTH_ > 0;
}

function assertLockHeld_() {
  if (DB_LOCK_DEPTH_ <= 0) {
    throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: การบันทึกข้อมูลต้องทำภายใต้ LockService');
  }
}

function assertActor_(actor) {
  if (!actor || typeof actor.userId !== 'string' || !actor.userId ||
      typeof actor.username !== 'string' || !actor.username ||
      typeof actor.role !== 'string' || !actor.role) {
    throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ไม่ได้ระบุผู้ทำรายการ');
  }
}

// ---------------------------------------------------------------------------
// อ่านหัวตารางและข้อมูล
// ---------------------------------------------------------------------------

function normalizeHeaderCell_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

/** หัวตารางแถวที่ 1 (ตัดช่องว่างหัวท้าย) */
function readHeader_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normalizeHeaderCell_);
}

/** ดัชนีคอลัมน์จากหัวตาราง (ห้ามมีคอลัมน์ของระบบซ้ำกัน) */
function buildColumnIndex_(header, schema) {
  const index = Object.create(null);
  header.forEach(function (h, i) {
    if (h === '') return;
    if (index[h] !== undefined) {
      if (schema.columnMap[h]) {
        throw appError_(ERROR_CODES.INTERNAL, 'ชีต "' + schema.name + '" มีหัวคอลัมน์ "' + h + '" ซ้ำกัน กรุณาแก้ไขให้เหลือคอลัมน์เดียว');
      }
      return;
    }
    index[h] = i;
  });
  return index;
}

function missingColumns_(colIndex, schema) {
  return schema.columnNames.filter(function (c) { return colIndex[c] === undefined; });
}

function isBlankRow_(row) {
  for (let i = 0; i < row.length; i++) {
    if (row[i] !== '' && row[i] !== null && row[i] !== undefined) return false;
  }
  return true;
}

/** อ่านทั้งชีตเป็นรายการ object (เก็บไว้ในหน่วยความจำจนกว่าจะได้ lock ใหม่) */
function dbTable_(name) {
  if (DB_TABLES_[name]) return DB_TABLES_[name];
  const schema = getSchema_(name);
  const sheet = dbSheet_(name);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    throw appError_(ERROR_CODES.INTERNAL, 'ชีต "' + name + '" ยังไม่มีหัวตาราง ' + SETUP_HINT_);
  }
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const header = values[0].map(normalizeHeaderCell_);
  const colIndex = buildColumnIndex_(header, schema);
  const missing = missingColumns_(colIndex, schema);
  if (missing.length) {
    throw appError_(ERROR_CODES.INTERNAL, 'ชีต "' + name + '" ขาดคอลัมน์ ' + missing.join(', ') + ' ' + SETUP_HINT_);
  }
  const rows = [];
  const idIndex = Object.create(null);
  const duplicateIds = [];
  for (let r = 1; r < values.length; r++) {
    const raw = values[r];
    if (isBlankRow_(raw)) continue;
    const record = {};
    schema.columns.forEach(function (col) {
      record[col.name] = fromSheetValue_(col, raw[colIndex[col.name]], name, r + 1);
    });
    const id = record[schema.idColumn];
    if (id !== '') {
      if (idIndex[id] !== undefined) duplicateIds.push(id);
      else idIndex[id] = rows.length;
    }
    rows.push({ rowNumber: r + 1, record: record });
  }
  const table = {
    name: name,
    schema: schema,
    sheet: sheet,
    header: header,
    colIndex: colIndex,
    rows: rows,
    idIndex: idIndex,
    duplicateIds: duplicateIds,
    lastRow: lastRow,
  };
  DB_TABLES_[name] = table;
  return table;
}

// ---------------------------------------------------------------------------
// API อ่านข้อมูล (คืนสำเนา แก้ไขค่าที่ได้รับไม่กระทบข้อมูลในระบบ)
// ---------------------------------------------------------------------------

function copyRecord_(record) {
  return Object.assign({}, record);
}

function pickFields_(record, keys) {
  const out = {};
  keys.forEach(function (k) { out[k] = record[k]; });
  return out;
}

function dbAll_(name) {
  return dbTable_(name).rows.map(function (row) { return copyRecord_(row.record); });
}

function dbGet_(name, id) {
  const table = dbTable_(name);
  const index = table.idIndex[id];
  return index === undefined ? null : copyRecord_(table.rows[index].record);
}

function dbFind_(name, predicate) {
  return dbTable_(name).rows
    .filter(function (row) { return predicate(row.record); })
    .map(function (row) { return copyRecord_(row.record); });
}

function dbFindOne_(name, predicate) {
  const rows = dbTable_(name).rows;
  for (let i = 0; i < rows.length; i++) {
    if (predicate(rows[i].record)) return copyRecord_(rows[i].record);
  }
  return null;
}

// ---------------------------------------------------------------------------
// API เขียนข้อมูล
// ---------------------------------------------------------------------------

/** เพิ่ม 1 รายการ คืนค่ารายการที่บันทึกแล้ว (มีรหัสอ้างอิงและเวลาที่สร้าง) */
function dbInsert_(name, record, actor, options) {
  return dbInsertMany_(name, [record], actor, options)[0];
}

/**
 * เพิ่มหลายรายการในการเขียนครั้งเดียว
 * options: { action: AUDIT_ACTIONS.xxx (ค่าเริ่มต้น CREATE), note: หมายเหตุใน AuditLogs }
 */
function dbInsertMany_(name, records, actor, options) {
  assertLockHeld_();
  assertActor_(actor);
  const opts = options || {};
  if (!Array.isArray(records)) throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: records ต้องเป็น array');
  if (records.length === 0) return [];
  const table = dbTable_(name);
  const schema = table.schema;
  if (schema.writeVia !== 'db') {
    throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ชีต ' + name + ' ต้องเขียนผ่านฟังก์ชันเฉพาะเท่านั้น');
  }
  const ts = nowIso_();
  const batchIds = Object.create(null);

  const prepared = records.map(function (input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ข้อมูลที่จะบันทึกต้องเป็น object');
    }
    Object.keys(input).forEach(function (key) {
      if (!schema.columnMap[key]) throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ชีต ' + name + ' ไม่มีคอลัมน์ "' + key + '"');
      if (SYSTEM_COLUMNS.indexOf(key) !== -1) throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: คอลัมน์ ' + key + ' ระบบบันทึกเอง');
    });
    const rec = {};
    schema.columns.forEach(function (col) { rec[col.name] = coerceValue_(col, input[col.name], name); });

    if (schema.idPrefix) {
      if (rec[schema.idColumn]) throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ห้ามกำหนด ' + schema.idColumn + ' เอง');
      let id = newId_(schema.idPrefix);
      while (table.idIndex[id] !== undefined || batchIds[id]) id = newId_(schema.idPrefix);
      rec[schema.idColumn] = id;
    } else if (!rec[schema.idColumn]) {
      throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ต้องระบุ ' + schema.idColumn);
    }
    const id = rec[schema.idColumn];
    if (table.idIndex[id] !== undefined || batchIds[id]) {
      throw appError_(ERROR_CODES.CONFLICT, 'รหัส "' + id + '" มีอยู่แล้วในชีต ' + name);
    }
    batchIds[id] = true;
    if (schema.columnMap.CreatedAt) {
      rec.CreatedAt = ts;
      rec.CreatedBy = actor.username;
    }
    return rec;
  });

  checkUnique_(table, prepared, null);

  const startRow = table.lastRow + 1;
  writeRecordsAt_(table.sheet, table.header, schema, prepared, startRow);
  prepared.forEach(function (rec, i) {
    table.idIndex[rec[schema.idColumn]] = table.rows.length;
    table.rows.push({ rowNumber: startRow + i, record: rec });
  });
  table.lastRow = startRow + prepared.length - 1;

  auditAppend_(prepared.map(function (rec) {
    return {
      action: opts.action || AUDIT_ACTIONS.CREATE,
      entity: name,
      entityId: rec[schema.idColumn],
      before: null,
      after: rec,
      note: opts.note || '',
    };
  }), actor);

  return prepared.map(copyRecord_);
}

/**
 * แก้ไข 1 รายการ เฉพาะคอลัมน์ที่ส่งมาและเปลี่ยนค่าจริง
 * คืนค่า { changed: [ชื่อคอลัมน์], before, after }
 * options: { action: AUDIT_ACTIONS.xxx (ค่าเริ่มต้น UPDATE), note }
 */
function dbUpdate_(name, id, changes, actor, options) {
  assertLockHeld_();
  assertActor_(actor);
  const opts = options || {};
  const table = dbTable_(name);
  const schema = table.schema;
  if (schema.writeVia !== 'db') {
    throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ชีต ' + name + ' แก้ไขไม่ได้');
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: changes ต้องเป็น object');
  }
  const index = (id === '' || id === null || id === undefined) ? undefined : table.idIndex[id];
  if (index === undefined) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลที่ต้องการแก้ไข');
  const row = table.rows[index];
  const before = row.record;
  const after = copyRecord_(before);
  const changed = [];

  Object.keys(changes).forEach(function (key) {
    const col = schema.columnMap[key];
    if (!col) throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ชีต ' + name + ' ไม่มีคอลัมน์ "' + key + '"');
    if (key === schema.idColumn || SYSTEM_COLUMNS.indexOf(key) !== -1) {
      throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: คอลัมน์ ' + key + ' แก้ไขไม่ได้');
    }
    const value = coerceValue_(col, changes[key], name);
    if (value === before[key]) return;
    if (!schema.mutableSet[key]) {
      throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: คอลัมน์ ' + key + ' ของชีต ' + name + ' แก้ไขไม่ได้หลังบันทึกแล้ว');
    }
    after[key] = value;
    changed.push(key);
  });

  if (!changed.length) return { changed: [], before: copyRecord_(before), after: copyRecord_(before) };

  const toWrite = changed.slice();
  if (schema.columnMap.UpdatedAt) {
    after.UpdatedAt = nowIso_();
    after.UpdatedBy = actor.username;
    toWrite.push('UpdatedAt', 'UpdatedBy');
  }
  checkUnique_(table, [after], id);
  verifyRowIdentity_(table, row, id);

  toWrite.forEach(function (key) {
    const col = schema.columnMap[key];
    const cell = table.sheet.getRange(row.rowNumber, table.colIndex[key] + 1);
    cell.setNumberFormat(numberFormatFor_(col.type));
    cell.setValue(toSheetValue_(col.type, after[key]));
  });
  row.record = after;

  const audited = changed.filter(function (k) { return !schema.auditExemptSet[k]; });
  if (audited.length) {
    auditAppend_([{
      action: opts.action || AUDIT_ACTIONS.UPDATE,
      entity: name,
      entityId: id,
      before: pickFields_(before, audited),
      after: pickFields_(after, audited),
      note: opts.note || '',
    }], actor);
  }
  return { changed: changed, before: copyRecord_(before), after: copyRecord_(after) };
}

/** ยืนยันว่าแถวที่จะเขียนยังเป็นรายการเดิม (กันกรณีมีคนจัดเรียงหรือแทรกแถวในชีตด้วยมือ) */
function verifyRowIdentity_(table, row, id) {
  const value = table.sheet.getRange(row.rowNumber, table.colIndex[table.schema.idColumn] + 1).getValue();
  if (unsanitizeFromSheet_(String(value)) !== String(id)) {
    throw appError_(ERROR_CODES.CONFLICT,
      'ตำแหน่งข้อมูลในชีต "' + table.name + '" เปลี่ยนไประหว่างบันทึก (อาจมีการจัดเรียงหรือแก้ไขชีตด้วยมือ) ' +
      'ระบบหยุดการบันทึกเพื่อป้องกันข้อมูลผิดแถว กรุณาลองใหม่ หากยังพบปัญหาให้แจ้งผู้ดูแลระบบ');
  }
}

// ---------------------------------------------------------------------------
// ตรวจข้อมูลซ้ำ
// ---------------------------------------------------------------------------

function uniqueKey_(rule, record) {
  if (rule.skipStatus && rule.skipStatus.indexOf(record.Status) !== -1) return null;
  const parts = [];
  for (let i = 0; i < rule.cols.length; i++) {
    const v = record[rule.cols[i]];
    const part = v === null || v === undefined ? '' : String(v).trim().toUpperCase();
    if (part === '') return null; // ค่าว่างไม่นับว่าซ้ำ
    parts.push(part);
  }
  return parts.join('\u0001');
}

/** โยน CONFLICT ถ้ารายการใหม่ซ้ำกับข้อมูลเดิมหรือซ้ำกันเอง (excludeId = รายการที่กำลังแก้ไข) */
function checkUnique_(table, candidates, excludeId) {
  const schema = table.schema;
  schema.unique.forEach(function (rule) {
    const seen = Object.create(null);
    table.rows.forEach(function (row) {
      const rowId = row.record[schema.idColumn];
      if (excludeId !== null && rowId === excludeId) return;
      const key = uniqueKey_(rule, row.record);
      if (key !== null) seen[key] = rowId;
    });
    candidates.forEach(function (rec) {
      const key = uniqueKey_(rule, rec);
      if (key === null) return;
      if (seen[key] !== undefined) {
        throw appError_(ERROR_CODES.CONFLICT, rule.message || ('ข้อมูลซ้ำ: ' + rule.cols.join(' + ')),
          { existingId: seen[key], columns: rule.cols.slice() });
      }
      seen[key] = rec[schema.idColumn];
    });
  });
}

// ---------------------------------------------------------------------------
// แปลงค่าระหว่างโปรแกรมกับชีต
// ---------------------------------------------------------------------------

function isDateObject_(value) {
  return Object.prototype.toString.call(value) === '[object Date]';
}

/**
 * ตรวจและแปลงค่าก่อนบันทึก (ค่าในโปรแกรม)
 *  text/id/enum/json → ข้อความ (ตัด ' นำหน้าออก)   money → บาท (ทศนิยม 2 ตำแหน่ง) หรือ null
 *  int → จำนวนเต็มหรือ null   bool → true/false   date/datetime → ข้อความ ISO
 */
function coerceValue_(col, value, sheetName) {
  const where = sheetName + '.' + col.name;
  const blank = value === null || value === undefined || value === '';
  switch (col.type) {
    case 'id':
    case 'text':
    case 'enum': {
      if (blank) return '';
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw appError_(ERROR_CODES.VALIDATION, 'ข้อมูลไม่ถูกต้อง (' + where + ')');
      }
      const text = String(value).replace(/^'+/, '');
      if (text.length > LIMITS.CELL_MAX_CHARS) throw appError_(ERROR_CODES.VALIDATION, 'ข้อความยาวเกินกำหนด (' + where + ')');
      if (col.type === 'enum' && text !== '' && col.values.indexOf(text) === -1) {
        throw appError_(ERROR_CODES.VALIDATION, 'ค่า "' + text + '" ไม่ถูกต้องสำหรับ ' + where);
      }
      return text;
    }
    case 'json': {
      if (blank) return '';
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      if (text.length > LIMITS.CELL_MAX_CHARS) throw appError_(ERROR_CODES.VALIDATION, 'ข้อมูลยาวเกินกำหนด (' + where + ')');
      return text;
    }
    case 'date': {
      if (blank) return '';
      const text = isDateObject_(value) ? dateToIso_(value) : String(value).trim();
      if (!isValidIsoDate_(text)) throw appError_(ERROR_CODES.VALIDATION, 'วันที่ไม่ถูกต้อง (' + where + ')');
      return text;
    }
    case 'datetime': {
      if (blank) return '';
      const text = isDateObject_(value) ? dateToIsoDateTime_(value) : String(value).trim();
      if (!isValidIsoDateTime_(text)) throw appError_(ERROR_CODES.VALIDATION, 'วันเวลาไม่ถูกต้อง (' + where + ')');
      return text;
    }
    case 'money': {
      if (blank) return null;
      return satangToBaht_(toSatang_(value, 'จำนวนเงิน (' + where + ')'));
    }
    case 'int': {
      if (blank) return null;
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isSafeInteger(n)) throw appError_(ERROR_CODES.VALIDATION, 'ต้องเป็นจำนวนเต็ม (' + where + ')');
      return n;
    }
    case 'bool': {
      if (value === true || value === false) return value;
      if (blank) return false;
      const text = String(value).trim().toUpperCase();
      if (text === 'TRUE') return true;
      if (text === 'FALSE') return false;
      throw appError_(ERROR_CODES.VALIDATION, 'ต้องเป็น TRUE หรือ FALSE (' + where + ')');
    }
    default:
      throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ไม่รู้จักชนิดคอลัมน์ ' + col.type);
  }
}

/** รูปแบบตัวเลขของเซลล์ตามชนิดคอลัมน์ ('@' = Plain text) */
function numberFormatFor_(type) {
  if (type === 'money') return '#,##0.00';
  if (type === 'int') return '0';
  return '@';
}

/** ข้อความที่ขึ้นต้นด้วย = + - @ จะถูกนำหน้าด้วย ' เพื่อไม่ให้ Google Sheets ตีความเป็นสูตร */
function sanitizeForSheet_(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function unsanitizeFromSheet_(text) {
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

/** ค่าในโปรแกรม → ค่าที่เขียนลงเซลล์ */
function toSheetValue_(type, value) {
  if (type === 'money' || type === 'int') return value === null || value === undefined ? '' : value;
  if (type === 'bool') return value ? 'TRUE' : 'FALSE';
  return sanitizeForSheet_(value === null || value === undefined ? '' : String(value));
}

function cellError_(sheetName, rowNumber, colName, raw) {
  return appError_(ERROR_CODES.INTERNAL,
    'ข้อมูลในชีต "' + sheetName + '" แถว ' + rowNumber + ' คอลัมน์ ' + colName +
    ' ไม่ถูกต้อง ("' + String(raw).slice(0, 50) + '") อาจมีการแก้ไขชีตด้วยมือ กรุณาให้ผู้ดูแลระบบตรวจสอบ');
}

/**
 * ค่าในเซลล์ → ค่าในโปรแกรม
 * จำนวนเงินหรือจำนวนเต็มที่ผิดรูปแบบจะ error ทันที (ไม่เดาค่า) เพื่อไม่ให้ยอดเงินคลาดเคลื่อนโดยไม่รู้ตัว
 */
function fromSheetValue_(col, raw, sheetName, rowNumber) {
  const blank = raw === '' || raw === null || raw === undefined;
  switch (col.type) {
    case 'money': {
      if (blank) return null;
      const result = parseMoneyToSatang_(typeof raw === 'number' ? raw : String(raw));
      if (!result.ok) throw cellError_(sheetName, rowNumber, col.name, raw);
      return satangToBaht_(result.satang);
    }
    case 'int': {
      if (blank) return null;
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isSafeInteger(n)) throw cellError_(sheetName, rowNumber, col.name, raw);
      return n;
    }
    case 'bool':
      return raw === true || String(raw).trim().toUpperCase() === 'TRUE';
    case 'date':
      if (blank) return '';
      return isDateObject_(raw) ? dateToIso_(raw) : String(raw).trim();
    case 'datetime':
      if (blank) return '';
      return isDateObject_(raw) ? dateToIsoDateTime_(raw) : String(raw).trim();
    default:
      if (blank) return '';
      if (isDateObject_(raw)) return dateToIsoDateTime_(raw);
      if (typeof raw === 'boolean') return raw ? 'TRUE' : 'FALSE';
      return unsanitizeFromSheet_(String(raw));
  }
}

// ---------------------------------------------------------------------------
// เขียนแถวลงชีต
// ---------------------------------------------------------------------------

/** เขียนหลายแถวต่อท้ายในครั้งเดียว (ตั้งรูปแบบเซลล์ก่อนใส่ค่า เพื่อกันการแปลงอัตโนมัติ) */
function writeRecordsAt_(sheet, header, schema, records, startRow) {
  if (!records.length) return;
  ensureRowCapacity_(sheet, startRow + records.length - 1);
  const values = records.map(function (rec) {
    return header.map(function (h) {
      const col = schema.columnMap[h];
      return col ? toSheetValue_(col.type, rec[h]) : '';
    });
  });
  const formats = records.map(function () {
    return header.map(function (h) {
      const col = schema.columnMap[h];
      return col ? numberFormatFor_(col.type) : '@';
    });
  });
  const range = sheet.getRange(startRow, 1, records.length, header.length);
  range.setNumberFormats(formats);
  range.setValues(values);
}

function ensureRowCapacity_(sheet, lastNeededRow) {
  const max = sheet.getMaxRows();
  if (lastNeededRow > max) {
    sheet.insertRowsAfter(max, Math.max(lastNeededRow - max, LIMITS.ROW_CAPACITY_STEP));
  }
}

function ensureColumnCapacity_(sheet, neededColumns) {
  const max = sheet.getMaxColumns();
  if (neededColumns > max) sheet.insertColumnsAfter(max, neededColumns - max);
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Audit.js
// ============================================================================

/**
 * ============================================================================
 *  Audit.gs — ประวัติการใช้งาน (AuditLogs) แบบเพิ่มต่อท้าย พร้อมลูกโซ่ hash
 * ----------------------------------------------------------------------------
 *  - Hash ของแต่ละแถว = SHA-256 ของ (ข้อมูลในแถว + Hash ของแถวก่อนหน้า)
 *    ถ้ามีผู้แก้ไข แทรก หรือลบแถวในชีต AuditLogs ด้วยมือ ลูกโซ่จะขาด และ auditVerifyChain_() ตรวจพบ
 *  - ระบบจำตำแหน่งและ hash ของแถวล่าสุดไว้ใน Script Properties (AUDIT_HEAD)
 *    เพื่อตรวจกรณีมีการลบแถวท้ายชีต
 *  - ค่าลับ (รหัสผ่าน ค่าแฮชรหัสผ่าน token) ถูกแทนด้วย [ซ่อน] ก่อนบันทึกเสมอ
 *  - Db.gs เรียก auditAppend_() อัตโนมัติทุกครั้งที่เพิ่มหรือแก้ไขข้อมูล
 * ============================================================================
 */

const AUDIT_GENESIS_HASH = 'GENESIS';
const AUDIT_REDACTED_VALUE = '[ซ่อน]';
const AUDIT_ALWAYS_REDACT = Object.freeze([
  'PasswordHash', 'Password', 'NewPassword', 'OldPassword', 'CurrentPassword',
  'Token', 'SessionToken', 'Pepper', 'Secret',
]);
const AUDIT_HASH_FIELDS = Object.freeze([
  'LogId', 'Timestamp', 'UserId', 'Username', 'Role', 'Action',
  'Entity', 'EntityId', 'BeforeJson', 'AfterJson', 'Note', 'PrevHash',
]);
const AUDIT_PROBLEM_LABELS = Object.freeze({
  PREV_HASH_MISMATCH: 'ลูกโซ่ไม่ต่อเนื่อง: มีการลบ แทรก หรือแก้ไขแถวก่อนหน้า',
  HASH_MISMATCH: 'ข้อมูลในแถวนี้ถูกแก้ไขหลังบันทึก',
  DUPLICATE_ID: 'รหัสประวัติซ้ำ',
  HEAD_MISSING: 'ไม่พบแถวล่าสุดที่ระบบจำไว้ (อาจมีการลบแถวท้ายชีต)',
});

let AUDIT_STATE_ = null; // หัวตารางและ hash ล่าสุดของ AuditLogs (อ่านเฉพาะแถวสุดท้าย ไม่อ่านทั้งชีต)

function auditResetState_() {
  AUDIT_STATE_ = null;
}

function auditState_() {
  if (AUDIT_STATE_) return AUDIT_STATE_;
  const schema = getSchema_(SHEETS.AUDIT_LOGS);
  const sheet = dbSheet_(SHEETS.AUDIT_LOGS);
  const header = readHeader_(sheet);
  if (!header.length) throw appError_(ERROR_CODES.INTERNAL, 'ชีต AuditLogs ยังไม่มีหัวตาราง ' + SETUP_HINT_);
  const colIndex = buildColumnIndex_(header, schema);
  const missing = missingColumns_(colIndex, schema);
  if (missing.length) {
    throw appError_(ERROR_CODES.INTERNAL, 'ชีต AuditLogs ขาดคอลัมน์ ' + missing.join(', ') + ' ' + SETUP_HINT_);
  }
  const lastRow = sheet.getLastRow();
  let lastHash = AUDIT_GENESIS_HASH;
  if (lastRow >= 2) {
    lastHash = unsanitizeFromSheet_(String(sheet.getRange(lastRow, colIndex.Hash + 1).getValue()));
  }
  AUDIT_STATE_ = { schema: schema, sheet: sheet, header: header, colIndex: colIndex, lastRow: lastRow, lastHash: lastHash };
  return AUDIT_STATE_;
}

/**
 * เพิ่มประวัติหลายรายการต่อท้ายชีต AuditLogs (ต้องถือ lock อยู่)
 * entries: [{ action, entity, entityId, before, after, note }]
 */
function auditAppend_(entries, actor) {
  assertLockHeld_();
  assertActor_(actor);
  if (!entries || !entries.length) return [];
  const state = auditState_();
  const ts = nowIso_();
  let prevHash = state.lastHash;

  const records = entries.map(function (entry) {
    if (!entry || !entry.action) throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ไม่ได้ระบุการกระทำของประวัติ');
    const raw = {
      LogId: newId_(state.schema.idPrefix),
      Timestamp: ts,
      UserId: actor.userId,
      Username: actor.username,
      Role: actor.role,
      Action: entry.action,
      Entity: entry.entity || '',
      EntityId: entry.entityId || '',
      BeforeJson: entry.before ? auditToJson_(entry.entity, entry.before) : '',
      AfterJson: entry.after ? auditToJson_(entry.entity, entry.after) : '',
      Note: entry.note || '',
      PrevHash: prevHash,
      Hash: '',
    };
    const rec = {};
    state.schema.columns.forEach(function (col) {
      rec[col.name] = coerceValue_(col, raw[col.name], SHEETS.AUDIT_LOGS);
    });
    rec.Hash = auditComputeHash_(rec);
    prevHash = rec.Hash;
    return rec;
  });

  writeRecordsAt_(state.sheet, state.header, state.schema, records, state.lastRow + 1);
  state.lastRow += records.length;
  state.lastHash = prevHash;
  dbForgetTable_(SHEETS.AUDIT_LOGS);
  auditSaveHead_(state.lastRow, records[records.length - 1]);
  return records.map(copyRecord_);
}

/** จำตำแหน่งแถวล่าสุดไว้ใน Script Properties (ถ้าบันทึกไม่ได้ ไม่ทำให้การบันทึกหลักล้มเหลว) */
function auditSaveHead_(rowNumber, record) {
  try {
    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.AUDIT_HEAD, JSON.stringify({
      row: rowNumber,
      logId: record.LogId,
      hash: record.Hash,
      spreadsheetId: db_().getId(),
    }));
  } catch (e) {
    console.error('บันทึก AUDIT_HEAD ไม่สำเร็จ');
  }
}

function auditComputeHash_(record) {
  const parts = AUDIT_HASH_FIELDS.map(function (f) {
    const v = record[f];
    return v === null || v === undefined ? '' : String(v);
  });
  return sha256Hex_(JSON.stringify(parts));
}

/** แปลงข้อมูลเป็น JSON สำหรับ AuditLogs โดยซ่อนค่าลับทุกระดับ */
function auditToJson_(entity, data) {
  const secret = Object.create(null);
  AUDIT_ALWAYS_REDACT.forEach(function (k) { secret[k] = true; });
  if (entity && Object.prototype.hasOwnProperty.call(SCHEMA, entity)) {
    getSchema_(entity).secret.forEach(function (k) { secret[k] = true; });
  }
  let json = JSON.stringify(redactDeep_(data, secret, 0));
  const max = LIMITS.CELL_MAX_CHARS - 1000;
  if (json.length > max) json = json.slice(0, max) + '…[ตัดทอน]';
  return json;
}

function redactDeep_(value, secret, depth) {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(function (v) { return redactDeep_(v, secret, depth + 1); });
  const out = {};
  Object.keys(value).forEach(function (k) {
    const v = value[k];
    if (secret[k]) out[k] = (v === '' || v === null || v === undefined) ? '' : AUDIT_REDACTED_VALUE;
    else out[k] = redactDeep_(v, secret, depth + 1);
  });
  return out;
}

/**
 * ตรวจความต่อเนื่องของลูกโซ่ hash ทั้งชีต (อ่านอย่างเดียว ไม่แก้ไขข้อมูล)
 * คืนค่า { ok, total, problemCount, problems: [{ rowNumber, logId, problem, label }], lastHash }
 */
function auditVerifyChain_() {
  const table = dbTable_(SHEETS.AUDIT_LOGS);
  const problems = [];
  const seen = Object.create(null);
  let prev = AUDIT_GENESIS_HASH;

  table.rows.forEach(function (row) {
    const rec = row.record;
    if (rec.PrevHash !== prev) problems.push({ rowNumber: row.rowNumber, logId: rec.LogId, problem: 'PREV_HASH_MISMATCH' });
    if (rec.Hash !== auditComputeHash_(rec)) problems.push({ rowNumber: row.rowNumber, logId: rec.LogId, problem: 'HASH_MISMATCH' });
    if (seen[rec.LogId]) problems.push({ rowNumber: row.rowNumber, logId: rec.LogId, problem: 'DUPLICATE_ID' });
    seen[rec.LogId] = true;
    prev = rec.Hash;
  });

  const headRaw = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.AUDIT_HEAD);
  if (headRaw) {
    let head = null;
    try { head = JSON.parse(headRaw); } catch (e) { head = null; }
    if (head && head.hash && (!head.spreadsheetId || head.spreadsheetId === db_().getId())) {
      const found = table.rows.some(function (row) { return row.record.Hash === head.hash; });
      if (!found) problems.push({ rowNumber: head.row, logId: head.logId, problem: 'HEAD_MISSING' });
    }
  }

  problems.forEach(function (p) { p.label = AUDIT_PROBLEM_LABELS[p.problem] || p.problem; });
  return {
    ok: problems.length === 0,
    total: table.rows.length,
    problemCount: problems.length,
    problems: problems.slice(0, 100),
    lastHash: prev,
  };
}
