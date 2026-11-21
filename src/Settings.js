/**
 * ============================================================================
 *  Settings.gs — ค่าตั้งค่าโรงเรียน (SchoolSettings) และปีการศึกษา (AcademicYears)
 * ----------------------------------------------------------------------------
 *  - อ่านค่าตั้งค่าแบบตรวจชนิดเสมอ ถ้าค่าในชีตผิดรูปแบบ (เช่น แก้ด้วยมือ) จะใช้ค่าเริ่มต้นแทน
 *  - แก้ไขค่าตั้งค่าได้เฉพาะผู้ดูแลระบบ (ตรวจสิทธิ์ใน Api.gs) และบันทึกค่าเดิม/ค่าใหม่ทุกครั้ง
 *  - ปีการศึกษาปัจจุบันมีได้ปีเดียว และตรงกับค่า CURRENT_ACADEMIC_YEAR เสมอ
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// อ่านค่าตั้งค่า
// ---------------------------------------------------------------------------

function settingDef_(key) {
  for (let i = 0; i < SETTINGS_DEFS.length; i++) {
    if (SETTINGS_DEFS[i].key === key) return SETTINGS_DEFS[i];
  }
  return null;
}

/** ค่าดิบ (ข้อความ) จากชีต หรือค่าเริ่มต้นถ้ายังไม่มี */
function getSettingRaw_(key) {
  const def = settingDef_(key);
  if (!def) throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ไม่รู้จักค่าตั้งค่า ' + key);
  const row = dbGet_(SHEETS.SCHOOL_SETTINGS, key);
  if (row) return row.Value;
  return def.key === 'CURRENT_ACADEMIC_YEAR' ? String(academicYearOfDate_(todayIso_())) : String(def.defaultValue || '');
}

/** ค่าที่แปลงตามชนิดแล้ว (int/year → ตัวเลข, bool → true/false, list → array, text → ข้อความ) */
function getSetting_(key) {
  const def = settingDef_(key);
  return parseSettingValue_(def, getSettingRaw_(key));
}

function parseSettingValue_(def, raw) {
  const text = raw === null || raw === undefined ? '' : String(raw).trim();
  switch (def.type) {
    case 'int': {
      const fallback = Number(def.defaultValue);
      const n = Number(text);
      if (text === '' || !Number.isInteger(n)) return fallback;
      if (def.min !== undefined && n < def.min) return def.min;
      if (def.max !== undefined && n > def.max) return def.max;
      return n;
    }
    case 'year': {
      const n = Number(text);
      return Number.isInteger(n) && n >= 2500 && n <= 2700 ? n : academicYearOfDate_(todayIso_());
    }
    case 'bool':
      if (text.toUpperCase() === 'TRUE') return true;
      if (text.toUpperCase() === 'FALSE') return false;
      return String(def.defaultValue).toUpperCase() === 'TRUE';
    case 'list':
      return text === '' ? [] : text.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
    default:
      return text;
  }
}

/** ข้อมูลโรงเรียนที่ใช้แสดงบนหน้าเว็บทุกหน้า */
function schoolInfo_() {
  return {
    name: getSetting_('SCHOOL_NAME') || APP.SCHOOL_NAME,
    province: getSetting_('SCHOOL_PROVINCE'),
    address: getSetting_('SCHOOL_ADDRESS'),
    affiliation: getSetting_('SCHOOL_AFFILIATION'),
    currentAcademicYear: getSetting_('CURRENT_ACADEMIC_YEAR'),
  };
}

// ---------------------------------------------------------------------------
// API: ค่าตั้งค่า
// ---------------------------------------------------------------------------

/** settings.get — ทุกบทบาทดูได้ (ไม่มีค่าลับในชีตนี้) */
function settingsGet_(ctx) {
  const editable = ctx.role === ROLES.ADMIN;
  const groups = SETTINGS_GROUPS.map(function (g) {
    return {
      key: g.key,
      label: g.label,
      items: SETTINGS_DEFS.filter(function (d) { return d.group === g.key; }).map(function (d) {
        return {
          key: d.key,
          label: d.label,
          description: d.description || '',
          type: d.type,
          min: d.min === undefined ? null : d.min,
          max: d.max === undefined ? null : d.max,
          readOnly: !!d.readOnly,
          value: getSetting_(d.key),
        };
      }),
    };
  });
  return { editable: editable, groups: groups };
}

