'use strict';
/**
 * ตัวช่วยสำหรับทดสอบระบบการเงิน (ระยะที่ 4)
 * สร้างระบบที่มีเจ้าหน้าที่การเงิน ผู้อำนวยการ และฟังก์ชันลัดสำหรับตั้งอัตรา เรียกเก็บ เปิดเล่ม และรับเงิน
 */
const { createAppEnv, plain } = require('./harness');

const APPROVAL_REF = 'มติคณะกรรมการสถานศึกษา ครั้งที่ 1/2569 ลงวันที่ 1 พฤษภาคม 2569';

function setupFinance() {
  const h = createAppEnv();
  const admin = h.adminToken();
  const fin = h.addUser(admin, 'FINANCE', 'finance1', { displayName: 'นางสาวการเงิน ทดสอบ' });
  const dir = h.addUser(admin, 'DIRECTOR', 'director1', { displayName: 'นายผู้อำนวยการ ทดสอบ' });
  const t = { h, admin, fin: fin.token, dir: dir.token };
  let keySeq = 0;

  t.student = (studentNo, firstName, gradeLevel, extra) => h.ok('students.create', Object.assign({
    studentNo, prefix: 'เด็กชาย', firstName, lastName: 'ทดสอบ', gradeLevel, room: '1', year: 2569,
  }, extra || {}), t.fin);

  t.fee = (fields) => h.ok('fees.create', Object.assign({
    year: 2569, term: '1', gradeLevels: ['ป.1'], amount: '500', startDate: '2026-05-16', dueDate: '2026-06-30', approvalRef: APPROVAL_REF,
  }, fields || {}), t.fin);
  t.feeOne = (fields) => t.fee(fields)[0];
  t.generate = (feeSettingId) => h.ok('assessments.generate', { feeSettingId }, t.fin);

  t.book = (bookNo, startNo, endNo) => {
    const b = h.ok('receipts.registerBook', { bookNo, startNo, endNo }, t.fin);
    return h.ok('receipts.activateBook', { bookId: b.bookId }, t.fin);
  };

  t.key = () => 'test-request-' + String(++keySeq).padStart(6, '0') + '-0000';
  t.ledger = (studentId) => h.ok('ledger.student', { studentId }, t.fin);
  t.context = (studentId) => h.ok('payments.context', { studentId }, t.fin);

  /** ตัดชำระแบบหนี้เก่าก่อน (เหมือนค่าเริ่มต้นของหน้าเว็บ) */
  t.autoAllocations = (items, amountSatang) => plain(h.gas.autoAllocate_(
    items.map((it) => ({ id: it.assessmentId, outstandingSatang: it.outstandingSatang })), amountSatang,
  )).allocations.map((a) => ({ assessmentId: a.id, amount: (a.satang / 100).toFixed(2) }));

  /** รับเงิน (ส่งคำขอแบบเดียวกับหน้าเว็บ) คืนค่าคำตอบของ api ทั้งก้อน */
  t.payRaw = (studentId, amountBaht, extra) => {
    const ctx = t.context(studentId);
    const amountSatang = Math.round(Number(amountBaht) * 100);
    return h.api('payments.create', Object.assign({
      requestKey: t.key(),
      studentId,
      paymentDate: '2026-11-21',
      amount: String(amountBaht),
      channel: 'เงินสด',
      channelRef: '',
      receivedByName: 'นางสาวการเงิน ทดสอบ',
      note: '',
      bookId: ctx.book ? ctx.book.bookId : '',
      receiptNo: ctx.book ? ctx.book.nextNo : null,
      confirmPhysicalReceipt: true,
      allocations: t.autoAllocations(ctx.items || [], amountSatang),
    }, extra || {}), t.fin);
  };
  t.pay = (studentId, amountBaht, extra) => {
    const res = t.payRaw(studentId, amountBaht, extra);
    if (!res.ok) throw new Error('payments.create ไม่สำเร็จ: ' + JSON.stringify(res.error));
    return res.data;
  };

  t.rows = (sheet) => {
    h.newExecution();
    return plain(h.gas.dbAll_(sheet));
  };
  t.setSetting = (values) => h.ok('settings.update', { values }, t.admin);
  t.yearId = (year) => h.ok('years.list', {}, t.admin).find((y) => y.year === year).academicYearId;
  return t;
}

