/**
 * ============================================================================
 *  Fees.gs — อัตราเงินบำรุง รายการเรียกเก็บ ลดหย่อน/ยกเว้น และการยกเลิกรายการเรียกเก็บ
 * ----------------------------------------------------------------------------
 *  - อัตราตั้งตามปีการศึกษา ภาคเรียน และระดับชั้น
 *    ต้องกรอกเอกสารที่อนุมัติอัตราก่อนสร้างรายการเรียกเก็บ (การตัดสินใจ D-06)
 *  - ชั้นเดียวกันในปีเดียวกัน ใช้อัตรารายภาคเรียนหรือทั้งปีอย่างใดอย่างหนึ่ง (กันเรียกเก็บซ้ำ)
 *  - เมื่อมีรายการเรียกเก็บแล้ว แก้จำนวนเงินและวันครบกำหนดของอัตราไม่ได้
 *  - สร้างรายการเรียกเก็บซ้ำได้โดยไม่เกิดรายการซ้ำ (สร้างเฉพาะคนที่ยังไม่มี)
 *  - ลดหย่อน/ยกเว้น และยกเลิกรายการเรียกเก็บ ต้องมีเหตุผล
 *    และรอผู้อำนวยการอนุมัติถ้าตั้งค่าไว้ (D-07, D-10) ระหว่างรออนุมัติ ข้อมูลเดิมยังมีผล
 *  - สิทธิ์: เจ้าหน้าที่การเงินบันทึก ผู้อำนวยการดูและอนุมัติ (ตรวจใน Api.gs)
 * ============================================================================
 */

const FEE_DEFAULT_DESCRIPTION = 'เงินบำรุงการศึกษา';
const FEE_MAX_SATANG = 10000000; // 100,000 บาทต่อคนต่อรายการ (กันพิมพ์ผิด)

// ---------------------------------------------------------------------------
// ตัวช่วย
// ---------------------------------------------------------------------------

function termOptions_() {
  return [STATUS.TERM.TERM_1, STATUS.TERM.TERM_2, STATUS.TERM.YEAR].map(function (t) {
    return { value: t, label: STATUS_LABELS.TERM[t] };
  });
}

function yearRecord_(year) {
  return dbFindOne_(SHEETS.ACADEMIC_YEARS, function (r) { return r.Year === year; });
}

function isYearOpen_(year) {
  const r = yearRecord_(year);
  return !!r && r.Status === STATUS.ACADEMIC_YEAR.OPEN;
}

function requireFeeSetting_(value) {
  const id = requireId_(value, 'FEE', 'รหัสอัตราเงินบำรุง');
  const f = dbGet_(SHEETS.FEE_SETTINGS, id);
  if (!f) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบอัตราเงินบำรุงนี้');
  return f;
}

function feeLabel_(f) {
  return feeItemLabel_(f.Description, f.Term, f.AcademicYear, f.GradeLevel);
}

function emptyFeeStats_() {
  return { count: 0, netSatang: 0, paidSatang: 0, outstandingSatang: 0, states: { UNPAID: 0, PARTIAL: 0, PAID: 0, EXEMPT: 0 } };
}

/** สถิติของแต่ละอัตรา จากรายการเรียกเก็บที่มีผล */
function feeStats_(lc) {
  const out = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (asm) {
    if (asm.Status !== STATUS.ASSESSMENT.ACTIVE) return;
    const s = out[asm.FeeSettingId] || (out[asm.FeeSettingId] = emptyFeeStats_());
    const f = assessmentFigures_(asm, lc);
    s.count += 1;
    s.netSatang += f.netSatang;
    s.paidSatang += f.paidSatang;
    s.outstandingSatang += f.outstandingSatang;
    s.states[f.state] = (s.states[f.state] || 0) + 1;
  });
  return out;
}

function feeSettingDto_(f, stats) {
  const st = stats || emptyFeeStats_();
  return {
    feeSettingId: f.FeeSettingId,
    year: f.AcademicYear,
    term: f.Term,
    termLabel: STATUS_LABELS.TERM[f.Term] || f.Term,
    gradeLevel: f.GradeLevel,
    amountSatang: satangOf_(f.Amount),
    startDate: f.StartDate,
    dueDate: f.DueDate,
    description: f.Description,
    label: feeLabel_(f),
    approvalRef: f.ApprovalRef,
    status: f.Status,
    statusLabel: STATUS_LABELS.FEE_SETTING[f.Status] || f.Status,
    stats: st,
    locked: st.count > 0,
  };
}

