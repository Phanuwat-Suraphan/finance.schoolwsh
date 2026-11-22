'use strict';
/**
 * ทดสอบเครื่องมือตรวจความถูกต้องของข้อมูล (ระยะที่ 8)
 * - ข้อมูลที่บันทึกผ่านระบบทุกรูปแบบ (รับเงิน ยกเลิก แก้ไข ปิดเล่ม ปิดยอด ฯลฯ) ต้องตรวจผ่านทุกข้อ
 * - การแก้ชีตด้วยมือแต่ละแบบ ต้องถูกตรวจพบในข้อที่ถูกต้อง
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArrearsDataset, arrearsNextYear } = require('./finance-helpers');
const { plain } = require('./harness');

const KEYS = ['sheets', 'audit', 'payments', 'receipts', 'assessments', 'books', 'auditCoverage', 'closings'];

/** ชุดข้อมูลที่ผ่านทุกเส้นทางของระบบ */
function richDataset() {
  const { t, h, s } = buildArrearsDataset();
  const pays = h.ok('payments.list', {}, t.fin).rows;
  const ofD = pays.find((p) => p.studentId === s.D.studentId);
  const ofB = pays.find((p) => p.studentId === s.B.studentId);
  // ยกเลิกใบเสร็จ (อนุมัติ) และขอยกเลิกที่ไม่อนุมัติ
  h.ok('payments.requestVoid', { paymentId: ofD.paymentId, reason: 'ชำระซ้ำ', confirmKept: true }, t.fin);
  // แก้ไขรายการบันทึกผิด (อนุมัติ)
  h.ok('payments.requestCorrection', {
    paymentId: ofB.paymentId, paymentDate: '2026-11-21', amount: '250', channel: 'เงินสด', channelRef: '',
    receivedByName: 'นางสาวการเงิน ทดสอบ', note: '', reason: 'พิมพ์จำนวนเงินผิด',
    allocations: [{ assessmentId: ofB.allocations[0].assessmentId, amount: '250' }],
  }, t.fin);
  // ยกเลิกเลขที่ที่เขียนผิด: อนุมัติ 1 ใบ ไม่อนุมัติ 1 ใบ (คืนเลขที่)
  const book = h.ok('receipts.books', {}, t.fin).books[0];
  h.ok('receipts.requestCancelNumber', { bookId: book.bookId, receiptNo: 6, reason: 'เขียนผิด', confirmKept: true }, t.fin);
  h.ok('receipts.requestCancelNumber', { bookId: book.bookId, receiptNo: 7, reason: 'เขียนผิด', confirmKept: true }, t.fin);
  const decide = (match, decision) => {
    const r = h.ok('approvals.list', { status: 'PENDING' }, t.dir).rows.find((x) => x.summary.includes(match));
    h.ok('approvals.decide', { requestId: r.requestId, decision, note: decision === 'REJECT' ? 'ตรวจแล้วใบเสร็จยังใช้ได้' : '' }, t.dir);
  };
  decide('ยกเลิกใบเสร็จ', 'APPROVE');
  decide('แก้ไขรายการ', 'APPROVE');
  decide('เลขที่ 6', 'APPROVE');
  decide('เลขที่ 7', 'REJECT');
  // รับเงินต่อ ขึ้นปีใหม่และตัดชำระข้ามปี
  t.pay(s.C.studentId, 100);
  arrearsNextYear(t, h, s);
  // ปิดยอด เปิดยอดใหม่ และปิดยอดอีกครั้ง
  const daily = h.ok('reports.daily', { date: '2026-11-21' }, t.fin);
  h.ok('closings.close', { date: '2026-11-21', expectedDigest: daily.figures.digest, confirmChecked: true }, t.fin);
  h.ok('closings.reopen', { date: '2026-11-21', reason: 'ตรวจทานอีกครั้ง' }, t.dir);
  const again = h.ok('reports.daily', { date: '2026-11-21' }, t.fin);
  h.ok('closings.close', { date: '2026-11-21', expectedDigest: again.figures.digest, confirmChecked: true }, t.fin);
  return { t, h, s, book };
}

