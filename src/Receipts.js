/**
 * ============================================================================
 *  Receipts.gs — ทะเบียนคุมเล่มและเลขที่ใบเสร็จรับเงิน
 * ----------------------------------------------------------------------------
 *  ระบบไม่ออกเลขใบเสร็จเอง: ใช้เฉพาะเลขที่ในช่วงของเล่มจริงที่ลงทะเบียนไว้
 *  - ลงทะเบียนเล่ม (เลขเล่มไม่ซ้ำ) → เปิดใช้ได้ครั้งละ 1 เล่ม
 *  - เลขที่ถัดไป = เลขต่ำสุดในช่วงของเล่มที่ยังไม่มีในทะเบียนคุม (ReceiptEntries)
 *  - เล่ม + เลขที่ ไม่ซ้ำ ตรวจภายใต้ lock ทุกครั้ง
 *  - ยกเลิกเลขที่ที่เขียนผิดหรือชำรุด (ยังไม่บันทึกรับเงิน) ต้องมีเหตุผล ยืนยันว่าเก็บฉบับจริงไว้
 *    และรอผู้อำนวยการอนุมัติถ้าตั้งค่าไว้ ระหว่างรอ เลขที่นั้นถูกกันไว้ (ไม่ถูกเสนอเป็นเลขถัดไป)
 *    ไม่อนุมัติหรือถอนคำขอ = คืนเลขที่ (แถวเดิมเก็บไว้เป็นประวัติ)
 *  - เล่มเปลี่ยนเป็น "ใช้ครบเล่ม" เมื่อทุกเลขที่ใช้แล้วหรือยกเลิกแล้ว และไม่มีคำขอยกเลิกค้าง
 *  - ปิดเล่มก่อนใช้ครบ ต้องมีเหตุผลและอนุมัติ เลขที่ที่เหลือเป็น "ไม่ได้ใช้ (ปิดเล่ม)" ใช้ต่อไม่ได้
 *  - เลขที่ขาดช่วง = เลขที่ยังไม่ใช้ แต่ต่ำกว่าเลขที่สูงสุดที่ใช้หรือยกเลิกแล้ว (เตือนจนกว่าจะบันทึกหรือยกเลิก)
 * ============================================================================
 */

const RECEIPT_BOOK_MAX_NUMBERS = 1000;

const BOOK_STATUS_ORDER_ = Object.freeze({ ACTIVE: 0, REGISTERED: 1, FULL: 2, CLOSED: 3 });

/** สถานะของเลขที่แต่ละใบในตารางเลขที่ */
const NUMBER_STATUS_LABELS = Object.freeze({
  UNUSED: 'ยังไม่ใช้',
  GAP: 'ขาดช่วง',
  USED: 'ใช้แล้ว',
  CANCEL_PENDING: 'รออนุมัติยกเลิก',
  CANCELLED: 'ยกเลิก',
  CLOSED_UNUSED: 'ไม่ได้ใช้ (ปิดเล่ม)',
});

const KEEP_ORIGINAL_MESSAGE = 'กรุณายืนยันว่าเก็บใบเสร็จฉบับที่ยกเลิกไว้ครบทุกส่วนแล้ว (ห้ามฉีกทิ้ง)';

function receiptSettings_() {
  return {
    lowWarning: getSetting_('RECEIPT_LOW_WARNING'),
    strict: getSetting_('RECEIPT_STRICT_SEQUENCE'),
  };
}

function receiptEntriesByBook_() {
  const out = Object.create(null);
  dbAll_(SHEETS.RECEIPT_ENTRIES).forEach(function (e) {
    (out[e.BookId] || (out[e.BookId] = [])).push(e);
  });
  return out;
}

function entriesOfBook_(bookId) {
  return dbFind_(SHEETS.RECEIPT_ENTRIES, function (e) { return e.BookId === bookId; });
}

