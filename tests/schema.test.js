'use strict';
/**
 * ทดสอบความถูกต้องของโครงสร้างฐานข้อมูล (SCHEMA) และกฎของโปรเจกต์
 * - ทุกชีตมีรหัสอ้างอิงเฉพาะ / ชนิดคอลัมน์ถูกต้อง / จำนวนเงินที่บันทึกแล้วแก้ไม่ได้
 * - ชื่อฟังก์ชันและตัวแปรระดับไฟล์ไม่ชนกันข้ามไฟล์ (Apps Script ใช้ขอบเขตเดียวกันทุกไฟล์)
 * - มีเฉพาะฟังก์ชันที่ตั้งใจเท่านั้นที่เรียกจากหน้าเว็บได้ (ชื่อไม่ลงท้ายด้วย _)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createEnv, plain, listSourceFiles, SRC_DIR } = require('./harness');

const h = createEnv({ withSpreadsheet: false });
const SCHEMA = h.run('SCHEMA');
const SHEET_ORDER = plain(h.run('SHEET_ORDER'));
const TYPES = ['id', 'text', 'enum', 'money', 'int', 'bool', 'date', 'datetime', 'json'];
const SYSTEM_COLUMNS = ['CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];

/** ฟังก์ชันที่อนุญาตให้เรียกจากภายนอก (google.script.run / เมนู / ทริกเกอร์) */
const PUBLIC_FUNCTIONS = ['doGet', 'onOpen', 'api', 'SetupDatabase', 'menuSetupDatabase', 'menuVerifyAuditLog',
  'menuSetupAdmin', 'ownerSetupAdmin'];

test('มีครบ 12 ชีตตามข้อกำหนด และอีก 3 ชีตที่ออกแบบเพิ่ม', () => {
  const required = ['Users', 'Students', 'AcademicYears', 'FeeSettings', 'FeeAssessments', 'Payments',
    'PaymentAllocations', 'ReceiptBooks', 'ReceiptEntries', 'ReceiptCancellations', 'AuditLogs', 'SchoolSettings'];
  required.forEach((name) => assert.ok(SHEET_ORDER.includes(name), 'ขาดชีต ' + name));
  ['Enrollments', 'FeeAdjustments', 'ApprovalRequests'].forEach((name) => assert.ok(SHEET_ORDER.includes(name)));
  assert.equal(SHEET_ORDER.length, 15);
  assert.deepEqual([...Object.keys(SCHEMA)].sort(), [...SHEET_ORDER].sort());
});

test('ทุกชีต: คอลัมน์แรกเป็นรหัสอ้างอิง ชื่อไม่ซ้ำ ชนิดถูกต้อง และกฎอ้างคอลัมน์ที่มีอยู่จริง', () => {
  SHEET_ORDER.forEach((name) => {
    const def = SCHEMA[name];
    const s = h.gas.getSchema_(name);
    const names = s.columnNames;
    assert.equal(s.columns[0].type, 'id', name + ': คอลัมน์แรกต้องเป็นรหัสอ้างอิง');
    assert.equal(new Set(names).size, names.length, name + ': ชื่อคอลัมน์ซ้ำ');
    assert.ok(s.label, name + ': ไม่มีชื่อภาษาไทย');
    s.columns.forEach((c) => {
      assert.ok(TYPES.includes(c.type), name + '.' + c.name + ': ชนิด ' + c.type + ' ไม่ถูกต้อง');
      assert.ok(c.note && c.note.length > 1, name + '.' + c.name + ': ไม่มีคำอธิบายภาษาไทย');
      assert.match(c.name, /^[A-Z][A-Za-z]+$/, name + '.' + c.name + ': ชื่อคอลัมน์ต้องเป็นภาษาอังกฤษ PascalCase');
      if (c.type === 'enum') assert.ok(c.values && c.values.length > 0, name + '.' + c.name + ': enum ไม่มีรายการค่า');
    });
    (def.unique || []).forEach((rule) => {
      rule.cols.forEach((c) => assert.ok(names.includes(c), name + ': unique อ้างคอลัมน์ ' + c + ' ที่ไม่มี'));
      assert.ok(rule.message, name + ': กฎ unique ต้องมีข้อความภาษาไทย');
      if (rule.skipStatus) assert.ok(names.includes('Status'), name + ': skipStatus ต้องมีคอลัมน์ Status');
    });
    Object.keys(s.mutableSet).forEach((c) => {
      assert.ok(names.includes(c), name + ': mutable อ้างคอลัมน์ ' + c + ' ที่ไม่มี');
      assert.notEqual(c, s.idColumn, name + ': รหัสอ้างอิงต้องแก้ไขไม่ได้');
      assert.ok(!SYSTEM_COLUMNS.includes(c), name + ': คอลัมน์ระบบต้องแก้ไขไม่ได้');
    });
    s.secret.forEach((c) => assert.ok(names.includes(c)));
    Object.keys(s.auditExemptSet).forEach((c) => assert.ok(names.includes(c)));
    if (name !== 'AuditLogs') {
      assert.ok(names.includes('CreatedAt') && names.includes('CreatedBy'), name + ': ต้องมี CreatedAt/CreatedBy');
    }
    assert.ok(names.length <= 26, name + ': คอลัมน์เกินขนาดเริ่มต้นของชีต (ระบบรองรับได้ แต่ควรตรวจ)');
  });
});

