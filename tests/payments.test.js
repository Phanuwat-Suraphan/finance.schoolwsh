'use strict';
/** ทดสอบเล่มใบเสร็จ (ส่วนแกน) และการรับชำระเงิน (ระยะที่ 4) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupFinance } = require('./finance-helpers');

/** นักเรียน 1 คน อัตรา 500 บาท และเล่มใบเสร็จที่เปิดใช้แล้ว */
function ready(bookEnd) {
  const t = setupFinance();
  const a = t.student('10001', 'หนึ่ง', 'ป.1');
  const fee = t.feeOne();
  t.generate(fee.feeSettingId);
  const book = t.book('1/2569', 1, bookEnd || 50);
  return { t, h: t.h, a, fee, book };
}

test('เล่มใบเสร็จ: เลขเล่มไม่ซ้ำ ช่วงเลขที่ถูกต้อง และเปิดใช้ได้ครั้งละ 1 เล่ม', () => {
  const t = setupFinance();
  const { h } = t;
  const b1 = h.ok('receipts.registerBook', { bookNo: 'ล.1', startNo: 1, endNo: 50, receivedDate: '2026-05-01' }, t.fin);
  assert.equal(b1.status, 'REGISTERED');
  assert.equal(b1.remaining, 50);
  const reg = (fields) => h.api('receipts.registerBook', Object.assign({ bookNo: 'ล.9', startNo: 1, endNo: 50 }, fields), t.fin);
  assert.equal(reg({ bookNo: ' ล.1 ' }).error.code, 'CONFLICT', 'เลขเล่มซ้ำ (ไม่สนช่องว่างหัวท้าย)');
  assert.match(reg({ startNo: 50, endNo: 1 }).error.message, /เลขที่สิ้นสุดต้องไม่น้อยกว่าเลขที่เริ่มต้น/);
  assert.match(reg({ endNo: 1001 }).error.message, /ไม่เกิน 1000 เลขที่/);
  assert.match(reg({ receivedDate: '2026-12-01' }).error.message, /ต้องไม่เป็นวันในอนาคต/);
  assert.match(reg({ startNo: '1.5' }).error.message, /จำนวนเต็ม/);

  const b2 = h.ok('receipts.registerBook', { bookNo: 'ล.2', startNo: 51, endNo: 100 }, t.fin);
  const active = h.ok('receipts.activateBook', { bookId: b1.bookId }, t.fin);
  assert.equal(active.status, 'ACTIVE');
  assert.equal(active.responsibleName, 'นางสาวการเงิน ทดสอบ');
  assert.equal(active.startUseDate, '2026-11-21');
  assert.equal(active.nextNo, 1);
  assert.match(h.api('receipts.activateBook', { bookId: b2.bookId }, t.fin).error.message, /เล่มที่ ล\.1 ยังใช้ไม่ครบ/);
  assert.match(h.api('receipts.activateBook', { bookId: b1.bookId }, t.fin).error.message, /เปิดใช้ได้เฉพาะเล่มที่ลงทะเบียนแล้ว/);
  assert.match(h.api('receipts.updateBook', { bookId: b1.bookId, bookNo: 'ล.1', startNo: 1, endNo: 60 }, t.fin).error.message, /แก้ไขได้เฉพาะเล่มที่ยังไม่เริ่มใช้/);
  assert.equal(h.ok('receipts.updateBook', { bookId: b2.bookId, bookNo: 'ล.2', startNo: 51, endNo: 90 }, t.fin).endNo, 90);

  const list = h.ok('receipts.books', {}, t.dir);
  assert.deepEqual(list.books.map((b) => b.bookNo + ':' + b.status), ['ล.1:ACTIVE', 'ล.2:REGISTERED']);
  assert.equal(list.hasActive, true);
  assert.equal(list.strict, true);
  assert.equal(list.canManage, false, 'ผู้อำนวยการดูได้อย่างเดียว');
});

