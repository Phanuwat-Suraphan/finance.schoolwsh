/**
 * ============================================================================
 *  Dashboard.gs — ภาพรวมการเงินของปีการศึกษา (ข้อกำหนดข้อ 10)
 * ----------------------------------------------------------------------------
 *  - นักเรียนที่นับ = นักเรียนที่มีชั้นเรียนในปีนั้น และนักเรียนที่มีรายการเรียกเก็บของปีนั้นแต่ไม่มีชั้นเรียน (กลุ่ม "อื่น ๆ")
 *  - สถานะรายนักเรียน (รวมทุกรายการของปีนั้น):
 *      ชำระครบ = ไม่มียอดค้างและยอดสุทธิมากกว่า 0 / ได้รับยกเว้น = ยอดสุทธิเป็น 0 ทั้งหมด
 *      ชำระบางส่วน = มียอดค้างและเคยชำระแล้ว / ยังไม่ชำระ = มียอดค้างและยังไม่ชำระเลย
 *      ยังไม่มีรายการ = ยังไม่ได้ออกรายการเรียกเก็บ
 *  - ยอดเงินเป็นยอด ณ ขณะที่เปิดหน้า คำนวณจาก Ledger ทุกครั้ง (ตรงกับรายงานยอดค้าง)
 * ============================================================================
 */

const DASHBOARD_STATES = Object.freeze(['PAID', 'PARTIAL', 'UNPAID', 'EXEMPT', 'NO_BILL']);
const DASHBOARD_STATE_LABELS = Object.freeze({
  PAID: 'ชำระครบ', PARTIAL: 'ชำระบางส่วน', UNPAID: 'ยังไม่ชำระ', EXEMPT: 'ได้รับยกเว้น', NO_BILL: 'ยังไม่มีรายการเรียกเก็บ',
});
const DASHBOARD_OTHER_KEY = '__OTHER__';

function emptyDashboardGroup_(base) {
  const g = Object.assign(base || {}, {
    students: 0, grossSatang: 0, netSatang: 0, paidSatang: 0, outstandingSatang: 0, overdueSatang: 0, states: {},
  });
  DASHBOARD_STATES.forEach(function (s) { g.states[s] = 0; });
  return g;
}

function addDashboardStudent_(g, r, state) {
  g.students += 1;
  g.states[state] += 1;
  if (!r) return;
  g.grossSatang += r.gross;
  g.netSatang += r.net;
  g.paidSatang += r.paid;
  g.outstandingSatang += r.outstanding;
  g.overdueSatang += r.overdue;
}

function dashboardStateOf_(r) {
  if (!r || !r.count) return 'NO_BILL';
  if (r.outstanding <= 0) return r.net > 0 ? 'PAID' : 'EXEMPT';
  return r.paid > 0 ? 'PARTIAL' : 'UNPAID';
}

/** dashboard.summary — payload: { year } (ค่าเริ่มต้น = ปีการศึกษาปัจจุบัน) */
function dashboardSummary_(ctx, payload) {
  const year = isBlankInput_(payload.year) ? currentAcademicYear_() : requireAcademicYear_(payload.year);
  const lc = ledgerContext_();
  const levels = gradeLevels_();
  const enrollments = Object.create(null);
  dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === year; }).forEach(function (e) { enrollments[e.StudentId] = e; });

  const per = Object.create(null);
  let priorOutstanding = 0;
  const priorStudents = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) {
    if (a.Status !== STATUS.ASSESSMENT.ACTIVE) return;
    if (a.AcademicYear > year) return;
    const f = assessmentFigures_(a, lc);
    if (a.AcademicYear < year) {
      priorOutstanding += f.outstandingSatang;
      if (f.outstandingSatang > 0) priorStudents[a.StudentId] = true;
      return;
    }
    const r = per[a.StudentId] || (per[a.StudentId] = { count: 0, gross: 0, net: 0, paid: 0, outstanding: 0, overdue: 0 });
    r.count += 1;
    r.gross += f.grossSatang;
    r.net += f.netSatang;
    r.paid += f.paidSatang;
    r.outstanding += f.outstandingSatang;
    if (f.outstandingSatang > 0 && a.DueDate && a.DueDate < lc.today) r.overdue += f.outstandingSatang;
  });

  const totals = emptyDashboardGroup_();
  const grades = Object.create(null);
  const population = Object.create(null);
  Object.keys(enrollments).forEach(function (id) { population[id] = true; });
  Object.keys(per).forEach(function (id) { population[id] = true; });
  Object.keys(population).forEach(function (id) {
    const r = per[id] || null;
    const state = dashboardStateOf_(r);
    const e = enrollments[id];
    addDashboardStudent_(totals, r, state);
    const gk = e ? e.GradeLevel : DASHBOARD_OTHER_KEY;
    const g = grades[gk] || (grades[gk] = emptyDashboardGroup_({
      gradeLevel: e ? e.GradeLevel : '', label: e ? e.GradeLevel : 'ไม่มีชั้นเรียนในปีนี้', other: !e, rooms: Object.create(null),
    }));
    addDashboardStudent_(g, r, state);
    if (!e) return;
    const room = g.rooms[e.Room] || (g.rooms[e.Room] = emptyDashboardGroup_({ room: e.Room, label: classLabel_(e.GradeLevel, e.Room) }));
    addDashboardStudent_(room, r, state);
  });
  const byGrade = gradeOrder_(levels);
  const gradeList = Object.keys(grades).sort(function (a, b) {
    if (a === DASHBOARD_OTHER_KEY) return 1;
    if (b === DASHBOARD_OTHER_KEY) return -1;
    return byGrade(a, b);
  }).map(function (k) {
    const g = grades[k];
    g.rooms = Object.keys(g.rooms).sort(compareRoom_).map(function (r) { return g.rooms[r]; });
    return g;
  });

  const today = lc.today;
  const todayFig = dayFigures_(today);
  return {
    year: year,
    today: today,
    generatedAt: nowIso_(),
    totals: totals,
    grades: gradeList,
    states: DASHBOARD_STATES.map(function (s) { return { key: s, label: DASHBOARD_STATE_LABELS[s] }; }),
    priorOutstandingSatang: priorOutstanding,
    priorStudents: Object.keys(priorStudents).length,
    todayReceipts: { date: today, count: todayFig.receiptCount, totalSatang: todayFig.totalSatang, closed: !!closingOf_(today) },
    pendingApprovals: dbFind_(SHEETS.APPROVAL_REQUESTS, function (r) { return r.Status === STATUS.DECISION.PENDING; }).length,
    unclosedDays: unclosedDaysCount_(),
  };
}
