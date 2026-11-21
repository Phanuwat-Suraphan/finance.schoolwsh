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

module.exports = { setupFinance, APPROVAL_REF };
