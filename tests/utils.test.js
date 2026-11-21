'use strict';
/** ทดสอบฟังก์ชันช่วยฝั่ง Server: ข้อผิดพลาด เวลา รหัสอ้างอิง แฮช และการตรวจข้อมูลนำเข้า */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness');

const h = createEnv({ withSpreadsheet: false });
const g = h.gas;

const isValidation = (e) => e && e.name === 'AppError' && e.code === 'VALIDATION';

test('appError_ สร้างข้อผิดพลาดที่แสดงผู้ใช้ได้ และ safeErrorMessage_ ไม่เปิดเผยข้อผิดพลาดภายใน', () => {
  const e = g.appError_('CONFLICT', 'ข้อมูลซ้ำ');
  assert.equal(e.name, 'AppError');
  assert.equal(e.code, 'CONFLICT');
  assert.equal(g.safeErrorMessage_(e), 'ข้อมูลซ้ำ');
  assert.equal(g.appError_('ไม่มีรหัสนี้', 'x').code, 'INTERNAL');
  const internal = new Error('Exception: Service Spreadsheets failed while accessing document with id 1abc');
  assert.doesNotMatch(g.safeErrorMessage_(internal), /1abc|Exception/);
});

test('เวลาใช้เขตเวลา Asia/Bangkok', () => {
  h.setNow('2026-11-21T17:30:05Z'); // = 22 พ.ย. 2569 00:30:05 เวลาไทย
  assert.equal(g.nowIso_(), '2026-11-22 00:30:05');
  assert.equal(g.todayIso_(), '2026-11-22');
});

test('newId_ มีรูปแบบอ่านง่าย เรียงตามเวลา และไม่ซ้ำ', () => {
  h.setNow('2026-11-21T07:30:15Z');
  const id = g.newId_('PAY');
  assert.match(id, /^PAY-20261121143015-[0-9A-F]{6}$/);
  const ids = new Set();
  for (let i = 0; i < 2000; i++) ids.add(g.newId_('STU'));
  assert.equal(ids.size, 2000);
});

