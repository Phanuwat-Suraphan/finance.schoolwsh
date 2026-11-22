/**
 * ============================================================================
 *  Ledger.gs — คำนวณยอดเงินของรายการเรียกเก็บ และบัญชีการเงินของนักเรียน
 * ----------------------------------------------------------------------------
 *  ระบบไม่เก็บยอดคงเหลือหรือสถานะการชำระไว้ในชีต คำนวณใหม่จากข้อมูลจริงทุกครั้ง:
 *    ยอดเรียกเก็บสุทธิ = GrossAmount − ลดหย่อน/ยกเว้นที่มีผล
 *    ยอดชำระ         = การตัดชำระที่มีผล ของการรับเงินที่ยังมีผล
 *    ยอดคงเหลือ       = ยอดสุทธิ − ยอดชำระ
 *  คำนวณเป็นสตางค์ (จำนวนเต็ม) เสมอ และคำนวณใหม่ภายใต้ lock ก่อนบันทึกเงินทุกครั้ง
 * ============================================================================
 */

/** ลำดับภาคเรียนสำหรับการเรียง (ทั้งปีการศึกษามาก่อนภาคเรียนที่ 1) */
const TERM_ORDER_ = Object.freeze({ Y: 0, '1': 1, '2': 2 });

function satangOf_(baht) {
  return baht === null || baht === undefined || baht === '' ? 0 : toSatang_(baht);
}

/** อ่านข้อมูลที่ใช้คำนวณยอดครั้งเดียวต่อคำขอ */
function ledgerContext_() {
  const adjustments = dbAll_(SHEETS.FEE_ADJUSTMENTS);
  const adjustBy = Object.create(null);
  adjustments.forEach(function (a) {
    if (a.Status === STATUS.ADJUSTMENT.ACTIVE) adjustBy[a.AssessmentId] = (adjustBy[a.AssessmentId] || 0) + satangOf_(a.Amount);
  });
  const payments = Object.create(null);
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) { payments[p.PaymentId] = p; });
  const allocations = dbAll_(SHEETS.PAYMENT_ALLOCATIONS);
  const paidBy = Object.create(null);
  allocations.forEach(function (al) {
    const p = payments[al.PaymentId];
    if (al.Status !== STATUS.ALLOCATION.ACTIVE || !p || p.Status !== STATUS.PAYMENT.ACTIVE) return;
    paidBy[al.AssessmentId] = (paidBy[al.AssessmentId] || 0) + satangOf_(al.Amount);
  });
  const fees = Object.create(null);
  dbAll_(SHEETS.FEE_SETTINGS).forEach(function (f) { fees[f.FeeSettingId] = f; });
  return { adjustments: adjustments, adjustBy: adjustBy, payments: payments, allocations: allocations, paidBy: paidBy, fees: fees, today: todayIso_() };
}

/** ยอดเงินของรายการเรียกเก็บ 1 รายการ (สตางค์) */
function assessmentFigures_(asm, lc) {
  const gross = satangOf_(asm.GrossAmount);
  const adjust = lc.adjustBy[asm.AssessmentId] || 0;
  const paid = lc.paidBy[asm.AssessmentId] || 0;
  const cancelled = asm.Status === STATUS.ASSESSMENT.CANCELLED;
  const net = gross - adjust;
  return {
    grossSatang: gross,
    adjustSatang: adjust,
    netSatang: net,
    paidSatang: paid,
    outstandingSatang: cancelled ? 0 : net - paid,
    state: payStateOf_(cancelled, net, paid),
  };
}

function assessmentLabel_(asm, lc) {
  const fee = lc.fees[asm.FeeSettingId];
  return feeItemLabel_(fee ? fee.Description : '', asm.Term, asm.AcademicYear, asm.GradeLevel);
}

function assessmentDto_(asm, lc) {
  const f = assessmentFigures_(asm, lc);
  return {
    assessmentId: asm.AssessmentId,
    studentId: asm.StudentId,
    feeSettingId: asm.FeeSettingId,
    year: asm.AcademicYear,
    term: asm.Term,
    termLabel: termLabel_(asm.Term, asm.AcademicYear),
    gradeLevel: asm.GradeLevel,
    room: asm.Room,
    classLabel: classLabel_(asm.GradeLevel, asm.Room),
    label: assessmentLabel_(asm, lc),
    dueDate: asm.DueDate,
    status: asm.Status,
    grossSatang: f.grossSatang,
    adjustSatang: f.adjustSatang,
    netSatang: f.netSatang,
    paidSatang: f.paidSatang,
    outstandingSatang: f.outstandingSatang,
    state: f.state,
    stateLabel: STATUS_LABELS.PAY_STATE[f.state],
    overdue: f.outstandingSatang > 0 && !!asm.DueDate && asm.DueDate < lc.today,
    cancelReason: asm.CancelReason,
    cancelledAt: asm.CancelledAt,
    createdAt: asm.CreatedAt,
  };
}