function run(h, token) {
  const r = h.ok('integrity.check', {}, token);
  const byKey = {};
  r.checks.forEach((c) => { byKey[c.key] = c; });
  return { r, byKey };
}

function findRow(h, sheetName, idColumn, id) {
  const sheet = h.sheet(sheetName);
  const header = sheet._rowValues(1);
  const idCol = header.indexOf(idColumn);
  for (let r = 2; r <= sheet.getLastRow(); r++) {
    if (sheet._rowValues(r)[idCol] === id) return { sheet, row: r, header };
  }
  throw new Error('ไม่พบ ' + id);
}

function setCell(h, sheetName, idColumn, id, column, value) {
  const f = findRow(h, sheetName, idColumn, id);
  f.sheet._rawSet(f.row, f.header.indexOf(column) + 1, value);
}

test('ข้อมูลที่บันทึกผ่านระบบทุกเส้นทาง ตรวจผ่านครบ 8 ข้อ และบันทึกประวัติการตรวจ', () => {
  const { t, h } = richDataset();
  const { r } = run(h, t.dir);
  assert.deepEqual(r.checks.map((c) => c.key), KEYS);
  assert.deepEqual(r.checks.filter((c) => !c.ok).map((c) => c.key + ': ' + c.problems.join(' | ')), []);
  assert.equal(r.ok, true);
  assert.equal(r.problemCount, 0);
  const status = h.ok('integrity.status', {}, t.admin);
  assert.equal(status.last.ok, true);
  assert.equal(status.last.byName, 'นายผู้อำนวยการ ทดสอบ');
  assert.ok(h.auditRows().some((x) => x.Action === 'INTEGRITY_CHECK' && /ถูกต้องทั้งหมด/.test(x.Note)));
  assert.equal(run(h, t.admin).r.ok, true, 'ผู้ดูแลระบบตรวจได้');
  assert.equal(h.api('integrity.check', {}, t.fin).error.code, 'FORBIDDEN');
});

test('แก้จำนวนเงินในชีต Payments โดยตรง: ตรวจพบทั้งยอดตัดชำระ ทะเบียนคุม และวันที่ปิดยอดแล้ว', () => {
  const { t, h, s } = richDataset();
  const p = h.ok('payments.list', {}, t.fin).rows.find((x) => x.studentId === s.G.studentId && x.status === 'ACTIVE');
  setCell(h, 'Payments', 'PaymentId', p.paymentId, 'Amount', 70);
  const { r, byKey } = run(h, t.dir);
  assert.equal(r.ok, false);
  assert.match(byKey.payments.problems.join('\n'), /ยอดเงินในใบเสร็จไม่เท่ากับผลรวมการตัดชำระ/);
  assert.match(byKey.payments.problems.join('\n'), /ไม่ตรงกับทะเบียนคุมใบเสร็จ/);
  assert.match(byKey.closings.problems.join('\n'), /21 พฤศจิกายน 2569: รายการรับเงินไม่ตรงกับตอนปิดยอด/);
  assert.doesNotMatch(JSON.stringify(r), /70\.00|7,000/, 'ข้อความปัญหาไม่แสดงจำนวนเงิน');
  assert.equal(h.ok('integrity.status', {}, t.admin).last.problemCount, r.problemCount);
});

