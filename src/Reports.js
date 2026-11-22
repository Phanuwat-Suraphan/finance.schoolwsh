/**
 * ============================================================================
 *  Reports.gs — ข้อมูลของรายงานแบบทางการ (หน้าเว็บจัดรูปแบบสำหรับพิมพ์หรือบันทึกเป็น PDF)
 * ----------------------------------------------------------------------------
 *  ทุกรายงานคำนวณจากข้อมูลในชีตทุกครั้ง ไม่มีตารางสรุปที่เก็บแยกไว้ และพิมพ์วันเวลาที่ออกรายงานเสมอ
 *   1. เอกสารแจ้งยอดเรียกเก็บเงิน ............ reports.notices
 *   2. รายงานการรับเงินประจำวัน (และปิดยอด) ... reports.daily + closings.*
 *   3. รายงานการรับเงินแยกตามห้อง ............ reports.collections
 *   4. รายงานการรับเงินแยกตามระดับชั้น ........ reports.collections
 *   5. รายงานยอดค้างชำระ .................... arrears.summary (Arrears.gs)
 *   6. รายงานทะเบียนคุมใบเสร็จ ............... receipts.book (Receipts.gs)
 *   7. รายงานใบเสร็จยกเลิก ................... reports.cancelled
 *   8. รายงานสรุปประจำปีการศึกษา ............. reports.annual
 *   9. รายงานการใช้ใบเสร็จประจำปีงบประมาณ ...... reports.receiptUsage (D-15)
 *  ช่วงเวลาเลือกได้ทั้งปีการศึกษา ปีงบประมาณ เดือน หรือกำหนดเอง (D-18)
 *  ช่วงของปีการศึกษาในรายงานคือ 1 พ.ค.–30 เม.ย. ต่อเนื่องกันทุกปี เพื่อไม่ให้มีวันที่หล่นหาย (D-39)
 * ============================================================================
 */

const REPORT_MAX_DAYS = 400;
const REPORT_PERIOD_TYPES = Object.freeze(['academic', 'fiscal', 'month', 'range']);
const NOTICE_MAX_STUDENTS = 600;

function reportSigners_() {
  return {
    financeName: getSetting_('FINANCE_OFFICER_NAME'),
    financePosition: getSetting_('FINANCE_OFFICER_POSITION'),
    directorName: getSetting_('DIRECTOR_NAME'),
    directorPosition: getSetting_('DIRECTOR_POSITION'),
  };
}

/** หัวรายงาน: ข้อมูลโรงเรียน ผู้ลงนาม และผู้ออกรายงาน */
function reportMeta_(ctx) {
  const school = schoolInfo_();
  school.phone = getSetting_('SCHOOL_PHONE');
  return {
    school: school,
    signers: reportSigners_(),
    generatedAt: nowIso_(),
    generatedBy: ctx.displayName || ctx.username,
  };
}

