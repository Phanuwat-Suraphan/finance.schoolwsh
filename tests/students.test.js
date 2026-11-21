'use strict';
/** ทดสอบข้อมูลนักเรียน: เพิ่ม แก้ไข ค้นหา เปลี่ยนสถานะ และประวัติรายปี */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppEnv } = require('./harness');

function setup() {
  const h = createAppEnv();
  const admin = h.adminToken();
  const fin = h.addUser(admin, 'FINANCE', 'finance1').token;
  const dir = h.addUser(admin, 'DIRECTOR', 'director1').token;
  return { h, admin, fin, dir };
}

function addStudent(h, token, extra) {
  return h.ok('students.create', Object.assign({
    studentNo: '10001', prefix: 'เด็กชาย', firstName: 'สมชาย', lastName: 'ใจดี', gradeLevel: 'ป.1', room: '1', classNo: 1, year: 2569,
  }, extra || {}), token);
}

test('เพิ่มนักเรียน: ได้ทั้งข้อมูลนักเรียนและชั้นเรียนของปีการศึกษา', () => {
  const { h, fin } = setup();
  const s = addStudent(h, fin, { gradeLevel: 'ประถมศึกษาปีที่ 1', room: 'ห้อง 01' });
  assert.match(s.studentId, /^STU-/);
  assert.equal(s.fullName, 'เด็กชายสมชาย ใจดี');
  assert.equal(s.gradeLevel, 'ป.1', 'แปลงชื่อระดับชั้นให้ตรงกับรายการที่ตั้งไว้');
  assert.equal(s.room, '1');
  assert.equal(s.classLabel, 'ป.1/1');
  assert.equal(s.status, 'STUDYING');
  assert.equal(s.year, 2569);
  h.newExecution();
  assert.equal(h.gas.dbAll_('Enrollments').length, 1);
  const actions = h.auditRows().filter((r) => r.Username === 'finance1' && r.Action === 'CREATE').map((r) => r.Entity);
  assert.deepEqual([...actions], ['Students', 'Enrollments']);
});

test('ตรวจข้อมูลนักเรียน: ข้อความผิดพลาดภาษาไทยที่ชัดเจน', () => {
  const { h, fin } = setup();
  const bad = (extra, re) => {
    const res = h.api('students.create', Object.assign({ studentNo: '1', firstName: 'ก', gradeLevel: 'ป.1', year: 2569 }, extra), fin);
    assert.equal(res.ok, false, JSON.stringify(extra));
    assert.match(res.error.message, re, JSON.stringify(extra));
  };
  bad({ studentNo: '' }, /กรุณากรอกเลขประจำตัวนักเรียน/);
  bad({ studentNo: 'ก123' }, /ใช้ได้เฉพาะตัวเลข/);
  bad({ firstName: '' }, /กรุณากรอกชื่อ/);
  bad({ gradeLevel: 'ม.1' }, /ระดับชั้น "ม.1" ไม่อยู่ในรายการระดับชั้นที่เปิดสอน/);
  bad({ classNo: '0' }, /เลขที่ต้องไม่น้อยกว่า 1/);
  bad({ year: 2575 }, /ไม่พบปีการศึกษา 2575/);
  assert.equal(addStudent(h, fin, { lastName: '' }).fullName, 'เด็กชายสมชาย', 'นามสกุลเว้นว่างได้');
});

test('เลขประจำตัวห้ามซ้ำ และชื่อซ้ำต้องยืนยันก่อน (ห้ามบันทึกซ้ำโดยไม่แจ้งเตือน)', () => {
  const { h, fin } = setup();
  addStudent(h, fin);
  const dupNo = h.api('students.create', { studentNo: '10001', firstName: 'คนอื่น', gradeLevel: 'ป.2', year: 2569 }, fin);
  assert.equal(dupNo.error.code, 'CONFLICT');
  assert.match(dupNo.error.message, /เลขประจำตัว 10001 เป็นของ เด็กชายสมชาย ใจดี อยู่แล้ว/);
  const dupName = h.api('students.create', { studentNo: '10002', firstName: 'สมชาย', lastName: ' ใจดี', gradeLevel: 'ป.3', year: 2569 }, fin);
  assert.equal(dupName.error.reason, 'NAME_DUPLICATE');
  assert.match(dupName.error.message, /มีนักเรียนชื่อ เด็กชายสมชาย ใจดี อยู่แล้ว \(เลขประจำตัว 10001\)/);
  const ok = h.ok('students.create', { studentNo: '10002', firstName: 'สมชาย', lastName: 'ใจดี', gradeLevel: 'ป.3', year: 2569, confirmDuplicateName: true }, fin);
  assert.equal(ok.studentNo, '10002');
});