/**
 * การใช้เลขที่ของเล่ม: ใช้แล้ว ยกเลิก รออนุมัติยกเลิก คงเหลือ เลขที่ถัดไป และเลขที่ขาดช่วง
 * แถวที่คืนเลขที่แล้ว (RELEASED) ไม่นับ / เล่มที่ปิดแล้ว เลขที่ที่เหลือเป็น "ไม่ได้ใช้ (ปิดเล่ม)"
 */
function bookUsage_(book, entries) {
  const taken = Object.create(null);
  const byNo = Object.create(null);
  let used = 0;
  let cancelled = 0;
  let pending = 0;
  let maxTaken = null;
  (entries || []).forEach(function (e) {
    if (e.Status === STATUS.RECEIPT_ENTRY.RELEASED) return;
    taken[e.ReceiptNo] = true;
    byNo[e.ReceiptNo] = e;
    if (e.Status === STATUS.RECEIPT_ENTRY.USED) used += 1;
    else if (e.Status === STATUS.RECEIPT_ENTRY.CANCELLED) cancelled += 1;
    else if (e.Status === STATUS.RECEIPT_ENTRY.CANCEL_PENDING) pending += 1;
    if (maxTaken === null || e.ReceiptNo > maxTaken) maxTaken = e.ReceiptNo;
  });
  const closed = book.Status === STATUS.BOOK.CLOSED;
  let nextNo = null;
  let remaining = 0;
  const gaps = [];
  for (let n = book.StartNo; n <= book.EndNo; n++) {
    if (taken[n]) continue;
    remaining += 1;
    if (closed) continue;
    if (nextNo === null) nextNo = n;
    if (maxTaken !== null && n < maxTaken) gaps.push(n);
  }
  return {
    total: book.EndNo - book.StartNo + 1,
    usedCount: used,
    cancelledCount: cancelled,
    pendingCount: pending,
    remaining: closed ? 0 : remaining,
    closedUnused: closed ? remaining : 0,
    nextNo: closed ? null : nextNo,
    maxTaken: maxTaken,
    gaps: gaps,
    taken: taken,
    byNo: byNo,
  };
}

function bookDto_(b, usage, settings) {
  return {
    bookId: b.BookId,
    bookNo: b.BookNo,
    startNo: b.StartNo,
    endNo: b.EndNo,
    receivedDate: b.ReceivedDate,
    startUseDate: b.StartUseDate,
    closedDate: b.ClosedDate,
    closeReason: b.CloseReason,
    responsibleName: b.ResponsibleName,
    status: b.Status,
    statusLabel: STATUS_LABELS.BOOK[b.Status] || b.Status,
    note: b.Note,
    total: usage.total,
    usedCount: usage.usedCount,
    cancelledCount: usage.cancelledCount,
    pendingCount: usage.pendingCount,
    remaining: usage.remaining,
    closedUnused: usage.closedUnused,
    nextNo: b.Status === STATUS.BOOK.ACTIVE ? usage.nextNo : null,
    gaps: b.Status === STATUS.BOOK.ACTIVE ? usage.gaps : [],
    low: b.Status === STATUS.BOOK.ACTIVE && usage.remaining <= settings.lowWarning,
    createdAt: b.CreatedAt,
  };
}

function activeBooks_() {
  return dbFind_(SHEETS.RECEIPT_BOOKS, function (b) { return b.Status === STATUS.BOOK.ACTIVE; });
}

/** เล่มที่กำลังใช้ (null = ยังไม่มี) */
function activeBook_() {
  const books = activeBooks_();
  if (books.length > 1) {
    throw appError_(ERROR_CODES.INTERNAL,
      'พบเล่มใบเสร็จที่กำลังใช้มากกว่า 1 เล่ม อาจมีการแก้ไขชีตโดยตรง กรุณาให้ผู้ดูแลระบบตรวจสอบชีต ReceiptBooks');
  }
  return books.length ? books[0] : null;
}