/** ช่วงวันที่ของรายงาน payload: { periodType, year, fiscalYear, month: 'YYYY-MM', fromDate, toDate } */
function reportPeriod_(payload) {
  const type = isBlankInput_(payload.periodType) ? 'academic' : requireEnum_(payload.periodType, REPORT_PERIOD_TYPES, 'ช่วงเวลาของรายงาน');
  let from;
  let to;
  let label;
  if (type === 'academic') {
    const year = isBlankInput_(payload.year) ? currentAcademicYear_() : requireInt_(payload.year, 'ปีการศึกษา', { min: 2500, max: 2700 });
    const r = academicYearRange_(year);
    from = r.from;
    to = r.to;
    label = 'ปีการศึกษา ' + year;
  } else if (type === 'fiscal') {
    const fy = isBlankInput_(payload.fiscalYear) ? fiscalYearOfDate_(todayIso_()) : requireInt_(payload.fiscalYear, 'ปีงบประมาณ', { min: 2500, max: 2700 });
    const r = fiscalYearRange_(fy);
    from = r.from;
    to = r.to;
    label = 'ปีงบประมาณ ' + fy;
  } else if (type === 'month') {
    const m = requireText_(payload.month, 'เดือน', { max: 7, pattern: /^\d{4}-(0[1-9]|1[0-2])$/, patternMessage: 'เดือนไม่ถูกต้อง' });
    from = m + '-01';
    const p = m.split('-').map(Number);
    to = addDaysIso_(p[1] === 12 ? (p[0] + 1) + '-01-01' : p[0] + '-' + ('0' + (p[1] + 1)).slice(-2) + '-01', -1);
    label = 'เดือน' + formatThaiMonth_(m);
  } else {
    from = requireIsoDate_(payload.fromDate, 'วันที่เริ่มต้น');
    to = requireIsoDate_(isBlankInput_(payload.toDate) ? from : payload.toDate, 'วันที่สิ้นสุด');
    if (to < from) throw validationError_('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น');
    if (daysBetween_(from, to) >= REPORT_MAX_DAYS) throw validationError_('เลือกช่วงวันที่ได้ไม่เกิน ' + REPORT_MAX_DAYS + ' วัน');
    label = from === to ? 'วันที่ ' + formatThaiDate_(from) : 'ระหว่างวันที่ ' + formatThaiDate_(from) + ' ถึง ' + formatThaiDate_(to);
  }
  return { type: type, from: from, to: to, label: label, rangeLabel: formatThaiDate_(from) + ' – ' + formatThaiDate_(to) };
}

function studentsById_() {
  const out = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { out[s.StudentId] = s; });
  return out;
}

function studentNameOf_(s) {
  return s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) : '';
}

function gradeOrder_(levels) {
  return function (a, b) {
    const ga = levels.indexOf(a);
    const gb = levels.indexOf(b);
    return (ga === -1 ? 999 : ga) - (gb === -1 ? 999 : gb) || compareText_(a, b);
  };
}

// ---------------------------------------------------------------------------
// 2. รายงานการรับเงินประจำวัน
// ---------------------------------------------------------------------------

/** reports.daily — รายการรับเงินของวัน เรียงตามเล่มและเลขที่ใบเสร็จ พร้อมสถานะการปิดยอด payload: { date } */
function reportsDaily_(ctx, payload) {
  const date = requireIsoDate_(isBlankInput_(payload.date) ? todayIso_() : payload.date, 'วันที่');
  const payments = paymentsOfDay_(date);
  const fig = dayFigures_(date, payments);
  const lc = ledgerContext_();
  const labels = allocationLabels_(lc);
  const names = userDisplayNames_();
  const students = studentsById_();
  const enroll = latestEnrollments_();
  const rows = payments.map(function (p) {
    const s = students[p.StudentId];
    const e = enroll[p.StudentId];
    const dto = paymentDto_(p, lc, labels, names);
    return {
      paymentId: p.PaymentId,
      bookNo: p.ReceiptBookNo,
      receiptNo: p.ReceiptNo,
      studentNo: s ? s.StudentNo : '',
      studentName: studentNameOf_(s),
      classLabel: e ? classLabel_(e.GradeLevel, e.Room) : '',
      items: dto.allocations.map(function (al) { return al.label; }),
      channel: p.Channel,
      channelRef: p.ChannelRef,
      amountSatang: satangOf_(p.Amount),
      status: p.Status,
      statusLabel: STATUS_LABELS.PAYMENT[p.Status] || p.Status,
      voidReason: p.VoidReason,
      corrected: !!p.ReplacesPaymentId,
      receivedByName: p.ReceivedByName,
      createdBy: dto.createdBy,
    };
  });
  const spoiled = dbFind_(SHEETS.RECEIPT_CANCELLATIONS, function (c) {
    return c.CancelType === STATUS.CANCEL_TYPE.SPOILED && String(c.CreatedAt).slice(0, 10) === date;
  }).sort(function (a, b) { return compareText_(a.BookNo, b.BookNo) || a.ReceiptNo - b.ReceiptNo; })
    .map(function (c) {
      return { bookNo: c.BookNo, receiptNo: c.ReceiptNo, reason: c.Reason, status: c.Status, statusLabel: STATUS_LABELS.DECISION[c.Status] || c.Status };
    });
  const closingRec = closingOf_(date);
  const history = dbFind_(SHEETS.DAILY_CLOSINGS, function (c) {
    return c.ClosingDate === date && c.Status === STATUS.CLOSING.REOPENED;
  }).sort(function (a, b) { return a.CreatedAt < b.CreatedAt ? -1 : 1; }).map(function (c) { return closingDto_(c, names); });
  const pendingCount = pendingRequestsOfDay_(date).length;
  const closing = closingDto_(closingRec, names);
  return {
    date: date,
    today: todayIso_(),
    rows: rows,
    spoiled: spoiled,
    figures: {
      receiptCount: fig.receiptCount,
      voidedCount: fig.voidedCount,
      totalSatang: fig.totalSatang,
      totalText: bahtText_(fig.totalSatang),
      byChannel: fig.byChannel,
      receiptRange: fig.receiptRange,
      digest: fig.digest,
      verifyCode: verifyCodeOf_(fig.digest),
    },
    closing: closing,
    matches: closing ? closing.digest === fig.digest : null,
    history: history,
    pendingCount: pendingCount,
    canClose: ctx.role === ROLES.FINANCE && !closing && payments.length > 0 && pendingCount === 0 && date <= todayIso_(),
    canReopen: ctx.role === ROLES.DIRECTOR && !!closing,
    confirmText: CLOSING_CONFIRM_TEXT,
    meta: reportMeta_(ctx),
  };
}