/** เรียงอัตรา: ภาคเรียน → ลำดับระดับชั้นตามการตั้งค่า */
function compareFeeSettings_(levels) {
  return function (a, b) {
    const ta = TERM_ORDER_[a.term] === undefined ? 9 : TERM_ORDER_[a.term];
    const tb = TERM_ORDER_[b.term] === undefined ? 9 : TERM_ORDER_[b.term];
    if (ta !== tb) return ta - tb;
    const ga = levels.indexOf(a.gradeLevel);
    const gb = levels.indexOf(b.gradeLevel);
    return (ga === -1 ? 999 : ga) - (gb === -1 ? 999 : gb);
  };
}

function validateFeeInput_(payload) {
  const amountSatang = requireMoney_(payload.amount, 'จำนวนเงิน', { maxSatang: FEE_MAX_SATANG });
  const startDate = requireIsoDate_(payload.startDate, 'วันเริ่มเรียกเก็บ', { optional: true });
  const dueDate = requireIsoDate_(payload.dueDate, 'วันครบกำหนดชำระ');
  if (startDate && dueDate < startDate) throw validationError_('วันครบกำหนดชำระต้องไม่ก่อนวันเริ่มเรียกเก็บ');
  return {
    amountSatang: amountSatang,
    startDate: startDate,
    dueDate: dueDate,
    description: requireText_(payload.description, 'ชื่อรายการ', { optional: true, max: 100 }) || FEE_DEFAULT_DESCRIPTION,
    approvalRef: requireText_(payload.approvalRef, 'เอกสารที่อนุมัติอัตรา', { optional: true, max: 300 }),
  };
}

/** อัตราที่พร้อมสร้างรายการเรียกเก็บ: ใช้งานอยู่ มีเอกสารอนุมัติ และปีการศึกษายังไม่ปิด */
function requireFeeReadyForAssessment_(value) {
  const f = requireFeeSetting_(value);
  if (f.Status !== STATUS.FEE_SETTING.ACTIVE) {
    throw appError_(ERROR_CODES.CONFLICT, 'อัตรานี้ปิดการใช้งานแล้ว สร้างรายการเรียกเก็บไม่ได้');
  }
  if (!f.ApprovalRef) {
    throw appError_(ERROR_CODES.VALIDATION,
      'กรุณากรอกเลขที่และวันที่ของหนังสือหรือมติที่อนุมัติอัตรานี้ก่อนสร้างรายการเรียกเก็บ (กดแก้ไขอัตรา แล้วกรอกช่อง "เอกสารที่อนุมัติอัตรา")',
      { reason: 'APPROVAL_REF_REQUIRED' });
  }
  if (!isYearOpen_(f.AcademicYear)) {
    throw appError_(ERROR_CODES.CONFLICT, 'ปีการศึกษา ' + f.AcademicYear + ' ปิดแล้ว สร้างรายการเรียกเก็บใหม่ไม่ได้');
  }
  return f;
}

function newAssessmentRecord_(f, studentId, enrollmentId, room) {
  return {
    StudentId: studentId,
    EnrollmentId: enrollmentId,
    FeeSettingId: f.FeeSettingId,
    AcademicYear: f.AcademicYear,
    Term: f.Term,
    GradeLevel: f.GradeLevel,
    Room: room,
    GrossAmount: f.Amount,
    DueDate: f.DueDate,
    Status: STATUS.ASSESSMENT.ACTIVE,
  };
}

/**
 * แผนการสร้างรายการเรียกเก็บของอัตราหนึ่ง
 *  - เรียกเก็บนักเรียนชั้นนั้นของปีนั้นที่กำลังศึกษา หรือจบการศึกษาในปีนั้น (เรียนครบปีแล้ว)
 *  - ข้ามผู้ที่มีรายการของอัตรานี้แล้ว ผู้ที่ย้ายออก และผู้ที่รายการเดิมถูกยกเลิก
 *    (สองกรณีหลัง ถ้าต้องเรียกเก็บ ให้เพิ่มรายบุคคลในบัญชีนักเรียน) จึงกดสร้างซ้ำได้โดยไม่เรียกเก็บซ้ำ
 */
