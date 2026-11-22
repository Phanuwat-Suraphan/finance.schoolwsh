'use strict';
/**
 * ทดสอบการสำรองและกู้คืนข้อมูล (ระยะที่ 7, ข้อกำหนดข้อ 12)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupFinance } = require('./finance-helpers');
const { plain, createEnv } = require('./harness');

function ready() {
  const t = setupFinance();
  const a = t.student('10001', 'เอ', 'ป.1');
  t.generate(t.feeOne().feeSettingId);
  t.book('1/2569', 1, 50);
  t.pay(a.studentId, 200);
  return { t, h: t.h, a };
}

function backupSheetNames(h, fileId) {
  return h.env.spreadsheets.get(fileId).getSheets().map((s) => s.getName());
}

function triggerUid(h) {
  return h.env.triggers.find((x) => x.getHandlerFunction() === 'dailyBackup').getUniqueId();
}

test('ติดตั้งแล้วมีการสำรองอัตโนมัติทุกวันเวลา 18:00 น. และไม่สร้างซ้ำเมื่อรันติดตั้งอีกครั้ง', () => {
  const { t, h } = ready();
  assert.equal(h.env.triggers.length, 1);
  const spec = h.env.triggers[0]._spec;
  assert.deepEqual([spec.fn, spec.everyDays, spec.atHour, spec.timezone], ['dailyBackup', 1, 18, 'Asia/Bangkok']);
  h.newExecution();
  h.gas.SetupDatabase();
  assert.equal(h.env.triggers.length, 1, 'รันติดตั้งซ้ำไม่สร้างตัวตั้งเวลาเพิ่ม');

  const off = h.ok('backups.setSchedule', { enabled: false }, t.admin);
  assert.equal(off.schedule.enabled, false);
  assert.equal(h.env.triggers.length, 0);
  h.newExecution();
  h.gas.SetupDatabase();
  assert.equal(h.env.triggers.length, 0, 'ผู้ดูแลระบบปิดไว้ ติดตั้งซ้ำต้องไม่เปิดให้เอง');
  const on = h.ok('backups.setSchedule', { enabled: true, hour: 20 }, t.admin);
  assert.deepEqual([on.schedule.enabled, on.schedule.hour, on.schedule.hourLabel, on.schedule.triggerFound], [true, 20, '20:00–21:00 น.', true]);
  assert.equal(h.env.triggers.length, 1);
  assert.match(h.api('backups.setSchedule', { enabled: true, hour: 24 }, t.admin).error.message, /ไม่มากกว่า 23/);
  const audit = h.auditRows().filter((r) => r.Action === 'BACKUP_SCHEDULE');
  assert.equal(audit.length, 2);
});

test('สำรองข้อมูลตอนนี้: ไฟล์ใหม่ในโฟลเดอร์สำรอง มีครบทุกชีตและชีตข้อมูลไฟล์สำรอง ไม่มีชีตว่างเริ่มต้น', () => {
  const { t, h } = ready();
  const res = h.ok('backups.create', {}, t.admin);
  const b = res.backup;
  assert.equal(b.kind, 'MANUAL');
  assert.equal(b.name, 'สำรองข้อมูล_2569-11-21_1000_สำรองเอง');
  assert.equal(b.createdBy, 'ผู้ดูแลระบบ ทดสอบ');
  const sheets = backupSheetNames(h, b.fileId);
  assert.deepEqual(sheets, plain(h.run('SHEET_ORDER')).concat(['_ข้อมูลไฟล์สำรอง']));
  const ss = h.env.spreadsheets.get(b.fileId);
  assert.deepEqual(ss.getSheetByName('Payments').getDataRange().getValues().length, 2, 'หัวตาราง + การรับเงิน 1 รายการ');
  const info = ss.getSheetByName('_ข้อมูลไฟล์สำรอง').getDataRange().getValues();
  assert.deepEqual(info.slice(1, 4).map((r) => [r[0], r[1]]), [['app', 'school-fee-backup'], ['kind', 'MANUAL'], ['createdAt', '2026-11-21 10:00:00']]);
  assert.equal(info.some((r) => String(r[1]).includes('PEPPER')), false);

  const list = h.ok('backups.list', {}, t.admin);
  assert.equal(list.folder.name, 'สำรองข้อมูล ระบบเงินบำรุงการศึกษา – ฐานข้อมูลทดสอบ', 'ชื่อโฟลเดอร์มีชื่อไฟล์ฐานข้อมูลต่อท้าย');
  assert.deepEqual(list.backups.map((x) => x.fileId), [b.fileId]);
  assert.equal(list.backups[0].rows > 0, true);
  assert.equal(list.retention, 60);
  assert.deepEqual(list.excludedSheets.map((x) => x.name), ['Users', 'AuditLogs']);
  const status = h.ok('backups.status', {}, t.admin);
  assert.equal(status.last.name, b.name);
  assert.equal(h.env.stats.foldersCreated, 1);
  h.ok('backups.create', {}, t.admin);
  assert.equal(h.env.stats.foldersCreated, 1, 'ใช้โฟลเดอร์เดิม');
  assert.equal(h.auditRows().filter((r) => r.Action === 'BACKUP').length, 2);
  assert.equal(h.api('backups.create', {}, t.fin).error.code, 'FORBIDDEN');
});

test('สำรองอัตโนมัติ: เรียกได้จากตัวตั้งเวลาของระบบหรือเจ้าของระบบเท่านั้น และเก็บไฟล์ตามจำนวนที่ตั้งไว้', () => {
  const { t, h } = ready();
  t.setSetting({ BACKUP_RETENTION: '7' });
  h.ok('backups.create', {}, t.admin); // ไฟล์สำรองเอง ต้องไม่ถูกลบ
  const uid = triggerUid(h);

  h.setUsers('', 'owner@example.com'); // ผู้ใช้ภายนอก (ไม่มีอีเมล) เรียกผ่าน google.script.run
  h.newExecution();
  assert.throws(() => h.gas.dailyBackup({ triggerUid: 'wrong' }), (e) => /เจ้าของระบบ/.test(e.userMessage));
  h.newExecution();
  assert.throws(() => h.gas.dailyBackup(), (e) => /เจ้าของระบบ/.test(e.userMessage));

  for (let d = 1; d <= 10; d++) {
    h.setNow('2026-11-' + String(d).padStart(2, '0') + 'T18:20:00+07:00');
    h.newExecution();
    const r = plain(h.gas.dailyBackup({ triggerUid: uid }));
    assert.equal(r.ok, true);
  }
  h.setUsers('owner@example.com');
  h.setNow('2026-11-21T18:30:00+07:00');
  const admin = h.adminToken();
  const list = h.ok('backups.list', {}, admin);
  const autos = list.backups.filter((b) => b.kind === 'AUTO').map((b) => b.createdAt.slice(0, 10));
  assert.deepEqual(autos, ['2026-11-10', '2026-11-09', '2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05', '2026-11-04', '2026-11-01'],
    'เก็บ 7 ไฟล์ล่าสุด และไฟล์แรกของเดือน');
  assert.equal(list.backups.filter((b) => b.kind === 'MANUAL').length, 1);
  assert.equal(list.lastAuto.ok, true);
  assert.equal(h.auditRows().filter((r) => r.Action === 'BACKUP_CLEANUP').length, 2);
  // ไฟล์ที่เกินถูกย้ายไปถังขยะ (ไม่ลบถาวร)
  const trashed = Array.from(h.env.driveMeta.values()).filter((m) => m.trashed).length;
  assert.equal(trashed, 2);

  // เจ้าของระบบสั่งเองได้ (จาก Apps Script Editor)
  h.newExecution();
  assert.equal(plain(h.gas.dailyBackup()).ok, true);
});

test('Google Drive ยังไม่ได้รับอนุญาต: แจ้งวิธีแก้เป็นภาษาไทย ไม่แสดงข้อความดิบ และบันทึกผลสำรองอัตโนมัติที่ล้มเหลว', () => {
  const { t, h } = ready();
  h.env.driveFailure = 'Exception: You do not have permission to call DriveApp.createFolder. Required permissions: https://www.googleapis.com/auth/drive';
  const res = h.api('backups.create', {}, t.admin);
  assert.equal(res.ok, false);
  assert.match(res.error.message, /ยังไม่ได้อนุญาตสิทธิ์ "Google ไดรฟ์/);
  assert.doesNotMatch(res.error.message, /googleapis|Exception/);
  h.newExecution();
  assert.throws(() => h.gas.dailyBackup({ triggerUid: triggerUid(h) }));
  h.env.driveFailure = null;
  const status = h.ok('backups.status', {}, t.admin);
  assert.equal(status.lastAuto.ok, false);
  assert.match(status.lastAuto.message, /Google ไดรฟ์/);
  assert.equal(h.auditRows().filter((r) => r.Action === 'BACKUP').length, 0);
});

test('กู้คืนข้อมูล: ตรวจผลกระทบก่อน สำรอง "ก่อนกู้คืน" ข้อมูลย้อนกลับ แต่บัญชีผู้ใช้และประวัติไม่ย้อน', () => {
  const { t, h, a } = ready();
  const backup = h.ok('backups.create', {}, t.admin).backup;

  // หลังสำรอง: รับเงินเพิ่ม เพิ่มนักเรียน แก้ค่าตั้งค่า และเพิ่มผู้ใช้
  t.pay(a.studentId, 300);
  t.student('10002', 'บี', 'ป.1');
  t.setSetting({ SCHOOL_PHONE: '053-000000' });
  const newUser = h.addUser(t.admin, 'FINANCE', 'finance2');

  const preview = h.ok('backups.restorePreview', { fileId: backup.fileId }, t.admin);
  assert.equal(preview.valid, true);
  assert.deepEqual(preview.problems, []);
  const pay = preview.sheets.find((s) => s.name === 'Payments');
  assert.deepEqual([pay.backupRows, pay.currentRows], [1, 2]);
  assert.equal(preview.sheets.some((s) => s.name === 'Users' || s.name === 'AuditLogs'), false);
  assert.equal(preview.since.total > 0, true);
  assert.equal(preview.since.items.find((i) => i.entity === 'Payments').count, 1);
  assert.equal(preview.since.items.some((i) => i.entity === 'Users'), false);

  assert.match(h.api('backups.restore', { fileId: backup.fileId, confirmText: 'กู้คืน' }, t.admin).error.message, /กู้คืนข้อมูล/);
  const res = h.ok('backups.restore', { fileId: backup.fileId, confirmText: 'กู้คืนข้อมูล' }, t.admin);
  assert.match(res.message, /ทุกคนต้องเข้าสู่ระบบใหม่/);
  assert.equal(res.preRestore.kind, 'PRE_RESTORE');
  assert.equal(res.restored.Payments, 1);

  // ทุก session ถูกยกเลิก
  const expired = h.api('auth.me', {}, t.fin);
  assert.equal(expired.error.code, 'UNAUTHENTICATED');
  assert.match(expired.error.message, /กู้คืนข้อมูล/);

  // ข้อมูลย้อนกลับ ณ เวลาสำรอง
  assert.equal(t.rows('Payments').length, 1);
  assert.equal(t.rows('Students').length, 1);
  assert.equal(t.rows('SchoolSettings').find((r) => r.SettingKey === 'SCHOOL_PHONE').Value, '');
  // บัญชีผู้ใช้ไม่ย้อน: ผู้ใช้ที่เพิ่มหลังสำรองยังเข้าสู่ระบบได้
  assert.ok(h.login('finance2', newUser.password));
  // ประวัติการใช้งานต่อเนื่อง ลูกโซ่ไม่ขาด และมีรายการกู้คืนล่าสุด
  h.newExecution();
  assert.equal(plain(h.gas.auditVerifyChain_()).ok, true);
  const audit = h.auditRows();
  const last = audit.filter((r) => r.Action === 'RESTORE').pop();
  assert.match(last.Note, /ข้อมูลก่อนกู้คืนเก็บไว้ในไฟล์ สำรองข้อมูล_2569-11-21_1000_ก่อนกู้คืน/);
  assert.ok(audit.some((r) => r.Entity === 'Payments' && r.Action === 'CREATE' && r.Timestamp >= backup.createdAt), 'ประวัติการรับเงินหลังสำรองยังอยู่');

  // เลขที่ใบเสร็จที่ใช้หลังเวลาสำรองกลับมาว่าง ต้องบันทึกใหม่ตามสำเนาใบเสร็จ
  t.fin = h.login('finance1', 'Better2569pw');
  assert.equal(t.context(a.studentId).book.nextNo, 2);

  // ย้อนการกู้คืนด้วยไฟล์ "ก่อนกู้คืน"
  const admin = h.adminToken();
  h.ok('backups.restore', { fileId: res.preRestore.fileId, confirmText: 'กู้คืนข้อมูล' }, admin);
  assert.equal(t.rows('Payments').length, 2);
  assert.equal(t.rows('Students').length, 2);
});

test('กู้คืนไม่ได้จากไฟล์นอกโฟลเดอร์สำรอง หรือไฟล์ที่ไม่สมบูรณ์ และข้อมูลจริงไม่ถูกแตะ', () => {
  const { t, h } = ready();
  const dbId = h.env.activeSpreadsheet.getId();
  assert.equal(h.api('backups.restorePreview', { fileId: dbId }, t.admin).error.code, 'NOT_FOUND', 'ยังไม่มีโฟลเดอร์สำรอง');
  const backup = h.ok('backups.create', {}, t.admin).backup;
  assert.equal(h.api('backups.restorePreview', { fileId: dbId }, t.admin).error.code, 'FORBIDDEN');
  assert.equal(h.api('backups.restore', { fileId: dbId, confirmText: 'กู้คืนข้อมูล' }, t.admin).error.code, 'FORBIDDEN');
  assert.equal(h.api('backups.restorePreview', { fileId: 'ไม่มี' }, t.admin).ok, false);

  // มีผู้แก้หัวตารางในไฟล์สำรอง
  const sheet = h.env.spreadsheets.get(backup.fileId).getSheetByName('Payments');
  const header = sheet._rowValues(1);
  sheet._rawSet(1, header.indexOf('Amount') + 1, 'จำนวนเงิน');
  const preview = h.ok('backups.restorePreview', { fileId: backup.fileId }, t.admin);
  assert.equal(preview.valid, false);
  assert.match(preview.problems[0], /Payments.*ขาดคอลัมน์ Amount/);
  const res = h.api('backups.restore', { fileId: backup.fileId, confirmText: 'กู้คืนข้อมูล' }, t.admin);
  assert.equal(res.error.code, 'CONFLICT');
  assert.equal(h.ok('backups.list', {}, t.admin).backups.filter((b) => b.kind === 'PRE_RESTORE').length, 0, 'ไม่เริ่มกู้คืนเลย');
  assert.equal(t.rows('Payments').length, 1);
  assert.equal(h.api('auth.me', {}, t.fin).ok, true, 'ไม่มีใครถูกออกจากระบบ');

  // คอลัมน์ที่ผู้ใช้เพิ่มเองในชีตจริง: แจ้งเตือนก่อนกู้คืนว่าข้อมูลในคอลัมน์นั้นจะถูกล้าง
  const live = h.sheet('Students');
  live._rawSet(1, live.getLastColumn() + 1, 'หมายเหตุครู');
  const good = h.ok('backups.create', {}, t.admin).backup;
  const warn = h.ok('backups.restorePreview', { fileId: good.fileId }, t.admin);
  assert.deepEqual(warn.extraColumns, [{ name: 'Students', label: 'นักเรียน', columns: ['หมายเหตุครู'] }]);

  // ไฟล์ในถังขยะใช้ไม่ได้
  h.gas.DriveApp.getFileById(backup.fileId).setTrashed(true);
  assert.equal(h.api('backups.restorePreview', { fileId: backup.fileId }, t.admin).error.code, 'FORBIDDEN');
  assert.equal(h.ok('backups.list', {}, t.admin).backups.length, 1, 'เหลือเฉพาะไฟล์ที่ไม่อยู่ในถังขยะ');
});

test('ติดตั้งโดยยังไม่ได้ติ๊กสิทธิ์ทำงานอัตโนมัติ: รายงานบอกวิธีแก้ และรันติดตั้งซ้ำหลังอนุญาตแล้วตั้งเวลาให้', () => {
  const h = createEnv();
  h.env.scriptAppFailure = 'Exception: คุณไม่ได้รับอนุญาตให้เรียกใช้ ScriptApp.getProjectTriggers สิทธิ์ที่จำเป็นคือ https://www.googleapis.com/auth/script.scriptapp';
  const first = plain(h.gas.SetupDatabase());
  assert.deepEqual(first.permissionsMissing, ['การทำงานเมื่อไม่ได้เปิดใช้ (ใช้ตั้งเวลาสำรองข้อมูลอัตโนมัติ)']);
  assert.equal(first.backupScheduleCreated, null);
  const log = h.env.logs.map((l) => l.text).join('\n');
  assert.match(log, /คำเตือน: ยังไม่ได้รับอนุญาตสิทธิ์: การทำงานเมื่อไม่ได้เปิดใช้/);
  assert.match(log, /ติ๊ก "เลือกทั้งหมด \(Select all\)"/);
  assert.equal(h.env.props.has('BACKUP_SCHEDULE'), false, 'ยังไม่บันทึกว่าตั้งค่าแล้ว');
  assert.equal(h.env.triggers.length, 0);

  // เจ้าของระบบอนุญาตครบแล้ว รันติดตั้งอีกครั้ง
  h.env.scriptAppFailure = null;
  h.newExecution();
  const second = plain(h.gas.SetupDatabase());
  assert.deepEqual(second.permissionsMissing, []);
  assert.equal(second.backupScheduleCreated, 18);
  assert.equal(h.env.triggers.length, 1);
});

test('หน้าเว็บ: ตั้งเวลาไม่ได้เพราะยังไม่ได้รับสิทธิ์ แจ้งชื่อสิทธิ์ที่ขาดและวิธีแก้ ไม่แสดงข้อความดิบของ Google', () => {
  const { t, h } = ready();
  h.env.scriptAppFailure = 'Exception: You do not have permission to call ScriptApp.getProjectTriggers. Required permissions: https://www.googleapis.com/auth/script.scriptapp';
  const res = h.api('backups.setSchedule', { enabled: true, hour: 18 }, t.admin);
  assert.equal(res.ok, false);
  assert.equal(res.error.reason, 'PERMISSION_MISSING');
  assert.match(res.error.message, /การทำงานเมื่อไม่ได้เปิดใช้/);
  assert.match(res.error.message, /เลือกทั้งหมด/);
  assert.doesNotMatch(res.error.message, /googleapis|Exception/);
});
