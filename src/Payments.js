/**
 * ============================================================================
 *  Payments.gs — บันทึกการรับชำระเงิน (1 ครั้ง = ใบเสร็จจริง 1 ฉบับ)
 * ----------------------------------------------------------------------------
 *  บันทึกรับเงิน (ทั้งหมดอยู่ภายใต้ lock เดียว):
 *   1. ต้องยืนยันว่าได้ตรวจใบเสร็จฉบับจริงแล้ว
 *   2. RequestKey ซ้ำ = คำขอเดิมที่ส่งซ้ำ ตอบผลเดิมโดยไม่บันทึกซ้ำ
 *   3. ตรวจเล่มที่กำลังใช้และเลขที่ (ไม่ซ้ำ อยู่ในช่วงของเล่ม เรียงลำดับตามการตั้งค่า)
 *   4. คำนวณยอดคงเหลือใหม่ แล้วตรวจว่ายอดตัดชำระรวมเท่ากับเงินที่รับ และไม่เกินยอดคงเหลือ
 *   5. บันทึกทะเบียนคุมเลขที่ → การรับเงิน → การตัดชำระ (ตรวจทุกเงื่อนไขก่อนเริ่มเขียน)
 *   6. ใช้ครบเล่มแล้ว เปลี่ยนสถานะเล่มเป็น "ใช้ครบเล่ม"
 *  ระบบไม่รับเงินเกินยอดค้าง และไม่มีเงินเครดิตล่วงหน้า (D-09)
 *
 *  แก้ไขหลังบันทึก (ไม่มีการลบ ทุกขั้นมีประวัติ และรออนุมัติถ้าตั้งค่าไว้):
 *   - ยกเลิกใบเสร็จ: การรับเงินและการตัดชำระเป็น "ยกเลิก" ยอดค้างกลับมา เลขที่ใบเสร็จเป็น "ยกเลิก"
 *     ระหว่างรออนุมัติ การรับเงินเดิมยังมีผล
 *   - แก้ไขรายการบันทึกผิด (ใบเสร็จจริงถูกต้อง): รายการเดิมเป็น "ถูกแทนด้วยรายการแก้ไข"
 *     แล้วสร้างรายการใหม่ที่อ้างเลขใบเสร็จเดิม เลขที่นั้นไม่ถือว่ายกเลิก (D-14)
 * ============================================================================
 */

const PAYMENT_CONFIRM_TEXT = 'ข้าพเจ้าได้ตรวจสอบใบเสร็จรับเงินฉบับจริงแล้ว เลขเล่ม เลขที่ และจำนวนเงินตรงกับที่บันทึก';
const PAYMENT_MAX_ALLOCATIONS = 50;
const PAYMENT_LIST_MAX_DAYS = 92;

/** ช่องทางที่ไม่ใช่เงินสดต้องกรอกเลขอ้างอิง เช่น เลขรายการโอน (D-04) */
function isCashChannel_(channel) {
  return /เงินสด/.test(String(channel || ''));
}

function paymentChannels_() {
  const list = getSetting_('PAYMENT_CHANNELS');
  return list.length ? list : ['เงินสด'];
}

/** รายการที่ยังค้างชำระของนักเรียน เรียงหนี้เก่าก่อน */
function outstandingItems_(studentId, lc) {
  return dbFind_(SHEETS.FEE_ASSESSMENTS, function (a) {
    return a.StudentId === studentId && a.Status === STATUS.ASSESSMENT.ACTIVE;
  })
    .map(function (a) { return assessmentDto_(a, lc); })
    .filter(function (d) { return d.outstandingSatang > 0; })
    .sort(compareForPayment_);
}

function latestEnrollmentOf_(studentId) {
  let latest = null;
  dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.StudentId === studentId; }).forEach(function (e) {
    if (!latest || e.AcademicYear > latest.AcademicYear) latest = e;
  });
  return latest;
}

function daysBetween_(fromIso, toIso) {
  const a = fromIso.split('-').map(Number);
  const b = toIso.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

function requirePayment_(value) {
  const id = requireId_(value, 'PAY', 'รหัสการรับเงิน');
  const p = dbGet_(SHEETS.PAYMENTS, id);
  if (!p) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการรับเงินนี้');
  return p;
}

function requireActivePayment_(value) {
  const p = requirePayment_(value);
  if (p.Status !== STATUS.PAYMENT.ACTIVE) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการรับเงินนี้' + (STATUS_LABELS.PAYMENT[p.Status] || p.Status) + 'แล้ว');
  }
  return p;
}

/** ยอดคงเหลือแบบที่ยังไม่นับการรับเงินรายการหนึ่ง (ใช้ตอนแก้ไขรายการที่บันทึกผิด) */
function ledgerContextExcluding_(paymentId) {
  const lc = ledgerContext_();
  if (!paymentId) return lc;
  lc.allocations.forEach(function (al) {
    if (al.PaymentId !== paymentId || al.Status !== STATUS.ALLOCATION.ACTIVE) return;
    lc.paidBy[al.AssessmentId] = (lc.paidBy[al.AssessmentId] || 0) - satangOf_(al.Amount);
  });
  return lc;
}