function assessmentPlan_(f) {
  const has = Object.create(null);
  const cancelled = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) {
    if (a.FeeSettingId !== f.FeeSettingId) return;
    if (a.Status === STATUS.ASSESSMENT.ACTIVE) has[a.StudentId] = true;
    else cancelled[a.StudentId] = true;
  });
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const create = [];
  const skipped = [];
  let already = 0;
  dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === f.AcademicYear && e.GradeLevel === f.GradeLevel; })
    .forEach(function (e) {
      const s = students[e.StudentId];
      if (!s) return;
      if (has[e.StudentId]) { already += 1; return; }
      const item = {
        studentId: s.StudentId,
        enrollmentId: e.EnrollmentId,
        studentNo: s.StudentNo,
        fullName: studentDisplayName_(s.Prefix, s.FirstName, s.LastName),
        firstName: s.FirstName,
        gradeLevel: e.GradeLevel,
        room: e.Room,
        classLabel: classLabel_(e.GradeLevel, e.Room),
        classNo: e.ClassNo,
      };
      if (cancelled[e.StudentId]) {
        item.reason = 'รายการเดิมของอัตรานี้ถูกยกเลิกแล้ว (ถ้าต้องเรียกเก็บใหม่ ให้เพิ่มรายบุคคลในบัญชีนักเรียน)';
        skipped.push(item);
        return;
      }
      if (e.EnrollStatus === STATUS.STUDENT.TRANSFERRED) {
        item.reason = 'ย้ายออกแล้ว (ถ้าต้องเรียกเก็บ ให้เพิ่มรายบุคคลในบัญชีนักเรียน)';
        skipped.push(item);
        return;
      }
      create.push(item);
    });
  const levels = gradeLevels_();
  create.sort(compareStudentRows_(levels));
  skipped.sort(compareStudentRows_(levels));
  return { create: create, skipped: skipped, already: already };
}

/** อัตราที่เพิ่มเป็นรายการเรียกเก็บรายบุคคลให้นักเรียนคนนี้ได้ (ใช้ในหน้าบัญชีนักเรียน) */
function availableFeesForStudent_(studentId, lc) {
  const enrollments = dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.StudentId === studentId; });
  const has = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) {
    if (a.StudentId === studentId && a.Status === STATUS.ASSESSMENT.ACTIVE) has[a.FeeSettingId] = true;
  });
  const open = Object.create(null);
  dbAll_(SHEETS.ACADEMIC_YEARS).forEach(function (y) { if (y.Status === STATUS.ACADEMIC_YEAR.OPEN) open[y.Year] = true; });
  return dbAll_(SHEETS.FEE_SETTINGS)
    .filter(function (f) {
      return f.Status === STATUS.FEE_SETTING.ACTIVE && f.ApprovalRef && open[f.AcademicYear] && !has[f.FeeSettingId] &&
        enrollments.some(function (e) { return e.AcademicYear === f.AcademicYear && e.GradeLevel === f.GradeLevel; });
    })
    .map(function (f) { return feeSettingDto_(f, null); })
    .sort(function (a, b) { return a.year !== b.year ? b.year - a.year : compareFeeSettings_(gradeLevels_())(a, b); });
}

// ---------------------------------------------------------------------------
// API: อัตราเงินบำรุง
// ---------------------------------------------------------------------------

/** fees.list — อัตราเงินบำรุงของปีการศึกษา พร้อมสถิติการเรียกเก็บ */
function feesList_(ctx, payload) {
  const year = isBlankInput_(payload.year) ? currentAcademicYear_() : requireAcademicYear_(payload.year);
  const levels = gradeLevels_();
  const stats = feeStats_(ledgerContext_());
  const settings = dbFind_(SHEETS.FEE_SETTINGS, function (f) { return f.AcademicYear === year; })
    .map(function (f) { return feeSettingDto_(f, stats[f.FeeSettingId]); })
    .sort(compareFeeSettings_(levels));
  return {
    year: year,
    yearOpen: isYearOpen_(year),
    gradeLevels: levels,
    terms: termOptions_(),
    defaultDescription: FEE_DEFAULT_DESCRIPTION,
    settings: settings,
  };
}

