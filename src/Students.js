/**
 * ============================================================================
 *  Students.gs — ข้อมูลนักเรียน และชั้นเรียนรายปีการศึกษา
 * ----------------------------------------------------------------------------
 *  - Students   เก็บข้อมูลที่ไม่เปลี่ยนตามปี (เลขประจำตัว ชื่อ สถานะปัจจุบัน)
 *  - Enrollments เก็บชั้น ห้อง เลขที่ แยกตามปีการศึกษา → ขึ้นปีใหม่แล้วข้อมูลปีเก่ายังอยู่ครบ
 *  - ไม่มีการลบนักเรียน ใช้สถานะ ย้ายออก / จบการศึกษา แทน
 *  - ชื่อซ้ำกับนักเรียนเดิมต้องยืนยันก่อนบันทึก (ห้ามบันทึกซ้ำโดยไม่แจ้งเตือน)
 *  - สิทธิ์: เจ้าหน้าที่การเงินจัดการได้ ผู้อำนวยการดูได้ (ตรวจใน Api.gs)
 * ============================================================================
 */

const STUDENT_PREFIX_SUGGESTIONS = Object.freeze(['เด็กชาย', 'เด็กหญิง', 'นาย', 'นางสาว', 'ด.ช.', 'ด.ญ.']);

// ---------------------------------------------------------------------------
// ตัวช่วย
// ---------------------------------------------------------------------------

function gradeLevels_() {
  return getSetting_('GRADE_LEVELS');
}

/** ปีการศึกษาที่มีอยู่ในระบบ (mustBeOpen = ต้องยังไม่ปิด) */
function requireAcademicYear_(value, options) {
  const opt = options || {};
  const year = requireInt_(value, 'ปีการศึกษา', { min: 2500, max: 2700 });
  const record = dbFindOne_(SHEETS.ACADEMIC_YEARS, function (r) { return r.Year === year; });
  if (!record) {
    throw appError_(ERROR_CODES.VALIDATION, 'ไม่พบปีการศึกษา ' + year + ' ในระบบ กรุณาให้ผู้ดูแลระบบเพิ่มปีการศึกษาก่อน');
  }
  if (opt.mustBeOpen && record.Status !== STATUS.ACADEMIC_YEAR.OPEN) {
    throw appError_(ERROR_CODES.CONFLICT, 'ปีการศึกษา ' + year + ' ปิดแล้ว แก้ไขข้อมูลชั้นเรียนของปีนี้ไม่ได้');
  }
  return year;
}

function currentAcademicYear_() {
  return getSetting_('CURRENT_ACADEMIC_YEAR');
}

/** ตรวจและแปลงข้อมูลนักเรียนที่กรอก (ใช้ทั้งการเพิ่ม แก้ไข และนำเข้า) */
function validateStudentInput_(payload, levels) {
  const studentNo = requireText_(String(payload.studentNo === undefined || payload.studentNo === null ? '' : payload.studentNo).replace(/\s+/g, ''),
    'เลขประจำตัวนักเรียน', { max: 20, pattern: /^[0-9A-Za-z\-\/]+$/, patternMessage: 'เลขประจำตัวนักเรียนใช้ได้เฉพาะตัวเลข ตัวอักษรภาษาอังกฤษ - และ /' });
  const gradeText = requireText_(payload.gradeLevel, 'ระดับชั้น', { max: 40 });
  const gradeLevel = normalizeGradeLevel_(gradeText, levels);
  if (!gradeLevel) {
    throw validationError_('ระดับชั้น "' + gradeText + '" ไม่อยู่ในรายการระดับชั้นที่เปิดสอน (' + levels.join(', ') + ')');
  }
  const room = normalizeRoom_(requireText_(payload.room, 'ห้อง', { optional: true, max: 20 }));
  if (room.length > 10) throw validationError_('ห้องยาวเกิน 10 ตัวอักษร');
  return {
    studentNo: studentNo,
    prefix: requireText_(payload.prefix, 'คำนำหน้าชื่อ', { optional: true, max: 20 }),
    firstName: requireText_(payload.firstName, 'ชื่อ', { max: 100 }),
    lastName: requireText_(payload.lastName, 'นามสกุล', { optional: true, max: 100 }),
    gradeLevel: gradeLevel,
    room: room,
    classNo: requireInt_(payload.classNo, 'เลขที่', { optional: true, min: 1, max: 999 }),
  };
}