function studentLabel_(studentId) {
  const s = dbGet_(SHEETS.STUDENTS, studentId);
  return s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) + ' (' + s.StudentNo + ')' : studentId;
}

/** ผลการรับเงินที่ส่งกลับไปหน้าเว็บ (ใช้ทั้งบันทึกใหม่และคำขอที่ส่งซ้ำ) */
function paymentResult_(payment) {
  const lc = ledgerContext_();
  const names = userDisplayNames_();
  const labels = Object.create(null);
  const affected = [];
  lc.allocations.forEach(function (al) {
    if (al.PaymentId !== payment.PaymentId || al.Status !== STATUS.ALLOCATION.ACTIVE) return;
    const asm = dbGet_(SHEETS.FEE_ASSESSMENTS, al.AssessmentId);
    if (!asm) return;
    const dto = assessmentDto_(asm, lc);
    labels[asm.AssessmentId] = dto.label;
    affected.push(dto);
  });
  const student = dbGet_(SHEETS.STUDENTS, payment.StudentId);
  const items = outstandingItems_(payment.StudentId, lc);
  const book = activeBookInfo_();
  const warnings = [];
  if (!book) warnings.push('ไม่มีเล่มใบเสร็จที่กำลังใช้ (เล่มเดิมใช้ครบแล้ว) กรุณาเปิดใช้เล่มใหม่ในหน้า "เล่มใบเสร็จ" ก่อนรับเงินครั้งถัดไป');
  else if (book.nextNo === null) warnings.push('เล่มที่ ' + book.bookNo + ' ไม่มีเลขที่ว่างแล้ว (เลขที่ที่เหลือรออนุมัติยกเลิก)');
  else if (book.low) warnings.push('เล่มที่ ' + book.bookNo + ' เหลือ ' + book.remaining + ' ฉบับ กรุณาเตรียมลงทะเบียนเล่มใหม่');
  return {
    duplicate: false,
    payment: paymentDto_(payment, lc, labels, names),
    student: student ? studentDto_(student, latestEnrollmentOf_(student.StudentId)) : null,
    assessments: affected,
    outstandingSatang: items.reduce(function (sum, d) { return sum + d.outstandingSatang; }, 0),
    book: book,
    warnings: warnings,
  };
}

/** ตรวจการตัดชำระกับยอดคงเหลือล่าสุด (ภายใต้ lock) คืนค่า [{ asm, satang }] */
function validateAllocations_(list, studentId, amountSatang, lcOverride) {
  if (!Array.isArray(list) || !list.length) throw validationError_('กรุณาระบุรายการที่ตัดชำระ');
  if (list.length > PAYMENT_MAX_ALLOCATIONS) throw validationError_('ตัดชำระได้ไม่เกิน ' + PAYMENT_MAX_ALLOCATIONS + ' รายการต่อใบเสร็จ');
  const lc = lcOverride || ledgerContext_();
  const seen = Object.create(null);
  const out = [];
  let total = 0;
  list.forEach(function (item) {
    const asmId = requireId_(item && item.assessmentId, 'ASM', 'รายการที่ตัดชำระ');
    if (seen[asmId]) throw validationError_('มีรายการตัดชำระซ้ำกัน');
    seen[asmId] = true;
    const asm = dbGet_(SHEETS.FEE_ASSESSMENTS, asmId);
    if (!asm || asm.StudentId !== studentId) throw validationError_('รายการที่ตัดชำระไม่ใช่ของนักเรียนคนนี้');
    const label = assessmentLabel_(asm, lc);
    if (asm.Status !== STATUS.ASSESSMENT.ACTIVE) {
      throw appError_(ERROR_CODES.CONFLICT, 'รายการ "' + label + '" ถูกยกเลิกแล้ว', { reason: 'BALANCE_CHANGED' });
    }
    const satang = requireMoney_(item.amount, 'ยอดตัดชำระของ ' + label);
    const fig = assessmentFigures_(asm, lc);
    if (satang > fig.outstandingSatang) {
      throw appError_(ERROR_CODES.CONFLICT, 'ยอดตัดชำระของ "' + label + '" เกินยอดคงเหลือ (คงเหลือ ' +
        formatSatang_(fig.outstandingSatang, true) + ') ระบบไม่รับเงินเกินยอดค้าง', { reason: 'BALANCE_CHANGED' });
    }
    total += satang;
    out.push({ asm: asm, satang: satang });
  });
  if (total !== amountSatang) {
    throw validationError_('ยอดตัดชำระรวม ' + formatSatang_(total, true) + ' ไม่เท่ากับจำนวนเงินที่รับ ' + formatSatang_(amountSatang, true));
  }
  return out;
}

