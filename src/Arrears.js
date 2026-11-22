/**
 * ============================================================================
 *  Arrears.gs — ยอดค้างชำระ รายนักเรียน ห้อง ชั้น ทั้งโรงเรียน และยอดค้างสะสมจากปีก่อน
 * ----------------------------------------------------------------------------
 *  - ยอดค้าง = ยอดเรียกเก็บสุทธิ − ยอดชำระ ของรายการเรียกเก็บที่มีผล (คำนวณจาก Ledger ทุกครั้ง ไม่เก็บไว้ในชีต)
 *  - เมื่อเลือกปีการศึกษาหนึ่ง:
 *      ปีนี้           = ยอดค้างของรายการเรียกเก็บปีการศึกษานั้น
 *      ค้างจากปีก่อน    = ยอดค้างของรายการเรียกเก็บปีการศึกษาก่อนหน้า (ยอดค้างสะสม)
 *      ปีถัดไป          = ยอดค้างของปีหลังจากนั้น (มีเฉพาะเมื่อดูปีที่ผ่านมาแล้ว)
 *      รวมทุกปี        = ผลรวมทั้งหมด
 *  - จัดกลุ่มตามชั้นและห้องของนักเรียนในปีการศึกษาที่เลือก
 *    นักเรียนที่ยังมียอดค้างแต่ไม่มีชั้นเรียนในปีนั้น (เช่น ย้ายออก จบการศึกษา) แสดงแยกกลุ่ม
 *    และยังนับในยอดรวมทั้งโรงเรียน (หนี้ไม่ถูกตัดอัตโนมัติ: D-10)
 *  - เลยกำหนด = ยอดค้างของรายการที่วันครบกำหนดผ่านมาแล้ว
 *  - อัตราการชำระ = ยอดชำระ ÷ ยอดเรียกเก็บสุทธิ ของปีที่เลือก
 * ============================================================================
 */

const ARREARS_FIELDS_ = Object.freeze(['netSatang', 'paidSatang', 'currentSatang', 'priorSatang', 'laterSatang', 'totalSatang', 'overdueSatang']);

function emptyArrears_() {
  const out = { students: 0, owingStudents: 0 };
  ARREARS_FIELDS_.forEach(function (k) { out[k] = 0; });
  return out;
}

function addArrears_(target, row) {
  target.students += 1;
  if (row.totalSatang > 0) target.owingStudents += 1;
  ARREARS_FIELDS_.forEach(function (k) { target[k] += row[k]; });
}

/** ยอดของนักเรียนทุกคน แยกตามปีการศึกษาที่เลือก */
function arrearsByStudent_(year, lc) {
  const out = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (asm) {
    if (asm.Status !== STATUS.ASSESSMENT.ACTIVE) return;
    const f = assessmentFigures_(asm, lc);
    let r = out[asm.StudentId];
    if (!r) {
      r = out[asm.StudentId] = { years: Object.create(null), oldestDue: '' };
      ARREARS_FIELDS_.forEach(function (k) { r[k] = 0; });
    }
    if (asm.AcademicYear === year) {
      r.netSatang += f.netSatang;
      r.paidSatang += f.paidSatang;
      r.currentSatang += f.outstandingSatang;
    } else if (asm.AcademicYear < year) {
      r.priorSatang += f.outstandingSatang;
    } else {
      r.laterSatang += f.outstandingSatang;
    }
    r.totalSatang += f.outstandingSatang;
    if (f.outstandingSatang > 0) {
      r.years[asm.AcademicYear] = (r.years[asm.AcademicYear] || 0) + f.outstandingSatang;
      if (asm.DueDate && asm.DueDate < lc.today) r.overdueSatang += f.outstandingSatang;
      if (asm.DueDate && (!r.oldestDue || asm.DueDate < r.oldestDue)) r.oldestDue = asm.DueDate;
    }
  });
  return out;
}

