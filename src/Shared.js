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
