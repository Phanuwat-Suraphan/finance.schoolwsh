'use strict';
/**
 * ทดสอบทะเบียนคุมใบเสร็จเต็มรูปแบบ (ระยะที่ 5)
 * ครอบคลุมข้อกำหนด 10 ข้อในเอกสารสถาปัตยกรรม หัวข้อ 6.4:
 *  1 เลขที่ถัดไป  2 ไม่ซ้ำ  3 ใช้ครบแล้วหยุด  4 เปลี่ยนเล่มเมื่อลงทะเบียนแล้ว  5 ไม่ออกเลขเอง
 *  6 ยืนยันใบเสร็จจริง  7 เลขที่ยกเลิกเก็บประวัติ ห้ามใช้ซ้ำ  8 แสดงสถานะทุกเลข  9 เตือนเลขขาดช่วง  10 กันเลขซ้ำเมื่อบันทึกพร้อมกัน
 * (ข้อ 1–6 และ 10 มีทดสอบเพิ่มเติมใน payments.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupFinance } = require('./finance-helpers');

function ready(bookEnd) {
  const t = setupFinance();
  const a = t.student('10001', 'หนึ่ง', 'ป.1');
  const fee = t.feeOne();
  t.generate(fee.feeSettingId);
  const book = t.book('1/2569', 1, bookEnd || 50);
  return { t, h: t.h, a, fee, book };
}

function cancelNumber(t, book, receiptNo, extra) {
  return t.h.api('receipts.requestCancelNumber', Object.assign({
    bookId: book.bookId, receiptNo, reason: 'เขียนจำนวนเงินผิด', confirmKept: true,
  }, extra || {}), t.fin);
}

function grid(t, book) {
  const res = t.h.ok('receipts.book', { bookId: book.bookId }, t.dir);
  const map = {};
  res.numbers.forEach((n) => { map[n.no] = n.status; });
  return { res, map };
}

function pending(t) {
  return t.h.ok('approvals.list', {}, t.dir).rows;
}

function decide(t, row, decision, note) {
  return t.h.ok('approvals.decide', { requestId: row.requestId, decision, note }, t.dir);
}

test('ยกเลิกเลขที่ที่เขียนผิด: กันเลขที่ไว้ทันทีระหว่างรออนุมัติ เลขที่ถัดไปเลื่อนไป และเก็บประวัติ (ข้อ 7, 8)', () => {
  const { t, h, a, book } = ready();
  assert.match(cancelNumber(t, book, 1, { reason: '' }).error.message, /กรุณากรอกเหตุผลการยกเลิก/);
  assert.match(cancelNumber(t, book, 1, { confirmKept: false }).error.message, /เก็บใบเสร็จฉบับที่ยกเลิกไว้ครบทุกส่วนแล้ว/);
  assert.match(cancelNumber(t, book, 51).error.message, /ไม่อยู่ในเล่มที่ 1\/2569/);

  const res = cancelNumber(t, book, 1).data;
  assert.equal(res.applied, false);
  assert.match(res.message, /กันเลขที่ 1 ไว้แล้ว/);
  assert.equal(t.context(a.studentId).book.nextNo, 2, 'ระหว่างรออนุมัติ เลขที่ 1 ถูกกันไว้');
  assert.equal(t.pay(a.studentId, 100).payment.receiptNo, 2);
  assert.deepEqual([1, 2, 3].map((n) => grid(t, book).map[n]), ['CANCEL_PENDING', 'USED', 'UNUSED']);
  assert.equal(cancelNumber(t, book, 2).error.reason, 'RECEIPT_NO_TAKEN', 'ใบเสร็จที่บันทึกรับเงินแล้วต้องใช้ "ยกเลิกใบเสร็จ"');

  const req = pending(t)[0];
  assert.equal(req.type, 'RECEIPT_CANCEL');
  assert.match(req.summary, /ยกเลิกเลขที่ใบเสร็จ เล่มที่ 1\/2569 เลขที่ 1/);
  decide(t, req, 'APPROVE');
  const after = grid(t, book);
  assert.equal(after.map[1], 'CANCELLED');
  const item = after.res.numbers[0];
  assert.equal(item.cancelReason, 'เขียนจำนวนเงินผิด');
  assert.equal(item.cancelType, 'SPOILED');
  assert.equal(item.decidedBy, 'director1');
  const c = t.rows('ReceiptCancellations')[0];
  assert.equal(c.Status, 'APPROVED');
  assert.equal(c.ApprovalRequestId, req.requestId);
  assert.equal(t.rows('ReceiptEntries').find((e) => e.ReceiptNo === 1).Status, 'CANCELLED');
  assert.equal(cancelNumber(t, book, 1).error.reason, 'RECEIPT_NO_TAKEN', 'เลขที่ยกเลิกแล้วใช้หรือยกเลิกซ้ำไม่ได้');
  assert.ok(h.auditRows().some((r) => r.Entity === 'ReceiptEntries' && r.Action === 'CANCEL'));
});

test('ไม่อนุมัติหรือถอนคำขอยกเลิกเลขที่: คืนเลขที่ และกลับมาเป็นเลขที่ถัดไป (แถวเดิมเก็บไว้)', () => {
  const { t, h, a, book } = ready();
  cancelNumber(t, book, 1);
  decide(t, pending(t)[0], 'REJECT', 'ใบเสร็จยังใช้ได้');
  assert.equal(t.context(a.studentId).book.nextNo, 1);
  assert.equal(grid(t, book).map[1], 'UNUSED');
  assert.equal(t.rows('ReceiptCancellations')[0].Status, 'REJECTED');

  const again = cancelNumber(t, book, 1).data;
  h.ok('approvals.withdraw', { requestId: again.requestId }, t.fin);
  assert.equal(t.context(a.studentId).book.nextNo, 1);
  assert.deepEqual([...t.rows('ReceiptEntries').map((e) => e.Status)], ['RELEASED', 'RELEASED']);
  assert.equal(t.rows('ReceiptCancellations')[1].Status, 'WITHDRAWN');

  assert.equal(t.pay(a.studentId, 100).payment.receiptNo, 1, 'เลขที่ที่คืนแล้วนำมาใช้ได้');
  assert.equal(t.rows('ReceiptEntries').length, 3);
});

test('ไม่ต้องอนุมัติตามการตั้งค่า: ยกเลิกเลขที่มีผลทันที และเลขที่ขาดช่วงหายไป (ข้อ 9)', () => {
  const { t, h, a, book } = ready();
  t.setSetting({ APPROVAL_RECEIPT_CANCEL: 'FALSE', RECEIPT_STRICT_SEQUENCE: 'FALSE' });
  t.pay(a.studentId, 100, { receiptNo: 3, confirmSkipNumber: true });
  const books = () => h.ok('receipts.books', {}, t.fin).books[0];
  assert.deepEqual([...books().gaps], [1, 2]);
  assert.deepEqual([1, 2].map((n) => grid(t, book).map[n]), ['GAP', 'GAP']);
  assert.equal(cancelNumber(t, book, 1).data.applied, true);
  assert.deepEqual([...books().gaps], [2]);
  cancelNumber(t, book, 2);
  assert.deepEqual([...books().gaps], []);
  assert.equal(books().cancelledCount, 2);
  assert.equal(t.rows('ApprovalRequests').length, 0);
  assert.equal(t.rows('ReceiptCancellations')[0].DecisionNote, 'ไม่ต้องอนุมัติตามการตั้งค่า');
});

test('ยกเลิกใบเสร็จที่บันทึกรับเงินแล้ว: ระหว่างรอ การรับเงินยังมีผล อนุมัติแล้วยอดค้างกลับมา', () => {
  const { t, h, a, book } = ready();
  const paid = t.pay(a.studentId, 300).payment;
  const voidReq = (extra) => h.api('payments.requestVoid', Object.assign({
    paymentId: paid.paymentId, reason: 'เขียนชื่อนักเรียนผิดทั้งฉบับ', confirmKept: true,
  }, extra || {}), t.fin);
  assert.match(voidReq({ confirmKept: false }).error.message, /เก็บใบเสร็จฉบับที่ยกเลิกไว้ครบทุกส่วนแล้ว/);
  assert.match(voidReq({ reason: '' }).error.message, /กรุณากรอกเหตุผลการยกเลิกใบเสร็จ/);
  const sent = voidReq().data;
  assert.equal(sent.applied, false);
  const during = t.ledger(a.studentId);
  assert.equal(during.totals.paidSatang, 30000, 'ระหว่างรออนุมัติ การรับเงินเดิมยังมีผล');
  assert.equal(during.payments[0].pendingRequest.type, 'RECEIPT_CANCEL');
  assert.equal(grid(t, book).map[1], 'CANCEL_PENDING');
  assert.equal(h.api('payments.requestCorrection', { paymentId: paid.paymentId, reason: 'x' }, t.fin).error.reason, 'PENDING_REQUEST');

  decide(t, pending(t)[0], 'APPROVE');
  const after = t.ledger(a.studentId);
  assert.equal(after.totals.paidSatang, 0);
  assert.equal(after.totals.outstandingSatang, 50000);
  assert.equal(after.assessments[0].state, 'UNPAID');
  assert.equal(after.payments[0].status, 'VOIDED');
  assert.equal(after.payments[0].voidReason, 'เขียนชื่อนักเรียนผิดทั้งฉบับ');
  assert.equal(after.payments[0].voidedBy, 'นายผู้อำนวยการ ทดสอบ');
  assert.deepEqual([...t.rows('PaymentAllocations').map((x) => x.Status)], ['VOIDED']);
  assert.equal(grid(t, book).map[1], 'CANCELLED');
  assert.equal(t.context(a.studentId).book.nextNo, 2, 'เลขที่ที่ยกเลิกแล้วไม่กลับมาใช้');
  const list = h.ok('payments.list', {}, t.dir);
  assert.equal(list.rows[0].status, 'VOIDED');
  assert.equal(list.totals.count, 0, 'ยอดรวมไม่นับใบเสร็จที่ยกเลิก');
});

test('ไม่อนุมัติการยกเลิกใบเสร็จ: ใบเสร็จกลับเป็นใช้แล้ว และยอดชำระไม่เปลี่ยน', () => {
  const { t, h, a, book } = ready();
  const paid = t.pay(a.studentId, 300).payment;
  h.ok('payments.requestVoid', { paymentId: paid.paymentId, reason: 'ผู้ปกครองขอคืนเงิน', confirmKept: true }, t.fin);
  decide(t, pending(t)[0], 'REJECT', 'การคืนเงินต้องทำตามระเบียบนอกระบบ');
  assert.equal(grid(t, book).map[1], 'USED');
  assert.equal(t.ledger(a.studentId).totals.paidSatang, 30000);
  assert.equal(t.rows('Payments')[0].Status, 'ACTIVE');
  assert.equal(t.rows('ReceiptCancellations')[0].Status, 'REJECTED');
});

function correction(t, paymentId, fields) {
  return t.h.api('payments.requestCorrection', Object.assign({
    paymentId, paymentDate: '2026-11-21', amount: '300', channel: 'เงินสด', channelRef: '', receivedByName: 'นางสาวการเงิน ทดสอบ', note: '',
    reason: 'พิมพ์จำนวนเงินผิด ใบเสร็จจริงเขียนถูกต้อง',
  }, fields || {}), t.fin);
}

test('แก้ไขรายการที่บันทึกผิด: ใช้เลขที่ใบเสร็จเดิม รายการเดิมถูกแทน และทะเบียนคุมชี้รายการใหม่ (D-14)', () => {
  const { t, h, a, book } = ready();
  const paid = t.pay(a.studentId, 300).payment;
  const asm = paid.allocations[0].assessmentId;
  assert.match(correction(t, paid.paymentId, { allocations: [{ assessmentId: asm, amount: '300' }] }).error.message, /เหมือนรายการเดิมทุกช่อง/);
  assert.equal(correction(t, paid.paymentId, { amount: '600', allocations: [{ assessmentId: asm, amount: '600' }] }).error.reason, 'BALANCE_CHANGED');

  const ctx = h.ok('payments.get', { paymentId: paid.paymentId }, t.fin);
  assert.equal(ctx.items[0].outstandingSatang, 50000, 'ยอดที่แก้ได้คิดแบบไม่นับรายการเดิม');
  assert.equal(ctx.items[0].allocatedSatang, 30000);
  assert.equal(ctx.canRequest, true);

  const sent = correction(t, paid.paymentId, {
    amount: '350', channel: 'โอนเงินเข้าบัญชีโรงเรียน', channelRef: 'KTB-1', allocations: [{ assessmentId: asm, amount: '350' }],
  }).data;
  assert.equal(sent.applied, false);
  const req = pending(t)[0];
  assert.equal(req.type, 'PAYMENT_CORRECTION');
  const changed = req.details.filter((d) => d.changed).map((d) => d.label);
  assert.deepEqual([...changed], ['จำนวนเงิน', 'ช่องทาง', 'รายการที่ตัดชำระ']);
  assert.equal(req.details.find((d) => d.label === 'จำนวนเงิน').after, '350.00 บาท');
  assert.equal(t.ledger(a.studentId).totals.paidSatang, 30000, 'ระหว่างรออนุมัติ รายการเดิมยังมีผล');

  decide(t, req, 'APPROVE');
  const payments = t.rows('Payments');
  const old = payments.find((p) => p.PaymentId === paid.paymentId);
  const neu = payments.find((p) => p.PaymentId !== paid.paymentId);
  assert.equal(old.Status, 'REPLACED');
  assert.equal(old.ReplacedByPaymentId, neu.PaymentId);
  assert.equal(neu.ReplacesPaymentId, old.PaymentId);
  assert.equal(neu.Status, 'ACTIVE');
  assert.equal(neu.ReceiptNo, 1);
  assert.equal(neu.Amount, 350);
  assert.equal(neu.ApprovalRequestId, req.requestId);
  const entries = t.rows('ReceiptEntries');
  assert.equal(entries.length, 1, 'เลขที่ใบเสร็จเดิม ไม่ใช้เลขใหม่');
  assert.equal(entries[0].PaymentId, neu.PaymentId);
  assert.equal(entries[0].Amount, 350);
  assert.equal(entries[0].Status, 'USED');
  assert.equal(t.ledger(a.studentId).totals.paidSatang, 35000);
  assert.equal(grid(t, book).res.numbers[0].corrected, true);
  assert.equal(t.context(a.studentId).book.nextNo, 2);
});

test('แก้ไขรายการที่บันทึกผิดคน: ย้ายการรับเงินไปให้นักเรียนที่ถูกต้อง โดยใช้เลขที่ใบเสร็จเดิม', () => {
  const { t, h, a, fee } = ready();
  const b = t.student('10002', 'สอง', 'ป.1');
  t.generate(fee.feeSettingId);
  const paid = t.pay(a.studentId, 500).payment;
  const ctx = h.ok('payments.get', { paymentId: paid.paymentId, studentId: b.studentId }, t.fin);
  assert.equal(ctx.student.studentId, b.studentId);
  assert.equal(ctx.items.length, 1);
  assert.equal(ctx.items[0].allocatedSatang, 0);
  correction(t, paid.paymentId, { studentId: b.studentId, amount: '500', allocations: [{ assessmentId: ctx.items[0].assessmentId, amount: '500' }] });
  decide(t, pending(t)[0], 'APPROVE');
  assert.equal(t.ledger(a.studentId).totals.outstandingSatang, 50000);
  assert.equal(t.ledger(b.studentId).totals.outstandingSatang, 0);
  assert.equal(t.ledger(b.studentId).payments[0].receiptNo, 1);
  assert.equal(t.rows('ReceiptEntries')[0].StudentId, b.studentId);
});

test('ตรวจยอดใหม่ตอนอนุมัติการแก้ไข: ถ้ายอดเปลี่ยนไประหว่างรอ อนุมัติไม่ได้และคำขอยังรออยู่', () => {
  const { t, a } = ready();
  const first = t.pay(a.studentId, 300).payment;
  const asm = first.allocations[0].assessmentId;
  correction(t, first.paymentId, { amount: '500', allocations: [{ assessmentId: asm, amount: '500' }] });
  t.pay(a.studentId, 200);
  const res = t.h.api('approvals.decide', { requestId: pending(t)[0].requestId, decision: 'APPROVE' }, t.dir);
  assert.equal(res.error.reason, 'BALANCE_CHANGED');
  assert.equal(pending(t)[0].status, 'PENDING');
  assert.equal(t.rows('Payments').filter((p) => p.Status === 'ACTIVE').length, 2);
});

test('ปิดเล่มก่อนใช้ครบ: ต้องอนุมัติ เลขที่ที่เหลือใช้ไม่ได้อีก และเปิดเล่มใหม่ได้ (ข้อ 4, 7)', () => {
  const { t, h, a, book } = ready();
  t.pay(a.studentId, 100);
  const next = h.ok('receipts.registerBook', { bookNo: '2/2569', startNo: 51, endNo: 100 }, t.fin);
  const close = (b, extra) => h.api('receipts.requestCloseBook', Object.assign({ bookId: b.bookId, reason: 'เล่มเปียกน้ำ ใช้ต่อไม่ได้' }, extra || {}), t.fin);
  assert.match(close(book, { reason: '' }).error.message, /กรุณากรอกเหตุผลการปิดเล่ม/);
  cancelNumber(t, book, 2);
  assert.match(close(book).error.message, /มีคำขอยกเลิกเลขที่ที่รออนุมัติ 1 รายการ/);
  decide(t, pending(t)[0], 'APPROVE');

  assert.equal(close(book).data.applied, false);
  assert.equal(close(book).error.reason, 'PENDING_REQUEST');
  assert.match(h.api('receipts.activateBook', { bookId: next.bookId }, t.fin).error.message, /ยังใช้ไม่ครบ/);
  decide(t, pending(t).find((r) => r.type === 'BOOK_CLOSE'), 'APPROVE');
  const closed = h.ok('receipts.books', {}, t.fin).books.find((b) => b.bookId === book.bookId);
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.closeReason, 'เล่มเปียกน้ำ ใช้ต่อไม่ได้');
  assert.equal(closed.closedUnused, 48);
  assert.equal(closed.nextNo, null);
  const g = grid(t, book);
  assert.deepEqual([1, 2, 3, 50].map((n) => g.map[n]), ['USED', 'CANCELLED', 'CLOSED_UNUSED', 'CLOSED_UNUSED']);
  assert.equal(t.context(a.studentId).book, null);
  h.ok('receipts.activateBook', { bookId: next.bookId }, t.fin);
  assert.equal(t.pay(a.studentId, 100).payment.receiptNo, 51);

  const spare = h.ok('receipts.registerBook', { bookNo: '3/2569', startNo: 101, endNo: 150 }, t.fin);
  t.setSetting({ APPROVAL_BOOK_CLOSE: 'FALSE' });
  assert.equal(close(spare).data.applied, true, 'ปิดเล่มที่ยังไม่เริ่มใช้ได้ (เช่น เล่มชำรุด)');
  assert.match(close(spare).error.message, /ปิดได้เฉพาะเล่มที่กำลังใช้หรือยังไม่เริ่มใช้/);
});

test('ใช้ครบเล่ม: เปลี่ยนเป็นใช้ครบเฉพาะเมื่อไม่มีคำขอยกเลิกค้าง (ข้อ 3)', () => {
  const { t, h, a, book } = ready(2);
  t.pay(a.studentId, 100);
  cancelNumber(t, book, 2);
  const active = h.ok('receipts.books', {}, t.fin).books[0];
  assert.equal(active.status, 'ACTIVE', 'ยังมีคำขอยกเลิกค้าง จึงยังไม่ปิดเป็นใช้ครบ');
  assert.equal(active.nextNo, null);
  assert.equal(active.remaining, 0);
  assert.equal(t.context(a.studentId).book.nextNo, null);
  decide(t, pending(t)[0], 'APPROVE');
  assert.equal(h.ok('receipts.books', {}, t.fin).books[0].status, 'FULL');
});

test('สองคนบันทึกเลขที่เดียวกันพร้อมกัน: คนที่บันทึกทีหลังถูกปฏิเสธ พร้อมเลขที่ถัดไปใหม่ (ข้อ 2, 10)', () => {
  const { t, h, a } = ready();
  const b = t.student('10002', 'สอง', 'ป.1');
  t.generate(t.rows('FeeSettings')[0].FeeSettingId);
  const fin2 = h.addUser(t.admin, 'FINANCE', 'finance2').token;
  const ctxA = t.context(a.studentId);
  const ctxB = h.ok('payments.context', { studentId: b.studentId }, fin2);
  assert.equal(ctxA.book.nextNo, 1);
  assert.equal(ctxB.book.nextNo, 1);
  const send = (ctx, studentId, token, key) => h.api('payments.create', {
    requestKey: key, studentId, paymentDate: '2026-11-21', amount: '100', channel: 'เงินสด', receivedByName: 'ผู้รับเงิน',
    bookId: ctx.book.bookId, receiptNo: ctx.book.nextNo, confirmPhysicalReceipt: true,
    allocations: [{ assessmentId: ctx.items[0].assessmentId, amount: '100' }],
  }, token);
  assert.equal(send(ctxA, a.studentId, t.fin, 'concurrent-request-a-0001').ok, true);
  const late = send(ctxB, b.studentId, fin2, 'concurrent-request-b-0001');
  assert.equal(late.error.reason, 'RECEIPT_NO_TAKEN');
  assert.match(late.error.message, /เลขที่ถัดไปคือ 2/);
  assert.equal(t.rows('ReceiptEntries').length, 1);
  h.env.lockContended = true;
  assert.equal(send(ctxB, b.studentId, fin2, 'concurrent-request-b-0002').error.code, 'LOCK_TIMEOUT', 'รอ lock ไม่ทัน ระบบไม่บันทึก');
  h.env.lockContended = false;
  assert.equal(t.rows('ReceiptEntries').length, 1);
});
