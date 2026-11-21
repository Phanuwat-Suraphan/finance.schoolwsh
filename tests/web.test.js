'use strict';
/** ทดสอบการประกอบหน้าเว็บ: ไม่มีข้อมูลลับ, ไม่มีเครื่องหมายค้าง, สคริปต์ไม่มี syntax error, กัน XSS */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createAppEnv, createEnv, SRC_DIR } = require('./harness');
const { OUT_FILE } = require('../scripts/build');

function scripts(html) {
  const out = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

test('doGet: หน้าเว็บครบทุกส่วน รองรับมือถือ และไม่มีเครื่องหมายแทนที่ค้างอยู่', () => {
  const h = createAppEnv();
  const out = h.gas.doGet({});
  const html = out.getContent();
  assert.equal(out.getTitle(), 'ระบบบริหารจัดเก็บเงินบำรุงการศึกษา');
  assert.match(out._metas.viewport, /width=device-width/);
  assert.doesNotMatch(html, /@@[A-Z]+@@/);
  assert.match(html, /var BOOT = \{/);
  assert.match(html, /function formatSatang_/);
  assert.match(html, /App\.start\(\)/);
  assert.match(html, /<style>/);
});

test('สคริปต์ทุกส่วนในหน้าเว็บและหน้าต่างผู้ดูแลระบบไม่มี syntax error', () => {
  const h = createAppEnv();
  const pages = [h.gas.doGet({}).getContent()];
  h.gas.menuSetupAdmin();
  pages.push(h.env.dialogs[0].html);
  pages.forEach((html) => {
    const list = scripts(html);
    assert.ok(list.length >= 1);
    list.forEach((code, i) => assert.doesNotThrow(() => new vm.Script(code), 'สคริปต์ส่วนที่ ' + i));
  });
});

test('BOOT ไม่มีข้อมูลลับ และข้อความแปลกปลอมในชื่อโรงเรียนไม่หลุดออกจากแท็ก <script>', () => {
  const h = createAppEnv();
  const admin = h.adminToken();
  h.ok('settings.update', { values: { SCHOOL_NAME: '</script><script>alert(1)</script>' } }, admin);
  h.newExecution();
  const html = h.gas.doGet({}).getContent();
  const boot = /var BOOT = (\{.*?\});/.exec(html)[1];
  const data = JSON.parse(boot);
  assert.deepEqual(Object.keys(data).sort(), ['appName', 'authMode', 'province', 'release', 'schoolName', 'version']);
  assert.equal(data.schoolName, '</script><script>alert(1)</script>', 'ค่าถูกต้องหลังแปลง JSON');
  assert.ok(!html.includes('</script><script>alert(1)'), 'ต้อง escape เครื่องหมาย < ในสคริปต์');
  ['PASSWORD_PEPPER', 'DB_SPREADSHEET_ID'].forEach((k) => assert.ok(!html.includes(h.env.props.get(k)), k));
});

test('หน้าเว็บโหลดทรัพยากรภายนอกเฉพาะฟอนต์จาก Google Fonts', () => {
  const h = createAppEnv();
  const html = h.gas.doGet({}).getContent();
  const urls = html.match(/https?:\/\/[^\s"'<>)]+/g) || [];
  const hosts = [...new Set(urls.map((u) => new URL(u).host))].sort();
  // www.w3.org และ schemas.openxmlformats.org เป็นชื่อ namespace ของ SVG/Excel ไม่ใช่การโหลดข้อมูล
  const allowed = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.w3.org', 'schemas.openxmlformats.org'];
  assert.ok(hosts.every((x) => allowed.includes(x)), hosts.join(','));
  assert.doesNotMatch(html, /\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|new WebSocket/, 'หน้าเว็บต้องติดต่อ Server ผ่าน google.script.run เท่านั้น');
  assert.doesNotMatch(html, /<script[^>]+src=/i, 'ห้ามโหลดสคริปต์จากภายนอก');
});

test('โค้ดหน้าเว็บไม่ใช้ innerHTML หรือ document.write กับข้อมูล (กัน XSS)', () => {
  ['JsCore.html', 'JsViews.html', 'Index.html', 'AdminDialog.html'].forEach((file) => {
    const src = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    assert.doesNotMatch(src, /\.innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write|eval\(|new Function\(/, file);
  });
});

test('ติดตั้งแบบไฟล์เดียว: หน้าเว็บที่ได้เหมือนกับแบบแยกไฟล์ทุกตัวอักษร', () => {
  const separate = createEnv();
  separate.setNow('2026-11-21T10:00:00+07:00');
  separate.gas.SetupDatabase();
  separate.newExecution();
  const bundled = createEnv({ sources: [{ name: 'Code.gs', code: fs.readFileSync(OUT_FILE, 'utf8') }] });
  bundled.setNow('2026-11-21T10:00:00+07:00');
  bundled.gas.SetupDatabase();
  bundled.newExecution();
  assert.equal(bundled.gas.doGet({}).getContent(), separate.gas.doGet({}).getContent());
  assert.equal(bundled.gas.htmlSource_('AdminDialog'), fs.readFileSync(path.join(SRC_DIR, 'AdminDialog.html'), 'utf8'));
});

test('เปิดหน้าเว็บได้แม้ยังไม่ได้ติดตั้งฐานข้อมูล (ใช้ชื่อโรงเรียนค่าเริ่มต้น)', () => {
  const h = createEnv();
  const html = h.gas.doGet({}).getContent();
  assert.match(html, /"schoolName":"โรงเรียนวัดเสาหิน"/);
});
