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
    await desk.context.close();

    // ------------------------------------------------------------------ มือถือ: ผู้อำนวยการ
    const mobile = await openApp(browser, h, Object.assign({}, devices['iPhone 13'], { locale: 'th-TH' }));
    const m = mobile.page;
    await m.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).waitFor();
    await shot(m, '08-mobile-login');
    await login(m, 'director1', 'TempPass456');
    await forcedChange(m, 'TempPass456', 'Director2569pw');
    await m.getByRole('heading', { name: /สวัสดี คุณนายสมชาย รักโรงเรียน/ }).waitFor();
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