/** fees.create — ตั้งอัตราให้หลายระดับชั้นพร้อมกัน (1 ชั้น = 1 รายการ) */
function feesCreate_(ctx, payload) {
  const year = requireAcademicYear_(payload.year, { mustBeOpen: true });
  const term = requireEnum_(payload.term, STATUS.TERM, 'ภาคเรียน');
  const levels = gradeLevels_();
  const grades = Array.isArray(payload.gradeLevels) ? payload.gradeLevels : [];
  if (!grades.length) throw validationError_('กรุณาเลือกระดับชั้นอย่างน้อย 1 ชั้น');
  if (grades.length > levels.length) throw validationError_('ระดับชั้นไม่ถูกต้อง');
  const chosen = [];
  grades.forEach(function (g) {
    const text = typeof g === 'string' ? g.trim() : '';
    if (levels.indexOf(text) === -1) throw validationError_('ระดับชั้น "' + text + '" ไม่อยู่ในรายการระดับชั้นที่เปิดสอน');
    if (chosen.indexOf(text) === -1) chosen.push(text);
  });
  chosen.sort(function (a, b) { return levels.indexOf(a) - levels.indexOf(b); });
  const input = validateFeeInput_(payload);

  const existing = dbFind_(SHEETS.FEE_SETTINGS, function (f) { return f.AcademicYear === year; });
  const same = chosen.filter(function (g) {
    return existing.some(function (f) { return f.GradeLevel === g && f.Term === term; });
  });
  if (same.length) {
    throw appError_(ERROR_CODES.CONFLICT, 'ชั้น ' + same.join(', ') + ' มีอัตรา' + STATUS_LABELS.TERM[term] +
      ' ปีการศึกษา ' + year + ' แล้ว ให้แก้ไขอัตราเดิมแทน');
  }
  const mixed = chosen.filter(function (g) {
    return existing.some(function (f) {
      return f.GradeLevel === g && f.Term !== term && (f.Term === STATUS.TERM.YEAR || term === STATUS.TERM.YEAR);
    });
  });
  if (mixed.length) {
    throw appError_(ERROR_CODES.CONFLICT, 'ชั้น ' + mixed.join(', ') +
      (term === STATUS.TERM.YEAR ? ' มีอัตรารายภาคเรียนแล้ว' : ' มีอัตราทั้งปีการศึกษาแล้ว') +
      ' ตั้งอัตรารายภาคเรียนและทั้งปีการศึกษาซ้อนกันไม่ได้ (ป้องกันการเรียกเก็บซ้ำ)');
  }

  const created = dbInsertMany_(SHEETS.FEE_SETTINGS, chosen.map(function (g) {
    return {
      AcademicYear: year,
      Term: term,
      GradeLevel: g,
      Amount: satangToBaht_(input.amountSatang),
      StartDate: input.startDate,
      DueDate: input.dueDate,
      Description: input.description,
      ApprovalRef: input.approvalRef,
      Status: STATUS.FEE_SETTING.ACTIVE,
    };
  }), actorFromCtx_(ctx), { note: 'ตั้งอัตรา' + input.description + ' ' + termLabel_(term, year) });
  return created.map(function (f) { return feeSettingDto_(f, null); });
}

