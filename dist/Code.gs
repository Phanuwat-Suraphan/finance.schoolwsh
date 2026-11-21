/**
 * ============================================================================
 *  ระบบบริหารจัดเก็บเงินบำรุงการศึกษา
 *  โรงเรียนวัดเสาหิน จังหวัดเชียงใหม่
 *  เวอร์ชัน 0.2.0 — ระยะที่ 2: ระบบเข้าสู่ระบบและสิทธิ์
 * ============================================================================
 *
 *  วิธีติดตั้งและอัปเดต (ขั้นตอนละเอียดและรูปประกอบ: docs/INSTALL.md)
 *   1. เปิด Google Sheets ที่จะใช้เป็นฐานข้อมูล > เมนู ส่วนขยาย > Apps Script
 *   2. ลบโค้ดเดิมในไฟล์ Code.gs ทั้งหมด แล้ววางเนื้อหาไฟล์นี้ทั้งไฟล์ > กด Ctrl+S
 *   3. แถบด้านบน เลือกฟังก์ชัน SetupDatabase > กด "เรียกใช้" (Run) > อนุญาตสิทธิ์
 *   4. ครั้งแรกเท่านั้น: รีเฟรช Google Sheets > เมนู "ระบบเงินบำรุงการศึกษา"
 *      > 3) สร้างหรือรีเซ็ตบัญชีผู้ดูแลระบบ
 *   5. เผยแพร่เว็บ: Deploy > New deployment > Web app
 *      Execute as = Me / Who has access = Anyone with Google account
 *      อัปเดตครั้งต่อไป: Deploy > Manage deployments > แก้ไข (ดินสอ) > Version: New version > Deploy
 *
 *  ข้อมูลเดิมไม่หายเมื่ออัปเดต และลิงก์เว็บแอปเดิมใช้ต่อได้
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
 *  สร้างผู้ดูแลระบบคนแรก (หรือรีเซ็ตเมื่อลืมรหัสผ่าน): เมนู "3) สร้างหรือรีเซ็ตบัญชีผู้ดูแลระบบ"
 *   ใช้ได้เฉพาะเจ้าของระบบ ไม่มีหน้า "สมัครสมาชิก" บนเว็บ
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
    .addItem('3) สร้างหรือรีเซ็ตบัญชีผู้ดูแลระบบ', 'menuSetupAdmin')
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

/** เมนู 3: เปิดหน้าต่างสร้างหรือรีเซ็ตบัญชีผู้ดูแลระบบ */
function menuSetupAdmin() {
  const ui = SpreadsheetApp.getUi();
  try {
    assertOwnerContext_();
    const html = injectHtml_(htmlSource_('AdminDialog'), '/*@@BOOT@@*/',
      'var DIALOG = ' + safeJsonForScript_({ authMode: authMode_() }) + ';');
    ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(440).setHeight(600), 'สร้างหรือรีเซ็ตบัญชีผู้ดูแลระบบ');
  } catch (e) {
    ui.alert('เปิดหน้าต่างไม่สำเร็จ', ownerErrorMessage_(e), ui.ButtonSet.OK);
  }
}

/**
 * รับข้อมูลจากหน้าต่างในเมนู 3 (เจ้าของระบบเท่านั้น)
 * ชื่อผู้ใช้ใหม่ = สร้างผู้ดูแลระบบ / ชื่อผู้ใช้ผู้ดูแลระบบเดิม = รีเซ็ตรหัสผ่านและเปิดใช้งาน
 */
function ownerSetupAdmin(form) {
  try {
    assertOwnerContext_();
    const message = withScriptLock_(function () { return ownerSetupAdmin_(form || {}); });
    return { ok: true, message: message };
  } catch (e) {
    return { ok: false, message: ownerErrorMessage_(e) };
  }
}

function ownerSetupAdmin_(form) {
  const mode = authMode_();
  const username = normalizeUsername_(form.username);
  const fields = {
    DisplayName: requireText_(form.displayName, 'ชื่อ-นามสกุล', { max: 100 }),
    Email: normalizeEmail_(form.email, mode === AUTH_MODES.GOOGLE),
    Status: STATUS.USER.ACTIVE,
  };
  if (mode === AUTH_MODES.PASSWORD) {
    const password = validateNewPassword_(typeof form.password === 'string' ? form.password : '', username);
    if (form.password !== form.confirmPassword) throw validationError_('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    fields.PasswordHash = hashPassword_(password);
    fields.MustChangePassword = form.mustChangePassword !== false;
  }
  const existing = dbFindOne_(SHEETS.USERS, function (u) { return u.Username === username; });
  if (existing) {
    if (existing.Role !== ROLES.ADMIN) {
      throw appError_(ERROR_CODES.CONFLICT, 'ชื่อผู้ใช้ "' + username + '" เป็นบัญชีของ' + (ROLE_LABELS[existing.Role] || existing.Role) + ' กรุณาใช้ชื่อผู้ใช้อื่น');
    }
    fields.SessionVersion = (existing.SessionVersion || 0) + 1;
    dbUpdate_(SHEETS.USERS, existing.UserId, fields, ACTORS.OWNER, {
      action: AUDIT_ACTIONS.PASSWORD_CHANGE, note: 'เจ้าของระบบรีเซ็ตบัญชีผู้ดูแลระบบ',
    });
    clearLoginFailures_(username);
    return 'รีเซ็ตบัญชีผู้ดูแลระบบ "' + username + '" เรียบร้อยแล้ว';
  }
  fields.Username = username;
  fields.Role = ROLES.ADMIN;
  fields.SessionVersion = 1;
  if (fields.MustChangePassword === undefined) fields.MustChangePassword = false;
  dbInsert_(SHEETS.USERS, fields, ACTORS.OWNER, { note: 'เจ้าของระบบสร้างบัญชีผู้ดูแลระบบ' });
  return 'สร้างบัญชีผู้ดูแลระบบ "' + username + '" เรียบร้อยแล้ว';
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
    academicYearCreated: null,
    changed: false,
  };

  initScriptProperties_(ss, report);
  SHEET_ORDER.forEach(function (name) {
    report.sheets.push(ensureSheet_(ss, name));
  });
  dbClearCache_();
  ensureDefaultSettings_(report);
  ensureDefaultAcademicYear_(report);
  ensurePasswordHashIterations_(report);

  report.changed = report.propertiesInitialized.length > 0 ||
    report.settingsAdded.length > 0 ||
    report.academicYearCreated !== null ||
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
      return { SettingKey: def.key, Value: defaultSettingValue_(def), Description: settingDescription_(def) };
    });
  if (toAdd.length) {
    dbInsertMany_(SHEETS.SCHOOL_SETTINGS, toAdd, ACTORS.OWNER, { note: 'ค่าเริ่มต้นจากการติดตั้งฐานข้อมูล' });
    report.settingsAdded = toAdd.map(function (r) { return r.SettingKey; });
  }
}

/** สร้างปีการศึกษาปัจจุบันให้ ถ้ายังไม่มีปีการศึกษาใดเลย */
function ensureDefaultAcademicYear_(report) {
  if (dbAll_(SHEETS.ACADEMIC_YEARS).length) return;
  const year = getSetting_('CURRENT_ACADEMIC_YEAR');
  dbInsert_(SHEETS.ACADEMIC_YEARS, {
    Year: year,
    Label: 'ปีการศึกษา ' + year,
    IsCurrent: true,
    Status: STATUS.ACADEMIC_YEAR.OPEN,
  }, ACTORS.OWNER, { note: 'ปีการศึกษาเริ่มต้นจากการติดตั้งฐานข้อมูล' });
  report.academicYearCreated = year;
}

/** วัดความเร็วเครื่องแล้วกำหนดจำนวนรอบแฮชรหัสผ่าน (ครั้งเดียว ไม่เปลี่ยนค่าเดิม) */
function ensurePasswordHashIterations_(report) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(PROP_KEYS.PASSWORD_HASH_ITERATIONS)) return;
  props.setProperty(PROP_KEYS.PASSWORD_HASH_ITERATIONS, String(calibrateHashIterations_()));
  report.propertiesInitialized.push(PROP_KEYS.PASSWORD_HASH_ITERATIONS);
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
    academicYearCreated: report.academicYearCreated,
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
  if (report.academicYearCreated !== null) lines.push('สร้างปีการศึกษาเริ่มต้น ' + report.academicYearCreated);
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
 *  Code.gs — จุดเข้าของ Web App และการประกอบหน้าเว็บ
 * ----------------------------------------------------------------------------
 *  - doGet() ส่งหน้าเว็บเปล่าที่ยังไม่มีข้อมูลใด ๆ ข้อมูลทั้งหมดโหลดผ่าน api() หลังเข้าสู่ระบบ
 *  - หน้าเว็บประกอบจากไฟล์ HTML (Index, Styles, JsCore, JsViews) ด้วยการแทนที่ข้อความตรง ๆ
 *    ไม่ใช้ scriptlet ของ HtmlTemplate เพื่อไม่ให้โค้ด JavaScript ถูกตีความผิด
 *  - ติดตั้งแบบไฟล์เดียว (dist/Code.gs): ไฟล์ HTML ถูกฝังไว้ในค่าคงที่ BUNDLED_HTML_
 *    ติดตั้งแบบแยกไฟล์: อ่านจากไฟล์ HTML ในโปรเจกต์
 * ============================================================================
 */

function doGet() {
  return HtmlService.createHtmlOutput(renderAppHtml_())
    .setTitle(APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** ประกอบหน้าเว็บทั้งหน้า */
function renderAppHtml_() {
  let html = htmlSource_('Index');
  html = injectHtml_(html, '<!--@@STYLES@@-->', htmlSource_('Styles'));
  html = injectHtml_(html, '/*@@BOOT@@*/', 'var BOOT = ' + safeJsonForScript_(bootConfig_()) + ';');
  html = injectHtml_(html, '/*@@SHARED@@*/', sharedClientSource_());
  html = injectHtml_(html, '<!--@@CORE@@-->', htmlSource_('JsCore'));
  html = injectHtml_(html, '<!--@@VIEWS@@-->', htmlSource_('JsViews'));
  return html;
}

/** ค่าเริ่มต้นที่หน้าเว็บต้องรู้ก่อนเข้าสู่ระบบ (ไม่มีข้อมูลลับ) */
function bootConfig_() {
  let schoolName = APP.SCHOOL_NAME;
  let province = APP.PROVINCE;
  try {
    schoolName = getSetting_('SCHOOL_NAME') || schoolName;
    province = getSetting_('SCHOOL_PROVINCE') || province;
  } catch (e) {
    // ยังไม่ได้ติดตั้งฐานข้อมูล: ใช้ค่าเริ่มต้น
  }
  return {
    appName: APP.NAME,
    schoolName: schoolName,
    province: province,
    version: APP.VERSION,
    release: APP.RELEASE,
    authMode: authMode_(),
  };
}

/** เนื้อหาไฟล์ HTML ตามชื่อ (ไฟล์เดียว: จาก BUNDLED_HTML_ / แยกไฟล์: จากไฟล์ในโปรเจกต์) */
function htmlSource_(name) {
  if (typeof BUNDLED_HTML_ !== 'undefined' && Object.prototype.hasOwnProperty.call(BUNDLED_HTML_, name)) {
    return BUNDLED_HTML_[name];
  }
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** แทนที่เครื่องหมายด้วยเนื้อหา (ไม่ใช้ String.replace เพราะ $ ในเนื้อหาจะถูกตีความพิเศษ) */
function injectHtml_(html, marker, content) {
  const index = html.indexOf(marker);
  if (index === -1) throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ไม่พบตำแหน่ง ' + marker + ' ในหน้าเว็บ');
  return html.slice(0, index) + content + html.slice(index + marker.length);
}

/** JSON ที่ปลอดภัยต่อการวางในแท็ก <script> */
function safeJsonForScript_(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Api.js
// ============================================================================

/**
 * ============================================================================
 *  Api.gs — ทางเข้าเดียวของข้อมูลทั้งหมดจากหน้าเว็บ
 * ----------------------------------------------------------------------------
 *  หน้าเว็บเรียก google.script.run.api({ action, token, payload }) เท่านั้น
 *  ทุกคำขอผ่านขั้นตอนเดียวกัน:
 *   1. action ต้องอยู่ในตาราง apiActions_() (ไม่อยู่ = ปฏิเสธ)
 *   2. ตรวจ session จาก token และอ่านบทบาทล่าสุดจากชีต Users
 *   3. ถ้าผู้ใช้ต้องเปลี่ยนรหัสผ่าน ใช้ได้เฉพาะคำสั่งที่จำเป็น
 *   4. ตรวจบทบาทตามตาราง (ถูกปฏิเสธ = บันทึก ACCESS_DENIED)
 *   5. คำสั่งที่บันทึกข้อมูลทำภายใต้ LockService (ตรวจ session ภายใน lock ด้วย)
 *   6. ตอบกลับ { ok: true, data } หรือ { ok: false, error: { code, message } }
 *      ไม่ส่งรายละเอียดข้อผิดพลาดภายในหรือ stack trace ออกไป
 *
 *  ตารางสิทธิ์ทั้งหมดอยู่ใน apiActions_() ที่เดียว ตรวจทานได้ในที่เดียว
 * ============================================================================
 */

let API_ACTIONS_ = null;

/**
 * ตารางคำสั่งและสิทธิ์
 *  roles    บทบาทที่ใช้คำสั่งได้
 *  public   ไม่ต้องเข้าสู่ระบบ (เฉพาะคำสั่งเข้าสู่ระบบ)
 *  write    บันทึกข้อมูล = ทำภายใต้ LockService
 *  allowWhenMustChangePassword  ใช้ได้แม้ยังไม่ได้เปลี่ยนรหัสผ่านชั่วคราว
 */
function apiActions_() {
  if (API_ACTIONS_) return API_ACTIONS_;
  const ALL = [ROLES.ADMIN, ROLES.FINANCE, ROLES.DIRECTOR];
  const ADMIN = [ROLES.ADMIN];
  const OVERSIGHT = [ROLES.ADMIN, ROLES.DIRECTOR];
  API_ACTIONS_ = {
    // การเข้าสู่ระบบ
    'auth.login': { public: true, write: true, handler: authLogin_ },
    'auth.loginGoogle': { public: true, write: true, handler: authLoginGoogle_ },
    'auth.me': { roles: ALL, write: false, allowWhenMustChangePassword: true, handler: authMe_ },
    'auth.logout': { roles: ALL, write: true, allowWhenMustChangePassword: true, handler: authLogout_ },
    'auth.changePassword': { roles: ALL, write: true, allowWhenMustChangePassword: true, handler: authChangePassword_ },
    // ผู้ใช้งาน
    'users.list': { roles: ADMIN, write: false, handler: usersList_ },
    'users.create': { roles: ADMIN, write: true, handler: usersCreate_ },
    'users.update': { roles: ADMIN, write: true, handler: usersUpdate_ },
    'users.resetPassword': { roles: ADMIN, write: true, handler: usersResetPassword_ },
    // ค่าตั้งค่าโรงเรียน
    'settings.get': { roles: ALL, write: false, handler: settingsGet_ },
    'settings.update': { roles: ADMIN, write: true, handler: settingsUpdate_ },
    // ปีการศึกษา
    'years.list': { roles: ALL, write: false, handler: yearsList_ },
    'years.create': { roles: ADMIN, write: true, handler: yearsCreate_ },
    'years.update': { roles: ADMIN, write: true, handler: yearsUpdate_ },
    'years.setCurrent': { roles: ADMIN, write: true, handler: yearsSetCurrent_ },
    // ประวัติการใช้งาน
    'audit.list': { roles: OVERSIGHT, write: false, handler: auditList_ },
    'audit.verify': { roles: OVERSIGHT, write: true, handler: auditVerify_ },
  };
  Object.keys(API_ACTIONS_).forEach(function (k) { Object.freeze(API_ACTIONS_[k]); });
  Object.freeze(API_ACTIONS_);
  return API_ACTIONS_;
}

/** ทางเข้าเดียวจากหน้าเว็บ */
function api(request) {
  try {
    const req = request && typeof request === 'object' && !Array.isArray(request) ? request : {};
    const action = typeof req.action === 'string' ? req.action : '';
    const actions = apiActions_();
    if (!Object.prototype.hasOwnProperty.call(actions, action)) {
      throw appError_(ERROR_CODES.FORBIDDEN, 'ไม่มีสิทธิ์ใช้งานคำสั่งนี้');
    }
    const def = actions[action];
    const payload = req.payload && typeof req.payload === 'object' && !Array.isArray(req.payload) ? req.payload : {};
    const execute = function () {
      const ctx = def.public ? null : authorizeRequest_(req.token, def, action);
      return def.handler(ctx, payload);
    };
    const data = def.write ? withScriptLock_(execute) : execute();
    return { ok: true, data: data === undefined ? null : data };
  } catch (e) {
    return apiErrorResponse_(e);
  }
}

/** ตรวจ session และสิทธิ์ของคำขอ คืนค่า ctx ของผู้ใช้ */
function authorizeRequest_(token, def, action) {
  const ctx = authenticate_(token);
  if (ctx.mustChangePassword && !def.allowWhenMustChangePassword) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งานระบบ', { reason: 'PASSWORD_CHANGE_REQUIRED' });
  }
  if (def.roles.indexOf(ctx.role) === -1) {
    auditAccessDenied_(ctx, action);
    throw appError_(ERROR_CODES.FORBIDDEN, 'ไม่มีสิทธิ์ใช้งานคำสั่งนี้');
  }
  return ctx;
}

/** บันทึกความพยายามใช้คำสั่งที่ไม่มีสิทธิ์ (หน้าเว็บปกติจะไม่ส่งคำสั่งเหล่านี้) */
function auditAccessDenied_(ctx, action) {
  try {
    withScriptLock_(function () {
      auditAppend_([{
        action: AUDIT_ACTIONS.ACCESS_DENIED,
        entity: 'Api',
        entityId: action,
        note: 'พยายามใช้คำสั่งที่ไม่มีสิทธิ์',
      }], actorFromCtx_(ctx));
    }, 5000);
  } catch (e) {
    console.error('บันทึก ACCESS_DENIED ไม่สำเร็จ');
  }
}

/** แปลงข้อผิดพลาดเป็นคำตอบที่ปลอดภัยต่อการส่งให้หน้าเว็บ */
function apiErrorResponse_(e) {
  if (isAppError_(e)) {
    const error = { code: e.code, message: e.userMessage };
    if (e.details && typeof e.details.reason === 'string') error.reason = e.details.reason;
    return { ok: false, error: error };
  }
  console.error('API error: ' + (e && e.name ? e.name : 'Error') + ': ' + (e && e.message ? e.message : String(e)));
  return { ok: false, error: { code: ERROR_CODES.INTERNAL, message: safeErrorMessage_(e) } };
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Auth.js
// ============================================================================

/**
 * ============================================================================
 *  Auth.gs — การยืนยันตัวตน รหัสผ่าน และ session
 * ----------------------------------------------------------------------------
 *  รหัสผ่าน
 *   - เก็บเฉพาะค่าแฮช รูปแบบ v1$รอบ$salt$hash (HMAC-SHA256 วนซ้ำ + salt ต่อผู้ใช้ + pepper ใน Script Properties)
 *   - จำนวนรอบปรับตามความเร็วของเครื่อง Google ตอนติดตั้ง และระบบแฮชใหม่ให้อัตโนมัติเมื่อจำนวนรอบเพิ่ม
 *   - เทียบค่าแฮชแบบใช้เวลาคงที่ และคำนวณแฮชเสมอแม้ไม่พบชื่อผู้ใช้ (กันการเดาว่าชื่อใดมีอยู่)
 *  การเข้าสู่ระบบ
 *   - ใส่รหัสผิดเกินกำหนด ล็อกชื่อผู้ใช้นั้นชั่วคราว (นับตามชื่อผู้ใช้ แม้ไม่มีชื่อนั้นในระบบ)
 *   - ประวัติการเข้าสู่ระบบไม่สำเร็จ จะไม่บันทึกข้อความที่พิมพ์มาถ้าไม่ใช่ชื่อผู้ใช้จริง
 *     (กันกรณีพิมพ์รหัสผ่านลงช่องชื่อผู้ใช้โดยไม่ตั้งใจ)
 *  Session
 *   - token สุ่ม 256 บิต เก็บใน CacheService เป็นค่าแฮชของ token
 *   - หมดอายุเมื่อไม่ใช้งาน และมีอายุสูงสุด ตรวจสถานะ/บทบาทล่าสุดจากชีต Users ทุกคำขอ
 *   - เพิ่ม SessionVersion ของผู้ใช้ = ทุก session เดิมของผู้ใช้นั้นใช้ไม่ได้ทันที
 * ============================================================================
 */

const SESSION_KEY_PREFIX_ = 'sess:';
const LOGIN_FAIL_KEY_PREFIX_ = 'lfail:';
const LOGIN_FAILED_MESSAGE_ = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

// ---------------------------------------------------------------------------
// โหมดการเข้าสู่ระบบ
// ---------------------------------------------------------------------------

function authMode_() {
  const mode = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.AUTH_MODE);
  return mode === AUTH_MODES.GOOGLE ? AUTH_MODES.GOOGLE : AUTH_MODES.PASSWORD;
}

// ---------------------------------------------------------------------------
// ผู้กระทำ (ใช้บันทึก AuditLogs)
// ---------------------------------------------------------------------------

function actorFromUser_(user) {
  return { userId: user.UserId, username: user.Username, role: user.Role };
}

function actorFromCtx_(ctx) {
  return { userId: ctx.userId, username: ctx.username, role: ctx.role };
}

// ---------------------------------------------------------------------------
// รหัสผ่าน
// ---------------------------------------------------------------------------

function passwordPepper_() {
  const pepper = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.PASSWORD_PEPPER);
  if (!pepper) throw appError_(ERROR_CODES.INTERNAL, 'ระบบยังไม่ได้ติดตั้งค่าความปลอดภัย ' + SETUP_HINT_);
  return pepper;
}

function passwordHashIterations_() {
  const n = Number(PropertiesService.getScriptProperties().getProperty(PROP_KEYS.PASSWORD_HASH_ITERATIONS));
  if (!Number.isInteger(n)) return AUTH.HASH_DEFAULT_ITERATIONS;
  return Math.min(AUTH.HASH_MAX_ITERATIONS, Math.max(AUTH.HASH_MIN_ITERATIONS, n));
}

/** HMAC-SHA256 วนซ้ำ คืนค่าฐานสิบหก */
function derivePasswordHash_(password, saltHex, iterations) {
  const pepper = passwordPepper_();
  let hash = bytesToHex_(Utilities.computeHmacSha256Signature(saltHex + '|' + password, pepper, Utilities.Charset.UTF_8));
  for (let i = 1; i < iterations; i++) {
    hash = bytesToHex_(Utilities.computeHmacSha256Signature(hash + '|' + saltHex, pepper));
  }
  return hash;
}

function hashPassword_(password) {
  const salt = randomHex_(32).toLowerCase();
  const iterations = passwordHashIterations_();
  return [AUTH.HASH_VERSION, iterations, salt, derivePasswordHash_(password, salt, iterations)].join('$');
}

/** ตรวจรหัสผ่าน คืนค่า { ok, needsRehash } */
function verifyPassword_(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== AUTH.HASH_VERSION || !/^[0-9a-f]{32}$/.test(parts[2])) {
    // รูปแบบไม่ถูกต้อง: ยังคำนวณแฮชเพื่อให้ใช้เวลาเท่ากัน
    derivePasswordHash_(String(password), randomHex_(32).toLowerCase(), passwordHashIterations_());
    return { ok: false, needsRehash: false };
  }
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > AUTH.HASH_MAX_ITERATIONS * 4) {
    return { ok: false, needsRehash: false };
  }
  const actual = derivePasswordHash_(String(password), parts[2], iterations);
  return { ok: constantTimeEquals_(actual, parts[3]), needsRehash: iterations < passwordHashIterations_() };
}