/** เรียงสำหรับการตัดชำระ: ครบกำหนดก่อน → ปีการศึกษา → ภาคเรียน → วันที่สร้าง (หนี้เก่าก่อน ตามการตัดสินใจ D-08) */
function compareForPayment_(a, b) {
  const dueA = a.dueDate || '9999-12-31';
  const dueB = b.dueDate || '9999-12-31';
  if (dueA !== dueB) return dueA < dueB ? -1 : 1;
  if (a.year !== b.year) return a.year - b.year;
  const ta = TERM_ORDER_[a.term] === undefined ? 9 : TERM_ORDER_[a.term];
  const tb = TERM_ORDER_[b.term] === undefined ? 9 : TERM_ORDER_[b.term];
  if (ta !== tb) return ta - tb;
  return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0);
}

/** เรียงสำหรับแสดงในบัญชีนักเรียน: ปีล่าสุดก่อน แล้วตามภาคเรียน */
function compareForStatement_(a, b) {
  if (a.year !== b.year) return b.year - a.year;
  const ta = TERM_ORDER_[a.term] === undefined ? 9 : TERM_ORDER_[a.term];
  const tb = TERM_ORDER_[b.term] === undefined ? 9 : TERM_ORDER_[b.term];
  if (ta !== tb) return ta - tb;
  return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0);
}

/** ข้อมูลชั้นเรียนของปีการศึกษาล่าสุดที่มีข้อมูล ของนักเรียนทุกคน */
function latestEnrollments_() {
  const out = Object.create(null);
  dbAll_(SHEETS.ENROLLMENTS).forEach(function (e) {
    const cur = out[e.StudentId];
    if (!cur || e.AcademicYear > cur.AcademicYear) out[e.StudentId] = e;
  });
  return out;
}

/** ชื่อที่แสดงของผู้ใช้ตามชื่อผู้ใช้ (ใช้แสดงผู้บันทึก ผู้ขอ ผู้อนุมัติ) */
function userDisplayNames_() {
  const out = Object.create(null);
  dbAll_(SHEETS.USERS).forEach(function (u) { out[u.Username] = u.DisplayName || u.Username; });
  return out;
}

function displayNameOf_(username, names) {
  if (!username) return '';
  return names[username] || username;
}

function sumFigures_(dtos) {
  const t = { grossSatang: 0, adjustSatang: 0, netSatang: 0, paidSatang: 0, outstandingSatang: 0, overdueSatang: 0 };
  dtos.forEach(function (d) {
    if (d.status !== STATUS.ASSESSMENT.ACTIVE) return;
    t.grossSatang += d.grossSatang;
    t.adjustSatang += d.adjustSatang;
    t.netSatang += d.netSatang;
    t.paidSatang += d.paidSatang;
    t.outstandingSatang += d.outstandingSatang;
    if (d.overdue) t.overdueSatang += d.outstandingSatang;
  });
  return t;
}

function adjustmentDto_(a, labels, names) {
  return {
    adjustmentId: a.AdjustmentId,
    assessmentId: a.AssessmentId,
    studentId: a.StudentId,
    label: labels[a.AssessmentId] || '',
    type: a.Type,
    typeLabel: STATUS_LABELS.ADJUSTMENT_TYPE[a.Type] || a.Type,
    amountSatang: satangOf_(a.Amount),
    reason: a.Reason,
    referenceDoc: a.ReferenceDoc,
    status: a.Status,
    statusLabel: STATUS_LABELS.ADJUSTMENT[a.Status] || a.Status,
    requestedBy: displayNameOf_(a.RequestedBy, names),
    approvedBy: displayNameOf_(a.ApprovedBy, names),
    approvalRequestId: a.ApprovalRequestId,
    createdAt: a.CreatedAt,
    revokedAt: a.RevokedAt,
    revokedBy: displayNameOf_(a.RevokedBy, names),
    revokeReason: a.RevokeReason,
  };
}