/** ข้อมูลการรับเงินที่กรอก (ใช้ทั้งบันทึกใหม่และการแก้ไขรายการ) */
function validatePaymentFields_(payload) {
  const paymentDate = requireIsoDate_(payload.paymentDate, 'วันที่รับเงิน');
  if (paymentDate > todayIso_()) throw validationError_('วันที่รับเงินต้องไม่เป็นวันในอนาคต');
  const amountSatang = requireMoney_(payload.amount, 'จำนวนเงินที่รับ');
  const channel = requireText_(payload.channel, 'ช่องทางการรับเงิน', { max: 100 });
  if (paymentChannels_().indexOf(channel) === -1) throw validationError_('ช่องทางการรับเงินไม่อยู่ในรายการที่ตั้งค่าไว้');
  return {
    paymentDate: paymentDate,
    amountSatang: amountSatang,
    channel: channel,
    channelRef: requireText_(isCashChannel_(channel) ? '' : payload.channelRef, 'เลขอ้างอิงการโอน', { optional: isCashChannel_(channel), max: 100 }),
    receivedByName: requireText_(payload.receivedByName, 'ชื่อผู้รับเงิน', { max: 100 }),
    note: requireText_(payload.note, 'หมายเหตุ', { optional: true, max: 300, multiline: true }),
  };
}

/** ยกเลิกการรับเงินและการตัดชำระ (ยอดค้างกลับมา) — ใช้เมื่อยกเลิกใบเสร็จที่บันทึกรับเงินแล้ว */
function voidPaymentRecords_(paymentId, reason, requestId, actor) {
  const p = dbGet_(SHEETS.PAYMENTS, paymentId);
  if (!p) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการรับเงิน');
  if (p.Status !== STATUS.PAYMENT.ACTIVE) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการรับเงินนี้' + (STATUS_LABELS.PAYMENT[p.Status] || p.Status) + 'แล้ว');
  }
  const where = receiptWhere_(p.ReceiptBookNo, p.ReceiptNo);
  dbUpdate_(SHEETS.PAYMENTS, p.PaymentId, {
    Status: STATUS.PAYMENT.VOIDED,
    VoidReason: reason,
    VoidedAt: nowIso_(),
    VoidedBy: actor.username,
    ApprovalRequestId: requestId || '',
  }, actor, { action: AUDIT_ACTIONS.CANCEL, note: 'ยกเลิกใบเสร็จ ' + where });
  dbFind_(SHEETS.PAYMENT_ALLOCATIONS, function (al) {
    return al.PaymentId === p.PaymentId && al.Status === STATUS.ALLOCATION.ACTIVE;
  }).forEach(function (al) {
    dbUpdate_(SHEETS.PAYMENT_ALLOCATIONS, al.AllocationId, { Status: STATUS.ALLOCATION.VOIDED }, actor,
      { action: AUDIT_ACTIONS.CANCEL, note: 'ยกเลิกการตัดชำระจากใบเสร็จ ' + where });
  });
}

/** ข้อความเปรียบเทียบค่าเดิมกับค่าใหม่ของการแก้ไขรายการ (แสดงให้ผู้อนุมัติ) */
function correctionDisplay_(p, next, lcOld, lcNew) {
  const names = userDisplayNames_();
  const oldAlloc = paymentDto_(p, lcOld, allocationLabels_(lcOld), names).allocations
    .map(function (al) { return al.label + ' ' + formatSatang_(al.amountSatang); }).join(' / ');
  const newAlloc = next.allocations.map(function (al) {
    const asm = dbGet_(SHEETS.FEE_ASSESSMENTS, al.assessmentId);
    return (asm ? assessmentLabel_(asm, lcNew) : al.assessmentId) + ' ' + formatSatang_(al.amountSatang);
  }).join(' / ');
  const rows = [
    ['นักเรียน', studentLabel_(p.StudentId), studentLabel_(next.studentId)],
    ['วันที่รับเงิน', formatThaiDate_(p.PaymentDate), formatThaiDate_(next.paymentDate)],
    ['จำนวนเงิน', formatSatang_(satangOf_(p.Amount), true), formatSatang_(next.amountSatang, true)],
    ['ช่องทาง', p.Channel + (p.ChannelRef ? ' (' + p.ChannelRef + ')' : ''), next.channel + (next.channelRef ? ' (' + next.channelRef + ')' : '')],
    ['ผู้รับเงิน', p.ReceivedByName, next.receivedByName],
    ['หมายเหตุ', p.Note || '–', next.note || '–'],
    ['รายการที่ตัดชำระ', oldAlloc, newAlloc],
  ];
  return rows.map(function (r) { return { label: r[0], before: r[1], after: r[2], changed: r[1] !== r[2] }; });
}

function allocationLabels_(lc) {
  const labels = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) { labels[a.AssessmentId] = assessmentLabel_(a, lc); });
  return labels;
}

// ---------------------------------------------------------------------------
// API: รับเงิน
// ---------------------------------------------------------------------------

