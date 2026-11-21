'use strict';
/** ทดสอบลดหย่อน/ยกเว้น การยกเลิกรายการเรียกเก็บ และคิวอนุมัติของผู้อำนวยการ (ระยะที่ 4) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupFinance } = require('./finance-helpers');

function ready() {
  const t = setupFinance();
  const a = t.student('10001', 'หนึ่ง', 'ป.1');
  const fee = t.feeOne();
  t.generate(fee.feeSettingId);
  const asm = t.ledger(a.studentId).assessments[0];
  return { t, h: t.h, a, fee, asm };
}

function request(t, asm, fields) {
  return t.h.api('adjustments.request', Object.assign({
    assessmentId: asm.assessmentId, type: 'DISCOUNT', amount: '200', reason: 'ครอบครัวมีรายได้น้อย', referenceDoc: 'หนังสือขอลดหย่อน ลงวันที่ 1 พ.ย. 2569',
  }, fields || {}), t.fin);
}

test('ลดหย่อนต้องมีเหตุผลและเอกสารอ้างอิง และรอผู้อำนวยการอนุมัติ (ระหว่างรอ ยอดเดิมยังมีผล)', () => {
  const { t, h, a, asm } = ready();
  assert.match(request(t, asm, { reason: '' }).error.message, /กรุณากรอกเหตุผล/);
  assert.match(request(t, asm, { referenceDoc: ' ' }).error.message, /กรุณากรอกเอกสารอ้างอิง/);
  const sent = request(t, asm);
  assert.equal(sent.data.applied, false);
  assert.match(sent.data.message, /ส่งคำขอลดหย่อน 200\.00 บาท ให้ผู้อำนวยการพิจารณาแล้ว/);
  const before = t.ledger(a.studentId);
  assert.equal(before.totals.outstandingSatang, 50000, 'ระหว่างรออนุมัติ ยอดเดิมยังมีผล');
  assert.equal(before.assessments[0].pendingRequest.type, 'FEE_ADJUSTMENT');
  assert.equal(before.requests[0].status, 'PENDING');
  assert.equal(request(t, asm).error.reason, 'PENDING_REQUEST', 'รายการเดียวกันมีคำขอรอได้ครั้งละ 1 คำขอ');
  assert.equal(t.rows('FeeAdjustments').length, 0);

  const queue = h.ok('approvals.list', {}, t.dir);
  assert.equal(queue.pendingCount, 1);
  assert.equal(queue.canDecide, true);
  const item = queue.rows[0];
  assert.equal(item.amountSatang, 20000);
  assert.equal(item.studentName, 'เด็กชายหนึ่ง ทดสอบ');
  assert.equal(item.requestedByName, 'นางสาวการเงิน ทดสอบ');
  assert.match(item.summary, /^ลดหย่อน 200\.00 บาท: เด็กชายหนึ่ง ทดสอบ \(10001\) เงินบำรุงการศึกษา ภาคเรียนที่ 1\/2569 ชั้น ป\.1$/);
  assert.equal(h.ok('approvals.list', {}, t.fin).canDecide, false);

  const decided = h.ok('approvals.decide', { requestId: item.requestId, decision: 'APPROVE' }, t.dir);
  assert.equal(decided.status, 'APPROVED');
  const after = t.ledger(a.studentId);
  assert.equal(after.assessments[0].adjustSatang, 20000);
  assert.equal(after.assessments[0].netSatang, 30000);
  assert.equal(after.assessments[0].state, 'UNPAID');
  assert.equal(after.assessments[0].pendingRequest, null);
  assert.equal(after.adjustments[0].approvedBy, 'นายผู้อำนวยการ ทดสอบ');
  assert.equal(after.adjustments[0].requestedBy, 'นางสาวการเงิน ทดสอบ');
  const row = t.rows('FeeAdjustments')[0];
  assert.equal(row.ApprovalRequestId, item.requestId);
  assert.equal(row.ReferenceDoc, 'หนังสือขอลดหย่อน ลงวันที่ 1 พ.ย. 2569');
  const actions = h.auditRows().map((r) => r.Action);
  assert.ok(actions.includes('REQUEST') && actions.includes('APPROVE'));
  assert.equal(h.api('approvals.decide', { requestId: item.requestId, decision: 'APPROVE' }, t.dir).error.message, 'คำขอนี้อนุมัติแล้ว');
});

test('ไม่อนุมัติต้องมีเหตุผลและไม่กระทบยอดเงิน และผู้ยื่นถอนคำขอของตนเองได้', () => {
  const { t, h, a, asm } = ready();
  const first = request(t, asm).data;
  assert.match(h.api('approvals.decide', { requestId: first.requestId, decision: 'REJECT' }, t.dir).error.message, /กรุณากรอกเหตุผลที่ไม่อนุมัติ/);
  h.ok('approvals.decide', { requestId: first.requestId, decision: 'REJECT', note: 'เอกสารไม่ครบ' }, t.dir);
  assert.equal(t.ledger(a.studentId).totals.outstandingSatang, 50000);
  assert.equal(t.ledger(a.studentId).requests[0].decisionNote, 'เอกสารไม่ครบ');

  const second = request(t, asm).data;
  h.ok('approvals.withdraw', { requestId: second.requestId }, t.fin);
  assert.equal(h.api('approvals.decide', { requestId: second.requestId, decision: 'APPROVE' }, t.dir).error.message, 'คำขอนี้ถอนคำขอแล้ว');
  assert.equal(h.ok('approvals.list', { status: 'ALL' }, t.dir).rows.length, 2);
  assert.equal(h.ok('approvals.list', {}, t.dir).pendingCount, 0);
  assert.equal(t.rows('FeeAdjustments').length, 0);
});

test('ยกเว้นทั้งจำนวน: สถานะเป็น "ได้รับยกเว้น" และลดหย่อนเกินยอดคงเหลือไม่ได้', () => {
  const { t, h, a, asm } = ready();
  assert.match(request(t, asm, { amount: '500.01' }).error.message, /ต้องไม่เกิน 500\.00 บาท/);
  const ex = request(t, asm, { type: 'EXEMPTION', amount: '' }).data;
  h.ok('approvals.decide', { requestId: ex.requestId, decision: 'APPROVE' }, t.dir);
  const item = t.ledger(a.studentId).assessments[0];
  assert.equal(item.state, 'EXEMPT');
  assert.equal(item.stateLabel, 'ได้รับยกเว้น');
  assert.equal(item.outstandingSatang, 0);
  assert.match(request(t, asm).error.message, /ไม่มียอดคงเหลือให้ลดหย่อนหรือยกเว้น/);
  assert.equal(t.context(a.studentId).items.length, 0, 'ไม่มีรายการค้างให้รับเงิน');
});

test('ตรวจยอดคงเหลือใหม่ตอนอนุมัติ: ถ้ายอดเปลี่ยนไประหว่างรอ อนุมัติไม่ได้และคำขอยังรออยู่', () => {
  const { t, h, a, asm } = ready();
  t.book('1/2569', 1, 50);
  const ex = request(t, asm, { type: 'EXEMPTION' }).data;
  t.pay(a.studentId, 100);
  const res = h.api('approvals.decide', { requestId: ex.requestId, decision: 'APPROVE' }, t.dir);
  assert.equal(res.error.reason, 'BALANCE_CHANGED');
  assert.match(res.error.message, /คงเหลือ 400\.00 บาท/);
  assert.equal(h.ok('approvals.list', {}, t.dir).rows[0].status, 'PENDING');
  assert.equal(t.rows('FeeAdjustments').length, 0);
  h.ok('approvals.decide', { requestId: ex.requestId, decision: 'REJECT', note: 'ยอดเปลี่ยนแล้ว ให้ยื่นใหม่' }, t.dir);
});

test('ผู้ยื่นคำขอพิจารณาคำขอของตนเองไม่ได้ และถอนได้เฉพาะคำขอของตนเอง (ตรวจที่ Server)', () => {
  const { t, h, asm } = ready();
  const sent = request(t, asm).data;
  h.newExecution();
  const outcome = h.gas.withScriptLock_(() => {
    try {
      h.gas.approvalsDecide_({ userId: 'USR-x', username: 'finance1', role: 'DIRECTOR' }, { requestId: sent.requestId, decision: 'APPROVE' });
      return 'allowed';
    } catch (e) {
      return e.code + ':' + e.userMessage;
    }
  });
  assert.equal(outcome, 'FORBIDDEN:ผู้ยื่นคำขอพิจารณาคำขอของตนเองไม่ได้');
  const fin2 = h.addUser(t.admin, 'FINANCE', 'finance2');
  assert.match(h.api('approvals.withdraw', { requestId: sent.requestId }, fin2.token).error.message, /ถอนได้เฉพาะคำขอที่ตนเองยื่น/);
});

test('ปิด "ต้องอนุมัติ" ในหน้าตั้งค่า: คำขอมีผลทันทีและบันทึกผู้ทำรายการ', () => {
  const { t, h, a, asm } = ready();
  t.setSetting({ APPROVAL_FEE_ADJUSTMENT: 'FALSE' });
  const res = request(t, asm, { amount: '100' }).data;
  assert.equal(res.applied, true);
  const row = t.rows('FeeAdjustments')[0];
  assert.equal(row.RequestedBy, 'finance1');
  assert.equal(row.ApprovedBy, '');
  assert.equal(t.rows('ApprovalRequests').length, 0);
  assert.equal(t.ledger(a.studentId).totals.outstandingSatang, 40000);
  assert.ok(h.auditRows().some((r) => r.Entity === 'FeeAdjustments' && r.Action === 'CREATE' && r.Username === 'finance1'));
});

test('ยกเลิกรายการเรียกเก็บ: ต้องยังไม่มีการชำระ มีเหตุผล และผ่านการอนุมัติ', () => {
  const { t, h, a, fee, asm } = ready();
  const b = t.student('10002', 'สอง', 'ป.1');
  t.generate(fee.feeSettingId);
  const asmB = t.ledger(b.studentId).assessments[0];
  t.book('1/2569', 1, 50);
  t.pay(a.studentId, 100);
  assert.match(h.api('assessments.requestCancel', { assessmentId: asmB.assessmentId, reason: '' }, t.fin).error.message, /กรุณากรอกเหตุผลการยกเลิก/);
  assert.match(h.api('assessments.requestCancel', { assessmentId: asm.assessmentId, reason: 'เรียกเก็บผิดคน' }, t.fin).error.message, /รับชำระแล้ว 100\.00 บาท จึงยกเลิกไม่ได้/);

  const sent = h.ok('assessments.requestCancel', { assessmentId: asmB.assessmentId, reason: 'นักเรียนได้รับทุนเต็มจำนวนจากมูลนิธิ' }, t.fin);
  assert.equal(sent.applied, false);
  assert.equal(t.ledger(b.studentId).assessments[0].state, 'UNPAID', 'ระหว่างรออนุมัติยังเป็นหนี้ตามเดิม');
  h.ok('approvals.decide', { requestId: sent.requestId, decision: 'APPROVE' }, t.dir);
  const cancelled = t.ledger(b.studentId);
  assert.equal(cancelled.assessments[0].state, 'CANCELLED');
  assert.equal(cancelled.assessments[0].cancelReason, 'นักเรียนได้รับทุนเต็มจำนวนจากมูลนิธิ');
  assert.equal(cancelled.totals.outstandingSatang, 0);
  const row = t.rows('FeeAssessments').find((r) => r.AssessmentId === asmB.assessmentId);
  assert.equal(row.CancelledBy, 'finance1');
  assert.equal(row.ApprovalRequestId, sent.requestId);
  assert.ok(h.auditRows().some((r) => r.Entity === 'FeeAssessments' && r.Action === 'CANCEL'));

  // สร้างรายการเรียกเก็บซ้ำต้องไม่เรียกเก็บคนที่ถูกยกเลิกไปแล้ว
  const again = h.ok('assessments.preview', { feeSettingId: fee.feeSettingId }, t.fin);
  assert.equal(again.create.length, 0);
  assert.match(again.skipped[0].reason, /รายการเดิมของอัตรานี้ถูกยกเลิกแล้ว/);
  assert.match(t.payRaw(b.studentId, 100, { allocations: [{ assessmentId: asmB.assessmentId, amount: '100' }] }).error.message, /ถูกยกเลิกแล้ว/);
});

test('ผู้อำนวยการเพิกถอนลดหย่อนที่บันทึกผิดได้ ยอดค้างกลับมาตามเดิม', () => {
  const { t, h, a, asm } = ready();
  const sent = request(t, asm).data;
  h.ok('approvals.decide', { requestId: sent.requestId, decision: 'APPROVE' }, t.dir);
  const adj = t.ledger(a.studentId).adjustments[0];
  assert.match(h.api('adjustments.revoke', { adjustmentId: adj.adjustmentId, reason: '' }, t.dir).error.message, /กรุณากรอกเหตุผลการเพิกถอน/);
  h.ok('adjustments.revoke', { adjustmentId: adj.adjustmentId, reason: 'อนุมัติผิดคน' }, t.dir);
  const after = t.ledger(a.studentId);
  assert.equal(after.totals.outstandingSatang, 50000);
  assert.equal(after.adjustments[0].status, 'REVOKED');
  assert.equal(after.adjustments[0].revokedBy, 'นายผู้อำนวยการ ทดสอบ');
  assert.match(h.api('adjustments.revoke', { adjustmentId: adj.adjustmentId, reason: 'ซ้ำ' }, t.dir).error.message, /ถูกเพิกถอนแล้ว/);
});
