'use strict';
/**
 * scripts/build.js — รวมไฟล์ทั้งหมดใน src/ เป็นไฟล์เดียว dist/Code.gs
 * เพื่อให้โรงเรียนติดตั้งหรืออัปเดตได้ด้วยการคัดลอกแล้ววางครั้งเดียว
 *
 * ใช้งาน: npm run build
 * ชุดทดสอบ (tests/bundle.test.js) จะแจ้งเตือนถ้า dist/Code.gs ไม่ตรงกับ src/
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const OUT_FILE = path.join(ROOT, 'dist', 'Code.gs');

/**
 * ลำดับไฟล์ในไฟล์รวม: ส่วนที่ผู้ติดตั้งใช้ก่อน (SetupDatabase อยู่บนสุด) แล้วจึงเป็นรายละเอียด
 * ทุกไฟล์ไม่มีโค้ดระดับไฟล์ที่พึ่งไฟล์อื่น จึงเรียงลำดับใดก็ทำงานได้ (มีชุดทดสอบยืนยัน)
 */
const ORDER = ['Setup.js', 'Code.js', 'Api.js', 'Auth.js', 'Users.js', 'Settings.js', 'Students.js', 'StudentImport.js',
  'Ledger.js', 'Fees.js', 'Approvals.js', 'Receipts.js', 'Payments.js', 'Arrears.js',
  'Closings.js', 'Reports.js', 'Dashboard.js', 'Backup.js',
  'Config.js', 'Shared.js', 'Utils.js', 'Db.js', 'Audit.js'];

function readAppInfo() {
  const config = fs.readFileSync(path.join(SRC_DIR, 'Config.js'), 'utf8');
  return vm.runInNewContext(config + '\n;({ version: APP.VERSION, release: APP.RELEASE, name: APP.NAME, school: APP.SCHOOL_NAME, province: APP.PROVINCE })');
}

function buildBundle() {
  const available = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).sort();
  const notListed = available.filter((f) => !ORDER.includes(f));
  if (notListed.length) {
    throw new Error('มีไฟล์ใหม่ใน src/ ที่ยังไม่ได้ใส่ใน ORDER ของ scripts/build.js: ' + notListed.join(', '));
  }
  const missing = ORDER.filter((f) => !available.includes(f));
  if (missing.length) throw new Error('ไม่พบไฟล์ใน src/: ' + missing.join(', '));

  const app = readAppInfo();
  const line = '='.repeat(76);
  const header = [
    '/**',
    ' * ' + line,
    ' *  ' + app.name,
    ' *  ' + app.school + ' จังหวัด' + app.province,
    ' *  เวอร์ชัน ' + app.version + ' — ' + app.release,
    ' * ' + line,
    ' *',
    ' *  วิธีติดตั้งและอัปเดต (ขั้นตอนละเอียดและรูปประกอบ: docs/INSTALL.md)',
    ' *   1. เปิด Google Sheets ที่จะใช้เป็นฐานข้อมูล > เมนู ส่วนขยาย > Apps Script',
    ' *   2. ลบโค้ดเดิมในไฟล์ Code.gs ทั้งหมด แล้ววางเนื้อหาไฟล์นี้ทั้งไฟล์ > กด Ctrl+S',
    ' *   3. แถบด้านบน เลือกฟังก์ชัน SetupDatabase > กด "เรียกใช้" (Run) > อนุญาตสิทธิ์',
    ' *   4. ครั้งแรกเท่านั้น: รีเฟรช Google Sheets > เมนู "ระบบเงินบำรุงการศึกษา"',
    ' *      > 3) สร้างหรือรีเซ็ตบัญชีผู้ดูแลระบบ',
    ' *   5. เผยแพร่เว็บ: Deploy > New deployment > Web app',
    ' *      Execute as = Me / Who has access = Anyone with Google account',
    ' *      อัปเดตครั้งต่อไป: Deploy > Manage deployments > แก้ไข (ดินสอ) > Version: New version > Deploy',
    ' *',
    ' *  ข้อมูลเดิมไม่หายเมื่ออัปเดต และลิงก์เว็บแอปเดิมใช้ต่อได้',
    ' *',
    ' *  ห้ามแก้ไขไฟล์นี้โดยตรง: ไฟล์นี้สร้างอัตโนมัติจากโฟลเดอร์ src/ ด้วยคำสั่ง npm run build',
    ' * ' + line,
    ' */',
    '',
  ].join('\n');

  const parts = ORDER.map((file) => {
    const code = fs.readFileSync(path.join(SRC_DIR, file), 'utf8').replace(/\s+$/, '');
    return '// ' + line + '\n// ไฟล์ต้นฉบับ: src/' + file + '\n// ' + line + '\n\n' + code + '\n';
  });

  // หน้าเว็บ: ฝังไฟล์ HTML เป็นข้อความ ให้ htmlSource_() ใน Code.gs อ่านจากที่นี่
  const htmlFiles = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.html')).sort();
  const htmlEntries = htmlFiles.map((file) => {
    const name = file.replace(/\.html$/, '');
    return '  ' + JSON.stringify(name) + ': ' + JSON.stringify(fs.readFileSync(path.join(SRC_DIR, file), 'utf8')) + ',';
  });
  parts.push('// ' + line + '\n// หน้าเว็บ: ไฟล์ HTML จาก src/ (' + htmlFiles.join(', ') + ')\n// ' + line + '\n\n' +
    'const BUNDLED_HTML_ = Object.freeze({\n' + htmlEntries.join('\n') + '\n});\n');
  return header + '\n' + parts.join('\n');
}

if (require.main === module) {
  const bundle = buildBundle();
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, bundle);
  const kb = (Buffer.byteLength(bundle, 'utf8') / 1024).toFixed(1);
  console.log('สร้าง dist/Code.gs แล้ว: ' + bundle.split('\n').length + ' บรรทัด, ' + kb + ' KB');
}

module.exports = { buildBundle, ORDER, OUT_FILE };
