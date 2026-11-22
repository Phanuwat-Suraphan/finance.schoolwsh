'use strict';
/** ทดสอบประวัติการใช้งาน (AuditLogs) และการตรวจจับการแก้ไข/ลบด้วยมือ */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstalledEnv, plain } = require('./harness');

const OFFICER = { userId: 'USR-TEST', username: 'finance1', role: 'FINANCE' };

function setup() {
  const h = createInstalledEnv({ now: '2026-11-21T10:00:00+07:00' });
  const g = h.gas;
  g.withScriptLock_(() => {
    for (let i = 1; i <= 5; i++) {
      g.dbInsert_('Students', { StudentNo: 'A' + i, FirstName: 'นักเรียน' + i, Status: 'STUDYING' }, OFFICER);
    }
  });
  h.newExecution();
  return { h, g, audit: h.sheet('AuditLogs') };
}

function colOf(sheet, name) {
  return sheet._rowValues(1).indexOf(name) + 1;
}

function verify(h) {
  h.newExecution();
  return plain(h.gas.auditVerifyChain_());
}

test('ลูกโซ่ hash ถูกต้องหลังติดตั้งและบันทึกข้อมูล รวมถึงข้ามการทำงานหลายรอบ', () => {
  const { h, g } = setup();
  let result = verify(h);
  assert.equal(result.ok, true);
  assert.equal(result.total, 26 + 5); // ค่าตั้งค่า 24 + ปีการศึกษาเริ่มต้น 1 + SETUP 1 + นักเรียน 5
  g.withScriptLock_(() => g.dbInsert_('Students', { StudentNo: 'B1', FirstName: 'ใหม่', Status: 'STUDYING' }, OFFICER));
  result = verify(h);
  assert.equal(result.ok, true);
  assert.equal(result.total, 32);
});

test('แถวแรกต่อจาก GENESIS และทุกแถวอ้าง hash ของแถวก่อนหน้า', () => {
  const { audit } = setup();
  const prevCol = colOf(audit, 'PrevHash');
  const hashCol = colOf(audit, 'Hash');
  assert.equal(audit.getRange(2, prevCol).getValue(), 'GENESIS');
  for (let r = 3; r <= audit.getLastRow(); r++) {
    assert.equal(audit.getRange(r, prevCol).getValue(), audit.getRange(r - 1, hashCol).getValue());
    assert.match(audit.getRange(r, hashCol).getValue(), /^[0-9a-f]{64}$/);
  }
});

test('ตรวจพบการแก้ไขข้อมูลในแถวประวัติด้วยมือ และกลับมาถูกต้องเมื่อคืนค่าเดิม', () => {
  const { h, audit } = setup();
  const noteCol = colOf(audit, 'AfterJson');
  let row = 2;
  while (!/นักเรียน2/.test(audit.getRange(row, noteCol).getValue())) row++; // แถวประวัติการเพิ่มนักเรียน2
  const original = audit.getRange(row, noteCol).getValue();
  audit._rawSet(row, noteCol, original.replace('นักเรียน2', 'นักเรียนปลอม'));
  let result = verify(h);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map((p) => [p.rowNumber, p.problem]), [[row, 'HASH_MISMATCH']]);
  assert.match(result.problems[0].label, /ถูกแก้ไข/);
  audit._rawSet(row, noteCol, original);
  result = verify(h);
  assert.equal(result.ok, true);
});

test('ตรวจพบการลบแถวกลางชีต', () => {
  const { h, audit } = setup();
  audit.deleteRow(10);
  const result = verify(h);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.problem === 'PREV_HASH_MISMATCH' && p.rowNumber === 10));
});

test('ตรวจพบการลบแถวท้ายชีต (ด้วยตำแหน่งล่าสุดที่ระบบจำไว้ใน Script Properties)', () => {
  const { h, audit } = setup();
  audit.deleteRow(audit.getLastRow());
  const result = verify(h);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map((p) => p.problem), ['HEAD_MISSING']);
});

test('ตรวจพบการแก้ hash แล้วคำนวณใหม่เฉพาะแถว (ลูกโซ่ของแถวถัดไปขาด)', () => {
  const { h, g, audit } = setup();
  const hashCol = colOf(audit, 'Hash');
  const noteCol = colOf(audit, 'Note');
  audit._rawSet(15, noteCol, 'แก้ไขย้อนหลัง');
  h.newExecution();
  const rec = g.dbAll_('AuditLogs')[13]; // แถว 15
  audit._rawSet(15, hashCol, g.auditComputeHash_(rec));
  const result = verify(h);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map((p) => [p.rowNumber, p.problem]), [[16, 'PREV_HASH_MISMATCH']]);
});

test('เขียนหรือแก้ไข AuditLogs ผ่าน Db ทั่วไปไม่ได้', () => {
  const { g } = setup();
  assert.throws(() => g.withScriptLock_(() => g.dbInsert_('AuditLogs', { Action: 'CREATE' }, OFFICER)), /ฟังก์ชันเฉพาะ/);
  const logId = g.dbAll_('AuditLogs')[0].LogId;
  assert.throws(() => g.withScriptLock_(() => g.dbUpdate_('AuditLogs', logId, { Note: 'x' }, OFFICER)), /แก้ไขไม่ได้/);
  assert.throws(() => g.auditAppend_([{ action: 'LOGIN' }], OFFICER), /LockService/);
});

test('ซ่อนค่าลับทุกระดับของข้อมูล', () => {
  const { h, g } = setup();
  g.withScriptLock_(() => g.auditAppend_([{
    action: 'LOGIN_FAILED',
    entity: 'Auth',
    after: { username: 'x', Password: 'p@ss', nested: { Token: 'tok-123', list: [{ NewPassword: 'n3w' }] } },
  }], { userId: 'ANONYMOUS', username: 'x', role: 'ANONYMOUS' }));
  const audit = h.sheet('AuditLogs');
  const after = JSON.parse(audit.getRange(audit.getLastRow(), colOf(audit, 'AfterJson')).getValue());
  assert.deepEqual(after, { username: 'x', Password: '[ซ่อน]', nested: { Token: '[ซ่อน]', list: [{ NewPassword: '[ซ่อน]' }] } });
});

test('ค่า Action ต้องอยู่ในรายการที่กำหนด', () => {
  const { g } = setup();
  assert.throws(() => g.withScriptLock_(() => g.auditAppend_([{ action: 'HACK' }], OFFICER)), (e) => e.code === 'VALIDATION');
});
