/**
 * ============================================================================
 *  Closings.gs — การปิดยอดประจำวัน (D-19, D-37)
 * ----------------------------------------------------------------------------
 *  - เจ้าหน้าที่การเงินพิมพ์รายงานรับเงินประจำวัน ตรวจกับเงินและสำเนาใบเสร็จ แล้วกด "ปิดยอด"
 *  - ระบบเก็บ "รหัสตรวจสอบ" = SHA-256 ของรายการรับเงินที่มีผลในวันนั้น และพิมพ์ไว้ในรายงานที่ลงนาม
 *    ถ้าข้อมูลของวันนั้นถูกแก้ภายหลัง (เช่น แก้ชีตด้วยมือ) รหัสที่คำนวณใหม่จะไม่ตรงกับกระดาษที่ลงนาม
 *  - วันที่ปิดยอดแล้ว: บันทึกรับเงิน ขอยกเลิกใบเสร็จ หรือขอแก้ไขรายการที่มีวันที่นั้นไม่ได้
 *    ต้องให้ผู้อำนวยการ "เปิดยอดใหม่" พร้อมเหตุผลก่อน (ประวัติการปิดยอดเดิมยังอยู่ในชีต)
 *  - ปิดยอดไม่ได้ถ้ายังมีคำขอยกเลิกหรือแก้ไขใบเสร็จของวันนั้นที่รอพิจารณา
 * ============================================================================
 */

const CLOSING_CONFIRM_TEXT = 'ตรวจนับเงินและสำเนาใบเสร็จตรงกับรายงานนี้แล้ว';
const CLOSING_LOOKBACK_DAYS = 30; // ช่วงที่ใช้เตือน "ยังไม่ปิดยอด"

/** การปิดยอดที่มีผลของวันที่ (ไม่นับที่เปิดยอดใหม่แล้ว) */
function closingOf_(date) {
  return dbFindOne_(SHEETS.DAILY_CLOSINGS, function (c) {
    return c.ClosingDate === date && c.Status === STATUS.CLOSING.CLOSED;
  });
}

/** วันที่ที่ปิดยอดแล้วทั้งหมด (ใช้ตรวจหลายวันในครั้งเดียว) */
function closedDateSet_() {
  const out = Object.create(null);
  dbAll_(SHEETS.DAILY_CLOSINGS).forEach(function (c) {
    if (c.Status === STATUS.CLOSING.CLOSED) out[c.ClosingDate] = c;
  });
  return out;
}

/** ห้ามเปลี่ยนรายการรับเงินของวันที่ปิดยอดแล้ว */
function assertDayOpen_(date, what) {
  if (!date || !closingOf_(date)) return;
  throw appError_(ERROR_CODES.CONFLICT,
    'วันที่ ' + formatThaiDate_(date) + ' ปิดยอดแล้ว จึง' + what + 'ไม่ได้ ' +
    'ถ้าจำเป็นต้องแก้ไข ให้ผู้อำนวยการเปิดยอดของวันนั้นใหม่ (หน้า "รายงานและปิดยอด")', { reason: 'DAY_CLOSED' });
}

/** การรับเงินของวันที่ (รายการที่ถูกแก้ไขแทนแล้วไม่นับ เพราะรายการใหม่แสดงแทน) เรียงตามเล่มและเลขที่ */
function paymentsOfDay_(date) {
  return dbFind_(SHEETS.PAYMENTS, function (p) {
    return p.PaymentDate === date && p.Status !== STATUS.PAYMENT.REPLACED;
  }).sort(compareByReceipt_);
}

function compareByReceipt_(a, b) {
  if (a.ReceiptBookNo !== b.ReceiptBookNo) return compareText_(a.ReceiptBookNo, b.ReceiptBookNo);
  if (a.ReceiptNo !== b.ReceiptNo) return a.ReceiptNo - b.ReceiptNo;
  return a.CreatedAt < b.CreatedAt ? -1 : (a.CreatedAt > b.CreatedAt ? 1 : 0);
}

/**
 * ยอดของวัน: จำนวนใบเสร็จ ยอดรวม แยกช่องทาง ช่วงเลขที่ และรหัสตรวจสอบ
 * รหัสตรวจสอบคิดจากรายการที่มีผลเท่านั้น (รหัส เล่ม เลขที่ นักเรียน จำนวนเงิน ช่องทาง เลขอ้างอิง)
 */