test('รับเงินบางส่วนแล้วครบ: สถานะเปลี่ยนตามยอด เลขที่ใบเสร็จเดินต่อ และข้อมูลทุกชีตอ้างอิงกันครบ', () => {
  const { t, h, a } = ready();
  const ctx = t.context(a.studentId);
  assert.equal(ctx.book.nextNo, 1);
  assert.equal(ctx.items.length, 1);
  assert.equal(ctx.outstandingSatang, 50000);
  assert.equal(ctx.receivedByName, 'นางสาวการเงิน ทดสอบ');
  assert.deepEqual(ctx.channels, ['เงินสด', 'โอนเงินเข้าบัญชีโรงเรียน']);

  const r1 = t.pay(a.studentId, 200);
  assert.equal(r1.duplicate, false);
  assert.equal(r1.payment.receiptNo, 1);
  assert.equal(r1.payment.amountSatang, 20000);
  assert.equal(r1.assessments[0].state, 'PARTIAL');
  assert.equal(r1.assessments[0].stateLabel, 'ชำระบางส่วน');
  assert.equal(r1.outstandingSatang, 30000);
  assert.equal(r1.book.nextNo, 2);
  assert.deepEqual(r1.warnings, []);

  const r2 = t.pay(a.studentId, 300);
  assert.equal(r2.payment.receiptNo, 2);
  assert.equal(r2.assessments[0].state, 'PAID');
  assert.equal(r2.outstandingSatang, 0);

  const ledger = t.ledger(a.studentId);
  assert.equal(ledger.totals.paidSatang, 50000);
  assert.equal(ledger.totals.outstandingSatang, 0);
  assert.deepEqual(ledger.payments.map((p) => p.receiptNo), [2, 1], 'ล่าสุดก่อน');
  assert.equal(ledger.payments[0].allocations[0].label, 'เงินบำรุงการศึกษา ภาคเรียนที่ 1/2569 ชั้น ป.1');

  const entries = t.rows('ReceiptEntries');
  const payments = t.rows('Payments');
  const allocations = t.rows('PaymentAllocations');
  assert.equal(entries.length, 2);
  assert.equal(payments.length, 2);
  assert.equal(allocations.length, 2);
  payments.forEach((p) => {
    const entry = entries.find((e) => e.EntryId === p.ReceiptEntryId);
    assert.ok(entry, 'การรับเงินอ้างถึงรายการในทะเบียนคุม');
    assert.equal(entry.PaymentId, p.PaymentId, 'ทะเบียนคุมอ้างกลับมาที่การรับเงิน');
    assert.equal(entry.Status, 'USED');
    assert.equal(entry.ReceiptNo, p.ReceiptNo);
    assert.equal(entry.Amount, p.Amount);
  });
  assert.match(h.api('payments.create', {
    requestKey: t.key(), studentId: a.studentId, paymentDate: '2026-11-21', amount: '1', channel: 'เงินสด', receivedByName: 'ก',
    bookId: r2.book.bookId, receiptNo: 3, confirmPhysicalReceipt: true,
    allocations: [{ assessmentId: r2.assessments[0].assessmentId, amount: '1' }],
  }, t.fin).error.message, /เกินยอดคงเหลือ .* ระบบไม่รับเงินเกินยอดค้าง/);
});

test('ตัดชำระหลายรายการในใบเสร็จเดียว: ค่าเริ่มต้นหนี้เก่าก่อน และเลือกตัดเองได้', () => {
  const t = setupFinance();
  const a = t.student('10001', 'หนึ่ง', 'ป.1');
  t.generate(t.feeOne({ term: '2', dueDate: '2026-12-31' }).feeSettingId);
  t.generate(t.feeOne({ term: '1', dueDate: '2026-06-30' }).feeSettingId);
  t.book('1/2569', 1, 50);
  const items = t.context(a.studentId).items;
  assert.deepEqual(items.map((i) => i.term), ['1', '2'], 'ครบกำหนดก่อนอยู่ก่อน');
  assert.equal(items[0].overdue, true, 'เลยวันครบกำหนดแล้ว');
  assert.equal(items[1].overdue, false);

  const r = t.pay(a.studentId, 700);
  assert.deepEqual(r.assessments.map((x) => x.term + ':' + x.state), ['1:PAID', '2:PARTIAL']);
  assert.equal(r.payment.allocations.length, 2);
  assert.equal(r.outstandingSatang, 30000);

  const left = t.context(a.studentId).items;
  const custom = t.pay(a.studentId, 100, { allocations: [{ assessmentId: left[0].assessmentId, amount: '100.00' }] });
  assert.equal(custom.outstandingSatang, 20000);
});

