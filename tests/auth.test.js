'use strict';
/** ทดสอบการยืนยันตัวตน: รหัสผ่าน การล็อกเมื่อใส่ผิด session และการบังคับเปลี่ยนรหัสผ่าน */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppEnv } = require('./harness');

const GENERIC = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

test('แฮชรหัสผ่าน: รูปแบบ v1$รอบ$salt$hash ตรวจถูก/ผิดได้ และ salt ต่างกันทุกครั้ง', () => {
  const h = createAppEnv();
  const g = h.gas;
  const a = g.hashPassword_('Secret2569');
  const b = g.hashPassword_('Secret2569');
  assert.match(a, /^v1\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(a, b, 'salt ต้องต่างกัน');
  assert.equal(g.verifyPassword_('Secret2569', a).ok, true);
  assert.equal(g.verifyPassword_('secret2569', a).ok, false);
  assert.equal(g.verifyPassword_('Secret2569', 'v1$10$zz$abc').ok, false, 'รูปแบบผิดต้องไม่ผ่าน');
  assert.equal(g.verifyPassword_('Secret2569', '').ok, false);
  assert.equal(g.constantTimeEquals_('abc', 'abc'), true);
  assert.equal(g.constantTimeEquals_('abc', 'abd'), false);
  assert.equal(g.constantTimeEquals_('abc', 'abcd'), false);
});

test('นโยบายรหัสผ่าน', () => {
  const h = createAppEnv();
  const g = h.gas;
  const bad = (pw, re) => assert.throws(() => g.validateNewPassword_(pw, 'somchai'), (e) => e.code === 'VALIDATION' && re.test(e.message), pw);
  bad('', /กรุณากรอก/);
  bad('Ab1', /อย่างน้อย 8/);
  bad('abcdefgh', /ทั้งตัวอักษรและตัวเลข/);
  bad('12345678', /ทั้งตัวอักษรและตัวเลข/);
  bad(' Abcdefg1', /ช่องว่าง/);
  bad('xxSomchai2569', /ชื่อผู้ใช้/);
  bad('a1'.repeat(65), /ยาวเกิน/);
  assert.equal(g.validateNewPassword_('Better2569pw', 'somchai'), 'Better2569pw');
  assert.equal(g.validateNewPassword_('รหัสผ่านไทย2569', 'somchai'), 'รหัสผ่านไทย2569', 'รองรับตัวอักษรไทย');
});

test('เข้าสู่ระบบสำเร็จ: ได้ token สุ่ม ข้อมูลผู้ใช้ไม่มีค่าลับ และบันทึกประวัติ LOGIN', () => {
  const h = createAppEnv();
  const res = h.ok('auth.login', { username: '  ADMIN ', password: h.admin.password });
  assert.match(res.token, /^[0-9a-f]{64}$/);
  assert.equal(res.user.username, 'admin');
  assert.equal(res.mustChangePassword, false);
  const json = JSON.stringify(res);
  assert.doesNotMatch(json, /PasswordHash|SessionVersion|v1\$/);
  const rows = h.auditRows();
  assert.equal(rows[rows.length - 1].Action, 'LOGIN');
  assert.equal(rows[rows.length - 1].Username, 'admin');
  assert.ok(!rows.some((r) => r.Action === 'UPDATE' && r.Entity === 'Users'), 'เวลาเข้าสู่ระบบล่าสุดไม่สร้างประวัติแก้ไข');
  h.newExecution();
  assert.equal(h.gas.dbFindOne_('Users', (u) => u.Username === 'admin').LastLoginAt, '2026-11-21 10:00:00');
  assert.ok(![...h.env.cache.keys()].some((k) => k.indexOf(res.token) !== -1), 'ต้องเก็บค่าแฮชของ token ไม่ใช่ token จริง');
});

test('เข้าสู่ระบบไม่สำเร็จ: ข้อความเหมือนกันทั้งชื่อผู้ใช้ผิดและรหัสผ่านผิด และไม่บันทึกข้อความที่พิมพ์ผิดลงประวัติ', () => {
  const h = createAppEnv();
  const wrongPw = h.api('auth.login', { username: 'admin', password: 'nope1234' });
  const noUser = h.api('auth.login', { username: 'Secret#Pass99', password: 'nope1234' });
  assert.deepEqual(wrongPw.error, { code: 'UNAUTHENTICATED', message: GENERIC });
  assert.deepEqual(noUser.error, { code: 'UNAUTHENTICATED', message: GENERIC });
  const failed = h.auditRows().filter((r) => r.Action === 'LOGIN_FAILED');
  assert.equal(failed.length, 2);
  assert.equal(failed[0].Username, 'admin');
  assert.match(failed[0].Note, /รหัสผ่านไม่ถูกต้อง \(ครั้งที่ 1\)/);
  assert.equal(failed[1].Username, '(ไม่พบชื่อผู้ใช้)');
  const allText = JSON.stringify(h.auditRows());
  assert.doesNotMatch(allText, /Secret#Pass99|secret#pass99/, 'อาจเป็นรหัสผ่านที่พิมพ์ผิดช่อง ห้ามบันทึก');
  assert.equal(h.api('auth.login', { username: '', password: '' }).error.code, 'VALIDATION');
});

test('ใส่รหัสผ่านผิด 5 ครั้ง: ล็อก 15 นาที แม้ใส่รหัสถูก และปลดล็อกเมื่อครบเวลา', () => {
  const h = createAppEnv();
  for (let i = 1; i <= 4; i++) assert.equal(h.api('auth.login', { username: 'admin', password: 'wrong' + i + 'x' }).error.message, GENERIC);
  const fifth = h.api('auth.login', { username: 'admin', password: 'wrong5x' });
  assert.match(fifth.error.message, /ถูกล็อกชั่วคราว.*15 นาที/);
  const correctButLocked = h.api('auth.login', { username: 'admin', password: h.admin.password });
  assert.equal(correctButLocked.ok, false);
  assert.match(correctButLocked.error.message, /ถูกล็อกชั่วคราว/);
  h.setNow('2026-11-21T10:16:00+07:00');
  assert.equal(h.api('auth.login', { username: 'admin', password: h.admin.password }).ok, true);
});

test('ชื่อผู้ใช้ที่ไม่มีในระบบก็ถูกล็อกเหมือนกัน (เดาไม่ได้ว่าชื่อใดมีอยู่)', () => {
  const h = createAppEnv();
  let last;
  for (let i = 0; i < 5; i++) last = h.api('auth.login', { username: 'ghost', password: 'wrong123' });
  assert.match(last.error.message, /ถูกล็อกชั่วคราว/);
});

test('บัญชีที่ปิดการใช้งานเข้าสู่ระบบไม่ได้ และ session เดิมหมดอายุทันที', () => {
  const h = createAppEnv();
  const admin = h.adminToken();
  const fin = h.addUser(admin, 'FINANCE', 'finance1');
  assert.equal(h.api('auth.me', {}, fin.token).ok, true);
  h.ok('users.update', { userId: fin.user.userId, displayName: fin.user.displayName, role: 'FINANCE', status: 'DISABLED' }, admin);
  assert.equal(h.api('auth.me', {}, fin.token).error.code, 'UNAUTHENTICATED');
  const res = h.api('auth.login', { username: 'finance1', password: fin.password });
  assert.equal(res.error.message, 'บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
});

test('session หมดอายุเมื่อไม่ใช้งาน 30 นาที แต่ใช้งานต่อเนื่องได้', () => {
  const h = createAppEnv();
  const token = h.adminToken();
  h.setNow('2026-11-21T10:25:00+07:00');
  assert.equal(h.api('auth.me', {}, token).ok, true);
  h.setNow('2026-11-21T10:50:00+07:00');
  assert.equal(h.api('auth.me', {}, token).ok, true, 'ใช้งานล่าสุด 10:25 ยังไม่ครบ 30 นาที');
  h.setNow('2026-11-21T11:21:00+07:00');
  const expired = h.api('auth.me', {}, token);
  assert.equal(expired.error.code, 'UNAUTHENTICATED');
  assert.match(expired.error.message, /หมดเวลาการใช้งาน/);
});

test('session มีอายุสูงสุด 8 ชั่วโมง แม้ใช้งานต่อเนื่อง', () => {
  const h = createAppEnv();
  const token = h.adminToken();
  let minutes = 0;
  let res;
  do {
    minutes += 20;
    const t = new Date(Date.parse('2026-11-21T10:00:00+07:00') + minutes * 60000);
    h.setNow(t.toISOString());
    res = h.api('auth.me', {}, token);
  } while (res.ok && minutes < 600);
  assert.equal(minutes, 500, 'หมดอายุที่ 8 ชั่วโมงแรกหลังเข้าสู่ระบบ (ตรวจทุก 20 นาที)');
  assert.match(res.error.message, /ครบเวลาการเข้าสู่ระบบสูงสุด/);
});

test('ออกจากระบบ: token ใช้ไม่ได้อีก และบันทึก LOGOUT', () => {
  const h = createAppEnv();
  const token = h.adminToken();
  assert.equal(h.ok('auth.logout', {}, token).loggedOut, true);
  assert.equal(h.api('auth.me', {}, token).error.code, 'UNAUTHENTICATED');
  const rows = h.auditRows();
  assert.equal(rows[rows.length - 1].Action, 'LOGOUT');
});

test('token ปลอมหรือผิดรูปแบบใช้ไม่ได้', () => {
  const h = createAppEnv();
  ['', 'abc', 'g'.repeat(64), 'a'.repeat(64), null, 12345].forEach((t) => {
    assert.equal(h.api('auth.me', {}, t).error.code, 'UNAUTHENTICATED');
  });
});

test('บังคับเปลี่ยนรหัสผ่านชั่วคราว: ใช้คำสั่งอื่นไม่ได้จนกว่าจะเปลี่ยน และ session เดิมหมดอายุหลังเปลี่ยน', () => {
  const h = createAppEnv();
  const admin = h.adminToken();
  h.ok('users.create', { username: 'director1', displayName: 'ผอ.ทดสอบ', role: 'DIRECTOR', tempPassword: 'TempPass123' }, admin);
  const login = h.ok('auth.login', { username: 'director1', password: 'TempPass123' });
  assert.equal(login.mustChangePassword, true);
  const blocked = h.api('audit.list', {}, login.token);
  assert.equal(blocked.error.code, 'FORBIDDEN');
  assert.equal(blocked.error.reason, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal(h.ok('auth.me', {}, login.token).mustChangePassword, true);

  const wrong = h.api('auth.changePassword', { currentPassword: 'nope', newPassword: 'Better2569pw' }, login.token);
  assert.equal(wrong.error.message, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  const weak = h.api('auth.changePassword', { currentPassword: 'TempPass123', newPassword: 'short1' }, login.token);
  assert.match(weak.error.message, /อย่างน้อย 8/);
  const same = h.api('auth.changePassword', { currentPassword: 'TempPass123', newPassword: 'TempPass123' }, login.token);
  assert.match(same.error.message, /ไม่ซ้ำกับรหัสผ่านเดิม/);

  const changed = h.ok('auth.changePassword', { currentPassword: 'TempPass123', newPassword: 'Better2569pw' }, login.token);
  assert.notEqual(changed.token, login.token);
  assert.equal(changed.mustChangePassword, false);
  assert.equal(h.api('auth.me', {}, login.token).error.code, 'UNAUTHENTICATED', 'token เดิมต้องหมดอายุ');
  assert.equal(h.api('audit.list', {}, changed.token).ok, true);
  assert.equal(h.api('auth.login', { username: 'director1', password: 'TempPass123' }).ok, false);
  assert.equal(h.api('auth.login', { username: 'director1', password: 'Better2569pw' }).ok, true);
  assert.ok(h.auditRows().some((r) => r.Action === 'PASSWORD_CHANGE' && r.Username === 'director1'));
});

test('แฮชรหัสผ่านใหม่อัตโนมัติเมื่อเพิ่มจำนวนรอบ', () => {
  const h = createAppEnv();
  h.env.props.set('PASSWORD_HASH_ITERATIONS', '300');
  const admin = h.adminToken();
  h.ok('users.create', { username: 'finance2', displayName: 'การเงิน 2', role: 'FINANCE', tempPassword: 'TempPass123' }, admin);
  h.newExecution();
  assert.match(h.gas.dbFindOne_('Users', (u) => u.Username === 'finance2').PasswordHash, /^v1\$300\$/);
  h.env.props.set('PASSWORD_HASH_ITERATIONS', '1200');
  h.login('finance2', 'TempPass123');
  h.newExecution();
  assert.match(h.gas.dbFindOne_('Users', (u) => u.Username === 'finance2').PasswordHash, /^v1\$1200\$/);
  assert.equal(h.api('auth.login', { username: 'finance2', password: 'TempPass123' }).ok, true);
});

test('โหมดบัญชี Google: ใช้อีเมลที่ Google ยืนยัน และ session ผูกกับบัญชี Google นั้น', () => {
  const h = createAppEnv();
  const admin = h.adminToken();
  h.ok('users.create', { username: 'finance3', displayName: 'การเงิน 3', role: 'FINANCE', email: 'Finance3@School.example', tempPassword: 'TempPass123' }, admin);
  h.env.props.set('AUTH_MODE', 'GOOGLE');
  assert.equal(h.api('auth.login', { username: 'finance3', password: 'TempPass123' }).error.code, 'FORBIDDEN');

  h.setUsers('stranger@school.example', 'owner@example.com');
  const stranger = h.api('auth.loginGoogle');
  assert.equal(stranger.error.code, 'FORBIDDEN');
  assert.match(stranger.error.message, /ยังไม่ได้รับสิทธิ์/);

  h.setUsers('finance3@school.example', 'owner@example.com');
  const res = h.ok('auth.loginGoogle');
  assert.equal(res.user.username, 'finance3');
  assert.equal(res.mustChangePassword, false, 'โหมด Google ไม่มีรหัสผ่านชั่วคราว');
  assert.equal(h.api('settings.get', {}, res.token).ok, true);

  h.setUsers('someone.else@school.example', 'owner@example.com');
  assert.equal(h.api('settings.get', {}, res.token).error.code, 'UNAUTHENTICATED', 'token ถูกนำไปใช้กับบัญชี Google อื่นไม่ได้');
  h.setUsers('', 'owner@example.com');
  assert.equal(h.api('auth.loginGoogle').error.code, 'UNAUTHENTICATED');
});

test('จดจำการเข้าสู่ระบบ: อยู่ในระบบต่อได้จนครบอายุสูงสุด ผู้ดูแลระบบปิดได้ และเปลี่ยนรหัสผ่านแล้วยังจำแบบเดิม', () => {
  const h = createAppEnv();
  const login = (remember) => h.ok('auth.login', { username: 'admin', password: h.admin.password, remember });
  const normal = login(false);
  const kept = login(true);
  assert.equal(normal.remember, false);
  assert.equal(kept.remember, true);
  assert.ok(h.auditRows().some((r) => r.Action === 'LOGIN' && /อยู่ในระบบต่อในเครื่องนี้/.test(r.Note)), 'ประวัติบอกว่าเลือกอยู่ในระบบต่อ');

  // ไม่ได้ใช้งาน 2 ชั่วโมง: แบบปกติ (30 นาที) หมดเวลา แบบจดจำยังใช้ได้
  h.setNow('2026-11-21T12:00:00+07:00');
  assert.equal(h.api('auth.me', {}, normal.token).error.code, 'UNAUTHENTICATED');
  assert.equal(h.api('auth.me', {}, kept.token).ok, true);
  // ครบอายุสูงสุด 8 ชั่วโมงนับจากเข้าสู่ระบบ: ต้องเข้าสู่ระบบใหม่เสมอ แม้ใช้งานอยู่
  h.setNow('2026-11-21T15:00:00+07:00');
  assert.equal(h.api('auth.me', {}, kept.token).ok, true);
  h.setNow('2026-11-21T18:01:00+07:00');
  assert.match(h.api('auth.me', {}, kept.token).error.message, /ครบเวลาการเข้าสู่ระบบสูงสุด/);

  // ไม่ได้ใช้งานเกิน 6 ชั่วโมง (ขีดจำกัดของ CacheService) ก็ต้องเข้าสู่ระบบใหม่
  const kept2 = login(true);
  h.setNow('2026-11-22T00:02:00+07:00');
  assert.equal(h.api('auth.me', {}, kept2.token).error.code, 'UNAUTHENTICATED');

  // เปลี่ยนรหัสผ่านแล้ว token ใหม่ยังเป็นแบบจดจำ
  const kept3 = login(true);
  const changed = h.ok('auth.changePassword', { currentPassword: h.admin.password, newPassword: 'NewPass2569x' }, kept3.token);
  assert.equal(changed.remember, true);
  h.setNow('2026-11-22T02:00:00+07:00');
  assert.equal(h.api('auth.me', {}, changed.token).ok, true);

  // ผู้ดูแลระบบปิดตัวเลือกนี้: ระบบไม่จดจำแม้ผู้ใช้เลือก
  h.ok('settings.update', { values: { SESSION_ALLOW_REMEMBER: false } }, changed.token);
  const off = h.ok('auth.login', { username: 'admin', password: 'NewPass2569x', remember: true });
  assert.equal(off.remember, false);
  h.setNow('2026-11-22T03:00:00+07:00');
  assert.equal(h.api('auth.me', {}, off.token).error.code, 'UNAUTHENTICATED');
  h.newExecution();
  assert.equal(h.gas.bootConfig_().allowRemember, false, 'หน้าเข้าสู่ระบบซ่อนตัวเลือกนี้');
});