function dayFigures_(date, payments) {
  const list = payments || paymentsOfDay_(date);
  const active = list.filter(function (p) { return p.Status === STATUS.PAYMENT.ACTIVE; });
  const byChannel = Object.create(null);
  const books = Object.create(null);
  let total = 0;
  active.forEach(function (p) {
    const satang = satangOf_(p.Amount);
    total += satang;
    const ch = byChannel[p.Channel] || (byChannel[p.Channel] = { channel: p.Channel, count: 0, satang: 0 });
    ch.count += 1;
    ch.satang += satang;
    const b = books[p.ReceiptBookNo] || (books[p.ReceiptBookNo] = { bookNo: p.ReceiptBookNo, from: p.ReceiptNo, to: p.ReceiptNo });
    b.from = Math.min(b.from, p.ReceiptNo);
    b.to = Math.max(b.to, p.ReceiptNo);
  });
  const canonical = active.map(function (p) {
    return [p.PaymentId, p.ReceiptBookNo, p.ReceiptNo, p.StudentId, satangOf_(p.Amount), p.Channel, p.ChannelRef];
  });
  const range = Object.keys(books).sort(compareText_).map(function (k) {
    const b = books[k];
    return 'เล่มที่ ' + b.bookNo + ' เลขที่ ' + (b.from === b.to ? b.from : b.from + '–' + b.to);
  }).join(', ');
  return {
    date: date,
    receiptCount: active.length,
    voidedCount: list.length - active.length,
    totalSatang: total,
    byChannel: Object.keys(byChannel).sort(compareText_).map(function (k) { return byChannel[k]; }),
    receiptRange: range,
    digest: sha256Hex_(JSON.stringify([date, canonical])),
  };
}

/** รหัสตรวจสอบสำหรับพิมพ์ (16 ตัวแรกของ SHA-256 แบ่งเป็นกลุ่มละ 4 ตัว) */
function verifyCodeOf_(digest) {
  if (!digest) return '';
  return String(digest).slice(0, 16).toUpperCase().match(/.{4}/g).join('-');
}

/** คำขอที่รอพิจารณาและกระทบรายการรับเงินของวันที่ (ยกเลิกใบเสร็จ / แก้ไขรายการ ทั้งวันเดิมและวันใหม่) */
function pendingRequestsOfDay_(date) {
  const payments = Object.create(null);
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) { payments[p.PaymentId] = p; });
  return dbFind_(SHEETS.APPROVAL_REQUESTS, function (r) {
    if (r.Status !== STATUS.DECISION.PENDING) return false;
    if (r.RequestType !== STATUS.REQUEST_TYPE.RECEIPT_CANCEL && r.RequestType !== STATUS.REQUEST_TYPE.PAYMENT_CORRECTION) return false;
    const data = parseRequestData_(r);
    const p = payments[data.paymentId || r.RefId];
    if (p && p.PaymentDate === date) return true;
    return r.RequestType === STATUS.REQUEST_TYPE.PAYMENT_CORRECTION && data.paymentDate === date;
  });
}