test('Server ตรวจข้อมูลการรับเงินทุกครั้ง และไม่บันทึกอะไรเลยเมื่อข้อมูลไม่ถูกต้อง', () => {
  const { t, a } = ready();
  const b = t.student('10002', 'สอง', 'ป.1');
  t.generate(t.rows('FeeSettings')[0].FeeSettingId);
  const other = t.context(b.studentId).items[0].assessmentId;
  const mine = t.context(a.studentId).items[0].assessmentId;
  const err = (amount, extra) => t.payRaw(a.studentId, amount, extra).error;

  assert.match(err(100, { confirmPhysicalReceipt: false }).message, /ติ๊กยืนยันว่าได้ตรวจสอบใบเสร็จรับเงินฉบับจริงแล้ว/);
  assert.match(err(300, { allocations: [{ assessmentId: mine, amount: '200' }] }).message, /ยอดตัดชำระรวม 200\.00 บาท ไม่เท่ากับจำนวนเงินที่รับ 300\.00 บาท/);
  assert.equal(err(600, { allocations: [{ assessmentId: mine, amount: '600' }] }).reason, 'BALANCE_CHANGED');
  assert.match(err(100, { allocations: [{ assessmentId: other, amount: '100' }] }).message, /ไม่ใช่ของนักเรียนคนนี้/);
  assert.match(err(200, { allocations: [{ assessmentId: mine, amount: '100' }, { assessmentId: mine, amount: '100' }] }).message, /ซ้ำกัน/);
  assert.match(err(100, { allocations: [] }).message, /กรุณาระบุรายการที่ตัดชำระ/);
  assert.match(err(100, { paymentDate: '2026-11-22' }).message, /ต้องไม่เป็นวันในอนาคต/);
  assert.match(err(100, { paymentDate: '2026-02-30' }).message, /วันที่รับเงินไม่ถูกต้อง/);
  assert.match(err(100, { channel: 'โอนเงินเข้าบัญชีโรงเรียน' }).message, /กรุณากรอกเลขอ้างอิงการโอน/);
  assert.match(err(100, { channel: 'บัตรเครดิต' }).message, /ไม่อยู่ในรายการที่ตั้งค่าไว้/);
  assert.match(err(100, { receivedByName: '' }).message, /กรุณากรอกชื่อผู้รับเงิน/);
  assert.match(err(100, { requestKey: 'สั้น' }).message, /รหัสคำขอไม่ถูกต้อง/);
  assert.equal(t.rows('ReceiptEntries').length, 0, 'ไม่มีการใช้เลขที่ใบเสร็จ');
  assert.equal(t.rows('Payments').length, 0);
  assert.equal(t.rows('PaymentAllocations').length, 0);

  const transfer = t.pay(a.studentId, 100, { channel: 'โอนเงินเข้าบัญชีโรงเรียน', channelRef: 'KTB-20261121-001' });
  assert.equal(transfer.payment.channelRef, 'KTB-20261121-001');
});