function paymentDto_(p, lc, labels, names) {
  return {
    paymentId: p.PaymentId,
    studentId: p.StudentId,
    date: p.PaymentDate,
    amountSatang: satangOf_(p.Amount),
    channel: p.Channel,
    channelRef: p.ChannelRef,
    bookId: p.ReceiptBookId,
    bookNo: p.ReceiptBookNo,
    receiptNo: p.ReceiptNo,
    receivedByName: p.ReceivedByName,
    note: p.Note,
    status: p.Status,
    statusLabel: STATUS_LABELS.PAYMENT[p.Status] || p.Status,
    voidReason: p.VoidReason,
    voidedAt: p.VoidedAt,
    voidedBy: displayNameOf_(p.VoidedBy, names),
    replacesPaymentId: p.ReplacesPaymentId,
    replacedByPaymentId: p.ReplacedByPaymentId,
    entryId: p.ReceiptEntryId,
    createdBy: displayNameOf_(p.CreatedBy, names),
    createdAt: p.CreatedAt,
    allocations: lc.allocations
      .filter(function (al) { return al.PaymentId === p.PaymentId && al.Status === STATUS.ALLOCATION.ACTIVE; })
      .map(function (al) { return { assessmentId: al.AssessmentId, label: labels[al.AssessmentId] || '', amountSatang: satangOf_(al.Amount) }; }),
  };
}

/** เรียงการรับเงินล่าสุดก่อน: วันที่รับเงิน → เวลาที่บันทึก → เลขที่ใบเสร็จ */
function comparePaymentsDesc_(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return (b.receiptNo || 0) - (a.receiptNo || 0);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** ledger.students — นักเรียนทุกคนพร้อมยอดคงค้างรวม (ค้นหานักเรียนตอนรับเงิน) */
function ledgerStudents_(ctx, payload) {
  const lc = ledgerContext_();
  const totals = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (asm) {
    if (asm.Status !== STATUS.ASSESSMENT.ACTIVE) return;
    const f = assessmentFigures_(asm, lc);
    const t = totals[asm.StudentId] || (totals[asm.StudentId] = { outstanding: 0, overdue: 0, items: 0 });
    t.items += 1;
    t.outstanding += f.outstandingSatang;
    if (f.outstandingSatang > 0 && asm.DueDate && asm.DueDate < lc.today) t.overdue += f.outstandingSatang;
  });
  const latest = latestEnrollments_();
  const rows = dbAll_(SHEETS.STUDENTS).map(function (s) {
    const dto = studentDto_(s, latest[s.StudentId] || null);
    const t = totals[s.StudentId] || { outstanding: 0, overdue: 0, items: 0 };
    return {
      studentId: dto.studentId,
      studentNo: dto.studentNo,
      fullName: dto.fullName,
      firstName: dto.firstName,
      lastName: dto.lastName,
      status: dto.status,
      statusLabel: dto.statusLabel,
      year: dto.year,
      gradeLevel: dto.gradeLevel,
      room: dto.room,
      classLabel: dto.classLabel,
      classNo: dto.classNo,
      outstandingSatang: t.outstanding,
      overdueSatang: t.overdue,
      assessedItems: t.items,
    };
  }).sort(compareStudentRows_(gradeLevels_()));
  return { currentYear: currentAcademicYear_(), rows: rows };
}

/** ledger.student — บัญชีการเงินของนักเรียน 1 คน: รายการเรียกเก็บทุกปี ลดหย่อน การรับเงิน และคำขออนุมัติ */
function ledgerStudent_(ctx, payload) {
  const id = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const s = dbGet_(SHEETS.STUDENTS, id);
  if (!s) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const lc = ledgerContext_();
  const names = userDisplayNames_();
  const latest = latestEnrollments_()[id] || null;
  const assessments = dbFind_(SHEETS.FEE_ASSESSMENTS, function (a) { return a.StudentId === id; })
    .map(function (a) { return assessmentDto_(a, lc); })
    .sort(compareForStatement_);
  const labels = Object.create(null);
  assessments.forEach(function (a) { labels[a.assessmentId] = a.label; });
  const pendingByRef = pendingRequestsByRef_();
  assessments.forEach(function (a) { a.pendingRequest = pendingByRef[a.assessmentId] || null; });
  const payments = dbFind_(SHEETS.PAYMENTS, function (p) { return p.StudentId === id; })
    .map(function (p) {
      const dto = paymentDto_(p, lc, labels, names);
      dto.pendingRequest = pendingByRef[p.PaymentId] || null;
      return dto;
    })
    .sort(comparePaymentsDesc_);
  const adjustments = lc.adjustments
    .filter(function (a) { return a.StudentId === id; })
    .map(function (a) { return adjustmentDto_(a, labels, names); })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  const students = Object.create(null);
  students[id] = s;
  const requests = dbFind_(SHEETS.APPROVAL_REQUESTS, function (r) { return r.StudentId === id; })
    .map(function (r) { return approvalDto_(r, students, names); })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  return {
    student: studentDto_(s, latest),
    totals: sumFigures_(assessments),
    assessments: assessments,
    payments: payments,
    adjustments: adjustments,
    requests: requests,
    availableFees: ctx.role === ROLES.FINANCE ? availableFeesForStudent_(id, lc) : [],
  };
}
