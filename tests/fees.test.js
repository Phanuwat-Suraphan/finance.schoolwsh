'use strict';
/** ทดสอบอัตราเงินบำรุงและการสร้างรายการเรียกเก็บ (ระยะที่ 4) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupFinance, APPROVAL_REF } = require('./finance-helpers');

test('ตั้งอัตราให้หลายชั้นพร้อมกัน และกันอัตราซ้ำหรืออัตรารายปีซ้อนกับรายภาค', () => {
  const t = setupFinance();
  const { h } = t;
  const created = t.fee({ gradeLevels: ['ป.2', 'ป.1'], amount: '1,500.50' });
  assert.deepEqual(created.map((f) => f.gradeLevel), ['ป.1', 'ป.2'], 'เรียงตามลำดับชั้น');
  assert.equal(created[0].amountSatang, 150050);
  assert.equal(created[0].label, 'เงินบำรุงการศึกษา ภาคเรียนที่ 1/2569 ชั้น ป.1');

  const dup = h.api('fees.create', { year: 2569, term: '1', gradeLevels: ['ป.1', 'ป.3'], amount: '500', dueDate: '2026-06-30' }, t.fin);
  assert.equal(dup.error.code, 'CONFLICT');
  assert.match(dup.error.message, /ชั้น ป\.1 มีอัตราภาคเรียนที่ 1 ปีการศึกษา 2569 แล้ว/);
  const mixed = h.api('fees.create', { year: 2569, term: 'Y', gradeLevels: ['ป.2'], amount: '900', dueDate: '2026-06-30' }, t.fin);
  assert.match(mixed.error.message, /มีอัตรารายภาคเรียนแล้ว ตั้งอัตรารายภาคเรียนและทั้งปีการศึกษาซ้อนกันไม่ได้/);
  t.fee({ term: 'Y', gradeLevels: ['ป.3'], amount: '900' });
  const mixed2 = h.api('fees.create', { year: 2569, term: '2', gradeLevels: ['ป.3'], amount: '500', dueDate: '2026-12-31' }, t.fin);
  assert.match(mixed2.error.message, /ป\.3 มีอัตราทั้งปีการศึกษาแล้ว/);
  t.fee({ term: '2', gradeLevels: ['ป.1'], dueDate: '2026-12-31' });

  const bad = (fields) => h.api('fees.create', Object.assign({ year: 2569, term: '1', gradeLevels: ['ป.4'], amount: '500', dueDate: '2026-06-30' }, fields), t.fin).error.message;
  assert.match(bad({ gradeLevels: ['ม.1'] }), /ไม่อยู่ในรายการระดับชั้นที่เปิดสอน/);
  assert.match(bad({ gradeLevels: [] }), /เลือกระดับชั้นอย่างน้อย 1 ชั้น/);
  assert.match(bad({ amount: '0' }), /จำนวนเงินต้องมากกว่า 0/);
  assert.match(bad({ amount: '10.555' }), /ทศนิยมได้ไม่เกิน 2 ตำแหน่ง/);
  assert.match(bad({ amount: '100001' }), /ต้องไม่เกิน 100,000\.00 บาท/);
  assert.match(bad({ startDate: '2026-07-01', dueDate: '2026-06-30' }), /ต้องไม่ก่อนวันเริ่มเรียกเก็บ/);
  assert.match(bad({ dueDate: '' }), /กรุณาระบุวันครบกำหนดชำระ/);

  const list = h.ok('fees.list', { year: 2569 }, t.dir);
  assert.deepEqual(list.settings.map((f) => f.term + ':' + f.gradeLevel), ['Y:ป.3', '1:ป.1', '1:ป.2', '2:ป.1']);
  assert.equal(list.yearOpen, true);
});

test('สร้างรายการเรียกเก็บได้เมื่อมีเอกสารอนุมัติอัตรา และอัตรายังใช้งานอยู่ (D-06)', () => {
  const t = setupFinance();
  const { h } = t;
  t.student('10001', 'หนึ่ง', 'ป.1');
  const fee = t.feeOne({ approvalRef: '' });
  const noRef = h.api('assessments.preview', { feeSettingId: fee.feeSettingId }, t.fin);
  assert.equal(noRef.error.reason, 'APPROVAL_REF_REQUIRED');
  assert.equal(h.api('assessments.generate', { feeSettingId: fee.feeSettingId }, t.fin).error.reason, 'APPROVAL_REF_REQUIRED');

  const update = (fields) => h.api('fees.update', Object.assign({
    feeSettingId: fee.feeSettingId, amount: '500', startDate: '2026-05-16', dueDate: '2026-06-30', status: 'ACTIVE', approvalRef: APPROVAL_REF,
  }, fields), t.fin);
  assert.equal(update({}).ok, true);
  assert.equal(h.ok('assessments.preview', { feeSettingId: fee.feeSettingId }, t.fin).create.length, 1);
  assert.equal(update({ status: 'INACTIVE' }).ok, true);
  assert.match(h.api('assessments.preview', { feeSettingId: fee.feeSettingId }, t.fin).error.message, /ปิดการใช้งานแล้ว/);
});

test('สร้างรายการเรียกเก็บ: ดูตัวอย่างก่อน เรียกเก็บผู้จบการศึกษาในปีนั้น ข้ามผู้ย้ายออก และกดซ้ำไม่เกิดรายการซ้ำ', () => {
  const t = setupFinance();
  const { h } = t;
  const a = t.student('10001', 'หนึ่ง', 'ป.1', { classNo: 1 });
  t.student('10002', 'สอง', 'ป.1', { classNo: 2 });
  const c = t.student('10003', 'สาม', 'ป.1', { room: '2' });
  t.student('10004', 'สี่', 'ป.2');
  const g = t.student('10006', 'หก', 'ป.6');
  h.ok('students.setStatus', { studentId: c.studentId, status: 'TRANSFERRED', statusDate: '2026-08-15', note: 'ย้ายตามผู้ปกครอง', year: 2569 }, t.fin);

  const fee = t.feeOne();
  const preview = h.ok('assessments.preview', { feeSettingId: fee.feeSettingId }, t.fin);
  assert.deepEqual(preview.create.map((x) => x.studentNo), ['10001', '10002']);
  assert.deepEqual(preview.skipped.map((x) => x.studentNo), ['10003']);
  assert.match(preview.skipped[0].reason, /ย้ายออกแล้ว/);
  assert.equal(preview.totalSatang, 100000);
  assert.equal(t.rows('FeeAssessments').length, 0, 'ดูตัวอย่างต้องไม่บันทึก');

  assert.deepEqual(t.generate(fee.feeSettingId), { created: 2, already: 0, skipped: 1, totalSatang: 100000 });
  const rows = t.rows('FeeAssessments');
  const first = rows.find((r) => r.StudentId === a.studentId);
  assert.equal(first.GradeLevel, 'ป.1');
  assert.equal(first.Room, '1');
  assert.equal(first.GrossAmount, 500);
  assert.equal(first.DueDate, '2026-06-30');
  assert.ok(t.h.auditRows().some((r) => r.Entity === 'FeeAssessments' && r.Action === 'CREATE' && /สร้างรายการเรียกเก็บ เงินบำรุงการศึกษา/.test(r.Note)));

  assert.deepEqual(t.generate(fee.feeSettingId), { created: 0, already: 2, skipped: 1, totalSatang: 0 }, 'กดซ้ำไม่เกิดรายการซ้ำ');
  t.student('10005', 'ห้า', 'ป.1', { classNo: 3 });
  assert.equal(t.generate(fee.feeSettingId).created, 1, 'นักเรียนย้ายเข้าทีหลัง สร้างเพิ่มได้');
  assert.equal(t.rows('FeeAssessments').length, 3);

  // จบการศึกษาหลังเลื่อนชั้น: ยังเรียกเก็บของปีที่เรียนครบแล้วได้
  h.ok('years.create', { year: 2570 }, t.admin);
  h.ok('students.promoteCommit', { fromYear: 2569, toYear: 2570, graduationDate: '2027-03-31' }, t.fin);
  const feeP6 = t.feeOne({ gradeLevels: ['ป.6'] });
  const p6 = h.ok('assessments.preview', { feeSettingId: feeP6.feeSettingId }, t.fin);
  assert.deepEqual(p6.create.map((x) => x.studentId), [g.studentId]);
});

test('อัตราที่สร้างรายการเรียกเก็บแล้ว: แก้จำนวนเงินและวันครบกำหนดไม่ได้ แต่แก้เอกสารอนุมัติได้', () => {
  const t = setupFinance();
  const { h } = t;
  t.student('10001', 'หนึ่ง', 'ป.1');
  const fee = t.feeOne();
  const update = (fields) => h.api('fees.update', Object.assign({
    feeSettingId: fee.feeSettingId, amount: '500', startDate: '2026-05-16', dueDate: '2026-06-30', status: 'ACTIVE', approvalRef: APPROVAL_REF,
  }, fields), t.fin);
  assert.equal(update({ amount: '450' }).ok, true, 'ก่อนเรียกเก็บแก้ได้');
  assert.equal(update({ amount: '500' }).ok, true);
  t.generate(fee.feeSettingId);
  assert.match(update({ amount: '600' }).error.message, /แก้จำนวนเงินไม่ได้ ถ้าบางคนต้องจ่ายต่างจากอัตรา ให้ใช้การลดหย่อน/);
  assert.match(update({ dueDate: '2026-07-31' }).error.message, /แก้วันครบกำหนดชำระไม่ได้/);
  const ok = update({ approvalRef: 'มติครั้งที่ 2/2569' });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.locked, true);
  const log = t.h.auditRows().filter((r) => r.Entity === 'FeeSettings' && r.Action === 'UPDATE').pop();
  assert.match(log.BeforeJson, /มติคณะกรรมการสถานศึกษา/);
  assert.match(log.AfterJson, /มติครั้งที่ 2\/2569/);
});

test('เพิ่มรายการเรียกเก็บรายบุคคล: ต้องเรียนชั้นนั้นในปีนั้น และไม่ซ้ำ', () => {
  const t = setupFinance();
  const { h } = t;
  const moved = t.student('10003', 'สาม', 'ป.1');
  const other = t.student('10004', 'สี่', 'ป.2');
  h.ok('students.setStatus', { studentId: moved.studentId, status: 'TRANSFERRED', statusDate: '2026-08-15', note: 'ย้ายออกเดือนสิงหาคม', year: 2569 }, t.fin);
  const fee = t.feeOne();
  t.generate(fee.feeSettingId);
  assert.equal(t.ledger(moved.studentId).assessments.length, 0);
  assert.deepEqual(t.ledger(moved.studentId).availableFees.map((f) => f.feeSettingId), [fee.feeSettingId]);

  const one = h.ok('assessments.createOne', { studentId: moved.studentId, feeSettingId: fee.feeSettingId }, t.fin);
  assert.equal(one.state, 'UNPAID');
  assert.equal(one.outstandingSatang, 50000);
  assert.equal(t.ledger(moved.studentId).availableFees.length, 0);
  assert.match(h.api('assessments.createOne', { studentId: moved.studentId, feeSettingId: fee.feeSettingId }, t.fin).error.message, /มีรายการเรียกเก็บของอัตรานี้แล้ว/);
  assert.match(h.api('assessments.createOne', { studentId: other.studentId, feeSettingId: fee.feeSettingId }, t.fin).error.message, /ไม่ได้เรียนชั้น ป\.1 ในปีการศึกษา 2569/);
  assert.deepEqual(t.ledger(other.studentId).availableFees, [], 'ผู้อำนวยการและเจ้าหน้าที่เห็นเฉพาะอัตราที่ตรงชั้น');
  assert.deepEqual(h.ok('ledger.student', { studentId: moved.studentId }, t.dir).availableFees, [], 'ผู้อำนวยการไม่มีปุ่มเพิ่มรายการ');
});

test('ปีการศึกษาที่ปิดแล้ว: ตั้งอัตราใหม่และสร้างรายการเรียกเก็บไม่ได้', () => {
  const t = setupFinance();
  const { h } = t;
  t.student('10001', 'หนึ่ง', 'ป.1');
  const fee = t.feeOne();
  h.ok('years.create', { year: 2570 }, t.admin);
  h.ok('years.setCurrent', { academicYearId: t.yearId(2570) }, t.admin);
  h.ok('years.update', { academicYearId: t.yearId(2569), label: 'ปีการศึกษา 2569', status: 'CLOSED' }, t.admin);
  assert.match(h.api('fees.create', { year: 2569, term: '2', gradeLevels: ['ป.1'], amount: '500', dueDate: '2026-12-31' }, t.fin).error.message, /ปิดแล้ว/);
  assert.match(h.api('assessments.generate', { feeSettingId: fee.feeSettingId }, t.fin).error.message, /ปีการศึกษา 2569 ปิดแล้ว สร้างรายการเรียกเก็บใหม่ไม่ได้/);
  assert.equal(h.ok('fees.list', { year: 2569 }, t.fin).yearOpen, false);
});
