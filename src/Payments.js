/**
 * ============================================================================
 *  Payments.gs — บันทึกการรับชำระเงิน (1 ครั้ง = ใบเสร็จจริง 1 ฉบับ)
 * ----------------------------------------------------------------------------
 *  ขั้นตอนฝั่ง Server (ทั้งหมดอยู่ภายใต้ lock เดียว):
 *   1. ต้องยืนยันว่าได้ตรวจใบเสร็จฉบับจริงแล้ว
 *   2. RequestKey ซ้ำ = คำขอเดิมที่ส่งซ้ำ ตอบผลเดิมโดยไม่บันทึกซ้ำ
 *   3. ตรวจเล่มที่กำลังใช้และเลขที่ (ไม่ซ้ำ อยู่ในช่วงของเล่ม เรียงลำดับตามการตั้งค่า)
 *   4. คำนวณยอดคงเหลือใหม่ แล้วตรวจว่ายอดตัดชำระรวมเท่ากับเงินที่รับ และไม่เกินยอดคงเหลือ
 *   5. บันทึกทะเบียนคุมเลขที่ → การรับเงิน → การตัดชำระ (ตรวจทุกเงื่อนไขก่อนเริ่มเขียน)
 *   6. ใช้ครบเล่มแล้ว เปลี่ยนสถานะเล่มเป็น "ใช้ครบเล่ม"
 *  ระบบไม่รับเงินเกินยอดค้าง และไม่มีเงินเครดิตล่วงหน้า (D-09)
 *  การยกเลิกใบเสร็จและการแก้ไขรายการที่บันทึกผิด อยู่ในระยะที่ 5
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
function validateAllocations_(list, studentId, amountSatang) {
  if (!Array.isArray(list) || !list.length) throw validationError_('กรุณาระบุรายการที่ตัดชำระ');
  if (list.length > PAYMENT_MAX_ALLOCATIONS) throw validationError_('ตัดชำระได้ไม่เกิน ' + PAYMENT_MAX_ALLOCATIONS + ' รายการต่อใบเสร็จ');
  const lc = ledgerContext_();
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

// ---------------------------------------------------------------------------
// API
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

  // ข้อมูลการรับเงิน
  const today = todayIso_();
  const paymentDate = requireIsoDate_(payload.paymentDate, 'วันที่รับเงิน');
  if (paymentDate > today) throw validationError_('วันที่รับเงินต้องไม่เป็นวันในอนาคต');
  const amountSatang = requireMoney_(payload.amount, 'จำนวนเงินที่รับ');
  const channel = requireText_(payload.channel, 'ช่องทางการรับเงิน', { max: 100 });
  if (paymentChannels_().indexOf(channel) === -1) throw validationError_('ช่องทางการรับเงินไม่อยู่ในรายการที่ตั้งค่าไว้');
  const channelRef = requireText_(payload.channelRef, 'เลขอ้างอิงการโอน', { optional: isCashChannel_(channel), max: 100 });
  const receivedByName = requireText_(payload.receivedByName, 'ชื่อผู้รับเงิน', { max: 100 });
  const note = requireText_(payload.note, 'หมายเหตุ', { optional: true, max: 300, multiline: true });

  // เล่มและเลขที่ใบเสร็จ
  const book = activeBook_();
  if (!book) {
    throw appError_(ERROR_CODES.CONFLICT, 'ยังไม่มีเล่มใบเสร็จที่กำลังใช้ กรุณาลงทะเบียนและเปิดใช้เล่มในหน้า "เล่มใบเสร็จ" ก่อน', { reason: 'BOOK_CHANGED' });
  }
  if (payload.bookId !== book.BookId) {
    throw appError_(ERROR_CODES.CONFLICT, 'เล่มใบเสร็จที่กำลังใช้เปลี่ยนเป็นเล่มที่ ' + book.BookNo + ' แล้ว กรุณาตรวจเลขเล่มและเลขที่อีกครั้ง', { reason: 'BOOK_CHANGED' });
  }
  const receiptNo = requireInt_(payload.receiptNo, 'เลขที่ใบเสร็จ', { min: 1, max: 99999999 });
  const usage = bookUsage_(book, dbFind_(SHEETS.RECEIPT_ENTRIES, function (e) { return e.BookId === book.BookId; }));
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
  const allocations = validateAllocations_(payload.allocations, studentId, amountSatang);

  // บันทึก: ทะเบียนคุมเลขที่ → การรับเงิน → การตัดชำระ
  const actor = actorFromCtx_(ctx);
  const where = 'เล่มที่ ' + book.BookNo + ' เลขที่ ' + receiptNo;
  const paymentId = dbReserveId_(SHEETS.PAYMENTS);
  const entry = dbInsert_(SHEETS.RECEIPT_ENTRIES, {
    BookId: book.BookId,
    BookNo: book.BookNo,
    ReceiptNo: receiptNo,
    Status: STATUS.RECEIPT_ENTRY.USED,
    PaymentId: paymentId,
    ReceiptDate: paymentDate,
    Amount: satangToBaht_(amountSatang),
    StudentId: studentId,
  }, actor, { note: 'ใช้ใบเสร็จ ' + where });
  const payment = dbInsert_(SHEETS.PAYMENTS, {
    PaymentId: paymentId,
    RequestKey: requestKey,
    StudentId: studentId,
    PaymentDate: paymentDate,
    Amount: satangToBaht_(amountSatang),
    Channel: channel,
    ChannelRef: channelRef,
    ReceiptBookId: book.BookId,
    ReceiptBookNo: book.BookNo,
    ReceiptNo: receiptNo,
    ReceiptEntryId: entry.EntryId,
    ReceivedByName: receivedByName,
    Note: note,
    Status: STATUS.PAYMENT.ACTIVE,
  }, actor, { note: 'รับเงิน ' + formatSatang_(amountSatang, true) + ' ใบเสร็จ' + where });
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

  if (usage.remaining <= 1) {
    dbUpdate_(SHEETS.RECEIPT_BOOKS, book.BookId, { Status: STATUS.BOOK.FULL, ClosedDate: today }, actor,
      { note: 'ใช้ครบเล่มที่ ' + book.BookNo });
  }
  return paymentResult_(payment);
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
  const labels = Object.create(null);
  dbAll_(SHEETS.FEE_ASSESSMENTS).forEach(function (a) { labels[a.AssessmentId] = assessmentLabel_(a, lc); });
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
      return a.receiptNo - b.receiptNo;
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
