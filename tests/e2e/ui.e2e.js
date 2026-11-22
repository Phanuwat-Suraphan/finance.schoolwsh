'use strict';
/**
 * tests/e2e/ui.e2e.js — ทดสอบหน้าเว็บจริงใน Chromium (Playwright)
 * - ใช้หน้าเว็บที่ doGet() ประกอบจริง และต่อ google.script.run เข้ากับ Server จำลอง (tests/harness.js)
 * - กดใช้งานจริงตั้งแต่เข้าสู่ระบบ จนถึงจัดการผู้ใช้ ตั้งค่า ปีการศึกษา ประวัติการใช้งาน
 *   ทั้งบนจอคอมพิวเตอร์และมือถือ แล้วบันทึกภาพหน้าจอไว้ที่ docs/screenshots
 *
 * รัน: npm run test:e2e   (ต้องมี Playwright และ Chromium ในเครื่อง)
 */
const path = require('path');
const fs = require('fs');
const { chromium, devices } = require('playwright');
const { createAppEnv } = require('../harness');
const { makeXlsx } = require('./xlsx');

const OUT_DIR = process.env.SCREENSHOT_DIR || path.join(__dirname, '..', '..', 'docs', 'screenshots');
const APP_URL = 'https://app.test/';
const results = [];
const pageErrors = [];

function check(condition, message) {
  results.push({ ok: !!condition, message });
  if (!condition) throw new Error('ไม่ผ่าน: ' + message);
}

async function openApp(browser, h, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    // ชุดทดสอบตั้งใจบล็อกฟอนต์ภายนอก จึงไม่นับข้อผิดพลาดการโหลดไฟล์
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push('console: ' + m.text());
  });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(APP_URL)) {
      h.newExecution();
      const out = h.gas.doGet({});
      // Apps Script ใส่ meta tag ที่กำหนดด้วย addMetaTag ไว้ในหน้าหลักให้ จำลองแบบเดียวกัน
      const metas = Object.keys(out._metas).map((name) => '<meta name="' + name + '" content="' + out._metas[name] + '">').join('');
      const body = out.getContent().replace('<head>', '<head>' + metas);
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    }
    return route.abort(); // ไม่โหลดทรัพยากรภายนอก (ฟอนต์จะใช้ฟอนต์สำรองของเครื่อง)
  });
  await page.exposeFunction('__gasCall', (fn, argsJson) => {
    if (fn !== 'api') throw new Error('หน้าเว็บเรียกฟังก์ชันที่ไม่ใช่ api: ' + fn);
    h.newExecution();
    return JSON.stringify(h.gas.api.apply(null, JSON.parse(argsJson)));
  });
  await page.addInitScript(() => {
    function runner(success, failure) {
      return new Proxy({}, {
        get(_, prop) {
          if (prop === 'withSuccessHandler') return (f) => runner(f, failure);
          if (prop === 'withFailureHandler') return (f) => runner(success, f);
          if (prop === 'withUserObject') return () => runner(success, failure);
          return (...args) => {
            window.__gasCall(String(prop), JSON.stringify(args))
              .then((r) => { if (success) success(JSON.parse(r)); })
              .catch((e) => { if (failure) failure(e); });
          };
        },
      });
    }
    window.google = { script: { run: runner(null, null), host: { close() {} } } };
  });
  await page.goto(APP_URL);
  return { context, page };
}

async function shot(page, name, fullPage) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.waitForTimeout(250);
  // รอให้การเลื่อนหน้าแบบนุ่มนวลหยุดก่อนถ่ายภาพ
  for (let i = 0, last = -1; i < 30; i++) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) break;
    last = y;
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: path.join(OUT_DIR, name + '.jpg'), type: 'jpeg', quality: 82, fullPage: !!fullPage });
}

async function login(page, username, password) {
  await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
}

async function forcedChange(page, temp, next) {
  await page.getByText('กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งาน').waitFor();
  await page.getByLabel('รหัสผ่านปัจจุบัน (รหัสผ่านชั่วคราว)', { exact: true }).fill(temp);
  await page.getByLabel('รหัสผ่านใหม่', { exact: true }).fill(next);
  await page.getByLabel('ยืนยันรหัสผ่านใหม่', { exact: true }).fill(next);
  await page.getByRole('button', { name: 'บันทึกรหัสผ่านใหม่' }).click();
}

async function nav(page, label) {
  await page.locator('.nav-item', { hasText: label }).click();
  await page.locator('#page-title', { hasText: label }).waitFor();
}

