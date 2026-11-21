/**
 * ============================================================================
 *  Receipts.gs — ทะเบียนคุมเล่มและเลขที่ใบเสร็จรับเงิน (ส่วนแกน ระยะที่ 4)
 * ----------------------------------------------------------------------------
 *  ระบบไม่ออกเลขใบเสร็จเอง: ใช้เฉพาะเลขที่ในช่วงของเล่มจริงที่ลงทะเบียนไว้
 *  - ลงทะเบียนเล่ม (เลขเล่มไม่ซ้ำ) → เปิดใช้ได้ครั้งละ 1 เล่ม
 *  - เลขที่ถัดไป = เลขต่ำสุดในช่วงของเล่มที่ยังไม่มีในทะเบียนคุม (ReceiptEntries)
 *  - เล่ม + เลขที่ ไม่ซ้ำ ตรวจภายใต้ lock ทุกครั้ง
 *  - ใช้ครบทุกเลขแล้ว เล่มเปลี่ยนเป็น "ใช้ครบเล่ม" และบันทึกในเล่มนั้นต่อไม่ได้
 *  ระยะที่ 5: ยกเลิกเลขที่ ปิดเล่มก่อนใช้ครบ ตารางเลขที่ทุกตัว และรายงาน
 * ============================================================================
 */

const RECEIPT_BOOK_MAX_NUMBERS = 1000;

const BOOK_STATUS_ORDER_ = Object.freeze({ ACTIVE: 0, REGISTERED: 1, FULL: 2, CLOSED: 3 });

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

/** การใช้เลขที่ของเล่ม: ใช้แล้ว ยกเลิก คงเหลือ เลขที่ถัดไป และเลขที่ขาดช่วง (ไม่ได้ใช้ แต่ต่ำกว่าเลขสูงสุดที่ใช้แล้ว) */
function bookUsage_(book, entries) {
  const taken = Object.create(null);
  let used = 0;
  let cancelled = 0;
  let pending = 0;
  let maxTaken = null;
  (entries || []).forEach(function (e) {
    taken[e.ReceiptNo] = true;
    if (e.Status === STATUS.RECEIPT_ENTRY.USED) used += 1;
    else if (e.Status === STATUS.RECEIPT_ENTRY.CANCELLED) cancelled += 1;
    else if (e.Status === STATUS.RECEIPT_ENTRY.CANCEL_PENDING) pending += 1;
    if (maxTaken === null || e.ReceiptNo > maxTaken) maxTaken = e.ReceiptNo;
  });
  let nextNo = null;
  let remaining = 0;
  const gaps = [];
  for (let n = book.StartNo; n <= book.EndNo; n++) {
    if (taken[n]) continue;
    remaining += 1;
    if (nextNo === null) nextNo = n;
    if (maxTaken !== null && n < maxTaken) gaps.push(n);
  }
  return {
    total: book.EndNo - book.StartNo + 1,
    usedCount: used,
    cancelledCount: cancelled,
    pendingCount: pending,
    remaining: remaining,
    nextNo: nextNo,
    maxTaken: maxTaken,
    gaps: gaps,
    taken: taken,
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
    responsibleName: b.ResponsibleName,
    status: b.Status,
    statusLabel: STATUS_LABELS.BOOK[b.Status] || b.Status,
    note: b.Note,
    total: usage.total,
    usedCount: usage.usedCount,
    cancelledCount: usage.cancelledCount,
    pendingCount: usage.pendingCount,
    remaining: usage.remaining,
    nextNo: b.Status === STATUS.BOOK.ACTIVE ? usage.nextNo : null,
    gaps: usage.gaps,
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
  const settings = receiptSettings_();
  const usage = bookUsage_(b, dbFind_(SHEETS.RECEIPT_ENTRIES, function (e) { return e.BookId === b.BookId; }));
  return bookDto_(b, usage, settings);
}

function requireBook_(value) {
  const id = requireId_(value, 'BOOK', 'รหัสเล่มใบเสร็จ');
  const b = dbGet_(SHEETS.RECEIPT_BOOKS, id);
  if (!b) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบเล่มใบเสร็จนี้');
  return b;
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

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** receipts.books — ทะเบียนเล่มใบเสร็จทั้งหมด พร้อมการใช้เลขที่ */
function receiptsBooks_(ctx, payload) {
  const byBook = receiptEntriesByBook_();
  const settings = receiptSettings_();
  const books = dbAll_(SHEETS.RECEIPT_BOOKS)
    .map(function (b) { return bookDto_(b, bookUsage_(b, byBook[b.BookId]), settings); })
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