test('เลขที่ใบเสร็จ: ใช้ซ้ำไม่ได้ ต้องเรียงลำดับ อยู่ในช่วงของเล่ม และใช้เล่มที่กำลังใช้เท่านั้น', () => {
  const { t, h, a } = ready();
  assert.equal(t.payRaw(a.studentId, 100, { receiptNo: 3 }).error.reason, 'RECEIPT_STRICT');
  assert.match(t.payRaw(a.studentId, 100, { receiptNo: 51 }).error.message, /ไม่อยู่ในเล่มที่ 1\/2569 \(เลขที่ 1–50\)/);
  t.pay(a.studentId, 100);
  const stale = t.payRaw(a.studentId, 100, { receiptNo: 1 });
  assert.equal(stale.error.reason, 'RECEIPT_NO_TAKEN');
  assert.match(stale.error.message, /เลขที่ใบเสร็จ 1 ของเล่มที่ 1\/2569 ถูกบันทึกแล้ว ใช้ซ้ำไม่ได้ เลขที่ถัดไปคือ 2/);
  const other = h.ok('receipts.registerBook', { bookNo: '2/2569', startNo: 51, endNo: 100 }, t.fin);
  assert.equal(t.payRaw(a.studentId, 100, { bookId: other.bookId, receiptNo: 51 }).error.reason, 'BOOK_CHANGED');

  // ปิดการบังคับเรียงเลข: ข้ามเลขได้เมื่อยืนยัน และระบบแสดงเลขขาดช่วง
  t.setSetting({ RECEIPT_STRICT_SEQUENCE: 'FALSE' });
  assert.equal(t.payRaw(a.studentId, 100, { receiptNo: 5 }).error.reason, 'RECEIPT_GAP_CONFIRM');
  assert.equal(t.pay(a.studentId, 100, { receiptNo: 5, confirmSkipNumber: true }).payment.receiptNo, 5);
  const book = h.ok('receipts.books', {}, t.fin).books.find((b) => b.status === 'ACTIVE');
  assert.deepEqual(book.gaps, [2, 3, 4]);
  assert.equal(book.nextNo, 2);
  assert.equal(book.usedCount, 2);
});

test('กดบันทึกซ้ำด้วยรหัสคำขอเดิม: ไม่บันทึกซ้ำ และตอบผลเดิม', () => {
  const { t, h, a } = ready();
  const ctx = t.context(a.studentId);
  const payload = {
    requestKey: 'same-request-key-0001', studentId: a.studentId, paymentDate: '2026-11-21', amount: '150', channel: 'เงินสด',
    receivedByName: 'นางสาวการเงิน ทดสอบ', bookId: ctx.book.bookId, receiptNo: 1, confirmPhysicalReceipt: true,
    allocations: [{ assessmentId: ctx.items[0].assessmentId, amount: '150' }],
  };
  const first = h.ok('payments.create', payload, t.fin);
  const again = h.ok('payments.create', payload, t.fin);
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal(again.payment.paymentId, first.payment.paymentId);
  assert.equal(t.rows('Payments').length, 1);
  assert.equal(t.rows('ReceiptEntries').length, 1);
  assert.equal(t.ledger(a.studentId).totals.paidSatang, 15000);
  const b = t.student('10002', 'สอง', 'ป.1');
  assert.match(h.api('payments.create', Object.assign({}, payload, { studentId: b.studentId }), t.fin).error.message, /ถูกใช้กับนักเรียนคนอื่นแล้ว/);
});

test('ใช้ครบเล่ม: เล่มเปลี่ยนเป็นใช้ครบเล่ม หยุดบันทึก และเตือนเมื่อเลขที่ใกล้หมด', () => {
  const { t, h, a } = ready(6);
  const r1 = t.pay(a.studentId, 50);
  assert.equal(r1.book.remaining, 5);
  assert.match(r1.warnings[0], /เล่มที่ 1\/2569 เหลือ 5 ฉบับ/);
  [2, 3, 4, 5].forEach(() => t.pay(a.studentId, 50));
  const last = t.pay(a.studentId, 50);
  assert.equal(last.payment.receiptNo, 6);
  assert.equal(last.book, null);
  assert.match(last.warnings[0], /ไม่มีเล่มใบเสร็จที่กำลังใช้/);
  const book = h.ok('receipts.books', {}, t.fin).books[0];
  assert.equal(book.status, 'FULL');
  assert.equal(book.remaining, 0);
  assert.equal(t.rows('ReceiptBooks')[0].ClosedDate, '2026-11-21');
  assert.equal(t.context(a.studentId).book, null);
  const blocked = t.payRaw(a.studentId, 50, { bookId: book.bookId, receiptNo: 6 });
  assert.equal(blocked.error.reason, 'BOOK_CHANGED');
  assert.match(blocked.error.message, /ยังไม่มีเล่มใบเสร็จที่กำลังใช้/);
  t.book('2/2569', 7, 56);
  assert.equal(t.pay(a.studentId, 50).payment.receiptNo, 7);
});

