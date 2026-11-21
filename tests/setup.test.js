'use strict';
/** ทดสอบ SetupDatabase(): สร้างโครงสร้าง รันซ้ำได้อย่างปลอดภัย และป้องกันผู้ที่ไม่ใช่เจ้าของ */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, createInstalledEnv, plain } = require('./harness');

const OFFICER = { userId: 'USR-TEST', username: 'finance1', role: 'FINANCE' };
const isCode = (code) => (e) => e && e.name === 'AppError' && e.code === code;

function freshEnv() {
  const h = createEnv();
  h.setNow('2026-11-21T10:00:00+07:00');
  return h;
}

test('ติดตั้งครั้งแรก: สร้าง 15 ชีตพร้อมหัวตารางตามลำดับใน SCHEMA', () => {
  const h = freshEnv();
  const report = plain(h.gas.SetupDatabase());
  assert.equal(report.sheets.length, 15);
  assert.ok(report.sheets.every((s) => s.action === 'created'));
  assert.equal(report.changed, true);
  h.run('SHEET_ORDER').forEach((name) => {
    const sheet = h.sheet(name);
    assert.ok(sheet, 'ไม่พบชีต ' + name);
    const expected = plain(h.gas.getSchema_(name).columnNames);
    assert.deepEqual(sheet._rowValues(1), expected, name);
  });
  assert.ok(h.sheet('Sheet1'), 'ไม่ลบชีตเดิมที่มีอยู่ในไฟล์');
});

test('หัวตาราง: ตรึงแถว มีคำอธิบายภาษาไทย สีกรมท่า และคำเตือนเมื่อแก้ไขด้วยมือ', () => {
  const h = freshEnv();
  h.gas.SetupDatabase();
  const sheet = h.sheet('Payments');
  assert.equal(sheet.getFrozenRows(), 1);
  assert.match(sheet.getRange(1, 5).getNote(), /จำนวนเงินที่รับจริง/);
  assert.equal(sheet._peek(1, 1).style.background, '#1F3A5F');
  const protections = sheet.getProtections('SHEET');
  assert.equal(protections.length, 1);
  assert.equal(protections[0].isWarningOnly(), true);
  // รูปแบบคอลัมน์: ข้อความเป็น Plain text, เงินเป็นทศนิยม 2 ตำแหน่ง
  assert.equal(sheet.getRange(500, 2).getNumberFormat(), '@');
  assert.equal(sheet.getRange(500, 5).getNumberFormat(), '#,##0.00');
});

test('สร้างค่าตั้งค่าเริ่มต้นครบ และปีการศึกษาปัจจุบันคำนวณจากวันที่ติดตั้ง', () => {
  const h = freshEnv();
  h.gas.SetupDatabase();
  h.newExecution();
  const settings = Object.fromEntries(h.gas.dbAll_('SchoolSettings').map((r) => [r.SettingKey, r.Value]));
  assert.equal(Object.keys(settings).length, h.run('SETTINGS_DEFS.length'));
  assert.equal(Object.keys(settings).length, 23);
  assert.equal(settings.RECEIPT_STRICT_SEQUENCE, 'TRUE');
  assert.equal(settings.APPROVAL_BOOK_CLOSE, 'TRUE');
  assert.equal(settings.SCHOOL_NAME, 'โรงเรียนวัดเสาหิน');
  assert.equal(settings.CURRENT_ACADEMIC_YEAR, '2569');
  assert.equal(settings.APPROVAL_RECEIPT_CANCEL, 'TRUE');
  assert.equal(settings.RECEIPT_LOW_WARNING, '5', 'ค่าตัวเลขเก็บเป็นข้อความ ไม่ถูกแปลง');

  const h2 = createEnv();
  h2.setNow('2027-02-10T09:00:00+07:00'); // ภาคเรียนที่ 2 ของปีการศึกษา 2569
  h2.gas.SetupDatabase();
  h2.newExecution();
  assert.equal(h2.gas.dbGet_('SchoolSettings', 'CURRENT_ACADEMIC_YEAR').Value, '2569');
});

