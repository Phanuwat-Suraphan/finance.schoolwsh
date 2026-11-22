'use strict';
/**
 * ทดสอบทั้งระบบ (ระยะที่ 8): ใช้งานครบ 1 ปีการศึกษาผ่าน API เหมือนหน้าเว็บ แล้วตรวจความถูกต้องของข้อมูลหลังทุกขั้นตอน
 * และเทียบตัวเลขจากหลายหน้า (บัญชีนักเรียน ยอดค้าง Dashboard รายงาน) ว่าตรงกันทุกที่
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupFinance } = require('./finance-helpers');
const { plain } = require('./harness');

const GRADES = ['ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6'];
const FIRST = ['สมชาย', 'สมหญิง', 'มานะ', 'มานี'];

function integrityOk(t, step) {
  const r = t.h.ok('integrity.check', {}, t.dir);
  assert.deepEqual(r.checks.filter((c) => !c.ok).map((c) => c.key + ': ' + c.problems.join(' | ')), [], 'ความถูกต้องหลังขั้นตอน: ' + step);
}

function decideAll(t, decision) {
  t.h.ok('approvals.list', { status: 'PENDING' }, t.dir).rows.forEach((r) => {
    t.h.ok('approvals.decide', { requestId: r.requestId, decision, note: decision === 'REJECT' ? 'ไม่อนุมัติเพื่อทดสอบ' : '' }, t.dir);
  });
}

function sum(list, f) {
  return list.reduce((s, x) => s + f(x), 0);
}

test('ใช้งานครบ 1 ปีการศึกษา: ทุกขั้นตอนข้อมูลถูกต้อง และตัวเลขทุกหน้าตรงกัน', () => {
  const t = setupFinance();
  const { h } = t;
  h.ok('settings.update', { values: { SCHOOL_PHONE: '053-000000', FINANCE_OFFICER_NAME: 'นางสาวการเงิน ทดสอบ', DIRECTOR_NAME: 'นายผู้อำนวยการ ทดสอบ' } }, t.admin);
  integrityOk(t, 'ติดตั้งและตั้งค่า');

  // ---------------------------------------------------------------- 1. นำเข้านักเรียน 24 คน และนำเข้าซ้ำต้องไม่เพิ่มคนซ้ำ
  const rows = [];
  GRADES.forEach((g, gi) => ['1', '2'].forEach((room, ri) => [1, 2].forEach((no) => {
    const n = rows.length + 1;
    rows.push({ studentNo: String(20000 + n), prefix: no === 1 ? 'เด็กชาย' : 'เด็กหญิง', firstName: FIRST[(gi + ri + no) % 4] + n, lastName: 'ทดสอบระบบ', gradeLevel: g, room, classNo: no });
  })));
  const pre = h.ok('students.importPreview', { year: 2569, rows }, t.fin);
  assert.equal(pre.rows.filter((r) => r.status === 'NEW').length, 24);
  assert.equal(h.ok('students.importCommit', { year: 2569, rows, fileName: 'รายชื่อ.xlsx' }, t.fin).created, 24);
  const again = h.ok('students.importPreview', { year: 2569, rows }, t.fin);
  assert.equal(again.rows.filter((r) => r.status === 'NEW').length, 0, 'นำเข้าซ้ำต้องไม่มีรายการใหม่');
  assert.equal(h.ok('students.importCommit', { year: 2569, rows }, t.fin).created, 0);
  const students = h.ok('students.list', { year: 2569 }, t.fin).rows;
  assert.equal(students.length, 24);
  const sid = (n) => students.find((s) => s.studentNo === String(20000 + n)).studentId;
  integrityOk(t, 'นำเข้านักเรียน');

  // ---------------------------------------------------------------- 2. อัตราภาค 1 และเรียกเก็บ
  t.fee({ gradeLevels: ['ป.1', 'ป.2', 'ป.3'], amount: '500' }).forEach((f) => t.generate(f.feeSettingId));
  t.fee({ gradeLevels: ['ป.4', 'ป.5', 'ป.6'], amount: '600' }).forEach((f) => t.generate(f.feeSettingId));
  integrityOk(t, 'สร้างรายการเรียกเก็บ');

  // ---------------------------------------------------------------- 3. รับเงิน (เต็ม บางส่วน หลายครั้ง โอน) วันที่ 20 พ.ย.
  t.book('1/2569', 1, 30);
  const D1 = '2026-11-20';
  const term1Fee = (n) => (Math.floor((n - 1) / 4) < 3 ? 500 : 600); // ป.1–ป.3 = 500, ป.4–ป.6 = 600
  for (let n = 1; n <= 10; n++) t.pay(sid(n), term1Fee(n), { paymentDate: D1 });
  for (let n = 11; n <= 16; n++) t.pay(sid(n), 200, { paymentDate: D1 });
  for (let n = 11; n <= 13; n++) t.pay(sid(n), 100, { paymentDate: D1, channel: 'โอนเงินเข้าบัญชีโรงเรียน', channelRef: 'KTB-' + n });
  integrityOk(t, 'รับเงิน');

  // ---------------------------------------------------------------- 4. ลดหย่อน/ยกเว้น และการแก้ไขหลังบันทึก
  const ledgerOf = (n) => t.ledger(sid(n));
  h.ok('adjustments.request', { assessmentId: ledgerOf(17).assessments[0].assessmentId, type: 'EXEMPTION', reason: 'ทุนการศึกษา', referenceDoc: 'ประกาศ 1/2569' }, t.fin);
  h.ok('adjustments.request', { assessmentId: ledgerOf(14).assessments[0].assessmentId, type: 'DISCOUNT', amount: '100', reason: 'พี่น้องเรียนด้วยกัน', referenceDoc: 'ประกาศ 2/2569' }, t.fin);
  decideAll(t, 'APPROVE');
  const book1 = h.ok('receipts.books', {}, t.fin).books[0];
  h.ok('receipts.requestCancelNumber', { bookId: book1.bookId, receiptNo: 20, reason: 'เขียนผิด', confirmKept: true }, t.fin);
  const p1 = ledgerOf(1).payments[0];
  h.ok('payments.requestVoid', { paymentId: p1.paymentId, reason: 'ผู้ปกครองชำระซ้ำ คืนเงินแล้ว', confirmKept: true }, t.fin);
  const p2 = ledgerOf(2).payments[0];
  h.ok('payments.requestCorrection', {
    paymentId: p2.paymentId, paymentDate: D1, amount: '450', channel: 'เงินสด', channelRef: '', receivedByName: 'นางสาวการเงิน ทดสอบ', note: '',
    reason: 'พิมพ์จำนวนเงินผิด', allocations: [{ assessmentId: p2.allocations[0].assessmentId, amount: '450' }],
  }, t.fin);
  decideAll(t, 'APPROVE');
  const p3 = ledgerOf(3).payments[0];
  h.ok('payments.requestVoid', { paymentId: p3.paymentId, reason: 'ทดสอบไม่อนุมัติ', confirmKept: true }, t.fin);
  decideAll(t, 'REJECT');
  integrityOk(t, 'ลดหย่อน ยกเลิก แก้ไข');

  // ---------------------------------------------------------------- 5. ปิดยอดวันที่ 20 และปิดเล่มก่อนใช้ครบ เปิดเล่มใหม่
  const daily = h.ok('reports.daily', { date: D1 }, t.fin);
  h.ok('closings.close', { date: D1, expectedDigest: daily.figures.digest, confirmChecked: true }, t.fin);
  h.ok('receipts.requestCloseBook', { bookId: book1.bookId, reason: 'เล่มชำรุด' }, t.fin);
  decideAll(t, 'APPROVE');
  t.book('2/2569', 1, 50);
  integrityOk(t, 'ปิดยอดและเปลี่ยนเล่ม');

  // ---------------------------------------------------------------- 6. ภาค 2: เรียกเก็บและรับเงินวันที่ 21 (หนี้เก่าก่อน)
  t.fee({ term: '2', gradeLevels: GRADES, amount: '500', startDate: '2026-11-01', dueDate: '2026-12-31' }).forEach((f) => t.generate(f.feeSettingId));
  [15, 16, 18, 19, 20].forEach((n) => t.pay(sid(n), 700));
  t.pay(sid(17), 500); // ได้รับยกเว้นภาค 1 จึงค้างเฉพาะภาค 2
  t.pay(sid(4), 500);
  integrityOk(t, 'ภาคเรียนที่ 2');

  // ---------------------------------------------------------------- 7. ตัวเลขทุกหน้าตรงกัน
  const ledger = h.ok('ledger.students', {}, t.dir).rows;
  const arrears = h.ok('arrears.summary', {}, t.dir);
  const dash = h.ok('dashboard.summary', {}, t.dir);
  const annual = h.ok('reports.annual', {}, t.dir);
  const coll = h.ok('reports.collections', { periodType: 'academic', year: 2569 }, t.dir);
  const pays = h.ok('payments.list', { fromDate: '2026-11-01', toDate: '2026-11-30' }, t.dir);
  const activePays = pays.rows.filter((p) => p.status === 'ACTIVE');
  assert.equal(sum(ledger, (r) => r.outstandingSatang), arrears.school.totalSatang, 'บัญชีนักเรียน = ยอดค้างทั้งโรงเรียน');
  assert.equal(dash.totals.outstandingSatang, arrears.school.currentSatang, 'Dashboard = รายงานยอดค้าง');
  assert.equal(dash.totals.netSatang, annual.overall.netSatang, 'Dashboard = รายงานประจำปี (ยอดสุทธิ)');
  assert.equal(dash.totals.paidSatang, annual.overall.paidSatang, 'Dashboard = รายงานประจำปี (ยอดรับ)');
  assert.equal(coll.total.satang, sum(activePays, (p) => p.amountSatang), 'รายงานแยกห้อง = ผลรวมใบเสร็จที่มีผล');
  assert.equal(coll.total.receipts, activePays.length);
  assert.equal(annual.cash.satang, coll.total.satang, 'รายงานประจำปี = รายงานแยกห้อง');
  assert.equal(annual.overall.paidSatang + annual.cash.priorSatang + annual.cash.laterSatang, annual.cash.satang, 'เงินที่รับทั้งหมดตัดชำระครบทุกบาท');
  assert.equal(sum(dash.grades, (g) => g.students), 24);
  assert.equal(dash.totals.states.PAID + dash.totals.states.PARTIAL + dash.totals.states.UNPAID + dash.totals.states.EXEMPT + dash.totals.states.NO_BILL, 24);
  const notices = h.ok('reports.notices', {}, t.fin);
  assert.equal(notices.notices.length, arrears.rows.filter((r) => r.enrolled && r.totalSatang > 0).length, 'หนังสือแจ้งยอด = ผู้ที่มียอดค้าง');
  assert.equal(notices.totalSatang, arrears.enrolled.totalSatang);
  const cancelled = h.ok('reports.cancelled', { periodType: 'academic', year: 2569 }, t.dir);
  assert.deepEqual([cancelled.totals.voidCount, cancelled.totals.spoiledCount, cancelled.totals.notApprovedCount], [1, 1, 1]);
  const usage = h.ok('reports.receiptUsage', {}, t.dir);
  const entries = (() => { h.newExecution(); return plain(h.gas.dbAll_('ReceiptEntries')); })();
  assert.equal(usage.total.used, entries.filter((e) => e.Status === 'USED').length);
  assert.equal(usage.total.cancelled, entries.filter((e) => e.Status === 'CANCELLED').length);
  assert.equal(usage.total.received, 80);
  assert.equal(usage.total.used + usage.total.cancelled + usage.total.closedUnused + usage.total.remaining, 80, 'เลขที่ทุกใบมีที่ไป');
  h.newExecution();
  assert.equal(plain(h.gas.dbAll_('FeeAssessments')).length, 48, 'เรียกเก็บ 2 ภาคเรียน × 24 คน');

  // ---------------------------------------------------------------- 8. ขึ้นปีการศึกษาใหม่ หนี้เก่ายังอยู่
  h.ok('years.create', { year: 2570 }, t.admin);
  h.ok('students.promoteCommit', { fromYear: 2569, toYear: 2570, graduationDate: '2027-03-31' }, t.fin);
  const next = h.ok('dashboard.summary', { year: 2570 }, t.dir);
  assert.equal(next.priorOutstandingSatang, arrears.school.totalSatang, 'ยอดค้างปี 2569 ยกไปเป็นค้างจากปีก่อน');
  integrityOk(t, 'ขึ้นปีการศึกษาใหม่');

  // ---------------------------------------------------------------- 9. สำรองแล้วกู้คืน ข้อมูลกลับมาเหมือนเดิมทุกแถว
  const SHEETS_TO_COMPARE = ['Students', 'Enrollments', 'FeeSettings', 'FeeAssessments', 'FeeAdjustments', 'Payments', 'PaymentAllocations',
    'ReceiptBooks', 'ReceiptEntries', 'ReceiptCancellations', 'ApprovalRequests', 'DailyClosings', 'AcademicYears', 'SchoolSettings'];
  const snapshot = () => { h.newExecution(); const o = {}; SHEETS_TO_COMPARE.forEach((n) => { o[n] = plain(h.gas.dbAll_(n)); }); return o; };
  const backup = h.ok('backups.create', {}, t.admin).backup;
  const before = snapshot();
  t.pay(sid(21), 300);
  h.ok('backups.restore', { fileId: backup.fileId, confirmText: 'กู้คืนข้อมูล' }, t.admin);
  assert.deepEqual(snapshot(), before, 'กู้คืนแล้วทุกชีตตรงกับตอนสำรองทุกแถว');
  t.dir = h.login('director1', 'Better2569pw');
  integrityOk(t, 'กู้คืนข้อมูล');
});
