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
