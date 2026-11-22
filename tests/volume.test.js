'use strict';
/**
 * ทดสอบปริมาณข้อมูล (ระยะที่ 8): นักเรียน 600 คน รายการเรียกเก็บ 600 รายการ และใบเสร็จ 200 ฉบับ
 * - จำนวนครั้งที่อ่านชีตต่อคำขอต้องคงที่ (ไม่อ่านทีละแถว) เพราะบน Apps Script การอ่านแต่ละครั้งใช้เวลา 0.1–0.5 วินาที
 * - เวลาบนเครื่องทดสอบใช้จับการคำนวณที่ช้าผิดปกติ (เช่น วนซ้อนทุกแถว) ไม่ใช่เวลาจริงบน Google
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupFinance } = require('./finance-helpers');

const GRADES = ['ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6'];
const MAX_READS = 20;
const MAX_MS = 3000;

test('นักเรียน 600 คน ใบเสร็จ 200 ฉบับ: ทุกหน้าอ่านชีตจำนวนครั้งคงที่ และตอบได้เร็ว', () => {
  const t = setupFinance();
  const { h } = t;
  const rows = [];
  for (let i = 0; i < 600; i++) {
    rows.push({
      studentNo: String(30000 + i), prefix: i % 2 ? 'เด็กหญิง' : 'เด็กชาย', firstName: 'นักเรียน' + i, lastName: 'ทดสอบปริมาณ',
      gradeLevel: GRADES[Math.floor(i / 100)], room: String(1 + (i % 4)), classNo: 1 + Math.floor((i % 100) / 4),
    });
  }
  assert.equal(h.ok('students.importCommit', { year: 2569, rows }, t.fin).created, 600);
  t.fee({ gradeLevels: GRADES, amount: '500' }).forEach((f) => t.generate(f.feeSettingId));
  t.book('1/2569', 1, 1000);
  const students = h.ok('students.list', { year: 2569 }, t.fin).rows;
  for (let i = 0; i < 200; i++) t.pay(students[i].studentId, i % 4 ? 500 : 200);

  // วัด 2 ครั้งแล้วใช้เวลาที่น้อยกว่า (ลดผลจากเครื่องทดสอบที่ทำงานอื่นอยู่) ส่วนจำนวนครั้งที่อ่านชีตต้องเท่าเดิมทุกครั้ง
  const measure = (action, payload, token) => {
    let data = null;
    let best = Infinity;
    for (let round = 0; round < 2; round++) {
      h.env.stats.getValues = 0;
      const start = Date.now();
      data = h.ok(action, payload || {}, token || t.dir);
      best = Math.min(best, Date.now() - start);
      assert.ok(h.env.stats.getValues <= MAX_READS, action + ' อ่านชีต ' + h.env.stats.getValues + ' ครั้ง');
    }
    assert.ok(best < MAX_MS, action + ' ใช้เวลา ' + best + ' ms');
    return data;
  };
  const book = h.ok('receipts.books', {}, t.fin).books[0];
  const dash = measure('dashboard.summary');
  const arrears = measure('arrears.summary');
  measure('reports.annual');
  const coll = measure('reports.collections');
  measure('reports.daily', { date: '2026-11-21' });
  measure('reports.notices', {}, t.fin);
  measure('reports.receiptUsage');
  measure('ledger.students');
  measure('receipts.book', { bookId: book.bookId });
  measure('payments.list');
  measure('payments.context', { studentId: students[300].studentId }, t.fin);
  const integrity = measure('integrity.check');

  // บันทึกรับเงิน 1 ฉบับ (ส่วนที่เขียน) อ่านชีตจำนวนครั้งคงที่
  const ctx = t.context(students[301].studentId);
  h.env.stats.getValues = 0;
  t.payRaw(students[301].studentId, 500);
  assert.ok(h.env.stats.getValues <= MAX_READS + 12, 'บันทึกรับเงินอ่านชีต ' + h.env.stats.getValues + ' ครั้ง');
  assert.equal(ctx.items.length, 1);

  assert.equal(dash.totals.students, 600);
  assert.equal(dash.totals.paidSatang, 150 * 50000 + 50 * 20000);
  assert.equal(arrears.school.totalSatang, 600 * 50000 - dash.totals.paidSatang);
  assert.equal(coll.total.receipts, 200);
  assert.equal(integrity.ok, true);
});