test('การรับเงินบันทึกภายใต้ lock และมีประวัติการใช้งานครบทุกชีต', () => {
  const { t, h, a } = ready();
  h.env.lockContended = true;
  assert.equal(t.payRaw(a.studentId, 100).error.code, 'LOCK_TIMEOUT');
  h.env.lockContended = false;
  assert.equal(t.rows('Payments').length, 0, 'คำขอที่รอ lock ไม่ทันต้องไม่ถูกบันทึก');
  t.pay(a.studentId, 100);
  const logs = h.auditRows().filter((r) => ['ReceiptEntries', 'Payments', 'PaymentAllocations'].includes(r.Entity));
  assert.deepEqual([...logs.map((r) => r.Entity + ':' + r.Action)], ['ReceiptEntries:CREATE', 'Payments:CREATE', 'PaymentAllocations:CREATE']);
  logs.forEach((r) => assert.match(r.Note, /เล่มที่ 1\/2569 เลขที่ 1/));
  assert.equal(logs[1].Username, 'finance1');
});

test('รายการรับเงินตามช่วงวันที่ รวมยอดแยกตามช่องทาง (ผู้อำนวยการดูได้)', () => {
  const { t, h, a } = ready();
  const b = t.student('10002', 'สอง', 'ป.1');
  t.generate(t.rows('FeeSettings')[0].FeeSettingId);
  t.pay(a.studentId, 500);
  t.pay(b.studentId, 200, { channel: 'โอนเงินเข้าบัญชีโรงเรียน', channelRef: 'REF-1', paymentDate: '2026-11-20' });
  const list = h.ok('payments.list', { fromDate: '2026-11-01', toDate: '2026-11-21' }, t.dir);
  assert.deepEqual(list.rows.map((r) => r.date + '#' + r.receiptNo), ['2026-11-20#2', '2026-11-21#1']);
  assert.equal(list.rows[0].studentName, 'เด็กชายสอง ทดสอบ');
  assert.equal(list.totals.count, 2);
  assert.equal(list.totals.totalSatang, 70000);
  assert.deepEqual(list.totals.byChannel.map((c) => c.channel + '=' + c.totalSatang).sort(), ['เงินสด=50000', 'โอนเงินเข้าบัญชีโรงเรียน=20000']);
  assert.equal(h.ok('payments.list', {}, t.fin).rows.length, 1, 'ค่าเริ่มต้นคือวันนี้');
  assert.match(h.api('payments.list', { fromDate: '2026-01-01', toDate: '2026-11-21' }, t.fin).error.message, /ไม่เกิน 92 วัน/);
});

test('ค้นหานักเรียนตอนรับเงิน: ยอดค้างรวมทุกปี และยอดที่เลยกำหนด', () => {
  const { t, h, a } = ready();
  t.student('10002', 'สอง', 'ป.2');
  t.pay(a.studentId, 100);
  const res = h.ok('ledger.students', {}, t.fin);
  const one = res.rows.find((r) => r.studentId === a.studentId);
  assert.equal(one.outstandingSatang, 40000);
  assert.equal(one.overdueSatang, 40000, 'ครบกำหนด 30 มิ.ย. 2569 เลยมาแล้ว');
  assert.equal(one.classLabel, 'ป.1/1');
  assert.equal(res.rows.find((r) => r.studentNo === '10002').outstandingSatang, 0);
  assert.equal(res.currentYear, 2569);
});