/**
 * ชุดข้อมูลตัวอย่าง 7 คน ปีการศึกษา 2569 (ใช้ทดสอบยอดค้าง Dashboard และรายงาน; ตัวเลขดูคำอธิบายใน arrears.test.js)
 * วันนี้ = 21 พ.ย. 2569 ทุกการรับเงินลงวันที่ 21 พ.ย. 2569 เล่ม 1/2569 เลขที่ 1–5
 */
function buildArrearsDataset() {
  const t = setupFinance();
  const { h } = t;
  const s = {
    A: t.student('10001', 'เอ', 'ป.1', { classNo: 1 }),
    B: t.student('10002', 'บี', 'ป.1', { classNo: 2 }),
    C: t.student('10003', 'ซี', 'ป.1', { room: '2', classNo: 1 }),
    F: t.student('10006', 'เอฟ', 'ป.1', { room: '2', classNo: 2 }),
    D: t.student('10004', 'ดี', 'ป.2'),
    E: t.student('10005', 'อี', 'ป.6', { classNo: 1 }),
    G: t.student('10007', 'จี', 'ป.6', { classNo: 2 }),
  };
  t.generate(t.feeOne({ gradeLevels: ['ป.1'], term: '1', amount: '500', dueDate: '2026-06-30' }).feeSettingId);
  t.generate(t.feeOne({ gradeLevels: ['ป.2'], term: '1', amount: '600', dueDate: '2026-06-30' }).feeSettingId);
  t.generate(t.feeOne({ gradeLevels: ['ป.6'], term: '1', amount: '700', dueDate: '2026-06-30' }).feeSettingId);
  h.ok('students.setStatus', { studentId: s.F.studentId, status: 'TRANSFERRED', statusDate: '2026-08-15', note: 'ย้ายตามผู้ปกครอง', year: 2569 }, t.fin);
  t.generate(t.feeOne({ gradeLevels: ['ป.1'], term: '2', amount: '500', dueDate: '2026-12-31' }).feeSettingId);
  t.book('1/2569', 1, 100);
  t.pay(s.A.studentId, 500);
  t.pay(s.B.studentId, 200);
  t.pay(s.D.studentId, 600);
  t.pay(s.E.studentId, 300);
  t.pay(s.G.studentId, 700);
  const cTerm1 = t.ledger(s.C.studentId).assessments.find((a) => a.term === '1');
  const req = h.ok('adjustments.request', { assessmentId: cTerm1.assessmentId, type: 'EXEMPTION', reason: 'ทุนการศึกษา', referenceDoc: 'ประกาศ 1/2569' }, t.fin);
  h.ok('approvals.decide', { requestId: req.requestId, decision: 'APPROVE' }, t.dir);
  return { t, h, s };
}

/** ขึ้นปีการศึกษา 2570 และ A จ่าย 800 (ตัดหนี้ปี 2569 500 ก่อน แล้ว 300 เข้าปี 2570) */
function arrearsNextYear(t, h, s) {
  h.ok('years.create', { year: 2570 }, t.admin);
  h.ok('students.promoteCommit', { fromYear: 2569, toYear: 2570, graduationDate: '2027-03-31' }, t.fin);
  t.generate(t.feeOne({ year: 2570, gradeLevels: ['ป.2'], term: '1', amount: '800', startDate: '2027-05-16', dueDate: '2027-06-30' }).feeSettingId);
  t.generate(t.feeOne({ year: 2570, gradeLevels: ['ป.3'], term: '1', amount: '900', startDate: '2027-05-16', dueDate: '2027-06-30' }).feeSettingId);
  const r = t.pay(s.A.studentId, 800);
  return r;
}

module.exports = { setupFinance, buildArrearsDataset, arrearsNextYear, APPROVAL_REF };
