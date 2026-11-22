'use strict';
/**
 * ทดสอบ Dashboard และรายงาน (ระยะที่ 7) ด้วยชุดข้อมูลเดียวกับการทดสอบยอดค้าง (ดูตัวเลขใน arrears.test.js)
 *   ปี 2569: A ป.1/1 ค้าง 500 | B ป.1/1 ค้าง 800 | C ป.1/2 ค้าง 500 (ยกเว้นภาค 1) | F ป.1/2 ย้ายออก ค้าง 500
 *            D ป.2/1 ชำระครบ 600 | E ป.6/1 ค้าง 400 | G ป.6/1 ชำระครบ 700
 *   รับเงินทั้งหมด 5 ใบ วันที่ 21 พ.ย. 2569 รวม 2,300 บาท
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArrearsDataset, arrearsNextYear, setupFinance } = require('./finance-helpers');

const baht = (n) => Math.round(n * 100);
const money = (g) => [g.students, g.netSatang / 100, g.paidSatang / 100, g.outstandingSatang / 100];
const states = (g) => [g.states.PAID, g.states.PARTIAL, g.states.UNPAID, g.states.EXEMPT, g.states.NO_BILL];

test('Dashboard: จำนวนนักเรียน ยอดเรียกเก็บ ยอดรับ ยอดค้าง และจำนวนตามสถานะ ตรงกับการคำนวณมือ', () => {
  const { t, h } = buildArrearsDataset();
  const d = h.ok('dashboard.summary', {}, t.dir);
  assert.equal(d.year, 2569);
  assert.deepEqual(money(d.totals), [7, 5000, 2300, 2700]);
  assert.equal(d.totals.grossSatang, baht(5500), 'ก่อนหักการยกเว้น 500');
  assert.equal(d.totals.overdueSatang, baht(1200));
  //                              ครบ บางส่วน ยังไม่ ยกเว้น ไม่มีรายการ
  assert.deepEqual(states(d.totals), [2, 3, 2, 0, 0]);
  assert.deepEqual(d.grades.map((g) => g.label), ['ป.1', 'ป.2', 'ป.6']);
  const p1 = d.grades[0];
  assert.deepEqual(money(p1), [4, 3000, 700, 2300]);
  assert.deepEqual(states(p1), [0, 2, 2, 0, 0]);
  assert.deepEqual(p1.rooms.map((r) => [r.label].concat(money(r))), [['ป.1/1', 2, 2000, 700, 1300], ['ป.1/2', 2, 1000, 0, 1000]]);
  assert.deepEqual(money(d.grades[1]), [1, 600, 600, 0]);
  assert.deepEqual(states(d.grades[2]), [1, 1, 0, 0, 0]);
  assert.deepEqual(d.todayReceipts, { date: '2026-11-21', count: 5, totalSatang: baht(2300), closed: false });
  assert.equal(d.pendingApprovals, 0);
  assert.equal(d.priorOutstandingSatang, 0);
  assert.deepEqual(d.states.map((s) => s.label), ['ชำระครบ', 'ชำระบางส่วน', 'ยังไม่ชำระ', 'ได้รับยกเว้น', 'ยังไม่มีรายการเรียกเก็บ']);
  assert.equal(h.api('dashboard.summary', {}, t.admin).error.code, 'FORBIDDEN', 'ผู้ดูแลระบบไม่เห็นข้อมูลการเงิน');
});

test('Dashboard ปี 2570: ยอดค้างจากปีก่อนแยกไว้ และนักเรียนที่ยังไม่มีรายการเรียกเก็บ', () => {
  const { t, h, s } = buildArrearsDataset();
  arrearsNextYear(t, h, s);
  const d = h.ok('dashboard.summary', { year: 2570 }, t.dir);
  // ปี 2570: A ป.2 (800 จ่าย 300) B ป.2 (800) C ป.2 (800) D ป.3 (900) | E G จบการศึกษา F ย้ายออก ไม่มีชั้นเรียนปี 2570
  assert.deepEqual(money(d.totals), [4, 3300, 300, 3000]);
  assert.deepEqual(states(d.totals), [0, 1, 3, 0, 0]);
  // ค้างจากปี 2569: B 800 + C 500 + F 500 + E 400 (A จ่ายครบแล้ว)
  assert.equal(d.priorOutstandingSatang, baht(2200));
  assert.equal(d.priorStudents, 4);
  const d2569 = h.ok('dashboard.summary', { year: 2569 }, t.dir);
  assert.deepEqual(states(d2569.totals), [3, 2, 2, 0, 0], 'A ชำระครบปี 2569 แล้ว');
});

test('รายงานการรับเงินแยกตามชั้นและห้อง: ยอดรวมทุกกลุ่มเท่ากับเงินที่รับจริง และแยกปีของรายการ', () => {
  const { t, h, s } = buildArrearsDataset();
  let r = h.ok('reports.collections', { periodType: 'academic', year: 2569 }, t.fin);
  assert.equal(r.period.from, '2026-05-01');
  assert.equal(r.period.to, '2027-04-30');
  assert.equal(r.period.label, 'ปีการศึกษา 2569');
  assert.deepEqual(r.grades.map((g) => [g.year, g.label, g.students, g.receipts, g.satang / 100]),
    [[2569, 'ป.1', 2, 2, 700], [2569, 'ป.2', 1, 1, 600], [2569, 'ป.6', 2, 2, 1000]]);
  assert.deepEqual(r.grades[0].rooms.map((x) => [x.label, x.satang / 100]), [['ป.1/1', 700]]);
  assert.deepEqual(r.total, { students: 5, receipts: 5, satang: baht(2300), text: 'สองพันสามร้อยบาทถ้วน' });
  assert.equal(r.unallocatedSatang, 0);

  arrearsNextYear(t, h, s); // A จ่าย 800 → 500 เข้าหนี้ปี 2569 ป.1/1 และ 300 เข้าปี 2570 ป.2/1
  r = h.ok('reports.collections', { periodType: 'month', month: '2026-11' }, t.fin);
  assert.equal(r.period.label, 'เดือนพฤศจิกายน 2569');
  assert.deepEqual(r.grades.map((g) => [g.year, g.label, g.satang / 100]),
    [[2570, 'ป.2', 300], [2569, 'ป.1', 1200], [2569, 'ป.2', 600], [2569, 'ป.6', 1000]]);
  assert.equal(r.total.receipts, 6);
  assert.equal(r.total.satang, baht(3100));
  assert.deepEqual(r.years, [2570, 2569]);

  const fiscal = h.ok('reports.collections', { periodType: 'fiscal', fiscalYear: 2570 }, t.fin);
  assert.deepEqual([fiscal.period.from, fiscal.period.to], ['2026-10-01', '2027-09-30']);
  assert.equal(fiscal.total.satang, baht(3100));
  const none = h.ok('reports.collections', { periodType: 'range', fromDate: '2026-11-01', toDate: '2026-11-20' }, t.fin);
  assert.equal(none.total.satang, 0);
  assert.equal(none.period.label, 'ระหว่างวันที่ 1 พฤศจิกายน 2569 ถึง 20 พฤศจิกายน 2569');
  assert.match(h.api('reports.collections', { periodType: 'range', fromDate: '2025-01-01', toDate: '2026-11-21' }, t.fin).error.message, /ไม่เกิน 400 วัน/);
  assert.match(h.api('reports.collections', { periodType: 'month', month: '2026-13' }, t.fin).error.message, /เดือนไม่ถูกต้อง/);
});

test('รายงานสรุปประจำปีการศึกษา: การเรียกเก็บ ลดหย่อน/ยกเว้น รายการ รายเดือน และใบเสร็จ', () => {
  const { t, h } = buildArrearsDataset();
  const r = h.ok('reports.annual', { year: 2569 }, t.dir);
  const o = r.overall;
  assert.deepEqual([o.count, o.students, o.grossSatang, o.adjustSatang, o.netSatang, o.paidSatang, o.outstandingSatang, o.overdueSatang].map((x, i) => (i < 2 ? x : x / 100)),
    [10, 7, 5500, 500, 5000, 2300, 2700, 1200]);
  assert.deepEqual(r.adjustments, { DISCOUNT: { count: 0, satang: 0 }, EXEMPTION: { count: 1, satang: baht(500) } });
  assert.deepEqual(r.items.map((i) => [i.label, i.count, i.netSatang / 100, i.paidSatang / 100, i.outstandingSatang / 100]),
    [['เงินบำรุงการศึกษา ภาคเรียนที่ 1/2569', 7, 3500, 2300, 1200], ['เงินบำรุงการศึกษา ภาคเรียนที่ 2/2569', 3, 1500, 0, 1500]]);
  assert.deepEqual(r.grades.map((g) => [g.gradeLevel, g.students, g.outstandingSatang / 100]), [['ป.1', 4, 2300], ['ป.2', 1, 0], ['ป.6', 2, 400]]);
  assert.equal(r.months.length, 12);
  assert.equal(r.months[0].label, 'พฤษภาคม 2569');
  assert.equal(r.months[11].label, 'เมษายน 2570');
  assert.deepEqual(r.months.filter((m) => m.count).map((m) => [m.month, m.count, m.satang / 100]), [['2026-11', 5, 2300]]);
  assert.deepEqual([r.cash.satang, r.cash.thisYearSatang, r.cash.priorSatang], [baht(2300), baht(2300), 0]);
  assert.deepEqual(r.receipts, { used: 5, voided: 0, spoiled: 0, books: ['1/2569'] });
  assert.equal(r.period.rangeLabel, '1 พฤษภาคม 2569 – 30 เมษายน 2570');
});

test('รายงานการใช้ใบเสร็จประจำปีงบประมาณ: รับเข้า ใช้ ยกเลิก และคงเหลือ', () => {
  const t = setupFinance();
  const { h } = t;
  const a = t.student('10001', 'เอ', 'ป.1');
  t.generate(t.feeOne().feeSettingId);
  const book = t.book('1/2569', 1, 50);
  t.pay(a.studentId, 100);
  t.pay(a.studentId, 100);
  h.ok('receipts.requestCancelNumber', { bookId: book.bookId, receiptNo: 3, reason: 'เขียนผิด', confirmKept: true }, t.fin);
  const req = h.ok('approvals.list', { status: 'PENDING' }, t.dir).rows[0];
  h.ok('approvals.decide', { requestId: req.requestId, decision: 'APPROVE' }, t.dir);
  t.pay(a.studentId, 100);
  const r = h.ok('reports.receiptUsage', {}, t.fin);
  assert.equal(r.fiscalYear, 2570);
  assert.equal(r.period.rangeLabel, '1 ตุลาคม 2569 – 30 กันยายน 2570');
  assert.deepEqual(r.rows.map((x) => [x.bookNo, x.broughtForward, x.received, x.used, x.cancelled, x.pending, x.closedUnused, x.remaining, x.usedFrom, x.usedTo]),
    [['1/2569', 0, 50, 3, 1, 0, 0, 46, 1, 4]]);
  assert.equal(r.total.remaining, 46);
  assert.equal(h.ok('reports.receiptUsage', { fiscalYear: 2569 }, t.fin).rows.length, 0, 'เล่มที่ได้รับหลังปีงบประมาณไม่แสดง');

  const cancelled = h.ok('reports.cancelled', { periodType: 'fiscal', fiscalYear: 2570 }, t.dir);
  assert.deepEqual(cancelled.rows.map((x) => [x.receiptNo, x.cancelType, x.status]), [[3, 'SPOILED', 'APPROVED']]);
  assert.equal(cancelled.rows[0].reason, 'เขียนผิด');
  assert.equal(cancelled.rows[0].decidedBy, 'นายผู้อำนวยการ ทดสอบ');
  assert.deepEqual(cancelled.totals, { voidCount: 0, voidSatang: 0, spoiledCount: 1, pendingCount: 0, notApprovedCount: 0 });
});

test('รายงานใบเสร็จยกเลิก: ยกเลิกใบเสร็จที่รับเงินแล้ว รออนุมัติ และไม่อนุมัติ', () => {
  const { t, h, s } = buildArrearsDataset();
  const payments = h.ok('payments.list', {}, t.fin).rows;
  const ofD = payments.find((p) => p.studentId === s.D.studentId);
  const ofG = payments.find((p) => p.studentId === s.G.studentId);
  h.ok('payments.requestVoid', { paymentId: ofD.paymentId, reason: 'ผู้ปกครองชำระซ้ำ', confirmKept: true }, t.fin);
  h.ok('payments.requestVoid', { paymentId: ofG.paymentId, reason: 'ทดสอบไม่อนุมัติ', confirmKept: true }, t.fin);
  const pending = h.ok('approvals.list', { status: 'PENDING' }, t.dir).rows;
  h.ok('approvals.decide', { requestId: pending.find((r) => r.summary.includes('ดี')).requestId, decision: 'APPROVE' }, t.dir);
  const r = h.ok('reports.cancelled', {}, t.fin);
  assert.deepEqual(r.rows.map((x) => [x.receiptNo, x.status]), [[3, 'APPROVED'], [5, 'PENDING']]);
  assert.equal(r.rows[0].amountSatang, baht(600));
  assert.equal(r.rows[0].studentName, 'เด็กชายดี ทดสอบ');
  assert.equal(r.rows[0].receiptDate, '2026-11-21');
  assert.deepEqual(r.totals, { voidCount: 1, voidSatang: baht(600), spoiledCount: 0, pendingCount: 1, notApprovedCount: 0 });
  h.ok('approvals.decide', { requestId: pending.find((x) => x.summary.includes('จี')).requestId, decision: 'REJECT', note: 'ใบเสร็จถูกต้องแล้ว' }, t.dir);
  assert.equal(h.ok('reports.cancelled', {}, t.fin).totals.notApprovedCount, 1);
});

test('เอกสารแจ้งยอด: เฉพาะนักเรียนที่มียอดค้าง ไม่รวมผู้ย้ายออก เรียงตามห้องและเลขที่ และกรองตามชั้น', () => {
  const { t, h, s } = buildArrearsDataset();
  let r = h.ok('reports.notices', { year: 2569 }, t.fin);
  assert.deepEqual(r.notices.map((n) => [n.firstName, n.classLabel, n.totalSatang / 100]),
    [['เอ', 'ป.1/1', 500], ['บี', 'ป.1/1', 800], ['ซี', 'ป.1/2', 500], ['อี', 'ป.6/1', 400]]);
  assert.equal(r.totalSatang, baht(2200));
  const bNotice = r.notices[1];
  assert.deepEqual(bNotice.items.map((i) => [i.label, i.outstandingSatang / 100, i.overdue]),
    [['เงินบำรุงการศึกษา ภาคเรียนที่ 1/2569 ชั้น ป.1', 300, true], ['เงินบำรุงการศึกษา ภาคเรียนที่ 2/2569 ชั้น ป.1', 500, false]]);
  assert.equal(bNotice.totalText, 'แปดร้อยบาทถ้วน');
  assert.equal(r.meta.school.name, 'โรงเรียนวัดเสาหิน');
  r = h.ok('reports.notices', { year: 2569, gradeLevel: 'ป.1', room: '2' }, t.fin);
  assert.deepEqual(r.notices.map((n) => n.firstName), ['ซี']);
  r = h.ok('reports.notices', { year: 2569, studentId: s.D.studentId }, t.fin);
  assert.equal(r.notices.length, 0, 'ชำระครบแล้วไม่ต้องแจ้ง');

  arrearsNextYear(t, h, s);
  r = h.ok('reports.notices', { year: 2570 }, t.fin);
  // ปี 2570: B ค้างปีก่อน 800 + ปีนี้ 800 เรียงหนี้เก่าก่อน
  const b = r.notices.find((n) => n.firstName === 'บี');
  assert.deepEqual(b.items.map((i) => i.year), [2569, 2569, 2570]);
  assert.equal(b.totalSatang, baht(1600));
  assert.equal(r.notices.find((n) => n.firstName === 'อี'), undefined, 'จบการศึกษาแล้วไม่มีชั้นเรียนปี 2570');
});