// ---------------------------------------------------------------------------
// 3–4. รายงานการรับเงินแยกตามห้องและระดับชั้น
// ---------------------------------------------------------------------------

function newCollectionGroup_(base) {
  return Object.assign(base, { studentSet: Object.create(null), paymentSet: Object.create(null), satang: 0 });
}

function addCollection_(g, al, satang) {
  g.studentSet[al.StudentId] = true;
  g.paymentSet[al.PaymentId] = true;
  g.satang += satang;
}

function finishCollection_(g) {
  g.students = Object.keys(g.studentSet).length;
  g.receipts = Object.keys(g.paymentSet).length;
  delete g.studentSet;
  delete g.paymentSet;
  return g;
}

/**
 * reports.collections — เงินที่รับในช่วงเวลา แยกตามชั้นและห้องของรายการเรียกเก็บ (ชั้น/ห้อง ณ วันที่เรียกเก็บ)
 * ยอดค้างจากปีก่อนที่รับในช่วงนี้แสดงเป็นกลุ่มของปีการศึกษานั้นแยกต่างหาก ยอดรวมทุกกลุ่มเท่ากับเงินที่รับจริง
 */
function reportsCollections_(ctx, payload) {
  const period = reportPeriod_(payload);
  const levels = gradeLevels_();
  const pay = Object.create(null);
  const byChannel = Object.create(null);
  let totalSatang = 0;
  let receiptCount = 0;
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) {
    if (p.Status !== STATUS.PAYMENT.ACTIVE || p.PaymentDate < period.from || p.PaymentDate > period.to) return;
    const satang = satangOf_(p.Amount);
    pay[p.PaymentId] = p;
    totalSatang += satang;
    receiptCount += 1;
    const ch = byChannel[p.Channel] || (byChannel[p.Channel] = { channel: p.Channel, count: 0, satang: 0 });
    ch.count += 1;
    ch.satang += satang;
  });
  const asms = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) { asms[a.AssessmentId] = a; });
  const grades = Object.create(null);
  const allStudents = Object.create(null);
  let allocated = 0;
  dbAll_(SHEETS.PAYMENT_ALLOCATIONS).forEach(function (al) {
    if (al.Status !== STATUS.ALLOCATION.ACTIVE || !pay[al.PaymentId]) return;
    const asm = asms[al.AssessmentId];
    const year = asm ? asm.AcademicYear : al.AcademicYear;
    const grade = asm ? asm.GradeLevel : '';
    const room = asm ? asm.Room : '';
    const satang = satangOf_(al.Amount);
    allocated += satang;
    allStudents[al.StudentId] = true;
    const gk = year + '|' + grade;
    const g = grades[gk] || (grades[gk] = newCollectionGroup_({ year: year, gradeLevel: grade, label: grade || 'ไม่ระบุชั้น', rooms: Object.create(null) }));
    addCollection_(g, al, satang);
    const r = g.rooms[room] || (g.rooms[room] = newCollectionGroup_({ year: year, gradeLevel: grade, room: room, label: classLabel_(grade, room) || 'ไม่ระบุห้อง' }));
    addCollection_(r, al, satang);
  });
  const byGrade = gradeOrder_(levels);
  const gradeList = Object.keys(grades).map(function (k) { return grades[k]; })
    .sort(function (a, b) { return b.year - a.year || byGrade(a.gradeLevel, b.gradeLevel); })
    .map(function (g) {
      g.rooms = Object.keys(g.rooms).sort(compareRoom_).map(function (k) { return finishCollection_(g.rooms[k]); });
      return finishCollection_(g);
    });
  return {
    period: period,
    grades: gradeList,
    years: gradeList.map(function (g) { return g.year; }).filter(function (y, i, a) { return a.indexOf(y) === i; }),
    total: { students: Object.keys(allStudents).length, receipts: receiptCount, satang: totalSatang, text: bahtText_(totalSatang) },
    byChannel: Object.keys(byChannel).sort(compareText_).map(function (k) { return byChannel[k]; }),
    unallocatedSatang: totalSatang - allocated,
    meta: reportMeta_(ctx),
  };
}