/** payments.context — ข้อมูลสำหรับหน้ารับเงิน: เล่มที่กำลังใช้ เลขที่ถัดไป และรายการค้างของนักเรียน (ถ้าระบุ) */
function paymentsContext_(ctx, payload) {
  const settings = receiptSettings_();
  const out = {
    book: activeBookInfo_(),
    strict: settings.strict,
    channels: paymentChannels_(),
    today: todayIso_(),
    receivedByName: ctx.displayName || ctx.username,
    confirmText: PAYMENT_CONFIRM_TEXT,
  };
  if (isBlankInput_(payload.studentId)) return out;
  const id = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const s = dbGet_(SHEETS.STUDENTS, id);
  if (!s) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const lc = ledgerContext_();
  const names = userDisplayNames_();
  out.student = studentDto_(s, latestEnrollmentOf_(id));
  out.items = outstandingItems_(id, lc);
  out.outstandingSatang = out.items.reduce(function (sum, d) { return sum + d.outstandingSatang; }, 0);
  const labels = Object.create(null);
  dbFind_(SHEETS.FEE_ASSESSMENTS, function (a) { return a.StudentId === id; })
    .forEach(function (a) { labels[a.AssessmentId] = assessmentLabel_(a, lc); });
  out.recentPayments = dbFind_(SHEETS.PAYMENTS, function (p) { return p.StudentId === id; })
    .map(function (p) { return paymentDto_(p, lc, labels, names); })
    .sort(comparePaymentsDesc_)
    .slice(0, 5);
  return out;
}

/** payments.create — บันทึกการรับเงินตามใบเสร็จจริง */
function paymentsCreate_(ctx, payload) {
  if (payload.confirmPhysicalReceipt !== true) {
    throw validationError_('กรุณาติ๊กยืนยันว่าได้ตรวจสอบใบเสร็จรับเงินฉบับจริงแล้ว');
  }
  const requestKey = requireText_(payload.requestKey, 'รหัสคำขอ', {
    max: 64, pattern: /^[A-Za-z0-9-]{16,64}$/, patternMessage: 'รหัสคำขอไม่ถูกต้อง กรุณาเปิดหน้ารับเงินใหม่',
  });
  const studentId = requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');

  // คำขอเดิมที่ส่งซ้ำ (กดบันทึกซ้ำ หรือเน็ตหลุดแล้วส่งใหม่): ตอบผลเดิม ไม่บันทึกซ้ำ
  const existing = dbFindOne_(SHEETS.PAYMENTS, function (p) { return p.RequestKey === requestKey; });
  if (existing) {
    if (existing.StudentId !== studentId) {
      throw appError_(ERROR_CODES.CONFLICT, 'รหัสคำขอนี้ถูกใช้กับนักเรียนคนอื่นแล้ว กรุณาเปิดหน้ารับเงินใหม่');
    }
    const again = paymentResult_(existing);
    again.duplicate = true;
    return again;
  }
  const student = dbGet_(SHEETS.STUDENTS, studentId);
  if (!student) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const f = validatePaymentFields_(payload);

  // เล่มและเลขที่ใบเสร็จ
  const book = activeBook_();
  if (!book) {
    throw appError_(ERROR_CODES.CONFLICT, 'ยังไม่มีเล่มใบเสร็จที่กำลังใช้ กรุณาลงทะเบียนและเปิดใช้เล่มในหน้า "เล่มใบเสร็จ" ก่อน', { reason: 'BOOK_CHANGED' });
  }
  if (payload.bookId !== book.BookId) {
    throw appError_(ERROR_CODES.CONFLICT, 'เล่มใบเสร็จที่กำลังใช้เปลี่ยนเป็นเล่มที่ ' + book.BookNo + ' แล้ว กรุณาตรวจเลขเล่มและเลขที่อีกครั้ง', { reason: 'BOOK_CHANGED' });
  }
  const receiptNo = requireInt_(payload.receiptNo, 'เลขที่ใบเสร็จ', { min: 1, max: 99999999 });
  const usage = bookUsage_(book, entriesOfBook_(book.BookId));
  if (receiptNo < book.StartNo || receiptNo > book.EndNo) {
    throw validationError_('เลขที่ ' + receiptNo + ' ไม่อยู่ในเล่มที่ ' + book.BookNo + ' (เลขที่ ' + book.StartNo + '–' + book.EndNo + ')');
  }
  if (usage.taken[receiptNo]) {
    throw appError_(ERROR_CODES.CONFLICT, 'เลขที่ใบเสร็จ ' + receiptNo + ' ของเล่มที่ ' + book.BookNo + ' ถูกบันทึกแล้ว ใช้ซ้ำไม่ได้' +
      (usage.nextNo !== null ? ' เลขที่ถัดไปคือ ' + usage.nextNo : ''), { reason: 'RECEIPT_NO_TAKEN' });
  }
  if (receiptNo !== usage.nextNo) {
    if (receiptSettings_().strict) {
      throw appError_(ERROR_CODES.CONFLICT, 'ต้องใช้เลขที่ถัดไปคือ ' + usage.nextNo + ' (ระบบตั้งค่าให้ใช้เลขที่เรียงลำดับ) ถ้าใบเสร็จเลขที่ ' +
        usage.nextNo + ' เขียนผิดหรือชำรุด ต้องบันทึกยกเลิกเลขที่นั้นก่อน', { reason: 'RECEIPT_STRICT' });
    }
    if (payload.confirmSkipNumber !== true) {
      throw appError_(ERROR_CODES.CONFLICT, 'เลขที่ ' + receiptNo + ' ไม่ใช่เลขที่ถัดไป (' + usage.nextNo +
        ') การข้ามเลขทำให้เกิดเลขที่ขาดช่วงที่ต้องอธิบายได้ ยืนยันหรือไม่', { reason: 'RECEIPT_GAP_CONFIRM' });
    }
  }

  // การตัดชำระ (คำนวณยอดคงเหลือใหม่ภายใต้ lock)
  const allocations = validateAllocations_(payload.allocations, studentId, f.amountSatang);

  // บันทึก: ทะเบียนคุมเลขที่ → การรับเงิน → การตัดชำระ
  const actor = actorFromCtx_(ctx);
  const where = receiptWhere_(book.BookNo, receiptNo);
  const paymentId = dbReserveId_(SHEETS.PAYMENTS);
  const entry = dbInsert_(SHEETS.RECEIPT_ENTRIES, {
    BookId: book.BookId,
    BookNo: book.BookNo,
    ReceiptNo: receiptNo,
    Status: STATUS.RECEIPT_ENTRY.USED,
    PaymentId: paymentId,
    ReceiptDate: f.paymentDate,
    Amount: satangToBaht_(f.amountSatang),
    StudentId: studentId,
  }, actor, { note: 'ใช้ใบเสร็จ ' + where });
  const payment = dbInsert_(SHEETS.PAYMENTS, {
    PaymentId: paymentId,
    RequestKey: requestKey,
    StudentId: studentId,
    PaymentDate: f.paymentDate,
    Amount: satangToBaht_(f.amountSatang),
    Channel: f.channel,
    ChannelRef: f.channelRef,
    ReceiptBookId: book.BookId,
    ReceiptBookNo: book.BookNo,
    ReceiptNo: receiptNo,
    ReceiptEntryId: entry.EntryId,
    ReceivedByName: f.receivedByName,
    Note: f.note,
    Status: STATUS.PAYMENT.ACTIVE,
  }, actor, { note: 'รับเงิน ' + formatSatang_(f.amountSatang, true) + ' ใบเสร็จ' + where });
  dbInsertMany_(SHEETS.PAYMENT_ALLOCATIONS, allocations.map(function (al) {
    return {
      PaymentId: paymentId,
      AssessmentId: al.asm.AssessmentId,
      StudentId: studentId,
      AcademicYear: al.asm.AcademicYear,
      Amount: satangToBaht_(al.satang),
      Status: STATUS.ALLOCATION.ACTIVE,
    };
  }), actor, { note: 'ตัดชำระจากใบเสร็จ' + where });

  refreshBookStatus_(book.BookId, actor);
  return paymentResult_(payment);
}