/** ข้อมูลเล่มที่กำลังใช้และเลขที่ถัดไป สำหรับหน้ารับเงิน */
function activeBookInfo_() {
  const b = activeBook_();
  if (!b) return null;
  const dto = bookDto_(b, bookUsage_(b, entriesOfBook_(b.BookId)), receiptSettings_());
  const pending = pendingRequestsByRef_()[b.BookId];
  dto.pendingClose = pending && pending.type === STATUS.REQUEST_TYPE.BOOK_CLOSE ? pending : null;
  return dto;
}

function requireBook_(value) {
  const id = requireId_(value, 'BOOK', 'รหัสเล่มใบเสร็จ');
  const b = dbGet_(SHEETS.RECEIPT_BOOKS, id);
  if (!b) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบเล่มใบเสร็จนี้');
  return b;
}

/** เปลี่ยนเล่มเป็น "ใช้ครบเล่ม" เมื่อทุกเลขที่ใช้แล้วหรือยกเลิกแล้ว และไม่มีคำขอยกเลิกที่รออนุมัติ */
function refreshBookStatus_(bookId, actor) {
  const b = dbGet_(SHEETS.RECEIPT_BOOKS, bookId);
  if (!b || b.Status !== STATUS.BOOK.ACTIVE) return b;
  const usage = bookUsage_(b, entriesOfBook_(bookId));
  if (usage.remaining === 0 && usage.pendingCount === 0) {
    return dbUpdate_(SHEETS.RECEIPT_BOOKS, bookId, { Status: STATUS.BOOK.FULL, ClosedDate: todayIso_() }, actor,
      { note: 'ใช้ครบเล่มที่ ' + b.BookNo }).after;
  }
  return b;
}

function receiptWhere_(bookNo, receiptNo) {
  return 'เล่มที่ ' + bookNo + ' เลขที่ ' + receiptNo;
}

function validateBookInput_(payload) {
  const bookNo = requireText_(payload.bookNo, 'เลขเล่ม', { max: 30 }).replace(/\s+/g, ' ');
  const startNo = requireInt_(payload.startNo, 'เลขที่เริ่มต้น', { min: 1, max: 99999999 });
  const endNo = requireInt_(payload.endNo, 'เลขที่สิ้นสุด', { min: 1, max: 99999999 });
  if (endNo < startNo) throw validationError_('เลขที่สิ้นสุดต้องไม่น้อยกว่าเลขที่เริ่มต้น');
  if (endNo - startNo + 1 > RECEIPT_BOOK_MAX_NUMBERS) {
    throw validationError_('เล่มหนึ่งมีได้ไม่เกิน ' + RECEIPT_BOOK_MAX_NUMBERS + ' เลขที่ กรุณาตรวจเลขที่เริ่มต้นและสิ้นสุดอีกครั้ง');
  }
  const receivedDate = requireIsoDate_(payload.receivedDate, 'วันที่ได้รับเล่ม', { optional: true });
  if (receivedDate && receivedDate > todayIso_()) throw validationError_('วันที่ได้รับเล่มต้องไม่เป็นวันในอนาคต');
  return {
    bookNo: bookNo,
    startNo: startNo,
    endNo: endNo,
    receivedDate: receivedDate,
    note: requireText_(payload.note, 'หมายเหตุ', { optional: true, max: 300 }),
  };
}

function requireKeptOriginal_(payload) {
  if (payload.confirmKept !== true) throw validationError_(KEEP_ORIGINAL_MESSAGE);
}

// ---------------------------------------------------------------------------
// API: ทะเบียนเล่ม
// ---------------------------------------------------------------------------