// ---------------------------------------------------------------------------
// 7. รายงานใบเสร็จยกเลิก
// ---------------------------------------------------------------------------

/** reports.cancelled — คำขอยกเลิกเลขที่/ใบเสร็จที่ยื่นในช่วงเวลา (ทุกผลการพิจารณา) เรียงตามเล่มและเลขที่ */
function reportsCancelled_(ctx, payload) {
  const period = reportPeriod_(payload);
  const names = userDisplayNames_();
  const students = studentsById_();
  const payments = Object.create(null);
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) { payments[p.PaymentId] = p; });
  const entries = Object.create(null);
  dbAll_(SHEETS.RECEIPT_ENTRIES).forEach(function (e) { entries[e.EntryId] = e; });
  const totals = { voidCount: 0, voidSatang: 0, spoiledCount: 0, pendingCount: 0, notApprovedCount: 0 };
  const rows = dbFind_(SHEETS.RECEIPT_CANCELLATIONS, function (c) {
    const d = String(c.CreatedAt).slice(0, 10);
    return d >= period.from && d <= period.to;
  }).map(function (c) {
    const p = c.PaymentId ? payments[c.PaymentId] : null;
    const e = entries[c.EntryId];
    const s = students[p ? p.StudentId : (e ? e.StudentId : '')];
    const amount = c.Amount === null || c.Amount === '' ? null : satangOf_(c.Amount);
    if (c.Status === STATUS.DECISION.APPROVED) {
      if (c.CancelType === STATUS.CANCEL_TYPE.VOID_PAYMENT) {
        totals.voidCount += 1;
        totals.voidSatang += amount || 0;
      } else {
        totals.spoiledCount += 1;
      }
    } else if (c.Status === STATUS.DECISION.PENDING) {
      totals.pendingCount += 1;
    } else {
      totals.notApprovedCount += 1;
    }
    return {
      cancellationId: c.CancellationId,
      requestedAt: c.CreatedAt,
      bookNo: c.BookNo,
      receiptNo: c.ReceiptNo,
      cancelType: c.CancelType,
      cancelTypeLabel: STATUS_LABELS.CANCEL_TYPE[c.CancelType] || c.CancelType,
      receiptDate: p ? p.PaymentDate : (e ? e.ReceiptDate : ''),
      studentNo: s ? s.StudentNo : '',
      studentName: studentNameOf_(s),
      amountSatang: amount,
      reason: c.Reason,
      requestedBy: displayNameOf_(c.CreatedBy, names),
      status: c.Status,
      statusLabel: STATUS_LABELS.DECISION[c.Status] || c.Status,
      decidedBy: displayNameOf_(c.DecidedBy, names),
      decidedAt: c.DecidedAt,
      decisionNote: c.DecisionNote,
    };
  }).sort(function (a, b) {
    return compareText_(a.bookNo, b.bookNo) || a.receiptNo - b.receiptNo || (a.requestedAt < b.requestedAt ? -1 : 1);
  });
  return { period: period, rows: rows, totals: totals, meta: reportMeta_(ctx) };
}

