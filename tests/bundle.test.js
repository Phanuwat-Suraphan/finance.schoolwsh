'use strict';
/**
 * ทดสอบไฟล์รวม dist/Code.gs (วิธีติดตั้งแบบวางไฟล์เดียว)
 * - ต้องตรงกับโค้ดใน src/ เสมอ (ถ้าไม่ตรงให้รัน npm run build)
 * - โหลดเป็นไฟล์เดียวใน Apps Script แล้วติดตั้งฐานข้อมูลได้จริง
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { buildBundle, OUT_FILE } = require('../scripts/build');
const { createEnv, plain } = require('./harness');

const PUBLIC_FUNCTIONS = ['doGet', 'onOpen', 'api', 'SetupDatabase', 'menuSetupDatabase', 'menuVerifyAuditLog',
  'menuSetupAdmin', 'ownerSetupAdmin', 'dailyBackup'];

function readBundle() {
  assert.ok(fs.existsSync(OUT_FILE), 'ไม่พบ dist/Code.gs กรุณารัน npm run build');
  return fs.readFileSync(OUT_FILE, 'utf8');
}

test('dist/Code.gs ตรงกับโค้ดล่าสุดใน src/ (ถ้าไม่ผ่าน ให้รัน npm run build)', () => {
  assert.equal(readBundle(), buildBundle());
});

test('ไฟล์รวมมีวิธีติดตั้งภาษาไทยอยู่ด้านบน และ SetupDatabase เป็นฟังก์ชันแรก (ถูกเลือกไว้ในช่อง Run)', () => {
  const bundle = readBundle();
  assert.match(bundle.slice(0, 2000), /วิธีติดตั้ง/);
  assert.match(bundle.slice(0, 2000), /SetupDatabase/);
  const functions = bundle.split('\n').map((l) => /^function\s+([A-Za-z0-9_$]+)/.exec(l)).filter(Boolean).map((m) => m[1]);
  assert.equal(functions[0], 'SetupDatabase');
  assert.deepEqual(functions.filter((n) => !n.endsWith('_')).sort(), [...PUBLIC_FUNCTIONS].sort(),
    'ไฟล์รวมต้องเปิดให้เรียกจากภายนอกได้เฉพาะฟังก์ชันที่ตั้งใจ');
  assert.equal(new Set(functions).size, functions.length, 'ชื่อฟังก์ชันซ้ำในไฟล์รวม');
  assert.doesNotMatch(bundle, /\brequire\(|module\.exports/, 'ห้ามมีโค้ดเฉพาะ Node.js');
});

test('วางไฟล์รวมไฟล์เดียวแล้วกด Run SetupDatabase: ติดตั้งสำเร็จ และรันซ้ำได้', () => {
  const h = createEnv({ sources: [{ name: 'Code.gs', code: readBundle() }] });
  h.setNow('2026-11-21T10:00:00+07:00');
  const first = plain(h.gas.SetupDatabase());
  assert.equal(first.sheets.filter((s) => s.action === 'created').length, 16);
  assert.match(h.env.logs.map((l) => l.text).join('\n'), /ผลการติดตั้งฐานข้อมูล[\s\S]*สร้างชีตใหม่ 16 ชีต/);
  h.newExecution();
  const second = plain(h.gas.SetupDatabase());
  assert.equal(second.changed, false);
  h.newExecution();
  assert.equal(plain(h.gas.auditVerifyChain_()).ok, true);
});

test('ขนาดไฟล์รวมไม่ใหญ่เกินไปสำหรับการคัดลอกและวาง', () => {
  const kb = Buffer.byteLength(readBundle(), 'utf8') / 1024;
  assert.ok(kb < 900, 'ไฟล์รวมมีขนาด ' + kb.toFixed(1) + ' KB');
});
