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