// ---------------------------------------------------------------------------
// 8. รายงานสรุปประจำปีการศึกษา
// ---------------------------------------------------------------------------

function emptyBilling_(base) {
  return Object.assign(base || {}, {
    count: 0, studentSet: Object.create(null),
    grossSatang: 0, adjustSatang: 0, netSatang: 0, paidSatang: 0, outstandingSatang: 0, overdueSatang: 0,
  });
}

function addBilling_(t, asm, f, today) {
  t.count += 1;
  t.studentSet[asm.StudentId] = true;
  t.grossSatang += f.grossSatang;
  t.adjustSatang += f.adjustSatang;
  t.netSatang += f.netSatang;
  t.paidSatang += f.paidSatang;
  t.outstandingSatang += f.outstandingSatang;
  if (f.outstandingSatang > 0 && asm.DueDate && asm.DueDate < today) t.overdueSatang += f.outstandingSatang;
}

function finishBilling_(t) {
  t.students = Object.keys(t.studentSet).length;
  delete t.studentSet;
  return t;
}

/** reports.annual — สรุปการเรียกเก็บ การลดหย่อน การรับเงิน ยอดค้าง และการใช้ใบเสร็จของปีการศึกษา payload: { year } */
function reportsAnnual_(ctx, payload) {
  const year = isBlankInput_(payload.year) ? currentAcademicYear_() : requireAcademicYear_(payload.year);
  const range = academicYearRange_(year);
  const lc = ledgerContext_();
  const levels = gradeLevels_();
  const asmById = Object.create(null);
  const overall = emptyBilling_();
  const cancelled = { count: 0, grossSatang: 0 };
  const grades = Object.create(null);
  const items = Object.create(null);
  let priorOutstanding = 0;
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) {
    asmById[a.AssessmentId] = a;
    if (a.AcademicYear !== year) {
      if (a.AcademicYear < year && a.Status === STATUS.ASSESSMENT.ACTIVE) priorOutstanding += assessmentFigures_(a, lc).outstandingSatang;
      return;
    }
    if (a.Status !== STATUS.ASSESSMENT.ACTIVE) {
      cancelled.count += 1;
      cancelled.grossSatang += satangOf_(a.GrossAmount);
      return;
    }
    const f = assessmentFigures_(a, lc);
    addBilling_(overall, a, f, lc.today);
    const g = grades[a.GradeLevel] || (grades[a.GradeLevel] = emptyBilling_({ gradeLevel: a.GradeLevel }));
    addBilling_(g, a, f, lc.today);
    const fee = lc.fees[a.FeeSettingId];
    const desc = (fee && fee.Description) || FEE_DEFAULT_DESCRIPTION;
    const ik = desc + '|' + a.Term;
    const it = items[ik] || (items[ik] = emptyBilling_({ description: desc, term: a.Term, label: desc + ' ' + termLabel_(a.Term, year) }));
    addBilling_(it, a, f, lc.today);
  });
  const adjustments = { DISCOUNT: { count: 0, satang: 0 }, EXEMPTION: { count: 0, satang: 0 } };
  lc.adjustments.forEach(function (ad) {
    const a = asmById[ad.AssessmentId];
    if (ad.Status !== STATUS.ADJUSTMENT.ACTIVE || !a || a.AcademicYear !== year || a.Status !== STATUS.ASSESSMENT.ACTIVE) return;
    const t = adjustments[ad.Type];
    if (!t) return;
    t.count += 1;
    t.satang += satangOf_(ad.Amount);
  });

  // เงินที่รับในช่วงปีการศึกษา (ตามวันที่รับเงิน) แยกเดือน และแยกว่าเป็นเงินของปีใด
  const months = [];
  for (let d = range.from; d <= range.to; d = addDaysIso_(d.slice(0, 7) + '-28', 7).slice(0, 7) + '-01') {
    months.push({ month: d.slice(0, 7), label: formatThaiMonth_(d.slice(0, 7)), count: 0, satang: 0 });
  }
  const monthIdx = Object.create(null);
  months.forEach(function (m, i) { monthIdx[m.month] = i; });
  const payIds = Object.create(null);
  const books = Object.create(null);
  const cash = { count: 0, satang: 0, thisYearSatang: 0, priorSatang: 0, laterSatang: 0, voidedCount: 0 };
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) {
    if (p.PaymentDate < range.from || p.PaymentDate > range.to) return;
    if (p.Status === STATUS.PAYMENT.VOIDED) { cash.voidedCount += 1; return; }
    if (p.Status !== STATUS.PAYMENT.ACTIVE) return;
    const satang = satangOf_(p.Amount);
    payIds[p.PaymentId] = true;
    books[p.ReceiptBookNo] = true;
    cash.count += 1;
    cash.satang += satang;
    const m = months[monthIdx[p.PaymentDate.slice(0, 7)]];
    if (m) { m.count += 1; m.satang += satang; }
  });
  lc.allocations.forEach(function (al) {
    if (al.Status !== STATUS.ALLOCATION.ACTIVE || !payIds[al.PaymentId]) return;
    const a = asmById[al.AssessmentId];
    const y = a ? a.AcademicYear : al.AcademicYear;
    const satang = satangOf_(al.Amount);
    if (y === year) cash.thisYearSatang += satang;
    else if (y < year) cash.priorSatang += satang;
    else cash.laterSatang += satang;
  });
  const spoiled = dbFind_(SHEETS.RECEIPT_CANCELLATIONS, function (c) {
    const d = String(c.CreatedAt).slice(0, 10);
    return c.CancelType === STATUS.CANCEL_TYPE.SPOILED && c.Status === STATUS.DECISION.APPROVED && d >= range.from && d <= range.to;
  }).length;
  const byGrade = gradeOrder_(levels);
  return {
    year: year,
    period: { from: range.from, to: range.to, label: 'ปีการศึกษา ' + year, rangeLabel: formatThaiDate_(range.from) + ' – ' + formatThaiDate_(range.to) },
    today: lc.today,
    overall: finishBilling_(overall),
    cancelled: cancelled,
    adjustments: adjustments,
    grades: Object.keys(grades).sort(byGrade).map(function (k) { return finishBilling_(grades[k]); }),
    items: Object.keys(items).map(function (k) { return finishBilling_(items[k]); })
      .sort(function (a, b) { return (TERM_ORDER_[a.term] || 0) - (TERM_ORDER_[b.term] || 0) || compareText_(a.description, b.description); }),
    months: months,
    cash: cash,
    receipts: { used: cash.count, voided: cash.voidedCount, spoiled: spoiled, books: Object.keys(books).sort(compareText_) },
    priorOutstandingSatang: priorOutstanding,
    meta: reportMeta_(ctx),
  };
}