test('จำนวนเงินที่บันทึกแล้วแก้ไขไม่ได้ (ห้ามเขียนทับยอดเดิม)', () => {
  const immutableMoney = [
    ['Payments', 'Amount'],
    ['PaymentAllocations', 'Amount'],
    ['FeeAssessments', 'GrossAmount'],
    ['FeeAdjustments', 'Amount'],
    ['ReceiptCancellations', 'Amount'],
  ];
  immutableMoney.forEach(([sheet, col]) => {
    assert.equal(h.gas.getSchema_(sheet).mutableSet[col], undefined, sheet + '.' + col + ' ต้องแก้ไขไม่ได้');
  });
  assert.deepEqual(Object.keys(h.gas.getSchema_('AuditLogs').mutableSet), [], 'AuditLogs ต้องแก้ไขไม่ได้เลย');
  assert.equal(h.gas.getSchema_('AuditLogs').writeVia, 'audit');
});

test('ค่าตั้งค่าเริ่มต้น: key ไม่ซ้ำ และค่าเริ่มต้นตรงกับการตัดสินใจใน docs/DECISIONS.md', () => {
  const defs = plain(h.run('SETTINGS_DEFS'));
  const keys = defs.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
  const byKey = Object.fromEntries(defs.map((d) => [d.key, d]));
  assert.equal(byKey.GRADE_LEVELS.defaultValue, 'อ.1,อ.2,อ.3,ป.1,ป.2,ป.3,ป.4,ป.5,ป.6');
  ['APPROVAL_FEE_ADJUSTMENT', 'APPROVAL_ASSESSMENT_CANCEL', 'APPROVAL_RECEIPT_CANCEL', 'APPROVAL_PAYMENT_CORRECTION', 'APPROVAL_BOOK_CLOSE']
    .forEach((k) => assert.equal(byKey[k].defaultValue, 'TRUE', k + ' ต้องให้ผู้อำนวยการอนุมัติเป็นค่าเริ่มต้น'));
  assert.equal(byKey.RECEIPT_STRICT_SEQUENCE.defaultValue, 'TRUE', 'ใช้ใบเสร็จเรียงเลขที่เคร่งครัดเป็นค่าเริ่มต้น');
  defs.forEach((d) => assert.ok(['text', 'int', 'bool', 'list', 'year'].includes(d.type), d.key));
});

/** อ่านชื่อที่ประกาศระดับไฟล์ (เริ่มที่คอลัมน์แรกของบรรทัด) */
function topLevelNames(file) {
  const src = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
  const names = [];
  src.split('\n').forEach((line) => {
    let m = /^function\s+([A-Za-z0-9_$]+)\s*\(/.exec(line);
    if (m) names.push({ name: m[1], kind: 'function' });
    m = /^(?:const|let|var)\s+([A-Za-z0-9_$]+)/.exec(line);
    if (m) names.push({ name: m[1], kind: 'variable' });
  });
  return names;
}

test('ชื่อระดับไฟล์ไม่ชนกันข้ามไฟล์ (ใน Apps Script ฟังก์ชันชื่อซ้ำจะทับกันเงียบ ๆ)', () => {
  const owner = new Map();
  listSourceFiles().forEach((file) => {
    topLevelNames(file).forEach(({ name }) => {
      assert.ok(!owner.has(name), 'ชื่อ ' + name + ' ซ้ำกันใน ' + owner.get(name) + ' และ ' + file);
      owner.set(name, file);
    });
  });
});

test('เฉพาะฟังก์ชันที่ตั้งใจเท่านั้นที่เรียกจากภายนอกได้ (ชื่อไม่ลงท้ายด้วย _)', () => {
  const exposed = [];
  listSourceFiles().forEach((file) => {
    topLevelNames(file).filter((n) => n.kind === 'function' && !n.name.endsWith('_')).forEach((n) => exposed.push(n.name));
  });
  assert.deepEqual(exposed.sort(), [...PUBLIC_FUNCTIONS].sort());
});

test('โหลดไฟล์ได้ทุกลำดับ (ไม่มีโค้ดระดับไฟล์ที่พึ่งไฟล์อื่น)', () => {
  const reversed = listSourceFiles().reverse();
  assert.doesNotThrow(() => createEnv({ files: reversed, withSpreadsheet: false }));
});

test('appsscript.json: เขตเวลาไทย, V8 และสิทธิ์เท่าที่จำเป็น', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'appsscript.json'), 'utf8'));
  assert.equal(manifest.timeZone, 'Asia/Bangkok');
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING', 'ต้องทำงานในนามเจ้าของระบบ ไม่ใช่ผู้ใช้');
  assert.deepEqual(manifest.oauthScopes.sort(), [
    'https://www.googleapis.com/auth/script.container.ui',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email',
  ]);
});
