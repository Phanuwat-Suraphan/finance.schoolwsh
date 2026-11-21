'use strict';
/** ทดสอบการจัดการผู้ใช้ และการสร้าง/รีเซ็ตผู้ดูแลระบบโดยเจ้าของระบบ */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppEnv, plain } = require('./harness');

test('เพิ่มผู้ใช้: ตรวจข้อมูล กำหนดรหัสผ่านชั่วคราว และต้องเปลี่ยนรหัสผ่านครั้งแรก', () => {
  const h = createAppEnv();
  const admin = h.adminToken();
  const bad = (payload, re) => {
    const res = h.api('users.create', Object.assign({ username: 'finance1', displayName: 'การเงิน', role: 'FINANCE', tempPassword: 'TempPass123' }, payload), admin);
    assert.equal(res.ok, false, JSON.stringify(payload));
    assert.match(res.error.message, re, JSON.stringify(payload));
  };
  bad({ username: 'Somchai K' }, /ภาษาอังกฤษตัวพิมพ์เล็ก/);
  bad({ username: '1abc' }, /ขึ้นต้นด้วยตัวอักษร/);
  bad({ username: 'ab' }, /3–32 ตัว/);
  bad({ displayName: '' }, /กรุณากรอกชื่อ-นามสกุล/);
  bad({ role: 'ROOT' }, /บทบาทไม่ถูกต้อง/);
  bad({ email: 'not-an-email' }, /รูปแบบอีเมลไม่ถูกต้อง/);
  bad({ tempPassword: 'short' }, /อย่างน้อย 8/);

  const user = h.ok('users.create', { username: 'Finance1', displayName: '  นางสาว การเงิน  ', position: 'ครู', role: 'FINANCE', tempPassword: 'TempPass123' }, admin);
  assert.equal(user.username, 'finance1');
  assert.equal(user.displayName, 'นางสาว การเงิน');
  assert.equal(user.mustChangePassword, true);
  assert.equal(user.status, 'ACTIVE');
  assert.equal(user.roleLabel, 'เจ้าหน้าที่การเงิน');
  const dup = h.api('users.create', { username: 'FINANCE1', displayName: 'ซ้ำ', role: 'FINANCE', tempPassword: 'TempPass123' }, admin);
  assert.deepEqual(dup.error, { code: 'CONFLICT', message: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' });
});

test('อีเมลห้ามซ้ำ (ไม่สนตัวพิมพ์) แต่เว้นว่างได้หลายคน', () => {
  const h = createAppEnv();
  const admin = h.adminToken();
  h.ok('users.create', { username: 'aaa', displayName: 'ก', role: 'FINANCE', email: 'a@school.example', tempPassword: 'TempPass123' }, admin);
  const dup = h.api('users.create', { username: 'bbb', displayName: 'ข', role: 'FINANCE', email: 'A@School.Example', tempPassword: 'TempPass123' }, admin);
  assert.equal(dup.error.code, 'CONFLICT');
  h.ok('users.create', { username: 'ccc', displayName: 'ค', role: 'FINANCE', tempPassword: 'TempPass123' }, admin);
  h.ok('users.create', { username: 'ddd', displayName: 'ง', role: 'DIRECTOR', tempPassword: 'TempPass123' }, admin);
});

test('รายชื่อผู้ใช้: ผู้ที่ใช้งานอยู่ก่อน เรียงตามบทบาท และไม่มีข้อมูลลับ', () => {
  const h = createAppEnv();
  const admin = h.adminToken();
  const fin = h.addUser(admin, 'FINANCE', 'zeta.fin');
  h.addUser(admin, 'DIRECTOR', 'dir.one');
  h.ok('users.update', { userId: fin.user.userId, displayName: 'ปิดแล้ว', role: 'FINANCE', status: 'DISABLED' }, admin);
  const list = h.ok('users.list', {}, admin);
  assert.deepEqual(list.map((u) => u.username), ['admin', 'dir.one', 'zeta.fin']);
  assert.ok(list.every((u) => !('passwordHash' in u) && !('PasswordHash' in u) && !('sessionVersion' in u)));
});

test('แก้ไขผู้ใช้: เปลี่ยนบทบาทแล้วการเข้าสู่ระบบเดิมหมดอายุทันที และบันทึกค่าเดิม/ค่าใหม่', () => {
  const h = createAppEnv();
  const admin = h.adminToken();
  const fin = h.addUser(admin, 'FINANCE', 'finance1');
  assert.equal(h.api('settings.get', {}, fin.token).ok, true);
  const updated = h.ok('users.update', { userId: fin.user.userId, displayName: 'ชื่อใหม่', position: 'หัวหน้างานการเงิน', email: '', role: 'DIRECTOR', status: 'ACTIVE' }, admin);
  assert.equal(updated.role, 'DIRECTOR');
  assert.equal(h.api('settings.get', {}, fin.token).error.code, 'UNAUTHENTICATED');
  const relogin = h.login('finance1', fin.password);
  assert.equal(h.api('audit.list', {}, relogin).ok, true, 'สิทธิ์ใหม่มีผลทันทีที่เข้าสู่ระบบใหม่');
  const log = h.auditRows().filter((r) => r.Action === 'UPDATE' && r.EntityId === fin.user.userId).pop();
  assert.deepEqual(JSON.parse(log.BeforeJson).Role, 'FINANCE');
  assert.deepEqual(JSON.parse(log.AfterJson).Role, 'DIRECTOR');
});

test('แก้ไขชื่ออย่างเดียวไม่ทำให้ผู้ใช้หลุดจากระบบ', () => {
  const h = createAppEnv();
  const admin = h.adminToken();
  const fin = h.addUser(admin, 'FINANCE', 'finance1');
  h.ok('users.update', { userId: fin.user.userId, displayName: 'ชื่อใหม่', role: 'FINANCE', status: 'ACTIVE' }, admin);
  assert.equal(h.api('settings.get', {}, fin.token).ok, true);
});

test('เปลี่ยนบทบาทหรือปิดบัญชีของตนเองไม่ได้ และต้องมีผู้ดูแลระบบอย่างน้อย 1 คน', () => {
  const h = createAppEnv();
  const admin = h.adminToken();
  const me = h.ok('auth.me', {}, admin).user;
  const selfDemote = h.api('users.update', { userId: me.userId, displayName: me.displayName, role: 'FINANCE', status: 'ACTIVE' }, admin);
  assert.equal(selfDemote.error.code, 'FORBIDDEN');
  const selfDisable = h.api('users.update', { userId: me.userId, displayName: me.displayName, role: 'ADMIN', status: 'DISABLED' }, admin);
  assert.equal(selfDisable.error.code, 'FORBIDDEN');
  assert.equal(h.ok('users.update', { userId: me.userId, displayName: 'ชื่อใหม่ของฉัน', role: 'ADMIN', status: 'ACTIVE' }, admin).displayName, 'ชื่อใหม่ของฉัน');

  const second = h.addUser(admin, 'ADMIN', 'admin2');
  // admin2 ลดสิทธิ์ admin คนแรกได้ เพราะยังเหลือผู้ดูแลระบบ 1 คน
  h.ok('users.update', { userId: me.userId, displayName: me.displayName, role: 'FINANCE', status: 'ACTIVE' }, second.token);
  const last = h.api('users.update', { userId: second.user.userId, displayName: 'x', role: 'FINANCE', status: 'ACTIVE' }, second.token);
  assert.equal(last.error.code, 'FORBIDDEN', 'เปลี่ยนบทบาทตัวเองไม่ได้อยู่แล้ว');

  // ชั้นป้องกันที่สอง: ถ้าผู้ดูแลระบบที่เหลือคนเดียวถูกลดสิทธิ์ (เช่น ผ่านเส้นทางอื่นในอนาคต) ต้องถูกปฏิเสธ
  h.newExecution();
  const systemCtx = { userId: 'SYSTEM', username: 'system', role: 'SYSTEM' };
  assert.throws(() => h.gas.withScriptLock_(() => h.gas.usersUpdate_(systemCtx, {
    userId: second.user.userId, displayName: 'x', role: 'FINANCE', status: 'ACTIVE',
  })), (e) => e.code === 'CONFLICT' && /อย่างน้อย 1 คน/.test(e.message));
});

test('รีเซ็ตรหัสผ่าน: รหัสเดิมใช้ไม่ได้ ผู้ใช้ต้องเปลี่ยนรหัสผ่าน และปลดล็อกการใส่รหัสผิด', () => {
  const h = createAppEnv();
  const admin = h.adminToken();
  const fin = h.addUser(admin, 'FINANCE', 'finance1');
  for (let i = 0; i < 5; i++) h.api('auth.login', { username: 'finance1', password: 'wrong' + i + 'pw' });
  assert.match(h.api('auth.login', { username: 'finance1', password: fin.password }).error.message, /ถูกล็อกชั่วคราว/);

  const res = h.ok('users.resetPassword', { userId: fin.user.userId, tempPassword: 'NewTemp2569' }, admin);
  assert.equal(res.mustChangePassword, true);
  assert.equal(h.api('settings.get', {}, fin.token).error.code, 'UNAUTHENTICATED', 'session เดิมหมดอายุ');
  assert.equal(h.api('auth.login', { username: 'finance1', password: fin.password }).ok, false, 'รหัสเดิมใช้ไม่ได้');
  const login = h.ok('auth.login', { username: 'finance1', password: 'NewTemp2569' });
  assert.equal(login.mustChangePassword, true);
  const log = h.auditRows().filter((r) => r.Action === 'PASSWORD_CHANGE' && r.Username === 'admin').pop();
  assert.equal(log.Note, 'ผู้ดูแลระบบรีเซ็ตรหัสผ่าน');
  assert.doesNotMatch(log.AfterJson, /NewTemp2569|v1\$/);

  const me = h.ok('auth.me', {}, admin).user;
  assert.equal(h.api('users.resetPassword', { userId: me.userId, tempPassword: 'Whatever2569' }, admin).error.code, 'FORBIDDEN');
});

test('เจ้าของระบบสร้างผู้ดูแลระบบคนแรก และรีเซ็ตได้เมื่อลืมรหัสผ่าน (จากเมนูใน Google Sheets เท่านั้น)', () => {
  const h = createAppEnv();
  // เรียกจากเว็บแอป (ผู้ใช้อื่น) ต้องถูกปฏิเสธ
  h.setUsers('', 'owner@example.com');
  const web = plain(h.gas.ownerSetupAdmin({ username: 'hacker', displayName: 'x', password: 'Hack2569xx', confirmPassword: 'Hack2569xx' }));
  assert.equal(web.ok, false);
  assert.match(web.message, /เฉพาะเจ้าของระบบ/);
  h.setUsers('owner@example.com');

  const mismatch = plain(h.gas.ownerSetupAdmin({ username: 'admin2', displayName: 'ผู้ดูแล 2', password: 'Strong2569x', confirmPassword: 'Strong2569y' }));
  assert.match(mismatch.message, /ไม่ตรงกัน/);

  h.newExecution();
  const reset = plain(h.gas.ownerSetupAdmin({ username: 'admin', displayName: 'ผู้ดูแลระบบ', password: 'Recover2569', confirmPassword: 'Recover2569' }));
  assert.equal(reset.ok, true);
  assert.match(reset.message, /รีเซ็ตบัญชีผู้ดูแลระบบ "admin"/);
  assert.equal(h.api('auth.login', { username: 'admin', password: h.admin.password }).ok, false);
  const login = h.ok('auth.login', { username: 'admin', password: 'Recover2569' });
  assert.equal(login.mustChangePassword, true, 'ค่าเริ่มต้น: ต้องเปลี่ยนรหัสผ่านหลังรีเซ็ต');

  const token = login.token;
  const changed = h.ok('auth.changePassword', { currentPassword: 'Recover2569', newPassword: 'Another2569' }, token);
  h.addUser(changed.token, 'FINANCE', 'finance1');
  h.newExecution();
  const clash = plain(h.gas.ownerSetupAdmin({ username: 'finance1', displayName: 'x', password: 'Strong2569x', confirmPassword: 'Strong2569x' }));
  assert.equal(clash.ok, false);
  assert.match(clash.message, /เป็นบัญชีของเจ้าหน้าที่การเงิน/);
});

test('เมนู 3 เปิดหน้าต่างสร้างผู้ดูแลระบบที่ไม่มีข้อมูลลับ', () => {
  const h = createAppEnv();
  h.gas.menuSetupAdmin();
  assert.equal(h.env.dialogs.length, 1);
  const html = h.env.dialogs[0].html;
  assert.match(html, /var DIALOG = \{"authMode":"PASSWORD"\};/);
  assert.match(html, /ownerSetupAdmin/);
  assert.ok(!html.includes(h.env.props.get('PASSWORD_PEPPER')));
});