/** receipts.books — ทะเบียนเล่มใบเสร็จทั้งหมด พร้อมการใช้เลขที่ */
function receiptsBooks_(ctx, payload) {
  const byBook = receiptEntriesByBook_();
  const settings = receiptSettings_();
  const pending = pendingRequestsByRef_();
  const books = dbAll_(SHEETS.RECEIPT_BOOKS)
    .map(function (b) {
      const dto = bookDto_(b, bookUsage_(b, byBook[b.BookId]), settings);
      dto.pendingRequest = pending[b.BookId] || null;
      return dto;
    })
    .sort(function (a, b) {
      const sa = BOOK_STATUS_ORDER_[a.status] === undefined ? 9 : BOOK_STATUS_ORDER_[a.status];
      const sb = BOOK_STATUS_ORDER_[b.status] === undefined ? 9 : BOOK_STATUS_ORDER_[b.status];
      if (sa !== sb) return sa - sb;
      return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0);
    });
  return {
    books: books,
    hasActive: books.some(function (b) { return b.status === STATUS.BOOK.ACTIVE; }),
    lowWarning: settings.lowWarning,
    strict: settings.strict,
    canManage: ctx.role === ROLES.FINANCE,
  };
}

/** receipts.book — รายละเอียดเล่ม และตารางเลขที่ทุกใบพร้อมสถานะ */
function receiptsBook_(ctx, payload) {
  const b = requireBook_(payload.bookId);
  const entries = entriesOfBook_(b.BookId);
  const usage = bookUsage_(b, entries);
  const settings = receiptSettings_();
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const payments = Object.create(null);
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) { if (p.ReceiptBookId === b.BookId) payments[p.PaymentId] = p; });
  const cancelByEntry = Object.create(null);
  dbFind_(SHEETS.RECEIPT_CANCELLATIONS, function (c) { return c.BookId === b.BookId; }).forEach(function (c) {
    const cur = cancelByEntry[c.EntryId];
    if (!cur || c.CreatedAt >= cur.CreatedAt) cancelByEntry[c.EntryId] = c;
  });
  const gapSet = Object.create(null);
  usage.gaps.forEach(function (n) { gapSet[n] = true; });
  const pending = pendingRequestsByRef_();
  const numbers = [];
  for (let n = b.StartNo; n <= b.EndNo; n++) {
    const e = usage.byNo[n];
    let status;
    if (e) status = e.Status;
    else if (b.Status === STATUS.BOOK.CLOSED) status = 'CLOSED_UNUSED';
    else status = gapSet[n] ? 'GAP' : 'UNUSED';
    const item = { no: n, status: status, statusLabel: NUMBER_STATUS_LABELS[status] || status };
    if (e) {
      const p = e.PaymentId ? payments[e.PaymentId] : null;
      const s = students[e.StudentId];
      const c = cancelByEntry[e.EntryId];
      item.entryId = e.EntryId;
      item.paymentId = e.PaymentId;
      item.date = e.ReceiptDate;
      item.amountSatang = e.Amount === null ? null : satangOf_(e.Amount);
      item.studentId = e.StudentId;
      item.studentName = s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) : '';
      item.studentNo = s ? s.StudentNo : '';
      item.paymentStatus = p ? p.Status : '';
      item.corrected = !!(p && p.ReplacesPaymentId);
      item.cancelType = c ? c.CancelType : '';
      item.cancelTypeLabel = c ? (STATUS_LABELS.CANCEL_TYPE[c.CancelType] || c.CancelType) : '';
      item.cancelReason = c ? c.Reason : '';
      item.cancelStatus = c ? c.Status : '';
      item.cancelledBy = c ? c.CreatedBy : '';
      item.decidedBy = c ? c.DecidedBy : '';
      item.pendingRequest = pending[e.EntryId] || (e.PaymentId ? pending[e.PaymentId] : null) || null;
    }
    numbers.push(item);
  }
  const dto = bookDto_(b, usage, settings);
  dto.pendingRequest = pending[b.BookId] || null;
  return {
    book: dto,
    numbers: numbers,
    strict: settings.strict,
    canManage: ctx.role === ROLES.FINANCE,
  };
}