test('สร้างค่าระบบใน Script Properties โดยไม่แสดงค่าลับในรายงานหรือ Log', () => {
  const h = freshEnv();
  const report = plain(h.gas.SetupDatabase());
  assert.deepEqual(report.propertiesInitialized, ['DB_SPREADSHEET_ID', 'AUTH_MODE', 'PASSWORD_PEPPER']);
  const props = h.env.props;
  assert.equal(props.get('DB_SPREADSHEET_ID'), h.env.activeSpreadsheet.getId());
  assert.equal(props.get('AUTH_MODE'), 'PASSWORD');
  const pepper = props.get('PASSWORD_PEPPER');
  assert.match(pepper, /^[0-9a-f]{64}$/);
  assert.ok(props.get('AUDIT_HEAD'));
  const everything = JSON.stringify(report) + h.env.logs.map((l) => l.text).join('\n') +
    h.sheet('AuditLogs').getDataRange().getValues().flat().join('|');
  assert.ok(!everything.includes(pepper), 'ห้ามมีค่า pepper ในรายงาน Log หรือ AuditLogs');
});

test('รันซ้ำได้อย่างปลอดภัย: ไม่มีการเปลี่ยนแปลง ไม่เพิ่มค่าซ้ำ ไม่เปลี่ยนค่าลับ และข้อมูลเดิมอยู่ครบ', () => {
  const h = freshEnv();
  h.gas.SetupDatabase();
  const pepper = h.env.props.get('PASSWORD_PEPPER');
  h.newExecution();
  const saved = h.gas.withScriptLock_(() => h.gas.dbInsert_('Students', { StudentNo: '001', FirstName: 'สมชาย', Status: 'STUDYING' }, OFFICER));
  h.gas.withScriptLock_(() => h.gas.dbUpdate_('SchoolSettings', 'SCHOOL_ADDRESS', { Value: 'ต.ตัวอย่าง อ.ตัวอย่าง' }, OFFICER));

  h.newExecution();
  const report = plain(h.gas.SetupDatabase());
  assert.equal(report.changed, false);
  assert.ok(report.sheets.every((s) => s.action === 'ok'));
  assert.deepEqual(report.settingsAdded, []);
  assert.deepEqual(report.propertiesInitialized, []);
  assert.equal(h.env.props.get('PASSWORD_PEPPER'), pepper);

  h.newExecution();
  assert.equal(h.gas.dbAll_('SchoolSettings').length, 23);
  assert.equal(h.gas.dbGet_('SchoolSettings', 'SCHOOL_ADDRESS').Value, 'ต.ตัวอย่าง อ.ตัวอย่าง', 'ไม่เขียนทับค่าที่ตั้งไว้');
  assert.equal(h.gas.dbGet_('Students', saved.StudentId).FirstName, 'สมชาย');
  const verify = plain(h.gas.auditVerifyChain_());
  assert.equal(verify.ok, true);
  const setups = h.gas.dbFind_('AuditLogs', (r) => r.Action === 'SETUP');
  assert.equal(setups.length, 2, 'บันทึกการรันติดตั้งทุกครั้ง');
  assert.match(setups[1].Note, /ไม่มีการเปลี่ยนแปลง/);
});