async function toast(page, text) {
  await page.locator('.toast', { hasText: text }).first().waitFor({ timeout: 5000 });
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function main() {
  const h = createAppEnv();
  const browser = await chromium.launch();
  try {
    // ------------------------------------------------------------------ คอมพิวเตอร์: ผู้ดูแลระบบ
    const desk = await openApp(browser, h, { viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2, locale: 'th-TH' });
    const p = desk.page;
    await p.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).waitFor();
    check(await p.getByText('โรงเรียนวัดเสาหิน').isVisible(), 'หน้าเข้าสู่ระบบแสดงชื่อโรงเรียน');
    await shot(p, '01-login');

    await login(p, 'admin', 'wrong-pass1');
    await p.getByText('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง').waitFor();
    check(true, 'ใส่รหัสผ่านผิด แสดงข้อความ "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"');

    await login(p, 'admin', h.admin.password);
    await p.getByRole('heading', { name: /สวัสดี คุณผู้ดูแลระบบ ทดสอบ/ }).waitFor();
    for (const item of ['หน้าหลัก', 'ผู้ใช้งาน', 'ประวัติการใช้งาน', 'ตั้งค่าโรงเรียน', 'ปีการศึกษา']) {
      check(await p.locator('.nav-item', { hasText: item }).isVisible(), 'เมนูผู้ดูแลระบบมี "' + item + '"');
    }
    await shot(p, '02-home-admin');

    await nav(p, 'ผู้ใช้งาน');
    await p.getByRole('button', { name: 'เพิ่มผู้ใช้' }).click();
    const modal = p.locator('.modal');
    await modal.getByLabel('ชื่อผู้ใช้', { exact: false }).first().fill('finance1');
    await modal.getByLabel('ชื่อ-นามสกุล').fill('นางสาวสมใจ ใจดี');
    await modal.getByLabel('ตำแหน่ง').fill('ครูผู้รับผิดชอบงานการเงิน');
    await modal.getByLabel('บทบาท').selectOption('FINANCE');
    await modal.getByLabel(/^รหัสผ่านชั่วคราว/).fill('TempPass123');
    await modal.getByLabel(/^ยืนยันรหัสผ่านชั่วคราว/).fill('TempPass123');
    await modal.getByRole('button', { name: 'เพิ่มผู้ใช้' }).click();
    await toast(p, 'เพิ่มผู้ใช้ finance1 เรียบร้อยแล้ว');
    await p.locator('td', { hasText: 'finance1' }).waitFor();
    check(await p.getByText('รอเปลี่ยนรหัสผ่าน').first().isVisible(), 'ผู้ใช้ใหม่แสดงสถานะ "รอเปลี่ยนรหัสผ่าน"');

    await p.getByRole('button', { name: 'เพิ่มผู้ใช้' }).click();
    await modal.getByLabel('ชื่อผู้ใช้', { exact: false }).first().fill('director1');
    await modal.getByLabel('ชื่อ-นามสกุล').fill('นายสมชาย รักโรงเรียน');
    await modal.getByLabel('ตำแหน่ง').fill('ผู้อำนวยการโรงเรียน');
    await modal.getByLabel('บทบาท').selectOption('DIRECTOR');
    await modal.getByLabel(/^รหัสผ่านชั่วคราว/).fill('TempPass456');
    await modal.getByLabel(/^ยืนยันรหัสผ่านชั่วคราว/).fill('TempPass999');
    await modal.getByRole('button', { name: 'เพิ่มผู้ใช้' }).click();
    await modal.getByText('รหัสผ่านชั่วคราวทั้งสองช่องไม่ตรงกัน').waitFor();
    check(true, 'ฟอร์มเพิ่มผู้ใช้ตรวจรหัสผ่านสองช่องไม่ตรงกัน');
    await modal.getByLabel(/^ยืนยันรหัสผ่านชั่วคราว/).fill('TempPass456');
    await modal.getByRole('button', { name: 'เพิ่มผู้ใช้' }).click();
    await toast(p, 'เพิ่มผู้ใช้ director1 เรียบร้อยแล้ว');
    await p.locator('td', { hasText: 'director1' }).waitFor();
    await shot(p, '03-users');

    await nav(p, 'ตั้งค่าโรงเรียน');
    await p.getByLabel('ที่อยู่โรงเรียน').fill('หมู่ 1 ตำบลตัวอย่าง อำเภอตัวอย่าง จังหวัดเชียงใหม่');
    await p.getByLabel('ชื่อผู้อำนวยการ').fill('นายสมชาย รักโรงเรียน');
    await p.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' }).click();
    await toast(p, 'บันทึกค่าตั้งค่า 2 รายการเรียบร้อยแล้ว');
    await p.getByLabel('ที่อยู่โรงเรียน').waitFor();
    check((await p.getByLabel('ที่อยู่โรงเรียน').inputValue()).includes('ตำบลตัวอย่าง'), 'ค่าที่บันทึกแสดงหลังโหลดใหม่');
    await shot(p, '04-settings');

    await nav(p, 'ปีการศึกษา');
    await p.getByRole('button', { name: 'เพิ่มปีการศึกษา' }).click();
    check((await modal.getByLabel('ปีการศึกษา (พ.ศ.)').inputValue()) === '2570', 'เสนอปีการศึกษาถัดไป 2570');
    await modal.getByLabel('วันเริ่มปีการศึกษา').fill('2027-05-16');
    await modal.getByText('= 16 พฤษภาคม 2570').waitFor();
    check(true, 'ช่องวันที่แสดงวันที่ พ.ศ. ให้ทันที');
    await modal.getByLabel('วันสิ้นสุดปีการศึกษา').fill('2028-03-31');
    await modal.getByRole('button', { name: 'บันทึก' }).click();
    await toast(p, 'บันทึกปีการศึกษาเรียบร้อยแล้ว');
    await p.locator('td', { hasText: '2570' }).first().waitFor();
    await p.getByRole('button', { name: 'ตั้งเป็นปีปัจจุบัน' }).click();
    await p.locator('.modal').getByRole('button', { name: 'ตั้งเป็นปีปัจจุบัน' }).click();
    await toast(p, 'ตั้งปีการศึกษา 2570 เป็นปีปัจจุบันแล้ว');
    await p.locator('.year-chip', { hasText: '2570' }).waitFor();
    check(true, 'ตั้งปีปัจจุบันแล้ว ป้ายปีการศึกษาด้านบนเปลี่ยนเป็น 2570');
    await shot(p, '05-years');

    await nav(p, 'ประวัติการใช้งาน');
    await p.locator('.data-table tbody tr').first().waitFor();
    await p.getByRole('button', { name: 'ตรวจความถูกต้องของประวัติ' }).click();
    await p.locator('.modal').getByText(/ถูกต้อง: ประวัติการใช้งาน \d+ รายการ/).waitFor();
    check(true, 'ตรวจความถูกต้องของประวัติจากหน้าเว็บ: ถูกต้อง');
    await p.locator('.modal').getByRole('button', { name: 'ปิด', exact: true }).first().click();
    await p.locator('.data-table tbody tr', { hasText: 'แก้ไข' }).first().click();
    await p.locator('.modal').getByText('ค่าเดิม').waitFor();
    check(true, 'คลิกประวัติการแก้ไขแล้วเห็นค่าเดิมและค่าใหม่');
    await shot(p, '06-audit-detail');
    await p.keyboard.press('Escape');
    await shot(p, '06-audit');

    await p.locator('.userbox').getByRole('button', { name: 'ออกจากระบบ' }).click();
    await p.getByText('ออกจากระบบเรียบร้อยแล้ว').waitFor();
    check(true, 'ออกจากระบบแล้วกลับหน้าเข้าสู่ระบบ');

    // ------------------------------------------------------------------ คอมพิวเตอร์: เจ้าหน้าที่การเงิน
    await login(p, 'finance1', 'TempPass123');
    await p.getByText('กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งาน').waitFor();
    await shot(p, '07-force-change-password');
    await forcedChange(p, 'TempPass123', 'Somjai2569pw');
    await toast(p, 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว');
    await p.getByRole('heading', { name: /สวัสดี คุณนางสาวสมใจ ใจดี/ }).waitFor();
    check(!(await p.locator('.nav-item', { hasText: 'ผู้ใช้งาน' }).count()), 'เจ้าหน้าที่การเงินไม่เห็นเมนูผู้ใช้งาน');
    check(!(await p.locator('.nav-item', { hasText: 'ประวัติการใช้งาน' }).count()), 'เจ้าหน้าที่การเงินไม่เห็นเมนูประวัติการใช้งาน');
    await nav(p, 'ตั้งค่าโรงเรียน');
    check(await p.getByLabel('ที่อยู่โรงเรียน').isDisabled(), 'เจ้าหน้าที่การเงินดูค่าตั้งค่าได้แต่แก้ไขไม่ได้');
    check(await p.getByText('เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขค่าตั้งค่าได้').isVisible(), 'แสดงข้อความว่าแก้ไขได้เฉพาะผู้ดูแลระบบ');
    // แม้แก้หน้าเว็บเองเพื่อเรียกคำสั่งของผู้ดูแลระบบ Server ก็ปฏิเสธ
    const forged = await p.evaluate(() => App.api('users.list').then(() => 'allowed', (e) => e.code + ':' + e.message));
    check(forged === 'FORBIDDEN:ไม่มีสิทธิ์ใช้งานคำสั่งนี้', 'เรียกคำสั่งของผู้ดูแลระบบจากหน้าเว็บโดยตรง ถูก Server ปฏิเสธ (' + forged + ')');

    // ------------------------------------------------------------------ คอมพิวเตอร์: เจ้าหน้าที่การเงิน → ข้อมูลนักเรียน
    await nav(p, 'นักเรียน');
    await p.getByLabel('ปีการศึกษา').first().selectOption('2569');
    await p.getByText('ยังไม่มีข้อมูลนักเรียนในปีการศึกษานี้').waitFor();
    check(true, 'หน้านักเรียนแสดงข้อความเมื่อยังไม่มีข้อมูล');

    await p.getByRole('button', { name: 'เพิ่มนักเรียน' }).click();
    await modal.getByLabel(/^เลขประจำตัวนักเรียน/).fill('10001');
    await modal.getByLabel('คำนำหน้าชื่อ').selectOption('เด็กชาย');
    await modal.getByLabel(/^ชื่อ/).first().fill('สมชาย');
    await modal.getByLabel('นามสกุล').fill('ใจดี');
    check((await modal.getByLabel(/^ปีการศึกษา/).inputValue()) === '2569', 'ฟอร์มเพิ่มนักเรียนใช้ปีการศึกษาที่เลือกอยู่');
    await modal.getByLabel(/^ระดับชั้น/).selectOption('ป.1');
    await modal.getByLabel('ห้อง').fill('1');
    await modal.getByLabel('เลขที่').fill('1');
    await modal.getByRole('button', { name: 'บันทึก' }).click();
    await toast(p, 'เพิ่มนักเรียน เด็กชายสมชาย ใจดี เรียบร้อยแล้ว');

    await p.getByRole('button', { name: 'เพิ่มนักเรียน' }).click();
    await modal.getByLabel(/^เลขประจำตัวนักเรียน/).fill('10099');
    await modal.getByLabel(/^ชื่อ/).first().fill('สมชาย');
    await modal.getByLabel('นามสกุล').fill('ใจดี');
    await modal.getByLabel('ห้อง').fill('2');
    await modal.getByRole('button', { name: 'บันทึก' }).click();
    await modal.getByText('กรุณาเลือกระดับชั้น').waitFor();
    check(true, 'เพิ่มนักเรียนใหม่ต้องเลือกระดับชั้นเอง ระบบไม่เลือกให้');
    await modal.getByLabel(/^ระดับชั้น/).selectOption('ป.1');
    await modal.getByRole('button', { name: 'บันทึก' }).click();
    await p.getByText(/มีนักเรียนชื่อ เด็กชายสมชาย ใจดี อยู่แล้ว/).waitFor();
    check(true, 'เพิ่มนักเรียนชื่อซ้ำ ระบบเตือนและให้ยืนยันก่อนบันทึก');
    await p.getByRole('button', { name: 'ยืนยัน เป็นคนละคน' }).click();
    await toast(p, 'เพิ่มนักเรียน สมชาย ใจดี เรียบร้อยแล้ว');

    await p.getByRole('button', { name: 'นำเข้าจาก Excel/CSV' }).click();
    await p.locator('#page-title', { hasText: 'นำเข้าข้อมูลนักเรียน' }).waitFor();
    const xlsx = makeXlsx([
      ['รายชื่อนักเรียน ปีการศึกษา 2569'],
      ['ลำดับ', 'เลขประจำตัวนักเรียน', 'ชื่อ-นามสกุล', 'ชั้น/ห้อง', 'เลขที่'],
      [1, 10001, 'เด็กชายสมชาย ใจดี', 'ป.1/1', 1],
      [2, 20001, 'เด็กหญิงมานี มีนา', 'ป.1/1', 2],
      [3, 20002, 'เด็กชายปิติ ยินดี', 'ประถมศึกษาปีที่ 6/1', 1],
      [4, 20003, 'เด็กหญิงชูใจ เลิศล้ำ', 'ป.2/1', 1],
      [5, 20004, 'เด็กชายวีระ กล้าหาญ', 'ม.1/1', 1],
    ]);
    await p.locator('#student-file').setInputFiles({ name: 'รายชื่อนักเรียน.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx });
    await p.getByText('พบข้อมูล 5 แถว จาก รายชื่อนักเรียน.xlsx').waitFor();
    check(true, 'อ่านไฟล์ .xlsx ในเบราว์เซอร์ได้ (หัวตารางอยู่แถวที่ 2)');
    await p.getByRole('button', { name: 'ตรวจสอบข้อมูล' }).click();
    await p.getByText('3. ผลการตรวจสอบ (ยังไม่ได้บันทึก)').waitFor();
    check(await p.getByText(/ระดับชั้น "ม.1" ไม่อยู่ในรายการ/).isVisible(), 'ผลตรวจแสดงแถวที่ระดับชั้นไม่ถูกต้อง');
    await shot(p, '13-import-preview');
    await p.getByRole('button', { name: 'นำเข้า 3 รายการ' }).click();
    await p.locator('.modal').getByRole('button', { name: 'นำเข้า', exact: true }).click();
    await p.getByRole('heading', { name: 'นำเข้าข้อมูลเรียบร้อย' }).waitFor();
    check(true, 'นำเข้าไฟล์ .xlsx: บันทึก 3 รายการ ข้ามแถวที่ไม่ถูกต้อง');

    await p.getByRole('button', { name: 'ดูรายชื่อนักเรียน ปีการศึกษา 2569' }).click();
    await p.locator('td', { hasText: 'มานี' }).waitFor();
    await p.getByRole('button', { name: 'นำเข้าจาก Excel/CSV' }).click();
    await p.getByLabel(/^หรือคัดลอกตารางจาก Excel/).fill('เลขประจำตัวนักเรียน\tคำนำหน้า\tชื่อ\tนามสกุล\tระดับชั้น\tห้อง\tเลขที่\n30001\tเด็กชาย\tกล้า\tหาญ\tป.2\t1\t2');
    await p.getByRole('button', { name: 'อ่านข้อมูลที่วาง' }).click();
    await p.getByRole('button', { name: 'ตรวจสอบข้อมูล' }).click();
    await p.getByRole('button', { name: 'นำเข้า 1 รายการ' }).click();
    await p.locator('.modal').getByRole('button', { name: 'นำเข้า', exact: true }).click();
    await p.getByRole('heading', { name: 'นำเข้าข้อมูลเรียบร้อย' }).waitFor();
    check(true, 'นำเข้าด้วยการคัดลอกตารางจาก Excel มาวาง');
    await p.getByRole('button', { name: 'ดูรายชื่อนักเรียน ปีการศึกษา 2569' }).click();
    await p.locator('td', { hasText: 'กล้า' }).waitFor();
    check((await p.locator('.data-table tbody tr').count()) === 6, 'รายชื่อปี 2569 มีนักเรียน 6 คน');
    await p.getByLabel('ค้นหา').fill('ยินดี');
    check((await p.locator('.data-table tbody tr').count()) === 1, 'ค้นหาด้วยนามสกุลแล้วเหลือ 1 คน');
    await p.getByLabel('ค้นหา').fill('');
    await shot(p, '12-students');

    await p.locator('.data-table tbody tr', { hasText: 'ชูใจ' }).getByRole('button', { name: 'สถานะ' }).click();
    await modal.getByLabel('สถานะ').selectOption('TRANSFERRED');
    await modal.getByLabel('หมายเหตุ').fill('ย้ายตามผู้ปกครองไปจังหวัดลำพูน');
    await modal.getByRole('button', { name: 'บันทึก' }).click();
    await toast(p, 'เปลี่ยนสถานะ เด็กหญิงชูใจ เลิศล้ำ เป็นย้ายออกแล้ว');
    check((await p.locator('.data-table tbody tr').count()) === 5, 'ตัวกรองค่าเริ่มต้นแสดงเฉพาะผู้ที่กำลังศึกษา');

    await p.getByRole('button', { name: 'เลื่อนชั้นขึ้นปีใหม่' }).click();
    await p.locator('#page-title', { hasText: 'เลื่อนชั้นขึ้นปีการศึกษาใหม่' }).waitFor();
    await p.getByLabel('จากปีการศึกษา').selectOption('2569');
    await p.getByRole('button', { name: 'ดูตัวอย่างการเลื่อนชั้น' }).click();
    await p.getByText('ตัวอย่าง (ยังไม่ได้บันทึก)').waitFor();
    await shot(p, '14-promote');
    await p.getByRole('button', { name: /ยืนยันเลื่อนชั้น 4 คน และจบการศึกษา 1 คน/ }).click();
    await p.locator('.modal').getByRole('button', { name: 'ยืนยันเลื่อนชั้น' }).click();
    await p.getByText('เลื่อนชั้น 4 คน · จบการศึกษา 1 คน · ข้าม 0 คน').waitFor();
    check(true, 'เลื่อนชั้น 4 คน ชั้น ป.6 จบการศึกษา 1 คน ผู้ที่ย้ายออกไม่ถูกเลื่อน');
    await p.getByRole('button', { name: 'ดูรายชื่อนักเรียน ปีการศึกษา 2570' }).click();
    await p.locator('td', { hasText: 'ป.2/1' }).first().waitFor();
    check((await p.locator('.data-table tbody tr').count()) === 4, 'ปีการศึกษา 2570 มีนักเรียนที่เลื่อนชั้นแล้ว 4 คน');

    // ------------------------------------------------------------------ คอมพิวเตอร์: เจ้าหน้าที่การเงิน → อัตรา เรียกเก็บ เล่มใบเสร็จ รับเงิน
    await nav(p, 'อัตราและการเรียกเก็บ');
    await p.getByText('ยังไม่มีอัตราเงินบำรุงของปีการศึกษานี้').waitFor();
    await p.getByRole('button', { name: 'ตั้งอัตราเงินบำรุง' }).click();
    await modal.getByRole('button', { name: 'ตั้งอัตรา' }).click();
    await modal.getByText('กรุณาเลือกระดับชั้น (เลือกได้หลายชั้นถ้าอัตราเท่ากัน)').waitFor();
    check(true, 'ฟอร์มตั้งอัตราเตือนเมื่อยังไม่เลือกระดับชั้น');
    await modal.getByLabel('ป.2', { exact: true }).check();
    await modal.getByLabel('ป.3', { exact: true }).check();
    await modal.getByLabel(/^จำนวนเงินต่อคน/).fill('500');
    await modal.getByLabel(/^วันครบกำหนดชำระ/).fill('2027-06-30');
    await modal.getByLabel('เอกสารที่อนุมัติอัตรา').fill('มติคณะกรรมการสถานศึกษา ครั้งที่ 1/2570 ลงวันที่ 1 พ.ค. 2570');
    await modal.getByRole('button', { name: 'ตั้งอัตรา' }).click();
    await toast(p, 'ตั้งอัตราแล้ว 2 ชั้น');
    await p.locator('.data-table tbody tr', { hasText: 'ป.2' }).getByRole('button', { name: 'สร้างรายการเรียกเก็บ' }).click();
    await p.locator('.modal').getByText('จะสร้างรายการเรียกเก็บ 3 คน รวม 1,500.00 บาท').waitFor();
    check(true, 'ดูตัวอย่างก่อนสร้างรายการเรียกเก็บ: ป.2 จำนวน 3 คน รวม 1,500.00 บาท');
    await shot(p, '16-fee-generate');
    await p.locator('.modal').getByRole('button', { name: 'สร้างรายการเรียกเก็บ 3 คน' }).click();
    await toast(p, 'สร้างรายการเรียกเก็บ 3 คน รวม 1,500.00 บาท เรียบร้อยแล้ว');
    await p.locator('.data-table tbody tr', { hasText: 'ป.3' }).getByRole('button', { name: 'สร้างรายการเรียกเก็บ' }).click();
    await p.locator('.modal').getByRole('button', { name: 'สร้างรายการเรียกเก็บ 1 คน' }).click();
    await toast(p, 'สร้างรายการเรียกเก็บ 1 คน');
    await p.locator('.stat', { hasText: 'คงค้าง' }).getByText('2,000.00 บาท').waitFor();
    check(true, 'หน้าอัตราแสดงยอดคงค้างรวม 2,000.00 บาท');
    await shot(p, '17-fees');

    await nav(p, 'รับชำระเงิน');
    await p.getByText('ยังไม่มีเล่มใบเสร็จที่กำลังใช้').waitFor();
    check(true, 'หน้ารับเงินเตือนเมื่อยังไม่มีเล่มใบเสร็จที่กำลังใช้');
    await p.getByRole('button', { name: 'ไปที่เล่มใบเสร็จ' }).click();
    await p.locator('#page-title', { hasText: 'เล่มใบเสร็จ' }).waitFor();
    await p.getByRole('button', { name: 'ลงทะเบียนเล่มใหม่' }).click();
    await modal.getByLabel(/^เลขเล่ม/).fill('1/2570');
    await modal.getByLabel(/^เลขที่ใบแรก/).fill('1');
    await modal.getByLabel(/^เลขที่ใบสุดท้าย/).fill('50');
    await modal.getByRole('button', { name: 'ลงทะเบียน' }).click();
    await toast(p, 'ลงทะเบียนเล่มที่ 1/2570 (เลขที่ 1–50) เรียบร้อยแล้ว');
    await p.getByRole('button', { name: 'เปิดใช้', exact: true }).click();
    await p.locator('.modal').getByRole('button', { name: 'เปิดใช้เล่มนี้' }).click();
    await toast(p, 'เปิดใช้เล่มที่ 1/2570 แล้ว เลขที่ถัดไปคือ 1');
    await p.getByText('เล่มที่ 1/2570 เลขที่ 1', { exact: true }).waitFor();
    await shot(p, '18-receipt-books');

    await nav(p, 'รับชำระเงิน');
    check((await p.locator('.data-table tbody tr').count()) === 4, 'หน้ารับเงินแสดงนักเรียนที่มียอดค้าง 4 คน');
    await p.getByLabel('ค้นหานักเรียน').fill('มานี');
    await p.locator('.data-table tbody tr', { hasText: 'มานี' }).click();
    await p.getByRole('heading', { name: 'รับชำระเงิน: เด็กหญิงมานี มีนา' }).waitFor();
    await p.getByLabel(/^จำนวนเงินที่รับ/).fill('300');
    check((await p.getByLabel(/^ตัดชำระ /).first().inputValue()) === '300.00', 'กรอกจำนวนเงินแล้วระบบตัดชำระหนี้เก่าก่อนให้อัตโนมัติ');
    await p.getByText('ยอดตัดชำระรวม 300.00 บาท เท่ากับจำนวนเงินที่รับ').waitFor();
    await p.locator('.receipt-preview').getByText('(สามร้อยบาทถ้วน)').waitFor();
    check(true, 'แสดงรายการที่ต้องเขียนในใบเสร็จ พร้อมจำนวนเงินเป็นตัวอักษร');
    await p.getByRole('button', { name: 'บันทึกการรับเงิน' }).click();
    await p.getByText('กรุณาติ๊กยืนยันว่าได้ตรวจสอบใบเสร็จรับเงินฉบับจริงแล้ว').waitFor();
    check(true, 'บันทึกไม่ได้จนกว่าจะติ๊กยืนยันว่าตรวจใบเสร็จฉบับจริงแล้ว');
    await p.locator('#confirm-receipt').check();
    await shot(p, '19-payment-form');
    await p.getByRole('button', { name: 'บันทึกการรับเงิน' }).click();
    await p.getByRole('heading', { name: 'บันทึกการรับเงินเรียบร้อย' }).waitFor();
    check(await p.getByText('เล่มที่ 1/2570 เลขที่ 1', { exact: true }).isVisible(), 'บันทึกรับเงินใบเสร็จเล่มที่ 1/2570 เลขที่ 1');
    check(await p.locator('.data-table').getByText('ชำระบางส่วน').isVisible(), 'สถานะเปลี่ยนเป็นชำระบางส่วน');
    await shot(p, '20-payment-done');
    await p.getByRole('button', { name: 'รับเงินจากนักเรียนคนนี้อีกครั้ง' }).click();
    await p.getByRole('button', { name: 'รับเต็มยอดค้าง 200.00 บาท' }).click();
    await p.getByLabel(/^ช่องทางการรับเงิน/).selectOption('โอนเงินเข้าบัญชีโรงเรียน');
    await p.locator('#confirm-receipt').check();
    await p.getByRole('button', { name: 'บันทึกการรับเงิน' }).click();
    await p.getByText('กรุณากรอกเลขอ้างอิงการโอน').waitFor();
    check(true, 'รับเงินโอนต้องกรอกเลขอ้างอิงการโอน');
    await p.getByLabel(/^เลขอ้างอิงการโอน/).fill('KTB-20261121-001');
    await p.getByRole('button', { name: 'บันทึกการรับเงิน' }).click();
    await p.getByRole('heading', { name: 'บันทึกการรับเงินเรียบร้อย' }).waitFor();
    check(await p.getByText('เล่มที่ 1/2570 เลขที่ 2', { exact: true }).isVisible(), 'เลขที่ใบเสร็จเดินต่อเป็นเลขที่ 2');
    check(await p.locator('.data-table').getByText('ชำระครบ').isVisible(), 'จ่ายครบแล้วสถานะเป็นชำระครบ');

    await nav(p, 'อัตราและการเรียกเก็บ');
    await p.locator('.data-table tbody tr td', { hasText: /^ป\.2$/ }).click();
    await p.getByRole('heading', { name: 'เงินบำรุงการศึกษา ภาคเรียนที่ 1/2570 ชั้น ป.2' }).waitFor();
    await p.locator('.data-table tbody tr', { hasText: '10001' }).getByRole('button', { name: 'ลดหย่อน/ยกเว้น' }).click();
    await modal.getByLabel(/^จำนวนเงินที่ลดหย่อน/).fill('100');
    await modal.getByLabel(/^เหตุผล/).fill('ครอบครัวมีรายได้น้อย');
    await modal.getByLabel(/^เอกสารอ้างอิง/).fill('หนังสือขอลดหย่อน ลงวันที่ 20 พ.ย. 2569');
    await modal.getByRole('button', { name: 'ส่งคำขอ' }).click();
    await toast(p, 'ส่งคำขอลดหย่อน 100.00 บาท ให้ผู้อำนวยการพิจารณาแล้ว');
    await p.locator('.data-table tbody tr', { hasText: '10001' }).getByText('รออนุมัติ: ลดหย่อน/ยกเว้น').waitFor();
    check(true, 'ส่งคำขอลดหย่อนแล้ว รายการแสดงว่ารออนุมัติ และยอดเดิมยังมีผล');
    await shot(p, '21-fee-detail');

    await p.getByRole('button', { name: 'กลับ' }).click();
    await p.locator('.data-table tbody tr td', { hasText: /^ป\.3$/ }).click();
    await p.locator('.data-table tbody tr', { hasText: '30001' }).click();
    await p.getByRole('heading', { name: 'เด็กชายกล้า หาญ' }).waitFor();
    await p.getByRole('button', { name: 'ลดหย่อน/ยกเว้น' }).click();
    await modal.getByLabel(/^ประเภท/).selectOption('EXEMPTION');
    check((await modal.getByLabel(/^จำนวนเงินที่ลดหย่อน/).inputValue()) === '500.00', 'เลือกยกเว้นแล้วจำนวนเงินเป็นยอดคงเหลือทั้งหมด');
    await modal.getByLabel(/^เหตุผล/).fill('นักเรียนทุนพระราชทาน');
    await modal.getByLabel(/^เอกสารอ้างอิง/).fill('ประกาศโรงเรียน ที่ 5/2569');
    await modal.getByRole('button', { name: 'ส่งคำขอ' }).click();
    await toast(p, 'ส่งคำขอยกเว้น 500.00 บาท ให้ผู้อำนวยการพิจารณาแล้ว');
    await p.getByText('รออนุมัติ: ลดหย่อน/ยกเว้น').waitFor();
    await shot(p, '22-student-account');

    await nav(p, 'รายการรับเงิน');
    await p.getByText('2 ฉบับ รวม 500.00 บาท').waitFor();
    check((await p.locator('.data-table tbody tr').count()) === 2, 'รายการรับเงินวันนี้ 2 ฉบับ รวม 500.00 บาท');
    await shot(p, '23-payment-history');
    await desk.context.close();

    // ------------------------------------------------------------------ มือถือ: ผู้อำนวยการ
    const mobile = await openApp(browser, h, Object.assign({}, devices['iPhone 13'], { locale: 'th-TH' }));
    const m = mobile.page;
    await m.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).waitFor();
    await shot(m, '08-mobile-login');
    await login(m, 'director1', 'TempPass456');
    await forcedChange(m, 'TempPass456', 'Director2569pw');
    await m.getByRole('heading', { name: /สวัสดี คุณนายสมชาย รักโรงเรียน/ }).waitFor();
    await m.locator('.stat', { hasText: 'คำขอรอพิจารณา' }).getByText('2 รายการ').waitFor();
    check(true, 'หน้าหลักผู้อำนวยการแสดงคำขอรอพิจารณา 2 รายการ');
    check(await noHorizontalScroll(m), 'มือถือ: หน้าหลักไม่มีแถบเลื่อนแนวนอน');
    const sideBox = await m.locator('.sidebar').boundingBox();
    check(!sideBox || sideBox.x + sideBox.width <= 1, 'มือถือ: เมนูข้างซ่อนไว้จนกว่าจะกดปุ่มเมนู');
    await shot(m, '09-mobile-home');
    await m.getByRole('button', { name: 'เปิดเมนู' }).click();
    await m.waitForTimeout(300);
    check(await m.locator('.nav-item', { hasText: 'ประวัติการใช้งาน' }).isVisible(), 'มือถือ: กดปุ่มเมนูแล้วเห็นเมนู');
    await shot(m, '10-mobile-menu');
    await m.locator('.nav-item', { hasText: 'ประวัติการใช้งาน' }).click();
    await m.locator('.data-table tbody tr').first().waitFor();
    check(await noHorizontalScroll(m), 'มือถือ: ตารางประวัติแสดงเป็นการ์ด ไม่มีแถบเลื่อนแนวนอน');
    await shot(m, '11-mobile-audit');
    await m.getByRole('button', { name: 'เปิดเมนู' }).click();
    await m.locator('.nav-item', { hasText: 'นักเรียน' }).click();
    await m.locator('.data-table tbody tr').first().waitFor();
    check(!(await m.getByRole('button', { name: 'เพิ่มนักเรียน' }).count()), 'ผู้อำนวยการดูรายชื่อนักเรียนได้ แต่ไม่มีปุ่มเพิ่มหรือนำเข้า');
    check(await noHorizontalScroll(m), 'มือถือ: รายชื่อนักเรียนไม่มีแถบเลื่อนแนวนอน');
    await shot(m, '15-mobile-students');

    await m.getByRole('button', { name: 'เปิดเมนู' }).click();
    check(!(await m.locator('.nav-item', { hasText: 'รับชำระเงิน' }).count()), 'ผู้อำนวยการไม่เห็นเมนูรับชำระเงิน');
    await m.locator('.nav-item', { hasText: 'คำขออนุมัติ' }).click();
    await m.locator('.data-table tbody tr').first().waitFor();
    check(await noHorizontalScroll(m), 'มือถือ: หน้าคำขออนุมัติไม่มีแถบเลื่อนแนวนอน');
    await shot(m, '24-mobile-approvals');
    await m.locator('.data-table tbody tr', { hasText: 'ลดหย่อน 100.00 บาท' }).getByRole('button', { name: 'พิจารณา' }).click();
    await m.locator('.modal').getByText('หนังสือขอลดหย่อน ลงวันที่ 20 พ.ย. 2569').waitFor();
    await m.locator('.modal').getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await toast(m, 'อนุมัติคำขอเรียบร้อยแล้ว');
    await m.locator('.data-table tbody tr', { hasText: 'ยกเว้น 500.00 บาท' }).getByRole('button', { name: 'พิจารณา' }).click();
    await m.locator('.modal').getByRole('button', { name: 'ไม่อนุมัติ' }).click();
    await m.locator('.modal').getByText('กรุณากรอกเหตุผลที่ไม่อนุมัติ').waitFor();
    check(true, 'ไม่อนุมัติต้องกรอกเหตุผล');
    await m.locator('.modal').getByLabel(/^ความเห็น/).fill('ขอเอกสารประกาศทุนฉบับจริงก่อน');
    await m.locator('.modal').getByRole('button', { name: 'ไม่อนุมัติ' }).click();
    await toast(m, 'ไม่อนุมัติคำขอเรียบร้อยแล้ว');
    await m.getByText('ไม่มีคำขอที่รออนุมัติ').waitFor();
    check(true, 'ผู้อำนวยการอนุมัติ 1 คำขอ และไม่อนุมัติ 1 คำขอ');
    const forgedPay = await m.evaluate(() => App.api('payments.create', {}).then(() => 'allowed', (e) => e.code));
    check(forgedPay === 'FORBIDDEN', 'ผู้อำนวยการเรียกคำสั่งบันทึกรับเงินโดยตรง ถูก Server ปฏิเสธ');
    await m.getByRole('button', { name: 'เปิดเมนู' }).click();
    await m.locator('.nav-item', { hasText: 'อัตราและการเรียกเก็บ' }).click();
    await m.locator('.data-table tbody tr td', { hasText: /^ป\.2$/ }).click();
    await m.locator('.data-table tbody tr', { hasText: '10001' }).getByText('400.00').first().waitFor();
    check(true, 'หลังอนุมัติ ยอดสุทธิของนักเรียนลดเหลือ 400.00 บาท');
    check(await noHorizontalScroll(m), 'มือถือ: รายการเรียกเก็บไม่มีแถบเลื่อนแนวนอน');
    await shot(m, '25-mobile-fee-detail');
    await mobile.context.close();
  } finally {
    await browser.close();
  }
  check(pageErrors.length === 0, 'ไม่มีข้อผิดพลาด JavaScript ในหน้าเว็บ ' + (pageErrors.length ? JSON.stringify(pageErrors) : ''));
}

main()
  .then(() => {
    results.forEach((r) => console.log((r.ok ? '✓ ' : '✗ ') + r.message));
    console.log('\nผ่าน ' + results.length + ' รายการ ภาพหน้าจออยู่ที่ ' + path.relative(process.cwd(), OUT_DIR));
  })
  .catch((err) => {
    results.forEach((r) => console.log((r.ok ? '✓ ' : '✗ ') + r.message));
    console.error('\n' + err.stack);
    if (pageErrors.length) console.error('ข้อผิดพลาดในหน้าเว็บ:\n' + pageErrors.join('\n'));
    process.exit(1);
  });