/** settings.update — ผู้ดูแลระบบเท่านั้น รับ { values: { KEY: ค่า } } บันทึกเฉพาะค่าที่เปลี่ยน */
function settingsUpdate_(ctx, payload) {
  const values = payload.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw validationError_('ไม่มีค่าที่ต้องการบันทึก');
  const keys = Object.keys(values);
  if (!keys.length) throw validationError_('ไม่มีค่าที่ต้องการบันทึก');
  const actor = actorFromCtx_(ctx);
  const prepared = keys.map(function (key) {
    const def = settingDef_(key);
    if (!def) throw validationError_('ไม่รู้จักค่าตั้งค่า "' + key + '"');
    if (def.readOnly) throw validationError_('"' + def.label + '" แก้ไขที่หน้านี้ไม่ได้');
    return { key: key, value: normalizeSettingInput_(def, values[key]) };
  });
  const changed = [];
  prepared.forEach(function (item) {
    const existing = dbGet_(SHEETS.SCHOOL_SETTINGS, item.key);
    if (existing) {
      const res = dbUpdate_(SHEETS.SCHOOL_SETTINGS, item.key, { Value: item.value }, actor);
      if (res.changed.length) changed.push(item.key);
    } else {
      const def = settingDef_(item.key);
      dbInsert_(SHEETS.SCHOOL_SETTINGS, { SettingKey: item.key, Value: item.value, Description: settingDescription_(def) }, actor);
      changed.push(item.key);
    }
  });
  return { changed: changed, settings: settingsGet_(ctx) };
}

function settingDescription_(def) {
  return def.label + (def.description ? ' — ' + def.description : '');
}

/** ตรวจและแปลงค่าที่ผู้ใช้กรอก เป็นข้อความที่จะเก็บในชีต */
function normalizeSettingInput_(def, input) {
  switch (def.type) {
    case 'int': {
      const n = requireInt_(input, def.label, { min: def.min, max: def.max });
      return String(n);
    }
    case 'year':
      return String(requireInt_(input, def.label, { min: 2500, max: 2700 }));
    case 'bool':
      return requireBool_(input, def.label) ? 'TRUE' : 'FALSE';
    case 'list': {
      const parts = Array.isArray(input) ? input : String(input === null || input === undefined ? '' : input).split(',');
      const seen = Object.create(null);
      const items = [];
      parts.forEach(function (part) {
        const text = cleanText_(part);
        if (text === '') return;
        if (text.indexOf(',') !== -1) throw validationError_(def.label + ': แต่ละรายการต้องไม่มีเครื่องหมายจุลภาค');
        if (text.length > 50) throw validationError_(def.label + ': แต่ละรายการยาวได้ไม่เกิน 50 ตัวอักษร');
        if (seen[text]) throw validationError_(def.label + ': มีรายการ "' + text + '" ซ้ำกัน');
        seen[text] = true;
        items.push(text);
      });
      if (!items.length) throw validationError_('กรุณากรอก' + def.label + ' อย่างน้อย 1 รายการ');
      if (items.length > 30) throw validationError_(def.label + ' มีได้ไม่เกิน 30 รายการ');
      return items.join(',');
    }
    default:
      return requireText_(input, def.label, { optional: true, max: 300 });
  }
}

// ---------------------------------------------------------------------------
// API: ปีการศึกษา
// ---------------------------------------------------------------------------

function yearDto_(r) {
  return {
    academicYearId: r.AcademicYearId,
    year: r.Year,
    label: r.Label,
    startDate: r.StartDate,
    endDate: r.EndDate,
    isCurrent: r.IsCurrent,
    status: r.Status,
    statusLabel: STATUS_LABELS.ACADEMIC_YEAR[r.Status] || r.Status,
    updatedAt: r.UpdatedAt || r.CreatedAt,
  };
}

/** years.list — ทุกบทบาทดูได้ เรียงจากปีล่าสุด */
function yearsList_() {
  return dbAll_(SHEETS.ACADEMIC_YEARS)
    .sort(function (a, b) { return b.Year - a.Year; })
    .map(yearDto_);
}

function validateYearDates_(startDate, endDate) {
  if (startDate && endDate && startDate >= endDate) throw validationError_('วันสิ้นสุดปีการศึกษาต้องอยู่หลังวันเริ่มปีการศึกษา');
}

