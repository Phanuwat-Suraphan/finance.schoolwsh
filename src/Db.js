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