// ---------------------------------------------------------------------------
// API: รายละเอียด ยกเลิกใบเสร็จ และแก้ไขรายการที่บันทึกผิด
// ---------------------------------------------------------------------------

/**
 * payments.get — รายละเอียดการรับเงิน พร้อมข้อมูลสำหรับฟอร์มแก้ไข
 * payload.studentId (ไม่บังคับ) = นักเรียนที่จะย้ายการรับเงินไปให้ กรณีบันทึกผิดคน
 */
function paymentsGet_(ctx, payload) {
  const p = requirePayment_(payload.paymentId);
  const lc = ledgerContextExcluding_(p.Status === STATUS.PAYMENT.ACTIVE ? p.PaymentId : null);
  const names = userDisplayNames_();
  const labels = allocationLabels_(lc);
  const targetId = isBlankInput_(payload.studentId) ? p.StudentId : requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  const target = dbGet_(SHEETS.STUDENTS, targetId);
  if (!target) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const allocated = Object.create(null);
  lc.allocations.forEach(function (al) {
    if (al.PaymentId === p.PaymentId && al.Status === STATUS.ALLOCATION.ACTIVE) allocated[al.AssessmentId] = satangOf_(al.Amount);
  });
  // ยอดที่ตัดชำระได้ = ยอดคงเหลือแบบไม่นับการรับเงินรายการนี้
  const items = dbFind_(SHEETS.FEE_ASSESSMENTS, function (a) { return a.StudentId === targetId && a.Status === STATUS.ASSESSMENT.ACTIVE; })
    .map(function (a) {
      const dto = assessmentDto_(a, lc);
      dto.allocatedSatang = targetId === p.StudentId ? (allocated[a.AssessmentId] || 0) : 0;
      return dto;
    })
    .filter(function (d) { return d.outstandingSatang > 0 || d.allocatedSatang > 0; })
    .sort(compareForPayment_);
  const dto = paymentDto_(p, ledgerContext_(), labels, names);
  const pending = pendingRequestsByRef_()[p.PaymentId] || null;
  const related = dbFind_(SHEETS.PAYMENTS, function (x) {
    return x.PaymentId === p.ReplacesPaymentId || x.PaymentId === p.ReplacedByPaymentId;
  }).map(function (x) { return { paymentId: x.PaymentId, status: x.Status, statusLabel: STATUS_LABELS.PAYMENT[x.Status] || x.Status, amountSatang: satangOf_(x.Amount), date: x.PaymentDate }; });
  return {
    payment: dto,
    student: studentDto_(target, latestEnrollmentOf_(targetId)),
    originalStudent: studentDto_(dbGet_(SHEETS.STUDENTS, p.StudentId), latestEnrollmentOf_(p.StudentId)),
    items: items,
    channels: paymentChannels_(),
    today: todayIso_(),
    pendingRequest: pending,
    related: related,
    canRequest: ctx.role === ROLES.FINANCE && p.Status === STATUS.PAYMENT.ACTIVE && !pending,
  };
}

