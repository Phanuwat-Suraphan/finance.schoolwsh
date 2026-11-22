/**
 * ============================================================================
 *  Integrity.gs — ตรวจความถูกต้องของข้อมูลทั้งระบบ (ARCHITECTURE หัวข้อ 7, ระยะที่ 8)
 * ----------------------------------------------------------------------------
 *  - ตรวจภายใต้ lock เดียวกับการบันทึก จึงไม่เห็นข้อมูลที่บันทึกค้างครึ่งทาง
 *  - อ่านอย่างเดียว ไม่แก้ไขข้อมูลใด ๆ (ถ้าพบปัญหา ให้คนตรวจต่อจากประวัติการใช้งาน)
 *  - ข้อความปัญหาอ้างอิงรหัสรายการและเลขที่ใบเสร็จ ไม่แสดงจำนวนเงิน (ผู้ดูแลระบบไม่เห็นข้อมูลการเงิน)
 *  - รันได้จากหน้าเว็บ (ผู้ดูแลระบบ ผู้อำนวยการ) และรันอัตโนมัติทุกวันต่อจากการสำรองข้อมูล
 *
 *  รายการตรวจ
 *   1. อ่านข้อมูลได้ทุกชีต และไม่มีรหัสซ้ำ
 *   2. ลูกโซ่ hash ของประวัติการใช้งานไม่ขาด
 *   3. การรับเงินตรงกับการตัดชำระ และตรงกับทะเบียนคุมเลขที่ใบเสร็จ
 *   4. เลขที่ใบเสร็จไม่ซ้ำ และอยู่ในช่วงของเล่ม
 *   5. ไม่มีรายการเรียกเก็บที่ถูกตัดชำระเกินยอดสุทธิ
 *   6. สถานะเล่มสอดคล้องกับเลขที่ที่ใช้
 *   7. ทุกรายการการเงินมีประวัติการบันทึกคู่กัน (ตรวจการเพิ่มแถวในชีตโดยตรง)
 *   8. รายการของวันที่ปิดยอดแล้วไม่เปลี่ยน
 * ============================================================================
 */

const INTEGRITY_MAX_PROBLEMS = 50;

function receiptRef_(bookNo, receiptNo) {
  return 'ใบเสร็จเล่มที่ ' + (bookNo || '?') + ' เลขที่ ' + (receiptNo === null || receiptNo === undefined || receiptNo === '' ? '?' : receiptNo);
}

/** ชีตที่เป็นข้อมูลการเงินและต้องมีประวัติการบันทึกทุกแถว */
function integrityFinancialSheets_() {
  return [SHEETS.FEE_SETTINGS, SHEETS.FEE_ASSESSMENTS, SHEETS.FEE_ADJUSTMENTS, SHEETS.PAYMENTS, SHEETS.PAYMENT_ALLOCATIONS,
    SHEETS.RECEIPT_BOOKS, SHEETS.RECEIPT_ENTRIES, SHEETS.RECEIPT_CANCELLATIONS, SHEETS.APPROVAL_REQUESTS, SHEETS.DAILY_CLOSINGS];
}

