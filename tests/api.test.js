'use strict';
/**
 * ทดสอบทางเข้าเดียว api(): ตารางสิทธิ์ทุกคำสั่ง × ทุกบทบาท, การปฏิเสธเป็นค่าเริ่มต้น,
 * การไม่เปิดเผยข้อมูลลับหรือข้อผิดพลาดภายใน, และการใช้ LockService กับคำสั่งที่บันทึกข้อมูล
 *
 * ตาราง EXPECTED ด้านล่างจงใจเขียนซ้ำกับ apiActions_() ใน src/Api.js
 * ถ้ามีการเปลี่ยนสิทธิ์ ต้องแก้ทั้งสองที่ (กันการเปลี่ยนสิทธิ์โดยไม่ตั้งใจ)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppEnv } = require('./harness');

const ROLE_DENIED = 'ไม่มีสิทธิ์ใช้งานคำสั่งนี้';
const ALL = ['ADMIN', 'FINANCE', 'DIRECTOR'];
const EXPECTED = {
  'auth.me': ALL,
  'auth.logout': ALL,
  'auth.changePassword': ALL,
  'users.list': ['ADMIN'],
  'users.create': ['ADMIN'],
  'users.update': ['ADMIN'],
  'users.resetPassword': ['ADMIN'],
  'settings.get': ALL,
  'settings.update': ['ADMIN'],
  'years.list': ALL,
  'years.create': ['ADMIN'],
  'years.update': ['ADMIN'],
  'years.setCurrent': ['ADMIN'],
  'audit.list': ['ADMIN', 'DIRECTOR'],
  'audit.verify': ['ADMIN', 'DIRECTOR'],
};
const PUBLIC = ['auth.login', 'auth.loginGoogle'];

function setupRoles() {
  const h = createAppEnv();
  const admin = h.adminToken();
  const fin = h.addUser(admin, 'FINANCE', 'finance1');
  const dir = h.addUser(admin, 'DIRECTOR', 'director1');
  return { h, tokens: { ADMIN: admin, FINANCE: fin.token, DIRECTOR: dir.token } };
}

test('ตารางสิทธิ์ใน src/Api.js ตรงกับที่กำหนด (ไม่มีคำสั่งเกินหรือขาด)', () => {
  const h = createAppEnv();
  const actions = h.gas.apiActions_();
  const names = Object.keys(actions).sort();
  assert.deepEqual(names, Object.keys(EXPECTED).concat(PUBLIC).sort());
  Object.keys(EXPECTED).forEach((name) => {
    assert.deepEqual([...actions[name].roles].sort(), [...EXPECTED[name]].sort(), name);
    assert.equal(actions[name].public, undefined, name + ' ต้องไม่ใช่คำสั่งสาธารณะ');
    assert.equal(typeof actions[name].handler, 'function', name);
  });
  PUBLIC.forEach((name) => assert.equal(actions[name].public, true));
  assert.ok(Object.isFrozen(actions), 'ตารางสิทธิ์ต้องแก้ไขระหว่างทำงานไม่ได้');
});

test('ทุกคำสั่ง × ทุกบทบาท: บทบาทที่ไม่มีสิทธิ์ถูกปฏิเสธที่ Server และบันทึก ACCESS_DENIED', () => {
  const { h, tokens } = setupRoles();
  Object.keys(EXPECTED).forEach((action) => {
    if (action === 'auth.logout' || action === 'auth.changePassword') return; // ทดสอบแยก (จะทำให้ token หมดอายุ)
    ALL.forEach((role) => {
      const before = h.auditRows().filter((r) => r.Action === 'ACCESS_DENIED').length;
      const res = h.api(action, {}, tokens[role]);
      const deniedByRole = !res.ok && res.error.code === 'FORBIDDEN' && res.error.message === ROLE_DENIED;
      const after = h.auditRows().filter((r) => r.Action === 'ACCESS_DENIED');
      if (EXPECTED[action].includes(role)) {
        assert.equal(deniedByRole, false, action + ' ต้องอนุญาต ' + role);
        assert.equal(after.length, before, action + '/' + role);
      } else {
        assert.equal(deniedByRole, true, action + ' ต้องปฏิเสธ ' + role + ' แต่ได้ ' + JSON.stringify(res));
        assert.equal(after.length, before + 1, 'ต้องบันทึก ACCESS_DENIED: ' + action + '/' + role);
        assert.equal(after[after.length - 1].EntityId, action);
      }
    });
  });
});

test('ไม่มี token หรือ token ผิด: ทุกคำสั่งที่ไม่ใช่สาธารณะถูกปฏิเสธ', () => {
  const h = createAppEnv();
  Object.keys(EXPECTED).forEach((action) => {
    assert.equal(h.api(action, {}, null).error.code, 'UNAUTHENTICATED', action);
    assert.equal(h.api(action, {}, 'f'.repeat(64)).error.code, 'UNAUTHENTICATED', action);
  });
});

test('คำสั่งที่ไม่มีในตาราง หรือคำขอผิดรูปแบบ ถูกปฏิเสธเสมอ', () => {
  const h = createAppEnv();
  const token = h.adminToken();
  ['users.delete', 'constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'Users.List'].forEach((action) => {
    const res = h.api(action, {}, token);
    assert.equal(res.ok, false, action);
    assert.equal(res.error.code, 'FORBIDDEN', action);
  });
  h.newExecution();
  [null, undefined, 'users.list', 42, [], ['auth.me']].forEach((req) => {
    const res = h.gas.api(req);
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'FORBIDDEN');
  });
});

test('ข้อผิดพลาดภายในไม่ถูกส่งออกไปหน้าเว็บ แต่บันทึกใน Log ฝั่ง Server', () => {
  const h = createAppEnv();
  const token = h.adminToken();
  h.gas.usersList_ = () => { throw new Error('Exception: secret detail /drive/ABC123 PasswordHash'); };
  h.run('API_ACTIONS_ = null');
  const res = h.api('users.list', {}, token);
  assert.equal(res.error.code, 'INTERNAL');
  assert.doesNotMatch(res.error.message, /secret|ABC123|PasswordHash|Exception/);
  assert.ok(h.env.logs.some((l) => l.level === 'error' && /secret detail/.test(l.text)));
  assert.equal(Object.keys(res).sort().join(','), 'error,ok');
});

test('คำตอบทุกคำสั่งส่งผ่าน google.script.run ได้ (ไม่มี Date/function) และไม่มีค่าลับ', () => {
  const { h, tokens } = setupRoles();
  const pepper = h.env.props.get('PASSWORD_PEPPER');
  const raw = [];
  const call = (action, payload, token) => {
    h.newExecution();
    const res = h.gas.api({ action, payload, token });
    raw.push(res);
    return res;
  };
  call('auth.login', { username: 'admin', password: h.admin.password }, null);
  call('auth.me', {}, tokens.ADMIN);
  call('users.list', {}, tokens.ADMIN);
  call('settings.get', {}, tokens.FINANCE);
  call('years.list', {}, tokens.DIRECTOR);
  call('audit.list', {}, tokens.DIRECTOR);
  call('audit.verify', {}, tokens.ADMIN);
  const walk = (v, path) => {
    const tag = Object.prototype.toString.call(v);
    assert.notEqual(tag, '[object Date]', 'พบ Date ที่ ' + path);
    assert.notEqual(typeof v, 'function', 'พบ function ที่ ' + path);
    assert.notEqual(v, undefined, 'พบ undefined ที่ ' + path);
    if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k], path + '.' + k));
  };
  raw.forEach((res, i) => {
    assert.equal(res.ok, true, 'คำสั่งที่ ' + i + ': ' + JSON.stringify(res.error));
    walk(res, 'res' + i);
    const json = JSON.stringify(res);
    assert.doesNotMatch(json, /v1\$\d+\$[0-9a-f]{32}/, 'คำตอบที่ ' + i + ' มีค่าแฮชรหัสผ่าน');
    assert.doesNotMatch(json, /"PasswordHash":"(?!\[ซ่อน\]")[^"]/, 'คำตอบที่ ' + i + ' มีค่าในช่องรหัสผ่านที่ไม่ได้ซ่อน');
    if (i <= 2) assert.doesNotMatch(json, /PasswordHash|SessionVersion/, 'ข้อมูลผู้ใช้ต้องไม่มีช่องลับเลย (คำตอบที่ ' + i + ')');
    assert.ok(!json.includes(pepper), 'คำตอบที่ ' + i + ' มีค่า pepper');
  });
});

test('คำสั่งที่บันทึกข้อมูลใช้ LockService ส่วนคำสั่งอ่านอย่างเดียวไม่ต้องรอ lock', () => {
  const h = createAppEnv();
  const token = h.adminToken();
  let before = h.env.stats.lockAcquired;
  h.ok('users.list', {}, token);
  h.ok('settings.get', {}, token);
  assert.equal(h.env.stats.lockAcquired, before, 'อ่านอย่างเดียวไม่ใช้ lock');
  before = h.env.stats.lockAcquired;
  h.ok('years.create', { year: 2570 }, token);
  assert.equal(h.env.stats.lockAcquired, before + 1);

  h.env.lockContended = true;
  const busy = h.api('years.create', { year: 2571 }, token);
  assert.equal(busy.error.code, 'LOCK_TIMEOUT');
  assert.match(busy.error.message, /มีผู้ใช้อื่นกำลังบันทึกข้อมูล/);
  assert.equal(h.api('years.list', {}, token).ok, true, 'อ่านข้อมูลได้แม้มีผู้ใช้อื่นกำลังบันทึก');
  h.env.lockContended = false;
  assert.equal(h.ok('years.list', {}, token).length, 2, 'คำขอที่ติด lock ต้องไม่ถูกบันทึก');
});

test('payload ที่ผิดชนิดถูกเพิกเฉยอย่างปลอดภัย', () => {
  const h = createAppEnv();
  const token = h.adminToken();
  const res = h.api('years.create', ['2570'], token);
  assert.equal(res.error.code, 'VALIDATION');
  const proto = h.api('settings.update', JSON.parse('{"values":{"__proto__":{"x":1}}}'), token);
  assert.equal(proto.ok, false);
});