/** receipts.registerBook — ลงทะเบียนเล่มใบเสร็จที่ได้รับ */
function receiptsRegisterBook_(ctx, payload) {
  const v = validateBookInput_(payload);
  const rec = dbInsert_(SHEETS.RECEIPT_BOOKS, {
    BookNo: v.bookNo,
    StartNo: v.startNo,
    EndNo: v.endNo,
    ReceivedDate: v.receivedDate,
    Status: STATUS.BOOK.REGISTERED,
    Note: v.note,
  }, actorFromCtx_(ctx), { note: 'ลงทะเบียนเล่มใบเสร็จ เล่มที่ ' + v.bookNo + ' เลขที่ ' + v.startNo + '–' + v.endNo });
  return bookDto_(rec, bookUsage_(rec, []), receiptSettings_());
}

/** receipts.updateBook — แก้ไขข้อมูลเล่มที่ยังไม่เริ่มใช้ (กรณีลงทะเบียนผิด) */
function receiptsUpdateBook_(ctx, payload) {
  const b = requireBook_(payload.bookId);
  if (b.Status !== STATUS.BOOK.REGISTERED) throw appError_(ERROR_CODES.CONFLICT, 'แก้ไขได้เฉพาะเล่มที่ยังไม่เริ่มใช้');
  if (dbFindOne_(SHEETS.RECEIPT_ENTRIES, function (e) { return e.BookId === b.BookId; })) {
    throw appError_(ERROR_CODES.CONFLICT, 'เล่มนี้มีการใช้เลขที่แล้ว แก้ไขไม่ได้');
  }
  const v = validateBookInput_(payload);
  const result = dbUpdate_(SHEETS.RECEIPT_BOOKS, b.BookId, {
    BookNo: v.bookNo,
    StartNo: v.startNo,
    EndNo: v.endNo,
    ReceivedDate: v.receivedDate,
    Note: v.note,
  }, actorFromCtx_(ctx), { note: 'แก้ไขข้อมูลเล่มใบเสร็จที่ยังไม่เริ่มใช้' });
  return bookDto_(result.after, bookUsage_(result.after, []), receiptSettings_());
}

/** receipts.activateBook — เปิดใช้เล่มใหม่ (ได้เมื่อไม่มีเล่มที่กำลังใช้อยู่) */
function receiptsActivateBook_(ctx, payload) {
  const b = requireBook_(payload.bookId);
  if (b.Status !== STATUS.BOOK.REGISTERED) {
    throw appError_(ERROR_CODES.CONFLICT, 'เปิดใช้ได้เฉพาะเล่มที่ลงทะเบียนแล้วและยังไม่เคยใช้');
  }
  if (pendingRequestsByRef_()[b.BookId]) {
    throw appError_(ERROR_CODES.CONFLICT, 'เล่มนี้มีคำขอปิดเล่มที่รออนุมัติ จึงเปิดใช้ไม่ได้');
  }
  const current = activeBook_();
  if (current) {
    throw appError_(ERROR_CODES.CONFLICT, 'เล่มที่ ' + current.BookNo + ' ยังใช้ไม่ครบ ต้องใช้ให้ครบเล่มหรือปิดเล่มเดิมก่อน จึงเปิดเล่มใหม่ได้');
  }
  const result = dbUpdate_(SHEETS.RECEIPT_BOOKS, b.BookId, {
    Status: STATUS.BOOK.ACTIVE,
    StartUseDate: todayIso_(),
    ResponsibleUserId: ctx.userId,
    ResponsibleName: ctx.displayName || ctx.username,
  }, actorFromCtx_(ctx), { note: 'เปิดใช้เล่มใบเสร็จ เล่มที่ ' + b.BookNo });
  return bookDto_(result.after, bookUsage_(result.after, []), receiptSettings_());
}

// ---------------------------------------------------------------------------
// API: ยกเลิกเลขที่ที่เขียนผิดหรือชำรุด (ยังไม่บันทึกรับเงิน)
// ---------------------------------------------------------------------------