/** fees.update — แก้ไขอัตรา (จำนวนเงินและวันครบกำหนดแก้ไม่ได้เมื่อมีรายการเรียกเก็บแล้ว) */
function feesUpdate_(ctx, payload) {
  const f = requireFeeSetting_(payload.feeSettingId);
  if (!isYearOpen_(f.AcademicYear)) {
    throw appError_(ERROR_CODES.CONFLICT, 'ปีการศึกษา ' + f.AcademicYear + ' ปิดแล้ว แก้ไขอัตราไม่ได้');
  }
  const input = validateFeeInput_(payload);
  const status = requireEnum_(payload.status, STATUS.FEE_SETTING, 'สถานะ');
  const used = dbFindOne_(SHEETS.FEE_ASSESSMENTS, function (a) {
    return a.FeeSettingId === f.FeeSettingId && a.Status === STATUS.ASSESSMENT.ACTIVE;
  });
  if (used && input.amountSatang !== satangOf_(f.Amount)) {
    throw appError_(ERROR_CODES.CONFLICT,
      'อัตรานี้สร้างรายการเรียกเก็บแล้ว จึงแก้จำนวนเงินไม่ได้ ถ้าบางคนต้องจ่ายต่างจากอัตรา ให้ใช้การลดหย่อนเป็นรายคน');
  }
  if (used && input.dueDate !== f.DueDate) {
    throw appError_(ERROR_CODES.CONFLICT, 'อัตรานี้สร้างรายการเรียกเก็บแล้ว จึงแก้วันครบกำหนดชำระไม่ได้');
  }
  const result = dbUpdate_(SHEETS.FEE_SETTINGS, f.FeeSettingId, {
    Amount: satangToBaht_(input.amountSatang),
    StartDate: input.startDate,
    DueDate: input.dueDate,
    Description: input.description,
    ApprovalRef: input.approvalRef,
    Status: status,
  }, actorFromCtx_(ctx), { note: 'แก้ไขอัตรา ' + feeLabel_(f) });
  return feeSettingDto_(result.after, feeStats_(ledgerContext_())[f.FeeSettingId]);
}

// ---------------------------------------------------------------------------
// API: รายการเรียกเก็บ
// ---------------------------------------------------------------------------

/** assessments.list — รายการเรียกเก็บของอัตราหนึ่ง พร้อมยอดชำระและสถานะของแต่ละคน */
function assessmentsList_(ctx, payload) {
  const f = requireFeeSetting_(payload.feeSettingId);
  const lc = ledgerContext_();
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const enrollments = Object.create(null);
  dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === f.AcademicYear; })
    .forEach(function (e) { enrollments[e.StudentId] = e; });
  const pending = pendingRequestsByRef_();
  const rows = dbFind_(SHEETS.FEE_ASSESSMENTS, function (a) { return a.FeeSettingId === f.FeeSettingId; })
    .map(function (a) {
      const dto = assessmentDto_(a, lc);
      const s = students[a.StudentId];
      const e = enrollments[a.StudentId];
      dto.studentNo = s ? s.StudentNo : '';
      dto.fullName = s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) : '';
      dto.firstName = s ? s.FirstName : '';
      dto.classNo = e ? e.ClassNo : null;
      dto.pendingRequest = pending[a.AssessmentId] || null;
      return dto;
    })
    .sort(compareStudentRows_(gradeLevels_()));
  return {
    setting: feeSettingDto_(f, feeStats_(lc)[f.FeeSettingId]),
    rows: rows,
    canManage: ctx.role === ROLES.FINANCE,
  };
}

/** assessments.preview — ตัวอย่างก่อนสร้างรายการเรียกเก็บ (ยังไม่บันทึก) */
function assessmentsPreview_(ctx, payload) {
  const f = requireFeeReadyForAssessment_(payload.feeSettingId);
  const plan = assessmentPlan_(f);
  return {
    setting: feeSettingDto_(f, null),
    create: plan.create,
    skipped: plan.skipped,
    already: plan.already,
    totalSatang: plan.create.length * satangOf_(f.Amount),
  };
}

/** assessments.generate — สร้างรายการเรียกเก็บ (ตรวจซ้ำภายใต้ lock กดซ้ำได้โดยไม่เกิดรายการซ้ำ) */
function assessmentsGenerate_(ctx, payload) {
  const f = requireFeeReadyForAssessment_(payload.feeSettingId);
  const plan = assessmentPlan_(f);
  if (plan.create.length) {
    dbInsertMany_(SHEETS.FEE_ASSESSMENTS, plan.create.map(function (it) {
      return newAssessmentRecord_(f, it.studentId, it.enrollmentId, it.room);
    }), actorFromCtx_(ctx), { note: 'สร้างรายการเรียกเก็บ ' + feeLabel_(f) });
  }
  return {
    created: plan.create.length,
    already: plan.already,
    skipped: plan.skipped.length,
    totalSatang: plan.create.length * satangOf_(f.Amount),
  };
}