function closingDto_(c, names) {
  if (!c) return null;
  let byChannel = [];
  try { byChannel = c.ByChannelJson ? JSON.parse(c.ByChannelJson) : []; } catch (e) { byChannel = []; }
  return {
    closingId: c.ClosingId,
    date: c.ClosingDate,
    status: c.Status,
    statusLabel: STATUS_LABELS.CLOSING[c.Status] || c.Status,
    receiptCount: c.ReceiptCount,
    totalSatang: satangOf_(c.TotalAmount),
    byChannel: byChannel,
    receiptRange: c.ReceiptRange,
    digest: c.Digest,
    verifyCode: verifyCodeOf_(c.Digest),
    auditAnchor: c.AuditHash ? String(c.AuditHash).slice(0, 12).toUpperCase() : '',
    closedBy: displayNameOf_(c.CreatedBy, names),
    closedAt: c.CreatedAt,
    reopenedBy: displayNameOf_(c.ReopenedBy, names),
    reopenedAt: c.ReopenedAt,
    reopenReason: c.ReopenReason,
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * closings.close — ปิดยอดประจำวัน (เจ้าหน้าที่การเงิน)
 * payload: { date, expectedDigest, confirmChecked: true }
 * expectedDigest = รหัสตรวจสอบของรายงานที่เจ้าหน้าที่เปิดดูอยู่ ถ้าข้อมูลเปลี่ยนไประหว่างนั้นจะปิดยอดไม่ได้
 */
function closingsClose_(ctx, payload) {
  const date = requireIsoDate_(payload.date, 'วันที่ปิดยอด');
  if (date > todayIso_()) throw validationError_('ปิดยอดล่วงหน้าไม่ได้');
  if (payload.confirmChecked !== true) throw validationError_('กรุณาติ๊กยืนยันว่า' + CLOSING_CONFIRM_TEXT);
  if (closingOf_(date)) {
    throw appError_(ERROR_CODES.CONFLICT, 'วันที่ ' + formatThaiDate_(date) + ' ปิดยอดแล้ว', { reason: 'DAY_CLOSED' });
  }
  const payments = paymentsOfDay_(date);
  const fig = dayFigures_(date, payments);
  if (!payments.length) throw validationError_('ไม่มีรายการรับเงินในวันที่ ' + formatThaiDate_(date) + ' จึงไม่ต้องปิดยอด');
  const pending = pendingRequestsOfDay_(date);
  if (pending.length) {
    throw appError_(ERROR_CODES.CONFLICT, 'ยังมีคำขอยกเลิกหรือแก้ไขใบเสร็จของวันนี้ที่รอผู้อำนวยการพิจารณา ' + pending.length +
      ' รายการ กรุณารอผลการพิจารณาก่อนปิดยอด', { reason: 'PENDING_REQUEST' });
  }
  if (typeof payload.expectedDigest !== 'string' || payload.expectedDigest !== fig.digest) {
    throw appError_(ERROR_CODES.CONFLICT, 'รายการรับเงินของวันนี้เปลี่ยนไปหลังจากเปิดรายงาน กรุณาโหลดรายงานใหม่และตรวจอีกครั้งก่อนปิดยอด',
      { reason: 'DAY_CHANGED' });
  }
  const actor = actorFromCtx_(ctx);
  const closing = dbInsert_(SHEETS.DAILY_CLOSINGS, {
    ClosingDate: date,
    Status: STATUS.CLOSING.CLOSED,
    ReceiptCount: fig.receiptCount,
    TotalAmount: satangToBaht_(fig.totalSatang),
    ByChannelJson: JSON.stringify(fig.byChannel),
    ReceiptRange: fig.receiptRange,
    Digest: fig.digest,
    AuditHash: auditState_().lastHash,
  }, actor, {
    action: AUDIT_ACTIONS.DAY_CLOSE,
    note: 'ปิดยอดวันที่ ' + formatThaiDate_(date) + ' ใบเสร็จ ' + fig.receiptCount + ' ฉบับ รวม ' + formatSatang_(fig.totalSatang, true),
  });
  return {
    closing: closingDto_(closing, userDisplayNames_()),
    message: 'ปิดยอดวันที่ ' + formatThaiDate_(date) + ' เรียบร้อยแล้ว รหัสตรวจสอบ ' + verifyCodeOf_(fig.digest),
  };
}

/** closings.reopen — เปิดยอดของวันที่ปิดแล้วใหม่ (ผู้อำนวยการ ต้องมีเหตุผล) payload: { date, reason } */
function closingsReopen_(ctx, payload) {
  const date = requireIsoDate_(payload.date, 'วันที่');
  const reason = requireText_(payload.reason, 'เหตุผลการเปิดยอดใหม่', { max: 500, multiline: true });
  const c = closingOf_(date);
  if (!c) throw appError_(ERROR_CODES.CONFLICT, 'วันที่ ' + formatThaiDate_(date) + ' ยังไม่ได้ปิดยอด');
  const actor = actorFromCtx_(ctx);
  dbUpdate_(SHEETS.DAILY_CLOSINGS, c.ClosingId, {
    Status: STATUS.CLOSING.REOPENED,
    ReopenedAt: nowIso_(),
    ReopenedBy: actor.username,
    ReopenReason: reason,
  }, actor, { action: AUDIT_ACTIONS.DAY_REOPEN, note: 'เปิดยอดวันที่ ' + formatThaiDate_(date) + ' ใหม่: ' + reason });
  return { message: 'เปิดยอดวันที่ ' + formatThaiDate_(date) + ' ใหม่แล้ว เจ้าหน้าที่การเงินแก้ไขรายการแล้วต้องปิดยอดอีกครั้ง' };
}

/**
 * closings.list — สถานะการปิดยอดรายวันในช่วงวันที่ (ไม่เกิน 92 วัน ค่าเริ่มต้น 30 วันล่าสุด)
 * แสดงเฉพาะวันที่มีการรับเงินหรือเคยปิดยอด
 */
function closingsList_(ctx, payload) {
  const today = todayIso_();
  const toDate = requireIsoDate_(isBlankInput_(payload.toDate) ? today : payload.toDate, 'วันที่สิ้นสุด');
  const fromDate = requireIsoDate_(isBlankInput_(payload.fromDate) ? addDaysIso_(toDate, -(CLOSING_LOOKBACK_DAYS - 1)) : payload.fromDate, 'วันที่เริ่มต้น');
  if (toDate < fromDate) throw validationError_('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น');
  if (daysBetween_(fromDate, toDate) >= PAYMENT_LIST_MAX_DAYS) throw validationError_('ดูได้ครั้งละไม่เกิน ' + PAYMENT_LIST_MAX_DAYS + ' วัน');
  const names = userDisplayNames_();
  const days = Object.create(null);
  const dayOf = function (d) {
    return days[d] || (days[d] = { date: d, payments: [], closing: null, history: [] });
  };
  dbFind_(SHEETS.PAYMENTS, function (p) {
    return p.PaymentDate >= fromDate && p.PaymentDate <= toDate && p.Status !== STATUS.PAYMENT.REPLACED;
  }).forEach(function (p) { dayOf(p.PaymentDate).payments.push(p); });
  dbFind_(SHEETS.DAILY_CLOSINGS, function (c) { return c.ClosingDate >= fromDate && c.ClosingDate <= toDate; })
    .sort(function (a, b) { return a.CreatedAt < b.CreatedAt ? 1 : -1; })
    .forEach(function (c) {
      const d = dayOf(c.ClosingDate);
      if (c.Status === STATUS.CLOSING.CLOSED) d.closing = closingDto_(c, names);
      else d.history.push(closingDto_(c, names));
    });
  const rows = Object.keys(days).sort().reverse().map(function (k) {
    const d = days[k];
    const fig = dayFigures_(k, d.payments.sort(compareByReceipt_));
    return {
      date: k,
      receiptCount: fig.receiptCount,
      voidedCount: fig.voidedCount,
      totalSatang: fig.totalSatang,
      receiptRange: fig.receiptRange,
      closed: !!d.closing,
      closing: d.closing,
      changedAfterClose: !!d.closing && d.closing.digest !== fig.digest,
      reopenCount: d.history.length,
      history: d.history,
    };
  });
  return {
    fromDate: fromDate,
    toDate: toDate,
    today: today,
    rows: rows,
    unclosedCount: rows.filter(function (r) { return !r.closed && r.date < today && r.receiptCount + r.voidedCount > 0; }).length,
    canClose: ctx.role === ROLES.FINANCE,
    canReopen: ctx.role === ROLES.DIRECTOR,
  };
}

/** จำนวนวันที่รับเงินแล้วแต่ยังไม่ปิดยอด ใน 30 วันล่าสุด (ไม่นับวันนี้) — ใช้แสดงเตือนในหน้าแรก */
function unclosedDaysCount_() {
  const today = todayIso_();
  const from = addDaysIso_(today, -CLOSING_LOOKBACK_DAYS);
  const closed = closedDateSet_();
  const seen = Object.create(null);
  dbAll_(SHEETS.PAYMENTS).forEach(function (p) {
    if (p.PaymentDate >= from && p.PaymentDate < today && p.Status !== STATUS.PAYMENT.REPLACED && !closed[p.PaymentDate]) seen[p.PaymentDate] = true;
  });
  return Object.keys(seen).length;
}

/** บวกหรือลบจำนวนวันจากวันที่ ISO */
function addDaysIso_(iso, days) {
  const p = String(iso).split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
