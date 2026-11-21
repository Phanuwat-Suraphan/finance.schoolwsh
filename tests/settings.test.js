'use strict';
/** ทดสอบค่าตั้งค่าโรงเรียนและปีการศึกษา */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppEnv } = require('./harness');

function setup() {
  const h = createAppEnv();
  const admin = h.adminToken();
  const fin = h.addUser(admin, 'FINANCE', 'finance1');
  return { h, admin, fin: fin.token };
}

function findItem(data, key) {
  for (const g of data.groups) for (const it of g.items) if (it.key === key) return it;
  return null;
}

test('ดูค่าตั้งค่า: ทุกบทบาทดูได้ แก้ไขได้เฉพาะผู้ดูแลระบบ และค่าถูกแปลงตามชนิด', () => {
  const { h, admin, fin } = setup();
  const a = h.ok('settings.get', {}, admin);
  const f = h.ok('settings.get', {}, fin);
  assert.equal(a.editable, true);
  assert.equal(f.editable, false);
  assert.deepEqual(a.groups.map((g) => g.key), ['school', 'signers', 'academic', 'approval', 'receipt', 'security', 'backup']);
  assert.equal(findItem(a, 'SCHOOL_NAME').value, 'โรงเรียนวัดเสาหิน');
  assert.equal(findItem(a, 'RECEIPT_STRICT_SEQUENCE').value, true);
  assert.equal(findItem(a, 'SESSION_IDLE_MINUTES').value, 30);
  assert.deepEqual(findItem(a, 'PAYMENT_CHANNELS').value, ['เงินสด', 'โอนเงินเข้าบัญชีโรงเรียน']);
  assert.equal(findItem(a, 'CURRENT_ACADEMIC_YEAR').readOnly, true);
  assert.equal(h.api('settings.update', { values: { SCHOOL_ADDRESS: 'x' } }, fin).error.code, 'FORBIDDEN');
});

test('บันทึกค่าตั้งค่า: ตรวจชนิดและช่วงค่า บันทึกเฉพาะค่าที่เปลี่ยน และเก็บค่าเดิม/ค่าใหม่', () => {
  const { h, admin } = setup();
  const bad = (values, re) => {
    const res = h.api('settings.update', { values }, admin);
    assert.equal(res.ok, false, JSON.stringify(values));
    assert.match(res.error.message, re, JSON.stringify(values));
  };
  bad({ SESSION_IDLE_MINUTES: '2' }, /ต้องไม่น้อยกว่า 5/);
  bad({ SESSION_IDLE_MINUTES: 'สามสิบ' }, /ต้องเป็นจำนวนเต็ม/);
  bad({ LOGIN_LOCK_MINUTES: 1000 }, /ต้องไม่มากกว่า 360/);
  bad({ APPROVAL_FEE_ADJUSTMENT: 'yes' }, /ไม่ถูกต้อง/);
  bad({ GRADE_LEVELS: 'ป.1, ป.2, ป.1' }, /ซ้ำกัน/);
  bad({ GRADE_LEVELS: ' , ' }, /อย่างน้อย 1 รายการ/);
  bad({ CURRENT_ACADEMIC_YEAR: 2570 }, /แก้ไขที่หน้านี้ไม่ได้/);
  bad({ UNKNOWN_KEY: 'x' }, /ไม่รู้จักค่าตั้งค่า/);
  bad({}, /ไม่มีค่าที่ต้องการบันทึก/);

  const res = h.ok('settings.update', { values: {
    SCHOOL_ADDRESS: '  ต.ตัวอย่าง  อ.ตัวอย่าง  ',
    SCHOOL_NAME: 'โรงเรียนวัดเสาหิน',
    APPROVAL_BOOK_CLOSE: false,
    GRADE_LEVELS: ['อ.2', 'อ.3', 'ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6'],
    SESSION_IDLE_MINUTES: '45',
  } }, admin);
  assert.deepEqual(res.changed.sort(), ['APPROVAL_BOOK_CLOSE', 'GRADE_LEVELS', 'SCHOOL_ADDRESS', 'SESSION_IDLE_MINUTES']);
  assert.equal(findItem(res.settings, 'SCHOOL_ADDRESS').value, 'ต.ตัวอย่าง อ.ตัวอย่าง');
  assert.equal(findItem(res.settings, 'APPROVAL_BOOK_CLOSE').value, false);
  assert.deepEqual(findItem(res.settings, 'GRADE_LEVELS').value.slice(0, 2), ['อ.2', 'อ.3']);
  const log = h.auditRows().filter((r) => r.Entity === 'SchoolSettings' && r.EntityId === 'SESSION_IDLE_MINUTES' && r.Action === 'UPDATE').pop();
  assert.deepEqual(JSON.parse(log.BeforeJson), { Value: '30' });
  assert.deepEqual(JSON.parse(log.AfterJson), { Value: '45' });
  assert.equal(log.Username, 'admin');
});

