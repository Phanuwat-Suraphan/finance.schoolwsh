'use strict';
/** ทดสอบฟังก์ชันจัดรูปแบบที่ใช้ร่วมกัน (เงิน วันที่ จำนวนเงินเป็นตัวอักษร) */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createEnv, plain } = require('./harness');

const h = createEnv({ withSpreadsheet: false });
const g = h.gas;

test('isValidIsoDate_ ตรวจวันที่จริงและกันการกรอกปี พ.ศ.', () => {
  assert.equal(g.isValidIsoDate_('2026-11-21'), true);
  assert.equal(g.isValidIsoDate_('2024-02-29'), true, 'ปีอธิกสุรทิน');
  assert.equal(g.isValidIsoDate_('2026-02-29'), false);
  assert.equal(g.isValidIsoDate_('2100-02-29'), false, '2100 ไม่ใช่ปีอธิกสุรทิน');
  assert.equal(g.isValidIsoDate_('2026-04-31'), false);
  assert.equal(g.isValidIsoDate_('2026-13-01'), false);
  assert.equal(g.isValidIsoDate_('2569-11-21'), false, 'ปี พ.ศ. ต้องถูกปฏิเสธ');
  assert.equal(g.isValidIsoDate_('21/11/2569'), false);
  assert.equal(g.isValidIsoDate_(''), false);
  assert.equal(g.isValidIsoDate_(null), false);
  assert.equal(g.isValidIsoDate_(20261121), false);
});

test('isValidIsoDateTime_', () => {
  assert.equal(g.isValidIsoDateTime_('2026-11-21 08:30:00'), true);
  assert.equal(g.isValidIsoDateTime_('2026-11-21 23:59:59'), true);
  assert.equal(g.isValidIsoDateTime_('2026-11-21 24:00:00'), false);
  assert.equal(g.isValidIsoDateTime_('2026-11-21T08:30:00'), false);
  assert.equal(g.isValidIsoDateTime_('2026-11-21'), false);
});

test('formatThaiDate_ แสดงเป็น พ.ศ. ภาษาไทย', () => {
  assert.equal(g.formatThaiDate_('2026-11-21'), '21 พฤศจิกายน 2569');
  assert.equal(g.formatThaiDate_('2026-11-21', 'short'), '21 พ.ย. 2569');
  assert.equal(g.formatThaiDate_('2026-01-05', 'numeric'), '05/01/2569');
  assert.equal(g.formatThaiDate_('2027-03-01'), '1 มีนาคม 2570');
  assert.equal(g.formatThaiDate_(''), '');
  assert.equal(g.formatThaiDate_(null), '');
  assert.equal(g.formatThaiDate_('ไม่ใช่วันที่'), 'ไม่ใช่วันที่', 'ค่าที่ไม่ใช่วันที่แสดงตามเดิม');
});

test('formatThaiDateTime_', () => {
  assert.equal(g.formatThaiDateTime_('2026-11-21 08:05:09'), '21 พฤศจิกายน 2569 เวลา 08:05 น.');
  assert.equal(g.formatThaiDateTime_('2026-11-21 08:05:09', 'short'), '21 พ.ย. 2569 เวลา 08:05 น.');
  assert.equal(g.formatThaiDateTime_('2026-11-21'), '21 พฤศจิกายน 2569');
});

test('parseMoneyToSatang_ รับตัวเลขและข้อความ และไม่ยอมรับทศนิยมเกิน 2 ตำแหน่ง', () => {
  const ok = (v, expected) => assert.deepEqual(plain(g.parseMoneyToSatang_(v)), { ok: true, satang: expected }, String(v));
  const bad = (v, error) => assert.deepEqual(plain(g.parseMoneyToSatang_(v)), { ok: false, error }, String(v));
  ok('1,000.50', 100050);
  ok('1000', 100000);
  ok('1000 บาท', 100000);
  ok('1,000.50 บาท', 100050);
  ok('0.1', 10);
  ok('1000.500', 100050);
  ok('007', 700);
  ok(1000.5, 100050);
  ok(0.1 + 0.2, 30);
  ok(19.99, 1999);
  ok(1234567.89, 123456789);
  ok(0, 0);
  ok('-25.5', -2550);
  bad('1.005', 'DECIMALS');
  bad(1.005, 'DECIMALS');
  bad(100.123, 'DECIMALS');
  bad('abc', 'FORMAT');
  bad('1.2.3', 'FORMAT');
  bad('.5', 'FORMAT');
  bad(Infinity, 'FORMAT');
  bad(NaN, 'FORMAT');
  bad({}, 'FORMAT');
  bad('', 'EMPTY');
  bad('  ', 'EMPTY');
  bad(null, 'EMPTY');
  bad('99999999999', 'RANGE');
});

