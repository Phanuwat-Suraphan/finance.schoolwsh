'use strict';
/**
 * tests/e2e/xlsx.js — สร้างไฟล์ Excel (.xlsx) จริงสำหรับทดสอบการนำเข้า (ไม่ใช้แพ็กเกจภายนอก)
 * ข้อความเก็บใน sharedStrings ตัวเลขเก็บเป็นค่าตัวเลข เหมือนไฟล์ที่ Excel บันทึก
 */
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat(parts.concat([centralBuf, end]));
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function columnName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** rows: array ของแถว ค่าที่เป็น number เก็บเป็นตัวเลข ค่าอื่นเก็บเป็นข้อความ */
function makeXlsx(rows) {
  const strings = [];
  const index = new Map();
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = columnName(c) + (r + 1);
      if (v === null || v === undefined || v === '') return '';
      if (typeof v === 'number') return '<c r="' + ref + '"><v>' + v + '</v></c>';
      if (!index.has(v)) { index.set(v, strings.length); strings.push(v); }
      return '<c r="' + ref + '" t="s"><v>' + index.get(v) + '</v></c>';
    }).join('');
    return '<row r="' + (r + 1) + '">' + cells + '</row>';
  }).join('');
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + rel + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="' + ns + '" xmlns:r="' + rel + '"><sheets>' +
      '<sheet name="รายชื่อ" sheetId="1" r:id="rId7"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId7" Type="' + rel + '/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId8" Type="' + rel + '/sharedStrings" Target="sharedStrings.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', data: '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="' + ns + '" count="' + strings.length + '" uniqueCount="' + strings.length + '">' +
      strings.map((s) => '<si><t xml:space="preserve">' + escapeXml(s) + '</t></si>').join('') + '</sst>' },
    { name: 'xl/worksheets/sheet1.xml', data: '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="' + ns + '"><sheetData>' + sheetRows + '</sheetData></worksheet>' },
  ]);
}

module.exports = { makeXlsx };