function constantTimeEquals_(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/** นโยบายรหัสผ่าน: 8–128 ตัว มีทั้งตัวอักษรและตัวเลข ไม่มีชื่อผู้ใช้อยู่ในรหัสผ่าน */
function validateNewPassword_(password, username) {
  if (typeof password !== 'string' || password === '') throw validationError_('กรุณากรอกรหัสผ่าน');
  if (password.length < AUTH.PASSWORD_MIN_LENGTH) throw validationError_('รหัสผ่านต้องมีอย่างน้อย ' + AUTH.PASSWORD_MIN_LENGTH + ' ตัวอักษร');
  if (password.length > AUTH.PASSWORD_MAX_LENGTH) throw validationError_('รหัสผ่านยาวเกิน ' + AUTH.PASSWORD_MAX_LENGTH + ' ตัวอักษร');
  if (!/[A-Za-zก-ฮ]/.test(password) || !/[0-9]/.test(password)) throw validationError_('รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข');
  if (/^\s|\s$/.test(password)) throw validationError_('รหัสผ่านต้องไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง');
  if (username && password.toLowerCase().indexOf(String(username).toLowerCase()) !== -1) {
    throw validationError_('รหัสผ่านต้องไม่มีชื่อผู้ใช้อยู่ในรหัสผ่าน');
  }
  return password;
}

/** ชื่อผู้ใช้: ตัวพิมพ์เล็ก a-z ขึ้นต้น ตามด้วย a-z 0-9 . _ - รวม 3–32 ตัว */
function normalizeUsername_(value) {
  const username = requireText_(value, 'ชื่อผู้ใช้', { max: 32 }).toLowerCase();
  if (!new RegExp(AUTH.USERNAME_PATTERN).test(username)) {
    throw validationError_('ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษตัวพิมพ์เล็ก ขึ้นต้นด้วยตัวอักษร ใช้ได้เฉพาะ a-z 0-9 . _ - และยาว 3–32 ตัว');
  }
  return username;
}

function normalizeEmail_(value, required) {
  const email = requireText_(value, 'อีเมล', { optional: !required, max: 254 }).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validationError_('รูปแบบอีเมลไม่ถูกต้อง');
  return email;
}

/** วัดความเร็วการแฮชบนเครื่อง Google แล้วเลือกจำนวนรอบให้ใช้เวลาประมาณ AUTH.HASH_TARGET_MS */
function calibrateHashIterations_() {
  const sample = 200;
  const started = Date.now();
  derivePasswordHash_('calibration-password-1', 'c0ffee00c0ffee00c0ffee00c0ffee00', sample);
  const perIteration = Math.max(Date.now() - started, 1) / sample;
  const target = Math.round(AUTH.HASH_TARGET_MS / perIteration);
  return Math.min(AUTH.HASH_MAX_ITERATIONS, Math.max(AUTH.HASH_MIN_ITERATIONS, target));
}

// ---------------------------------------------------------------------------
// การล็อกเมื่อใส่รหัสผ่านผิด
// ---------------------------------------------------------------------------

function authLimits_() {
  return {
    idleMinutes: getSetting_('SESSION_IDLE_MINUTES'),
    maxHours: getSetting_('SESSION_MAX_HOURS'),
    maxAttempts: getSetting_('LOGIN_MAX_ATTEMPTS'),
    lockMinutes: getSetting_('LOGIN_LOCK_MINUTES'),
  };
}

function loginFailKey_(username) {
  return LOGIN_FAIL_KEY_PREFIX_ + sha256Hex_(String(username).toLowerCase());
}

function safeJsonParse_(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

function loginFailState_(username) {
  const state = safeJsonParse_(CacheService.getScriptCache().get(loginFailKey_(username)));
  if (!state) return { count: 0, lockedUntil: 0 };
  if (state.lockedUntil && state.lockedUntil <= now_().getTime()) {
    CacheService.getScriptCache().remove(loginFailKey_(username));
    return { count: 0, lockedUntil: 0 };
  }
  return state;
}

function recordLoginFailure_(username, limits) {
  const state = loginFailState_(username);
  state.count = (state.count || 0) + 1;
  if (state.count >= limits.maxAttempts) state.lockedUntil = now_().getTime() + limits.lockMinutes * 60000;
  const ttl = Math.min(AUTH.CACHE_MAX_SECONDS, limits.lockMinutes * 60);
  CacheService.getScriptCache().put(loginFailKey_(username), JSON.stringify(state), ttl);
  return state;
}

function clearLoginFailures_(username) {
  CacheService.getScriptCache().remove(loginFailKey_(username));
}

function lockedMessage_(lockedUntil) {
  const minutes = Math.max(1, Math.ceil((lockedUntil - now_().getTime()) / 60000));
  return 'มีการใส่รหัสผ่านผิดหลายครั้ง ชื่อผู้ใช้นี้ถูกล็อกชั่วคราว กรุณารอประมาณ ' + minutes + ' นาทีแล้วลองใหม่';
}

/** บันทึกการเข้าสู่ระบบไม่สำเร็จ (ไม่บันทึกข้อความที่พิมพ์ ถ้าไม่ใช่ชื่อผู้ใช้จริง) */
function auditLoginFailure_(user, reason) {
  const actor = user ? actorFromUser_(user) : { userId: 'ANONYMOUS', username: '(ไม่พบชื่อผู้ใช้)', role: 'ANONYMOUS' };
  auditAppend_([{
    action: AUDIT_ACTIONS.LOGIN_FAILED,
    entity: SHEETS.USERS,
    entityId: user ? user.UserId : '',
    note: reason,
  }], actor);
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

function sessionKey_(token) {
  return SESSION_KEY_PREFIX_ + sha256Hex_(token);
}

function createSession_(user, limits) {
  const token = randomHex_(64).toLowerCase();
  const nowMs = now_().getTime();
  const idleSeconds = Math.min(AUTH.CACHE_MAX_SECONDS, limits.idleMinutes * 60);
  const session = {
    uid: user.UserId,
    ver: user.SessionVersion || 0,
    created: nowMs,
    seen: nowMs,
    idle: idleSeconds,
    maxMs: limits.maxHours * 3600000,
  };
  CacheService.getScriptCache().put(sessionKey_(token), JSON.stringify(session), idleSeconds);
  return token;
}

function sessionExpiredError_(message) {
  return appError_(ERROR_CODES.UNAUTHENTICATED, message || 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
}

/**
 * ตรวจ token ของทุกคำขอ คืนค่าข้อมูลผู้ใช้ล่าสุด (ctx)
 * ไม่เชื่อข้อมูลบทบาทจากหน้าเว็บ อ่านจากชีต Users ทุกครั้ง
 */
function authenticate_(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw sessionExpiredError_();
  const cache = CacheService.getScriptCache();
  const key = sessionKey_(token);
  const session = safeJsonParse_(cache.get(key));
  if (!session || !session.uid) throw sessionExpiredError_();
  const nowMs = now_().getTime();
  if (nowMs - session.created > session.maxMs) {
    cache.remove(key);
    throw sessionExpiredError_('ครบเวลาการเข้าสู่ระบบสูงสุดแล้ว กรุณาเข้าสู่ระบบใหม่');
  }
  if (nowMs - session.seen > session.idle * 1000) {
    cache.remove(key);
    throw sessionExpiredError_();
  }
  const user = dbGet_(SHEETS.USERS, session.uid);
  if (!user || user.Status !== STATUS.USER.ACTIVE || (user.SessionVersion || 0) !== session.ver) {
    cache.remove(key);
    throw sessionExpiredError_('บัญชีของคุณมีการเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่');
  }
  if (authMode_() === AUTH_MODES.GOOGLE) {
    const email = activeGoogleEmail_();
    if (!email || email !== String(user.Email).toLowerCase()) {
      cache.remove(key);
      throw sessionExpiredError_('บัญชี Google ที่ใช้อยู่ไม่ตรงกับผู้ใช้ที่เข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่');
    }
  }
  if (nowMs - session.seen > 60000) {
    session.seen = nowMs;
    cache.put(key, JSON.stringify(session), session.idle);
  }
  return {
    userId: user.UserId,
    username: user.Username,
    role: user.Role,
    displayName: user.DisplayName,
    mustChangePassword: authMode_() === AUTH_MODES.PASSWORD && user.MustChangePassword === true,
    sessionKey: key,
  };
}

function activeGoogleEmail_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').toLowerCase();
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// API: การเข้าสู่ระบบ
// ---------------------------------------------------------------------------

/** ข้อมูลผู้ใช้ที่ส่งให้หน้าเว็บ (ไม่มีค่าแฮชรหัสผ่านหรือ SessionVersion) */
function userDto_(u) {
  return {
    userId: u.UserId,
    username: u.Username,
    displayName: u.DisplayName,
    position: u.Position,
    email: u.Email,
    role: u.Role,
    roleLabel: ROLE_LABELS[u.Role] || u.Role,
    status: u.Status,
    statusLabel: STATUS_LABELS.USER[u.Status] || u.Status,
    mustChangePassword: u.MustChangePassword === true,
    lastLoginAt: u.LastLoginAt,
    createdAt: u.CreatedAt,
    updatedAt: u.UpdatedAt,
  };
}

/**
 * หลังยืนยันตัวตนสำเร็จ: บันทึกเวลา ประวัติ และสร้าง session
 * rehashPassword = รหัสผ่านที่ต้องแฮชใหม่ด้วยจำนวนรอบปัจจุบัน (null = ไม่ต้อง)
 */
function completeLogin_(user, rehashPassword, limits) {
  const changes = { LastLoginAt: nowIso_() };
  if (rehashPassword !== null) changes.PasswordHash = hashPassword_(rehashPassword);
  dbUpdate_(SHEETS.USERS, user.UserId, changes, actorFromUser_(user), { note: 'ปรับรูปแบบการเก็บรหัสผ่านอัตโนมัติ' });
  auditAppend_([{ action: AUDIT_ACTIONS.LOGIN, entity: SHEETS.USERS, entityId: user.UserId, note: 'เข้าสู่ระบบสำเร็จ' }], actorFromUser_(user));
  const fresh = dbGet_(SHEETS.USERS, user.UserId);
  return {
    token: createSession_(fresh, limits),
    user: userDto_(fresh),
    mustChangePassword: authMode_() === AUTH_MODES.PASSWORD && fresh.MustChangePassword === true,
  };
}

/** auth.login — โหมดชื่อผู้ใช้และรหัสผ่าน */
function authLogin_(ctx, payload) {
  if (authMode_() !== AUTH_MODES.PASSWORD) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'ระบบนี้ตั้งค่าให้เข้าสู่ระบบด้วยบัญชี Google ของโรงเรียน');
  }
  const username = cleanText_(typeof payload.username === 'string' ? payload.username : '').toLowerCase().slice(0, 64);
  const password = typeof payload.password === 'string' ? payload.password : '';
  if (!username || !password) throw validationError_('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');

  const limits = authLimits_();
  const user = dbFindOne_(SHEETS.USERS, function (u) { return u.Username === username; });

  const lock = loginFailState_(username);
  if (lock.lockedUntil) {
    auditLoginFailure_(user, 'ถูกล็อกชั่วคราวเพราะใส่รหัสผ่านผิดหลายครั้ง');
    throw appError_(ERROR_CODES.UNAUTHENTICATED, lockedMessage_(lock.lockedUntil));
  }

  let verified = false;
  let needsRehash = false;
  if (password.length <= AUTH.PASSWORD_MAX_LENGTH) {
    if (user) {
      const check = verifyPassword_(password, user.PasswordHash);
      verified = check.ok;
      needsRehash = check.needsRehash;
    } else {
      derivePasswordHash_(password, randomHex_(32).toLowerCase(), passwordHashIterations_());
    }
  }
  if (!verified) {
    const state = recordLoginFailure_(username, limits);
    auditLoginFailure_(user, (user ? 'รหัสผ่านไม่ถูกต้อง' : 'ไม่พบชื่อผู้ใช้') + ' (ครั้งที่ ' + state.count + ')');
    throw appError_(ERROR_CODES.UNAUTHENTICATED, state.lockedUntil ? lockedMessage_(state.lockedUntil) : LOGIN_FAILED_MESSAGE_);
  }
  if (user.Status !== STATUS.USER.ACTIVE) {
    auditLoginFailure_(user, 'บัญชีถูกปิดการใช้งาน');
    throw appError_(ERROR_CODES.UNAUTHENTICATED, 'บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  }
  clearLoginFailures_(username);
  return completeLogin_(user, needsRehash ? password : null, limits);
}

/** auth.loginGoogle — โหมดบัญชี Google ของโรงเรียน (ใช้อีเมลที่ Google ยืนยันแล้ว) */
function authLoginGoogle_() {
  if (authMode_() !== AUTH_MODES.GOOGLE) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'ระบบนี้ตั้งค่าให้เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน');
  }
  const email = activeGoogleEmail_();
  if (!email) {
    throw appError_(ERROR_CODES.UNAUTHENTICATED, 'ไม่พบบัญชี Google ที่เข้าสู่ระบบ กรุณาเข้าสู่ระบบ Google ด้วยบัญชีของโรงเรียน');
  }
  const user = dbFindOne_(SHEETS.USERS, function (u) { return String(u.Email).toLowerCase() === email; });
  if (!user || user.Status !== STATUS.USER.ACTIVE) {
    auditLoginFailure_(user, user ? 'บัญชีถูกปิดการใช้งาน' : 'บัญชี Google ที่ยังไม่ได้รับสิทธิ์ใช้งาน');
    throw appError_(ERROR_CODES.FORBIDDEN, 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งานระบบ กรุณาติดต่อผู้ดูแลระบบ');
  }
  return completeLogin_(user, null, authLimits_());
}

/** auth.me — ข้อมูลผู้ใช้และโรงเรียนสำหรับหน้าเว็บ */
function authMe_(ctx) {
  const user = dbGet_(SHEETS.USERS, ctx.userId);
  return {
    user: userDto_(user),
    mustChangePassword: ctx.mustChangePassword,
    authMode: authMode_(),
    school: schoolInfo_(),
    app: { name: APP.NAME, version: APP.VERSION, release: APP.RELEASE },
  };
}

/** auth.logout */
function authLogout_(ctx) {
  CacheService.getScriptCache().remove(ctx.sessionKey);
  auditAppend_([{ action: AUDIT_ACTIONS.LOGOUT, entity: SHEETS.USERS, entityId: ctx.userId, note: 'ออกจากระบบ' }], actorFromCtx_(ctx));
  return { loggedOut: true };
}

/** auth.changePassword — เปลี่ยนรหัสผ่านของตนเอง (ทุก session เดิมหมดอายุ แล้วออก session ใหม่ให้) */
function authChangePassword_(ctx, payload) {
  if (authMode_() !== AUTH_MODES.PASSWORD) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'ระบบนี้ใช้บัญชี Google จึงไม่มีรหัสผ่านของระบบ');
  }
  const user = dbGet_(SHEETS.USERS, ctx.userId);
  const current = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
  const next = typeof payload.newPassword === 'string' ? payload.newPassword : '';
  const limits = authLimits_();
  const lock = loginFailState_(user.Username);
  if (lock.lockedUntil) throw appError_(ERROR_CODES.VALIDATION, lockedMessage_(lock.lockedUntil));
  if (!current || !verifyPassword_(current, user.PasswordHash).ok) {
    const state = recordLoginFailure_(user.Username, limits);
    auditLoginFailure_(user, 'เปลี่ยนรหัสผ่าน: รหัสผ่านปัจจุบันไม่ถูกต้อง (ครั้งที่ ' + state.count + ')');
    throw validationError_(state.lockedUntil ? lockedMessage_(state.lockedUntil) : 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }
  validateNewPassword_(next, user.Username);
  if (next === current) throw validationError_('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
  clearLoginFailures_(user.Username);
  dbUpdate_(SHEETS.USERS, user.UserId, {
    PasswordHash: hashPassword_(next),
    MustChangePassword: false,
    SessionVersion: (user.SessionVersion || 0) + 1,
  }, actorFromCtx_(ctx), { action: AUDIT_ACTIONS.PASSWORD_CHANGE, note: 'เปลี่ยนรหัสผ่านด้วยตนเอง' });
  CacheService.getScriptCache().remove(ctx.sessionKey);
  const fresh = dbGet_(SHEETS.USERS, user.UserId);
  return { token: createSession_(fresh, limits), user: userDto_(fresh), mustChangePassword: false };
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Users.js
// ============================================================================

/**
 * ============================================================================
 *  Users.gs — จัดการบัญชีผู้ใช้ (ผู้ดูแลระบบเท่านั้น ตรวจสิทธิ์ใน Api.gs)
 * ----------------------------------------------------------------------------
 *  กฎที่บังคับ
 *   - ไม่มีการลบผู้ใช้ ใช้ "ปิดการใช้งาน" แทน (ประวัติการทำรายการยังอ้างถึงผู้ใช้ได้)
 *   - ชื่อผู้ใช้เปลี่ยนไม่ได้ และห้ามซ้ำแม้ผู้ใช้เดิมถูกปิดการใช้งานแล้ว
 *   - เปลี่ยนบทบาทหรือปิดบัญชีของตนเองไม่ได้ (กันผู้ดูแลระบบล็อกตัวเองออก)
 *   - ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คนเสมอ
 *   - เปลี่ยนบทบาท ปิดบัญชี หรือรีเซ็ตรหัสผ่าน = การเข้าสู่ระบบเดิมของผู้ใช้นั้นหมดอายุทันที
 *   - รหัสผ่านชั่วคราวผู้ดูแลระบบเป็นผู้กำหนดเอง (ระบบไม่สุ่มและไม่แสดงรหัสผ่านบนหน้าเว็บ)
 *     และผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก
 * ============================================================================
 */

/** users.list */
function usersList_() {
  const roleOrder = { ADMIN: 1, DIRECTOR: 2, FINANCE: 3 };
  return dbAll_(SHEETS.USERS)
    .sort(function (a, b) {
      if (a.Status !== b.Status) return a.Status === STATUS.USER.ACTIVE ? -1 : 1;
      const r = (roleOrder[a.Role] || 9) - (roleOrder[b.Role] || 9);
      return r !== 0 ? r : (a.Username < b.Username ? -1 : 1);
    })
    .map(userDto_);
}

function activeAdminCount_() {
  return dbFind_(SHEETS.USERS, function (u) {
    return u.Role === ROLES.ADMIN && u.Status === STATUS.USER.ACTIVE;
  }).length;
}

/** users.create */
function usersCreate_(ctx, payload) {
  const mode = authMode_();
  const username = normalizeUsername_(payload.username);
  const fields = {
    Username: username,
    DisplayName: requireText_(payload.displayName, 'ชื่อ-นามสกุล', { max: 100 }),
    Position: requireText_(payload.position, 'ตำแหน่ง', { optional: true, max: 100 }),
    Email: normalizeEmail_(payload.email, mode === AUTH_MODES.GOOGLE),
    Role: requireEnum_(payload.role, ROLES, 'บทบาท'),
    Status: STATUS.USER.ACTIVE,
    SessionVersion: 1,
    MustChangePassword: false,
  };
  if (mode === AUTH_MODES.PASSWORD) {
    const password = validateNewPassword_(payload.tempPassword, username);
    fields.PasswordHash = hashPassword_(password);
    fields.MustChangePassword = true;
  }
  const rec = dbInsert_(SHEETS.USERS, fields, actorFromCtx_(ctx), { note: 'ผู้ดูแลระบบเพิ่มผู้ใช้' });
  return userDto_(rec);
}

/** users.update — ชื่อ ตำแหน่ง อีเมล บทบาท และสถานะ */
function usersUpdate_(ctx, payload) {
  const id = requireId_(payload.userId, 'USR', 'รหัสผู้ใช้');
  const user = dbGet_(SHEETS.USERS, id);
  if (!user) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ใช้ที่ต้องการแก้ไข');
  const mode = authMode_();
  const role = requireEnum_(payload.role, ROLES, 'บทบาท');
  const status = requireEnum_(payload.status, STATUS.USER, 'สถานะ');
  const changes = {
    DisplayName: requireText_(payload.displayName, 'ชื่อ-นามสกุล', { max: 100 }),
    Position: requireText_(payload.position, 'ตำแหน่ง', { optional: true, max: 100 }),
    Email: normalizeEmail_(payload.email, mode === AUTH_MODES.GOOGLE),
    Role: role,
    Status: status,
  };
  const accessChanged = role !== user.Role || status !== user.Status;
  if (id === ctx.userId && accessChanged) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'เปลี่ยนบทบาทหรือปิดการใช้งานบัญชีของตนเองไม่ได้ ให้ผู้ดูแลระบบคนอื่นดำเนินการ');
  }
  const losesAdmin = user.Role === ROLES.ADMIN && user.Status === STATUS.USER.ACTIVE &&
    (role !== ROLES.ADMIN || status !== STATUS.USER.ACTIVE);
  if (losesAdmin && activeAdminCount_() <= 1) {
    throw appError_(ERROR_CODES.CONFLICT, 'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
  }
  if (accessChanged || (mode === AUTH_MODES.GOOGLE && changes.Email !== user.Email)) {
    changes.SessionVersion = (user.SessionVersion || 0) + 1;
  }
  const res = dbUpdate_(SHEETS.USERS, id, changes, actorFromCtx_(ctx));
  return userDto_(res.after);
}

/** users.resetPassword — ผู้ดูแลระบบกำหนดรหัสผ่านชั่วคราวให้ผู้ใช้อื่น */
function usersResetPassword_(ctx, payload) {
  if (authMode_() !== AUTH_MODES.PASSWORD) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'ระบบนี้ใช้บัญชี Google จึงไม่มีรหัสผ่านของระบบ');
  }
  const id = requireId_(payload.userId, 'USR', 'รหัสผู้ใช้');
  if (id === ctx.userId) throw appError_(ERROR_CODES.FORBIDDEN, 'กรุณาเปลี่ยนรหัสผ่านของตนเองที่เมนู "เปลี่ยนรหัสผ่าน"');
  const user = dbGet_(SHEETS.USERS, id);
  if (!user) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ใช้');
  const password = validateNewPassword_(payload.tempPassword, user.Username);
  dbUpdate_(SHEETS.USERS, id, {
    PasswordHash: hashPassword_(password),
    MustChangePassword: true,
    SessionVersion: (user.SessionVersion || 0) + 1,
  }, actorFromCtx_(ctx), { action: AUDIT_ACTIONS.PASSWORD_CHANGE, note: 'ผู้ดูแลระบบรีเซ็ตรหัสผ่าน' });
  clearLoginFailures_(user.Username);
  return userDto_(dbGet_(SHEETS.USERS, id));
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Settings.js
// ============================================================================

/**
 * ============================================================================
 *  Settings.gs — ค่าตั้งค่าโรงเรียน (SchoolSettings) และปีการศึกษา (AcademicYears)
 * ----------------------------------------------------------------------------
 *  - อ่านค่าตั้งค่าแบบตรวจชนิดเสมอ ถ้าค่าในชีตผิดรูปแบบ (เช่น แก้ด้วยมือ) จะใช้ค่าเริ่มต้นแทน
 *  - แก้ไขค่าตั้งค่าได้เฉพาะผู้ดูแลระบบ (ตรวจสิทธิ์ใน Api.gs) และบันทึกค่าเดิม/ค่าใหม่ทุกครั้ง
 *  - ปีการศึกษาปัจจุบันมีได้ปีเดียว และตรงกับค่า CURRENT_ACADEMIC_YEAR เสมอ
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// อ่านค่าตั้งค่า
// ---------------------------------------------------------------------------

function settingDef_(key) {
  for (let i = 0; i < SETTINGS_DEFS.length; i++) {
    if (SETTINGS_DEFS[i].key === key) return SETTINGS_DEFS[i];
  }
  return null;
}

/** ค่าดิบ (ข้อความ) จากชีต หรือค่าเริ่มต้นถ้ายังไม่มี */
function getSettingRaw_(key) {
  const def = settingDef_(key);
  if (!def) throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ไม่รู้จักค่าตั้งค่า ' + key);
  const row = dbGet_(SHEETS.SCHOOL_SETTINGS, key);
  if (row) return row.Value;
  return def.key === 'CURRENT_ACADEMIC_YEAR' ? String(academicYearOfDate_(todayIso_())) : String(def.defaultValue || '');
}

/** ค่าที่แปลงตามชนิดแล้ว (int/year → ตัวเลข, bool → true/false, list → array, text → ข้อความ) */
function getSetting_(key) {
  const def = settingDef_(key);
  return parseSettingValue_(def, getSettingRaw_(key));
}

function parseSettingValue_(def, raw) {
  const text = raw === null || raw === undefined ? '' : String(raw).trim();
  switch (def.type) {
    case 'int': {
      const fallback = Number(def.defaultValue);
      const n = Number(text);
      if (text === '' || !Number.isInteger(n)) return fallback;
      if (def.min !== undefined && n < def.min) return def.min;
      if (def.max !== undefined && n > def.max) return def.max;
      return n;
    }
    case 'year': {
      const n = Number(text);
      return Number.isInteger(n) && n >= 2500 && n <= 2700 ? n : academicYearOfDate_(todayIso_());
    }
    case 'bool':
      if (text.toUpperCase() === 'TRUE') return true;
      if (text.toUpperCase() === 'FALSE') return false;
      return String(def.defaultValue).toUpperCase() === 'TRUE';
    case 'list':
      return text === '' ? [] : text.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
    default:
      return text;
  }
}

/** ข้อมูลโรงเรียนที่ใช้แสดงบนหน้าเว็บทุกหน้า */
function schoolInfo_() {
  return {
    name: getSetting_('SCHOOL_NAME') || APP.SCHOOL_NAME,
    province: getSetting_('SCHOOL_PROVINCE'),
    address: getSetting_('SCHOOL_ADDRESS'),
    affiliation: getSetting_('SCHOOL_AFFILIATION'),
    currentAcademicYear: getSetting_('CURRENT_ACADEMIC_YEAR'),
  };
}

// ---------------------------------------------------------------------------
// API: ค่าตั้งค่า
// ---------------------------------------------------------------------------

/** settings.get — ทุกบทบาทดูได้ (ไม่มีค่าลับในชีตนี้) */
function settingsGet_(ctx) {
  const editable = ctx.role === ROLES.ADMIN;
  const groups = SETTINGS_GROUPS.map(function (g) {
    return {
      key: g.key,
      label: g.label,
      items: SETTINGS_DEFS.filter(function (d) { return d.group === g.key; }).map(function (d) {
        return {
          key: d.key,
          label: d.label,
          description: d.description || '',
          type: d.type,
          min: d.min === undefined ? null : d.min,
          max: d.max === undefined ? null : d.max,
          readOnly: !!d.readOnly,
          value: getSetting_(d.key),
        };
      }),
    };
  });
  return { editable: editable, groups: groups };
}

/** settings.update — ผู้ดูแลระบบเท่านั้น รับ { values: { KEY: ค่า } } บันทึกเฉพาะค่าที่เปลี่ยน */
function settingsUpdate_(ctx, payload) {
  const values = payload.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw validationError_('ไม่มีค่าที่ต้องการบันทึก');
  const keys = Object.keys(values);
  if (!keys.length) throw validationError_('ไม่มีค่าที่ต้องการบันทึก');
  const actor = actorFromCtx_(ctx);
  const prepared = keys.map(function (key) {
    const def = settingDef_(key);
    if (!def) throw validationError_('ไม่รู้จักค่าตั้งค่า "' + key + '"');
    if (def.readOnly) throw validationError_('"' + def.label + '" แก้ไขที่หน้านี้ไม่ได้');
    return { key: key, value: normalizeSettingInput_(def, values[key]) };
  });
  const changed = [];
  prepared.forEach(function (item) {
    const existing = dbGet_(SHEETS.SCHOOL_SETTINGS, item.key);
    if (existing) {
      const res = dbUpdate_(SHEETS.SCHOOL_SETTINGS, item.key, { Value: item.value }, actor);
      if (res.changed.length) changed.push(item.key);
    } else {
      const def = settingDef_(item.key);
      dbInsert_(SHEETS.SCHOOL_SETTINGS, { SettingKey: item.key, Value: item.value, Description: settingDescription_(def) }, actor);
      changed.push(item.key);
    }
  });
  return { changed: changed, settings: settingsGet_(ctx) };
}

function settingDescription_(def) {
  return def.label + (def.description ? ' — ' + def.description : '');
}

/** ตรวจและแปลงค่าที่ผู้ใช้กรอก เป็นข้อความที่จะเก็บในชีต */
function normalizeSettingInput_(def, input) {
  switch (def.type) {
    case 'int': {
      const n = requireInt_(input, def.label, { min: def.min, max: def.max });
      return String(n);
    }
    case 'year':
      return String(requireInt_(input, def.label, { min: 2500, max: 2700 }));
    case 'bool':
      return requireBool_(input, def.label) ? 'TRUE' : 'FALSE';
    case 'list': {
      const parts = Array.isArray(input) ? input : String(input === null || input === undefined ? '' : input).split(',');
      const seen = Object.create(null);
      const items = [];
      parts.forEach(function (part) {
        const text = cleanText_(part);
        if (text === '') return;
        if (text.indexOf(',') !== -1) throw validationError_(def.label + ': แต่ละรายการต้องไม่มีเครื่องหมายจุลภาค');
        if (text.length > 50) throw validationError_(def.label + ': แต่ละรายการยาวได้ไม่เกิน 50 ตัวอักษร');
        if (seen[text]) throw validationError_(def.label + ': มีรายการ "' + text + '" ซ้ำกัน');
        seen[text] = true;
        items.push(text);
      });
      if (!items.length) throw validationError_('กรุณากรอก' + def.label + ' อย่างน้อย 1 รายการ');
      if (items.length > 30) throw validationError_(def.label + ' มีได้ไม่เกิน 30 รายการ');
      return items.join(',');
    }
    default:
      return requireText_(input, def.label, { optional: true, max: 300 });
  }
}

// ---------------------------------------------------------------------------
// API: ปีการศึกษา
// ---------------------------------------------------------------------------

function yearDto_(r) {
  return {
    academicYearId: r.AcademicYearId,
    year: r.Year,
    label: r.Label,
    startDate: r.StartDate,
    endDate: r.EndDate,
    isCurrent: r.IsCurrent,
    status: r.Status,
    statusLabel: STATUS_LABELS.ACADEMIC_YEAR[r.Status] || r.Status,
    updatedAt: r.UpdatedAt || r.CreatedAt,
  };
}

/** years.list — ทุกบทบาทดูได้ เรียงจากปีล่าสุด */
function yearsList_() {
  return dbAll_(SHEETS.ACADEMIC_YEARS)
    .sort(function (a, b) { return b.Year - a.Year; })
    .map(yearDto_);
}

function validateYearDates_(startDate, endDate) {
  if (startDate && endDate && startDate >= endDate) throw validationError_('วันสิ้นสุดปีการศึกษาต้องอยู่หลังวันเริ่มปีการศึกษา');
}

/** years.create — ผู้ดูแลระบบ */
function yearsCreate_(ctx, payload) {
  const year = requireInt_(payload.year, 'ปีการศึกษา (พ.ศ.)', { min: 2500, max: 2700 });
  const label = requireText_(payload.label, 'ชื่อที่แสดง', { optional: true, max: 60 }) || ('ปีการศึกษา ' + year);
  const startDate = requireIsoDate_(payload.startDate, 'วันเริ่มปีการศึกษา', { optional: true });
  const endDate = requireIsoDate_(payload.endDate, 'วันสิ้นสุดปีการศึกษา', { optional: true });
  validateYearDates_(startDate, endDate);
  const hasCurrent = dbFindOne_(SHEETS.ACADEMIC_YEARS, function (r) { return r.IsCurrent; }) !== null;
  const rec = dbInsert_(SHEETS.ACADEMIC_YEARS, {
    Year: year,
    Label: label,
    StartDate: startDate,
    EndDate: endDate,
    IsCurrent: !hasCurrent,
    Status: STATUS.ACADEMIC_YEAR.OPEN,
  }, actorFromCtx_(ctx));
  if (!hasCurrent) setCurrentYearSetting_(year, ctx);
  return yearDto_(rec);
}

/** years.update — ผู้ดูแลระบบ (เปลี่ยนชื่อ วันที่ และสถานะเปิด/ปิด) */
function yearsUpdate_(ctx, payload) {
  const id = requireId_(payload.academicYearId, 'AY', 'รหัสปีการศึกษา');
  const current = dbGet_(SHEETS.ACADEMIC_YEARS, id);
  if (!current) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบปีการศึกษาที่ต้องการแก้ไข');
  const label = requireText_(payload.label, 'ชื่อที่แสดง', { max: 60 });
  const startDate = requireIsoDate_(payload.startDate, 'วันเริ่มปีการศึกษา', { optional: true });
  const endDate = requireIsoDate_(payload.endDate, 'วันสิ้นสุดปีการศึกษา', { optional: true });
  validateYearDates_(startDate, endDate);
  const status = requireEnum_(payload.status, STATUS.ACADEMIC_YEAR, 'สถานะ');
  if (current.IsCurrent && status === STATUS.ACADEMIC_YEAR.CLOSED) {
    throw appError_(ERROR_CODES.CONFLICT, 'ปิดปีการศึกษาปัจจุบันไม่ได้ กรุณาตั้งปีการศึกษาอื่นเป็นปีปัจจุบันก่อน');
  }
  const res = dbUpdate_(SHEETS.ACADEMIC_YEARS, id, {
    Label: label,
    StartDate: startDate,
    EndDate: endDate,
    Status: status,
  }, actorFromCtx_(ctx));
  return yearDto_(res.after);
}

/** years.setCurrent — ผู้ดูแลระบบ ตั้งปีการศึกษาปัจจุบัน (ปีที่เปิดอยู่เท่านั้น) */
function yearsSetCurrent_(ctx, payload) {
  const id = requireId_(payload.academicYearId, 'AY', 'รหัสปีการศึกษา');
  const target = dbGet_(SHEETS.ACADEMIC_YEARS, id);
  if (!target) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบปีการศึกษาที่เลือก');
  if (target.Status !== STATUS.ACADEMIC_YEAR.OPEN) throw appError_(ERROR_CODES.CONFLICT, 'ปีการศึกษาที่ปิดแล้วตั้งเป็นปีปัจจุบันไม่ได้');
  const actor = actorFromCtx_(ctx);
  dbFind_(SHEETS.ACADEMIC_YEARS, function (r) { return r.IsCurrent && r.AcademicYearId !== id; }).forEach(function (r) {
    dbUpdate_(SHEETS.ACADEMIC_YEARS, r.AcademicYearId, { IsCurrent: false }, actor);
  });
  dbUpdate_(SHEETS.ACADEMIC_YEARS, id, { IsCurrent: true }, actor);
  setCurrentYearSetting_(target.Year, ctx);
  return yearsList_();
}

function setCurrentYearSetting_(year, ctx) {
  const actor = actorFromCtx_(ctx);
  if (dbGet_(SHEETS.SCHOOL_SETTINGS, 'CURRENT_ACADEMIC_YEAR')) {
    dbUpdate_(SHEETS.SCHOOL_SETTINGS, 'CURRENT_ACADEMIC_YEAR', { Value: String(year) }, actor);
  } else {
    const def = settingDef_('CURRENT_ACADEMIC_YEAR');
    dbInsert_(SHEETS.SCHOOL_SETTINGS, { SettingKey: def.key, Value: String(year), Description: settingDescription_(def) }, actor);
  }
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
  VERSION: '0.2.0',
  RELEASE: 'ระยะที่ 2: ระบบเข้าสู่ระบบและสิทธิ์',
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
  PASSWORD_HASH_ITERATIONS: 'PASSWORD_HASH_ITERATIONS', // จำนวนรอบแฮชรหัสผ่าน (ปรับตามความเร็วของเครื่อง Google ตอนติดตั้ง)
});

const AUTH_MODES = Object.freeze({ PASSWORD: 'PASSWORD', GOOGLE: 'GOOGLE' });

/** นโยบายรหัสผ่านและการแฮช */
const AUTH = Object.freeze({
  HASH_VERSION: 'v1',
  HASH_DEFAULT_ITERATIONS: 1000, // ใช้เมื่อยังไม่ได้วัดความเร็ว
  HASH_MIN_ITERATIONS: 300,
  HASH_MAX_ITERATIONS: 5000,
  HASH_TARGET_MS: 250,           // เวลาที่ต้องการใช้แฮชรหัสผ่าน 1 ครั้ง (ยิ่งนาน ยิ่งเดารหัสยาก)
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,
  USERNAME_PATTERN: '^[a-z][a-z0-9._-]{2,31}$', // a-z ขึ้นต้น ตามด้วย a-z 0-9 . _ - รวม 3–32 ตัว
  CACHE_MAX_SECONDS: 21600,     // ข้อจำกัดของ CacheService (6 ชั่วโมง)
});

const ROLES = Object.freeze({ ADMIN: 'ADMIN', FINANCE: 'FINANCE', DIRECTOR: 'DIRECTOR' });

const ROLE_LABELS = Object.freeze({
  ADMIN: 'ผู้ดูแลระบบ',
  FINANCE: 'เจ้าหน้าที่การเงิน',
  DIRECTOR: 'ผู้อำนวยการ',
});

/** ผู้กระทำที่ไม่ใช่ผู้ใช้ในชีต Users (บันทึกลง AuditLogs) */
/** ป้ายของผู้กระทำที่ไม่ใช่บทบาทผู้ใช้ (ใช้แสดงในประวัติการใช้งาน) */
const ACTOR_ROLE_LABELS = Object.freeze({
  OWNER: 'เจ้าของระบบ',
  SYSTEM: 'ระบบ',
  ANONYMOUS: 'ไม่ระบุตัวตน',
});

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
  ACCESS_DENIED: 'ACCESS_DENIED',
});