test('formatSatang_ แสดงเงินรูปแบบ 1,000.00 บาท', () => {
  assert.equal(g.formatSatang_(100000), '1,000.00');
  assert.equal(g.formatSatang_(100000, true), '1,000.00 บาท');
  assert.equal(g.formatSatang_(5), '0.05');
  assert.equal(g.formatSatang_(0), '0.00');
  assert.equal(g.formatSatang_(123456789), '1,234,567.89');
  assert.equal(g.formatSatang_(-150), '-1.50');
  assert.equal(g.formatSatang_(null), '');
  assert.equal(g.formatSatang_(''), '');
});

test('bahtText_ อ่านจำนวนเงินเป็นภาษาไทยถูกต้องตามหลัก เอ็ด/ยี่', () => {
  const cases = [
    [0, 'ศูนย์บาทถ้วน'],
    [100, 'หนึ่งบาทถ้วน'],
    [1000, 'สิบบาทถ้วน'],
    [1100, 'สิบเอ็ดบาทถ้วน'],
    [2100, 'ยี่สิบเอ็ดบาทถ้วน'],
    [2000, 'ยี่สิบบาทถ้วน'],
    [10100, 'หนึ่งร้อยเอ็ดบาทถ้วน'],
    [52000, 'ห้าร้อยยี่สิบบาทถ้วน'],
    [100000, 'หนึ่งพันบาทถ้วน'],
    [150050, 'หนึ่งพันห้าร้อยบาทห้าสิบสตางค์'],
    [202100, 'สองพันยี่สิบเอ็ดบาทถ้วน'],
    [1001, 'สิบบาทหนึ่งสตางค์'],
    [25, 'ยี่สิบห้าสตางค์'],
    [1, 'หนึ่งสตางค์'],
    [11, 'สิบเอ็ดสตางค์'],
    [100000000, 'หนึ่งล้านบาทถ้วน'],
    [100000100, 'หนึ่งล้านเอ็ดบาทถ้วน'],
    [1100000000, 'สิบเอ็ดล้านบาทถ้วน'],
    [100000000000, 'หนึ่งพันล้านบาทถ้วน'],
    [-100, 'ลบหนึ่งบาทถ้วน'],
  ];
  cases.forEach(([satang, text]) => assert.equal(g.bahtText_(satang), text, String(satang)));
  assert.equal(g.bahtText_(1.5), '', 'ไม่ใช่จำนวนเต็มของสตางค์');
  assert.equal(g.bahtText_(null), '');
});

test('academicYearOfDate_ (พ.ค.–ธ.ค. = ปีเดียวกัน, ม.ค.–เม.ย. = ปีก่อน)', () => {
  assert.equal(g.academicYearOfDate_('2026-11-21'), 2569);
  assert.equal(g.academicYearOfDate_('2026-05-01'), 2569);
  assert.equal(g.academicYearOfDate_('2026-04-30'), 2568);
  assert.equal(g.academicYearOfDate_('2027-03-31'), 2569);
  assert.equal(g.academicYearOfDate_(''), null);
});

test('sharedClientSource_ ใช้ในหน้าเว็บได้โดยไม่พึ่งบริการของ Apps Script', () => {
  const source = g.sharedClientSource_();
  const clean = vm.createContext({}); // ไม่มี SpreadsheetApp, Utilities หรือค่าคงที่ใด ๆ
  vm.runInContext(source, clean);
  assert.equal(vm.runInContext('formatSatang_(150050, true)', clean), '1,500.50 บาท');
  assert.equal(vm.runInContext('bahtText_(150050)', clean), 'หนึ่งพันห้าร้อยบาทห้าสิบสตางค์');
  assert.equal(vm.runInContext('formatThaiDateTime_("2026-11-21 08:05:00")', clean), '21 พฤศจิกายน 2569 เวลา 08:05 น.');
  assert.equal(vm.runInContext('parseMoneyToSatang_("1,000").satang', clean), 100000);
  assert.equal(vm.runInContext('academicYearOfDate_("2026-11-21")', clean), 2569);
});
