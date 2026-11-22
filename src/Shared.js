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
  };
  return SHARED_CLIENT_FUNCTIONS_.map(function (name) { return String(fns[name]); }).join('\n\n');
}