function nameKey_(firstName, lastName) {
  return cleanText_(firstName).replace(/\s+/g, '') + '|' + cleanText_(lastName).replace(/\s+/g, '');
}

function classLabel_(gradeLevel, room) {
  return room ? gradeLevel + '/' + room : gradeLevel;
}

/** เลขที่ต้องไม่ซ้ำกับนักเรียนที่กำลังศึกษาในห้องเดียวกันของปีเดียวกัน */
function assertClassNoFree_(year, gradeLevel, room, classNo, exceptStudentId) {
  if (classNo === null || classNo === undefined) return;
  const clash = dbFindOne_(SHEETS.ENROLLMENTS, function (e) {
    return e.AcademicYear === year && e.GradeLevel === gradeLevel && e.Room === room && e.ClassNo === classNo &&
      e.EnrollStatus === STATUS.STUDENT.STUDYING && e.StudentId !== exceptStudentId;
  });
  if (clash) {
    const other = dbGet_(SHEETS.STUDENTS, clash.StudentId);
    throw appError_(ERROR_CODES.CONFLICT, 'เลขที่ ' + classNo + ' ของชั้น ' + classLabel_(gradeLevel, room) + ' ปีการศึกษา ' + year +
      ' เป็นของ ' + (other ? studentDisplayName_(other.Prefix, other.FirstName, other.LastName) : 'นักเรียนคนอื่น') + ' แล้ว');
  }
}

function enrollmentOf_(studentId, year) {
  return dbFindOne_(SHEETS.ENROLLMENTS, function (e) { return e.StudentId === studentId && e.AcademicYear === year; });
}

function studentDto_(s, e) {
  return {
    studentId: s.StudentId,
    studentNo: s.StudentNo,
    prefix: s.Prefix,
    firstName: s.FirstName,
    lastName: s.LastName,
    fullName: studentDisplayName_(s.Prefix, s.FirstName, s.LastName),
    status: s.Status,
    statusLabel: STATUS_LABELS.STUDENT[s.Status] || s.Status,
    statusDate: s.StatusDate,
    statusNote: s.StatusNote,
    year: e ? e.AcademicYear : null,
    enrollmentId: e ? e.EnrollmentId : '',
    gradeLevel: e ? e.GradeLevel : '',
    room: e ? e.Room : '',
    classLabel: e ? classLabel_(e.GradeLevel, e.Room) : '',
    classNo: e ? e.ClassNo : null,
    enrollStatus: e ? e.EnrollStatus : '',
    enrollStatusLabel: e ? (STATUS_LABELS.STUDENT[e.EnrollStatus] || e.EnrollStatus) : '',
  };
}

function compareText_(a, b) {
  try { return String(a).localeCompare(String(b), 'th'); } catch (err) { return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0); }
}

function compareRoom_(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
  return compareText_(a, b);
}

/** เรียง: ลำดับระดับชั้นตามการตั้งค่า → ห้อง → เลขที่ → ชื่อ */
function compareStudentRows_(levels) {
  return function (x, y) {
    const gx = levels.indexOf(x.gradeLevel);
    const gy = levels.indexOf(y.gradeLevel);
    if (gx !== gy) return (gx === -1 ? 999 : gx) - (gy === -1 ? 999 : gy);
    const r = compareRoom_(x.room, y.room);
    if (r !== 0) return r;
    const cx = x.classNo === null ? 99999 : x.classNo;
    const cy = y.classNo === null ? 99999 : y.classNo;
    if (cx !== cy) return cx - cy;
    return compareText_(x.firstName, y.firstName);
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * students.list — รายชื่อนักเรียนของปีการศึกษาหนึ่ง (ทุกสถานะ หน้าเว็บกรองและค้นหาต่อเอง)
 * payload: { year }
 */
function studentsList_(ctx, payload) {
  const year = payload.year === undefined || payload.year === null || payload.year === ''
    ? currentAcademicYear_()
    : requireAcademicYear_(payload.year);
  const levels = gradeLevels_();
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const rows = dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === year; })
    .filter(function (e) { return students[e.StudentId]; })
    .map(function (e) { return studentDto_(students[e.StudentId], e); })
    .sort(compareStudentRows_(levels));
  const rooms = Object.create(null);
  rows.forEach(function (r) {
    rooms[r.gradeLevel] = rooms[r.gradeLevel] || [];
    if (r.room && rooms[r.gradeLevel].indexOf(r.room) === -1) rooms[r.gradeLevel].push(r.room);
  });
  Object.keys(rooms).forEach(function (k) { rooms[k].sort(compareRoom_); });
  return {
    year: year,
    gradeLevels: levels,
    rooms: rooms,
    prefixSuggestions: STUDENT_PREFIX_SUGGESTIONS.slice(),
    rows: rows,
  };
}

