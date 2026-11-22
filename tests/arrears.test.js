'use strict';
/**
 * ทดสอบยอดค้างชำระ (ระยะที่ 6) โดยเทียบกับตัวเลขที่คำนวณด้วยมือ
 *
 * ชุดข้อมูล (ปีการศึกษา 2569, วันนี้ = 21 พ.ย. 2569)
 *   ป.1 ภาค 1 = 500 (ครบกำหนด 30 มิ.ย. 2569 → เลยกำหนดแล้ว)  ป.1 ภาค 2 = 500 (ครบกำหนด 31 ธ.ค. 2569)
 *   ป.2 ภาค 1 = 600   ป.6 ภาค 1 = 700 (ครบกำหนด 30 มิ.ย. 2569)
 *   A ป.1/1 จ่าย 500          → ค้าง 500 (ภาค 2)
 *   B ป.1/1 จ่าย 200          → ค้าง 300 (ภาค 1 เลยกำหนด) + 500 (ภาค 2)
 *   C ป.1/2 ได้รับยกเว้นภาค 1   → ค้าง 500 (ภาค 2)
 *   F ป.1/2 ย้ายออกก่อนเรียกเก็บภาค 2 → ค้าง 500 (ภาค 1 เลยกำหนด)
 *   D ป.2/1 จ่าย 600          → ไม่ค้าง
 *   E ป.6/1 จ่าย 300          → ค้าง 400 (เลยกำหนด) แล้วจบการศึกษา
 *   G ป.6/1 จ่าย 700          → ไม่ค้าง แล้วจบการศึกษา
 * ปีการศึกษา 2570: เลื่อนชั้น ป.2 ภาค 1 = 800, ป.3 ภาค 1 = 900
 *   A จ่าย 800 → ตัดหนี้ปี 2569 ที่เหลือ 500 ก่อน แล้ว 300 เข้าปี 2570 (ค้าง 500)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArrearsDataset, arrearsNextYear } = require('./finance-helpers');

const KEYS = ['students', 'owingStudents', 'netSatang', 'paidSatang', 'currentSatang', 'priorSatang', 'laterSatang', 'totalSatang', 'overdueSatang'];
function pick(o, keys) {
  const out = {};
  (keys || KEYS).forEach((k) => { out[k] = o[k]; });
  return out;
}
const baht = (n) => Math.round(n * 100);
function fig(students, owing, net, paid, current, prior, later, total, overdue) {
  return {
    students, owingStudents: owing, netSatang: baht(net), paidSatang: baht(paid), currentSatang: baht(current),
    priorSatang: baht(prior), laterSatang: baht(later), totalSatang: baht(total), overdueSatang: baht(overdue),
  };
}

const build = buildArrearsDataset;
const nextYear = arrearsNextYear;

test('ยอดค้างปีการศึกษา 2569: ทั้งโรงเรียน รายชั้น และรายห้อง ตรงกับการคำนวณมือ', () => {
  const { t, h, s } = build();
  const r = h.ok('arrears.summary', {}, t.dir);
  assert.equal(r.year, 2569, 'ค่าเริ่มต้นคือปีการศึกษาปัจจุบัน');
  //                                 นร. ค้าง  สุทธิ  ชำระ  ปีนี้  ก่อน ถัดไป  รวม  เลยกำหนด
  assert.deepEqual(pick(r.school), fig(7, 5, 5000, 2300, 2700, 0, 0, 2700, 1200));
  assert.deepEqual(pick(r.other), fig(0, 0, 0, 0, 0, 0, 0, 0, 0));
  assert.deepEqual(r.grades.map((g) => g.gradeLevel), ['ป.1', 'ป.2', 'ป.6']);
  const [p1, p2, p6] = r.grades;
  assert.deepEqual(pick(p1), fig(4, 4, 3000, 700, 2300, 0, 0, 2300, 800));
  assert.deepEqual(p1.rooms.map((x) => x.classLabel), ['ป.1/1', 'ป.1/2']);
  assert.deepEqual(pick(p1.rooms[0]), fig(2, 2, 2000, 700, 1300, 0, 0, 1300, 300));
  assert.deepEqual(pick(p1.rooms[1]), fig(2, 2, 1000, 0, 1000, 0, 0, 1000, 500));
  assert.deepEqual(pick(p2), fig(1, 0, 600, 600, 0, 0, 0, 0, 0));
  assert.deepEqual(pick(p6), fig(2, 1, 1400, 1000, 400, 0, 0, 400, 400));

  const row = (no) => r.rows.find((x) => x.studentNo === no);
  assert.deepEqual(pick(row('10002'), ['currentSatang', 'overdueSatang', 'totalSatang']), { currentSatang: 80000, overdueSatang: 30000, totalSatang: 80000 });
  assert.equal(row('10003').netSatang, 50000, 'ได้รับยกเว้นภาค 1 ยอดสุทธิเหลือเฉพาะภาค 2');
  assert.equal(row('10006').enrollStatus, 'TRANSFERRED', 'ผู้ย้ายออกยังแสดงในชั้นของปีที่เรียนอยู่');
  assert.equal(row('10006').oldestDue, '2026-06-30');
  assert.deepEqual([...r.rows.map((x) => x.studentNo)], ['10001', '10002', '10003', '10006', '10004', '10005', '10007'], 'เรียงตามชั้น ห้อง เลขที่');
});

test('ยอดค้างปีการศึกษา 2570: ยอดค้างสะสมจากปีก่อน และนักเรียนที่จบหรือย้ายออกแล้วแสดงแยก', () => {
  const { t, h, s } = build();
  const paid = nextYear(t, h, s);
  assert.deepEqual([...paid.payment.allocations.map((a) => a.label + '=' + a.amountSatang)],
    ['เงินบำรุงการศึกษา ภาคเรียนที่ 2/2569 ชั้น ป.1=50000', 'เงินบำรุงการศึกษา ภาคเรียนที่ 1/2570 ชั้น ป.2=30000'], 'ตัดหนี้ปีก่อนก่อน');

  const r = h.ok('arrears.summary', { year: 2570 }, t.dir);
  //                                 นร. ค้าง  สุทธิ  ชำระ  ปีนี้  ก่อน ถัดไป  รวม  เลยกำหนด
  assert.deepEqual(pick(r.school), fig(6, 6, 3300, 300, 3000, 2200, 0, 5200, 1200));
  assert.deepEqual(pick(r.enrolled), fig(4, 4, 3300, 300, 3000, 1300, 0, 4300, 300));
  assert.deepEqual(pick(r.other), fig(2, 2, 0, 0, 0, 900, 0, 900, 900));
  const [p2, p3] = r.grades;
  assert.equal(r.grades.length, 2);
  assert.deepEqual(pick(p2), fig(3, 3, 2400, 300, 2100, 1300, 0, 3400, 300));
  assert.deepEqual(pick(p2.rooms[0]), fig(2, 2, 1600, 300, 1300, 800, 0, 2100, 300));
  assert.deepEqual(pick(p2.rooms[1]), fig(1, 1, 800, 0, 800, 500, 0, 1300, 0));
  assert.deepEqual(pick(p3), fig(1, 1, 900, 0, 900, 0, 0, 900, 0));

  const others = r.rows.filter((x) => !x.enrolled);
  assert.deepEqual([...others.map((x) => x.studentNo + ':' + x.statusLabel)].sort(), ['10005:จบการศึกษา', '10006:ย้ายออก']);
  assert.ok(!r.rows.some((x) => x.studentNo === '10007'), 'จบการศึกษาและไม่มียอดค้าง ไม่ต้องแสดง');
  const b = r.rows.find((x) => x.studentNo === '10002');
  assert.deepEqual([...b.years.map((y) => y.year + '=' + y.satang)], ['2569=80000', '2570=80000']);
  assert.equal(b.classLabel, 'ป.2/1');

  const total = h.ok('ledger.students', {}, t.fin).rows.reduce((sum, x) => sum + x.outstandingSatang, 0);
  assert.equal(total, r.school.totalSatang, 'ยอดรวมทั้งโรงเรียนตรงกับยอดค้างรายคนในบัญชีนักเรียน');
  assert.equal(r.rows.reduce((sum, x) => sum + x.totalSatang, 0), r.school.totalSatang);
});

test('ดูปีที่ผ่านมาแล้ว: ยอดของปีถัดไปแยกไว้ และยอดรวมทุกปีเท่าเดิม', () => {
  const { t, h, s } = build();
  nextYear(t, h, s);
  const r = h.ok('arrears.summary', { year: 2569 }, t.fin);
  //                                 นร. ค้าง  สุทธิ  ชำระ  ปีนี้  ก่อน ถัดไป  รวม  เลยกำหนด
  assert.deepEqual(pick(r.school), fig(7, 6, 5000, 2800, 2200, 0, 3000, 5200, 1200));
  assert.deepEqual(pick(r.grades[0]), fig(4, 4, 3000, 1200, 1800, 0, 2100, 3900, 800));
  assert.equal(r.rows.find((x) => x.studentNo === '10001').currentSatang, 0, 'A จ่ายหนี้ปี 2569 ครบแล้วด้วยใบเสร็จปี 2570');
});

test('ยอดค้างเปลี่ยนตามการยกเลิกใบเสร็จและการยกเลิกรายการเรียกเก็บ', () => {
  const { t, h, s } = build();
  const before = h.ok('arrears.summary', {}, t.fin).school.totalSatang;
  const pay = t.ledger(s.D.studentId).payments[0];
  h.ok('payments.requestVoid', { paymentId: pay.paymentId, reason: 'เขียนผิดทั้งฉบับ', confirmKept: true }, t.fin);
  const voidReq = h.ok('approvals.list', {}, t.dir).rows.find((x) => x.type === 'RECEIPT_CANCEL');
  h.ok('approvals.decide', { requestId: voidReq.requestId, decision: 'APPROVE' }, t.dir);
  assert.equal(h.ok('arrears.summary', {}, t.fin).school.totalSatang, before + 60000, 'ยกเลิกใบเสร็จ 600 บาท ยอดค้างเพิ่ม 600');

  const fAsm = t.ledger(s.F.studentId).assessments[0];
  const cancel = h.ok('assessments.requestCancel', { assessmentId: fAsm.assessmentId, reason: 'ย้ายออกก่อนเปิดภาคเรียน' }, t.fin);
  h.ok('approvals.decide', { requestId: cancel.requestId, decision: 'APPROVE' }, t.dir);
  const after = h.ok('arrears.summary', {}, t.fin);
  assert.equal(after.school.totalSatang, before + 60000 - 50000);
  assert.equal(after.rows.find((x) => x.studentNo === '10006').totalSatang, 0);
});