/** ตรวจทุกข้อ คืน { ok, checkedAt, problemCount, checks: [{ key, label, ok, count, problems, more }] } (ต้องถือ lock) */
function integrityRun_() {
  assertLockHeld_();
  const checks = [];
  function check(key, label, fn) {
    const problems = [];
    let error = '';
    try {
      fn(function (message) { problems.push(message); });
    } catch (e) {
      error = isAppError_(e) ? e.userMessage : 'ตรวจข้อนี้ไม่สำเร็จ เพราะอ่านข้อมูลไม่ได้';
      if (!isAppError_(e)) console.error('integrity ' + key + ': ' + (e && e.message ? String(e.message).slice(0, 200) : String(e)));
    }
    const all = (error ? [error] : []).concat(problems);
    checks.push({
      key: key,
      label: label,
      ok: all.length === 0,
      count: all.length,
      problems: all.slice(0, INTEGRITY_MAX_PROBLEMS),
      more: Math.max(0, all.length - INTEGRITY_MAX_PROBLEMS),
    });
  }

  check('sheets', 'อ่านข้อมูลได้ทุกชีต และไม่มีรหัสซ้ำ', function (bad) {
    SHEET_ORDER.forEach(function (name) {
      try {
        const t = dbTable_(name);
        if (t.duplicateIds.length) bad('ชีต "' + SCHEMA[name].label + '" มีรหัสซ้ำ: ' + t.duplicateIds.slice(0, 5).join(', '));
      } catch (e) {
        bad('ชีต "' + SCHEMA[name].label + '": ' + (isAppError_(e) ? e.userMessage : 'อ่านข้อมูลไม่ได้'));
      }
    });
  });

  check('audit', 'ลูกโซ่ประวัติการใช้งานไม่ขาด (ไม่มีการแก้ แทรก หรือลบแถวประวัติ)', function (bad) {
    const r = auditVerifyChain_();
    r.problems.forEach(function (p) { bad('แถว ' + p.rowNumber + ' (' + (p.logId || '-') + '): ' + p.label); });
    if (r.problemCount > r.problems.length) bad('และอีก ' + (r.problemCount - r.problems.length) + ' จุด');
  });

  // ข้อมูลที่ใช้ร่วมกันในหลายข้อ (อ่านครั้งเดียว)
  let data = null;
  function load() {
    if (data) return data;
    const payments = dbAll_(SHEETS.PAYMENTS);
    const byPayment = Object.create(null);
    payments.forEach(function (p) { byPayment[p.PaymentId] = p; });
    const allocations = dbAll_(SHEETS.PAYMENT_ALLOCATIONS);
    const allocBy = Object.create(null);
    allocations.forEach(function (al) { (allocBy[al.PaymentId] || (allocBy[al.PaymentId] = [])).push(al); });
    const entries = dbAll_(SHEETS.RECEIPT_ENTRIES);
    const byEntry = Object.create(null);
    entries.forEach(function (e) { byEntry[e.EntryId] = e; });
    const books = dbAll_(SHEETS.RECEIPT_BOOKS);
    const byBook = Object.create(null);
    books.forEach(function (b) { byBook[b.BookId] = b; });
    const assessments = dbAll_(SHEETS.FEE_ASSESSMENTS);
    const byAsm = Object.create(null);
    assessments.forEach(function (a) { byAsm[a.AssessmentId] = a; });
    data = {
      payments: payments, byPayment: byPayment, allocations: allocations, allocBy: allocBy,
      entries: entries, byEntry: byEntry, books: books, byBook: byBook, assessments: assessments, byAsm: byAsm,
    };
    return data;
  }

  check('payments', 'การรับเงินตรงกับการตัดชำระ และตรงกับทะเบียนคุมเลขที่ใบเสร็จ', function (bad) {
    const d = load();
    const keys = Object.create(null);
    d.allocations.forEach(function (al) {
      if (!d.byPayment[al.PaymentId]) bad('การตัดชำระ ' + al.AllocationId + ': ไม่พบการรับเงินที่อ้างถึง (' + al.PaymentId + ')');
    });
    d.payments.forEach(function (p) {
      const ref = receiptRef_(p.ReceiptBookNo, p.ReceiptNo) + ' (' + p.PaymentId + ')';
      if (p.RequestKey) {
        if (keys[p.RequestKey]) bad(ref + ': รหัสคำขอซ้ำกับรายการ ' + keys[p.RequestKey] + ' (อาจบันทึกซ้ำ)');
        else keys[p.RequestKey] = p.PaymentId;
      }
      const active = (d.allocBy[p.PaymentId] || []).filter(function (al) { return al.Status === STATUS.ALLOCATION.ACTIVE; });
      active.forEach(function (al) {
        const asm = d.byAsm[al.AssessmentId];
        if (!asm) bad(ref + ': ตัดชำระรายการเรียกเก็บที่ไม่มีอยู่ (' + al.AssessmentId + ')');
        else if (asm.StudentId !== p.StudentId || al.StudentId !== p.StudentId) bad(ref + ': ตัดชำระรายการของนักเรียนคนอื่น (' + al.AllocationId + ')');
      });
      if (p.Status === STATUS.PAYMENT.ACTIVE) {
        const sum = active.reduce(function (s, al) { return s + satangOf_(al.Amount); }, 0);
        if (sum !== satangOf_(p.Amount)) bad(ref + ': ยอดเงินในใบเสร็จไม่เท่ากับผลรวมการตัดชำระ');
        const e = d.byEntry[p.ReceiptEntryId];
        if (!e) {
          bad(ref + ': ไม่พบเลขที่นี้ในทะเบียนคุมใบเสร็จ');
          return;
        }
        if (e.PaymentId !== p.PaymentId) bad(ref + ': ทะเบียนคุมใบเสร็จชี้ไปที่การรับเงินรายการอื่น');
        if (e.BookId !== p.ReceiptBookId || e.ReceiptNo !== p.ReceiptNo) bad(ref + ': เล่มหรือเลขที่ไม่ตรงกับทะเบียนคุมใบเสร็จ');
        if (e.Status !== STATUS.RECEIPT_ENTRY.USED && e.Status !== STATUS.RECEIPT_ENTRY.CANCEL_PENDING) {
          bad(ref + ': สถานะในทะเบียนคุมเป็น "' + (STATUS_LABELS.RECEIPT_ENTRY[e.Status] || e.Status) + '" แต่การรับเงินยังมีผล');
        }
        if (satangOf_(e.Amount) !== satangOf_(p.Amount) || e.ReceiptDate !== p.PaymentDate || e.StudentId !== p.StudentId) {
          bad(ref + ': จำนวนเงิน วันที่ หรือนักเรียน ไม่ตรงกับทะเบียนคุมใบเสร็จ');
        }
      } else {
        if (active.length) bad(ref + ': การรับเงินที่' + (STATUS_LABELS.PAYMENT[p.Status] || p.Status) + 'แล้วยังมีการตัดชำระที่มีผล');
        if (p.Status === STATUS.PAYMENT.VOIDED) {
          const e = d.byEntry[p.ReceiptEntryId];
          if (e && e.PaymentId === p.PaymentId && e.Status !== STATUS.RECEIPT_ENTRY.CANCELLED) bad(ref + ': ยกเลิกใบเสร็จแล้ว แต่ทะเบียนคุมยังไม่เป็น "ยกเลิก"');
        }
        if (p.Status === STATUS.PAYMENT.REPLACED) {
          const next = d.byPayment[p.ReplacedByPaymentId];
          if (!next || next.ReplacesPaymentId !== p.PaymentId) bad(ref + ': ไม่พบรายการใหม่ที่มาแทนรายการที่แก้ไข');
        }
      }
    });
  });

  check('receipts', 'เลขที่ใบเสร็จไม่ซ้ำ และอยู่ในช่วงของเล่ม', function (bad) {
    const d = load();
    const seen = Object.create(null);
    d.entries.forEach(function (e) {
      if (e.Status === STATUS.RECEIPT_ENTRY.RELEASED) return;
      const ref = receiptRef_(e.BookNo, e.ReceiptNo);
      const key = e.BookId + '|' + e.ReceiptNo;
      if (seen[key]) bad(ref + ': มีในทะเบียนคุมซ้ำ (' + seen[key] + ', ' + e.EntryId + ')');
      else seen[key] = e.EntryId;
      const b = d.byBook[e.BookId];
      if (!b) { bad(ref + ': ไม่พบเล่มใบเสร็จ (' + e.BookId + ')'); return; }
      if (b.BookNo !== e.BookNo) bad(ref + ': เลขเล่มไม่ตรงกับทะเบียนเล่ม (' + b.BookNo + ')');
      if (e.ReceiptNo < b.StartNo || e.ReceiptNo > b.EndNo) bad(ref + ': อยู่นอกช่วงเลขที่ของเล่ม (' + b.StartNo + '–' + b.EndNo + ')');
      if (e.Status === STATUS.RECEIPT_ENTRY.USED) {
        const p = d.byPayment[e.PaymentId];
        if (!p || p.Status !== STATUS.PAYMENT.ACTIVE || p.ReceiptEntryId !== e.EntryId) bad(ref + ': ทะเบียนคุมเป็น "ใช้แล้ว" แต่ไม่มีการรับเงินที่มีผลคู่กัน');
      }
    });
    const activeNo = Object.create(null);
    d.payments.forEach(function (p) {
      if (p.Status !== STATUS.PAYMENT.ACTIVE) return;
      const key = p.ReceiptBookId + '|' + p.ReceiptNo;
      if (activeNo[key]) bad(receiptRef_(p.ReceiptBookNo, p.ReceiptNo) + ': มีการรับเงินที่มีผลซ้ำเลขที่เดียวกัน (' + activeNo[key] + ', ' + p.PaymentId + ')');
      else activeNo[key] = p.PaymentId;
    });
  });

  check('assessments', 'ไม่มีรายการเรียกเก็บที่ถูกตัดชำระเกินยอดสุทธิ', function (bad) {
    const d = load();
    const lc = ledgerContext_();
    lc.adjustments.forEach(function (ad) {
      if (ad.Status === STATUS.ADJUSTMENT.ACTIVE && !d.byAsm[ad.AssessmentId]) bad('การลดหย่อน/ยกเว้น ' + ad.AdjustmentId + ': ไม่พบรายการเรียกเก็บที่อ้างถึง');
    });
    d.assessments.forEach(function (a) {
      const f = assessmentFigures_(a, lc);
      const ref = 'รายการเรียกเก็บ ' + a.AssessmentId + ' (' + termLabel_(a.Term, a.AcademicYear) + ')';
      if (f.netSatang < 0) bad(ref + ': ลดหย่อน/ยกเว้นเกินยอดเรียกเก็บ');
      if (a.Status === STATUS.ASSESSMENT.CANCELLED && f.paidSatang > 0) bad(ref + ': ยกเลิกแล้วแต่ยังมีการตัดชำระที่มีผล');
      else if (f.paidSatang > f.netSatang && f.netSatang >= 0) bad(ref + ': ตัดชำระเกินยอดสุทธิ');
    });
  });

  check('books', 'สถานะเล่มใบเสร็จสอดคล้องกับเลขที่ที่ใช้', function (bad) {
    const d = load();
    const byBookEntries = Object.create(null);
    d.entries.forEach(function (e) { (byBookEntries[e.BookId] || (byBookEntries[e.BookId] = [])).push(e); });
    const active = d.books.filter(function (b) { return b.Status === STATUS.BOOK.ACTIVE; });
    if (active.length > 1) bad('มีเล่มที่กำลังใช้พร้อมกัน ' + active.length + ' เล่ม: ' + active.map(function (b) { return b.BookNo; }).join(', '));
    d.books.forEach(function (b) {
      const ref = 'เล่มที่ ' + b.BookNo;
      if (b.EndNo < b.StartNo) { bad(ref + ': เลขที่สิ้นสุดน้อยกว่าเลขที่เริ่มต้น'); return; }
      const u = bookUsage_(b, byBookEntries[b.BookId] || []);
      if (b.Status === STATUS.BOOK.ACTIVE && u.remaining === 0 && u.pendingCount === 0) bad(ref + ': ใช้ครบทุกเลขที่แล้ว แต่สถานะยังเป็น "กำลังใช้"');
      if (b.Status === STATUS.BOOK.FULL && u.total - u.usedCount - u.cancelledCount - u.pendingCount > 0) bad(ref + ': สถานะ "ใช้ครบเล่ม" แต่ยังมีเลขที่ที่ไม่ได้ใช้');
      if (b.Status === STATUS.BOOK.CLOSED && !b.ClosedDate) bad(ref + ': ปิดเล่มแล้วแต่ไม่มีวันที่ปิดเล่ม');
      if (b.Status === STATUS.BOOK.REGISTERED && (byBookEntries[b.BookId] || []).some(function (e) { return e.Status !== STATUS.RECEIPT_ENTRY.RELEASED; })) {
        bad(ref + ': ยังไม่เปิดใช้ แต่มีเลขที่ถูกใช้แล้ว');
      }
    });
  });

  check('auditCoverage', 'ทุกรายการการเงินมีประวัติการบันทึกคู่กัน (ไม่มีการเพิ่มแถวในชีตโดยตรง)', function (bad) {
    const logged = Object.create(null);
    dbAll_(SHEETS.AUDIT_LOGS).forEach(function (r) { if (r.EntityId) logged[r.Entity + '|' + r.EntityId] = true; });
    integrityFinancialSheets_().forEach(function (name) {
      const schema = getSchema_(name);
      dbAll_(name).forEach(function (rec) {
        const id = rec[schema.idColumn];
        if (!id || !logged[name + '|' + id]) bad('ชีต "' + schema.label + '" รหัส ' + (id || '(ว่าง)') + ': ไม่มีประวัติการบันทึก (อาจเพิ่มหรือแก้แถวในชีตโดยตรง)');
      });
    });
  });

  check('closings', 'รายการรับเงินของวันที่ปิดยอดแล้วไม่เปลี่ยน', function (bad) {
    const byDate = Object.create(null);
    load().payments.forEach(function (p) {
      if (p.Status !== STATUS.PAYMENT.REPLACED) (byDate[p.PaymentDate] || (byDate[p.PaymentDate] = [])).push(p);
    });
    dbAll_(SHEETS.DAILY_CLOSINGS).forEach(function (c) {
      if (c.Status !== STATUS.CLOSING.CLOSED) return;
      const fig = dayFigures_(c.ClosingDate, (byDate[c.ClosingDate] || []).slice().sort(compareByReceipt_));
      if (fig.digest !== c.Digest) {
        bad('วันที่ ' + formatThaiDate_(c.ClosingDate) + ': รายการรับเงินไม่ตรงกับตอนปิดยอด (รหัสตรวจสอบบนรายงานที่ลงนาม ' + verifyCodeOf_(c.Digest) + ')');
      }
    });
  });

  const problemCount = checks.reduce(function (s, c) { return s + c.count; }, 0);
  return { ok: problemCount === 0, checkedAt: nowIso_(), problemCount: problemCount, checks: checks };
}