/** students.get — ข้อมูลนักเรียนพร้อมประวัติชั้นเรียนทุกปี */
function studentsGet_(ctx, payload) {
  const id = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const s = dbGet_(SHEETS.STUDENTS, id);
  if (!s) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const enrollments = dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.StudentId === id; })
    .sort(function (a, b) { return b.AcademicYear - a.AcademicYear; });
  return {
    student: studentDto_(s, enrollments[0] || null),
    enrollments: enrollments.map(function (e) {
      return {
        enrollmentId: e.EnrollmentId,
        year: e.AcademicYear,
        gradeLevel: e.GradeLevel,
        room: e.Room,
        classLabel: classLabel_(e.GradeLevel, e.Room),
        classNo: e.ClassNo,
        enrollStatus: e.EnrollStatus,
        enrollStatusLabel: STATUS_LABELS.STUDENT[e.EnrollStatus] || e.EnrollStatus,
        note: e.Note,
      };
    }),
  };
}

/**
 * students.create — เพิ่มนักเรียน 1 คน พร้อมชั้นเรียนของปีการศึกษาที่เลือก
 * ชื่อซ้ำกับนักเรียนเดิม: ต้องส่ง confirmDuplicateName = true มาอีกครั้ง
 */
function studentsCreate_(ctx, payload) {
  const levels = gradeLevels_();
  const input = validateStudentInput_(payload, levels);
  const year = requireAcademicYear_(payload.year === undefined || payload.year === '' ? currentAcademicYear_() : payload.year, { mustBeOpen: true });
  const sameNo = dbFindOne_(SHEETS.STUDENTS, function (s) { return String(s.StudentNo).toUpperCase() === input.studentNo.toUpperCase(); });
  if (sameNo) {
    throw appError_(ERROR_CODES.CONFLICT, 'เลขประจำตัว ' + input.studentNo + ' เป็นของ ' +
      studentDisplayName_(sameNo.Prefix, sameNo.FirstName, sameNo.LastName) + ' อยู่แล้ว');
  }
  if (payload.confirmDuplicateName !== true) {
    const key = nameKey_(input.firstName, input.lastName);
    const sameName = dbFindOne_(SHEETS.STUDENTS, function (s) { return nameKey_(s.FirstName, s.LastName) === key; });
    if (sameName) {
      throw appError_(ERROR_CODES.CONFLICT, 'มีนักเรียนชื่อ ' + studentDisplayName_(sameName.Prefix, sameName.FirstName, sameName.LastName) +
        ' อยู่แล้ว (เลขประจำตัว ' + sameName.StudentNo + ') ถ้าเป็นคนละคน กรุณายืนยันอีกครั้ง', { reason: 'NAME_DUPLICATE' });
    }
  }
  assertClassNoFree_(year, input.gradeLevel, input.room, input.classNo, null);
  const actor = actorFromCtx_(ctx);
  const student = dbInsert_(SHEETS.STUDENTS, {
    StudentNo: input.studentNo,
    Prefix: input.prefix,
    FirstName: input.firstName,
    LastName: input.lastName,
    Status: STATUS.STUDENT.STUDYING,
  }, actor);
  const enrollment = dbInsert_(SHEETS.ENROLLMENTS, {
    StudentId: student.StudentId,
    AcademicYear: year,
    GradeLevel: input.gradeLevel,
    Room: input.room,
    ClassNo: input.classNo,
    EnrollStatus: STATUS.STUDENT.STUDYING,
  }, actor);
  return studentDto_(student, enrollment);
}