test('sha256Hex_ ตรงกับค่ามาตรฐาน และรองรับภาษาไทย', () => {
  assert.equal(g.sha256Hex_('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(g.sha256Hex_('เงินบำรุง').length, 64);
  assert.notEqual(g.sha256Hex_('ก'), g.sha256Hex_('ข'));
});

test('newSecretHex_ ยาว 64 ตัวและสุ่มใหม่ทุกครั้ง', () => {
  const a = g.newSecretHex_();
  const b = g.newSecretHex_();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test('toSatang_ แปลงเงินและแจ้งข้อผิดพลาดภาษาไทย', () => {
  assert.equal(g.toSatang_('1,500.25'), 150025);
  assert.throws(() => g.toSatang_('12.345', 'ยอดชำระ'), (e) => isValidation(e) && /ยอดชำระมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง/.test(e.message));
  assert.throws(() => g.toSatang_('', 'ยอดชำระ'), (e) => isValidation(e) && /กรุณากรอกยอดชำระ/.test(e.message));
  assert.throws(() => g.toSatang_('abc', 'ยอดชำระ'), isValidation);
});

test('cleanText_ ลบอักขระมองไม่เห็น อักขระควบคุม และ \' นำหน้า แต่คงภาษาไทยไว้', () => {
  assert.equal(g.cleanText_('  ด.ช.​สมชาย   ใจดี  '), 'ด.ช.สมชาย ใจดี');
  assert.equal(g.cleanText_('﻿สมหญิง'), 'สมหญิง');
  assert.equal(g.cleanText_("'=SUM(A1)"), '=SUM(A1)');
  assert.equal(g.cleanText_('บรรทัด1\nบรรทัด2'), 'บรรทัด1 บรรทัด2');
  assert.equal(g.cleanText_('บรรทัด1\r\nบรรทัด2\u0007', true), 'บรรทัด1\nบรรทัด2');
  assert.equal(g.cleanText_(null), '');
  assert.equal(g.cleanText_(123), '123');
});

test('escapeHtml_ กันการฝังโค้ดในหน้าเว็บ', () => {
  assert.equal(g.escapeHtml_('<img src=x onerror="alert(1)">&\''), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
  assert.equal(g.escapeHtml_(null), '');
});

test('requireText_', () => {
  assert.equal(g.requireText_('  สมชาย ', 'ชื่อ'), 'สมชาย');
  assert.equal(g.requireText_('', 'หมายเหตุ', { optional: true }), '');
  assert.throws(() => g.requireText_('', 'ชื่อ'), (e) => isValidation(e) && e.message === 'กรุณากรอกชื่อ');
  assert.throws(() => g.requireText_('​', 'ชื่อ'), isValidation, 'มีแต่อักขระมองไม่เห็นถือว่าว่าง');
  assert.throws(() => g.requireText_('ก'.repeat(201), 'ชื่อ'), (e) => isValidation(e) && /ยาวเกิน 200/.test(e.message));
  assert.throws(() => g.requireText_({}, 'ชื่อ'), isValidation);
  assert.throws(() => g.requireText_('ab', 'รหัสผ่าน', { min: 8 }), isValidation);
  assert.throws(() => g.requireText_('A B', 'ชื่อผู้ใช้', { pattern: /^[a-z0-9._-]+$/ }), isValidation);
  assert.equal(g.requireText_(12345, 'เลขประจำตัว'), '12345');
});

test('requireEnum_ / requireInt_ / requireBool_', () => {
  assert.equal(g.requireEnum_('FINANCE', h.run('ROLES'), 'บทบาท'), 'FINANCE');
  assert.throws(() => g.requireEnum_('ROOT', h.run('ROLES'), 'บทบาท'), isValidation);
  assert.throws(() => g.requireEnum_('', h.run('ROLES'), 'บทบาท'), (e) => e.message === 'กรุณาเลือกบทบาท');
  assert.equal(g.requireInt_('2569', 'ปีการศึกษา', { min: 2500, max: 2700 }), 2569);
  assert.equal(g.requireInt_('', 'เลขที่', { optional: true }), null);
  assert.throws(() => g.requireInt_('12.5', 'เลขที่'), isValidation);
  assert.throws(() => g.requireInt_('2400', 'ปีการศึกษา', { min: 2500 }), isValidation);
  assert.equal(g.requireBool_(true, 'x'), true);
  assert.equal(g.requireBool_('false', 'x'), false);
  assert.throws(() => g.requireBool_('yes', 'x'), isValidation);
});

test('requireMoney_ คืนสตางค์ และตรวจค่าติดลบ/ศูนย์/เพดาน', () => {
  assert.equal(g.requireMoney_('1,500', 'ยอดชำระ'), 150000);
  assert.throws(() => g.requireMoney_('0', 'ยอดชำระ'), (e) => /ต้องมากกว่า 0/.test(e.message));
  assert.equal(g.requireMoney_('0', 'ส่วนลด', { allowZero: true }), 0);
  assert.throws(() => g.requireMoney_('-10', 'ยอดชำระ'), (e) => /ต้องไม่ติดลบ/.test(e.message));
  assert.throws(() => g.requireMoney_('600', 'ยอดชำระ', { maxSatang: 50000 }), (e) => /ต้องไม่เกิน 500.00 บาท/.test(e.message));
  assert.equal(g.requireMoney_('', 'ส่วนลด', { optional: true }), null);
});

test('requireIsoDate_ / requireId_', () => {
  assert.equal(g.requireIsoDate_('2026-11-21', 'วันที่รับเงิน'), '2026-11-21');
  assert.throws(() => g.requireIsoDate_('2569-11-21', 'วันที่รับเงิน'), (e) => e.message === 'วันที่รับเงินไม่ถูกต้อง');
  assert.equal(g.requireId_('STU-20261121143015-A7F3C2', 'STU', 'รหัสนักเรียน'), 'STU-20261121143015-A7F3C2');
  assert.throws(() => g.requireId_('PAY-20261121143015-A7F3C2', 'STU', 'รหัสนักเรียน'), isValidation);
  assert.throws(() => g.requireId_('STU-1', 'STU', 'รหัสนักเรียน'), isValidation);
});