/**
 * arrears.summary — ยอดค้างของปีการศึกษาที่เลือก: ทั้งโรงเรียน รายชั้น รายห้อง และรายนักเรียน
 * payload: { year } (ค่าเริ่มต้น = ปีการศึกษาปัจจุบัน)
 */
function arrearsSummary_(ctx, payload) {
  const year = isBlankInput_(payload.year) ? currentAcademicYear_() : requireAcademicYear_(payload.year);
  const lc = ledgerContext_();
  const levels = gradeLevels_();
  const figures = arrearsByStudent_(year, lc);
  const enrollments = Object.create(null);
  dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === year; }).forEach(function (e) { enrollments[e.StudentId] = e; });

  const rows = [];
  dbAll_(SHEETS.STUDENTS).forEach(function (s) {
    const e = enrollments[s.StudentId] || null;
    const f = figures[s.StudentId];
    if (!e && (!f || f.totalSatang <= 0)) return; // ไม่ได้เรียนปีนี้ และไม่มียอดค้าง
    const row = {
      studentId: s.StudentId,
      studentNo: s.StudentNo,
      fullName: studentDisplayName_(s.Prefix, s.FirstName, s.LastName),
      firstName: s.FirstName,
      status: s.Status,
      statusLabel: STATUS_LABELS.STUDENT[s.Status] || s.Status,
      enrolled: !!e,
      gradeLevel: e ? e.GradeLevel : '',
      room: e ? e.Room : '',
      classNo: e ? e.ClassNo : null,
      classLabel: e ? classLabel_(e.GradeLevel, e.Room) : '',
      enrollStatus: e ? e.EnrollStatus : '',
      enrollStatusLabel: e ? (STATUS_LABELS.STUDENT[e.EnrollStatus] || e.EnrollStatus) : '',
      oldestDue: f ? f.oldestDue : '',
      years: f ? Object.keys(f.years).map(Number).sort().map(function (y) { return { year: y, satang: f.years[y] }; }) : [],
    };
    ARREARS_FIELDS_.forEach(function (k) { row[k] = f ? f[k] : 0; });
    rows.push(row);
  });
  const byClass = compareStudentRows_(levels);
  rows.sort(function (a, b) {
    if (a.enrolled !== b.enrolled) return a.enrolled ? -1 : 1;
    return a.enrolled ? byClass(a, b) : compareText_(a.firstName, b.firstName);
  });

  const school = emptyArrears_();
  const enrolledTotals = emptyArrears_();
  const other = emptyArrears_();
  const grades = Object.create(null);
  rows.forEach(function (r) {
    addArrears_(school, r);
    if (!r.enrolled) { addArrears_(other, r); return; }
    addArrears_(enrolledTotals, r);
    const g = grades[r.gradeLevel] || (grades[r.gradeLevel] = Object.assign(emptyArrears_(), { gradeLevel: r.gradeLevel, rooms: Object.create(null) }));
    addArrears_(g, r);
    const room = g.rooms[r.room] || (g.rooms[r.room] = Object.assign(emptyArrears_(), { room: r.room, classLabel: classLabel_(r.gradeLevel, r.room) }));
    addArrears_(room, r);
  });
  const gradeList = Object.keys(grades)
    .sort(function (a, b) {
      const ga = levels.indexOf(a);
      const gb = levels.indexOf(b);
      return (ga === -1 ? 999 : ga) - (gb === -1 ? 999 : gb) || compareText_(a, b);
    })
    .map(function (k) {
      const g = grades[k];
      g.rooms = Object.keys(g.rooms).sort(compareRoom_).map(function (r) { return g.rooms[r]; });
      return g;
    });
  return {
    year: year,
    today: lc.today,
    generatedAt: nowIso_(),
    school: school,
    enrolled: enrolledTotals,
    other: other,
    grades: gradeList,
    rows: rows,
    gradeLevels: levels,
  };
}
