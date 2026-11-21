/**
 * ============================================================================
 *  Setup.gs — ติดตั้งและตรวจสอบโครงสร้างฐานข้อมูล + เมนูใน Google Sheets
 * ----------------------------------------------------------------------------
 *  วิธีใช้ (เจ้าของระบบเท่านั้น)
 *   - เปิด Google Sheets → เมนู "ระบบเงินบำรุงการศึกษา" → "1) ติดตั้ง / ตรวจสอบโครงสร้างฐานข้อมูล"
 *   - หรือเลือกฟังก์ชัน SetupDatabase แล้วกด Run ใน Apps Script Editor
 *
 *  SetupDatabase() รันซ้ำได้อย่างปลอดภัย
 *   - สร้างเฉพาะชีต คอลัมน์ และค่าตั้งค่าที่ยังไม่มี
 *   - ไม่ลบ ไม่ย้าย ไม่เขียนทับข้อมูลเดิม และไม่เปลี่ยนค่าลับที่สร้างไว้แล้ว
 *   - บันทึกผลการติดตั้งทุกครั้งใน AuditLogs
 * ============================================================================
 */

const MENU_TITLE = 'ระบบเงินบำรุงการศึกษา';

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
 * ติดตั้งหรือตรวจสอบโครงสร้างฐานข้อมูล (ชื่อฟังก์ชันตามข้อกำหนดของโครงการ)
 * คืนค่ารายงานผล (ไม่มีข้อมูลลับ)
 */
function SetupDatabase() {
  assertOwnerContext_();
  const ss = resolveSetupSpreadsheet_();
  dbUseSpreadsheet_(ss);
  const report = withScriptLock_(function () {
    return setupDatabase_(ss);
  }, LIMITS.SETUP_LOCK_TIMEOUT_MS);
  console.log(formatSetupReport_(report));
  return report;
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