/** บันทึกผลการตรวจ: ประวัติการใช้งาน + ผลล่าสุดสำหรับหน้าแรก (ต้องถือ lock) */
function integrityRecord_(result, actor) {
  const failed = result.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.label + ' (' + c.count + ')'; });
  auditAppend_([{
    action: AUDIT_ACTIONS.INTEGRITY_CHECK,
    entity: 'Integrity',
    note: result.ok
      ? 'ตรวจความถูกต้องของข้อมูล ' + result.checks.length + ' ข้อ: ถูกต้องทั้งหมด'
      : 'ตรวจความถูกต้องของข้อมูล: พบปัญหา ' + result.problemCount + ' จุด — ' + failed.join(', '),
  }], actor);
  PropertiesService.getScriptProperties().setProperty(PROP_KEYS.INTEGRITY_LAST, JSON.stringify({
    at: result.checkedAt, ok: result.ok, problemCount: result.problemCount, by: actor.username,
    failed: result.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.key; }),
  }));
}

function integrityLast_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.INTEGRITY_LAST);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// API (ผู้ดูแลระบบ ผู้อำนวยการ)
// ---------------------------------------------------------------------------

/** integrity.check — ตรวจทันที (ทำภายใต้ lock จาก Api.gs) */
function integrityCheck_(ctx) {
  const result = integrityRun_();
  const actor = actorFromCtx_(ctx);
  integrityRecord_(result, actor);
  result.checkedBy = ctx.displayName || ctx.username;
  return result;
}

/** integrity.status — ผลการตรวจครั้งล่าสุด (สำหรับหน้าแรกและหน้าตรวจ) */
function integrityStatus_() {
  const last = integrityLast_();
  if (last && last.by) last.byName = last.by === ACTORS.SYSTEM.username ? 'ระบบ (ตรวจอัตโนมัติ)' : displayNameOf_(last.by, userDisplayNames_());
  return { last: last, today: todayIso_() };
}