/** payments.requestVoid — ขอยกเลิกใบเสร็จที่บันทึกรับเงินแล้ว (ใบเสร็จเขียนผิดทั้งฉบับ) */
function paymentsRequestVoid_(ctx, payload) {
  const p = requireActivePayment_(payload.paymentId);
  const reason = requireText_(payload.reason, 'เหตุผลการยกเลิกใบเสร็จ', { max: 500, multiline: true });
  requireKeptOriginal_(payload);
  assertNoPendingRequest_(p.PaymentId);
  const entry = dbGet_(SHEETS.RECEIPT_ENTRIES, p.ReceiptEntryId);
  if (!entry || entry.Status !== STATUS.RECEIPT_ENTRY.USED) {
    throw appError_(ERROR_CODES.CONFLICT, 'สถานะของเลขที่ใบเสร็จนี้ไม่ใช่ "ใช้แล้ว" กรุณาตรวจสอบทะเบียนคุม');
  }
  const needApproval = approvalRequired_(STATUS.REQUEST_TYPE.RECEIPT_CANCEL);
  const actor = actorFromCtx_(ctx);
  const where = receiptWhere_(p.ReceiptBookNo, p.ReceiptNo);
  const summary = 'ยกเลิกใบเสร็จ ' + where + ' จำนวน ' + formatSatang_(satangOf_(p.Amount), true) + ': ' + studentLabel_(p.StudentId);
  const requestId = needApproval ? dbReserveId_(SHEETS.APPROVAL_REQUESTS) : '';
  if (needApproval) {
    dbUpdate_(SHEETS.RECEIPT_ENTRIES, entry.EntryId, { Status: STATUS.RECEIPT_ENTRY.CANCEL_PENDING }, actor,
      { action: AUDIT_ACTIONS.REQUEST, note: summary });
  }
  const cancel = dbInsert_(SHEETS.RECEIPT_CANCELLATIONS, {
    EntryId: entry.EntryId,
    BookId: entry.BookId,
    BookNo: entry.BookNo,
    ReceiptNo: entry.ReceiptNo,
    CancelType: STATUS.CANCEL_TYPE.VOID_PAYMENT,
    PaymentId: p.PaymentId,
    Amount: p.Amount,
    Reason: reason,
    Status: needApproval ? STATUS.DECISION.PENDING : STATUS.DECISION.APPROVED,
    DecisionNote: needApproval ? '' : 'ไม่ต้องอนุมัติตามการตั้งค่า',
    ApprovalRequestId: requestId,
  }, actor, { action: needApproval ? AUDIT_ACTIONS.REQUEST : AUDIT_ACTIONS.CANCEL, note: summary });
  if (needApproval) {
    createApprovalRequest_(STATUS.REQUEST_TYPE.RECEIPT_CANCEL, p.PaymentId, p.StudentId, summary, {
      cancellationId: cancel.CancellationId,
      entryId: entry.EntryId,
      paymentId: p.PaymentId,
      cancelType: STATUS.CANCEL_TYPE.VOID_PAYMENT,
      amountSatang: satangOf_(p.Amount),
    }, reason, actor, requestId);
    return { applied: false, requestId: requestId, message: 'ส่งคำขอยกเลิกใบเสร็จ ' + where + ' ให้ผู้อำนวยการพิจารณาแล้ว (ระหว่างรอ การรับเงินเดิมยังมีผล)' };
  }
  voidPaymentRecords_(p.PaymentId, reason, '', actor);
  dbUpdate_(SHEETS.RECEIPT_ENTRIES, entry.EntryId, { Status: STATUS.RECEIPT_ENTRY.CANCELLED }, actor,
    { action: AUDIT_ACTIONS.CANCEL, note: 'ยกเลิก' + where });
  return { applied: true, message: 'ยกเลิกใบเสร็จ ' + where + ' เรียบร้อยแล้ว ยอดค้างของนักเรียนกลับมาตามเดิม' };
}