/**
 * students.update — แก้ไขข้อมูลนักเรียน และชั้นเรียนของปีการศึกษาที่เลือก
 * (ถ้ายังไม่มีชั้นเรียนในปีนั้น จะเพิ่มให้)
 */
function studentsUpdate_(ctx, payload) {
  const id = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const student = dbGet_(SHEETS.STUDENTS, id);
  if (!student) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const input = validateStudentInput_(payload, gradeLevels_());
  const year = requireAcademicYear_(payload.year, { mustBeOpen: true });
  const sameNo = dbFindOne_(SHEETS.STUDENTS, function (s) {
    return s.StudentId !== id && String(s.StudentNo).toUpperCase() === input.studentNo.toUpperCase();
  });
  if (sameNo) {
    throw appError_(ERROR_CODES.CONFLICT, 'เลขประจำตัว ' + input.studentNo + ' เป็นของ ' +
      studentDisplayName_(sameNo.Prefix, sameNo.FirstName, sameNo.LastName) + ' อยู่แล้ว');
  }
  assertClassNoFree_(year, input.gradeLevel, input.room, input.classNo, id);
  const actor = actorFromCtx_(ctx);
  const updated = dbUpdate_(SHEETS.STUDENTS, id, {
    StudentNo: input.studentNo,
    Prefix: input.prefix,
    FirstName: input.firstName,
    LastName: input.lastName,
  }, actor).after;
  const existing = enrollmentOf_(id, year);
  let enrollment;
  if (existing) {
    enrollment = dbUpdate_(SHEETS.ENROLLMENTS, existing.EnrollmentId, {
      GradeLevel: input.gradeLevel,
      Room: input.room,
      ClassNo: input.classNo,
    }, actor).after;
  } else {
    enrollment = dbInsert_(SHEETS.ENROLLMENTS, {
      StudentId: id,
      AcademicYear: year,
      GradeLevel: input.gradeLevel,
      Room: input.room,
      ClassNo: input.classNo,
      EnrollStatus: student.Status === STATUS.STUDENT.STUDYING ? STATUS.STUDENT.STUDYING : student.Status,
    }, actor);
  }
  return studentDto_(updated, enrollment);
}

/**
 * students.setStatus — เปลี่ยนสถานะ กำลังศึกษา / ย้ายออก / จบการศึกษา
 * payload: { studentId, year, status, statusDate, note }
 * ยอดค้างชำระของนักเรียน (ระยะที่ 4–6) ไม่ถูกลบเมื่อย้ายออกหรือจบการศึกษา
 */
function studentsSetStatus_(ctx, payload) {
  const id = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const student = dbGet_(SHEETS.STUDENTS, id);
  if (!student) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const status = requireEnum_(payload.status, STATUS.STUDENT, 'สถานะ');
  const statusDate = requireIsoDate_(payload.statusDate, 'วันที่เปลี่ยนสถานะ');
  const note = requireText_(payload.note, 'หมายเหตุ', { optional: true, max: 300, multiline: true });
  if (status !== STATUS.STUDENT.STUDYING && !note) {
    throw validationError_('กรุณาระบุหมายเหตุ เช่น ย้ายไปโรงเรียนใด หรือจบการศึกษาเมื่อใด');
  }
  const year = requireAcademicYear_(payload.year, { mustBeOpen: true });
  const actor = actorFromCtx_(ctx);
  const label = STATUS_LABELS.STUDENT[status];
  const after = dbUpdate_(SHEETS.STUDENTS, id, { Status: status, StatusDate: statusDate, StatusNote: note }, actor,
    { note: 'เปลี่ยนสถานะเป็น' + label }).after;
  let enrollment = enrollmentOf_(id, year);
  if (enrollment) {
    if (status === STATUS.STUDENT.STUDYING) assertClassNoFree_(year, enrollment.GradeLevel, enrollment.Room, enrollment.ClassNo, id);
    enrollment = dbUpdate_(SHEETS.ENROLLMENTS, enrollment.EnrollmentId, { EnrollStatus: status }, actor,
      { note: 'เปลี่ยนสถานะเป็น' + label }).after;
  }
  return studentDto_(after, enrollment);
}
