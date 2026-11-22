'use strict';
/**
 * ทดสอบการปิดยอดประจำวันและรายงานรับเงินประจำวัน (ระยะที่ 7, D-19, D-37)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupFinance } = require('./finance-helpers');
const { plain } = require('./harness');

function ready() {
  const t = setupFinance();
  const a = t.student('10001', 'เอ', 'ป.1');
  const b = t.student('10002', 'บี', 'ป.1');
  t.generate(t.feeOne().feeSettingId);
  t.book('1/2569', 1, 50);
  return { t, h: t.h, a, b };
}

function daily(t, date, token) {
  return t.h.ok('reports.daily', { date }, token || t.fin);
}

function close(t, date, extra) {
  const report = daily(t, date);
  return t.h.api('closings.close', Object.assign({ date, expectedDigest: report.figures.digest, confirmChecked: true }, extra || {}), t.fin);
}

test('รายงานประจำวัน: เรียงตามเลขที่ ยอดแยกช่องทาง และรหัสตรวจสอบ 16 ตัว', () => {
  const { t, a, b } = ready();
  t.pay(a.studentId, 200);
  t.pay(b.studentId, 300, { channel: 'โอนเงินเข้าบัญชีโรงเรียน', channelRef: 'KTB-0001' });
  t.pay(a.studentId, 100);
  const r = daily(t, '2026-11-21');
  assert.deepEqual(r.rows.map((x) => x.receiptNo), [1, 2, 3]);
  assert.equal(r.rows[0].studentName, 'เด็กชายเอ ทดสอบ');
  assert.equal(r.rows[0].classLabel, 'ป.1/1');
  assert.equal(r.figures.receiptCount, 3);
  assert.equal(r.figures.totalSatang, 60000);
  assert.equal(r.figures.totalText, 'หกร้อยบาทถ้วน');
  assert.deepEqual(r.figures.byChannel.map((c) => [c.channel, c.count, c.satang]),
    [['เงินสด', 2, 30000], ['โอนเงินเข้าบัญชีโรงเรียน', 1, 30000]]);
  assert.equal(r.figures.receiptRange, 'เล่มที่ 1/2569 เลขที่ 1–3');
  assert.match(r.figures.verifyCode, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal(r.closing, null);
  assert.equal(r.canClose, true);
  assert.equal(daily(t, '2026-11-21', t.dir).canClose, false, 'ผู้อำนวยการปิดยอดไม่ได้');
  assert.equal(r.meta.signers.directorPosition, 'ผู้อำนวยการโรงเรียนวัดเสาหิน');
  assert.equal(r.confirmText, 'ตรวจนับเงินและสำเนาใบเสร็จตรงกับรายงานนี้แล้ว');
});

test('ปิดยอดแล้ว: บันทึกรับเงิน ยกเลิก หรือแก้ไขรายการของวันนั้นไม่ได้ จนกว่าผู้อำนวยการจะเปิดยอดใหม่', () => {
  const { t, h, a, b } = ready();
  const D = '2026-11-20';
  const first = t.pay(a.studentId, 200, { paymentDate: D }).payment;
  assert.match(close(t, D, { confirmChecked: false }).error.message, /ติ๊กยืนยัน/);
  const res = close(t, D);
  assert.equal(res.ok, true);
  assert.match(res.data.message, /รหัสตรวจสอบ [0-9A-F]{4}-/);
  assert.equal(close(t, D).error.reason, 'DAY_CLOSED', 'ปิดซ้ำไม่ได้');

  const blocked = t.payRaw(b.studentId, 100, { paymentDate: D });
  assert.equal(blocked.error.reason, 'DAY_CLOSED');
  assert.match(blocked.error.message, /20 พฤศจิกายน 2569 ปิดยอดแล้ว/);
  assert.equal(h.api('payments.requestVoid', { paymentId: first.paymentId, reason: 'ทดสอบ', confirmKept: true }, t.fin).error.reason, 'DAY_CLOSED');
  const corr = h.api('payments.requestCorrection', {
    paymentId: first.paymentId, paymentDate: D, amount: '250', channel: 'เงินสด', channelRef: '',
    receivedByName: 'นางสาวการเงิน ทดสอบ', note: '', reason: 'พิมพ์ผิด',
    allocations: [{ assessmentId: first.allocations[0].assessmentId, amount: '250' }],
  }, t.fin);
  assert.equal(corr.error.reason, 'DAY_CLOSED');

  // วันอื่นยังรับเงินได้ตามปกติ แต่ย้ายรายการเข้าวันที่ปิดแล้วไม่ได้
  const next = t.pay(b.studentId, 100).payment;
  const move = h.api('payments.requestCorrection', {
    paymentId: next.paymentId, paymentDate: D, amount: '100', channel: 'เงินสด', channelRef: '',
    receivedByName: 'นางสาวการเงิน ทดสอบ', note: '', reason: 'ลงวันที่ผิด',
    allocations: [{ assessmentId: next.allocations[0].assessmentId, amount: '100' }],
  }, t.fin);
  assert.equal(move.error.reason, 'DAY_CLOSED');

  // เปิดยอดใหม่: ต้องเป็นผู้อำนวยการและมีเหตุผล
  assert.match(h.api('closings.reopen', { date: D, reason: '' }, t.dir).error.message, /กรอกเหตุผล/);
  assert.equal(h.api('closings.reopen', { date: D, reason: 'ลืมบันทึก' }, t.fin).error.code, 'FORBIDDEN');
  h.ok('closings.reopen', { date: D, reason: 'เจ้าหน้าที่ลืมบันทึกใบเสร็จ 1 ฉบับ' }, t.dir);
  assert.equal(h.api('closings.reopen', { date: D, reason: 'ซ้ำ' }, t.dir).ok, false, 'เปิดซ้ำไม่ได้');
  assert.equal(t.payRaw(b.studentId, 50, { paymentDate: D }).ok, true, 'เปิดยอดแล้วบันทึกย้อนหลังได้');

  const again = close(t, D);
  assert.equal(again.ok, true, 'ปิดยอดใหม่ได้');
  const r = daily(t, D, t.dir);
  assert.equal(r.figures.receiptCount, 2);
  assert.equal(r.closing.receiptCount, 2);
  assert.equal(r.matches, true);
  assert.equal(r.history.length, 1, 'ประวัติการปิดยอดครั้งก่อนยังอยู่');
  assert.equal(r.history[0].reopenReason, 'เจ้าหน้าที่ลืมบันทึกใบเสร็จ 1 ฉบับ');
  assert.equal(r.history[0].reopenedBy, 'นายผู้อำนวยการ ทดสอบ');
  assert.equal(r.canReopen, true);
  const closings = t.rows('DailyClosings');
  assert.deepEqual(closings.map((c) => c.Status), ['REOPENED', 'CLOSED']);
  const actions = h.auditRows().map((x) => x.Action);
  assert.equal(actions.filter((x) => x === 'DAY_CLOSE').length, 2);
  assert.equal(actions.filter((x) => x === 'DAY_REOPEN').length, 1);
});

test('ปิดยอดไม่ได้ถ้ามีคำขอยกเลิกใบเสร็จของวันนั้นรอพิจารณา และใบเสร็จที่ยกเลิกไม่นับในยอด', () => {
  const { t, h, a, b } = ready();
  const p1 = t.pay(a.studentId, 200).payment;
  t.pay(b.studentId, 300);
  h.ok('payments.requestVoid', { paymentId: p1.paymentId, reason: 'ผู้ปกครองชำระซ้ำ', confirmKept: true }, t.fin);
  assert.equal(close(t, '2026-11-21').error.reason, 'PENDING_REQUEST');
  assert.equal(daily(t, '2026-11-21').canClose, false);
  assert.equal(daily(t, '2026-11-21').pendingCount, 1);

  const req = h.ok('approvals.list', { status: 'PENDING' }, t.dir).rows[0];
  h.ok('approvals.decide', { requestId: req.requestId, decision: 'APPROVE' }, t.dir);
  const r = daily(t, '2026-11-21');
  assert.equal(r.figures.receiptCount, 1);
  assert.equal(r.figures.voidedCount, 1);
  assert.equal(r.figures.totalSatang, 30000);
  assert.deepEqual(r.rows.map((x) => [x.receiptNo, x.status]), [[1, 'VOIDED'], [2, 'ACTIVE']]);
  assert.equal(r.rows[0].voidReason, 'ผู้ปกครองชำระซ้ำ');
  assert.equal(close(t, '2026-11-21').ok, true);
});

test('ข้อมูลเปลี่ยนระหว่างเปิดรายงานปิดยอดไม่ได้ และตรวจพบเมื่อชีตถูกแก้ด้วยมือหลังปิดยอด', () => {
  const { t, h, a, b } = ready();
  t.pay(a.studentId, 200);
  const stale = daily(t, '2026-11-21');
  t.pay(b.studentId, 300);
  const res = h.api('closings.close', { date: '2026-11-21', expectedDigest: stale.figures.digest, confirmChecked: true }, t.fin);
  assert.equal(res.error.reason, 'DAY_CHANGED');
  assert.equal(close(t, '2026-11-21').ok, true);

  // มีผู้แก้จำนวนเงินในชีต Payments โดยตรง (ไม่ผ่านระบบ)
  const sheet = h.sheet('Payments');
  const header = sheet._rowValues(1);
  const col = header.indexOf('Amount') + 1;
  sheet._rawSet(2, col, 20);
  const r = daily(t, '2026-11-21', t.dir);
  assert.equal(r.matches, false, 'รหัสตรวจสอบไม่ตรงกับตอนปิดยอด');
  assert.notEqual(r.figures.verifyCode, r.closing.verifyCode);
  const list = h.ok('closings.list', {}, t.dir);
  assert.equal(list.rows[0].changedAfterClose, true);
});

test('ปิดยอดได้เฉพาะวันที่มีรายการและไม่ใช่วันในอนาคต และรายการสถานะการปิดยอด', () => {
  const { t, h, a } = ready();
  assert.match(h.api('closings.close', { date: '2026-11-22', expectedDigest: 'x', confirmChecked: true }, t.fin).error.message, /ล่วงหน้า/);
  assert.match(close(t, '2026-11-20').error.message, /ไม่มีรายการรับเงิน/);
  t.pay(a.studentId, 100, { paymentDate: '2026-11-19' });
  t.pay(a.studentId, 100, { paymentDate: '2026-11-20' });
  t.pay(a.studentId, 100);
  close(t, '2026-11-19');
  const list = h.ok('closings.list', {}, t.fin);
  assert.deepEqual(list.rows.map((r) => [r.date, r.closed, r.receiptCount]),
    [['2026-11-21', false, 1], ['2026-11-20', false, 1], ['2026-11-19', true, 1]]);
  assert.equal(list.unclosedCount, 1, 'ไม่นับวันนี้ที่ยังรับเงินได้อยู่');
  assert.equal(list.canClose, true);
  assert.equal(h.ok('closings.list', {}, t.dir).canReopen, true);
  assert.equal(plain(h.gas.unclosedDaysCount_()), 1);
  const dash = h.ok('dashboard.summary', {}, t.dir);
  assert.equal(dash.unclosedDays, 1);
});