test('ค่าตั้งค่าในชีตที่ถูกแก้ด้วยมือจนผิด: ระบบใช้ค่าเริ่มต้นหรือค่าในช่วงที่ปลอดภัยแทน', () => {
  const { h, admin } = setup();
  const sheet = h.sheet('SchoolSettings');
  const header = sheet._rowValues(1);
  for (let r = 2; r <= sheet.getLastRow(); r++) {
    const key = sheet.getRange(r, 1).getValue();
    if (key === 'SESSION_IDLE_MINUTES') sheet._rawSet(r, header.indexOf('Value') + 1, '99999');
    if (key === 'LOGIN_MAX_ATTEMPTS') sheet._rawSet(r, header.indexOf('Value') + 1, 'ห้า');
  }
  const data = h.ok('settings.get', {}, admin);
  assert.equal(findItem(data, 'SESSION_IDLE_MINUTES').value, 240, 'ปัดลงเป็นค่าสูงสุดที่อนุญาต');
  assert.equal(findItem(data, 'LOGIN_MAX_ATTEMPTS').value, 5, 'ใช้ค่าเริ่มต้น');
});

test('ปีการศึกษา: มีปีเริ่มต้น เพิ่มปีใหม่ได้ ห้ามปีซ้ำ และตรวจวันที่', () => {
  const { h, admin, fin } = setup();
  const list = h.ok('years.list', {}, fin);
  assert.equal(list.length, 1);
  assert.equal(list[0].year, 2569);
  assert.equal(list[0].isCurrent, true);

  const y2570 = h.ok('years.create', { year: '2570', startDate: '2027-05-16', endDate: '2028-03-31' }, admin);
  assert.equal(y2570.label, 'ปีการศึกษา 2570');
  assert.equal(y2570.isCurrent, false, 'มีปีปัจจุบันอยู่แล้ว');
  assert.equal(h.api('years.create', { year: 2570 }, admin).error.code, 'CONFLICT');
  assert.match(h.api('years.create', { year: 2571, startDate: '2028-05-16', endDate: '2028-01-01' }, admin).error.message, /วันสิ้นสุด/);
  assert.match(h.api('years.create', { year: 2571, startDate: '2571-05-16' }, admin).error.message, /วันเริ่มปีการศึกษาไม่ถูกต้อง/, 'กันการกรอกปี พ.ศ. ในช่องวันที่');
  assert.match(h.api('years.create', { year: 2026 }, admin).error.message, /ต้องไม่น้อยกว่า 2500/, 'กันการกรอกปี ค.ศ. เป็นปีการศึกษา');
  assert.deepEqual(h.ok('years.list', {}, fin).map((y) => y.year), [2570, 2569]);
});

test('ตั้งปีการศึกษาปัจจุบัน: มีปีปัจจุบันปีเดียว และค่า CURRENT_ACADEMIC_YEAR ตรงกันเสมอ', () => {
  const { h, admin, fin } = setup();
  const y2570 = h.ok('years.create', { year: 2570 }, admin);
  const after = h.ok('years.setCurrent', { academicYearId: y2570.academicYearId }, admin);
  assert.deepEqual(after.filter((y) => y.isCurrent).map((y) => y.year), [2570]);
  assert.equal(h.ok('auth.me', {}, fin).school.currentAcademicYear, 2570);

  const y2569 = after.find((y) => y.year === 2569);
  h.ok('years.update', { academicYearId: y2569.academicYearId, label: 'ปีการศึกษา 2569', status: 'CLOSED' }, admin);
  const closedCurrent = h.api('years.setCurrent', { academicYearId: y2569.academicYearId }, admin);
  assert.match(closedCurrent.error.message, /ปิดแล้วตั้งเป็นปีปัจจุบันไม่ได้/);
  const closeCurrent = h.api('years.update', { academicYearId: y2570.academicYearId, label: 'ปีการศึกษา 2570', status: 'CLOSED' }, admin);
  assert.match(closeCurrent.error.message, /ปิดปีการศึกษาปัจจุบันไม่ได้/);
  assert.equal(h.api('years.setCurrent', { academicYearId: 'AY-x' }, admin).error.code, 'VALIDATION');
});