const AUDIT_ACTION_LABELS = Object.freeze({
  SETUP: 'ติดตั้ง/ตรวจโครงสร้าง',
  CREATE: 'เพิ่ม',
  UPDATE: 'แก้ไข',
  CANCEL: 'ยกเลิก',
  REQUEST: 'ยื่นคำขอ',
  APPROVE: 'อนุมัติ',
  REJECT: 'ไม่อนุมัติ',
  LOGIN: 'เข้าสู่ระบบ',
  LOGIN_FAILED: 'เข้าสู่ระบบไม่สำเร็จ',
  LOGOUT: 'ออกจากระบบ',
  PASSWORD_CHANGE: 'เปลี่ยน/รีเซ็ตรหัสผ่าน',
  IMPORT: 'นำเข้าข้อมูล',
  EXPORT: 'ส่งออกข้อมูล',
  BACKUP: 'สำรองข้อมูล',
  RESTORE: 'กู้คืนข้อมูล',
  INTEGRITY_CHECK: 'ตรวจความถูกต้อง',
  ACCESS_DENIED: 'ถูกปฏิเสธสิทธิ์',
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

/** กลุ่มของค่าตั้งค่า (ลำดับการแสดงในหน้าตั้งค่า) */
const SETTINGS_GROUPS = Object.freeze([
  { key: 'school', label: 'ข้อมูลโรงเรียน' },
  { key: 'signers', label: 'ผู้ลงนามในเอกสาร' },
  { key: 'academic', label: 'การเรียนการสอนและการรับเงิน' },
  { key: 'approval', label: 'รายการที่ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'receipt', label: 'ใบเสร็จรับเงิน' },
  { key: 'security', label: 'ความปลอดภัยในการเข้าสู่ระบบ' },
  { key: 'backup', label: 'การสำรองข้อมูล' },
]);

/**
 * ค่าตั้งค่าใน SchoolSettings (SetupDatabase เพิ่มเฉพาะรายการที่ยังไม่มี ไม่เขียนทับค่าเดิม)
 * type: text | int | bool | list (คั่นด้วยจุลภาค) | year (ปีการศึกษา พ.ศ.)
 * readOnly: แก้ในหน้าตั้งค่าไม่ได้ (เปลี่ยนผ่านหน้าที่เกี่ยวข้องแทน)
 */
const SETTINGS_DEFS = Object.freeze([
  { key: 'SCHOOL_NAME', group: 'school', label: 'ชื่อโรงเรียน', type: 'text', defaultValue: 'โรงเรียนวัดเสาหิน', description: 'ใช้ในหัวเอกสารและหน้าเข้าสู่ระบบ' },
  { key: 'SCHOOL_ADDRESS', group: 'school', label: 'ที่อยู่โรงเรียน', type: 'text', defaultValue: '', description: 'ใช้ในหัวเอกสาร' },
  { key: 'SCHOOL_PROVINCE', group: 'school', label: 'จังหวัด', type: 'text', defaultValue: 'เชียงใหม่', description: 'ใช้ในหัวเอกสาร' },
  { key: 'SCHOOL_AFFILIATION', group: 'school', label: 'หน่วยงานต้นสังกัด', type: 'text', defaultValue: '', description: 'กรอกตามจริง เช่น ชื่อ สพป. ที่โรงเรียนสังกัด' },
  { key: 'DIRECTOR_NAME', group: 'signers', label: 'ชื่อผู้อำนวยการ', type: 'text', defaultValue: '', description: 'ใช้ในช่องลงนามของรายงาน' },
  { key: 'DIRECTOR_POSITION', group: 'signers', label: 'ตำแหน่งผู้อำนวยการ', type: 'text', defaultValue: 'ผู้อำนวยการโรงเรียนวัดเสาหิน', description: 'ใช้ในช่องลงนามของรายงาน' },
  { key: 'FINANCE_OFFICER_NAME', group: 'signers', label: 'ชื่อเจ้าหน้าที่การเงิน', type: 'text', defaultValue: '', description: 'ใช้ในช่องลงนามของรายงาน' },
  { key: 'FINANCE_OFFICER_POSITION', group: 'signers', label: 'ตำแหน่งเจ้าหน้าที่การเงิน', type: 'text', defaultValue: 'เจ้าหน้าที่การเงิน', description: 'ใช้ในช่องลงนามของรายงาน' },
  { key: 'CURRENT_ACADEMIC_YEAR', group: 'academic', label: 'ปีการศึกษาปัจจุบัน', type: 'year', readOnly: true, defaultValue: null, description: 'เปลี่ยนได้ที่หน้า "ปีการศึกษา" (ค่าเริ่มต้นคำนวณจากวันที่ติดตั้ง)' },
  { key: 'GRADE_LEVELS', group: 'academic', label: 'ระดับชั้นที่เปิดสอน', type: 'list', defaultValue: 'อ.1,อ.2,อ.3,ป.1,ป.2,ป.3,ป.4,ป.5,ป.6', description: 'คั่นด้วยจุลภาค เรียงจากชั้นต่ำไปสูง (ใช้เลื่อนชั้น)' },
  { key: 'PAYMENT_CHANNELS', group: 'academic', label: 'ช่องทางการรับเงิน', type: 'list', defaultValue: 'เงินสด,โอนเงินเข้าบัญชีโรงเรียน', description: 'คั่นด้วยจุลภาค ทุกช่องทางต้องออกใบเสร็จจากเล่มจริง' },
  { key: 'APPROVAL_FEE_ADJUSTMENT', group: 'approval', label: 'ลดหย่อน/ยกเว้น', type: 'bool', defaultValue: 'TRUE', description: 'การลดหย่อน/ยกเว้น ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'APPROVAL_ASSESSMENT_CANCEL', group: 'approval', label: 'ยกเลิกรายการเรียกเก็บ', type: 'bool', defaultValue: 'TRUE', description: 'การยกเลิกรายการเรียกเก็บ ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'APPROVAL_RECEIPT_CANCEL', group: 'approval', label: 'ยกเลิกเลขที่ใบเสร็จ', type: 'bool', defaultValue: 'TRUE', description: 'การยกเลิกเลขที่ใบเสร็จ ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'APPROVAL_PAYMENT_CORRECTION', group: 'approval', label: 'แก้ไขรายการรับเงินที่บันทึกผิด', type: 'bool', defaultValue: 'TRUE', description: 'การแก้ไขรายการรับเงินที่บันทึกผิด ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'APPROVAL_BOOK_CLOSE', group: 'approval', label: 'ปิดเล่มใบเสร็จก่อนใช้ครบ', type: 'bool', defaultValue: 'TRUE', description: 'การปิดเล่มใบเสร็จก่อนใช้ครบเล่ม ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'RECEIPT_LOW_WARNING', group: 'receipt', label: 'เตือนเมื่อเลขที่ในเล่มเหลือไม่เกิน', type: 'int', defaultValue: '5', min: 0, max: 100, description: 'แจ้งเตือนให้เตรียมเล่มใหม่เมื่อเลขที่ในเล่มที่กำลังใช้เหลือน้อยกว่าหรือเท่ากับจำนวนนี้' },
  { key: 'RECEIPT_STRICT_SEQUENCE', group: 'receipt', label: 'ใช้เลขที่ใบเสร็จเรียงลำดับเคร่งครัด', type: 'bool', defaultValue: 'TRUE', description: 'TRUE = ต้องใช้เลขที่ถัดไปเท่านั้น ถ้าจะข้ามเลขต้องยกเลิกเลขนั้นพร้อมเหตุผลก่อน (ค่าที่แนะนำ) / FALSE = ใช้เลขอื่นในเล่มได้แต่ต้องยืนยันคำเตือนเลขขาดช่วง' },
  { key: 'SESSION_IDLE_MINUTES', group: 'security', label: 'ออกจากระบบอัตโนมัติเมื่อไม่ใช้งาน (นาที)', type: 'int', defaultValue: '30', min: 5, max: 240, description: 'มีผลกับการเข้าสู่ระบบครั้งถัดไป' },
  { key: 'SESSION_MAX_HOURS', group: 'security', label: 'อายุสูงสุดของการเข้าสู่ระบบ (ชั่วโมง)', type: 'int', defaultValue: '8', min: 1, max: 12, description: 'ครบเวลานี้ต้องเข้าสู่ระบบใหม่ แม้ยังใช้งานอยู่' },
  { key: 'LOGIN_MAX_ATTEMPTS', group: 'security', label: 'ใส่รหัสผ่านผิดได้ไม่เกิน (ครั้ง)', type: 'int', defaultValue: '5', min: 3, max: 20, description: 'เกินจำนวนนี้ ชื่อผู้ใช้นั้นจะถูกล็อกชั่วคราว' },
  { key: 'LOGIN_LOCK_MINUTES', group: 'security', label: 'ระยะเวลาล็อกชั่วคราว (นาที)', type: 'int', defaultValue: '15', min: 5, max: 360, description: 'ระยะเวลาที่ห้ามเข้าสู่ระบบหลังใส่รหัสผ่านผิดเกินกำหนด' },
  { key: 'BACKUP_RETENTION', group: 'backup', label: 'จำนวนไฟล์สำรองรายวันที่เก็บไว้', type: 'int', defaultValue: '60', min: 7, max: 365, description: 'ไม่นับไฟล์วันแรกของเดือนซึ่งเก็บถาวร (ใช้ในระยะที่ 7)' },
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

// ---------------------------------------------------------------------------
// API: ดูประวัติการใช้งาน (ผู้ดูแลระบบและผู้อำนวยการ ตรวจสิทธิ์ใน Api.gs)
// ---------------------------------------------------------------------------

const AUDIT_PAGE_SIZE = 50;

function auditEntityLabel_(entity) {
  if (entity && Object.prototype.hasOwnProperty.call(SCHEMA, entity)) return getSchema_(entity).label;
  const labels = { Database: 'ฐานข้อมูล', Api: 'คำสั่งของระบบ', Auth: 'การเข้าสู่ระบบ' };
  return labels[entity] || entity || '';
}

function auditParseJson_(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ข้อมูล: text };
  }
}

function auditItemDto_(r) {
  return {
    logId: r.LogId,
    timestamp: r.Timestamp,
    username: r.Username,
    role: r.Role,
    roleLabel: ROLE_LABELS[r.Role] || ACTOR_ROLE_LABELS[r.Role] || r.Role,
    action: r.Action,
    actionLabel: AUDIT_ACTION_LABELS[r.Action] || r.Action,
    entity: r.Entity,
    entityLabel: auditEntityLabel_(r.Entity),
    entityId: r.EntityId,
    note: r.Note,
    before: auditParseJson_(r.BeforeJson),
    after: auditParseJson_(r.AfterJson),
  };
}

/**
 * audit.list — ค้นหาประวัติ ล่าสุดก่อน
 * payload: { action, username, dateFrom, dateTo, q, page }
 */
function auditList_(ctx, payload) {
  const action = requireEnum_(payload.action, AUDIT_ACTIONS, 'การกระทำ', { optional: true });
  const username = requireText_(payload.username, 'ชื่อผู้ใช้', { optional: true, max: 64 }).toLowerCase();
  const dateFrom = requireIsoDate_(payload.dateFrom, 'วันที่เริ่มต้น', { optional: true });
  const dateTo = requireIsoDate_(payload.dateTo, 'วันที่สิ้นสุด', { optional: true });
  const q = requireText_(payload.q, 'คำค้น', { optional: true, max: 100 }).toLowerCase();
  const page = requireInt_(payload.page, 'หน้า', { optional: true, min: 1, max: 100000 }) || 1;

  const rows = dbAll_(SHEETS.AUDIT_LOGS).filter(function (r) {
    if (action && r.Action !== action) return false;
    if (username && String(r.Username).toLowerCase().indexOf(username) === -1) return false;
    const day = String(r.Timestamp).slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    if (q && (String(r.EntityId) + ' ' + String(r.Note) + ' ' + String(r.Entity)).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  rows.reverse();
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const current = Math.min(page, pages);
  const items = rows.slice((current - 1) * AUDIT_PAGE_SIZE, current * AUDIT_PAGE_SIZE).map(auditItemDto_);
  return {
    total: total,
    page: current,
    pages: pages,
    pageSize: AUDIT_PAGE_SIZE,
    items: items,
    actions: Object.keys(AUDIT_ACTIONS).map(function (k) { return { value: k, label: AUDIT_ACTION_LABELS[k] || k }; }),
  };
}

/** audit.verify — ตรวจลูกโซ่ hash และบันทึกผลการตรวจไว้ในประวัติด้วย */
function auditVerify_(ctx) {
  const result = auditVerifyChain_();
  auditAppend_([{
    action: AUDIT_ACTIONS.INTEGRITY_CHECK,
    entity: SHEETS.AUDIT_LOGS,
    entityId: '',
    note: result.ok
      ? 'ตรวจประวัติการใช้งาน ' + result.total + ' รายการ: ถูกต้อง'
      : 'ตรวจประวัติการใช้งาน ' + result.total + ' รายการ: พบปัญหา ' + result.problemCount + ' จุด',
  }], actorFromCtx_(ctx));
  return {
    ok: result.ok,
    total: result.total,
    problemCount: result.problemCount,
    problems: result.problems.slice(0, 50),
    lastHash: result.lastHash,
  };
}

// ============================================================================
// หน้าเว็บ: ไฟล์ HTML จาก src/ (AdminDialog.html, Index.html, JsCore.html, JsViews.html, Styles.html)
// ============================================================================

const BUNDLED_HTML_ = Object.freeze({
  "AdminDialog": "<!DOCTYPE html>\n<html lang=\"th\">\n<head>\n  <base target=\"_top\">\n  <meta charset=\"utf-8\">\n  <style>\n    * { box-sizing: border-box; }\n    body { margin: 0; font-family: 'Sarabun', 'Tahoma', 'Leelawadee UI', sans-serif; color: #1B2B3F; font-size: 14px; }\n    .intro { background: #EAF3FC; border-left: 4px solid #1F3A5F; padding: 10px 12px; border-radius: 6px; margin-bottom: 14px; line-height: 1.5; }\n    label { display: block; font-weight: 600; margin: 10px 0 4px; }\n    .hint { color: #5B6B80; font-weight: 400; font-size: 12px; }\n    input[type=text], input[type=email], input[type=password] { width: 100%; padding: 8px 10px; border: 1px solid #C9D3DF; border-radius: 6px; font: inherit; }\n    input:focus { outline: 2px solid #2E86DE; border-color: #2E86DE; }\n    .check { display: flex; gap: 8px; align-items: flex-start; margin-top: 12px; font-weight: 400; }\n    .check input { margin-top: 3px; }\n    .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }\n    button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid #1F3A5F; cursor: pointer; }\n    .primary { background: #1F3A5F; color: #fff; }\n    .secondary { background: #fff; color: #1F3A5F; }\n    button:disabled { opacity: .6; cursor: wait; }\n    .msg { margin-top: 12px; padding: 10px 12px; border-radius: 6px; display: none; line-height: 1.5; }\n    .msg.error { display: block; background: #FBEAE8; color: #8E2A1F; }\n    .msg.ok { display: block; background: #E6F5EE; color: #155F3D; }\n    .hidden { display: none; }\n  </style>\n</head>\n<body>\n  <div class=\"intro\">\n    ใช้สร้าง<strong>ผู้ดูแลระบบคนแรก</strong> หรือรีเซ็ตรหัสผ่านเมื่อผู้ดูแลระบบลืมรหัสผ่าน\n    (ใส่ชื่อผู้ใช้ของผู้ดูแลระบบเดิม) ผู้ดูแลระบบจะเพิ่มผู้ใช้คนอื่นได้ในเว็บแอป\n  </div>\n  <form id=\"form\" autocomplete=\"off\">\n    <label for=\"username\">ชื่อผู้ใช้ <span class=\"hint\">(ภาษาอังกฤษตัวพิมพ์เล็ก เช่น admin)</span></label>\n    <input id=\"username\" type=\"text\" maxlength=\"32\" required>\n\n    <label for=\"displayName\">ชื่อ-นามสกุล</label>\n    <input id=\"displayName\" type=\"text\" maxlength=\"100\" required>\n\n    <label for=\"email\">อีเมล <span class=\"hint\" id=\"emailHint\">(ไม่บังคับ)</span></label>\n    <input id=\"email\" type=\"email\" maxlength=\"254\">\n\n    <div id=\"passwordFields\">\n      <label for=\"password\">รหัสผ่าน <span class=\"hint\">(อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข)</span></label>\n      <input id=\"password\" type=\"password\" maxlength=\"128\" autocomplete=\"new-password\">\n      <label for=\"confirmPassword\">ยืนยันรหัสผ่าน</label>\n      <input id=\"confirmPassword\" type=\"password\" maxlength=\"128\" autocomplete=\"new-password\">\n      <label class=\"check\"><input id=\"mustChange\" type=\"checkbox\" checked>\n        <span>ให้เปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก (แนะนำ เมื่อสร้างให้ผู้อื่น)</span></label>\n    </div>\n\n    <div id=\"msg\" class=\"msg\" role=\"status\"></div>\n    <div class=\"actions\">\n      <button type=\"button\" class=\"secondary\" id=\"closeBtn\">ปิด</button>\n      <button type=\"submit\" class=\"primary\" id=\"saveBtn\">บันทึก</button>\n    </div>\n  </form>\n  <script>\n  /*@@BOOT@@*/\n  (function () {\n    var form = document.getElementById('form');\n    var msg = document.getElementById('msg');\n    var saveBtn = document.getElementById('saveBtn');\n    var googleMode = DIALOG.authMode === 'GOOGLE';\n    if (googleMode) {\n      document.getElementById('passwordFields').className = 'hidden';\n      document.getElementById('emailHint').textContent = '(บังคับ: บัญชี Google ของโรงเรียนที่ใช้เข้าสู่ระบบ)';\n      document.getElementById('email').required = true;\n    }\n    function show(text, ok) { msg.textContent = text; msg.className = 'msg ' + (ok ? 'ok' : 'error'); }\n    document.getElementById('closeBtn').addEventListener('click', function () { google.script.host.close(); });\n    form.addEventListener('submit', function (event) {\n      event.preventDefault();\n      saveBtn.disabled = true;\n      show('กำลังบันทึก…', true);\n      google.script.run\n        .withSuccessHandler(function (res) {\n          saveBtn.disabled = false;\n          show(res.message, res.ok);\n          if (res.ok) {\n            document.getElementById('password').value = '';\n            document.getElementById('confirmPassword').value = '';\n          }\n        })\n        .withFailureHandler(function () {\n          saveBtn.disabled = false;\n          show('เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่', false);\n        })\n        .ownerSetupAdmin({\n          username: document.getElementById('username').value,\n          displayName: document.getElementById('displayName').value,\n          email: document.getElementById('email').value,\n          password: googleMode ? '' : document.getElementById('password').value,\n          confirmPassword: googleMode ? '' : document.getElementById('confirmPassword').value,\n          mustChangePassword: document.getElementById('mustChange').checked,\n        });\n    });\n  })();\n  </script>\n</body>\n</html>\n",
  "Index": "<!DOCTYPE html>\n<html lang=\"th\">\n<head>\n  <base target=\"_top\">\n  <meta charset=\"utf-8\">\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n  <link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap\">\n  <!--@@STYLES@@-->\n</head>\n<body>\n  <div id=\"app\">\n    <div class=\"boot-screen\">\n      <div class=\"spinner\" aria-hidden=\"true\"></div>\n      <p>กำลังโหลดระบบ…</p>\n    </div>\n  </div>\n  <div id=\"busy-bar\" class=\"busy-bar\" aria-hidden=\"true\"></div>\n  <div id=\"toast-root\" class=\"toast-root\" role=\"status\" aria-live=\"polite\"></div>\n  <div id=\"modal-root\"></div>\n  <script>\n  /*@@BOOT@@*/\n  /*@@SHARED@@*/\n  </script>\n  <!--@@CORE@@-->\n  <!--@@VIEWS@@-->\n</body>\n</html>\n",
  "JsCore": "<script>\n/* ==========================================================================\n   JsCore — แกนของหน้าเว็บ: เรียก API, สร้างหน้าจอ, หน้าต่าง, ฟอร์ม, ตาราง, เมนู\n   กฎสำคัญ: แสดงข้อมูลผ่าน textContent เสมอ (ฟังก์ชัน h) ไม่ใช้ innerHTML กับข้อมูล\n   หน้าเว็บนี้ไม่ใช่ที่ตรวจสิทธิ์ การซ่อนเมนูเป็นเพียงความสะดวก Server ตรวจสิทธิ์ทุกคำขอ\n   ========================================================================== */\n(function () {\n  'use strict';\n\n  var App = window.App = {};\n  App.state = { token: null, me: null, route: null, renderSeq: 0 };\n  App.ROLE_LABELS = { ADMIN: 'ผู้ดูแลระบบ', FINANCE: 'เจ้าหน้าที่การเงิน', DIRECTOR: 'ผู้อำนวยการ' };\n  App.routes = {};\n  App.routeOrder = [];\n  App.MENU_GROUPS = [];\n\n  // ---------------------------------------------------------------------------\n  // สร้าง element (ข้อความทุกชิ้นใส่ผ่าน textContent)\n  // ---------------------------------------------------------------------------\n  function append(el, child) {\n    if (child === null || child === undefined || child === false) return;\n    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }\n    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));\n  }\n\n  function h(tag, props) {\n    var el = document.createElement(tag);\n    if (props) {\n      Object.keys(props).forEach(function (key) {\n        var v = props[key];\n        if (v === null || v === undefined || v === false) return;\n        if (key === 'class') el.className = v;\n        else if (key === 'text') el.textContent = v;\n        else if (key === 'style') Object.assign(el.style, v);\n        else if (key === 'value') el.value = v;\n        else if (key === 'checked') el.checked = !!v;\n        else if (key === 'disabled') el.disabled = !!v;\n        else if (key.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(key.slice(2).toLowerCase(), v);\n        else if (v === true) el.setAttribute(key, '');\n        else el.setAttribute(key, String(v));\n      });\n    }\n    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);\n    return el;\n  }\n\n  function clear(el) {\n    while (el.firstChild) el.removeChild(el.firstChild);\n    return el;\n  }\n\n  App.h = h;\n  App.append = append;\n  App.clear = clear;\n\n  var ICONS = {\n    school: 'M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6M12 5V2l3 1.5-3 1.5',\n    home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',\n    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',\n    settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',\n    calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',\n    history: 'M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8M12 7v5l4 2',\n    menu: 'M3 6h18M3 12h18M3 18h18',\n    x: 'M18 6L6 18M6 6l12 12',\n    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',\n    key: 'M15 7a2 2 0 0 1 2 2M21 9a6 6 0 0 1-7.74 5.74L11 17H9v2H7v2H4a1 1 0 0 1-1-1v-2.59a1 1 0 0 1 .29-.7l6-6A6 6 0 1 1 21 9z',\n    plus: 'M12 5v14M5 12h14',\n    edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',\n    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',\n    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',\n    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',\n  };\n\n  App.icon = function (name) {\n    var ns = 'http://www.w3.org/2000/svg';\n    var svg = document.createElementNS(ns, 'svg');\n    svg.setAttribute('viewBox', '0 0 24 24');\n    svg.setAttribute('fill', 'none');\n    svg.setAttribute('stroke', 'currentColor');\n    svg.setAttribute('stroke-width', '2');\n    svg.setAttribute('stroke-linecap', 'round');\n    svg.setAttribute('stroke-linejoin', 'round');\n    svg.setAttribute('aria-hidden', 'true');\n    var path = document.createElementNS(ns, 'path');\n    path.setAttribute('d', ICONS[name] || '');\n    svg.appendChild(path);\n    return svg;\n  };\n\n  // ---------------------------------------------------------------------------\n  // จัดรูปแบบ\n  // ---------------------------------------------------------------------------\n  App.fmt = {\n    date: function (v) { return v ? formatThaiDate_(v, 'short') : '–'; },\n    dateLong: function (v) { return v ? formatThaiDate_(v) : '–'; },\n    datetime: function (v) { return v ? formatThaiDateTime_(v, 'short') : '–'; },\n    money: function (satang) { return formatSatang_(satang, true); },\n  };\n\n  App.badge = function (text, kind) {\n    return h('span', { class: 'badge' + (kind ? ' badge-' + kind : ''), text: text });\n  };\n\n  App.roleBadge = function (role) {\n    return App.badge(App.ROLE_LABELS[role] || role, role);\n  };\n\n  // ---------------------------------------------------------------------------\n  // เก็บ token เฉพาะในแท็บนี้ (ปิดแท็บแล้วหาย)\n  // ---------------------------------------------------------------------------\n  var TOKEN_KEY = 'wsh-fee-session';\n  App.session = {\n    get: function () {\n      if (App.state.token) return App.state.token;\n      try { App.state.token = window.sessionStorage.getItem(TOKEN_KEY); } catch (e) { App.state.token = null; }\n      return App.state.token;\n    },\n    set: function (token) {\n      App.state.token = token;\n      try { window.sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* ใช้ในหน่วยความจำแทน */ }\n    },\n    clear: function () {\n      App.state.token = null;\n      App.state.me = null;\n      try { window.sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ไม่มี storage */ }\n    },\n  };\n\n  // ---------------------------------------------------------------------------\n  // เรียก API (ทางเข้าเดียว: google.script.run.api)\n  // ---------------------------------------------------------------------------\n  var busy = 0;\n  function setBusy(delta) {\n    busy = Math.max(0, busy + delta);\n    document.body.classList.toggle('is-busy', busy > 0);\n  }\n\n  App.api = function (action, payload) {\n    setBusy(1);\n    return new Promise(function (resolve, reject) {\n      google.script.run\n        .withSuccessHandler(function (res) {\n          setBusy(-1);\n          if (res && res.ok) resolve(res.data);\n          else reject(res && res.error ? res.error : { code: 'INTERNAL', message: 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่' });\n        })\n        .withFailureHandler(function () {\n          setBusy(-1);\n          reject({ code: 'NETWORK', message: 'เชื่อมต่อระบบไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' });\n        })\n        .api({ action: action, token: App.session.get(), payload: payload || {} });\n    }).catch(function (err) {\n      if (App.state.me && err.code === 'UNAUTHENTICATED') {\n        err.handled = true;\n        App.session.clear();\n        App.showLogin(err.message);\n      } else if (App.state.me && err.reason === 'PASSWORD_CHANGE_REQUIRED') {\n        err.handled = true;\n        App.showForcedPasswordChange();\n      }\n      throw err;\n    });\n  };\n\n  /** แสดงข้อผิดพลาด (ข้ามถ้าระบบจัดการแล้ว เช่น หมดเวลาและพากลับหน้าเข้าสู่ระบบ) */\n  App.fail = function (err) {\n    if (err && err.handled) return;\n    App.toast((err && err.message) || 'เกิดข้อผิดพลาด กรุณาลองใหม่', 'error');\n  };\n\n  // ---------------------------------------------------------------------------\n  // แจ้งเตือน / หน้าต่าง / ยืนยัน\n  // ---------------------------------------------------------------------------\n  App.toast = function (message, type) {\n    var root = document.getElementById('toast-root');\n    var el = h('div', { class: 'toast' + (type ? ' toast-' + type : ''), text: message });\n    root.appendChild(el);\n    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, type === 'error' ? 6500 : 4000);\n  };\n\n  App.modal = function (opts) {\n    var root = document.getElementById('modal-root');\n    var previousFocus = document.activeElement;\n    var closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'ปิด' }, App.icon('x'));\n    var body = h('div', { class: 'modal-body' });\n    append(body, opts.body);\n    var foot = h('div', { class: 'modal-foot' });\n    var dialog = h('div', { class: 'modal' + (opts.size === 'lg' ? ' modal-lg' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },\n      h('div', { class: 'modal-head' }, h('h2', { text: opts.title }), closeBtn), body, foot);\n    var overlay = h('div', { class: 'modal-overlay' }, dialog);\n    var closed = false;\n    function close() {\n      if (closed) return;\n      closed = true;\n      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);\n      document.removeEventListener('keydown', onKey);\n      if (previousFocus && previousFocus.focus) { try { previousFocus.focus(); } catch (e) { /* ไม่มีแล้ว */ } }\n      if (opts.onClose) opts.onClose();\n    }\n    function onKey(e) { if (e.key === 'Escape') close(); }\n    closeBtn.addEventListener('click', close);\n    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });\n    var buttons = (opts.actions || []).map(function (a) {\n      var btn = h('button', { type: 'button', class: 'btn' + (a.kind ? ' btn-' + a.kind : ''), text: a.label });\n      btn.addEventListener('click', function () { if (a.onClick) a.onClick(btn, close); else close(); });\n      foot.appendChild(btn);\n      return btn;\n    });\n    if (!buttons.length) foot.classList.add('hidden');\n    document.addEventListener('keydown', onKey);\n    root.appendChild(overlay);\n    var first = dialog.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');\n    if (first) first.focus(); else closeBtn.focus();\n    return { close: close, body: body, foot: foot, dialog: dialog, buttons: buttons };\n  };\n\n  App.confirm = function (message, opts) {\n    var o = opts || {};\n    return new Promise(function (resolve) {\n      var answered = false;\n      App.modal({\n        title: o.title || 'ยืนยันการทำรายการ',\n        body: h('p', { text: message }),\n        actions: [\n          { label: 'ยกเลิก', kind: 'secondary', onClick: function (b, close) { answered = true; close(); resolve(false); } },\n          { label: o.confirmLabel || 'ยืนยัน', kind: o.danger ? 'danger' : '', onClick: function (b, close) { answered = true; close(); resolve(true); } },\n        ],\n        onClose: function () { if (!answered) resolve(false); },\n      });\n    });\n  };\n\n  // ---------------------------------------------------------------------------\n  // ฟอร์ม\n  // ---------------------------------------------------------------------------\n  var fieldSeq = 0;\n\n  /** ช่องกรอกข้อมูล คืนค่า { wrap, input, get } */\n  App.field = function (o) {\n    var id = 'f' + (++fieldSeq);\n    var input;\n    if (o.type === 'checkbox') {\n      input = h('input', { id: id, type: 'checkbox', checked: !!o.value, disabled: o.disabled });\n      var wrapC = h('div', { class: 'field' + (o.span2 ? ' span-2' : '') },\n        h('label', { class: 'switch', for: id }, input, h('span', { text: o.label })),\n        o.help ? h('div', { class: 'help', text: o.help }) : null);\n      return { wrap: wrapC, input: input, get: function () { return input.checked; } };\n    }\n    if (o.type === 'select') {\n      input = h('select', { id: id, class: 'input', disabled: o.disabled });\n      (o.options || []).forEach(function (opt) { input.appendChild(h('option', { value: opt.value, text: opt.label })); });\n      if (o.value !== undefined && o.value !== null) input.value = String(o.value);\n    } else if (o.type === 'textarea') {\n      input = h('textarea', { id: id, class: 'input', rows: o.rows || 3, maxlength: o.maxlength, disabled: o.disabled });\n      input.value = o.value === undefined || o.value === null ? '' : String(o.value);\n    } else {\n      input = h('input', {\n        id: id, class: 'input', type: o.type || 'text', maxlength: o.maxlength, min: o.min, max: o.max,\n        placeholder: o.placeholder, autocomplete: o.autocomplete || 'off', inputmode: o.inputmode, disabled: o.disabled,\n        spellcheck: o.type === 'password' || o.mono ? 'false' : null, autocapitalize: o.autocapitalize,\n      });\n      if (o.value !== undefined && o.value !== null) input.value = String(o.value);\n    }\n    var label = h('label', { for: id }, o.label, o.required ? h('span', { class: 'req', text: ' *' }) : null);\n    var preview = null;\n    if (o.type === 'date') {\n      preview = h('div', { class: 'preview' });\n      var update = function () { preview.textContent = input.value ? '= ' + formatThaiDate_(input.value) : ''; };\n      input.addEventListener('input', update);\n      input.addEventListener('change', update);\n      update();\n    }\n    var wrap = h('div', { class: 'field' + (o.span2 ? ' span-2' : '') }, label, input, preview,\n      o.help ? h('div', { class: 'help', text: o.help }) : null);\n    return { wrap: wrap, input: input, get: function () { return input.value; } };\n  };\n\n  /** ช่องรหัสผ่าน พร้อมปุ่มแสดง/ซ่อน */\n  App.passwordField = function (o) {\n    var f = App.field(Object.assign({}, o, { type: 'password' }));\n    var toggle = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'แสดง', 'aria-label': 'แสดงหรือซ่อนรหัสผ่าน' });\n    toggle.addEventListener('click', function () {\n      var show = f.input.type === 'password';\n      f.input.type = show ? 'text' : 'password';\n      toggle.textContent = show ? 'ซ่อน' : 'แสดง';\n    });\n    var group = h('div', { class: 'input-group' });\n    f.input.parentNode.replaceChild(group, f.input);\n    group.appendChild(f.input);\n    group.appendChild(toggle);\n    return f;\n  };\n\n  /**\n   * หน้าต่างฟอร์ม\n   * opts: { title, intro, fields: [{ key, label, type, ... }], submitLabel, onSubmit(values) → Promise, onDone(result) }\n   */\n  App.formModal = function (opts) {\n    var errorBox = h('div', { class: 'alert alert-error hidden', role: 'alert' });\n    var form = h('form', { class: 'form-grid', novalidate: true });\n    var built = opts.fields.map(function (f) {\n      var b = f.type === 'password' ? App.passwordField(f) : App.field(f);\n      b.key = f.key;\n      form.appendChild(b.wrap);\n      return b;\n    });\n    form.appendChild(h('button', { type: 'submit', class: 'hidden', tabindex: '-1', 'aria-hidden': 'true' }));\n    var intro = opts.intro ? (opts.intro instanceof Node ? opts.intro : h('div', { class: 'alert alert-info', text: opts.intro })) : null;\n    var submitting = false;\n    var modal;\n    function submit() {\n      if (submitting) return;\n      var values = {};\n      built.forEach(function (b) { values[b.key] = b.get(); });\n      var btn = modal.buttons[modal.buttons.length - 1];\n      var label = btn.textContent;\n      submitting = true;\n      btn.disabled = true;\n      btn.textContent = 'กำลังบันทึก…';\n      errorBox.classList.add('hidden');\n      Promise.resolve()\n        .then(function () { return opts.onSubmit(values); })\n        .then(function (result) {\n          modal.close();\n          if (opts.onDone) opts.onDone(result);\n        })\n        .catch(function (err) {\n          if (err && err.handled) { modal.close(); return; }\n          errorBox.textContent = (err && err.message) || 'บันทึกไม่สำเร็จ กรุณาลองใหม่';\n          errorBox.classList.remove('hidden');\n          errorBox.scrollIntoView({ block: 'nearest' });\n        })\n        .then(function () {\n          submitting = false;\n          btn.disabled = false;\n          btn.textContent = label;\n        });\n    }\n    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });\n    modal = App.modal({\n      title: opts.title,\n      size: opts.size,\n      body: [intro, errorBox, form],\n      actions: [\n        { label: 'ยกเลิก', kind: 'secondary' },\n        { label: opts.submitLabel || 'บันทึก', onClick: function () { submit(); } },\n      ],\n    });\n    return modal;\n  };\n\n  // ---------------------------------------------------------------------------\n  // ตาราง (บนมือถือแสดงเป็นการ์ด ใช้ data-label เป็นหัวข้อ)\n  // ---------------------------------------------------------------------------\n  App.table = function (opts) {\n    var wrap = h('div', { class: 'table-wrap' });\n    if (!opts.rows.length) {\n      wrap.appendChild(h('div', { class: 'empty', text: opts.empty || 'ไม่มีข้อมูล' }));\n      return wrap;\n    }\n    var thead = h('thead', null, h('tr', null, opts.columns.map(function (c) { return h('th', { class: c.className, text: c.label }); })));\n    var tbody = h('tbody');\n    opts.rows.forEach(function (row) {\n      var tr = h('tr', { class: opts.onRowClick ? 'clickable' : null });\n      if (opts.onRowClick) {\n        tr.tabIndex = 0;\n        tr.addEventListener('click', function (e) { if (!e.target.closest('button')) opts.onRowClick(row); });\n        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') opts.onRowClick(row); });\n      }\n      opts.columns.forEach(function (c) {\n        var content = c.render ? c.render(row) : row[c.key];\n        var td = h('td', { class: c.className, 'data-label': c.label });\n        append(td, content === null || content === undefined || content === '' ? '–' : content);\n        tr.appendChild(td);\n      });\n      tbody.appendChild(tr);\n    });\n    wrap.appendChild(h('table', { class: 'data-table' }, thead, tbody));\n    return wrap;\n  };\n\n  // ---------------------------------------------------------------------------\n  // เมนูและการเปลี่ยนหน้า\n  // ---------------------------------------------------------------------------\n  App.defineRoute = function (name, def) {\n    App.routes[name] = def;\n    App.routeOrder.push(name);\n  };\n\n  App.canAccess = function (name) {\n    var route = App.routes[name];\n    return !!(route && App.state.me && route.roles.indexOf(App.state.me.user.role) !== -1);\n  };\n\n  function closeNav() {\n    var shell = document.getElementById('shell');\n    if (shell) shell.classList.remove('nav-open');\n  }\n\n  App.renderShell = function () {\n    var me = App.state.me;\n    var app = clear(document.getElementById('app'));\n    var nav = h('nav', { class: 'nav', 'aria-label': 'เมนูหลัก' });\n    App.MENU_GROUPS.forEach(function (group) {\n      var items = App.routeOrder.filter(function (name) {\n        var r = App.routes[name];\n        return r.menu && r.menu.group === group.key && App.canAccess(name);\n      });\n      if (!items.length) return;\n      nav.appendChild(h('div', { class: 'nav-group' },\n        h('div', { class: 'nav-group-label', text: group.label }),\n        items.map(function (name) {\n          var r = App.routes[name];\n          var btn = h('button', { type: 'button', class: 'nav-item', 'data-route': name }, App.icon(r.menu.icon), h('span', { text: r.menu.label }));\n          btn.addEventListener('click', function () { App.go(name); });\n          return btn;\n        })));\n    });\n\n    var userActions = h('div', { class: 'userbox-actions' });\n    if (me.authMode === 'PASSWORD') {\n      var pwBtn = h('button', { type: 'button', class: 'btn btn-sm' }, App.icon('key'), 'เปลี่ยนรหัสผ่าน');\n      pwBtn.addEventListener('click', function () { App.openChangePassword(); });\n      userActions.appendChild(pwBtn);\n    }\n    var outBtn = h('button', { type: 'button', class: 'btn btn-sm' }, App.icon('logout'), 'ออกจากระบบ');\n    outBtn.addEventListener('click', function () { App.logout(); });\n    userActions.appendChild(outBtn);\n\n    var sidebar = h('aside', { class: 'sidebar', id: 'sidebar' },\n      h('div', { class: 'brand' },\n        h('div', { class: 'brand-logo' }, App.icon('school')),\n        h('div', null, h('div', { class: 'brand-name', text: me.school.name }), h('div', { class: 'brand-sub', text: 'ระบบเงินบำรุงการศึกษา' }))),\n      nav,\n      h('div', { class: 'userbox' },\n        h('div', { class: 'userbox-name', text: me.user.displayName }),\n        h('div', { class: 'userbox-role', text: me.user.roleLabel + ' · ' + me.user.username }),\n        userActions));\n\n    var toggle = h('button', { type: 'button', class: 'icon-btn menu-toggle', 'aria-label': 'เปิดเมนู', 'aria-controls': 'sidebar' }, App.icon('menu'));\n    toggle.addEventListener('click', function () { document.getElementById('shell').classList.toggle('nav-open'); });\n    var topbar = h('header', { class: 'topbar' },\n      toggle,\n      h('div', { class: 'topbar-title', id: 'page-title' }),\n      h('span', { class: 'year-chip', title: 'ปีการศึกษาปัจจุบัน' }, App.icon('calendar'), h('span', { class: 'chip-label', text: 'ปีการศึกษา ' }), String(me.school.currentAcademicYear)));\n\n    var backdrop = h('div', { class: 'backdrop' });\n    backdrop.addEventListener('click', closeNav);\n    app.appendChild(h('div', { class: 'shell', id: 'shell' }, sidebar, backdrop,\n      h('div', { class: 'main' }, topbar, h('main', { class: 'content', id: 'content', tabindex: '-1' }))));\n  };\n\n  App.go = function (name, params) {\n    if (!App.routes[name]) name = 'home';\n    if (!document.getElementById('shell')) App.renderShell();\n    App.state.route = name;\n    var route = App.routes[name];\n    document.getElementById('page-title').textContent = route.title;\n    document.title = route.title + ' · ' + BOOT.appName;\n    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (el) {\n      el.classList.toggle('active', el.getAttribute('data-route') === name);\n    });\n    closeNav();\n    var content = clear(document.getElementById('content'));\n    if (!App.canAccess(name)) {\n      content.appendChild(h('div', { class: 'card card-body' }, h('h2', { text: 'ไม่มีสิทธิ์เข้าถึงหน้านี้' }),\n        h('p', { class: 'muted', text: 'หากต้องการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' })));\n      return;\n    }\n    var seq = ++App.state.renderSeq;\n    content.appendChild(h('div', { class: 'empty', text: 'กำลังโหลดข้อมูล…' }));\n    Promise.resolve()\n      .then(function () { return route.render(params || {}); })\n      .then(function (node) {\n        if (seq !== App.state.renderSeq) return;\n        clear(content);\n        append(content, node);\n        window.scrollTo(0, 0);\n      })\n      .catch(function (err) {\n        if (seq !== App.state.renderSeq || (err && err.handled)) return;\n        clear(content).appendChild(h('div', { class: 'alert alert-error', role: 'alert', text: (err && err.message) || 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่' }));\n      });\n  };\n\n  App.refresh = function () { App.go(App.state.route); };\n\n  /** โหลดข้อมูลผู้ใช้ปัจจุบันแล้วเปิดหน้าหลัก (หรือหน้าบังคับเปลี่ยนรหัสผ่าน) */\n  App.loadMe = function (route) {\n    return App.api('auth.me').then(function (me) {\n      App.state.me = me;\n      if (me.mustChangePassword) {\n        App.showForcedPasswordChange();\n        return;\n      }\n      App.renderShell();\n      App.go(route || 'home');\n    });\n  };\n\n  /** โหลดข้อมูลผู้ใช้/โรงเรียนใหม่ (เช่น หลังเปลี่ยนชื่อโรงเรียนหรือปีการศึกษา) แล้วอยู่หน้าเดิม */\n  App.reloadMe = function () {\n    return App.api('auth.me').then(function (me) {\n      App.state.me = me;\n      App.renderShell();\n      App.go(App.state.route || 'home');\n    });\n  };\n\n  App.logout = function () {\n    App.api('auth.logout').catch(function () { /* ออกจากระบบฝั่งหน้าเว็บต่อไป */ }).then(function () {\n      App.session.clear();\n      App.showLogin('ออกจากระบบเรียบร้อยแล้ว', 'info');\n    });\n  };\n\n  App.start = function () {\n    if (!window.google || !google.script || !google.script.run) {\n      clear(document.getElementById('app')).appendChild(h('div', { class: 'boot-screen' },\n        h('p', { text: 'กรุณาเปิดระบบผ่านลิงก์เว็บแอปของโรงเรียน' })));\n      return;\n    }\n    if (App.session.get()) {\n      App.loadMe().catch(function () {\n        App.session.clear();\n        App.showLogin();\n      });\n    } else {\n      App.showLogin();\n    }\n  };\n})();\n</script>\n",
  "JsViews": "<script>\n/* ==========================================================================\n   JsViews — หน้าจอของระบบ (ระยะที่ 2)\n   เข้าสู่ระบบ / เปลี่ยนรหัสผ่าน / หน้าหลัก / ผู้ใช้งาน / ตั้งค่าโรงเรียน / ปีการศึกษา / ประวัติการใช้งาน\n   ========================================================================== */\n(function () {\n  'use strict';\n  var h = App.h;\n  var clear = App.clear;\n  var icon = App.icon;\n  var ALL = ['ADMIN', 'FINANCE', 'DIRECTOR'];\n\n  App.MENU_GROUPS = [\n    { key: 'main', label: 'ทั่วไป' },\n    { key: 'manage', label: 'การจัดการระบบ' },\n    { key: 'info', label: 'ข้อมูลโรงเรียน' },\n  ];\n\n  var PASSWORD_RULES = [\n    'อย่างน้อย 8 ตัวอักษร',\n    'มีทั้งตัวอักษรและตัวเลข',\n    'ไม่มีชื่อผู้ใช้อยู่ในรหัสผ่าน',\n  ];\n\n  function rulesList(extra) {\n    return h('ul', { class: 'rules' }, PASSWORD_RULES.concat(extra || []).map(function (r) { return h('li', { text: r }); }));\n  }\n\n  function pageHead(title, description, actions) {\n    return h('div', { class: 'page-head' },\n      h('div', null, h('h1', { text: title }), description ? h('p', { text: description }) : null),\n      actions ? h('div', { class: 'toolbar', style: { marginBottom: '0' } }, actions) : null);\n  }\n\n  function button(label, kind, onClick, iconName) {\n    var btn = h('button', { type: 'button', class: 'btn' + (kind ? ' btn-' + kind : '') }, iconName ? icon(iconName) : null, label);\n    btn.addEventListener('click', onClick);\n    return btn;\n  }\n\n  // ---------------------------------------------------------------------------\n  // หน้าเข้าสู่ระบบ\n  // ---------------------------------------------------------------------------\n  function authPage(title, subtitle, bodyNodes) {\n    var app = clear(document.getElementById('app'));\n    app.appendChild(h('div', { class: 'login-page' },\n      h('div', { class: 'login-card' },\n        h('div', { class: 'login-head' },\n          h('div', { class: 'login-logo' }, icon('school')),\n          h('div', { class: 'login-school', text: title }),\n          h('div', { class: 'login-app', text: subtitle })),\n        h('div', { class: 'login-body' }, bodyNodes),\n        h('div', { class: 'login-foot', text: 'จังหวัด' + BOOT.province + ' · เวอร์ชัน ' + BOOT.version }))));\n  }\n\n  App.showLogin = function (message, kind) {\n    App.state.me = null;\n    var notice = h('div', { class: 'alert ' + (kind === 'info' ? 'alert-info' : 'alert-error') + (message ? '' : ' hidden'), role: 'alert', text: message || '' });\n    function showError(text) {\n      notice.className = 'alert alert-error';\n      notice.textContent = text;\n    }\n    function onLoggedIn(result) {\n      App.session.set(result.token);\n      return App.loadMe();\n    }\n\n    if (BOOT.authMode === 'GOOGLE') {\n      var googleBtn = h('button', { type: 'button', class: 'btn btn-block', text: 'เข้าสู่ระบบด้วยบัญชี Google ของโรงเรียน' });\n      googleBtn.addEventListener('click', function () {\n        googleBtn.disabled = true;\n        App.api('auth.loginGoogle').then(onLoggedIn).catch(function (err) {\n          googleBtn.disabled = false;\n          showError(err.message);\n        });\n      });\n      authPage(BOOT.schoolName, BOOT.appName, [notice,\n        h('p', { class: 'muted small', text: 'ระบบจะใช้บัญชี Google ที่เข้าสู่ระบบอยู่ในเบราว์เซอร์นี้' }), googleBtn]);\n      return;\n    }\n\n    var username = App.field({ label: 'ชื่อผู้ใช้', autocomplete: 'username', autocapitalize: 'none', mono: true });\n    var password = App.passwordField({ label: 'รหัสผ่าน', autocomplete: 'current-password' });\n    var submit = h('button', { type: 'submit', class: 'btn btn-block', text: 'เข้าสู่ระบบ' });\n    var form = h('form', { class: 'stack', novalidate: true }, notice, username.wrap, password.wrap, submit);\n    form.addEventListener('submit', function (e) {\n      e.preventDefault();\n      if (submit.disabled) return;\n      submit.disabled = true;\n      submit.textContent = 'กำลังตรวจสอบ…';\n      notice.classList.add('hidden');\n      App.api('auth.login', { username: username.input.value, password: password.input.value })\n        .then(onLoggedIn)\n        .catch(function (err) {\n          password.input.value = '';\n          showError(err.message);\n          password.input.focus();\n        })\n        .then(function () {\n          submit.disabled = false;\n          submit.textContent = 'เข้าสู่ระบบ';\n        });\n    });\n    authPage(BOOT.schoolName, BOOT.appName, [form,\n      h('p', { class: 'muted small', text: 'ลืมรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบของโรงเรียน' })]);\n    username.input.focus();\n  };\n\n  // ---------------------------------------------------------------------------\n  // เปลี่ยนรหัสผ่าน (บังคับเมื่อใช้รหัสผ่านชั่วคราว / เลือกเองจากเมนู)\n  // ---------------------------------------------------------------------------\n  function changePasswordRequest(values) {\n    if (values.newPassword !== values.confirmPassword) {\n      return Promise.reject({ message: 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน' });\n    }\n    return App.api('auth.changePassword', { currentPassword: values.currentPassword, newPassword: values.newPassword })\n      .then(function (result) {\n        App.session.set(result.token);\n        return result;\n      });\n  }\n\n  App.showForcedPasswordChange = function () {\n    var me = App.state.me;\n    var notice = h('div', { class: 'alert alert-error hidden', role: 'alert' });\n    var current = App.passwordField({ label: 'รหัสผ่านปัจจุบัน (รหัสผ่านชั่วคราว)', autocomplete: 'current-password' });\n    var next = App.passwordField({ label: 'รหัสผ่านใหม่', autocomplete: 'new-password' });\n    var confirm = App.passwordField({ label: 'ยืนยันรหัสผ่านใหม่', autocomplete: 'new-password' });\n    var submit = h('button', { type: 'submit', class: 'btn btn-block', text: 'บันทึกรหัสผ่านใหม่' });\n    var logout = h('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'ออกจากระบบ' });\n    logout.addEventListener('click', function () { App.logout(); });\n    var form = h('form', { class: 'stack', novalidate: true },\n      h('div', { class: 'alert alert-info' },\n        h('strong', { text: 'กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งาน' }),\n        h('div', { text: 'บัญชีนี้ใช้รหัสผ่านชั่วคราวที่ผู้ดูแลระบบกำหนด รหัสผ่านใหม่ต้อง:' }),\n        rulesList(['ไม่ซ้ำกับรหัสผ่านเดิม'])),\n      notice, current.wrap, next.wrap, confirm.wrap, submit, logout);\n    form.addEventListener('submit', function (e) {\n      e.preventDefault();\n      if (submit.disabled) return;\n      submit.disabled = true;\n      notice.classList.add('hidden');\n      changePasswordRequest({ currentPassword: current.input.value, newPassword: next.input.value, confirmPassword: confirm.input.value })\n        .then(function () {\n          App.toast('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว', 'success');\n          return App.loadMe();\n        })\n        .catch(function (err) {\n          if (err && err.handled) return;\n          notice.textContent = err.message;\n          notice.classList.remove('hidden');\n        })\n        .then(function () { submit.disabled = false; });\n    });\n    authPage('ตั้งรหัสผ่านใหม่', (me ? me.user.displayName + ' · ' : '') + BOOT.schoolName, form);\n    current.input.focus();\n  };\n\n  App.openChangePassword = function () {\n    App.formModal({\n      title: 'เปลี่ยนรหัสผ่าน',\n      intro: h('div', { class: 'alert alert-info' }, h('div', { text: 'รหัสผ่านใหม่ต้อง:' }), rulesList(['ไม่ซ้ำกับรหัสผ่านเดิม']),\n        h('div', { class: 'small', text: 'หลังเปลี่ยน การเข้าสู่ระบบบนเครื่องอื่นของคุณจะหมดอายุทันที' })),\n      fields: [\n        { key: 'currentPassword', label: 'รหัสผ่านปัจจุบัน', type: 'password', autocomplete: 'current-password', span2: true },\n        { key: 'newPassword', label: 'รหัสผ่านใหม่', type: 'password', autocomplete: 'new-password' },\n        { key: 'confirmPassword', label: 'ยืนยันรหัสผ่านใหม่', type: 'password', autocomplete: 'new-password' },\n      ],\n      submitLabel: 'เปลี่ยนรหัสผ่าน',\n      onSubmit: changePasswordRequest,\n      onDone: function () { App.toast('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว', 'success'); },\n    });\n  };\n\n  // ---------------------------------------------------------------------------\n  // หน้าหลัก\n  // ---------------------------------------------------------------------------\n  function stat(label, value) {\n    return h('div', { class: 'card stat' }, h('div', { class: 'stat-label', text: label }), h('div', { class: 'stat-value', text: value }));\n  }\n\n  function stepList(steps) {\n    return h('ol', { class: 'steps' }, steps.map(function (s, i) {\n      return h('li', null, h('span', { class: 'step-no', text: String(i + 1) }),\n        h('div', { style: { flex: '1' } }, h('div', { text: s.text }), s.help ? h('div', { class: 'muted small', text: s.help }) : null),\n        s.route ? button(s.button || 'ไปที่หน้านี้', 'secondary btn-sm', function () { App.go(s.route); }) : null);\n    }));\n  }\n\n  App.defineRoute('home', {\n    title: 'หน้าหลัก',\n    roles: ALL,\n    menu: { group: 'main', label: 'หน้าหลัก', icon: 'home' },\n    render: function () {\n      var me = App.state.me;\n      var role = me.user.role;\n      var card;\n      if (role === 'ADMIN') {\n        card = h('div', { class: 'card' },\n          h('div', { class: 'card-head' }, h('h2', { text: 'เริ่มต้นใช้งาน (ผู้ดูแลระบบ)' })),\n          h('div', { class: 'card-body' }, stepList([\n            { text: 'ตรวจและกรอกข้อมูลโรงเรียน และชื่อผู้ลงนามในเอกสาร', route: 'settings' },\n            { text: 'เพิ่มผู้ใช้: เจ้าหน้าที่การเงิน และผู้อำนวยการ', help: 'กำหนดรหัสผ่านชั่วคราว แล้วแจ้งผู้ใช้เป็นการส่วนตัว ผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก', route: 'users' },\n            { text: 'ตรวจปีการศึกษาปัจจุบัน', route: 'years' },\n            { text: 'ดูประวัติการใช้งาน และตรวจความถูกต้องของประวัติ', route: 'audit' },\n          ])));\n      } else if (role === 'DIRECTOR') {\n        card = h('div', { class: 'card' },\n          h('div', { class: 'card-head' }, h('h2', { text: 'สิ่งที่ทำได้ในขณะนี้' })),\n          h('div', { class: 'card-body' }, stepList([\n            { text: 'ดูประวัติการใช้งานของทุกบัญชี และตรวจว่าประวัติไม่ถูกแก้ไข', route: 'audit' },\n            { text: 'ดูข้อมูลโรงเรียนและปีการศึกษา', route: 'settings' },\n            { text: 'Dashboard การเงินและการอนุมัติรายการจะเปิดใช้ในระยะถัดไป' },\n          ])));\n      } else {\n        card = h('div', { class: 'card' },\n          h('div', { class: 'card-head' }, h('h2', { text: 'งานการเงินที่จะเปิดใช้ในระยะถัดไป' })),\n          h('div', { class: 'card-body' }, stepList([\n            { text: 'ข้อมูลนักเรียนและการนำเข้าจาก Excel (ระยะที่ 3)' },\n            { text: 'ตั้งอัตราเงินบำรุง เรียกเก็บ และรับชำระ (ระยะที่ 4)' },\n            { text: 'ทะเบียนคุมใบเสร็จรับเงิน (ระยะที่ 5)' },\n            { text: 'ติดตามยอดค้าง รายงาน และพิมพ์เอกสาร (ระยะที่ 6–7)' },\n          ])));\n      }\n      return h('div', null,\n        pageHead('สวัสดี คุณ' + me.user.displayName, me.school.name + ' · ' + me.user.roleLabel),\n        h('div', { class: 'grid-cards' },\n          stat('ปีการศึกษาปัจจุบัน', String(me.school.currentAcademicYear)),\n          stat('บทบาทของคุณ', me.user.roleLabel),\n          stat('สถานะการพัฒนาระบบ', 'ระยะที่ 2 จาก 8')),\n        card);\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // ผู้ใช้งาน (ผู้ดูแลระบบ)\n  // ---------------------------------------------------------------------------\n  var ROLE_OPTIONS = [\n    { value: 'FINANCE', label: 'เจ้าหน้าที่การเงิน' },\n    { value: 'DIRECTOR', label: 'ผู้อำนวยการ' },\n    { value: 'ADMIN', label: 'ผู้ดูแลระบบ' },\n  ];\n  var STATUS_OPTIONS = [\n    { value: 'ACTIVE', label: 'ใช้งาน' },\n    { value: 'DISABLED', label: 'ปิดการใช้งาน' },\n  ];\n\n  function checkTempPassword(values) {\n    if (values.tempPassword !== values.confirmPassword) return Promise.reject({ message: 'รหัสผ่านชั่วคราวทั้งสองช่องไม่ตรงกัน' });\n    return null;\n  }\n\n  function openCreateUser() {\n    var googleMode = App.state.me.authMode === 'GOOGLE';\n    var fields = [\n      { key: 'username', label: 'ชื่อผู้ใช้', required: true, mono: true, autocapitalize: 'none', maxlength: 32, help: 'ภาษาอังกฤษตัวพิมพ์เล็ก เช่น somchai.k (เปลี่ยนภายหลังไม่ได้)' },\n      { key: 'displayName', label: 'ชื่อ-นามสกุล', required: true, maxlength: 100 },\n      { key: 'position', label: 'ตำแหน่ง', maxlength: 100 },\n      { key: 'email', label: 'อีเมล', type: 'email', required: googleMode, maxlength: 254, help: googleMode ? 'บัญชี Google ของโรงเรียนที่ใช้เข้าสู่ระบบ' : 'ไม่บังคับ' },\n      { key: 'role', label: 'บทบาท', type: 'select', options: ROLE_OPTIONS, value: 'FINANCE', required: true, span2: true },\n    ];\n    if (!googleMode) {\n      fields.push({ key: 'tempPassword', label: 'รหัสผ่านชั่วคราว', type: 'password', required: true, autocomplete: 'new-password' });\n      fields.push({ key: 'confirmPassword', label: 'ยืนยันรหัสผ่านชั่วคราว', type: 'password', required: true, autocomplete: 'new-password' });\n    }\n    App.formModal({\n      title: 'เพิ่มผู้ใช้',\n      intro: googleMode ? null : h('div', { class: 'alert alert-info' },\n        h('div', { text: 'ผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก แจ้งรหัสผ่านชั่วคราวเป็นการส่วนตัวเท่านั้น รหัสผ่านต้อง:' }),\n        rulesList()),\n      fields: fields,\n      submitLabel: 'เพิ่มผู้ใช้',\n      onSubmit: function (v) {\n        return checkTempPassword(v) || App.api('users.create', {\n          username: v.username, displayName: v.displayName, position: v.position, email: v.email, role: v.role, tempPassword: v.tempPassword,\n        });\n      },\n      onDone: function (user) {\n        App.toast('เพิ่มผู้ใช้ ' + user.username + ' เรียบร้อยแล้ว', 'success');\n        App.refresh();\n      },\n    });\n  }\n\n  function openEditUser(user) {\n    var self = user.userId === App.state.me.user.userId;\n    App.formModal({\n      title: 'แก้ไขผู้ใช้: ' + user.username,\n      intro: self ? 'นี่คือบัญชีของคุณ จึงเปลี่ยนบทบาทหรือปิดการใช้งานไม่ได้' :\n        'ถ้าเปลี่ยนบทบาทหรือปิดการใช้งาน ผู้ใช้นี้จะถูกออกจากระบบทันที',\n      fields: [\n        { key: 'displayName', label: 'ชื่อ-นามสกุล', value: user.displayName, required: true, maxlength: 100 },\n        { key: 'position', label: 'ตำแหน่ง', value: user.position, maxlength: 100 },\n        { key: 'email', label: 'อีเมล', type: 'email', value: user.email, maxlength: 254, span2: true },\n        { key: 'role', label: 'บทบาท', type: 'select', options: ROLE_OPTIONS, value: user.role, disabled: self },\n        { key: 'status', label: 'สถานะ', type: 'select', options: STATUS_OPTIONS, value: user.status, disabled: self },\n      ],\n      onSubmit: function (v) {\n        return App.api('users.update', {\n          userId: user.userId, displayName: v.displayName, position: v.position, email: v.email, role: v.role, status: v.status,\n        });\n      },\n      onDone: function () {\n        App.toast('บันทึกข้อมูลผู้ใช้เรียบร้อยแล้ว', 'success');\n        if (self) App.reloadMe(); else App.refresh();\n      },\n    });\n  }\n\n  function openResetPassword(user) {\n    App.formModal({\n      title: 'รีเซ็ตรหัสผ่าน: ' + user.username,\n      intro: h('div', { class: 'alert alert-warning' },\n        h('div', { text: 'การเข้าสู่ระบบเดิมของผู้ใช้นี้จะหมดอายุทันที และผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งถัดไป รหัสผ่านชั่วคราวต้อง:' }),\n        rulesList()),\n      fields: [\n        { key: 'tempPassword', label: 'รหัสผ่านชั่วคราวใหม่', type: 'password', autocomplete: 'new-password' },\n        { key: 'confirmPassword', label: 'ยืนยันรหัสผ่านชั่วคราว', type: 'password', autocomplete: 'new-password' },\n      ],\n      submitLabel: 'รีเซ็ตรหัสผ่าน',\n      onSubmit: function (v) {\n        return checkTempPassword(v) || App.api('users.resetPassword', { userId: user.userId, tempPassword: v.tempPassword });\n      },\n      onDone: function () {\n        App.toast('รีเซ็ตรหัสผ่านของ ' + user.username + ' แล้ว แจ้งรหัสผ่านชั่วคราวเป็นการส่วนตัว', 'success');\n        App.refresh();\n      },\n    });\n  }\n\n  App.defineRoute('users', {\n    title: 'ผู้ใช้งาน',\n    roles: ['ADMIN'],\n    menu: { group: 'manage', label: 'ผู้ใช้งาน', icon: 'users' },\n    render: function () {\n      return App.api('users.list').then(function (users) {\n        var googleMode = App.state.me.authMode === 'GOOGLE';\n        var search = App.field({ label: 'ค้นหา', placeholder: 'ชื่อผู้ใช้ ชื่อ-นามสกุล หรือตำแหน่ง' });\n        var list = h('div');\n        function draw() {\n          var q = search.input.value.trim().toLowerCase();\n          var rows = users.filter(function (u) {\n            return !q || (u.username + ' ' + u.displayName + ' ' + (u.position || '') + ' ' + (u.email || '')).toLowerCase().indexOf(q) !== -1;\n          });\n          clear(list).appendChild(App.table({\n            rows: rows,\n            empty: 'ไม่พบผู้ใช้',\n            columns: [\n              { label: 'ชื่อผู้ใช้', render: function (u) { return h('span', { class: 'mono', text: u.username }); } },\n              { label: 'ชื่อ-นามสกุล', render: function (u) {\n                return h('div', null, h('div', { text: u.displayName }), u.position ? h('div', { class: 'muted small', text: u.position }) : null);\n              } },\n              { label: 'บทบาท', render: function (u) { return App.roleBadge(u.role); } },\n              { label: 'สถานะ', render: function (u) {\n                return h('div', null, App.badge(u.statusLabel, u.status === 'ACTIVE' ? 'success' : 'muted'), ' ',\n                  u.mustChangePassword && !googleMode ? App.badge('รอเปลี่ยนรหัสผ่าน', 'warning') : null);\n              } },\n              { label: 'เข้าสู่ระบบล่าสุด', render: function (u) { return App.fmt.datetime(u.lastLoginAt); } },\n              { label: 'จัดการ', className: 'actions', render: function (u) {\n                var self = u.userId === App.state.me.user.userId;\n                return [\n                  button('แก้ไข', 'secondary btn-sm', function () { openEditUser(u); }, 'edit'),\n                  !googleMode && !self ? button('รีเซ็ตรหัสผ่าน', 'secondary btn-sm', function () { openResetPassword(u); }, 'key') : null,\n                ];\n              } },\n            ],\n          }));\n        }\n        search.input.addEventListener('input', draw);\n        draw();\n        return h('div', null,\n          pageHead('ผู้ใช้งาน', 'เพิ่มผู้ใช้ กำหนดบทบาท และรีเซ็ตรหัสผ่าน (ไม่มีการลบผู้ใช้ ใช้ \"ปิดการใช้งาน\" แทน)',\n            button('เพิ่มผู้ใช้', '', openCreateUser, 'plus')),\n          h('div', { class: 'card' }, h('div', { class: 'card-body' }, h('div', { class: 'toolbar' }, search.wrap), list)));\n      });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // ตั้งค่าโรงเรียน (ทุกบทบาทดูได้ แก้ไขได้เฉพาะผู้ดูแลระบบ)\n  // ---------------------------------------------------------------------------\n  function settingInput(item, editable) {\n    var disabled = !editable || item.readOnly;\n    var help = item.description || '';\n    if ((item.type === 'int') && item.min !== null) help = (help ? help + ' ' : '') + '(' + item.min + '–' + item.max + ')';\n    if (item.type === 'bool') return App.field({ type: 'checkbox', label: item.label, value: item.value, help: help, disabled: disabled, span2: true });\n    if (item.type === 'list') return App.field({ type: 'textarea', label: item.label, value: item.value.join(', '), help: help, disabled: disabled, span2: true, rows: 2, maxlength: 1500 });\n    if (item.type === 'int' || item.type === 'year') return App.field({ type: 'number', label: item.label, value: item.value, min: item.min, max: item.max, help: help, disabled: disabled, inputmode: 'numeric' });\n    return App.field({ label: item.label, value: item.value, help: help, disabled: disabled, maxlength: 300, span2: item.key === 'SCHOOL_ADDRESS' || item.key === 'SCHOOL_AFFILIATION' });\n  }\n\n  function settingCurrentValue(item, f) {\n    if (item.type === 'bool') return f.input.checked;\n    if (item.type === 'list') return f.input.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean).join(',');\n    return String(f.input.value).trim();\n  }\n\n  function settingOriginalValue(item) {\n    if (item.type === 'bool') return item.value;\n    if (item.type === 'list') return item.value.join(',');\n    return String(item.value === null || item.value === undefined ? '' : item.value);\n  }\n\n  App.defineRoute('settings', {\n    title: 'ตั้งค่าโรงเรียน',\n    roles: ALL,\n    menu: { group: 'info', label: 'ตั้งค่าโรงเรียน', icon: 'settings' },\n    render: function () {\n      return App.api('settings.get').then(function (data) {\n        var inputs = [];\n        var cards = data.groups.map(function (g) {\n          var grid = h('div', { class: 'form-grid' });\n          g.items.forEach(function (item) {\n            var f = settingInput(item, data.editable);\n            if (!item.readOnly) inputs.push({ item: item, field: f });\n            grid.appendChild(f.wrap);\n          });\n          return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: g.label })), h('div', { class: 'card-body' }, grid));\n        });\n        var footer;\n        if (data.editable) {\n          var save = button('บันทึกการเปลี่ยนแปลง', '', function () {\n            var values = {};\n            inputs.forEach(function (x) {\n              var current = settingCurrentValue(x.item, x.field);\n              if (current !== settingOriginalValue(x.item)) values[x.item.key] = current;\n            });\n            if (!Object.keys(values).length) { App.toast('ไม่มีค่าที่เปลี่ยนแปลง'); return; }\n            save.disabled = true;\n            App.api('settings.update', { values: values })\n              .then(function (res) {\n                App.toast('บันทึกค่าตั้งค่า ' + res.changed.length + ' รายการเรียบร้อยแล้ว', 'success');\n                return App.reloadMe();\n              })\n              .catch(App.fail)\n              .then(function () { save.disabled = false; });\n          }, 'check');\n          footer = h('div', { class: 'card card-body', style: { position: 'sticky', bottom: '12px', marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },\n            h('span', { class: 'muted small', text: 'ระบบบันทึกเฉพาะค่าที่เปลี่ยน และเก็บค่าเดิม/ค่าใหม่ไว้ในประวัติการใช้งาน' }), save);\n        } else {\n          footer = h('div', { class: 'alert alert-info', style: { marginTop: '16px' }, text: 'เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขค่าตั้งค่าได้' });\n        }\n        return h('div', null,\n          pageHead('ตั้งค่าโรงเรียน', 'ข้อมูลโรงเรียน ผู้ลงนาม รายการที่ต้องอนุมัติ และความปลอดภัยในการเข้าสู่ระบบ'),\n          cards, footer);\n      });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // ปีการศึกษา (ทุกบทบาทดูได้ จัดการได้เฉพาะผู้ดูแลระบบ)\n  // ---------------------------------------------------------------------------\n  function openYearForm(year, years) {\n    var editing = !!year;\n    var nextYear = years.length ? Math.max.apply(null, years.map(function (y) { return y.year; })) + 1 : (App.state.me.school.currentAcademicYear || 2569);\n    var fields = editing ? [] : [\n      { key: 'year', label: 'ปีการศึกษา (พ.ศ.)', type: 'number', value: nextYear, required: true, inputmode: 'numeric', min: 2500, max: 2700 },\n    ];\n    fields = fields.concat([\n      { key: 'label', label: 'ชื่อที่แสดง', value: editing ? year.label : '', placeholder: 'เว้นว่าง = ปีการศึกษา ' + (editing ? year.year : nextYear), maxlength: 60, span2: !editing },\n      { key: 'startDate', label: 'วันเริ่มปีการศึกษา', type: 'date', value: editing ? year.startDate : '' },\n      { key: 'endDate', label: 'วันสิ้นสุดปีการศึกษา', type: 'date', value: editing ? year.endDate : '' },\n    ]);\n    if (editing) {\n      fields.push({ key: 'status', label: 'สถานะ', type: 'select', value: year.status, span2: true,\n        options: [{ value: 'OPEN', label: 'เปิด' }, { value: 'CLOSED', label: 'ปิดแล้ว (สร้างรายการเรียกเก็บใหม่ไม่ได้ แต่รับชำระหนี้ค้างได้)' }] });\n    }\n    App.formModal({\n      title: editing ? 'แก้ไข' + year.label : 'เพิ่มปีการศึกษา',\n      intro: 'วันที่ในช่องเลือกเป็นปี ค.ศ. ตามปฏิทินของเครื่อง ระบบแสดงผลเป็น พ.ศ. ให้ด้านล่างช่อง',\n      fields: fields,\n      onSubmit: function (v) {\n        if (editing) {\n          return App.api('years.update', { academicYearId: year.academicYearId, label: v.label || year.label, startDate: v.startDate, endDate: v.endDate, status: v.status });\n        }\n        return App.api('years.create', { year: v.year, label: v.label, startDate: v.startDate, endDate: v.endDate });\n      },\n      onDone: function () {\n        App.toast('บันทึกปีการศึกษาเรียบร้อยแล้ว', 'success');\n        App.reloadMe();\n      },\n    });\n  }\n\n  App.defineRoute('years', {\n    title: 'ปีการศึกษา',\n    roles: ALL,\n    menu: { group: 'info', label: 'ปีการศึกษา', icon: 'calendar' },\n    render: function () {\n      return App.api('years.list').then(function (years) {\n        var admin = App.state.me.user.role === 'ADMIN';\n        var columns = [\n          { label: 'ปีการศึกษา', render: function (y) {\n            return h('div', null, h('strong', { text: String(y.year) }), ' ', y.isCurrent ? App.badge('ปีปัจจุบัน', 'success') : null);\n          } },\n          { label: 'ชื่อที่แสดง', key: 'label' },\n          { label: 'ช่วงเวลา', render: function (y) {\n            return y.startDate || y.endDate ? App.fmt.date(y.startDate) + ' – ' + App.fmt.date(y.endDate) : 'ไม่ได้ระบุ';\n          } },\n          { label: 'สถานะ', render: function (y) { return App.badge(y.statusLabel, y.status === 'OPEN' ? 'success' : 'muted'); } },\n        ];\n        if (admin) {\n          columns.push({ label: 'จัดการ', className: 'actions', render: function (y) {\n            return [\n              button('แก้ไข', 'secondary btn-sm', function () { openYearForm(y, years); }, 'edit'),\n              !y.isCurrent && y.status === 'OPEN' ? button('ตั้งเป็นปีปัจจุบัน', 'secondary btn-sm', function () {\n                App.confirm('ตั้งปีการศึกษา ' + y.year + ' เป็นปีปัจจุบัน? ระบบจะใช้ปีนี้เป็นค่าเริ่มต้นในการเรียกเก็บและรายงาน', { confirmLabel: 'ตั้งเป็นปีปัจจุบัน' })\n                  .then(function (ok) {\n                    if (!ok) return null;\n                    return App.api('years.setCurrent', { academicYearId: y.academicYearId }).then(function () {\n                      App.toast('ตั้งปีการศึกษา ' + y.year + ' เป็นปีปัจจุบันแล้ว', 'success');\n                      return App.reloadMe();\n                    });\n                  })\n                  .catch(App.fail);\n              }, 'star') : null,\n            ];\n          } });\n        }\n        return h('div', null,\n          pageHead('ปีการศึกษา', 'ปีการศึกษาปัจจุบันใช้เป็นค่าเริ่มต้นของการเรียกเก็บและรายงาน ข้อมูลปีเก่าไม่ถูกลบ',\n            admin ? button('เพิ่มปีการศึกษา', '', function () { openYearForm(null, years); }, 'plus') : null),\n          h('div', { class: 'card' }, h('div', { class: 'card-body' }, App.table({ columns: columns, rows: years, empty: 'ยังไม่มีปีการศึกษา' }))));\n      });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // ประวัติการใช้งาน (ผู้ดูแลระบบ และผู้อำนวยการ)\n  // ---------------------------------------------------------------------------\n  var ACTION_KIND = {\n    LOGIN_FAILED: 'danger', ACCESS_DENIED: 'danger', CANCEL: 'danger', REJECT: 'danger',\n    CREATE: 'success', APPROVE: 'success', IMPORT: 'success',\n    UPDATE: 'warning', PASSWORD_CHANGE: 'warning', RESTORE: 'warning',\n    LOGIN: 'muted', LOGOUT: 'muted', INTEGRITY_CHECK: 'muted', SETUP: 'muted',\n  };\n\n  function kvTable(obj) {\n    if (!obj || typeof obj !== 'object') return h('p', { class: 'muted', text: 'ไม่มีข้อมูล' });\n    var keys = Object.keys(obj);\n    if (!keys.length) return h('p', { class: 'muted', text: 'ไม่มีข้อมูล' });\n    return h('table', { class: 'kv' }, h('tbody', null, keys.map(function (k) {\n      var v = obj[k];\n      var text = v === null || v === undefined || v === '' ? '–' : (typeof v === 'object' ? JSON.stringify(v) : String(v));\n      return h('tr', null, h('th', { text: k }), h('td', { text: text }));\n    })));\n  }\n\n  function openAuditDetail(item) {\n    var info = {\n      'วันเวลา': formatThaiDateTime_(item.timestamp),\n      'ผู้ใช้': item.username,\n      'บทบาท': item.roleLabel,\n      'การกระทำ': item.actionLabel,\n      'รายการ': item.entityLabel,\n      'รหัสรายการ': item.entityId,\n      'หมายเหตุ': item.note,\n      'รหัสประวัติ': item.logId,\n    };\n    App.modal({\n      title: 'รายละเอียดประวัติ',\n      size: 'lg',\n      body: [kvTable(info),\n        item.before ? [h('h3', { text: 'ค่าเดิม' }), kvTable(item.before)] : null,\n        item.after ? [h('h3', { text: 'ค่าใหม่' }), kvTable(item.after)] : null],\n      actions: [{ label: 'ปิด', kind: 'secondary' }],\n    });\n  }\n\n  function openVerifyResult(result) {\n    var body;\n    if (result.ok) {\n      body = h('div', { class: 'alert alert-success', text: 'ถูกต้อง: ประวัติการใช้งาน ' + result.total + ' รายการ ต่อเนื่องครบถ้วน ไม่พบการแก้ไขหรือลบ' });\n    } else {\n      body = [\n        h('div', { class: 'alert alert-error', text: 'พบปัญหา ' + result.problemCount + ' จุด จากประวัติทั้งหมด ' + result.total + ' รายการ' }),\n        App.table({ rows: result.problems, columns: [\n          { label: 'แถวในชีต', key: 'rowNumber' },\n          { label: 'รหัสประวัติ', render: function (p) { return h('span', { class: 'mono', text: p.logId || '–' }); } },\n          { label: 'ปัญหา', key: 'label' },\n        ] }),\n        h('p', { class: 'muted small', text: 'กรุณาตรวจสอบประวัติเวอร์ชันของไฟล์ Google Sheets (ไฟล์ > ประวัติเวอร์ชัน) และรายงานผู้อำนวยการ' }),\n      ];\n    }\n    App.modal({ title: 'ผลการตรวจความถูกต้องของประวัติ', size: 'lg', body: body, actions: [{ label: 'ปิด', kind: 'secondary' }] });\n  }\n\n  App.defineRoute('audit', {\n    title: 'ประวัติการใช้งาน',\n    roles: ['ADMIN', 'DIRECTOR'],\n    menu: { group: 'manage', label: 'ประวัติการใช้งาน', icon: 'history' },\n    render: function () {\n      var filters = { action: '', username: '', dateFrom: '', dateTo: '', q: '', page: 1 };\n      return App.api('audit.list', filters).then(function (first) {\n        var action = App.field({ label: 'การกระทำ', type: 'select', options: [{ value: '', label: 'ทั้งหมด' }].concat(first.actions) });\n        var username = App.field({ label: 'ชื่อผู้ใช้', autocapitalize: 'none', mono: true });\n        var dateFrom = App.field({ label: 'ตั้งแต่วันที่', type: 'date' });\n        var dateTo = App.field({ label: 'ถึงวันที่', type: 'date' });\n        var q = App.field({ label: 'คำค้น', placeholder: 'รหัสรายการ หรือหมายเหตุ' });\n        var results = h('div');\n\n        function draw(data) {\n          var pager = h('div', { class: 'pager' },\n            h('span', { class: 'muted small', text: 'ทั้งหมด ' + data.total.toLocaleString('th-TH') + ' รายการ · หน้า ' + data.page + ' จาก ' + data.pages }),\n            h('div', { class: 'toolbar', style: { marginBottom: '0' } },\n              button('ก่อนหน้า', 'secondary btn-sm', function () { load(data.page - 1); }),\n              button('ถัดไป', 'secondary btn-sm', function () { load(data.page + 1); })));\n          pager.querySelectorAll('button')[0].disabled = data.page <= 1;\n          pager.querySelectorAll('button')[1].disabled = data.page >= data.pages;\n          clear(results).appendChild(App.table({\n            rows: data.items,\n            empty: 'ไม่พบประวัติตามเงื่อนไข',\n            onRowClick: openAuditDetail,\n            columns: [\n              { label: 'วันเวลา', className: 'nowrap', render: function (r) { return App.fmt.datetime(r.timestamp); } },\n              { label: 'ผู้ใช้', render: function (r) { return h('div', null, h('div', { class: 'mono', text: r.username }), h('div', { class: 'muted small', text: r.roleLabel })); } },\n              { label: 'การกระทำ', render: function (r) { return App.badge(r.actionLabel, ACTION_KIND[r.action] || ''); } },\n              { label: 'รายการ', render: function (r) { return h('div', null, h('div', { text: r.entityLabel }), r.entityId ? h('div', { class: 'muted small mono', text: r.entityId }) : null); } },\n              { label: 'หมายเหตุ', key: 'note' },\n            ],\n          }));\n          results.appendChild(pager);\n        }\n\n        function load(page) {\n          filters = { action: action.get(), username: username.get(), dateFrom: dateFrom.get(), dateTo: dateTo.get(), q: q.get(), page: page || 1 };\n          return App.api('audit.list', filters).then(draw).catch(App.fail);\n        }\n\n        var searchBtn = button('ค้นหา', '', function () { load(1); }, 'search');\n        var resetBtn = button('ล้างเงื่อนไข', 'secondary', function () {\n          [username, dateFrom, dateTo, q].forEach(function (f) { f.input.value = ''; f.input.dispatchEvent(new Event('change')); });\n          action.input.value = '';\n          load(1);\n        });\n        var verifyBtn = button('ตรวจความถูกต้องของประวัติ', 'secondary', function () {\n          verifyBtn.disabled = true;\n          App.api('audit.verify')\n            .then(function (result) { openVerifyResult(result); return load(filters.page); })\n            .catch(App.fail)\n            .then(function () { verifyBtn.disabled = false; });\n        }, 'shield');\n        [username.input, q.input].forEach(function (input) {\n          input.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(1); });\n        });\n        draw(first);\n        return h('div', null,\n          pageHead('ประวัติการใช้งาน', 'บันทึกทุกการเพิ่ม แก้ไข เข้าสู่ระบบ และการปฏิเสธสิทธิ์ แก้ไขหรือลบไม่ได้ คลิกรายการเพื่อดูค่าเดิมและค่าใหม่', verifyBtn),\n          h('div', { class: 'card' }, h('div', { class: 'card-body' },\n            h('div', { class: 'toolbar' }, action.wrap, username.wrap, dateFrom.wrap, dateTo.wrap, q.wrap),\n            h('div', { class: 'toolbar' }, searchBtn, resetBtn),\n            results)));\n      });\n    },\n  });\n\n  App.start();\n})();\n</script>\n",
  "Styles": "<style>\n/* ==========================================================================\n   Styles — โทนกรมท่า ขาว ฟ้า / รองรับคอมพิวเตอร์และมือถือ / พิมพ์ได้\n   ========================================================================== */\n:root {\n  --navy: #1F3A5F;\n  --navy-800: #19304F;\n  --navy-900: #122540;\n  --navy-100: #E3E9F2;\n  --blue: #2E86DE;\n  --blue-700: #1F6FBF;\n  --blue-50: #EEF5FD;\n  --bg: #F3F6FA;\n  --surface: #FFFFFF;\n  --text: #1B2B3F;\n  --muted: #5B6B80;\n  --border: #DCE3EC;\n  --success: #1E7F52;\n  --success-bg: #E5F4EC;\n  --danger: #B73A2E;\n  --danger-bg: #FBEAE8;\n  --warning: #9A6412;\n  --warning-bg: #FDF3E1;\n  --radius: 10px;\n  --radius-sm: 6px;\n  --shadow: 0 1px 2px rgba(18, 37, 64, .06), 0 6px 16px rgba(18, 37, 64, .06);\n  --sidebar-w: 260px;\n  --topbar-h: 60px;\n}\n\n* { box-sizing: border-box; }\nhtml { -webkit-text-size-adjust: 100%; }\nbody {\n  margin: 0;\n  font-family: 'Sarabun', 'Tahoma', 'Leelawadee UI', 'Thonburi', sans-serif;\n  font-size: 16px;\n  line-height: 1.55;\n  color: var(--text);\n  background: var(--bg);\n}\nh1, h2, h3 { margin: 0; line-height: 1.3; color: var(--navy-900); }\nh1 { font-size: 1.45rem; }\nh2 { font-size: 1.15rem; }\nh3 { font-size: 1rem; }\np { margin: 0 0 .6em; }\na { color: var(--blue-700); }\nbutton, input, select, textarea { font: inherit; color: inherit; }\n:focus-visible { outline: 3px solid rgba(46, 134, 222, .45); outline-offset: 2px; }\n.muted { color: var(--muted); }\n.small { font-size: .875rem; }\n.nowrap { white-space: nowrap; }\n.hidden { display: none !important; }\n.mono { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace; font-size: .85em; }\n.stack { display: flex; flex-direction: column; gap: 14px; }\n\n/* ---------- โหลดหน้าแรก / แถบสถานะกำลังทำงาน ---------- */\n.boot-screen { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--muted); }\n.spinner { width: 34px; height: 34px; border: 3px solid var(--navy-100); border-top-color: var(--navy); border-radius: 50%; animation: spin .8s linear infinite; }\n@keyframes spin { to { transform: rotate(360deg); } }\n.busy-bar { position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 100; background: linear-gradient(90deg, transparent, var(--blue), transparent); background-size: 50% 100%; opacity: 0; transition: opacity .15s; }\nbody.is-busy .busy-bar { opacity: 1; animation: busy 1s linear infinite; }\n@keyframes busy { from { background-position: -50% 0; } to { background-position: 150% 0; } }\n\n/* ---------- ปุ่ม ---------- */\n.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 8px 16px; border-radius: var(--radius-sm); border: 1px solid var(--navy); background: var(--navy); color: #fff; font-weight: 600; cursor: pointer; text-decoration: none; white-space: nowrap; }\n.btn:hover { background: var(--navy-800); }\n.btn:disabled { opacity: .55; cursor: not-allowed; }\n.btn-secondary { background: #fff; color: var(--navy); border-color: var(--border); }\n.btn-secondary:hover { background: var(--blue-50); }\n.btn-danger { background: var(--danger); border-color: var(--danger); }\n.btn-danger:hover { background: #9C2F25; }\n.btn-ghost { background: transparent; color: var(--navy); border-color: transparent; }\n.btn-ghost:hover { background: var(--blue-50); }\n.btn-sm { min-height: 32px; padding: 4px 10px; font-size: .875rem; font-weight: 500; }\n.btn-block { width: 100%; }\n.btn svg { width: 18px; height: 18px; flex-shrink: 0; }\n\n/* ---------- ป้าย ---------- */\n.badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 999px; font-size: .8rem; font-weight: 600; background: var(--navy-100); color: var(--navy); white-space: nowrap; }\n.badge-ADMIN { background: var(--navy); color: #fff; }\n.badge-FINANCE { background: var(--blue-50); color: var(--blue-700); border: 1px solid #C8DFF7; }\n.badge-DIRECTOR { background: var(--warning-bg); color: var(--warning); border: 1px solid #F2DDB4; }\n.badge-success { background: var(--success-bg); color: var(--success); }\n.badge-danger { background: var(--danger-bg); color: var(--danger); }\n.badge-muted { background: #EEF1F5; color: var(--muted); }\n.badge-warning { background: var(--warning-bg); color: var(--warning); }\n\n/* ---------- ฟอร์ม ---------- */\n.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; }\n.form-grid .span-2 { grid-column: 1 / -1; }\n.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }\n.field > label { font-weight: 600; font-size: .95rem; }\n.field .req { color: var(--danger); }\n.field .help { color: var(--muted); font-size: .85rem; }\n.field .preview { color: var(--blue-700); font-size: .85rem; }\n.input, select.input, textarea.input { width: 100%; min-height: 42px; padding: 8px 12px; border: 1px solid #C9D3DF; border-radius: var(--radius-sm); background: #fff; }\ntextarea.input { min-height: 84px; resize: vertical; }\n.input:focus { border-color: var(--blue); outline: 3px solid rgba(46, 134, 222, .2); }\n.input:disabled, .input[readonly] { background: #F2F5F9; color: var(--muted); }\n.input-group { display: flex; gap: 6px; }\n.input-group .input { flex: 1; }\n.switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }\n.switch input { width: 20px; height: 20px; accent-color: var(--navy); }\n.alert { padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid; line-height: 1.5; }\n.alert-error { background: var(--danger-bg); border-color: #F2C9C4; color: #8E2A1F; }\n.alert-info { background: var(--blue-50); border-color: #C8DFF7; color: var(--navy-900); }\n.alert-success { background: var(--success-bg); border-color: #BFE3CF; color: #155F3D; }\n.alert-warning { background: var(--warning-bg); border-color: #F2DDB4; color: #6F4A0E; }\n.rules { margin: 6px 0 0; padding-left: 20px; color: var(--muted); font-size: .9rem; }\n\n/* ---------- หน้าเข้าสู่ระบบ ---------- */\n.login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; background: linear-gradient(160deg, var(--navy-900) 0%, var(--navy) 55%, #2A5C93 100%); }\n.login-card { width: 100%; max-width: 420px; background: #fff; border-radius: 14px; box-shadow: 0 20px 50px rgba(0, 0, 0, .25); overflow: hidden; }\n.login-head { padding: 26px 28px 18px; border-bottom: 1px solid var(--border); text-align: center; }\n.login-logo { width: 56px; height: 56px; margin: 0 auto 10px; border-radius: 14px; background: var(--navy); color: #fff; display: flex; align-items: center; justify-content: center; }\n.login-logo svg { width: 30px; height: 30px; }\n.login-school { font-size: 1.25rem; font-weight: 700; color: var(--navy-900); }\n.login-app { color: var(--muted); font-size: .95rem; }\n.login-body { padding: 22px 28px 26px; display: flex; flex-direction: column; gap: 14px; }\n.login-foot { padding: 12px 28px; background: #F7F9FC; color: var(--muted); font-size: .8rem; text-align: center; }\n\n/* ---------- โครงหน้าแอป ---------- */\n.shell { display: grid; grid-template-columns: var(--sidebar-w) minmax(0, 1fr); min-height: 100vh; }\n.sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--navy); color: #DCE6F2; z-index: 30; }\n.brand { display: flex; align-items: center; gap: 12px; padding: 18px 18px 16px; border-bottom: 1px solid rgba(255, 255, 255, .1); }\n.brand-logo { width: 40px; height: 40px; border-radius: 10px; background: rgba(255, 255, 255, .12); display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; }\n.brand-logo svg { width: 22px; height: 22px; }\n.brand-name { color: #fff; font-weight: 700; line-height: 1.25; }\n.brand-sub { font-size: .78rem; color: #A9BBD3; line-height: 1.3; }\n.nav { flex: 1; overflow-y: auto; padding: 10px 10px 16px; }\n.nav-group { margin-top: 12px; }\n.nav-group-label { padding: 4px 10px; font-size: .75rem; font-weight: 600; letter-spacing: .02em; color: #8FA6C4; }\n.nav-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; margin: 2px 0; border: 0; border-radius: 8px; background: transparent; color: #DCE6F2; text-align: left; cursor: pointer; font-weight: 500; }\n.nav-item svg { width: 20px; height: 20px; flex-shrink: 0; opacity: .9; }\n.nav-item:hover { background: rgba(255, 255, 255, .08); color: #fff; }\n.nav-item.active { background: #fff; color: var(--navy); font-weight: 700; }\n.nav-item.active svg { color: var(--blue); }\n.userbox { padding: 12px 14px 16px; border-top: 1px solid rgba(255, 255, 255, .1); }\n.userbox-name { color: #fff; font-weight: 600; }\n.userbox-role { font-size: .8rem; color: #A9BBD3; margin-bottom: 8px; }\n.userbox .btn { border-color: rgba(255, 255, 255, .25); background: transparent; color: #fff; }\n.userbox .btn:hover { background: rgba(255, 255, 255, .1); }\n.userbox-actions { display: flex; gap: 6px; flex-wrap: wrap; }\n\n.main { min-width: 0; display: flex; flex-direction: column; }\n.topbar { position: sticky; top: 0; z-index: 20; height: var(--topbar-h); display: flex; align-items: center; gap: 12px; padding: 0 24px; background: rgba(255, 255, 255, .96); border-bottom: 1px solid var(--border); backdrop-filter: blur(4px); }\n.topbar-title { font-size: 1.1rem; font-weight: 700; color: var(--navy-900); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.menu-toggle { display: none; }\n.year-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; background: var(--blue-50); color: var(--blue-700); font-size: .85rem; font-weight: 600; white-space: nowrap; }\n.content { width: 100%; max-width: 1180px; padding: 24px; }\n.backdrop { display: none; }\n\n/* ---------- การ์ด / ส่วนหัวหน้า ---------- */\n.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }\n.page-head p { margin: 4px 0 0; color: var(--muted); }\n.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }\n.card + .card { margin-top: 16px; }\n.card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--border); }\n.card-body { padding: 18px; }\n.grid-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 18px; }\n.stat { padding: 16px 18px; }\n.stat-label { color: var(--muted); font-size: .9rem; }\n.stat-value { font-size: 1.6rem; font-weight: 700; color: var(--navy-900); line-height: 1.2; margin-top: 4px; }\n.steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }\n.steps li { display: flex; gap: 12px; align-items: flex-start; }\n.step-no { width: 28px; height: 28px; border-radius: 50%; background: var(--navy); color: #fff; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }\n.toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 14px; }\n.toolbar .field { min-width: 160px; flex: 1; }\n.toolbar .grow { flex: 2; }\n\n/* ---------- ตาราง ---------- */\n.table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }\n.data-table { width: 100%; border-collapse: collapse; background: #fff; }\n.data-table th { text-align: left; font-size: .85rem; font-weight: 600; color: var(--muted); background: #F7F9FC; padding: 10px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; }\n.data-table td { padding: 10px 12px; border-bottom: 1px solid #EDF1F6; vertical-align: top; }\n.data-table tbody tr:hover { background: #FAFCFE; }\n.data-table tr.clickable { cursor: pointer; }\n.data-table .actions { white-space: nowrap; text-align: right; }\n.data-table .actions .btn + .btn { margin-left: 6px; }\n.empty { padding: 28px 16px; text-align: center; color: var(--muted); }\n.pager { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; flex-wrap: wrap; }\n\n/* ---------- หน้าต่าง (modal) ---------- */\n.modal-overlay { position: fixed; inset: 0; z-index: 60; background: rgba(18, 37, 64, .5); display: flex; align-items: flex-start; justify-content: center; padding: 6vh 16px 16px; overflow-y: auto; }\n.modal { width: 100%; max-width: 560px; background: #fff; border-radius: 12px; box-shadow: 0 24px 60px rgba(0, 0, 0, .3); }\n.modal-lg { max-width: 820px; }\n.modal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 20px; border-bottom: 1px solid var(--border); }\n.modal-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }\n.modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); background: #F9FBFD; border-radius: 0 0 12px 12px; flex-wrap: wrap; }\n.icon-btn { width: 36px; height: 36px; border: 0; background: transparent; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; color: var(--muted); }\n.icon-btn:hover { background: var(--blue-50); color: var(--navy); }\n.icon-btn svg { width: 20px; height: 20px; }\n.kv { width: 100%; border-collapse: collapse; font-size: .9rem; }\n.kv th, .kv td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #EDF1F6; vertical-align: top; word-break: break-word; }\n.kv th { color: var(--muted); font-weight: 600; width: 34%; }\n\n/* ---------- แจ้งเตือน (toast) ---------- */\n.toast-root { position: fixed; right: 20px; bottom: 20px; z-index: 80; display: flex; flex-direction: column; gap: 8px; max-width: min(420px, calc(100vw - 32px)); }\n.toast { padding: 12px 16px; border-radius: 8px; background: var(--navy-900); color: #fff; box-shadow: var(--shadow); line-height: 1.45; animation: toast-in .18s ease-out; }\n.toast-success { background: var(--success); }\n.toast-error { background: var(--danger); }\n@keyframes toast-in { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }\n\n/* ---------- มือถือและแท็บเล็ต ---------- */\n@media (max-width: 900px) {\n  .shell { grid-template-columns: minmax(0, 1fr); }\n  .sidebar { position: fixed; top: 0; bottom: 0; left: 0; width: min(300px, 86vw); height: auto; transform: translateX(-102%); transition: transform .2s ease; box-shadow: 0 0 40px rgba(0, 0, 0, .3); }\n  .shell.nav-open .sidebar { transform: none; }\n  .shell.nav-open .backdrop { display: block; position: fixed; inset: 0; z-index: 25; background: rgba(18, 37, 64, .45); }\n  .menu-toggle { display: inline-flex; }\n  .topbar { padding: 0 12px; }\n  .content { padding: 16px; }\n}\n@media (max-width: 640px) {\n  body { font-size: 15px; }\n  .form-grid { grid-template-columns: minmax(0, 1fr); }\n  .year-chip .chip-label { display: none; }\n  .toolbar .field { min-width: 100%; }\n  .data-table thead { display: none; }\n  .data-table, .data-table tbody, .data-table tr, .data-table td { display: block; width: 100%; }\n  .data-table tr { border: 1px solid var(--border); border-radius: var(--radius); margin: 0 0 10px; padding: 6px 12px; background: #fff; }\n  .data-table td { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 7px 0; border-bottom: 1px dashed #EDF1F6; text-align: right; }\n  .data-table td:last-child { border-bottom: 0; }\n  .data-table td::before { content: attr(data-label); color: var(--muted); font-weight: 600; text-align: left; flex-shrink: 0; max-width: 45%; }\n  .data-table .actions { justify-content: flex-end; flex-wrap: wrap; }\n  .data-table .actions::before { content: none; }\n  .table-wrap { overflow: visible; }\n  .card-body { padding: 14px; }\n  .modal-overlay { padding: 0; align-items: stretch; }\n  .modal { border-radius: 0; min-height: 100vh; max-width: none; }\n  .modal-foot { border-radius: 0; position: sticky; bottom: 0; }\n  .toast-root { left: 16px; right: 16px; bottom: 16px; max-width: none; }\n}\n\n/* ---------- พิมพ์ ---------- */\n@media print {\n  .sidebar, .topbar, .toolbar, .btn, .toast-root, .busy-bar, .backdrop { display: none !important; }\n  .shell { display: block; }\n  body { background: #fff; }\n  .card { box-shadow: none; border-color: #999; }\n  .content { padding: 0; max-width: none; }\n}\n</style>\n",
});
