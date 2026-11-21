'use strict';
/** ทดสอบการนำเข้านักเรียน (อ่านไฟล์ ตรวจ จัดประเภท บันทึก) และการเลื่อนชั้นขึ้นปีใหม่ */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppEnv, createEnv, plain } = require('./harness');

const g0 = createEnv({ withSpreadsheet: false }).gas;

function setup() {
  const h = createAppEnv();
  const admin = h.adminToken();
  const fin = h.addUser(admin, 'FINANCE', 'finance1').token;
  return { h, admin, fin };
}

function row(no, first, last, grade, room, classNo, extra) {
  return Object.assign({ studentNo: no, prefix: 'เด็กชาย', firstName: first, lastName: last, gradeLevel: grade, room: room, classNo: classNo }, extra || {});
}

function preview(h, token, rows, options) {
  return h.ok('students.importPreview', Object.assign({ year: 2569, rows }, options || {}), token);
}

function statuses(res) {
  return res.rows.map((r) => r.rowNo + ':' + r.status);
}

// ---------------------------------------------------------------------------
// อ่านไฟล์และหัวตาราง (ฟังก์ชันเดียวกับที่หน้าเว็บใช้)
// ---------------------------------------------------------------------------

test('อ่าน CSV/TSV: เครื่องหมายคำพูด จุลภาคและขึ้นบรรทัดในช่อง BOM และเลือกตัวคั่นอัตโนมัติ', () => {
  assert.deepEqual(plain(g0.parseDelimitedText_('﻿เลขประจำตัว,ชื่อ\r\n"001","สม, ชาย"\r\n002,"มี ""ชื่อ"" เล่น"\n\n003,"สอง\nบรรทัด"')),
    [['เลขประจำตัว', 'ชื่อ'], ['001', 'สม, ชาย'], ['002', 'มี "ชื่อ" เล่น'], ['003', 'สอง\nบรรทัด']]);
  assert.deepEqual(plain(g0.parseDelimitedText_('เลขที่\tชื่อ, นามสกุล\n1\tสมชาย, ใจดี\n')), [['เลขที่', 'ชื่อ, นามสกุล'], ['1', 'สมชาย, ใจดี']], 'ข้อความที่คัดลอกจาก Excel ใช้แท็บ');
  assert.deepEqual(plain(g0.parseDelimitedText_('a;b\n1;2')), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(plain(g0.parseDelimitedText_('')), []);
});

test('จับคู่หัวตารางภาษาไทยและอังกฤษ และหาแถวหัวตารางที่ไม่ได้อยู่แถวแรก', () => {
  const cols = plain(g0.detectStudentColumns_(['ลำดับ', 'เลขประจำตัวนักเรียน', 'คำนำหน้าชื่อ', 'ชื่อ', 'นามสกุล', 'ชั้น', 'ห้อง', 'เลขที่']));
  assert.deepEqual(cols, { studentNo: 1, prefix: 2, fullName: -1, firstName: 3, lastName: 4, gradeRoom: -1, gradeLevel: 5, room: 6, classNo: 7 });
  const alt = plain(g0.detectStudentColumns_(['Student ID', 'Full Name', 'ชั้น/ห้อง', 'No.']));
  assert.equal(alt.studentNo, 0);
  assert.equal(alt.fullName, 1);
  assert.equal(alt.gradeRoom, 2);
  assert.equal(alt.classNo, 3);
  const found = plain(g0.findStudentHeaderRow_([['รายชื่อนักเรียน ปีการศึกษา 2569'], [''], ['เลขประจำตัว', 'ชื่อ-นามสกุล', 'ชั้น'], ['1', 'ก ข', 'ป.1']]));
  assert.equal(found.index, 2);
  assert.equal(g0.findStudentHeaderRow_([['a', 'b'], ['1', '2']]), null);
});

test('แยกชื่อเต็มภาษาไทย และแปลงระดับชั้น/ห้องให้ตรงรูปแบบ', () => {
  assert.deepEqual(plain(g0.splitThaiFullName_('เด็กหญิงสมใจ  ใจดี')), { prefix: 'เด็กหญิง', firstName: 'สมใจ', lastName: 'ใจดี' });
  assert.deepEqual(plain(g0.splitThaiFullName_('ด.ช. สมชาย ณ เชียงใหม่')), { prefix: 'ด.ช.', firstName: 'สมชาย', lastName: 'ณ เชียงใหม่' });
  assert.deepEqual(plain(g0.splitThaiFullName_('นางสาวมานี')), { prefix: 'นางสาว', firstName: 'มานี', lastName: '' });
  const levels = ['อ.2', 'อ.3', 'ป.1', 'ป.2', 'ป.6'];
  [['ป1', 'ป.1'], ['ป. 2', 'ป.2'], ['ประถมศึกษาปีที่ 6', 'ป.6'], ['อนุบาล 3', 'อ.3'], ['อนุบาลปีที่ 2', 'อ.2'], ['ม.1', ''], ['ป.3', ''], ['', '']]
    .forEach(([input, expected]) => assert.equal(g0.normalizeGradeLevel_(input, levels), expected, input));
  assert.equal(g0.normalizeRoom_('ห้อง 01'), '1');
  assert.equal(g0.normalizeRoom_(' ก '), 'ก');
  assert.equal(g0.studentDisplayName_('ด.ญ.', 'มานี', 'มีนา'), 'ด.ญ.มานี มีนา');
});

// ---------------------------------------------------------------------------
// ตรวจข้อมูล (ไม่บันทึก)
// ---------------------------------------------------------------------------

test('ตรวจข้อมูล: จัดประเภททุกแถว และไม่บันทึกอะไรเลย', () => {
  const { h, fin } = setup();
  h.ok('students.create', { studentNo: '500', prefix: 'เด็กหญิง', firstName: 'มานี', lastName: 'มีนา', gradeLevel: 'ป.2', room: '1', classNo: 5, year: 2569 }, fin);
  h.ok('students.create', { studentNo: '501', firstName: 'ปิติ', lastName: 'ยินดี', gradeLevel: 'ป.2', room: '1', classNo: 6, year: 2569 }, fin);
  const before = h.auditRows().length;
  const res = preview(h, fin, [
    row('1001', 'สมชาย', 'ใจดี', 'ป.1', '1', '1'),                          // 1 NEW
    row('1002', 'สมหญิง', 'ใจงาม', 'ป1', 'ห้อง 1', '2'),                     // 2 NEW (แปลงชั้น/ห้อง)
    row('1001', 'ซ้ำ', 'ในไฟล์', 'ป.1', '1', '3'),                           // 3 DUPLICATE_IN_FILE
    row('500', 'มานี', 'มีนา', 'ป.2', '1', '5', { prefix: 'เด็กหญิง' }),       // 4 SAME
    row('501', 'ปิติ', 'ยินดี', 'ป.2', '2', '6'),                             // 5 UPDATE (ห้องเปลี่ยน)
    row('500', 'คนอื่น', 'นามสกุลอื่น', 'ป.2', '1', '7'),                     // 6 DUPLICATE_IN_FILE (500 มีแล้วในแถว 4)
    row('600', 'มานี', 'มีนา', 'ป.3', '1', '1'),                              // 7 NAME_DUPLICATE
    row('', 'ไม่มี', 'เลข', 'ป.1', '1', '9'),                                 // 8 INVALID
    row('1003', 'ชั้นผิด', 'ไม่มี', 'ม.1', '1', '1'),                          // 9 INVALID
    row('1004', 'เลขที่', 'ซ้ำ', 'ป.1', '1', '1'),                            // 10 INVALID (เลขที่ 1 ป.1/1 ซ้ำแถว 1)
    row('1005', 'ใช้เลขที่', 'ของคนเดิม', 'ป.2', '1', '5'),                   // 11 INVALID (เลขที่ 5 ป.2/1 เป็นของมานี)
  ].map((r, i) => Object.assign({ rowNo: i + 1 }, r)));
  assert.deepEqual([...statuses(res)], [
    '1:NEW', '2:NEW', '3:DUPLICATE_IN_FILE', '4:SAME', '5:UPDATE', '6:DUPLICATE_IN_FILE', '7:NAME_DUPLICATE',
    '8:INVALID', '9:INVALID', '10:INVALID', '11:INVALID']);
  assert.equal(res.rows[1].classLabel, 'ป.1/1');
  assert.match(res.rows[4].changes.join(), /ชั้น ป.2\/1 → ป.2\/2/);
  assert.match(res.rows[6].messages.join(), /ชื่อซ้ำกับ เด็กหญิงมานี มีนา \(เลขประจำตัว 500\)/);
  assert.match(res.rows[7].messages.join(), /กรุณากรอกเลขประจำตัวนักเรียน/);
  assert.match(res.rows[8].messages.join(), /ระดับชั้น "ม.1" ไม่อยู่ในรายการ/);
  assert.match(res.rows[9].messages.join(), /เลขที่ 1 ของชั้น ป.1\/1 ซ้ำกับ แถวที่ 1 ในไฟล์/);
  assert.match(res.rows[10].messages.join(), /ซ้ำกับ เด็กหญิงมานี มีนา \(ในระบบ\)/);
  assert.equal(res.counts.apply, 2, 'ค่าเริ่มต้นบันทึกเฉพาะนักเรียนใหม่ที่ไม่มีปัญหา');
  assert.equal(h.auditRows().length, before, 'ตรวจข้อมูลต้องไม่บันทึกอะไรเลย');
});

test('ตัวเลือกของผู้ใช้เปลี่ยนผลตรวจ: ปรับปรุงข้อมูลเดิม และยืนยันชื่อซ้ำ', () => {
  const { h, fin } = setup();
  h.ok('students.create', { studentNo: '500', firstName: 'มานี', lastName: 'มีนา', gradeLevel: 'ป.2', room: '1', classNo: 5, year: 2569 }, fin);
  const rows = [
    row('500', 'มานี', 'มีนา', 'ป.2', '1', '8'),         // UPDATE เลขที่ 5 → 8
    row('700', 'ใหม่', 'ใช้เลขที่ห้า', 'ป.2', '1', '5'),   // ใช้เลขที่ 5 ได้ เฉพาะเมื่อมานีย้ายไปเลขที่ 8
    row('800', 'มานี', 'มีนา', 'ป.3', '1', '1'),          // NAME_DUPLICATE
  ];
  const plainRes = preview(h, fin, rows);
  assert.deepEqual([...statuses(plainRes)], ['1:UPDATE', '2:INVALID', '3:NAME_DUPLICATE']);
  const withUpdate = preview(h, fin, rows, { updateExisting: true, acceptNameDuplicates: true });
  assert.deepEqual([...statuses(withUpdate)], ['1:UPDATE', '2:NEW', '3:NAME_DUPLICATE']);
  assert.equal(withUpdate.counts.apply, 3);
});

test('จำกัดจำนวนแถวต่อครั้ง และต้องเป็นปีการศึกษาที่เปิดอยู่', () => {
  const { h, fin } = setup();
  const many = Array.from({ length: 1501 }, (_, i) => row(String(i + 1), 'ก' + i, 'ข', 'ป.1', '1', ''));
  assert.match(h.api('students.importPreview', { year: 2569, rows: many }, fin).error.message, /ไม่เกิน 1,500 แถว/);
  assert.match(h.api('students.importPreview', { year: 2569, rows: [] }, fin).error.message, /ไม่พบข้อมูลที่จะนำเข้า/);
  assert.match(h.api('students.importPreview', { year: 2590, rows: [row('1', 'ก', 'ข', 'ป.1', '1', '')] }, fin).error.message, /ไม่พบปีการศึกษา 2590/);
});

// ---------------------------------------------------------------------------
// บันทึก
// ---------------------------------------------------------------------------

test('นำเข้า: บันทึกเฉพาะแถวที่ผ่าน และนำเข้าไฟล์เดิมซ้ำไม่เกิดข้อมูลซ้ำ', () => {
  const { h, fin } = setup();
  const rows = [];
  for (let i = 1; i <= 30; i++) rows.push(row(String(2000 + i), 'นักเรียน' + i, 'ทดสอบ', i <= 15 ? 'ป.1' : 'ป.2', '1', String(((i - 1) % 15) + 1)));
  rows.push(row('', 'ไม่มีเลข', 'ประจำตัว', 'ป.1', '1', '99'));
  const first = h.ok('students.importCommit', { year: 2569, rows, fileName: 'รายชื่อ ป.1-ป.2.xlsx' }, fin);
  assert.deepEqual({ ...first }, { year: 2569, created: 30, enrolled: 0, updated: 0, unchanged: 0, skipped: 1 });
  const list = h.ok('students.list', { year: 2569 }, fin);
  assert.equal(list.rows.length, 30);
  assert.equal(list.rows[0].classLabel, 'ป.1/1');

  const again = h.ok('students.importCommit', { year: 2569, rows, fileName: 'รายชื่อ ป.1-ป.2.xlsx' }, fin);
  assert.deepEqual({ ...again }, { year: 2569, created: 0, enrolled: 0, updated: 0, unchanged: 30, skipped: 1 });
  assert.equal(h.ok('students.list', { year: 2569 }, fin).rows.length, 30, 'ไม่มีนักเรียนซ้ำ');

  const summary = h.auditRows().filter((r) => r.Action === 'IMPORT' && r.EntityId === '');
  assert.equal(summary.length, 2);
  assert.match(summary[0].Note, /จาก รายชื่อ ป.1-ป.2.xlsx: เพิ่มใหม่ 30 คน/);
  assert.ok(h.auditRows().filter((r) => r.Action === 'IMPORT' && r.Entity === 'Students' && r.EntityId).length === 30, 'บันทึกประวัติรายคน');
});

test('นำเข้าปีใหม่ด้วยไฟล์รายชื่อเดิม: นักเรียนเดิมได้ชั้นเรียนปีใหม่ และปรับปรุงเมื่อผู้ใช้เลือก', () => {
  const { h, admin, fin } = setup();
  h.ok('students.importCommit', { year: 2569, rows: [row('1', 'ก', 'ข', 'ป.1', '1', '1'), row('2', 'ค', 'ง', 'ป.1', '1', '2')] }, fin);
  h.ok('years.create', { year: 2570 }, admin);
  const next = h.ok('students.importCommit', { year: 2570, rows: [row('1', 'ก', 'ข', 'ป.2', '1', '1'), row('2', 'ค', 'งาม', 'ป.2', '1', '2')] }, fin);
  assert.equal(next.enrolled, 1, 'คนที่ 1: เพิ่มชั้นเรียนปี 2570');
  assert.equal(next.skipped, 1, 'คนที่ 2: นามสกุลต่างจากในระบบ ต้องเลือกปรับปรุงก่อน');
  const forced = h.ok('students.importCommit', { year: 2570, updateExisting: true, rows: [row('2', 'ค', 'งาม', 'ป.2', '1', '2')] }, fin);
  assert.equal(forced.updated, 1);
  const list2570 = h.ok('students.list', { year: 2570 }, fin).rows;
  assert.deepEqual(list2570.map((r) => r.studentNo + ':' + r.fullName + ':' + r.classLabel), ['1:เด็กชายก ข:ป.2/1', '2:เด็กชายค งาม:ป.2/1']);
  assert.equal(h.ok('students.list', { year: 2569 }, fin).rows.length, 2, 'ข้อมูลปี 2569 ยังอยู่ครบ');
});

test('นำเข้าด้วยคอลัมน์ ชื่อ-นามสกุล และ ชั้น/ห้อง', () => {
  const { h, fin } = setup();
  const res = h.ok('students.importCommit', { year: 2569, rows: [
    { studentNo: '3001', fullName: 'เด็กหญิงสมใจ รักเรียน', gradeRoom: 'ป.1/2', classNo: '3' },
  ] }, fin);
  assert.equal(res.created, 1);
  const s = h.ok('students.list', { year: 2569 }, fin).rows[0];
  assert.equal(s.prefix, 'เด็กหญิง');
  assert.equal(s.firstName, 'สมใจ');
  assert.equal(s.lastName, 'รักเรียน');
  assert.equal(s.classLabel, 'ป.1/2');
});

// ---------------------------------------------------------------------------
// เลื่อนชั้น
// ---------------------------------------------------------------------------

function promotionSetup() {
  const { h, admin, fin } = setup();
  h.ok('students.importCommit', { year: 2569, rows: [
    row('1', 'อนุบาล', 'สาม', 'อ.3', '1', '1'),
    row('2', 'ประถม', 'หนึ่ง', 'ป.1', '1', '1'),
    row('3', 'ประถม', 'หนึ่งบี', 'ป.1', '1', '2'),
    row('4', 'ประถม', 'หก', 'ป.6', '1', '1'),
    row('5', 'ย้าย', 'ออก', 'ป.1', '1', '3'),
  ] }, fin);
  const transferred = h.ok('students.list', { year: 2569 }, fin).rows.find((r) => r.studentNo === '5');
  h.ok('students.setStatus', { studentId: transferred.studentId, year: 2569, status: 'TRANSFERRED', statusDate: '2026-12-01', note: 'ย้ายตามผู้ปกครอง' }, fin);
  h.ok('years.create', { year: 2570 }, admin);
  return { h, admin, fin };
}

test('เลื่อนชั้น: ดูตัวอย่างก่อน ชั้นสุดท้ายจบการศึกษา และผู้ที่ย้ายออกไม่ถูกเลื่อน', () => {
  const { h, fin } = promotionSetup();
  const before = h.auditRows().length;
  const p = h.ok('students.promotePreview', { fromYear: 2569, toYear: 2570 }, fin);
  assert.deepEqual(p.groups.map((g) => g.fromGrade + '→' + (g.graduate ? 'จบ' : g.toGrade) + ':' + g.count), ['อ.3→ป.1:1', 'ป.1→ป.2:2', 'ป.6→จบ:1']);
  assert.equal(p.promote, 3);
  assert.equal(p.graduate, 1);
  assert.equal(h.auditRows().length, before, 'ดูตัวอย่างไม่บันทึก');
});

test('เลื่อนชั้นจริง: สร้างชั้นเรียนปีใหม่ ข้อมูลปีเดิมไม่หาย และรันซ้ำไม่เกิดข้อมูลซ้ำ', () => {
  const { h, fin } = promotionSetup();
  const r = h.ok('students.promoteCommit', { fromYear: 2569, toYear: 2570, graduationDate: '2027-03-31' }, fin);
  assert.deepEqual({ ...r }, { fromYear: 2569, toYear: 2570, promoted: 3, graduated: 1, skipped: 0, classNoCleared: 0 });
  const y2570 = h.ok('students.list', { year: 2570 }, fin).rows;
  assert.deepEqual(y2570.map((x) => x.studentNo + ':' + x.classLabel + '#' + x.classNo), ['1:ป.1/1#1', '2:ป.2/1#1', '3:ป.2/1#2']);
  const y2569 = h.ok('students.list', { year: 2569 }, fin).rows;
  assert.equal(y2569.length, 5, 'ปีเดิมยังอยู่ครบ');
  const grad = y2569.find((x) => x.studentNo === '4');
  assert.equal(grad.status, 'GRADUATED');
  assert.equal(grad.enrollStatus, 'GRADUATED');
  assert.equal(grad.statusDate, '2027-03-31');
  assert.equal(y2569.find((x) => x.studentNo === '2').enrollStatus, 'STUDYING', 'สถานะปีเดิมของคนที่เลื่อนชั้นไม่เปลี่ยน');

  const again = h.ok('students.promotePreview', { fromYear: 2569, toYear: 2570 }, fin);
  assert.equal(again.promote + again.graduate, 0);
  assert.equal(again.skipped.length, 3);
  assert.match(again.skipped[0].reason, /มีข้อมูลชั้นเรียนปีการศึกษา 2570 แล้ว/);
  assert.equal(h.ok('students.promoteCommit', { fromYear: 2569, toYear: 2570 }, fin).promoted, 0);
  assert.equal(h.auditRows().filter((x) => x.Action === 'PROMOTE' && x.EntityId === '').length, 2);
});

test('เลื่อนชั้น: เลขที่ที่ซ้ำกับนักเรียนในปีใหม่ถูกเว้นไว้ และตรวจปีการศึกษา', () => {
  const { h, fin } = promotionSetup();
  h.ok('students.importCommit', { year: 2570, rows: [row('9', 'ย้ายเข้า', 'ใหม่', 'ป.2', '1', '1')] }, fin);
  const r = h.ok('students.promoteCommit', { fromYear: 2569, toYear: 2570 }, fin);
  assert.equal(r.classNoCleared, 1);
  const p2 = h.ok('students.list', { year: 2570 }, fin).rows.filter((x) => x.gradeLevel === 'ป.2');
  assert.deepEqual(p2.map((x) => x.studentNo + '#' + x.classNo), ['9#1', '3#2', '2#null'], 'คนที่เลขที่ซ้ำกับผู้ย้ายเข้าถูกเว้นเลขที่ไว้');
  assert.match(h.api('students.promotePreview', { fromYear: 2570, toYear: 2569 }, fin).error.message, /ไม่พบปีการศึกษา|ต้องมากกว่า/);
  assert.match(h.api('students.promotePreview', { fromYear: 2569, toYear: 2571 }, fin).error.message, /ไม่พบปีการศึกษา 2571/);
});