test('ชีตรุ่นเก่าที่ขาดคอลัมน์: เพิ่มคอลัมน์ต่อท้าย ข้อมูลเดิมไม่เปลี่ยน และคอลัมน์ที่ไม่รู้จักไม่ถูกลบ', () => {
  const h = freshEnv();
  const ss = h.env.activeSpreadsheet;
  const old = ss.insertSheet('Students');
  old.getRange(1, 1, 1, 6).setValues([['StudentId', 'StudentNo', 'FirstName', 'LastName', 'Status', 'หมายเหตุครู']]);
  old.getRange(2, 1, 1, 6).setNumberFormats([['@', '@', '@', '@', '@', '@']]);
  old.getRange(2, 1, 1, 6).setValues([['STU-20260101000000-ABCDEF', '0099', 'มานี', 'มีนา', 'STUDYING', 'ข้อมูลเดิม']]);

  const report = plain(h.gas.SetupDatabase());
  const students = report.sheets.find((s) => s.name === 'Students');
  assert.equal(students.action, 'columns_added');
  assert.deepEqual(students.addedColumns, ['Prefix', 'StatusDate', 'StatusNote', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy']);
  assert.deepEqual(students.extraColumns, ['หมายเหตุครู']);
  const header = old._rowValues(1);
  assert.deepEqual(header.slice(0, 6), ['StudentId', 'StudentNo', 'FirstName', 'LastName', 'Status', 'หมายเหตุครู'], 'คอลัมน์เดิมอยู่ตำแหน่งเดิม');
  assert.equal(old.getRange(2, 6).getValue(), 'ข้อมูลเดิม');

  h.newExecution();
  const rec = h.gas.dbGet_('Students', 'STU-20260101000000-ABCDEF');
  assert.equal(rec.StudentNo, '0099');
  assert.equal(rec.FirstName, 'มานี');
  assert.equal(rec.Prefix, '');
  // เพิ่มข้อมูลใหม่ได้ตามปกติ และคอลัมน์ที่ไม่รู้จักเป็นค่าว่าง
  h.gas.withScriptLock_(() => h.gas.dbInsert_('Students', { StudentNo: '0100', FirstName: 'ปิติ', Status: 'STUDYING' }, OFFICER));
  assert.equal(old.getRange(3, 6).getValue(), '');
  assert.equal(old.getRange(3, 2).getValue(), '0100');
});

test('ชีตที่มีข้อมูลแต่ไม่มีหัวตาราง: หยุดทันทีโดยไม่แก้ข้อมูล', () => {
  const h = freshEnv();
  const ss = h.env.activeSpreadsheet;
  const broken = ss.insertSheet('Payments');
  broken._rawSet(2, 1, 'ข้อมูลที่ไม่มีหัวตาราง');
  assert.throws(() => h.gas.SetupDatabase(), (e) => /Payments/.test(e.message) && /ไม่มีหัวตาราง/.test(e.message));
  assert.equal(broken.getRange(2, 1).getValue(), 'ข้อมูลที่ไม่มีหัวตาราง');
  assert.equal(broken.getRange(1, 1).getValue(), '');
});

test('หัวคอลัมน์ของระบบซ้ำกัน: แจ้งให้แก้ไข', () => {
  const h = freshEnv();
  const ss = h.env.activeSpreadsheet;
  ss.insertSheet('Users').getRange(1, 1, 1, 3).setValues([['UserId', 'Username', 'Username']]);
  assert.throws(() => h.gas.SetupDatabase(), (e) => /Username/.test(e.message) && /ซ้ำ/.test(e.message));
});

test('ป้องกันการเรียกจากเว็บหรือผู้ที่ไม่ใช่เจ้าของ (activeUser ต้องตรงกับ effectiveUser)', () => {
  const cases = [
    ['', 'owner@example.com'],                  // ผู้ใช้ไม่ระบุตัวตนเรียกผ่านเว็บแอปแบบ Execute as Me
    ['visitor@example.com', 'owner@example.com'], // ผู้ใช้อื่นในโดเมนเดียวกัน
    ['', ''],
  ];
  cases.forEach(([active, effective]) => {
    const h = freshEnv();
    h.setUsers(active, effective);
    assert.throws(() => h.gas.SetupDatabase(), isCode('FORBIDDEN'));
    assert.equal(h.sheet('Users'), null, 'ต้องไม่สร้างอะไรเลย');
    assert.equal(h.env.props.size, 0);
  });
  const ok = freshEnv();
  ok.setUsers('Owner@Example.com', 'owner@example.com');
  assert.doesNotThrow(() => ok.gas.SetupDatabase(), 'ตัวพิมพ์เล็กใหญ่ของอีเมลไม่มีผล');
});

test('มีผู้ใช้อื่นถือ lock อยู่: แจ้งให้ลองใหม่ และไม่สร้างอะไร', () => {
  const h = freshEnv();
  h.env.lockContended = true;
  assert.throws(() => h.gas.SetupDatabase(), isCode('LOCK_TIMEOUT'));
  assert.equal(h.sheet('Users'), null);
});

test('ใช้ไฟล์ตาม DB_SPREADSHEET_ID ถ้ามีการกำหนดไว้ (เช่น หลังกู้คืนข้อมูล)', () => {
  const h = freshEnv();
  const other = h.newSpreadsheet('ไฟล์ฐานข้อมูลที่กู้คืน');
  h.env.props.set('DB_SPREADSHEET_ID', other.getId());
  const report = plain(h.gas.SetupDatabase());
  assert.equal(report.spreadsheetName, 'ไฟล์ฐานข้อมูลที่กู้คืน');
  assert.ok(other.getSheetByName('Payments'));
  assert.equal(h.sheet('Payments'), null, 'ไม่แตะไฟล์ที่ผูกสคริปต์');
});

test('เมนูใน Google Sheets: แสดงเมนู ยืนยันก่อนติดตั้ง และยกเลิกได้', () => {
  const h = freshEnv();
  h.gas.onOpen();
  assert.equal(h.env.menus.length, 1);
  assert.equal(h.env.menus[0].title, 'ระบบเงินบำรุงการศึกษา');
  assert.deepEqual(h.env.menus[0].items.map((i) => i.fn), ['menuSetupDatabase', 'menuVerifyAuditLog']);

  h.env.uiResponses.push('NO');
  h.gas.menuSetupDatabase();
  assert.equal(h.sheet('Users'), null, 'กด "ไม่" ต้องไม่ติดตั้ง');

  h.env.uiResponses.push('YES');
  h.gas.menuSetupDatabase();
  assert.ok(h.sheet('Users'));
  const last = h.env.alerts[h.env.alerts.length - 1];
  assert.equal(last.title, 'ผลการติดตั้งฐานข้อมูล');
  assert.match(last.message, /สร้างชีตใหม่ 15 ชีต/);

  h.newExecution();
  h.gas.menuVerifyAuditLog();
  assert.match(h.env.alerts[h.env.alerts.length - 1].message, /^ถูกต้อง: ประวัติการใช้งาน 24 รายการ/);
});

test('เมนูแสดงข้อผิดพลาดเป็นข้อความภาษาไทยแทนการหยุดทำงาน', () => {
  const h = freshEnv();
  h.setUsers('visitor@example.com', 'owner@example.com');
  h.env.uiResponses.push('YES');
  h.gas.menuSetupDatabase();
  const last = h.env.alerts[h.env.alerts.length - 1];
  assert.equal(last.title, 'ติดตั้งไม่สำเร็จ');
  assert.match(last.message, /เฉพาะเจ้าของระบบ/);
});

test('doGet ระยะที่ 1: หน้าสถานะที่ไม่มีข้อมูลใด ๆ และรองรับมือถือ', () => {
  const h = createInstalledEnv({ now: '2026-11-21T10:00:00+07:00' });
  const out = h.gas.doGet({});
  assert.equal(out.getTitle(), 'ระบบบริหารจัดเก็บเงินบำรุงการศึกษา');
  assert.equal(out._metas.viewport, 'width=device-width, initial-scale=1');
  assert.match(out.getContent(), /อยู่ระหว่างการติดตั้ง/);
  assert.doesNotMatch(out.getContent(), /STU-|PAY-|SCHOOL_|PASSWORD/);
});