/** ตรวจข้อมูลที่แก้ไข (ยอดคงเหลือคิดแบบไม่นับการรับเงินรายการเดิม) */
function validateCorrection_(p, payload) {
  const studentId = isBlankInput_(payload.studentId) ? p.StudentId : requireId_(payload.studentId, 'STU', 'รหัสนักเรียน');
  if (!dbGet_(SHEETS.STUDENTS, studentId)) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลนักเรียน');
  const f = validatePaymentFields_(payload);
  const lc = ledgerContextExcluding_(p.PaymentId);
  const allocations = validateAllocations_(payload.allocations, studentId, f.amountSatang, lc);
  return {
    paymentId: p.PaymentId,
    studentId: studentId,
    paymentDate: f.paymentDate,
    amountSatang: f.amountSatang,
    channel: f.channel,
    channelRef: f.channelRef,
    receivedByName: f.receivedByName,
    note: f.note,
    allocations: allocations.map(function (al) { return { assessmentId: al.asm.AssessmentId, amountSatang: al.satang }; }),
  };
}

/** payments.requestCorrection — ขอแก้ไขรายการรับเงินที่บันทึกผิด (ใบเสร็จจริงถูกต้อง เลขที่ใบเสร็จไม่เปลี่ยน) */
function paymentsRequestCorrection_(ctx, payload) {
  const p = requireActivePayment_(payload.paymentId);
  const reason = requireText_(payload.reason, 'เหตุผลการแก้ไข', { max: 500, multiline: true });
  assertNoPendingRequest_(p.PaymentId);
  const next = validateCorrection_(p, payload);
  const display = correctionDisplay_(p, next, ledgerContext_(), ledgerContextExcluding_(p.PaymentId));
  if (!display.some(function (d) { return d.changed; })) throw validationError_('ข้อมูลที่แก้ไขเหมือนรายการเดิมทุกช่อง');
  next.display = display;
  const actor = actorFromCtx_(ctx);
  const where = receiptWhere_(p.ReceiptBookNo, p.ReceiptNo);
  const summary = 'แก้ไขรายการรับเงินที่บันทึกผิด ใบเสร็จ' + where + ': ' + studentLabel_(p.StudentId) +
    ' (' + display.filter(function (d) { return d.changed; }).map(function (d) { return d.label; }).join(', ') + ')';
  if (approvalRequired_(STATUS.REQUEST_TYPE.PAYMENT_CORRECTION)) {
    const req = createApprovalRequest_(STATUS.REQUEST_TYPE.PAYMENT_CORRECTION, p.PaymentId, p.StudentId, summary, next, reason, actor);
    return { applied: false, requestId: req.RequestId, message: 'ส่งคำขอแก้ไขรายการใบเสร็จ' + where + ' ให้ผู้อำนวยการพิจารณาแล้ว (ระหว่างรอ รายการเดิมยังมีผล)' };
  }
  const result = applyPaymentCorrection_(next, reason, '', actor);
  return { applied: true, paymentId: result.PaymentId, message: 'แก้ไขรายการใบเสร็จ' + where + ' เรียบร้อยแล้ว' };
}

