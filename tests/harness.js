'use strict';
/**
 * tests/harness.js — จำลองบริการของ Google Apps Script บน Node.js
 * เพื่อรันโค้ดจริงใน src/ ได้โดยไม่ต้องเชื่อมต่อ Google
 *
 * ตัวจำลองนี้ตั้งใจให้ "เข้มงวดกว่าของจริง" ในจุดที่อาจทำให้ข้อมูลเพี้ยน:
 *  - เซลล์ที่ไม่ได้ตั้งรูปแบบ Plain text ('@') จะแปลงข้อความที่ดูเหมือนตัวเลข วันที่ หรือ TRUE/FALSE
 *    เป็นค่าชนิดอื่น เหมือนการพิมพ์ใน Google Sheets
 *  - ข้อความที่ขึ้นต้นด้วย = กลายเป็นสูตรเสมอ (อ่านกลับได้ '#FORMULA!') ถ้าไม่มี ' นำหน้า
 *  - เครื่องหมาย ' นำหน้า: โหมด 'consume' ถูกตัดทิ้งเหมือนการพิมพ์ / โหมด 'literal' ถูกเก็บไว้ในเซลล์ Plain text
 *  - อ้างช่วงเซลล์เกินขนาดชีตจะ error เหมือนของจริง
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC_DIR = path.join(__dirname, '..', 'src');
const DEFAULT_ROWS = 1000;
const DEFAULT_COLS = 26;
const TZ_OFFSETS_MIN = { 'Asia/Bangkok': 420, UTC: 0, GMT: 0, 'Etc/UTC': 0 };

function listSourceFiles() {
  return fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).sort();
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Spreadsheet mock
// ---------------------------------------------------------------------------

class MockRange {
  constructor(sheet, row, col, numRows, numCols) {
    numRows = numRows === undefined ? 1 : numRows;
    numCols = numCols === undefined ? 1 : numCols;
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 1 || col < 1) {
      throw new Error('Exception: Invalid range coordinates (' + row + ',' + col + ')');
    }
    if (numRows < 1) throw new Error('Exception: The number of rows in the range must be at least 1.');
    if (numCols < 1) throw new Error('Exception: The number of columns in the range must be at least 1.');
    if (row + numRows - 1 > sheet._maxRows || col + numCols - 1 > sheet._maxCols) {
      throw new Error('Exception: The coordinates of the range are outside the dimensions of the sheet.');
    }
    this._sheet = sheet;
    this._row = row;
    this._col = col;
    this._numRows = numRows;
    this._numCols = numCols;
  }

  getRow() { return this._row; }
  getColumn() { return this._col; }
  getNumRows() { return this._numRows; }
  getNumColumns() { return this._numCols; }

  _each(fn) {
    for (let r = 0; r < this._numRows; r++) {
      for (let c = 0; c < this._numCols; c++) fn(this._row + r, this._col + c, r, c);
    }
  }

  _checkMatrix(values, what) {
    if (!Array.isArray(values) || values.length !== this._numRows ||
        values.some((row) => !Array.isArray(row) || row.length !== this._numCols)) {
      throw new Error('Exception: The number of rows or columns in the ' + what + ' does not match the range.');
    }
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this._numRows; r++) {
      const row = [];
      for (let c = 0; c < this._numCols; c++) row.push(this._sheet._read(this._row + r, this._col + c));
      out.push(row);
    }
    return out;
  }

  getValue() { return this._sheet._read(this._row, this._col); }

  setValues(values) {
    this._checkMatrix(values, 'data');
    this._each((r, c, i, j) => this._sheet._write(r, c, values[i][j]));
    this._sheet._env.stats.setValues++;
    return this;
  }

  setValue(value) {
    this._each((r, c) => this._sheet._write(r, c, value));
    this._sheet._env.stats.setValue++;
    return this;
  }

  setNumberFormat(format) {
    this._each((r, c) => { this._sheet._cell(r, c).format = format; });
    return this;
  }

  setNumberFormats(formats) {
    this._checkMatrix(formats, 'formats');
    this._each((r, c, i, j) => { this._sheet._cell(r, c).format = formats[i][j]; });
    return this;
  }

  getNumberFormat() {
    const cell = this._sheet._peek(this._row, this._col);
    return cell && cell.format ? cell.format : '';
  }

  getNumberFormats() {
    const out = [];
    for (let r = 0; r < this._numRows; r++) {
      const row = [];
      for (let c = 0; c < this._numCols; c++) {
        const cell = this._sheet._peek(this._row + r, this._col + c);
        row.push(cell && cell.format ? cell.format : '');
      }
      out.push(row);
    }
    return out;
  }

  setNote(note) {
    this._each((r, c) => { this._sheet._cell(r, c).note = note; });
    return this;
  }

  setNotes(notes) {
    this._checkMatrix(notes, 'notes');
    this._each((r, c, i, j) => { this._sheet._cell(r, c).note = notes[i][j]; });
    return this;
  }

  getNote() {
    const cell = this._sheet._peek(this._row, this._col);
    return cell && cell.note ? cell.note : '';
  }

  _style(key, value) {
    this._each((r, c) => {
      const cell = this._sheet._cell(r, c);
      cell.style = cell.style || {};
      cell.style[key] = value;
    });
    return this;
  }

  setFontWeight(v) { return this._style('fontWeight', v); }
  setFontColor(v) { return this._style('fontColor', v); }
  setBackground(v) { return this._style('background', v); }
  setVerticalAlignment(v) { return this._style('verticalAlignment', v); }
  setHorizontalAlignment(v) { return this._style('horizontalAlignment', v); }
  setWrap(v) { return this._style('wrap', v); }
  setFontSize(v) { return this._style('fontSize', v); }
  setFontFamily(v) { return this._style('fontFamily', v); }
}

class MockProtection {
  constructor() { this._description = ''; this._warningOnly = false; }
  setDescription(d) { this._description = d; return this; }
  getDescription() { return this._description; }
  setWarningOnly(b) { this._warningOnly = !!b; return this; }
  isWarningOnly() { return this._warningOnly; }
}

class MockSheet {
  constructor(env, spreadsheet, name) {
    this._env = env;
    this._ss = spreadsheet;
    this._name = name;
    this._maxRows = DEFAULT_ROWS;
    this._maxCols = DEFAULT_COLS;
    this._grid = []; // _grid[r-1][c-1] = { value, formula, format, note, style }
    this._frozenRows = 0;
    this._tabColor = null;
    this._protections = [];
  }

  getName() { return this._name; }
  getParent() { return this._ss; }
  getMaxRows() { return this._maxRows; }
  getMaxColumns() { return this._maxCols; }

  _peek(r, c) {
    const row = this._grid[r - 1];
    return row ? row[c - 1] || null : null;
  }

  _cell(r, c) {
    while (this._grid.length < r) this._grid.push([]);
    const row = this._grid[r - 1];
    if (!row[c - 1]) row[c - 1] = { value: '', formula: false, format: '' };
    return row[c - 1];
  }

  _read(r, c) {
    const cell = this._peek(r, c);
    if (!cell) return '';
    if (cell.formula) return '#FORMULA!';
    if (cell.value instanceof Date) return new Date(cell.value.getTime());
    return cell.value;
  }

  _write(r, c, value) {
    const cell = this._cell(r, c);
    const format = cell.format || '';
    cell.formula = false;
    if (typeof value === 'string') {
      if (value.startsWith("'")) {
        if (this._env.apostropheMode === 'literal' && format === '@') cell.value = value;
        else cell.value = value.slice(1);
        return;
      }
      if (value.startsWith('=')) {
        cell.value = value;
        cell.formula = true;
        return;
      }
      if (format !== '@') {
        const t = value.trim();
        if (/^-?\d+(\.\d+)?$/.test(t)) { cell.value = Number(t); return; }
        const dm = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
        if (dm) {
          cell.value = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3], (+dm[4] || 0), (+dm[5] || 0), (+dm[6] || 0)) - 7 * 3600 * 1000);
          return;
        }
        if (/^(TRUE|FALSE)$/i.test(t)) { cell.value = t.toUpperCase() === 'TRUE'; return; }
      }
      cell.value = value;
      return;
    }
    if (value === null || value === undefined) { cell.value = ''; return; }
    if (Object.prototype.toString.call(value) === '[object Date]') { cell.value = new Date(value.getTime()); return; }
    if (typeof value === 'number' || typeof value === 'boolean') { cell.value = value; return; }
    throw new Error('Exception: Unsupported value type for a cell: ' + typeof value);
  }

  _isEmptyCell(cell) {
    return !cell || (!cell.formula && (cell.value === '' || cell.value === null || cell.value === undefined));
  }

  getLastRow() {
    for (let r = this._grid.length; r >= 1; r--) {
      const row = this._grid[r - 1];
      if (row && row.some((cell) => !this._isEmptyCell(cell))) return r;
    }
    return 0;
  }

  getLastColumn() {
    let last = 0;
    this._grid.forEach((row) => {
      if (!row) return;
      for (let c = row.length; c >= 1; c--) {
        if (!this._isEmptyCell(row[c - 1])) { last = Math.max(last, c); break; }
      }
    });
    return last;
  }

  getRange(row, col, numRows, numCols) {
    if (typeof row === 'string') throw new Error('A1 notation is not supported by this mock');
    return new MockRange(this, row, col, numRows, numCols);
  }

  getDataRange() {
    return new MockRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }

  insertRowsAfter(afterPosition, howMany) {
    if (afterPosition < this._grid.length) {
      const blanks = Array.from({ length: howMany }, () => []);
      this._grid.splice(afterPosition, 0, ...blanks);
    }
    this._maxRows += howMany;
    return this;
  }

  insertColumnsAfter(afterPosition, howMany) {
    this._grid.forEach((row) => {
      if (row && afterPosition < row.length) row.splice(afterPosition, 0, ...new Array(howMany));
    });
    this._maxCols += howMany;
    return this;
  }

  deleteRow(rowPosition) {
    if (rowPosition <= this._grid.length) this._grid.splice(rowPosition - 1, 1);
    this._maxRows -= 1;
    return this;
  }

  setFrozenRows(n) { this._frozenRows = n; return this; }
  getFrozenRows() { return this._frozenRows; }
  setTabColor(color) { this._tabColor = color; return this; }
  getTabColor() { return this._tabColor; }
  autoResizeColumns() { return this; }
  setColumnWidth() { return this; }

  protect() {
    const p = new MockProtection();
    this._protections.push(p);
    return p;
  }

  getProtections() { return this._protections.slice(); }

  // ---- ตัวช่วยสำหรับชุดทดสอบ (จำลองการแก้ชีตด้วยมือ) ----
  _rawSet(r, c, value) { this._cell(r, c).value = value; this._cell(r, c).formula = false; }
  _swapRows(a, b) {
    while (this._grid.length < Math.max(a, b)) this._grid.push([]);
    const tmp = this._grid[a - 1];
    this._grid[a - 1] = this._grid[b - 1];
    this._grid[b - 1] = tmp;
  }
  _rowValues(r) { return this.getRange(r, 1, 1, Math.max(this.getLastColumn(), 1)).getValues()[0]; }
}

class MockSpreadsheet {
  constructor(env, name) {
    this._env = env;
    this._id = 'SS' + crypto.randomBytes(8).toString('hex');
    this._name = name || 'ฐานข้อมูลทดสอบ';
    this._sheets = [];
    env.spreadsheets.set(this._id, this);
    this.insertSheet('Sheet1');
  }

  getId() { return this._id; }
  getName() { return this._name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this._id + '/edit'; }
  getSheets() { return this._sheets.slice(); }
  getSheetByName(name) { return this._sheets.find((s) => s.getName() === name) || null; }

  insertSheet(name, index) {
    if (this.getSheetByName(name)) {
      throw new Error('Exception: A sheet with the name "' + name + '" already exists. Please enter another name.');
    }
    const sheet = new MockSheet(this._env, this, name);
    if (index === undefined || index >= this._sheets.length) this._sheets.push(sheet);
    else this._sheets.splice(index, 0, sheet);
    return sheet;
  }

  deleteSheet(sheet) {
    this._sheets = this._sheets.filter((s) => s !== sheet);
  }
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function formatDate(date, tz, pattern) {
  if (!(Object.prototype.toString.call(date) === '[object Date]')) throw new Error('formatDate: not a Date');
  if (!(tz in TZ_OFFSETS_MIN)) throw new Error('formatDate mock: unsupported timezone ' + tz);
  const d = new Date(date.getTime() + TZ_OFFSETS_MIN[tz] * 60000);
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  const parts = {
    yyyy: String(d.getUTCFullYear()),
    MM: pad(d.getUTCMonth() + 1),
    dd: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()),
    mm: pad(d.getUTCMinutes()),
    ss: pad(d.getUTCSeconds()),
    SSS: pad(d.getUTCMilliseconds(), 3),
  };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss|SSS/g, (t) => parts[t]);
}

function toSignedBytes(buffer) {
  return Array.from(buffer, (b) => (b > 127 ? b - 256 : b));
}

function createEnv(options) {
  const opts = options || {};
  const env = {
    spreadsheets: new Map(),
    activeSpreadsheet: null,
    props: new Map(),
    cache: new Map(),
    activeUser: 'owner@example.com',
    effectiveUser: 'owner@example.com',
    apostropheMode: opts.apostropheMode || 'consume',
    uiAvailable: true,
    uiResponses: [],
    alerts: [],
    menus: [],
    logs: [],
    fixedNow: null,
    lockContended: false,
    lockHeld: false,
    stats: { setValues: 0, setValue: 0, flush: 0, lockAcquired: 0 },
  };

  const nowMs = () => (env.fixedNow ? env.fixedNow.getTime() : Date.now());

  const ui = {
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO', YES_NO_CANCEL: 'YES_NO_CANCEL' },
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO', CLOSE: 'CLOSE' },
    createMenu(title) {
      const menu = { title, items: [] };
      const api = {
        addItem(caption, fn) { menu.items.push({ caption, fn }); return api; },
        addSeparator() { menu.items.push({ separator: true }); return api; },
        addToUi() { env.menus.push(menu); },
      };
      return api;
    },
    alert(a, b, c) {
      const entry = c === undefined && b === undefined ? { title: '', message: a, buttons: 'OK' } : { title: a, message: b, buttons: c };
      env.alerts.push(entry);
      if (env.uiResponses.length) return env.uiResponses.shift();
      return entry.buttons === 'YES_NO' ? 'YES' : 'OK';
    },
  };

  const lock = {
    tryLock() {
      if (env.lockContended) return false;
      env.lockHeld = true;
      env.stats.lockAcquired++;
      return true;
    },
    waitLock(ms) { if (!this.tryLock(ms)) throw new Error('Lock timeout'); },
    releaseLock() { env.lockHeld = false; },
    hasLock() { return env.lockHeld; },
  };

  const scriptProperties = {
    getProperty: (k) => (env.props.has(k) ? env.props.get(k) : null),
    setProperty(k, v) { env.props.set(k, String(v)); return scriptProperties; },
    deleteProperty(k) { env.props.delete(k); return scriptProperties; },
    getProperties: () => Object.fromEntries(env.props),
    getKeys: () => Array.from(env.props.keys()),
  };

  const scriptCache = {
    get(k) {
      const e = env.cache.get(k);
      if (!e) return null;
      if (e.expires <= nowMs()) { env.cache.delete(k); return null; }
      return e.value;
    },
    put(k, v, ttlSec) {
      if (typeof v !== 'string') throw new Error('Cache value must be a string');
      env.cache.set(k, { value: v, expires: nowMs() + Math.min(ttlSec || 600, 21600) * 1000 });
    },
    remove(k) { env.cache.delete(k); },
  };

  const capture = (level) => (...args) => env.logs.push({ level, text: args.map(String).join(' ') });

  const globals = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => env.activeSpreadsheet,
      getActive: () => env.activeSpreadsheet,
      openById(id) {
        const ss = env.spreadsheets.get(id);
        if (!ss) throw new Error('Exception: Unexpected error while getting the method or property openById on object SpreadsheetApp.');
        return ss;
      },
      flush() { env.stats.flush++; },
      getUi() {
        if (!env.uiAvailable) throw new Error('Exception: Cannot call SpreadsheetApp.getUi() from this context.');
        return ui;
      },
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
    },
    LockService: { getScriptLock: () => lock },
    CacheService: { getScriptCache: () => scriptCache },
    PropertiesService: { getScriptProperties: () => scriptProperties },
    Session: {
      getActiveUser: () => ({ getEmail: () => env.activeUser }),
      getEffectiveUser: () => ({ getEmail: () => env.effectiveUser }),
      getScriptTimeZone: () => 'Asia/Bangkok',
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      getUuid: () => crypto.randomUUID(),
      formatDate,
      computeDigest(alg, value) {
        if (alg !== 'SHA_256') throw new Error('mock supports SHA_256 only');
        return toSignedBytes(crypto.createHash('sha256').update(Buffer.from(String(value), 'utf8')).digest());
      },
      computeHmacSha256Signature(value, key) {
        return toSignedBytes(crypto.createHmac('sha256', Buffer.from(String(key), 'utf8')).update(Buffer.from(String(value), 'utf8')).digest());
      },
      base64Encode: (data) => Buffer.from(typeof data === 'string' ? data : data.map((b) => (b < 0 ? b + 256 : b))).toString('base64'),
      sleep() {},
    },
    HtmlService: {
      createHtmlOutput(html) {
        const out = {
          _html: String(html || ''), _title: '', _metas: {},
          setTitle(t) { out._title = t; return out; },
          getTitle() { return out._title; },
          addMetaTag(name, content) { out._metas[name] = content; return out; },
          getContent() { return out._html; },
          setXFrameOptionsMode() { return out; },
        };
        return out;
      },
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
    },
    Logger: { log: capture('logger') },
    console: { log: capture('log'), info: capture('info'), warn: capture('warn'), error: capture('error') },
  };

  const context = vm.createContext(globals);
  const files = opts.files || listSourceFiles();
  files.forEach((file) => {
    const code = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    vm.runInContext(code, context, { filename: file });
  });

  const harness = {
    env,
    gas: context,
    run(code) { return vm.runInContext(code, context); },
    newSpreadsheet(name) { return new MockSpreadsheet(env, name); },
    setActiveSpreadsheet(ss) { env.activeSpreadsheet = ss; },
    setNow(isoWithZone) {
      env.fixedNow = new Date(isoWithZone);
      context.now_ = () => new Date(env.fixedNow.getTime());
    },
    setUsers(active, effective) {
      env.activeUser = active;
      env.effectiveUser = effective === undefined ? active : effective;
    },
    /** จำลองการเริ่มทำงานรอบใหม่ของ Apps Script (ล้างตัวแปรในหน่วยความจำ) */
    newExecution() {
      vm.runInContext('DB_SPREADSHEET_ = null; DB_TABLES_ = Object.create(null); AUDIT_STATE_ = null; ISSUED_IDS_ = Object.create(null);', context);
    },
    sheet(name) {
      const ss = env.activeSpreadsheet;
      return ss ? ss.getSheetByName(name) : null;
    },
  };

  if (opts.withSpreadsheet !== false) {
    harness.setActiveSpreadsheet(harness.newSpreadsheet(opts.spreadsheetName));
  }
  return harness;
}

/** สร้างสภาพแวดล้อมที่ติดตั้งฐานข้อมูลแล้ว */
function createInstalledEnv(options) {
  const h = createEnv(options);
  if (options && options.now) h.setNow(options.now);
  h.gas.SetupDatabase();
  h.newExecution();
  return h;
}

module.exports = { createEnv, createInstalledEnv, plain, listSourceFiles, SRC_DIR };
