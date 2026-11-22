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