/** years.create — ผู้ดูแลระบบ */
function yearsCreate_(ctx, payload) {
  const year = requireInt_(payload.year, 'ปีการศึกษา (พ.ศ.)', { min: 2500, max: 2700 });
  const label = requireText_(payload.label, 'ชื่อที่แสดง', { optional: true, max: 60 }) || ('ปีการศึกษา ' + year);
  const startDate = requireIsoDate_(payload.startDate, 'วันเริ่มปีการศึกษา', { optional: true });
  const endDate = requireIsoDate_(payload.endDate, 'วันสิ้นสุดปีการศึกษา', { optional: true });
  validateYearDates_(startDate, endDate);
  const hasCurrent = dbFindOne_(SHEETS.ACADEMIC_YEARS, function (r) { return r.IsCurrent; }) !== null;
  const rec = dbInsert_(SHEETS.ACADEMIC_YEARS, {
    Year: year,
    Label: label,
    StartDate: startDate,
    EndDate: endDate,
    IsCurrent: !hasCurrent,
    Status: STATUS.ACADEMIC_YEAR.OPEN,
  }, actorFromCtx_(ctx));
  if (!hasCurrent) setCurrentYearSetting_(year, ctx);
  return yearDto_(rec);
}

/** years.update — ผู้ดูแลระบบ (เปลี่ยนชื่อ วันที่ และสถานะเปิด/ปิด) */
function yearsUpdate_(ctx, payload) {
  const id = requireId_(payload.academicYearId, 'AY', 'รหัสปีการศึกษา');
  const current = dbGet_(SHEETS.ACADEMIC_YEARS, id);
  if (!current) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบปีการศึกษาที่ต้องการแก้ไข');
  const label = requireText_(payload.label, 'ชื่อที่แสดง', { max: 60 });
  const startDate = requireIsoDate_(payload.startDate, 'วันเริ่มปีการศึกษา', { optional: true });
  const endDate = requireIsoDate_(payload.endDate, 'วันสิ้นสุดปีการศึกษา', { optional: true });
  validateYearDates_(startDate, endDate);
  const status = requireEnum_(payload.status, STATUS.ACADEMIC_YEAR, 'สถานะ');
  if (current.IsCurrent && status === STATUS.ACADEMIC_YEAR.CLOSED) {
    throw appError_(ERROR_CODES.CONFLICT, 'ปิดปีการศึกษาปัจจุบันไม่ได้ กรุณาตั้งปีการศึกษาอื่นเป็นปีปัจจุบันก่อน');
  }
  const res = dbUpdate_(SHEETS.ACADEMIC_YEARS, id, {
    Label: label,
    StartDate: startDate,
    EndDate: endDate,
    Status: status,
  }, actorFromCtx_(ctx));
  return yearDto_(res.after);
}

/** years.setCurrent — ผู้ดูแลระบบ ตั้งปีการศึกษาปัจจุบัน (ปีที่เปิดอยู่เท่านั้น) */
function yearsSetCurrent_(ctx, payload) {
  const id = requireId_(payload.academicYearId, 'AY', 'รหัสปีการศึกษา');
  const target = dbGet_(SHEETS.ACADEMIC_YEARS, id);
  if (!target) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบปีการศึกษาที่เลือก');
  if (target.Status !== STATUS.ACADEMIC_YEAR.OPEN) throw appError_(ERROR_CODES.CONFLICT, 'ปีการศึกษาที่ปิดแล้วตั้งเป็นปีปัจจุบันไม่ได้');
  const actor = actorFromCtx_(ctx);
  dbFind_(SHEETS.ACADEMIC_YEARS, function (r) { return r.IsCurrent && r.AcademicYearId !== id; }).forEach(function (r) {
    dbUpdate_(SHEETS.ACADEMIC_YEARS, r.AcademicYearId, { IsCurrent: false }, actor);
  });
  dbUpdate_(SHEETS.ACADEMIC_YEARS, id, { IsCurrent: true }, actor);
  setCurrentYearSetting_(target.Year, ctx);
  return yearsList_();
}

function setCurrentYearSetting_(year, ctx) {
  const actor = actorFromCtx_(ctx);
  if (dbGet_(SHEETS.SCHOOL_SETTINGS, 'CURRENT_ACADEMIC_YEAR')) {
    dbUpdate_(SHEETS.SCHOOL_SETTINGS, 'CURRENT_ACADEMIC_YEAR', { Value: String(year) }, actor);
  } else {
    const def = settingDef_('CURRENT_ACADEMIC_YEAR');
    dbInsert_(SHEETS.SCHOOL_SETTINGS, { SettingKey: def.key, Value: String(year), Description: settingDescription_(def) }, actor);
  }
}