// ---------------------------------------------------------------------------
// 9. รายงานการใช้ใบเสร็จประจำปีงบประมาณ (D-15)
// ---------------------------------------------------------------------------

/**
 * reports.receiptUsage — ต่อเล่ม: ยกมา รับเข้า ใช้ ยกเลิก รออนุมัติ ปิดเล่มโดยไม่ใช้ และคงเหลือ ณ สิ้นปีงบประมาณ
 * วันที่ของเลขที่แต่ละใบใช้วันที่ในใบเสร็จ (เลขที่ยกเลิกก่อนบันทึกรับเงินใช้วันที่ยื่นคำขอ)
 */
function reportsReceiptUsage_(ctx, payload) {
  const fy = isBlankInput_(payload.fiscalYear) ? fiscalYearOfDate_(todayIso_()) : requireInt_(payload.fiscalYear, 'ปีงบประมาณ', { min: 2500, max: 2700 });
  const range = fiscalYearRange_(fy);
  const byBook = receiptEntriesByBook_();
  const rows = [];
  const total = { broughtForward: 0, received: 0, used: 0, cancelled: 0, pending: 0, closedUnused: 0, remaining: 0 };
  dbAll_(SHEETS.RECEIPT_BOOKS).forEach(function (b) {
    const received = b.ReceivedDate || String(b.CreatedAt).slice(0, 10);
    if (received > range.to) return;
    const entries = (byBook[b.BookId] || []).filter(function (e) { return e.Status !== STATUS.RECEIPT_ENTRY.RELEASED; });
    const usage = bookUsage_(b, entries);
    const dateOf = function (e) { return e.ReceiptDate || String(e.CreatedAt).slice(0, 10); };
    const before = entries.filter(function (e) { return dateOf(e) < range.from; }).length;
    const inFy = entries.filter(function (e) { const d = dateOf(e); return d >= range.from && d <= range.to; });
    const closed = b.Status === STATUS.BOOK.CLOSED && b.ClosedDate;
    const closedBefore = closed && b.ClosedDate < range.from ? usage.closedUnused : 0;
    const closedInFy = closed && b.ClosedDate >= range.from && b.ClosedDate <= range.to ? usage.closedUnused : 0;
    const row = {
      bookId: b.BookId,
      bookNo: b.BookNo,
      startNo: b.StartNo,
      endNo: b.EndNo,
      receivedDate: received,
      status: b.Status,
      statusLabel: STATUS_LABELS.BOOK[b.Status] || b.Status,
      broughtForward: received < range.from ? usage.total - before - closedBefore : 0,
      received: received >= range.from ? usage.total : 0,
      used: inFy.filter(function (e) { return e.Status === STATUS.RECEIPT_ENTRY.USED; }).length,
      cancelled: inFy.filter(function (e) { return e.Status === STATUS.RECEIPT_ENTRY.CANCELLED; }).length,
      pending: inFy.filter(function (e) { return e.Status === STATUS.RECEIPT_ENTRY.CANCEL_PENDING; }).length,
      closedUnused: closedInFy,
      usedFrom: null,
      usedTo: null,
    };
    if (row.broughtForward + row.received === 0) return; // ใช้หมดหรือปิดก่อนปีนี้ ไม่เกี่ยวกับปีงบประมาณนี้
    inFy.forEach(function (e) {
      row.usedFrom = row.usedFrom === null ? e.ReceiptNo : Math.min(row.usedFrom, e.ReceiptNo);
      row.usedTo = row.usedTo === null ? e.ReceiptNo : Math.max(row.usedTo, e.ReceiptNo);
    });
    row.remaining = row.broughtForward + row.received - row.used - row.cancelled - row.pending - row.closedUnused;
    Object.keys(total).forEach(function (k) { total[k] += row[k]; });
    rows.push(row);
  });
  rows.sort(function (a, b) { return compareText_(a.receivedDate, b.receivedDate) || compareText_(a.bookNo, b.bookNo); });
  return {
    fiscalYear: fy,
    period: { from: range.from, to: range.to, label: 'ปีงบประมาณ ' + fy, rangeLabel: formatThaiDate_(range.from) + ' – ' + formatThaiDate_(range.to) },
    asOf: todayIso_() < range.to ? todayIso_() : range.to,
    rows: rows,
    total: total,
    meta: reportMeta_(ctx),
  };
}