test('แก้สถานะการตัดชำระ ลบการรับเงิน และเพิ่มแถวเลขที่ใบเสร็จซ้ำในชีตโดยตรง: ตรวจพบทุกกรณี', () => {
  const { t, h, s } = richDataset();
  const rows = (name) => { h.newExecution(); return plain(h.gas.dbAll_(name)); };
  const pay = rows('Payments').find((x) => x.StudentId === s.E.studentId && x.Status === 'ACTIVE');
  const alloc = rows('PaymentAllocations').find((x) => x.PaymentId === pay.PaymentId);
  setCell(h, 'PaymentAllocations', 'AllocationId', alloc.AllocationId, 'Status', 'VOIDED');
  // เพิ่มแถวทะเบียนคุมซ้ำเลขที่เดิม (คัดลอกแถวแล้วเปลี่ยนรหัส)
  const entries = h.sheet('ReceiptEntries');
  const src = findRow(h, 'ReceiptEntries', 'EntryId', pay.ReceiptEntryId);
  const values = entries._rowValues(src.row);
  const newRow = entries.getLastRow() + 1;
  values.forEach((v, i) => entries._rawSet(newRow, i + 1, i === 0 ? 'RCE-20261121100000-ABCDEF' : v));
  // ลบแถวการรับเงินของอีกคน (การตัดชำระยังอยู่)
  const other = rows('Payments').find((x) => x.StudentId === s.A.studentId && x.Status === 'ACTIVE');
  const gone = findRow(h, 'Payments', 'PaymentId', other.PaymentId);
  gone.sheet.deleteRow(gone.row);
  const { byKey } = run(h, t.dir);
  const text = (k) => byKey[k].problems.join('\n');
  assert.match(text('payments'), /ยอดเงินในใบเสร็จไม่เท่ากับผลรวมการตัดชำระ/);
  assert.match(text('payments'), /ไม่พบการรับเงินที่อ้างถึง/);
  assert.match(text('receipts'), /มีในทะเบียนคุมซ้ำ/);
  assert.match(text('receipts'), /ไม่มีการรับเงินที่มีผลคู่กัน/);
  assert.match(text('auditCoverage'), /RCE-20261121100000-ABCDEF: ไม่มีประวัติการบันทึก/);
});

test('แก้ประวัติการใช้งาน สถานะเล่ม และยอดเรียกเก็บในชีตโดยตรง: ตรวจพบในข้อที่ถูกต้อง', () => {
  const { t, h, s, book } = richDataset();
  const audit = h.sheet('AuditLogs');
  audit._rawSet(5, audit._rowValues(1).indexOf('Note') + 1, 'แก้ไขข้อความประวัติ');
  setCell(h, 'ReceiptBooks', 'BookId', book.bookId, 'Status', 'FULL');
  h.newExecution();
  const asm = plain(h.gas.dbAll_('FeeAssessments')).find((a) => a.StudentId === s.G.studentId);
  setCell(h, 'FeeAssessments', 'AssessmentId', asm.AssessmentId, 'GrossAmount', 100);
  const { byKey } = run(h, t.admin);
  assert.match(byKey.audit.problems.join('\n'), /แถว 5 .*ข้อมูลในแถวนี้ถูกแก้ไขหลังบันทึก/);
  assert.match(byKey.books.problems.join('\n'), /สถานะ "ใช้ครบเล่ม" แต่ยังมีเลขที่ที่ไม่ได้ใช้/);
  assert.match(byKey.assessments.problems.join('\n'), /ตัดชำระเกินยอดสุทธิ/);
  assert.equal(byKey.payments.ok, true);
});

test('สำรองอัตโนมัติรายวันตรวจความถูกต้องต่อท้าย ถ้าพบปัญหาให้แจ้งเจ้าของระบบทางอีเมลของ Google', () => {
  const { t, h, s } = richDataset();
  const uid = h.env.triggers.find((x) => x.getHandlerFunction() === 'dailyBackup').getUniqueId();
  h.newExecution();
  const ok = plain(h.gas.dailyBackup({ triggerUid: uid }));
  assert.equal(ok.integrityOk, true);
  const p = h.ok('payments.list', {}, t.fin).rows.find((x) => x.studentId === s.G.studentId && x.status === 'ACTIVE');
  setCell(h, 'Payments', 'PaymentId', p.paymentId, 'Amount', 1);
  h.newExecution();
  assert.throws(() => h.gas.dailyBackup({ triggerUid: uid }), (e) => /สำรองข้อมูลสำเร็จ แต่ตรวจพบปัญหาความถูกต้องของข้อมูล/.test(e.userMessage));
  const status = h.ok('backups.status', {}, t.admin);
  assert.equal(status.lastAuto.ok, true, 'การสำรองเองสำเร็จ');
  const last = h.ok('integrity.status', {}, t.dir).last;
  assert.equal(last.ok, false);
  assert.equal(last.byName, 'ระบบ (ตรวจอัตโนมัติ)');
  assert.ok(last.failed.includes('payments'));
});