/** receipts.requestCancelNumber — กันเลขที่ไว้ทันที แล้วรออนุมัติ (หรือยกเลิกทันทีถ้าไม่ต้องอนุมัติ) */
function receiptsRequestCancelNumber_(ctx, payload) {
  const b = requireBook_(payload.bookId);
  if (b.Status !== STATUS.BOOK.ACTIVE) throw appError_(ERROR_CODES.CONFLICT, 'ยกเลิกเลขที่ได้เฉพาะเล่มที่กำลังใช้');
  const receiptNo = requireInt_(payload.receiptNo, 'เลขที่ใบเสร็จ', { min: 1, max: 99999999 });
  if (receiptNo < b.StartNo || receiptNo > b.EndNo) {
    throw validationError_('เลขที่ ' + receiptNo + ' ไม่อยู่ในเล่มที่ ' + b.BookNo + ' (เลขที่ ' + b.StartNo + '–' + b.EndNo + ')');
  }
  const reason = requireText_(payload.reason, 'เหตุผลการยกเลิก', { max: 500, multiline: true });
  requireKeptOriginal_(payload);
  const usage = bookUsage_(b, entriesOfBook_(b.BookId));
  if (usage.taken[receiptNo]) {
    throw appError_(ERROR_CODES.CONFLICT, 'เลขที่ ' + receiptNo + ' ถูกใช้หรือยกเลิกไปแล้ว ถ้าเป็นใบเสร็จที่บันทึกรับเงินแล้ว ให้ใช้ "ยกเลิกใบเสร็จ" ที่รายการรับเงินนั้นแทน',
      { reason: 'RECEIPT_NO_TAKEN' });
  }
  const needApproval = approvalRequired_(STATUS.REQUEST_TYPE.RECEIPT_CANCEL);
  const actor = actorFromCtx_(ctx);
  const where = receiptWhere_(b.BookNo, receiptNo);
  const summary = 'ยกเลิกเลขที่ใบเสร็จ ' + where + ' (เขียนผิดหรือชำรุด ยังไม่ได้บันทึกรับเงิน)';
  const requestId = needApproval ? dbReserveId_(SHEETS.APPROVAL_REQUESTS) : '';
  const entry = dbInsert_(SHEETS.RECEIPT_ENTRIES, {
    BookId: b.BookId,
    BookNo: b.BookNo,
    ReceiptNo: receiptNo,
    Status: needApproval ? STATUS.RECEIPT_ENTRY.CANCEL_PENDING : STATUS.RECEIPT_ENTRY.CANCELLED,
    PaymentId: '',
    ReceiptDate: todayIso_(),
    Amount: null,
    StudentId: '',
  }, actor, { action: needApproval ? AUDIT_ACTIONS.REQUEST : AUDIT_ACTIONS.CANCEL, note: summary });
  const cancel = dbInsert_(SHEETS.RECEIPT_CANCELLATIONS, {
    EntryId: entry.EntryId,
    BookId: b.BookId,
    BookNo: b.BookNo,
    ReceiptNo: receiptNo,
    CancelType: STATUS.CANCEL_TYPE.SPOILED,
    PaymentId: '',
    Amount: null,
    Reason: reason,
    Status: needApproval ? STATUS.DECISION.PENDING : STATUS.DECISION.APPROVED,
    DecisionNote: needApproval ? '' : 'ไม่ต้องอนุมัติตามการตั้งค่า',
    ApprovalRequestId: requestId,
  }, actor, { action: needApproval ? AUDIT_ACTIONS.REQUEST : AUDIT_ACTIONS.CANCEL, note: summary });
  if (needApproval) {
    createApprovalRequest_(STATUS.REQUEST_TYPE.RECEIPT_CANCEL, entry.EntryId, '', summary, {
      cancellationId: cancel.CancellationId,
      entryId: entry.EntryId,
      cancelType: STATUS.CANCEL_TYPE.SPOILED,
      bookId: b.BookId,
      receiptNo: receiptNo,
    }, reason, actor, requestId);
    return { applied: false, requestId: requestId, message: 'กันเลขที่ ' + receiptNo + ' ไว้แล้ว และส่งคำขอยกเลิกให้ผู้อำนวยการพิจารณาแล้ว' };
  }
  refreshBookStatus_(b.BookId, actor);
  return { applied: true, message: 'ยกเลิกเลขที่ใบเสร็จ ' + where + ' เรียบร้อยแล้ว' };
}