test('เลขที่ห้ามซ้ำในห้องเดียวกันของปีเดียวกัน แต่ซ้ำได้ต่างห้องหรือเมื่อคนเดิมย้ายออก', () => {
  const { h, fin } = setup();
  const first = addStudent(h, fin);
  const clash = h.api('students.create', { studentNo: '10002', firstName: 'มานี', lastName: 'มีนา', gradeLevel: 'ป.1', room: '1', classNo: 1, year: 2569 }, fin);
  assert.match(clash.error.message, /เลขที่ 1 ของชั้น ป.1\/1 ปีการศึกษา 2569 เป็นของ เด็กชายสมชาย ใจดี แล้ว/);
  h.ok('students.create', { studentNo: '10002', firstName: 'มานี', lastName: 'มีนา', gradeLevel: 'ป.1', room: '2', classNo: 1, year: 2569 }, fin);
  h.ok('students.setStatus', { studentId: first.studentId, year: 2569, status: 'TRANSFERRED', statusDate: '2026-11-20', note: 'ย้ายไปโรงเรียนในเมือง' }, fin);
  h.ok('students.create', { studentNo: '10003', firstName: 'ปิติ', lastName: 'ยินดี', gradeLevel: 'ป.1', room: '1', classNo: 1, year: 2569 }, fin);
  const back = h.api('students.setStatus', { studentId: first.studentId, year: 2569, status: 'STUDYING', statusDate: '2026-11-21' }, fin);
  assert.match(back.error.message, /เลขที่ 1 ของชั้น ป.1\/1/, 'กลับมาเรียนแต่เลขที่เดิมมีคนใช้แล้ว ต้องแก้เลขที่ก่อน');
});

test('รายชื่อนักเรียน: เรียงตามลำดับชั้นในตั้งค่า ห้อง และเลขที่ พร้อมรายการห้องของแต่ละชั้น', () => {
  const { h, fin, dir } = setup();
  addStudent(h, fin, { studentNo: '1', firstName: 'ก', gradeLevel: 'ป.2', room: '1', classNo: 2 });
  addStudent(h, fin, { studentNo: '2', firstName: 'ข', gradeLevel: 'อ.3', room: '1', classNo: 1 });
  addStudent(h, fin, { studentNo: '3', firstName: 'ค', gradeLevel: 'ป.2', room: '10', classNo: 1 });
  addStudent(h, fin, { studentNo: '4', firstName: 'ง', gradeLevel: 'ป.2', room: '2', classNo: 1 });
  addStudent(h, fin, { studentNo: '5', firstName: 'จ', gradeLevel: 'ป.2', room: '1', classNo: 1 });
  const list = h.ok('students.list', { year: 2569 }, dir);
  assert.deepEqual(list.rows.map((r) => r.classLabel + '#' + r.classNo), ['อ.3/1#1', 'ป.2/1#1', 'ป.2/1#2', 'ป.2/2#1', 'ป.2/10#1']);
  assert.deepEqual(list.rooms['ป.2'], ['1', '2', '10']);
  assert.equal(list.gradeLevels[0], 'อ.1');
  assert.equal(h.api('students.create', { studentNo: '9', firstName: 'x', gradeLevel: 'ป.1', year: 2569 }, dir).error.code, 'FORBIDDEN', 'ผู้อำนวยการดูได้อย่างเดียว');
  assert.equal(h.ok('students.list', {}, fin).year, 2569, 'ไม่ระบุปี = ปีการศึกษาปัจจุบัน');
});