/** assessments.createOne — เพิ่มรายการเรียกเก็บรายบุคคล เช่น นักเรียนย้ายเข้ากลางปี */
function assessmentsCreateOne_(ctx, payload) {
  const f = requireFeeReadyForAssessment_(payload.feeSettingId);
  const studentId = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const s = dbGet_(SHEETS.STUDENTS, studentId);
  if (!s) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const e = enrollmentOf_(studentId, f.AcademicYear);
  if (!e || e.GradeLevel !== f.GradeLevel) {
    throw appError_(ERROR_CODES.CONFLICT, studentDisplayName_(s.Prefix, s.FirstName, s.LastName) + ' ไม่ได้เรียนชั้น ' +
      f.GradeLevel + ' ในปีการศึกษา ' + f.AcademicYear);
  }
  const dup = dbFindOne_(SHEETS.FEE_ASSESSMENTS, function (a) {
    return a.StudentId === studentId && a.FeeSettingId === f.FeeSettingId && a.Status === STATUS.ASSESSMENT.ACTIVE;
  });
  if (dup) throw appError_(ERROR_CODES.CONFLICT, 'นักเรียนคนนี้มีรายการเรียกเก็บของอัตรานี้แล้ว');
  const rec = dbInsert_(SHEETS.FEE_ASSESSMENTS, newAssessmentRecord_(f, studentId, e.EnrollmentId, e.Room),
    actorFromCtx_(ctx), { note: 'เพิ่มรายการเรียกเก็บรายบุคคล ' + feeLabel_(f) });
  return assessmentDto_(rec, ledgerContext_());
}

// ---------------------------------------------------------------------------
// ลดหย่อน/ยกเว้น และการยกเลิกรายการเรียกเก็บ
// ---------------------------------------------------------------------------

function requireActiveAssessment_(value) {
  const id = requireId_(value, 'ASM', 'รหัสรายการเรียกเก็บ');
  const asm = dbGet_(SHEETS.FEE_ASSESSMENTS, id);
  if (!asm) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการเรียกเก็บ');
  if (asm.Status !== STATUS.ASSESSMENT.ACTIVE) throw appError_(ERROR_CODES.CONFLICT, 'รายการเรียกเก็บนี้ถูกยกเลิกแล้ว');
  return asm;
}

/** ข้อความอธิบายรายการเรียกเก็บ เช่น "เด็กชายสมชาย ใจดี (10001) เงินบำรุงการศึกษา ภาคเรียนที่ 1/2569 ชั้น ป.1" */
function describeAssessment_(asm, lc) {
  const s = dbGet_(SHEETS.STUDENTS, asm.StudentId);
  const who = s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) + ' (' + s.StudentNo + ')' : asm.StudentId;
  return who + ' ' + assessmentLabel_(asm, lc);
}

/** รายการเดียวกันมีคำขอที่รออนุมัติได้ครั้งละ 1 คำขอ */
function assertNoPendingRequest_(assessmentId) {
  const pending = dbFindOne_(SHEETS.APPROVAL_REQUESTS, function (r) {
    return r.RefId === assessmentId && r.Status === STATUS.DECISION.PENDING;
  });
  if (pending) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการนี้มีคำขอ "' + (STATUS_LABELS.REQUEST_TYPE[pending.RequestType] || pending.RequestType) +
      '" ที่รออนุมัติอยู่แล้ว กรุณารอผลการพิจารณา หรือถอนคำขอเดิมก่อน', { reason: 'PENDING_REQUEST' });
  }
}

/**
 * adjustments.request — ขอลดหย่อนหรือยกเว้น
 * ยกเว้น = ยกเว้นยอดคงเหลือทั้งหมด / ลดหย่อน = ระบุจำนวนเงิน ไม่เกินยอดคงเหลือ
 */