// ---------------------------------------------------------------------------
// 1. เอกสารแจ้งยอดเรียกเก็บเงิน (D-21)
// ---------------------------------------------------------------------------

/**
 * reports.notices — หนังสือแจ้งยอดถึงผู้ปกครอง เฉพาะนักเรียนที่มียอดค้าง (รวมยอดค้างจากปีก่อน)
 * payload: { year, gradeLevel, room, studentId } (ไม่นับนักเรียนที่ย้ายออกแล้ว)
 */
function reportsNotices_(ctx, payload) {
  const year = isBlankInput_(payload.year) ? currentAcademicYear_() : requireAcademicYear_(payload.year);
  const gradeLevel = requireText_(payload.gradeLevel, 'ระดับชั้น', { optional: true, max: 50 });
  const room = requireText_(payload.room, 'ห้อง', { optional: true, max: 20 });
  const studentId = isBlankInput_(payload.studentId) ? '' : requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const lc = ledgerContext_();
  const levels = gradeLevels_();
  const students = studentsById_();
  const enrolls = dbFind_(SHEETS.ENROLLMENTS, function (e) {
    return e.AcademicYear === year && e.EnrollStatus !== STATUS.STUDENT.TRANSFERRED &&
      (!gradeLevel || e.GradeLevel === gradeLevel) && (!room || e.Room === room) && (!studentId || e.StudentId === studentId);
  });
  const wanted = Object.create(null);
  enrolls.forEach(function (e) { wanted[e.StudentId] = e; });
  const items = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) {
    if (!wanted[a.StudentId] || a.Status !== STATUS.ASSESSMENT.ACTIVE) return;
    const dto = assessmentDto_(a, lc);
    if (dto.outstandingSatang <= 0) return;
    (items[a.StudentId] || (items[a.StudentId] = [])).push(dto);
  });
  const notices = enrolls.filter(function (e) { return items[e.StudentId]; }).map(function (e) {
    const s = students[e.StudentId];
    const list = items[e.StudentId].sort(function (a, b) { return a.year - b.year || compareForStatement_(a, b); });
    return {
      studentId: e.StudentId,
      studentNo: s ? s.StudentNo : '',
      fullName: studentNameOf_(s),
      firstName: s ? s.FirstName : '',
      gradeLevel: e.GradeLevel,
      room: e.Room,
      classNo: e.ClassNo,
      classLabel: classLabel_(e.GradeLevel, e.Room),
      items: list.map(function (d) {
        return {
          label: d.label, year: d.year, dueDate: d.dueDate,
          netSatang: d.netSatang, paidSatang: d.paidSatang, outstandingSatang: d.outstandingSatang, overdue: d.overdue,
        };
      }),
      totalSatang: list.reduce(function (sum, d) { return sum + d.outstandingSatang; }, 0),
    };
  }).sort(compareStudentRows_(levels));
  if (notices.length > NOTICE_MAX_STUDENTS) {
    throw validationError_('มีนักเรียนที่ต้องแจ้งยอด ' + notices.length + ' คน มากเกินกว่าจะพิมพ์ครั้งเดียว กรุณาเลือกระดับชั้น');
  }
  notices.forEach(function (n) { n.totalText = bahtText_(n.totalSatang); });
  return {
    year: year,
    issueDate: todayIso_(),
    filter: { gradeLevel: gradeLevel, room: room, studentId: studentId },
    notices: notices,
    totalSatang: notices.reduce(function (sum, n) { return sum + n.totalSatang; }, 0),
    meta: reportMeta_(ctx),
  };
}