test('แก้ไขข้อมูล: เปลี่ยนชั้นของปีที่เลือก โดยประวัติปีอื่นไม่เปลี่ยน และบันทึกค่าเดิม/ค่าใหม่', () => {
  const { h, admin, fin } = setup();
  const s = addStudent(h, fin);
  h.ok('years.create', { year: 2570 }, admin);
  const moved = h.ok('students.update', { studentId: s.studentId, year: 2570, studentNo: '10001', prefix: 'เด็กชาย', firstName: 'สมชาย',
    lastName: 'ใจดีมาก', gradeLevel: 'ป.2', room: '1', classNo: 3 }, fin);
  assert.equal(moved.year, 2570);
  assert.equal(moved.lastName, 'ใจดีมาก');
  const detail = h.ok('students.get', { studentId: s.studentId }, fin);
  assert.deepEqual(detail.enrollments.map((e) => e.year + ':' + e.classLabel + '#' + e.classNo), ['2570:ป.2/1#3', '2569:ป.1/1#1']);
  const log = h.auditRows().filter((r) => r.Entity === 'Students' && r.Action === 'UPDATE').pop();
  assert.deepEqual(JSON.parse(log.BeforeJson), { LastName: 'ใจดี' });
  assert.deepEqual(JSON.parse(log.AfterJson), { LastName: 'ใจดีมาก' });
  const other = addStudent(h, fin, { studentNo: '20000', firstName: 'มานะ', classNo: 2 });
  const steal = h.api('students.update', Object.assign({}, { studentId: other.studentId, year: 2569, studentNo: '10001', firstName: 'มานะ', gradeLevel: 'ป.1', room: '1', classNo: 2 }), fin);
  assert.equal(steal.error.code, 'CONFLICT');
});

test('ปีการศึกษาที่ปิดแล้วแก้ไขชั้นเรียนไม่ได้', () => {
  const { h, admin, fin } = setup();
  const s = addStudent(h, fin);
  const y2570 = h.ok('years.create', { year: 2570 }, admin);
  h.ok('years.setCurrent', { academicYearId: y2570.academicYearId }, admin);
  const y2569 = h.ok('years.list', {}, admin).find((y) => y.year === 2569);
  h.ok('years.update', { academicYearId: y2569.academicYearId, label: y2569.label, status: 'CLOSED' }, admin);
  const res = h.api('students.update', { studentId: s.studentId, year: 2569, studentNo: '10001', firstName: 'สมชาย', gradeLevel: 'ป.2' }, fin);
  assert.match(res.error.message, /ปีการศึกษา 2569 ปิดแล้ว/);
  assert.match(h.api('students.create', { studentNo: '3', firstName: 'ก', gradeLevel: 'ป.1', year: 2569 }, fin).error.message, /ปิดแล้ว/);
  assert.equal(h.ok('students.list', { year: 2569 }, fin).rows.length, 1, 'ยังดูข้อมูลปีที่ปิดได้');
});

test('เปลี่ยนสถานะย้ายออก: บังคับวันที่และหมายเหตุ สถานะในปีนั้นเปลี่ยนด้วย และข้อมูลไม่ถูกลบ', () => {
  const { h, fin, dir } = setup();
  const s = addStudent(h, fin);
  assert.match(h.api('students.setStatus', { studentId: s.studentId, year: 2569, status: 'TRANSFERRED', statusDate: '2026-11-20' }, fin).error.message, /กรุณาระบุหมายเหตุ/);
  assert.match(h.api('students.setStatus', { studentId: s.studentId, year: 2569, status: 'TRANSFERRED', note: 'x' }, fin).error.message, /กรุณาระบุวันที่/);
  const out = h.ok('students.setStatus', { studentId: s.studentId, year: 2569, status: 'TRANSFERRED', statusDate: '2026-11-20', note: 'ย้ายตามผู้ปกครอง' }, fin);
  assert.equal(out.status, 'TRANSFERRED');
  assert.equal(out.enrollStatus, 'TRANSFERRED');
  assert.equal(out.statusLabel, 'ย้ายออก');
  const list = h.ok('students.list', { year: 2569 }, dir);
  assert.equal(list.rows.length, 1, 'ยังอยู่ในรายชื่อ (หน้าเว็บกรองตามสถานะเอง)');
  assert.equal(list.rows[0].enrollStatus, 'TRANSFERRED');
  const log = h.auditRows().filter((r) => r.Entity === 'Students' && r.Action === 'UPDATE').pop();
  assert.equal(log.Note, 'เปลี่ยนสถานะเป็นย้ายออก');
});