function adjustmentsRequest_(ctx, payload) {
  const asm = requireActiveAssessment_(payload.assessmentId);
  const type = requireEnum_(payload.type, STATUS.ADJUSTMENT_TYPE, 'ประเภท');
  const reason = requireText_(payload.reason, 'เหตุผล', { max: 500, multiline: true });
  const referenceDoc = requireText_(payload.referenceDoc, 'เอกสารอ้างอิง', { max: 300 });
  assertNoPendingRequest_(asm.AssessmentId);
  const lc = ledgerContext_();
  const fig = assessmentFigures_(asm, lc);
  if (fig.outstandingSatang <= 0) throw appError_(ERROR_CODES.CONFLICT, 'รายการนี้ไม่มียอดคงเหลือให้ลดหย่อนหรือยกเว้น');
  const amountSatang = type === STATUS.ADJUSTMENT_TYPE.EXEMPTION
    ? fig.outstandingSatang
    : requireMoney_(payload.amount, 'จำนวนเงินที่ลดหย่อน', { maxSatang: fig.outstandingSatang });
  const typeLabel = STATUS_LABELS.ADJUSTMENT_TYPE[type];
  const data = { assessmentId: asm.AssessmentId, type: type, amountSatang: amountSatang, reason: reason, referenceDoc: referenceDoc };
  const summary = typeLabel + ' ' + formatSatang_(amountSatang, true) + ': ' + describeAssessment_(asm, lc);
  const actor = actorFromCtx_(ctx);
  if (approvalRequired_(STATUS.REQUEST_TYPE.FEE_ADJUSTMENT)) {
    const req = createApprovalRequest_(STATUS.REQUEST_TYPE.FEE_ADJUSTMENT, asm.AssessmentId, asm.StudentId, summary, data, reason, actor);
    return { applied: false, requestId: req.RequestId, message: 'ส่งคำขอ' + typeLabel + ' ' + formatSatang_(amountSatang, true) + ' ให้ผู้อำนวยการพิจารณาแล้ว' };
  }
  applyFeeAdjustment_(data, ctx.username, '', '', actor);
  return { applied: true, message: 'บันทึก' + typeLabel + ' ' + formatSatang_(amountSatang, true) + ' เรียบร้อยแล้ว' };
}

/** บันทึกลดหย่อน/ยกเว้น (เรียกเมื่อไม่ต้องอนุมัติ หรือเมื่อผู้อำนวยการอนุมัติ) ตรวจยอดคงเหลือใหม่ทุกครั้ง */
function applyFeeAdjustment_(data, requestedBy, approvedBy, requestId, actor) {
  if (requestId) {
    const done = dbFindOne_(SHEETS.FEE_ADJUSTMENTS, function (a) { return a.ApprovalRequestId === requestId; });
    if (done) return done;
  }
  const asm = requireActiveAssessment_(data.assessmentId);
  const fig = assessmentFigures_(asm, ledgerContext_());
  if (data.amountSatang > fig.outstandingSatang) {
    throw appError_(ERROR_CODES.CONFLICT, 'ยอดคงเหลือของรายการนี้เปลี่ยนไปแล้ว (คงเหลือ ' + formatSatang_(fig.outstandingSatang, true) +
      ') จึงดำเนินการตามคำขอนี้ไม่ได้ ถ้าเป็นคำขออนุมัติ ให้เลือก "ไม่อนุมัติ" แล้วให้เจ้าหน้าที่ยื่นคำขอใหม่', { reason: 'BALANCE_CHANGED' });
  }
  return dbInsert_(SHEETS.FEE_ADJUSTMENTS, {
    AssessmentId: asm.AssessmentId,
    StudentId: asm.StudentId,
    Type: data.type,
    Amount: satangToBaht_(data.amountSatang),
    Reason: data.reason,
    ReferenceDoc: data.referenceDoc,
    Status: STATUS.ADJUSTMENT.ACTIVE,
    RequestedBy: requestedBy,
    ApprovedBy: approvedBy,
    ApprovalRequestId: requestId,
  }, actor, { note: (STATUS_LABELS.ADJUSTMENT_TYPE[data.type] || data.type) + ' ' + formatSatang_(data.amountSatang, true) });
}