/** ทำการแก้ไข: รายการเดิม → ถูกแทน, สร้างรายการใหม่ที่อ้างเลขใบเสร็จเดิม และปรับทะเบียนคุมให้ชี้รายการใหม่ */
function applyPaymentCorrection_(data, reason, requestId, actor) {
  const old = dbGet_(SHEETS.PAYMENTS, data.paymentId);
  if (!old) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการรับเงินเดิม');
  if (requestId && old.Status === STATUS.PAYMENT.REPLACED && old.ApprovalRequestId === requestId) {
    return dbGet_(SHEETS.PAYMENTS, old.ReplacedByPaymentId);
  }
  if (old.Status !== STATUS.PAYMENT.ACTIVE) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการรับเงินเดิม' + (STATUS_LABELS.PAYMENT[old.Status] || old.Status) + 'แล้ว จึงแก้ไขไม่ได้');
  }
  const entry = dbGet_(SHEETS.RECEIPT_ENTRIES, old.ReceiptEntryId);
  if (!entry || entry.Status !== STATUS.RECEIPT_ENTRY.USED || entry.PaymentId !== old.PaymentId) {
    throw appError_(ERROR_CODES.CONFLICT, 'สถานะของเลขที่ใบเสร็จนี้เปลี่ยนไปแล้ว กรุณาตรวจสอบทะเบียนคุม');
  }
  // ตรวจยอดคงเหลือใหม่ภายใต้ lock (ยอดอาจเปลี่ยนไประหว่างรออนุมัติ)
  const lc = ledgerContextExcluding_(old.PaymentId);
  const allocations = validateAllocations_(data.allocations.map(function (al) {
    return { assessmentId: al.assessmentId, amount: formatSatang_(al.amountSatang) };
  }), data.studentId, data.amountSatang, lc);
  const where = receiptWhere_(old.ReceiptBookNo, old.ReceiptNo);
  const newId = dbReserveId_(SHEETS.PAYMENTS);
  dbUpdate_(SHEETS.PAYMENTS, old.PaymentId, {
    Status: STATUS.PAYMENT.REPLACED,
    VoidReason: reason,
    VoidedAt: nowIso_(),
    VoidedBy: actor.username,
    ReplacedByPaymentId: newId,
    ApprovalRequestId: requestId || '',
  }, actor, { note: 'แก้ไขรายการบันทึกผิด ใบเสร็จ' + where + ' (รายการเดิม)' });
  dbFind_(SHEETS.PAYMENT_ALLOCATIONS, function (al) {
    return al.PaymentId === old.PaymentId && al.Status === STATUS.ALLOCATION.ACTIVE;
  }).forEach(function (al) {
    dbUpdate_(SHEETS.PAYMENT_ALLOCATIONS, al.AllocationId, { Status: STATUS.ALLOCATION.VOIDED }, actor,
      { note: 'แก้ไขรายการบันทึกผิด ใบเสร็จ' + where + ' (การตัดชำระเดิม)' });
  });
  const created = dbInsert_(SHEETS.PAYMENTS, {
    PaymentId: newId,
    RequestKey: 'CORR-' + (requestId || newId),
    StudentId: data.studentId,
    PaymentDate: data.paymentDate,
    Amount: satangToBaht_(data.amountSatang),
    Channel: data.channel,
    ChannelRef: data.channelRef,
    ReceiptBookId: old.ReceiptBookId,
    ReceiptBookNo: old.ReceiptBookNo,
    ReceiptNo: old.ReceiptNo,
    ReceiptEntryId: old.ReceiptEntryId,
    ReceivedByName: data.receivedByName,
    Note: data.note,
    Status: STATUS.PAYMENT.ACTIVE,
    ReplacesPaymentId: old.PaymentId,
    ApprovalRequestId: requestId || '',
  }, actor, { note: 'แก้ไขรายการบันทึกผิด ใบเสร็จ' + where + ' (รายการใหม่)' });
  dbInsertMany_(SHEETS.PAYMENT_ALLOCATIONS, allocations.map(function (al) {
    return {
      PaymentId: newId,
      AssessmentId: al.asm.AssessmentId,
      StudentId: data.studentId,
      AcademicYear: al.asm.AcademicYear,
      Amount: satangToBaht_(al.satang),
      Status: STATUS.ALLOCATION.ACTIVE,
    };
  }), actor, { note: 'แก้ไขรายการบันทึกผิด ใบเสร็จ' + where + ' (การตัดชำระใหม่)' });
  dbUpdate_(SHEETS.RECEIPT_ENTRIES, entry.EntryId, {
    PaymentId: newId,
    ReceiptDate: data.paymentDate,
    Amount: satangToBaht_(data.amountSatang),
    StudentId: data.studentId,
  }, actor, { note: 'แก้ไขรายการบันทึกผิด ใบเสร็จ' + where });
  return created;
}

/** payments.list — รายการรับเงินตามช่วงวันที่ (ไม่เกิน 92 วัน) เรียงตามวันที่และเลขที่ใบเสร็จ */
function paymentsList_(ctx, payload) {
  const today = todayIso_();
  const fromDate = requireIsoDate_(isBlankInput_(payload.fromDate) ? today : payload.fromDate, 'วันที่เริ่มต้น');
  const toDate = requireIsoDate_(isBlankInput_(payload.toDate) ? fromDate : payload.toDate, 'วันที่สิ้นสุด');
  if (toDate < fromDate) throw validationError_('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น');
  if (daysBetween_(fromDate, toDate) >= PAYMENT_LIST_MAX_DAYS) {
    throw validationError_('ดูรายการได้ครั้งละไม่เกิน ' + PAYMENT_LIST_MAX_DAYS + ' วัน');
  }
  const lc = ledgerContext_();
  const names = userDisplayNames_();
  const labels = allocationLabels_(lc);
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const rows = dbFind_(SHEETS.PAYMENTS, function (p) { return p.PaymentDate >= fromDate && p.PaymentDate <= toDate; })
    .map(function (p) {
      const dto = paymentDto_(p, lc, labels, names);
      const s = students[p.StudentId];
      dto.studentNo = s ? s.StudentNo : '';
      dto.studentName = s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) : '';
      return dto;
    })
    .sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.bookNo !== b.bookNo) return compareText_(a.bookNo, b.bookNo);
      if (a.receiptNo !== b.receiptNo) return a.receiptNo - b.receiptNo;
      return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0);
    });
  const byChannel = Object.create(null);
  let totalSatang = 0;
  let activeCount = 0;
  rows.forEach(function (r) {
    if (r.status !== STATUS.PAYMENT.ACTIVE) return;
    activeCount += 1;
    totalSatang += r.amountSatang;
    byChannel[r.channel] = (byChannel[r.channel] || 0) + r.amountSatang;
  });
  return {
    fromDate: fromDate,
    toDate: toDate,
    rows: rows,
    totals: {
      count: activeCount,
      totalSatang: totalSatang,
      byChannel: Object.keys(byChannel).map(function (k) { return { channel: k, totalSatang: byChannel[k] }; }),
    },
  };
}