/** อนุมัติการยกเลิกเลขที่ (ทั้งเลขที่เขียนผิด และใบเสร็จที่บันทึกรับเงินแล้ว) */
function applyReceiptCancel_(data, requestId, actor, note) {
  const c = dbGet_(SHEETS.RECEIPT_CANCELLATIONS, data.cancellationId);
  if (!c) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบข้อมูลการยกเลิกเลขที่');
  if (c.Status === STATUS.DECISION.APPROVED) return c;
  if (c.Status !== STATUS.DECISION.PENDING) throw appError_(ERROR_CODES.CONFLICT, 'คำขอยกเลิกนี้ไม่ได้อยู่ระหว่างรออนุมัติ');
  const e = dbGet_(SHEETS.RECEIPT_ENTRIES, c.EntryId);
  if (!e || e.Status !== STATUS.RECEIPT_ENTRY.CANCEL_PENDING) {
    throw appError_(ERROR_CODES.CONFLICT, 'สถานะของเลขที่ใบเสร็จนี้เปลี่ยนไปแล้ว กรุณาตรวจสอบทะเบียนคุม');
  }
  if (c.CancelType === STATUS.CANCEL_TYPE.VOID_PAYMENT) voidPaymentRecords_(c.PaymentId, c.Reason, requestId, actor);
  dbUpdate_(SHEETS.RECEIPT_ENTRIES, e.EntryId, { Status: STATUS.RECEIPT_ENTRY.CANCELLED }, actor,
    { action: AUDIT_ACTIONS.CANCEL, note: 'ยกเลิก' + receiptWhere_(e.BookNo, e.ReceiptNo) });
  dbUpdate_(SHEETS.RECEIPT_CANCELLATIONS, c.CancellationId, {
    Status: STATUS.DECISION.APPROVED,
    DecidedBy: actor.username,
    DecidedAt: nowIso_(),
    DecisionNote: note || '',
  }, actor, { action: AUDIT_ACTIONS.APPROVE, note: 'อนุมัติยกเลิก' + receiptWhere_(e.BookNo, e.ReceiptNo) });
  refreshBookStatus_(e.BookId, actor);
  return c;
}

/** ไม่อนุมัติหรือถอนคำขอยกเลิก: เลขที่ที่ยังไม่บันทึกรับเงินถูกคืน / ใบเสร็จที่บันทึกรับเงินแล้วกลับเป็น "ใช้แล้ว" */
function releaseReceiptCancel_(data, actor, outcome, note) {
  const c = dbGet_(SHEETS.RECEIPT_CANCELLATIONS, data.cancellationId);
  if (!c || c.Status !== STATUS.DECISION.PENDING) return;
  const e = dbGet_(SHEETS.RECEIPT_ENTRIES, c.EntryId);
  if (e && e.Status === STATUS.RECEIPT_ENTRY.CANCEL_PENDING) {
    const back = c.CancelType === STATUS.CANCEL_TYPE.SPOILED ? STATUS.RECEIPT_ENTRY.RELEASED : STATUS.RECEIPT_ENTRY.USED;
    dbUpdate_(SHEETS.RECEIPT_ENTRIES, e.EntryId, { Status: back }, actor, {
      note: (back === STATUS.RECEIPT_ENTRY.RELEASED ? 'คืนเลขที่ ' : 'ใบเสร็จกลับเป็นใช้แล้ว ') + receiptWhere_(e.BookNo, e.ReceiptNo) +
        ' (' + (STATUS_LABELS.DECISION[outcome] || outcome) + ')',
    });
  }
  dbUpdate_(SHEETS.RECEIPT_CANCELLATIONS, c.CancellationId, {
    Status: outcome,
    DecidedBy: actor.username,
    DecidedAt: nowIso_(),
    DecisionNote: note || '',
  }, actor, { action: outcome === STATUS.DECISION.REJECTED ? AUDIT_ACTIONS.REJECT : AUDIT_ACTIONS.CANCEL, note: 'คำขอยกเลิก' + receiptWhere_(c.BookNo, c.ReceiptNo) });
}