/** adjustments.revoke — เพิกถอนลดหย่อน/ยกเว้นที่บันทึกผิด (ผู้อำนวยการ) ยอดค้างจะกลับมา */
function adjustmentsRevoke_(ctx, payload) {
  const id = requireId_(payload.adjustmentId, 'ADJ', 'รหัสรายการลดหย่อน');
  const a = dbGet_(SHEETS.FEE_ADJUSTMENTS, id);
  if (!a) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการลดหย่อน/ยกเว้น');
  if (a.Status !== STATUS.ADJUSTMENT.ACTIVE) throw appError_(ERROR_CODES.CONFLICT, 'รายการนี้ถูกเพิกถอนแล้ว');
  const reason = requireText_(payload.reason, 'เหตุผลการเพิกถอน', { max: 500, multiline: true });
  dbUpdate_(SHEETS.FEE_ADJUSTMENTS, id, {
    Status: STATUS.ADJUSTMENT.REVOKED,
    RevokedAt: nowIso_(),
    RevokedBy: ctx.username,
    RevokeReason: reason,
  }, actorFromCtx_(ctx), { action: AUDIT_ACTIONS.CANCEL, note: 'เพิกถอน' + (STATUS_LABELS.ADJUSTMENT_TYPE[a.Type] || '') });
  return { adjustmentId: id, message: 'เพิกถอนเรียบร้อยแล้ว ยอดค้างของรายการนี้กลับมาตามเดิม' };
}

/** assessments.requestCancel — ขอยกเลิกรายการเรียกเก็บ (ได้เฉพาะรายการที่ยังไม่มีการชำระ) */
function assessmentsRequestCancel_(ctx, payload) {
  const asm = requireActiveAssessment_(payload.assessmentId);
  const reason = requireText_(payload.reason, 'เหตุผลการยกเลิก', { max: 500, multiline: true });
  assertNoPendingRequest_(asm.AssessmentId);
  const lc = ledgerContext_();
  const fig = assessmentFigures_(asm, lc);
  if (fig.paidSatang > 0) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการนี้รับชำระแล้ว ' + formatSatang_(fig.paidSatang, true) +
      ' จึงยกเลิกไม่ได้ ถ้าจำเป็นต้องยกเลิกใบเสร็จที่เกี่ยวข้องก่อน');
  }
  const data = { assessmentId: asm.AssessmentId, reason: reason };
  const summary = 'ยกเลิกรายการเรียกเก็บ ' + formatSatang_(fig.netSatang, true) + ': ' + describeAssessment_(asm, lc);
  const actor = actorFromCtx_(ctx);
  if (approvalRequired_(STATUS.REQUEST_TYPE.ASSESSMENT_CANCEL)) {
    const req = createApprovalRequest_(STATUS.REQUEST_TYPE.ASSESSMENT_CANCEL, asm.AssessmentId, asm.StudentId, summary, data, reason, actor);
    return { applied: false, requestId: req.RequestId, message: 'ส่งคำขอยกเลิกรายการเรียกเก็บให้ผู้อำนวยการพิจารณาแล้ว' };
  }
  applyAssessmentCancel_(data, ctx.username, '', actor);
  return { applied: true, message: 'ยกเลิกรายการเรียกเก็บเรียบร้อยแล้ว' };
}

/** ยกเลิกรายการเรียกเก็บ (เรียกเมื่อไม่ต้องอนุมัติ หรือเมื่อผู้อำนวยการอนุมัติ) ตรวจการชำระใหม่ทุกครั้ง */
function applyAssessmentCancel_(data, requestedBy, requestId, actor) {
  const asm = dbGet_(SHEETS.FEE_ASSESSMENTS, data.assessmentId);
  if (!asm) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการเรียกเก็บ');
  if (asm.Status === STATUS.ASSESSMENT.CANCELLED) {
    if (requestId && asm.ApprovalRequestId === requestId) return asm;
    throw appError_(ERROR_CODES.CONFLICT, 'รายการเรียกเก็บนี้ถูกยกเลิกแล้ว');
  }
  const fig = assessmentFigures_(asm, ledgerContext_());
  if (fig.paidSatang > 0) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการนี้มีการรับชำระแล้ว ' + formatSatang_(fig.paidSatang, true) +
      ' จึงยกเลิกไม่ได้ ถ้าเป็นคำขออนุมัติ ให้เลือก "ไม่อนุมัติ"', { reason: 'BALANCE_CHANGED' });
  }
  return dbUpdate_(SHEETS.FEE_ASSESSMENTS, asm.AssessmentId, {
    Status: STATUS.ASSESSMENT.CANCELLED,
    CancelReason: data.reason,
    CancelledAt: nowIso_(),
    CancelledBy: requestedBy,
    ApprovalRequestId: requestId,
  }, actor, { action: AUDIT_ACTIONS.CANCEL, note: 'ยกเลิกรายการเรียกเก็บ' }).after;
}
