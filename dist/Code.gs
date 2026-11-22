/**
 * ============================================================================
 *  ระบบบริหารจัดเก็บเงินบำรุงการศึกษา
 *  โรงเรียนวัดเสาหิน จังหวัดเชียงใหม่
 *  เวอร์ชัน 0.7.1 — ระยะที่ 7: Dashboard รายงาน และการสำรองข้อมูล
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
    .addItem('4) ตรวจความพร้อมของระบบบน Google (ไม่แก้ข้อมูลจริง)', 'menuPlatformCheck')
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

/** เมนู 4: ตรวจว่าบริการของ Google ที่ระบบใช้ทำงานถูกต้อง (ใช้ไฟล์ชั่วคราว แล้วย้ายไปถังขยะ) */
function menuPlatformCheck() {
  const ui = SpreadsheetApp.getUi();
  try {
    assertOwnerContext_();
    const result = platformCheck_();
    console.log('ผลการตรวจความพร้อมของระบบ\n' + formatPlatformCheck_(result));
    ui.alert('ผลการตรวจความพร้อมของระบบ', formatPlatformCheck_(result), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ตรวจไม่สำเร็จ', ownerErrorMessage_(e), ui.ButtonSet.OK);
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
    backupScheduleCreated: null,
    permissionsMissing: [],
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
  ensureDefaultBackupSchedule_(report);

  report.changed = report.propertiesInitialized.length > 0 ||
    report.settingsAdded.length > 0 ||
    report.academicYearCreated !== null ||
    report.backupScheduleCreated !== null ||
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
    backupScheduleCreated: report.backupScheduleCreated,
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
  if (report.backupScheduleCreated !== null) {
    lines.push('ตั้งเวลาสำรองข้อมูลอัตโนมัติทุกวัน เวลาประมาณ ' + backupHourLabel_(report.backupScheduleCreated) + ' (เปลี่ยนได้ในหน้า "สำรองข้อมูล")');
  }
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

/** ไฟล์หน้าจอแยกตามโมดูล (เพิ่มชื่อไฟล์ที่นี่เมื่อมีโมดูลใหม่) */
const VIEW_FILES_ = ['JsViews', 'JsStudents', 'JsFees', 'JsPayments', 'JsApprovals', 'JsArrears', 'JsDashboard', 'JsReports', 'JsBackup', 'JsIntegrity'];

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
  html = injectHtml_(html, '<!--@@VIEWS@@-->', VIEW_FILES_.map(htmlSource_).join('\n'));
  return html;
}

/** ค่าเริ่มต้นที่หน้าเว็บต้องรู้ก่อนเข้าสู่ระบบ (ไม่มีข้อมูลลับ) */
function bootConfig_() {
  let schoolName = APP.SCHOOL_NAME;
  let province = APP.PROVINCE;
  let allowRemember = true;
  try {
    schoolName = getSetting_('SCHOOL_NAME') || schoolName;
    province = getSetting_('SCHOOL_PROVINCE') || province;
    allowRemember = getSetting_('SESSION_ALLOW_REMEMBER') === true;
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
    allowRemember: allowRemember,
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
  const FINANCE = [ROLES.FINANCE];
  const STUDENT_VIEW = [ROLES.FINANCE, ROLES.DIRECTOR];
  const FINANCE_VIEW = [ROLES.FINANCE, ROLES.DIRECTOR];
  const DIRECTOR = [ROLES.DIRECTOR];
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
    // นักเรียน (ผู้ดูแลระบบไม่เห็นข้อมูลนักเรียน ตามหลักสิทธิ์น้อยที่สุด)
    'students.list': { roles: STUDENT_VIEW, write: false, handler: studentsList_ },
    'students.get': { roles: STUDENT_VIEW, write: false, handler: studentsGet_ },
    'students.create': { roles: FINANCE, write: true, handler: studentsCreate_ },
    'students.update': { roles: FINANCE, write: true, handler: studentsUpdate_ },
    'students.setStatus': { roles: FINANCE, write: true, handler: studentsSetStatus_ },
    'students.importPreview': { roles: FINANCE, write: false, handler: studentsImportPreview_ },
    'students.importCommit': { roles: FINANCE, write: true, handler: studentsImportCommit_ },
    'students.promotePreview': { roles: FINANCE, write: false, handler: studentsPromotePreview_ },
    'students.promoteCommit': { roles: FINANCE, write: true, handler: studentsPromoteCommit_ },
    // อัตราเงินบำรุงและรายการเรียกเก็บ (ผู้ดูแลระบบไม่เห็นข้อมูลการเงิน)
    'fees.list': { roles: FINANCE_VIEW, write: false, handler: feesList_ },
    'fees.create': { roles: FINANCE, write: true, handler: feesCreate_ },
    'fees.update': { roles: FINANCE, write: true, handler: feesUpdate_ },
    'assessments.list': { roles: FINANCE_VIEW, write: false, handler: assessmentsList_ },
    'assessments.preview': { roles: FINANCE, write: false, handler: assessmentsPreview_ },
    'assessments.generate': { roles: FINANCE, write: true, handler: assessmentsGenerate_ },
    'assessments.createOne': { roles: FINANCE, write: true, handler: assessmentsCreateOne_ },
    'assessments.requestCancel': { roles: FINANCE, write: true, handler: assessmentsRequestCancel_ },
    'adjustments.request': { roles: FINANCE, write: true, handler: adjustmentsRequest_ },
    'adjustments.revoke': { roles: DIRECTOR, write: true, handler: adjustmentsRevoke_ },
    // บัญชีการเงินของนักเรียน
    'ledger.students': { roles: FINANCE_VIEW, write: false, handler: ledgerStudents_ },
    'ledger.student': { roles: FINANCE_VIEW, write: false, handler: ledgerStudent_ },
    'arrears.summary': { roles: FINANCE_VIEW, write: false, handler: arrearsSummary_ },
    // คำขออนุมัติ: เจ้าหน้าที่ยื่น/ถอน ผู้อำนวยการพิจารณา
    'approvals.list': { roles: FINANCE_VIEW, write: false, handler: approvalsList_ },
    'approvals.decide': { roles: DIRECTOR, write: true, handler: approvalsDecide_ },
    'approvals.withdraw': { roles: FINANCE, write: true, handler: approvalsWithdraw_ },
    // ทะเบียนเล่มใบเสร็จ
    'receipts.books': { roles: FINANCE_VIEW, write: false, handler: receiptsBooks_ },
    'receipts.registerBook': { roles: FINANCE, write: true, handler: receiptsRegisterBook_ },
    'receipts.updateBook': { roles: FINANCE, write: true, handler: receiptsUpdateBook_ },
    'receipts.activateBook': { roles: FINANCE, write: true, handler: receiptsActivateBook_ },
    'receipts.book': { roles: FINANCE_VIEW, write: false, handler: receiptsBook_ },
    'receipts.requestCancelNumber': { roles: FINANCE, write: true, handler: receiptsRequestCancelNumber_ },
    'receipts.requestCloseBook': { roles: FINANCE, write: true, handler: receiptsRequestCloseBook_ },
    // รับชำระเงิน
    'payments.context': { roles: FINANCE, write: false, handler: paymentsContext_ },
    'payments.create': { roles: FINANCE, write: true, handler: paymentsCreate_ },
    'payments.list': { roles: FINANCE_VIEW, write: false, handler: paymentsList_ },
    'payments.get': { roles: FINANCE_VIEW, write: false, handler: paymentsGet_ },
    'payments.requestVoid': { roles: FINANCE, write: true, handler: paymentsRequestVoid_ },
    'payments.requestCorrection': { roles: FINANCE, write: true, handler: paymentsRequestCorrection_ },
    // ภาพรวม รายงาน และการปิดยอดประจำวัน
    'dashboard.summary': { roles: FINANCE_VIEW, write: false, handler: dashboardSummary_ },
    'reports.daily': { roles: FINANCE_VIEW, write: false, handler: reportsDaily_ },
    'reports.collections': { roles: FINANCE_VIEW, write: false, handler: reportsCollections_ },
    'reports.cancelled': { roles: FINANCE_VIEW, write: false, handler: reportsCancelled_ },
    'reports.annual': { roles: FINANCE_VIEW, write: false, handler: reportsAnnual_ },
    'reports.receiptUsage': { roles: FINANCE_VIEW, write: false, handler: reportsReceiptUsage_ },
    'reports.notices': { roles: FINANCE_VIEW, write: false, handler: reportsNotices_ },
    'closings.list': { roles: FINANCE_VIEW, write: false, handler: closingsList_ },
    'closings.close': { roles: FINANCE, write: true, handler: closingsClose_ },
    'closings.reopen': { roles: DIRECTOR, write: true, handler: closingsReopen_ },
    // สำรองและกู้คืนข้อมูล (ผู้ดูแลระบบ: เห็นเฉพาะรายชื่อไฟล์และจำนวนแถว ไม่เห็นรายละเอียดการเงิน)
    'backups.status': { roles: ADMIN, write: false, handler: backupsStatus_ },
    'backups.list': { roles: ADMIN, write: false, handler: backupsList_ },
    'backups.create': { roles: ADMIN, write: true, handler: backupsCreate_ },
    'backups.setSchedule': { roles: ADMIN, write: true, handler: backupsSetSchedule_ },
    'backups.restorePreview': { roles: ADMIN, write: false, handler: backupsRestorePreview_ },
    'backups.restore': { roles: ADMIN, write: true, handler: backupsRestore_ },
    // ตรวจความถูกต้องของข้อมูล (ตรวจภายใต้ lock และบันทึกประวัติ)
    'integrity.check': { roles: OVERSIGHT, write: true, handler: integrityCheck_ },
    'integrity.status': { roles: OVERSIGHT, write: false, handler: integrityStatus_ },
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
    allowRemember: getSetting_('SESSION_ALLOW_REMEMBER'),
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

/**
 * สร้าง session ใหม่
 * remember = ผู้ใช้เลือก "อยู่ในระบบต่อในเครื่องนี้" (ถ้าผู้ดูแลระบบอนุญาต): ไม่ออกจากระบบเพราะไม่ได้ใช้งาน
 * จนครบอายุสูงสุดของการเข้าสู่ระบบ (CacheService เก็บได้ไม่เกิน 6 ชั่วโมงนับจากการใช้งานครั้งล่าสุด)
 */
function createSession_(user, limits, remember) {
  const token = randomHex_(64).toLowerCase();
  const nowMs = now_().getTime();
  const remembered = !!remember && limits.allowRemember === true;
  const idleSeconds = Math.min(AUTH.CACHE_MAX_SECONDS, remembered ? limits.maxHours * 3600 : limits.idleMinutes * 60);
  const session = {
    uid: user.UserId,
    ver: user.SessionVersion || 0,
    ep: sessionEpoch_(),
    rem: remembered,
    created: nowMs,
    seen: nowMs,
    idle: idleSeconds,
    maxMs: limits.maxHours * 3600000,
  };
  CacheService.getScriptCache().put(sessionKey_(token), JSON.stringify(session), idleSeconds);
  return token;
}

/** ค่าที่เปลี่ยนเมื่อกู้คืนข้อมูล (session ที่สร้างก่อนหน้านั้นใช้ไม่ได้ทั้งหมด) */
function sessionEpoch_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_KEYS.SESSION_EPOCH) || '';
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
  if ((session.ep || '') !== sessionEpoch_()) {
    cache.remove(key);
    throw sessionExpiredError_('ผู้ดูแลระบบกู้คืนข้อมูลจากไฟล์สำรองแล้ว กรุณาเข้าสู่ระบบใหม่');
  }
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
    remember: session.rem === true,
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
function completeLogin_(user, rehashPassword, limits, remember) {
  const remembered = remember === true && limits.allowRemember === true;
  const changes = { LastLoginAt: nowIso_() };
  if (rehashPassword !== null) changes.PasswordHash = hashPassword_(rehashPassword);
  dbUpdate_(SHEETS.USERS, user.UserId, changes, actorFromUser_(user), { note: 'ปรับรูปแบบการเก็บรหัสผ่านอัตโนมัติ' });
  auditAppend_([{
    action: AUDIT_ACTIONS.LOGIN, entity: SHEETS.USERS, entityId: user.UserId,
    note: 'เข้าสู่ระบบสำเร็จ' + (remembered ? ' (เลือกอยู่ในระบบต่อในเครื่องนี้)' : ''),
  }], actorFromUser_(user));
  const fresh = dbGet_(SHEETS.USERS, user.UserId);
  return {
    token: createSession_(fresh, limits, remembered),
    remember: remembered,
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
  return completeLogin_(user, needsRehash ? password : null, limits, payload.remember === true);
}

/** auth.loginGoogle — โหมดบัญชี Google ของโรงเรียน (ใช้อีเมลที่ Google ยืนยันแล้ว) */
function authLoginGoogle_(ctx, payload) {
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
  return completeLogin_(user, null, authLimits_(), !!payload && payload.remember === true);
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
  return { token: createSession_(fresh, limits, ctx.remember), remember: ctx.remember === true && limits.allowRemember === true, user: userDto_(fresh), mustChangePassword: false };
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
// ไฟล์ต้นฉบับ: src/Students.js
// ============================================================================

/**
 * ============================================================================
 *  Students.gs — ข้อมูลนักเรียน และชั้นเรียนรายปีการศึกษา
 * ----------------------------------------------------------------------------
 *  - Students   เก็บข้อมูลที่ไม่เปลี่ยนตามปี (เลขประจำตัว ชื่อ สถานะปัจจุบัน)
 *  - Enrollments เก็บชั้น ห้อง เลขที่ แยกตามปีการศึกษา → ขึ้นปีใหม่แล้วข้อมูลปีเก่ายังอยู่ครบ
 *  - ไม่มีการลบนักเรียน ใช้สถานะ ย้ายออก / จบการศึกษา แทน
 *  - ชื่อซ้ำกับนักเรียนเดิมต้องยืนยันก่อนบันทึก (ห้ามบันทึกซ้ำโดยไม่แจ้งเตือน)
 *  - สิทธิ์: เจ้าหน้าที่การเงินจัดการได้ ผู้อำนวยการดูได้ (ตรวจใน Api.gs)
 * ============================================================================
 */

const STUDENT_PREFIX_SUGGESTIONS = Object.freeze(['เด็กชาย', 'เด็กหญิง', 'นาย', 'นางสาว', 'ด.ช.', 'ด.ญ.']);

// ---------------------------------------------------------------------------
// ตัวช่วย
// ---------------------------------------------------------------------------

function gradeLevels_() {
  return getSetting_('GRADE_LEVELS');
}

/** ปีการศึกษาที่มีอยู่ในระบบ (mustBeOpen = ต้องยังไม่ปิด) */
function requireAcademicYear_(value, options) {
  const opt = options || {};
  const year = requireInt_(value, 'ปีการศึกษา', { min: 2500, max: 2700 });
  const record = dbFindOne_(SHEETS.ACADEMIC_YEARS, function (r) { return r.Year === year; });
  if (!record) {
    throw appError_(ERROR_CODES.VALIDATION, 'ไม่พบปีการศึกษา ' + year + ' ในระบบ กรุณาให้ผู้ดูแลระบบเพิ่มปีการศึกษาก่อน');
  }
  if (opt.mustBeOpen && record.Status !== STATUS.ACADEMIC_YEAR.OPEN) {
    throw appError_(ERROR_CODES.CONFLICT, 'ปีการศึกษา ' + year + ' ปิดแล้ว แก้ไขข้อมูลชั้นเรียนของปีนี้ไม่ได้');
  }
  return year;
}

function currentAcademicYear_() {
  return getSetting_('CURRENT_ACADEMIC_YEAR');
}

/** ตรวจและแปลงข้อมูลนักเรียนที่กรอก (ใช้ทั้งการเพิ่ม แก้ไข และนำเข้า) */
function validateStudentInput_(payload, levels) {
  const studentNo = requireText_(String(payload.studentNo === undefined || payload.studentNo === null ? '' : payload.studentNo).replace(/\s+/g, ''),
    'เลขประจำตัวนักเรียน', { max: 20, pattern: /^[0-9A-Za-z\-\/]+$/, patternMessage: 'เลขประจำตัวนักเรียนใช้ได้เฉพาะตัวเลข ตัวอักษรภาษาอังกฤษ - และ /' });
  const gradeText = requireText_(payload.gradeLevel, 'ระดับชั้น', { max: 40 });
  const gradeLevel = normalizeGradeLevel_(gradeText, levels);
  if (!gradeLevel) {
    throw validationError_('ระดับชั้น "' + gradeText + '" ไม่อยู่ในรายการระดับชั้นที่เปิดสอน (' + levels.join(', ') + ')');
  }
  const room = normalizeRoom_(requireText_(payload.room, 'ห้อง', { optional: true, max: 20 }));
  if (room.length > 10) throw validationError_('ห้องยาวเกิน 10 ตัวอักษร');
  return {
    studentNo: studentNo,
    prefix: requireText_(payload.prefix, 'คำนำหน้าชื่อ', { optional: true, max: 20 }),
    firstName: requireText_(payload.firstName, 'ชื่อ', { max: 100 }),
    lastName: requireText_(payload.lastName, 'นามสกุล', { optional: true, max: 100 }),
    gradeLevel: gradeLevel,
    room: room,
    classNo: requireInt_(payload.classNo, 'เลขที่', { optional: true, min: 1, max: 999 }),
  };
}

function nameKey_(firstName, lastName) {
  return cleanText_(firstName).replace(/\s+/g, '') + '|' + cleanText_(lastName).replace(/\s+/g, '');
}

function classLabel_(gradeLevel, room) {
  return room ? gradeLevel + '/' + room : gradeLevel;
}

/** เลขที่ต้องไม่ซ้ำกับนักเรียนที่กำลังศึกษาในห้องเดียวกันของปีเดียวกัน */
function assertClassNoFree_(year, gradeLevel, room, classNo, exceptStudentId) {
  if (classNo === null || classNo === undefined) return;
  const clash = dbFindOne_(SHEETS.ENROLLMENTS, function (e) {
    return e.AcademicYear === year && e.GradeLevel === gradeLevel && e.Room === room && e.ClassNo === classNo &&
      e.EnrollStatus === STATUS.STUDENT.STUDYING && e.StudentId !== exceptStudentId;
  });
  if (clash) {
    const other = dbGet_(SHEETS.STUDENTS, clash.StudentId);
    throw appError_(ERROR_CODES.CONFLICT, 'เลขที่ ' + classNo + ' ของชั้น ' + classLabel_(gradeLevel, room) + ' ปีการศึกษา ' + year +
      ' เป็นของ ' + (other ? studentDisplayName_(other.Prefix, other.FirstName, other.LastName) : 'นักเรียนคนอื่น') + ' แล้ว');
  }
}

function enrollmentOf_(studentId, year) {
  return dbFindOne_(SHEETS.ENROLLMENTS, function (e) { return e.StudentId === studentId && e.AcademicYear === year; });
}

function studentDto_(s, e) {
  return {
    studentId: s.StudentId,
    studentNo: s.StudentNo,
    prefix: s.Prefix,
    firstName: s.FirstName,
    lastName: s.LastName,
    fullName: studentDisplayName_(s.Prefix, s.FirstName, s.LastName),
    status: s.Status,
    statusLabel: STATUS_LABELS.STUDENT[s.Status] || s.Status,
    statusDate: s.StatusDate,
    statusNote: s.StatusNote,
    year: e ? e.AcademicYear : null,
    enrollmentId: e ? e.EnrollmentId : '',
    gradeLevel: e ? e.GradeLevel : '',
    room: e ? e.Room : '',
    classLabel: e ? classLabel_(e.GradeLevel, e.Room) : '',
    classNo: e ? e.ClassNo : null,
    enrollStatus: e ? e.EnrollStatus : '',
    enrollStatusLabel: e ? (STATUS_LABELS.STUDENT[e.EnrollStatus] || e.EnrollStatus) : '',
  };
}

function compareText_(a, b) {
  try { return String(a).localeCompare(String(b), 'th'); } catch (err) { return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0); }
}

function compareRoom_(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
  return compareText_(a, b);
}

/** เรียง: ลำดับระดับชั้นตามการตั้งค่า → ห้อง → เลขที่ → ชื่อ */
function compareStudentRows_(levels) {
  return function (x, y) {
    const gx = levels.indexOf(x.gradeLevel);
    const gy = levels.indexOf(y.gradeLevel);
    if (gx !== gy) return (gx === -1 ? 999 : gx) - (gy === -1 ? 999 : gy);
    const r = compareRoom_(x.room, y.room);
    if (r !== 0) return r;
    const cx = x.classNo === null ? 99999 : x.classNo;
    const cy = y.classNo === null ? 99999 : y.classNo;
    if (cx !== cy) return cx - cy;
    return compareText_(x.firstName, y.firstName);
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * students.list — รายชื่อนักเรียนของปีการศึกษาหนึ่ง (ทุกสถานะ หน้าเว็บกรองและค้นหาต่อเอง)
 * payload: { year }
 */
function studentsList_(ctx, payload) {
  const year = payload.year === undefined || payload.year === null || payload.year === ''
    ? currentAcademicYear_()
    : requireAcademicYear_(payload.year);
  const levels = gradeLevels_();
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const rows = dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === year; })
    .filter(function (e) { return students[e.StudentId]; })
    .map(function (e) { return studentDto_(students[e.StudentId], e); })
    .sort(compareStudentRows_(levels));
  const rooms = Object.create(null);
  rows.forEach(function (r) {
    rooms[r.gradeLevel] = rooms[r.gradeLevel] || [];
    if (r.room && rooms[r.gradeLevel].indexOf(r.room) === -1) rooms[r.gradeLevel].push(r.room);
  });
  Object.keys(rooms).forEach(function (k) { rooms[k].sort(compareRoom_); });
  return {
    year: year,
    gradeLevels: levels,
    rooms: rooms,
    prefixSuggestions: STUDENT_PREFIX_SUGGESTIONS.slice(),
    rows: rows,
  };
}

/** students.get — ข้อมูลนักเรียนพร้อมประวัติชั้นเรียนทุกปี */
function studentsGet_(ctx, payload) {
  const id = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const s = dbGet_(SHEETS.STUDENTS, id);
  if (!s) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const enrollments = dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.StudentId === id; })
    .sort(function (a, b) { return b.AcademicYear - a.AcademicYear; });
  return {
    student: studentDto_(s, enrollments[0] || null),
    enrollments: enrollments.map(function (e) {
      return {
        enrollmentId: e.EnrollmentId,
        year: e.AcademicYear,
        gradeLevel: e.GradeLevel,
        room: e.Room,
        classLabel: classLabel_(e.GradeLevel, e.Room),
        classNo: e.ClassNo,
        enrollStatus: e.EnrollStatus,
        enrollStatusLabel: STATUS_LABELS.STUDENT[e.EnrollStatus] || e.EnrollStatus,
        note: e.Note,
      };
    }),
  };
}

/**
 * students.create — เพิ่มนักเรียน 1 คน พร้อมชั้นเรียนของปีการศึกษาที่เลือก
 * ชื่อซ้ำกับนักเรียนเดิม: ต้องส่ง confirmDuplicateName = true มาอีกครั้ง
 */
function studentsCreate_(ctx, payload) {
  const levels = gradeLevels_();
  const input = validateStudentInput_(payload, levels);
  const year = requireAcademicYear_(payload.year === undefined || payload.year === '' ? currentAcademicYear_() : payload.year, { mustBeOpen: true });
  const sameNo = dbFindOne_(SHEETS.STUDENTS, function (s) { return String(s.StudentNo).toUpperCase() === input.studentNo.toUpperCase(); });
  if (sameNo) {
    throw appError_(ERROR_CODES.CONFLICT, 'เลขประจำตัว ' + input.studentNo + ' เป็นของ ' +
      studentDisplayName_(sameNo.Prefix, sameNo.FirstName, sameNo.LastName) + ' อยู่แล้ว');
  }
  if (payload.confirmDuplicateName !== true) {
    const key = nameKey_(input.firstName, input.lastName);
    const sameName = dbFindOne_(SHEETS.STUDENTS, function (s) { return nameKey_(s.FirstName, s.LastName) === key; });
    if (sameName) {
      throw appError_(ERROR_CODES.CONFLICT, 'มีนักเรียนชื่อ ' + studentDisplayName_(sameName.Prefix, sameName.FirstName, sameName.LastName) +
        ' อยู่แล้ว (เลขประจำตัว ' + sameName.StudentNo + ') ถ้าเป็นคนละคน กรุณายืนยันอีกครั้ง', { reason: 'NAME_DUPLICATE' });
    }
  }
  assertClassNoFree_(year, input.gradeLevel, input.room, input.classNo, null);
  const actor = actorFromCtx_(ctx);
  const student = dbInsert_(SHEETS.STUDENTS, {
    StudentNo: input.studentNo,
    Prefix: input.prefix,
    FirstName: input.firstName,
    LastName: input.lastName,
    Status: STATUS.STUDENT.STUDYING,
  }, actor);
  const enrollment = dbInsert_(SHEETS.ENROLLMENTS, {
    StudentId: student.StudentId,
    AcademicYear: year,
    GradeLevel: input.gradeLevel,
    Room: input.room,
    ClassNo: input.classNo,
    EnrollStatus: STATUS.STUDENT.STUDYING,
  }, actor);
  return studentDto_(student, enrollment);
}

/**
 * students.update — แก้ไขข้อมูลนักเรียน และชั้นเรียนของปีการศึกษาที่เลือก
 * (ถ้ายังไม่มีชั้นเรียนในปีนั้น จะเพิ่มให้)
 */
function studentsUpdate_(ctx, payload) {
  const id = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const student = dbGet_(SHEETS.STUDENTS, id);
  if (!student) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const input = validateStudentInput_(payload, gradeLevels_());
  const year = requireAcademicYear_(payload.year, { mustBeOpen: true });
  const sameNo = dbFindOne_(SHEETS.STUDENTS, function (s) {
    return s.StudentId !== id && String(s.StudentNo).toUpperCase() === input.studentNo.toUpperCase();
  });
  if (sameNo) {
    throw appError_(ERROR_CODES.CONFLICT, 'เลขประจำตัว ' + input.studentNo + ' เป็นของ ' +
      studentDisplayName_(sameNo.Prefix, sameNo.FirstName, sameNo.LastName) + ' อยู่แล้ว');
  }
  assertClassNoFree_(year, input.gradeLevel, input.room, input.classNo, id);
  const actor = actorFromCtx_(ctx);
  const updated = dbUpdate_(SHEETS.STUDENTS, id, {
    StudentNo: input.studentNo,
    Prefix: input.prefix,
    FirstName: input.firstName,
    LastName: input.lastName,
  }, actor).after;
  const existing = enrollmentOf_(id, year);
  let enrollment;
  if (existing) {
    enrollment = dbUpdate_(SHEETS.ENROLLMENTS, existing.EnrollmentId, {
      GradeLevel: input.gradeLevel,
      Room: input.room,
      ClassNo: input.classNo,
    }, actor).after;
  } else {
    enrollment = dbInsert_(SHEETS.ENROLLMENTS, {
      StudentId: id,
      AcademicYear: year,
      GradeLevel: input.gradeLevel,
      Room: input.room,
      ClassNo: input.classNo,
      EnrollStatus: student.Status === STATUS.STUDENT.STUDYING ? STATUS.STUDENT.STUDYING : student.Status,
    }, actor);
  }
  return studentDto_(updated, enrollment);
}

/**
 * students.setStatus — เปลี่ยนสถานะ กำลังศึกษา / ย้ายออก / จบการศึกษา
 * payload: { studentId, year, status, statusDate, note }
 * ยอดค้างชำระของนักเรียน (ระยะที่ 4–6) ไม่ถูกลบเมื่อย้ายออกหรือจบการศึกษา
 */
function studentsSetStatus_(ctx, payload) {
  const id = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const student = dbGet_(SHEETS.STUDENTS, id);
  if (!student) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const status = requireEnum_(payload.status, STATUS.STUDENT, 'สถานะ');
  const statusDate = requireIsoDate_(payload.statusDate, 'วันที่เปลี่ยนสถานะ');
  const note = requireText_(payload.note, 'หมายเหตุ', { optional: true, max: 300, multiline: true });
  if (status !== STATUS.STUDENT.STUDYING && !note) {
    throw validationError_('กรุณาระบุหมายเหตุ เช่น ย้ายไปโรงเรียนใด หรือจบการศึกษาเมื่อใด');
  }
  const year = requireAcademicYear_(payload.year, { mustBeOpen: true });
  const actor = actorFromCtx_(ctx);
  const label = STATUS_LABELS.STUDENT[status];
  const after = dbUpdate_(SHEETS.STUDENTS, id, { Status: status, StatusDate: statusDate, StatusNote: note }, actor,
    { note: 'เปลี่ยนสถานะเป็น' + label }).after;
  let enrollment = enrollmentOf_(id, year);
  if (enrollment) {
    if (status === STATUS.STUDENT.STUDYING) assertClassNoFree_(year, enrollment.GradeLevel, enrollment.Room, enrollment.ClassNo, id);
    enrollment = dbUpdate_(SHEETS.ENROLLMENTS, enrollment.EnrollmentId, { EnrollStatus: status }, actor,
      { note: 'เปลี่ยนสถานะเป็น' + label }).after;
  }
  return studentDto_(after, enrollment);
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/StudentImport.js
// ============================================================================

/**
 * ============================================================================
 *  StudentImport.gs — นำเข้ารายชื่อนักเรียน (Excel/CSV) และเลื่อนชั้นขึ้นปีการศึกษาใหม่
 * ----------------------------------------------------------------------------
 *  นำเข้า 2 ขั้นตอน: ตรวจสอบ (ไม่บันทึกอะไร) → ยืนยันนำเข้า (ตรวจซ้ำทั้งหมดภายใต้ lock ก่อนบันทึก)
 *  ทุกแถวถูกจัดประเภท และบันทึกเฉพาะประเภทที่ปลอดภัย เว้นแต่ผู้ใช้เลือกเอง:
 *   NEW               นักเรียนใหม่                              → เพิ่ม
 *   ENROLL            นักเรียนเดิมที่ยังไม่มีชั้นเรียนในปีนี้        → เพิ่มชั้นเรียน
 *   SAME              ตรงกับในระบบทุกอย่าง                      → ไม่ทำอะไร
 *   UPDATE            นักเรียนเดิม แต่ชั้น/ห้อง/เลขที่ต่าง          → ปรับปรุงเมื่อเลือก "ปรับปรุงข้อมูลเดิม"
 *   CONFLICT          เลขประจำตัวมีแล้ว แต่ชื่อต่างจากในระบบ       → ปรับปรุงเมื่อเลือก "ปรับปรุงข้อมูลเดิม"
 *   NAME_DUPLICATE    ชื่อซ้ำกับนักเรียนเดิม แต่เลขประจำตัวต่าง      → เพิ่มเมื่อเลือก "ยืนยันว่าเป็นคนละคน"
 *   DUPLICATE_IN_FILE เลขประจำตัวซ้ำกันเองในไฟล์                 → ข้าม
 *   INVALID           ข้อมูลไม่ครบหรือไม่ถูกต้อง หรือเลขที่ซ้ำ       → ข้าม
 *  การนำเข้าไฟล์เดิมซ้ำจะไม่เกิดข้อมูลซ้ำ (แถวที่บันทึกแล้วจะเป็น SAME)
 * ============================================================================
 */

const IMPORT_MAX_ROWS = 1500;
const IMPORT_STATUS_LABELS = Object.freeze({
  NEW: 'นักเรียนใหม่',
  ENROLL: 'นักเรียนเดิม: เพิ่มชั้นเรียนปีนี้',
  SAME: 'ไม่มีการเปลี่ยนแปลง',
  UPDATE: 'นักเรียนเดิม: ข้อมูลต่างจากในระบบ',
  CONFLICT: 'เลขประจำตัวซ้ำ แต่ชื่อต่างจากในระบบ',
  NAME_DUPLICATE: 'ชื่อซ้ำกับนักเรียนเดิม',
  DUPLICATE_IN_FILE: 'เลขประจำตัวซ้ำในไฟล์',
  INVALID: 'ข้อมูลไม่ถูกต้อง',
});

function importOptions_(payload) {
  return {
    updateExisting: payload.updateExisting === true,
    acceptNameDuplicates: payload.acceptNameDuplicates === true,
  };
}

/** แถวนี้จะถูกบันทึกหรือไม่ ตามตัวเลือกของผู้ใช้ */
function importRowApplies_(item, options) {
  switch (item.status) {
    case 'NEW':
    case 'ENROLL':
      return true;
    case 'UPDATE':
    case 'CONFLICT':
      return options.updateExisting;
    case 'NAME_DUPLICATE':
      return options.acceptNameDuplicates;
    default:
      return false;
  }
}

function importRawText_(v) {
  return v === null || v === undefined ? '' : String(v);
}

/** ตรวจและจัดประเภททุกแถว (ไม่บันทึกอะไร) */
function analyzeImport_(year, rawRows, options) {
  if (!Array.isArray(rawRows) || !rawRows.length) throw validationError_('ไม่พบข้อมูลที่จะนำเข้า');
  if (rawRows.length > IMPORT_MAX_ROWS) throw validationError_('นำเข้าได้ครั้งละไม่เกิน ' + IMPORT_MAX_ROWS.toLocaleString() + ' แถว');
  const levels = gradeLevels_();
  const byNo = Object.create(null);
  const byName = Object.create(null);
  const studentsById = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) {
    studentsById[s.StudentId] = s;
    byNo[String(s.StudentNo).toUpperCase()] = s;
    const key = nameKey_(s.FirstName, s.LastName);
    (byName[key] = byName[key] || []).push(s);
  });
  const yearEnrollments = dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === year; });
  const enrollmentByStudent = Object.create(null);
  yearEnrollments.forEach(function (e) { enrollmentByStudent[e.StudentId] = e; });
  const seenNo = Object.create(null);

  const items = rawRows.map(function (raw, i) {
    const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const item = {
      rowNo: Number.isInteger(row.rowNo) && row.rowNo > 0 ? row.rowNo : i + 1,
      status: '',
      messages: [],
      changes: [],
      data: null,
      existing: null,
    };
    let prefix = importRawText_(row.prefix);
    let firstName = importRawText_(row.firstName);
    let lastName = importRawText_(row.lastName);
    if (!cleanText_(firstName) && cleanText_(row.fullName)) {
      const split = splitThaiFullName_(cleanText_(row.fullName));
      prefix = cleanText_(prefix) || split.prefix;
      firstName = split.firstName;
      lastName = split.lastName;
    }
    let gradeLevel = importRawText_(row.gradeLevel);
    let room = importRawText_(row.room);
    if (!cleanText_(gradeLevel) && cleanText_(row.gradeRoom)) {
      const parts = cleanText_(row.gradeRoom).split('/');
      gradeLevel = parts[0];
      room = cleanText_(room) || parts[1] || '';
    }
    let data;
    try {
      data = validateStudentInput_({ studentNo: row.studentNo, prefix: prefix, firstName: firstName, lastName: lastName,
        gradeLevel: gradeLevel, room: room, classNo: row.classNo }, levels);
    } catch (e) {
      if (!isAppError_(e)) throw e;
      item.status = 'INVALID';
      item.messages.push(e.userMessage);
      item.data = {
        studentNo: cleanText_(row.studentNo), prefix: cleanText_(prefix), firstName: cleanText_(firstName), lastName: cleanText_(lastName),
        gradeLevel: cleanText_(gradeLevel), room: cleanText_(room), classNo: cleanText_(row.classNo),
      };
      return item;
    }
    item.data = data;
    const noKey = data.studentNo.toUpperCase();
    if (seenNo[noKey]) {
      item.status = 'DUPLICATE_IN_FILE';
      item.messages.push('เลขประจำตัวซ้ำกับแถวที่ ' + seenNo[noKey] + ' ในไฟล์');
      return item;
    }
    seenNo[noKey] = item.rowNo;

    const existing = byNo[noKey];
    if (existing) {
      item.existing = {
        studentId: existing.StudentId,
        fullName: studentDisplayName_(existing.Prefix, existing.FirstName, existing.LastName),
        status: existing.Status,
      };
      if (nameKey_(existing.FirstName, existing.LastName) !== nameKey_(data.firstName, data.lastName)) {
        item.status = 'CONFLICT';
        item.messages.push('เลขประจำตัวนี้ในระบบเป็นของ ' + item.existing.fullName);
        item.changes.push('ชื่อ ' + item.existing.fullName + ' → ' + studentDisplayName_(data.prefix, data.firstName, data.lastName));
      } else if (data.prefix && data.prefix !== existing.Prefix) {
        item.changes.push('คำนำหน้า ' + (existing.Prefix || '–') + ' → ' + data.prefix);
      }
      const enrollment = enrollmentByStudent[existing.StudentId];
      if (!enrollment) {
        item.changes.push('เพิ่มชั้นเรียน ' + classLabel_(data.gradeLevel, data.room) + ' ปีการศึกษา ' + year);
        if (!item.status) item.status = item.changes.length > 1 ? 'UPDATE' : 'ENROLL';
      } else {
        if (enrollment.GradeLevel !== data.gradeLevel || enrollment.Room !== data.room) {
          item.changes.push('ชั้น ' + classLabel_(enrollment.GradeLevel, enrollment.Room) + ' → ' + classLabel_(data.gradeLevel, data.room));
        }
        if (enrollment.ClassNo !== data.classNo) {
          item.changes.push('เลขที่ ' + (enrollment.ClassNo === null ? '–' : enrollment.ClassNo) + ' → ' + (data.classNo === null ? '–' : data.classNo));
        }
        if (!item.status) item.status = item.changes.length ? 'UPDATE' : 'SAME';
      }
      if (existing.Status !== STATUS.STUDENT.STUDYING) {
        item.messages.push('สถานะในระบบ: ' + STATUS_LABELS.STUDENT[existing.Status]);
      }
      return item;
    }
    const sameName = byName[nameKey_(data.firstName, data.lastName)];
    if (sameName && sameName.length) {
      item.status = 'NAME_DUPLICATE';
      item.messages.push('ชื่อซ้ำกับ ' + studentDisplayName_(sameName[0].Prefix, sameName[0].FirstName, sameName[0].LastName) +
        ' (เลขประจำตัว ' + sameName[0].StudentNo + ') ตรวจให้แน่ใจว่าเป็นคนละคน');
    } else {
      item.status = 'NEW';
    }
    return item;
  });

  markClassNoConflicts_(year, items, options, yearEnrollments, studentsById);
  return items;
}

/**
 * เลขที่ต้องไม่ซ้ำในห้องเดียวกันหลังนำเข้า
 * - ค่าที่จะยังอยู่ในระบบ (นักเรียนที่ไม่ได้ถูกปรับปรุงในการนำเข้านี้) ถือเป็นค่าที่จองแล้ว
 * - แถวที่จะบันทึก ไล่ตามลำดับในไฟล์ แถวหลังที่ซ้ำจะถูกเปลี่ยนเป็น INVALID
 */
function markClassNoConflicts_(year, items, options, yearEnrollments, studentsById) {
  const changing = Object.create(null);
  items.forEach(function (it) {
    if (it.existing && (it.status === 'UPDATE' || it.status === 'CONFLICT') && options.updateExisting) changing[it.existing.studentId] = true;
  });
  const occupied = Object.create(null);
  const slot = function (grade, room, no) { return grade + '|' + room + '|' + no; };
  yearEnrollments.forEach(function (e) {
    if (e.ClassNo === null || e.EnrollStatus !== STATUS.STUDENT.STUDYING || changing[e.StudentId]) return;
    const s = studentsById[e.StudentId];
    occupied[slot(e.GradeLevel, e.Room, e.ClassNo)] = s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) + ' (ในระบบ)' : 'นักเรียนในระบบ';
  });
  items.forEach(function (it) {
    if (!importRowApplies_(it, options) || !it.data || it.data.classNo === null) return;
    if (it.status === 'SAME') return;
    const key = slot(it.data.gradeLevel, it.data.room, it.data.classNo);
    if (occupied[key]) {
      it.status = 'INVALID';
      it.messages.push('เลขที่ ' + it.data.classNo + ' ของชั้น ' + classLabel_(it.data.gradeLevel, it.data.room) + ' ซ้ำกับ ' + occupied[key]);
      return;
    }
    occupied[key] = 'แถวที่ ' + it.rowNo + ' ในไฟล์';
  });
}

function importCounts_(items, options) {
  const counts = { total: items.length, apply: 0 };
  Object.keys(IMPORT_STATUS_LABELS).forEach(function (k) { counts[k] = 0; });
  items.forEach(function (it) {
    counts[it.status] += 1;
    if (importRowApplies_(it, options)) counts.apply += 1;
  });
  return counts;
}

/**
 * students.importPreview — ตรวจข้อมูลที่จะนำเข้า (ไม่บันทึก)
 * payload: { year, rows: [{ rowNo, studentNo, prefix, firstName, lastName, fullName, gradeLevel, room, gradeRoom, classNo }],
 *            updateExisting, acceptNameDuplicates }
 */
function studentsImportPreview_(ctx, payload) {
  const year = requireAcademicYear_(payload.year, { mustBeOpen: true });
  const options = importOptions_(payload);
  const items = analyzeImport_(year, payload.rows, options);
  return {
    year: year,
    options: options,
    counts: importCounts_(items, options),
    labels: IMPORT_STATUS_LABELS,
    rows: items.map(function (it) {
      return {
        rowNo: it.rowNo,
        status: it.status,
        statusLabel: IMPORT_STATUS_LABELS[it.status],
        applies: importRowApplies_(it, options),
        messages: it.messages,
        changes: it.changes,
        studentNo: it.data ? it.data.studentNo : '',
        fullName: it.data ? studentDisplayName_(it.data.prefix, it.data.firstName, it.data.lastName) : '',
        classLabel: it.data && it.data.gradeLevel ? classLabel_(it.data.gradeLevel, it.data.room) : '',
        classNo: it.data ? it.data.classNo : null,
        existingName: it.existing ? it.existing.fullName : '',
      };
    }),
  };
}

/** students.importCommit — ตรวจซ้ำทั้งหมดภายใต้ lock แล้วบันทึกเฉพาะแถวที่ผ่าน */
function studentsImportCommit_(ctx, payload) {
  const year = requireAcademicYear_(payload.year, { mustBeOpen: true });
  const options = importOptions_(payload);
  const fileName = requireText_(payload.fileName, 'ชื่อไฟล์', { optional: true, max: 200 });
  const items = analyzeImport_(year, payload.rows, options);
  const actor = actorFromCtx_(ctx);
  const note = 'นำเข้าข้อมูลนักเรียน ปีการศึกษา ' + year + (fileName ? ' จาก ' + fileName : '');
  const result = { year: year, created: 0, enrolled: 0, updated: 0, unchanged: 0, skipped: 0 };

  const toCreate = items.filter(function (it) {
    return importRowApplies_(it, options) && (it.status === 'NEW' || it.status === 'NAME_DUPLICATE');
  });
  const created = dbInsertMany_(SHEETS.STUDENTS, toCreate.map(function (it) {
    return { StudentNo: it.data.studentNo, Prefix: it.data.prefix, FirstName: it.data.firstName, LastName: it.data.lastName, Status: STATUS.STUDENT.STUDYING };
  }), actor, { action: AUDIT_ACTIONS.IMPORT, note: note });
  result.created = created.length;

  const newEnrollments = created.map(function (s, i) {
    const d = toCreate[i].data;
    return { StudentId: s.StudentId, AcademicYear: year, GradeLevel: d.gradeLevel, Room: d.room, ClassNo: d.classNo, EnrollStatus: STATUS.STUDENT.STUDYING };
  });

  items.forEach(function (it) {
    if (!importRowApplies_(it, options) || !it.existing) return;
    const d = it.data;
    const studentId = it.existing.studentId;
    const student = dbGet_(SHEETS.STUDENTS, studentId);
    const enrollment = enrollmentOf_(studentId, year);
    let changed = false;
    if (it.status === 'UPDATE' || it.status === 'CONFLICT') {
      const res = dbUpdate_(SHEETS.STUDENTS, studentId, { Prefix: d.prefix || student.Prefix, FirstName: d.firstName, LastName: d.lastName },
        actor, { action: AUDIT_ACTIONS.IMPORT, note: note });
      changed = res.changed.length > 0;
    }
    if (enrollment) {
      const res = dbUpdate_(SHEETS.ENROLLMENTS, enrollment.EnrollmentId, { GradeLevel: d.gradeLevel, Room: d.room, ClassNo: d.classNo },
        actor, { action: AUDIT_ACTIONS.IMPORT, note: note });
      changed = changed || res.changed.length > 0;
      if (changed) result.updated += 1;
    } else {
      newEnrollments.push({ StudentId: studentId, AcademicYear: year, GradeLevel: d.gradeLevel, Room: d.room, ClassNo: d.classNo, EnrollStatus: student.Status });
      if (it.status === 'ENROLL') result.enrolled += 1;
      else result.updated += 1;
    }
  });
  dbInsertMany_(SHEETS.ENROLLMENTS, newEnrollments, actor, { action: AUDIT_ACTIONS.IMPORT, note: note });

  items.forEach(function (it) {
    if (it.status === 'SAME') result.unchanged += 1;
    else if (!importRowApplies_(it, options)) result.skipped += 1;
  });
  auditAppend_([{
    action: AUDIT_ACTIONS.IMPORT,
    entity: SHEETS.STUDENTS,
    entityId: '',
    after: { year: year, fileName: fileName, rows: items.length, created: result.created, enrolled: result.enrolled,
      updated: result.updated, unchanged: result.unchanged, skipped: result.skipped },
    note: note + ': เพิ่มใหม่ ' + result.created + ' คน, เพิ่มชั้นเรียน ' + result.enrolled + ' คน, ปรับปรุง ' + result.updated +
      ' คน, ไม่เปลี่ยนแปลง ' + result.unchanged + ' คน, ข้าม ' + result.skipped + ' แถว',
  }], actor);
  return result;
}

// ---------------------------------------------------------------------------
// เลื่อนชั้นขึ้นปีการศึกษาใหม่
// ---------------------------------------------------------------------------

/**
 * วางแผนเลื่อนชั้น: นักเรียนที่กำลังศึกษาในปีเดิม → ชั้นถัดไปตามลำดับในตั้งค่า GRADE_LEVELS
 * ชั้นสุดท้าย → จบการศึกษา / มีชั้นเรียนในปีใหม่แล้ว → ข้าม (รันซ้ำได้ไม่เกิดข้อมูลซ้ำ)
 */
function promotionPlan_(fromYear, toYear) {
  const levels = gradeLevels_();
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const targetHas = Object.create(null);
  const occupied = Object.create(null);
  dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === toYear; }).forEach(function (e) {
    targetHas[e.StudentId] = true;
    if (e.ClassNo !== null && e.EnrollStatus === STATUS.STUDENT.STUDYING) occupied[e.GradeLevel + '|' + e.Room + '|' + e.ClassNo] = true;
  });
  return dbFind_(SHEETS.ENROLLMENTS, function (e) {
    return e.AcademicYear === fromYear && e.EnrollStatus === STATUS.STUDENT.STUDYING &&
      students[e.StudentId] && students[e.StudentId].Status === STATUS.STUDENT.STUDYING;
  }).map(function (e) {
    const s = students[e.StudentId];
    const item = {
      studentId: s.StudentId,
      enrollmentId: e.EnrollmentId,
      studentNo: s.StudentNo,
      fullName: studentDisplayName_(s.Prefix, s.FirstName, s.LastName),
      fromGrade: e.GradeLevel,
      room: e.Room,
      classNo: e.ClassNo,
      action: '',
      toGrade: '',
      reason: '',
      classNoCleared: false,
    };
    const idx = levels.indexOf(e.GradeLevel);
    if (targetHas[s.StudentId]) {
      item.action = 'SKIP';
      item.reason = 'มีข้อมูลชั้นเรียนปีการศึกษา ' + toYear + ' แล้ว';
    } else if (idx === -1) {
      item.action = 'SKIP';
      item.reason = 'ระดับชั้น ' + e.GradeLevel + ' ไม่อยู่ในรายการระดับชั้นที่เปิดสอน';
    } else if (idx === levels.length - 1) {
      item.action = 'GRADUATE';
    } else {
      item.action = 'PROMOTE';
      item.toGrade = levels[idx + 1];
      if (item.classNo !== null) {
        const key = item.toGrade + '|' + item.room + '|' + item.classNo;
        if (occupied[key]) {
          item.classNo = null;
          item.classNoCleared = true;
        } else {
          occupied[key] = true;
        }
      }
    }
    return item;
  });
}

function requirePromotionYears_(payload) {
  const fromYear = requireAcademicYear_(payload.fromYear);
  const toYear = requireAcademicYear_(payload.toYear, { mustBeOpen: true });
  if (toYear <= fromYear) throw validationError_('ปีการศึกษาใหม่ต้องมากกว่าปีการศึกษาเดิม');
  return { fromYear: fromYear, toYear: toYear };
}

function summarizePromotion_(plan) {
  const groups = Object.create(null);
  const order = [];
  plan.forEach(function (it) {
    if (it.action === 'SKIP') return;
    const key = it.fromGrade + '→' + (it.action === 'GRADUATE' ? 'GRADUATE' : it.toGrade);
    if (!groups[key]) {
      groups[key] = { fromGrade: it.fromGrade, toGrade: it.action === 'GRADUATE' ? '' : it.toGrade, graduate: it.action === 'GRADUATE', count: 0 };
      order.push(key);
    }
    groups[key].count += 1;
  });
  const levels = gradeLevels_();
  return order.map(function (k) { return groups[k]; }).sort(function (a, b) { return levels.indexOf(a.fromGrade) - levels.indexOf(b.fromGrade); });
}

/** students.promotePreview — ดูผลการเลื่อนชั้นก่อนยืนยัน (ไม่บันทึก) */
function studentsPromotePreview_(ctx, payload) {
  const years = requirePromotionYears_(payload);
  const plan = promotionPlan_(years.fromYear, years.toYear);
  return {
    fromYear: years.fromYear,
    toYear: years.toYear,
    groups: summarizePromotion_(plan),
    promote: plan.filter(function (it) { return it.action === 'PROMOTE'; }).length,
    graduate: plan.filter(function (it) { return it.action === 'GRADUATE'; }).length,
    classNoCleared: plan.filter(function (it) { return it.classNoCleared; }).length,
    skipped: plan.filter(function (it) { return it.action === 'SKIP'; }).map(function (it) {
      return { studentNo: it.studentNo, fullName: it.fullName, classLabel: classLabel_(it.fromGrade, it.room), reason: it.reason };
    }),
  };
}

/** students.promoteCommit — เลื่อนชั้นจริง (ข้อมูลปีเดิมไม่ถูกแก้ ยกเว้นสถานะจบการศึกษาของชั้นสุดท้าย) */
function studentsPromoteCommit_(ctx, payload) {
  const years = requirePromotionYears_(payload);
  const graduationDate = requireIsoDate_(payload.graduationDate, 'วันที่จบการศึกษา', { optional: true }) || todayIso_();
  const plan = promotionPlan_(years.fromYear, years.toYear);
  const actor = actorFromCtx_(ctx);
  const promote = plan.filter(function (it) { return it.action === 'PROMOTE'; });
  dbInsertMany_(SHEETS.ENROLLMENTS, promote.map(function (it) {
    return {
      StudentId: it.studentId,
      AcademicYear: years.toYear,
      GradeLevel: it.toGrade,
      Room: it.room,
      ClassNo: it.classNo,
      EnrollStatus: STATUS.STUDENT.STUDYING,
      Note: 'เลื่อนชั้นจาก ' + classLabel_(it.fromGrade, it.room) + ' ปีการศึกษา ' + years.fromYear,
    };
  }), actor, { action: AUDIT_ACTIONS.PROMOTE });
  const graduates = plan.filter(function (it) { return it.action === 'GRADUATE'; });
  graduates.forEach(function (it) {
    const note = 'จบการศึกษาชั้น ' + it.fromGrade + ' ปีการศึกษา ' + years.fromYear;
    dbUpdate_(SHEETS.STUDENTS, it.studentId, { Status: STATUS.STUDENT.GRADUATED, StatusDate: graduationDate, StatusNote: note },
      actor, { action: AUDIT_ACTIONS.PROMOTE, note: note });
    dbUpdate_(SHEETS.ENROLLMENTS, it.enrollmentId, { EnrollStatus: STATUS.STUDENT.GRADUATED }, actor, { action: AUDIT_ACTIONS.PROMOTE, note: note });
  });
  const skipped = plan.length - promote.length - graduates.length;
  auditAppend_([{
    action: AUDIT_ACTIONS.PROMOTE,
    entity: SHEETS.ENROLLMENTS,
    entityId: '',
    after: { fromYear: years.fromYear, toYear: years.toYear, promoted: promote.length, graduated: graduates.length, skipped: skipped },
    note: 'เลื่อนชั้นจากปีการศึกษา ' + years.fromYear + ' เป็น ' + years.toYear + ': เลื่อนชั้น ' + promote.length +
      ' คน, จบการศึกษา ' + graduates.length + ' คน, ข้าม ' + skipped + ' คน',
  }], actor);
  return {
    fromYear: years.fromYear,
    toYear: years.toYear,
    promoted: promote.length,
    graduated: graduates.length,
    skipped: skipped,
    classNoCleared: promote.filter(function (it) { return it.classNoCleared; }).length,
  };
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Ledger.js
// ============================================================================

/**
 * ============================================================================
 *  Ledger.gs — คำนวณยอดเงินของรายการเรียกเก็บ และบัญชีการเงินของนักเรียน
 * ----------------------------------------------------------------------------
 *  ระบบไม่เก็บยอดคงเหลือหรือสถานะการชำระไว้ในชีต คำนวณใหม่จากข้อมูลจริงทุกครั้ง:
 *    ยอดเรียกเก็บสุทธิ = GrossAmount − ลดหย่อน/ยกเว้นที่มีผล
 *    ยอดชำระ         = การตัดชำระที่มีผล ของการรับเงินที่ยังมีผล
 *    ยอดคงเหลือ       = ยอดสุทธิ − ยอดชำระ
 *  คำนวณเป็นสตางค์ (จำนวนเต็ม) เสมอ และคำนวณใหม่ภายใต้ lock ก่อนบันทึกเงินทุกครั้ง
 * ============================================================================
 */

/** ลำดับภาคเรียนสำหรับการเรียง (ทั้งปีการศึกษามาก่อนภาคเรียนที่ 1) */
const TERM_ORDER_ = Object.freeze({ Y: 0, '1': 1, '2': 2 });

function satangOf_(baht) {
  return baht === null || baht === undefined || baht === '' ? 0 : toSatang_(baht);
}

/** อ่านข้อมูลที่ใช้คำนวณยอดครั้งเดียวต่อคำขอ */
function ledgerContext_() {
  const adjustments = dbAll_(SHEETS.FEE_ADJUSTMENTS);
  const adjustBy = Object.create(null);
  adjustments.forEach(function (a) {
    if (a.Status === STATUS.ADJUSTMENT.ACTIVE) adjustBy[a.AssessmentId] = (adjustBy[a.AssessmentId] || 0) + satangOf_(a.Amount);
  });
  const payments = Object.create(null);
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) { payments[p.PaymentId] = p; });
  const allocations = dbAll_(SHEETS.PAYMENT_ALLOCATIONS);
  const paidBy = Object.create(null);
  allocations.forEach(function (al) {
    const p = payments[al.PaymentId];
    if (al.Status !== STATUS.ALLOCATION.ACTIVE || !p || p.Status !== STATUS.PAYMENT.ACTIVE) return;
    paidBy[al.AssessmentId] = (paidBy[al.AssessmentId] || 0) + satangOf_(al.Amount);
  });
  const fees = Object.create(null);
  dbAll_(SHEETS.FEE_SETTINGS).forEach(function (f) { fees[f.FeeSettingId] = f; });
  return { adjustments: adjustments, adjustBy: adjustBy, payments: payments, allocations: allocations, paidBy: paidBy, fees: fees, today: todayIso_() };
}

/** ยอดเงินของรายการเรียกเก็บ 1 รายการ (สตางค์) */
function assessmentFigures_(asm, lc) {
  const gross = satangOf_(asm.GrossAmount);
  const adjust = lc.adjustBy[asm.AssessmentId] || 0;
  const paid = lc.paidBy[asm.AssessmentId] || 0;
  const cancelled = asm.Status === STATUS.ASSESSMENT.CANCELLED;
  const net = gross - adjust;
  return {
    grossSatang: gross,
    adjustSatang: adjust,
    netSatang: net,
    paidSatang: paid,
    outstandingSatang: cancelled ? 0 : net - paid,
    state: payStateOf_(cancelled, net, paid),
  };
}

function assessmentLabel_(asm, lc) {
  const fee = lc.fees[asm.FeeSettingId];
  return feeItemLabel_(fee ? fee.Description : '', asm.Term, asm.AcademicYear, asm.GradeLevel);
}

function assessmentDto_(asm, lc) {
  const f = assessmentFigures_(asm, lc);
  return {
    assessmentId: asm.AssessmentId,
    studentId: asm.StudentId,
    feeSettingId: asm.FeeSettingId,
    year: asm.AcademicYear,
    term: asm.Term,
    termLabel: termLabel_(asm.Term, asm.AcademicYear),
    gradeLevel: asm.GradeLevel,
    room: asm.Room,
    classLabel: classLabel_(asm.GradeLevel, asm.Room),
    label: assessmentLabel_(asm, lc),
    dueDate: asm.DueDate,
    status: asm.Status,
    grossSatang: f.grossSatang,
    adjustSatang: f.adjustSatang,
    netSatang: f.netSatang,
    paidSatang: f.paidSatang,
    outstandingSatang: f.outstandingSatang,
    state: f.state,
    stateLabel: STATUS_LABELS.PAY_STATE[f.state],
    overdue: f.outstandingSatang > 0 && !!asm.DueDate && asm.DueDate < lc.today,
    cancelReason: asm.CancelReason,
    cancelledAt: asm.CancelledAt,
    createdAt: asm.CreatedAt,
  };
}

/** เรียงสำหรับการตัดชำระ: ครบกำหนดก่อน → ปีการศึกษา → ภาคเรียน → วันที่สร้าง (หนี้เก่าก่อน ตามการตัดสินใจ D-08) */
function compareForPayment_(a, b) {
  const dueA = a.dueDate || '9999-12-31';
  const dueB = b.dueDate || '9999-12-31';
  if (dueA !== dueB) return dueA < dueB ? -1 : 1;
  if (a.year !== b.year) return a.year - b.year;
  const ta = TERM_ORDER_[a.term] === undefined ? 9 : TERM_ORDER_[a.term];
  const tb = TERM_ORDER_[b.term] === undefined ? 9 : TERM_ORDER_[b.term];
  if (ta !== tb) return ta - tb;
  return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0);
}

/** เรียงสำหรับแสดงในบัญชีนักเรียน: ปีล่าสุดก่อน แล้วตามภาคเรียน */
function compareForStatement_(a, b) {
  if (a.year !== b.year) return b.year - a.year;
  const ta = TERM_ORDER_[a.term] === undefined ? 9 : TERM_ORDER_[a.term];
  const tb = TERM_ORDER_[b.term] === undefined ? 9 : TERM_ORDER_[b.term];
  if (ta !== tb) return ta - tb;
  return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0);
}

/** ข้อมูลชั้นเรียนของปีการศึกษาล่าสุดที่มีข้อมูล ของนักเรียนทุกคน */
function latestEnrollments_() {
  const out = Object.create(null);
  dbAll_(SHEETS.ENROLLMENTS).forEach(function (e) {
    const cur = out[e.StudentId];
    if (!cur || e.AcademicYear > cur.AcademicYear) out[e.StudentId] = e;
  });
  return out;
}

/** ชื่อที่แสดงของผู้ใช้ตามชื่อผู้ใช้ (ใช้แสดงผู้บันทึก ผู้ขอ ผู้อนุมัติ) */
function userDisplayNames_() {
  const out = Object.create(null);
  dbAll_(SHEETS.USERS).forEach(function (u) { out[u.Username] = u.DisplayName || u.Username; });
  return out;
}

function displayNameOf_(username, names) {
  if (!username) return '';
  return names[username] || username;
}

function sumFigures_(dtos) {
  const t = { grossSatang: 0, adjustSatang: 0, netSatang: 0, paidSatang: 0, outstandingSatang: 0, overdueSatang: 0 };
  dtos.forEach(function (d) {
    if (d.status !== STATUS.ASSESSMENT.ACTIVE) return;
    t.grossSatang += d.grossSatang;
    t.adjustSatang += d.adjustSatang;
    t.netSatang += d.netSatang;
    t.paidSatang += d.paidSatang;
    t.outstandingSatang += d.outstandingSatang;
    if (d.overdue) t.overdueSatang += d.outstandingSatang;
  });
  return t;
}

function adjustmentDto_(a, labels, names) {
  return {
    adjustmentId: a.AdjustmentId,
    assessmentId: a.AssessmentId,
    studentId: a.StudentId,
    label: labels[a.AssessmentId] || '',
    type: a.Type,
    typeLabel: STATUS_LABELS.ADJUSTMENT_TYPE[a.Type] || a.Type,
    amountSatang: satangOf_(a.Amount),
    reason: a.Reason,
    referenceDoc: a.ReferenceDoc,
    status: a.Status,
    statusLabel: STATUS_LABELS.ADJUSTMENT[a.Status] || a.Status,
    requestedBy: displayNameOf_(a.RequestedBy, names),
    approvedBy: displayNameOf_(a.ApprovedBy, names),
    approvalRequestId: a.ApprovalRequestId,
    createdAt: a.CreatedAt,
    revokedAt: a.RevokedAt,
    revokedBy: displayNameOf_(a.RevokedBy, names),
    revokeReason: a.RevokeReason,
  };
}

function paymentDto_(p, lc, labels, names) {
  return {
    paymentId: p.PaymentId,
    studentId: p.StudentId,
    date: p.PaymentDate,
    amountSatang: satangOf_(p.Amount),
    channel: p.Channel,
    channelRef: p.ChannelRef,
    bookId: p.ReceiptBookId,
    bookNo: p.ReceiptBookNo,
    receiptNo: p.ReceiptNo,
    receivedByName: p.ReceivedByName,
    note: p.Note,
    status: p.Status,
    statusLabel: STATUS_LABELS.PAYMENT[p.Status] || p.Status,
    voidReason: p.VoidReason,
    voidedAt: p.VoidedAt,
    voidedBy: displayNameOf_(p.VoidedBy, names),
    replacesPaymentId: p.ReplacesPaymentId,
    replacedByPaymentId: p.ReplacedByPaymentId,
    entryId: p.ReceiptEntryId,
    createdBy: displayNameOf_(p.CreatedBy, names),
    createdAt: p.CreatedAt,
    allocations: lc.allocations
      .filter(function (al) { return al.PaymentId === p.PaymentId && al.Status === STATUS.ALLOCATION.ACTIVE; })
      .map(function (al) { return { assessmentId: al.AssessmentId, label: labels[al.AssessmentId] || '', amountSatang: satangOf_(al.Amount) }; }),
  };
}

/** เรียงการรับเงินล่าสุดก่อน: วันที่รับเงิน → เวลาที่บันทึก → เลขที่ใบเสร็จ */
function comparePaymentsDesc_(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return (b.receiptNo || 0) - (a.receiptNo || 0);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** ledger.students — นักเรียนทุกคนพร้อมยอดคงค้างรวม (ค้นหานักเรียนตอนรับเงิน) */
function ledgerStudents_(ctx, payload) {
  const lc = ledgerContext_();
  const totals = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (asm) {
    if (asm.Status !== STATUS.ASSESSMENT.ACTIVE) return;
    const f = assessmentFigures_(asm, lc);
    const t = totals[asm.StudentId] || (totals[asm.StudentId] = { outstanding: 0, overdue: 0, items: 0 });
    t.items += 1;
    t.outstanding += f.outstandingSatang;
    if (f.outstandingSatang > 0 && asm.DueDate && asm.DueDate < lc.today) t.overdue += f.outstandingSatang;
  });
  const latest = latestEnrollments_();
  const rows = dbAll_(SHEETS.STUDENTS).map(function (s) {
    const dto = studentDto_(s, latest[s.StudentId] || null);
    const t = totals[s.StudentId] || { outstanding: 0, overdue: 0, items: 0 };
    return {
      studentId: dto.studentId,
      studentNo: dto.studentNo,
      fullName: dto.fullName,
      firstName: dto.firstName,
      lastName: dto.lastName,
      status: dto.status,
      statusLabel: dto.statusLabel,
      year: dto.year,
      gradeLevel: dto.gradeLevel,
      room: dto.room,
      classLabel: dto.classLabel,
      classNo: dto.classNo,
      outstandingSatang: t.outstanding,
      overdueSatang: t.overdue,
      assessedItems: t.items,
    };
  }).sort(compareStudentRows_(gradeLevels_()));
  return { currentYear: currentAcademicYear_(), rows: rows };
}

/** ledger.student — บัญชีการเงินของนักเรียน 1 คน: รายการเรียกเก็บทุกปี ลดหย่อน การรับเงิน และคำขออนุมัติ */
function ledgerStudent_(ctx, payload) {
  const id = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const s = dbGet_(SHEETS.STUDENTS, id);
  if (!s) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const lc = ledgerContext_();
  const names = userDisplayNames_();
  const latest = latestEnrollments_()[id] || null;
  const assessments = dbFind_(SHEETS.FEE_ASSESSMENTS, function (a) { return a.StudentId === id; })
    .map(function (a) { return assessmentDto_(a, lc); })
    .sort(compareForStatement_);
  const labels = Object.create(null);
  assessments.forEach(function (a) { labels[a.assessmentId] = a.label; });
  const pendingByRef = pendingRequestsByRef_();
  assessments.forEach(function (a) { a.pendingRequest = pendingByRef[a.assessmentId] || null; });
  const payments = dbFind_(SHEETS.PAYMENTS, function (p) { return p.StudentId === id; })
    .map(function (p) {
      const dto = paymentDto_(p, lc, labels, names);
      dto.pendingRequest = pendingByRef[p.PaymentId] || null;
      return dto;
    })
    .sort(comparePaymentsDesc_);
  const adjustments = lc.adjustments
    .filter(function (a) { return a.StudentId === id; })
    .map(function (a) { return adjustmentDto_(a, labels, names); })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  const students = Object.create(null);
  students[id] = s;
  const requests = dbFind_(SHEETS.APPROVAL_REQUESTS, function (r) { return r.StudentId === id; })
    .map(function (r) { return approvalDto_(r, students, names); })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  return {
    student: studentDto_(s, latest),
    totals: sumFigures_(assessments),
    assessments: assessments,
    payments: payments,
    adjustments: adjustments,
    requests: requests,
    availableFees: ctx.role === ROLES.FINANCE ? availableFeesForStudent_(id, lc) : [],
  };
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Fees.js
// ============================================================================

/**
 * ============================================================================
 *  Fees.gs — อัตราเงินบำรุง รายการเรียกเก็บ ลดหย่อน/ยกเว้น และการยกเลิกรายการเรียกเก็บ
 * ----------------------------------------------------------------------------
 *  - อัตราตั้งตามปีการศึกษา ภาคเรียน และระดับชั้น
 *    ต้องกรอกเอกสารที่อนุมัติอัตราก่อนสร้างรายการเรียกเก็บ (การตัดสินใจ D-06)
 *  - ชั้นเดียวกันในปีเดียวกัน ใช้อัตรารายภาคเรียนหรือทั้งปีอย่างใดอย่างหนึ่ง (กันเรียกเก็บซ้ำ)
 *  - เมื่อมีรายการเรียกเก็บแล้ว แก้จำนวนเงินและวันครบกำหนดของอัตราไม่ได้
 *  - สร้างรายการเรียกเก็บซ้ำได้โดยไม่เกิดรายการซ้ำ (สร้างเฉพาะคนที่ยังไม่มี)
 *  - ลดหย่อน/ยกเว้น และยกเลิกรายการเรียกเก็บ ต้องมีเหตุผล
 *    และรอผู้อำนวยการอนุมัติถ้าตั้งค่าไว้ (D-07, D-10) ระหว่างรออนุมัติ ข้อมูลเดิมยังมีผล
 *  - สิทธิ์: เจ้าหน้าที่การเงินบันทึก ผู้อำนวยการดูและอนุมัติ (ตรวจใน Api.gs)
 * ============================================================================
 */

const FEE_DEFAULT_DESCRIPTION = 'เงินบำรุงการศึกษา';
const FEE_MAX_SATANG = 10000000; // 100,000 บาทต่อคนต่อรายการ (กันพิมพ์ผิด)

// ---------------------------------------------------------------------------
// ตัวช่วย
// ---------------------------------------------------------------------------

function termOptions_() {
  return [STATUS.TERM.TERM_1, STATUS.TERM.TERM_2, STATUS.TERM.YEAR].map(function (t) {
    return { value: t, label: STATUS_LABELS.TERM[t] };
  });
}

function yearRecord_(year) {
  return dbFindOne_(SHEETS.ACADEMIC_YEARS, function (r) { return r.Year === year; });
}

function isYearOpen_(year) {
  const r = yearRecord_(year);
  return !!r && r.Status === STATUS.ACADEMIC_YEAR.OPEN;
}

function requireFeeSetting_(value) {
  const id = requireId_(value, 'FEE', 'รหัสอัตราเงินบำรุง');
  const f = dbGet_(SHEETS.FEE_SETTINGS, id);
  if (!f) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบอัตราเงินบำรุงนี้');
  return f;
}

function feeLabel_(f) {
  return feeItemLabel_(f.Description, f.Term, f.AcademicYear, f.GradeLevel);
}

function emptyFeeStats_() {
  return { count: 0, netSatang: 0, paidSatang: 0, outstandingSatang: 0, states: { UNPAID: 0, PARTIAL: 0, PAID: 0, EXEMPT: 0 } };
}

/** สถิติของแต่ละอัตรา จากรายการเรียกเก็บที่มีผล */
function feeStats_(lc) {
  const out = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (asm) {
    if (asm.Status !== STATUS.ASSESSMENT.ACTIVE) return;
    const s = out[asm.FeeSettingId] || (out[asm.FeeSettingId] = emptyFeeStats_());
    const f = assessmentFigures_(asm, lc);
    s.count += 1;
    s.netSatang += f.netSatang;
    s.paidSatang += f.paidSatang;
    s.outstandingSatang += f.outstandingSatang;
    s.states[f.state] = (s.states[f.state] || 0) + 1;
  });
  return out;
}

function feeSettingDto_(f, stats) {
  const st = stats || emptyFeeStats_();
  return {
    feeSettingId: f.FeeSettingId,
    year: f.AcademicYear,
    term: f.Term,
    termLabel: STATUS_LABELS.TERM[f.Term] || f.Term,
    gradeLevel: f.GradeLevel,
    amountSatang: satangOf_(f.Amount),
    startDate: f.StartDate,
    dueDate: f.DueDate,
    description: f.Description,
    label: feeLabel_(f),
    approvalRef: f.ApprovalRef,
    status: f.Status,
    statusLabel: STATUS_LABELS.FEE_SETTING[f.Status] || f.Status,
    stats: st,
    locked: st.count > 0,
  };
}

/** เรียงอัตรา: ภาคเรียน → ลำดับระดับชั้นตามการตั้งค่า */
function compareFeeSettings_(levels) {
  return function (a, b) {
    const ta = TERM_ORDER_[a.term] === undefined ? 9 : TERM_ORDER_[a.term];
    const tb = TERM_ORDER_[b.term] === undefined ? 9 : TERM_ORDER_[b.term];
    if (ta !== tb) return ta - tb;
    const ga = levels.indexOf(a.gradeLevel);
    const gb = levels.indexOf(b.gradeLevel);
    return (ga === -1 ? 999 : ga) - (gb === -1 ? 999 : gb);
  };
}

function validateFeeInput_(payload) {
  const amountSatang = requireMoney_(payload.amount, 'จำนวนเงิน', { maxSatang: FEE_MAX_SATANG });
  const startDate = requireIsoDate_(payload.startDate, 'วันเริ่มเรียกเก็บ', { optional: true });
  const dueDate = requireIsoDate_(payload.dueDate, 'วันครบกำหนดชำระ');
  if (startDate && dueDate < startDate) throw validationError_('วันครบกำหนดชำระต้องไม่ก่อนวันเริ่มเรียกเก็บ');
  return {
    amountSatang: amountSatang,
    startDate: startDate,
    dueDate: dueDate,
    description: requireText_(payload.description, 'ชื่อรายการ', { optional: true, max: 100 }) || FEE_DEFAULT_DESCRIPTION,
    approvalRef: requireText_(payload.approvalRef, 'เอกสารที่อนุมัติอัตรา', { optional: true, max: 300 }),
  };
}

/** อัตราที่พร้อมสร้างรายการเรียกเก็บ: ใช้งานอยู่ มีเอกสารอนุมัติ และปีการศึกษายังไม่ปิด */
function requireFeeReadyForAssessment_(value) {
  const f = requireFeeSetting_(value);
  if (f.Status !== STATUS.FEE_SETTING.ACTIVE) {
    throw appError_(ERROR_CODES.CONFLICT, 'อัตรานี้ปิดการใช้งานแล้ว สร้างรายการเรียกเก็บไม่ได้');
  }
  if (!f.ApprovalRef) {
    throw appError_(ERROR_CODES.VALIDATION,
      'กรุณากรอกเลขที่และวันที่ของหนังสือหรือมติที่อนุมัติอัตรานี้ก่อนสร้างรายการเรียกเก็บ (กดแก้ไขอัตรา แล้วกรอกช่อง "เอกสารที่อนุมัติอัตรา")',
      { reason: 'APPROVAL_REF_REQUIRED' });
  }
  if (!isYearOpen_(f.AcademicYear)) {
    throw appError_(ERROR_CODES.CONFLICT, 'ปีการศึกษา ' + f.AcademicYear + ' ปิดแล้ว สร้างรายการเรียกเก็บใหม่ไม่ได้');
  }
  return f;
}

function newAssessmentRecord_(f, studentId, enrollmentId, room) {
  return {
    StudentId: studentId,
    EnrollmentId: enrollmentId,
    FeeSettingId: f.FeeSettingId,
    AcademicYear: f.AcademicYear,
    Term: f.Term,
    GradeLevel: f.GradeLevel,
    Room: room,
    GrossAmount: f.Amount,
    DueDate: f.DueDate,
    Status: STATUS.ASSESSMENT.ACTIVE,
  };
}

/**
 * แผนการสร้างรายการเรียกเก็บของอัตราหนึ่ง
 *  - เรียกเก็บนักเรียนชั้นนั้นของปีนั้นที่กำลังศึกษา หรือจบการศึกษาในปีนั้น (เรียนครบปีแล้ว)
 *  - ข้ามผู้ที่มีรายการของอัตรานี้แล้ว ผู้ที่ย้ายออก และผู้ที่รายการเดิมถูกยกเลิก
 *    (สองกรณีหลัง ถ้าต้องเรียกเก็บ ให้เพิ่มรายบุคคลในบัญชีนักเรียน) จึงกดสร้างซ้ำได้โดยไม่เรียกเก็บซ้ำ
 */
function assessmentPlan_(f) {
  const has = Object.create(null);
  const cancelled = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) {
    if (a.FeeSettingId !== f.FeeSettingId) return;
    if (a.Status === STATUS.ASSESSMENT.ACTIVE) has[a.StudentId] = true;
    else cancelled[a.StudentId] = true;
  });
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const create = [];
  const skipped = [];
  let already = 0;
  dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === f.AcademicYear && e.GradeLevel === f.GradeLevel; })
    .forEach(function (e) {
      const s = students[e.StudentId];
      if (!s) return;
      if (has[e.StudentId]) { already += 1; return; }
      const item = {
        studentId: s.StudentId,
        enrollmentId: e.EnrollmentId,
        studentNo: s.StudentNo,
        fullName: studentDisplayName_(s.Prefix, s.FirstName, s.LastName),
        firstName: s.FirstName,
        gradeLevel: e.GradeLevel,
        room: e.Room,
        classLabel: classLabel_(e.GradeLevel, e.Room),
        classNo: e.ClassNo,
      };
      if (cancelled[e.StudentId]) {
        item.reason = 'รายการเดิมของอัตรานี้ถูกยกเลิกแล้ว (ถ้าต้องเรียกเก็บใหม่ ให้เพิ่มรายบุคคลในบัญชีนักเรียน)';
        skipped.push(item);
        return;
      }
      if (e.EnrollStatus === STATUS.STUDENT.TRANSFERRED) {
        item.reason = 'ย้ายออกแล้ว (ถ้าต้องเรียกเก็บ ให้เพิ่มรายบุคคลในบัญชีนักเรียน)';
        skipped.push(item);
        return;
      }
      create.push(item);
    });
  const levels = gradeLevels_();
  create.sort(compareStudentRows_(levels));
  skipped.sort(compareStudentRows_(levels));
  return { create: create, skipped: skipped, already: already };
}

/** อัตราที่เพิ่มเป็นรายการเรียกเก็บรายบุคคลให้นักเรียนคนนี้ได้ (ใช้ในหน้าบัญชีนักเรียน) */
function availableFeesForStudent_(studentId, lc) {
  const enrollments = dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.StudentId === studentId; });
  const has = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) {
    if (a.StudentId === studentId && a.Status === STATUS.ASSESSMENT.ACTIVE) has[a.FeeSettingId] = true;
  });
  const open = Object.create(null);
  dbAll_(SHEETS.ACADEMIC_YEARS).forEach(function (y) { if (y.Status === STATUS.ACADEMIC_YEAR.OPEN) open[y.Year] = true; });
  return dbAll_(SHEETS.FEE_SETTINGS)
    .filter(function (f) {
      return f.Status === STATUS.FEE_SETTING.ACTIVE && f.ApprovalRef && open[f.AcademicYear] && !has[f.FeeSettingId] &&
        enrollments.some(function (e) { return e.AcademicYear === f.AcademicYear && e.GradeLevel === f.GradeLevel; });
    })
    .map(function (f) { return feeSettingDto_(f, null); })
    .sort(function (a, b) { return a.year !== b.year ? b.year - a.year : compareFeeSettings_(gradeLevels_())(a, b); });
}

// ---------------------------------------------------------------------------
// API: อัตราเงินบำรุง
// ---------------------------------------------------------------------------

/** fees.list — อัตราเงินบำรุงของปีการศึกษา พร้อมสถิติการเรียกเก็บ */
function feesList_(ctx, payload) {
  const year = isBlankInput_(payload.year) ? currentAcademicYear_() : requireAcademicYear_(payload.year);
  const levels = gradeLevels_();
  const stats = feeStats_(ledgerContext_());
  const settings = dbFind_(SHEETS.FEE_SETTINGS, function (f) { return f.AcademicYear === year; })
    .map(function (f) { return feeSettingDto_(f, stats[f.FeeSettingId]); })
    .sort(compareFeeSettings_(levels));
  return {
    year: year,
    yearOpen: isYearOpen_(year),
    gradeLevels: levels,
    terms: termOptions_(),
    defaultDescription: FEE_DEFAULT_DESCRIPTION,
    settings: settings,
  };
}

/** fees.create — ตั้งอัตราให้หลายระดับชั้นพร้อมกัน (1 ชั้น = 1 รายการ) */
function feesCreate_(ctx, payload) {
  const year = requireAcademicYear_(payload.year, { mustBeOpen: true });
  const term = requireEnum_(payload.term, STATUS.TERM, 'ภาคเรียน');
  const levels = gradeLevels_();
  const grades = Array.isArray(payload.gradeLevels) ? payload.gradeLevels : [];
  if (!grades.length) throw validationError_('กรุณาเลือกระดับชั้นอย่างน้อย 1 ชั้น');
  if (grades.length > levels.length) throw validationError_('ระดับชั้นไม่ถูกต้อง');
  const chosen = [];
  grades.forEach(function (g) {
    const text = typeof g === 'string' ? g.trim() : '';
    if (levels.indexOf(text) === -1) throw validationError_('ระดับชั้น "' + text + '" ไม่อยู่ในรายการระดับชั้นที่เปิดสอน');
    if (chosen.indexOf(text) === -1) chosen.push(text);
  });
  chosen.sort(function (a, b) { return levels.indexOf(a) - levels.indexOf(b); });
  const input = validateFeeInput_(payload);

  const existing = dbFind_(SHEETS.FEE_SETTINGS, function (f) { return f.AcademicYear === year; });
  const same = chosen.filter(function (g) {
    return existing.some(function (f) { return f.GradeLevel === g && f.Term === term; });
  });
  if (same.length) {
    throw appError_(ERROR_CODES.CONFLICT, 'ชั้น ' + same.join(', ') + ' มีอัตรา' + STATUS_LABELS.TERM[term] +
      ' ปีการศึกษา ' + year + ' แล้ว ให้แก้ไขอัตราเดิมแทน');
  }
  const mixed = chosen.filter(function (g) {
    return existing.some(function (f) {
      return f.GradeLevel === g && f.Term !== term && (f.Term === STATUS.TERM.YEAR || term === STATUS.TERM.YEAR);
    });
  });
  if (mixed.length) {
    throw appError_(ERROR_CODES.CONFLICT, 'ชั้น ' + mixed.join(', ') +
      (term === STATUS.TERM.YEAR ? ' มีอัตรารายภาคเรียนแล้ว' : ' มีอัตราทั้งปีการศึกษาแล้ว') +
      ' ตั้งอัตรารายภาคเรียนและทั้งปีการศึกษาซ้อนกันไม่ได้ (ป้องกันการเรียกเก็บซ้ำ)');
  }

  const created = dbInsertMany_(SHEETS.FEE_SETTINGS, chosen.map(function (g) {
    return {
      AcademicYear: year,
      Term: term,
      GradeLevel: g,
      Amount: satangToBaht_(input.amountSatang),
      StartDate: input.startDate,
      DueDate: input.dueDate,
      Description: input.description,
      ApprovalRef: input.approvalRef,
      Status: STATUS.FEE_SETTING.ACTIVE,
    };
  }), actorFromCtx_(ctx), { note: 'ตั้งอัตรา' + input.description + ' ' + termLabel_(term, year) });
  return created.map(function (f) { return feeSettingDto_(f, null); });
}

/** fees.update — แก้ไขอัตรา (จำนวนเงินและวันครบกำหนดแก้ไม่ได้เมื่อมีรายการเรียกเก็บแล้ว) */
function feesUpdate_(ctx, payload) {
  const f = requireFeeSetting_(payload.feeSettingId);
  if (!isYearOpen_(f.AcademicYear)) {
    throw appError_(ERROR_CODES.CONFLICT, 'ปีการศึกษา ' + f.AcademicYear + ' ปิดแล้ว แก้ไขอัตราไม่ได้');
  }
  const input = validateFeeInput_(payload);
  const status = requireEnum_(payload.status, STATUS.FEE_SETTING, 'สถานะ');
  const used = dbFindOne_(SHEETS.FEE_ASSESSMENTS, function (a) {
    return a.FeeSettingId === f.FeeSettingId && a.Status === STATUS.ASSESSMENT.ACTIVE;
  });
  if (used && input.amountSatang !== satangOf_(f.Amount)) {
    throw appError_(ERROR_CODES.CONFLICT,
      'อัตรานี้สร้างรายการเรียกเก็บแล้ว จึงแก้จำนวนเงินไม่ได้ ถ้าบางคนต้องจ่ายต่างจากอัตรา ให้ใช้การลดหย่อนเป็นรายคน');
  }
  if (used && input.dueDate !== f.DueDate) {
    throw appError_(ERROR_CODES.CONFLICT, 'อัตรานี้สร้างรายการเรียกเก็บแล้ว จึงแก้วันครบกำหนดชำระไม่ได้');
  }
  const result = dbUpdate_(SHEETS.FEE_SETTINGS, f.FeeSettingId, {
    Amount: satangToBaht_(input.amountSatang),
    StartDate: input.startDate,
    DueDate: input.dueDate,
    Description: input.description,
    ApprovalRef: input.approvalRef,
    Status: status,
  }, actorFromCtx_(ctx), { note: 'แก้ไขอัตรา ' + feeLabel_(f) });
  return feeSettingDto_(result.after, feeStats_(ledgerContext_())[f.FeeSettingId]);
}

// ---------------------------------------------------------------------------
// API: รายการเรียกเก็บ
// ---------------------------------------------------------------------------

/** assessments.list — รายการเรียกเก็บของอัตราหนึ่ง พร้อมยอดชำระและสถานะของแต่ละคน */
function assessmentsList_(ctx, payload) {
  const f = requireFeeSetting_(payload.feeSettingId);
  const lc = ledgerContext_();
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const enrollments = Object.create(null);
  dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === f.AcademicYear; })
    .forEach(function (e) { enrollments[e.StudentId] = e; });
  const pending = pendingRequestsByRef_();
  const rows = dbFind_(SHEETS.FEE_ASSESSMENTS, function (a) { return a.FeeSettingId === f.FeeSettingId; })
    .map(function (a) {
      const dto = assessmentDto_(a, lc);
      const s = students[a.StudentId];
      const e = enrollments[a.StudentId];
      dto.studentNo = s ? s.StudentNo : '';
      dto.fullName = s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) : '';
      dto.firstName = s ? s.FirstName : '';
      dto.classNo = e ? e.ClassNo : null;
      dto.pendingRequest = pending[a.AssessmentId] || null;
      return dto;
    })
    .sort(compareStudentRows_(gradeLevels_()));
  return {
    setting: feeSettingDto_(f, feeStats_(lc)[f.FeeSettingId]),
    rows: rows,
    canManage: ctx.role === ROLES.FINANCE,
  };
}

/** assessments.preview — ตัวอย่างก่อนสร้างรายการเรียกเก็บ (ยังไม่บันทึก) */
function assessmentsPreview_(ctx, payload) {
  const f = requireFeeReadyForAssessment_(payload.feeSettingId);
  const plan = assessmentPlan_(f);
  return {
    setting: feeSettingDto_(f, null),
    create: plan.create,
    skipped: plan.skipped,
    already: plan.already,
    totalSatang: plan.create.length * satangOf_(f.Amount),
  };
}

/** assessments.generate — สร้างรายการเรียกเก็บ (ตรวจซ้ำภายใต้ lock กดซ้ำได้โดยไม่เกิดรายการซ้ำ) */
function assessmentsGenerate_(ctx, payload) {
  const f = requireFeeReadyForAssessment_(payload.feeSettingId);
  const plan = assessmentPlan_(f);
  if (plan.create.length) {
    dbInsertMany_(SHEETS.FEE_ASSESSMENTS, plan.create.map(function (it) {
      return newAssessmentRecord_(f, it.studentId, it.enrollmentId, it.room);
    }), actorFromCtx_(ctx), { note: 'สร้างรายการเรียกเก็บ ' + feeLabel_(f) });
  }
  return {
    created: plan.create.length,
    already: plan.already,
    skipped: plan.skipped.length,
    totalSatang: plan.create.length * satangOf_(f.Amount),
  };
}

/** assessments.createOne — เพิ่มรายการเรียกเก็บรายบุคคล เช่น นักเรียนย้ายเข้ากลางปี */
function assessmentsCreateOne_(ctx, payload) {
  const f = requireFeeReadyForAssessment_(payload.feeSettingId);
  const studentId = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const s = dbGet_(SHEETS.STUDENTS, studentId);
  if (!s) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const e = enrollmentOf_(studentId, f.AcademicYear);
  if (!e || e.GradeLevel !== f.GradeLevel) {
    throw appError_(ERROR_CODES.CONFLICT, studentDisplayName_(s.Prefix, s.FirstName, s.LastName) + ' ไม่ได้เรียนชั้น ' +
      f.GradeLevel + ' ในปีการศึกษา ' + f.AcademicYear);
  }
  const dup = dbFindOne_(SHEETS.FEE_ASSESSMENTS, function (a) {
    return a.StudentId === studentId && a.FeeSettingId === f.FeeSettingId && a.Status === STATUS.ASSESSMENT.ACTIVE;
  });
  if (dup) throw appError_(ERROR_CODES.CONFLICT, 'นักเรียนคนนี้มีรายการเรียกเก็บของอัตรานี้แล้ว');
  const rec = dbInsert_(SHEETS.FEE_ASSESSMENTS, newAssessmentRecord_(f, studentId, e.EnrollmentId, e.Room),
    actorFromCtx_(ctx), { note: 'เพิ่มรายการเรียกเก็บรายบุคคล ' + feeLabel_(f) });
  return assessmentDto_(rec, ledgerContext_());
}

// ---------------------------------------------------------------------------
// ลดหย่อน/ยกเว้น และการยกเลิกรายการเรียกเก็บ
// ---------------------------------------------------------------------------

function requireActiveAssessment_(value) {
  const id = requireId_(value, 'ASM', 'รหัสรายการเรียกเก็บ');
  const asm = dbGet_(SHEETS.FEE_ASSESSMENTS, id);
  if (!asm) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการเรียกเก็บ');
  if (asm.Status !== STATUS.ASSESSMENT.ACTIVE) throw appError_(ERROR_CODES.CONFLICT, 'รายการเรียกเก็บนี้ถูกยกเลิกแล้ว');
  return asm;
}

/** ข้อความอธิบายรายการเรียกเก็บ เช่น "เด็กชายสมชาย ใจดี (10001) เงินบำรุงการศึกษา ภาคเรียนที่ 1/2569 ชั้น ป.1" */
function describeAssessment_(asm, lc) {
  const s = dbGet_(SHEETS.STUDENTS, asm.StudentId);
  const who = s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) + ' (' + s.StudentNo + ')' : asm.StudentId;
  return who + ' ' + assessmentLabel_(asm, lc);
}

/** รายการเดียวกันมีคำขอที่รออนุมัติได้ครั้งละ 1 คำขอ */
function assertNoPendingRequest_(assessmentId) {
  const pending = dbFindOne_(SHEETS.APPROVAL_REQUESTS, function (r) {
    return r.RefId === assessmentId && r.Status === STATUS.DECISION.PENDING;
  });
  if (pending) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการนี้มีคำขอ "' + (STATUS_LABELS.REQUEST_TYPE[pending.RequestType] || pending.RequestType) +
      '" ที่รออนุมัติอยู่แล้ว กรุณารอผลการพิจารณา หรือถอนคำขอเดิมก่อน', { reason: 'PENDING_REQUEST' });
  }
}

/**
 * adjustments.request — ขอลดหย่อนหรือยกเว้น
 * ยกเว้น = ยกเว้นยอดคงเหลือทั้งหมด / ลดหย่อน = ระบุจำนวนเงิน ไม่เกินยอดคงเหลือ
 */
function adjustmentsRequest_(ctx, payload) {
  const asm = requireActiveAssessment_(payload.assessmentId);
  const type = requireEnum_(payload.type, STATUS.ADJUSTMENT_TYPE, 'ประเภท');
  const reason = requireText_(payload.reason, 'เหตุผล', { max: 500, multiline: true });
  const referenceDoc = requireText_(payload.referenceDoc, 'เอกสารอ้างอิง', { max: 300 });
  assertNoPendingRequest_(asm.AssessmentId);
  const lc = ledgerContext_();
  const fig = assessmentFigures_(asm, lc);
  if (fig.outstandingSatang <= 0) throw appError_(ERROR_CODES.CONFLICT, 'รายการนี้ไม่มียอดคงเหลือให้ลดหย่อนหรือยกเว้น');
  const amountSatang = type === STATUS.ADJUSTMENT_TYPE.EXEMPTION
    ? fig.outstandingSatang
    : requireMoney_(payload.amount, 'จำนวนเงินที่ลดหย่อน', { maxSatang: fig.outstandingSatang });
  const typeLabel = STATUS_LABELS.ADJUSTMENT_TYPE[type];
  const data = { assessmentId: asm.AssessmentId, type: type, amountSatang: amountSatang, reason: reason, referenceDoc: referenceDoc };
  const summary = typeLabel + ' ' + formatSatang_(amountSatang, true) + ': ' + describeAssessment_(asm, lc);
  const actor = actorFromCtx_(ctx);
  if (approvalRequired_(STATUS.REQUEST_TYPE.FEE_ADJUSTMENT)) {
    const req = createApprovalRequest_(STATUS.REQUEST_TYPE.FEE_ADJUSTMENT, asm.AssessmentId, asm.StudentId, summary, data, reason, actor);
    return { applied: false, requestId: req.RequestId, message: 'ส่งคำขอ' + typeLabel + ' ' + formatSatang_(amountSatang, true) + ' ให้ผู้อำนวยการพิจารณาแล้ว' };
  }
  applyFeeAdjustment_(data, ctx.username, '', '', actor);
  return { applied: true, message: 'บันทึก' + typeLabel + ' ' + formatSatang_(amountSatang, true) + ' เรียบร้อยแล้ว' };
}

/** บันทึกลดหย่อน/ยกเว้น (เรียกเมื่อไม่ต้องอนุมัติ หรือเมื่อผู้อำนวยการอนุมัติ) ตรวจยอดคงเหลือใหม่ทุกครั้ง */
function applyFeeAdjustment_(data, requestedBy, approvedBy, requestId, actor) {
  if (requestId) {
    const done = dbFindOne_(SHEETS.FEE_ADJUSTMENTS, function (a) { return a.ApprovalRequestId === requestId; });
    if (done) return done;
  }
  const asm = requireActiveAssessment_(data.assessmentId);
  const fig = assessmentFigures_(asm, ledgerContext_());
  if (data.amountSatang > fig.outstandingSatang) {
    throw appError_(ERROR_CODES.CONFLICT, 'ยอดคงเหลือของรายการนี้เปลี่ยนไปแล้ว (คงเหลือ ' + formatSatang_(fig.outstandingSatang, true) +
      ') จึงดำเนินการตามคำขอนี้ไม่ได้ ถ้าเป็นคำขออนุมัติ ให้เลือก "ไม่อนุมัติ" แล้วให้เจ้าหน้าที่ยื่นคำขอใหม่', { reason: 'BALANCE_CHANGED' });
  }
  return dbInsert_(SHEETS.FEE_ADJUSTMENTS, {
    AssessmentId: asm.AssessmentId,
    StudentId: asm.StudentId,
    Type: data.type,
    Amount: satangToBaht_(data.amountSatang),
    Reason: data.reason,
    ReferenceDoc: data.referenceDoc,
    Status: STATUS.ADJUSTMENT.ACTIVE,
    RequestedBy: requestedBy,
    ApprovedBy: approvedBy,
    ApprovalRequestId: requestId,
  }, actor, { note: (STATUS_LABELS.ADJUSTMENT_TYPE[data.type] || data.type) + ' ' + formatSatang_(data.amountSatang, true) });
}

/** adjustments.revoke — เพิกถอนลดหย่อน/ยกเว้นที่บันทึกผิด (ผู้อำนวยการ) ยอดค้างจะกลับมา */
function adjustmentsRevoke_(ctx, payload) {
  const id = requireId_(payload.adjustmentId, 'ADJ', 'รหัสรายการลดหย่อน');
  const a = dbGet_(SHEETS.FEE_ADJUSTMENTS, id);
  if (!a) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการลดหย่อน/ยกเว้น');
  if (a.Status !== STATUS.ADJUSTMENT.ACTIVE) throw appError_(ERROR_CODES.CONFLICT, 'รายการนี้ถูกเพิกถอนแล้ว');
  const reason = requireText_(payload.reason, 'เหตุผลการเพิกถอน', { max: 500, multiline: true });
  dbUpdate_(SHEETS.FEE_ADJUSTMENTS, id, {
    Status: STATUS.ADJUSTMENT.REVOKED,
    RevokedAt: nowIso_(),
    RevokedBy: ctx.username,
    RevokeReason: reason,
  }, actorFromCtx_(ctx), { action: AUDIT_ACTIONS.CANCEL, note: 'เพิกถอน' + (STATUS_LABELS.ADJUSTMENT_TYPE[a.Type] || '') });
  return { adjustmentId: id, message: 'เพิกถอนเรียบร้อยแล้ว ยอดค้างของรายการนี้กลับมาตามเดิม' };
}

/** assessments.requestCancel — ขอยกเลิกรายการเรียกเก็บ (ได้เฉพาะรายการที่ยังไม่มีการชำระ) */
function assessmentsRequestCancel_(ctx, payload) {
  const asm = requireActiveAssessment_(payload.assessmentId);
  const reason = requireText_(payload.reason, 'เหตุผลการยกเลิก', { max: 500, multiline: true });
  assertNoPendingRequest_(asm.AssessmentId);
  const lc = ledgerContext_();
  const fig = assessmentFigures_(asm, lc);
  if (fig.paidSatang > 0) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการนี้รับชำระแล้ว ' + formatSatang_(fig.paidSatang, true) +
      ' จึงยกเลิกไม่ได้ ถ้าจำเป็นต้องยกเลิกใบเสร็จที่เกี่ยวข้องก่อน');
  }
  const data = { assessmentId: asm.AssessmentId, reason: reason };
  const summary = 'ยกเลิกรายการเรียกเก็บ ' + formatSatang_(fig.netSatang, true) + ': ' + describeAssessment_(asm, lc);
  const actor = actorFromCtx_(ctx);
  if (approvalRequired_(STATUS.REQUEST_TYPE.ASSESSMENT_CANCEL)) {
    const req = createApprovalRequest_(STATUS.REQUEST_TYPE.ASSESSMENT_CANCEL, asm.AssessmentId, asm.StudentId, summary, data, reason, actor);
    return { applied: false, requestId: req.RequestId, message: 'ส่งคำขอยกเลิกรายการเรียกเก็บให้ผู้อำนวยการพิจารณาแล้ว' };
  }
  applyAssessmentCancel_(data, ctx.username, '', actor);
  return { applied: true, message: 'ยกเลิกรายการเรียกเก็บเรียบร้อยแล้ว' };
}

/** ยกเลิกรายการเรียกเก็บ (เรียกเมื่อไม่ต้องอนุมัติ หรือเมื่อผู้อำนวยการอนุมัติ) ตรวจการชำระใหม่ทุกครั้ง */
function applyAssessmentCancel_(data, requestedBy, requestId, actor) {
  const asm = dbGet_(SHEETS.FEE_ASSESSMENTS, data.assessmentId);
  if (!asm) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการเรียกเก็บ');
  if (asm.Status === STATUS.ASSESSMENT.CANCELLED) {
    if (requestId && asm.ApprovalRequestId === requestId) return asm;
    throw appError_(ERROR_CODES.CONFLICT, 'รายการเรียกเก็บนี้ถูกยกเลิกแล้ว');
  }
  const fig = assessmentFigures_(asm, ledgerContext_());
  if (fig.paidSatang > 0) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการนี้มีการรับชำระแล้ว ' + formatSatang_(fig.paidSatang, true) +
      ' จึงยกเลิกไม่ได้ ถ้าเป็นคำขออนุมัติ ให้เลือก "ไม่อนุมัติ"', { reason: 'BALANCE_CHANGED' });
  }
  return dbUpdate_(SHEETS.FEE_ASSESSMENTS, asm.AssessmentId, {
    Status: STATUS.ASSESSMENT.CANCELLED,
    CancelReason: data.reason,
    CancelledAt: nowIso_(),
    CancelledBy: requestedBy,
    ApprovalRequestId: requestId,
  }, actor, { action: AUDIT_ACTIONS.CANCEL, note: 'ยกเลิกรายการเรียกเก็บ' }).after;
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Approvals.js
// ============================================================================

/**
 * ============================================================================
 *  Approvals.gs — คำขออนุมัติ (คิวเดียวสำหรับผู้อำนวยการ)
 * ----------------------------------------------------------------------------
 *  เจ้าหน้าที่ยื่นคำขอพร้อมเหตุผล → PENDING
 *    → ผู้อำนวยการอนุมัติ   : ระบบตรวจเงื่อนไขใหม่ภายใต้ lock แล้วดำเนินการตามคำขอ
 *    → ผู้อำนวยการไม่อนุมัติ : ไม่มีผลกับข้อมูล (ต้องระบุเหตุผล)
 *    → ผู้ยื่นถอนคำขอ      : ไม่มีผลกับข้อมูล
 *  - ระหว่างรออนุมัติ ข้อมูลเดิมยังมีผลตามเดิม
 *  - ผู้ยื่นคำขออนุมัติคำขอของตนเองไม่ได้ (ตรวจที่ Server)
 *  - ปิด "ต้องอนุมัติ" ในหน้าตั้งค่าแล้ว คำขอประเภทนั้นจะมีผลทันที และบันทึกผู้ทำรายการไว้ในประวัติ
 *  - ตัวดำเนินการของแต่ละประเภทอยู่ใน approvalHandlers_() ที่เดียว
 *    approve = ทำตามคำขอ (ตรวจเงื่อนไขใหม่) / release = คืนสิ่งที่กันไว้เมื่อไม่อนุมัติหรือถอนคำขอ
 * ============================================================================
 */

/** ประเภทคำขอนี้ต้องให้ผู้อำนวยการอนุมัติหรือไม่ (ตามหน้าตั้งค่า) */
function approvalRequired_(type) {
  return getSetting_('APPROVAL_' + type) === true;
}

/**
 * ตัวดำเนินการของคำขอแต่ละประเภท
 *  approve(data, request, actor, note)          อนุมัติ: ตรวจเงื่อนไขใหม่ทุกครั้ง ถ้าไม่ผ่านจะ error และคำขอยังรออนุมัติ
 *  release(data, request, actor, outcome, note) ไม่อนุมัติ/ถอนคำขอ: คืนสิ่งที่กันไว้ระหว่างรอ (ถ้ามี)
 */
function approvalHandlers_() {
  return {
    FEE_ADJUSTMENT: {
      approve: function (data, request, actor) { applyFeeAdjustment_(data, request.CreatedBy, actor.username, request.RequestId, actor); },
    },
    ASSESSMENT_CANCEL: {
      approve: function (data, request, actor) { applyAssessmentCancel_(data, request.CreatedBy, request.RequestId, actor); },
    },
    RECEIPT_CANCEL: {
      approve: function (data, request, actor, note) { applyReceiptCancel_(data, request.RequestId, actor, note); },
      release: function (data, request, actor, outcome, note) { releaseReceiptCancel_(data, actor, outcome, note); },
    },
    PAYMENT_CORRECTION: {
      approve: function (data, request, actor) { applyPaymentCorrection_(data, request.Reason, request.RequestId, actor); },
    },
    BOOK_CLOSE: {
      approve: function (data, request, actor) { applyBookClose_(data, actor); },
    },
  };
}

/** presetId = รหัสที่จองไว้ด้วย dbReserveId_() เมื่อรายการอื่นต้องอ้างรหัสคำขอตั้งแต่บันทึกครั้งแรก */
function createApprovalRequest_(type, refId, studentId, summary, data, reason, actor, presetId) {
  return dbInsert_(SHEETS.APPROVAL_REQUESTS, {
    RequestId: presetId || '',
    RequestType: type,
    RefId: refId,
    StudentId: studentId || '',
    Summary: summary,
    PayloadJson: JSON.stringify(data),
    Reason: reason,
    Status: STATUS.DECISION.PENDING,
  }, actor, { action: AUDIT_ACTIONS.REQUEST, note: summary });
}

/** คำขอที่รออนุมัติ แยกตามรายการที่อ้างถึง (ใช้ปิดปุ่มในหน้าเว็บระหว่างรอ) */
function pendingRequestsByRef_() {
  const out = Object.create(null);
  dbAll_(SHEETS.APPROVAL_REQUESTS).forEach(function (r) {
    if (r.Status === STATUS.DECISION.PENDING && r.RefId) {
      out[r.RefId] = { requestId: r.RequestId, type: r.RequestType, typeLabel: STATUS_LABELS.REQUEST_TYPE[r.RequestType] || r.RequestType };
    }
  });
  return out;
}

function parseRequestData_(r) {
  try {
    const data = JSON.parse(r.PayloadJson || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    return {};
  }
}

function approvalDto_(r, students, names) {
  const s = students[r.StudentId];
  const data = parseRequestData_(r);
  return {
    requestId: r.RequestId,
    type: r.RequestType,
    typeLabel: STATUS_LABELS.REQUEST_TYPE[r.RequestType] || r.RequestType,
    refId: r.RefId,
    studentId: r.StudentId,
    studentNo: s ? s.StudentNo : '',
    studentName: s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) : '',
    summary: r.Summary,
    reason: r.Reason,
    amountSatang: typeof data.amountSatang === 'number' ? data.amountSatang : null,
    referenceDoc: typeof data.referenceDoc === 'string' ? data.referenceDoc : '',
    details: Array.isArray(data.display) ? data.display.map(function (d) {
      return { label: String(d.label), before: String(d.before), after: String(d.after), changed: d.changed === true };
    }) : [],
    status: r.Status,
    statusLabel: STATUS_LABELS.DECISION[r.Status] || r.Status,
    requestedBy: r.CreatedBy,
    requestedByName: displayNameOf_(r.CreatedBy, names),
    createdAt: r.CreatedAt,
    decidedByName: displayNameOf_(r.DecidedBy, names),
    decidedAt: r.DecidedAt,
    decisionNote: r.DecisionNote,
  };
}

function requirePendingRequest_(value) {
  const id = requireId_(value, 'APR', 'รหัสคำขอ');
  const r = dbGet_(SHEETS.APPROVAL_REQUESTS, id);
  if (!r) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบคำขอนี้');
  if (r.Status !== STATUS.DECISION.PENDING) {
    throw appError_(ERROR_CODES.CONFLICT, 'คำขอนี้' + (STATUS_LABELS.DECISION[r.Status] || r.Status) + 'แล้ว');
  }
  return r;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** approvals.list — คำขอที่รออนุมัติ (เรียงเก่าก่อน) หรือทั้งหมด (ล่าสุดก่อน 300 รายการ) */
function approvalsList_(ctx, payload) {
  const showAll = payload.status === 'ALL';
  const names = userDisplayNames_();
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const all = dbAll_(SHEETS.APPROVAL_REQUESTS);
  let rows = all
    .filter(function (r) { return showAll || r.Status === STATUS.DECISION.PENDING; })
    .map(function (r) { return approvalDto_(r, students, names); })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0); });
  if (showAll) rows = rows.reverse().slice(0, 300);
  return {
    status: showAll ? 'ALL' : 'PENDING',
    rows: rows,
    pendingCount: all.filter(function (r) { return r.Status === STATUS.DECISION.PENDING; }).length,
    canDecide: ctx.role === ROLES.DIRECTOR,
    me: ctx.username,
  };
}

/** approvals.decide — ผู้อำนวยการอนุมัติหรือไม่อนุมัติ (ไม่อนุมัติต้องระบุเหตุผล) */
function approvalsDecide_(ctx, payload) {
  const r = requirePendingRequest_(payload.requestId);
  const decision = requireEnum_(payload.decision, { APPROVE: 'APPROVE', REJECT: 'REJECT' }, 'ผลการพิจารณา');
  const approve = decision === 'APPROVE';
  const note = requireText_(payload.note, 'เหตุผลที่ไม่อนุมัติ', { optional: approve, max: 500, multiline: true });
  if (r.CreatedBy === ctx.username) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'ผู้ยื่นคำขอพิจารณาคำขอของตนเองไม่ได้');
  }
  const actor = actorFromCtx_(ctx);
  const handler = approvalHandlers_()[r.RequestType];
  if (!handler) throw appError_(ERROR_CODES.CONFLICT, 'ระบบยังไม่รองรับการพิจารณาคำขอประเภทนี้');
  const status = approve ? STATUS.DECISION.APPROVED : STATUS.DECISION.REJECTED;
  if (approve) handler.approve(parseRequestData_(r), r, actor, note);
  else if (handler.release) handler.release(parseRequestData_(r), r, actor, status, note);
  dbUpdate_(SHEETS.APPROVAL_REQUESTS, r.RequestId, {
    Status: status,
    DecidedBy: ctx.username,
    DecidedAt: nowIso_(),
    DecisionNote: note,
  }, actor, { action: approve ? AUDIT_ACTIONS.APPROVE : AUDIT_ACTIONS.REJECT, note: r.Summary });
  return {
    requestId: r.RequestId,
    status: status,
    message: (approve ? 'อนุมัติ' : 'ไม่อนุมัติ') + 'คำขอเรียบร้อยแล้ว',
  };
}

/** approvals.withdraw — ผู้ยื่นถอนคำขอที่ยังรออนุมัติ */
function approvalsWithdraw_(ctx, payload) {
  const r = requirePendingRequest_(payload.requestId);
  if (r.CreatedBy !== ctx.username) throw appError_(ERROR_CODES.FORBIDDEN, 'ถอนได้เฉพาะคำขอที่ตนเองยื่น');
  const note = requireText_(payload.note, 'เหตุผลการถอนคำขอ', { optional: true, max: 300 });
  const handler = approvalHandlers_()[r.RequestType];
  if (handler && handler.release) handler.release(parseRequestData_(r), r, actorFromCtx_(ctx), STATUS.DECISION.WITHDRAWN, note || 'ผู้ยื่นถอนคำขอ');
  dbUpdate_(SHEETS.APPROVAL_REQUESTS, r.RequestId, {
    Status: STATUS.DECISION.WITHDRAWN,
    DecidedBy: ctx.username,
    DecidedAt: nowIso_(),
    DecisionNote: note || 'ผู้ยื่นถอนคำขอ',
  }, actorFromCtx_(ctx), { action: AUDIT_ACTIONS.CANCEL, note: 'ถอนคำขอ: ' + r.Summary });
  return { requestId: r.RequestId, message: 'ถอนคำขอเรียบร้อยแล้ว' };
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Receipts.js
// ============================================================================

/**
 * ============================================================================
 *  Receipts.gs — ทะเบียนคุมเล่มและเลขที่ใบเสร็จรับเงิน
 * ----------------------------------------------------------------------------
 *  ระบบไม่ออกเลขใบเสร็จเอง: ใช้เฉพาะเลขที่ในช่วงของเล่มจริงที่ลงทะเบียนไว้
 *  - ลงทะเบียนเล่ม (เลขเล่มไม่ซ้ำ) → เปิดใช้ได้ครั้งละ 1 เล่ม
 *  - เลขที่ถัดไป = เลขต่ำสุดในช่วงของเล่มที่ยังไม่มีในทะเบียนคุม (ReceiptEntries)
 *  - เล่ม + เลขที่ ไม่ซ้ำ ตรวจภายใต้ lock ทุกครั้ง
 *  - ยกเลิกเลขที่ที่เขียนผิดหรือชำรุด (ยังไม่บันทึกรับเงิน) ต้องมีเหตุผล ยืนยันว่าเก็บฉบับจริงไว้
 *    และรอผู้อำนวยการอนุมัติถ้าตั้งค่าไว้ ระหว่างรอ เลขที่นั้นถูกกันไว้ (ไม่ถูกเสนอเป็นเลขถัดไป)
 *    ไม่อนุมัติหรือถอนคำขอ = คืนเลขที่ (แถวเดิมเก็บไว้เป็นประวัติ)
 *  - เล่มเปลี่ยนเป็น "ใช้ครบเล่ม" เมื่อทุกเลขที่ใช้แล้วหรือยกเลิกแล้ว และไม่มีคำขอยกเลิกค้าง
 *  - ปิดเล่มก่อนใช้ครบ ต้องมีเหตุผลและอนุมัติ เลขที่ที่เหลือเป็น "ไม่ได้ใช้ (ปิดเล่ม)" ใช้ต่อไม่ได้
 *  - เลขที่ขาดช่วง = เลขที่ยังไม่ใช้ แต่ต่ำกว่าเลขที่สูงสุดที่ใช้หรือยกเลิกแล้ว (เตือนจนกว่าจะบันทึกหรือยกเลิก)
 * ============================================================================
 */

const RECEIPT_BOOK_MAX_NUMBERS = 1000;

const BOOK_STATUS_ORDER_ = Object.freeze({ ACTIVE: 0, REGISTERED: 1, FULL: 2, CLOSED: 3 });

/** สถานะของเลขที่แต่ละใบในตารางเลขที่ */
const NUMBER_STATUS_LABELS = Object.freeze({
  UNUSED: 'ยังไม่ใช้',
  GAP: 'ขาดช่วง',
  USED: 'ใช้แล้ว',
  CANCEL_PENDING: 'รออนุมัติยกเลิก',
  CANCELLED: 'ยกเลิก',
  CLOSED_UNUSED: 'ไม่ได้ใช้ (ปิดเล่ม)',
});

const KEEP_ORIGINAL_MESSAGE = 'กรุณายืนยันว่าเก็บใบเสร็จฉบับที่ยกเลิกไว้ครบทุกส่วนแล้ว (ห้ามฉีกทิ้ง)';

function receiptSettings_() {
  return {
    lowWarning: getSetting_('RECEIPT_LOW_WARNING'),
    strict: getSetting_('RECEIPT_STRICT_SEQUENCE'),
  };
}

function receiptEntriesByBook_() {
  const out = Object.create(null);
  dbAll_(SHEETS.RECEIPT_ENTRIES).forEach(function (e) {
    (out[e.BookId] || (out[e.BookId] = [])).push(e);
  });
  return out;
}

function entriesOfBook_(bookId) {
  return dbFind_(SHEETS.RECEIPT_ENTRIES, function (e) { return e.BookId === bookId; });
}

/**
 * การใช้เลขที่ของเล่ม: ใช้แล้ว ยกเลิก รออนุมัติยกเลิก คงเหลือ เลขที่ถัดไป และเลขที่ขาดช่วง
 * แถวที่คืนเลขที่แล้ว (RELEASED) ไม่นับ / เล่มที่ปิดแล้ว เลขที่ที่เหลือเป็น "ไม่ได้ใช้ (ปิดเล่ม)"
 */
function bookUsage_(book, entries) {
  const taken = Object.create(null);
  const byNo = Object.create(null);
  let used = 0;
  let cancelled = 0;
  let pending = 0;
  let maxTaken = null;
  (entries || []).forEach(function (e) {
    if (e.Status === STATUS.RECEIPT_ENTRY.RELEASED) return;
    taken[e.ReceiptNo] = true;
    byNo[e.ReceiptNo] = e;
    if (e.Status === STATUS.RECEIPT_ENTRY.USED) used += 1;
    else if (e.Status === STATUS.RECEIPT_ENTRY.CANCELLED) cancelled += 1;
    else if (e.Status === STATUS.RECEIPT_ENTRY.CANCEL_PENDING) pending += 1;
    if (maxTaken === null || e.ReceiptNo > maxTaken) maxTaken = e.ReceiptNo;
  });
  const closed = book.Status === STATUS.BOOK.CLOSED;
  let nextNo = null;
  let remaining = 0;
  const gaps = [];
  for (let n = book.StartNo; n <= book.EndNo; n++) {
    if (taken[n]) continue;
    remaining += 1;
    if (closed) continue;
    if (nextNo === null) nextNo = n;
    if (maxTaken !== null && n < maxTaken) gaps.push(n);
  }
  return {
    total: book.EndNo - book.StartNo + 1,
    usedCount: used,
    cancelledCount: cancelled,
    pendingCount: pending,
    remaining: closed ? 0 : remaining,
    closedUnused: closed ? remaining : 0,
    nextNo: closed ? null : nextNo,
    maxTaken: maxTaken,
    gaps: gaps,
    taken: taken,
    byNo: byNo,
  };
}

function bookDto_(b, usage, settings) {
  return {
    bookId: b.BookId,
    bookNo: b.BookNo,
    startNo: b.StartNo,
    endNo: b.EndNo,
    receivedDate: b.ReceivedDate,
    startUseDate: b.StartUseDate,
    closedDate: b.ClosedDate,
    closeReason: b.CloseReason,
    responsibleName: b.ResponsibleName,
    status: b.Status,
    statusLabel: STATUS_LABELS.BOOK[b.Status] || b.Status,
    note: b.Note,
    total: usage.total,
    usedCount: usage.usedCount,
    cancelledCount: usage.cancelledCount,
    pendingCount: usage.pendingCount,
    remaining: usage.remaining,
    closedUnused: usage.closedUnused,
    nextNo: b.Status === STATUS.BOOK.ACTIVE ? usage.nextNo : null,
    gaps: b.Status === STATUS.BOOK.ACTIVE ? usage.gaps : [],
    low: b.Status === STATUS.BOOK.ACTIVE && usage.remaining <= settings.lowWarning,
    createdAt: b.CreatedAt,
  };
}

function activeBooks_() {
  return dbFind_(SHEETS.RECEIPT_BOOKS, function (b) { return b.Status === STATUS.BOOK.ACTIVE; });
}

/** เล่มที่กำลังใช้ (null = ยังไม่มี) */
function activeBook_() {
  const books = activeBooks_();
  if (books.length > 1) {
    throw appError_(ERROR_CODES.INTERNAL,
      'พบเล่มใบเสร็จที่กำลังใช้มากกว่า 1 เล่ม อาจมีการแก้ไขชีตโดยตรง กรุณาให้ผู้ดูแลระบบตรวจสอบชีต ReceiptBooks');
  }
  return books.length ? books[0] : null;
}

/** ข้อมูลเล่มที่กำลังใช้และเลขที่ถัดไป สำหรับหน้ารับเงิน */
function activeBookInfo_() {
  const b = activeBook_();
  if (!b) return null;
  const dto = bookDto_(b, bookUsage_(b, entriesOfBook_(b.BookId)), receiptSettings_());
  const pending = pendingRequestsByRef_()[b.BookId];
  dto.pendingClose = pending && pending.type === STATUS.REQUEST_TYPE.BOOK_CLOSE ? pending : null;
  return dto;
}

function requireBook_(value) {
  const id = requireId_(value, 'BOOK', 'รหัสเล่มใบเสร็จ');
  const b = dbGet_(SHEETS.RECEIPT_BOOKS, id);
  if (!b) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบเล่มใบเสร็จนี้');
  return b;
}

/** เปลี่ยนเล่มเป็น "ใช้ครบเล่ม" เมื่อทุกเลขที่ใช้แล้วหรือยกเลิกแล้ว และไม่มีคำขอยกเลิกที่รออนุมัติ */
function refreshBookStatus_(bookId, actor) {
  const b = dbGet_(SHEETS.RECEIPT_BOOKS, bookId);
  if (!b || b.Status !== STATUS.BOOK.ACTIVE) return b;
  const usage = bookUsage_(b, entriesOfBook_(bookId));
  if (usage.remaining === 0 && usage.pendingCount === 0) {
    return dbUpdate_(SHEETS.RECEIPT_BOOKS, bookId, { Status: STATUS.BOOK.FULL, ClosedDate: todayIso_() }, actor,
      { note: 'ใช้ครบเล่มที่ ' + b.BookNo }).after;
  }
  return b;
}

function receiptWhere_(bookNo, receiptNo) {
  return 'เล่มที่ ' + bookNo + ' เลขที่ ' + receiptNo;
}

function validateBookInput_(payload) {
  const bookNo = requireText_(payload.bookNo, 'เลขเล่ม', { max: 30 }).replace(/\s+/g, ' ');
  const startNo = requireInt_(payload.startNo, 'เลขที่เริ่มต้น', { min: 1, max: 99999999 });
  const endNo = requireInt_(payload.endNo, 'เลขที่สิ้นสุด', { min: 1, max: 99999999 });
  if (endNo < startNo) throw validationError_('เลขที่สิ้นสุดต้องไม่น้อยกว่าเลขที่เริ่มต้น');
  if (endNo - startNo + 1 > RECEIPT_BOOK_MAX_NUMBERS) {
    throw validationError_('เล่มหนึ่งมีได้ไม่เกิน ' + RECEIPT_BOOK_MAX_NUMBERS + ' เลขที่ กรุณาตรวจเลขที่เริ่มต้นและสิ้นสุดอีกครั้ง');
  }
  const receivedDate = requireIsoDate_(payload.receivedDate, 'วันที่ได้รับเล่ม', { optional: true });
  if (receivedDate && receivedDate > todayIso_()) throw validationError_('วันที่ได้รับเล่มต้องไม่เป็นวันในอนาคต');
  return {
    bookNo: bookNo,
    startNo: startNo,
    endNo: endNo,
    receivedDate: receivedDate,
    note: requireText_(payload.note, 'หมายเหตุ', { optional: true, max: 300 }),
  };
}

function requireKeptOriginal_(payload) {
  if (payload.confirmKept !== true) throw validationError_(KEEP_ORIGINAL_MESSAGE);
}

// ---------------------------------------------------------------------------
// API: ทะเบียนเล่ม
// ---------------------------------------------------------------------------

/** receipts.books — ทะเบียนเล่มใบเสร็จทั้งหมด พร้อมการใช้เลขที่ */
function receiptsBooks_(ctx, payload) {
  const byBook = receiptEntriesByBook_();
  const settings = receiptSettings_();
  const pending = pendingRequestsByRef_();
  const books = dbAll_(SHEETS.RECEIPT_BOOKS)
    .map(function (b) {
      const dto = bookDto_(b, bookUsage_(b, byBook[b.BookId]), settings);
      dto.pendingRequest = pending[b.BookId] || null;
      return dto;
    })
    .sort(function (a, b) {
      const sa = BOOK_STATUS_ORDER_[a.status] === undefined ? 9 : BOOK_STATUS_ORDER_[a.status];
      const sb = BOOK_STATUS_ORDER_[b.status] === undefined ? 9 : BOOK_STATUS_ORDER_[b.status];
      if (sa !== sb) return sa - sb;
      return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0);
    });
  return {
    books: books,
    hasActive: books.some(function (b) { return b.status === STATUS.BOOK.ACTIVE; }),
    lowWarning: settings.lowWarning,
    strict: settings.strict,
    canManage: ctx.role === ROLES.FINANCE,
  };
}

/** receipts.book — รายละเอียดเล่ม และตารางเลขที่ทุกใบพร้อมสถานะ */
function receiptsBook_(ctx, payload) {
  const b = requireBook_(payload.bookId);
  const entries = entriesOfBook_(b.BookId);
  const usage = bookUsage_(b, entries);
  const settings = receiptSettings_();
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const payments = Object.create(null);
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) { if (p.ReceiptBookId === b.BookId) payments[p.PaymentId] = p; });
  const cancelByEntry = Object.create(null);
  dbFind_(SHEETS.RECEIPT_CANCELLATIONS, function (c) { return c.BookId === b.BookId; }).forEach(function (c) {
    const cur = cancelByEntry[c.EntryId];
    if (!cur || c.CreatedAt >= cur.CreatedAt) cancelByEntry[c.EntryId] = c;
  });
  const gapSet = Object.create(null);
  usage.gaps.forEach(function (n) { gapSet[n] = true; });
  const pending = pendingRequestsByRef_();
  const numbers = [];
  for (let n = b.StartNo; n <= b.EndNo; n++) {
    const e = usage.byNo[n];
    let status;
    if (e) status = e.Status;
    else if (b.Status === STATUS.BOOK.CLOSED) status = 'CLOSED_UNUSED';
    else status = gapSet[n] ? 'GAP' : 'UNUSED';
    const item = { no: n, status: status, statusLabel: NUMBER_STATUS_LABELS[status] || status };
    if (e) {
      const p = e.PaymentId ? payments[e.PaymentId] : null;
      const s = students[e.StudentId];
      const c = cancelByEntry[e.EntryId];
      item.entryId = e.EntryId;
      item.paymentId = e.PaymentId;
      item.date = e.ReceiptDate;
      item.amountSatang = e.Amount === null ? null : satangOf_(e.Amount);
      item.studentId = e.StudentId;
      item.studentName = s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) : '';
      item.studentNo = s ? s.StudentNo : '';
      item.paymentStatus = p ? p.Status : '';
      item.corrected = !!(p && p.ReplacesPaymentId);
      item.cancelType = c ? c.CancelType : '';
      item.cancelTypeLabel = c ? (STATUS_LABELS.CANCEL_TYPE[c.CancelType] || c.CancelType) : '';
      item.cancelReason = c ? c.Reason : '';
      item.cancelStatus = c ? c.Status : '';
      item.cancelledBy = c ? c.CreatedBy : '';
      item.decidedBy = c ? c.DecidedBy : '';
      item.pendingRequest = pending[e.EntryId] || (e.PaymentId ? pending[e.PaymentId] : null) || null;
    }
    numbers.push(item);
  }
  const dto = bookDto_(b, usage, settings);
  dto.pendingRequest = pending[b.BookId] || null;
  return {
    book: dto,
    numbers: numbers,
    strict: settings.strict,
    canManage: ctx.role === ROLES.FINANCE,
  };
}

/** receipts.registerBook — ลงทะเบียนเล่มใบเสร็จที่ได้รับ */
function receiptsRegisterBook_(ctx, payload) {
  const v = validateBookInput_(payload);
  const rec = dbInsert_(SHEETS.RECEIPT_BOOKS, {
    BookNo: v.bookNo,
    StartNo: v.startNo,
    EndNo: v.endNo,
    ReceivedDate: v.receivedDate,
    Status: STATUS.BOOK.REGISTERED,
    Note: v.note,
  }, actorFromCtx_(ctx), { note: 'ลงทะเบียนเล่มใบเสร็จ เล่มที่ ' + v.bookNo + ' เลขที่ ' + v.startNo + '–' + v.endNo });
  return bookDto_(rec, bookUsage_(rec, []), receiptSettings_());
}

/** receipts.updateBook — แก้ไขข้อมูลเล่มที่ยังไม่เริ่มใช้ (กรณีลงทะเบียนผิด) */
function receiptsUpdateBook_(ctx, payload) {
  const b = requireBook_(payload.bookId);
  if (b.Status !== STATUS.BOOK.REGISTERED) throw appError_(ERROR_CODES.CONFLICT, 'แก้ไขได้เฉพาะเล่มที่ยังไม่เริ่มใช้');
  if (dbFindOne_(SHEETS.RECEIPT_ENTRIES, function (e) { return e.BookId === b.BookId; })) {
    throw appError_(ERROR_CODES.CONFLICT, 'เล่มนี้มีการใช้เลขที่แล้ว แก้ไขไม่ได้');
  }
  const v = validateBookInput_(payload);
  const result = dbUpdate_(SHEETS.RECEIPT_BOOKS, b.BookId, {
    BookNo: v.bookNo,
    StartNo: v.startNo,
    EndNo: v.endNo,
    ReceivedDate: v.receivedDate,
    Note: v.note,
  }, actorFromCtx_(ctx), { note: 'แก้ไขข้อมูลเล่มใบเสร็จที่ยังไม่เริ่มใช้' });
  return bookDto_(result.after, bookUsage_(result.after, []), receiptSettings_());
}

/** receipts.activateBook — เปิดใช้เล่มใหม่ (ได้เมื่อไม่มีเล่มที่กำลังใช้อยู่) */
function receiptsActivateBook_(ctx, payload) {
  const b = requireBook_(payload.bookId);
  if (b.Status !== STATUS.BOOK.REGISTERED) {
    throw appError_(ERROR_CODES.CONFLICT, 'เปิดใช้ได้เฉพาะเล่มที่ลงทะเบียนแล้วและยังไม่เคยใช้');
  }
  if (pendingRequestsByRef_()[b.BookId]) {
    throw appError_(ERROR_CODES.CONFLICT, 'เล่มนี้มีคำขอปิดเล่มที่รออนุมัติ จึงเปิดใช้ไม่ได้');
  }
  const current = activeBook_();
  if (current) {
    throw appError_(ERROR_CODES.CONFLICT, 'เล่มที่ ' + current.BookNo + ' ยังใช้ไม่ครบ ต้องใช้ให้ครบเล่มหรือปิดเล่มเดิมก่อน จึงเปิดเล่มใหม่ได้');
  }
  const result = dbUpdate_(SHEETS.RECEIPT_BOOKS, b.BookId, {
    Status: STATUS.BOOK.ACTIVE,
    StartUseDate: todayIso_(),
    ResponsibleUserId: ctx.userId,
    ResponsibleName: ctx.displayName || ctx.username,
  }, actorFromCtx_(ctx), { note: 'เปิดใช้เล่มใบเสร็จ เล่มที่ ' + b.BookNo });
  return bookDto_(result.after, bookUsage_(result.after, []), receiptSettings_());
}

// ---------------------------------------------------------------------------
// API: ยกเลิกเลขที่ที่เขียนผิดหรือชำรุด (ยังไม่บันทึกรับเงิน)
// ---------------------------------------------------------------------------

/** receipts.requestCancelNumber — กันเลขที่ไว้ทันที แล้วรออนุมัติ (หรือยกเลิกทันทีถ้าไม่ต้องอนุมัติ) */
function receiptsRequestCancelNumber_(ctx, payload) {
  const b = requireBook_(payload.bookId);
  if (b.Status !== STATUS.BOOK.ACTIVE) throw appError_(ERROR_CODES.CONFLICT, 'ยกเลิกเลขที่ได้เฉพาะเล่มที่กำลังใช้');
  const receiptNo = requireInt_(payload.receiptNo, 'เลขที่ใบเสร็จ', { min: 1, max: 99999999 });
  if (receiptNo < b.StartNo || receiptNo > b.EndNo) {
    throw validationError_('เลขที่ ' + receiptNo + ' ไม่อยู่ในเล่มที่ ' + b.BookNo + ' (เลขที่ ' + b.StartNo + '–' + b.EndNo + ')');
  }
  const reason = requireText_(payload.reason, 'เหตุผลการยกเลิก', { max: 500, multiline: true });
  requireKeptOriginal_(payload);
  const usage = bookUsage_(b, entriesOfBook_(b.BookId));
  if (usage.taken[receiptNo]) {
    throw appError_(ERROR_CODES.CONFLICT, 'เลขที่ ' + receiptNo + ' ถูกใช้หรือยกเลิกไปแล้ว ถ้าเป็นใบเสร็จที่บันทึกรับเงินแล้ว ให้ใช้ "ยกเลิกใบเสร็จ" ที่รายการรับเงินนั้นแทน',
      { reason: 'RECEIPT_NO_TAKEN' });
  }
  const needApproval = approvalRequired_(STATUS.REQUEST_TYPE.RECEIPT_CANCEL);
  const actor = actorFromCtx_(ctx);
  const where = receiptWhere_(b.BookNo, receiptNo);
  const summary = 'ยกเลิกเลขที่ใบเสร็จ ' + where + ' (เขียนผิดหรือชำรุด ยังไม่ได้บันทึกรับเงิน)';
  const requestId = needApproval ? dbReserveId_(SHEETS.APPROVAL_REQUESTS) : '';
  const entry = dbInsert_(SHEETS.RECEIPT_ENTRIES, {
    BookId: b.BookId,
    BookNo: b.BookNo,
    ReceiptNo: receiptNo,
    Status: needApproval ? STATUS.RECEIPT_ENTRY.CANCEL_PENDING : STATUS.RECEIPT_ENTRY.CANCELLED,
    PaymentId: '',
    ReceiptDate: todayIso_(),
    Amount: null,
    StudentId: '',
  }, actor, { action: needApproval ? AUDIT_ACTIONS.REQUEST : AUDIT_ACTIONS.CANCEL, note: summary });
  const cancel = dbInsert_(SHEETS.RECEIPT_CANCELLATIONS, {
    EntryId: entry.EntryId,
    BookId: b.BookId,
    BookNo: b.BookNo,
    ReceiptNo: receiptNo,
    CancelType: STATUS.CANCEL_TYPE.SPOILED,
    PaymentId: '',
    Amount: null,
    Reason: reason,
    Status: needApproval ? STATUS.DECISION.PENDING : STATUS.DECISION.APPROVED,
    DecisionNote: needApproval ? '' : 'ไม่ต้องอนุมัติตามการตั้งค่า',
    ApprovalRequestId: requestId,
  }, actor, { action: needApproval ? AUDIT_ACTIONS.REQUEST : AUDIT_ACTIONS.CANCEL, note: summary });
  if (needApproval) {
    createApprovalRequest_(STATUS.REQUEST_TYPE.RECEIPT_CANCEL, entry.EntryId, '', summary, {
      cancellationId: cancel.CancellationId,
      entryId: entry.EntryId,
      cancelType: STATUS.CANCEL_TYPE.SPOILED,
      bookId: b.BookId,
      receiptNo: receiptNo,
    }, reason, actor, requestId);
    return { applied: false, requestId: requestId, message: 'กันเลขที่ ' + receiptNo + ' ไว้แล้ว และส่งคำขอยกเลิกให้ผู้อำนวยการพิจารณาแล้ว' };
  }
  refreshBookStatus_(b.BookId, actor);
  return { applied: true, message: 'ยกเลิกเลขที่ใบเสร็จ ' + where + ' เรียบร้อยแล้ว' };
}

/** อนุมัติการยกเลิกเลขที่ (ทั้งเลขที่เขียนผิด และใบเสร็จที่บันทึกรับเงินแล้ว) */
function applyReceiptCancel_(data, requestId, actor, note) {
  const c = dbGet_(SHEETS.RECEIPT_CANCELLATIONS, data.cancellationId);
  if (!c) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลการยกเลิกเลขที่');
  if (c.Status === STATUS.DECISION.APPROVED) return c;
  if (c.Status !== STATUS.DECISION.PENDING) throw appError_(ERROR_CODES.CONFLICT, 'คำขอยกเลิกนี้ไม่ได้อยู่ระหว่างรออนุมัติ');
  const e = dbGet_(SHEETS.RECEIPT_ENTRIES, c.EntryId);
  if (!e || e.Status !== STATUS.RECEIPT_ENTRY.CANCEL_PENDING) {
    throw appError_(ERROR_CODES.CONFLICT, 'สถานะของเลขที่ใบเสร็จนี้เปลี่ยนไปแล้ว กรุณาตรวจสอบทะเบียนคุม');
  }
  if (c.CancelType === STATUS.CANCEL_TYPE.VOID_PAYMENT) voidPaymentRecords_(c.PaymentId, c.Reason, requestId, actor);
  dbUpdate_(SHEETS.RECEIPT_ENTRIES, e.EntryId, { Status: STATUS.RECEIPT_ENTRY.CANCELLED }, actor,
    { action: AUDIT_ACTIONS.CANCEL, note: 'ยกเลิก' + receiptWhere_(e.BookNo, e.ReceiptNo) });
  dbUpdate_(SHEETS.RECEIPT_CANCELLATIONS, c.CancellationId, {
    Status: STATUS.DECISION.APPROVED,
    DecidedBy: actor.username,
    DecidedAt: nowIso_(),
    DecisionNote: note || '',
  }, actor, { action: AUDIT_ACTIONS.APPROVE, note: 'อนุมัติยกเลิก' + receiptWhere_(e.BookNo, e.ReceiptNo) });
  refreshBookStatus_(e.BookId, actor);
  return c;
}

/** ไม่อนุมัติหรือถอนคำขอยกเลิก: เลขที่ที่ยังไม่บันทึกรับเงินถูกคืน / ใบเสร็จที่บันทึกรับเงินแล้วกลับเป็น "ใช้แล้ว" */
function releaseReceiptCancel_(data, actor, outcome, note) {
  const c = dbGet_(SHEETS.RECEIPT_CANCELLATIONS, data.cancellationId);
  if (!c || c.Status !== STATUS.DECISION.PENDING) return;
  const e = dbGet_(SHEETS.RECEIPT_ENTRIES, c.EntryId);
  if (e && e.Status === STATUS.RECEIPT_ENTRY.CANCEL_PENDING) {
    const back = c.CancelType === STATUS.CANCEL_TYPE.SPOILED ? STATUS.RECEIPT_ENTRY.RELEASED : STATUS.RECEIPT_ENTRY.USED;
    dbUpdate_(SHEETS.RECEIPT_ENTRIES, e.EntryId, { Status: back }, actor, {
      note: (back === STATUS.RECEIPT_ENTRY.RELEASED ? 'คืนเลขที่ ' : 'ใบเสร็จกลับเป็นใช้แล้ว ') + receiptWhere_(e.BookNo, e.ReceiptNo) +
        ' (' + (STATUS_LABELS.DECISION[outcome] || outcome) + ')',
    });
  }
  dbUpdate_(SHEETS.RECEIPT_CANCELLATIONS, c.CancellationId, {
    Status: outcome,
    DecidedBy: actor.username,
    DecidedAt: nowIso_(),
    DecisionNote: note || '',
  }, actor, { action: outcome === STATUS.DECISION.REJECTED ? AUDIT_ACTIONS.REJECT : AUDIT_ACTIONS.CANCEL, note: 'คำขอยกเลิก' + receiptWhere_(c.BookNo, c.ReceiptNo) });
}

// ---------------------------------------------------------------------------
// API: ปิดเล่มก่อนใช้ครบ
// ---------------------------------------------------------------------------

/** receipts.requestCloseBook — ขอปิดเล่มที่กำลังใช้หรือยังไม่เริ่มใช้ เลขที่ที่เหลือจะใช้ไม่ได้อีก */
function receiptsRequestCloseBook_(ctx, payload) {
  const b = requireBook_(payload.bookId);
  const reason = requireText_(payload.reason, 'เหตุผลการปิดเล่ม', { max: 500, multiline: true });
  const usage = checkBookClosable_(b);
  assertNoPendingRequest_(b.BookId);
  const actor = actorFromCtx_(ctx);
  const summary = 'ปิดเล่มใบเสร็จ เล่มที่ ' + b.BookNo + ' ก่อนใช้ครบ (เลขที่ที่ยังไม่ใช้ ' + usage.remaining + ' ใบ จะใช้ไม่ได้อีก)';
  const data = { bookId: b.BookId, reason: reason };
  if (approvalRequired_(STATUS.REQUEST_TYPE.BOOK_CLOSE)) {
    const req = createApprovalRequest_(STATUS.REQUEST_TYPE.BOOK_CLOSE, b.BookId, '', summary, data, reason, actor);
    return { applied: false, requestId: req.RequestId, message: 'ส่งคำขอปิดเล่มที่ ' + b.BookNo + ' ให้ผู้อำนวยการพิจารณาแล้ว' };
  }
  applyBookClose_(data, actor);
  return { applied: true, message: 'ปิดเล่มที่ ' + b.BookNo + ' เรียบร้อยแล้ว' };
}

function checkBookClosable_(b) {
  if (b.Status !== STATUS.BOOK.ACTIVE && b.Status !== STATUS.BOOK.REGISTERED) {
    throw appError_(ERROR_CODES.CONFLICT, 'ปิดได้เฉพาะเล่มที่กำลังใช้หรือยังไม่เริ่มใช้ (เล่มนี้' + (STATUS_LABELS.BOOK[b.Status] || b.Status) + 'แล้ว)');
  }
  const usage = bookUsage_(b, entriesOfBook_(b.BookId));
  if (usage.pendingCount > 0) {
    throw appError_(ERROR_CODES.CONFLICT, 'เล่มนี้มีคำขอยกเลิกเลขที่ที่รออนุมัติ ' + usage.pendingCount + ' รายการ กรุณาให้ผู้อำนวยการพิจารณาคำขอเหล่านั้นก่อน');
  }
  if (usage.remaining === 0) throw appError_(ERROR_CODES.CONFLICT, 'เล่มนี้ไม่มีเลขที่เหลือแล้ว ไม่ต้องปิดเล่ม');
  return usage;
}

function applyBookClose_(data, actor) {
  const b = dbGet_(SHEETS.RECEIPT_BOOKS, data.bookId);
  if (!b) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบเล่มใบเสร็จนี้');
  if (b.Status === STATUS.BOOK.CLOSED) return b;
  checkBookClosable_(b);
  return dbUpdate_(SHEETS.RECEIPT_BOOKS, b.BookId, {
    Status: STATUS.BOOK.CLOSED,
    ClosedDate: todayIso_(),
    CloseReason: data.reason,
  }, actor, { action: AUDIT_ACTIONS.CANCEL, note: 'ปิดเล่มใบเสร็จ เล่มที่ ' + b.BookNo + ' ก่อนใช้ครบ' }).after;
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Payments.js
// ============================================================================

/**
 * ============================================================================
 *  Payments.gs — บันทึกการรับชำระเงิน (1 ครั้ง = ใบเสร็จจริง 1 ฉบับ)
 * ----------------------------------------------------------------------------
 *  บันทึกรับเงิน (ทั้งหมดอยู่ภายใต้ lock เดียว):
 *   1. ต้องยืนยันว่าได้ตรวจใบเสร็จฉบับจริงแล้ว
 *   2. RequestKey ซ้ำ = คำขอเดิมที่ส่งซ้ำ ตอบผลเดิมโดยไม่บันทึกซ้ำ
 *   3. ตรวจเล่มที่กำลังใช้และเลขที่ (ไม่ซ้ำ อยู่ในช่วงของเล่ม เรียงลำดับตามการตั้งค่า)
 *   4. คำนวณยอดคงเหลือใหม่ แล้วตรวจว่ายอดตัดชำระรวมเท่ากับเงินที่รับ และไม่เกินยอดคงเหลือ
 *   5. บันทึกทะเบียนคุมเลขที่ → การรับเงิน → การตัดชำระ (ตรวจทุกเงื่อนไขก่อนเริ่มเขียน)
 *   6. ใช้ครบเล่มแล้ว เปลี่ยนสถานะเล่มเป็น "ใช้ครบเล่ม"
 *  ระบบไม่รับเงินเกินยอดค้าง และไม่มีเงินเครดิตล่วงหน้า (D-09)
 *
 *  แก้ไขหลังบันทึก (ไม่มีการลบ ทุกขั้นมีประวัติ และรออนุมัติถ้าตั้งค่าไว้):
 *   - ยกเลิกใบเสร็จ: การรับเงินและการตัดชำระเป็น "ยกเลิก" ยอดค้างกลับมา เลขที่ใบเสร็จเป็น "ยกเลิก"
 *     ระหว่างรออนุมัติ การรับเงินเดิมยังมีผล
 *   - แก้ไขรายการบันทึกผิด (ใบเสร็จจริงถูกต้อง): รายการเดิมเป็น "ถูกแทนด้วยรายการแก้ไข"
 *     แล้วสร้างรายการใหม่ที่อ้างเลขใบเสร็จเดิม เลขที่นั้นไม่ถือว่ายกเลิก (D-14)
 * ============================================================================
 */

const PAYMENT_CONFIRM_TEXT = 'ข้าพเจ้าได้ตรวจสอบใบเสร็จรับเงินฉบับจริงแล้ว เลขเล่ม เลขที่ และจำนวนเงินตรงกับที่บันทึก';
const PAYMENT_MAX_ALLOCATIONS = 50;
const PAYMENT_LIST_MAX_DAYS = 92;

/** ช่องทางที่ไม่ใช่เงินสดต้องกรอกเลขอ้างอิง เช่น เลขรายการโอน (D-04) */
function isCashChannel_(channel) {
  return /เงินสด/.test(String(channel || ''));
}

function paymentChannels_() {
  const list = getSetting_('PAYMENT_CHANNELS');
  return list.length ? list : ['เงินสด'];
}

/** รายการที่ยังค้างชำระของนักเรียน เรียงหนี้เก่าก่อน */
function outstandingItems_(studentId, lc) {
  return dbFind_(SHEETS.FEE_ASSESSMENTS, function (a) {
    return a.StudentId === studentId && a.Status === STATUS.ASSESSMENT.ACTIVE;
  })
    .map(function (a) { return assessmentDto_(a, lc); })
    .filter(function (d) { return d.outstandingSatang > 0; })
    .sort(compareForPayment_);
}

function latestEnrollmentOf_(studentId) {
  let latest = null;
  dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.StudentId === studentId; }).forEach(function (e) {
    if (!latest || e.AcademicYear > latest.AcademicYear) latest = e;
  });
  return latest;
}

function daysBetween_(fromIso, toIso) {
  const a = fromIso.split('-').map(Number);
  const b = toIso.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

function requirePayment_(value) {
  const id = requireId_(value, 'PAY', 'รหัสการรับเงิน');
  const p = dbGet_(SHEETS.PAYMENTS, id);
  if (!p) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการรับเงินนี้');
  return p;
}

function requireActivePayment_(value) {
  const p = requirePayment_(value);
  if (p.Status !== STATUS.PAYMENT.ACTIVE) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการรับเงินนี้' + (STATUS_LABELS.PAYMENT[p.Status] || p.Status) + 'แล้ว');
  }
  return p;
}

/** ยอดคงเหลือแบบที่ยังไม่นับการรับเงินรายการหนึ่ง (ใช้ตอนแก้ไขรายการที่บันทึกผิด) */
function ledgerContextExcluding_(paymentId) {
  const lc = ledgerContext_();
  if (!paymentId) return lc;
  lc.allocations.forEach(function (al) {
    if (al.PaymentId !== paymentId || al.Status !== STATUS.ALLOCATION.ACTIVE) return;
    lc.paidBy[al.AssessmentId] = (lc.paidBy[al.AssessmentId] || 0) - satangOf_(al.Amount);
  });
  return lc;
}

function studentLabel_(studentId) {
  const s = dbGet_(SHEETS.STUDENTS, studentId);
  return s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) + ' (' + s.StudentNo + ')' : studentId;
}

/** ผลการรับเงินที่ส่งกลับไปหน้าเว็บ (ใช้ทั้งบันทึกใหม่และคำขอที่ส่งซ้ำ) */
function paymentResult_(payment) {
  const lc = ledgerContext_();
  const names = userDisplayNames_();
  const labels = Object.create(null);
  const affected = [];
  lc.allocations.forEach(function (al) {
    if (al.PaymentId !== payment.PaymentId || al.Status !== STATUS.ALLOCATION.ACTIVE) return;
    const asm = dbGet_(SHEETS.FEE_ASSESSMENTS, al.AssessmentId);
    if (!asm) return;
    const dto = assessmentDto_(asm, lc);
    labels[asm.AssessmentId] = dto.label;
    affected.push(dto);
  });
  const student = dbGet_(SHEETS.STUDENTS, payment.StudentId);
  const items = outstandingItems_(payment.StudentId, lc);
  const book = activeBookInfo_();
  const warnings = [];
  if (!book) warnings.push('ไม่มีเล่มใบเสร็จที่กำลังใช้ (เล่มเดิมใช้ครบแล้ว) กรุณาเปิดใช้เล่มใหม่ในหน้า "เล่มใบเสร็จ" ก่อนรับเงินครั้งถัดไป');
  else if (book.nextNo === null) warnings.push('เล่มที่ ' + book.bookNo + ' ไม่มีเลขที่ว่างแล้ว (เลขที่ที่เหลือรออนุมัติยกเลิก)');
  else if (book.low) warnings.push('เล่มที่ ' + book.bookNo + ' เหลือ ' + book.remaining + ' ฉบับ กรุณาเตรียมลงทะเบียนเล่มใหม่');
  return {
    duplicate: false,
    payment: paymentDto_(payment, lc, labels, names),
    student: student ? studentDto_(student, latestEnrollmentOf_(student.StudentId)) : null,
    assessments: affected,
    outstandingSatang: items.reduce(function (sum, d) { return sum + d.outstandingSatang; }, 0),
    book: book,
    warnings: warnings,
  };
}

/** ตรวจการตัดชำระกับยอดคงเหลือล่าสุด (ภายใต้ lock) คืนค่า [{ asm, satang }] */
function validateAllocations_(list, studentId, amountSatang, lcOverride) {
  if (!Array.isArray(list) || !list.length) throw validationError_('กรุณาระบุรายการที่ตัดชำระ');
  if (list.length > PAYMENT_MAX_ALLOCATIONS) throw validationError_('ตัดชำระได้ไม่เกิน ' + PAYMENT_MAX_ALLOCATIONS + ' รายการต่อใบเสร็จ');
  const lc = lcOverride || ledgerContext_();
  const seen = Object.create(null);
  const out = [];
  let total = 0;
  list.forEach(function (item) {
    const asmId = requireId_(item && item.assessmentId, 'ASM', 'รายการที่ตัดชำระ');
    if (seen[asmId]) throw validationError_('มีรายการตัดชำระซ้ำกัน');
    seen[asmId] = true;
    const asm = dbGet_(SHEETS.FEE_ASSESSMENTS, asmId);
    if (!asm || asm.StudentId !== studentId) throw validationError_('รายการที่ตัดชำระไม่ใช่ของนักเรียนคนนี้');
    const label = assessmentLabel_(asm, lc);
    if (asm.Status !== STATUS.ASSESSMENT.ACTIVE) {
      throw appError_(ERROR_CODES.CONFLICT, 'รายการ "' + label + '" ถูกยกเลิกแล้ว', { reason: 'BALANCE_CHANGED' });
    }
    const satang = requireMoney_(item.amount, 'ยอดตัดชำระของ ' + label);
    const fig = assessmentFigures_(asm, lc);
    if (satang > fig.outstandingSatang) {
      throw appError_(ERROR_CODES.CONFLICT, 'ยอดตัดชำระของ "' + label + '" เกินยอดคงเหลือ (คงเหลือ ' +
        formatSatang_(fig.outstandingSatang, true) + ') ระบบไม่รับเงินเกินยอดค้าง', { reason: 'BALANCE_CHANGED' });
    }
    total += satang;
    out.push({ asm: asm, satang: satang });
  });
  if (total !== amountSatang) {
    throw validationError_('ยอดตัดชำระรวม ' + formatSatang_(total, true) + ' ไม่เท่ากับจำนวนเงินที่รับ ' + formatSatang_(amountSatang, true));
  }
  return out;
}

/** ข้อมูลการรับเงินที่กรอก (ใช้ทั้งบันทึกใหม่และการแก้ไขรายการ) */
function validatePaymentFields_(payload) {
  const paymentDate = requireIsoDate_(payload.paymentDate, 'วันที่รับเงิน');
  if (paymentDate > todayIso_()) throw validationError_('วันที่รับเงินต้องไม่เป็นวันในอนาคต');
  const amountSatang = requireMoney_(payload.amount, 'จำนวนเงินที่รับ');
  const channel = requireText_(payload.channel, 'ช่องทางการรับเงิน', { max: 100 });
  if (paymentChannels_().indexOf(channel) === -1) throw validationError_('ช่องทางการรับเงินไม่อยู่ในรายการที่ตั้งค่าไว้');
  return {
    paymentDate: paymentDate,
    amountSatang: amountSatang,
    channel: channel,
    channelRef: requireText_(isCashChannel_(channel) ? '' : payload.channelRef, 'เลขอ้างอิงการโอน', { optional: isCashChannel_(channel), max: 100 }),
    receivedByName: requireText_(payload.receivedByName, 'ชื่อผู้รับเงิน', { max: 100 }),
    note: requireText_(payload.note, 'หมายเหตุ', { optional: true, max: 300, multiline: true }),
  };
}

/** ยกเลิกการรับเงินและการตัดชำระ (ยอดค้างกลับมา) — ใช้เมื่อยกเลิกใบเสร็จที่บันทึกรับเงินแล้ว */
function voidPaymentRecords_(paymentId, reason, requestId, actor) {
  const p = dbGet_(SHEETS.PAYMENTS, paymentId);
  if (!p) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการรับเงิน');
  if (p.Status !== STATUS.PAYMENT.ACTIVE) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการรับเงินนี้' + (STATUS_LABELS.PAYMENT[p.Status] || p.Status) + 'แล้ว');
  }
  assertDayOpen_(p.PaymentDate, 'ยกเลิกใบเสร็จของวันนั้น');
  const where = receiptWhere_(p.ReceiptBookNo, p.ReceiptNo);
  dbUpdate_(SHEETS.PAYMENTS, p.PaymentId, {
    Status: STATUS.PAYMENT.VOIDED,
    VoidReason: reason,
    VoidedAt: nowIso_(),
    VoidedBy: actor.username,
    ApprovalRequestId: requestId || '',
  }, actor, { action: AUDIT_ACTIONS.CANCEL, note: 'ยกเลิกใบเสร็จ ' + where });
  dbFind_(SHEETS.PAYMENT_ALLOCATIONS, function (al) {
    return al.PaymentId === p.PaymentId && al.Status === STATUS.ALLOCATION.ACTIVE;
  }).forEach(function (al) {
    dbUpdate_(SHEETS.PAYMENT_ALLOCATIONS, al.AllocationId, { Status: STATUS.ALLOCATION.VOIDED }, actor,
      { action: AUDIT_ACTIONS.CANCEL, note: 'ยกเลิกการตัดชำระจากใบเสร็จ ' + where });
  });
}

/** ข้อความเปรียบเทียบค่าเดิมกับค่าใหม่ของการแก้ไขรายการ (แสดงให้ผู้อนุมัติ) */
function correctionDisplay_(p, next, lcOld, lcNew) {
  const names = userDisplayNames_();
  const oldAlloc = paymentDto_(p, lcOld, allocationLabels_(lcOld), names).allocations
    .map(function (al) { return al.label + ' ' + formatSatang_(al.amountSatang); }).join(' / ');
  const newAlloc = next.allocations.map(function (al) {
    const asm = dbGet_(SHEETS.FEE_ASSESSMENTS, al.assessmentId);
    return (asm ? assessmentLabel_(asm, lcNew) : al.assessmentId) + ' ' + formatSatang_(al.amountSatang);
  }).join(' / ');
  const rows = [
    ['นักเรียน', studentLabel_(p.StudentId), studentLabel_(next.studentId)],
    ['วันที่รับเงิน', formatThaiDate_(p.PaymentDate), formatThaiDate_(next.paymentDate)],
    ['จำนวนเงิน', formatSatang_(satangOf_(p.Amount), true), formatSatang_(next.amountSatang, true)],
    ['ช่องทาง', p.Channel + (p.ChannelRef ? ' (' + p.ChannelRef + ')' : ''), next.channel + (next.channelRef ? ' (' + next.channelRef + ')' : '')],
    ['ผู้รับเงิน', p.ReceivedByName, next.receivedByName],
    ['หมายเหตุ', p.Note || '–', next.note || '–'],
    ['รายการที่ตัดชำระ', oldAlloc, newAlloc],
  ];
  return rows.map(function (r) { return { label: r[0], before: r[1], after: r[2], changed: r[1] !== r[2] }; });
}

function allocationLabels_(lc) {
  const labels = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) { labels[a.AssessmentId] = assessmentLabel_(a, lc); });
  return labels;
}

// ---------------------------------------------------------------------------
// API: รับเงิน
// ---------------------------------------------------------------------------

/** payments.context — ข้อมูลสำหรับหน้ารับเงิน: เล่มที่กำลังใช้ เลขที่ถัดไป และรายการค้างของนักเรียน (ถ้าระบุ) */
function paymentsContext_(ctx, payload) {
  const settings = receiptSettings_();
  const out = {
    book: activeBookInfo_(),
    strict: settings.strict,
    channels: paymentChannels_(),
    today: todayIso_(),
    receivedByName: ctx.displayName || ctx.username,
    confirmText: PAYMENT_CONFIRM_TEXT,
  };
  if (isBlankInput_(payload.studentId)) return out;
  const id = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const s = dbGet_(SHEETS.STUDENTS, id);
  if (!s) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const lc = ledgerContext_();
  const names = userDisplayNames_();
  out.student = studentDto_(s, latestEnrollmentOf_(id));
  out.items = outstandingItems_(id, lc);
  out.outstandingSatang = out.items.reduce(function (sum, d) { return sum + d.outstandingSatang; }, 0);
  const labels = Object.create(null);
  dbFind_(SHEETS.FEE_ASSESSMENTS, function (a) { return a.StudentId === id; })
    .forEach(function (a) { labels[a.AssessmentId] = assessmentLabel_(a, lc); });
  out.recentPayments = dbFind_(SHEETS.PAYMENTS, function (p) { return p.StudentId === id; })
    .map(function (p) { return paymentDto_(p, lc, labels, names); })
    .sort(comparePaymentsDesc_)
    .slice(0, 5);
  return out;
}

/** payments.create — บันทึกการรับเงินตามใบเสร็จจริง */
function paymentsCreate_(ctx, payload) {
  if (payload.confirmPhysicalReceipt !== true) {
    throw validationError_('กรุณาติ๊กยืนยันว่าได้ตรวจสอบใบเสร็จรับเงินฉบับจริงแล้ว');
  }
  const requestKey = requireText_(payload.requestKey, 'รหัสคำขอ', {
    max: 64, pattern: /^[A-Za-z0-9-]{16,64}$/, patternMessage: 'รหัสคำขอไม่ถูกต้อง กรุณาเปิดหน้ารับเงินใหม่',
  });
  const studentId = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');

  // คำขอเดิมที่ส่งซ้ำ (กดบันทึกซ้ำ หรือเน็ตหลุดแล้วส่งใหม่): ตอบผลเดิม ไม่บันทึกซ้ำ
  const existing = dbFindOne_(SHEETS.PAYMENTS, function (p) { return p.RequestKey === requestKey; });
  if (existing) {
    if (existing.StudentId !== studentId) {
      throw appError_(ERROR_CODES.CONFLICT, 'รหัสคำขอนี้ถูกใช้กับนักเรียนคนอื่นแล้ว กรุณาเปิดหน้ารับเงินใหม่');
    }
    const again = paymentResult_(existing);
    again.duplicate = true;
    return again;
  }
  const student = dbGet_(SHEETS.STUDENTS, studentId);
  if (!student) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const f = validatePaymentFields_(payload);
  assertDayOpen_(f.paymentDate, 'บันทึกรับเงินในวันนั้น');

  // เล่มและเลขที่ใบเสร็จ
  const book = activeBook_();
  if (!book) {
    throw appError_(ERROR_CODES.CONFLICT, 'ยังไม่มีเล่มใบเสร็จที่กำลังใช้ กรุณาลงทะเบียนและเปิดใช้เล่มในหน้า "เล่มใบเสร็จ" ก่อน', { reason: 'BOOK_CHANGED' });
  }
  if (payload.bookId !== book.BookId) {
    throw appError_(ERROR_CODES.CONFLICT, 'เล่มใบเสร็จที่กำลังใช้เปลี่ยนเป็นเล่มที่ ' + book.BookNo + ' แล้ว กรุณาตรวจเลขเล่มและเลขที่อีกครั้ง', { reason: 'BOOK_CHANGED' });
  }
  const receiptNo = requireInt_(payload.receiptNo, 'เลขที่ใบเสร็จ', { min: 1, max: 99999999 });
  const usage = bookUsage_(book, entriesOfBook_(book.BookId));
  if (receiptNo < book.StartNo || receiptNo > book.EndNo) {
    throw validationError_('เลขที่ ' + receiptNo + ' ไม่อยู่ในเล่มที่ ' + book.BookNo + ' (เลขที่ ' + book.StartNo + '–' + book.EndNo + ')');
  }
  if (usage.taken[receiptNo]) {
    throw appError_(ERROR_CODES.CONFLICT, 'เลขที่ใบเสร็จ ' + receiptNo + ' ของเล่มที่ ' + book.BookNo + ' ถูกบันทึกแล้ว ใช้ซ้ำไม่ได้' +
      (usage.nextNo !== null ? ' เลขที่ถัดไปคือ ' + usage.nextNo : ''), { reason: 'RECEIPT_NO_TAKEN' });
  }
  if (receiptNo !== usage.nextNo) {
    if (receiptSettings_().strict) {
      throw appError_(ERROR_CODES.CONFLICT, 'ต้องใช้เลขที่ถัดไปคือ ' + usage.nextNo + ' (ระบบตั้งค่าให้ใช้เลขที่เรียงลำดับ) ถ้าใบเสร็จเลขที่ ' +
        usage.nextNo + ' เขียนผิดหรือชำรุด ต้องบันทึกยกเลิกเลขที่นั้นก่อน', { reason: 'RECEIPT_STRICT' });
    }
    if (payload.confirmSkipNumber !== true) {
      throw appError_(ERROR_CODES.CONFLICT, 'เลขที่ ' + receiptNo + ' ไม่ใช่เลขที่ถัดไป (' + usage.nextNo +
        ') การข้ามเลขทำให้เกิดเลขที่ขาดช่วงที่ต้องอธิบายได้ ยืนยันหรือไม่', { reason: 'RECEIPT_GAP_CONFIRM' });
    }
  }

  // การตัดชำระ (คำนวณยอดคงเหลือใหม่ภายใต้ lock)
  const allocations = validateAllocations_(payload.allocations, studentId, f.amountSatang);

  // บันทึก: ทะเบียนคุมเลขที่ → การรับเงิน → การตัดชำระ
  const actor = actorFromCtx_(ctx);
  const where = receiptWhere_(book.BookNo, receiptNo);
  const paymentId = dbReserveId_(SHEETS.PAYMENTS);
  const entry = dbInsert_(SHEETS.RECEIPT_ENTRIES, {
    BookId: book.BookId,
    BookNo: book.BookNo,
    ReceiptNo: receiptNo,
    Status: STATUS.RECEIPT_ENTRY.USED,
    PaymentId: paymentId,
    ReceiptDate: f.paymentDate,
    Amount: satangToBaht_(f.amountSatang),
    StudentId: studentId,
  }, actor, { note: 'ใช้ใบเสร็จ ' + where });
  const payment = dbInsert_(SHEETS.PAYMENTS, {
    PaymentId: paymentId,
    RequestKey: requestKey,
    StudentId: studentId,
    PaymentDate: f.paymentDate,
    Amount: satangToBaht_(f.amountSatang),
    Channel: f.channel,
    ChannelRef: f.channelRef,
    ReceiptBookId: book.BookId,
    ReceiptBookNo: book.BookNo,
    ReceiptNo: receiptNo,
    ReceiptEntryId: entry.EntryId,
    ReceivedByName: f.receivedByName,
    Note: f.note,
    Status: STATUS.PAYMENT.ACTIVE,
  }, actor, { note: 'รับเงิน ' + formatSatang_(f.amountSatang, true) + ' ใบเสร็จ' + where });
  dbInsertMany_(SHEETS.PAYMENT_ALLOCATIONS, allocations.map(function (al) {
    return {
      PaymentId: paymentId,
      AssessmentId: al.asm.AssessmentId,
      StudentId: studentId,
      AcademicYear: al.asm.AcademicYear,
      Amount: satangToBaht_(al.satang),
      Status: STATUS.ALLOCATION.ACTIVE,
    };
  }), actor, { note: 'ตัดชำระจากใบเสร็จ' + where });

  refreshBookStatus_(book.BookId, actor);
  return paymentResult_(payment);
}

// ---------------------------------------------------------------------------
// API: รายละเอียด ยกเลิกใบเสร็จ และแก้ไขรายการที่บันทึกผิด
// ---------------------------------------------------------------------------

/**
 * payments.get — รายละเอียดการรับเงิน พร้อมข้อมูลสำหรับฟอร์มแก้ไข
 * payload.studentId (ไม่บังคับ) = นักเรียนที่จะย้ายการรับเงินไปให้ กรณีบันทึกผิดคน
 */
function paymentsGet_(ctx, payload) {
  const p = requirePayment_(payload.paymentId);
  const lc = ledgerContextExcluding_(p.Status === STATUS.PAYMENT.ACTIVE ? p.PaymentId : null);
  const names = userDisplayNames_();
  const labels = allocationLabels_(lc);
  const targetId = isBlankInput_(payload.studentId) ? p.StudentId : requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const target = dbGet_(SHEETS.STUDENTS, targetId);
  if (!target) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const allocated = Object.create(null);
  lc.allocations.forEach(function (al) {
    if (al.PaymentId === p.PaymentId && al.Status === STATUS.ALLOCATION.ACTIVE) allocated[al.AssessmentId] = satangOf_(al.Amount);
  });
  // ยอดที่ตัดชำระได้ = ยอดคงเหลือแบบไม่นับการรับเงินรายการนี้
  const items = dbFind_(SHEETS.FEE_ASSESSMENTS, function (a) { return a.StudentId === targetId && a.Status === STATUS.ASSESSMENT.ACTIVE; })
    .map(function (a) {
      const dto = assessmentDto_(a, lc);
      dto.allocatedSatang = targetId === p.StudentId ? (allocated[a.AssessmentId] || 0) : 0;
      return dto;
    })
    .filter(function (d) { return d.outstandingSatang > 0 || d.allocatedSatang > 0; })
    .sort(compareForPayment_);
  const dto = paymentDto_(p, ledgerContext_(), labels, names);
  const pending = pendingRequestsByRef_()[p.PaymentId] || null;
  const related = dbFind_(SHEETS.PAYMENTS, function (x) {
    return x.PaymentId === p.ReplacesPaymentId || x.PaymentId === p.ReplacedByPaymentId;
  }).map(function (x) { return { paymentId: x.PaymentId, status: x.Status, statusLabel: STATUS_LABELS.PAYMENT[x.Status] || x.Status, amountSatang: satangOf_(x.Amount), date: x.PaymentDate }; });
  return {
    payment: dto,
    student: studentDto_(target, latestEnrollmentOf_(targetId)),
    originalStudent: studentDto_(dbGet_(SHEETS.STUDENTS, p.StudentId), latestEnrollmentOf_(p.StudentId)),
    items: items,
    channels: paymentChannels_(),
    today: todayIso_(),
    pendingRequest: pending,
    related: related,
    canRequest: ctx.role === ROLES.FINANCE && p.Status === STATUS.PAYMENT.ACTIVE && !pending,
  };
}

/** payments.requestVoid — ขอยกเลิกใบเสร็จที่บันทึกรับเงินแล้ว (ใบเสร็จเขียนผิดทั้งฉบับ) */
function paymentsRequestVoid_(ctx, payload) {
  const p = requireActivePayment_(payload.paymentId);
  const reason = requireText_(payload.reason, 'เหตุผลการยกเลิกใบเสร็จ', { max: 500, multiline: true });
  requireKeptOriginal_(payload);
  assertNoPendingRequest_(p.PaymentId);
  assertDayOpen_(p.PaymentDate, 'ยกเลิกใบเสร็จของวันนั้น');
  const entry = dbGet_(SHEETS.RECEIPT_ENTRIES, p.ReceiptEntryId);
  if (!entry || entry.Status !== STATUS.RECEIPT_ENTRY.USED) {
    throw appError_(ERROR_CODES.CONFLICT, 'สถานะของเลขที่ใบเสร็จนี้ไม่ใช่ "ใช้แล้ว" กรุณาตรวจสอบทะเบียนคุม');
  }
  const needApproval = approvalRequired_(STATUS.REQUEST_TYPE.RECEIPT_CANCEL);
  const actor = actorFromCtx_(ctx);
  const where = receiptWhere_(p.ReceiptBookNo, p.ReceiptNo);
  const summary = 'ยกเลิกใบเสร็จ ' + where + ' จำนวน ' + formatSatang_(satangOf_(p.Amount), true) + ': ' + studentLabel_(p.StudentId);
  const requestId = needApproval ? dbReserveId_(SHEETS.APPROVAL_REQUESTS) : '';
  if (needApproval) {
    dbUpdate_(SHEETS.RECEIPT_ENTRIES, entry.EntryId, { Status: STATUS.RECEIPT_ENTRY.CANCEL_PENDING }, actor,
      { action: AUDIT_ACTIONS.REQUEST, note: summary });
  }
  const cancel = dbInsert_(SHEETS.RECEIPT_CANCELLATIONS, {
    EntryId: entry.EntryId,
    BookId: entry.BookId,
    BookNo: entry.BookNo,
    ReceiptNo: entry.ReceiptNo,
    CancelType: STATUS.CANCEL_TYPE.VOID_PAYMENT,
    PaymentId: p.PaymentId,
    Amount: p.Amount,
    Reason: reason,
    Status: needApproval ? STATUS.DECISION.PENDING : STATUS.DECISION.APPROVED,
    DecisionNote: needApproval ? '' : 'ไม่ต้องอนุมัติตามการตั้งค่า',
    ApprovalRequestId: requestId,
  }, actor, { action: needApproval ? AUDIT_ACTIONS.REQUEST : AUDIT_ACTIONS.CANCEL, note: summary });
  if (needApproval) {
    createApprovalRequest_(STATUS.REQUEST_TYPE.RECEIPT_CANCEL, p.PaymentId, p.StudentId, summary, {
      cancellationId: cancel.CancellationId,
      entryId: entry.EntryId,
      paymentId: p.PaymentId,
      cancelType: STATUS.CANCEL_TYPE.VOID_PAYMENT,
      amountSatang: satangOf_(p.Amount),
    }, reason, actor, requestId);
    return { applied: false, requestId: requestId, message: 'ส่งคำขอยกเลิกใบเสร็จ ' + where + ' ให้ผู้อำนวยการพิจารณาแล้ว (ระหว่างรอ การรับเงินเดิมยังมีผล)' };
  }
  voidPaymentRecords_(p.PaymentId, reason, '', actor);
  dbUpdate_(SHEETS.RECEIPT_ENTRIES, entry.EntryId, { Status: STATUS.RECEIPT_ENTRY.CANCELLED }, actor,
    { action: AUDIT_ACTIONS.CANCEL, note: 'ยกเลิก' + where });
  return { applied: true, message: 'ยกเลิกใบเสร็จ ' + where + ' เรียบร้อยแล้ว ยอดค้างของนักเรียนกลับมาตามเดิม' };
}

/** ตรวจข้อมูลที่แก้ไข (ยอดคงเหลือคิดแบบไม่นับการรับเงินรายการเดิม) */
function validateCorrection_(p, payload) {
  const studentId = isBlankInput_(payload.studentId) ? p.StudentId : requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  if (!dbGet_(SHEETS.STUDENTS, studentId)) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const f = validatePaymentFields_(payload);
  const lc = ledgerContextExcluding_(p.PaymentId);
  const allocations = validateAllocations_(payload.allocations, studentId, f.amountSatang, lc);
  return {
    paymentId: p.PaymentId,
    studentId: studentId,
    paymentDate: f.paymentDate,
    amountSatang: f.amountSatang,
    channel: f.channel,
    channelRef: f.channelRef,
    receivedByName: f.receivedByName,
    note: f.note,
    allocations: allocations.map(function (al) { return { assessmentId: al.asm.AssessmentId, amountSatang: al.satang }; }),
  };
}

/** payments.requestCorrection — ขอแก้ไขรายการรับเงินที่บันทึกผิด (ใบเสร็จจริงถูกต้อง เลขที่ใบเสร็จไม่เปลี่ยน) */
function paymentsRequestCorrection_(ctx, payload) {
  const p = requireActivePayment_(payload.paymentId);
  const reason = requireText_(payload.reason, 'เหตุผลการแก้ไข', { max: 500, multiline: true });
  assertNoPendingRequest_(p.PaymentId);
  assertDayOpen_(p.PaymentDate, 'แก้ไขรายการรับเงินของวันนั้น');
  const next = validateCorrection_(p, payload);
  assertDayOpen_(next.paymentDate, 'ย้ายรายการรับเงินไปวันนั้น');
  const display = correctionDisplay_(p, next, ledgerContext_(), ledgerContextExcluding_(p.PaymentId));
  if (!display.some(function (d) { return d.changed; })) throw validationError_('ข้อมูลที่แก้ไขเหมือนรายการเดิมทุกช่อง');
  next.display = display;
  const actor = actorFromCtx_(ctx);
  const where = receiptWhere_(p.ReceiptBookNo, p.ReceiptNo);
  const summary = 'แก้ไขรายการรับเงินที่บันทึกผิด ใบเสร็จ' + where + ': ' + studentLabel_(p.StudentId) +
    ' (' + display.filter(function (d) { return d.changed; }).map(function (d) { return d.label; }).join(', ') + ')';
  if (approvalRequired_(STATUS.REQUEST_TYPE.PAYMENT_CORRECTION)) {
    const req = createApprovalRequest_(STATUS.REQUEST_TYPE.PAYMENT_CORRECTION, p.PaymentId, p.StudentId, summary, next, reason, actor);
    return { applied: false, requestId: req.RequestId, message: 'ส่งคำขอแก้ไขรายการใบเสร็จ' + where + ' ให้ผู้อำนวยการพิจารณาแล้ว (ระหว่างรอ รายการเดิมยังมีผล)' };
  }
  const result = applyPaymentCorrection_(next, reason, '', actor);
  return { applied: true, paymentId: result.PaymentId, message: 'แก้ไขรายการใบเสร็จ' + where + ' เรียบร้อยแล้ว' };
}

/** ทำการแก้ไข: รายการเดิม → ถูกแทน, สร้างรายการใหม่ที่อ้างเลขใบเสร็จเดิม และปรับทะเบียนคุมให้ชี้รายการใหม่ */
function applyPaymentCorrection_(data, reason, requestId, actor) {
  const old = dbGet_(SHEETS.PAYMENTS, data.paymentId);
  if (!old) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการรับเงินเดิม');
  if (requestId && old.Status === STATUS.PAYMENT.REPLACED && old.ApprovalRequestId === requestId) {
    return dbGet_(SHEETS.PAYMENTS, old.ReplacedByPaymentId);
  }
  if (old.Status !== STATUS.PAYMENT.ACTIVE) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการรับเงินเดิม' + (STATUS_LABELS.PAYMENT[old.Status] || old.Status) + 'แล้ว จึงแก้ไขไม่ได้');
  }
  assertDayOpen_(old.PaymentDate, 'แก้ไขรายการรับเงินของวันนั้น');
  assertDayOpen_(data.paymentDate, 'ย้ายรายการรับเงินไปวันนั้น');
  const entry = dbGet_(SHEETS.RECEIPT_ENTRIES, old.ReceiptEntryId);
  if (!entry || entry.Status !== STATUS.RECEIPT_ENTRY.USED || entry.PaymentId !== old.PaymentId) {
    throw appError_(ERROR_CODES.CONFLICT, 'สถานะของเลขที่ใบเสร็จนี้เปลี่ยนไปแล้ว กรุณาตรวจสอบทะเบียนคุม');
  }
  // ตรวจยอดคงเหลือใหม่ภายใต้ lock (ยอดอาจเปลี่ยนไประหว่างรออนุมัติ)
  const lc = ledgerContextExcluding_(old.PaymentId);
  const allocations = validateAllocations_(data.allocations.map(function (al) {
    return { assessmentId: al.assessmentId, amount: formatSatang_(al.amountSatang) };
  }), data.studentId, data.amountSatang, lc);
  const where = receiptWhere_(old.ReceiptBookNo, old.ReceiptNo);
  const newId = dbReserveId_(SHEETS.PAYMENTS);
  dbUpdate_(SHEETS.PAYMENTS, old.PaymentId, {
    Status: STATUS.PAYMENT.REPLACED,
    VoidReason: reason,
    VoidedAt: nowIso_(),
    VoidedBy: actor.username,
    ReplacedByPaymentId: newId,
    ApprovalRequestId: requestId || '',
  }, actor, { note: 'แก้ไขรายการบันทึกผิด ใบเสร็จ' + where + ' (รายการเดิม)' });
  dbFind_(SHEETS.PAYMENT_ALLOCATIONS, function (al) {
    return al.PaymentId === old.PaymentId && al.Status === STATUS.ALLOCATION.ACTIVE;
  }).forEach(function (al) {
    dbUpdate_(SHEETS.PAYMENT_ALLOCATIONS, al.AllocationId, { Status: STATUS.ALLOCATION.VOIDED }, actor,
      { note: 'แก้ไขรายการบันทึกผิด ใบเสร็จ' + where + ' (การตัดชำระเดิม)' });
  });
  const created = dbInsert_(SHEETS.PAYMENTS, {
    PaymentId: newId,
    RequestKey: 'CORR-' + (requestId || newId),
    StudentId: data.studentId,
    PaymentDate: data.paymentDate,
    Amount: satangToBaht_(data.amountSatang),
    Channel: data.channel,
    ChannelRef: data.channelRef,
    ReceiptBookId: old.ReceiptBookId,
    ReceiptBookNo: old.ReceiptBookNo,
    ReceiptNo: old.ReceiptNo,
    ReceiptEntryId: old.ReceiptEntryId,
    ReceivedByName: data.receivedByName,
    Note: data.note,
    Status: STATUS.PAYMENT.ACTIVE,
    ReplacesPaymentId: old.PaymentId,
    ApprovalRequestId: requestId || '',
  }, actor, { note: 'แก้ไขรายการบันทึกผิด ใบเสร็จ' + where + ' (รายการใหม่)' });
  dbInsertMany_(SHEETS.PAYMENT_ALLOCATIONS, allocations.map(function (al) {
    return {
      PaymentId: newId,
      AssessmentId: al.asm.AssessmentId,
      StudentId: data.studentId,
      AcademicYear: al.asm.AcademicYear,
      Amount: satangToBaht_(al.satang),
      Status: STATUS.ALLOCATION.ACTIVE,
    };
  }), actor, { note: 'แก้ไขรายการบันทึกผิด ใบเสร็จ' + where + ' (การตัดชำระใหม่)' });
  dbUpdate_(SHEETS.RECEIPT_ENTRIES, entry.EntryId, {
    PaymentId: newId,
    ReceiptDate: data.paymentDate,
    Amount: satangToBaht_(data.amountSatang),
    StudentId: data.studentId,
  }, actor, { note: 'แก้ไขรายการบันทึกผิด ใบเสร็จ' + where });
  return created;
}

/** payments.list — รายการรับเงินตามช่วงวันที่ (ไม่เกิน 92 วัน) เรียงตามวันที่และเลขที่ใบเสร็จ */
function paymentsList_(ctx, payload) {
  const today = todayIso_();
  const fromDate = requireIsoDate_(isBlankInput_(payload.fromDate) ? today : payload.fromDate, 'วันที่เริ่มต้น');
  const toDate = requireIsoDate_(isBlankInput_(payload.toDate) ? fromDate : payload.toDate, 'วันที่สิ้นสุด');
  if (toDate < fromDate) throw validationError_('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น');
  if (daysBetween_(fromDate, toDate) >= PAYMENT_LIST_MAX_DAYS) {
    throw validationError_('ดูรายการได้ครั้งละไม่เกิน ' + PAYMENT_LIST_MAX_DAYS + ' วัน');
  }
  const lc = ledgerContext_();
  const names = userDisplayNames_();
  const labels = allocationLabels_(lc);
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const rows = dbFind_(SHEETS.PAYMENTS, function (p) { return p.PaymentDate >= fromDate && p.PaymentDate <= toDate; })
    .map(function (p) {
      const dto = paymentDto_(p, lc, labels, names);
      const s = students[p.StudentId];
      dto.studentNo = s ? s.StudentNo : '';
      dto.studentName = s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) : '';
      return dto;
    })
    .sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.bookNo !== b.bookNo) return compareText_(a.bookNo, b.bookNo);
      if (a.receiptNo !== b.receiptNo) return a.receiptNo - b.receiptNo;
      return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0);
    });
  const byChannel = Object.create(null);
  let totalSatang = 0;
  let activeCount = 0;
  rows.forEach(function (r) {
    if (r.status !== STATUS.PAYMENT.ACTIVE) return;
    activeCount += 1;
    totalSatang += r.amountSatang;
    byChannel[r.channel] = (byChannel[r.channel] || 0) + r.amountSatang;
  });
  return {
    fromDate: fromDate,
    toDate: toDate,
    rows: rows,
    totals: {
      count: activeCount,
      totalSatang: totalSatang,
      byChannel: Object.keys(byChannel).map(function (k) { return { channel: k, totalSatang: byChannel[k] }; }),
    },
  };
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Arrears.js
// ============================================================================

/**
 * ============================================================================
 *  Arrears.gs — ยอดค้างชำระ รายนักเรียน ห้อง ชั้น ทั้งโรงเรียน และยอดค้างสะสมจากปีก่อน
 * ----------------------------------------------------------------------------
 *  - ยอดค้าง = ยอดเรียกเก็บสุทธิ − ยอดชำระ ของรายการเรียกเก็บที่มีผล (คำนวณจาก Ledger ทุกครั้ง ไม่เก็บไว้ในชีต)
 *  - เมื่อเลือกปีการศึกษาหนึ่ง:
 *      ปีนี้           = ยอดค้างของรายการเรียกเก็บปีการศึกษานั้น
 *      ค้างจากปีก่อน    = ยอดค้างของรายการเรียกเก็บปีการศึกษาก่อนหน้า (ยอดค้างสะสม)
 *      ปีถัดไป          = ยอดค้างของปีหลังจากนั้น (มีเฉพาะเมื่อดูปีที่ผ่านมาแล้ว)
 *      รวมทุกปี        = ผลรวมทั้งหมด
 *  - จัดกลุ่มตามชั้นและห้องของนักเรียนในปีการศึกษาที่เลือก
 *    นักเรียนที่ยังมียอดค้างแต่ไม่มีชั้นเรียนในปีนั้น (เช่น ย้ายออก จบการศึกษา) แสดงแยกกลุ่ม
 *    และยังนับในยอดรวมทั้งโรงเรียน (หนี้ไม่ถูกตัดอัตโนมัติ: D-10)
 *  - เลยกำหนด = ยอดค้างของรายการที่วันครบกำหนดผ่านมาแล้ว
 *  - อัตราการชำระ = ยอดชำระ ÷ ยอดเรียกเก็บสุทธิ ของปีที่เลือก
 * ============================================================================
 */

const ARREARS_FIELDS_ = Object.freeze(['netSatang', 'paidSatang', 'currentSatang', 'priorSatang', 'laterSatang', 'totalSatang', 'overdueSatang']);

function emptyArrears_() {
  const out = { students: 0, owingStudents: 0 };
  ARREARS_FIELDS_.forEach(function (k) { out[k] = 0; });
  return out;
}

function addArrears_(target, row) {
  target.students += 1;
  if (row.totalSatang > 0) target.owingStudents += 1;
  ARREARS_FIELDS_.forEach(function (k) { target[k] += row[k]; });
}

/** ยอดของนักเรียนทุกคน แยกตามปีการศึกษาที่เลือก */
function arrearsByStudent_(year, lc) {
  const out = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (asm) {
    if (asm.Status !== STATUS.ASSESSMENT.ACTIVE) return;
    const f = assessmentFigures_(asm, lc);
    let r = out[asm.StudentId];
    if (!r) {
      r = out[asm.StudentId] = { years: Object.create(null), oldestDue: '' };
      ARREARS_FIELDS_.forEach(function (k) { r[k] = 0; });
    }
    if (asm.AcademicYear === year) {
      r.netSatang += f.netSatang;
      r.paidSatang += f.paidSatang;
      r.currentSatang += f.outstandingSatang;
    } else if (asm.AcademicYear < year) {
      r.priorSatang += f.outstandingSatang;
    } else {
      r.laterSatang += f.outstandingSatang;
    }
    r.totalSatang += f.outstandingSatang;
    if (f.outstandingSatang > 0) {
      r.years[asm.AcademicYear] = (r.years[asm.AcademicYear] || 0) + f.outstandingSatang;
      if (asm.DueDate && asm.DueDate < lc.today) r.overdueSatang += f.outstandingSatang;
      if (asm.DueDate && (!r.oldestDue || asm.DueDate < r.oldestDue)) r.oldestDue = asm.DueDate;
    }
  });
  return out;
}

/**
 * arrears.summary — ยอดค้างของปีการศึกษาที่เลือก: ทั้งโรงเรียน รายชั้น รายห้อง และรายนักเรียน
 * payload: { year } (ค่าเริ่มต้น = ปีการศึกษาปัจจุบัน)
 */
function arrearsSummary_(ctx, payload) {
  const year = isBlankInput_(payload.year) ? currentAcademicYear_() : requireAcademicYear_(payload.year);
  const lc = ledgerContext_();
  const levels = gradeLevels_();
  const figures = arrearsByStudent_(year, lc);
  const enrollments = Object.create(null);
  dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === year; }).forEach(function (e) { enrollments[e.StudentId] = e; });

  const rows = [];
  dbAll_(SHEETS.STUDENTS).forEach(function (s) {
    const e = enrollments[s.StudentId] || null;
    const f = figures[s.StudentId];
    if (!e && (!f || f.totalSatang <= 0)) return; // ไม่ได้เรียนปีนี้ และไม่มียอดค้าง
    const row = {
      studentId: s.StudentId,
      studentNo: s.StudentNo,
      fullName: studentDisplayName_(s.Prefix, s.FirstName, s.LastName),
      firstName: s.FirstName,
      status: s.Status,
      statusLabel: STATUS_LABELS.STUDENT[s.Status] || s.Status,
      enrolled: !!e,
      gradeLevel: e ? e.GradeLevel : '',
      room: e ? e.Room : '',
      classNo: e ? e.ClassNo : null,
      classLabel: e ? classLabel_(e.GradeLevel, e.Room) : '',
      enrollStatus: e ? e.EnrollStatus : '',
      enrollStatusLabel: e ? (STATUS_LABELS.STUDENT[e.EnrollStatus] || e.EnrollStatus) : '',
      oldestDue: f ? f.oldestDue : '',
      years: f ? Object.keys(f.years).map(Number).sort().map(function (y) { return { year: y, satang: f.years[y] }; }) : [],
    };
    ARREARS_FIELDS_.forEach(function (k) { row[k] = f ? f[k] : 0; });
    rows.push(row);
  });
  const byClass = compareStudentRows_(levels);
  rows.sort(function (a, b) {
    if (a.enrolled !== b.enrolled) return a.enrolled ? -1 : 1;
    return a.enrolled ? byClass(a, b) : compareText_(a.firstName, b.firstName);
  });

  const school = emptyArrears_();
  const enrolledTotals = emptyArrears_();
  const other = emptyArrears_();
  const grades = Object.create(null);
  rows.forEach(function (r) {
    addArrears_(school, r);
    if (!r.enrolled) { addArrears_(other, r); return; }
    addArrears_(enrolledTotals, r);
    const g = grades[r.gradeLevel] || (grades[r.gradeLevel] = Object.assign(emptyArrears_(), { gradeLevel: r.gradeLevel, rooms: Object.create(null) }));
    addArrears_(g, r);
    const room = g.rooms[r.room] || (g.rooms[r.room] = Object.assign(emptyArrears_(), { room: r.room, classLabel: classLabel_(r.gradeLevel, r.room) }));
    addArrears_(room, r);
  });
  const gradeList = Object.keys(grades)
    .sort(function (a, b) {
      const ga = levels.indexOf(a);
      const gb = levels.indexOf(b);
      return (ga === -1 ? 999 : ga) - (gb === -1 ? 999 : gb) || compareText_(a, b);
    })
    .map(function (k) {
      const g = grades[k];
      g.rooms = Object.keys(g.rooms).sort(compareRoom_).map(function (r) { return g.rooms[r]; });
      return g;
    });
  return {
    year: year,
    today: lc.today,
    generatedAt: nowIso_(),
    school: school,
    enrolled: enrolledTotals,
    other: other,
    grades: gradeList,
    rows: rows,
    gradeLevels: levels,
  };
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Closings.js
// ============================================================================

/**
 * ============================================================================
 *  Closings.gs — การปิดยอดประจำวัน (D-19, D-37)
 * ----------------------------------------------------------------------------
 *  - เจ้าหน้าที่การเงินพิมพ์รายงานรับเงินประจำวัน ตรวจกับเงินและสำเนาใบเสร็จ แล้วกด "ปิดยอด"
 *  - ระบบเก็บ "รหัสตรวจสอบ" = SHA-256 ของรายการรับเงินที่มีผลในวันนั้น และพิมพ์ไว้ในรายงานที่ลงนาม
 *    ถ้าข้อมูลของวันนั้นถูกแก้ภายหลัง (เช่น แก้ชีตด้วยมือ) รหัสที่คำนวณใหม่จะไม่ตรงกับกระดาษที่ลงนาม
 *  - วันที่ปิดยอดแล้ว: บันทึกรับเงิน ขอยกเลิกใบเสร็จ หรือขอแก้ไขรายการที่มีวันที่นั้นไม่ได้
 *    ต้องให้ผู้อำนวยการ "เปิดยอดใหม่" พร้อมเหตุผลก่อน (ประวัติการปิดยอดเดิมยังอยู่ในชีต)
 *  - ปิดยอดไม่ได้ถ้ายังมีคำขอยกเลิกหรือแก้ไขใบเสร็จของวันนั้นที่รอพิจารณา
 * ============================================================================
 */

const CLOSING_CONFIRM_TEXT = 'ตรวจนับเงินและสำเนาใบเสร็จตรงกับรายงานนี้แล้ว';
const CLOSING_LOOKBACK_DAYS = 30; // ช่วงที่ใช้เตือน "ยังไม่ปิดยอด"

/** การปิดยอดที่มีผลของวันที่ (ไม่นับที่เปิดยอดใหม่แล้ว) */
function closingOf_(date) {
  return dbFindOne_(SHEETS.DAILY_CLOSINGS, function (c) {
    return c.ClosingDate === date && c.Status === STATUS.CLOSING.CLOSED;
  });
}

/** วันที่ที่ปิดยอดแล้วทั้งหมด (ใช้ตรวจหลายวันในครั้งเดียว) */
function closedDateSet_() {
  const out = Object.create(null);
  dbAll_(SHEETS.DAILY_CLOSINGS).forEach(function (c) {
    if (c.Status === STATUS.CLOSING.CLOSED) out[c.ClosingDate] = c;
  });
  return out;
}

/** ห้ามเปลี่ยนรายการรับเงินของวันที่ปิดยอดแล้ว */
function assertDayOpen_(date, what) {
  if (!date || !closingOf_(date)) return;
  throw appError_(ERROR_CODES.CONFLICT,
    'วันที่ ' + formatThaiDate_(date) + ' ปิดยอดแล้ว จึง' + what + 'ไม่ได้ ' +
    'ถ้าจำเป็นต้องแก้ไข ให้ผู้อำนวยการเปิดยอดของวันนั้นใหม่ (หน้า "รายงานและปิดยอด")', { reason: 'DAY_CLOSED' });
}

/** การรับเงินของวันที่ (รายการที่ถูกแก้ไขแทนแล้วไม่นับ เพราะรายการใหม่แสดงแทน) เรียงตามเล่มและเลขที่ */
function paymentsOfDay_(date) {
  return dbFind_(SHEETS.PAYMENTS, function (p) {
    return p.PaymentDate === date && p.Status !== STATUS.PAYMENT.REPLACED;
  }).sort(compareByReceipt_);
}

function compareByReceipt_(a, b) {
  if (a.ReceiptBookNo !== b.ReceiptBookNo) return compareText_(a.ReceiptBookNo, b.ReceiptBookNo);
  if (a.ReceiptNo !== b.ReceiptNo) return a.ReceiptNo - b.ReceiptNo;
  return a.CreatedAt < b.CreatedAt ? -1 : (a.CreatedAt > b.CreatedAt ? 1 : 0);
}

/**
 * ยอดของวัน: จำนวนใบเสร็จ ยอดรวม แยกช่องทาง ช่วงเลขที่ และรหัสตรวจสอบ
 * รหัสตรวจสอบคิดจากรายการที่มีผลเท่านั้น (รหัส เล่ม เลขที่ นักเรียน จำนวนเงิน ช่องทาง เลขอ้างอิง)
 */
function dayFigures_(date, payments) {
  const list = payments || paymentsOfDay_(date);
  const active = list.filter(function (p) { return p.Status === STATUS.PAYMENT.ACTIVE; });
  const byChannel = Object.create(null);
  const books = Object.create(null);
  let total = 0;
  active.forEach(function (p) {
    const satang = satangOf_(p.Amount);
    total += satang;
    const ch = byChannel[p.Channel] || (byChannel[p.Channel] = { channel: p.Channel, count: 0, satang: 0 });
    ch.count += 1;
    ch.satang += satang;
    const b = books[p.ReceiptBookNo] || (books[p.ReceiptBookNo] = { bookNo: p.ReceiptBookNo, from: p.ReceiptNo, to: p.ReceiptNo });
    b.from = Math.min(b.from, p.ReceiptNo);
    b.to = Math.max(b.to, p.ReceiptNo);
  });
  const canonical = active.map(function (p) {
    return [p.PaymentId, p.ReceiptBookNo, p.ReceiptNo, p.StudentId, satangOf_(p.Amount), p.Channel, p.ChannelRef];
  });
  const range = Object.keys(books).sort(compareText_).map(function (k) {
    const b = books[k];
    return 'เล่มที่ ' + b.bookNo + ' เลขที่ ' + (b.from === b.to ? b.from : b.from + '–' + b.to);
  }).join(', ');
  return {
    date: date,
    receiptCount: active.length,
    voidedCount: list.length - active.length,
    totalSatang: total,
    byChannel: Object.keys(byChannel).sort(compareText_).map(function (k) { return byChannel[k]; }),
    receiptRange: range,
    digest: sha256Hex_(JSON.stringify([date, canonical])),
  };
}

/** รหัสตรวจสอบสำหรับพิมพ์ (16 ตัวแรกของ SHA-256 แบ่งเป็นกลุ่มละ 4 ตัว) */
function verifyCodeOf_(digest) {
  if (!digest) return '';
  return String(digest).slice(0, 16).toUpperCase().match(/.{4}/g).join('-');
}

/** คำขอที่รอพิจารณาและกระทบรายการรับเงินของวันที่ (ยกเลิกใบเสร็จ / แก้ไขรายการ ทั้งวันเดิมและวันใหม่) */
function pendingRequestsOfDay_(date) {
  const payments = Object.create(null);
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) { payments[p.PaymentId] = p; });
  return dbFind_(SHEETS.APPROVAL_REQUESTS, function (r) {
    if (r.Status !== STATUS.DECISION.PENDING) return false;
    if (r.RequestType !== STATUS.REQUEST_TYPE.RECEIPT_CANCEL && r.RequestType !== STATUS.REQUEST_TYPE.PAYMENT_CORRECTION) return false;
    const data = parseRequestData_(r);
    const p = payments[data.paymentId || r.RefId];
    if (p && p.PaymentDate === date) return true;
    return r.RequestType === STATUS.REQUEST_TYPE.PAYMENT_CORRECTION && data.paymentDate === date;
  });
}

function closingDto_(c, names) {
  if (!c) return null;
  let byChannel = [];
  try { byChannel = c.ByChannelJson ? JSON.parse(c.ByChannelJson) : []; } catch (e) { byChannel = []; }
  return {
    closingId: c.ClosingId,
    date: c.ClosingDate,
    status: c.Status,
    statusLabel: STATUS_LABELS.CLOSING[c.Status] || c.Status,
    receiptCount: c.ReceiptCount,
    totalSatang: satangOf_(c.TotalAmount),
    byChannel: byChannel,
    receiptRange: c.ReceiptRange,
    digest: c.Digest,
    verifyCode: verifyCodeOf_(c.Digest),
    auditAnchor: c.AuditHash ? String(c.AuditHash).slice(0, 12).toUpperCase() : '',
    closedBy: displayNameOf_(c.CreatedBy, names),
    closedAt: c.CreatedAt,
    reopenedBy: displayNameOf_(c.ReopenedBy, names),
    reopenedAt: c.ReopenedAt,
    reopenReason: c.ReopenReason,
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * closings.close — ปิดยอดประจำวัน (เจ้าหน้าที่การเงิน)
 * payload: { date, expectedDigest, confirmChecked: true }
 * expectedDigest = รหัสตรวจสอบของรายงานที่เจ้าหน้าที่เปิดดูอยู่ ถ้าข้อมูลเปลี่ยนไประหว่างนั้นจะปิดยอดไม่ได้
 */
function closingsClose_(ctx, payload) {
  const date = requireIsoDate_(payload.date, 'วันที่ปิดยอด');
  if (date > todayIso_()) throw validationError_('ปิดยอดล่วงหน้าไม่ได้');
  if (payload.confirmChecked !== true) throw validationError_('กรุณาติ๊กยืนยันว่า' + CLOSING_CONFIRM_TEXT);
  if (closingOf_(date)) {
    throw appError_(ERROR_CODES.CONFLICT, 'วันที่ ' + formatThaiDate_(date) + ' ปิดยอดแล้ว', { reason: 'DAY_CLOSED' });
  }
  const payments = paymentsOfDay_(date);
  const fig = dayFigures_(date, payments);
  if (!payments.length) throw validationError_('ไม่มีรายการรับเงินในวันที่ ' + formatThaiDate_(date) + ' จึงไม่ต้องปิดยอด');
  const pending = pendingRequestsOfDay_(date);
  if (pending.length) {
    throw appError_(ERROR_CODES.CONFLICT, 'ยังมีคำขอยกเลิกหรือแก้ไขใบเสร็จของวันนี้ที่รอผู้อำนวยการพิจารณา ' + pending.length +
      ' รายการ กรุณารอผลการพิจารณาก่อนปิดยอด', { reason: 'PENDING_REQUEST' });
  }
  if (typeof payload.expectedDigest !== 'string' || payload.expectedDigest !== fig.digest) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการรับเงินของวันนี้เปลี่ยนไปหลังจากเปิดรายงาน กรุณาโหลดรายงานใหม่และตรวจอีกครั้งก่อนปิดยอด',
      { reason: 'DAY_CHANGED' });
  }
  const actor = actorFromCtx_(ctx);
  const closing = dbInsert_(SHEETS.DAILY_CLOSINGS, {
    ClosingDate: date,
    Status: STATUS.CLOSING.CLOSED,
    ReceiptCount: fig.receiptCount,
    TotalAmount: satangToBaht_(fig.totalSatang),
    ByChannelJson: JSON.stringify(fig.byChannel),
    ReceiptRange: fig.receiptRange,
    Digest: fig.digest,
    AuditHash: auditState_().lastHash,
  }, actor, {
    action: AUDIT_ACTIONS.DAY_CLOSE,
    note: 'ปิดยอดวันที่ ' + formatThaiDate_(date) + ' ใบเสร็จ ' + fig.receiptCount + ' ฉบับ รวม ' + formatSatang_(fig.totalSatang, true),
  });
  return {
    closing: closingDto_(closing, userDisplayNames_()),
    message: 'ปิดยอดวันที่ ' + formatThaiDate_(date) + ' เรียบร้อยแล้ว รหัสตรวจสอบ ' + verifyCodeOf_(fig.digest),
  };
}

/** closings.reopen — เปิดยอดของวันที่ปิดแล้วใหม่ (ผู้อำนวยการ ต้องมีเหตุผล) payload: { date, reason } */
function closingsReopen_(ctx, payload) {
  const date = requireIsoDate_(payload.date, 'วันที่');
  const reason = requireText_(payload.reason, 'เหตุผลการเปิดยอดใหม่', { max: 500, multiline: true });
  const c = closingOf_(date);
  if (!c) throw appError_(ERROR_CODES.CONFLICT, 'วันที่ ' + formatThaiDate_(date) + ' ยังไม่ได้ปิดยอด');
  const actor = actorFromCtx_(ctx);
  dbUpdate_(SHEETS.DAILY_CLOSINGS, c.ClosingId, {
    Status: STATUS.CLOSING.REOPENED,
    ReopenedAt: nowIso_(),
    ReopenedBy: actor.username,
    ReopenReason: reason,
  }, actor, { action: AUDIT_ACTIONS.DAY_REOPEN, note: 'เปิดยอดวันที่ ' + formatThaiDate_(date) + ' ใหม่: ' + reason });
  return { message: 'เปิดยอดวันที่ ' + formatThaiDate_(date) + ' ใหม่แล้ว เจ้าหน้าที่การเงินแก้ไขรายการแล้วต้องปิดยอดอีกครั้ง' };
}

/**
 * closings.list — สถานะการปิดยอดรายวันในช่วงวันที่ (ไม่เกิน 92 วัน ค่าเริ่มต้น 30 วันล่าสุด)
 * แสดงเฉพาะวันที่มีการรับเงินหรือเคยปิดยอด
 */
function closingsList_(ctx, payload) {
  const today = todayIso_();
  const toDate = requireIsoDate_(isBlankInput_(payload.toDate) ? today : payload.toDate, 'วันที่สิ้นสุด');
  const fromDate = requireIsoDate_(isBlankInput_(payload.fromDate) ? addDaysIso_(toDate, -(CLOSING_LOOKBACK_DAYS - 1)) : payload.fromDate, 'วันที่เริ่มต้น');
  if (toDate < fromDate) throw validationError_('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น');
  if (daysBetween_(fromDate, toDate) >= PAYMENT_LIST_MAX_DAYS) throw validationError_('ดูได้ครั้งละไม่เกิน ' + PAYMENT_LIST_MAX_DAYS + ' วัน');
  const names = userDisplayNames_();
  const days = Object.create(null);
  const dayOf = function (d) {
    return days[d] || (days[d] = { date: d, payments: [], closing: null, history: [] });
  };
  dbFind_(SHEETS.PAYMENTS, function (p) {
    return p.PaymentDate >= fromDate && p.PaymentDate <= toDate && p.Status !== STATUS.PAYMENT.REPLACED;
  }).forEach(function (p) { dayOf(p.PaymentDate).payments.push(p); });
  dbFind_(SHEETS.DAILY_CLOSINGS, function (c) { return c.ClosingDate >= fromDate && c.ClosingDate <= toDate; })
    .sort(function (a, b) { return a.CreatedAt < b.CreatedAt ? 1 : -1; })
    .forEach(function (c) {
      const d = dayOf(c.ClosingDate);
      if (c.Status === STATUS.CLOSING.CLOSED) d.closing = closingDto_(c, names);
      else d.history.push(closingDto_(c, names));
    });
  const rows = Object.keys(days).sort().reverse().map(function (k) {
    const d = days[k];
    const fig = dayFigures_(k, d.payments.sort(compareByReceipt_));
    return {
      date: k,
      receiptCount: fig.receiptCount,
      voidedCount: fig.voidedCount,
      totalSatang: fig.totalSatang,
      receiptRange: fig.receiptRange,
      closed: !!d.closing,
      closing: d.closing,
      changedAfterClose: !!d.closing && d.closing.digest !== fig.digest,
      reopenCount: d.history.length,
      history: d.history,
    };
  });
  return {
    fromDate: fromDate,
    toDate: toDate,
    today: today,
    rows: rows,
    unclosedCount: rows.filter(function (r) { return !r.closed && r.date < today && r.receiptCount + r.voidedCount > 0; }).length,
    canClose: ctx.role === ROLES.FINANCE,
    canReopen: ctx.role === ROLES.DIRECTOR,
  };
}

/** จำนวนวันที่รับเงินแล้วแต่ยังไม่ปิดยอด ใน 30 วันล่าสุด (ไม่นับวันนี้) — ใช้แสดงเตือนในหน้าแรก */
function unclosedDaysCount_() {
  const today = todayIso_();
  const from = addDaysIso_(today, -CLOSING_LOOKBACK_DAYS);
  const closed = closedDateSet_();
  const seen = Object.create(null);
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) {
    if (p.PaymentDate >= from && p.PaymentDate < today && p.Status !== STATUS.PAYMENT.REPLACED && !closed[p.PaymentDate]) seen[p.PaymentDate] = true;
  });
  return Object.keys(seen).length;
}

/** บวกหรือลบจำนวนวันจากวันที่ ISO */
function addDaysIso_(iso, days) {
  const p = String(iso).split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Reports.js
// ============================================================================

/**
 * ============================================================================
 *  Reports.gs — ข้อมูลของรายงานแบบทางการ (หน้าเว็บจัดรูปแบบสำหรับพิมพ์หรือบันทึกเป็น PDF)
 * ----------------------------------------------------------------------------
 *  ทุกรายงานคำนวณจากข้อมูลในชีตทุกครั้ง ไม่มีตารางสรุปที่เก็บแยกไว้ และพิมพ์วันเวลาที่ออกรายงานเสมอ
 *   1. เอกสารแจ้งยอดเรียกเก็บเงิน ............ reports.notices
 *   2. รายงานการรับเงินประจำวัน (และปิดยอด) ... reports.daily + closings.*
 *   3. รายงานการรับเงินแยกตามห้อง ............ reports.collections
 *   4. รายงานการรับเงินแยกตามระดับชั้น ........ reports.collections
 *   5. รายงานยอดค้างชำระ .................... arrears.summary (Arrears.gs)
 *   6. รายงานทะเบียนคุมใบเสร็จ ............... receipts.book (Receipts.gs)
 *   7. รายงานใบเสร็จยกเลิก ................... reports.cancelled
 *   8. รายงานสรุปประจำปีการศึกษา ............. reports.annual
 *   9. รายงานการใช้ใบเสร็จประจำปีงบประมาณ ...... reports.receiptUsage (D-15)
 *  ช่วงเวลาเลือกได้ทั้งปีการศึกษา ปีงบประมาณ เดือน หรือกำหนดเอง (D-18)
 *  ช่วงของปีการศึกษาในรายงานคือ 1 พ.ค.–30 เม.ย. ต่อเนื่องกันทุกปี เพื่อไม่ให้มีวันที่หล่นหาย (D-39)
 * ============================================================================
 */

const REPORT_MAX_DAYS = 400;
const REPORT_PERIOD_TYPES = Object.freeze(['academic', 'fiscal', 'month', 'range']);
const NOTICE_MAX_STUDENTS = 600;

function reportSigners_() {
  return {
    financeName: getSetting_('FINANCE_OFFICER_NAME'),
    financePosition: getSetting_('FINANCE_OFFICER_POSITION'),
    directorName: getSetting_('DIRECTOR_NAME'),
    directorPosition: getSetting_('DIRECTOR_POSITION'),
  };
}

/** หัวรายงาน: ข้อมูลโรงเรียน ผู้ลงนาม และผู้ออกรายงาน */
function reportMeta_(ctx) {
  const school = schoolInfo_();
  school.phone = getSetting_('SCHOOL_PHONE');
  return {
    school: school,
    signers: reportSigners_(),
    generatedAt: nowIso_(),
    generatedBy: ctx.displayName || ctx.username,
  };
}

/** ช่วงวันที่ของรายงาน payload: { periodType, year, fiscalYear, month: 'YYYY-MM', fromDate, toDate } */
function reportPeriod_(payload) {
  const type = isBlankInput_(payload.periodType) ? 'academic' : requireEnum_(payload.periodType, REPORT_PERIOD_TYPES, 'ช่วงเวลาของรายงาน');
  let from;
  let to;
  let label;
  if (type === 'academic') {
    const year = isBlankInput_(payload.year) ? currentAcademicYear_() : requireInt_(payload.year, 'ปีการศึกษา', { min: 2500, max: 2700 });
    const r = academicYearRange_(year);
    from = r.from;
    to = r.to;
    label = 'ปีการศึกษา ' + year;
  } else if (type === 'fiscal') {
    const fy = isBlankInput_(payload.fiscalYear) ? fiscalYearOfDate_(todayIso_()) : requireInt_(payload.fiscalYear, 'ปีงบประมาณ', { min: 2500, max: 2700 });
    const r = fiscalYearRange_(fy);
    from = r.from;
    to = r.to;
    label = 'ปีงบประมาณ ' + fy;
  } else if (type === 'month') {
    const m = requireText_(payload.month, 'เดือน', { max: 7, pattern: /^\d{4}-(0[1-9]|1[0-2])$/, patternMessage: 'เดือนไม่ถูกต้อง' });
    from = m + '-01';
    const p = m.split('-').map(Number);
    to = addDaysIso_(p[1] === 12 ? (p[0] + 1) + '-01-01' : p[0] + '-' + ('0' + (p[1] + 1)).slice(-2) + '-01', -1);
    label = 'เดือน' + formatThaiMonth_(m);
  } else {
    from = requireIsoDate_(payload.fromDate, 'วันที่เริ่มต้น');
    to = requireIsoDate_(isBlankInput_(payload.toDate) ? from : payload.toDate, 'วันที่สิ้นสุด');
    if (to < from) throw validationError_('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น');
    if (daysBetween_(from, to) >= REPORT_MAX_DAYS) throw validationError_('เลือกช่วงวันที่ได้ไม่เกิน ' + REPORT_MAX_DAYS + ' วัน');
    label = from === to ? 'วันที่ ' + formatThaiDate_(from) : 'ระหว่างวันที่ ' + formatThaiDate_(from) + ' ถึง ' + formatThaiDate_(to);
  }
  return { type: type, from: from, to: to, label: label, rangeLabel: formatThaiDate_(from) + ' – ' + formatThaiDate_(to) };
}

function studentsById_() {
  const out = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { out[s.StudentId] = s; });
  return out;
}

function studentNameOf_(s) {
  return s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) : '';
}

function gradeOrder_(levels) {
  return function (a, b) {
    const ga = levels.indexOf(a);
    const gb = levels.indexOf(b);
    return (ga === -1 ? 999 : ga) - (gb === -1 ? 999 : gb) || compareText_(a, b);
  };
}

// ---------------------------------------------------------------------------
// 2. รายงานการรับเงินประจำวัน
// ---------------------------------------------------------------------------

/** reports.daily — รายการรับเงินของวัน เรียงตามเล่มและเลขที่ใบเสร็จ พร้อมสถานะการปิดยอด payload: { date } */
function reportsDaily_(ctx, payload) {
  const date = requireIsoDate_(isBlankInput_(payload.date) ? todayIso_() : payload.date, 'วันที่');
  const payments = paymentsOfDay_(date);
  const fig = dayFigures_(date, payments);
  const lc = ledgerContext_();
  const labels = allocationLabels_(lc);
  const names = userDisplayNames_();
  const students = studentsById_();
  const enroll = latestEnrollments_();
  const rows = payments.map(function (p) {
    const s = students[p.StudentId];
    const e = enroll[p.StudentId];
    const dto = paymentDto_(p, lc, labels, names);
    return {
      paymentId: p.PaymentId,
      bookNo: p.ReceiptBookNo,
      receiptNo: p.ReceiptNo,
      studentNo: s ? s.StudentNo : '',
      studentName: studentNameOf_(s),
      classLabel: e ? classLabel_(e.GradeLevel, e.Room) : '',
      items: dto.allocations.map(function (al) { return al.label; }),
      channel: p.Channel,
      channelRef: p.ChannelRef,
      amountSatang: satangOf_(p.Amount),
      status: p.Status,
      statusLabel: STATUS_LABELS.PAYMENT[p.Status] || p.Status,
      voidReason: p.VoidReason,
      corrected: !!p.ReplacesPaymentId,
      receivedByName: p.ReceivedByName,
      createdBy: dto.createdBy,
    };
  });
  const spoiled = dbFind_(SHEETS.RECEIPT_CANCELLATIONS, function (c) {
    return c.CancelType === STATUS.CANCEL_TYPE.SPOILED && String(c.CreatedAt).slice(0, 10) === date;
  }).sort(function (a, b) { return compareText_(a.BookNo, b.BookNo) || a.ReceiptNo - b.ReceiptNo; })
    .map(function (c) {
      return { bookNo: c.BookNo, receiptNo: c.ReceiptNo, reason: c.Reason, status: c.Status, statusLabel: STATUS_LABELS.DECISION[c.Status] || c.Status };
    });
  const closingRec = closingOf_(date);
  const history = dbFind_(SHEETS.DAILY_CLOSINGS, function (c) {
    return c.ClosingDate === date && c.Status === STATUS.CLOSING.REOPENED;
  }).sort(function (a, b) { return a.CreatedAt < b.CreatedAt ? -1 : 1; }).map(function (c) { return closingDto_(c, names); });
  const pendingCount = pendingRequestsOfDay_(date).length;
  const closing = closingDto_(closingRec, names);
  return {
    date: date,
    today: todayIso_(),
    rows: rows,
    spoiled: spoiled,
    figures: {
      receiptCount: fig.receiptCount,
      voidedCount: fig.voidedCount,
      totalSatang: fig.totalSatang,
      totalText: bahtText_(fig.totalSatang),
      byChannel: fig.byChannel,
      receiptRange: fig.receiptRange,
      digest: fig.digest,
      verifyCode: verifyCodeOf_(fig.digest),
    },
    closing: closing,
    matches: closing ? closing.digest === fig.digest : null,
    history: history,
    pendingCount: pendingCount,
    canClose: ctx.role === ROLES.FINANCE && !closing && payments.length > 0 && pendingCount === 0 && date <= todayIso_(),
    canReopen: ctx.role === ROLES.DIRECTOR && !!closing,
    confirmText: CLOSING_CONFIRM_TEXT,
    meta: reportMeta_(ctx),
  };
}

// ---------------------------------------------------------------------------
// 3–4. รายงานการรับเงินแยกตามห้องและระดับชั้น
// ---------------------------------------------------------------------------

function newCollectionGroup_(base) {
  return Object.assign(base, { studentSet: Object.create(null), paymentSet: Object.create(null), satang: 0 });
}

function addCollection_(g, al, satang) {
  g.studentSet[al.StudentId] = true;
  g.paymentSet[al.PaymentId] = true;
  g.satang += satang;
}

function finishCollection_(g) {
  g.students = Object.keys(g.studentSet).length;
  g.receipts = Object.keys(g.paymentSet).length;
  delete g.studentSet;
  delete g.paymentSet;
  return g;
}

/**
 * reports.collections — เงินที่รับในช่วงเวลา แยกตามชั้นและห้องของรายการเรียกเก็บ (ชั้น/ห้อง ณ วันที่เรียกเก็บ)
 * ยอดค้างจากปีก่อนที่รับในช่วงนี้แสดงเป็นกลุ่มของปีการศึกษานั้นแยกต่างหาก ยอดรวมทุกกลุ่มเท่ากับเงินที่รับจริง
 */
function reportsCollections_(ctx, payload) {
  const period = reportPeriod_(payload);
  const levels = gradeLevels_();
  const pay = Object.create(null);
  const byChannel = Object.create(null);
  let totalSatang = 0;
  let receiptCount = 0;
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) {
    if (p.Status !== STATUS.PAYMENT.ACTIVE || p.PaymentDate < period.from || p.PaymentDate > period.to) return;
    const satang = satangOf_(p.Amount);
    pay[p.PaymentId] = p;
    totalSatang += satang;
    receiptCount += 1;
    const ch = byChannel[p.Channel] || (byChannel[p.Channel] = { channel: p.Channel, count: 0, satang: 0 });
    ch.count += 1;
    ch.satang += satang;
  });
  const asms = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) { asms[a.AssessmentId] = a; });
  const grades = Object.create(null);
  const allStudents = Object.create(null);
  let allocated = 0;
  dbAll_(SHEETS.PAYMENT_ALLOCATIONS).forEach(function (al) {
    if (al.Status !== STATUS.ALLOCATION.ACTIVE || !pay[al.PaymentId]) return;
    const asm = asms[al.AssessmentId];
    const year = asm ? asm.AcademicYear : al.AcademicYear;
    const grade = asm ? asm.GradeLevel : '';
    const room = asm ? asm.Room : '';
    const satang = satangOf_(al.Amount);
    allocated += satang;
    allStudents[al.StudentId] = true;
    const gk = year + '|' + grade;
    const g = grades[gk] || (grades[gk] = newCollectionGroup_({ year: year, gradeLevel: grade, label: grade || 'ไม่ระบุชั้น', rooms: Object.create(null) }));
    addCollection_(g, al, satang);
    const r = g.rooms[room] || (g.rooms[room] = newCollectionGroup_({ year: year, gradeLevel: grade, room: room, label: classLabel_(grade, room) || 'ไม่ระบุห้อง' }));
    addCollection_(r, al, satang);
  });
  const byGrade = gradeOrder_(levels);
  const gradeList = Object.keys(grades).map(function (k) { return grades[k]; })
    .sort(function (a, b) { return b.year - a.year || byGrade(a.gradeLevel, b.gradeLevel); })
    .map(function (g) {
      g.rooms = Object.keys(g.rooms).sort(compareRoom_).map(function (k) { return finishCollection_(g.rooms[k]); });
      return finishCollection_(g);
    });
  return {
    period: period,
    grades: gradeList,
    years: gradeList.map(function (g) { return g.year; }).filter(function (y, i, a) { return a.indexOf(y) === i; }),
    total: { students: Object.keys(allStudents).length, receipts: receiptCount, satang: totalSatang, text: bahtText_(totalSatang) },
    byChannel: Object.keys(byChannel).sort(compareText_).map(function (k) { return byChannel[k]; }),
    unallocatedSatang: totalSatang - allocated,
    meta: reportMeta_(ctx),
  };
}

// ---------------------------------------------------------------------------
// 7. รายงานใบเสร็จยกเลิก
// ---------------------------------------------------------------------------

/** reports.cancelled — คำขอยกเลิกเลขที่/ใบเสร็จที่ยื่นในช่วงเวลา (ทุกผลการพิจารณา) เรียงตามเล่มและเลขที่ */
function reportsCancelled_(ctx, payload) {
  const period = reportPeriod_(payload);
  const names = userDisplayNames_();
  const students = studentsById_();
  const payments = Object.create(null);
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) { payments[p.PaymentId] = p; });
  const entries = Object.create(null);
  dbAll_(SHEETS.RECEIPT_ENTRIES).forEach(function (e) { entries[e.EntryId] = e; });
  const totals = { voidCount: 0, voidSatang: 0, spoiledCount: 0, pendingCount: 0, notApprovedCount: 0 };
  const rows = dbFind_(SHEETS.RECEIPT_CANCELLATIONS, function (c) {
    const d = String(c.CreatedAt).slice(0, 10);
    return d >= period.from && d <= period.to;
  }).map(function (c) {
    const p = c.PaymentId ? payments[c.PaymentId] : null;
    const e = entries[c.EntryId];
    const s = students[p ? p.StudentId : (e ? e.StudentId : '')];
    const amount = c.Amount === null || c.Amount === '' ? null : satangOf_(c.Amount);
    if (c.Status === STATUS.DECISION.APPROVED) {
      if (c.CancelType === STATUS.CANCEL_TYPE.VOID_PAYMENT) {
        totals.voidCount += 1;
        totals.voidSatang += amount || 0;
      } else {
        totals.spoiledCount += 1;
      }
    } else if (c.Status === STATUS.DECISION.PENDING) {
      totals.pendingCount += 1;
    } else {
      totals.notApprovedCount += 1;
    }
    return {
      cancellationId: c.CancellationId,
      requestedAt: c.CreatedAt,
      bookNo: c.BookNo,
      receiptNo: c.ReceiptNo,
      cancelType: c.CancelType,
      cancelTypeLabel: STATUS_LABELS.CANCEL_TYPE[c.CancelType] || c.CancelType,
      receiptDate: p ? p.PaymentDate : (e ? e.ReceiptDate : ''),
      studentNo: s ? s.StudentNo : '',
      studentName: studentNameOf_(s),
      amountSatang: amount,
      reason: c.Reason,
      requestedBy: displayNameOf_(c.CreatedBy, names),
      status: c.Status,
      statusLabel: STATUS_LABELS.DECISION[c.Status] || c.Status,
      decidedBy: displayNameOf_(c.DecidedBy, names),
      decidedAt: c.DecidedAt,
      decisionNote: c.DecisionNote,
    };
  }).sort(function (a, b) {
    return compareText_(a.bookNo, b.bookNo) || a.receiptNo - b.receiptNo || (a.requestedAt < b.requestedAt ? -1 : 1);
  });
  return { period: period, rows: rows, totals: totals, meta: reportMeta_(ctx) };
}

// ---------------------------------------------------------------------------
// 8. รายงานสรุปประจำปีการศึกษา
// ---------------------------------------------------------------------------

function emptyBilling_(base) {
  return Object.assign(base || {}, {
    count: 0, studentSet: Object.create(null),
    grossSatang: 0, adjustSatang: 0, netSatang: 0, paidSatang: 0, outstandingSatang: 0, overdueSatang: 0,
  });
}

function addBilling_(t, asm, f, today) {
  t.count += 1;
  t.studentSet[asm.StudentId] = true;
  t.grossSatang += f.grossSatang;
  t.adjustSatang += f.adjustSatang;
  t.netSatang += f.netSatang;
  t.paidSatang += f.paidSatang;
  t.outstandingSatang += f.outstandingSatang;
  if (f.outstandingSatang > 0 && asm.DueDate && asm.DueDate < today) t.overdueSatang += f.outstandingSatang;
}

function finishBilling_(t) {
  t.students = Object.keys(t.studentSet).length;
  delete t.studentSet;
  return t;
}

/** reports.annual — สรุปการเรียกเก็บ การลดหย่อน การรับเงิน ยอดค้าง และการใช้ใบเสร็จของปีการศึกษา payload: { year } */
function reportsAnnual_(ctx, payload) {
  const year = isBlankInput_(payload.year) ? currentAcademicYear_() : requireAcademicYear_(payload.year);
  const range = academicYearRange_(year);
  const lc = ledgerContext_();
  const levels = gradeLevels_();
  const asmById = Object.create(null);
  const overall = emptyBilling_();
  const cancelled = { count: 0, grossSatang: 0 };
  const grades = Object.create(null);
  const items = Object.create(null);
  let priorOutstanding = 0;
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) {
    asmById[a.AssessmentId] = a;
    if (a.AcademicYear !== year) {
      if (a.AcademicYear < year && a.Status === STATUS.ASSESSMENT.ACTIVE) priorOutstanding += assessmentFigures_(a, lc).outstandingSatang;
      return;
    }
    if (a.Status !== STATUS.ASSESSMENT.ACTIVE) {
      cancelled.count += 1;
      cancelled.grossSatang += satangOf_(a.GrossAmount);
      return;
    }
    const f = assessmentFigures_(a, lc);
    addBilling_(overall, a, f, lc.today);
    const g = grades[a.GradeLevel] || (grades[a.GradeLevel] = emptyBilling_({ gradeLevel: a.GradeLevel }));
    addBilling_(g, a, f, lc.today);
    const fee = lc.fees[a.FeeSettingId];
    const desc = (fee && fee.Description) || FEE_DEFAULT_DESCRIPTION;
    const ik = desc + '|' + a.Term;
    const it = items[ik] || (items[ik] = emptyBilling_({ description: desc, term: a.Term, label: desc + ' ' + termLabel_(a.Term, year) }));
    addBilling_(it, a, f, lc.today);
  });
  const adjustments = { DISCOUNT: { count: 0, satang: 0 }, EXEMPTION: { count: 0, satang: 0 } };
  lc.adjustments.forEach(function (ad) {
    const a = asmById[ad.AssessmentId];
    if (ad.Status !== STATUS.ADJUSTMENT.ACTIVE || !a || a.AcademicYear !== year || a.Status !== STATUS.ASSESSMENT.ACTIVE) return;
    const t = adjustments[ad.Type];
    if (!t) return;
    t.count += 1;
    t.satang += satangOf_(ad.Amount);
  });

  // เงินที่รับในช่วงปีการศึกษา (ตามวันที่รับเงิน) แยกเดือน และแยกว่าเป็นเงินของปีใด
  const months = [];
  for (let d = range.from; d <= range.to; d = addDaysIso_(d.slice(0, 7) + '-28', 7).slice(0, 7) + '-01') {
    months.push({ month: d.slice(0, 7), label: formatThaiMonth_(d.slice(0, 7)), count: 0, satang: 0 });
  }
  const monthIdx = Object.create(null);
  months.forEach(function (m, i) { monthIdx[m.month] = i; });
  const payIds = Object.create(null);
  const books = Object.create(null);
  const cash = { count: 0, satang: 0, thisYearSatang: 0, priorSatang: 0, laterSatang: 0, voidedCount: 0 };
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) {
    if (p.PaymentDate < range.from || p.PaymentDate > range.to) return;
    if (p.Status === STATUS.PAYMENT.VOIDED) { cash.voidedCount += 1; return; }
    if (p.Status !== STATUS.PAYMENT.ACTIVE) return;
    const satang = satangOf_(p.Amount);
    payIds[p.PaymentId] = true;
    books[p.ReceiptBookNo] = true;
    cash.count += 1;
    cash.satang += satang;
    const m = months[monthIdx[p.PaymentDate.slice(0, 7)]];
    if (m) { m.count += 1; m.satang += satang; }
  });
  lc.allocations.forEach(function (al) {
    if (al.Status !== STATUS.ALLOCATION.ACTIVE || !payIds[al.PaymentId]) return;
    const a = asmById[al.AssessmentId];
    const y = a ? a.AcademicYear : al.AcademicYear;
    const satang = satangOf_(al.Amount);
    if (y === year) cash.thisYearSatang += satang;
    else if (y < year) cash.priorSatang += satang;
    else cash.laterSatang += satang;
  });
  const spoiled = dbFind_(SHEETS.RECEIPT_CANCELLATIONS, function (c) {
    const d = String(c.CreatedAt).slice(0, 10);
    return c.CancelType === STATUS.CANCEL_TYPE.SPOILED && c.Status === STATUS.DECISION.APPROVED && d >= range.from && d <= range.to;
  }).length;
  const byGrade = gradeOrder_(levels);
  return {
    year: year,
    period: { from: range.from, to: range.to, label: 'ปีการศึกษา ' + year, rangeLabel: formatThaiDate_(range.from) + ' – ' + formatThaiDate_(range.to) },
    today: lc.today,
    overall: finishBilling_(overall),
    cancelled: cancelled,
    adjustments: adjustments,
    grades: Object.keys(grades).sort(byGrade).map(function (k) { return finishBilling_(grades[k]); }),
    items: Object.keys(items).map(function (k) { return finishBilling_(items[k]); })
      .sort(function (a, b) { return (TERM_ORDER_[a.term] || 0) - (TERM_ORDER_[b.term] || 0) || compareText_(a.description, b.description); }),
    months: months,
    cash: cash,
    receipts: { used: cash.count, voided: cash.voidedCount, spoiled: spoiled, books: Object.keys(books).sort(compareText_) },
    priorOutstandingSatang: priorOutstanding,
    meta: reportMeta_(ctx),
  };
}

// ---------------------------------------------------------------------------
// 9. รายงานการใช้ใบเสร็จประจำปีงบประมาณ (D-15)
// ---------------------------------------------------------------------------

/**
 * reports.receiptUsage — ต่อเล่ม: ยกมา รับเข้า ใช้ ยกเลิก รออนุมัติ ปิดเล่มโดยไม่ใช้ และคงเหลือ ณ สิ้นปีงบประมาณ
 * วันที่ของเลขที่แต่ละใบใช้วันที่ในใบเสร็จ (เลขที่ยกเลิกก่อนบันทึกรับเงินใช้วันที่ยื่นคำขอ)
 */
function reportsReceiptUsage_(ctx, payload) {
  const fy = isBlankInput_(payload.fiscalYear) ? fiscalYearOfDate_(todayIso_()) : requireInt_(payload.fiscalYear, 'ปีงบประมาณ', { min: 2500, max: 2700 });
  const range = fiscalYearRange_(fy);
  const byBook = receiptEntriesByBook_();
  const rows = [];
  const total = { broughtForward: 0, received: 0, used: 0, cancelled: 0, pending: 0, closedUnused: 0, remaining: 0 };
  dbAll_(SHEETS.RECEIPT_BOOKS).forEach(function (b) {
    const received = b.ReceivedDate || String(b.CreatedAt).slice(0, 10);
    if (received > range.to) return;
    const entries = (byBook[b.BookId] || []).filter(function (e) { return e.Status !== STATUS.RECEIPT_ENTRY.RELEASED; });
    const usage = bookUsage_(b, entries);
    const dateOf = function (e) { return e.ReceiptDate || String(e.CreatedAt).slice(0, 10); };
    const before = entries.filter(function (e) { return dateOf(e) < range.from; }).length;
    const inFy = entries.filter(function (e) { const d = dateOf(e); return d >= range.from && d <= range.to; });
    const closed = b.Status === STATUS.BOOK.CLOSED && b.ClosedDate;
    const closedBefore = closed && b.ClosedDate < range.from ? usage.closedUnused : 0;
    const closedInFy = closed && b.ClosedDate >= range.from && b.ClosedDate <= range.to ? usage.closedUnused : 0;
    const row = {
      bookId: b.BookId,
      bookNo: b.BookNo,
      startNo: b.StartNo,
      endNo: b.EndNo,
      receivedDate: received,
      status: b.Status,
      statusLabel: STATUS_LABELS.BOOK[b.Status] || b.Status,
      broughtForward: received < range.from ? usage.total - before - closedBefore : 0,
      received: received >= range.from ? usage.total : 0,
      used: inFy.filter(function (e) { return e.Status === STATUS.RECEIPT_ENTRY.USED; }).length,
      cancelled: inFy.filter(function (e) { return e.Status === STATUS.RECEIPT_ENTRY.CANCELLED; }).length,
      pending: inFy.filter(function (e) { return e.Status === STATUS.RECEIPT_ENTRY.CANCEL_PENDING; }).length,
      closedUnused: closedInFy,
      usedFrom: null,
      usedTo: null,
    };
    if (row.broughtForward + row.received === 0) return; // ใช้หมดหรือปิดก่อนปีนี้ ไม่เกี่ยวกับปีงบประมาณนี้
    inFy.forEach(function (e) {
      row.usedFrom = row.usedFrom === null ? e.ReceiptNo : Math.min(row.usedFrom, e.ReceiptNo);
      row.usedTo = row.usedTo === null ? e.ReceiptNo : Math.max(row.usedTo, e.ReceiptNo);
    });
    row.remaining = row.broughtForward + row.received - row.used - row.cancelled - row.pending - row.closedUnused;
    Object.keys(total).forEach(function (k) { total[k] += row[k]; });
    rows.push(row);
  });
  rows.sort(function (a, b) { return compareText_(a.receivedDate, b.receivedDate) || compareText_(a.bookNo, b.bookNo); });
  return {
    fiscalYear: fy,
    period: { from: range.from, to: range.to, label: 'ปีงบประมาณ ' + fy, rangeLabel: formatThaiDate_(range.from) + ' – ' + formatThaiDate_(range.to) },
    asOf: todayIso_() < range.to ? todayIso_() : range.to,
    rows: rows,
    total: total,
    meta: reportMeta_(ctx),
  };
}

// ---------------------------------------------------------------------------
// 1. เอกสารแจ้งยอดเรียกเก็บเงิน (D-21)
// ---------------------------------------------------------------------------

/**
 * reports.notices — หนังสือแจ้งยอดถึงผู้ปกครอง เฉพาะนักเรียนที่มียอดค้าง (รวมยอดค้างจากปีก่อน)
 * payload: { year, gradeLevel, room, studentId } (ไม่นับนักเรียนที่ย้ายออกแล้ว)
 */
function reportsNotices_(ctx, payload) {
  const year = isBlankInput_(payload.year) ? currentAcademicYear_() : requireAcademicYear_(payload.year);
  const gradeLevel = requireText_(payload.gradeLevel, 'ระดับชั้น', { optional: true, max: 50 });
  const room = requireText_(payload.room, 'ห้อง', { optional: true, max: 20 });
  const studentId = isBlankInput_(payload.studentId) ? '' : requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const lc = ledgerContext_();
  const levels = gradeLevels_();
  const students = studentsById_();
  const enrolls = dbFind_(SHEETS.ENROLLMENTS, function (e) {
    return e.AcademicYear === year && e.EnrollStatus !== STATUS.STUDENT.TRANSFERRED &&
      (!gradeLevel || e.GradeLevel === gradeLevel) && (!room || e.Room === room) && (!studentId || e.StudentId === studentId);
  });
  const wanted = Object.create(null);
  enrolls.forEach(function (e) { wanted[e.StudentId] = e; });
  const items = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) {
    if (!wanted[a.StudentId] || a.Status !== STATUS.ASSESSMENT.ACTIVE) return;
    const dto = assessmentDto_(a, lc);
    if (dto.outstandingSatang <= 0) return;
    (items[a.StudentId] || (items[a.StudentId] = [])).push(dto);
  });
  const notices = enrolls.filter(function (e) { return items[e.StudentId]; }).map(function (e) {
    const s = students[e.StudentId];
    const list = items[e.StudentId].sort(function (a, b) { return a.year - b.year || compareForStatement_(a, b); });
    return {
      studentId: e.StudentId,
      studentNo: s ? s.StudentNo : '',
      fullName: studentNameOf_(s),
      firstName: s ? s.FirstName : '',
      gradeLevel: e.GradeLevel,
      room: e.Room,
      classNo: e.ClassNo,
      classLabel: classLabel_(e.GradeLevel, e.Room),
      items: list.map(function (d) {
        return {
          label: d.label, year: d.year, dueDate: d.dueDate,
          netSatang: d.netSatang, paidSatang: d.paidSatang, outstandingSatang: d.outstandingSatang, overdue: d.overdue,
        };
      }),
      totalSatang: list.reduce(function (sum, d) { return sum + d.outstandingSatang; }, 0),
    };
  }).sort(compareStudentRows_(levels));
  if (notices.length > NOTICE_MAX_STUDENTS) {
    throw validationError_('มีนักเรียนที่ต้องแจ้งยอด ' + notices.length + ' คน มากเกินกว่าจะพิมพ์ครั้งเดียว กรุณาเลือกระดับชั้น');
  }
  notices.forEach(function (n) { n.totalText = bahtText_(n.totalSatang); });
  return {
    year: year,
    issueDate: todayIso_(),
    filter: { gradeLevel: gradeLevel, room: room, studentId: studentId },
    notices: notices,
    totalSatang: notices.reduce(function (sum, n) { return sum + n.totalSatang; }, 0),
    meta: reportMeta_(ctx),
  };
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Dashboard.js
// ============================================================================

/**
 * ============================================================================
 *  Dashboard.gs — ภาพรวมการเงินของปีการศึกษา (ข้อกำหนดข้อ 10)
 * ----------------------------------------------------------------------------
 *  - นักเรียนที่นับ = นักเรียนที่มีชั้นเรียนในปีนั้น และนักเรียนที่มีรายการเรียกเก็บของปีนั้นแต่ไม่มีชั้นเรียน (กลุ่ม "อื่น ๆ")
 *  - สถานะรายนักเรียน (รวมทุกรายการของปีนั้น):
 *      ชำระครบ = ไม่มียอดค้างและยอดสุทธิมากกว่า 0 / ได้รับยกเว้น = ยอดสุทธิเป็น 0 ทั้งหมด
 *      ชำระบางส่วน = มียอดค้างและเคยชำระแล้ว / ยังไม่ชำระ = มียอดค้างและยังไม่ชำระเลย
 *      ยังไม่มีรายการ = ยังไม่ได้ออกรายการเรียกเก็บ
 *  - ยอดเงินเป็นยอด ณ ขณะที่เปิดหน้า คำนวณจาก Ledger ทุกครั้ง (ตรงกับรายงานยอดค้าง)
 * ============================================================================
 */

const DASHBOARD_STATES = Object.freeze(['PAID', 'PARTIAL', 'UNPAID', 'EXEMPT', 'NO_BILL']);
const DASHBOARD_STATE_LABELS = Object.freeze({
  PAID: 'ชำระครบ', PARTIAL: 'ชำระบางส่วน', UNPAID: 'ยังไม่ชำระ', EXEMPT: 'ได้รับยกเว้น', NO_BILL: 'ยังไม่มีรายการเรียกเก็บ',
});
const DASHBOARD_OTHER_KEY = '__OTHER__';

function emptyDashboardGroup_(base) {
  const g = Object.assign(base || {}, {
    students: 0, grossSatang: 0, netSatang: 0, paidSatang: 0, outstandingSatang: 0, overdueSatang: 0, states: {},
  });
  DASHBOARD_STATES.forEach(function (s) { g.states[s] = 0; });
  return g;
}

function addDashboardStudent_(g, r, state) {
  g.students += 1;
  g.states[state] += 1;
  if (!r) return;
  g.grossSatang += r.gross;
  g.netSatang += r.net;
  g.paidSatang += r.paid;
  g.outstandingSatang += r.outstanding;
  g.overdueSatang += r.overdue;
}

function dashboardStateOf_(r) {
  if (!r || !r.count) return 'NO_BILL';
  if (r.outstanding <= 0) return r.net > 0 ? 'PAID' : 'EXEMPT';
  return r.paid > 0 ? 'PARTIAL' : 'UNPAID';
}

/** dashboard.summary — payload: { year } (ค่าเริ่มต้น = ปีการศึกษาปัจจุบัน) */
function dashboardSummary_(ctx, payload) {
  const year = isBlankInput_(payload.year) ? currentAcademicYear_() : requireAcademicYear_(payload.year);
  const lc = ledgerContext_();
  const levels = gradeLevels_();
  const enrollments = Object.create(null);
  dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === year; }).forEach(function (e) { enrollments[e.StudentId] = e; });

  const per = Object.create(null);
  let priorOutstanding = 0;
  const priorStudents = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) {
    if (a.Status !== STATUS.ASSESSMENT.ACTIVE) return;
    if (a.AcademicYear > year) return;
    const f = assessmentFigures_(a, lc);
    if (a.AcademicYear < year) {
      priorOutstanding += f.outstandingSatang;
      if (f.outstandingSatang > 0) priorStudents[a.StudentId] = true;
      return;
    }
    const r = per[a.StudentId] || (per[a.StudentId] = { count: 0, gross: 0, net: 0, paid: 0, outstanding: 0, overdue: 0 });
    r.count += 1;
    r.gross += f.grossSatang;
    r.net += f.netSatang;
    r.paid += f.paidSatang;
    r.outstanding += f.outstandingSatang;
    if (f.outstandingSatang > 0 && a.DueDate && a.DueDate < lc.today) r.overdue += f.outstandingSatang;
  });

  const totals = emptyDashboardGroup_();
  const grades = Object.create(null);
  const population = Object.create(null);
  Object.keys(enrollments).forEach(function (id) { population[id] = true; });
  Object.keys(per).forEach(function (id) { population[id] = true; });
  Object.keys(population).forEach(function (id) {
    const r = per[id] || null;
    const state = dashboardStateOf_(r);
    const e = enrollments[id];
    addDashboardStudent_(totals, r, state);
    const gk = e ? e.GradeLevel : DASHBOARD_OTHER_KEY;
    const g = grades[gk] || (grades[gk] = emptyDashboardGroup_({
      gradeLevel: e ? e.GradeLevel : '', label: e ? e.GradeLevel : 'ไม่มีชั้นเรียนในปีนี้', other: !e, rooms: Object.create(null),
    }));
    addDashboardStudent_(g, r, state);
    if (!e) return;
    const room = g.rooms[e.Room] || (g.rooms[e.Room] = emptyDashboardGroup_({ room: e.Room, label: classLabel_(e.GradeLevel, e.Room) }));
    addDashboardStudent_(room, r, state);
  });
  const byGrade = gradeOrder_(levels);
  const gradeList = Object.keys(grades).sort(function (a, b) {
    if (a === DASHBOARD_OTHER_KEY) return 1;
    if (b === DASHBOARD_OTHER_KEY) return -1;
    return byGrade(a, b);
  }).map(function (k) {
    const g = grades[k];
    g.rooms = Object.keys(g.rooms).sort(compareRoom_).map(function (r) { return g.rooms[r]; });
    return g;
  });

  const today = lc.today;
  const todayFig = dayFigures_(today);
  return {
    year: year,
    today: today,
    generatedAt: nowIso_(),
    totals: totals,
    grades: gradeList,
    states: DASHBOARD_STATES.map(function (s) { return { key: s, label: DASHBOARD_STATE_LABELS[s] }; }),
    priorOutstandingSatang: priorOutstanding,
    priorStudents: Object.keys(priorStudents).length,
    todayReceipts: { date: today, count: todayFig.receiptCount, totalSatang: todayFig.totalSatang, closed: !!closingOf_(today) },
    pendingApprovals: dbFind_(SHEETS.APPROVAL_REQUESTS, function (r) { return r.Status === STATUS.DECISION.PENDING; }).length,
    unclosedDays: unclosedDaysCount_(),
  };
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Backup.js
// ============================================================================

/**
 * ============================================================================
 *  Backup.gs — สำรองและกู้คืนข้อมูล (ข้อกำหนดข้อ 12, D-40 ถึง D-42)
 * ----------------------------------------------------------------------------
 *  ไฟล์สำรอง
 *  - เป็น Google Sheets ไฟล์ใหม่ในโฟลเดอร์ "สำรองข้อมูล ระบบเงินบำรุงการศึกษา" ใน Drive ของบัญชีเจ้าของระบบ
 *  - คัดลอกทุกชีตของฐานข้อมูล (ค่าและรูปแบบเซลล์) + ชีต "_ข้อมูลไฟล์สำรอง"
 *    ไม่มีสคริปต์และค่าลับใน Script Properties ติดไปด้วย
 *  - สำรองภายใต้ lock เดียวกับการบันทึก ทุกชีตในไฟล์จึงเป็นข้อมูล ณ เวลาเดียวกัน
 *  - อัตโนมัติ: ตัวตั้งเวลารายวัน (เปิด/ปิด/เปลี่ยนเวลาได้ในหน้าเว็บ) เก็บไฟล์อัตโนมัติ BACKUP_RETENTION ไฟล์ล่าสุด
 *    และไฟล์อัตโนมัติไฟล์แรกของทุกเดือน ไฟล์อัตโนมัติอื่นย้ายไปถังขยะของ Drive (กู้คืนจากถังขยะได้ภายใน 30 วัน)
 *    ไฟล์ที่สำรองเองและไฟล์ "ก่อนกู้คืน" ไม่ถูกลบอัตโนมัติ
 *
 *  การกู้คืน (ผู้ดูแลระบบ ต้องพิมพ์คำยืนยัน)
 *  1) อ่านและตรวจข้อมูลทุกชีตในไฟล์สำรองก่อน ถ้าพบปัญหาจะไม่แตะข้อมูลจริงเลย
 *  2) สำรองข้อมูลปัจจุบันเป็นไฟล์ "ก่อนกู้คืน" ภายใต้ lock เดียวกัน (ย้อนการกู้คืนได้)
 *  3) เขียนข้อมูลจากไฟล์สำรองทับในไฟล์ฐานข้อมูลเดิม (ไม่สลับไฟล์ ไม่แก้ DB_SPREADSHEET_ID)
 *     ยกเว้น Users (บัญชีและรหัสผ่านปัจจุบัน ผู้ที่ถูกปิดบัญชีแล้วไม่กลับมาใช้ได้)
 *     และ AuditLogs (ประวัติต่อเนื่อง ไม่ย้อนกลับ ลูกโซ่ hash ไม่ขาด)
 *  4) บันทึกประวัติ RESTORE และให้ทุกคนเข้าสู่ระบบใหม่
 * ============================================================================
 */

const BACKUP_FOLDER_NAME = 'สำรองข้อมูล ระบบเงินบำรุงการศึกษา';
const BACKUP_INFO_SHEET = '_ข้อมูลไฟล์สำรอง';
const BACKUP_APP_TAG = 'school-fee-backup';
const BACKUP_HANDLER = 'dailyBackup';
const BACKUP_DEFAULT_HOUR = 18;
const BACKUP_KINDS = Object.freeze({ MANUAL: 'MANUAL', AUTO: 'AUTO', PRE_RESTORE: 'PRE_RESTORE', OTHER: 'OTHER' });
const BACKUP_KIND_LABELS = Object.freeze({ MANUAL: 'สำรองเอง', AUTO: 'อัตโนมัติ', PRE_RESTORE: 'ก่อนกู้คืน', OTHER: 'ไฟล์อื่นในโฟลเดอร์' });
const RESTORE_CONFIRM_TEXT = 'กู้คืนข้อมูล';
const BACKUP_SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/**
 * คอลัมน์ที่ยอมให้ไฟล์สำรองรุ่นเก่าไม่มีได้ (กู้คืนเป็นค่าว่าง) แยกตามชีต
 * ตอนนี้ยังไม่มี: ทุกคอลัมน์ต้องมีครบ เพราะการกู้คืนจำนวนเงินหรือสถานะเป็นค่าว่างเป็นอันตราย
 * ถ้าระบบรุ่นต่อไปเพิ่มคอลัมน์ที่ว่างได้ ให้เพิ่มชื่อไว้ที่นี่หลังตรวจแล้วว่าปลอดภัย เช่น { Payments: ['NewColumn'] }
 */
function restoreOptionalColumns_(name) {
  const map = {};
  return map[name] || [];
}

/** ชีตที่ไม่กู้คืน (คงข้อมูลปัจจุบันไว้) */
function restoreExcludedSheets_() {
  return [SHEETS.USERS, SHEETS.AUDIT_LOGS];
}

function restoreSheetNames_() {
  const excluded = restoreExcludedSheets_();
  return SHEET_ORDER.filter(function (n) { return excluded.indexOf(n) === -1; });
}

function backupHourLabel_(hour) {
  const h = Number(hour);
  return ('0' + h).slice(-2) + ':00–' + ('0' + ((h + 1) % 24)).slice(-2) + ':00 น.';
}

function safeParseJson_(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : fallback;
  } catch (e) {
    return fallback;
  }
}

const PERMISSION_FIX_HINT = 'วิธีแก้: เจ้าของระบบเปิด Apps Script กด Run ฟังก์ชัน SetupDatabase อีกครั้ง ' +
  'ในหน้าขออนุญาตของ Google ให้ติ๊ก "เลือกทั้งหมด (Select all)" ก่อนกดดำเนินการต่อ แล้ว Deploy เวอร์ชันใหม่ (คู่มือติดตั้ง หัวข้อปัญหาที่พบบ่อย)';

/** ข้อผิดพลาดเพราะเจ้าของระบบยังไม่ได้อนุญาตสิทธิ์ (เช่น ไม่ได้ติ๊กสิทธิ์บางข้อในหน้าขออนุญาตแบบเลือกได้ของ Google) */
function isPermissionError_(e) {
  const text = e && e.message ? String(e.message) : String(e);
  return /permission|authorization|ได้รับอนุญาต|สิทธิ์ที่จำเป็น|Required permissions/i.test(text);
}

/** สิทธิ์ที่ขาดจากข้อความของ Google (ไม่แสดงข้อความดิบในหน้าเว็บ) */
function missingPermissionLabel_(e) {
  const text = e && e.message ? String(e.message) : String(e);
  if (/script\.scriptapp|ScriptApp/.test(text)) return 'การทำงานเมื่อไม่ได้เปิดใช้ (ใช้ตั้งเวลาสำรองข้อมูลอัตโนมัติ)';
  if (/auth\/drive|DriveApp/.test(text)) return 'Google ไดรฟ์ (ใช้สร้างไฟล์สำรองข้อมูล)';
  if (/spreadsheets|SpreadsheetApp/.test(text)) return 'Google ชีต (ใช้สร้างไฟล์สำรองข้อมูล)';
  return 'สิทธิ์ที่ระบบต้องใช้';
}

/** แปลงข้อผิดพลาดจาก Drive/ScriptApp เป็นข้อความภาษาไทย (รายละเอียดเขียนลง Log ของเจ้าของระบบ ไม่มีค่าลับ) */
function driveError_(e, what) {
  if (isAppError_(e)) return e;
  const text = e && e.message ? String(e.message) : String(e);
  console.error(what + ' ไม่สำเร็จ: ' + text.slice(0, 300));
  if (isPermissionError_(e)) {
    return appError_(ERROR_CODES.INTERNAL, what + 'ไม่สำเร็จ เพราะเจ้าของระบบยังไม่ได้อนุญาตสิทธิ์ "' + missingPermissionLabel_(e) + '" ' +
      PERMISSION_FIX_HINT, { reason: 'PERMISSION_MISSING' });
  }
  return appError_(ERROR_CODES.INTERNAL, what + 'ไม่สำเร็จ (ติดต่อ Google Drive ไม่ได้ชั่วคราว) กรุณาลองใหม่อีกครั้ง');
}

/**
 * ตอนติดตั้ง: ตรวจว่าได้รับสิทธิ์ที่การสำรองข้อมูลต้องใช้ครบหรือไม่ (Google ให้ผู้ใช้เลือกอนุญาตทีละข้อได้)
 * คืนรายชื่อสิทธิ์ที่ขาด และเพิ่มคำเตือนพร้อมวิธีแก้ในรายงานการติดตั้ง
 */
function checkBackupPermissions_(report) {
  const missing = [];
  const probe = function (fn) {
    try { fn(); } catch (e) { if (isPermissionError_(e)) missing.push(missingPermissionLabel_(e)); }
  };
  probe(function () { DriveApp.getRootFolder().getId(); });
  probe(function () { ScriptApp.getProjectTriggers(); });
  if (missing.length) {
    report.warnings.push('ยังไม่ได้รับอนุญาตสิทธิ์: ' + missing.join(', ') + ' ระบบจึงยังสำรองข้อมูลอัตโนมัติไม่ได้ ' + PERMISSION_FIX_HINT);
  }
  report.permissionsMissing = missing;
  return missing;
}

// ---------------------------------------------------------------------------
// โฟลเดอร์และรายการไฟล์สำรอง
// ---------------------------------------------------------------------------

/** โฟลเดอร์สำรองที่มีอยู่ (ไม่สร้างใหม่) */
function existingBackupFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.BACKUP_FOLDER_ID);
  if (!id) return null;
  try {
    const folder = DriveApp.getFolderById(id);
    return folder.isTrashed() ? null : folder;
  } catch (e) {
    return null;
  }
}

/** โฟลเดอร์สำรอง (สร้างใหม่ถ้ายังไม่มี หรือถูกลบไปแล้ว) */
function backupFolder_() {
  const existing = existingBackupFolder_();
  if (existing) return existing;
  // ต่อท้ายด้วยชื่อไฟล์ฐานข้อมูล เพื่อแยกโฟลเดอร์ของระบบจริงกับชุดทดสอบที่ติดตั้งด้วยบัญชีเดียวกัน
  const folder = DriveApp.createFolder(BACKUP_FOLDER_NAME + ' – ' + db_().getName());
  folder.setDescription('ไฟล์สำรองข้อมูลของระบบบริหารจัดเก็บเงินบำรุงการศึกษา ห้ามแชร์โฟลเดอร์นี้ให้ผู้อื่น');
  PropertiesService.getScriptProperties().setProperty(PROP_KEYS.BACKUP_FOLDER_ID, folder.getId());
  return folder;
}

/** ชื่อไฟล์ เช่น สำรองข้อมูล_2569-11-22_1805_อัตโนมัติ */
function backupFileName_(createdAt, kind) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(createdAt);
  const stamp = m ? (Number(m[1]) + 543) + '-' + m[2] + '-' + m[3] + '_' + m[4] + m[5] : createdAt;
  return 'สำรองข้อมูล_' + stamp + '_' + (BACKUP_KIND_LABELS[kind] || kind);
}

function backupMetaOf_(file) {
  const meta = safeParseJson_(file.getDescription ? file.getDescription() || '' : '', null);
  if (meta && meta.app === BACKUP_APP_TAG && BACKUP_KINDS[meta.kind]) return meta;
  return {
    app: '',
    kind: BACKUP_KINDS.OTHER,
    createdAt: dateToIsoDateTime_(file.getDateCreated()),
    createdBy: '',
    version: '',
    rows: null,
  };
}

function backupDto_(file, meta, names) {
  let rows = null;
  if (meta.rows && typeof meta.rows === 'object') {
    rows = Object.keys(meta.rows).reduce(function (sum, k) { return sum + (Number(meta.rows[k]) || 0); }, 0);
  }
  return {
    fileId: file.getId(),
    name: file.getName(),
    url: file.getUrl(),
    kind: meta.kind,
    kindLabel: BACKUP_KIND_LABELS[meta.kind] || meta.kind,
    createdAt: meta.createdAt,
    createdBy: meta.createdBy ? displayNameOf_(meta.createdBy, names || Object.create(null)) : '',
    version: meta.version || '',
    rows: rows,
  };
}

/** ไฟล์สำรองทั้งหมดในโฟลเดอร์ (ข้ามไฟล์ในถังขยะและไฟล์ที่ไม่ใช่ Google Sheets) ล่าสุดก่อน */
function listBackups_(folder, names) {
  const out = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed() || f.getMimeType() !== BACKUP_SPREADSHEET_MIME) continue;
    out.push(backupDto_(f, backupMetaOf_(f), names));
  }
  return out.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : (a.createdAt > b.createdAt ? -1 : 0); });
}

/** ไฟล์ที่จะใช้กู้คืนต้องอยู่ในโฟลเดอร์สำรองของระบบ ไม่อยู่ในถังขยะ และเป็น Google Sheets */
function requireBackupFile_(fileId) {
  const id = requireText_(fileId, 'ไฟล์สำรอง', { max: 200, pattern: /^[A-Za-z0-9_-]+$/, patternMessage: 'รหัสไฟล์สำรองไม่ถูกต้อง' });
  const folder = existingBackupFolder_();
  if (!folder) throw appError_(ERROR_CODES.NOT_FOUND, 'ยังไม่มีโฟลเดอร์สำรองข้อมูล');
  let file;
  try {
    file = DriveApp.getFileById(id);
  } catch (e) {
    throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบไฟล์สำรองนี้ (อาจถูกลบหรือย้ายไปแล้ว)');
  }
  let inFolder = false;
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folder.getId()) inFolder = true;
  }
  if (!inFolder || file.isTrashed() || file.getMimeType() !== BACKUP_SPREADSHEET_MIME) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'กู้คืนได้เฉพาะไฟล์ Google Sheets ที่อยู่ในโฟลเดอร์ "' + folder.getName() + '" ของระบบนี้เท่านั้น');
  }
  return file;
}

// ---------------------------------------------------------------------------
// สร้างไฟล์สำรอง
// ---------------------------------------------------------------------------

/** สำรองข้อมูลทั้งฐานข้อมูลเป็นไฟล์ใหม่ (ทำภายใต้ lock) คืนข้อมูลไฟล์สำรอง */
function createBackup_(kind, actor) {
  return withScriptLock_(function () {
    const src = db_();
    const createdAt = nowIso_();
    const name = backupFileName_(createdAt, kind);
    let folder;
    let ss;
    try {
      folder = backupFolder_();
      ss = SpreadsheetApp.create(name);
    } catch (e) {
      throw driveError_(e, 'สร้างไฟล์สำรอง');
    }
    const fileId = ss.getId();
    try {
      const initial = ss.getSheets();
      const rows = {};
      SHEET_ORDER.forEach(function (sheetName) {
        const sheet = src.getSheetByName(sheetName);
        if (!sheet) throw appError_(ERROR_CODES.INTERNAL, 'ไม่พบชีต "' + sheetName + '" ในฐานข้อมูล ' + SETUP_HINT_);
        sheet.copyTo(ss).setName(sheetName);
        rows[sheetName] = Math.max(sheet.getLastRow() - 1, 0);
      });
      const info = [
        ['key', 'value', 'คำอธิบาย'],
        ['app', BACKUP_APP_TAG, 'ไฟล์สำรองของ' + APP.NAME + ' ห้ามแก้ไขไฟล์นี้'],
        ['kind', kind, BACKUP_KIND_LABELS[kind]],
        ['createdAt', createdAt, 'วันเวลาที่สำรอง'],
        ['createdBy', actor.username, 'ผู้สั่งสำรอง'],
        ['version', APP.VERSION, 'รุ่นของระบบ'],
        ['sourceId', src.getId(), 'รหัสไฟล์ฐานข้อมูลต้นฉบับ'],
      ];
      const infoSheet = ss.insertSheet(BACKUP_INFO_SHEET);
      const range = infoSheet.getRange(1, 1, info.length, 3);
      range.setNumberFormats(info.map(function () { return ['@', '@', '@']; }));
      range.setValues(info);
      initial.forEach(function (s) { ss.deleteSheet(s); });
      const meta = {
        app: BACKUP_APP_TAG, kind: kind, createdAt: createdAt, createdBy: actor.username,
        version: APP.VERSION, sourceId: src.getId(), rows: rows,
      };
      const file = DriveApp.getFileById(fileId);
      file.setDescription(JSON.stringify(meta));
      file.moveTo(folder);
      const total = Object.keys(rows).reduce(function (sum, k) { return sum + rows[k]; }, 0);
      auditAppend_([{
        action: AUDIT_ACTIONS.BACKUP,
        entity: 'Backup',
        entityId: fileId,
        after: { name: name, kind: kind, rows: rows },
        note: 'สำรองข้อมูล (' + BACKUP_KIND_LABELS[kind] + ') ' + name + ' รวม ' + total + ' แถว',
      }], actor);
      PropertiesService.getScriptProperties().setProperty(PROP_KEYS.BACKUP_LAST, JSON.stringify({
        fileId: fileId, name: name, kind: kind, createdAt: createdAt,
      }));
      return backupDto_(file, meta, userDisplayNames_());
    } catch (e) {
      // ไฟล์ที่ทำไม่เสร็จต้องไม่ถูกเลือกไปกู้คืน จึงย้ายไปถังขยะทันที
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignore) { /* ไม่มีอะไรต้องทำเพิ่ม */ }
      throw driveError_(e, 'สำรองข้อมูล');
    }
  }, LIMITS.SETUP_LOCK_TIMEOUT_MS);
}

/** ย้ายไฟล์สำรองอัตโนมัติที่เกินจำนวนไปถังขยะ (เก็บไฟล์แรกของทุกเดือนไว้เสมอ) คืนชื่อไฟล์ที่ย้าย */
function applyBackupRetention_(actor) {
  return withScriptLock_(function () {
    const folder = existingBackupFolder_();
    if (!folder) return [];
    const keep = getSetting_('BACKUP_RETENTION');
    const autos = listBackups_(folder).filter(function (b) { return b.kind === BACKUP_KINDS.AUTO; });
    const firstOfMonth = Object.create(null);
    autos.forEach(function (b) {
      const m = b.createdAt.slice(0, 7);
      if (!firstOfMonth[m] || b.createdAt < firstOfMonth[m].createdAt) firstOfMonth[m] = b;
    });
    const trashed = [];
    autos.forEach(function (b, i) {
      if (i < keep || firstOfMonth[b.createdAt.slice(0, 7)] === b) return;
      DriveApp.getFileById(b.fileId).setTrashed(true);
      trashed.push(b.name);
    });
    if (trashed.length) {
      auditAppend_([{
        action: AUDIT_ACTIONS.BACKUP_CLEANUP,
        entity: 'Backup',
        after: { files: trashed },
        note: 'ย้ายไฟล์สำรองอัตโนมัติที่เกิน ' + keep + ' ไฟล์ไปถังขยะของ Google Drive ' + trashed.length + ' ไฟล์ (กู้คืนจากถังขยะได้ภายใน 30 วัน)',
      }], actor);
    }
    return trashed;
  }, LIMITS.SETUP_LOCK_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// ตั้งเวลาสำรองอัตโนมัติ
// ---------------------------------------------------------------------------

function backupSchedule_() {
  return safeParseJson_(PropertiesService.getScriptProperties().getProperty(PROP_KEYS.BACKUP_SCHEDULE) || '', {});
}

function backupScheduleStatus_() {
  const s = backupSchedule_();
  let triggerFound = false;
  try {
    triggerFound = ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === BACKUP_HANDLER && (!s.triggerUid || String(t.getUniqueId()) === String(s.triggerUid));
    });
  } catch (e) {
    triggerFound = false;
  }
  return {
    configured: !!s.updatedAt,
    enabled: !!s.enabled,
    hour: s.enabled ? s.hour : null,
    hourLabel: s.enabled ? backupHourLabel_(s.hour) : '',
    triggerFound: triggerFound,
    updatedAt: s.updatedAt || '',
    updatedBy: s.updatedBy || '',
  };
}

/** สร้างหรือลบตัวตั้งเวลา (ลบของเดิมทั้งหมดก่อนเสมอ ไม่ให้สำรองซ้ำหลายครั้งต่อวัน) */
function applyBackupSchedule_(enabled, hour, actor) {
  let uid = '';
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === BACKUP_HANDLER) ScriptApp.deleteTrigger(t);
    });
    if (enabled) {
      uid = String(ScriptApp.newTrigger(BACKUP_HANDLER).timeBased().everyDays(1).atHour(hour).inTimezone(APP.TIMEZONE).create().getUniqueId());
    }
  } catch (e) {
    throw driveError_(e, 'ตั้งเวลาสำรองข้อมูลอัตโนมัติ');
  }
  PropertiesService.getScriptProperties().setProperty(PROP_KEYS.BACKUP_SCHEDULE, JSON.stringify({
    enabled: !!enabled, hour: enabled ? hour : null, triggerUid: uid, updatedAt: nowIso_(), updatedBy: actor.username,
  }));
  return backupScheduleStatus_();
}

/**
 * ตอนติดตั้ง: เปิดการสำรองอัตโนมัติทุกวันให้ ถ้ายังไม่เคยตั้งค่า (ถ้าผู้ดูแลระบบปิดไว้ จะไม่เปิดให้อีก)
 * ถ้ายังไม่ได้รับสิทธิ์ จะยังไม่บันทึกว่า "ตั้งค่าแล้ว" เพื่อให้รัน SetupDatabase ซ้ำหลังอนุญาตแล้วตั้งให้ได้
 */
function ensureDefaultBackupSchedule_(report) {
  const missing = checkBackupPermissions_(report);
  if (PropertiesService.getScriptProperties().getProperty(PROP_KEYS.BACKUP_SCHEDULE)) return;
  if (missing.length) return;
  try {
    applyBackupSchedule_(true, BACKUP_DEFAULT_HOUR, ACTORS.OWNER);
    report.backupScheduleCreated = BACKUP_DEFAULT_HOUR;
  } catch (e) {
    report.warnings.push('ตั้งเวลาสำรองข้อมูลอัตโนมัติไม่สำเร็จ ' + (isPermissionError_(e) ? PERMISSION_FIX_HINT : 'ผู้ดูแลระบบตั้งได้ภายหลังในหน้า "สำรองและกู้คืนข้อมูล"'));
  }
}

/**
 * ตัวตั้งเวลารายวันเรียกฟังก์ชันนี้ (ฟังก์ชันสาธารณะ จึงตรวจว่าเรียกจากตัวตั้งเวลาของระบบ หรือจากเจ้าของระบบเท่านั้น)
 * ถ้าสำรองไม่สำเร็จ จะบันทึกผลไว้ให้ผู้ดูแลระบบเห็น แล้วแจ้งข้อผิดพลาดต่อ เพื่อให้ Google ส่งอีเมลแจ้งเจ้าของระบบ
 */
function dailyBackup(e) {
  const schedule = backupSchedule_();
  const fromTrigger = !!(e && e.triggerUid && schedule.triggerUid && String(e.triggerUid) === String(schedule.triggerUid));
  if (!fromTrigger) assertOwnerContext_();
  const result = { at: nowIso_(), ok: false };
  try {
    const backup = createBackup_(BACKUP_KINDS.AUTO, ACTORS.SYSTEM);
    result.fileId = backup.fileId;
    result.name = backup.name;
    result.trashed = applyBackupRetention_(ACTORS.SYSTEM).length;
    result.ok = true;
  } catch (err) {
    result.message = isAppError_(err) ? err.userMessage : 'สำรองข้อมูลไม่สำเร็จ';
    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.BACKUP_LAST_AUTO, JSON.stringify(result));
    throw err;
  }
  PropertiesService.getScriptProperties().setProperty(PROP_KEYS.BACKUP_LAST_AUTO, JSON.stringify(result));
  // ตรวจความถูกต้องของข้อมูลทุกวัน ถ้าพบปัญหา ให้ทริกเกอร์จบแบบผิดพลาด เพื่อให้ Google ส่งอีเมลแจ้งเจ้าของระบบ
  const integrity = withScriptLock_(function () {
    const r = integrityRun_();
    integrityRecord_(r, ACTORS.SYSTEM);
    return r;
  }, LIMITS.SETUP_LOCK_TIMEOUT_MS);
  result.integrityOk = integrity.ok;
  if (!integrity.ok) {
    throw appError_(ERROR_CODES.INTERNAL, 'สำรองข้อมูลสำเร็จ แต่ตรวจพบปัญหาความถูกต้องของข้อมูล ' + integrity.problemCount +
      ' จุด กรุณาเปิดหน้า "ตรวจความถูกต้องของข้อมูล" ในระบบ');
  }
  return result;
}

// ---------------------------------------------------------------------------
// อ่านและตรวจไฟล์สำรอง
// ---------------------------------------------------------------------------

function readBackupInfo_(ss) {
  const sheet = ss.getSheetByName(BACKUP_INFO_SHEET);
  const out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (r) {
    const k = String(r[0] || '').trim();
    if (k) out[k] = String(r[1] === null || r[1] === undefined ? '' : r[1]).trim();
  });
  return out;
}

/** อ่านข้อมูลทุกชีตที่จะกู้คืนจากไฟล์สำรอง พร้อมรายการปัญหา (ไม่แก้ไขอะไร) */
function readBackupData_(file) {
  let ss;
  try {
    ss = SpreadsheetApp.openById(file.getId());
  } catch (e) {
    throw driveError_(e, 'เปิดไฟล์สำรอง');
  }
  const info = readBackupInfo_(ss);
  const tables = {};
  const problems = [];
  const warnings = [];
  if (info.app !== BACKUP_APP_TAG) warnings.push('ไม่พบข้อมูลไฟล์สำรองของระบบในไฟล์นี้ (อาจไม่ได้สร้างจากระบบ) ระบบจะตรวจข้อมูลทุกชีตก่อนกู้คืน');
  if (info.version && info.version !== APP.VERSION) {
    warnings.push('ไฟล์สำรองนี้สร้างจากระบบรุ่น ' + info.version + ' (รุ่นปัจจุบัน ' + APP.VERSION + ') คอลัมน์ที่ไม่มีในไฟล์จะเป็นค่าว่าง');
  }
  restoreSheetNames_().forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) { problems.push('ไม่พบชีต "' + name + '" ในไฟล์สำรอง'); return; }
    const schema = getSchema_(name);
    const header = readHeader_(sheet);
    const optional = restoreOptionalColumns_(name);
    const missingAll = missingColumns_(buildColumnIndex_(header, schema), schema);
    const missing = missingAll.filter(function (c) { return optional.indexOf(c) === -1; });
    if (missing.length) { problems.push('ชีต "' + name + '" ในไฟล์สำรองขาดคอลัมน์ ' + missing.join(', ')); return; }
    if (missingAll.length) warnings.push('ชีต "' + name + '" ในไฟล์สำรองไม่มีคอลัมน์ ' + missingAll.join(', ') + ' (กู้คืนเป็นค่าว่าง)');
    try {
      const t = readTable_(name, sheet, optional);
      if (t.duplicateIds.length) {
        problems.push('ชีต "' + name + '" ในไฟล์สำรองมีรหัสซ้ำ: ' + t.duplicateIds.slice(0, 3).join(', '));
        return;
      }
      tables[name] = t.rows.map(function (r) { return r.record; });
    } catch (e) {
      problems.push(isAppError_(e) ? e.userMessage : 'อ่านชีต "' + name + '" ในไฟล์สำรองไม่ได้');
    }
  });
  return { info: info, tables: tables, problems: problems, warnings: warnings };
}

/**
 * จำนวนรายการที่บันทึกหลังเวลาสำรอง แยกตามชีต (จากประวัติการใช้งาน ไม่แสดงรายละเอียดการเงิน)
 * ใช้ตำแหน่งของประวัติ "สำรองข้อมูล" ของไฟล์นั้นเป็นจุดตัด (แม่นยำกว่าเวลา เพราะบันทึกภายใต้ lock เดียวกับการสำรอง)
 * ถ้าไม่พบ (ไฟล์ที่ไม่ได้สร้างจากระบบ) ใช้เวลาที่สำรองแทน
 */
function changesSince_(fileId, createdAt) {
  const counts = Object.create(null);
  let total = 0;
  // นับเฉพาะการเปลี่ยนข้อมูลที่จะหายไปเมื่อกู้คืน (ไม่นับการเข้าสู่ระบบ การสำรอง และบัญชีผู้ใช้ซึ่งไม่ถูกกู้คืน)
  const skip = [AUDIT_ACTIONS.SETUP, AUDIT_ACTIONS.LOGIN, AUDIT_ACTIONS.LOGIN_FAILED, AUDIT_ACTIONS.LOGOUT,
    AUDIT_ACTIONS.PASSWORD_CHANGE, AUDIT_ACTIONS.EXPORT, AUDIT_ACTIONS.BACKUP, AUDIT_ACTIONS.RESTORE,
    AUDIT_ACTIONS.INTEGRITY_CHECK, AUDIT_ACTIONS.ACCESS_DENIED, AUDIT_ACTIONS.BACKUP_SCHEDULE, AUDIT_ACTIONS.BACKUP_CLEANUP];
  const rows = dbAll_(SHEETS.AUDIT_LOGS);
  let start = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].Action === AUDIT_ACTIONS.BACKUP && rows[i].EntityId === fileId) { start = i; break; }
  }
  rows.forEach(function (r, i) {
    if (start >= 0 ? i <= start : (!createdAt || r.Timestamp <= createdAt)) return;
    if (skip.indexOf(r.Action) !== -1 || r.Entity === SHEETS.USERS || !SCHEMA[r.Entity]) return;
    total += 1;
    counts[r.Entity] = (counts[r.Entity] || 0) + 1;
  });
  return {
    total: total,
    items: Object.keys(counts).sort().map(function (k) {
      return { entity: k, label: auditEntityLabel_(k), count: counts[k] };
    }),
  };
}

/** คอลัมน์ที่ไม่ใช่ของระบบในชีตปัจจุบัน (ข้อมูลในคอลัมน์เหล่านี้จะถูกล้างเมื่อกู้คืน จึงแจ้งเตือนก่อน) */
function liveExtraColumns_() {
  const out = [];
  const ss = db_();
  restoreSheetNames_().forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const schema = getSchema_(name);
    const extra = readHeader_(sheet).filter(function (h) { return h !== '' && !schema.columnMap[h]; });
    if (extra.length) out.push({ name: name, label: schema.label, columns: extra });
  });
  return out;
}

// ---------------------------------------------------------------------------
// API (ผู้ดูแลระบบเท่านั้น)
// ---------------------------------------------------------------------------

/** backups.status — สถานะโดยย่อสำหรับหน้าแรก (ไม่เปิด Drive) */
function backupsStatus_() {
  const props = PropertiesService.getScriptProperties();
  return {
    schedule: backupScheduleStatus_(),
    last: safeParseJson_(props.getProperty(PROP_KEYS.BACKUP_LAST) || '', null),
    lastAuto: safeParseJson_(props.getProperty(PROP_KEYS.BACKUP_LAST_AUTO) || '', null),
    today: todayIso_(),
  };
}

/** backups.list — รายการไฟล์สำรอง สถานะการตั้งเวลา และผลการสำรองอัตโนมัติครั้งล่าสุด */
function backupsList_() {
  const status = backupsStatus_();
  let folder;
  let backups = [];
  try {
    folder = existingBackupFolder_();
    if (folder) backups = listBackups_(folder, userDisplayNames_());
  } catch (e) {
    throw driveError_(e, 'อ่านรายการไฟล์สำรอง');
  }
  return {
    folder: folder ? { name: folder.getName(), url: folder.getUrl() } : null,
    backups: backups,
    schedule: status.schedule,
    last: status.last,
    lastAuto: status.lastAuto,
    retention: getSetting_('BACKUP_RETENTION'),
    confirmText: RESTORE_CONFIRM_TEXT,
    excludedSheets: restoreExcludedSheets_().map(function (n) { return { name: n, label: SCHEMA[n].label }; }),
  };
}

/** backups.create — สำรองข้อมูลตอนนี้ */
function backupsCreate_(ctx) {
  const backup = createBackup_(BACKUP_KINDS.MANUAL, actorFromCtx_(ctx));
  return { backup: backup, message: 'สำรองข้อมูลเรียบร้อยแล้ว: ' + backup.name };
}

/** backups.setSchedule — เปิด/ปิดการสำรองอัตโนมัติ payload: { enabled, hour } */
function backupsSetSchedule_(ctx, payload) {
  const enabled = requireBool_(payload.enabled, 'การสำรองข้อมูลอัตโนมัติ');
  const hour = enabled ? requireInt_(payload.hour, 'เวลาสำรองข้อมูล', { min: 0, max: 23 }) : null;
  const actor = actorFromCtx_(ctx);
  const before = backupScheduleStatus_();
  const status = applyBackupSchedule_(enabled, hour, actor);
  auditAppend_([{
    action: AUDIT_ACTIONS.BACKUP_SCHEDULE,
    entity: 'Backup',
    before: { enabled: before.enabled, hour: before.hour },
    after: { enabled: status.enabled, hour: status.hour },
    note: enabled ? 'สำรองข้อมูลอัตโนมัติทุกวัน เวลาประมาณ ' + status.hourLabel : 'ปิดการสำรองข้อมูลอัตโนมัติ',
  }], actor);
  return {
    schedule: status,
    message: enabled ? 'ตั้งเวลาสำรองข้อมูลอัตโนมัติทุกวัน เวลาประมาณ ' + status.hourLabel + ' แล้ว' : 'ปิดการสำรองข้อมูลอัตโนมัติแล้ว',
  };
}

/** backups.restorePreview — ตรวจไฟล์สำรองและแสดงผลกระทบก่อนกู้คืน (ยังไม่แก้ไขข้อมูล) payload: { fileId } */
function backupsRestorePreview_(ctx, payload) {
  const file = requireBackupFile_(payload.fileId);
  const data = readBackupData_(file);
  const meta = backupMetaOf_(file);
  const createdAt = data.info.createdAt || meta.createdAt;
  return {
    backup: backupDto_(file, Object.assign({}, meta, { createdAt: createdAt }), userDisplayNames_()),
    valid: data.problems.length === 0,
    problems: data.problems,
    warnings: data.warnings,
    sheets: restoreSheetNames_().map(function (n) {
      return { name: n, label: SCHEMA[n].label, backupRows: data.tables[n] ? data.tables[n].length : null, currentRows: dbAll_(n).length };
    }),
    excludedSheets: restoreExcludedSheets_().map(function (n) { return { name: n, label: SCHEMA[n].label }; }),
    extraColumns: liveExtraColumns_(),
    since: changesSince_(file.getId(), createdAt),
    confirmText: RESTORE_CONFIRM_TEXT,
  };
}

/**
 * backups.restore — กู้คืนข้อมูลจากไฟล์สำรอง payload: { fileId, confirmText }
 * ทำทั้งหมดภายใต้ lock เดียว: ตรวจไฟล์ → สำรอง "ก่อนกู้คืน" → เขียนทับ → บันทึกประวัติ → ให้ทุกคนเข้าสู่ระบบใหม่
 */
function backupsRestore_(ctx, payload) {
  if (payload.confirmText !== RESTORE_CONFIRM_TEXT) {
    throw validationError_('กรุณาพิมพ์คำว่า "' + RESTORE_CONFIRM_TEXT + '" ให้ตรงทุกตัวอักษรเพื่อยืนยัน');
  }
  const file = requireBackupFile_(payload.fileId);
  const data = readBackupData_(file);
  if (data.problems.length) {
    throw appError_(ERROR_CODES.CONFLICT, 'กู้คืนไม่ได้ เพราะไฟล์สำรองนี้ไม่สมบูรณ์: ' + data.problems[0]);
  }
  const actor = actorFromCtx_(ctx);
  const meta = backupMetaOf_(file);
  const backupCreatedAt = data.info.createdAt || meta.createdAt;
  const pre = createBackup_(BACKUP_KINDS.PRE_RESTORE, actor);
  const restored = withScriptLock_(function () {
    const ss = db_();
    const out = {};
    restoreSheetNames_().forEach(function (name) {
      const schema = getSchema_(name);
      const sheet = ss.getSheetByName(name);
      if (!sheet) throw appError_(ERROR_CODES.INTERNAL, 'ไม่พบชีต "' + name + '" ในฐานข้อมูล ' + SETUP_HINT_);
      const header = readHeader_(sheet);
      const missing = missingColumns_(buildColumnIndex_(header, schema), schema);
      if (missing.length) throw appError_(ERROR_CODES.INTERNAL, 'ชีต "' + name + '" ขาดคอลัมน์ ' + missing.join(', ') + ' ' + SETUP_HINT_);
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), header.length)).clearContent();
      writeRecordsAt_(sheet, header, schema, data.tables[name], 2);
      out[name] = data.tables[name].length;
    });
    dbClearCache_();
    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.SESSION_EPOCH, newId_('EPOCH'));
    auditAppend_([{
      action: AUDIT_ACTIONS.RESTORE,
      entity: 'Backup',
      entityId: file.getId(),
      after: { backupName: file.getName(), backupCreatedAt: backupCreatedAt, preRestoreFileId: pre.fileId, preRestoreName: pre.name, rows: out },
      note: 'กู้คืนข้อมูลจากไฟล์ ' + file.getName() + ' (ข้อมูลก่อนกู้คืนเก็บไว้ในไฟล์ ' + pre.name + ')',
    }], actor);
    return out;
  }, LIMITS.SETUP_LOCK_TIMEOUT_MS);
  return {
    restored: restored,
    preRestore: pre,
    backupCreatedAt: backupCreatedAt,
    message: 'กู้คืนข้อมูล ณ ' + formatThaiDateTime_(backupCreatedAt) + ' เรียบร้อยแล้ว ข้อมูลก่อนกู้คืนเก็บไว้ในไฟล์ "' + pre.name +
      '" ทุกคนต้องเข้าสู่ระบบใหม่',
  };
}

// ============================================================================
// ไฟล์ต้นฉบับ: src/Integrity.js
// ============================================================================

/**
 * ============================================================================
 *  Integrity.gs — ตรวจความถูกต้องของข้อมูลทั้งระบบ (ARCHITECTURE หัวข้อ 7, ระยะที่ 8)
 * ----------------------------------------------------------------------------
 *  - ตรวจภายใต้ lock เดียวกับการบันทึก จึงไม่เห็นข้อมูลที่บันทึกค้างครึ่งทาง
 *  - อ่านอย่างเดียว ไม่แก้ไขข้อมูลใด ๆ (ถ้าพบปัญหา ให้คนตรวจต่อจากประวัติการใช้งาน)
 *  - ข้อความปัญหาอ้างอิงรหัสรายการและเลขที่ใบเสร็จ ไม่แสดงจำนวนเงิน (ผู้ดูแลระบบไม่เห็นข้อมูลการเงิน)
 *  - รันได้จากหน้าเว็บ (ผู้ดูแลระบบ ผู้อำนวยการ) และรันอัตโนมัติทุกวันต่อจากการสำรองข้อมูล
 *
 *  รายการตรวจ
 *   1. อ่านข้อมูลได้ทุกชีต และไม่มีรหัสซ้ำ
 *   2. ลูกโซ่ hash ของประวัติการใช้งานไม่ขาด
 *   3. การรับเงินตรงกับการตัดชำระ และตรงกับทะเบียนคุมเลขที่ใบเสร็จ
 *   4. เลขที่ใบเสร็จไม่ซ้ำ และอยู่ในช่วงของเล่ม
 *   5. ไม่มีรายการเรียกเก็บที่ถูกตัดชำระเกินยอดสุทธิ
 *   6. สถานะเล่มสอดคล้องกับเลขที่ที่ใช้
 *   7. ทุกรายการการเงินมีประวัติการบันทึกคู่กัน (ตรวจการเพิ่มแถวในชีตโดยตรง)
 *   8. รายการของวันที่ปิดยอดแล้วไม่เปลี่ยน
 * ============================================================================
 */

const INTEGRITY_MAX_PROBLEMS = 50;

function receiptRef_(bookNo, receiptNo) {
  return 'ใบเสร็จเล่มที่ ' + (bookNo || '?') + ' เลขที่ ' + (receiptNo === null || receiptNo === undefined || receiptNo === '' ? '?' : receiptNo);
}

/** ชีตที่เป็นข้อมูลการเงินและต้องมีประวัติการบันทึกทุกแถว */
function integrityFinancialSheets_() {
  return [SHEETS.FEE_SETTINGS, SHEETS.FEE_ASSESSMENTS, SHEETS.FEE_ADJUSTMENTS, SHEETS.PAYMENTS, SHEETS.PAYMENT_ALLOCATIONS,
    SHEETS.RECEIPT_BOOKS, SHEETS.RECEIPT_ENTRIES, SHEETS.RECEIPT_CANCELLATIONS, SHEETS.APPROVAL_REQUESTS, SHEETS.DAILY_CLOSINGS];
}

/** ตรวจทุกข้อ คืน { ok, checkedAt, problemCount, checks: [{ key, label, ok, count, problems, more }] } (ต้องถือ lock) */
function integrityRun_() {
  assertLockHeld_();
  const checks = [];
  function check(key, label, fn) {
    const problems = [];
    let error = '';
    try {
      fn(function (message) { problems.push(message); });
    } catch (e) {
      error = isAppError_(e) ? e.userMessage : 'ตรวจข้อนี้ไม่สำเร็จ เพราะอ่านข้อมูลไม่ได้';
      if (!isAppError_(e)) console.error('integrity ' + key + ': ' + (e && e.message ? String(e.message).slice(0, 200) : String(e)));
    }
    const all = (error ? [error] : []).concat(problems);
    checks.push({
      key: key,
      label: label,
      ok: all.length === 0,
      count: all.length,
      problems: all.slice(0, INTEGRITY_MAX_PROBLEMS),
      more: Math.max(0, all.length - INTEGRITY_MAX_PROBLEMS),
    });
  }

  check('sheets', 'อ่านข้อมูลได้ทุกชีต และไม่มีรหัสซ้ำ', function (bad) {
    SHEET_ORDER.forEach(function (name) {
      try {
        const t = dbTable_(name);
        if (t.duplicateIds.length) bad('ชีต "' + SCHEMA[name].label + '" มีรหัสซ้ำ: ' + t.duplicateIds.slice(0, 5).join(', '));
      } catch (e) {
        bad('ชีต "' + SCHEMA[name].label + '": ' + (isAppError_(e) ? e.userMessage : 'อ่านข้อมูลไม่ได้'));
      }
    });
  });

  check('audit', 'ลูกโซ่ประวัติการใช้งานไม่ขาด (ไม่มีการแก้ แทรก หรือลบแถวประวัติ)', function (bad) {
    const r = auditVerifyChain_();
    r.problems.forEach(function (p) { bad('แถว ' + p.rowNumber + ' (' + (p.logId || '-') + '): ' + p.label); });
    if (r.problemCount > r.problems.length) bad('และอีก ' + (r.problemCount - r.problems.length) + ' จุด');
  });

  // ข้อมูลที่ใช้ร่วมกันในหลายข้อ (อ่านครั้งเดียว)
  let data = null;
  function load() {
    if (data) return data;
    const payments = dbAll_(SHEETS.PAYMENTS);
    const byPayment = Object.create(null);
    payments.forEach(function (p) { byPayment[p.PaymentId] = p; });
    const allocations = dbAll_(SHEETS.PAYMENT_ALLOCATIONS);
    const allocBy = Object.create(null);
    allocations.forEach(function (al) { (allocBy[al.PaymentId] || (allocBy[al.PaymentId] = [])).push(al); });
    const entries = dbAll_(SHEETS.RECEIPT_ENTRIES);
    const byEntry = Object.create(null);
    entries.forEach(function (e) { byEntry[e.EntryId] = e; });
    const books = dbAll_(SHEETS.RECEIPT_BOOKS);
    const byBook = Object.create(null);
    books.forEach(function (b) { byBook[b.BookId] = b; });
    const assessments = dbAll_(SHEETS.FEE_ASSESSMENTS);
    const byAsm = Object.create(null);
    assessments.forEach(function (a) { byAsm[a.AssessmentId] = a; });
    data = {
      payments: payments, byPayment: byPayment, allocations: allocations, allocBy: allocBy,
      entries: entries, byEntry: byEntry, books: books, byBook: byBook, assessments: assessments, byAsm: byAsm,
    };
    return data;
  }

  check('payments', 'การรับเงินตรงกับการตัดชำระ และตรงกับทะเบียนคุมเลขที่ใบเสร็จ', function (bad) {
    const d = load();
    const keys = Object.create(null);
    d.allocations.forEach(function (al) {
      if (!d.byPayment[al.PaymentId]) bad('การตัดชำระ ' + al.AllocationId + ': ไม่พบการรับเงินที่อ้างถึง (' + al.PaymentId + ')');
    });
    d.payments.forEach(function (p) {
      const ref = receiptRef_(p.ReceiptBookNo, p.ReceiptNo) + ' (' + p.PaymentId + ')';
      if (p.RequestKey) {
        if (keys[p.RequestKey]) bad(ref + ': รหัสคำขอซ้ำกับรายการ ' + keys[p.RequestKey] + ' (อาจบันทึกซ้ำ)');
        else keys[p.RequestKey] = p.PaymentId;
      }
      const active = (d.allocBy[p.PaymentId] || []).filter(function (al) { return al.Status === STATUS.ALLOCATION.ACTIVE; });
      active.forEach(function (al) {
        const asm = d.byAsm[al.AssessmentId];
        if (!asm) bad(ref + ': ตัดชำระรายการเรียกเก็บที่ไม่มีอยู่ (' + al.AssessmentId + ')');
        else if (asm.StudentId !== p.StudentId || al.StudentId !== p.StudentId) bad(ref + ': ตัดชำระรายการของนักเรียนคนอื่น (' + al.AllocationId + ')');
      });
      if (p.Status === STATUS.PAYMENT.ACTIVE) {
        const sum = active.reduce(function (s, al) { return s + satangOf_(al.Amount); }, 0);
        if (sum !== satangOf_(p.Amount)) bad(ref + ': ยอดเงินในใบเสร็จไม่เท่ากับผลรวมการตัดชำระ');
        const e = d.byEntry[p.ReceiptEntryId];
        if (!e) {
          bad(ref + ': ไม่พบเลขที่นี้ในทะเบียนคุมใบเสร็จ');
          return;
        }
        if (e.PaymentId !== p.PaymentId) bad(ref + ': ทะเบียนคุมใบเสร็จชี้ไปที่การรับเงินรายการอื่น');
        if (e.BookId !== p.ReceiptBookId || e.ReceiptNo !== p.ReceiptNo) bad(ref + ': เล่มหรือเลขที่ไม่ตรงกับทะเบียนคุมใบเสร็จ');
        if (e.Status !== STATUS.RECEIPT_ENTRY.USED && e.Status !== STATUS.RECEIPT_ENTRY.CANCEL_PENDING) {
          bad(ref + ': สถานะในทะเบียนคุมเป็น "' + (STATUS_LABELS.RECEIPT_ENTRY[e.Status] || e.Status) + '" แต่การรับเงินยังมีผล');
        }
        if (satangOf_(e.Amount) !== satangOf_(p.Amount) || e.ReceiptDate !== p.PaymentDate || e.StudentId !== p.StudentId) {
          bad(ref + ': จำนวนเงิน วันที่ หรือนักเรียน ไม่ตรงกับทะเบียนคุมใบเสร็จ');
        }
      } else {
        if (active.length) bad(ref + ': การรับเงินที่' + (STATUS_LABELS.PAYMENT[p.Status] || p.Status) + 'แล้วยังมีการตัดชำระที่มีผล');
        if (p.Status === STATUS.PAYMENT.VOIDED) {
          const e = d.byEntry[p.ReceiptEntryId];
          if (e && e.PaymentId === p.PaymentId && e.Status !== STATUS.RECEIPT_ENTRY.CANCELLED) bad(ref + ': ยกเลิกใบเสร็จแล้ว แต่ทะเบียนคุมยังไม่เป็น "ยกเลิก"');
        }
        if (p.Status === STATUS.PAYMENT.REPLACED) {
          const next = d.byPayment[p.ReplacedByPaymentId];
          if (!next || next.ReplacesPaymentId !== p.PaymentId) bad(ref + ': ไม่พบรายการใหม่ที่มาแทนรายการที่แก้ไข');
        }
      }
    });
  });

  check('receipts', 'เลขที่ใบเสร็จไม่ซ้ำ และอยู่ในช่วงของเล่ม', function (bad) {
    const d = load();
    const seen = Object.create(null);
    d.entries.forEach(function (e) {
      if (e.Status === STATUS.RECEIPT_ENTRY.RELEASED) return;
      const ref = receiptRef_(e.BookNo, e.ReceiptNo);
      const key = e.BookId + '|' + e.ReceiptNo;
      if (seen[key]) bad(ref + ': มีในทะเบียนคุมซ้ำ (' + seen[key] + ', ' + e.EntryId + ')');
      else seen[key] = e.EntryId;
      const b = d.byBook[e.BookId];
      if (!b) { bad(ref + ': ไม่พบเล่มใบเสร็จ (' + e.BookId + ')'); return; }
      if (b.BookNo !== e.BookNo) bad(ref + ': เลขเล่มไม่ตรงกับทะเบียนเล่ม (' + b.BookNo + ')');
      if (e.ReceiptNo < b.StartNo || e.ReceiptNo > b.EndNo) bad(ref + ': อยู่นอกช่วงเลขที่ของเล่ม (' + b.StartNo + '–' + b.EndNo + ')');
      if (e.Status === STATUS.RECEIPT_ENTRY.USED) {
        const p = d.byPayment[e.PaymentId];
        if (!p || p.Status !== STATUS.PAYMENT.ACTIVE || p.ReceiptEntryId !== e.EntryId) bad(ref + ': ทะเบียนคุมเป็น "ใช้แล้ว" แต่ไม่มีการรับเงินที่มีผลคู่กัน');
      }
    });
    const activeNo = Object.create(null);
    d.payments.forEach(function (p) {
      if (p.Status !== STATUS.PAYMENT.ACTIVE) return;
      const key = p.ReceiptBookId + '|' + p.ReceiptNo;
      if (activeNo[key]) bad(receiptRef_(p.ReceiptBookNo, p.ReceiptNo) + ': มีการรับเงินที่มีผลซ้ำเลขที่เดียวกัน (' + activeNo[key] + ', ' + p.PaymentId + ')');
      else activeNo[key] = p.PaymentId;
    });
  });

  check('assessments', 'ไม่มีรายการเรียกเก็บที่ถูกตัดชำระเกินยอดสุทธิ', function (bad) {
    const d = load();
    const lc = ledgerContext_();
    lc.adjustments.forEach(function (ad) {
      if (ad.Status === STATUS.ADJUSTMENT.ACTIVE && !d.byAsm[ad.AssessmentId]) bad('การลดหย่อน/ยกเว้น ' + ad.AdjustmentId + ': ไม่พบรายการเรียกเก็บที่อ้างถึง');
    });
    d.assessments.forEach(function (a) {
      const f = assessmentFigures_(a, lc);
      const ref = 'รายการเรียกเก็บ ' + a.AssessmentId + ' (' + termLabel_(a.Term, a.AcademicYear) + ')';
      if (f.netSatang < 0) bad(ref + ': ลดหย่อน/ยกเว้นเกินยอดเรียกเก็บ');
      if (a.Status === STATUS.ASSESSMENT.CANCELLED && f.paidSatang > 0) bad(ref + ': ยกเลิกแล้วแต่ยังมีการตัดชำระที่มีผล');
      else if (f.paidSatang > f.netSatang && f.netSatang >= 0) bad(ref + ': ตัดชำระเกินยอดสุทธิ');
    });
  });

  check('books', 'สถานะเล่มใบเสร็จสอดคล้องกับเลขที่ที่ใช้', function (bad) {
    const d = load();
    const byBookEntries = Object.create(null);
    d.entries.forEach(function (e) { (byBookEntries[e.BookId] || (byBookEntries[e.BookId] = [])).push(e); });
    const active = d.books.filter(function (b) { return b.Status === STATUS.BOOK.ACTIVE; });
    if (active.length > 1) bad('มีเล่มที่กำลังใช้พร้อมกัน ' + active.length + ' เล่ม: ' + active.map(function (b) { return b.BookNo; }).join(', '));
    d.books.forEach(function (b) {
      const ref = 'เล่มที่ ' + b.BookNo;
      if (b.EndNo < b.StartNo) { bad(ref + ': เลขที่สิ้นสุดน้อยกว่าเลขที่เริ่มต้น'); return; }
      const u = bookUsage_(b, byBookEntries[b.BookId] || []);
      if (b.Status === STATUS.BOOK.ACTIVE && u.remaining === 0 && u.pendingCount === 0) bad(ref + ': ใช้ครบทุกเลขที่แล้ว แต่สถานะยังเป็น "กำลังใช้"');
      if (b.Status === STATUS.BOOK.FULL && u.total - u.usedCount - u.cancelledCount - u.pendingCount > 0) bad(ref + ': สถานะ "ใช้ครบเล่ม" แต่ยังมีเลขที่ที่ไม่ได้ใช้');
      if (b.Status === STATUS.BOOK.CLOSED && !b.ClosedDate) bad(ref + ': ปิดเล่มแล้วแต่ไม่มีวันที่ปิดเล่ม');
      if (b.Status === STATUS.BOOK.REGISTERED && (byBookEntries[b.BookId] || []).some(function (e) { return e.Status !== STATUS.RECEIPT_ENTRY.RELEASED; })) {
        bad(ref + ': ยังไม่เปิดใช้ แต่มีเลขที่ถูกใช้แล้ว');
      }
    });
  });

  check('auditCoverage', 'ทุกรายการการเงินมีประวัติการบันทึกคู่กัน (ไม่มีการเพิ่มแถวในชีตโดยตรง)', function (bad) {
    const logged = Object.create(null);
    dbAll_(SHEETS.AUDIT_LOGS).forEach(function (r) { if (r.EntityId) logged[r.Entity + '|' + r.EntityId] = true; });
    integrityFinancialSheets_().forEach(function (name) {
      const schema = getSchema_(name);
      dbAll_(name).forEach(function (rec) {
        const id = rec[schema.idColumn];
        if (!id || !logged[name + '|' + id]) bad('ชีต "' + schema.label + '" รหัส ' + (id || '(ว่าง)') + ': ไม่มีประวัติการบันทึก (อาจเพิ่มหรือแก้แถวในชีตโดยตรง)');
      });
    });
  });

  check('closings', 'รายการรับเงินของวันที่ปิดยอดแล้วไม่เปลี่ยน', function (bad) {
    const byDate = Object.create(null);
    load().payments.forEach(function (p) {
      if (p.Status !== STATUS.PAYMENT.REPLACED) (byDate[p.PaymentDate] || (byDate[p.PaymentDate] = [])).push(p);
    });
    dbAll_(SHEETS.DAILY_CLOSINGS).forEach(function (c) {
      if (c.Status !== STATUS.CLOSING.CLOSED) return;
      const fig = dayFigures_(c.ClosingDate, (byDate[c.ClosingDate] || []).slice().sort(compareByReceipt_));
      if (fig.digest !== c.Digest) {
        bad('วันที่ ' + formatThaiDate_(c.ClosingDate) + ': รายการรับเงินไม่ตรงกับตอนปิดยอด (รหัสตรวจสอบบนรายงานที่ลงนาม ' + verifyCodeOf_(c.Digest) + ')');
      }
    });
  });

  const problemCount = checks.reduce(function (s, c) { return s + c.count; }, 0);
  return { ok: problemCount === 0, checkedAt: nowIso_(), problemCount: problemCount, checks: checks };
}

/** บันทึกผลการตรวจ: ประวัติการใช้งาน + ผลล่าสุดสำหรับหน้าแรก (ต้องถือ lock) */
function integrityRecord_(result, actor) {
  const failed = result.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.label + ' (' + c.count + ')'; });
  auditAppend_([{
    action: AUDIT_ACTIONS.INTEGRITY_CHECK,
    entity: 'Integrity',
    note: result.ok
      ? 'ตรวจความถูกต้องของข้อมูล ' + result.checks.length + ' ข้อ: ถูกต้องทั้งหมด'
      : 'ตรวจความถูกต้องของข้อมูล: พบปัญหา ' + result.problemCount + ' จุด — ' + failed.join(', '),
  }], actor);
  PropertiesService.getScriptProperties().setProperty(PROP_KEYS.INTEGRITY_LAST, JSON.stringify({
    at: result.checkedAt, ok: result.ok, problemCount: result.problemCount, by: actor.username,
    failed: result.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.key; }),
  }));
}

function integrityLast_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.INTEGRITY_LAST);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// API (ผู้ดูแลระบบ ผู้อำนวยการ)
// ---------------------------------------------------------------------------

/** integrity.check — ตรวจทันที (ทำภายใต้ lock จาก Api.gs) */
function integrityCheck_(ctx) {
  const result = integrityRun_();
  const actor = actorFromCtx_(ctx);
  integrityRecord_(result, actor);
  result.checkedBy = ctx.displayName || ctx.username;
  return result;
}

/** integrity.status — ผลการตรวจครั้งล่าสุด (สำหรับหน้าแรกและหน้าตรวจ) */
function integrityStatus_() {
  const last = integrityLast_();
  if (last && last.by) last.byName = last.by === ACTORS.SYSTEM.username ? 'ระบบ (ตรวจอัตโนมัติ)' : displayNameOf_(last.by, userDisplayNames_());
  return { last: last, today: todayIso_() };
}

// ---------------------------------------------------------------------------
// ตรวจความพร้อมของระบบบน Google จริง (เมนูใน Google Sheets สำหรับเจ้าของระบบ)
// ชุดทดสอบอัตโนมัติรันบนตัวจำลอง ข้อนี้ยืนยันว่าบริการของ Google ทำงานตามที่ระบบคาดไว้
// ใช้ไฟล์ชั่วคราวแล้วย้ายไปถังขยะ ไม่แก้ข้อมูลจริง
// ---------------------------------------------------------------------------

const PLATFORM_CHECK_FILE = 'ตรวจความพร้อมระบบเงินบำรุง (ไฟล์ชั่วคราว ลบได้)';

function platformCheck_() {
  const results = [];
  function item(label, fn) {
    try {
      const detail = fn();
      results.push({ label: label, ok: true, detail: detail || '' });
    } catch (e) {
      results.push({ label: label, ok: false, detail: isAppError_(e) ? e.userMessage : String(e && e.message ? e.message : e).slice(0, 200) });
    }
  }
  function expect(cond, message) { if (!cond) throw new Error(message); }

  item('เขตเวลาของสคริปต์เป็น Asia/Bangkok', function () {
    const tz = Session.getScriptTimeZone();
    expect(tz === APP.TIMEZONE, 'ตอนนี้เป็น ' + tz + ' (แก้ใน ⚙️ การตั้งค่าโปรเจกต์)');
  });
  item('ฐานข้อมูลเปิดได้ และมีชีตครบ ' + SHEET_ORDER.length + ' ชีต', function () {
    const ss = db_();
    const missing = SHEET_ORDER.filter(function (n) { return !ss.getSheetByName(n); });
    expect(!missing.length, 'ไม่พบชีต: ' + missing.join(', ') + ' (กด Run SetupDatabase)');
  });
  item('ค่าระบบใน Script Properties ครบ (ไม่แสดงค่า)', function () {
    const props = PropertiesService.getScriptProperties();
    const missing = [PROP_KEYS.DB_SPREADSHEET_ID, PROP_KEYS.AUTH_MODE, PROP_KEYS.PASSWORD_PEPPER, PROP_KEYS.PASSWORD_HASH_ITERATIONS]
      .filter(function (k) { return !props.getProperty(k); });
    expect(!missing.length, 'ขาด: ' + missing.join(', '));
  });
  item('LockService ป้องกันการบันทึกชนกันได้', function () {
    const lock = LockService.getScriptLock();
    expect(lock.tryLock(10000), 'ขอ lock ไม่ได้ภายใน 10 วินาที (อาจมีผู้ใช้กำลังบันทึก ลองใหม่)');
    lock.releaseLock();
  });
  item('CacheService เก็บการเข้าสู่ระบบได้', function () {
    const cache = CacheService.getScriptCache();
    const key = 'platform-check-' + randomHex_(8);
    cache.put(key, 'ok', 60);
    expect(cache.get(key) === 'ok', 'อ่านค่าที่เพิ่งเก็บไม่ได้');
    cache.remove(key);
  });
  item('SHA-256 ถูกต้อง (ใช้กับรหัสผ่าน ลูกโซ่ประวัติ และรหัสตรวจสอบ)', function () {
    expect(sha256Hex_('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'ผลลัพธ์ไม่ตรงกับค่ามาตรฐาน');
  });
  let temp = null;
  item('Google Sheets เก็บข้อความตรงทุกตัวอักษร (เลข 0 นำหน้า วันที่ ภาษาไทย สูตร)', function () {
    temp = SpreadsheetApp.create(PLATFORM_CHECK_FILE);
    const sheet = temp.getSheets()[0];
    const input = ['00123', '2026-11-21', 'เด็กหญิงทดสอบ ณ เชียงใหม่', '=1+1', '+66812345678'];
    const range = sheet.getRange(1, 1, 1, input.length);
    range.setNumberFormats([input.map(function () { return '@'; })]);
    range.setValues([input.map(sanitizeForSheet_)]);
    SpreadsheetApp.flush();
    const back = range.getValues()[0].map(function (v) { return unsanitizeFromSheet_(String(v)); });
    input.forEach(function (v, i) { expect(back[i] === v, 'เขียน "' + v + '" อ่านกลับได้ "' + back[i] + '"'); });
  });
  item('คัดลอกชีตไปไฟล์อื่นได้ (ใช้ตอนสำรองข้อมูล)', function () {
    expect(temp, 'สร้างไฟล์ชั่วคราวไม่สำเร็จ');
    const copy = temp.getSheets()[0].copyTo(temp);
    copy.setName('สำเนาตรวจ');
    expect(copy.getRange(1, 1).getValue() === '00123', 'ค่าในชีตที่คัดลอกไม่ตรง');
  });
  item('Google ไดรฟ์ใช้งานได้ (ย้ายไฟล์ชั่วคราวไปถังขยะ)', function () {
    expect(temp, 'สร้างไฟล์ชั่วคราวไม่สำเร็จ');
    DriveApp.getFileById(temp.getId()).setTrashed(true);
    temp = null;
  });
  item('ตั้งเวลาสำรองข้อมูลอัตโนมัติไว้แล้ว', function () {
    const s = backupScheduleStatus_();
    expect(s.enabled, 'ยังไม่ได้เปิด (ผู้ดูแลระบบเปิดได้ในหน้าสำรองและกู้คืนข้อมูล)');
    expect(s.triggerFound, 'ไม่พบตัวตั้งเวลาใน Apps Script (เปิดหน้าสำรองข้อมูลแล้วตั้งเวลาใหม่)');
    return 'ทุกวัน ' + s.hourLabel;
  });
  item('ลูกโซ่ประวัติการใช้งานไม่ขาด', function () {
    const r = auditVerifyChain_();
    expect(r.ok, 'พบปัญหา ' + r.problemCount + ' จุด (เปิดหน้าตรวจความถูกต้องของข้อมูลในระบบ)');
    return r.total + ' รายการ';
  });
  if (temp) {
    try { DriveApp.getFileById(temp.getId()).setTrashed(true); } catch (e) { /* ลบเองได้ภายหลัง ชื่อไฟล์บอกว่าลบได้ */ }
  }
  return { ok: results.every(function (r) { return r.ok; }), results: results };
}

function formatPlatformCheck_(r) {
  const lines = r.results.map(function (x) { return (x.ok ? '✓ ' : '✗ ') + x.label + (x.detail ? ': ' + x.detail : ''); });
  lines.unshift(r.ok ? 'พร้อมใช้งาน: ผ่านทุกข้อ' : 'พบข้อที่ต้องแก้ ' + r.results.filter(function (x) { return !x.ok; }).length + ' ข้อ', '');
  return lines.join('\n');
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
  VERSION: '0.7.1',
  RELEASE: 'ระยะที่ 7: Dashboard รายงาน และการสำรองข้อมูล',
  SCHEMA_VERSION: 1,
  TIMEZONE: 'Asia/Bangkok',
});

/** ชื่อค่าใน Script Properties (ที่เก็บความลับ ไม่อยู่ในชีต และไม่ส่งออกไปหน้าเว็บ) */
const PROP_KEYS = Object.freeze({
  DB_SPREADSHEET_ID: 'DB_SPREADSHEET_ID', // รหัสไฟล์ Google Sheets ที่ใช้เป็นฐานข้อมูล
  AUTH_MODE: 'AUTH_MODE',                 // PASSWORD หรือ GOOGLE
  PASSWORD_PEPPER: 'PASSWORD_PEPPER',     // ค่าลับสำหรับแฮชรหัสผ่าน ห้ามแก้หรือลบ
  BACKUP_FOLDER_ID: 'BACKUP_FOLDER_ID',   // โฟลเดอร์สำรองข้อมูลใน Google Drive ของเจ้าของระบบ
  BACKUP_SCHEDULE: 'BACKUP_SCHEDULE',     // การตั้งเวลาสำรองอัตโนมัติ (JSON: เปิด/ปิด ชั่วโมง รหัสตัวตั้งเวลา)
  BACKUP_LAST: 'BACKUP_LAST',             // ไฟล์สำรองล่าสุดที่สำเร็จ (JSON: ไม่มีข้อมูลลับ)
  BACKUP_LAST_AUTO: 'BACKUP_LAST_AUTO',   // ผลการสำรองอัตโนมัติครั้งล่าสุด (JSON)
  SESSION_EPOCH: 'SESSION_EPOCH',         // เปลี่ยนค่าเมื่อกู้คืนข้อมูล เพื่อให้ทุกคนเข้าสู่ระบบใหม่
  INTEGRITY_LAST: 'INTEGRITY_LAST',       // ผลการตรวจความถูกต้องของข้อมูลครั้งล่าสุด (JSON ไม่มีข้อมูลลับ)
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
  // RELEASED = คำขอยกเลิกเลขที่ (ยังไม่บันทึกรับเงิน) ไม่ได้รับอนุมัติหรือถูกถอน เลขที่นั้นกลับมาใช้ได้ (แถวเดิมเก็บไว้เป็นประวัติ)
  RECEIPT_ENTRY: Object.freeze({ USED: 'USED', CANCEL_PENDING: 'CANCEL_PENDING', CANCELLED: 'CANCELLED', RELEASED: 'RELEASED' }),
  CANCEL_TYPE: Object.freeze({ SPOILED: 'SPOILED', VOID_PAYMENT: 'VOID_PAYMENT' }),
  DECISION: Object.freeze({ PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', WITHDRAWN: 'WITHDRAWN' }),
  REQUEST_TYPE: Object.freeze({
    FEE_ADJUSTMENT: 'FEE_ADJUSTMENT',
    ASSESSMENT_CANCEL: 'ASSESSMENT_CANCEL',
    RECEIPT_CANCEL: 'RECEIPT_CANCEL',
    PAYMENT_CORRECTION: 'PAYMENT_CORRECTION',
    BOOK_CLOSE: 'BOOK_CLOSE',
  }),
  CLOSING: Object.freeze({ CLOSED: 'CLOSED', REOPENED: 'REOPENED' }),
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
  RECEIPT_ENTRY: { USED: 'ใช้แล้ว', CANCEL_PENDING: 'รออนุมัติยกเลิก', CANCELLED: 'ยกเลิก', RELEASED: 'คืนเลขที่ (คำขอยกเลิกไม่ผ่าน)' },
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
  CLOSING: { CLOSED: 'ปิดยอดแล้ว', REOPENED: 'เปิดยอดใหม่' },
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
  PROMOTE: 'PROMOTE',
  DAY_CLOSE: 'DAY_CLOSE',
  DAY_REOPEN: 'DAY_REOPEN',
  BACKUP_SCHEDULE: 'BACKUP_SCHEDULE',
  BACKUP_CLEANUP: 'BACKUP_CLEANUP',
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
  PROMOTE: 'เลื่อนชั้น',
  DAY_CLOSE: 'ปิดยอดประจำวัน',
  DAY_REOPEN: 'เปิดยอดประจำวันใหม่',
  BACKUP_SCHEDULE: 'ตั้งเวลาสำรองข้อมูลอัตโนมัติ',
  BACKUP_CLEANUP: 'ย้ายไฟล์สำรองเก่าไปถังขยะ',
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
  DAILY_CLOSINGS: 'DailyClosings',
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
  SHEETS.DAILY_CLOSINGS,
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
      ['Status', 'enum', 'USED ใช้แล้ว / CANCEL_PENDING รออนุมัติยกเลิก / CANCELLED ยกเลิก / RELEASED คืนเลขที่ (คำขอยกเลิกไม่ผ่าน)', STATUS.RECEIPT_ENTRY],
      ['PaymentId', 'text', 'รหัสการรับเงินที่ผูกอยู่ (ว่าง = ยกเลิกก่อนบันทึกรับเงิน)'],
      ['ReceiptDate', 'date', 'วันที่ในใบเสร็จ'],
      ['Amount', 'money', 'จำนวนเงินในใบเสร็จ (บาท)'],
      ['StudentId', 'text', 'รหัสนักเรียนในระบบ'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{
      cols: ['BookId', 'ReceiptNo'],
      skipStatus: [STATUS.RECEIPT_ENTRY.RELEASED],
      message: 'เลขที่ใบเสร็จนี้ถูกบันทึกในทะเบียนคุมแล้ว ใช้ซ้ำไม่ได้',
    }],
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

  [SHEETS.DAILY_CLOSINGS]: {
    label: 'การปิดยอดประจำวัน',
    idPrefix: 'CLS',
    tabColor: TAB_COLORS.FEE,
    columns: [
      ['ClosingId', 'id', 'รหัสการปิดยอด (ระบบสร้างอัตโนมัติ) ผู้ปิดยอด = CreatedBy เวลาที่ปิดยอด = CreatedAt'],
      ['ClosingDate', 'date', 'วันที่รับเงินที่ปิดยอด'],
      ['Status', 'enum', 'CLOSED ปิดยอดแล้ว / REOPENED เปิดยอดใหม่ (ผู้อำนวยการ)', STATUS.CLOSING],
      ['ReceiptCount', 'int', 'จำนวนใบเสร็จที่มีผล ณ เวลาปิดยอด'],
      ['TotalAmount', 'money', 'ยอดรับเงินรวม ณ เวลาปิดยอด (บาท)'],
      ['ByChannelJson', 'json', 'ยอดแยกตามช่องทาง'],
      ['ReceiptRange', 'text', 'เล่มและเลขที่ใบเสร็จที่ใช้ในวันนั้น'],
      ['Digest', 'text', 'รหัสตรวจสอบของรายการรับเงินในวันนั้น (พิมพ์ไว้ในรายงานที่ลงนาม)'],
      ['AuditHash', 'text', 'hash ล่าสุดของประวัติการใช้งานขณะปิดยอด'],
      ['ReopenedAt', 'datetime', 'วันเวลาที่เปิดยอดใหม่'],
      ['ReopenedBy', 'text', 'ผู้เปิดยอดใหม่'],
      ['ReopenReason', 'text', 'เหตุผลการเปิดยอดใหม่'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{ cols: ['ClosingDate'], skipStatus: [STATUS.CLOSING.REOPENED], message: 'วันนี้ปิดยอดแล้ว' }],
    mutable: ['Status', 'ReopenedAt', 'ReopenedBy', 'ReopenReason'],
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
  { key: 'SCHOOL_PHONE', group: 'school', label: 'เบอร์โทรศัพท์ติดต่อ', type: 'text', defaultValue: '', description: 'ใช้ในหนังสือแจ้งยอดถึงผู้ปกครอง' },
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
  { key: 'SESSION_ALLOW_REMEMBER', group: 'security', label: 'อนุญาตให้เลือก "อยู่ในระบบต่อในเครื่องนี้"', type: 'bool', defaultValue: 'TRUE', description: 'ผู้ใช้เลือกได้ตอนเข้าสู่ระบบ (เฉพาะเครื่องส่วนตัว) ปิดเบราว์เซอร์แล้วเปิดใหม่ไม่ต้องเข้าสู่ระบบ จนครบอายุสูงสุดของการเข้าสู่ระบบ (ไม่เกิน 6 ชั่วโมงที่ไม่ได้ใช้งาน)' },
  { key: 'LOGIN_MAX_ATTEMPTS', group: 'security', label: 'ใส่รหัสผ่านผิดได้ไม่เกิน (ครั้ง)', type: 'int', defaultValue: '5', min: 3, max: 20, description: 'เกินจำนวนนี้ ชื่อผู้ใช้นั้นจะถูกล็อกชั่วคราว' },
  { key: 'LOGIN_LOCK_MINUTES', group: 'security', label: 'ระยะเวลาล็อกชั่วคราว (นาที)', type: 'int', defaultValue: '15', min: 5, max: 360, description: 'ระยะเวลาที่ห้ามเข้าสู่ระบบหลังใส่รหัสผ่านผิดเกินกำหนด' },
  { key: 'BACKUP_RETENTION', group: 'backup', label: 'จำนวนไฟล์สำรองอัตโนมัติที่เก็บไว้', type: 'int', defaultValue: '60', min: 7, max: 365, description: 'ไฟล์สำรองอัตโนมัติไฟล์แรกของทุกเดือน ไฟล์ที่สำรองเอง และไฟล์ก่อนกู้คืน เก็บถาวรเสมอ ไม่นับในจำนวนนี้' },
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

/** เดือนภาษาไทยจาก 'YYYY-MM' (ค.ศ.) เช่น '2026-11' → 'พฤศจิกายน 2569' */
function formatThaiMonth_(yyyyMm) {
  var m = /^(\d{4})-(\d{2})$/.exec(String(yyyyMm === null || yyyyMm === undefined ? '' : yyyyMm));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return String(yyyyMm || '');
  return formatThaiDate_(m[1] + '-' + m[2] + '-01').replace(/^1 /, '');
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

/** ช่วงวันที่ของปีงบประมาณ (พ.ศ.) เช่น 2570 → 1 ต.ค. 2569 ถึง 30 ก.ย. 2570 (คืนค่าเป็นวันที่ ค.ศ.) */
function fiscalYearRange_(fiscalYear) {
  var ce = Number(fiscalYear) - 543;
  return { from: (ce - 1) + '-10-01', to: ce + '-09-30' };
}

/** ช่วงวันที่ของปีการศึกษา: ใช้วันที่ที่ตั้งไว้ ถ้าไม่มีใช้ 1 พ.ค. ถึง 30 เม.ย. ปีถัดไป (สอดคล้องกับ academicYearOfDate_) */
function academicYearRange_(year, startDate, endDate) {
  var ce = Number(year) - 543;
  return { from: startDate || ce + '-05-01', to: endDate || (ce + 1) + '-04-30' };
}

/**
 * แยกข้อความ CSV/TSV เป็นตาราง (array ของแถว)
 * รองรับเครื่องหมายคำพูด การขึ้นบรรทัดใหม่ในช่อง BOM และเลือกตัวคั่นอัตโนมัติ (แท็บ จุลภาค หรืออัฒภาค)
 * ใช้ได้ทั้งไฟล์ CSV และข้อความที่คัดลอกจาก Excel มาวาง
 */
function parseDelimitedText_(text, delimiter) {
  var s = String(text === null || text === undefined ? '' : text).replace(/^﻿/, '');
  var d = delimiter;
  if (!d) {
    var firstLine = s.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; })[0] || '';
    var counts = { '\t': firstLine.split('\t').length, ',': firstLine.split(',').length, ';': firstLine.split(';').length };
    d = '\t';
    if (counts[','] > counts[d]) d = ',';
    if (counts[';'] > counts[d]) d = ';';
  }
  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (s.charAt(i + 1) === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s.charAt(i + 1) === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
}

/**
 * หาคอลัมน์ข้อมูลนักเรียนจากหัวตาราง (ภาษาไทยหรืออังกฤษ)
 * คืนค่า { studentNo, prefix, firstName, lastName, fullName, gradeLevel, room, gradeRoom, classNo } เป็นเลขคอลัมน์ (-1 = ไม่พบ)
 */
function detectStudentColumns_(headerCells) {
  var FIELDS = {
    studentNo: ['เลขประจำตัวนักเรียน', 'เลขประจำตัว', 'รหัสนักเรียน', 'รหัสประจำตัวนักเรียน', 'รหัสประจำตัว', 'studentno', 'studentid', 'id'],
    prefix: ['คำนำหน้าชื่อ', 'คำนำหน้า', 'prefix', 'title'],
    fullName: ['ชื่อ-นามสกุล', 'ชื่อ-สกุล', 'ชื่อนามสกุล', 'ชื่อสกุล', 'ชื่อ–นามสกุล', 'fullname', 'name'],
    firstName: ['ชื่อ', 'ชื่อจริง', 'firstname'],
    lastName: ['นามสกุล', 'สกุล', 'lastname', 'surname'],
    gradeRoom: ['ชั้น/ห้อง', 'ระดับชั้น/ห้อง', 'ห้องเรียน(ชั้น/ห้อง)', 'class'],
    gradeLevel: ['ระดับชั้น', 'ชั้น', 'ชั้นเรียน', 'grade', 'level'],
    room: ['ห้อง', 'ห้องเรียน', 'room'],
    classNo: ['เลขที่', 'ที่', 'no', 'no.', 'number'],
  };
  function norm(v) { return String(v === null || v === undefined ? '' : v).toLowerCase().replace(/[\s_]+/g, ''); }
  var result = {};
  var used = {};
  Object.keys(FIELDS).forEach(function (key) {
    result[key] = -1;
    var aliases = FIELDS[key].map(norm);
    for (var i = 0; i < headerCells.length; i++) {
      if (!used[i] && aliases.indexOf(norm(headerCells[i])) !== -1) {
        result[key] = i;
        used[i] = true;
        break;
      }
    }
  });
  return result;
}

/** หาแถวหัวตาราง (ใน 10 แถวแรก) ที่มีคอลัมน์ข้อมูลนักเรียนอย่างน้อย 2 คอลัมน์ คืนค่า { index, columns } หรือ null */
function findStudentHeaderRow_(rows) {
  for (var r = 0; r < Math.min(rows.length, 10); r++) {
    var cols = detectStudentColumns_(rows[r]);
    var found = Object.keys(cols).filter(function (k) { return cols[k] !== -1; }).length;
    var hasName = cols.firstName !== -1 || cols.fullName !== -1;
    if (found >= 2 && (cols.studentNo !== -1 || hasName)) return { index: r, columns: cols };
  }
  return null;
}

/** แยกชื่อเต็มภาษาไทยเป็น { prefix, firstName, lastName } เช่น "เด็กชายสมชาย ใจดี" */
function splitThaiFullName_(fullName) {
  var PREFIXES = ['เด็กชาย', 'เด็กหญิง', 'ด.ช.', 'ด.ญ.', 'ดช.', 'ดญ.', 'นางสาว', 'น.ส.', 'นาย', 'นาง', 'Mr.', 'Mrs.', 'Miss', 'Ms.'];
  var s = String(fullName === null || fullName === undefined ? '' : fullName).replace(/\s+/g, ' ').trim();
  var prefix = '';
  for (var i = 0; i < PREFIXES.length; i++) {
    if (s.indexOf(PREFIXES[i]) === 0) {
      prefix = PREFIXES[i];
      s = s.slice(prefix.length).trim();
      break;
    }
  }
  var parts = s === '' ? [] : s.split(' ');
  return { prefix: prefix, firstName: parts.shift() || '', lastName: parts.join(' ') };
}

/**
 * แปลงชื่อระดับชั้นให้ตรงกับรายการที่โรงเรียนตั้งไว้ เช่น "ป1" "ป. 1" "ประถมศึกษาปีที่ 1" → "ป.1"
 * allowed = รายการระดับชั้นจากหน้าตั้งค่า คืนค่า '' ถ้าจับคู่ไม่ได้
 */
function normalizeGradeLevel_(text, allowed) {
  var s = String(text === null || text === undefined ? '' : text).replace(/\s+/g, '').replace(/ปีที่/g, '');
  var candidate = s;
  var patterns = [
    [/^(อนุบาล|อ\.?)(\d+)$/, 'อ.'],
    [/^(ประถมศึกษา|ประถม|ป\.?)(\d+)$/, 'ป.'],
    [/^(มัธยมศึกษา|มัธยม|ม\.?)(\d+)$/, 'ม.'],
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = patterns[i][0].exec(s);
    if (m) { candidate = patterns[i][1] + Number(m[2]); break; }
  }
  for (var j = 0; j < (allowed || []).length; j++) {
    if (String(allowed[j]).replace(/\s+/g, '') === candidate) return allowed[j];
  }
  return '';
}

/** ห้องเรียน: ตัดคำว่า "ห้อง" และช่องว่าง ตัวเลขนำหน้าด้วย 0 ถูกตัด ("01" → "1") */
function normalizeRoom_(text) {
  var s = String(text === null || text === undefined ? '' : text).replace(/ห้อง/g, '').replace(/\s+/g, '');
  return /^\d+$/.test(s) ? String(Number(s)) : s;
}

/** ชื่อเต็มสำหรับแสดงผล: คำนำหน้าติดกับชื่อ แล้วเว้นวรรคก่อนนามสกุล */
function studentDisplayName_(prefix, firstName, lastName) {
  var head = String(prefix || '') + String(firstName || '');
  return lastName ? head + ' ' + lastName : head;
}

// ---------------------------------------------------------------------------
// การเรียกเก็บและการรับชำระ (ระยะที่ 4)
// ---------------------------------------------------------------------------

/** ป้ายภาคเรียน เช่น ('1', 2569) → "ภาคเรียนที่ 1/2569" และ ('Y', 2569) → "ปีการศึกษา 2569" */
function termLabel_(term, year) {
  var t = String(term);
  return t === 'Y' ? 'ปีการศึกษา ' + year : 'ภาคเรียนที่ ' + t + '/' + year;
}

/** ชื่อรายการเรียกเก็บ เช่น "เงินบำรุงการศึกษา ภาคเรียนที่ 1/2569 ชั้น ป.1" (ใช้เขียนในใบเสร็จ) */
function feeItemLabel_(description, term, year, gradeLevel) {
  var name = String(description || '').trim() || 'เงินบำรุงการศึกษา';
  return name + ' ' + termLabel_(term, year) + (gradeLevel ? ' ชั้น ' + gradeLevel : '');
}

/**
 * สถานะการชำระของรายการเรียกเก็บ ตรวจตามลำดับ:
 * ยกเลิก → ได้รับยกเว้น (ยอดสุทธิ 0) → ยังไม่ชำระ → ชำระบางส่วน → ชำระครบ
 */
function payStateOf_(cancelled, netSatang, paidSatang) {
  if (cancelled) return 'CANCELLED';
  if (netSatang <= 0) return 'EXEMPT';
  if (paidSatang <= 0) return 'UNPAID';
  if (paidSatang < netSatang) return 'PARTIAL';
  return 'PAID';
}

/**
 * ตัดชำระตามลำดับรายการที่ส่งมา (เรียงหนี้เก่าก่อนแล้ว) จนเงินหมด
 * items: [{ id, outstandingSatang }] → { allocations: [{ id, satang }], remainderSatang (เงินที่เกินยอดค้าง) }
 */
function autoAllocate_(items, amountSatang) {
  var left = Math.max(0, Math.round(Number(amountSatang) || 0));
  var out = [];
  for (var i = 0; i < items.length && left > 0; i++) {
    var take = Math.min(left, Math.max(0, Math.round(Number(items[i].outstandingSatang) || 0)));
    if (take > 0) {
      out.push({ id: items[i].id, satang: take });
      left -= take;
    }
  }
  return { allocations: out, remainderSatang: left };
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
  'parseDelimitedText_',
  'detectStudentColumns_',
  'findStudentHeaderRow_',
  'splitThaiFullName_',
  'normalizeGradeLevel_',
  'normalizeRoom_',
  'studentDisplayName_',
  'termLabel_',
  'feeItemLabel_',
  'payStateOf_',
  'autoAllocate_',
  'fiscalYearRange_',
  'academicYearRange_',
  'formatThaiMonth_',
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
    parseDelimitedText_: parseDelimitedText_,
    detectStudentColumns_: detectStudentColumns_,
    findStudentHeaderRow_: findStudentHeaderRow_,
    splitThaiFullName_: splitThaiFullName_,
    normalizeGradeLevel_: normalizeGradeLevel_,
    normalizeRoom_: normalizeRoom_,
    studentDisplayName_: studentDisplayName_,
    termLabel_: termLabel_,
    feeItemLabel_: feeItemLabel_,
    payStateOf_: payStateOf_,
    autoAllocate_: autoAllocate_,
    fiscalYearRange_: fiscalYearRange_,
    academicYearRange_: academicYearRange_,
    formatThaiMonth_: formatThaiMonth_,
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
function newId_(prefix, randomLength) {
  for (let i = 0; i < 20; i++) {
    const id = prefix + '-' + Utilities.formatDate(now_(), APP.TIMEZONE, 'yyyyMMddHHmmss') + '-' + randomHex_(randomLength || 6);
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
  const table = readTable_(name, dbSheet_(name));
  DB_TABLES_[name] = table;
  return table;
}

/**
 * อ่านชีตใดก็ได้ตาม SCHEMA (ใช้กับฐานข้อมูล และกับไฟล์สำรองตอนกู้คืน) ไม่เก็บแคช
 * allowMissing: รายชื่อคอลัมน์ที่ยอมให้ไม่มีได้ (อ่านเป็นค่าว่าง) ใช้เฉพาะตอนกู้คืนไฟล์สำรองรุ่นเก่า
 */
function readTable_(name, sheet, allowMissing) {
  const schema = getSchema_(name);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    throw appError_(ERROR_CODES.INTERNAL, 'ชีต "' + name + '" ยังไม่มีหัวตาราง ' + SETUP_HINT_);
  }
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const header = values[0].map(normalizeHeaderCell_);
  const colIndex = buildColumnIndex_(header, schema);
  const missing = missingColumns_(colIndex, schema).filter(function (c) { return !allowMissing || allowMissing.indexOf(c) === -1; });
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

/** รหัสที่จองไว้ด้วย dbReserveId_() แต่ยังไม่ได้บันทึก (ล้างเมื่อเริ่มคำขอใหม่) */
let RESERVED_IDS_ = Object.create(null);

/**
 * จองรหัสอ้างอิงล่วงหน้า สำหรับรายการ 2 ชีตที่ต้องอ้างถึงกันตั้งแต่บันทึกครั้งแรก
 * เช่น การรับเงินกับทะเบียนคุมเลขที่ใบเสร็จ (ต้องถือ lock อยู่)
 */
function dbReserveId_(name) {
  assertLockHeld_();
  const table = dbTable_(name);
  const schema = table.schema;
  if (!schema.idPrefix) throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ชีต ' + name + ' ไม่มีรหัสอัตโนมัติ');
  let id = newId_(schema.idPrefix);
  while (table.idIndex[id] !== undefined || RESERVED_IDS_[id]) id = newId_(schema.idPrefix);
  RESERVED_IDS_[id] = name;
  return id;
}

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

    if (schema.idPrefix && rec[schema.idColumn]) {
      // กำหนดรหัสเองได้เฉพาะรหัสที่จองด้วย dbReserveId_() สำหรับชีตนี้
      if (RESERVED_IDS_[rec[schema.idColumn]] !== name) {
        throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ห้ามกำหนด ' + schema.idColumn + ' เอง');
      }
    } else if (schema.idPrefix) {
      let id = newId_(schema.idPrefix);
      while (table.idIndex[id] !== undefined || batchIds[id] || RESERVED_IDS_[id]) id = newId_(schema.idPrefix);
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
  prepared.forEach(function (rec) { delete RESERVED_IDS_[rec[schema.idColumn]]; });
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
const AUDIT_ID_RANDOM_HEX = 12;
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
      // ประวัติไม่ได้ตรวจรหัสซ้ำกับทุกแถวในชีต (อ่านเฉพาะแถวล่าสุดเพื่อความเร็ว) จึงใช้ส่วนสุ่มยาวกว่า (48 บิต)
      // ให้โอกาสซ้ำแทบเป็นศูนย์ แม้บันทึกหลายพันรายการภายในวินาทีเดียว
      LogId: newId_(state.schema.idPrefix, AUDIT_ID_RANDOM_HEX),
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
// หน้าเว็บ: ไฟล์ HTML จาก src/ (AdminDialog.html, Index.html, JsApprovals.html, JsArrears.html, JsBackup.html, JsCore.html, JsDashboard.html, JsFees.html, JsIntegrity.html, JsPayments.html, JsReports.html, JsStudents.html, JsViews.html, Styles.html)
// ============================================================================

const BUNDLED_HTML_ = Object.freeze({
  "AdminDialog": "<!DOCTYPE html>\n<html lang=\"th\">\n<head>\n  <base target=\"_top\">\n  <meta charset=\"utf-8\">\n  <style>\n    * { box-sizing: border-box; }\n    body { margin: 0; font-family: 'Sarabun', 'Tahoma', 'Leelawadee UI', sans-serif; color: #1B2B3F; font-size: 14px; }\n    .intro { background: #EAF3FC; border-left: 4px solid #1F3A5F; padding: 10px 12px; border-radius: 6px; margin-bottom: 14px; line-height: 1.5; }\n    label { display: block; font-weight: 600; margin: 10px 0 4px; }\n    .hint { color: #5B6B80; font-weight: 400; font-size: 12px; }\n    input[type=text], input[type=email], input[type=password] { width: 100%; padding: 8px 10px; border: 1px solid #C9D3DF; border-radius: 6px; font: inherit; }\n    input:focus { outline: 2px solid #2E86DE; border-color: #2E86DE; }\n    .check { display: flex; gap: 8px; align-items: flex-start; margin-top: 12px; font-weight: 400; }\n    .check input { margin-top: 3px; }\n    .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }\n    button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid #1F3A5F; cursor: pointer; }\n    .primary { background: #1F3A5F; color: #fff; }\n    .secondary { background: #fff; color: #1F3A5F; }\n    button:disabled { opacity: .6; cursor: wait; }\n    .msg { margin-top: 12px; padding: 10px 12px; border-radius: 6px; display: none; line-height: 1.5; }\n    .msg.error { display: block; background: #FBEAE8; color: #8E2A1F; }\n    .msg.ok { display: block; background: #E6F5EE; color: #155F3D; }\n    .hidden { display: none; }\n  </style>\n</head>\n<body>\n  <div class=\"intro\">\n    ใช้สร้าง<strong>ผู้ดูแลระบบคนแรก</strong> หรือรีเซ็ตรหัสผ่านเมื่อผู้ดูแลระบบลืมรหัสผ่าน\n    (ใส่ชื่อผู้ใช้ของผู้ดูแลระบบเดิม) ผู้ดูแลระบบจะเพิ่มผู้ใช้คนอื่นได้ในเว็บแอป\n  </div>\n  <form id=\"form\" autocomplete=\"off\">\n    <label for=\"username\">ชื่อผู้ใช้ <span class=\"hint\">(ภาษาอังกฤษตัวพิมพ์เล็ก เช่น admin)</span></label>\n    <input id=\"username\" type=\"text\" maxlength=\"32\" required>\n\n    <label for=\"displayName\">ชื่อ-นามสกุล</label>\n    <input id=\"displayName\" type=\"text\" maxlength=\"100\" required>\n\n    <label for=\"email\">อีเมล <span class=\"hint\" id=\"emailHint\">(ไม่บังคับ)</span></label>\n    <input id=\"email\" type=\"email\" maxlength=\"254\">\n\n    <div id=\"passwordFields\">\n      <label for=\"password\">รหัสผ่าน <span class=\"hint\">(อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข)</span></label>\n      <input id=\"password\" type=\"password\" maxlength=\"128\" autocomplete=\"new-password\">\n      <label for=\"confirmPassword\">ยืนยันรหัสผ่าน</label>\n      <input id=\"confirmPassword\" type=\"password\" maxlength=\"128\" autocomplete=\"new-password\">\n      <label class=\"check\"><input id=\"mustChange\" type=\"checkbox\" checked>\n        <span>ให้เปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก (แนะนำ เมื่อสร้างให้ผู้อื่น)</span></label>\n    </div>\n\n    <div id=\"msg\" class=\"msg\" role=\"status\"></div>\n    <div class=\"actions\">\n      <button type=\"button\" class=\"secondary\" id=\"closeBtn\">ปิด</button>\n      <button type=\"submit\" class=\"primary\" id=\"saveBtn\">บันทึก</button>\n    </div>\n  </form>\n  <script>\n  /*@@BOOT@@*/\n  (function () {\n    var form = document.getElementById('form');\n    var msg = document.getElementById('msg');\n    var saveBtn = document.getElementById('saveBtn');\n    var googleMode = DIALOG.authMode === 'GOOGLE';\n    if (googleMode) {\n      document.getElementById('passwordFields').className = 'hidden';\n      document.getElementById('emailHint').textContent = '(บังคับ: บัญชี Google ของโรงเรียนที่ใช้เข้าสู่ระบบ)';\n      document.getElementById('email').required = true;\n    }\n    function show(text, ok) { msg.textContent = text; msg.className = 'msg ' + (ok ? 'ok' : 'error'); }\n    document.getElementById('closeBtn').addEventListener('click', function () { google.script.host.close(); });\n    form.addEventListener('submit', function (event) {\n      event.preventDefault();\n      saveBtn.disabled = true;\n      show('กำลังบันทึก…', true);\n      google.script.run\n        .withSuccessHandler(function (res) {\n          saveBtn.disabled = false;\n          show(res.message, res.ok);\n          if (res.ok) {\n            document.getElementById('password').value = '';\n            document.getElementById('confirmPassword').value = '';\n          }\n        })\n        .withFailureHandler(function () {\n          saveBtn.disabled = false;\n          show('เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่', false);\n        })\n        .ownerSetupAdmin({\n          username: document.getElementById('username').value,\n          displayName: document.getElementById('displayName').value,\n          email: document.getElementById('email').value,\n          password: googleMode ? '' : document.getElementById('password').value,\n          confirmPassword: googleMode ? '' : document.getElementById('confirmPassword').value,\n          mustChangePassword: document.getElementById('mustChange').checked,\n        });\n    });\n  })();\n  </script>\n</body>\n</html>\n",
  "Index": "<!DOCTYPE html>\n<html lang=\"th\">\n<head>\n  <base target=\"_top\">\n  <meta charset=\"utf-8\">\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n  <link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap\">\n  <!--@@STYLES@@-->\n</head>\n<body>\n  <div id=\"app\">\n    <div class=\"boot-screen\">\n      <div class=\"spinner\" aria-hidden=\"true\"></div>\n      <p>กำลังโหลดระบบ…</p>\n    </div>\n  </div>\n  <div id=\"busy-bar\" class=\"busy-bar\" aria-hidden=\"true\"></div>\n  <div id=\"toast-root\" class=\"toast-root\" role=\"status\" aria-live=\"polite\"></div>\n  <div id=\"modal-root\"></div>\n  <script>\n  /*@@BOOT@@*/\n  /*@@SHARED@@*/\n  </script>\n  <!--@@CORE@@-->\n  <!--@@VIEWS@@-->\n  <script>App.start();</script>\n</body>\n</html>\n",
  "JsApprovals": "<script>\n/* ==========================================================================\n   JsApprovals — คำขออนุมัติ (ระยะที่ 4)\n   ผู้อำนวยการพิจารณา / เจ้าหน้าที่การเงินติดตามผลและถอนคำขอของตนเอง\n   Server ตรวจสิทธิ์ ตรวจว่าไม่ใช่ผู้ยื่นเอง และตรวจยอดเงินล่าสุดอีกครั้งตอนอนุมัติ\n   ========================================================================== */\n(function () {\n  'use strict';\n  var h = App.h;\n  var clear = App.clear;\n  var button = App.button;\n  var money = App.fmt.money;\n\n  App.state.approvalFilter = 'PENDING';\n\n  function openDecision(r) {\n    var note = App.field({ label: 'ความเห็น (ต้องกรอกเมื่อไม่อนุมัติ)', type: 'textarea', maxlength: 500, span2: true });\n    var errorBox = h('div', { class: 'alert alert-error hidden', role: 'alert' });\n    var busy = false;\n    function decide(decision, btn, close) {\n      if (busy) return;\n      errorBox.classList.add('hidden');\n      if (decision === 'REJECT' && !note.get().trim()) {\n        errorBox.textContent = 'กรุณากรอกเหตุผลที่ไม่อนุมัติ';\n        errorBox.classList.remove('hidden');\n        note.input.focus();\n        return;\n      }\n      busy = true;\n      var label = btn.textContent;\n      btn.disabled = true;\n      btn.textContent = 'กำลังบันทึก…';\n      App.api('approvals.decide', { requestId: r.requestId, decision: decision, note: note.get() }).then(function (res) {\n        close();\n        App.toast(res.message, 'success');\n        App.refresh();\n      }).catch(function (err) {\n        busy = false;\n        btn.disabled = false;\n        btn.textContent = label;\n        errorBox.textContent = (err && err.message) || 'บันทึกไม่สำเร็จ กรุณาลองใหม่';\n        errorBox.classList.remove('hidden');\n      });\n    }\n    App.modal({\n      title: 'พิจารณาคำขอ: ' + r.typeLabel,\n      size: 'lg',\n      body: [\n        h('table', { class: 'kv' }, h('tbody', null,\n          h('tr', null, h('th', { text: 'นักเรียน' }), h('td', { text: r.studentName ? r.studentName + ' (เลขประจำตัว ' + r.studentNo + ')' : '–' })),\n          h('tr', null, h('th', { text: 'รายละเอียด' }), h('td', { class: 'strong', text: r.summary })),\n          r.amountSatang !== null ? h('tr', null, h('th', { text: 'จำนวนเงิน' }), h('td', { text: money(r.amountSatang) })) : null,\n          h('tr', null, h('th', { text: 'เหตุผลของผู้ขอ' }), h('td', { text: r.reason })),\n          r.referenceDoc ? h('tr', null, h('th', { text: 'เอกสารอ้างอิง' }), h('td', { text: r.referenceDoc })) : null,\n          h('tr', null, h('th', { text: 'ผู้ขอ' }), h('td', { text: r.requestedByName + ' · ' + App.fmt.datetime(r.createdAt) })))),\n        r.details && r.details.length ? h('div', null,\n          h('h3', { style: { margin: '14px 0 6px' }, text: 'ค่าเดิมและค่าที่ขอแก้ไข' }),\n          App.table({\n            rows: r.details,\n            columns: [\n              { label: 'ข้อมูล', render: function (x) { return h('span', { class: x.changed ? 'strong' : '', text: x.label }); } },\n              { label: 'ค่าเดิม', key: 'before' },\n              { label: 'ค่าใหม่', render: function (x) { return h('span', { class: x.changed ? 'strong text-danger' : 'muted', text: x.after }); } },\n            ],\n          })) : null,\n        h('div', { class: 'alert alert-info', style: { margin: '12px 0' },\n          text: 'ตรวจเหตุผลและเอกสารอ้างอิงก่อนอนุมัติ ระบบจะตรวจยอดเงินล่าสุดอีกครั้งตอนอนุมัติ ถ้ายอดเปลี่ยนไปแล้วจะอนุมัติไม่ได้' }),\n        note.wrap,\n        errorBox,\n        r.studentId ? h('p', { class: 'small' }, button('ดูบัญชีนักเรียนคนนี้', 'ghost btn-sm', function () {\n          App.clearOverlays();\n          App.go('student-account', { studentId: r.studentId, back: 'approvals' });\n        }, 'user')) : null,\n      ],\n      actions: [\n        { label: 'ปิด', kind: 'secondary' },\n        { label: 'ไม่อนุมัติ', kind: 'danger', onClick: function (btn, close) { decide('REJECT', btn, close); } },\n        { label: 'อนุมัติ', onClick: function (btn, close) { decide('APPROVE', btn, close); } },\n      ],\n    });\n  }\n\n  function withdraw(r) {\n    App.confirm('ถอนคำขอ \"' + r.summary + '\" ใช่หรือไม่? ข้อมูลเดิมจะไม่เปลี่ยนแปลง', { title: 'ถอนคำขอ', confirmLabel: 'ถอนคำขอ', danger: true })\n      .then(function (yes) {\n        if (!yes) return;\n        App.api('approvals.withdraw', { requestId: r.requestId }).then(function (res) {\n          App.toast(res.message, 'success');\n          App.refresh();\n        }).catch(App.fail);\n      });\n  }\n\n  App.defineRoute('approvals', {\n    title: 'คำขออนุมัติ',\n    roles: ['FINANCE', 'DIRECTOR'],\n    menu: { group: 'finance', label: 'คำขออนุมัติ', icon: 'checkSquare', order: 50 },\n    render: function () {\n      var filter = App.state.approvalFilter;\n      return App.api('approvals.list', { status: filter }).then(function (data) {\n        function tab(value, label) {\n          var b = button(label, 'secondary btn-sm', function () {\n            App.state.approvalFilter = value;\n            App.refresh();\n          });\n          b.setAttribute('aria-pressed', String(filter === value));\n          return b;\n        }\n        var columns = [\n          { label: 'วันที่ขอ', className: 'nowrap', render: function (r) { return App.fmt.datetime(r.createdAt); } },\n          { label: 'ประเภท', key: 'typeLabel' },\n          { label: 'รายละเอียด', render: function (r) { return [h('div', { text: r.summary }), h('div', { class: 'muted small', text: 'เหตุผล: ' + r.reason })]; } },\n          { label: 'ผู้ขอ', key: 'requestedByName' },\n          { label: 'สถานะ', render: function (r) {\n            return [App.badge(r.statusLabel, App.KIND.DECISION[r.status]),\n              r.decidedByName && r.status !== 'PENDING' ? h('div', { class: 'muted small', text: r.decidedByName + (r.decisionNote ? ': ' + r.decisionNote : '') }) : null];\n          } },\n          { label: 'จัดการ', className: 'actions', render: function (r) {\n            if (r.status !== 'PENDING') return null;\n            if (data.canDecide) return button('พิจารณา', 'primary btn-sm', function () { openDecision(r); }, 'checkSquare');\n            if (r.requestedBy === data.me) return button('ถอนคำขอ', 'ghost btn-sm', function () { withdraw(r); });\n            return null;\n          } },\n        ];\n        return h('div', null,\n          App.pageHead('คำขออนุมัติ', data.canDecide\n            ? 'คำขอที่รอผู้อำนวยการพิจารณา: ลดหย่อน/ยกเว้น ยกเลิกรายการเรียกเก็บ ยกเลิกเลขที่หรือใบเสร็จ แก้ไขรายการรับเงิน และปิดเล่มใบเสร็จ (รายการเก่าอยู่บนสุด)'\n            : 'ติดตามผลคำขอที่ยื่นไว้ ระหว่างรออนุมัติ ยอดเงินเดิมยังมีผลตามเดิม'),\n          h('div', { class: 'tabs', role: 'group', 'aria-label': 'ตัวกรองคำขอ' },\n            tab('PENDING', 'รออนุมัติ (' + data.pendingCount + ')'),\n            tab('ALL', 'ทั้งหมด')),\n          h('div', { class: 'card' }, h('div', { class: 'card-body' }, App.table({\n            rows: data.rows,\n            columns: columns,\n            onRowClick: data.canDecide ? function (r) { if (r.status === 'PENDING') openDecision(r); } : null,\n            empty: filter === 'PENDING' ? 'ไม่มีคำขอที่รออนุมัติ' : 'ยังไม่มีคำขอ',\n          }))));\n      });\n    },\n  });\n})();\n</script>\n",
  "JsArrears": "<script>\n/* ==========================================================================\n   JsArrears — ยอดค้างชำระ รายชั้น รายห้อง รายนักเรียน และยอดค้างสะสมจากปีก่อน (ระยะที่ 6)\n   ตัวเลขทั้งหมดคำนวณที่ Server จากข้อมูลจริงทุกครั้ง หน้านี้กรองและจัดรูปแบบเท่านั้น\n   ========================================================================== */\n(function () {\n  'use strict';\n  var h = App.h;\n  var clear = App.clear;\n  var button = App.button;\n  var money = App.fmt.money;\n  var OTHER = '__OTHER__';\n\n  App.state.arrearsYear = null;\n  App.state.arrearsFilter = { grade: '', room: '', owing: true, overdue: false, q: '' };\n\n  function pct(paid, net) {\n    return net > 0 ? (Math.round(paid * 1000 / net) / 10).toFixed(1) + '%' : '–';\n  }\n\n  function amount(satang, strong) {\n    return h('span', { class: satang > 0 && strong ? 'text-danger strong' : (satang > 0 ? '' : 'muted'), text: formatSatang_(satang) });\n  }\n\n  App.defineRoute('arrears', {\n    title: 'ยอดค้างชำระ',\n    roles: ['FINANCE', 'DIRECTOR'],\n    menu: { group: 'finance', label: 'ยอดค้างชำระ', icon: 'alertCircle', order: 25 },\n    render: function (params) {\n      var year = params.year || App.state.arrearsYear || App.state.me.school.currentAcademicYear;\n      return Promise.all([App.api('arrears.summary', { year: year }), App.api('years.list')]).then(function (res) {\n        var data = res[0];\n        var years = res[1];\n        App.state.arrearsYear = data.year;\n        var f = App.state.arrearsFilter;\n        var s = data.school;\n        var hasLater = s.laterSatang > 0;\n\n        // ---------------------------------------------------------------- สรุปตามชั้นและห้อง\n        var summaryRows = [];\n        data.grades.forEach(function (g) {\n          summaryRows.push({ kind: 'grade', label: g.gradeLevel, grade: g.gradeLevel, room: '', fig: g });\n          if (g.rooms.length > 1) {\n            g.rooms.forEach(function (r) { summaryRows.push({ kind: 'room', label: 'ห้อง ' + (r.room || '–'), grade: g.gradeLevel, room: r.room, fig: r }); });\n          }\n        });\n        summaryRows.push({ kind: 'total', label: 'รวมนักเรียนปีการศึกษา ' + data.year, fig: data.enrolled });\n        if (data.other.students) {\n          summaryRows.push({ kind: 'other', label: 'ไม่มีชั้นเรียนในปีนี้ (ย้ายออก/จบการศึกษา)', grade: OTHER, fig: data.other });\n          summaryRows.push({ kind: 'school', label: 'รวมทั้งโรงเรียน', fig: s });\n        }\n        var summaryColumns = [\n          { label: 'ชั้น / ห้อง', render: function (r) {\n            var cls = r.kind === 'room' ? 'small' : (r.kind === 'grade' || r.kind === 'other' ? 'strong' : 'strong');\n            return h('span', { class: cls, style: r.kind === 'room' ? { paddingLeft: '18px' } : null, text: r.label });\n          } },\n          { label: 'นักเรียน', className: 'num', render: function (r) { return String(r.fig.students); } },\n          { label: 'ค้าง (คน)', className: 'num', render: function (r) { return String(r.fig.owingStudents); } },\n          { label: 'เรียกเก็บสุทธิ ' + data.year, className: 'num', render: function (r) { return formatSatang_(r.fig.netSatang); } },\n          { label: 'ชำระแล้ว', className: 'num', render: function (r) {\n            return [h('div', { text: formatSatang_(r.fig.paidSatang) }), h('div', { class: 'muted small', text: pct(r.fig.paidSatang, r.fig.netSatang) })];\n          } },\n          { label: 'ค้างปี ' + data.year, className: 'num', render: function (r) { return amount(r.fig.currentSatang); } },\n          { label: 'ค้างจากปีก่อน', className: 'num', render: function (r) { return amount(r.fig.priorSatang); } },\n        ];\n        if (hasLater) summaryColumns.push({ label: 'ปีถัดไป', className: 'num', render: function (r) { return amount(r.fig.laterSatang); } });\n        summaryColumns.push(\n          { label: 'รวมค้าง', className: 'num', render: function (r) { return amount(r.fig.totalSatang, true); } },\n          { label: 'เลยกำหนด', className: 'num', render: function (r) { return amount(r.fig.overdueSatang); } });\n\n        // ---------------------------------------------------------------- รายชื่อนักเรียน\n        var gradeOptions = [{ value: '', label: 'ทุกชั้น' }].concat(data.grades.map(function (g) { return { value: g.gradeLevel, label: g.gradeLevel }; }));\n        if (data.other.students) gradeOptions.push({ value: OTHER, label: 'ไม่มีชั้นเรียนในปีนี้' });\n        if (!gradeOptions.some(function (o) { return o.value === f.grade; })) { f.grade = ''; f.room = ''; }\n        var gradeSel = App.field({ label: 'ชั้น', type: 'select', options: gradeOptions, value: f.grade });\n        var roomSel = App.field({ label: 'ห้อง', type: 'select' });\n        var search = App.field({ label: 'ค้นหา', placeholder: 'ชื่อ หรือเลขประจำตัว', value: f.q });\n        search.wrap.classList.add('filter-wide');\n        var owing = App.field({ label: 'เฉพาะผู้ที่มียอดค้าง', type: 'checkbox', value: f.owing });\n        var overdue = App.field({ label: 'เฉพาะที่เลยกำหนด', type: 'checkbox', value: f.overdue });\n        var listInfo = h('div', { class: 'toolbar', style: { gap: '8px', marginBottom: '12px' } });\n        var list = h('div');\n        var printFilter = h('div');\n\n        function fillRooms() {\n          var g = data.grades.filter(function (x) { return x.gradeLevel === f.grade; })[0];\n          var rooms = g ? g.rooms.map(function (r) { return r.room; }) : [];\n          clear(roomSel.input);\n          roomSel.input.appendChild(h('option', { value: '', text: g ? 'ทุกห้อง' : '(เลือกชั้นก่อน)' }));\n          rooms.forEach(function (r) { roomSel.input.appendChild(h('option', { value: r, text: 'ห้อง ' + (r || '–') })); });\n          if (rooms.indexOf(f.room) === -1) f.room = '';\n          roomSel.input.value = f.room;\n          roomSel.input.disabled = !g || rooms.length < 2;\n        }\n\n        function filterText() {\n          var parts = [];\n          parts.push(f.grade === OTHER ? 'นักเรียนที่ไม่มีชั้นเรียนในปีนี้' : (f.grade ? 'ชั้น ' + f.grade + (f.room ? '/' + f.room : '') : 'ทุกชั้น'));\n          if (f.owing) parts.push('เฉพาะผู้ที่มียอดค้าง');\n          if (f.overdue) parts.push('เฉพาะที่เลยกำหนด');\n          if (f.q.trim()) parts.push('ค้นหา \"' + f.q.trim() + '\"');\n          return parts.join(' · ');\n        }\n\n        function draw() {\n          var q = f.q.trim().toLowerCase().replace(/\\s+/g, '');\n          var rows = data.rows.filter(function (r) {\n            if (f.grade === OTHER && r.enrolled) return false;\n            if (f.grade && f.grade !== OTHER && r.gradeLevel !== f.grade) return false;\n            if (f.room && r.room !== f.room) return false;\n            if (f.owing && r.totalSatang <= 0) return false;\n            if (f.overdue && r.overdueSatang <= 0) return false;\n            if (q && (r.studentNo + r.fullName).toLowerCase().replace(/\\s+/g, '').indexOf(q) === -1) return false;\n            return true;\n          });\n          var sum = { current: 0, prior: 0, total: 0, overdue: 0 };\n          rows.forEach(function (r) { sum.current += r.currentSatang; sum.prior += r.priorSatang; sum.total += r.totalSatang; sum.overdue += r.overdueSatang; });\n          clear(listInfo);\n          listInfo.appendChild(App.badge(rows.length + ' คน รวมค้าง ' + money(sum.total), sum.total ? 'danger' : 'success'));\n          listInfo.appendChild(App.badge('ปีนี้ ' + money(sum.current), 'FINANCE'));\n          if (sum.prior) listInfo.appendChild(App.badge('จากปีก่อน ' + money(sum.prior), 'warning'));\n          if (sum.overdue) listInfo.appendChild(App.badge('เลยกำหนด ' + money(sum.overdue), 'danger'));\n          printFilter.textContent = 'รายชื่อ: ' + filterText() + ' · ' + rows.length + ' คน รวมค้าง ' + money(sum.total);\n          var columns = [\n            { label: 'ชั้น/ห้อง', className: 'nowrap', render: function (r) { return r.enrolled ? r.classLabel : '–'; } },\n            { label: 'เลขที่', render: function (r) { return r.classNo === null ? '–' : String(r.classNo); } },\n            { label: 'เลขประจำตัว', render: function (r) { return h('span', { class: 'mono', text: r.studentNo }); } },\n            { label: 'ชื่อ-นามสกุล', render: function (r) {\n              var note = !r.enrolled ? r.statusLabel : (r.enrollStatus !== 'STUDYING' ? r.enrollStatusLabel : '');\n              return [h('div', { text: r.fullName }), note ? App.badge(note, 'muted') : null];\n            } },\n            { label: 'ค้างปีนี้', className: 'num', render: function (r) { return amount(r.currentSatang); } },\n            { label: 'ค้างจากปีก่อน', className: 'num', render: function (r) {\n              var prior = r.years.filter(function (y) { return y.year < data.year; });\n              return [amount(r.priorSatang), prior.length ? h('div', { class: 'muted small', text: prior.map(function (y) { return y.year + ': ' + formatSatang_(y.satang); }).join(', ') }) : null];\n            } },\n          ];\n          if (hasLater) columns.push({ label: 'ปีถัดไป', className: 'num', render: function (r) { return amount(r.laterSatang); } });\n          columns.push(\n            { label: 'รวมค้าง', className: 'num', render: function (r) { return amount(r.totalSatang, true); } },\n            { label: 'เลยกำหนด', className: 'num', render: function (r) {\n              return [amount(r.overdueSatang), r.overdueSatang && r.oldestDue ? h('div', { class: 'muted small', text: 'ตั้งแต่ ' + App.fmt.date(r.oldestDue) }) : null];\n            } });\n          clear(list).appendChild(App.table({\n            rows: rows,\n            columns: columns,\n            onRowClick: function (r) { App.go('student-account', { studentId: r.studentId, back: 'arrears', backParams: { year: data.year } }); },\n            empty: f.owing ? 'ไม่มีนักเรียนที่ค้างชำระตามเงื่อนไขนี้' : 'ไม่พบนักเรียนตามเงื่อนไข',\n          }));\n        }\n\n        function setGroup(grade, room) {\n          f.grade = grade || '';\n          f.room = room || '';\n          gradeSel.input.value = f.grade;\n          fillRooms();\n          draw();\n          App.scrollToEl(listCard);\n        }\n        gradeSel.input.addEventListener('change', function () { f.grade = gradeSel.get(); f.room = ''; fillRooms(); draw(); });\n        roomSel.input.addEventListener('change', function () { f.room = roomSel.get(); draw(); });\n        search.input.addEventListener('input', function () { f.q = search.get(); draw(); });\n        owing.input.addEventListener('change', function () { f.owing = owing.get(); draw(); });\n        overdue.input.addEventListener('change', function () { f.overdue = overdue.get(); draw(); });\n        fillRooms();\n        draw();\n\n        var yearSel = App.field({ label: 'ปีการศึกษา', type: 'select', value: String(data.year),\n          options: years.map(function (y) { return { value: String(y.year), label: y.label + (y.isCurrent ? ' (ปัจจุบัน)' : '') }; }) });\n        yearSel.input.addEventListener('change', function () { App.go('arrears', { year: Number(yearSel.input.value) }); });\n\n        var listCard = h('div', { class: 'card' },\n          h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: 'รายชื่อนักเรียน' })),\n          h('div', { class: 'card-body' },\n            h('div', { class: 'toolbar filter-bar' }, gradeSel.wrap, roomSel.wrap, search.wrap, owing.wrap, overdue.wrap),\n            listInfo, list));\n\n        var generated = App.fmt.datetime(data.generatedAt);\n        return h('div', { class: 'has-print-head' },\n          h('div', { class: 'print-only print-head' },\n            h('div', { class: 'strong', text: App.state.me.school.name }),\n            h('h1', { text: 'รายงานยอดค้างชำระเงินบำรุงการศึกษา ปีการศึกษา ' + data.year }),\n            h('div', { text: 'ข้อมูล ณ ' + generated + ' · ยอดค้างจากปีก่อน = รายการเรียกเก็บของปีการศึกษาก่อนหน้าที่ยังชำระไม่ครบ' }),\n            printFilter),\n          App.pageHead('ยอดค้างชำระ', 'ปีการศึกษา ' + data.year + ' · ข้อมูล ณ ' + generated + ' · คลิกชั้นหรือห้องเพื่อดูรายชื่อ คลิกชื่อเพื่อดูบัญชีนักเรียน',\n            [button('พิมพ์', 'secondary', function () { window.print(); }, 'printer')]),\n          h('div', { class: 'toolbar filter-bar no-print' }, yearSel.wrap),\n          h('div', { class: 'grid-cards' },\n            App.statCard('ยอดค้างทั้งหมด', money(s.totalSatang), s.owingStudents + ' คน' + (s.overdueSatang ? ' · เลยกำหนด ' + money(s.overdueSatang) : ''), s.totalSatang ? 'danger' : 'success'),\n            App.statCard('ค้างปีการศึกษา ' + data.year, money(s.currentSatang), 'ชำระแล้ว ' + pct(s.paidSatang, s.netSatang) + ' ของ ' + money(s.netSatang)),\n            App.statCard('ค้างจากปีก่อน', money(s.priorSatang), s.priorSatang ? 'ยอดค้างสะสมของปีการศึกษาก่อนหน้า' : 'ไม่มี'),\n            App.statCard('นักเรียนปีการศึกษา ' + data.year, data.enrolled.students + ' คน', 'ค้างชำระ ' + data.enrolled.owingStudents + ' คน')),\n          h('div', { class: 'stack' },\n            h('div', { class: 'card' },\n              h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: 'สรุปตามชั้นและห้อง' })),\n              h('div', { class: 'card-body' }, App.table({\n                rows: summaryRows,\n                columns: summaryColumns,\n                onRowClick: function (r) {\n                  if (r.kind === 'grade' || r.kind === 'room' || r.kind === 'other') setGroup(r.grade, r.room);\n                  else setGroup('', '');\n                },\n                empty: 'ยังไม่มีข้อมูลนักเรียนหรือรายการเรียกเก็บของปีการศึกษานี้',\n              }))),\n            listCard));\n      });\n    },\n  });\n})();\n</script>\n",
  "JsBackup": "<script>\n/* ==========================================================================\n   JsBackup — สำรองและกู้คืนข้อมูล (ระยะที่ 7, ข้อกำหนดข้อ 12) เฉพาะผู้ดูแลระบบ\n   - ผู้ดูแลระบบเห็นเฉพาะชื่อไฟล์ เวลา และจำนวนแถว ไม่เห็นรายละเอียดการเงิน\n   - กู้คืน: ระบบตรวจไฟล์และแสดงผลกระทบก่อน ต้องพิมพ์คำยืนยัน และสำรองข้อมูลปัจจุบันเป็นไฟล์ \"ก่อนกู้คืน\" ทุกครั้ง\n   - Server ตรวจสิทธิ์ ตรวจไฟล์ และทำทั้งหมดภายใต้ lock เดียว (หน้าเว็บนี้แค่แสดงผลและส่งคำสั่ง)\n   ========================================================================== */\n(function () {\n  'use strict';\n  var h = App.h;\n  var clear = App.clear;\n  var button = App.button;\n\n  var KIND_BADGE = { MANUAL: 'FINANCE', AUTO: 'muted', PRE_RESTORE: 'warning', OTHER: 'muted' };\n\n  function hourOptions() {\n    var out = [];\n    for (var i = 0; i < 24; i++) out.push({ value: String(i), label: (i < 10 ? '0' : '') + i + ':00–' + ((i + 1) % 24 < 10 ? '0' : '') + ((i + 1) % 24) + ':00 น.' });\n    return out;\n  }\n\n  function busyButton(btn, text) {\n    var label = btn.textContent;\n    btn.disabled = true;\n    btn.textContent = text;\n    return function () { btn.disabled = false; btn.textContent = label; };\n  }\n\n  function backupNow(btn) {\n    App.confirm('สำรองข้อมูลทั้งหมดเป็นไฟล์ใหม่ในโฟลเดอร์สำรองของ Google Drive ระหว่างสำรอง (ประมาณ 1 นาที) ผู้อื่นจะบันทึกข้อมูลไม่ได้ชั่วคราว',\n      { title: 'สำรองข้อมูลตอนนี้', confirmLabel: 'สำรองข้อมูล' }).then(function (yes) {\n      if (!yes) return;\n      var done = busyButton(btn, 'กำลังสำรองข้อมูล…');\n      App.api('backups.create', {}).then(function (res) {\n        App.toast(res.message, 'success');\n        App.refresh();\n      }).catch(function (err) { done(); App.fail(err); });\n    });\n  }\n\n  function openSchedule(schedule) {\n    App.formModal({\n      title: 'ตั้งเวลาสำรองข้อมูลอัตโนมัติ',\n      intro: 'ระบบสำรองข้อมูลอัตโนมัติวันละครั้งในช่วงเวลาที่เลือก (Google เลือกนาทีเองภายในชั่วโมงนั้น) แนะนำช่วงหลังเลิกงาน เช่น 18:00–19:00 น. ' +\n        'ไฟล์อัตโนมัติเก็บตามจำนวนที่ตั้งไว้ในหน้าตั้งค่า (BACKUP_RETENTION) และเก็บไฟล์แรกของทุกเดือนถาวร',\n      fields: [\n        { key: 'enabled', type: 'checkbox', label: 'เปิดการสำรองข้อมูลอัตโนมัติทุกวัน', value: schedule.enabled, span2: true },\n        { key: 'hour', type: 'select', label: 'ช่วงเวลา', options: hourOptions(), value: String(schedule.enabled ? schedule.hour : 18), span2: true },\n      ],\n      onReady: function (f) {\n        var sync = function () { f.hour.input.disabled = !f.enabled.get(); };\n        f.enabled.input.addEventListener('change', sync);\n        sync();\n      },\n      onSubmit: function (v) { return App.api('backups.setSchedule', { enabled: v.enabled, hour: Number(v.hour) }); },\n      onDone: function (res) { App.toast(res.message, 'success'); App.refresh(); },\n    });\n  }\n\n  function openRestore(b, confirmText) {\n    var modal = App.modal({ title: 'กู้คืนข้อมูลจากไฟล์สำรอง', size: 'lg', body: h('p', { class: 'muted', text: 'กำลังตรวจไฟล์สำรอง…' }) });\n    App.api('backups.restorePreview', { fileId: b.fileId }).then(function (p) {\n      var body = modal.body;\n      clear(body);\n      body.appendChild(h('table', { class: 'kv' }, h('tbody', null,\n        h('tr', null, h('th', { text: 'ไฟล์' }), h('td', { class: 'strong', text: p.backup.name })),\n        h('tr', null, h('th', { text: 'ข้อมูล ณ' }), h('td', { text: App.fmt.datetime(p.backup.createdAt) })),\n        h('tr', null, h('th', { text: 'ประเภท' }), h('td', { text: p.backup.kindLabel + (p.backup.createdBy ? ' โดย ' + p.backup.createdBy : '') })))));\n      p.problems.forEach(function (x) { body.appendChild(h('div', { class: 'alert alert-error', text: x })); });\n      p.warnings.forEach(function (x) { body.appendChild(h('div', { class: 'alert alert-warning', text: x })); });\n      (p.extraColumns || []).forEach(function (x) {\n        body.appendChild(h('div', { class: 'alert alert-warning', text: 'ชีต \"' + x.label + '\" มีคอลัมน์ที่ระบบไม่ได้ใช้ (' + x.columns.join(', ') + ') ข้อมูลในคอลัมน์นี้จะถูกล้างเมื่อกู้คืน ถ้าต้องการเก็บไว้ ให้คัดลอกออกก่อน' }));\n      });\n      if (!p.valid) {\n        body.appendChild(h('p', { class: 'strong', text: 'ไฟล์นี้ใช้กู้คืนไม่ได้ ข้อมูลในระบบไม่ถูกเปลี่ยนแปลง' }));\n        return;\n      }\n      body.appendChild(h('h3', { style: { margin: '14px 0 6px' }, text: 'ผลกระทบของการกู้คืน' }));\n      body.appendChild(h('div', { class: 'alert ' + (p.since.total ? 'alert-error' : 'alert-info') },\n        h('div', { class: 'strong', text: p.since.total\n          ? 'ข้อมูลที่บันทึกหลังเวลาสำรอง ' + p.since.total + ' รายการจะไม่อยู่ในระบบหลังกู้คืน'\n          : 'ไม่พบการบันทึกข้อมูลหลังเวลาสำรอง' }),\n        p.since.items.length ? h('div', { text: p.since.items.map(function (i) { return i.label + ' ' + i.count; }).join(' · ') }) : null,\n        h('div', { text: 'ถ้ามีการรับเงินหลังเวลาสำรอง เจ้าหน้าที่การเงินต้องบันทึกใหม่ตามสำเนาใบเสร็จ (รายการเดิมยังดูได้ในไฟล์ \"ก่อนกู้คืน\" และประวัติการใช้งาน)' })));\n      body.appendChild(App.table({\n        rows: p.sheets,\n        columns: [\n          { label: 'ข้อมูล', key: 'label' },\n          { label: 'ในไฟล์สำรอง', className: 'num', render: function (x) { return String(x.backupRows); } },\n          { label: 'ในระบบตอนนี้', className: 'num', render: function (x) { return String(x.currentRows); } },\n        ],\n      }));\n      body.appendChild(h('ul', { class: 'small', style: { margin: '10px 0' } },\n        h('li', { text: 'ระบบจะสำรองข้อมูลปัจจุบันเป็นไฟล์ \"ก่อนกู้คืน\" ก่อนเสมอ จึงย้อนการกู้คืนได้' }),\n        h('li', { text: 'ไม่กู้คืน: ' + p.excludedSheets.map(function (x) { return x.label; }).join(' และ ') + ' (บัญชีและรหัสผ่านปัจจุบันใช้ต่อได้ ประวัติการใช้งานไม่ย้อนกลับ)' }),\n        h('li', { text: 'หลังกู้คืน ทุกคนรวมถึงคุณต้องเข้าสู่ระบบใหม่' })));\n      var confirmField = App.field({ label: 'พิมพ์คำว่า \"' + p.confirmText + '\" เพื่อยืนยัน', autocomplete: 'off' });\n      var errorBox = h('div', { class: 'alert alert-error hidden', role: 'alert' });\n      body.appendChild(confirmField.wrap);\n      body.appendChild(errorBox);\n      var go = h('button', { type: 'button', class: 'btn btn-danger', text: 'กู้คืนข้อมูล', disabled: true });\n      confirmField.input.addEventListener('input', function () { go.disabled = confirmField.get().trim() !== p.confirmText; });\n      go.addEventListener('click', function () {\n        errorBox.classList.add('hidden');\n        var done = busyButton(go, 'กำลังกู้คืน… (อาจใช้เวลา 1–2 นาที)');\n        App.api('backups.restore', { fileId: b.fileId, confirmText: confirmField.get().trim() }).then(function (res) {\n          modal.close();\n          App.modal({\n            title: 'กู้คืนข้อมูลเรียบร้อย',\n            body: [h('div', { class: 'alert alert-success', text: res.message }),\n              h('p', { text: 'กรุณาแจ้งผู้ใช้ทุกคนให้เข้าสู่ระบบใหม่ และให้เจ้าหน้าที่การเงินตรวจรายการรับเงินหลังเวลา ' + App.fmt.datetime(res.backupCreatedAt) + ' กับสำเนาใบเสร็จ' })],\n            actions: [{ label: 'เข้าสู่ระบบใหม่' }],\n            onClose: function () { App.logout(); },\n          });\n        }).catch(function (err) {\n          done();\n          go.disabled = false;\n          errorBox.textContent = (err && err.message) || 'กู้คืนไม่สำเร็จ';\n          errorBox.classList.remove('hidden');\n        });\n      });\n      var cancel = h('button', { type: 'button', class: 'btn btn-secondary', text: 'ยกเลิก' });\n      cancel.addEventListener('click', function () { modal.close(); });\n      modal.foot.classList.remove('hidden');\n      modal.foot.appendChild(cancel);\n      modal.foot.appendChild(go);\n      confirmField.input.focus();\n    }).catch(function (err) {\n      clear(modal.body).appendChild(h('div', { class: 'alert alert-error', text: (err && err.message) || 'ตรวจไฟล์สำรองไม่สำเร็จ' }));\n    });\n  }\n\n  App.defineRoute('backups', {\n    title: 'สำรองและกู้คืนข้อมูล',\n    roles: ['ADMIN'],\n    menu: { group: 'manage', label: 'สำรองและกู้คืนข้อมูล', icon: 'database', order: 110 },\n    render: function () {\n      return App.api('backups.list', {}).then(function (d) {\n        var s = d.schedule;\n        var last = d.last;\n        var auto = d.lastAuto;\n        var alerts = [];\n        if (!s.enabled) alerts.push(h('div', { class: 'alert alert-warning', text: 'ยังไม่ได้เปิดการสำรองข้อมูลอัตโนมัติ แนะนำให้เปิดไว้ (ปุ่ม \"ตั้งเวลาสำรองอัตโนมัติ\")' }));\n        else if (!s.triggerFound) alerts.push(h('div', { class: 'alert alert-error', text: 'ไม่พบตัวตั้งเวลาสำรองอัตโนมัติใน Apps Script (อาจถูกลบ) กรุณากด \"ตั้งเวลาสำรองอัตโนมัติ\" แล้วบันทึกอีกครั้ง' }));\n        if (auto && !auto.ok) alerts.push(h('div', { class: 'alert alert-error', text: 'การสำรองอัตโนมัติครั้งล่าสุด (' + App.fmt.datetime(auto.at) + ') ไม่สำเร็จ: ' + (auto.message || '') }));\n        var backupBtn = button('สำรองข้อมูลตอนนี้', '', function () { backupNow(backupBtn); }, 'database');\n        var actions = [backupBtn, button('ตั้งเวลาสำรองอัตโนมัติ', 'secondary', function () { openSchedule(s); }, 'calendar')];\n        var table = App.table({\n          rows: d.backups,\n          columns: [\n            { label: 'ไฟล์สำรอง', render: function (b) { return [h('div', { class: 'strong', text: b.name }), h('div', { class: 'muted small', text: 'ข้อมูล ณ ' + App.fmt.datetime(b.createdAt) })]; } },\n            { label: 'ประเภท', render: function (b) { return App.badge(b.kindLabel, KIND_BADGE[b.kind]); } },\n            { label: 'ผู้สั่ง', render: function (b) { return b.createdBy || (b.kind === 'AUTO' ? 'ระบบ' : '–'); } },\n            { label: 'จำนวนแถว', className: 'num', render: function (b) { return b.rows === null ? '–' : String(b.rows); } },\n            { label: 'จัดการ', className: 'actions', render: function (b) { return button('กู้คืน…', 'ghost btn-sm', function () { openRestore(b, d.confirmText); }, 'refresh'); } },\n          ],\n          empty: 'ยังไม่มีไฟล์สำรอง กด \"สำรองข้อมูลตอนนี้\" เพื่อสร้างไฟล์แรก',\n        });\n        return h('div', null,\n          App.pageHead('สำรองและกู้คืนข้อมูล', 'ไฟล์สำรองเก็บใน Google Drive ของบัญชีเจ้าของระบบ' + (d.folder ? ' (โฟลเดอร์ \"' + d.folder.name + '\")' : ' (ระบบสร้างโฟลเดอร์ให้เมื่อสำรองครั้งแรก)') + ' ห้ามแชร์โฟลเดอร์นี้ให้ผู้อื่น', actions),\n          alerts.length ? h('div', { class: 'stack', style: { marginBottom: '14px' } }, alerts) : null,\n          h('div', { class: 'grid-cards' },\n            App.statCard('สำรองล่าสุด', last ? App.fmt.datetime(last.createdAt) : 'ยังไม่เคยสำรอง', last ? last.name : 'กดสำรองข้อมูลตอนนี้', last ? 'success' : 'danger'),\n            App.statCard('สำรองอัตโนมัติ', s.enabled ? 'ทุกวัน' : 'ปิดอยู่', s.enabled ? 'เวลาประมาณ ' + s.hourLabel : 'แนะนำให้เปิด', s.enabled && s.triggerFound ? 'success' : 'danger'),\n            App.statCard('ผลสำรองอัตโนมัติล่าสุด', auto ? (auto.ok ? 'สำเร็จ' : 'ไม่สำเร็จ') : 'ยังไม่มี', auto ? App.fmt.datetime(auto.at) : 'รอรอบเวลาที่ตั้งไว้', auto ? (auto.ok ? 'success' : 'danger') : ''),\n            App.statCard('ไฟล์ในโฟลเดอร์', d.backups.length + ' ไฟล์', 'เก็บไฟล์อัตโนมัติ ' + d.retention + ' ไฟล์ล่าสุด + ไฟล์แรกของทุกเดือน')),\n          h('div', { class: 'card', style: { marginTop: '14px' } },\n            h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: 'ไฟล์สำรอง (ล่าสุดก่อน)' }),\n              d.folder ? h('a', { class: 'btn btn-ghost btn-sm', href: d.folder.url, target: '_blank', rel: 'noopener', text: 'เปิดโฟลเดอร์ใน Google Drive' }) : null),\n            h('div', { class: 'card-body' },\n              h('p', { class: 'muted small', style: { marginTop: '0' }, text: 'ลิงก์โฟลเดอร์เปิดได้เฉพาะบัญชี Google ของเจ้าของระบบ · แนะนำให้ดาวน์โหลดไฟล์สำรองเก็บแยกไว้เดือนละครั้งตามนโยบายของโรงเรียน' }),\n              table)),\n          h('div', { class: 'card', style: { marginTop: '14px' } },\n            h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: 'ขั้นตอนกู้คืนข้อมูล' })),\n            h('div', { class: 'card-body' }, h('ol', { style: { margin: '0', paddingLeft: '20px', lineHeight: '1.8' } },\n              h('li', { text: 'แจ้งผู้ใช้ทุกคนให้หยุดบันทึกข้อมูลก่อน' }),\n              h('li', { text: 'เลือกไฟล์สำรองที่ต้องการ แล้วกด \"กู้คืน…\" ระบบจะตรวจไฟล์และแสดงผลกระทบ' }),\n              h('li', { text: 'พิมพ์คำว่า \"' + d.confirmText + '\" แล้วกดกู้คืน ระบบสำรองข้อมูลปัจจุบันเป็นไฟล์ \"ก่อนกู้คืน\" ให้อัตโนมัติ' }),\n              h('li', { text: 'เข้าสู่ระบบใหม่ แล้วให้เจ้าหน้าที่การเงินบันทึกรายการรับเงินที่เกิดหลังเวลาสำรองใหม่ตามสำเนาใบเสร็จ' }),\n              h('li', { text: 'ถ้ากู้คืนผิดไฟล์ ให้กู้คืนจากไฟล์ \"ก่อนกู้คืน\" ล่าสุดเพื่อย้อนกลับ' })))));\n      });\n    },\n  });\n})();\n</script>\n",
  "JsCore": "<script>\n/* ==========================================================================\n   JsCore — แกนของหน้าเว็บ: เรียก API, สร้างหน้าจอ, หน้าต่าง, ฟอร์ม, ตาราง, เมนู\n   กฎสำคัญ: แสดงข้อมูลผ่าน textContent เสมอ (ฟังก์ชัน h) ไม่ใช้ innerHTML กับข้อมูล\n   หน้าเว็บนี้ไม่ใช่ที่ตรวจสิทธิ์ การซ่อนเมนูเป็นเพียงความสะดวก Server ตรวจสิทธิ์ทุกคำขอ\n   ========================================================================== */\n(function () {\n  'use strict';\n\n  var App = window.App = {};\n  App.state = { token: null, me: null, route: null, renderSeq: 0 };\n  App.ROLE_LABELS = { ADMIN: 'ผู้ดูแลระบบ', FINANCE: 'เจ้าหน้าที่การเงิน', DIRECTOR: 'ผู้อำนวยการ' };\n  App.routes = {};\n  App.routeOrder = [];\n  App.MENU_GROUPS = [];\n\n  // ---------------------------------------------------------------------------\n  // สร้าง element (ข้อความทุกชิ้นใส่ผ่าน textContent)\n  // ---------------------------------------------------------------------------\n  function append(el, child) {\n    if (child === null || child === undefined || child === false) return;\n    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }\n    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));\n  }\n\n  function h(tag, props) {\n    var el = document.createElement(tag);\n    if (props) {\n      Object.keys(props).forEach(function (key) {\n        var v = props[key];\n        if (v === null || v === undefined || v === false) return;\n        if (key === 'class') el.className = v;\n        else if (key === 'text') el.textContent = v;\n        else if (key === 'style') Object.assign(el.style, v);\n        else if (key === 'value') el.value = v;\n        else if (key === 'checked') el.checked = !!v;\n        else if (key === 'disabled') el.disabled = !!v;\n        else if (key.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(key.slice(2).toLowerCase(), v);\n        else if (v === true) el.setAttribute(key, '');\n        else el.setAttribute(key, String(v));\n      });\n    }\n    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);\n    return el;\n  }\n\n  function clear(el) {\n    while (el.firstChild) el.removeChild(el.firstChild);\n    return el;\n  }\n\n  App.h = h;\n  App.append = append;\n  App.clear = clear;\n\n  var ICONS = {\n    school: 'M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6M12 5V2l3 1.5-3 1.5',\n    home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',\n    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',\n    settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',\n    calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',\n    history: 'M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8M12 7v5l4 2',\n    menu: 'M3 6h18M3 12h18M3 18h18',\n    x: 'M18 6L6 18M6 6l12 12',\n    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',\n    key: 'M15 7a2 2 0 0 1 2 2M21 9a6 6 0 0 1-7.74 5.74L11 17H9v2H7v2H4a1 1 0 0 1-1-1v-2.59a1 1 0 0 1 .29-.7l6-6A6 6 0 1 1 21 9z',\n    plus: 'M12 5v14M5 12h14',\n    edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',\n    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',\n    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',\n    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',\n    student: 'M22 10L12 5 2 10l10 5 10-5zM6 12v5c3 3 9 3 12 0v-5',\n    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',\n    arrowUp: 'M12 19V5M5 12l7-7 7 7',\n    flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',\n    cash: 'M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 12h.01M18 12h.01',\n    tag: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01',\n    book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2zM9 7h7M9 11h5',\n    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',\n    checkSquare: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',\n    check: 'M20 6L9 17l-5-5',\n    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',\n    play: 'M5 3l14 9-14 9V3z',\n    arrowLeft: 'M19 12H5M12 19l-7-7 7-7',\n    alertCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01',\n    printer: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',\n    chart: 'M3 3v18h18M7 16v-5M12 16V8M17 16v-8',\n    database: 'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4 3 9 3s9-1.34 9-3',\n    refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',\n  };\n\n  App.icon = function (name) {\n    var ns = 'http://www.w3.org/2000/svg';\n    var svg = document.createElementNS(ns, 'svg');\n    svg.setAttribute('viewBox', '0 0 24 24');\n    svg.setAttribute('fill', 'none');\n    svg.setAttribute('stroke', 'currentColor');\n    svg.setAttribute('stroke-width', '2');\n    svg.setAttribute('stroke-linecap', 'round');\n    svg.setAttribute('stroke-linejoin', 'round');\n    svg.setAttribute('aria-hidden', 'true');\n    var path = document.createElementNS(ns, 'path');\n    path.setAttribute('d', ICONS[name] || '');\n    svg.appendChild(path);\n    return svg;\n  };\n\n  // ---------------------------------------------------------------------------\n  // จัดรูปแบบ\n  // ---------------------------------------------------------------------------\n  App.fmt = {\n    date: function (v) { return v ? formatThaiDate_(v, 'short') : '–'; },\n    dateLong: function (v) { return v ? formatThaiDate_(v) : '–'; },\n    datetime: function (v) { return v ? formatThaiDateTime_(v, 'short') : '–'; },\n    money: function (satang) { return formatSatang_(satang, true); },\n  };\n\n  App.badge = function (text, kind) {\n    return h('span', { class: 'badge' + (kind ? ' badge-' + kind : ''), text: text });\n  };\n\n  App.roleBadge = function (role) {\n    return App.badge(App.ROLE_LABELS[role] || role, role);\n  };\n\n  /** สีป้ายสถานะการเงิน */\n  App.KIND = {\n    PAY_STATE: { UNPAID: 'danger', PARTIAL: 'warning', PAID: 'success', EXEMPT: 'FINANCE', CANCELLED: 'muted' },\n    DECISION: { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', WITHDRAWN: 'muted' },\n    BOOK: { ACTIVE: 'success', REGISTERED: 'FINANCE', FULL: 'muted', CLOSED: 'muted' },\n    ACTIVE: { ACTIVE: 'success', INACTIVE: 'muted', REVOKED: 'muted', VOIDED: 'danger', REPLACED: 'muted' },\n  };\n\n  /** ปุ่ม: kind = '' (หลัก) / secondary / danger / ghost และต่อท้าย btn-sm ได้ */\n  App.button = function (label, kind, onClick, iconName) {\n    var btn = h('button', { type: 'button', class: 'btn' + (kind ? ' btn-' + kind : '') }, iconName ? App.icon(iconName) : null, label);\n    btn.addEventListener('click', onClick);\n    return btn;\n  };\n\n  /** หัวหน้า: ชื่อ คำอธิบาย และปุ่มด้านขวา */\n  App.pageHead = function (title, description, actions) {\n    return h('div', { class: 'page-head' },\n      h('div', null, h('h1', { text: title }), description ? h('p', { text: description }) : null),\n      actions && actions.length ? h('div', { class: 'toolbar', style: { marginBottom: '0' } }, actions) : null);\n  };\n\n  /** การ์ดตัวเลขสรุป */\n  App.statCard = function (label, value, sub, kind) {\n    return h('div', { class: 'card stat' + (kind ? ' stat-' + kind : '') },\n      h('div', { class: 'stat-label', text: label }),\n      h('div', { class: 'stat-value', text: value }),\n      sub ? h('div', { class: 'stat-sub', text: sub }) : null);\n  };\n\n  /** รหัสคำขอสำหรับกันการบันทึกซ้ำ (สร้างใหม่ทุกครั้งที่เปิดฟอร์ม และใช้ค่าเดิมเมื่อกดบันทึกซ้ำ) */\n  App.newRequestKey = function () {\n    var bytes = new Uint8Array(16);\n    window.crypto.getRandomValues(bytes);\n    return 'req-' + Array.prototype.map.call(bytes, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');\n  };\n\n  // ---------------------------------------------------------------------------\n  // เก็บ token: ปกติเก็บเฉพาะในแท็บนี้ (ปิดแท็บแล้วหาย)\n  // ถ้าผู้ใช้เลือก \"อยู่ในระบบต่อในเครื่องนี้\" เก็บในเครื่อง (ปิดเบราว์เซอร์แล้วยังอยู่ จนครบเวลาที่ Server กำหนด)\n  // ชื่อผู้ใช้ที่ให้จดจำ เก็บแยก (ไม่เก็บรหัสผ่านเด็ดขาด)\n  // ---------------------------------------------------------------------------\n  var TOKEN_KEY = 'wsh-fee-session';\n  var USERNAME_KEY = 'wsh-fee-username';\n  function store(kind) {\n    try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch (e) { return null; }\n  }\n  function storeGet(kind, key) { try { var s = store(kind); return s ? s.getItem(key) : null; } catch (e) { return null; } }\n  function storeSet(kind, key, value) { try { var s = store(kind); if (s) s.setItem(key, value); } catch (e) { /* ใช้ในหน่วยความจำแทน */ } }\n  function storeRemove(kind, key) { try { var s = store(kind); if (s) s.removeItem(key); } catch (e) { /* ไม่มี storage */ } }\n\n  App.session = {\n    get: function () {\n      if (App.state.token) return App.state.token;\n      var t = storeGet('session', TOKEN_KEY);\n      if (t) { App.state.remember = false; } else { t = storeGet('local', TOKEN_KEY); App.state.remember = !!t; }\n      App.state.token = t || null;\n      return App.state.token;\n    },\n    /** remember: true = เก็บในเครื่อง / false = เฉพาะแท็บนี้ / ไม่ระบุ = ใช้แบบเดิม (เช่น ตอนเปลี่ยนรหัสผ่าน) */\n    set: function (token, remember) {\n      if (remember !== undefined) App.state.remember = !!remember;\n      App.state.token = token;\n      storeRemove(App.state.remember ? 'session' : 'local', TOKEN_KEY);\n      storeSet(App.state.remember ? 'local' : 'session', TOKEN_KEY, token);\n    },\n    clear: function () {\n      App.state.token = null;\n      App.state.me = null;\n      App.state.remember = false;\n      storeRemove('session', TOKEN_KEY);\n      storeRemove('local', TOKEN_KEY);\n    },\n    rememberedUsername: function () { return storeGet('local', USERNAME_KEY) || ''; },\n    rememberUsername: function (username, keep) {\n      if (keep && username) storeSet('local', USERNAME_KEY, username);\n      else storeRemove('local', USERNAME_KEY);\n    },\n  };\n\n  // ---------------------------------------------------------------------------\n  // เรียก API (ทางเข้าเดียว: google.script.run.api)\n  // ---------------------------------------------------------------------------\n  var busy = 0;\n  function setBusy(delta) {\n    busy = Math.max(0, busy + delta);\n    document.body.classList.toggle('is-busy', busy > 0);\n  }\n\n  App.api = function (action, payload) {\n    setBusy(1);\n    return new Promise(function (resolve, reject) {\n      google.script.run\n        .withSuccessHandler(function (res) {\n          setBusy(-1);\n          if (res && res.ok) resolve(res.data);\n          else reject(res && res.error ? res.error : { code: 'INTERNAL', message: 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่' });\n        })\n        .withFailureHandler(function () {\n          setBusy(-1);\n          reject({ code: 'NETWORK', message: 'เชื่อมต่อระบบไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' });\n        })\n        .api({ action: action, token: App.session.get(), payload: payload || {} });\n    }).catch(function (err) {\n      if (App.state.me && err.code === 'UNAUTHENTICATED') {\n        err.handled = true;\n        App.session.clear();\n        App.showLogin(err.message);\n      } else if (App.state.me && err.reason === 'PASSWORD_CHANGE_REQUIRED') {\n        err.handled = true;\n        App.showForcedPasswordChange();\n      }\n      throw err;\n    });\n  };\n\n  /** แสดงข้อผิดพลาด (ข้ามถ้าระบบจัดการแล้ว เช่น หมดเวลาและพากลับหน้าเข้าสู่ระบบ) */\n  App.fail = function (err) {\n    if (err && err.handled) return;\n    App.toast((err && err.message) || 'เกิดข้อผิดพลาด กรุณาลองใหม่', 'error');\n  };\n\n  // ---------------------------------------------------------------------------\n  // แจ้งเตือน / หน้าต่าง / ยืนยัน\n  // ---------------------------------------------------------------------------\n  /** ข้อความแจ้งเตือนมุมจอ: แสดงพร้อมกันไม่เกิน 3 ข้อความ คลิกเพื่อปิดได้ */\n  App.toast = function (message, type) {\n    var root = document.getElementById('toast-root');\n    var el = h('div', { class: 'toast' + (type ? ' toast-' + type : ''), text: message, title: 'คลิกเพื่อปิด' });\n    var remove = function () { if (el.parentNode) el.parentNode.removeChild(el); };\n    el.addEventListener('click', remove);\n    while (root.children.length >= 3) root.removeChild(root.firstChild);\n    root.appendChild(el);\n    setTimeout(remove, type === 'error' ? 6500 : 4000);\n  };\n\n  /** เลื่อนหน้าไปยังส่วนที่ต้องการ (ไม่ใช้ภาพเคลื่อนไหวถ้าผู้ใช้ตั้งค่าลดการเคลื่อนไหวไว้) */\n  App.scrollToEl = function (el) {\n    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;\n    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });\n  };\n\n  /** ล้างข้อความแจ้งเตือนและหน้าต่างที่ค้างอยู่ (ใช้เมื่อเปลี่ยนผู้ใช้ ไม่ให้ผู้ใช้คนถัดไปเห็นข้อความของคนก่อน) */\n  App.clearOverlays = function () {\n    clear(document.getElementById('toast-root'));\n    clear(document.getElementById('modal-root'));\n  };\n\n  App.modal = function (opts) {\n    var root = document.getElementById('modal-root');\n    var previousFocus = document.activeElement;\n    var closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'ปิด' }, App.icon('x'));\n    var body = h('div', { class: 'modal-body' });\n    append(body, opts.body);\n    var foot = h('div', { class: 'modal-foot' });\n    var dialog = h('div', { class: 'modal' + (opts.size === 'lg' ? ' modal-lg' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },\n      h('div', { class: 'modal-head' }, h('h2', { text: opts.title }), closeBtn), body, foot);\n    var overlay = h('div', { class: 'modal-overlay' }, dialog);\n    var closed = false;\n    function close() {\n      if (closed) return;\n      closed = true;\n      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);\n      document.removeEventListener('keydown', onKey);\n      if (previousFocus && previousFocus.focus) { try { previousFocus.focus(); } catch (e) { /* ไม่มีแล้ว */ } }\n      if (opts.onClose) opts.onClose();\n    }\n    function onKey(e) { if (e.key === 'Escape') close(); }\n    closeBtn.addEventListener('click', close);\n    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });\n    var buttons = (opts.actions || []).map(function (a) {\n      var btn = h('button', { type: 'button', class: 'btn' + (a.kind ? ' btn-' + a.kind : ''), text: a.label });\n      btn.addEventListener('click', function () { if (a.onClick) a.onClick(btn, close); else close(); });\n      foot.appendChild(btn);\n      return btn;\n    });\n    if (!buttons.length) foot.classList.add('hidden');\n    document.addEventListener('keydown', onKey);\n    root.appendChild(overlay);\n    var first = dialog.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');\n    if (first) first.focus(); else closeBtn.focus();\n    return { close: close, body: body, foot: foot, dialog: dialog, buttons: buttons };\n  };\n\n  App.confirm = function (message, opts) {\n    var o = opts || {};\n    return new Promise(function (resolve) {\n      var answered = false;\n      App.modal({\n        title: o.title || 'ยืนยันการทำรายการ',\n        body: h('p', { text: message }),\n        actions: [\n          { label: 'ยกเลิก', kind: 'secondary', onClick: function (b, close) { answered = true; close(); resolve(false); } },\n          { label: o.confirmLabel || 'ยืนยัน', kind: o.danger ? 'danger' : '', onClick: function (b, close) { answered = true; close(); resolve(true); } },\n        ],\n        onClose: function () { if (!answered) resolve(false); },\n      });\n    });\n  };\n\n  // ---------------------------------------------------------------------------\n  // ฟอร์ม\n  // ---------------------------------------------------------------------------\n  var fieldSeq = 0;\n\n  /** ช่องกรอกข้อมูล คืนค่า { wrap, input, get } */\n  App.field = function (o) {\n    var id = 'f' + (++fieldSeq);\n    var input;\n    if (o.type === 'checkgroup') {\n      // เลือกได้หลายค่า: get() คืนค่ารายการที่ติ๊ก\n      var boxes = (o.options || []).map(function (opt) {\n        var cb = h('input', { type: 'checkbox', value: opt.value, checked: (o.value || []).indexOf(opt.value) !== -1, disabled: o.disabled });\n        return { cb: cb, label: h('label', null, cb, h('span', { text: opt.label })) };\n      });\n      var group = h('div', { class: 'check-grid', role: 'group', 'aria-labelledby': id + '-label' }, boxes.map(function (b) { return b.label; }));\n      var wrapG = h('div', { class: 'field' + (o.span2 ? ' span-2' : '') },\n        h('div', { class: 'field-label', id: id + '-label' }, o.label, o.required ? h('span', { class: 'req', text: ' *', 'aria-hidden': 'true' }) : null),\n        group, o.help ? h('div', { class: 'help', text: o.help }) : null);\n      return {\n        wrap: wrapG,\n        input: boxes.length ? boxes[0].cb : group,\n        boxes: boxes.map(function (b) { return b.cb; }),\n        get: function () { return boxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.cb.value; }); },\n      };\n    }\n    if (o.type === 'checkbox') {\n      input = h('input', { id: id, type: 'checkbox', checked: !!o.value, disabled: o.disabled });\n      var wrapC = h('div', { class: 'field' + (o.span2 ? ' span-2' : '') },\n        h('label', { class: 'switch', for: id }, input, h('span', { text: o.label })),\n        o.help ? h('div', { class: 'help', text: o.help }) : null);\n      return { wrap: wrapC, input: input, get: function () { return input.checked; } };\n    }\n    if (o.type === 'select') {\n      input = h('select', { id: id, class: 'input', disabled: o.disabled });\n      (o.options || []).forEach(function (opt) { input.appendChild(h('option', { value: opt.value, text: opt.label })); });\n      if (o.value !== undefined && o.value !== null) input.value = String(o.value);\n    } else if (o.type === 'textarea') {\n      input = h('textarea', { id: id, class: 'input', rows: o.rows || 3, maxlength: o.maxlength, disabled: o.disabled });\n      input.value = o.value === undefined || o.value === null ? '' : String(o.value);\n    } else {\n      input = h('input', {\n        id: id, class: 'input', type: o.type || 'text', maxlength: o.maxlength, min: o.min, max: o.max,\n        placeholder: o.placeholder, autocomplete: o.autocomplete || 'off', inputmode: o.inputmode, disabled: o.disabled,\n        spellcheck: o.type === 'password' || o.mono ? 'false' : null, autocapitalize: o.autocapitalize,\n      });\n      if (o.value !== undefined && o.value !== null) input.value = String(o.value);\n    }\n    if (o.required) input.setAttribute('aria-required', 'true');\n    var label = h('label', { for: id }, o.label, o.required ? h('span', { class: 'req', text: ' *', 'aria-hidden': 'true' }) : null);\n    var preview = null;\n    if (o.type === 'date') {\n      preview = h('div', { class: 'preview' });\n      var update = function () { preview.textContent = input.value ? '= ' + formatThaiDate_(input.value) : ''; };\n      input.addEventListener('input', update);\n      input.addEventListener('change', update);\n      update();\n    }\n    var wrap = h('div', { class: 'field' + (o.span2 ? ' span-2' : '') }, label, input, preview,\n      o.help ? h('div', { class: 'help', text: o.help }) : null);\n    return { wrap: wrap, input: input, get: function () { return input.value; } };\n  };\n\n  /** ช่องรหัสผ่าน พร้อมปุ่มแสดง/ซ่อน */\n  App.passwordField = function (o) {\n    var f = App.field(Object.assign({}, o, { type: 'password' }));\n    var toggle = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'แสดง', 'aria-label': 'แสดงหรือซ่อนรหัสผ่าน' });\n    toggle.addEventListener('click', function () {\n      var show = f.input.type === 'password';\n      f.input.type = show ? 'text' : 'password';\n      toggle.textContent = show ? 'ซ่อน' : 'แสดง';\n    });\n    var group = h('div', { class: 'input-group' });\n    f.input.parentNode.replaceChild(group, f.input);\n    group.appendChild(f.input);\n    group.appendChild(toggle);\n    return f;\n  };\n\n  /**\n   * หน้าต่างฟอร์ม\n   * opts: { title, intro, fields: [{ key, label, type, ... }], submitLabel, onSubmit(values) → Promise, onDone(result) }\n   */\n  App.formModal = function (opts) {\n    var errorBox = h('div', { class: 'alert alert-error hidden', role: 'alert' });\n    var form = h('form', { class: 'form-grid', novalidate: true });\n    var built = opts.fields.map(function (f) {\n      var b = f.type === 'password' ? App.passwordField(f) : App.field(f);\n      b.key = f.key;\n      form.appendChild(b.wrap);\n      return b;\n    });\n    form.appendChild(h('button', { type: 'submit', class: 'hidden', tabindex: '-1', 'aria-hidden': 'true' }));\n    var intro = opts.intro ? (opts.intro instanceof Node ? opts.intro : h('div', { class: 'alert alert-info', text: opts.intro })) : null;\n    var submitting = false;\n    var modal;\n    function submit() {\n      if (submitting) return;\n      var values = {};\n      built.forEach(function (b) { values[b.key] = b.get(); });\n      // ช่องที่จำเป็นต้องกรอก: เตือนทันทีโดยไม่ต้องรอ Server (Server ยังตรวจซ้ำทุกครั้ง)\n      for (var i = 0; i < opts.fields.length; i++) {\n        var spec = opts.fields[i];\n        var v = values[spec.key];\n        if (spec.required && spec.type !== 'checkbox' && !built[i].input.disabled && (v === null || v === undefined || String(v).trim() === '')) {\n          errorBox.textContent = (spec.type === 'select' || spec.type === 'checkgroup' ? 'กรุณาเลือก' : 'กรุณากรอก') + spec.label;\n          errorBox.classList.remove('hidden');\n          built[i].input.focus();\n          return;\n        }\n      }\n      var btn = modal.buttons[modal.buttons.length - 1];\n      var label = btn.textContent;\n      submitting = true;\n      btn.disabled = true;\n      btn.textContent = 'กำลังบันทึก…';\n      errorBox.classList.add('hidden');\n      Promise.resolve()\n        .then(function () { return opts.onSubmit(values); })\n        .then(function (result) {\n          modal.close();\n          if (opts.onDone) opts.onDone(result);\n        })\n        .catch(function (err) {\n          if (err && err.handled) { modal.close(); return; }\n          errorBox.textContent = (err && err.message) || 'บันทึกไม่สำเร็จ กรุณาลองใหม่';\n          errorBox.classList.remove('hidden');\n          errorBox.scrollIntoView({ block: 'nearest' });\n        })\n        .then(function () {\n          submitting = false;\n          btn.disabled = false;\n          btn.textContent = label;\n        });\n    }\n    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });\n    modal = App.modal({\n      title: opts.title,\n      size: opts.size,\n      body: [intro, errorBox, form],\n      actions: [\n        { label: 'ยกเลิก', kind: 'secondary' },\n        { label: opts.submitLabel || 'บันทึก', kind: opts.submitKind, onClick: function () { submit(); } },\n      ],\n    });\n    // ให้ฟอร์มปรับช่องตามค่าที่เลือกได้ เช่น ยกเว้นทั้งจำนวน = ปิดช่องจำนวนเงิน\n    if (opts.onReady) {\n      var byKey = {};\n      built.forEach(function (b) { byKey[b.key] = b; });\n      opts.onReady(byKey, modal);\n    }\n    return modal;\n  };\n\n  // ---------------------------------------------------------------------------\n  // ตาราง (บนมือถือแสดงเป็นการ์ด ใช้ data-label เป็นหัวข้อ)\n  // ---------------------------------------------------------------------------\n  App.table = function (opts) {\n    var wrap = h('div', { class: 'table-wrap' });\n    if (!opts.rows.length) {\n      wrap.appendChild(h('div', { class: 'empty', text: opts.empty || 'ไม่มีข้อมูล' }));\n      return wrap;\n    }\n    var thead = h('thead', null, h('tr', null, opts.columns.map(function (c) { return h('th', { class: c.className, text: c.label }); })));\n    var tbody = h('tbody');\n    opts.rows.forEach(function (row) {\n      var tr = h('tr', { class: opts.onRowClick ? 'clickable' : null });\n      if (opts.onRowClick) {\n        tr.tabIndex = 0;\n        tr.addEventListener('click', function (e) { if (!e.target.closest('button')) opts.onRowClick(row); });\n        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') opts.onRowClick(row); });\n      }\n      opts.columns.forEach(function (c) {\n        var content = c.render ? c.render(row) : row[c.key];\n        // หลายบรรทัดในช่องเดียว: รวมเป็นก้อนเดียว (บนมือถือจะไม่ถูกแยกเป็นหลายคอลัมน์)\n        if (Array.isArray(content) && !/\\bactions\\b/.test(c.className || '')) {\n          content = content.filter(function (x) { return x !== null && x !== undefined && x !== false && x !== ''; });\n          content = content.length ? h('div', { class: 'cell-stack' }, content) : '';\n        }\n        var td = h('td', { class: c.className, 'data-label': c.label });\n        append(td, content === null || content === undefined || content === '' ? '–' : content);\n        tr.appendChild(td);\n      });\n      tbody.appendChild(tr);\n    });\n    wrap.appendChild(h('table', { class: 'data-table' }, thead, tbody));\n    return wrap;\n  };\n\n  // ---------------------------------------------------------------------------\n  // เมนูและการเปลี่ยนหน้า\n  // ---------------------------------------------------------------------------\n  App.defineRoute = function (name, def) {\n    App.routes[name] = def;\n    App.routeOrder.push(name);\n  };\n\n  App.canAccess = function (name) {\n    var route = App.routes[name];\n    return !!(route && App.state.me && route.roles.indexOf(App.state.me.user.role) !== -1);\n  };\n\n  function closeNav() {\n    var shell = document.getElementById('shell');\n    if (shell) shell.classList.remove('nav-open');\n  }\n\n  App.renderShell = function () {\n    var me = App.state.me;\n    var app = clear(document.getElementById('app'));\n    var nav = h('nav', { class: 'nav', 'aria-label': 'เมนูหลัก' });\n    App.MENU_GROUPS.forEach(function (group) {\n      var items = App.routeOrder.filter(function (name) {\n        var r = App.routes[name];\n        return r.menu && r.menu.group === group.key && App.canAccess(name);\n      }).map(function (name, i) { return { name: name, i: i, order: App.routes[name].menu.order || 100 }; })\n        .sort(function (a, b) { return a.order - b.order || a.i - b.i; })\n        .map(function (x) { return x.name; });\n      if (!items.length) return;\n      nav.appendChild(h('div', { class: 'nav-group' },\n        h('div', { class: 'nav-group-label', text: group.label }),\n        items.map(function (name) {\n          var r = App.routes[name];\n          var btn = h('button', { type: 'button', class: 'nav-item', 'data-route': name }, App.icon(r.menu.icon), h('span', { text: r.menu.label }));\n          btn.addEventListener('click', function () { App.go(name); });\n          return btn;\n        })));\n    });\n\n    var userActions = h('div', { class: 'userbox-actions' });\n    if (me.authMode === 'PASSWORD') {\n      var pwBtn = h('button', { type: 'button', class: 'btn btn-sm' }, App.icon('key'), 'เปลี่ยนรหัสผ่าน');\n      pwBtn.addEventListener('click', function () { App.openChangePassword(); });\n      userActions.appendChild(pwBtn);\n    }\n    var outBtn = h('button', { type: 'button', class: 'btn btn-sm' }, App.icon('logout'), 'ออกจากระบบ');\n    outBtn.addEventListener('click', function () { App.logout(); });\n    userActions.appendChild(outBtn);\n\n    var sidebar = h('aside', { class: 'sidebar', id: 'sidebar' },\n      h('div', { class: 'brand' },\n        h('div', { class: 'brand-logo' }, App.icon('school')),\n        h('div', null, h('div', { class: 'brand-name', text: me.school.name }), h('div', { class: 'brand-sub', text: 'ระบบเงินบำรุงการศึกษา' }))),\n      nav,\n      h('div', { class: 'userbox' },\n        h('div', { class: 'userbox-name', text: me.user.displayName }),\n        h('div', { class: 'userbox-role', text: me.user.roleLabel + ' · ' + me.user.username }),\n        userActions));\n\n    var toggle = h('button', { type: 'button', class: 'icon-btn menu-toggle', 'aria-label': 'เปิดเมนู', 'aria-controls': 'sidebar' }, App.icon('menu'));\n    toggle.addEventListener('click', function () { document.getElementById('shell').classList.toggle('nav-open'); });\n    var topbar = h('header', { class: 'topbar' },\n      toggle,\n      h('div', { class: 'topbar-title', id: 'page-title' }),\n      h('span', { class: 'year-chip', title: 'ปีการศึกษาปัจจุบัน' }, App.icon('calendar'), h('span', { class: 'chip-label', text: 'ปีการศึกษา ' }), String(me.school.currentAcademicYear)));\n\n    var backdrop = h('div', { class: 'backdrop' });\n    backdrop.addEventListener('click', closeNav);\n    app.appendChild(h('div', { class: 'shell', id: 'shell' }, sidebar, backdrop,\n      h('div', { class: 'main' }, topbar, h('main', { class: 'content', id: 'content', tabindex: '-1' }))));\n  };\n\n  App.go = function (name, params) {\n    if (!App.routes[name]) name = 'home';\n    if (!document.getElementById('shell')) App.renderShell();\n    App.state.route = name;\n    App.state.params = params || {};\n    var route = App.routes[name];\n    document.getElementById('page-title').textContent = route.title;\n    document.title = route.title + ' · ' + BOOT.appName;\n    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (el) {\n      el.classList.toggle('active', el.getAttribute('data-route') === name);\n    });\n    closeNav();\n    var content = clear(document.getElementById('content'));\n    if (!App.canAccess(name)) {\n      content.appendChild(h('div', { class: 'card card-body' }, h('h2', { text: 'ไม่มีสิทธิ์เข้าถึงหน้านี้' }),\n        h('p', { class: 'muted', text: 'หากต้องการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' })));\n      return;\n    }\n    var seq = ++App.state.renderSeq;\n    content.appendChild(h('div', { class: 'empty', text: 'กำลังโหลดข้อมูล…' }));\n    Promise.resolve()\n      .then(function () { return route.render(params || {}); })\n      .then(function (node) {\n        if (seq !== App.state.renderSeq) return;\n        clear(content);\n        append(content, node);\n        window.scrollTo(0, 0);\n      })\n      .catch(function (err) {\n        if (seq !== App.state.renderSeq || (err && err.handled)) return;\n        clear(content).appendChild(h('div', { class: 'alert alert-error', role: 'alert', text: (err && err.message) || 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่' }));\n      });\n  };\n\n  /** โหลดหน้าปัจจุบันใหม่ด้วยพารามิเตอร์เดิม (เช่น หลังบันทึกข้อมูล) */\n  App.refresh = function () { App.go(App.state.route, App.state.params); };\n\n  /** โหลดข้อมูลผู้ใช้ปัจจุบันแล้วเปิดหน้าหลัก (หรือหน้าบังคับเปลี่ยนรหัสผ่าน) */\n  App.loadMe = function (route) {\n    return App.api('auth.me').then(function (me) {\n      App.state.me = me;\n      if (me.mustChangePassword) {\n        App.showForcedPasswordChange();\n        return;\n      }\n      App.renderShell();\n      App.go(route || 'home');\n    });\n  };\n\n  /** โหลดข้อมูลผู้ใช้/โรงเรียนใหม่ (เช่น หลังเปลี่ยนชื่อโรงเรียนหรือปีการศึกษา) แล้วอยู่หน้าเดิม */\n  App.reloadMe = function () {\n    return App.api('auth.me').then(function (me) {\n      App.state.me = me;\n      App.renderShell();\n      App.go(App.state.route || 'home');\n    });\n  };\n\n  App.logout = function () {\n    App.api('auth.logout').catch(function () { /* ออกจากระบบฝั่งหน้าเว็บต่อไป */ }).then(function () {\n      App.session.clear();\n      App.showLogin('ออกจากระบบเรียบร้อยแล้ว', 'info');\n    });\n  };\n\n  App.start = function () {\n    if (!window.google || !google.script || !google.script.run) {\n      clear(document.getElementById('app')).appendChild(h('div', { class: 'boot-screen' },\n        h('p', { text: 'กรุณาเปิดระบบผ่านลิงก์เว็บแอปของโรงเรียน' })));\n      return;\n    }\n    if (App.session.get()) {\n      App.loadMe().catch(function () {\n        App.session.clear();\n        App.showLogin();\n      });\n    } else {\n      App.showLogin();\n    }\n  };\n})();\n</script>\n",
  "JsDashboard": "<script>\n/* ==========================================================================\n   JsDashboard — ภาพรวมการเงินของปีการศึกษา (ระยะที่ 7, ข้อกำหนดข้อ 10)\n   - ตัวเลขทั้งหมดคำนวณที่ Server (dashboard.summary) หน้านี้จัดรูปแบบเท่านั้น\n   - กราฟ 1: แท่งความคืบหน้าการรับชำระ (ชำระแล้ว ÷ ยอดเรียกเก็บสุทธิ) รายชั้นหรือรายห้อง\n   - กราฟ 2: สถานะการชำระของนักเรียนในตาราง พร้อมแท่งแบ่งส่วน (ตัวเลขอยู่ในช่องข้างแท่งเสมอ)\n   - ชี้หรือกด Tab ที่แท่งเพื่อดูรายละเอียด ข้อมูลเดียวกันอยู่ในตารางด้วย (ไม่ต้องพึ่งการชี้)\n   ========================================================================== */\n(function () {\n  'use strict';\n  var h = App.h;\n  var clear = App.clear;\n  var button = App.button;\n  var money = App.fmt.money;\n\n  App.state.dashYear = null;\n  App.state.dashGroup = 'grade';\n\n  var STATE_KEYS = ['PAID', 'PARTIAL', 'UNPAID', 'OTHER'];\n  var STATE_LABELS = { PAID: 'ชำระครบ', PARTIAL: 'ชำระบางส่วน', UNPAID: 'ยังไม่ชำระ', OTHER: 'ยกเว้น / ยังไม่มีรายการ' };\n\n  function pctText(paid, net) {\n    if (!(net > 0)) return '–';\n    return (Math.floor(paid * 1000 / net) / 10).toFixed(1) + '%';\n  }\n\n  function share(paid, net) {\n    return net > 0 ? Math.max(0, Math.min(1, paid / net)) : 0;\n  }\n\n  function stateCounts(g) {\n    return { PAID: g.states.PAID, PARTIAL: g.states.PARTIAL, UNPAID: g.states.UNPAID, OTHER: g.states.EXEMPT + g.states.NO_BILL };\n  }\n\n  // ---------------------------------------------------------------- tooltip (ใช้ textContent เสมอ)\n  var tip = null;\n  function tipEl() {\n    if (!tip || !document.body.contains(tip)) {\n      tip = h('div', { class: 'viz-tip hidden', role: 'tooltip' });\n      document.body.appendChild(tip);\n    }\n    return tip;\n  }\n  function showTip(target, lines, x, y) {\n    var el = tipEl();\n    clear(el);\n    lines.forEach(function (l, i) { el.appendChild(h('div', { class: i === 0 ? 'tip-value' : 'tip-label', text: l })); });\n    el.classList.remove('hidden');\n    var r = target.getBoundingClientRect();\n    var left = x === undefined ? r.left + 8 : x + 14;\n    var top = y === undefined ? r.bottom + 6 : y + 14;\n    var w = el.offsetWidth;\n    var hgt = el.offsetHeight;\n    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);\n    if (top + hgt > window.innerHeight - 8) top = Math.max(8, (y === undefined ? r.top : y) - hgt - 10);\n    el.style.left = left + 'px';\n    el.style.top = top + 'px';\n  }\n  function hideTip() { if (tip) tip.classList.add('hidden'); }\n  function hover(el, linesFn) {\n    el.addEventListener('pointermove', function (e) { showTip(el, linesFn(), e.clientX, e.clientY); });\n    el.addEventListener('pointerleave', hideTip);\n    el.addEventListener('focus', function () { showTip(el, linesFn()); });\n    el.addEventListener('blur', hideTip);\n  }\n\n  // ---------------------------------------------------------------- แท่งความคืบหน้า\n  function meterRow(label, g) {\n    var fill = h('div', { class: 'meter-fill', style: { width: (share(g.paidSatang, g.netSatang) * 100).toFixed(2) + '%' } });\n    var row = h('div', {\n      class: 'meter-row', tabindex: '0',\n      'aria-label': label + ' ชำระแล้ว ' + pctText(g.paidSatang, g.netSatang) + ' ค้าง ' + money(g.outstandingSatang),\n    },\n      h('div', { class: 'meter-name', text: label }),\n      h('div', { class: 'meter-track' }, fill),\n      h('div', { class: 'meter-figure' },\n        h('span', { class: 'strong', text: pctText(g.paidSatang, g.netSatang) }),\n        h('span', { class: 'muted', text: ' · ค้าง ' + formatSatang_(g.outstandingSatang) })));\n    hover(row, function () {\n      return [\n        'ชำระแล้ว ' + money(g.paidSatang) + ' (' + pctText(g.paidSatang, g.netSatang) + ')',\n        label + ' · เรียกเก็บสุทธิ ' + money(g.netSatang),\n        'ค้างชำระ ' + money(g.outstandingSatang) + (g.overdueSatang ? ' (เลยกำหนด ' + money(g.overdueSatang) + ')' : ''),\n        'นักเรียน ' + g.students + ' คน',\n      ];\n    });\n    return row;\n  }\n\n  function segBar(label, g) {\n    var c = stateCounts(g);\n    var total = g.students || 1;\n    var bar = h('div', { class: 'segbar', role: 'img', tabindex: '0',\n      'aria-label': label + ': ' + STATE_KEYS.map(function (k) { return STATE_LABELS[k] + ' ' + c[k] + ' คน'; }).join(', ') });\n    STATE_KEYS.forEach(function (k) {\n      if (!c[k]) return;\n      bar.appendChild(h('span', { class: 'seg-' + k, style: { flexGrow: String(c[k] / total), flexBasis: '0' } }));\n    });\n    hover(bar, function () {\n      return [label + ' · ' + g.students + ' คน'].concat(STATE_KEYS.filter(function (k) { return c[k]; }).map(function (k) {\n        return STATE_LABELS[k] + ' ' + c[k] + ' คน';\n      }));\n    });\n    return bar;\n  }\n\n  function legend() {\n    return h('div', { class: 'viz-legend', 'aria-hidden': 'true' }, STATE_KEYS.map(function (k) {\n      return h('span', null, h('span', { class: 'sw seg-' + k }), STATE_LABELS[k]);\n    }));\n  }\n\n  function groupsOf(data, mode) {\n    var out = [];\n    data.grades.forEach(function (g) {\n      if (g.other) { out.push({ label: 'ไม่มีชั้นเรียนในปีนี้', g: g }); return; }\n      if (mode === 'room') g.rooms.forEach(function (r) { out.push({ label: r.label, g: r }); });\n      else out.push({ label: g.label, g: g });\n    });\n    return out;\n  }\n\n  App.defineRoute('dashboard', {\n    title: 'ภาพรวม (Dashboard)',\n    roles: ['FINANCE', 'DIRECTOR'],\n    menu: { group: 'main', label: 'ภาพรวม (Dashboard)', icon: 'chart', order: 110 },\n    render: function (params) {\n      var year = params.year || App.state.dashYear || App.state.me.school.currentAcademicYear;\n      return Promise.all([App.api('dashboard.summary', { year: year }), App.api('years.list')]).then(function (res) {\n        var data = res[0];\n        var years = res[1];\n        App.state.dashYear = data.year;\n        var t = data.totals;\n        var st = t.states;\n        var yearSel = App.field({ label: 'ปีการศึกษา', type: 'select', value: String(data.year),\n          options: years.map(function (y) { return { value: String(y.year), label: y.label + (y.isCurrent ? ' (ปัจจุบัน)' : '') }; }) });\n        yearSel.input.addEventListener('change', function () { App.go('dashboard', { year: Number(yearSel.input.value) }); });\n        yearSel.wrap.style.flex = '0 1 320px';\n\n        // ---------------------------------------------------------------- แจ้งเตือนสั้น ๆ\n        var alerts = [];\n        if (data.pendingApprovals) {\n          alerts.push(h('div', { class: 'alert alert-info' },\n            h('span', { text: 'มีคำขอรออนุมัติ ' + data.pendingApprovals + ' รายการ ' }),\n            button('ดูคำขอ', 'ghost btn-sm', function () { App.go('approvals'); })));\n        }\n        if (data.unclosedDays) {\n          alerts.push(h('div', { class: 'alert alert-warning' },\n            h('span', { text: 'มีวันที่รับเงินแล้วแต่ยังไม่ปิดยอด ' + data.unclosedDays + ' วัน (30 วันล่าสุด) ' }),\n            button('ดูรายงานประจำวัน', 'ghost btn-sm', function () { App.go('report-daily'); })));\n        }\n\n        // ---------------------------------------------------------------- กราฟความคืบหน้า + สถานะ\n        var mode = App.state.dashGroup;\n        var chartBox = h('div', { class: 'viz' });\n        var statusBox = h('div', { class: 'viz' });\n        var tableBox = h('div');\n        function tab(value, label) {\n          var b = button(label, 'secondary btn-sm', function () { App.state.dashGroup = value; mode = value; drawCharts(); syncTabs(); });\n          b.dataset.value = value;\n          return b;\n        }\n        var tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'จัดกลุ่มกราฟ' }, tab('grade', 'แยกตามระดับชั้น'), tab('room', 'แยกตามห้อง'));\n        function syncTabs() {\n          Array.prototype.forEach.call(tabs.children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.value === mode)); });\n        }\n        function drawCharts() {\n          hideTip();\n          var groups = groupsOf(data, mode);\n          clear(chartBox).appendChild(groups.length\n            ? h('div', { class: 'meter-list' }, groups.map(function (x) { return meterRow(x.label, x.g); }))\n            : h('div', { class: 'empty', text: 'ยังไม่มีข้อมูลนักเรียนหรือรายการเรียกเก็บของปีนี้' }));\n          clear(statusBox);\n          statusBox.appendChild(legend());\n          statusBox.appendChild(App.table({\n            rows: groups,\n            columns: [\n              { label: mode === 'room' ? 'ห้อง' : 'ระดับชั้น', render: function (x) { return h('span', { class: 'strong', text: x.label }); } },\n              { label: 'นักเรียน', className: 'num', render: function (x) { return String(x.g.students); } },\n              { label: 'ชำระครบ', className: 'num', render: function (x) { return String(x.g.states.PAID); } },\n              { label: 'บางส่วน', className: 'num', render: function (x) { return String(x.g.states.PARTIAL); } },\n              { label: 'ยังไม่ชำระ', className: 'num', render: function (x) { return h('span', { class: x.g.states.UNPAID ? 'text-danger strong' : 'muted', text: String(x.g.states.UNPAID) }); } },\n              { label: 'ยกเว้น', className: 'num', render: function (x) { return String(x.g.states.EXEMPT); } },\n              { label: 'ยังไม่มีรายการ', className: 'num', render: function (x) { return String(x.g.states.NO_BILL); } },\n              { label: 'สัดส่วน', render: function (x) { return segBar(x.label, x.g); } },\n            ],\n            empty: 'ไม่มีข้อมูล',\n          }));\n          clear(tableBox).appendChild(App.table({\n            rows: groups,\n            columns: [\n              { label: mode === 'room' ? 'ห้อง' : 'ระดับชั้น', render: function (x) { return h('span', { class: 'strong', text: x.label }); } },\n              { label: 'นักเรียน', className: 'num', render: function (x) { return String(x.g.students); } },\n              { label: 'เรียกเก็บสุทธิ', className: 'num', render: function (x) { return formatSatang_(x.g.netSatang); } },\n              { label: 'ชำระแล้ว', className: 'num', render: function (x) { return formatSatang_(x.g.paidSatang); } },\n              { label: 'ร้อยละ', className: 'num', render: function (x) { return pctText(x.g.paidSatang, x.g.netSatang); } },\n              { label: 'ค้างชำระ', className: 'num', render: function (x) { return h('span', { class: x.g.outstandingSatang ? 'text-danger' : 'muted', text: formatSatang_(x.g.outstandingSatang) }); } },\n              { label: 'เลยกำหนด', className: 'num', render: function (x) { return formatSatang_(x.g.overdueSatang); } },\n            ],\n          }));\n        }\n        drawCharts();\n        syncTabs();\n\n        var overall = h('div', { class: 'viz meter-overall' },\n          h('div', { class: 'meter-track', role: 'img', 'aria-label': 'รับชำระแล้ว ' + pctText(t.paidSatang, t.netSatang) + ' ของยอดเรียกเก็บสุทธิ' },\n            h('div', { class: 'meter-fill', style: { width: (share(t.paidSatang, t.netSatang) * 100).toFixed(2) + '%' } })));\n\n        var today = data.todayReceipts;\n        return h('div', null,\n          App.pageHead('ภาพรวมปีการศึกษา ' + data.year, 'ข้อมูล ณ ' + App.fmt.datetime(data.generatedAt) + ' · คำนวณจากรายการเรียกเก็บและการรับเงินจริงทุกครั้ง',\n            [button('รายงาน', 'secondary', function () { App.go('reports'); }, 'printer')]),\n          h('div', { class: 'toolbar filter-bar' }, yearSel.wrap),\n          alerts.length ? h('div', { class: 'stack', style: { marginBottom: '14px' } }, alerts) : null,\n          h('div', { class: 'grid-cards' },\n            App.statCard('จำนวนนักเรียน', t.students + ' คน', 'ปีการศึกษา ' + data.year),\n            App.statCard('ยอดเรียกเก็บทั้งหมด (สุทธิ)', money(t.netSatang), t.grossSatang !== t.netSatang ? 'ก่อนลดหย่อน/ยกเว้น ' + money(t.grossSatang) : 'ไม่มีการลดหย่อน/ยกเว้น'),\n            App.statCard('ยอดรับชำระแล้ว', money(t.paidSatang), pctText(t.paidSatang, t.netSatang) + ' ของยอดเรียกเก็บ', 'success'),\n            App.statCard('ยอดค้างชำระ', money(t.outstandingSatang),\n              (t.overdueSatang ? 'เลยกำหนด ' + money(t.overdueSatang) : 'ไม่มียอดเลยกำหนด') +\n              (data.priorOutstandingSatang ? ' · ค้างจากปีก่อน ' + money(data.priorOutstandingSatang) : ''), t.outstandingSatang ? 'danger' : 'success')),\n          h('div', { class: 'grid-cards', style: { marginTop: '12px' } },\n            App.statCard('ชำระครบ', st.PAID + ' คน', 'ไม่มียอดค้างของปีนี้', 'success'),\n            App.statCard('ชำระบางส่วน', st.PARTIAL + ' คน', 'ชำระแล้วบางส่วน ยังมียอดค้าง'),\n            App.statCard('ยังไม่ชำระ', st.UNPAID + ' คน', 'ยังไม่มีการชำระของปีนี้', st.UNPAID ? 'danger' : ''),\n            App.statCard('ยกเว้น / ยังไม่มีรายการ', (st.EXEMPT + st.NO_BILL) + ' คน', 'ได้รับยกเว้น ' + st.EXEMPT + ' · ยังไม่เรียกเก็บ ' + st.NO_BILL)),\n          h('div', { class: 'stack', style: { marginTop: '14px' } },\n            h('div', { class: 'card' },\n              h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: 'อัตราการรับชำระ ปีการศึกษา ' + data.year })),\n              h('div', { class: 'card-body' },\n                h('div', { class: 'status-line' },\n                  h('span', { class: 'strong', style: { fontSize: '1.6rem' }, text: pctText(t.paidSatang, t.netSatang) }),\n                  h('span', { class: 'muted', text: 'ชำระแล้ว ' + money(t.paidSatang) + ' จาก ' + money(t.netSatang) })),\n                overall,\n                h('div', { class: 'muted small', style: { marginTop: '8px' },\n                  text: 'รับเงินวันนี้ ' + today.count + ' ใบ รวม ' + money(today.totalSatang) + (today.count ? (today.closed ? ' · ปิดยอดแล้ว' : ' · ยังไม่ปิดยอด') : '') }))),\n            h('div', { class: 'card' },\n              h('div', { class: 'card-head' },\n                h('h2', { class: 'section-title', text: 'ความคืบหน้าการรับชำระ' }), tabs),\n              h('div', { class: 'card-body' },\n                h('p', { class: 'muted small', style: { marginTop: '0' }, text: 'ความยาวแท่ง = ยอดที่ชำระแล้ว ÷ ยอดเรียกเก็บสุทธิของปีนี้ · ชี้หรือกด Tab ที่แถวเพื่อดูตัวเลข' }),\n                chartBox,\n                h('details', { style: { marginTop: '12px' } }, h('summary', { text: 'ดูเป็นตารางตัวเลข' }), tableBox))),\n            h('div', { class: 'card' },\n              h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: 'สถานะการชำระของนักเรียน' })),\n              h('div', { class: 'card-body' }, statusBox))));\n      });\n    },\n  });\n})();\n</script>\n",
  "JsFees": "<script>\n/* ==========================================================================\n   JsFees — อัตราเงินบำรุง รายการเรียกเก็บ ลดหย่อน/ยกเว้น และบัญชีนักเรียน (ระยะที่ 4)\n   ปุ่มที่ซ่อนตามบทบาทมีไว้เพื่อความสะดวกเท่านั้น ทุกคำสั่งตรวจสิทธิ์และเงื่อนไขซ้ำที่ Server\n   ========================================================================== */\n(function () {\n  'use strict';\n  var h = App.h;\n  var clear = App.clear;\n  var button = App.button;\n  var money = App.fmt.money;\n  var VIEW = ['FINANCE', 'DIRECTOR'];\n\n  App.state.feeYear = null;\n\n  function isFinance() { return App.state.me.user.role === 'FINANCE'; }\n  function withTitle(el, title) { el.title = title; return el; }\n  function isDirector() { return App.state.me.user.role === 'DIRECTOR'; }\n\n  function num(satang, strongWhenPositive) {\n    return h('span', { class: strongWhenPositive && satang > 0 ? 'text-danger strong' : '', text: formatSatang_(satang) });\n  }\n\n  function stateCell(a) {\n    return [\n      App.badge(a.stateLabel, App.KIND.PAY_STATE[a.state]),\n      a.pendingRequest ? h('div', { style: { marginTop: '4px' } }, App.badge('รออนุมัติ: ' + a.pendingRequest.typeLabel, 'warning')) : null,\n    ];\n  }\n\n  // ---------------------------------------------------------------------------\n  // ฟอร์มที่ใช้หลายหน้า\n  // ---------------------------------------------------------------------------\n\n  /** ขอลดหย่อนหรือยกเว้น (a = รายการเรียกเก็บ) */\n  App.openAdjustmentForm = function (a, who) {\n    App.formModal({\n      title: 'ลดหย่อน/ยกเว้น',\n      intro: h('div', { class: 'alert alert-info' },\n        h('div', { class: 'strong', text: (who ? who + ' · ' : '') + a.label }),\n        h('div', { text: 'ยอดคงเหลือ ' + money(a.outstandingSatang) }),\n        h('div', { class: 'small', text: 'ต้องมีเหตุผลและเอกสารอ้างอิง ถ้าโรงเรียนตั้งค่าให้ต้องอนุมัติ คำขอจะรอผู้อำนวยการพิจารณา และยอดเดิมยังมีผลระหว่างรอ' })),\n      fields: [\n        { key: 'type', label: 'ประเภท', type: 'select', required: true, value: 'DISCOUNT',\n          options: [{ value: 'DISCOUNT', label: 'ลดหย่อน (ระบุจำนวนเงิน)' }, { value: 'EXEMPTION', label: 'ยกเว้นยอดคงเหลือทั้งหมด' }] },\n        { key: 'amount', label: 'จำนวนเงินที่ลดหย่อน (บาท)', required: true, inputmode: 'decimal', placeholder: '0.00',\n          help: 'ไม่เกินยอดคงเหลือ ' + formatSatang_(a.outstandingSatang) + ' บาท' },\n        { key: 'reason', label: 'เหตุผล', type: 'textarea', required: true, span2: true, maxlength: 500 },\n        { key: 'referenceDoc', label: 'เอกสารอ้างอิง', required: true, span2: true, maxlength: 300,\n          help: 'เช่น เลขที่และวันที่ของหนังสือขอลดหย่อน หรือประกาศของโรงเรียน' },\n      ],\n      submitLabel: 'ส่งคำขอ',\n      onReady: function (f) {\n        f.type.input.addEventListener('change', function () {\n          var exempt = f.type.get() === 'EXEMPTION';\n          f.amount.input.disabled = exempt;\n          f.amount.input.value = exempt ? formatSatang_(a.outstandingSatang) : '';\n        });\n      },\n      onSubmit: function (v) {\n        return App.api('adjustments.request', {\n          assessmentId: a.assessmentId, type: v.type, amount: v.amount, reason: v.reason, referenceDoc: v.referenceDoc,\n        });\n      },\n      onDone: function (res) {\n        App.toast(res.message, 'success');\n        App.refresh();\n      },\n    });\n  };\n\n  /** ขอยกเลิกรายการเรียกเก็บ (ได้เฉพาะรายการที่ยังไม่มีการชำระ) */\n  App.openCancelAssessmentForm = function (a, who) {\n    App.formModal({\n      title: 'ขอยกเลิกรายการเรียกเก็บ',\n      intro: h('div', { class: 'alert alert-warning' },\n        h('div', { class: 'strong', text: (who ? who + ' · ' : '') + a.label + ' ' + money(a.netSatang) }),\n        h('div', { class: 'small', text: 'ยกเลิกได้เฉพาะรายการที่ยังไม่มีการชำระ รายการเดิมยังเก็บไว้และดูย้อนหลังได้' })),\n      fields: [{ key: 'reason', label: 'เหตุผลการยกเลิก', type: 'textarea', required: true, span2: true, maxlength: 500 }],\n      submitLabel: 'ส่งคำขอยกเลิก',\n      submitKind: 'danger',\n      onSubmit: function (v) { return App.api('assessments.requestCancel', { assessmentId: a.assessmentId, reason: v.reason }); },\n      onDone: function (res) {\n        App.toast(res.message, 'success');\n        App.refresh();\n      },\n    });\n  };\n\n  function assessmentActions(a, who) {\n    if (!isFinance() || a.status !== 'ACTIVE' || a.pendingRequest) return null;\n    return [\n      a.outstandingSatang > 0 ? button('ลดหย่อน/ยกเว้น', 'secondary btn-sm', function () { App.openAdjustmentForm(a, who); }) : null,\n      a.paidSatang === 0 ? button('ขอยกเลิก', 'ghost btn-sm', function () { App.openCancelAssessmentForm(a, who); }) : null,\n    ];\n  }\n\n  // ---------------------------------------------------------------------------\n  // อัตราเงินบำรุง\n  // ---------------------------------------------------------------------------\n\n  function openFeeForm(data, f) {\n    var editing = !!f;\n    var locked = editing && f.locked;\n    var fields = [];\n    if (!editing) {\n      fields.push({ key: 'term', label: 'ภาคเรียน', type: 'select', required: true, options: data.terms, value: '1' });\n      fields.push({ key: 'description', label: 'ชื่อรายการ (ใช้เขียนในใบเสร็จ)', maxlength: 100, value: data.defaultDescription });\n      fields.push({ key: 'gradeLevels', label: 'ระดับชั้น (เลือกได้หลายชั้นถ้าอัตราเท่ากัน)', type: 'checkgroup', required: true, span2: true,\n        options: data.gradeLevels.map(function (g) { return { value: g, label: g }; }) });\n    } else {\n      fields.push({ key: 'description', label: 'ชื่อรายการ (ใช้เขียนในใบเสร็จ)', maxlength: 100, value: f.description, span2: true });\n    }\n    fields.push(\n      { key: 'amount', label: 'จำนวนเงินต่อคน (บาท)', required: true, inputmode: 'decimal', disabled: locked,\n        value: editing ? formatSatang_(f.amountSatang) : '', placeholder: '0.00',\n        help: locked ? 'สร้างรายการเรียกเก็บแล้ว แก้ไม่ได้ ถ้าบางคนต้องจ่ายต่างกัน ให้ใช้การลดหย่อน' : 'เช่น 500 หรือ 1,250.50' },\n      { key: 'dueDate', label: 'วันครบกำหนดชำระ', type: 'date', required: true, disabled: locked, value: editing ? f.dueDate : '' },\n      { key: 'startDate', label: 'วันเริ่มเรียกเก็บ', type: 'date', value: editing ? f.startDate : '' },\n      { key: 'approvalRef', label: 'เอกสารที่อนุมัติอัตรา', type: 'textarea', rows: 2, maxlength: 300, span2: true, value: editing ? f.approvalRef : '',\n        help: 'เลขที่และวันที่ของหนังสือหรือมติที่อนุมัติอัตรานี้ เช่น มติคณะกรรมการสถานศึกษา ครั้งที่ 1/2569 ลงวันที่ 1 พ.ค. 2569 (ต้องกรอกก่อนสร้างรายการเรียกเก็บ)' });\n    if (editing) {\n      fields.push({ key: 'status', label: 'สถานะ', type: 'select', value: f.status,\n        options: [{ value: 'ACTIVE', label: 'ใช้งาน' }, { value: 'INACTIVE', label: 'ไม่ใช้งาน (ไม่สร้างรายการเรียกเก็บเพิ่ม)' }] });\n    }\n    App.formModal({\n      title: editing ? 'แก้ไขอัตรา: ' + f.label : 'ตั้งอัตราเงินบำรุง ปีการศึกษา ' + data.year,\n      size: 'lg',\n      intro: locked ? h('div', { class: 'alert alert-info', text: 'อัตรานี้สร้างรายการเรียกเก็บแล้ว ' + f.stats.count +\n        ' รายการ จึงแก้จำนวนเงินและวันครบกำหนดไม่ได้' }) : null,\n      fields: fields,\n      submitLabel: editing ? 'บันทึก' : 'ตั้งอัตรา',\n      onSubmit: function (v) {\n        var payload = { amount: v.amount, dueDate: v.dueDate, startDate: v.startDate, description: v.description, approvalRef: v.approvalRef };\n        if (editing) {\n          payload.feeSettingId = f.feeSettingId;\n          payload.status = v.status;\n          return App.api('fees.update', payload);\n        }\n        payload.year = data.year;\n        payload.term = v.term;\n        payload.gradeLevels = v.gradeLevels;\n        return App.api('fees.create', payload);\n      },\n      onDone: function (res) {\n        App.toast(editing ? 'บันทึกอัตราเรียบร้อยแล้ว' : 'ตั้งอัตราแล้ว ' + res.length + ' ชั้น', 'success');\n        App.refresh();\n      },\n    });\n  }\n\n  /** ดูตัวอย่าง แล้วยืนยันสร้างรายการเรียกเก็บ */\n  function openGenerate(f) {\n    App.api('assessments.preview', { feeSettingId: f.feeSettingId }).then(function (p) {\n      var n = p.create.length;\n      var body = [\n        h('div', { class: 'alert ' + (n ? 'alert-info' : 'alert-success') },\n          h('div', { class: 'strong', text: n ? 'จะสร้างรายการเรียกเก็บ ' + n + ' คน รวม ' + money(p.totalSatang) : 'ทุกคนที่ต้องเรียกเก็บมีรายการของอัตรานี้แล้ว' }),\n          h('div', { text: p.setting.label + ' คนละ ' + money(p.setting.amountSatang) + ' ครบกำหนด ' + App.fmt.dateLong(p.setting.dueDate) }),\n          p.already ? h('div', { text: 'มีรายการแล้ว ' + p.already + ' คน (ไม่สร้างซ้ำ)' }) : null),\n      ];\n      if (n) {\n        body.push(h('h3', { text: 'รายชื่อที่จะเรียกเก็บ' }), App.table({\n          rows: p.create,\n          columns: [\n            { label: 'ชั้น/ห้อง', key: 'classLabel', className: 'nowrap' },\n            { label: 'เลขที่', key: 'classNo' },\n            { label: 'เลขประจำตัว', render: function (r) { return h('span', { class: 'mono', text: r.studentNo }); } },\n            { label: 'ชื่อ-นามสกุล', key: 'fullName' },\n          ],\n        }));\n      }\n      if (p.skipped.length) {\n        body.push(h('h3', { text: 'ไม่สร้างรายการ ' + p.skipped.length + ' คน' }), App.table({\n          rows: p.skipped,\n          columns: [\n            { label: 'เลขประจำตัว', render: function (r) { return h('span', { class: 'mono', text: r.studentNo }); } },\n            { label: 'ชื่อ-นามสกุล', key: 'fullName' },\n            { label: 'เหตุผล', key: 'reason' },\n          ],\n        }));\n      }\n      var confirmLabel = 'สร้างรายการเรียกเก็บ ' + n + ' คน';\n      App.modal({\n        title: 'สร้างรายการเรียกเก็บ: ' + p.setting.label,\n        size: 'lg',\n        body: body,\n        actions: n ? [\n          { label: 'ยกเลิก', kind: 'secondary' },\n          { label: confirmLabel, onClick: function (btn, close) {\n            btn.disabled = true;\n            btn.textContent = 'กำลังบันทึก…';\n            App.api('assessments.generate', { feeSettingId: f.feeSettingId }).then(function (r) {\n              close();\n              App.toast('สร้างรายการเรียกเก็บ ' + r.created + ' คน รวม ' + money(r.totalSatang) + ' เรียบร้อยแล้ว', 'success');\n              App.refresh();\n            }).catch(function (err) {\n              btn.disabled = false;\n              btn.textContent = confirmLabel;\n              App.fail(err);\n            });\n          } },\n        ] : [{ label: 'ปิด', kind: 'secondary' }],\n      });\n    }).catch(App.fail);\n  }\n\n  App.defineRoute('fees', {\n    title: 'อัตราและการเรียกเก็บ',\n    roles: VIEW,\n    menu: { group: 'finance', label: 'อัตราและการเรียกเก็บ', icon: 'tag', order: 30 },\n    render: function (params) {\n      var year = params.year || App.state.feeYear || App.state.me.school.currentAcademicYear;\n      return Promise.all([App.api('fees.list', { year: year }), App.api('years.list')]).then(function (res) {\n        var data = res[0];\n        var years = res[1];\n        App.state.feeYear = data.year;\n        var canEdit = isFinance() && data.yearOpen;\n        var yearSel = App.field({ label: 'ปีการศึกษา', type: 'select', value: String(data.year),\n          options: years.map(function (y) {\n            return { value: String(y.year), label: y.label + (y.isCurrent ? ' (ปัจจุบัน)' : '') + (y.status === 'CLOSED' ? ' (ปิดแล้ว)' : '') };\n          }) });\n        yearSel.input.addEventListener('change', function () { App.go('fees', { year: Number(yearSel.input.value) }); });\n\n        var totals = { count: 0, net: 0, paid: 0, out: 0 };\n        data.settings.forEach(function (f) {\n          totals.count += f.stats.count;\n          totals.net += f.stats.netSatang;\n          totals.paid += f.stats.paidSatang;\n          totals.out += f.stats.outstandingSatang;\n        });\n\n        var columns = [\n          { label: 'ชั้น / ภาคเรียน', className: 'nowrap', render: function (f) {\n            return [h('div', { class: 'strong', text: f.gradeLevel }), h('div', { class: 'muted small', text: f.termLabel }),\n              f.status !== 'ACTIVE' ? App.badge(f.statusLabel, App.KIND.ACTIVE[f.status]) : null];\n          } },\n          { label: 'อัตรา/คน', className: 'num', render: function (f) { return formatSatang_(f.amountSatang); } },\n          { label: 'ครบกำหนด', className: 'nowrap', render: function (f) { return App.fmt.date(f.dueDate); } },\n          { label: 'เอกสารอนุมัติอัตรา', render: function (f) {\n            return f.approvalRef ? h('div', { class: 'small clamp-2', title: f.approvalRef, text: f.approvalRef }) : App.badge('ยังไม่กรอก', 'danger');\n          } },\n          { label: 'เรียกเก็บ', className: 'num', render: function (f) { return f.stats.count + ' คน'; } },\n          { label: 'ชำระแล้ว', className: 'num', render: function (f) { return formatSatang_(f.stats.paidSatang); } },\n          { label: 'คงค้าง', className: 'num', render: function (f) { return num(f.stats.outstandingSatang, true); } },\n        ];\n        if (canEdit) {\n          columns.push({ label: 'จัดการ', className: 'actions', render: function (f) {\n            return [\n              f.status === 'ACTIVE' ? withTitle(button('เรียกเก็บ', 'primary btn-sm', function () { openGenerate(f); }, 'play'), 'สร้างรายการเรียกเก็บของอัตรานี้ (ดูตัวอย่างก่อนบันทึก)') : null,\n              button('แก้ไข', 'secondary btn-sm', function () { openFeeForm(data, f); }, 'edit'),\n            ];\n          } });\n        }\n        var actions = canEdit ? [button('ตั้งอัตราเงินบำรุง', '', function () { openFeeForm(data, null); }, 'plus')] : [];\n        return h('div', null,\n          App.pageHead('อัตราเงินบำรุงและการเรียกเก็บ', 'ปีการศึกษา ' + data.year + ' · คลิกแถวเพื่อดูรายชื่อและยอดค้างรายคน', actions),\n          h('div', { class: 'grid-cards' },\n            App.statCard('รายการเรียกเก็บ', totals.count + ' รายการ'),\n            App.statCard('ยอดเรียกเก็บสุทธิ', money(totals.net)),\n            App.statCard('ชำระแล้ว', money(totals.paid), null, 'success'),\n            App.statCard('คงค้าง', money(totals.out), null, totals.out ? 'danger' : null)),\n          h('div', { class: 'card' }, h('div', { class: 'card-body' },\n            h('div', { class: 'toolbar filter-bar' }, yearSel.wrap),\n            data.yearOpen ? null : h('div', { class: 'alert alert-warning', style: { marginBottom: '12px' },\n              text: 'ปีการศึกษานี้ปิดแล้ว ตั้งอัตราหรือสร้างรายการเรียกเก็บใหม่ไม่ได้ แต่ยังรับชำระหนี้ค้างได้' }),\n            canEdit ? h('p', { class: 'muted small', text: 'ทุกอัตราต้องกรอกเลขที่และวันที่ของหนังสือหรือมติที่อนุมัติอัตรา ก่อนสร้างรายการเรียกเก็บ' }) : null,\n            App.table({\n              rows: data.settings,\n              columns: columns,\n              onRowClick: function (f) { App.go('fee-detail', { feeSettingId: f.feeSettingId }); },\n              empty: 'ยังไม่มีอัตราเงินบำรุงของปีการศึกษานี้' + (canEdit ? ' กด \"ตั้งอัตราเงินบำรุง\" เพื่อเริ่มต้น' : ''),\n            }))));\n      });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // รายการเรียกเก็บของอัตราหนึ่ง (รายคน)\n  // ---------------------------------------------------------------------------\n  var STATE_OPTIONS = [\n    { value: '', label: 'ทุกสถานะ' },\n    { value: 'OWING', label: 'ยังค้างชำระ (ยังไม่ชำระ + บางส่วน)' },\n    { value: 'UNPAID', label: 'ยังไม่ชำระ' },\n    { value: 'PARTIAL', label: 'ชำระบางส่วน' },\n    { value: 'PAID', label: 'ชำระครบ' },\n    { value: 'EXEMPT', label: 'ได้รับยกเว้น' },\n    { value: 'CANCELLED', label: 'ยกเลิก' },\n  ];\n\n  App.defineRoute('fee-detail', {\n    title: 'รายการเรียกเก็บ',\n    roles: VIEW,\n    render: function (params) {\n      return App.api('assessments.list', { feeSettingId: params.feeSettingId }).then(function (data) {\n        var f = data.setting;\n        var filt = { state: params.state || '', room: '', q: '' };\n        var stateSel = App.field({ label: 'สถานะการชำระ', type: 'select', options: STATE_OPTIONS, value: filt.state });\n        var rooms = [];\n        data.rows.forEach(function (r) { if (r.room && rooms.indexOf(r.room) === -1) rooms.push(r.room); });\n        rooms.sort(function (a, b) { return Number(a) - Number(b) || (a < b ? -1 : a > b ? 1 : 0); });\n        var roomSel = App.field({ label: 'ห้อง', type: 'select', options: [{ value: '', label: 'ทุกห้อง' }].concat(rooms.map(function (r) { return { value: r, label: 'ห้อง ' + r }; })) });\n        var search = App.field({ label: 'ค้นหา', placeholder: 'ชื่อ หรือเลขประจำตัว' });\n        search.wrap.classList.add('filter-wide');\n        var summary = h('div', { class: 'toolbar', style: { gap: '8px', marginBottom: '12px' } });\n        var list = h('div');\n\n        function draw() {\n          var q = filt.q.trim().toLowerCase().replace(/\\s+/g, '');\n          var rows = data.rows.filter(function (r) {\n            if (filt.state === 'OWING' && r.outstandingSatang <= 0) return false;\n            if (filt.state && filt.state !== 'OWING' && r.state !== filt.state) return false;\n            if (filt.room && r.room !== filt.room) return false;\n            if (q && (r.studentNo + r.fullName).toLowerCase().replace(/\\s+/g, '').indexOf(q) === -1) return false;\n            return true;\n          });\n          clear(summary);\n          ['UNPAID', 'PARTIAL', 'PAID', 'EXEMPT'].forEach(function (s) {\n            summary.appendChild(App.badge(STATE_OPTIONS.filter(function (o) { return o.value === s; })[0].label + ' ' + (f.stats.states[s] || 0), App.KIND.PAY_STATE[s]));\n          });\n          if (rows.length !== data.rows.length) summary.appendChild(App.badge('แสดง ' + rows.length + ' คน', 'FINANCE'));\n          var columns = [\n            { label: 'ชั้น/ห้อง', key: 'classLabel', className: 'nowrap' },\n            { label: 'เลขที่', key: 'classNo' },\n            { label: 'เลขประจำตัว', render: function (r) { return h('span', { class: 'mono', text: r.studentNo }); } },\n            { label: 'ชื่อ-นามสกุล', key: 'fullName' },\n            { label: 'ยอดสุทธิ', className: 'num', render: function (r) { return formatSatang_(r.netSatang); } },\n            { label: 'ชำระแล้ว', className: 'num', render: function (r) { return formatSatang_(r.paidSatang); } },\n            { label: 'คงเหลือ', className: 'num', render: function (r) { return num(r.outstandingSatang, true); } },\n            { label: 'สถานะ', render: stateCell },\n          ];\n          if (data.canManage) {\n            columns.push({ label: 'จัดการ', className: 'actions', render: function (r) { return assessmentActions(r, r.fullName); } });\n          }\n          clear(list).appendChild(App.table({\n            rows: rows,\n            columns: columns,\n            onRowClick: function (r) { App.go('student-account', { studentId: r.studentId, back: 'fee-detail', backParams: { feeSettingId: f.feeSettingId } }); },\n            empty: data.rows.length ? 'ไม่พบรายการตามเงื่อนไข' : 'ยังไม่ได้สร้างรายการเรียกเก็บของอัตรานี้',\n          }));\n        }\n        stateSel.input.addEventListener('change', function () { filt.state = stateSel.get(); draw(); });\n        roomSel.input.addEventListener('change', function () { filt.room = roomSel.get(); draw(); });\n        search.input.addEventListener('input', function () { filt.q = search.get(); draw(); });\n        draw();\n\n        var actions = [button('กลับ', 'secondary', function () { App.go('fees', { year: f.year }); }, 'arrowLeft')];\n        if (data.canManage && f.status === 'ACTIVE') {\n          actions.push(button('สร้างรายการเรียกเก็บ', '', function () { openGenerate(f); }, 'play'));\n        }\n        return h('div', null,\n          App.pageHead(f.label, 'คนละ ' + money(f.amountSatang) + ' · ครบกำหนด ' + App.fmt.dateLong(f.dueDate) +\n            (f.approvalRef ? ' · อนุมัติตาม ' + f.approvalRef : ' · ยังไม่ได้กรอกเอกสารที่อนุมัติอัตรา'), actions),\n          h('div', { class: 'grid-cards' },\n            App.statCard('เรียกเก็บ', f.stats.count + ' คน'),\n            App.statCard('ยอดเรียกเก็บสุทธิ', money(f.stats.netSatang)),\n            App.statCard('ชำระแล้ว', money(f.stats.paidSatang), null, 'success'),\n            App.statCard('คงค้าง', money(f.stats.outstandingSatang), null, f.stats.outstandingSatang ? 'danger' : null)),\n          h('div', { class: 'card' }, h('div', { class: 'card-body' },\n            h('div', { class: 'toolbar filter-bar' }, stateSel.wrap, roomSel.wrap, search.wrap),\n            summary, list)));\n      });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // บัญชีการเงินของนักเรียน\n  // ---------------------------------------------------------------------------\n\n  function openAddAssessment(d) {\n    App.formModal({\n      title: 'เพิ่มรายการเรียกเก็บรายบุคคล',\n      intro: h('div', { class: 'alert alert-info', text: 'ใช้กับนักเรียนที่ย้ายเข้ากลางปี หรือไม่ได้อยู่ในการสร้างรายการเรียกเก็บรอบก่อน เลือกได้เฉพาะอัตราของชั้นที่นักเรียนเรียนในปีนั้น' }),\n      fields: [{ key: 'feeSettingId', label: 'อัตรา', type: 'select', required: true, span2: true,\n        options: d.availableFees.map(function (f) { return { value: f.feeSettingId, label: f.label + ' (' + money(f.amountSatang) + ')' }; }) }],\n      submitLabel: 'เพิ่มรายการ',\n      onSubmit: function (v) { return App.api('assessments.createOne', { studentId: d.student.studentId, feeSettingId: v.feeSettingId }); },\n      onDone: function () {\n        App.toast('เพิ่มรายการเรียกเก็บเรียบร้อยแล้ว', 'success');\n        App.refresh();\n      },\n    });\n  }\n\n  function openRevoke(adj) {\n    App.formModal({\n      title: 'เพิกถอน' + adj.typeLabel,\n      intro: h('div', { class: 'alert alert-warning' },\n        h('div', { class: 'strong', text: adj.label + ' ' + money(adj.amountSatang) }),\n        h('div', { class: 'small', text: 'หลังเพิกถอน ยอดค้างของรายการนี้จะกลับมาตามเดิม และบันทึกเหตุผลไว้ในประวัติ' })),\n      fields: [{ key: 'reason', label: 'เหตุผลการเพิกถอน', type: 'textarea', required: true, span2: true, maxlength: 500 }],\n      submitLabel: 'เพิกถอน',\n      submitKind: 'danger',\n      onSubmit: function (v) { return App.api('adjustments.revoke', { adjustmentId: adj.adjustmentId, reason: v.reason }); },\n      onDone: function (res) {\n        App.toast(res.message, 'success');\n        App.refresh();\n      },\n    });\n  }\n\n  function section(title, content) {\n    return h('div', { class: 'card' },\n      h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: title })),\n      h('div', { class: 'card-body' }, content));\n  }\n\n  App.defineRoute('student-account', {\n    title: 'บัญชีนักเรียน',\n    roles: VIEW,\n    render: function (params) {\n      return App.api('ledger.student', { studentId: params.studentId }).then(function (d) {\n        var s = d.student;\n        var t = d.totals;\n        var actions = [];\n        if (params.back) actions.push(button('กลับ', 'secondary', function () { App.go(params.back, params.backParams); }, 'arrowLeft'));\n        if (isFinance()) {\n          actions.push(button('รับชำระเงิน', '', function () { App.go('payments', { studentId: s.studentId }); }, 'cash'));\n          if (d.availableFees.length) actions.push(button('เพิ่มรายการเรียกเก็บ', 'secondary', function () { openAddAssessment(d); }, 'plus'));\n        }\n        if (t.outstandingSatang > 0 && s.year) {\n          actions.push(button('พิมพ์หนังสือแจ้งยอด', 'secondary', function () { App.go('report-notices', { year: s.year, studentId: s.studentId }); }, 'printer'));\n        }\n        var desc = 'เลขประจำตัว ' + s.studentNo + (s.classLabel ? ' · ชั้น ' + s.classLabel + ' ปีการศึกษา ' + s.year : '') + ' · ' + s.statusLabel;\n\n        var assessments = App.table({\n          rows: d.assessments,\n          empty: 'ยังไม่มีรายการเรียกเก็บ',\n          columns: [\n            { label: 'รายการ', render: function (a) { return [h('div', { text: a.label }), a.overdue ? App.badge('เลยกำหนด', 'danger') : null]; } },\n            { label: 'ครบกำหนด', className: 'nowrap', render: function (a) { return App.fmt.date(a.dueDate); } },\n            { label: 'เรียกเก็บ', className: 'num', render: function (a) { return formatSatang_(a.grossSatang); } },\n            { label: 'ลดหย่อน/ยกเว้น', className: 'num', render: function (a) { return a.adjustSatang ? formatSatang_(a.adjustSatang) : '–'; } },\n            { label: 'ชำระแล้ว', className: 'num', render: function (a) { return formatSatang_(a.paidSatang); } },\n            { label: 'คงเหลือ', className: 'num', render: function (a) { return num(a.outstandingSatang, true); } },\n            { label: 'สถานะ', render: function (a) {\n              return [stateCell(a), a.status === 'CANCELLED' && a.cancelReason ? h('div', { class: 'muted small', text: 'เหตุผล: ' + a.cancelReason }) : null];\n            } },\n            { label: 'จัดการ', className: 'actions', render: function (a) { return assessmentActions(a, s.fullName); } },\n          ],\n        });\n\n        var payments = App.table({\n          rows: d.payments,\n          empty: 'ยังไม่มีการรับเงิน',\n          onRowClick: function (p) { App.openPaymentDetail(p.paymentId); },\n          columns: [\n            { label: 'วันที่', className: 'nowrap', render: function (p) { return App.fmt.date(p.date); } },\n            { label: 'ใบเสร็จ', className: 'nowrap', render: function (p) { return 'เล่ม ' + p.bookNo + ' เลขที่ ' + p.receiptNo; } },\n            { label: 'จำนวนเงิน', className: 'num', render: function (p) { return h('span', { class: 'strong', text: formatSatang_(p.amountSatang) }); } },\n            { label: 'ช่องทาง', render: function (p) { return [h('div', { text: p.channel }), p.channelRef ? h('div', { class: 'muted small', text: p.channelRef }) : null]; } },\n            { label: 'ตัดชำระ', render: function (p) {\n              return h('ul', { class: 'inline-list small' }, p.allocations.map(function (al) { return h('li', { text: al.label + ' ' + formatSatang_(al.amountSatang) }); }));\n            } },\n            { label: 'ผู้รับเงิน', key: 'receivedByName' },\n            { label: 'สถานะ', render: function (p) {\n              return [App.badge(p.statusLabel, App.KIND.ACTIVE[p.status]),\n                p.pendingRequest ? App.badge('รออนุมัติ: ' + p.pendingRequest.typeLabel, 'warning') : null,\n                p.status !== 'ACTIVE' && p.voidReason ? h('div', { class: 'muted small', text: p.voidReason }) : null,\n                p.replacesPaymentId ? h('div', { class: 'muted small', text: 'แก้ไขแทนรายการที่บันทึกผิด' }) : null];\n            } },\n            { label: 'จัดการ', className: 'actions', render: function (p) {\n              return button(isFinance() && p.status === 'ACTIVE' && !p.pendingRequest ? 'รายละเอียด / แก้ไข' : 'รายละเอียด', 'secondary btn-sm', function () { App.openPaymentDetail(p.paymentId); });\n            } },\n          ],\n        });\n\n        var adjustments = App.table({\n          rows: d.adjustments,\n          empty: 'ไม่มีการลดหย่อนหรือยกเว้น',\n          columns: [\n            { label: 'วันที่', className: 'nowrap', render: function (a) { return App.fmt.date(a.createdAt.slice(0, 10)); } },\n            { label: 'รายการ', key: 'label' },\n            { label: 'ประเภท', key: 'typeLabel' },\n            { label: 'จำนวนเงิน', className: 'num', render: function (a) { return formatSatang_(a.amountSatang); } },\n            { label: 'เหตุผล / เอกสาร', render: function (a) { return [h('div', { text: a.reason }), h('div', { class: 'muted small', text: a.referenceDoc })]; } },\n            { label: 'ผู้ขอ / ผู้อนุมัติ', render: function (a) {\n              return [h('div', { text: a.requestedBy }), h('div', { class: 'muted small', text: a.approvedBy ? 'อนุมัติโดย ' + a.approvedBy : 'ไม่ต้องอนุมัติตามการตั้งค่า' })];\n            } },\n            { label: 'สถานะ', render: function (a) {\n              return [App.badge(a.statusLabel, App.KIND.ACTIVE[a.status]),\n                a.status === 'REVOKED' ? h('div', { class: 'muted small', text: 'โดย ' + a.revokedBy + ': ' + a.revokeReason }) : null];\n            } },\n            { label: 'จัดการ', className: 'actions', render: function (a) {\n              return isDirector() && a.status === 'ACTIVE' ? button('เพิกถอน', 'ghost btn-sm', function () { openRevoke(a); }) : null;\n            } },\n          ],\n        });\n\n        var requests = App.table({\n          rows: d.requests,\n          empty: 'ไม่มีคำขออนุมัติ',\n          columns: [\n            { label: 'วันที่ขอ', className: 'nowrap', render: function (r) { return App.fmt.datetime(r.createdAt); } },\n            { label: 'ประเภท', key: 'typeLabel' },\n            { label: 'รายละเอียด', key: 'summary' },\n            { label: 'สถานะ', render: function (r) { return App.badge(r.statusLabel, App.KIND.DECISION[r.status]); } },\n            { label: 'ผลการพิจารณา', render: function (r) {\n              return r.decidedByName ? [h('div', { text: r.decidedByName }), r.decisionNote ? h('div', { class: 'muted small', text: r.decisionNote }) : null] : '–';\n            } },\n          ],\n        });\n\n        return h('div', null,\n          App.pageHead(s.fullName, desc, actions),\n          h('div', { class: 'grid-cards' },\n            App.statCard('ยอดเรียกเก็บสุทธิ', money(t.netSatang), t.adjustSatang ? 'หลังลดหย่อน/ยกเว้น ' + money(t.adjustSatang) : null),\n            App.statCard('ชำระแล้ว', money(t.paidSatang), null, 'success'),\n            App.statCard('คงค้าง', money(t.outstandingSatang), t.overdueSatang ? 'เลยกำหนดแล้ว ' + money(t.overdueSatang) : null, t.outstandingSatang ? 'danger' : null)),\n          h('div', { class: 'stack' },\n            section('รายการเรียกเก็บทุกปีการศึกษา', assessments),\n            section('ประวัติการรับเงิน', payments),\n            section('ลดหย่อน/ยกเว้น', adjustments),\n            section('คำขออนุมัติ', requests)));\n      });\n    },\n  });\n})();\n</script>\n",
  "JsIntegrity": "<script>\n/* ==========================================================================\n   JsIntegrity — ตรวจความถูกต้องของข้อมูล (ระยะที่ 8) ผู้ดูแลระบบและผู้อำนวยการ\n   - Server ตรวจทุกข้อภายใต้ lock อ่านอย่างเดียว และบันทึกประวัติการตรวจ\n   - ระบบตรวจอัตโนมัติทุกวันต่อจากการสำรองข้อมูลด้วย หน้านี้แสดงผลครั้งล่าสุดและตรวจซ้ำได้ทันที\n   ========================================================================== */\n(function () {\n  'use strict';\n  var h = App.h;\n  var clear = App.clear;\n  var button = App.button;\n\n  var CHECK_HELP = {\n    sheets: 'อ่านทุกชีตได้ ตัวเลขและวันที่อยู่ในรูปแบบที่ถูกต้อง และรหัสอ้างอิงไม่ซ้ำ',\n    audit: 'ประวัติการใช้งานต่อกันเป็นลูกโซ่ hash ถ้ามีการแก้ แทรก หรือลบแถว ลูกโซ่จะขาด',\n    payments: 'ใบเสร็จที่มีผลทุกใบ ยอดเงินเท่ากับผลรวมการตัดชำระ และตรงกับทะเบียนคุมเลขที่',\n    receipts: 'ไม่มีเลขที่ใบเสร็จซ้ำ และทุกเลขที่อยู่ในช่วงของเล่ม',\n    assessments: 'ไม่มีรายการเรียกเก็บที่รับเงินเกินยอดสุทธิ หรือรายการที่ยกเลิกแล้วยังมีการตัดชำระ',\n    books: 'สถานะเล่มตรงกับจำนวนเลขที่ที่ใช้ และมีเล่มที่กำลังใช้ไม่เกิน 1 เล่ม',\n    auditCoverage: 'ทุกรายการการเงินบันทึกผ่านระบบ (มีประวัติคู่กัน) ไม่ได้เพิ่มหรือแก้ในชีตโดยตรง',\n    closings: 'รายการรับเงินของวันที่ปิดยอดแล้วยังตรงกับรหัสตรวจสอบบนรายงานที่ลงนาม',\n  };\n\n  function resultView(r) {\n    return h('div', { class: 'stack' },\n      h('div', { class: 'alert ' + (r.ok ? 'alert-success' : 'alert-error') },\n        h('div', { class: 'strong', text: r.ok ? 'ถูกต้องทั้งหมด ' + r.checks.length + ' ข้อ' : 'พบปัญหา ' + r.problemCount + ' จุด' }),\n        h('div', { class: 'small', text: 'ตรวจเมื่อ ' + App.fmt.datetime(r.checkedAt) + (r.checkedBy ? ' โดย ' + r.checkedBy : '') })),\n      h('div', { class: 'card' }, h('div', { class: 'card-body' }, App.table({\n        rows: r.checks,\n        columns: [\n          { label: 'ผล', className: 'nowrap', render: function (c) { return App.badge(c.ok ? '✓ ผ่าน' : '✗ ' + c.count + ' จุด', c.ok ? 'success' : 'danger'); } },\n          { label: 'รายการตรวจ', render: function (c) {\n            var nodes = [h('div', { class: 'strong', text: c.label }), h('div', { class: 'muted small', text: CHECK_HELP[c.key] || '' })];\n            if (!c.ok) {\n              nodes.push(h('ul', { class: 'small', style: { margin: '6px 0 0', paddingLeft: '18px' } },\n                c.problems.map(function (p) { return h('li', { text: p }); }),\n                c.more ? h('li', { class: 'muted', text: 'และอีก ' + c.more + ' จุด' }) : null));\n            }\n            return nodes;\n          } },\n        ],\n      }))));\n  }\n\n  App.defineRoute('integrity', {\n    title: 'ตรวจความถูกต้องของข้อมูล',\n    roles: ['ADMIN', 'DIRECTOR'],\n    menu: { group: 'manage', label: 'ตรวจความถูกต้องของข้อมูล', icon: 'shield', order: 105 },\n    render: function () {\n      return App.api('integrity.status', {}).then(function (st) {\n        var last = st.last;\n        var box = h('div');\n        var runBtn = button('ตรวจตอนนี้', '', function () {\n          runBtn.disabled = true;\n          runBtn.textContent = 'กำลังตรวจ… (อาจใช้เวลา 1 นาที)';\n          App.api('integrity.check', {}).then(function (r) {\n            clear(box).appendChild(resultView(r));\n            App.toast(r.ok ? 'ตรวจแล้ว ถูกต้องทั้งหมด' : 'ตรวจแล้ว พบปัญหา ' + r.problemCount + ' จุด', r.ok ? 'success' : 'error');\n          }).catch(App.fail).then(function () {\n            runBtn.disabled = false;\n            runBtn.textContent = 'ตรวจตอนนี้';\n          });\n        }, 'shield');\n        if (last) {\n          box.appendChild(h('div', { class: 'alert ' + (last.ok ? 'alert-success' : 'alert-error') },\n            h('div', { class: 'strong', text: 'ผลการตรวจครั้งล่าสุด: ' + (last.ok ? 'ถูกต้องทั้งหมด' : 'พบปัญหา ' + last.problemCount + ' จุด') }),\n            h('div', { class: 'small', text: App.fmt.datetime(last.at) + ' โดย ' + (last.byName || last.by) + (last.ok ? '' : ' · กด \"ตรวจตอนนี้\" เพื่อดูรายละเอียด') })));\n        } else {\n          box.appendChild(h('div', { class: 'alert alert-info', text: 'ยังไม่เคยตรวจ กด \"ตรวจตอนนี้\" (ระบบจะตรวจให้อัตโนมัติทุกวันต่อจากการสำรองข้อมูล)' }));\n        }\n        return h('div', { class: 'has-print-head' },\n          h('div', { class: 'print-only print-head' },\n            h('div', { class: 'strong', text: App.state.me.school.name }),\n            h('h1', { text: 'ผลการตรวจความถูกต้องของข้อมูล' })),\n          App.pageHead('ตรวจความถูกต้องของข้อมูล', 'ตรวจทั้งระบบโดยไม่แก้ไขข้อมูล: ยอดเงิน เลขที่ใบเสร็จ สถานะเล่ม ประวัติการใช้งาน และวันที่ปิดยอดแล้ว',\n            [runBtn, button('พิมพ์', 'secondary', function () { window.print(); }, 'printer')]),\n          box,\n          h('div', { class: 'card', style: { marginTop: '14px' } },\n            h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: 'ถ้าพบปัญหา' })),\n            h('div', { class: 'card-body' }, h('ol', { style: { margin: '0', paddingLeft: '20px', lineHeight: '1.8' } },\n              h('li', { text: 'ห้ามแก้ข้อมูลในชีตเองเพื่อให้ \"ผ่าน\" เพราะจะทำให้ตรวจสอบย้อนหลังไม่ได้' }),\n              h('li', { text: 'แจ้งผู้อำนวยการและเจ้าหน้าที่การเงิน ใช้เลขที่ใบเสร็จหรือรหัสในรายการปัญหาเปิดดูในระบบ และดูหน้า \"ประวัติการใช้งาน\" ว่าใครทำอะไรเมื่อไร' }),\n              h('li', { text: 'เทียบกับเล่มใบเสร็จจริงและรายงานที่ลงนามแล้ว ถ้าข้อมูลในชีตถูกแก้โดยไม่ผ่านระบบ ให้ผู้ดูแลระบบพิจารณากู้คืนจากไฟล์สำรองก่อนวันที่เกิดปัญหา' }),\n              h('li', { text: 'ถ้าไม่แน่ใจ ให้ปรึกษาผู้พัฒนาระบบพร้อมภาพหน้าจอนี้' })))));\n      });\n    },\n  });\n})();\n</script>\n",
  "JsPayments": "<script>\n/* ==========================================================================\n   JsPayments — รับชำระเงิน รายการรับเงิน การแก้ไขหลังบันทึก และทะเบียนคุมใบเสร็จ\n   ระบบไม่ออกเลขใบเสร็จเอง: เจ้าหน้าที่เขียนใบเสร็จจริงจากเล่มที่ลงทะเบียนไว้ แล้วบันทึกเลขเล่ม เลขที่ และจำนวนเงิน\n   Server ตรวจเลขที่ ยอดคงเหลือ และการบันทึกซ้ำอีกครั้งภายใต้ lock ทุกครั้ง\n   ========================================================================== */\n(function () {\n  'use strict';\n  var h = App.h;\n  var clear = App.clear;\n  var button = App.button;\n  var money = App.fmt.money;\n  var VIEW = ['FINANCE', 'DIRECTOR'];\n\n  App.state.paySearch = '';\n  App.state.payOnlyOwing = true;\n\n  function isFinance() { return App.state.me.user.role === 'FINANCE'; }\n  function isCash(channel) { return /เงินสด/.test(String(channel || '')); }\n\n  function parseSatang(text) {\n    var r = parseMoneyToSatang_(String(text === null || text === undefined ? '' : text).trim());\n    return r.ok ? r.satang : null;\n  }\n\n  function receiptLabel(p) { return 'เล่มที่ ' + p.bookNo + ' เลขที่ ' + p.receiptNo; }\n\n  function kvRow(label, value) {\n    return h('tr', null, h('th', { text: label }), h('td', null, value === null || value === undefined || value === '' ? '–' : value));\n  }\n\n  /** ป้ายเล่มที่กำลังใช้และเลขที่ถัดไป */\n  function bookBanner(book, strict) {\n    if (!book) {\n      return h('div', { class: 'alert alert-warning stack', style: { marginBottom: '16px', gap: '6px' } },\n        h('div', { class: 'strong', text: 'ยังไม่มีเล่มใบเสร็จที่กำลังใช้' }),\n        h('div', { text: 'ต้องลงทะเบียนเล่มใบเสร็จจริงและเปิดใช้ก่อนรับเงิน (ระบบไม่ออกเลขใบเสร็จเอง)' }),\n        App.canAccess('receipt-books') ? h('div', null, button('ไปที่เล่มใบเสร็จ', 'secondary btn-sm', function () { App.go('receipt-books'); }, 'book')) : null);\n    }\n    if (book.nextNo === null) {\n      return h('div', { class: 'alert alert-warning', style: { marginBottom: '16px' },\n        text: 'เล่มที่ ' + book.bookNo + ' ไม่มีเลขที่ว่างแล้ว (เลขที่ที่เหลือรออนุมัติยกเลิก) เมื่อผู้อำนวยการพิจารณาแล้ว เล่มจะเปลี่ยนเป็นใช้ครบ แล้วจึงเปิดใช้เล่มใหม่ได้' });\n    }\n    return h('div', { class: 'card banner', style: { marginBottom: '16px' } },\n      h('div', null,\n        h('div', { class: 'muted small', text: 'ใบเสร็จฉบับถัดไปที่ต้องใช้' }),\n        h('div', { class: 'big', text: 'เล่มที่ ' + book.bookNo + ' เลขที่ ' + book.nextNo }),\n        h('div', { class: 'muted small', text: 'เหลือ ' + book.remaining + ' ฉบับ (เลขที่ ' + book.startNo + '–' + book.endNo + ')' +\n          (strict ? ' · ใช้เลขที่เรียงลำดับ' : '') })),\n      h('div', { class: 'stack', style: { gap: '6px', alignItems: 'flex-end' } },\n        book.low ? App.badge('ใกล้หมดเล่ม กรุณาเตรียมเล่มใหม่', 'warning') : null,\n        book.gaps && book.gaps.length ? App.badge('เลขที่ขาดช่วง: ' + book.gaps.join(', '), 'danger') : null,\n        book.pendingClose ? App.badge('มีคำขอปิดเล่มรออนุมัติ', 'warning') : null));\n  }\n\n  function recentPayments(list) {\n    if (!list || !list.length) return null;\n    return h('div', { class: 'card' },\n      h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: 'การรับเงินล่าสุดของนักเรียนคนนี้' })),\n      h('div', { class: 'card-body' }, App.table({\n        rows: list,\n        onRowClick: function (p) { App.openPaymentDetail(p.paymentId); },\n        columns: [\n          { label: 'วันที่', className: 'nowrap', render: function (p) { return App.fmt.date(p.date); } },\n          { label: 'ใบเสร็จ', className: 'nowrap', render: receiptLabel },\n          { label: 'จำนวนเงิน', className: 'num', render: function (p) { return formatSatang_(p.amountSatang); } },\n          { label: 'ตัดชำระ', render: function (p) {\n            return h('ul', { class: 'inline-list small' }, p.allocations.map(function (al) { return h('li', { text: al.label + ' ' + formatSatang_(al.amountSatang) }); }));\n          } },\n          { label: 'สถานะ', render: function (p) { return App.badge(p.statusLabel, App.KIND.ACTIVE[p.status]); } },\n        ],\n      })));\n  }\n\n  // ---------------------------------------------------------------------------\n  // ตัวช่วยการตัดชำระ (ใช้ทั้งหน้ารับเงินและหน้าแก้ไขรายการ)\n  // ---------------------------------------------------------------------------\n\n  /**\n   * ตารางรายการที่ตัดชำระ: ช่องกรอกยอดต่อรายการ และตัดหนี้เก่าก่อนให้อัตโนมัติ\n   * items: [{ assessmentId, label, dueDate, overdue, outstandingSatang, allocatedSatang? }] (เรียงหนี้เก่าก่อนแล้ว)\n   */\n  function allocationEditor(items, onChange) {\n    var inputs = {};\n    var table = App.table({\n      rows: items,\n      columns: [\n        { label: 'รายการ', render: function (it) { return [h('div', { text: it.label }), it.overdue ? App.badge('เลยกำหนด', 'danger') : null]; } },\n        { label: 'ครบกำหนด', className: 'nowrap', render: function (it) { return App.fmt.date(it.dueDate); } },\n        { label: 'คงเหลือ', className: 'num', render: function (it) { return formatSatang_(it.outstandingSatang); } },\n        { label: 'ตัดชำระครั้งนี้', className: 'num', render: function (it) {\n          var input = h('input', { class: 'input alloc-input', inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'ตัดชำระ ' + it.label });\n          if (it.allocatedSatang) input.value = formatSatang_(it.allocatedSatang);\n          input.addEventListener('input', onChange);\n          inputs[it.assessmentId] = input;\n          return input;\n        } },\n      ],\n    });\n    return {\n      table: table,\n      total: items.reduce(function (t, it) { return t + it.outstandingSatang; }, 0),\n      autoFill: function (amountSatang) {\n        var plan = autoAllocate_(items.map(function (it) { return { id: it.assessmentId, outstandingSatang: it.outstandingSatang }; }),\n          amountSatang && amountSatang > 0 ? amountSatang : 0);\n        items.forEach(function (it) { inputs[it.assessmentId].value = ''; });\n        plan.allocations.forEach(function (al) { inputs[al.id].value = formatSatang_(al.satang); });\n      },\n      /** อ่านยอดที่กรอก และตรวจเทียบกับจำนวนเงินที่รับ */\n      check: function (amountSatang) {\n        var list = [];\n        var badText = false;\n        items.forEach(function (it) {\n          var text = inputs[it.assessmentId].value.trim();\n          if (!text) return;\n          var v = parseSatang(text);\n          if (v === null || v < 0) { badText = true; return; }\n          if (v > 0) list.push({ item: it, satang: v });\n        });\n        var sum = list.reduce(function (t, x) { return t + x.satang; }, 0);\n        var over = list.filter(function (x) { return x.satang > x.item.outstandingSatang; });\n        var total = this.total;\n        var a = amountSatang;\n        var message;\n        var ok = false;\n        if (a === null || a <= 0) message = 'กรอกจำนวนเงินที่รับ ระบบจะตัดหนี้เก่าก่อนให้อัตโนมัติ และแก้ยอดตัดชำระแต่ละรายการได้';\n        else if (a > total) message = 'จำนวนเงินที่รับเกินยอดค้างทั้งหมด (' + money(total) + ') ระบบไม่รับเงินเกินยอดค้าง';\n        else if (badText) message = 'ยอดตัดชำระต้องเป็นตัวเลข มีทศนิยมไม่เกิน 2 ตำแหน่ง';\n        else if (over.length) message = 'ยอดตัดชำระของ \"' + over[0].item.label + '\" เกินยอดคงเหลือ';\n        else if (sum !== a) message = 'ยอดตัดชำระรวม ' + money(sum) + ' ยังไม่เท่ากับจำนวนเงินที่รับ ' + money(a);\n        else { message = 'ยอดตัดชำระรวม ' + money(sum) + ' เท่ากับจำนวนเงินที่รับ'; ok = true; }\n        return { ok: ok, message: message, list: list, sum: sum, started: a !== null && a > 0 };\n      },\n    };\n  }\n\n  function showSumLine(el, st) {\n    el.textContent = st.message;\n    el.className = 'sum-line' + (!st.started ? '' : st.ok ? ' good' : ' bad');\n  }\n\n  function showError(box, message, extra) {\n    clear(box).appendChild(h('div', { text: message }));\n    if (extra) box.appendChild(h('div', { style: { marginTop: '8px' } }, extra));\n    box.classList.remove('hidden');\n    box.scrollIntoView({ block: 'nearest' });\n  }\n\n  // ---------------------------------------------------------------------------\n  // ยกเลิกเลขที่ / ยกเลิกใบเสร็จ / รายละเอียดการรับเงิน\n  // ---------------------------------------------------------------------------\n\n  var KEEP_TEXT = 'ข้าพเจ้าเก็บใบเสร็จฉบับที่ยกเลิกไว้ครบทุกส่วนแล้ว (ห้ามฉีกทิ้ง)';\n\n  /** ขอยกเลิกเลขที่ที่เขียนผิดหรือชำรุด (ยังไม่บันทึกรับเงิน) */\n  App.openCancelNumberForm = function (book, receiptNo, onDone) {\n    var fields = [];\n    if (receiptNo === null || receiptNo === undefined) {\n      fields.push({ key: 'receiptNo', label: 'เลขที่ใบเสร็จ', type: 'number', required: true, inputmode: 'numeric',\n        min: book.startNo, max: book.endNo, value: book.nextNo, help: 'เลขที่ในเล่มนี้: ' + book.startNo + '–' + book.endNo });\n    }\n    fields.push(\n      { key: 'reason', label: 'เหตุผลการยกเลิก', type: 'textarea', required: true, span2: true, maxlength: 500, help: 'เช่น เขียนจำนวนเงินผิด ชื่อผิด หรือกระดาษชำรุด' },\n      { key: 'confirmKept', label: KEEP_TEXT, type: 'checkbox', span2: true });\n    App.formModal({\n      title: 'ยกเลิกเลขที่ใบเสร็จ' + (receiptNo ? ' เลขที่ ' + receiptNo : ''),\n      intro: h('div', { class: 'alert alert-warning' },\n        h('div', { class: 'strong', text: 'เล่มที่ ' + book.bookNo + (receiptNo ? ' เลขที่ ' + receiptNo : '') }),\n        h('div', { class: 'small', text: 'ใช้กับใบเสร็จที่เขียนผิดหรือชำรุด และยังไม่ได้บันทึกรับเงิน ห้ามแก้ตัวเลขบนใบเสร็จ ให้ยกเลิกทั้งฉบับและเก็บไว้ครบทุกส่วน ระหว่างรออนุมัติ เลขที่นี้จะถูกกันไว้' })),\n      fields: fields,\n      submitLabel: 'ส่งคำขอยกเลิก',\n      submitKind: 'danger',\n      onSubmit: function (v) {\n        return App.api('receipts.requestCancelNumber', {\n          bookId: book.bookId, receiptNo: receiptNo || Number(v.receiptNo), reason: v.reason, confirmKept: v.confirmKept === true,\n        });\n      },\n      onDone: function (res) {\n        App.toast(res.message, 'success');\n        if (onDone) onDone(res); else App.refresh();\n      },\n    });\n  };\n\n  /** ขอยกเลิกใบเสร็จที่บันทึกรับเงินแล้ว */\n  App.openVoidPaymentForm = function (p, onDone) {\n    App.formModal({\n      title: 'ขอยกเลิกใบเสร็จ ' + receiptLabel(p),\n      intro: h('div', { class: 'alert alert-warning' },\n        h('div', { class: 'strong', text: receiptLabel(p) + ' จำนวน ' + money(p.amountSatang) }),\n        h('div', { class: 'small', text: 'ใช้เมื่อใบเสร็จฉบับจริงต้องยกเลิกทั้งฉบับ เมื่ออนุมัติแล้ว ยอดค้างของนักเรียนจะกลับมา และเลขที่นี้เป็น \"ยกเลิก\" ถ้ารับเงินใหม่ต้องใช้ใบเสร็จฉบับใหม่ ถ้าใบเสร็จจริงถูกต้องแต่บันทึกในระบบผิด ให้ใช้ \"ขอแก้ไขรายการ\" แทน' })),\n      fields: [\n        { key: 'reason', label: 'เหตุผลการยกเลิกใบเสร็จ', type: 'textarea', required: true, span2: true, maxlength: 500 },\n        { key: 'confirmKept', label: KEEP_TEXT, type: 'checkbox', span2: true },\n      ],\n      submitLabel: 'ส่งคำขอยกเลิกใบเสร็จ',\n      submitKind: 'danger',\n      onSubmit: function (v) { return App.api('payments.requestVoid', { paymentId: p.paymentId, reason: v.reason, confirmKept: v.confirmKept === true }); },\n      onDone: function (res) {\n        App.toast(res.message, 'success');\n        if (onDone) onDone(res); else App.refresh();\n      },\n    });\n  };\n\n  /** รายละเอียดการรับเงิน พร้อมปุ่มขอแก้ไขหรือขอยกเลิก (เจ้าหน้าที่การเงิน) */\n  App.openPaymentDetail = function (paymentId) {\n    App.api('payments.get', { paymentId: paymentId }).then(function (d) {\n      var p = d.payment;\n      var s = d.student;\n      var body = [\n        h('table', { class: 'kv' }, h('tbody', null,\n          kvRow('ใบเสร็จ', h('span', { class: 'strong', text: receiptLabel(p) })),\n          kvRow('สถานะ', [App.badge(p.statusLabel, App.KIND.ACTIVE[p.status]),\n            d.pendingRequest ? App.badge('รออนุมัติ: ' + d.pendingRequest.typeLabel, 'warning') : null]),\n          kvRow('นักเรียน', s.fullName + ' (' + s.studentNo + ')'),\n          kvRow('วันที่รับเงิน', App.fmt.dateLong(p.date)),\n          kvRow('จำนวนเงิน', [h('div', { class: 'strong', text: money(p.amountSatang) }), h('div', { class: 'muted small', text: '(' + bahtText_(p.amountSatang) + ')' })]),\n          kvRow('ช่องทาง', p.channel + (p.channelRef ? ' (' + p.channelRef + ')' : '')),\n          kvRow('ผู้รับเงิน', p.receivedByName),\n          kvRow('หมายเหตุ', p.note),\n          kvRow('บันทึกโดย', p.createdBy + ' · ' + App.fmt.datetime(p.createdAt)),\n          p.status !== 'ACTIVE' ? kvRow(p.status === 'VOIDED' ? 'เหตุผลการยกเลิก' : 'เหตุผลการแก้ไข', p.voidReason + (p.voidedBy ? ' (' + p.voidedBy + ')' : '')) : null,\n          p.replacesPaymentId ? kvRow('หมายเหตุระบบ', 'รายการนี้แก้ไขแทนรายการที่บันทึกผิดก่อนหน้า (เลขที่ใบเสร็จเดิม)') : null)),\n        h('h3', { style: { margin: '14px 0 6px' }, text: 'รายการที่ตัดชำระ' }),\n        p.allocations.length ? h('ul', { class: 'inline-list' }, p.allocations.map(function (al) { return h('li', { text: al.label + ' ' + money(al.amountSatang) }); }))\n          : h('p', { class: 'muted', text: p.status === 'ACTIVE' ? '–' : 'การตัดชำระของรายการนี้ถูกยกเลิกแล้ว' }),\n      ];\n      var related = d.related.map(function (r) {\n        return button((r.paymentId === p.replacedByPaymentId ? 'ดูรายการที่แก้ไขแทน' : 'ดูรายการเดิมก่อนแก้ไข'), 'ghost btn-sm', function () {\n          App.clearOverlays();\n          App.openPaymentDetail(r.paymentId);\n        });\n      });\n      if (related.length) body.push(h('div', { class: 'toolbar', style: { marginTop: '10px' } }, related));\n      var actions = [{ label: 'ปิด', kind: 'secondary' }];\n      actions.push({ label: 'บัญชีนักเรียน', kind: 'secondary', onClick: function (b, close) { close(); App.go('student-account', { studentId: s.studentId }); } });\n      if (d.canRequest) {\n        actions.push({ label: 'ขอยกเลิกใบเสร็จ', kind: 'danger', onClick: function (b, close) { close(); App.openVoidPaymentForm(p); } });\n        actions.push({ label: 'ขอแก้ไขรายการ', onClick: function (b, close) { close(); App.go('payment-correct', { paymentId: p.paymentId }); } });\n      }\n      App.modal({ title: 'การรับเงิน ' + receiptLabel(p), size: 'lg', body: body, actions: actions });\n    }).catch(App.fail);\n  };\n\n  // ---------------------------------------------------------------------------\n  // รับชำระเงิน: ขั้นที่ 1 เลือกนักเรียน\n  // ---------------------------------------------------------------------------\n  function studentPicker(list, onPick, options) {\n    var o = options || {};\n    var search = App.field({ label: 'ค้นหานักเรียน', placeholder: 'ชื่อ นามสกุล หรือเลขประจำตัว', value: o.query || '' });\n    search.wrap.classList.add('filter-wide');\n    var owing = o.owingFilter ? App.field({ label: 'แสดงเฉพาะผู้ที่มียอดค้าง', type: 'checkbox', value: o.onlyOwing }) : null;\n    var results = h('div');\n    function draw() {\n      var q = search.get().trim().toLowerCase().replace(/\\s+/g, '');\n      var rows = list.rows.filter(function (r) {\n        if (owing && owing.get() && r.outstandingSatang <= 0) return false;\n        if (q && (r.studentNo + r.fullName).toLowerCase().replace(/\\s+/g, '').indexOf(q) === -1) return false;\n        return true;\n      });\n      var shown = rows.slice(0, 50);\n      var columns = [\n        { label: 'เลขประจำตัว', render: function (r) { return h('span', { class: 'mono', text: r.studentNo }); } },\n        { label: 'ชื่อ-นามสกุล', render: function (r) { return [h('div', { text: r.fullName }), r.status !== 'STUDYING' ? App.badge(r.statusLabel, 'muted') : null]; } },\n        { label: 'ชั้น/ห้อง', className: 'nowrap', render: function (r) { return r.classLabel ? r.classLabel + (r.year !== list.currentYear ? ' (' + r.year + ')' : '') : '–'; } },\n        { label: 'ยอดค้าง', className: 'num', render: function (r) {\n          return h('span', { class: r.outstandingSatang ? 'text-danger strong' : '', text: formatSatang_(r.outstandingSatang) });\n        } },\n        { label: 'เลยกำหนด', className: 'num', render: function (r) { return r.overdueSatang ? formatSatang_(r.overdueSatang) : '–'; } },\n        { label: '', className: 'actions', render: function (r) { return button(o.actionLabel || 'เลือก', 'secondary btn-sm', function () { onPick(r); }, o.actionIcon); } },\n      ];\n      clear(results).appendChild(App.table({\n        rows: shown,\n        onRowClick: onPick,\n        empty: q ? 'ไม่พบนักเรียนตามคำค้น' + (owing && owing.get() ? ' (ลองเอาติ๊ก \"แสดงเฉพาะผู้ที่มียอดค้าง\" ออก)' : '') : 'ไม่มีนักเรียนที่มียอดค้าง',\n        columns: columns,\n      }));\n      if (rows.length > shown.length) {\n        results.appendChild(h('p', { class: 'muted small', text: 'แสดง 50 คนแรกจาก ' + rows.length + ' คน พิมพ์ชื่อหรือเลขประจำตัวเพื่อค้นหาให้แคบลง' }));\n      }\n    }\n    search.input.addEventListener('input', function () { if (o.onQuery) o.onQuery(search.get()); draw(); });\n    if (owing) owing.input.addEventListener('change', function () { if (o.onOwing) o.onOwing(owing.get()); draw(); });\n    draw();\n    setTimeout(function () { search.input.focus(); }, 0);\n    return h('div', null, h('div', { class: 'toolbar filter-bar' }, search.wrap, owing ? owing.wrap : null), results);\n  }\n\n  function renderSearch(ctx, list) {\n    return h('div', null,\n      App.pageHead('รับชำระเงิน', 'เลือกนักเรียน แล้วบันทึกตามใบเสร็จรับเงินฉบับจริงที่เขียนให้ผู้ปกครอง'),\n      bookBanner(ctx.book, ctx.strict),\n      h('div', { class: 'card' }, h('div', { class: 'card-body' }, studentPicker(list, function (r) {\n        App.go('payments', { studentId: r.studentId });\n      }, {\n        query: App.state.paySearch, onQuery: function (q) { App.state.paySearch = q; },\n        owingFilter: true, onlyOwing: App.state.payOnlyOwing, onOwing: function (v) { App.state.payOnlyOwing = v; },\n        actionLabel: 'รับเงิน', actionIcon: 'cash',\n      }))));\n  }\n\n  // ---------------------------------------------------------------------------\n  // รับชำระเงิน: ขั้นที่ 2 บันทึกการรับเงิน\n  // ---------------------------------------------------------------------------\n  function renderForm(ctx) {\n    var s = ctx.student;\n    var requestKey = App.newRequestKey(); // ใช้ค่าเดิมเมื่อกดบันทึกซ้ำ ระบบจึงไม่บันทึกซ้ำ\n    var head = App.pageHead('รับชำระเงิน: ' + s.fullName,\n      'เลขประจำตัว ' + s.studentNo + (s.classLabel ? ' · ชั้น ' + s.classLabel : '') + ' · ยอดค้างทั้งหมด ' + money(ctx.outstandingSatang), [\n        button('เลือกนักเรียนคนอื่น', 'secondary', function () { App.go('payments'); }, 'arrowLeft'),\n        button('บัญชีนักเรียน', 'secondary', function () {\n          App.go('student-account', { studentId: s.studentId, back: 'payments', backParams: { studentId: s.studentId } });\n        }, 'user'),\n      ]);\n    if (!ctx.items.length) {\n      return h('div', null, head, h('div', { class: 'alert alert-success', style: { marginBottom: '16px' }, text: 'นักเรียนคนนี้ไม่มียอดค้างชำระ' }),\n        recentPayments(ctx.recentPayments));\n    }\n    if (!ctx.book || ctx.book.nextNo === null) return h('div', null, head, bookBanner(ctx.book, ctx.strict));\n\n    var amount = App.field({ label: 'จำนวนเงินที่รับ (บาท)', required: true, inputmode: 'decimal', placeholder: '0.00' });\n    amount.input.classList.add('amount-input');\n    var fillAll = button('รับเต็มยอดค้าง ' + formatSatang_(ctx.outstandingSatang) + ' บาท', 'secondary btn-sm', function () {\n      amount.input.value = formatSatang_(ctx.outstandingSatang);\n      onAmount();\n    });\n    var date = App.field({ label: 'วันที่รับเงิน', type: 'date', required: true, value: ctx.today, max: ctx.today });\n    var channel = App.field({ label: 'ช่องทางการรับเงิน', type: 'select', required: true,\n      options: ctx.channels.map(function (c) { return { value: c, label: c }; }) });\n    var channelRef = App.field({ label: 'เลขอ้างอิงการโอน', required: true, maxlength: 100, help: 'เช่น เลขที่รายการจากสลิปโอนเงิน' });\n    var receivedBy = App.field({ label: 'ผู้รับเงิน', required: true, maxlength: 100, value: ctx.receivedByName });\n    var note = App.field({ label: 'หมายเหตุ', maxlength: 300 });\n    var bookNo = App.field({ label: 'เล่มที่', value: ctx.book.bookNo, disabled: true });\n    var receiptNo = App.field({ label: 'เลขที่ใบเสร็จ', type: 'number', required: true, value: ctx.book.nextNo, inputmode: 'numeric',\n      min: ctx.book.startNo, max: ctx.book.endNo, disabled: ctx.strict,\n      help: ctx.strict ? 'ระบบตั้งค่าให้ใช้เลขที่ถัดไปเท่านั้น' : 'เลขที่ถัดไปคือ ' + ctx.book.nextNo });\n    var spoiled = button('ใบเสร็จเลขที่ ' + ctx.book.nextNo + ' เขียนผิดหรือชำรุด? ยกเลิกเลขที่นี้', 'ghost btn-sm', function () {\n      App.openCancelNumberForm(ctx.book, ctx.book.nextNo, function () { App.go('payments', { studentId: s.studentId }); });\n    });\n    function syncChannel() { channelRef.wrap.classList.toggle('hidden', isCash(channel.get())); }\n    channel.input.addEventListener('change', syncChannel);\n    syncChannel();\n\n    var editor = allocationEditor(ctx.items, function () { update(); });\n    var sumLine = h('div', { class: 'sum-line', role: 'status' });\n    var preview = h('div', { class: 'receipt-preview' });\n    var errorBox = h('div', { class: 'alert alert-error hidden', role: 'alert' });\n    var confirmBox = h('input', { type: 'checkbox', id: 'confirm-receipt' });\n    var confirmLabel = h('label', { class: 'confirm-box', for: 'confirm-receipt' }, confirmBox, h('span', { text: ctx.confirmText }));\n    confirmBox.addEventListener('change', function () { if (confirmBox.checked) errorBox.classList.add('hidden'); });\n    var saveLabel = h('span', { text: 'บันทึกการรับเงิน' });\n    var saveBtn = h('button', { type: 'button', class: 'btn' }, App.icon('check'), saveLabel);\n    saveBtn.addEventListener('click', function () { save(false); });\n\n    function onAmount() {\n      editor.autoFill(parseSatang(amount.get()));\n      update();\n    }\n    amount.input.addEventListener('input', onAmount);\n    receiptNo.input.addEventListener('input', function () { update(); });\n\n    /** ตรวจยอดบนหน้าเว็บ (Server ตรวจซ้ำอีกครั้งเสมอ) */\n    function update() {\n      var a = parseSatang(amount.get());\n      var st = editor.check(a);\n      showSumLine(sumLine, st);\n      clear(preview);\n      preview.appendChild(h('h3', { text: 'รายการที่ต้องเขียนในใบเสร็จ เล่มที่ ' + ctx.book.bookNo + ' เลขที่ ' + (receiptNo.get() || '–') }));\n      if (!st.list.length) preview.appendChild(h('div', { class: 'muted', text: 'ยังไม่มีรายการ' }));\n      st.list.forEach(function (x, i) {\n        preview.appendChild(h('div', { class: 'receipt-line' }, h('span', { text: (i + 1) + '. ' + x.item.label }), h('span', { class: 'nowrap', text: money(x.satang) })));\n      });\n      if (st.list.length) {\n        preview.appendChild(h('div', { class: 'receipt-total' }, h('span', { text: 'รวมเงิน' }), h('span', { class: 'nowrap', text: money(st.sum) })));\n        preview.appendChild(h('div', { class: 'muted small', text: '(' + bahtText_(st.sum) + ')' }));\n      }\n      st.amount = a;\n      return st;\n    }\n\n    function save(confirmSkip) {\n      errorBox.classList.add('hidden');\n      var st = update();\n      if (!st.ok) return showError(errorBox, st.message);\n      if (!date.get()) return showError(errorBox, 'กรุณาระบุวันที่รับเงิน');\n      if (!isCash(channel.get()) && !channelRef.get().trim()) return showError(errorBox, 'กรุณากรอกเลขอ้างอิงการโอน');\n      if (!receivedBy.get().trim()) return showError(errorBox, 'กรุณากรอกชื่อผู้รับเงิน');\n      if (!confirmBox.checked) return showError(errorBox, 'กรุณาติ๊กยืนยันว่าได้ตรวจสอบใบเสร็จรับเงินฉบับจริงแล้ว');\n      saveBtn.disabled = true;\n      saveLabel.textContent = 'กำลังบันทึก…';\n      App.api('payments.create', {\n        requestKey: requestKey,\n        studentId: s.studentId,\n        paymentDate: date.get(),\n        amount: formatSatang_(st.amount),\n        channel: channel.get(),\n        channelRef: isCash(channel.get()) ? '' : channelRef.get(),\n        receivedByName: receivedBy.get(),\n        note: note.get(),\n        bookId: ctx.book.bookId,\n        receiptNo: Number(receiptNo.get()),\n        confirmPhysicalReceipt: true,\n        confirmSkipNumber: confirmSkip === true,\n        allocations: st.list.map(function (x) { return { assessmentId: x.item.assessmentId, amount: formatSatang_(x.satang) }; }),\n      }).then(function (res) {\n        showSuccess(s, res);\n      }).catch(function (err) {\n        saveBtn.disabled = false;\n        saveLabel.textContent = 'บันทึกการรับเงิน';\n        var reason = err && err.reason;\n        if (reason === 'RECEIPT_GAP_CONFIRM') {\n          App.confirm(err.message, { title: 'ยืนยันการข้ามเลขที่ใบเสร็จ', confirmLabel: 'ยืนยัน ใช้เลขที่นี้' })\n            .then(function (yes) { if (yes) save(true); });\n          return;\n        }\n        if (['RECEIPT_NO_TAKEN', 'BOOK_CHANGED', 'BALANCE_CHANGED', 'RECEIPT_STRICT'].indexOf(reason) !== -1) {\n          showError(errorBox, err.message, button('โหลดเลขที่และยอดล่าสุด', 'secondary btn-sm', function () { App.go('payments', { studentId: s.studentId }); }));\n          return;\n        }\n        if (err && err.code === 'NETWORK') {\n          showError(errorBox, err.message + ' กดบันทึกอีกครั้งได้ ระบบจะไม่บันทึกซ้ำ');\n          return;\n        }\n        showError(errorBox, (err && err.message) || 'บันทึกไม่สำเร็จ กรุณาลองใหม่');\n      });\n    }\n\n    update();\n    setTimeout(function () { amount.input.focus(); }, 0);\n    return h('div', null, head, bookBanner(ctx.book, ctx.strict),\n      h('div', { class: 'stack' },\n        h('div', { class: 'card' },\n          h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: '1. จำนวนเงินและการรับเงิน' })),\n          h('div', { class: 'card-body stack' },\n            h('div', { class: 'form-grid' }, amount.wrap, h('div', { class: 'field', style: { alignSelf: 'end' } }, fillAll),\n              date.wrap, channel.wrap, channelRef.wrap, receivedBy.wrap, note.wrap),\n            sumLine)),\n        h('div', { class: 'card' },\n          h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: '2. รายการที่ตัดชำระ (หนี้เก่าอยู่บนสุด)' })),\n          h('div', { class: 'card-body' }, editor.table)),\n        h('div', { class: 'card' },\n          h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: '3. ใบเสร็จรับเงิน' })),\n          h('div', { class: 'card-body stack' },\n            h('div', { class: 'form-grid' }, bookNo.wrap, receiptNo.wrap),\n            ctx.strict ? h('div', null, spoiled) : null,\n            preview, confirmLabel, errorBox,\n            h('div', { class: 'toolbar', style: { justifyContent: 'flex-end', marginBottom: '0' } }, saveBtn))),\n        recentPayments(ctx.recentPayments)));\n  }\n\n  /** ผลการบันทึก: แสดงแทนฟอร์ม */\n  function showSuccess(s, res) {\n    var p = res.payment;\n    var allocated = {};\n    p.allocations.forEach(function (al) { allocated[al.assessmentId] = al.amountSatang; });\n    var node = h('div', null,\n      App.pageHead('บันทึกการรับเงินเรียบร้อย', s.fullName + ' · เลขประจำตัว ' + s.studentNo),\n      h('div', { class: 'stack' },\n        res.duplicate ? h('div', { class: 'alert alert-info', text: 'รายการนี้ถูกบันทึกไว้แล้วก่อนหน้า ระบบไม่บันทึกซ้ำ' }) : null,\n        res.warnings.map(function (w) { return h('div', { class: 'alert alert-warning', text: w }); }),\n        h('div', { class: 'card' }, h('div', { class: 'card-body' },\n          h('table', { class: 'kv' }, h('tbody', null,\n            kvRow('ใบเสร็จ', h('span', { class: 'strong', text: receiptLabel(p) })),\n            kvRow('วันที่รับเงิน', App.fmt.dateLong(p.date)),\n            kvRow('จำนวนเงิน', [h('div', { class: 'strong', text: money(p.amountSatang) }), h('div', { class: 'muted small', text: '(' + bahtText_(p.amountSatang) + ')' })]),\n            kvRow('ช่องทาง', p.channel + (p.channelRef ? ' (' + p.channelRef + ')' : '')),\n            kvRow('ผู้รับเงิน', p.receivedByName),\n            p.note ? kvRow('หมายเหตุ', p.note) : null)),\n          h('h3', { style: { margin: '16px 0 8px' }, text: 'รายการที่ตัดชำระ' }),\n          App.table({\n            rows: res.assessments,\n            columns: [\n              { label: 'รายการ', key: 'label' },\n              { label: 'ตัดชำระครั้งนี้', className: 'num', render: function (a) { return formatSatang_(allocated[a.assessmentId] || 0); } },\n              { label: 'คงเหลือ', className: 'num', render: function (a) { return formatSatang_(a.outstandingSatang); } },\n              { label: 'สถานะ', render: function (a) { return App.badge(a.stateLabel, App.KIND.PAY_STATE[a.state]); } },\n            ],\n          }),\n          h('p', { class: 'strong', style: { marginTop: '12px' }, text: 'ยอดค้างคงเหลือทั้งหมดของนักเรียนคนนี้ ' + money(res.outstandingSatang) }),\n          h('div', { class: 'toolbar', style: { marginBottom: '0' } },\n            button('รับเงินรายถัดไป', '', function () { App.go('payments'); }, 'cash'),\n            res.outstandingSatang > 0 ? button('รับเงินจากนักเรียนคนนี้อีกครั้ง', 'secondary', function () { App.go('payments', { studentId: s.studentId }); }) : null,\n            button('ดูบัญชีนักเรียน', 'secondary', function () { App.go('student-account', { studentId: s.studentId }); }, 'user'))))));\n    var content = clear(document.getElementById('content'));\n    content.appendChild(node);\n    window.scrollTo(0, 0);\n    App.toast('บันทึกการรับเงิน ' + money(p.amountSatang) + ' ใบเสร็จ' + receiptLabel(p) + ' เรียบร้อยแล้ว', 'success');\n  }\n\n  App.defineRoute('payments', {\n    title: 'รับชำระเงิน',\n    roles: ['FINANCE'],\n    menu: { group: 'finance', label: 'รับชำระเงิน', icon: 'cash', order: 10 },\n    render: function (params) {\n      if (params.studentId) return App.api('payments.context', { studentId: params.studentId }).then(renderForm);\n      return Promise.all([App.api('payments.context'), App.api('ledger.students')]).then(function (res) {\n        return renderSearch(res[0], res[1]);\n      });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // ขอแก้ไขรายการรับเงินที่บันทึกผิด (ใบเสร็จจริงถูกต้อง เลขที่ใบเสร็จไม่เปลี่ยน)\n  // ---------------------------------------------------------------------------\n  function pickStudentForCorrection(paymentId) {\n    App.api('ledger.students').then(function (list) {\n      var modal = App.modal({\n        title: 'เลือกนักเรียนที่ถูกต้อง',\n        size: 'lg',\n        body: studentPicker(list, function (r) {\n          modal.close();\n          App.go('payment-correct', { paymentId: paymentId, studentId: r.studentId });\n        }, { actionLabel: 'เลือก' }),\n        actions: [{ label: 'ปิด', kind: 'secondary' }],\n      });\n    }).catch(App.fail);\n  }\n\n  App.defineRoute('payment-correct', {\n    title: 'ขอแก้ไขรายการรับเงิน',\n    roles: ['FINANCE'],\n    render: function (params) {\n      return App.api('payments.get', { paymentId: params.paymentId, studentId: params.studentId }).then(function (d) {\n        var p = d.payment;\n        var s = d.student;\n        var head = App.pageHead('ขอแก้ไขรายการรับเงิน ใบเสร็จ' + receiptLabel(p),\n          'ใช้เมื่อใบเสร็จฉบับจริงถูกต้อง แต่บันทึกในระบบผิด เลขที่ใบเสร็จไม่เปลี่ยน รายการเดิมยังมีผลจนกว่าจะได้รับอนุมัติ', [\n            button('กลับ', 'secondary', function () { App.go('student-account', { studentId: d.originalStudent.studentId }); }, 'arrowLeft'),\n          ]);\n        if (!d.canRequest) {\n          return h('div', null, head, h('div', { class: 'alert alert-warning', text: d.pendingRequest\n            ? 'รายการนี้มีคำขอ \"' + d.pendingRequest.typeLabel + '\" ที่รออนุมัติอยู่แล้ว'\n            : 'รายการนี้' + p.statusLabel + 'แล้ว จึงขอแก้ไขไม่ได้' }));\n        }\n        var original = h('div', { class: 'card' },\n          h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: 'รายการเดิม (ที่บันทึกไว้)' })),\n          h('div', { class: 'card-body' }, h('table', { class: 'kv' }, h('tbody', null,\n            kvRow('นักเรียน', d.originalStudent.fullName + ' (' + d.originalStudent.studentNo + ')'),\n            kvRow('วันที่รับเงิน', App.fmt.dateLong(p.date)),\n            kvRow('จำนวนเงิน', money(p.amountSatang)),\n            kvRow('ช่องทาง', p.channel + (p.channelRef ? ' (' + p.channelRef + ')' : '')),\n            kvRow('ผู้รับเงิน', p.receivedByName),\n            kvRow('หมายเหตุ', p.note),\n            kvRow('รายการที่ตัดชำระ', p.allocations.map(function (al) { return al.label + ' ' + formatSatang_(al.amountSatang); }).join(' / '))))));\n\n        var sameStudent = s.studentId === d.originalStudent.studentId;\n        var amount = App.field({ label: 'จำนวนเงินที่ถูกต้อง (บาท)', required: true, inputmode: 'decimal', value: sameStudent ? formatSatang_(p.amountSatang) : '' });\n        amount.input.classList.add('amount-input');\n        var date = App.field({ label: 'วันที่รับเงิน', type: 'date', required: true, value: p.date, max: d.today });\n        var channel = App.field({ label: 'ช่องทางการรับเงิน', type: 'select', required: true, value: p.channel,\n          options: d.channels.concat(d.channels.indexOf(p.channel) === -1 ? [p.channel] : []).map(function (c) { return { value: c, label: c }; }) });\n        var channelRef = App.field({ label: 'เลขอ้างอิงการโอน', required: true, maxlength: 100, value: p.channelRef });\n        var receivedBy = App.field({ label: 'ผู้รับเงิน', required: true, maxlength: 100, value: p.receivedByName });\n        var note = App.field({ label: 'หมายเหตุ', maxlength: 300, value: p.note });\n        var reason = App.field({ label: 'เหตุผลการแก้ไข', type: 'textarea', required: true, maxlength: 500, span2: true,\n          help: 'เช่น พิมพ์จำนวนเงินผิด เลือกนักเรียนผิดคน หรือเลือกรายการที่ตัดชำระผิด' });\n        function syncChannel() { channelRef.wrap.classList.toggle('hidden', isCash(channel.get())); }\n        channel.input.addEventListener('change', syncChannel);\n        syncChannel();\n        var sumLine = h('div', { class: 'sum-line', role: 'status' });\n        var editor = allocationEditor(d.items, function () { update(); });\n        var errorBox = h('div', { class: 'alert alert-error hidden', role: 'alert' });\n        function update() { var st = editor.check(parseSatang(amount.get())); showSumLine(sumLine, st); return st; }\n        amount.input.addEventListener('input', function () { editor.autoFill(parseSatang(amount.get())); update(); });\n        var submit = button('ส่งคำขอแก้ไข', '', function () {\n          errorBox.classList.add('hidden');\n          var st = update();\n          if (!st.ok) return showError(errorBox, st.message);\n          if (!reason.get().trim()) return showError(errorBox, 'กรุณากรอกเหตุผลการแก้ไข');\n          submit.disabled = true;\n          App.api('payments.requestCorrection', {\n            paymentId: p.paymentId,\n            studentId: s.studentId,\n            paymentDate: date.get(),\n            amount: amount.get(),\n            channel: channel.get(),\n            channelRef: isCash(channel.get()) ? '' : channelRef.get(),\n            receivedByName: receivedBy.get(),\n            note: note.get(),\n            reason: reason.get(),\n            allocations: st.list.map(function (x) { return { assessmentId: x.item.assessmentId, amount: formatSatang_(x.satang) }; }),\n          }).then(function (res) {\n            App.toast(res.message, 'success');\n            App.go('student-account', { studentId: d.originalStudent.studentId });\n          }).catch(function (err) {\n            submit.disabled = false;\n            showError(errorBox, (err && err.message) || 'ส่งคำขอไม่สำเร็จ');\n          });\n        }, 'check');\n        update();\n        return h('div', null, head,\n          h('div', { class: 'stack' },\n            original,\n            h('div', { class: 'card' },\n              h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: 'ข้อมูลที่ถูกต้อง' })),\n              h('div', { class: 'card-body stack' },\n                h('div', { class: 'banner', style: { padding: '0' } },\n                  h('div', null, h('div', { class: 'muted small', text: 'นักเรียน' }), h('div', { class: 'strong', text: s.fullName + ' (' + s.studentNo + ')' }),\n                    sameStudent ? null : h('div', { class: 'text-danger small', text: 'ย้ายการรับเงินจาก ' + d.originalStudent.fullName })),\n                  button('เปลี่ยนนักเรียน (บันทึกผิดคน)', 'secondary btn-sm', function () { pickStudentForCorrection(p.paymentId); }, 'user')),\n                h('div', { class: 'form-grid' }, amount.wrap, date.wrap, channel.wrap, channelRef.wrap, receivedBy.wrap, note.wrap),\n                editor.table,\n                sumLine,\n                h('div', { class: 'form-grid' }, reason.wrap),\n                errorBox,\n                h('div', { class: 'toolbar', style: { justifyContent: 'flex-end', marginBottom: '0' } }, submit)))));\n      });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // รายการรับเงินตามช่วงวันที่\n  // ---------------------------------------------------------------------------\n  App.defineRoute('payment-history', {\n    title: 'รายการรับเงิน',\n    roles: VIEW,\n    menu: { group: 'finance', label: 'รายการรับเงิน', icon: 'list', order: 20 },\n    render: function (params) {\n      return App.api('payments.list', { fromDate: params.fromDate, toDate: params.toDate }).then(function (data) {\n        var from = App.field({ label: 'ตั้งแต่วันที่', type: 'date', value: data.fromDate });\n        var to = App.field({ label: 'ถึงวันที่', type: 'date', value: data.toDate });\n        var show = button('แสดง', '', function () { App.go('payment-history', { fromDate: from.get(), toDate: to.get() }); }, 'search');\n        var today = todayIsoLocal();\n        var quick = h('div', { class: 'toolbar', style: { marginBottom: '12px' } },\n          button('วันนี้', 'secondary btn-sm', function () { App.go('payment-history', { fromDate: today, toDate: today }); }),\n          button('เดือนนี้', 'secondary btn-sm', function () { App.go('payment-history', { fromDate: today.slice(0, 8) + '01', toDate: today }); }));\n        var t = data.totals;\n        var summary = h('div', { class: 'toolbar', style: { gap: '8px', marginBottom: '12px' } },\n          App.badge(t.count + ' ฉบับ รวม ' + money(t.totalSatang), 'success'),\n          t.byChannel.map(function (c) { return App.badge(c.channel + ' ' + money(c.totalSatang), 'FINANCE'); }));\n        var period = data.fromDate === data.toDate ? 'วันที่ ' + App.fmt.dateLong(data.fromDate)\n          : App.fmt.dateLong(data.fromDate) + ' ถึง ' + App.fmt.dateLong(data.toDate);\n        return h('div', null,\n          App.pageHead('รายการรับเงิน', period + ' · เรียงตามวันที่และเลขที่ใบเสร็จ · ยอดรวมไม่นับใบเสร็จที่ยกเลิกหรือถูกแทน'),\n          h('div', { class: 'card' }, h('div', { class: 'card-body' },\n            h('div', { class: 'toolbar filter-bar' }, from.wrap, to.wrap, h('div', { class: 'field', style: { alignSelf: 'end' } }, show)),\n            quick, summary,\n            App.table({\n              rows: data.rows,\n              onRowClick: function (r) { App.openPaymentDetail(r.paymentId); },\n              empty: 'ไม่มีการรับเงินในช่วงวันที่นี้',\n              columns: [\n                { label: 'วันที่', className: 'nowrap', render: function (r) { return App.fmt.date(r.date); } },\n                { label: 'ใบเสร็จ', className: 'nowrap', render: receiptLabel },\n                { label: 'เลขประจำตัว', render: function (r) { return h('span', { class: 'mono', text: r.studentNo }); } },\n                { label: 'ชื่อ-นามสกุล', key: 'studentName' },\n                { label: 'จำนวนเงิน', className: 'num', render: function (r) {\n                  return h('span', { class: r.status === 'ACTIVE' ? 'strong' : 'muted', style: r.status === 'ACTIVE' ? null : { textDecoration: 'line-through' }, text: formatSatang_(r.amountSatang) });\n                } },\n                { label: 'ช่องทาง', render: function (r) { return [h('div', { text: r.channel }), r.channelRef ? h('div', { class: 'muted small', text: r.channelRef }) : null]; } },\n                { label: 'ผู้รับเงิน', key: 'receivedByName' },\n                { label: 'สถานะ', render: function (r) { return App.badge(r.statusLabel, App.KIND.ACTIVE[r.status]); } },\n              ],\n            }))));\n      });\n    },\n  });\n\n  /** วันที่วันนี้ตามเวลาเครื่อง (ใช้กับปุ่มลัดเท่านั้น Server ใช้เวลาของตนเอง) */\n  function todayIsoLocal() {\n    var d = new Date();\n    var pad = function (n) { return (n < 10 ? '0' : '') + n; };\n    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());\n  }\n\n  // ---------------------------------------------------------------------------\n  // ทะเบียนเล่มใบเสร็จ\n  // ---------------------------------------------------------------------------\n  function openBookForm(book) {\n    var editing = !!book;\n    App.formModal({\n      title: editing ? 'แก้ไขเล่มใบเสร็จ ' + book.bookNo : 'ลงทะเบียนเล่มใบเสร็จ',\n      intro: h('div', { class: 'alert alert-info', text: 'กรอกตามเล่มจริง: ตรวจเลขที่ใบแรกและใบสุดท้ายของเล่ม แก้ไขได้จนกว่าจะเริ่มใช้เล่ม' }),\n      fields: [\n        { key: 'bookNo', label: 'เลขเล่ม', required: true, maxlength: 30, value: editing ? book.bookNo : '', help: 'ตามที่พิมพ์บนเล่ม เช่น 12 หรือ 12/2569' },\n        { key: 'receivedDate', label: 'วันที่ได้รับเล่ม', type: 'date', value: editing ? book.receivedDate : '' },\n        { key: 'startNo', label: 'เลขที่ใบแรก', type: 'number', required: true, inputmode: 'numeric', min: 1, value: editing ? book.startNo : '' },\n        { key: 'endNo', label: 'เลขที่ใบสุดท้าย', type: 'number', required: true, inputmode: 'numeric', min: 1, value: editing ? book.endNo : '' },\n        { key: 'note', label: 'หมายเหตุ', maxlength: 300, span2: true, value: editing ? book.note : '' },\n      ],\n      submitLabel: editing ? 'บันทึก' : 'ลงทะเบียน',\n      onSubmit: function (v) {\n        var payload = { bookNo: v.bookNo, startNo: v.startNo, endNo: v.endNo, receivedDate: v.receivedDate, note: v.note };\n        if (editing) {\n          payload.bookId = book.bookId;\n          return App.api('receipts.updateBook', payload);\n        }\n        return App.api('receipts.registerBook', payload);\n      },\n      onDone: function (b) {\n        App.toast((editing ? 'บันทึกเล่มที่ ' : 'ลงทะเบียนเล่มที่ ') + b.bookNo + ' (เลขที่ ' + b.startNo + '–' + b.endNo + ') เรียบร้อยแล้ว', 'success');\n        App.refresh();\n      },\n    });\n  }\n\n  function activateBook(book) {\n    App.confirm('เปิดใช้เล่มที่ ' + book.bookNo + ' (เลขที่ ' + book.startNo + '–' + book.endNo + ') เป็นเล่มที่กำลังใช้? เปิดใช้ได้ครั้งละ 1 เล่ม และต้องใช้ให้ครบเล่มก่อนเปิดเล่มใหม่',\n      { title: 'เปิดใช้เล่มใบเสร็จ', confirmLabel: 'เปิดใช้เล่มนี้' }).then(function (yes) {\n      if (!yes) return;\n      App.api('receipts.activateBook', { bookId: book.bookId }).then(function (b) {\n        App.toast('เปิดใช้เล่มที่ ' + b.bookNo + ' แล้ว เลขที่ถัดไปคือ ' + b.nextNo, 'success');\n        App.refresh();\n      }).catch(App.fail);\n    });\n  }\n\n  function openCloseBook(book) {\n    App.formModal({\n      title: 'ขอปิดเล่มที่ ' + book.bookNo + ' ก่อนใช้ครบ',\n      intro: h('div', { class: 'alert alert-warning' },\n        h('div', { class: 'strong', text: 'เลขที่ที่ยังไม่ใช้ ' + book.remaining + ' ใบ จะเป็น \"ไม่ได้ใช้ (ปิดเล่ม)\" และนำกลับมาใช้ไม่ได้อีก' }),\n        h('div', { class: 'small', text: 'ต้องเก็บเล่มจริงพร้อมใบที่ไม่ได้ใช้ไว้ตรวจสอบ ถ้ามีคำขอยกเลิกเลขที่ในเล่มนี้ค้างอยู่ ต้องรอผลก่อน' })),\n      fields: [{ key: 'reason', label: 'เหตุผลการปิดเล่ม', type: 'textarea', required: true, span2: true, maxlength: 500, help: 'เช่น เล่มชำรุด เปียกน้ำ หรือสูญหายบางส่วน' }],\n      submitLabel: 'ส่งคำขอปิดเล่ม',\n      submitKind: 'danger',\n      onSubmit: function (v) { return App.api('receipts.requestCloseBook', { bookId: book.bookId, reason: v.reason }); },\n      onDone: function (res) {\n        App.toast(res.message, 'success');\n        App.refresh();\n      },\n    });\n  }\n\n  App.defineRoute('receipt-books', {\n    title: 'เล่มใบเสร็จ',\n    roles: VIEW,\n    menu: { group: 'finance', label: 'เล่มใบเสร็จ', icon: 'book', order: 40 },\n    render: function () {\n      return App.api('receipts.books').then(function (data) {\n        var active = data.books.filter(function (b) { return b.status === 'ACTIVE'; })[0] || null;\n        var columns = [\n          { label: 'เลขเล่ม', render: function (b) { return h('span', { class: 'strong', text: b.bookNo }); } },\n          { label: 'เลขที่', className: 'nowrap', render: function (b) { return b.startNo + '–' + b.endNo; } },\n          { label: 'สถานะ', render: function (b) {\n            return [App.badge(b.statusLabel, App.KIND.BOOK[b.status]), b.pendingRequest ? App.badge('รออนุมัติ: ' + b.pendingRequest.typeLabel, 'warning') : null];\n          } },\n          { label: 'ใช้แล้ว', className: 'num', render: function (b) { return String(b.usedCount); } },\n          { label: 'ยกเลิก', className: 'num', render: function (b) { return String(b.cancelledCount + b.pendingCount); } },\n          { label: 'คงเหลือ', className: 'num', render: function (b) {\n            if (b.status === 'CLOSED') return h('span', { class: 'muted', text: b.closedUnused + ' (ปิดเล่ม)' });\n            return h('span', { class: b.low ? 'text-danger strong' : '', text: String(b.remaining) });\n          } },\n          { label: 'เลขที่ถัดไป', className: 'num', render: function (b) { return b.nextNo === null ? '–' : h('span', { class: 'strong', text: String(b.nextNo) }); } },\n          { label: 'เริ่มใช้', className: 'nowrap', render: function (b) { return b.startUseDate ? App.fmt.date(b.startUseDate) : '–'; } },\n          { label: 'ผู้รับผิดชอบ', key: 'responsibleName' },\n        ];\n        if (data.canManage) {\n          columns.push({ label: 'จัดการ', className: 'actions', render: function (b) {\n            if (b.status !== 'REGISTERED' || b.pendingRequest) return null;\n            return [\n              !data.hasActive ? button('เปิดใช้', 'primary btn-sm', function () { activateBook(b); }, 'play') : null,\n              button('แก้ไข', 'secondary btn-sm', function () { openBookForm(b); }, 'edit'),\n            ];\n          } });\n        }\n        var notes = [];\n        if (!active) {\n          notes.push(h('div', { class: 'alert alert-warning', text: data.books.some(function (b) { return b.status === 'REGISTERED'; })\n            ? 'ยังไม่มีเล่มที่กำลังใช้ กด \"เปิดใช้\" ที่เล่มที่ต้องการใช้ก่อนรับเงิน'\n            : 'ยังไม่มีเล่มใบเสร็จ กด \"ลงทะเบียนเล่มใหม่\" แล้วกรอกเลขเล่มและเลขที่ตามเล่มจริง' }));\n        } else {\n          if (active.low) notes.push(h('div', { class: 'alert alert-warning', text: 'เล่มที่ ' + active.bookNo + ' เหลือ ' + active.remaining + ' ฉบับ กรุณาลงทะเบียนเล่มใหม่เตรียมไว้' }));\n          if (active.gaps.length) {\n            notes.push(h('div', { class: 'alert alert-warning', text: 'เลขที่ขาดช่วงในเล่มที่ ' + active.bookNo + ': ' + active.gaps.join(', ') +\n              ' (ยังไม่ได้บันทึกรับเงินและยังไม่ได้ยกเลิก ต้องตรวจสอบกับใบเสร็จจริง แล้วบันทึกหรือยกเลิกเลขที่นั้น)' }));\n          }\n        }\n        return h('div', null,\n          App.pageHead('ทะเบียนเล่มใบเสร็จรับเงิน', 'ระบบไม่ออกเลขใบเสร็จเอง ใช้เลขที่ตามเล่มจริงที่ลงทะเบียนไว้ เปิดใช้ได้ครั้งละ 1 เล่ม · คลิกเล่มเพื่อดูเลขที่ทุกใบ' +\n            (data.strict ? ' · ใช้เลขที่เรียงลำดับ' : ''),\n            data.canManage ? [button('ลงทะเบียนเล่มใหม่', '', function () { openBookForm(null); }, 'plus')] : []),\n          active ? bookBanner(active, data.strict) : null,\n          notes.length ? h('div', { class: 'stack', style: { marginBottom: '16px' } }, notes) : null,\n          h('div', { class: 'card' }, h('div', { class: 'card-body' }, App.table({\n            rows: data.books,\n            columns: columns,\n            onRowClick: function (b) { App.go('receipt-book', { bookId: b.bookId }); },\n            empty: 'ยังไม่มีเล่มใบเสร็จในระบบ',\n          }))));\n      });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // รายละเอียดเล่ม: ตารางเลขที่ทุกใบ\n  // ---------------------------------------------------------------------------\n  var NUMBER_ORDER = ['USED', 'CANCEL_PENDING', 'CANCELLED', 'GAP', 'UNUSED', 'CLOSED_UNUSED'];\n\n  function openNumber(data, n) {\n    var b = data.book;\n    var rows = [kvRow('สถานะ', App.badge(n.statusLabel, 'num-' + n.status))];\n    var actions = [{ label: 'ปิด', kind: 'secondary' }];\n    if (n.status === 'USED' || n.status === 'CANCEL_PENDING' || n.status === 'CANCELLED') {\n      if (n.studentName) rows.push(kvRow('นักเรียน', n.studentName + ' (' + n.studentNo + ')'));\n      if (n.amountSatang !== null && n.amountSatang !== undefined) rows.push(kvRow('จำนวนเงิน', money(n.amountSatang)));\n      if (n.date) rows.push(kvRow(n.paymentId ? 'วันที่รับเงิน' : 'วันที่บันทึก', App.fmt.dateLong(n.date)));\n      if (n.corrected) rows.push(kvRow('หมายเหตุ', 'มีการแก้ไขรายการที่บันทึกผิด (ใช้เลขที่ใบเสร็จเดิม)'));\n      if (n.cancelType) {\n        rows.push(kvRow('การยกเลิก', n.cancelTypeLabel));\n        rows.push(kvRow('เหตุผล', n.cancelReason));\n        rows.push(kvRow('ผู้ขอยกเลิก', n.cancelledBy + (n.decidedBy ? ' · พิจารณาโดย ' + n.decidedBy : '')));\n      }\n      if (n.pendingRequest) rows.push(kvRow('คำขอ', App.badge('รออนุมัติ: ' + n.pendingRequest.typeLabel, 'warning')));\n      if (n.paymentId) {\n        actions.push({ label: 'ดูการรับเงิน', onClick: function (btn, close) { close(); App.openPaymentDetail(n.paymentId); } });\n      }\n    } else if (n.status === 'GAP') {\n      rows.push(kvRow('คำอธิบาย', 'เลขที่นี้ยังไม่ได้บันทึกรับเงินและยังไม่ได้ยกเลิก แต่มีเลขที่สูงกว่าถูกใช้แล้ว ต้องตรวจกับใบเสร็จจริง แล้วบันทึกรับเงินหรือยกเลิกเลขที่นี้'));\n    } else if (n.status === 'CLOSED_UNUSED') {\n      rows.push(kvRow('คำอธิบาย', 'เล่มนี้ปิดก่อนใช้ครบ เลขที่นี้ใช้ไม่ได้อีก' + (b.closeReason ? ' (เหตุผล: ' + b.closeReason + ')' : '')));\n    }\n    if (data.canManage && b.status === 'ACTIVE' && (n.status === 'UNUSED' || n.status === 'GAP')) {\n      actions.push({ label: 'ยกเลิกเลขที่นี้ (เขียนผิด/ชำรุด)', kind: 'danger', onClick: function (btn, close) {\n        close();\n        App.openCancelNumberForm(b, n.no);\n      } });\n    }\n    App.modal({ title: 'เล่มที่ ' + b.bookNo + ' เลขที่ ' + n.no, body: h('table', { class: 'kv' }, h('tbody', null, rows)), actions: actions });\n  }\n\n  App.defineRoute('receipt-book', {\n    title: 'เลขที่ใบเสร็จในเล่ม',\n    roles: VIEW,\n    render: function (params) {\n      return App.api('receipts.book', { bookId: params.bookId }).then(function (data) {\n        var b = data.book;\n        var counts = {};\n        data.numbers.forEach(function (n) { counts[n.status] = (counts[n.status] || 0) + 1; });\n        var labels = {};\n        data.numbers.forEach(function (n) { labels[n.status] = n.statusLabel; });\n        var legend = h('div', { class: 'toolbar', style: { gap: '8px', marginBottom: '12px' } },\n          NUMBER_ORDER.filter(function (k) { return counts[k]; }).map(function (k) { return App.badge(labels[k] + ' ' + counts[k], 'num-' + k); }));\n        var gridEl = h('div', { class: 'number-grid', role: 'list', 'aria-label': 'เลขที่ใบเสร็จทุกใบในเล่ม' }, data.numbers.map(function (n) {\n          var cell = h('button', { type: 'button', class: 'num-cell num-' + n.status + (n.corrected ? ' num-corrected' : ''), role: 'listitem',\n            title: n.no + ': ' + n.statusLabel + (n.studentName ? ' · ' + n.studentName : ''), 'aria-label': 'เลขที่ ' + n.no + ' ' + n.statusLabel, text: String(n.no) });\n          cell.addEventListener('click', function () { openNumber(data, n); });\n          return cell;\n        }));\n        var actions = [button('กลับ', 'secondary', function () { App.go('receipt-books'); }, 'arrowLeft')];\n        if (data.canManage && b.status === 'ACTIVE') {\n          actions.push(button('ยกเลิกเลขที่', 'secondary', function () { App.openCancelNumberForm(b, null); }));\n        }\n        if (data.canManage && (b.status === 'ACTIVE' || b.status === 'REGISTERED') && !b.pendingRequest && b.remaining > 0) {\n          actions.push(button('ขอปิดเล่มก่อนใช้ครบ', 'danger', function () { openCloseBook(b); }));\n        }\n        var notes = [];\n        if (b.pendingRequest) notes.push(h('div', { class: 'alert alert-warning', text: 'มีคำขอ \"' + b.pendingRequest.typeLabel + '\" ที่รออนุมัติ' }));\n        if (b.gaps.length) notes.push(h('div', { class: 'alert alert-warning', text: 'เลขที่ขาดช่วง: ' + b.gaps.join(', ') + ' ต้องตรวจกับใบเสร็จจริง แล้วบันทึกรับเงินหรือยกเลิกเลขที่นั้น' }));\n        if (b.status === 'CLOSED') notes.push(h('div', { class: 'alert alert-info', text: 'ปิดเล่มเมื่อ ' + App.fmt.dateLong(b.closedDate) + (b.closeReason ? ' เหตุผล: ' + b.closeReason : '') }));\n        return h('div', null,\n          App.pageHead('เล่มที่ ' + b.bookNo + ' (เลขที่ ' + b.startNo + '–' + b.endNo + ')',\n            b.statusLabel + (b.startUseDate ? ' · เริ่มใช้ ' + App.fmt.dateLong(b.startUseDate) : '') + (b.responsibleName ? ' · ผู้รับผิดชอบ ' + b.responsibleName : ''), actions),\n          h('div', { class: 'grid-cards' },\n            App.statCard('ใช้แล้ว', b.usedCount + ' ใบ'),\n            App.statCard('ยกเลิก', (b.cancelledCount + b.pendingCount) + ' ใบ', b.pendingCount ? 'รออนุมัติ ' + b.pendingCount + ' ใบ' : null),\n            b.status === 'CLOSED' ? App.statCard('ไม่ได้ใช้ (ปิดเล่ม)', b.closedUnused + ' ใบ') : App.statCard('คงเหลือ', b.remaining + ' ใบ', b.nextNo !== null ? 'เลขที่ถัดไป ' + b.nextNo : null),\n            App.statCard('เลขที่ขาดช่วง', b.gaps.length + ' ใบ', null, b.gaps.length ? 'danger' : null)),\n          notes.length ? h('div', { class: 'stack', style: { marginBottom: '16px' } }, notes) : null,\n          h('div', { class: 'card' }, h('div', { class: 'card-body' }, legend,\n            h('p', { class: 'muted small', text: 'คลิกเลขที่เพื่อดูรายละเอียด' + (data.canManage && b.status === 'ACTIVE' ? ' หรือยกเลิกเลขที่ที่เขียนผิด/ชำรุด' : '') }),\n            gridEl)));\n      });\n    },\n  });\n})();\n</script>\n",
  "JsReports": "<script>\n/* ==========================================================================\n   JsReports — รายงานแบบทางการ พิมพ์และบันทึกเป็น PDF ได้ (ระยะที่ 7, ข้อกำหนดข้อ 11)\n   - ตัวเลขทุกตัวมาจาก Server (Reports.gs, Closings.gs, Arrears.gs, Receipts.gs) หน้านี้จัดรูปแบบเท่านั้น\n   - เอกสารแสดงเป็นแผ่น A4 บนจอ และพิมพ์เฉพาะเนื้อเอกสาร (ปุ่ม เมนู ตัวกรองไม่ถูกพิมพ์)\n   - บันทึกเป็น PDF: กดปุ่ม \"พิมพ์ / บันทึก PDF\" แล้วเลือกปลายทาง \"บันทึกเป็น PDF\" ในหน้าต่างพิมพ์ของเบราว์เซอร์\n   - ทุกเอกสารพิมพ์วันเวลาที่ออกรายงาน ผู้ออกรายงาน และช่องลงนาม\n   ========================================================================== */\n(function () {\n  'use strict';\n  var h = App.h;\n  var clear = App.clear;\n  var button = App.button;\n  var amt = function (s) { return formatSatang_(s); };\n  var thaiDate = function (iso) { return iso ? formatThaiDate_(iso) : '–'; };\n  var DOTS = '.........................................';\n\n  // ==========================================================================\n  // ส่วนประกอบของเอกสาร\n  // ==========================================================================\n  function docHead(meta, title, sub, extra) {\n    return h('div', { class: 'doc-head' },\n      h('div', { class: 'doc-school', text: meta.school.name }),\n      meta.school.affiliation ? h('div', { class: 'small', text: meta.school.affiliation }) : null,\n      h('div', { class: 'doc-title', text: title }),\n      sub ? h('div', { class: 'doc-sub', text: sub }) : null,\n      extra || null);\n  }\n\n  function docFoot(meta, left) {\n    return h('div', { class: 'doc-foot' },\n      h('span', { text: left || '' }),\n      h('span', { text: 'ออกรายงานเมื่อ ' + formatThaiDateTime_(meta.generatedAt) + ' โดย ' + meta.generatedBy }));\n  }\n\n  function signs(list) {\n    return h('div', { class: 'doc-signs' }, list.map(function (s) {\n      return h('div', { class: 'doc-sign' },\n        h('div', { text: 'ลงชื่อ ' + DOTS + ' ' + s[0] }),\n        h('div', { text: '(' + (s[1] || DOTS) + ')' }),\n        h('div', { text: 'ตำแหน่ง ' + (s[2] || '..............................') }),\n        h('div', { text: 'วันที่ ........ / ........ / ........' }));\n    }));\n  }\n\n  function preparerAndDirector(meta) {\n    var s = meta.signers;\n    return signs([['ผู้จัดทำ', s.financeName, s.financePosition], ['ผู้ตรวจสอบ', '', ''], ['ผู้อำนวยการ', s.directorName, s.directorPosition]]);\n  }\n\n  /**\n   * ตารางในเอกสาร (ไม่แปลงเป็นการ์ดบนมือถือ เลื่อนซ้ายขวาได้แทน)\n   * columns: [{ label, className, render(row, index) }] / rows: [{ ..., _class }] / foot: [{ className, cells: [{ text, colspan, className }] }]\n   */\n  function docTable(columns, rows, foot, emptyText) {\n    var thead = h('thead', null, h('tr', null, columns.map(function (c) { return h('th', { class: c.headClass || c.className, text: c.label }); })));\n    var tbody = h('tbody');\n    if (!rows.length) {\n      tbody.appendChild(h('tr', null, h('td', { class: 'center', colspan: String(columns.length), text: emptyText || 'ไม่มีรายการ' })));\n    }\n    rows.forEach(function (row, i) {\n      var tr = h('tr', { class: row._class || null });\n      columns.forEach(function (c) {\n        var v = c.render ? c.render(row, i) : row[c.key];\n        var td = h('td', { class: c.className || null });\n        if (v instanceof Node) td.appendChild(v);\n        else if (Array.isArray(v)) v.forEach(function (x) { if (x) td.appendChild(x instanceof Node ? x : document.createTextNode(String(x))); });\n        else td.textContent = v === null || v === undefined || v === '' ? '–' : String(v);\n        tr.appendChild(td);\n      });\n      tbody.appendChild(tr);\n    });\n    var tfoot = foot && foot.length ? h('tfoot', null, foot.map(function (f) {\n      return h('tr', { class: f.className || 'total' }, f.cells.map(function (c) {\n        return h('td', { class: c.className || null, colspan: c.colspan ? String(c.colspan) : null, text: c.text });\n      }));\n    })) : null;\n    return h('div', { class: 'doc-scroll' }, h('table', { class: 'doc-table' }, thead, tbody, tfoot));\n  }\n\n  function line(label, value) {\n    return h('div', null, h('span', { class: 'strong', text: label + ' ' }), h('span', { text: value }));\n  }\n\n  /** หน้าโครงรายงาน: หัวหน้า (ไม่พิมพ์) ตัวกรอง (ไม่พิมพ์) และเอกสาร */\n  function reportPage(title, desc, filters, body, extraActions) {\n    var actions = [button('กลับหน้ารายงาน', 'ghost', function () { App.go('reports'); }, 'arrowLeft')]\n      .concat(extraActions || [])\n      .concat([button('พิมพ์ / บันทึก PDF', '', function () { window.print(); }, 'printer')]);\n    return h('div', { class: 'has-print-head' },\n      App.pageHead(title, desc, actions),\n      filters && filters.length ? h('div', { class: 'toolbar filter-bar no-print' }, filters) : null,\n      body);\n  }\n\n  function showButton(onClick) {\n    var b = button('แสดงรายงาน', 'secondary', onClick, 'search');\n    return h('div', { class: 'field', style: { flex: '0 0 auto', minWidth: '0', justifyContent: 'flex-end' } }, b);\n  }\n\n  function yearOptions(years) {\n    return years.map(function (y) { return { value: String(y.year), label: y.label + (y.isCurrent ? ' (ปัจจุบัน)' : '') }; });\n  }\n\n  // ---------------------------------------------------------------- ช่วงเวลา (D-18)\n  function periodFields(params, years, today) {\n    var p = params || {};\n    var fyNow = fiscalYearOfDate_(today);\n    var fyOptions = [];\n    for (var fy = fyNow; fy >= fyNow - 5; fy--) fyOptions.push({ value: String(fy), label: 'ปีงบประมาณ ' + fy });\n    var monthOptions = [];\n    var parts = today.split('-').map(Number);\n    for (var i = 0; i < 24; i++) {\n      var y = parts[0];\n      var m = parts[1] - i;\n      while (m < 1) { m += 12; y -= 1; }\n      var key = y + '-' + (m < 10 ? '0' : '') + m;\n      monthOptions.push({ value: key, label: formatThaiMonth_(key) });\n    }\n    var type = App.field({ label: 'ช่วงเวลา', type: 'select', value: p.periodType || 'academic', options: [\n      { value: 'academic', label: 'ปีการศึกษา' }, { value: 'fiscal', label: 'ปีงบประมาณ' },\n      { value: 'month', label: 'รายเดือน' }, { value: 'range', label: 'กำหนดวันที่เอง' }] });\n    var year = App.field({ label: 'ปีการศึกษา', type: 'select', options: yearOptions(years),\n      value: String(p.year || App.state.me.school.currentAcademicYear) });\n    var fiscal = App.field({ label: 'ปีงบประมาณ', type: 'select', options: fyOptions, value: String(p.fiscalYear || fyNow) });\n    var month = App.field({ label: 'เดือน', type: 'select', options: monthOptions, value: p.month || monthOptions[0].value });\n    var from = App.field({ label: 'ตั้งแต่วันที่', type: 'date', value: p.fromDate || today.slice(0, 8) + '01' });\n    var to = App.field({ label: 'ถึงวันที่', type: 'date', value: p.toDate || today });\n    function sync() {\n      var t = type.get();\n      year.wrap.classList.toggle('hidden', t !== 'academic');\n      fiscal.wrap.classList.toggle('hidden', t !== 'fiscal');\n      month.wrap.classList.toggle('hidden', t !== 'month');\n      from.wrap.classList.toggle('hidden', t !== 'range');\n      to.wrap.classList.toggle('hidden', t !== 'range');\n    }\n    type.input.addEventListener('change', sync);\n    sync();\n    return {\n      wraps: [type.wrap, year.wrap, fiscal.wrap, month.wrap, from.wrap, to.wrap],\n      get: function () {\n        var t = type.get();\n        var out = { periodType: t };\n        if (t === 'academic') out.year = Number(year.get());\n        if (t === 'fiscal') out.fiscalYear = Number(fiscal.get());\n        if (t === 'month') out.month = month.get();\n        if (t === 'range') { out.fromDate = from.get(); out.toDate = to.get(); }\n        return out;\n      },\n    };\n  }\n\n  function periodPayload(params) {\n    var p = params || {};\n    return { periodType: p.periodType, year: p.year, fiscalYear: p.fiscalYear, month: p.month, fromDate: p.fromDate, toDate: p.toDate };\n  }\n\n  // ==========================================================================\n  // หน้ารวมรายงาน\n  // ==========================================================================\n  var REPORTS = [\n    { route: 'report-daily', icon: 'cash', title: 'รายงานการรับเงินประจำวัน และปิดยอด', desc: 'เรียงตามเลขที่ใบเสร็จ ยอดแยกช่องทาง ช่องลงนาม และปิดยอดประจำวัน' },\n    { route: 'report-notices', icon: 'user', title: 'เอกสารแจ้งยอดเรียกเก็บเงิน', desc: 'หนังสือแจ้งผู้ปกครอง แยกคนละหน้า เลือกชั้นหรือห้องได้' },\n    { route: 'report-collections', params: { groupBy: 'room' }, icon: 'list', title: 'รายงานการรับเงินแยกตามห้อง', desc: 'เลือกปีการศึกษา ปีงบประมาณ รายเดือน หรือกำหนดวันที่เอง' },\n    { route: 'report-collections', params: { groupBy: 'grade' }, icon: 'list', title: 'รายงานการรับเงินแยกตามระดับชั้น', desc: 'ยอดรวมทุกกลุ่มเท่ากับเงินที่รับจริงในช่วงเวลา' },\n    { route: 'report-arrears', icon: 'alertCircle', title: 'รายงานยอดค้างชำระ', desc: 'สรุปรายชั้น/ห้อง และรายชื่อนักเรียนที่ค้างชำระ' },\n    { route: 'report-register', icon: 'book', title: 'รายงานทะเบียนคุมใบเสร็จ', desc: 'ทุกเลขที่ของเล่ม: ใช้แล้ว ยกเลิก และยังไม่ใช้' },\n    { route: 'report-cancelled', icon: 'x', title: 'รายงานใบเสร็จยกเลิก', desc: 'ยกเลิกใบเสร็จที่รับเงินแล้ว และเลขที่ที่เขียนผิดหรือชำรุด พร้อมผลการพิจารณา' },\n    { route: 'report-annual', icon: 'calendar', title: 'รายงานสรุปประจำปีการศึกษา', desc: 'การเรียกเก็บ ลดหย่อน/ยกเว้น การรับเงินรายเดือน และยอดค้าง' },\n    { route: 'report-receipt-usage', icon: 'book', title: 'รายงานการใช้ใบเสร็จประจำปีงบประมาณ', desc: 'ยกมา รับเข้า ใช้ ยกเลิก และคงเหลือของแต่ละเล่ม' },\n  ];\n\n  App.defineRoute('reports', {\n    title: 'รายงานและปิดยอด',\n    roles: ['FINANCE', 'DIRECTOR'],\n    menu: { group: 'finance', label: 'รายงานและปิดยอด', icon: 'printer', order: 60 },\n    render: function () {\n      return App.api('closings.list', {}).then(function (cl) {\n        var items = REPORTS.map(function (r) {\n          var b = h('button', { type: 'button', class: 'report-item' }, App.icon(r.icon),\n            h('span', null, h('span', { class: 'ri-title', text: r.title }), h('span', { class: 'ri-desc', text: r.desc })));\n          b.addEventListener('click', function () { App.go(r.route, r.params || {}); });\n          return b;\n        });\n        return h('div', null,\n          App.pageHead('รายงานและปิดยอด', 'เลือกรายงานที่ต้องการ ทุกรายงานพิมพ์หรือบันทึกเป็น PDF ได้ (ในหน้าต่างพิมพ์ เลือกปลายทาง \"บันทึกเป็น PDF\")'),\n          cl.unclosedCount ? h('div', { class: 'alert alert-warning', style: { marginBottom: '14px' } },\n            h('span', { text: 'มีวันที่รับเงินแล้วแต่ยังไม่ปิดยอด ' + cl.unclosedCount + ' วัน (30 วันล่าสุด) ' }),\n            button('ดูรายการ', 'ghost btn-sm', function () { App.go('report-daily'); })) : null,\n          h('div', { class: 'report-grid' }, items));\n      });\n    },\n  });\n\n  // ==========================================================================\n  // 2. รายงานการรับเงินประจำวัน + ปิดยอด\n  // ==========================================================================\n  function openCloseDay(r) {\n    var f = r.figures;\n    App.formModal({\n      title: 'ปิดยอดวันที่ ' + thaiDate(r.date),\n      submitLabel: 'ปิดยอด',\n      intro: h('div', null,\n        h('div', { class: 'doc-lines' },\n          line('ใบเสร็จที่มีผล', f.receiptCount + ' ฉบับ' + (f.receiptRange ? ' (' + f.receiptRange + ')' : '')),\n          line('ยอดรวม', App.fmt.money(f.totalSatang) + ' (' + f.totalText + ')'),\n          f.byChannel.length ? line('แยกตามช่องทาง', f.byChannel.map(function (c) { return c.channel + ' ' + App.fmt.money(c.satang); }).join(' · ')) : null,\n          line('รหัสตรวจสอบ', f.verifyCode)),\n        h('div', { class: 'alert alert-warning', text: 'ตรวจนับเงินและสำเนาใบเสร็จให้ตรงกับรายงานก่อนปิดยอด หลังปิดยอดจะบันทึกรับเงิน ขอยกเลิก หรือขอแก้ไขรายการของวันนี้ไม่ได้ ถ้าจำเป็นต้องให้ผู้อำนวยการเปิดยอดใหม่' })),\n      fields: [{ key: 'confirm', type: 'checkbox', label: r.confirmText, span2: true }],\n      onSubmit: function (v) {\n        return App.api('closings.close', { date: r.date, expectedDigest: f.digest, confirmChecked: v.confirm });\n      },\n      onDone: function (res) { App.toast(res.message, 'success'); App.refresh(); },\n    });\n  }\n\n  function openReopenDay(r) {\n    App.formModal({\n      title: 'เปิดยอดวันที่ ' + thaiDate(r.date) + ' ใหม่',\n      submitLabel: 'เปิดยอดใหม่',\n      submitKind: 'danger',\n      intro: 'ใช้เมื่อต้องแก้ไขรายการของวันที่ปิดยอดแล้ว เช่น ลืมบันทึกใบเสร็จ หรือต้องยกเลิกใบเสร็จ ประวัติการปิดยอดครั้งนี้ยังเก็บไว้ และเจ้าหน้าที่การเงินต้องปิดยอดใหม่หลังแก้ไข',\n      fields: [{ key: 'reason', type: 'textarea', label: 'เหตุผลการเปิดยอดใหม่', required: true, maxlength: 500, span2: true }],\n      onSubmit: function (v) { return App.api('closings.reopen', { date: r.date, reason: v.reason }); },\n      onDone: function (res) { App.toast(res.message, 'success'); App.refresh(); },\n    });\n  }\n\n  function dailyDoc(r) {\n    var f = r.figures;\n    var c = r.closing;\n    var draft = !c ? h('div', { class: 'doc-draft', text: 'ร่าง – ยังไม่ปิดยอด' }) : null;\n    var columns = [\n      { label: 'ที่', className: 'center', render: function (x, i) { return String(i + 1); } },\n      { label: 'เล่มที่/เลขที่', className: 'nowrap', render: function (x) { return x.bookNo + '/' + x.receiptNo; } },\n      { label: 'เลขประจำตัว', className: 'nowrap', render: function (x) { return x.studentNo; } },\n      { label: 'ชื่อ-สกุล', render: function (x) { return x.studentName; } },\n      { label: 'ชั้น', className: 'nowrap', render: function (x) { return x.classLabel; } },\n      { label: 'รายการ', render: function (x) {\n        if (x.status === 'VOIDED') return 'ยกเลิกใบเสร็จ: ' + (x.voidReason || '');\n        return x.items.join(', ') + (x.corrected ? ' (แก้ไขรายการแล้ว)' : '');\n      } },\n      { label: 'ช่องทาง', headClass: 'nowrap', render: function (x) { return x.channel + (x.channelRef ? ' ' + x.channelRef : ''); } },\n      { label: 'จำนวนเงิน (บาท)', className: 'num', render: function (x) { return h('span', { class: 'amt', text: amt(x.amountSatang) }); } },\n    ];\n    var rows = r.rows.map(function (x) { return Object.assign({ _class: x.status === 'VOIDED' ? 'void' : null }, x); });\n    var foot = [{ cells: [\n      { text: 'รวมใบเสร็จที่มีผล ' + f.receiptCount + ' ฉบับ' + (f.voidedCount ? ' (ยกเลิก ' + f.voidedCount + ' ฉบับ ไม่นับรวม)' : ''), colspan: 7 },\n      { text: amt(f.totalSatang), className: 'num' }] }];\n    var footLeft = c\n      ? 'ปิดยอดเมื่อ ' + formatThaiDateTime_(c.closedAt) + ' โดย ' + c.closedBy + ' · รหัสตรวจสอบ ' + c.verifyCode + ' · อ้างอิงประวัติ ' + c.auditAnchor\n      : 'ร่าง ยังไม่ปิดยอด · รหัสตรวจสอบ ณ ขณะพิมพ์ ' + f.verifyCode;\n    var s = r.meta.signers;\n    return h('div', { class: 'doc' },\n      docHead(r.meta, 'รายงานการรับเงินประจำวัน', 'วันที่ ' + thaiDate(r.date), draft),\n      docTable(columns, rows, foot, 'ไม่มีการรับเงินในวันนี้'),\n      h('div', { class: 'doc-lines' },\n        line('จำนวนเงินรวม (ตัวอักษร)', '(' + f.totalText + ')'),\n        f.byChannel.length ? line('แยกตามช่องทาง', f.byChannel.map(function (x) { return x.channel + ' ' + amt(x.satang) + ' บาท (' + x.count + ' ฉบับ)'; }).join(' · ')) : null,\n        f.receiptRange ? line('ใบเสร็จที่ใช้', f.receiptRange) : null,\n        r.spoiled.length ? line('เลขที่ที่ยกเลิกก่อนบันทึกรับเงิน (เขียนผิด/ชำรุด)', r.spoiled.map(function (x) {\n          return x.bookNo + '/' + x.receiptNo + ' (' + x.statusLabel + ')';\n        }).join(', ')) : null,\n        c && r.matches === false ? h('div', { class: 'text-danger strong', text: 'คำเตือน: รายการของวันนี้ไม่ตรงกับตอนปิดยอด (รหัสตรวจสอบปัจจุบัน ' + f.verifyCode + ') กรุณาตรวจสอบประวัติการใช้งาน' }) : null),\n      signs([['ผู้รับเงิน', s.financeName, s.financePosition], ['ผู้ตรวจสอบ', '', ''], ['ผู้อำนวยการ', s.directorName, s.directorPosition]]),\n      docFoot(r.meta, footLeft));\n  }\n\n  App.defineRoute('report-daily', {\n    title: 'รายงานการรับเงินประจำวัน',\n    roles: ['FINANCE', 'DIRECTOR'],\n    render: function (params) {\n      return Promise.all([App.api('reports.daily', { date: params.date || '' }), App.api('closings.list', {})]).then(function (res) {\n        var r = res[0];\n        var cl = res[1];\n        var dateField = App.field({ label: 'วันที่รับเงิน', type: 'date', value: r.date, max: r.today });\n        var c = r.closing;\n        var statusBadges = [];\n        if (c) statusBadges.push(App.badge('ปิดยอดแล้ว', 'success'), h('span', { class: 'muted small', text: 'เมื่อ ' + App.fmt.datetime(c.closedAt) + ' โดย ' + c.closedBy + ' · รหัสตรวจสอบ ' + c.verifyCode }));\n        else statusBadges.push(App.badge(r.rows.length ? 'ยังไม่ปิดยอด' : 'ไม่มีการรับเงิน', r.rows.length ? 'warning' : 'muted'));\n        if (r.history.length) statusBadges.push(App.badge('เคยเปิดยอดใหม่ ' + r.history.length + ' ครั้ง', 'muted'));\n        var actions = [];\n        if (r.canClose) actions.push(button('ปิดยอดวันนี้', '', function () { openCloseDay(r); }, 'check'));\n        if (r.canReopen) actions.push(button('เปิดยอดใหม่', 'danger', function () { openReopenDay(r); }));\n        var notes = [];\n        if (!c && r.pendingCount) notes.push(h('div', { class: 'alert alert-warning', text: 'มีคำขอยกเลิกหรือแก้ไขใบเสร็จของวันนี้รอผู้อำนวยการพิจารณา ' + r.pendingCount + ' รายการ จึงยังปิดยอดไม่ได้' }));\n        if (c && r.matches === false) notes.push(h('div', { class: 'alert alert-error', text: 'รายการรับเงินของวันนี้ไม่ตรงกับตอนปิดยอด (อาจมีการแก้ไขชีตโดยตรง) กรุณาให้ผู้ดูแลระบบตรวจประวัติการใช้งานและความถูกต้องของข้อมูล' }));\n        r.history.forEach(function (x) {\n          notes.push(h('div', { class: 'alert alert-info', text: 'เคยปิดยอดเมื่อ ' + App.fmt.datetime(x.closedAt) + ' (' + x.receiptCount + ' ฉบับ ' + App.fmt.money(x.totalSatang) + ') และผู้อำนวยการเปิดยอดใหม่เมื่อ ' + App.fmt.datetime(x.reopenedAt) + ' เหตุผล: ' + x.reopenReason }));\n        });\n        var days = App.table({\n          rows: cl.rows,\n          columns: [\n            { label: 'วันที่', className: 'nowrap', render: function (x) { return App.fmt.date(x.date); } },\n            { label: 'ใบเสร็จ', className: 'num', render: function (x) { return x.receiptCount + (x.voidedCount ? ' (ยกเลิก ' + x.voidedCount + ')' : ''); } },\n            { label: 'ยอดรวม', className: 'num', render: function (x) { return amt(x.totalSatang); } },\n            { label: 'สถานะ', render: function (x) {\n              if (x.changedAfterClose) return App.badge('ข้อมูลเปลี่ยนหลังปิดยอด', 'danger');\n              if (x.closed) return App.badge('ปิดยอดแล้ว', 'success');\n              return App.badge(x.date === cl.today ? 'วันนี้ ยังไม่ปิดยอด' : 'ยังไม่ปิดยอด', x.date === cl.today ? 'muted' : 'warning');\n            } },\n          ],\n          onRowClick: function (x) { App.go('report-daily', { date: x.date }); },\n          empty: 'ไม่มีการรับเงินใน 30 วันล่าสุด',\n        });\n        return reportPage('รายงานการรับเงินประจำวัน', 'ตรวจรายงานกับเงินและสำเนาใบเสร็จ พิมพ์ให้ผู้เกี่ยวข้องลงนาม แล้วปิดยอดประจำวัน',\n          [dateField.wrap, showButton(function () { App.go('report-daily', { date: dateField.get() }); })],\n          h('div', null,\n            h('div', { class: 'card no-print', style: { marginBottom: '14px' } }, h('div', { class: 'card-body' },\n              h('div', { class: 'status-line' }, statusBadges),\n              notes.length ? h('div', { class: 'stack', style: { marginTop: '10px' } }, notes) : null,\n              actions.length ? h('div', { class: 'toolbar', style: { marginTop: '12px', marginBottom: '0' } }, actions) : null)),\n            dailyDoc(r),\n            h('div', { class: 'card no-print' },\n              h('div', { class: 'card-head' }, h('h2', { class: 'section-title', text: 'สถานะการปิดยอด 30 วันล่าสุด' })),\n              h('div', { class: 'card-body' }, days))));\n      });\n    },\n  });\n\n  // ==========================================================================\n  // 3–4. รายงานการรับเงินแยกตามห้อง / ระดับชั้น\n  // ==========================================================================\n  function collectionsDoc(r, groupBy) {\n    var rows = [];\n    var multiYear = r.years.length > 1;\n    r.grades.forEach(function (g) {\n      var yearNote = multiYear ? ' (ปีการศึกษา ' + g.year + ')' : '';\n      if (groupBy === 'room') {\n        g.rooms.forEach(function (x) { rows.push({ label: x.label + yearNote, students: x.students, receipts: x.receipts, satang: x.satang }); });\n        if (g.rooms.length > 1) rows.push({ _class: 'sub', label: 'รวม ' + g.label + yearNote, students: g.students, receipts: g.receipts, satang: g.satang, sub: true });\n      } else {\n        rows.push({ label: g.label + yearNote, students: g.students, receipts: g.receipts, satang: g.satang });\n      }\n    });\n    var seq = 0;\n    var columns = [\n      { label: 'ที่', className: 'center', render: function (x) { return x.sub ? '' : String(++seq); } },\n      { label: groupBy === 'room' ? 'ห้อง' : 'ระดับชั้น', render: function (x) { return x.label; } },\n      { label: 'จำนวนนักเรียน', className: 'num', render: function (x) { return String(x.students); } },\n      { label: 'จำนวนใบเสร็จ', className: 'num', render: function (x) { return String(x.receipts); } },\n      { label: 'จำนวนเงิน (บาท)', className: 'num', render: function (x) { return amt(x.satang); } },\n    ];\n    var foot = [{ cells: [\n      { text: 'รวมทั้งสิ้น', colspan: 2 },\n      { text: String(r.total.students), className: 'num' },\n      { text: String(r.total.receipts), className: 'num' },\n      { text: amt(r.total.satang), className: 'num' }] }];\n    var title = groupBy === 'room' ? 'รายงานการรับเงินแยกตามห้อง' : 'รายงานการรับเงินแยกตามระดับชั้น';\n    return h('div', { class: 'doc' },\n      docHead(r.meta, title, r.period.label + ' (' + r.period.rangeLabel + ')'),\n      docTable(columns, rows, foot, 'ไม่มีการรับเงินในช่วงเวลานี้'),\n      h('div', { class: 'doc-lines' },\n        line('จำนวนเงินรวม (ตัวอักษร)', '(' + r.total.text + ')'),\n        r.byChannel.length ? line('แยกตามช่องทาง', r.byChannel.map(function (x) { return x.channel + ' ' + amt(x.satang) + ' บาท (' + x.count + ' ฉบับ)'; }).join(' · ')) : null,\n        r.unallocatedSatang ? h('div', { class: 'text-danger strong', text: 'มียอดที่ไม่ได้ตัดชำระรายการใด ' + amt(r.unallocatedSatang) + ' บาท กรุณาตรวจสอบ' }) : null),\n      h('div', { class: 'doc-note', text: 'หมายเหตุ: นับตามวันที่รับเงิน เฉพาะใบเสร็จที่มีผล ชั้น/ห้องเป็นของรายการเรียกเก็บ ณ วันที่เรียกเก็บ ' +\n        'ยอดค้างจากปีก่อนที่รับในช่วงนี้แสดงพร้อมปีการศึกษาของรายการ ใบเสร็จ 1 ฉบับที่ชำระหลายรายการอาจนับในหลายกลุ่ม แต่ยอดรวมทั้งสิ้นนับไม่ซ้ำ' }),\n      preparerAndDirector(r.meta),\n      docFoot(r.meta, 'ข้อมูล ณ ' + formatThaiDateTime_(r.meta.generatedAt)));\n  }\n\n  App.defineRoute('report-collections', {\n    title: 'รายงานการรับเงินแยกตามห้องและระดับชั้น',\n    roles: ['FINANCE', 'DIRECTOR'],\n    render: function (params) {\n      var groupBy = params.groupBy === 'grade' ? 'grade' : 'room';\n      return Promise.all([App.api('reports.collections', periodPayload(params)), App.api('years.list')]).then(function (res) {\n        var r = res[0];\n        var period = periodFields(params, res[1], r.meta.generatedAt.slice(0, 10));\n        var by = App.field({ label: 'แยกตาม', type: 'select', value: groupBy, options: [{ value: 'room', label: 'ห้อง' }, { value: 'grade', label: 'ระดับชั้น' }] });\n        return reportPage(groupBy === 'room' ? 'รายงานการรับเงินแยกตามห้อง' : 'รายงานการรับเงินแยกตามระดับชั้น',\n          'เงินที่รับในช่วงเวลา แยกตามชั้นและห้องของรายการเรียกเก็บ',\n          [by.wrap].concat(period.wraps).concat([showButton(function () { App.go('report-collections', Object.assign(period.get(), { groupBy: by.get() })); })]),\n          collectionsDoc(r, groupBy));\n      });\n    },\n  });\n\n  // ==========================================================================\n  // 5. รายงานยอดค้างชำระ (แบบทางการ)\n  // ==========================================================================\n  App.defineRoute('report-arrears', {\n    title: 'รายงานยอดค้างชำระ',\n    roles: ['FINANCE', 'DIRECTOR'],\n    render: function (params) {\n      var year = params.year || App.state.me.school.currentAcademicYear;\n      return Promise.all([App.api('arrears.summary', { year: year }), App.api('years.list'), App.api('settings.get')]).then(function (res) {\n        var r = res[0];\n        var meta = { school: App.state.me.school, generatedAt: r.generatedAt, generatedBy: App.state.me.user.displayName, signers: signersFromSettings(res[2]) };\n        var grade = params.grade || '';\n        var yearSel = App.field({ label: 'ปีการศึกษา', type: 'select', options: yearOptions(res[1]), value: String(r.year) });\n        var gradeSel = App.field({ label: 'ชั้น', type: 'select', value: grade,\n          options: [{ value: '', label: 'ทุกชั้น' }].concat(r.grades.map(function (g) { return { value: g.gradeLevel, label: g.gradeLevel }; })) });\n        var summary = [];\n        r.grades.forEach(function (g) {\n          if (grade && g.gradeLevel !== grade) return;\n          summary.push({ label: g.gradeLevel, f: g, _class: 'sub' });\n          if (g.rooms.length > 1) g.rooms.forEach(function (x) { summary.push({ label: 'ห้อง ' + (x.room || '–'), f: x, _class: 'indent' }); });\n        });\n        if (!grade && r.other.students) summary.push({ label: 'ไม่มีชั้นเรียนในปีนี้ (ย้ายออก/จบการศึกษา)', f: r.other, _class: 'sub' });\n        var totals = grade ? r.grades.filter(function (g) { return g.gradeLevel === grade; })[0] : r.school;\n        var cols = [\n          { label: 'ชั้น/ห้อง', render: function (x) { return x.label; } },\n          { label: 'นักเรียน', className: 'num', render: function (x) { return String(x.f.students); } },\n          { label: 'ค้าง (คน)', className: 'num', render: function (x) { return String(x.f.owingStudents); } },\n          { label: 'ค้างปี ' + r.year, className: 'num', render: function (x) { return amt(x.f.currentSatang); } },\n          { label: 'ค้างจากปีก่อน', className: 'num', render: function (x) { return amt(x.f.priorSatang); } },\n          { label: 'รวมค้าง', className: 'num', render: function (x) { return amt(x.f.totalSatang); } },\n          { label: 'เลยกำหนด', className: 'num', render: function (x) { return amt(x.f.overdueSatang); } },\n        ];\n        var foot = totals ? [{ cells: [\n          { text: 'รวม' }, { text: String(totals.students), className: 'num' }, { text: String(totals.owingStudents), className: 'num' },\n          { text: amt(totals.currentSatang), className: 'num' }, { text: amt(totals.priorSatang), className: 'num' },\n          { text: amt(totals.totalSatang), className: 'num' }, { text: amt(totals.overdueSatang), className: 'num' }] }] : [];\n        var owing = r.rows.filter(function (x) { return x.totalSatang > 0 && (!grade || x.gradeLevel === grade); });\n        var listCols = [\n          { label: 'ที่', className: 'center', render: function (x, i) { return String(i + 1); } },\n          { label: 'ชั้น/ห้อง', className: 'nowrap', render: function (x) { return x.enrolled ? x.classLabel : '–'; } },\n          { label: 'เลขที่', className: 'center', render: function (x) { return x.classNo === null ? '–' : String(x.classNo); } },\n          { label: 'เลขประจำตัว', className: 'nowrap', render: function (x) { return x.studentNo; } },\n          { label: 'ชื่อ-สกุล', render: function (x) { return x.fullName + (!x.enrolled ? ' (' + x.statusLabel + ')' : ''); } },\n          { label: 'ค้างปีนี้', className: 'num', render: function (x) { return amt(x.currentSatang); } },\n          { label: 'ค้างจากปีก่อน', className: 'num', render: function (x) { return amt(x.priorSatang); } },\n          { label: 'รวมค้าง', className: 'num', render: function (x) { return amt(x.totalSatang); } },\n          { label: 'เลยกำหนด', className: 'num', render: function (x) { return amt(x.overdueSatang); } },\n        ];\n        var docEl = h('div', { class: 'doc' },\n          docHead(meta, 'รายงานยอดค้างชำระเงินบำรุงการศึกษา', 'ปีการศึกษา ' + r.year + (grade ? ' ชั้น ' + grade : '') + ' · ข้อมูล ณ ' + formatThaiDateTime_(r.generatedAt)),\n          h('div', { class: 'doc-section', text: '1. สรุปตามชั้นและห้อง' }),\n          docTable(cols, summary, foot),\n          h('div', { class: 'doc-section', text: '2. รายชื่อนักเรียนที่ค้างชำระ (' + owing.length + ' คน)' }),\n          docTable(listCols, owing, [], 'ไม่มีนักเรียนที่ค้างชำระ'),\n          h('div', { class: 'doc-note', text: 'หมายเหตุ: ค้างจากปีก่อน = รายการเรียกเก็บของปีการศึกษาก่อนหน้าที่ยังชำระไม่ครบ · เลยกำหนด = ยอดค้างของรายการที่เลยวันครบกำหนดชำระแล้ว' }),\n          preparerAndDirector(meta),\n          docFoot(meta, 'ยอด ณ ขณะออกรายงาน'));\n        return reportPage('รายงานยอดค้างชำระ', 'รายงานแบบทางการสำหรับพิมพ์และลงนาม (ดูรายละเอียดและค้นหารายชื่อได้ในหน้า \"ยอดค้างชำระ\")',\n          [yearSel.wrap, gradeSel.wrap, showButton(function () { App.go('report-arrears', { year: Number(yearSel.get()), grade: gradeSel.get() }); })],\n          docEl);\n      });\n    },\n  });\n\n  function signersFromSettings(s) {\n    var v = {};\n    ((s && s.groups) || []).forEach(function (g) { g.items.forEach(function (it) { v[it.key] = it.value; }); });\n    return {\n      financeName: v.FINANCE_OFFICER_NAME || '', financePosition: v.FINANCE_OFFICER_POSITION || '',\n      directorName: v.DIRECTOR_NAME || '', directorPosition: v.DIRECTOR_POSITION || '',\n    };\n  }\n\n  // ==========================================================================\n  // 6. รายงานทะเบียนคุมใบเสร็จ\n  // ==========================================================================\n  App.defineRoute('report-register', {\n    title: 'รายงานทะเบียนคุมใบเสร็จ',\n    roles: ['FINANCE', 'DIRECTOR'],\n    render: function (params) {\n      return Promise.all([App.api('receipts.books', {}), App.api('settings.get')]).then(function (res) {\n        var books = res[0].books || res[0].rows || res[0];\n        var settings = res[1];\n        if (!books.length) {\n          return reportPage('รายงานทะเบียนคุมใบเสร็จ', '', [], h('div', { class: 'empty', text: 'ยังไม่มีเล่มใบเสร็จในระบบ' }));\n        }\n        var bookId = params.bookId || (books.filter(function (b) { return b.status === 'ACTIVE'; })[0] || books[0]).bookId;\n        return App.api('receipts.book', { bookId: bookId }).then(function (r) {\n          var b = r.book;\n          var meta = { school: App.state.me.school, generatedAt: null, generatedBy: App.state.me.user.displayName, signers: signersFromSettings(settings) };\n          var bookSel = App.field({ label: 'เล่มใบเสร็จ', type: 'select', value: bookId,\n            options: books.map(function (x) { return { value: x.bookId, label: 'เล่มที่ ' + x.bookNo + ' (' + x.startNo + '–' + x.endNo + ') ' + x.statusLabel }; }) });\n          var rows = [];\n          var run = null;\n          function flush() {\n            if (!run) return;\n            rows.push({ _class: null, no: run.from === run.to ? String(run.from) : run.from + '–' + run.to, statusLabel: run.label, count: run.to - run.from + 1, range: true });\n            run = null;\n          }\n          r.numbers.forEach(function (n) {\n            if (n.status === 'UNUSED' || n.status === 'CLOSED_UNUSED') {\n              if (run && run.status === n.status && run.to === n.no - 1) { run.to = n.no; return; }\n              flush();\n              run = { from: n.no, to: n.no, status: n.status, label: n.statusLabel };\n              return;\n            }\n            flush();\n            rows.push(Object.assign({ _class: n.status === 'CANCELLED' ? 'void' : null }, n, { no: String(n.no) }));\n          });\n          flush();\n          var columns = [\n            { label: 'เลขที่', className: 'nowrap center', render: function (x) { return x.no; } },\n            { label: 'วันที่', className: 'nowrap', render: function (x) { return x.range ? '' : App.fmt.date(x.date); } },\n            { label: 'นักเรียน', render: function (x) { return x.range ? '' : (x.studentName ? x.studentName + (x.studentNo ? ' (' + x.studentNo + ')' : '') : ''); } },\n            { label: 'จำนวนเงิน (บาท)', className: 'num', render: function (x) { return x.range || x.amountSatang === null || x.amountSatang === undefined ? '' : h('span', { class: 'amt', text: amt(x.amountSatang) }); } },\n            { label: 'สถานะ', render: function (x) { return x.range ? x.statusLabel + ' (' + x.count + ' เลขที่)' : x.statusLabel + (x.corrected ? ' (แก้ไขรายการแล้ว)' : ''); } },\n            { label: 'หมายเหตุ', render: function (x) { return x.cancelReason ? x.cancelTypeLabel + ': ' + x.cancelReason : ''; } },\n          ];\n          var docEl = h('div', { class: 'doc' },\n            docHead(meta, 'ทะเบียนคุมใบเสร็จรับเงิน', 'เล่มที่ ' + b.bookNo + ' เลขที่ ' + b.startNo + ' ถึง ' + b.endNo + ' (' + b.total + ' ฉบับ) · สถานะ ' + b.statusLabel),\n            h('div', { class: 'doc-lines' },\n              line('ได้รับเล่ม', thaiDate(b.receivedDate) + (b.responsibleName ? ' · ผู้รับผิดชอบ ' + b.responsibleName : '')),\n              line('เริ่มใช้', thaiDate(b.startUseDate) + (b.closedDate ? ' · ปิดเล่ม ' + thaiDate(b.closedDate) + (b.closeReason ? ' (' + b.closeReason + ')' : '') : '')),\n              line('สรุป', 'ใช้แล้ว ' + b.usedCount + ' · ยกเลิก ' + b.cancelledCount + (b.pendingCount ? ' · รออนุมัติยกเลิก ' + b.pendingCount : '') +\n                ' · ยังไม่ใช้ ' + b.remaining + (b.closedUnused ? ' · ปิดเล่มโดยไม่ใช้ ' + b.closedUnused : '') + ' ฉบับ')),\n            docTable(columns, rows),\n            preparerAndDirector(meta),\n            h('div', { class: 'doc-foot' }, h('span', { text: 'เลขที่ที่ยังไม่ใช้ติดกันแสดงเป็นช่วง' }),\n              h('span', { text: 'ออกรายงานเมื่อ ' + formatThaiDateTime_(nowText()) + ' โดย ' + meta.generatedBy })));\n          return reportPage('รายงานทะเบียนคุมใบเสร็จ', 'ทุกเลขที่ของเล่ม เรียงตามเลขที่',\n            [bookSel.wrap, showButton(function () { App.go('report-register', { bookId: bookSel.get() }); })], docEl);\n        });\n      });\n    },\n  });\n\n  function nowText() {\n    var d = new Date();\n    var p = function (n) { return (n < 10 ? '0' : '') + n; };\n    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());\n  }\n\n  // ==========================================================================\n  // 7. รายงานใบเสร็จยกเลิก\n  // ==========================================================================\n  App.defineRoute('report-cancelled', {\n    title: 'รายงานใบเสร็จยกเลิก',\n    roles: ['FINANCE', 'DIRECTOR'],\n    render: function (params) {\n      return Promise.all([App.api('reports.cancelled', periodPayload(params)), App.api('years.list')]).then(function (res) {\n        var r = res[0];\n        var period = periodFields(params, res[1], r.meta.generatedAt.slice(0, 10));\n        var t = r.totals;\n        var columns = [\n          { label: 'ที่', className: 'center', render: function (x, i) { return String(i + 1); } },\n          { label: 'เล่มที่/เลขที่', className: 'nowrap', render: function (x) { return x.bookNo + '/' + x.receiptNo; } },\n          { label: 'ประเภท', render: function (x) { return x.cancelType === 'SPOILED' ? 'เขียนผิด/ชำรุด' : 'ยกเลิกใบเสร็จที่รับเงินแล้ว'; } },\n          { label: 'วันที่ในใบเสร็จ', className: 'nowrap', render: function (x) { return App.fmt.date(x.receiptDate); } },\n          { label: 'นักเรียน', render: function (x) { return x.studentName; } },\n          { label: 'จำนวนเงิน', className: 'num', render: function (x) { return x.amountSatang === null ? '' : amt(x.amountSatang); } },\n          { label: 'เหตุผล', render: function (x) { return x.reason; } },\n          { label: 'ผู้ขอ / วันที่ขอ', render: function (x) { return x.requestedBy + ' ' + App.fmt.date(x.requestedAt); } },\n          { label: 'ผลการพิจารณา', render: function (x) {\n            return x.statusLabel + (x.decidedBy ? ' โดย ' + x.decidedBy : '') + (x.decisionNote && x.status !== 'APPROVED' ? ' (' + x.decisionNote + ')' : '');\n          } },\n        ];\n        var docEl = h('div', { class: 'doc' },\n          docHead(r.meta, 'รายงานใบเสร็จยกเลิก', r.period.label + ' (' + r.period.rangeLabel + ')'),\n          docTable(columns, r.rows, [], 'ไม่มีการยกเลิกในช่วงเวลานี้'),\n          h('div', { class: 'doc-lines' },\n            line('ยกเลิกใบเสร็จที่รับเงินแล้ว (อนุมัติ)', t.voidCount + ' ฉบับ รวม ' + amt(t.voidSatang) + ' บาท'),\n            line('ยกเลิกเลขที่ที่เขียนผิด/ชำรุด (อนุมัติ)', t.spoiledCount + ' ฉบับ'),\n            line('รอพิจารณา', t.pendingCount + ' รายการ · ไม่อนุมัติหรือถอนคำขอ ' + t.notApprovedCount + ' รายการ')),\n          h('div', { class: 'doc-note', text: 'หมายเหตุ: นับตามวันที่ยื่นขอยกเลิก ใบเสร็จฉบับจริงที่ยกเลิกต้องเก็บไว้ครบทุกฉบับ' }),\n          preparerAndDirector(r.meta),\n          docFoot(r.meta, ''));\n        return reportPage('รายงานใบเสร็จยกเลิก', 'คำขอยกเลิกที่ยื่นในช่วงเวลา พร้อมผลการพิจารณา',\n          period.wraps.concat([showButton(function () { App.go('report-cancelled', period.get()); })]), docEl);\n      });\n    },\n  });\n\n  // ==========================================================================\n  // 8. รายงานสรุปประจำปีการศึกษา\n  // ==========================================================================\n  App.defineRoute('report-annual', {\n    title: 'รายงานสรุปประจำปีการศึกษา',\n    roles: ['FINANCE', 'DIRECTOR'],\n    render: function (params) {\n      var year = params.year || App.state.me.school.currentAcademicYear;\n      return Promise.all([App.api('reports.annual', { year: year }), App.api('years.list')]).then(function (res) {\n        var r = res[0];\n        var o = r.overall;\n        var pct = function (paid, net) { return net > 0 ? (Math.floor(paid * 1000 / net) / 10).toFixed(1) + '%' : '–'; };\n        var yearSel = App.field({ label: 'ปีการศึกษา', type: 'select', options: yearOptions(res[1]), value: String(r.year) });\n        var billCols = function (first) {\n          return [\n            first,\n            { label: 'จำนวนรายการ', className: 'num', render: function (x) { return String(x.count); } },\n            { label: 'ยอดเรียกเก็บ', className: 'num', render: function (x) { return amt(x.grossSatang); } },\n            { label: 'ลดหย่อน/ยกเว้น', className: 'num', render: function (x) { return amt(x.adjustSatang); } },\n            { label: 'สุทธิ', className: 'num', render: function (x) { return amt(x.netSatang); } },\n            { label: 'รับชำระแล้ว', className: 'num', render: function (x) { return amt(x.paidSatang); } },\n            { label: 'ร้อยละ', className: 'num', render: function (x) { return pct(x.paidSatang, x.netSatang); } },\n            { label: 'ค้างชำระ', className: 'num', render: function (x) { return amt(x.outstandingSatang); } },\n          ];\n        };\n        var totalFoot = function (label) {\n          return [{ cells: [{ text: label }, { text: String(o.count), className: 'num' }, { text: amt(o.grossSatang), className: 'num' },\n            { text: amt(o.adjustSatang), className: 'num' }, { text: amt(o.netSatang), className: 'num' }, { text: amt(o.paidSatang), className: 'num' },\n            { text: pct(o.paidSatang, o.netSatang), className: 'num' }, { text: amt(o.outstandingSatang), className: 'num' }] }];\n        };\n        var monthRows = r.months;\n        var docEl = h('div', { class: 'doc' },\n          docHead(r.meta, 'รายงานสรุปการจัดเก็บเงินบำรุงการศึกษา', 'ปีการศึกษา ' + r.year + ' · ข้อมูล ณ ' + formatThaiDateTime_(r.meta.generatedAt)),\n          h('div', { class: 'doc-section', text: '1. ภาพรวมการเรียกเก็บของปีการศึกษา ' + r.year }),\n          h('div', { class: 'doc-lines' },\n            line('นักเรียนที่มีรายการเรียกเก็บ', o.students + ' คน (' + o.count + ' รายการ)'),\n            line('ยอดเรียกเก็บ', amt(o.grossSatang) + ' บาท'),\n            line('ลดหย่อน', r.adjustments.DISCOUNT.count + ' รายการ ' + amt(r.adjustments.DISCOUNT.satang) + ' บาท · ยกเว้น ' + r.adjustments.EXEMPTION.count + ' รายการ ' + amt(r.adjustments.EXEMPTION.satang) + ' บาท'),\n            line('ยอดเรียกเก็บสุทธิ', amt(o.netSatang) + ' บาท'),\n            line('รับชำระแล้ว', amt(o.paidSatang) + ' บาท (' + pct(o.paidSatang, o.netSatang) + ')'),\n            line('ค้างชำระ', amt(o.outstandingSatang) + ' บาท' + (o.overdueSatang ? ' (เลยกำหนด ' + amt(o.overdueSatang) + ' บาท)' : '')),\n            r.cancelled.count ? line('รายการเรียกเก็บที่ยกเลิก (ไม่นับรวม)', r.cancelled.count + ' รายการ ' + amt(r.cancelled.grossSatang) + ' บาท') : null,\n            line('ยอดค้างจากปีการศึกษาก่อนหน้า ณ ขณะนี้', amt(r.priorOutstandingSatang) + ' บาท')),\n          h('div', { class: 'doc-section', text: '2. แยกตามระดับชั้น' }),\n          docTable(billCols({ label: 'ระดับชั้น', render: function (x) { return x.gradeLevel + ' (' + x.students + ' คน)'; } }), r.grades, totalFoot('รวม'), 'ยังไม่มีรายการเรียกเก็บ'),\n          h('div', { class: 'doc-section', text: '3. แยกตามรายการเรียกเก็บ' }),\n          docTable(billCols({ label: 'รายการ', render: function (x) { return x.label; } }), r.items, totalFoot('รวม'), 'ยังไม่มีรายการเรียกเก็บ'),\n          h('div', { class: 'doc-section', text: '4. เงินที่รับรายเดือน (ตามวันที่รับเงิน ' + r.period.rangeLabel + ')' }),\n          docTable([\n            { label: 'เดือน', render: function (x) { return x.label; } },\n            { label: 'จำนวนใบเสร็จ', className: 'num', render: function (x) { return String(x.count); } },\n            { label: 'จำนวนเงิน (บาท)', className: 'num', render: function (x) { return amt(x.satang); } },\n          ], monthRows, [{ cells: [{ text: 'รวม' }, { text: String(r.cash.count), className: 'num' }, { text: amt(r.cash.satang), className: 'num' }] }]),\n          h('div', { class: 'doc-lines' },\n            line('เงินที่รับเป็นของปีการศึกษา ' + r.year, amt(r.cash.thisYearSatang) + ' บาท'),\n            line('เงินที่รับเป็นยอดค้างของปีก่อนหน้า', amt(r.cash.priorSatang) + ' บาท'),\n            r.cash.laterSatang ? line('เงินที่รับเป็นของปีการศึกษาถัดไป', amt(r.cash.laterSatang) + ' บาท') : null),\n          h('div', { class: 'doc-section', text: '5. ใบเสร็จรับเงินในช่วงปีการศึกษา' }),\n          h('div', { class: 'doc-lines' },\n            line('ใบเสร็จที่มีผล', r.receipts.used + ' ฉบับ' + (r.receipts.books.length ? ' (เล่มที่ ' + r.receipts.books.join(', ') + ')' : '')),\n            line('ยกเลิกใบเสร็จที่รับเงินแล้ว', r.receipts.voided + ' ฉบับ · เลขที่ที่เขียนผิด/ชำรุด ' + r.receipts.spoiled + ' ฉบับ')),\n          h('div', { class: 'doc-note', text: 'หมายเหตุ: ข้อ 1–3 นับตามรายการเรียกเก็บของปีการศึกษา ส่วนข้อ 4–5 นับตามวันที่รับเงินในช่วง ' + r.period.rangeLabel + ' (D-39) ยอดค้างเป็นยอด ณ ขณะออกรายงาน' }),\n          preparerAndDirector(r.meta),\n          docFoot(r.meta, ''));\n        return reportPage('รายงานสรุปประจำปีการศึกษา', 'สรุปการเรียกเก็บ การรับเงิน และการใช้ใบเสร็จของปีการศึกษา',\n          [yearSel.wrap, showButton(function () { App.go('report-annual', { year: Number(yearSel.get()) }); })], docEl);\n      });\n    },\n  });\n\n  // ==========================================================================\n  // 9. รายงานการใช้ใบเสร็จประจำปีงบประมาณ (D-15)\n  // ==========================================================================\n  App.defineRoute('report-receipt-usage', {\n    title: 'รายงานการใช้ใบเสร็จประจำปีงบประมาณ',\n    roles: ['FINANCE', 'DIRECTOR'],\n    render: function (params) {\n      return App.api('reports.receiptUsage', { fiscalYear: params.fiscalYear || '' }).then(function (r) {\n        var fyNow = fiscalYearOfDate_(r.meta.generatedAt.slice(0, 10));\n        var opts = [];\n        for (var fy = fyNow; fy >= fyNow - 5; fy--) opts.push({ value: String(fy), label: 'ปีงบประมาณ ' + fy });\n        var fySel = App.field({ label: 'ปีงบประมาณ', type: 'select', options: opts, value: String(r.fiscalYear) });\n        var t = r.total;\n        var columns = [\n          { label: 'เล่มที่', className: 'nowrap', render: function (x) { return x.bookNo; } },\n          { label: 'เลขที่', className: 'nowrap', render: function (x) { return x.startNo + '–' + x.endNo; } },\n          { label: 'ยกมา', className: 'num', render: function (x) { return String(x.broughtForward); } },\n          { label: 'รับเข้า', className: 'num', render: function (x) { return String(x.received); } },\n          { label: 'ใช้', className: 'num', render: function (x) { return String(x.used); } },\n          { label: 'เลขที่ที่ใช้ในปี', className: 'nowrap', render: function (x) { return x.usedFrom === null ? '–' : (x.usedFrom === x.usedTo ? String(x.usedFrom) : x.usedFrom + '–' + x.usedTo); } },\n          { label: 'ยกเลิก', className: 'num', render: function (x) { return String(x.cancelled + x.pending) + (x.pending ? ' (รอ ' + x.pending + ')' : ''); } },\n          { label: 'ปิดเล่มไม่ใช้', className: 'num', render: function (x) { return String(x.closedUnused); } },\n          { label: 'คงเหลือ', className: 'num', render: function (x) { return String(x.remaining); } },\n          { label: 'สถานะเล่ม', render: function (x) { return x.statusLabel; } },\n        ];\n        var foot = [{ cells: [{ text: 'รวม', colspan: 2 }, { text: String(t.broughtForward), className: 'num' }, { text: String(t.received), className: 'num' },\n          { text: String(t.used), className: 'num' }, { text: '' }, { text: String(t.cancelled + t.pending), className: 'num' },\n          { text: String(t.closedUnused), className: 'num' }, { text: String(t.remaining), className: 'num' }, { text: '' }] }];\n        var docEl = h('div', { class: 'doc' },\n          docHead(r.meta, 'รายงานการใช้ใบเสร็จรับเงินประจำปีงบประมาณ ' + r.fiscalYear, r.period.rangeLabel + (r.asOf < r.period.to ? ' (ข้อมูลถึงวันที่ ' + thaiDate(r.asOf) + ')' : '')),\n          docTable(columns, r.rows, foot, 'ไม่มีเล่มใบเสร็จที่ใช้ในปีงบประมาณนี้'),\n          h('div', { class: 'doc-note', text: 'หมายเหตุ: ยกมา = เลขที่ที่ยังไม่ใช้ ณ ต้นปีงบประมาณ · คงเหลือ = ยกมา + รับเข้า − ใช้ − ยกเลิก − ปิดเล่มโดยไม่ใช้ ' +\n            '(ใบเสร็จใช้ต่อเนื่องข้ามปีงบประมาณได้ ตาม D-15) วันที่ของเลขที่ที่ยกเลิกก่อนบันทึกรับเงินใช้วันที่ยื่นคำขอ' }),\n          preparerAndDirector(r.meta),\n          docFoot(r.meta, ''));\n        return reportPage('รายงานการใช้ใบเสร็จประจำปีงบประมาณ', 'ปีงบประมาณ = 1 ตุลาคม ถึง 30 กันยายน',\n          [fySel.wrap, showButton(function () { App.go('report-receipt-usage', { fiscalYear: Number(fySel.get()) }); })], docEl);\n      });\n    },\n  });\n\n  // ==========================================================================\n  // 1. เอกสารแจ้งยอดเรียกเก็บเงิน (D-21: สุภาพ แจ้งให้ทราบ ไม่มีถ้อยคำเชิงบังคับ)\n  // ==========================================================================\n  function noticeLetter(n, r, signer) {\n    var meta = r.meta;\n    var school = meta.school;\n    var contact = school.phone ? ' โทร ' + school.phone : '';\n    var signName = signer === 'director' ? meta.signers.directorName : meta.signers.financeName;\n    var signPos = signer === 'director' ? meta.signers.directorPosition : meta.signers.financePosition;\n    var items = n.items.map(function (x, i) { return Object.assign({ no: i + 1 }, x); });\n    return h('div', { class: 'doc doc-letter page-break' },\n      h('div', { class: 'letter-head' },\n        h('div', { class: 'strong', text: school.name }),\n        school.address ? h('div', { text: school.address + contact }) : (contact ? h('div', { text: contact.trim() }) : null)),\n      h('div', { class: 'letter-date', text: 'วันที่ ' + thaiDate(r.issueDate) }),\n      h('div', { class: 'letter-meta' },\n        h('span', { class: 'strong', text: 'เรื่อง' }), h('span', { text: 'แจ้งยอดเงินบำรุงการศึกษา' }),\n        h('span', { class: 'strong', text: 'เรียน' }), h('span', { text: 'ผู้ปกครองของ ' + n.fullName + ' ชั้น ' + n.classLabel + (n.classNo ? ' เลขที่ ' + n.classNo : '') + ' เลขประจำตัว ' + n.studentNo })),\n      h('p', { text: school.name + ' ขอแจ้งรายการเงินบำรุงการศึกษาของนักเรียนที่ยังไม่ได้ชำระ ณ วันที่ ' + thaiDate(r.issueDate) + ' เพื่อโปรดทราบ ดังนี้' }),\n      docTable([\n        { label: 'ที่', className: 'center', render: function (x) { return String(x.no); } },\n        { label: 'รายการ', render: function (x) { return x.label; } },\n        { label: 'กำหนดชำระ', className: 'nowrap', render: function (x) { return x.dueDate ? thaiDate(x.dueDate) : '–'; } },\n        { label: 'ยอดเรียกเก็บ', className: 'num', render: function (x) { return amt(x.netSatang); } },\n        { label: 'ชำระแล้ว', className: 'num', render: function (x) { return amt(x.paidSatang); } },\n        { label: 'คงเหลือ (บาท)', className: 'num', render: function (x) { return amt(x.outstandingSatang); } },\n      ], items, [{ cells: [{ text: 'รวมยอดคงเหลือ', colspan: 5 }, { text: amt(n.totalSatang), className: 'num' }] }]),\n      h('div', { class: 'doc-lines', style: { textAlign: 'right' }, text: '(' + n.totalText + ')' }),\n      h('p', { text: 'หากท่านได้ชำระเงินแล้ว โรงเรียนขออภัยมา ณ ที่นี้ และขอความกรุณานำหลักฐานการชำระมาแจ้งเจ้าหน้าที่การเงิน เพื่อตรวจสอบและปรับปรุงข้อมูลให้ถูกต้อง' }),\n      h('p', { text: 'หากมีข้อสงสัย หรือมีความจำเป็นที่ต้องการปรึกษาเรื่องการชำระเงิน สามารถติดต่อเจ้าหน้าที่การเงินของโรงเรียนได้ในวันและเวลาราชการ' + contact }),\n      h('p', { text: 'จึงเรียนมาเพื่อโปรดทราบ และขอขอบพระคุณที่ให้การสนับสนุนการจัดการศึกษาของโรงเรียนด้วยดีเสมอมา' }),\n      h('div', { class: 'letter-sign' },\n        h('div', { text: 'ขอแสดงความนับถือ' }),\n        h('div', { style: { height: '42px' } }),\n        h('div', { text: '(' + (signName || DOTS) + ')' }),\n        h('div', { text: signPos || DOTS })));\n  }\n\n  App.defineRoute('report-notices', {\n    title: 'เอกสารแจ้งยอดเรียกเก็บเงิน',\n    roles: ['FINANCE', 'DIRECTOR'],\n    render: function (params) {\n      var year = params.year || App.state.me.school.currentAcademicYear;\n      var payload = { year: year, gradeLevel: params.gradeLevel || '', room: params.room || '', studentId: params.studentId || '' };\n      return Promise.all([App.api('reports.notices', payload), App.api('years.list'), App.api('students.list', { year: year })]).then(function (res) {\n        var r = res[0];\n        var roomsByGrade = res[2].rooms || {};\n        var grades = (res[2].gradeLevels || []).filter(function (g) { return roomsByGrade[g]; });\n        var yearSel = App.field({ label: 'ปีการศึกษา', type: 'select', options: yearOptions(res[1]), value: String(r.year) });\n        var gradeSel = App.field({ label: 'ชั้น', type: 'select', value: r.filter.gradeLevel,\n          options: [{ value: '', label: 'ทุกชั้น' }].concat(grades.map(function (g) { return { value: g, label: g }; })) });\n        var roomSel = App.field({ label: 'ห้อง', type: 'select' });\n        function fillRooms() {\n          clear(roomSel.input);\n          var rooms = roomsByGrade[gradeSel.get()] || [];\n          roomSel.input.appendChild(h('option', { value: '', text: gradeSel.get() ? 'ทุกห้อง' : '(เลือกชั้นก่อน)' }));\n          rooms.forEach(function (x) { roomSel.input.appendChild(h('option', { value: x, text: 'ห้อง ' + (x || '–') })); });\n          roomSel.input.value = rooms.indexOf(r.filter.room) !== -1 && gradeSel.get() === r.filter.gradeLevel ? r.filter.room : '';\n          roomSel.input.disabled = !gradeSel.get();\n        }\n        gradeSel.input.addEventListener('change', fillRooms);\n        fillRooms();\n        var signer = params.signer === 'director' ? 'director' : 'finance';\n        var signSel = App.field({ label: 'ผู้ลงนามในหนังสือ', type: 'select', value: signer,\n          options: [{ value: 'finance', label: 'เจ้าหน้าที่การเงิน' }, { value: 'director', label: 'ผู้อำนวยการ' }] });\n        var letters = r.notices.map(function (n) { return noticeLetter(n, r, signer); });\n        var info = h('div', { class: 'card no-print', style: { marginBottom: '14px' } }, h('div', { class: 'card-body' },\n          h('div', { class: 'status-line' },\n            App.badge(r.notices.length + ' ฉบับ', r.notices.length ? 'FINANCE' : 'muted'),\n            h('span', { class: 'muted', text: 'รวมยอดคงเหลือ ' + App.fmt.money(r.totalSatang) + ' · นักเรียน 1 คนต่อ 1 หน้า · เฉพาะผู้ที่มียอดค้าง (ไม่รวมผู้ที่ย้ายออก)' })),\n          h('div', { class: 'alert alert-info', style: { marginTop: '10px' },\n            text: 'ถ้อยคำในหนังสือนี้เป็นการแจ้งให้ทราบ ไม่มีข้อความเชิงบังคับหรือบทลงโทษนักเรียน ผู้อำนวยการควรตรวจถ้อยคำก่อนใช้ครั้งแรก (D-21) ' +\n              'ตรวจว่าตั้งค่าที่อยู่และเบอร์โทรศัพท์ของโรงเรียนไว้แล้ว (หน้าตั้งค่า)' })));\n        return reportPage('เอกสารแจ้งยอดเรียกเก็บเงิน', 'หนังสือแจ้งผู้ปกครอง ปีการศึกษา ' + r.year + ' (รวมยอดค้างจากปีก่อน)',\n          [yearSel.wrap, gradeSel.wrap, roomSel.wrap, signSel.wrap, showButton(function () {\n            App.go('report-notices', { year: Number(yearSel.get()), gradeLevel: gradeSel.get(), room: roomSel.get(), signer: signSel.get(), studentId: '' });\n          })],\n          h('div', null, info, letters.length ? letters : h('div', { class: 'empty', text: 'ไม่มีนักเรียนที่มียอดค้างตามเงื่อนไขนี้' })));\n      });\n    },\n  });\n})();\n</script>\n",
  "JsStudents": "<script>\n/* ==========================================================================\n   JsStudents — หน้าจอข้อมูลนักเรียน (ระยะที่ 3)\n   รายชื่อ / เพิ่ม / แก้ไข / เปลี่ยนสถานะ / นำเข้าจาก Excel-CSV / เลื่อนชั้นขึ้นปีใหม่\n   ========================================================================== */\n(function () {\n  'use strict';\n  var h = App.h;\n  var clear = App.clear;\n  var icon = App.icon;\n  var MANAGE = 'FINANCE';\n  var STATUS_OPTIONS = [\n    { value: 'STUDYING', label: 'กำลังศึกษา' },\n    { value: 'TRANSFERRED', label: 'ย้ายออก' },\n    { value: 'GRADUATED', label: 'จบการศึกษา' },\n  ];\n  var STATUS_KIND = { STUDYING: 'success', TRANSFERRED: 'warning', GRADUATED: 'muted' };\n\n  function canManage() { return App.state.me && App.state.me.user.role === MANAGE; }\n\n  function button(label, kind, onClick, iconName) {\n    var btn = h('button', { type: 'button', class: 'btn' + (kind ? ' btn-' + kind : '') }, iconName ? icon(iconName) : null, label);\n    btn.addEventListener('click', onClick);\n    return btn;\n  }\n\n  function todayIso() {\n    var d = new Date();\n    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');\n  }\n\n  function prefixOptions(current, suggestions) {\n    var list = [{ value: '', label: '(ไม่ระบุ)' }].concat((suggestions || []).map(function (p) { return { value: p, label: p }; }));\n    if (current && !list.some(function (o) { return o.value === current; })) list.push({ value: current, label: current });\n    return list;\n  }\n\n  App.state.studentFilters = App.state.studentFilters || { grade: '', room: '', status: 'STUDYING', q: '' };\n\n  // ---------------------------------------------------------------------------\n  // เพิ่ม / แก้ไข / เปลี่ยนสถานะ / รายละเอียด\n  // ---------------------------------------------------------------------------\n  function openStudentForm(ctx, student) {\n    var editing = !!student;\n    var openYears = ctx.years.filter(function (y) { return y.status === 'OPEN'; });\n    var fields = [\n      { key: 'studentNo', label: 'เลขประจำตัวนักเรียน', required: true, maxlength: 20, value: editing ? student.studentNo : '', inputmode: 'numeric' },\n      { key: 'prefix', label: 'คำนำหน้าชื่อ', type: 'select', options: prefixOptions(editing ? student.prefix : '', ctx.data.prefixSuggestions), value: editing ? student.prefix : '' },\n      { key: 'firstName', label: 'ชื่อ', required: true, maxlength: 100, value: editing ? student.firstName : '' },\n      { key: 'lastName', label: 'นามสกุล', maxlength: 100, value: editing ? student.lastName : '' },\n    ];\n    if (!editing) {\n      fields.push({ key: 'year', label: 'ปีการศึกษา', type: 'select', required: true, span2: true,\n        options: openYears.map(function (y) { return { value: String(y.year), label: y.label }; }),\n        value: String(openYears.some(function (y) { return y.year === ctx.data.year; }) ? ctx.data.year : (openYears[0] ? openYears[0].year : '')) });\n    }\n    fields.push(\n      // เพิ่มนักเรียนใหม่: ไม่เลือกชั้นให้เอง (กันบันทึกผิดชั้นโดยไม่รู้ตัว) ยกเว้นกำลังดูรายชื่อชั้นใดชั้นหนึ่งอยู่\n      { key: 'gradeLevel', label: 'ระดับชั้น', type: 'select', required: true,\n        options: (editing ? [] : [{ value: '', label: '— เลือกระดับชั้น —' }]).concat(ctx.data.gradeLevels.map(function (g) { return { value: g, label: g }; })),\n        value: editing ? student.gradeLevel : (App.state.studentFilters.grade || '') },\n      { key: 'room', label: 'ห้อง', maxlength: 10, value: editing ? student.room : (App.state.studentFilters.room || '1'), help: 'เช่น 1, 2 หรือ ก' },\n      { key: 'classNo', label: 'เลขที่', type: 'number', min: 1, max: 999, inputmode: 'numeric', value: editing && student.classNo !== null ? student.classNo : '' });\n\n    App.formModal({\n      title: editing ? 'แก้ไขข้อมูลนักเรียน' : 'เพิ่มนักเรียน',\n      intro: editing ? 'ชั้น ห้อง และเลขที่ ที่แก้ไขเป็นของปีการศึกษา ' + ctx.data.year + ' ข้อมูลปีอื่นไม่เปลี่ยน' : null,\n      fields: fields,\n      onSubmit: function (v) {\n        var payload = {\n          studentNo: v.studentNo, prefix: v.prefix, firstName: v.firstName, lastName: v.lastName,\n          gradeLevel: v.gradeLevel, room: v.room, classNo: v.classNo,\n        };\n        if (editing) {\n          payload.studentId = student.studentId;\n          payload.year = ctx.data.year;\n          return App.api('students.update', payload);\n        }\n        payload.year = v.year;\n        return App.api('students.create', payload).catch(function (err) {\n          if (err.reason !== 'NAME_DUPLICATE') throw err;\n          return App.confirm(err.message, { title: 'ชื่อซ้ำกับนักเรียนเดิม', confirmLabel: 'ยืนยัน เป็นคนละคน' }).then(function (ok) {\n            if (!ok) throw { message: 'ยังไม่ได้บันทึก: ' + err.message };\n            payload.confirmDuplicateName = true;\n            return App.api('students.create', payload);\n          });\n        });\n      },\n      onDone: function (s) {\n        App.toast((editing ? 'บันทึกข้อมูล ' : 'เพิ่มนักเรียน ') + s.fullName + ' เรียบร้อยแล้ว', 'success');\n        App.refresh();\n      },\n    });\n  }\n\n  function openStatusForm(ctx, student) {\n    App.formModal({\n      title: 'เปลี่ยนสถานะ: ' + student.fullName,\n      intro: 'ยอดค้างชำระ (ถ้ามี) ยังคงอยู่แม้นักเรียนย้ายออกหรือจบการศึกษา',\n      fields: [\n        { key: 'status', label: 'สถานะ', type: 'select', options: STATUS_OPTIONS, value: student.status },\n        { key: 'statusDate', label: 'วันที่', type: 'date', value: todayIso() },\n        { key: 'note', label: 'หมายเหตุ', type: 'textarea', span2: true, maxlength: 300, help: 'บังคับเมื่อย้ายออกหรือจบการศึกษา เช่น ย้ายไปโรงเรียนใด' },\n      ],\n      onSubmit: function (v) {\n        return App.api('students.setStatus', { studentId: student.studentId, year: ctx.data.year, status: v.status, statusDate: v.statusDate, note: v.note });\n      },\n      onDone: function (s) {\n        App.toast('เปลี่ยนสถานะ ' + s.fullName + ' เป็น' + s.statusLabel + 'แล้ว', 'success');\n        App.refresh();\n      },\n    });\n  }\n\n  function openStudentDetail(student) {\n    App.api('students.get', { studentId: student.studentId }).then(function (d) {\n      var s = d.student;\n      App.modal({\n        title: s.fullName,\n        size: 'lg',\n        body: [\n          h('table', { class: 'kv' }, h('tbody', null,\n            h('tr', null, h('th', { text: 'เลขประจำตัวนักเรียน' }), h('td', { text: s.studentNo })),\n            h('tr', null, h('th', { text: 'สถานะปัจจุบัน' }), h('td', null, App.badge(s.statusLabel, STATUS_KIND[s.status]))),\n            s.statusDate ? h('tr', null, h('th', { text: 'วันที่เปลี่ยนสถานะ' }), h('td', { text: App.fmt.dateLong(s.statusDate) })) : null,\n            s.statusNote ? h('tr', null, h('th', { text: 'หมายเหตุ' }), h('td', { text: s.statusNote })) : null)),\n          h('h3', { text: 'ประวัติชั้นเรียนทุกปีการศึกษา' }),\n          App.table({\n            rows: d.enrollments,\n            empty: 'ยังไม่มีข้อมูลชั้นเรียน',\n            columns: [\n              { label: 'ปีการศึกษา', key: 'year' },\n              { label: 'ชั้น/ห้อง', key: 'classLabel' },\n              { label: 'เลขที่', key: 'classNo' },\n              { label: 'สถานะ', render: function (e) { return App.badge(e.enrollStatusLabel, STATUS_KIND[e.enrollStatus]); } },\n              { label: 'หมายเหตุ', key: 'note' },\n            ],\n          }),\n        ],\n        actions: [\n          { label: 'ปิด', kind: 'secondary' },\n          { label: 'ดูบัญชีการเงิน', onClick: function (b, close) { close(); App.go('student-account', { studentId: s.studentId }); } },\n        ],\n      });\n    }).catch(App.fail);\n  }\n\n  // ---------------------------------------------------------------------------\n  // รายชื่อนักเรียน\n  // ---------------------------------------------------------------------------\n  App.defineRoute('students', {\n    title: 'นักเรียน',\n    roles: ['FINANCE', 'DIRECTOR'],\n    menu: { group: 'students', label: 'นักเรียน', icon: 'student' },\n    render: function (params) {\n      var year = params.year || App.state.studentYear || App.state.me.school.currentAcademicYear;\n      return Promise.all([App.api('students.list', { year: year }), App.api('years.list')]).then(function (res) {\n        var data = res[0];\n        var years = res[1];\n        App.state.studentYear = data.year;\n        var ctx = { data: data, years: years };\n        var f = App.state.studentFilters;\n        var yearSel = App.field({ label: 'ปีการศึกษา', type: 'select', value: String(data.year),\n          options: years.map(function (y) { return { value: String(y.year), label: y.label + (y.isCurrent ? ' (ปัจจุบัน)' : '') }; }) });\n        var gradeSel = App.field({ label: 'ระดับชั้น', type: 'select', value: f.grade,\n          options: [{ value: '', label: 'ทุกชั้น' }].concat(data.gradeLevels.map(function (g) { return { value: g, label: g }; })) });\n        var roomSel = App.field({ label: 'ห้อง', type: 'select' });\n        var statusSel = App.field({ label: 'สถานะ', type: 'select', value: f.status,\n          options: [{ value: '', label: 'ทุกสถานะ' }].concat(STATUS_OPTIONS) });\n        var search = App.field({ label: 'ค้นหา', placeholder: 'ชื่อ หรือเลขประจำตัว', value: f.q });\n        search.wrap.classList.add('filter-wide');\n        var summary = h('div', { class: 'toolbar', style: { gap: '8px', marginBottom: '12px' } });\n        var list = h('div');\n\n        function fillRooms() {\n          var rooms = f.grade ? (data.rooms[f.grade] || []) : [];\n          clear(roomSel.input);\n          roomSel.input.appendChild(h('option', { value: '', text: f.grade ? 'ทุกห้อง' : '(เลือกระดับชั้นก่อน)' }));\n          rooms.forEach(function (r) { roomSel.input.appendChild(h('option', { value: r, text: 'ห้อง ' + r })); });\n          if (rooms.indexOf(f.room) === -1) f.room = '';\n          roomSel.input.value = f.room;\n          roomSel.input.disabled = !f.grade;\n        }\n\n        function draw() {\n          var q = f.q.trim().toLowerCase().replace(/\\s+/g, '');\n          var rows = data.rows.filter(function (r) {\n            if (f.grade && r.gradeLevel !== f.grade) return false;\n            if (f.room && r.room !== f.room) return false;\n            if (f.status && r.enrollStatus !== f.status) return false;\n            if (q && (r.studentNo + r.fullName + r.firstName + r.lastName).toLowerCase().replace(/\\s+/g, '').indexOf(q) === -1) return false;\n            return true;\n          });\n          var counts = { STUDYING: 0, TRANSFERRED: 0, GRADUATED: 0 };\n          data.rows.forEach(function (r) { counts[r.enrollStatus] = (counts[r.enrollStatus] || 0) + 1; });\n          clear(summary);\n          summary.appendChild(App.badge('ทั้งหมด ' + data.rows.length + ' คน'));\n          STATUS_OPTIONS.forEach(function (o) { summary.appendChild(App.badge(o.label + ' ' + (counts[o.value] || 0), STATUS_KIND[o.value])); });\n          if (rows.length !== data.rows.length) summary.appendChild(App.badge('แสดง ' + rows.length + ' คน', 'FINANCE'));\n          var columns = [\n            { label: 'เลขประจำตัว', render: function (r) { return h('span', { class: 'mono', text: r.studentNo }); } },\n            { label: 'ชื่อ-นามสกุล', key: 'fullName' },\n            { label: 'ชั้น/ห้อง', key: 'classLabel', className: 'nowrap' },\n            { label: 'เลขที่', key: 'classNo' },\n            { label: 'สถานะ', render: function (r) { return App.badge(r.enrollStatusLabel, STATUS_KIND[r.enrollStatus]); } },\n          ];\n          if (canManage()) {\n            columns.push({ label: 'จัดการ', className: 'actions', render: function (r) {\n              return [\n                button('แก้ไข', 'secondary btn-sm', function () { openStudentForm(ctx, r); }, 'edit'),\n                button('สถานะ', 'secondary btn-sm', function () { openStatusForm(ctx, r); }, 'flag'),\n              ];\n            } });\n          }\n          clear(list).appendChild(App.table({\n            rows: rows,\n            columns: columns,\n            onRowClick: openStudentDetail,\n            empty: data.rows.length ? 'ไม่พบนักเรียนตามเงื่อนไข' : 'ยังไม่มีข้อมูลนักเรียนในปีการศึกษานี้' + (canManage() ? ' กด \"นำเข้าจาก Excel/CSV\" หรือ \"เพิ่มนักเรียน\"' : ''),\n          }));\n        }\n\n        yearSel.input.addEventListener('change', function () { App.go('students', { year: Number(yearSel.input.value) }); });\n        gradeSel.input.addEventListener('change', function () { f.grade = gradeSel.input.value; fillRooms(); draw(); });\n        roomSel.input.addEventListener('change', function () { f.room = roomSel.input.value; draw(); });\n        statusSel.input.addEventListener('change', function () { f.status = statusSel.input.value; draw(); });\n        search.input.addEventListener('input', function () { f.q = search.input.value; draw(); });\n        fillRooms();\n        draw();\n\n        var actions = canManage() ? [\n          button('เพิ่มนักเรียน', '', function () { openStudentForm(ctx, null); }, 'plus'),\n          button('นำเข้าจาก Excel/CSV', 'secondary', function () { App.go('students-import', { year: data.year }); }, 'upload'),\n          button('เลื่อนชั้นขึ้นปีใหม่', 'secondary', function () { App.go('students-promote', { fromYear: data.year }); }, 'arrowUp'),\n        ] : null;\n        return h('div', null,\n          h('div', { class: 'page-head' },\n            h('div', null, h('h1', { text: 'นักเรียน' }), h('p', { text: 'ปีการศึกษา ' + data.year + ' · คลิกชื่อเพื่อดูประวัติชั้นเรียน' })),\n            actions ? h('div', { class: 'toolbar', style: { marginBottom: '0' } }, actions) : null),\n          h('div', { class: 'card' }, h('div', { class: 'card-body' },\n            h('div', { class: 'toolbar filter-bar' }, yearSel.wrap, gradeSel.wrap, roomSel.wrap, statusSel.wrap, search.wrap),\n            summary, list)));\n      });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // อ่านไฟล์ Excel (.xlsx) ในเบราว์เซอร์ (ไม่ส่งไฟล์ออกไปที่ใด และไม่ใช้ไลบรารีภายนอก)\n  // ---------------------------------------------------------------------------\n  function u16(b, o) { return b[o] | (b[o + 1] << 8); }\n  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }\n\n  function inflateRaw(bytes) {\n    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('NO_DECOMPRESSION'));\n    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));\n    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });\n  }\n\n  function openZip(buf) {\n    var eocd = -1;\n    for (var i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {\n      if (u32(buf, i) === 0x06054b50) { eocd = i; break; }\n    }\n    if (eocd < 0) throw new Error('NOT_ZIP');\n    var count = u16(buf, eocd + 10);\n    var ptr = u32(buf, eocd + 16);\n    var entries = {};\n    var decoder = new TextDecoder('utf-8');\n    for (var n = 0; n < count; n++) {\n      if (u32(buf, ptr) !== 0x02014b50) throw new Error('BAD_ZIP');\n      var nameLen = u16(buf, ptr + 28);\n      var name = decoder.decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));\n      entries[name] = { method: u16(buf, ptr + 10), size: u32(buf, ptr + 20), offset: u32(buf, ptr + 42) };\n      ptr += 46 + nameLen + u16(buf, ptr + 30) + u16(buf, ptr + 32);\n    }\n    return {\n      has: function (name) { return Object.prototype.hasOwnProperty.call(entries, name); },\n      names: function () { return Object.keys(entries); },\n      read: function (name) {\n        var e = entries[name];\n        if (!e || u32(buf, e.offset) !== 0x04034b50) return Promise.reject(new Error('BAD_ZIP'));\n        var start = e.offset + 30 + u16(buf, e.offset + 26) + u16(buf, e.offset + 28);\n        var data = buf.subarray(start, start + e.size);\n        var raw = e.method === 0 ? Promise.resolve(data) : (e.method === 8 ? inflateRaw(data) : Promise.reject(new Error('BAD_ZIP')));\n        return raw.then(function (bytes) { return decoder.decode(bytes); });\n      },\n    };\n  }\n\n  function parseXml(text) {\n    var doc = new DOMParser().parseFromString(text, 'application/xml');\n    if (doc.getElementsByTagName('parsererror').length) throw new Error('BAD_XML');\n    return doc;\n  }\n  function byTag(node, tag) { return Array.prototype.slice.call(node.getElementsByTagNameNS('*', tag)); }\n  function columnIndex(ref) {\n    var letters = /^[A-Z]+/.exec(ref);\n    if (!letters) return -1;\n    var n = 0;\n    for (var i = 0; i < letters[0].length; i++) n = n * 26 + (letters[0].charCodeAt(i) - 64);\n    return n - 1;\n  }\n\n  /** อ่านแผ่นงานแรกของไฟล์ .xlsx เป็นตาราง (array ของแถว) */\n  App.readXlsx = function (file) {\n    var zip;\n    var sheetPath = 'xl/worksheets/sheet1.xml';\n    var shared = [];\n    return file.arrayBuffer().then(function (ab) {\n      zip = openZip(new Uint8Array(ab));\n      if (!zip.has('xl/workbook.xml')) return null;\n      return zip.read('xl/workbook.xml').then(function (wbText) {\n        var sheet = byTag(parseXml(wbText), 'sheet')[0];\n        var rid = sheet ? (sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')) : '';\n        if (!rid || !zip.has('xl/_rels/workbook.xml.rels')) return null;\n        return zip.read('xl/_rels/workbook.xml.rels').then(function (relText) {\n          byTag(parseXml(relText), 'Relationship').forEach(function (rel) {\n            if (rel.getAttribute('Id') !== rid) return;\n            var target = rel.getAttribute('Target') || '';\n            sheetPath = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\\.\\//, '');\n          });\n        });\n      });\n    }).then(function () {\n      if (!zip.has(sheetPath)) {\n        sheetPath = zip.names().filter(function (n) { return /^xl\\/worksheets\\/[^/]+\\.xml$/.test(n); }).sort()[0];\n      }\n      if (!sheetPath) throw new Error('NO_SHEET');\n      if (!zip.has('xl/sharedStrings.xml')) return null;\n      return zip.read('xl/sharedStrings.xml').then(function (ssText) {\n        byTag(parseXml(ssText), 'si').forEach(function (si) {\n          shared.push(byTag(si, 't').map(function (t) { return t.textContent; }).join(''));\n        });\n      });\n    }).then(function () {\n      return zip.read(sheetPath);\n    }).then(function (sheetText) {\n      var rows = [];\n      byTag(parseXml(sheetText), 'row').forEach(function (rowEl) {\n        var values = [];\n        byTag(rowEl, 'c').forEach(function (c) {\n          var ref = c.getAttribute('r');\n          var idx = ref ? columnIndex(ref) : values.length;\n          var type = c.getAttribute('t');\n          var v = byTag(c, 'v')[0];\n          var text = '';\n          if (type === 's') text = shared[Number(v ? v.textContent : -1)] || '';\n          else if (type === 'inlineStr') text = byTag(c, 't').map(function (t) { return t.textContent; }).join('');\n          else if (type === 'b') text = v && v.textContent === '1' ? 'TRUE' : 'FALSE';\n          else text = v ? v.textContent : '';\n          while (values.length < idx) values.push('');\n          values[idx] = text;\n        });\n        rows.push(values);\n      });\n      return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });\n    });\n  };\n\n  /** อ่านไฟล์ CSV: ลอง UTF-8 ก่อน ถ้าไม่ใช่ใช้ Windows-874 (ภาษาไทยจาก Excel รุ่นเก่า) */\n  App.readCsv = function (file) {\n    return file.arrayBuffer().then(function (ab) {\n      var text;\n      try {\n        text = new TextDecoder('utf-8', { fatal: true }).decode(ab);\n      } catch (e) {\n        text = new TextDecoder('windows-874').decode(ab);\n      }\n      return parseDelimitedText_(text);\n    });\n  };\n\n  function fileErrorMessage(err, name) {\n    var code = err && err.message;\n    if (/\\.xls$/i.test(name)) return 'ไฟล์ .xls (Excel รุ่นเก่า) ยังอ่านไม่ได้ กรุณาเปิดใน Excel แล้วบันทึกเป็น .xlsx หรือ CSV หรือคัดลอกตารางมาวาง';\n    if (code === 'NO_DECOMPRESSION') return 'เบราว์เซอร์นี้อ่านไฟล์ .xlsx ไม่ได้ กรุณาบันทึกไฟล์เป็น CSV หรือคัดลอกตารางจาก Excel มาวาง';\n    return 'อ่านไฟล์ไม่สำเร็จ กรุณาตรวจว่าเป็นไฟล์ .xlsx หรือ .csv หรือคัดลอกตารางจาก Excel มาวาง';\n  }\n\n  function downloadTemplate() {\n    var lines = [\n      'เลขประจำตัวนักเรียน,คำนำหน้า,ชื่อ,นามสกุล,ระดับชั้น,ห้อง,เลขที่',\n      '12345,เด็กชาย,สมชาย,ใจดี,ป.1,1,1',\n      '12346,เด็กหญิง,สมใจ,รักเรียน,ป.1,1,2',\n    ];\n    var blob = new Blob(['﻿' + lines.join('\\r\\n')], { type: 'text/csv;charset=utf-8' });\n    var url = URL.createObjectURL(blob);\n    var a = h('a', { href: url, download: 'แบบฟอร์มนำเข้านักเรียน.csv' });\n    document.body.appendChild(a);\n    a.click();\n    document.body.removeChild(a);\n    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);\n  }\n\n  // ---------------------------------------------------------------------------\n  // นำเข้าข้อมูลนักเรียน\n  // ---------------------------------------------------------------------------\n  var MAP_FIELDS = [\n    { key: 'studentNo', label: 'เลขประจำตัวนักเรียน', need: true },\n    { key: 'prefix', label: 'คำนำหน้า' },\n    { key: 'firstName', label: 'ชื่อ' },\n    { key: 'lastName', label: 'นามสกุล' },\n    { key: 'fullName', label: 'ชื่อ-นามสกุล (ใช้แทนชื่อและนามสกุล)' },\n    { key: 'gradeLevel', label: 'ระดับชั้น' },\n    { key: 'room', label: 'ห้อง' },\n    { key: 'gradeRoom', label: 'ชั้น/ห้อง เช่น ป.1/2 (ใช้แทนระดับชั้นและห้อง)' },\n    { key: 'classNo', label: 'เลขที่' },\n  ];\n  var IMPORT_KIND = {\n    NEW: 'success', ENROLL: 'success', SAME: 'muted', UPDATE: 'warning', CONFLICT: 'danger',\n    NAME_DUPLICATE: 'warning', DUPLICATE_IN_FILE: 'danger', INVALID: 'danger',\n  };\n  var IMPORT_ORDER = ['INVALID', 'DUPLICATE_IN_FILE', 'CONFLICT', 'NAME_DUPLICATE', 'UPDATE', 'NEW', 'ENROLL', 'SAME'];\n\n  App.defineRoute('students-import', {\n    title: 'นำเข้าข้อมูลนักเรียน',\n    roles: [MANAGE],\n    render: function (params) {\n      return App.api('years.list').then(function (years) {\n        var openYears = years.filter(function (y) { return y.status === 'OPEN'; });\n        var state = { table: null, header: null, mapping: null, fileName: '', preview: null };\n        var wantYear = params.year || App.state.me.school.currentAcademicYear;\n        var yearSel = App.field({ label: 'นำเข้าเป็นข้อมูลปีการศึกษา', type: 'select',\n          options: openYears.map(function (y) { return { value: String(y.year), label: y.label }; }),\n          value: String(openYears.some(function (y) { return y.year === wantYear; }) ? wantYear : (openYears[0] ? openYears[0].year : '')) });\n        var fileInput = h('input', { type: 'file', class: 'input', accept: '.xlsx,.csv,.txt,text/csv', id: 'student-file' });\n        var paste = App.field({ label: 'หรือคัดลอกตารางจาก Excel แล้ววางที่นี่ (รวมแถวหัวตาราง)', type: 'textarea', rows: 5, span2: true });\n        var readError = h('div', { class: 'alert alert-error hidden', role: 'alert' });\n        var mappingBox = h('div');\n        var previewBox = h('div');\n\n        function setError(box, text) { box.textContent = text; box.classList.toggle('hidden', !text); }\n\n        function useTable(rows, fileName) {\n          state.preview = null;\n          clear(previewBox);\n          var found = findStudentHeaderRow_(rows);\n          if (!found) {\n            setError(readError, 'ไม่พบแถวหัวตาราง กรุณาให้แถวแรกเป็นชื่อคอลัมน์ เช่น เลขประจำตัวนักเรียน ชื่อ นามสกุล ระดับชั้น ห้อง เลขที่');\n            clear(mappingBox);\n            return;\n          }\n          setError(readError, '');\n          state.table = rows.slice(found.index + 1);\n          state.header = rows[found.index];\n          state.mapping = found.columns;\n          state.fileName = fileName;\n          renderMapping();\n        }\n\n        function renderMapping() {\n          var headerOptions = [{ value: '-1', label: '(ไม่มี)' }].concat(state.header.map(function (name, i) {\n            return { value: String(i), label: 'คอลัมน์ ' + (i + 1) + ': ' + (String(name).trim() || '(ไม่มีชื่อ)') };\n          }));\n          var grid = h('div', { class: 'form-grid' });\n          var selects = {};\n          MAP_FIELDS.forEach(function (fdef) {\n            var f = App.field({ label: fdef.label, type: 'select', options: headerOptions, value: String(state.mapping[fdef.key]), required: fdef.need });\n            f.input.addEventListener('change', function () { state.mapping[fdef.key] = Number(f.input.value); });\n            selects[fdef.key] = f;\n            grid.appendChild(f.wrap);\n          });\n          var sample = state.table.slice(0, 3).map(function (r) { return r.join(' | '); });\n          var mapError = h('div', { class: 'alert alert-error hidden', role: 'alert' });\n          var checkBtn = button('ตรวจสอบข้อมูล', '', function () {\n            var m = state.mapping;\n            var problems = [];\n            if (m.studentNo === -1) problems.push('เลือกคอลัมน์เลขประจำตัวนักเรียน');\n            if (m.firstName === -1 && m.fullName === -1) problems.push('เลือกคอลัมน์ชื่อ หรือคอลัมน์ชื่อ-นามสกุล');\n            if (m.gradeLevel === -1 && m.gradeRoom === -1) problems.push('เลือกคอลัมน์ระดับชั้น หรือคอลัมน์ชั้น/ห้อง');\n            if (problems.length) { setError(mapError, 'กรุณา' + problems.join(' และ')); return; }\n            setError(mapError, '');\n            runPreview({ updateExisting: false, acceptNameDuplicates: false });\n          }, 'search');\n          clear(mappingBox).appendChild(h('div', { class: 'card' },\n            h('div', { class: 'card-head' }, h('h2', { text: '2. ตรวจคอลัมน์ที่ระบบจับคู่ให้' })),\n            h('div', { class: 'card-body stack' },\n              h('div', { class: 'alert alert-info', text: 'พบข้อมูล ' + state.table.length + ' แถว' + (state.fileName ? ' จาก ' + state.fileName : '') +\n                ' ระบบจับคู่คอลัมน์จากหัวตารางให้แล้ว ถ้าไม่ถูกต้องให้เลือกใหม่' }),\n              grid,\n              h('div', null, h('div', { class: 'help', text: 'ตัวอย่างข้อมูล 3 แถวแรก:' }),\n                sample.map(function (line) { return h('div', { class: 'mono small', text: line }); })),\n              mapError,\n              h('div', null, checkBtn))));\n          App.scrollToEl(mappingBox);\n        }\n\n        function buildRows() {\n          var m = state.mapping;\n          var cell = function (r, idx) { return idx >= 0 && idx < r.length ? String(r[idx]) : ''; };\n          return state.table.map(function (r, i) {\n            var out = { rowNo: i + 1 };\n            MAP_FIELDS.forEach(function (fdef) { out[fdef.key] = cell(r, m[fdef.key]); });\n            return out;\n          });\n        }\n\n        function runPreview(options) {\n          var payload = Object.assign({ year: Number(yearSel.input.value), rows: buildRows(), fileName: state.fileName }, options);\n          return App.api('students.importPreview', payload).then(function (res) {\n            state.preview = res;\n            renderPreview(res, payload);\n          }).catch(function (err) {\n            if (err && err.handled) return;\n            clear(previewBox).appendChild(h('div', { class: 'alert alert-error', role: 'alert', text: err.message }));\n          });\n        }\n\n        function renderPreview(res, payload) {\n          var c = res.counts;\n          var chips = h('div', { class: 'toolbar', style: { gap: '8px' } });\n          IMPORT_ORDER.forEach(function (k) {\n            if (c[k]) chips.appendChild(App.badge(res.labels[k] + ' ' + c[k], IMPORT_KIND[k]));\n          });\n          var optUpdate = App.field({ type: 'checkbox', label: 'ปรับปรุงข้อมูลนักเรียนเดิมตามไฟล์ (' + (c.UPDATE + c.CONFLICT) + ' รายการ)',\n            value: res.options.updateExisting, help: 'ใช้เมื่อแน่ใจว่าไฟล์ถูกต้องกว่าข้อมูลในระบบ ระบบเก็บค่าเดิมไว้ในประวัติการใช้งาน' });\n          var optDup = App.field({ type: 'checkbox', label: 'ยืนยันนำเข้านักเรียนที่ชื่อซ้ำกับนักเรียนเดิม (' + c.NAME_DUPLICATE + ' รายการ)',\n            value: res.options.acceptNameDuplicates, help: 'เลือกเฉพาะเมื่อตรวจแล้วว่าเป็นคนละคน' });\n          optUpdate.input.disabled = !(c.UPDATE + c.CONFLICT);\n          optDup.input.disabled = !c.NAME_DUPLICATE;\n          var rerun = function () { runPreview({ updateExisting: optUpdate.input.checked, acceptNameDuplicates: optDup.input.checked }); };\n          optUpdate.input.addEventListener('change', rerun);\n          optDup.input.addEventListener('change', rerun);\n\n          var showAll = App.field({ type: 'checkbox', label: 'แสดงทุกแถว (ปกติแสดงเฉพาะแถวที่ต้องตรวจ)' });\n          var tableBox = h('div');\n          function drawRows() {\n            var rows = res.rows.filter(function (r) { return showAll.input.checked || ['NEW', 'ENROLL', 'SAME'].indexOf(r.status) === -1; })\n              .sort(function (a, b) { return IMPORT_ORDER.indexOf(a.status) - IMPORT_ORDER.indexOf(b.status) || a.rowNo - b.rowNo; });\n            clear(tableBox).appendChild(App.table({\n              rows: rows,\n              empty: 'ไม่มีแถวที่ต้องตรวจ ข้อมูลพร้อมนำเข้า',\n              columns: [\n                { label: 'ลำดับ', key: 'rowNo' },\n                { label: 'ผลตรวจ', render: function (r) {\n                  return h('div', null, App.badge(r.statusLabel, IMPORT_KIND[r.status]), ' ', r.applies ? App.badge('จะบันทึก', 'FINANCE') : null);\n                } },\n                { label: 'เลขประจำตัว', render: function (r) { return h('span', { class: 'mono', text: r.studentNo }); } },\n                { label: 'ชื่อ-นามสกุล', key: 'fullName' },\n                { label: 'ชั้น/ห้อง', key: 'classLabel' },\n                { label: 'เลขที่', key: 'classNo' },\n                { label: 'รายละเอียด', render: function (r) {\n                  return h('div', null, r.messages.map(function (m) { return h('div', { text: m }); }),\n                    r.changes.map(function (m) { return h('div', { class: 'muted small', text: m }); }));\n                } },\n              ],\n            }));\n          }\n          showAll.input.addEventListener('change', drawRows);\n          drawRows();\n\n          var commitBtn = button('นำเข้า ' + c.apply + ' รายการ', '', function () {\n            App.confirm('นำเข้าข้อมูล ' + c.apply + ' รายการเป็นข้อมูลปีการศึกษา ' + res.year + '? แถวที่ไม่ผ่านการตรวจจะถูกข้าม', { confirmLabel: 'นำเข้า' })\n              .then(function (ok) {\n                if (!ok) return null;\n                commitBtn.disabled = true;\n                return App.api('students.importCommit', payload).then(function (r) {\n                  App.toast('นำเข้าข้อมูลเรียบร้อยแล้ว', 'success');\n                  clear(mappingBox);\n                  clear(previewBox).appendChild(h('div', { class: 'card' },\n                    h('div', { class: 'card-head' }, h('h2', { text: 'นำเข้าข้อมูลเรียบร้อย' })),\n                    h('div', { class: 'card-body stack' },\n                      h('div', { class: 'grid-cards' },\n                        stat('เพิ่มนักเรียนใหม่', r.created), stat('เพิ่มชั้นเรียนปีนี้', r.enrolled),\n                        stat('ปรับปรุงข้อมูล', r.updated), stat('ไม่เปลี่ยนแปลง', r.unchanged), stat('ข้าม', r.skipped)),\n                      h('div', null, button('ดูรายชื่อนักเรียน ปีการศึกษา ' + r.year, '', function () { App.go('students', { year: r.year }); }, 'student')))));\n                });\n              })\n              .catch(App.fail)\n              .then(function () { commitBtn.disabled = false; });\n          }, 'upload');\n          commitBtn.disabled = c.apply === 0;\n\n          clear(previewBox).appendChild(h('div', { class: 'card' },\n            h('div', { class: 'card-head' }, h('h2', { text: '3. ผลการตรวจสอบ (ยังไม่ได้บันทึก)' })),\n            h('div', { class: 'card-body stack' },\n              chips,\n              h('div', { class: 'form-grid' }, optUpdate.wrap, optDup.wrap),\n              showAll.wrap,\n              tableBox,\n              h('div', { class: 'toolbar', style: { justifyContent: 'flex-end', marginBottom: '0' } },\n                h('span', { class: 'muted small', text: 'จะบันทึก ' + c.apply + ' จาก ' + c.total + ' แถว' }), commitBtn))));\n          App.scrollToEl(previewBox);\n        }\n\n        function stat(label, value) {\n          return h('div', { class: 'card stat' }, h('div', { class: 'stat-label', text: label }), h('div', { class: 'stat-value', text: String(value) }));\n        }\n\n        fileInput.addEventListener('change', function () {\n          var file = fileInput.files && fileInput.files[0];\n          if (!file) return;\n          setError(readError, '');\n          var reader = /\\.xlsx$/i.test(file.name) ? App.readXlsx(file) : (/\\.xls$/i.test(file.name) ? Promise.reject(new Error('XLS')) : App.readCsv(file));\n          reader.then(function (rows) { useTable(rows, file.name); })\n            .catch(function (err) { setError(readError, fileErrorMessage(err, file.name)); });\n        });\n        var pasteBtn = button('อ่านข้อมูลที่วาง', 'secondary', function () {\n          if (!paste.input.value.trim()) { setError(readError, 'กรุณาวางข้อมูลก่อน'); return; }\n          useTable(parseDelimitedText_(paste.input.value), 'ข้อมูลที่วาง');\n        });\n        var templateBtn = button('ดาวน์โหลดแบบฟอร์ม CSV', 'ghost', downloadTemplate);\n\n        if (!openYears.length) {\n          return h('div', { class: 'alert alert-warning', text: 'ยังไม่มีปีการศึกษาที่เปิดอยู่ กรุณาให้ผู้ดูแลระบบเพิ่มปีการศึกษาก่อน' });\n        }\n        return h('div', null,\n          h('div', { class: 'page-head' },\n            h('div', null, h('h1', { text: 'นำเข้าข้อมูลนักเรียน' }),\n              h('p', { text: 'ระบบตรวจข้อมูลและแสดงผลก่อนเสมอ ยังไม่บันทึกจนกว่าจะกดยืนยัน นำเข้าไฟล์เดิมซ้ำได้โดยไม่เกิดข้อมูลซ้ำ' })),\n            button('กลับไปรายชื่อนักเรียน', 'secondary', function () { App.go('students'); })),\n          h('div', { class: 'card' },\n            h('div', { class: 'card-head' }, h('h2', { text: '1. เลือกปีการศึกษาและข้อมูล' })),\n            h('div', { class: 'card-body stack' },\n              h('div', { class: 'form-grid' }, yearSel.wrap,\n                h('div', { class: 'field' }, h('label', { for: 'student-file', text: 'ไฟล์ Excel (.xlsx) หรือ CSV' }), fileInput,\n                  h('div', { class: 'help', text: 'ใช้แผ่นงานแรกของไฟล์ ไฟล์ไม่ถูกส่งไปเก็บที่ใด ระบบอ่านในเครื่องนี้แล้วส่งเฉพาะข้อมูลในตาราง' })),\n                paste.wrap),\n              h('div', { class: 'toolbar', style: { marginBottom: '0' } }, pasteBtn, templateBtn),\n              h('div', { class: 'help', text: 'หัวตารางที่รู้จัก: เลขประจำตัวนักเรียน, คำนำหน้า, ชื่อ, นามสกุล (หรือ ชื่อ-นามสกุล), ระดับชั้น, ห้อง (หรือ ชั้น/ห้อง), เลขที่' }),\n              readError)),\n          mappingBox,\n          previewBox);\n      });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // เลื่อนชั้นขึ้นปีการศึกษาใหม่\n  // ---------------------------------------------------------------------------\n  App.defineRoute('students-promote', {\n    title: 'เลื่อนชั้นขึ้นปีการศึกษาใหม่',\n    roles: [MANAGE],\n    render: function (params) {\n      return App.api('years.list').then(function (years) {\n        var sorted = years.slice().sort(function (a, b) { return a.year - b.year; });\n        var from = params.fromYear || App.state.me.school.currentAcademicYear;\n        var fromSel = App.field({ label: 'จากปีการศึกษา', type: 'select', value: String(from),\n          options: sorted.map(function (y) { return { value: String(y.year), label: y.label }; }) });\n        var toSel = App.field({ label: 'ไปปีการศึกษา', type: 'select' });\n        var gradDate = App.field({ label: 'วันที่จบการศึกษา (ชั้นสุดท้าย)', type: 'date', value: todayIso() });\n        var result = h('div');\n        var notice = h('div', { class: 'alert alert-warning hidden' });\n\n        function fillTo() {\n          var f = Number(fromSel.input.value);\n          var targets = sorted.filter(function (y) { return y.year > f && y.status === 'OPEN'; });\n          clear(toSel.input);\n          targets.forEach(function (y) { toSel.input.appendChild(h('option', { value: String(y.year), text: y.label })); });\n          notice.textContent = targets.length ? '' : 'ยังไม่มีปีการศึกษา ' + (f + 1) + ' ในระบบ กรุณาให้ผู้ดูแลระบบเพิ่มปีการศึกษาใหม่ก่อน';\n          notice.classList.toggle('hidden', !!targets.length);\n          previewBtn.disabled = !targets.length;\n          clear(result);\n        }\n\n        var previewBtn = button('ดูตัวอย่างการเลื่อนชั้น', '', function () {\n          var payload = { fromYear: Number(fromSel.input.value), toYear: Number(toSel.input.value), graduationDate: gradDate.input.value };\n          App.api('students.promotePreview', payload).then(function (p) {\n            var groupsTable = App.table({\n              rows: p.groups,\n              empty: 'ไม่มีนักเรียนที่ต้องเลื่อนชั้น',\n              columns: [\n                { label: 'ชั้นปีการศึกษา ' + p.fromYear, key: 'fromGrade' },\n                { label: 'ปีการศึกษา ' + p.toYear, render: function (g) { return g.graduate ? App.badge('จบการศึกษา', 'muted') : g.toGrade; } },\n                { label: 'จำนวน (คน)', key: 'count' },\n              ],\n            });\n            var skipped = p.skipped.length ? [h('h3', { text: 'ข้าม ' + p.skipped.length + ' คน' }), App.table({\n              rows: p.skipped,\n              columns: [\n                { label: 'เลขประจำตัว', key: 'studentNo' },\n                { label: 'ชื่อ-นามสกุล', key: 'fullName' },\n                { label: 'ชั้น/ห้อง', key: 'classLabel' },\n                { label: 'เหตุผล', key: 'reason' },\n              ],\n            })] : null;\n            var commitBtn = button('ยืนยันเลื่อนชั้น ' + p.promote + ' คน และจบการศึกษา ' + p.graduate + ' คน', '', function () {\n              App.confirm('ยืนยันการเลื่อนชั้นจากปีการศึกษา ' + p.fromYear + ' เป็น ' + p.toYear + '? ข้อมูลปีเดิมไม่ถูกลบ', { confirmLabel: 'ยืนยันเลื่อนชั้น' })\n                .then(function (ok) {\n                  if (!ok) return null;\n                  commitBtn.disabled = true;\n                  return App.api('students.promoteCommit', payload).then(function (r) {\n                    App.toast('เลื่อนชั้นเรียบร้อยแล้ว', 'success');\n                    clear(result).appendChild(h('div', { class: 'card' }, h('div', { class: 'card-body stack' },\n                      h('div', { class: 'alert alert-success', text: 'เลื่อนชั้น ' + r.promoted + ' คน · จบการศึกษา ' + r.graduated + ' คน · ข้าม ' + r.skipped + ' คน' }),\n                      r.classNoCleared ? h('div', { class: 'alert alert-warning', text: 'มี ' + r.classNoCleared + ' คนที่เลขที่เดิมซ้ำกับนักเรียนในปีใหม่ ระบบเว้นเลขที่ไว้ กรุณาแก้ไขภายหลัง' }) : null,\n                      h('div', { class: 'alert alert-info', text: 'เมื่อเปิดภาคเรียนใหม่ แจ้งผู้ดูแลระบบให้ตั้งปีการศึกษา ' + r.toYear + ' เป็นปีปัจจุบัน' }),\n                      h('div', null, button('ดูรายชื่อนักเรียน ปีการศึกษา ' + r.toYear, '', function () { App.go('students', { year: r.toYear }); }, 'student')))));\n                  });\n                })\n                .catch(App.fail)\n                .then(function () { commitBtn.disabled = false; });\n            }, 'arrowUp');\n            commitBtn.disabled = !(p.promote + p.graduate);\n            clear(result).appendChild(h('div', { class: 'card' },\n              h('div', { class: 'card-head' }, h('h2', { text: 'ตัวอย่าง (ยังไม่ได้บันทึก)' })),\n              h('div', { class: 'card-body stack' },\n                groupsTable,\n                p.classNoCleared ? h('div', { class: 'alert alert-warning', text: p.classNoCleared + ' คนมีเลขที่ซ้ำกับนักเรียนในปีใหม่ ระบบจะเว้นเลขที่ไว้' }) : null,\n                skipped,\n                h('div', { class: 'help', text: 'ห้องและเลขที่คงเดิม แก้ไขภายหลังได้ หรือนำเข้ารายชื่อปีใหม่พร้อมเลือก \"ปรับปรุงข้อมูลนักเรียนเดิม\"' }),\n                h('div', null, commitBtn))));\n          }).catch(App.fail);\n        }, 'search');\n\n        fromSel.input.addEventListener('change', fillTo);\n        fillTo();\n        return h('div', null,\n          h('div', { class: 'page-head' },\n            h('div', null, h('h1', { text: 'เลื่อนชั้นขึ้นปีการศึกษาใหม่' }),\n              h('p', { text: 'นักเรียนที่กำลังศึกษาจะเลื่อนขึ้นชั้นถัดไปตามลำดับในตั้งค่า \"ระดับชั้นที่เปิดสอน\" ชั้นสุดท้ายจะเป็นจบการศึกษา ข้อมูลปีเดิมไม่ถูกลบ' })),\n            button('กลับไปรายชื่อนักเรียน', 'secondary', function () { App.go('students'); })),\n          h('div', { class: 'card' }, h('div', { class: 'card-body stack' },\n            h('div', { class: 'form-grid' }, fromSel.wrap, toSel.wrap, gradDate.wrap),\n            notice,\n            h('div', null, previewBtn))),\n          result);\n      });\n    },\n  });\n})();\n</script>\n",
  "JsViews": "<script>\n/* ==========================================================================\n   JsViews — หน้าจอของระบบ (ระยะที่ 2)\n   เข้าสู่ระบบ / เปลี่ยนรหัสผ่าน / หน้าหลัก / ผู้ใช้งาน / ตั้งค่าโรงเรียน / ปีการศึกษา / ประวัติการใช้งาน\n   ========================================================================== */\n(function () {\n  'use strict';\n  var h = App.h;\n  var clear = App.clear;\n  var icon = App.icon;\n  var ALL = ['ADMIN', 'FINANCE', 'DIRECTOR'];\n\n  App.MENU_GROUPS = [\n    { key: 'main', label: 'ทั่วไป' },\n    { key: 'finance', label: 'การเงิน' },\n    { key: 'students', label: 'ข้อมูลนักเรียน' },\n    { key: 'manage', label: 'การจัดการระบบ' },\n    { key: 'info', label: 'ข้อมูลโรงเรียน' },\n  ];\n\n  var PASSWORD_RULES = [\n    'อย่างน้อย 8 ตัวอักษร',\n    'มีทั้งตัวอักษรและตัวเลข',\n    'ไม่มีชื่อผู้ใช้อยู่ในรหัสผ่าน',\n  ];\n\n  function rulesList(extra) {\n    return h('ul', { class: 'rules' }, PASSWORD_RULES.concat(extra || []).map(function (r) { return h('li', { text: r }); }));\n  }\n\n  function pageHead(title, description, actions) {\n    return h('div', { class: 'page-head' },\n      h('div', null, h('h1', { text: title }), description ? h('p', { text: description }) : null),\n      actions ? h('div', { class: 'toolbar', style: { marginBottom: '0' } }, actions) : null);\n  }\n\n  function button(label, kind, onClick, iconName) {\n    var btn = h('button', { type: 'button', class: 'btn' + (kind ? ' btn-' + kind : '') }, iconName ? icon(iconName) : null, label);\n    btn.addEventListener('click', onClick);\n    return btn;\n  }\n\n  // ---------------------------------------------------------------------------\n  // หน้าเข้าสู่ระบบ\n  // ---------------------------------------------------------------------------\n  function authPage(title, subtitle, bodyNodes) {\n    var app = clear(document.getElementById('app'));\n    app.appendChild(h('div', { class: 'login-page' },\n      h('div', { class: 'login-card' },\n        h('div', { class: 'login-head' },\n          h('div', { class: 'login-logo' }, icon('school')),\n          h('div', { class: 'login-school', text: title }),\n          h('div', { class: 'login-app', text: subtitle })),\n        h('div', { class: 'login-body' }, bodyNodes),\n        h('div', { class: 'login-foot', text: 'จังหวัด' + BOOT.province + ' · เวอร์ชัน ' + BOOT.version }))));\n  }\n\n  App.showLogin = function (message, kind) {\n    App.state.me = null;\n    App.state.studentYear = null;\n    App.state.studentFilters = { grade: '', room: '', status: 'STUDYING', q: '' };\n    App.clearOverlays();\n    var notice = h('div', { class: 'alert ' + (kind === 'info' ? 'alert-info' : 'alert-error') + (message ? '' : ' hidden'), role: 'alert', text: message || '' });\n    function showError(text) {\n      notice.className = 'alert alert-error';\n      notice.textContent = text;\n    }\n    function onLoggedIn(result) {\n      App.session.set(result.token, result.remember === true);\n      return App.loadMe();\n    }\n    var stayIn = BOOT.allowRemember ? App.field({\n      label: 'อยู่ในระบบต่อในเครื่องนี้ (ปิดเบราว์เซอร์แล้วไม่ต้องเข้าสู่ระบบใหม่)', type: 'checkbox',\n      help: 'เลือกเฉพาะเครื่องส่วนตัว ห้ามเลือกในเครื่องที่ใช้ร่วมกัน ระบบยังออกจากระบบเองเมื่อครบอายุการเข้าสู่ระบบที่ผู้ดูแลระบบกำหนด',\n    }) : null;\n\n    if (BOOT.authMode === 'GOOGLE') {\n      var googleBtn = h('button', { type: 'button', class: 'btn btn-block', text: 'เข้าสู่ระบบด้วยบัญชี Google ของโรงเรียน' });\n      googleBtn.addEventListener('click', function () {\n        googleBtn.disabled = true;\n        App.api('auth.loginGoogle', { remember: stayIn ? stayIn.get() : false }).then(onLoggedIn).catch(function (err) {\n          googleBtn.disabled = false;\n          showError(err.message);\n        });\n      });\n      authPage(BOOT.schoolName, BOOT.appName, [notice,\n        h('p', { class: 'muted small', text: 'ระบบจะใช้บัญชี Google ที่เข้าสู่ระบบอยู่ในเบราว์เซอร์นี้' }), stayIn ? stayIn.wrap : null, googleBtn]);\n      return;\n    }\n\n    var savedName = App.session.rememberedUsername();\n    var username = App.field({ label: 'ชื่อผู้ใช้', autocomplete: 'username', autocapitalize: 'none', mono: true, value: savedName });\n    var password = App.passwordField({ label: 'รหัสผ่าน', autocomplete: 'current-password' });\n    var keepName = App.field({ label: 'จดจำชื่อผู้ใช้ในเครื่องนี้', type: 'checkbox', value: true });\n    var submit = h('button', { type: 'submit', class: 'btn btn-block', text: 'เข้าสู่ระบบ' });\n    var form = h('form', { class: 'stack', novalidate: true }, notice, username.wrap, password.wrap,\n      h('div', { class: 'login-options' }, keepName.wrap, stayIn ? stayIn.wrap : null), submit);\n    form.addEventListener('submit', function (e) {\n      e.preventDefault();\n      if (submit.disabled) return;\n      submit.disabled = true;\n      submit.textContent = 'กำลังตรวจสอบ…';\n      notice.classList.add('hidden');\n      var name = username.input.value.trim();\n      App.api('auth.login', { username: name, password: password.input.value, remember: stayIn ? stayIn.get() : false })\n        .then(function (result) {\n          App.session.rememberUsername(name.toLowerCase(), keepName.get());\n          return onLoggedIn(result);\n        })\n        .catch(function (err) {\n          password.input.value = '';\n          showError(err.message);\n          password.input.focus();\n        })\n        .then(function () {\n          submit.disabled = false;\n          submit.textContent = 'เข้าสู่ระบบ';\n        });\n    });\n    authPage(BOOT.schoolName, BOOT.appName, [form,\n      h('p', { class: 'muted small', text: 'ลืมรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบของโรงเรียน' })]);\n    (savedName ? password.input : username.input).focus();\n  };\n\n  // ---------------------------------------------------------------------------\n  // เปลี่ยนรหัสผ่าน (บังคับเมื่อใช้รหัสผ่านชั่วคราว / เลือกเองจากเมนู)\n  // ---------------------------------------------------------------------------\n  function changePasswordRequest(values) {\n    if (values.newPassword !== values.confirmPassword) {\n      return Promise.reject({ message: 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน' });\n    }\n    return App.api('auth.changePassword', { currentPassword: values.currentPassword, newPassword: values.newPassword })\n      .then(function (result) {\n        App.session.set(result.token);\n        return result;\n      });\n  }\n\n  App.showForcedPasswordChange = function () {\n    var me = App.state.me;\n    var notice = h('div', { class: 'alert alert-error hidden', role: 'alert' });\n    var current = App.passwordField({ label: 'รหัสผ่านปัจจุบัน (รหัสผ่านชั่วคราว)', autocomplete: 'current-password' });\n    var next = App.passwordField({ label: 'รหัสผ่านใหม่', autocomplete: 'new-password' });\n    var confirm = App.passwordField({ label: 'ยืนยันรหัสผ่านใหม่', autocomplete: 'new-password' });\n    var submit = h('button', { type: 'submit', class: 'btn btn-block', text: 'บันทึกรหัสผ่านใหม่' });\n    var logout = h('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'ออกจากระบบ' });\n    logout.addEventListener('click', function () { App.logout(); });\n    var form = h('form', { class: 'stack', novalidate: true },\n      h('div', { class: 'alert alert-info' },\n        h('strong', { text: 'กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งาน' }),\n        h('div', { text: 'บัญชีนี้ใช้รหัสผ่านชั่วคราวที่ผู้ดูแลระบบกำหนด รหัสผ่านใหม่ต้อง:' }),\n        rulesList(['ไม่ซ้ำกับรหัสผ่านเดิม'])),\n      notice, current.wrap, next.wrap, confirm.wrap, submit, logout);\n    form.addEventListener('submit', function (e) {\n      e.preventDefault();\n      if (submit.disabled) return;\n      submit.disabled = true;\n      notice.classList.add('hidden');\n      changePasswordRequest({ currentPassword: current.input.value, newPassword: next.input.value, confirmPassword: confirm.input.value })\n        .then(function () {\n          App.toast('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว', 'success');\n          return App.loadMe();\n        })\n        .catch(function (err) {\n          if (err && err.handled) return;\n          notice.textContent = err.message;\n          notice.classList.remove('hidden');\n        })\n        .then(function () { submit.disabled = false; });\n    });\n    authPage('ตั้งรหัสผ่านใหม่', (me ? me.user.displayName + ' · ' : '') + BOOT.schoolName, form);\n    current.input.focus();\n  };\n\n  App.openChangePassword = function () {\n    App.formModal({\n      title: 'เปลี่ยนรหัสผ่าน',\n      intro: h('div', { class: 'alert alert-info' }, h('div', { text: 'รหัสผ่านใหม่ต้อง:' }), rulesList(['ไม่ซ้ำกับรหัสผ่านเดิม']),\n        h('div', { class: 'small', text: 'หลังเปลี่ยน การเข้าสู่ระบบบนเครื่องอื่นของคุณจะหมดอายุทันที' })),\n      fields: [\n        { key: 'currentPassword', label: 'รหัสผ่านปัจจุบัน', type: 'password', autocomplete: 'current-password', span2: true },\n        { key: 'newPassword', label: 'รหัสผ่านใหม่', type: 'password', autocomplete: 'new-password' },\n        { key: 'confirmPassword', label: 'ยืนยันรหัสผ่านใหม่', type: 'password', autocomplete: 'new-password' },\n      ],\n      submitLabel: 'เปลี่ยนรหัสผ่าน',\n      onSubmit: changePasswordRequest,\n      onDone: function () { App.toast('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว', 'success'); },\n    });\n  };\n\n  // ---------------------------------------------------------------------------\n  // หน้าหลัก\n  // ---------------------------------------------------------------------------\n  function stat(label, value) {\n    return h('div', { class: 'card stat' }, h('div', { class: 'stat-label', text: label }), h('div', { class: 'stat-value', text: value }));\n  }\n\n  function stepList(steps) {\n    return h('ol', { class: 'steps' }, steps.map(function (s, i) {\n      return h('li', null, h('span', { class: 'step-no', text: String(i + 1) }),\n        h('div', { style: { flex: '1' } }, h('div', { text: s.text }), s.help ? h('div', { class: 'muted small', text: s.help }) : null),\n        s.route ? button(s.button || 'ไปที่หน้านี้', 'secondary btn-sm', function () { App.go(s.route); }) : null);\n    }));\n  }\n\n  function integrityAlert(last) {\n    return h('div', { class: 'alert alert-error' },\n      h('span', { text: 'การตรวจความถูกต้องของข้อมูลเมื่อ ' + App.fmt.datetime(last.at) + ' พบปัญหา ' + last.problemCount + ' จุด ' }),\n      App.button('ดูรายละเอียด', 'ghost btn-sm', function () { App.go('integrity'); }));\n  }\n\n  function daysSince(fromIso, toIso) {\n    var a = fromIso.split('-').map(Number);\n    var b = toIso.split('-').map(Number);\n    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);\n  }\n\n  App.defineRoute('home', {\n    title: 'หน้าหลัก',\n    roles: ALL,\n    menu: { group: 'main', label: 'หน้าหลัก', icon: 'home' },\n    render: function () {\n      var me = App.state.me;\n      var role = me.user.role;\n      var card;\n      if (role === 'ADMIN') {\n        card = h('div', { class: 'card' },\n          h('div', { class: 'card-head' }, h('h2', { text: 'เริ่มต้นใช้งาน (ผู้ดูแลระบบ)' })),\n          h('div', { class: 'card-body' }, stepList([\n            { text: 'ตรวจและกรอกข้อมูลโรงเรียน และชื่อผู้ลงนามในเอกสาร', route: 'settings' },\n            { text: 'เพิ่มผู้ใช้: เจ้าหน้าที่การเงิน และผู้อำนวยการ', help: 'กำหนดรหัสผ่านชั่วคราว แล้วแจ้งผู้ใช้เป็นการส่วนตัว ผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก', route: 'users' },\n            { text: 'ตรวจปีการศึกษาปัจจุบัน', route: 'years' },\n            { text: 'ดูประวัติการใช้งาน และตรวจความถูกต้องของประวัติ', route: 'audit' },\n            { text: 'สำรองข้อมูล และตรวจว่าเปิดการสำรองอัตโนมัติรายวันไว้แล้ว', help: 'ไฟล์สำรองอยู่ใน Google Drive ของบัญชีเจ้าของระบบ กู้คืนได้จากหน้านี้', route: 'backups', button: 'สำรองข้อมูล' },\n            { text: 'ตรวจความถูกต้องของข้อมูลทั้งระบบ (ระบบตรวจให้อัตโนมัติทุกวันด้วย)', route: 'integrity', button: 'ตรวจความถูกต้อง' },\n          ])));\n      } else if (role === 'DIRECTOR') {\n        card = h('div', { class: 'card' },\n          h('div', { class: 'card-head' }, h('h2', { text: 'งานของผู้อำนวยการ' })),\n          h('div', { class: 'card-body' }, stepList([\n            { text: 'ดูภาพรวมการเงินของปีการศึกษา: ยอดเรียกเก็บ ยอดรับ ยอดค้าง และความคืบหน้ารายชั้น', route: 'dashboard', button: 'ภาพรวม' },\n            { text: 'พิจารณาคำขอลดหย่อน ยกเว้น และยกเลิกรายการเรียกเก็บ', help: 'ตรวจเหตุผลและเอกสารอ้างอิงก่อนอนุมัติ', route: 'approvals', button: 'คำขออนุมัติ' },\n            { text: 'ตรวจและลงนามรายงานรับเงินประจำวัน เปิดยอดใหม่เมื่อจำเป็นต้องแก้ไข', route: 'report-daily', button: 'รายงานประจำวัน' },\n            { text: 'ดูรายการรับเงินประจำวันและยอดรวมแยกช่องทาง', route: 'payment-history', button: 'รายการรับเงิน' },\n            { text: 'ดูอัตราเงินบำรุง ยอดเรียกเก็บ และยอดค้างของแต่ละชั้น', route: 'fees' },\n            { text: 'ดูทะเบียนเล่มใบเสร็จ และเลขที่ที่ใช้ไป', route: 'receipt-books' },\n            { text: 'ดูประวัติการใช้งานของทุกบัญชี และตรวจว่าประวัติไม่ถูกแก้ไข', route: 'audit' },\n            { text: 'ตรวจความถูกต้องของข้อมูลทั้งระบบ: ยอดเงิน เลขที่ใบเสร็จ และวันที่ปิดยอดแล้ว', route: 'integrity', button: 'ตรวจความถูกต้อง' },\n          ])));\n      } else {\n        card = h('div', { class: 'card' },\n          h('div', { class: 'card-head' }, h('h2', { text: 'งานของเจ้าหน้าที่การเงิน' })),\n          h('div', { class: 'card-body' }, stepList([\n            { text: 'นำเข้ารายชื่อนักเรียนจาก Excel หรือ CSV แล้วตรวจรายชื่อแยกตามชั้นและห้อง', route: 'students', button: 'ข้อมูลนักเรียน' },\n            { text: 'ตั้งอัตราเงินบำรุงพร้อมเอกสารที่อนุมัติ แล้วสร้างรายการเรียกเก็บ', route: 'fees', button: 'อัตราและการเรียกเก็บ' },\n            { text: 'ลงทะเบียนและเปิดใช้เล่มใบเสร็จรับเงินจากเล่มจริง', route: 'receipt-books', button: 'เล่มใบเสร็จ' },\n            { text: 'รับชำระเงิน: เขียนใบเสร็จจริง แล้วบันทึกเลขเล่ม เลขที่ และจำนวนเงิน', route: 'payments', button: 'รับชำระเงิน' },\n            { text: 'ยื่นคำขอลดหย่อน ยกเว้น หรือยกเลิกรายการเรียกเก็บ และติดตามผล', route: 'approvals', button: 'คำขออนุมัติ' },\n            { text: 'สิ้นวัน: พิมพ์รายงานรับเงินประจำวัน ตรวจกับเงินและสำเนาใบเสร็จ ให้ผู้เกี่ยวข้องลงนาม แล้วกดปิดยอด', route: 'report-daily', button: 'ปิดยอดประจำวัน' },\n            { text: 'พิมพ์เอกสารแจ้งยอดถึงผู้ปกครอง และรายงานอื่น ๆ', route: 'reports', button: 'รายงาน' },\n          ])));\n      }\n      var stats = [\n        stat('ปีการศึกษาปัจจุบัน', String(me.school.currentAcademicYear)),\n        stat('บทบาทของคุณ', me.user.roleLabel),\n        stat('สถานะการพัฒนาระบบ', (/ระยะที่ \\d+/.exec(BOOT.release) || ['ระยะที่ ?'])[0] + ' จาก 8'),\n      ];\n      var page = function (extra) {\n        return h('div', null,\n          pageHead('สวัสดี คุณ' + me.user.displayName, me.school.name + ' · ' + me.user.roleLabel),\n          h('div', { class: 'grid-cards' }, (extra ? [extra] : []).concat(stats)),\n          card);\n      };\n      if (role === 'ADMIN') {\n        return Promise.all([App.api('backups.status', {}), App.api('integrity.status', {})]).then(function (res) {\n          var b = res[0];\n          var integrity = res[1].last;\n          var last = b.last;\n          var stale = !last || daysSince(last.createdAt.slice(0, 10), b.today) > 2;\n          var box = App.statCard('สำรองข้อมูลล่าสุด', last ? App.fmt.datetime(last.createdAt) : 'ยังไม่เคยสำรอง',\n            b.schedule.enabled ? 'สำรองอัตโนมัติทุกวัน ' + b.schedule.hourLabel : 'ยังไม่เปิดการสำรองอัตโนมัติ', stale || !b.schedule.enabled ? 'danger' : 'success');\n          box.classList.add('clickable');\n          box.addEventListener('click', function () { App.go('backups'); });\n          var node = page(box);\n          var alerts = [];\n          if (!b.schedule.enabled) alerts.push(h('div', { class: 'alert alert-warning', text: 'ยังไม่ได้เปิดการสำรองข้อมูลอัตโนมัติ กรุณาเปิดในหน้า \"สำรองและกู้คืนข้อมูล\"' }));\n          if (integrity && !integrity.ok) alerts.push(integrityAlert(integrity));\n          if (b.lastAuto && !b.lastAuto.ok) alerts.push(h('div', { class: 'alert alert-error', text: 'การสำรองข้อมูลอัตโนมัติครั้งล่าสุดไม่สำเร็จ กรุณาตรวจในหน้า \"สำรองและกู้คืนข้อมูล\"' }));\n          else if (b.schedule.enabled && stale) alerts.push(h('div', { class: 'alert alert-warning', text: 'ไม่มีการสำรองข้อมูลมากกว่า 2 วัน กรุณาตรวจการสำรองอัตโนมัติ' }));\n          if (alerts.length) node.insertBefore(h('div', { class: 'stack', style: { marginBottom: '16px' } }, alerts), node.children[1]);\n          return node;\n        }, function () { return page(null); });\n      }\n      // คำขอที่รออนุมัติ และสิ่งที่ต้องตรวจในทะเบียนคุมใบเสร็จ\n      return Promise.all([App.api('approvals.list'), App.api('receipts.books'), App.api('arrears.summary'), App.api('closings.list', {}),\n        role === 'DIRECTOR' ? App.api('integrity.status', {}) : Promise.resolve(null)]).then(function (res) {\n        var label = role === 'DIRECTOR' ? 'คำขอรอพิจารณา' : 'คำขอรออนุมัติ';\n        var count = res[0].pendingCount;\n        var box = App.statCard(label, count + ' รายการ', count ? 'กดเพื่อดูรายละเอียด' : 'ไม่มีคำขอค้าง', count ? 'danger' : null);\n        box.classList.add('clickable');\n        box.addEventListener('click', function () { App.go('approvals'); });\n        var active = res[1].books.filter(function (b) { return b.status === 'ACTIVE'; })[0];\n        var alerts = [];\n        if (active && active.gaps.length) {\n          alerts.push(h('div', { class: 'alert alert-warning', text: 'เลขที่ใบเสร็จขาดช่วงในเล่มที่ ' + active.bookNo + ': ' + active.gaps.join(', ') + ' ต้องตรวจกับใบเสร็จจริง แล้วบันทึกรับเงินหรือยกเลิกเลขที่นั้น' }));\n        }\n        if (active && active.low) alerts.push(h('div', { class: 'alert alert-warning', text: 'ใบเสร็จเล่มที่ ' + active.bookNo + ' เหลือ ' + active.remaining + ' ฉบับ กรุณาเตรียมเล่มใหม่' }));\n        if (!active && role === 'FINANCE') alerts.push(h('div', { class: 'alert alert-info', text: 'ยังไม่มีเล่มใบเสร็จที่กำลังใช้ ลงทะเบียนและเปิดใช้เล่มก่อนรับเงิน' }));\n        if (res[4] && res[4].last && !res[4].last.ok) alerts.unshift(integrityAlert(res[4].last));\n        if (res[3].unclosedCount) {\n          alerts.push(h('div', { class: 'alert alert-warning' },\n            h('span', { text: 'มีวันที่รับเงินแล้วแต่ยังไม่ปิดยอด ' + res[3].unclosedCount + ' วัน (30 วันล่าสุด) ' }),\n            App.button('ดูรายงานประจำวัน', 'ghost btn-sm', function () { App.go('report-daily'); })));\n        }\n        var ar = res[2].school;\n        var arrearsBox = App.statCard('ยอดค้างทั้งหมด', App.fmt.money(ar.totalSatang),\n          ar.owingStudents + ' คน' + (ar.overdueSatang ? ' · เลยกำหนด ' + App.fmt.money(ar.overdueSatang) : ''), ar.totalSatang ? 'danger' : 'success');\n        arrearsBox.classList.add('clickable');\n        arrearsBox.addEventListener('click', function () { App.go('arrears'); });\n        var node = page(box);\n        node.children[1].insertBefore(arrearsBox, node.children[1].children[1]);\n        if (alerts.length) node.insertBefore(h('div', { class: 'stack', style: { marginBottom: '16px' } }, alerts), node.children[1]);\n        return node;\n      }, function () { return page(null); });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // ผู้ใช้งาน (ผู้ดูแลระบบ)\n  // ---------------------------------------------------------------------------\n  var ROLE_OPTIONS = [\n    { value: 'FINANCE', label: 'เจ้าหน้าที่การเงิน' },\n    { value: 'DIRECTOR', label: 'ผู้อำนวยการ' },\n    { value: 'ADMIN', label: 'ผู้ดูแลระบบ' },\n  ];\n  var STATUS_OPTIONS = [\n    { value: 'ACTIVE', label: 'ใช้งาน' },\n    { value: 'DISABLED', label: 'ปิดการใช้งาน' },\n  ];\n\n  function checkTempPassword(values) {\n    if (values.tempPassword !== values.confirmPassword) return Promise.reject({ message: 'รหัสผ่านชั่วคราวทั้งสองช่องไม่ตรงกัน' });\n    return null;\n  }\n\n  function openCreateUser() {\n    var googleMode = App.state.me.authMode === 'GOOGLE';\n    var fields = [\n      { key: 'username', label: 'ชื่อผู้ใช้', required: true, mono: true, autocapitalize: 'none', maxlength: 32, help: 'ภาษาอังกฤษตัวพิมพ์เล็ก เช่น somchai.k (เปลี่ยนภายหลังไม่ได้)' },\n      { key: 'displayName', label: 'ชื่อ-นามสกุล', required: true, maxlength: 100 },\n      { key: 'position', label: 'ตำแหน่ง', maxlength: 100 },\n      { key: 'email', label: 'อีเมล', type: 'email', required: googleMode, maxlength: 254, help: googleMode ? 'บัญชี Google ของโรงเรียนที่ใช้เข้าสู่ระบบ' : 'ไม่บังคับ' },\n      { key: 'role', label: 'บทบาท', type: 'select', options: ROLE_OPTIONS, value: 'FINANCE', required: true, span2: true },\n    ];\n    if (!googleMode) {\n      fields.push({ key: 'tempPassword', label: 'รหัสผ่านชั่วคราว', type: 'password', required: true, autocomplete: 'new-password' });\n      fields.push({ key: 'confirmPassword', label: 'ยืนยันรหัสผ่านชั่วคราว', type: 'password', required: true, autocomplete: 'new-password' });\n    }\n    App.formModal({\n      title: 'เพิ่มผู้ใช้',\n      intro: googleMode ? null : h('div', { class: 'alert alert-info' },\n        h('div', { text: 'ผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก แจ้งรหัสผ่านชั่วคราวเป็นการส่วนตัวเท่านั้น รหัสผ่านต้อง:' }),\n        rulesList()),\n      fields: fields,\n      submitLabel: 'เพิ่มผู้ใช้',\n      onSubmit: function (v) {\n        return checkTempPassword(v) || App.api('users.create', {\n          username: v.username, displayName: v.displayName, position: v.position, email: v.email, role: v.role, tempPassword: v.tempPassword,\n        });\n      },\n      onDone: function (user) {\n        App.toast('เพิ่มผู้ใช้ ' + user.username + ' เรียบร้อยแล้ว', 'success');\n        App.refresh();\n      },\n    });\n  }\n\n  function openEditUser(user) {\n    var self = user.userId === App.state.me.user.userId;\n    App.formModal({\n      title: 'แก้ไขผู้ใช้: ' + user.username,\n      intro: self ? 'นี่คือบัญชีของคุณ จึงเปลี่ยนบทบาทหรือปิดการใช้งานไม่ได้' :\n        'ถ้าเปลี่ยนบทบาทหรือปิดการใช้งาน ผู้ใช้นี้จะถูกออกจากระบบทันที',\n      fields: [\n        { key: 'displayName', label: 'ชื่อ-นามสกุล', value: user.displayName, required: true, maxlength: 100 },\n        { key: 'position', label: 'ตำแหน่ง', value: user.position, maxlength: 100 },\n        { key: 'email', label: 'อีเมล', type: 'email', value: user.email, maxlength: 254, span2: true },\n        { key: 'role', label: 'บทบาท', type: 'select', options: ROLE_OPTIONS, value: user.role, disabled: self },\n        { key: 'status', label: 'สถานะ', type: 'select', options: STATUS_OPTIONS, value: user.status, disabled: self },\n      ],\n      onSubmit: function (v) {\n        return App.api('users.update', {\n          userId: user.userId, displayName: v.displayName, position: v.position, email: v.email, role: v.role, status: v.status,\n        });\n      },\n      onDone: function () {\n        App.toast('บันทึกข้อมูลผู้ใช้เรียบร้อยแล้ว', 'success');\n        if (self) App.reloadMe(); else App.refresh();\n      },\n    });\n  }\n\n  function openResetPassword(user) {\n    App.formModal({\n      title: 'รีเซ็ตรหัสผ่าน: ' + user.username,\n      intro: h('div', { class: 'alert alert-warning' },\n        h('div', { text: 'การเข้าสู่ระบบเดิมของผู้ใช้นี้จะหมดอายุทันที และผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งถัดไป รหัสผ่านชั่วคราวต้อง:' }),\n        rulesList()),\n      fields: [\n        { key: 'tempPassword', label: 'รหัสผ่านชั่วคราวใหม่', type: 'password', autocomplete: 'new-password' },\n        { key: 'confirmPassword', label: 'ยืนยันรหัสผ่านชั่วคราว', type: 'password', autocomplete: 'new-password' },\n      ],\n      submitLabel: 'รีเซ็ตรหัสผ่าน',\n      onSubmit: function (v) {\n        return checkTempPassword(v) || App.api('users.resetPassword', { userId: user.userId, tempPassword: v.tempPassword });\n      },\n      onDone: function () {\n        App.toast('รีเซ็ตรหัสผ่านของ ' + user.username + ' แล้ว แจ้งรหัสผ่านชั่วคราวเป็นการส่วนตัว', 'success');\n        App.refresh();\n      },\n    });\n  }\n\n  App.defineRoute('users', {\n    title: 'ผู้ใช้งาน',\n    roles: ['ADMIN'],\n    menu: { group: 'manage', label: 'ผู้ใช้งาน', icon: 'users' },\n    render: function () {\n      return App.api('users.list').then(function (users) {\n        var googleMode = App.state.me.authMode === 'GOOGLE';\n        var search = App.field({ label: 'ค้นหา', placeholder: 'ชื่อผู้ใช้ ชื่อ-นามสกุล หรือตำแหน่ง' });\n        var list = h('div');\n        function draw() {\n          var q = search.input.value.trim().toLowerCase();\n          var rows = users.filter(function (u) {\n            return !q || (u.username + ' ' + u.displayName + ' ' + (u.position || '') + ' ' + (u.email || '')).toLowerCase().indexOf(q) !== -1;\n          });\n          clear(list).appendChild(App.table({\n            rows: rows,\n            empty: 'ไม่พบผู้ใช้',\n            columns: [\n              { label: 'ชื่อผู้ใช้', render: function (u) { return h('span', { class: 'mono', text: u.username }); } },\n              { label: 'ชื่อ-นามสกุล', render: function (u) {\n                return h('div', null, h('div', { text: u.displayName }), u.position ? h('div', { class: 'muted small', text: u.position }) : null);\n              } },\n              { label: 'บทบาท', render: function (u) { return App.roleBadge(u.role); } },\n              { label: 'สถานะ', render: function (u) {\n                return h('div', null, App.badge(u.statusLabel, u.status === 'ACTIVE' ? 'success' : 'muted'), ' ',\n                  u.mustChangePassword && !googleMode ? App.badge('รอเปลี่ยนรหัสผ่าน', 'warning') : null);\n              } },\n              { label: 'เข้าสู่ระบบล่าสุด', render: function (u) { return App.fmt.datetime(u.lastLoginAt); } },\n              { label: 'จัดการ', className: 'actions', render: function (u) {\n                var self = u.userId === App.state.me.user.userId;\n                return [\n                  button('แก้ไข', 'secondary btn-sm', function () { openEditUser(u); }, 'edit'),\n                  !googleMode && !self ? button('รีเซ็ตรหัสผ่าน', 'secondary btn-sm', function () { openResetPassword(u); }, 'key') : null,\n                ];\n              } },\n            ],\n          }));\n        }\n        search.input.addEventListener('input', draw);\n        draw();\n        return h('div', null,\n          pageHead('ผู้ใช้งาน', 'เพิ่มผู้ใช้ กำหนดบทบาท และรีเซ็ตรหัสผ่าน (ไม่มีการลบผู้ใช้ ใช้ \"ปิดการใช้งาน\" แทน)',\n            button('เพิ่มผู้ใช้', '', openCreateUser, 'plus')),\n          h('div', { class: 'card' }, h('div', { class: 'card-body' }, h('div', { class: 'toolbar' }, search.wrap), list)));\n      });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // ตั้งค่าโรงเรียน (ทุกบทบาทดูได้ แก้ไขได้เฉพาะผู้ดูแลระบบ)\n  // ---------------------------------------------------------------------------\n  function settingInput(item, editable) {\n    var disabled = !editable || item.readOnly;\n    var help = item.description || '';\n    if ((item.type === 'int') && item.min !== null) help = (help ? help + ' ' : '') + '(' + item.min + '–' + item.max + ')';\n    if (item.type === 'bool') return App.field({ type: 'checkbox', label: item.label, value: item.value, help: help, disabled: disabled, span2: true });\n    if (item.type === 'list') return App.field({ type: 'textarea', label: item.label, value: item.value.join(', '), help: help, disabled: disabled, span2: true, rows: 2, maxlength: 1500 });\n    if (item.type === 'int' || item.type === 'year') return App.field({ type: 'number', label: item.label, value: item.value, min: item.min, max: item.max, help: help, disabled: disabled, inputmode: 'numeric' });\n    return App.field({ label: item.label, value: item.value, help: help, disabled: disabled, maxlength: 300, span2: item.key === 'SCHOOL_ADDRESS' || item.key === 'SCHOOL_AFFILIATION' });\n  }\n\n  function settingCurrentValue(item, f) {\n    if (item.type === 'bool') return f.input.checked;\n    if (item.type === 'list') return f.input.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean).join(',');\n    return String(f.input.value).trim();\n  }\n\n  function settingOriginalValue(item) {\n    if (item.type === 'bool') return item.value;\n    if (item.type === 'list') return item.value.join(',');\n    return String(item.value === null || item.value === undefined ? '' : item.value);\n  }\n\n  App.defineRoute('settings', {\n    title: 'ตั้งค่าโรงเรียน',\n    roles: ALL,\n    menu: { group: 'info', label: 'ตั้งค่าโรงเรียน', icon: 'settings' },\n    render: function () {\n      return App.api('settings.get').then(function (data) {\n        var inputs = [];\n        var cards = data.groups.map(function (g) {\n          var grid = h('div', { class: 'form-grid' });\n          g.items.forEach(function (item) {\n            var f = settingInput(item, data.editable);\n            if (!item.readOnly) inputs.push({ item: item, field: f });\n            grid.appendChild(f.wrap);\n          });\n          return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: g.label })), h('div', { class: 'card-body' }, grid));\n        });\n        var footer;\n        if (data.editable) {\n          var save = button('บันทึกการเปลี่ยนแปลง', '', function () {\n            var values = {};\n            inputs.forEach(function (x) {\n              var current = settingCurrentValue(x.item, x.field);\n              if (current !== settingOriginalValue(x.item)) values[x.item.key] = current;\n            });\n            if (!Object.keys(values).length) { App.toast('ไม่มีค่าที่เปลี่ยนแปลง'); return; }\n            save.disabled = true;\n            App.api('settings.update', { values: values })\n              .then(function (res) {\n                App.toast('บันทึกค่าตั้งค่า ' + res.changed.length + ' รายการเรียบร้อยแล้ว', 'success');\n                return App.reloadMe();\n              })\n              .catch(App.fail)\n              .then(function () { save.disabled = false; });\n          }, 'check');\n          footer = h('div', { class: 'card card-body', style: { position: 'sticky', bottom: '12px', marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },\n            h('span', { class: 'muted small', text: 'ระบบบันทึกเฉพาะค่าที่เปลี่ยน และเก็บค่าเดิม/ค่าใหม่ไว้ในประวัติการใช้งาน' }), save);\n        } else {\n          footer = h('div', { class: 'alert alert-info', style: { marginTop: '16px' }, text: 'เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขค่าตั้งค่าได้' });\n        }\n        return h('div', null,\n          pageHead('ตั้งค่าโรงเรียน', 'ข้อมูลโรงเรียน ผู้ลงนาม รายการที่ต้องอนุมัติ และความปลอดภัยในการเข้าสู่ระบบ'),\n          cards, footer);\n      });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // ปีการศึกษา (ทุกบทบาทดูได้ จัดการได้เฉพาะผู้ดูแลระบบ)\n  // ---------------------------------------------------------------------------\n  function openYearForm(year, years) {\n    var editing = !!year;\n    var nextYear = years.length ? Math.max.apply(null, years.map(function (y) { return y.year; })) + 1 : (App.state.me.school.currentAcademicYear || 2569);\n    var fields = editing ? [] : [\n      { key: 'year', label: 'ปีการศึกษา (พ.ศ.)', type: 'number', value: nextYear, required: true, inputmode: 'numeric', min: 2500, max: 2700 },\n    ];\n    fields = fields.concat([\n      { key: 'label', label: 'ชื่อที่แสดง', value: editing ? year.label : '', placeholder: 'เว้นว่าง = ปีการศึกษา ' + (editing ? year.year : nextYear), maxlength: 60, span2: !editing },\n      { key: 'startDate', label: 'วันเริ่มปีการศึกษา', type: 'date', value: editing ? year.startDate : '' },\n      { key: 'endDate', label: 'วันสิ้นสุดปีการศึกษา', type: 'date', value: editing ? year.endDate : '' },\n    ]);\n    if (editing) {\n      fields.push({ key: 'status', label: 'สถานะ', type: 'select', value: year.status, span2: true,\n        options: [{ value: 'OPEN', label: 'เปิด' }, { value: 'CLOSED', label: 'ปิดแล้ว (สร้างรายการเรียกเก็บใหม่ไม่ได้ แต่รับชำระหนี้ค้างได้)' }] });\n    }\n    App.formModal({\n      title: editing ? 'แก้ไข' + year.label : 'เพิ่มปีการศึกษา',\n      intro: 'วันที่ในช่องเลือกเป็นปี ค.ศ. ตามปฏิทินของเครื่อง ระบบแสดงผลเป็น พ.ศ. ให้ด้านล่างช่อง',\n      fields: fields,\n      onSubmit: function (v) {\n        if (editing) {\n          return App.api('years.update', { academicYearId: year.academicYearId, label: v.label || year.label, startDate: v.startDate, endDate: v.endDate, status: v.status });\n        }\n        return App.api('years.create', { year: v.year, label: v.label, startDate: v.startDate, endDate: v.endDate });\n      },\n      onDone: function () {\n        App.toast('บันทึกปีการศึกษาเรียบร้อยแล้ว', 'success');\n        App.reloadMe();\n      },\n    });\n  }\n\n  App.defineRoute('years', {\n    title: 'ปีการศึกษา',\n    roles: ALL,\n    menu: { group: 'info', label: 'ปีการศึกษา', icon: 'calendar' },\n    render: function () {\n      return App.api('years.list').then(function (years) {\n        var admin = App.state.me.user.role === 'ADMIN';\n        var columns = [\n          { label: 'ปีการศึกษา', render: function (y) {\n            return h('div', null, h('strong', { text: String(y.year) }), ' ', y.isCurrent ? App.badge('ปีปัจจุบัน', 'success') : null);\n          } },\n          { label: 'ชื่อที่แสดง', key: 'label' },\n          { label: 'ช่วงเวลา', render: function (y) {\n            return y.startDate || y.endDate ? App.fmt.date(y.startDate) + ' – ' + App.fmt.date(y.endDate) : 'ไม่ได้ระบุ';\n          } },\n          { label: 'สถานะ', render: function (y) { return App.badge(y.statusLabel, y.status === 'OPEN' ? 'success' : 'muted'); } },\n        ];\n        if (admin) {\n          columns.push({ label: 'จัดการ', className: 'actions', render: function (y) {\n            return [\n              button('แก้ไข', 'secondary btn-sm', function () { openYearForm(y, years); }, 'edit'),\n              !y.isCurrent && y.status === 'OPEN' ? button('ตั้งเป็นปีปัจจุบัน', 'secondary btn-sm', function () {\n                App.confirm('ตั้งปีการศึกษา ' + y.year + ' เป็นปีปัจจุบัน? ระบบจะใช้ปีนี้เป็นค่าเริ่มต้นในการเรียกเก็บและรายงาน', { confirmLabel: 'ตั้งเป็นปีปัจจุบัน' })\n                  .then(function (ok) {\n                    if (!ok) return null;\n                    return App.api('years.setCurrent', { academicYearId: y.academicYearId }).then(function () {\n                      App.toast('ตั้งปีการศึกษา ' + y.year + ' เป็นปีปัจจุบันแล้ว', 'success');\n                      return App.reloadMe();\n                    });\n                  })\n                  .catch(App.fail);\n              }, 'star') : null,\n            ];\n          } });\n        }\n        return h('div', null,\n          pageHead('ปีการศึกษา', 'ปีการศึกษาปัจจุบันใช้เป็นค่าเริ่มต้นของการเรียกเก็บและรายงาน ข้อมูลปีเก่าไม่ถูกลบ',\n            admin ? button('เพิ่มปีการศึกษา', '', function () { openYearForm(null, years); }, 'plus') : null),\n          h('div', { class: 'card' }, h('div', { class: 'card-body' }, App.table({ columns: columns, rows: years, empty: 'ยังไม่มีปีการศึกษา' }))));\n      });\n    },\n  });\n\n  // ---------------------------------------------------------------------------\n  // ประวัติการใช้งาน (ผู้ดูแลระบบ และผู้อำนวยการ)\n  // ---------------------------------------------------------------------------\n  var ACTION_KIND = {\n    LOGIN_FAILED: 'danger', ACCESS_DENIED: 'danger', CANCEL: 'danger', REJECT: 'danger',\n    CREATE: 'success', APPROVE: 'success', IMPORT: 'success',\n    UPDATE: 'warning', PASSWORD_CHANGE: 'warning', RESTORE: 'warning',\n    LOGIN: 'muted', LOGOUT: 'muted', INTEGRITY_CHECK: 'muted', SETUP: 'muted',\n  };\n\n  function kvTable(obj) {\n    if (!obj || typeof obj !== 'object') return h('p', { class: 'muted', text: 'ไม่มีข้อมูล' });\n    var keys = Object.keys(obj);\n    if (!keys.length) return h('p', { class: 'muted', text: 'ไม่มีข้อมูล' });\n    return h('table', { class: 'kv' }, h('tbody', null, keys.map(function (k) {\n      var v = obj[k];\n      var text = v === null || v === undefined || v === '' ? '–' : (typeof v === 'object' ? JSON.stringify(v) : String(v));\n      return h('tr', null, h('th', { text: k }), h('td', { text: text }));\n    })));\n  }\n\n  function openAuditDetail(item) {\n    var info = {\n      'วันเวลา': formatThaiDateTime_(item.timestamp),\n      'ผู้ใช้': item.username,\n      'บทบาท': item.roleLabel,\n      'การกระทำ': item.actionLabel,\n      'รายการ': item.entityLabel,\n      'รหัสรายการ': item.entityId,\n      'หมายเหตุ': item.note,\n      'รหัสประวัติ': item.logId,\n    };\n    App.modal({\n      title: 'รายละเอียดประวัติ',\n      size: 'lg',\n      body: [kvTable(info),\n        item.before ? [h('h3', { text: 'ค่าเดิม' }), kvTable(item.before)] : null,\n        item.after ? [h('h3', { text: 'ค่าใหม่' }), kvTable(item.after)] : null],\n      actions: [{ label: 'ปิด', kind: 'secondary' }],\n    });\n  }\n\n  function openVerifyResult(result) {\n    var body;\n    if (result.ok) {\n      body = h('div', { class: 'alert alert-success', text: 'ถูกต้อง: ประวัติการใช้งาน ' + result.total + ' รายการ ต่อเนื่องครบถ้วน ไม่พบการแก้ไขหรือลบ' });\n    } else {\n      body = [\n        h('div', { class: 'alert alert-error', text: 'พบปัญหา ' + result.problemCount + ' จุด จากประวัติทั้งหมด ' + result.total + ' รายการ' }),\n        App.table({ rows: result.problems, columns: [\n          { label: 'แถวในชีต', key: 'rowNumber' },\n          { label: 'รหัสประวัติ', render: function (p) { return h('span', { class: 'mono', text: p.logId || '–' }); } },\n          { label: 'ปัญหา', key: 'label' },\n        ] }),\n        h('p', { class: 'muted small', text: 'กรุณาตรวจสอบประวัติเวอร์ชันของไฟล์ Google Sheets (ไฟล์ > ประวัติเวอร์ชัน) และรายงานผู้อำนวยการ' }),\n      ];\n    }\n    App.modal({ title: 'ผลการตรวจความถูกต้องของประวัติ', size: 'lg', body: body, actions: [{ label: 'ปิด', kind: 'secondary' }] });\n  }\n\n  App.defineRoute('audit', {\n    title: 'ประวัติการใช้งาน',\n    roles: ['ADMIN', 'DIRECTOR'],\n    menu: { group: 'manage', label: 'ประวัติการใช้งาน', icon: 'history' },\n    render: function () {\n      var filters = { action: '', username: '', dateFrom: '', dateTo: '', q: '', page: 1 };\n      return App.api('audit.list', filters).then(function (first) {\n        var action = App.field({ label: 'การกระทำ', type: 'select', options: [{ value: '', label: 'ทั้งหมด' }].concat(first.actions) });\n        var username = App.field({ label: 'ชื่อผู้ใช้', autocapitalize: 'none', mono: true });\n        var dateFrom = App.field({ label: 'ตั้งแต่วันที่', type: 'date' });\n        var dateTo = App.field({ label: 'ถึงวันที่', type: 'date' });\n        var q = App.field({ label: 'คำค้น', placeholder: 'รหัสรายการ หรือหมายเหตุ' });\n        var results = h('div');\n\n        function draw(data) {\n          var pager = h('div', { class: 'pager' },\n            h('span', { class: 'muted small', text: 'ทั้งหมด ' + data.total.toLocaleString('th-TH') + ' รายการ · หน้า ' + data.page + ' จาก ' + data.pages }),\n            h('div', { class: 'toolbar', style: { marginBottom: '0' } },\n              button('ก่อนหน้า', 'secondary btn-sm', function () { load(data.page - 1); }),\n              button('ถัดไป', 'secondary btn-sm', function () { load(data.page + 1); })));\n          pager.querySelectorAll('button')[0].disabled = data.page <= 1;\n          pager.querySelectorAll('button')[1].disabled = data.page >= data.pages;\n          clear(results).appendChild(App.table({\n            rows: data.items,\n            empty: 'ไม่พบประวัติตามเงื่อนไข',\n            onRowClick: openAuditDetail,\n            columns: [\n              { label: 'วันเวลา', className: 'nowrap', render: function (r) { return App.fmt.datetime(r.timestamp); } },\n              { label: 'ผู้ใช้', render: function (r) { return h('div', null, h('div', { class: 'mono', text: r.username }), h('div', { class: 'muted small', text: r.roleLabel })); } },\n              { label: 'การกระทำ', render: function (r) { return App.badge(r.actionLabel, ACTION_KIND[r.action] || ''); } },\n              { label: 'รายการ', render: function (r) { return h('div', null, h('div', { text: r.entityLabel }), r.entityId ? h('div', { class: 'muted small mono', text: r.entityId }) : null); } },\n              { label: 'หมายเหตุ', key: 'note' },\n            ],\n          }));\n          results.appendChild(pager);\n        }\n\n        function load(page) {\n          filters = { action: action.get(), username: username.get(), dateFrom: dateFrom.get(), dateTo: dateTo.get(), q: q.get(), page: page || 1 };\n          return App.api('audit.list', filters).then(draw).catch(App.fail);\n        }\n\n        var searchBtn = button('ค้นหา', '', function () { load(1); }, 'search');\n        var resetBtn = button('ล้างเงื่อนไข', 'secondary', function () {\n          [username, dateFrom, dateTo, q].forEach(function (f) { f.input.value = ''; f.input.dispatchEvent(new Event('change')); });\n          action.input.value = '';\n          load(1);\n        });\n        var verifyBtn = button('ตรวจความถูกต้องของประวัติ', 'secondary', function () {\n          verifyBtn.disabled = true;\n          App.api('audit.verify')\n            .then(function (result) { openVerifyResult(result); return load(filters.page); })\n            .catch(App.fail)\n            .then(function () { verifyBtn.disabled = false; });\n        }, 'shield');\n        [username.input, q.input].forEach(function (input) {\n          input.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(1); });\n        });\n        draw(first);\n        return h('div', null,\n          pageHead('ประวัติการใช้งาน', 'บันทึกทุกการเพิ่ม แก้ไข เข้าสู่ระบบ และการปฏิเสธสิทธิ์ แก้ไขหรือลบไม่ได้ คลิกรายการเพื่อดูค่าเดิมและค่าใหม่', verifyBtn),\n          h('div', { class: 'card' }, h('div', { class: 'card-body' },\n            h('div', { class: 'toolbar' }, action.wrap, username.wrap, dateFrom.wrap, dateTo.wrap, q.wrap),\n            h('div', { class: 'toolbar' }, searchBtn, resetBtn),\n            results)));\n      });\n    },\n  });\n\n})();\n</script>\n",
  "Styles": "<style>\n/* ==========================================================================\n   Styles — โทนกรมท่า ขาว ฟ้า / รองรับคอมพิวเตอร์และมือถือ / พิมพ์ได้\n   ========================================================================== */\n:root {\n  --navy: #1F3A5F;\n  --navy-800: #19304F;\n  --navy-900: #122540;\n  --navy-100: #E3E9F2;\n  --blue: #2E86DE;\n  --blue-700: #1F6FBF;\n  --blue-50: #EEF5FD;\n  --bg: #F3F6FA;\n  --surface: #FFFFFF;\n  --text: #1B2B3F;\n  --muted: #5B6B80;\n  --border: #DCE3EC;\n  --success: #1E7F52;\n  --success-bg: #E5F4EC;\n  --danger: #B73A2E;\n  --danger-bg: #FBEAE8;\n  --warning: #9A6412;\n  --warning-bg: #FDF3E1;\n  --radius: 10px;\n  --radius-sm: 6px;\n  --shadow: 0 1px 2px rgba(18, 37, 64, .06), 0 6px 16px rgba(18, 37, 64, .06);\n  --sidebar-w: 260px;\n  --topbar-h: 60px;\n}\n\n* { box-sizing: border-box; }\nhtml { -webkit-text-size-adjust: 100%; }\nbody {\n  margin: 0;\n  font-family: 'Sarabun', 'Tahoma', 'Leelawadee UI', 'Thonburi', sans-serif;\n  font-size: 16px;\n  line-height: 1.55;\n  color: var(--text);\n  background: var(--bg);\n}\nh1, h2, h3 { margin: 0; line-height: 1.3; color: var(--navy-900); }\nh1 { font-size: 1.45rem; }\nh2 { font-size: 1.15rem; }\nh3 { font-size: 1rem; }\np { margin: 0 0 .6em; }\na { color: var(--blue-700); }\nbutton, input, select, textarea { font: inherit; color: inherit; }\n:focus-visible { outline: 3px solid rgba(46, 134, 222, .45); outline-offset: 2px; }\n.muted { color: var(--muted); }\n.small { font-size: .875rem; }\n.nowrap { white-space: nowrap; }\n.hidden { display: none !important; }\n.mono { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace; font-size: .85em; }\n.stack { display: flex; flex-direction: column; gap: 14px; }\n\n/* ---------- โหลดหน้าแรก / แถบสถานะกำลังทำงาน ---------- */\n.boot-screen { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--muted); }\n.spinner { width: 34px; height: 34px; border: 3px solid var(--navy-100); border-top-color: var(--navy); border-radius: 50%; animation: spin .8s linear infinite; }\n@keyframes spin { to { transform: rotate(360deg); } }\n.busy-bar { position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 100; background: linear-gradient(90deg, transparent, var(--blue), transparent); background-size: 50% 100%; opacity: 0; transition: opacity .15s; }\nbody.is-busy .busy-bar { opacity: 1; animation: busy 1s linear infinite; }\n@keyframes busy { from { background-position: -50% 0; } to { background-position: 150% 0; } }\n\n/* ---------- ปุ่ม ---------- */\n.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 8px 16px; border-radius: var(--radius-sm); border: 1px solid var(--navy); background: var(--navy); color: #fff; font-weight: 600; cursor: pointer; text-decoration: none; white-space: nowrap; }\n.btn:hover { background: var(--navy-800); }\n.btn:disabled { opacity: .55; cursor: not-allowed; }\n.btn-secondary { background: #fff; color: var(--navy); border-color: var(--border); }\n.btn-secondary:hover { background: var(--blue-50); }\n.btn-danger { background: var(--danger); border-color: var(--danger); }\n.btn-danger:hover { background: #9C2F25; }\n.btn-ghost { background: transparent; color: var(--navy); border-color: transparent; }\n.btn-ghost:hover { background: var(--blue-50); }\n.btn-sm { min-height: 32px; padding: 4px 10px; font-size: .875rem; font-weight: 500; }\n.btn-block { width: 100%; }\n.btn svg { width: 18px; height: 18px; flex-shrink: 0; }\n\n/* ---------- ป้าย ---------- */\n.badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 999px; font-size: .8rem; font-weight: 600; background: var(--navy-100); color: var(--navy); white-space: nowrap; }\n.badge-ADMIN { background: var(--navy); color: #fff; }\n.badge-FINANCE { background: var(--blue-50); color: var(--blue-700); border: 1px solid #C8DFF7; }\n.badge-DIRECTOR { background: var(--warning-bg); color: var(--warning); border: 1px solid #F2DDB4; }\n.badge-success { background: var(--success-bg); color: var(--success); }\n.badge-danger { background: var(--danger-bg); color: var(--danger); }\n.badge-muted { background: #EEF1F5; color: var(--muted); }\n.badge-warning { background: var(--warning-bg); color: var(--warning); }\n\n/* ---------- ฟอร์ม ---------- */\n.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; }\n.form-grid .span-2 { grid-column: 1 / -1; }\n.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }\n.field > label { font-weight: 600; font-size: .95rem; }\n.field .req { color: var(--danger); }\n.field .help { color: var(--muted); font-size: .85rem; }\n.field .preview { color: var(--blue-700); font-size: .85rem; }\n.input, select.input, textarea.input { width: 100%; min-height: 42px; padding: 8px 12px; border: 1px solid #C9D3DF; border-radius: var(--radius-sm); background: #fff; }\ntextarea.input { min-height: 84px; resize: vertical; }\n.input:focus { border-color: var(--blue); outline: 3px solid rgba(46, 134, 222, .2); }\n.input:disabled, .input[readonly] { background: #F2F5F9; color: var(--muted); }\n.input-group { display: flex; gap: 6px; }\n.input-group .input { flex: 1; }\n.switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }\n.switch input { width: 20px; height: 20px; accent-color: var(--navy); }\n.alert { padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid; line-height: 1.5; }\n.alert-error { background: var(--danger-bg); border-color: #F2C9C4; color: #8E2A1F; }\n.alert-info { background: var(--blue-50); border-color: #C8DFF7; color: var(--navy-900); }\n.alert-success { background: var(--success-bg); border-color: #BFE3CF; color: #155F3D; }\n.alert-warning { background: var(--warning-bg); border-color: #F2DDB4; color: #6F4A0E; }\n.rules { margin: 6px 0 0; padding-left: 20px; color: var(--muted); font-size: .9rem; }\n\n/* ---------- หน้าเข้าสู่ระบบ ---------- */\n.login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; background: linear-gradient(160deg, var(--navy-900) 0%, var(--navy) 55%, #2A5C93 100%); }\n.login-card { width: 100%; max-width: 420px; background: #fff; border-radius: 14px; box-shadow: 0 20px 50px rgba(0, 0, 0, .25); overflow: hidden; }\n.login-head { padding: 26px 28px 18px; border-bottom: 1px solid var(--border); text-align: center; }\n.login-logo { width: 56px; height: 56px; margin: 0 auto 10px; border-radius: 14px; background: var(--navy); color: #fff; display: flex; align-items: center; justify-content: center; }\n.login-logo svg { width: 30px; height: 30px; }\n.login-options { display: grid; gap: 6px; }\n.login-options .field { margin: 0; }\n.login-options .help { font-size: .82rem; }\n.login-school { font-size: 1.25rem; font-weight: 700; color: var(--navy-900); }\n.login-app { color: var(--muted); font-size: .95rem; }\n.login-body { padding: 22px 28px 26px; display: flex; flex-direction: column; gap: 14px; }\n.login-foot { padding: 12px 28px; background: #F7F9FC; color: var(--muted); font-size: .8rem; text-align: center; }\n\n/* ---------- โครงหน้าแอป ---------- */\n.shell { display: grid; grid-template-columns: var(--sidebar-w) minmax(0, 1fr); min-height: 100vh; }\n.sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--navy); color: #DCE6F2; z-index: 30; }\n.brand { display: flex; align-items: center; gap: 12px; padding: 18px 18px 16px; border-bottom: 1px solid rgba(255, 255, 255, .1); }\n.brand-logo { width: 40px; height: 40px; border-radius: 10px; background: rgba(255, 255, 255, .12); display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; }\n.brand-logo svg { width: 22px; height: 22px; }\n.brand-name { color: #fff; font-weight: 700; line-height: 1.25; }\n.brand-sub { font-size: .78rem; color: #A9BBD3; line-height: 1.3; }\n.nav { flex: 1; overflow-y: auto; padding: 10px 10px 16px; }\n.nav-group { margin-top: 12px; }\n.nav-group-label { padding: 4px 10px; font-size: .75rem; font-weight: 600; letter-spacing: .02em; color: #8FA6C4; }\n.nav-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; margin: 2px 0; border: 0; border-radius: 8px; background: transparent; color: #DCE6F2; text-align: left; cursor: pointer; font-weight: 500; }\n.nav-item svg { width: 20px; height: 20px; flex-shrink: 0; opacity: .9; }\n.nav-item:hover { background: rgba(255, 255, 255, .08); color: #fff; }\n.nav-item.active { background: #fff; color: var(--navy); font-weight: 700; }\n.nav-item.active svg { color: var(--blue); }\n.userbox { padding: 12px 14px 16px; border-top: 1px solid rgba(255, 255, 255, .1); }\n.userbox-name { color: #fff; font-weight: 600; }\n.userbox-role { font-size: .8rem; color: #A9BBD3; margin-bottom: 8px; }\n.userbox .btn { border-color: rgba(255, 255, 255, .25); background: transparent; color: #fff; }\n.userbox .btn:hover { background: rgba(255, 255, 255, .1); }\n.userbox-actions { display: flex; gap: 6px; flex-wrap: wrap; }\n\n.main { min-width: 0; display: flex; flex-direction: column; }\n.topbar { position: sticky; top: 0; z-index: 20; height: var(--topbar-h); display: flex; align-items: center; gap: 12px; padding: 0 24px; background: rgba(255, 255, 255, .96); border-bottom: 1px solid var(--border); backdrop-filter: blur(4px); }\n.topbar-title { font-size: 1.1rem; font-weight: 700; color: var(--navy-900); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.topbar .menu-toggle { display: none; }\n.year-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; background: var(--blue-50); color: var(--blue-700); font-size: .85rem; font-weight: 600; white-space: nowrap; }\n.content { width: 100%; max-width: 1180px; padding: 24px; }\n.backdrop { display: none; }\n\n/* ---------- การ์ด / ส่วนหัวหน้า ---------- */\n.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }\n.page-head p { margin: 4px 0 0; color: var(--muted); }\n.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); scroll-margin-top: calc(var(--topbar-h) + 16px); }\n.card + .card { margin-top: 16px; }\n.card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--border); }\n.card-body { padding: 18px; }\n.grid-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 18px; }\n.grid-cards > .card { margin-top: 0; }\n.stat { padding: 16px 18px; }\n.stat-label { color: var(--muted); font-size: .9rem; }\n.stat-value { font-size: 1.6rem; font-weight: 700; color: var(--navy-900); line-height: 1.2; margin-top: 4px; }\n.steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }\n.steps li { display: flex; gap: 12px; align-items: flex-start; }\n.step-no { width: 28px; height: 28px; border-radius: 50%; background: var(--navy); color: #fff; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }\n.toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 14px; }\n.toolbar .field { min-width: 160px; flex: 1; }\n.toolbar .grow { flex: 2; }\n\n/* ---------- ตาราง ---------- */\n.table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }\n.data-table { width: 100%; border-collapse: collapse; background: #fff; }\n.data-table th { text-align: left; font-size: .85rem; font-weight: 600; color: var(--muted); background: #F7F9FC; padding: 10px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; }\n.data-table td { padding: 10px 12px; border-bottom: 1px solid #EDF1F6; vertical-align: top; }\n.data-table tbody tr:hover { background: #FAFCFE; }\n.data-table tr.clickable { cursor: pointer; }\n.data-table .actions { white-space: nowrap; text-align: right; }\n.data-table .actions .btn + .btn { margin-left: 6px; }\n.cell-stack { min-width: 0; }\n.clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 220px; }\n.empty { padding: 28px 16px; text-align: center; color: var(--muted); }\n.pager { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; flex-wrap: wrap; }\n\n/* ---------- หน้าต่าง (modal) ---------- */\n.modal-overlay { position: fixed; inset: 0; z-index: 60; background: rgba(18, 37, 64, .5); display: flex; align-items: flex-start; justify-content: center; padding: 6vh 16px 16px; overflow-y: auto; }\n.modal { width: 100%; max-width: 560px; background: #fff; border-radius: 12px; box-shadow: 0 24px 60px rgba(0, 0, 0, .3); }\n.modal-lg { max-width: 820px; }\n.modal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 20px; border-bottom: 1px solid var(--border); }\n.modal-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }\n.modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); background: #F9FBFD; border-radius: 0 0 12px 12px; flex-wrap: wrap; }\n.icon-btn { width: 36px; height: 36px; border: 0; background: transparent; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; color: var(--muted); }\n.icon-btn:hover { background: var(--blue-50); color: var(--navy); }\n.icon-btn svg { width: 20px; height: 20px; }\n.kv { width: 100%; border-collapse: collapse; font-size: .9rem; }\n.kv th, .kv td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #EDF1F6; vertical-align: top; word-break: break-word; }\n.kv th { color: var(--muted); font-weight: 600; width: 34%; }\n\n/* ---------- การเงิน ---------- */\n.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }\n.data-table th.num { text-align: right; }\n.strong { font-weight: 700; color: var(--navy-900); }\n.text-danger { color: var(--danger); }\n.text-success { color: var(--success); }\n.field-label { font-weight: 600; margin-bottom: 4px; }\n.check-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px 14px; padding: 6px 0; }\n.check-grid label { display: flex; align-items: center; gap: 8px; font-weight: 400; cursor: pointer; }\n.check-grid input { width: 18px; height: 18px; }\n.stat-sub { color: var(--muted); font-size: .85rem; margin-top: 2px; }\n.stat-danger .stat-value { color: var(--danger); }\n.stack > .card + .card { margin-top: 0; }\n.card.clickable { cursor: pointer; }\n.card.clickable:hover { border-color: var(--blue); }\n.stat-success .stat-value { color: var(--success); }\n.banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px 18px; }\n.banner .big { font-size: 1.35rem; font-weight: 700; color: var(--navy-900); }\n.banner .muted { margin-top: 2px; }\n.receipt-preview { border: 1px dashed #B9C6D6; border-radius: var(--radius-sm); padding: 12px 14px; background: #FBFCFE; }\n.receipt-preview h3 { margin: 0 0 8px; font-size: 1rem; }\n.receipt-line { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }\n.receipt-total { display: flex; justify-content: space-between; gap: 12px; font-weight: 700; border-top: 1px solid var(--border); margin-top: 6px; padding-top: 8px; }\n.alloc-input { max-width: 150px; text-align: right; }\n.amount-input { font-size: 1.25rem; font-weight: 700; }\n.sum-line { padding: 8px 12px; border-radius: var(--radius-sm); background: var(--blue-50); }\n.sum-line.bad { background: var(--danger-bg); color: #8E2A1F; }\n.sum-line.good { background: var(--success-bg); color: #155F3D; }\n.confirm-box { display: flex; gap: 10px; align-items: flex-start; padding: 12px; border: 1px solid #F2DDB4; background: var(--warning-bg); border-radius: var(--radius-sm); cursor: pointer; line-height: 1.5; }\n.confirm-box input { width: 20px; height: 20px; margin-top: 2px; flex-shrink: 0; }\n.tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }\n.tabs .btn[aria-pressed=\"true\"] { background: var(--navy); color: #fff; border-color: var(--navy); }\n.section-title { margin: 0; font-size: 1.05rem; }\n.inline-list { margin: 0; padding-left: 18px; }\n\n/* ---------- ตารางเลขที่ใบเสร็จ ---------- */\n.number-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(54px, 1fr)); gap: 6px; }\n.num-cell { min-height: 40px; padding: 4px; border-radius: 6px; border: 1px solid var(--border); background: #fff; color: var(--muted);\n  font: inherit; font-size: .9rem; font-variant-numeric: tabular-nums; cursor: pointer; }\n.num-cell:hover, .num-cell:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }\n.num-cell.num-USED, .badge.badge-num-USED { background: var(--blue-50); border-color: #C8DFF7; color: var(--blue-700); font-weight: 600; }\n.num-cell.num-CANCELLED, .badge.badge-num-CANCELLED { background: var(--danger-bg); border-color: #F2C9C4; color: var(--danger); }\n.num-cell.num-CANCELLED { text-decoration: line-through; }\n.num-cell.num-CANCEL_PENDING, .badge.badge-num-CANCEL_PENDING { background: var(--warning-bg); border-color: #F2DDB4; color: var(--warning); }\n.num-cell.num-GAP { border: 2px dashed var(--danger); color: var(--danger); font-weight: 700; }\n.badge.badge-num-GAP { background: #fff; border: 1px dashed var(--danger); color: var(--danger); }\n.badge.badge-num-UNUSED { background: #fff; border: 1px solid var(--border); color: var(--muted); }\n.num-cell.num-CLOSED_UNUSED, .badge.badge-num-CLOSED_UNUSED { background: #EEF1F5; color: #8A97A8; }\n.num-cell.num-corrected { box-shadow: inset 0 -3px 0 var(--warning); }\n\n/* ---------- พิมพ์รายงาน ---------- */\n.print-only { display: none; }\n.print-head { margin-bottom: 12px; line-height: 1.5; }\n.print-head h1 { font-size: 16pt; margin: 4px 0; }\n\n/* ---------- เอกสารและรายงานแบบทางการ (ระยะที่ 7) ----------\n   หน้าจอ: แสดงเป็นแผ่นกระดาษ A4 / พิมพ์: เหลือเฉพาะเนื้อเอกสาร (เมนูและปุ่มถูกซ่อน) */\n.report-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }\n.report-item { display: flex; gap: 12px; align-items: flex-start; text-align: left; width: 100%; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow); cursor: pointer; font: inherit; color: inherit; }\n.report-item:hover, .report-item:focus-visible { border-color: var(--blue); outline: none; }\n.report-item svg { width: 22px; height: 22px; flex-shrink: 0; color: var(--blue); margin-top: 2px; }\n.report-item .ri-title { font-weight: 700; display: block; }\n.report-item .ri-desc { color: var(--muted); font-size: .9em; display: block; margin-top: 2px; }\n.doc { background: #fff; color: #111; max-width: 210mm; margin: 0 auto 20px; padding: 12mm 13mm 10mm; border: 1px solid var(--border); border-radius: 4px; box-shadow: var(--shadow); font-size: 15px; line-height: 1.55; }\n.doc-head { text-align: center; margin-bottom: 12px; }\n.doc .strong { color: inherit; }\n.doc-school { font-weight: 700; }\n.doc-title { font-size: 1.2em; font-weight: 700; margin: 2px 0; }\n.doc-sub { color: #222; }\n.doc-draft { display: inline-block; margin-top: 6px; padding: 0 10px; border: 1.5px solid var(--danger); border-radius: 4px; color: var(--danger); font-weight: 700; }\n.doc-section { font-weight: 700; margin: 14px 0 6px; }\n.doc-scroll { overflow-x: auto; }\n.doc-table { width: 100%; border-collapse: collapse; font-size: .92em; }\n.doc-table th, .doc-table td { border: 1px solid #666; padding: 3px 6px; vertical-align: top; }\n.doc-table th { background: #EEF1F5; font-weight: 700; text-align: center; }\n.doc-table .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }\n.doc-table .center { text-align: center; }\n.doc-table .nowrap { white-space: nowrap; }\n.doc-table tr.total td { font-weight: 700; background: #F6F7F9; }\n.doc-table tr.sub td { font-weight: 700; }\n.doc-table tr.void td { color: #666; }\n.doc-table tr.void .amt { text-decoration: line-through; }\n.doc-table tr.indent td:first-child { padding-left: 18px; }\n.doc-lines { margin: 8px 0; }\n.doc-lines div { margin: 2px 0; }\n.doc-note { font-size: .85em; color: #333; margin-top: 8px; }\n.doc-signs { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 22px 24px; margin-top: 26px; break-inside: avoid; }\n.doc-sign { text-align: center; line-height: 1.9; }\n.doc-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 16px; margin-top: 18px; padding-top: 6px; border-top: 1px solid #999; font-size: .78em; color: #333; }\n.doc-letter { font-size: 16px; }\n.doc-letter .letter-head { text-align: center; margin-bottom: 14px; }\n.doc-letter .letter-date { text-align: right; margin: 6px 0 10px; }\n.doc-letter .letter-meta { display: grid; grid-template-columns: 4em minmax(0, 1fr); gap: 2px 8px; margin-bottom: 10px; }\n.doc-letter p { text-indent: 2.5em; margin: 0 0 8px; }\n.doc-letter .letter-sign { margin: 20px 0 0 50%; text-align: center; line-height: 1.9; }\n.status-line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }\n\n/* ---------- กราฟใน Dashboard ----------\n   สีตามระบบ dataviz: แท่งความคืบหน้า = ฟ้า (ช่องสีที่ 1) บนรางฟ้าอ่อนของสีเดียวกัน\n   สถานะการชำระ = สีสถานะ (ครบ/บางส่วน/ยังไม่ชำระ) + เทาสำหรับยกเว้น/ยังไม่มีรายการ คั่นด้วยช่องว่าง 2px\n   ตัวเลขอยู่ในตารางข้างแท่งเสมอ (สีไม่ใช่ช่องทางเดียวที่บอกความหมาย) */\n.viz { --viz-fill: #2a78d6; --viz-track: #cde2fb; --st-PAID: #0ca30c; --st-PARTIAL: #fab219; --st-UNPAID: #d03b3b; --st-OTHER: #898781; }\n.meter-list { display: grid; gap: 4px; }\n.meter-row { display: grid; grid-template-columns: minmax(70px, 140px) minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 6px 8px; border-radius: 6px; outline: none; }\n.meter-row:hover, .meter-row:focus-visible { background: var(--bg); }\n.meter-row:focus-visible { box-shadow: 0 0 0 2px var(--blue); }\n.meter-name { font-weight: 600; }\n.meter-track { height: 14px; background: var(--viz-track); border-radius: 4px; overflow: hidden; }\n.meter-fill { height: 100%; background: var(--viz-fill); border-radius: 0 4px 4px 0; }\n.meter-figure { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; min-width: 10.5em; }\n.meter-figure .muted { font-size: .88em; }\n.meter-overall { margin: 4px 0 2px; }\n.meter-overall .meter-track { height: 18px; }\n.segbar { display: flex; gap: 2px; height: 8px; min-width: 120px; }\n.segbar span { border-radius: 4px; min-width: 2px; }\n.seg-PAID { background: var(--st-PAID); }\n.seg-PARTIAL { background: var(--st-PARTIAL); }\n.seg-UNPAID { background: var(--st-UNPAID); }\n.seg-OTHER { background: var(--st-OTHER); }\n.viz-legend { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0 0 10px; color: var(--muted); font-size: .9em; }\n.viz-legend .sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }\n.viz-tip { position: fixed; z-index: 70; pointer-events: none; max-width: 280px; padding: 8px 10px; border-radius: 8px; background: var(--navy-900, #12253F); color: #fff; font-size: 13px; line-height: 1.45; box-shadow: var(--shadow); }\n.viz-tip .tip-value { font-weight: 700; font-size: 14px; }\n.viz-tip .tip-label { opacity: .85; }\n.viz-tip.hidden { display: none; }\n\n/* ---------- แจ้งเตือน (toast) ---------- */\n/* พื้นที่ว่างรอบข้อความไม่บังการคลิก และคลิกที่ข้อความเพื่อปิดได้ */\n.toast-root { position: fixed; right: 20px; bottom: 20px; z-index: 80; display: flex; flex-direction: column; gap: 8px; max-width: min(420px, calc(100vw - 32px)); pointer-events: none; }\n.toast { padding: 12px 16px; border-radius: 8px; background: var(--navy-900); color: #fff; box-shadow: var(--shadow); line-height: 1.45; animation: toast-in .18s ease-out; pointer-events: auto; cursor: pointer; }\n.toast-success { background: var(--success); }\n.toast-error { background: var(--danger); }\n@keyframes toast-in { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }\n\n/* ---------- มือถือและแท็บเล็ต ---------- */\n@media (max-width: 900px) {\n  .shell { grid-template-columns: minmax(0, 1fr); }\n  /* เมนูที่ซ่อนอยู่ต้องไม่มีเงาโผล่ที่ขอบจอ และกด Tab เข้าไปไม่ได้ */\n  .sidebar { position: fixed; top: 0; bottom: 0; left: 0; width: min(300px, 86vw); height: auto; transform: translateX(-100%); visibility: hidden; transition: transform .2s ease, visibility 0s linear .2s; }\n  .shell.nav-open .sidebar { transform: none; visibility: visible; box-shadow: 0 0 40px rgba(0, 0, 0, .3); transition: transform .2s ease; }\n  .shell.nav-open .backdrop { display: block; position: fixed; inset: 0; z-index: 25; background: rgba(18, 37, 64, .45); }\n  .topbar .menu-toggle { display: inline-flex; }\n  .topbar { padding: 0 12px; }\n  .content { padding: 16px; }\n}\n@media (max-width: 640px) {\n  body { font-size: 15px; }\n  .form-grid { grid-template-columns: minmax(0, 1fr); }\n  .year-chip .chip-label { display: none; }\n  .toolbar .field { min-width: 100%; }\n  .grid-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }\n  .stat { padding: 12px 14px; }\n  .stat-value { font-size: 1.2rem; }\n  .banner .big { font-size: 1.15rem; }\n  .filter-bar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }\n  .filter-bar .field { min-width: 0; }\n  .filter-bar .filter-wide { grid-column: 1 / -1; }\n  .data-table thead { display: none; }\n  .data-table, .data-table tbody, .data-table tr, .data-table td { display: block; width: 100%; }\n  .data-table tr { border: 1px solid var(--border); border-radius: var(--radius); margin: 0 0 10px; padding: 6px 12px; background: #fff; }\n  .data-table td { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 7px 0; border-bottom: 1px dashed #EDF1F6; text-align: right; }\n  .data-table td:last-child { border-bottom: 0; }\n  .data-table td::before { content: attr(data-label); color: var(--muted); font-weight: 600; text-align: left; flex-shrink: 0; max-width: 45%; }\n  .data-table .actions { justify-content: flex-end; flex-wrap: wrap; }\n  .data-table .actions::before { content: none; }\n  .table-wrap { overflow: visible; }\n  .card-body { padding: 14px; }\n  /* หน้าต่างเต็มจอ และยาวตามเนื้อหา (ถ้าใช้ stretch เนื้อหาที่ยาวเกินจอจะล้นพื้นหลังสีขาว) */\n  .modal-overlay { padding: 0; align-items: flex-start; }\n  .modal { border-radius: 0; min-height: 100vh; max-width: none; }\n  .modal-foot { border-radius: 0; position: sticky; bottom: 0; }\n  .toast-root { left: 16px; right: 16px; bottom: 16px; max-width: none; }\n  .doc { padding: 14px 12px; font-size: 14px; }\n  .doc-letter .letter-sign { margin-left: 20%; }\n  /* แท่งความคืบหน้า: ชื่อกับตัวเลขอยู่บรรทัดบน แท่งลงไปบรรทัดล่าง */\n  .meter-row { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: \"name fig\" \"bar bar\"; row-gap: 6px; }\n  .meter-name { grid-area: name; }\n  .meter-figure { grid-area: fig; min-width: 0; }\n  .meter-track { grid-area: bar; }\n}\n\n/* ---------- พิมพ์ ---------- */\n@media print {\n  @page { size: A4; margin: 12mm; }\n  .sidebar, .topbar, .toolbar, .btn, .toast-root, .busy-bar, .backdrop, .no-print { display: none !important; }\n  .has-print-head .page-head { display: none !important; }\n  .print-only { display: block; }\n  .data-table th, .data-table td { padding: 4px 6px; font-size: 10pt; }\n  .data-table tr { break-inside: avoid; }\n  .grid-cards { grid-template-columns: repeat(4, 1fr); gap: 6px; }\n  .stat { padding: 6px 8px; }\n  .stat-value { font-size: 12pt; }\n  .shell { display: block; }\n  body { background: #fff; }\n  .card { box-shadow: none; border-color: #999; }\n  .content { padding: 0; max-width: none; }\n  .doc { max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; box-shadow: none; font-size: 11.5pt; }\n  .doc + .doc { margin-top: 0; }\n  .doc.page-break { break-after: page; }\n  .doc-letter { font-size: 13pt; }\n  .doc-scroll { overflow: visible; }\n  .doc-table th, .doc-table tr.total td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n  .doc-table tr { break-inside: avoid; }\n  .report-screen-only { display: none !important; }\n}\n</style>\n",
});