// ---------------------------------------------------------------------------
// API: ปิดเล่มก่อนใช้ครบ
// ---------------------------------------------------------------------------

/** receipts.requestCloseBook — ขอปิดเล่มที่กำลังใช้หรือยังไม่เริ่มใช้ เลขที่ที่เหลือจะใช้ไม่ได้อีก */
function receiptsRequestCloseBook_(ctx, payload) {
  const b = requireBook_(payload.bookId);
  const reason = requireText_(payload.reason, 'เหตุผลการปิดเล่ม', { max: 500, multiline: true });
  const usage = checkBookClosable_(b);
  assertNoPendingRequest_(b.BookId);
  const actor = actorFromCtx_(ctx);
  const summary = 'ปิดเล่มใบเสร็จ เล่มที่ ' + b.BookNo + ' ก่อนใช้ครบ (เลขที่ที่ยังไม่ใช้ ' + usage.remaining + ' ใบ จะใช้ไม่ได้อีก)';
  const data = { bookId: b.BookId, reason: reason };
  if (approvalRequired_(STATUS.REQUEST_TYPE.BOOK_CLOSE)) {
    const req = createApprovalRequest_(STATUS.REQUEST_TYPE.BOOK_CLOSE, b.BookId, '', summary, data, reason, actor);
    return { applied: false, requestId: req.RequestId, message: 'ส่งคำขอปิดเล่มที่ ' + b.BookNo + ' ให้ผู้อำนวยการพิจารณาแล้ว' };
  }
  applyBookClose_(data, actor);
  return { applied: true, message: 'ปิดเล่มที่ ' + b.BookNo + ' เรียบร้อยแล้ว' };
}

function checkBookClosable_(b) {
  if (b.Status !== STATUS.BOOK.ACTIVE && b.Status !== STATUS.BOOK.REGISTERED) {
    throw appError_(ERROR_CODES.CONFLICT, 'ปิดได้เฉพาะเล่มที่กำลังใช้หรือยังไม่เริ่มใช้ (เล่มนี้' + (STATUS_LABELS.BOOK[b.Status] || b.Status) + 'แล้ว)');
  }
  const usage = bookUsage_(b, entriesOfBook_(b.BookId));
  if (usage.pendingCount > 0) {
    throw appError_(ERROR_CODES.CONFLICT, 'เล่มนี้มีคำขอยกเลิกเลขที่ที่รออนุมัติ ' + usage.pendingCount + ' รายการ กรุณาให้ผู้อำนวยการพิจารณาคำขอเหล่านั้นก่อน');
  }
  if (usage.remaining === 0) throw appError_(ERROR_CODES.CONFLICT, 'เล่มนี้ไม่มีเลขที่เหลือแล้ว ไม่ต้องปิดเล่ม');
  return usage;
}

function applyBookClose_(data, actor) {
  const b = dbGet_(SHEETS.RECEIPT_BOOKS, data.bookId);
  if (!b) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบเล่มใบเสร็จนี้');
  if (b.Status === STATUS.BOOK.CLOSED) return b;
  checkBookClosable_(b);
  return dbUpdate_(SHEETS.RECEIPT_BOOKS, b.BookId, {
    Status: STATUS.BOOK.CLOSED,
    ClosedDate: todayIso_(),
    CloseReason: data.reason,
  }, actor, { action: AUDIT_ACTIONS.CANCEL, note: 'ปิดเล่มใบเสร็จ เล่มที่ ' + b.BookNo + ' ก่อนใช้ครบ' }).after;
}
