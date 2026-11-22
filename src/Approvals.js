/**
 * ============================================================================
 *  Approvals.gs — คำขออนุมัติ (คิวเดียวสำหรับผู้อำนวยการ)
 * ----------------------------------------------------------------------------
 *  เจ้าหน้าที่ยื่นคำขอพร้อมเหตุผล → PENDING
 *    → ผู้อำนวยการอนุมัติ   : ระบบตรวจเงื่อนไขใหม่ภายใต้ lock แล้วดำเนินการตามคำขอ
 *    → ผู้อำนวยการไม่อนุมัติ : ไม่มีผลกับข้อมูล (ต้องระบุเหตุผล)
 *    → ผู้ยื่นถอนคำขอ      : ไม่มีผลกับข้อมูล
 *  - ระหว่างรออนุมัติ ข้อมูลเดิมยังมีผลตามเดิม
 *  - ผู้ยื่นคำขออนุมัติคำขอของตนเองไม่ได้ (ตรวจที่ Server)
 *  - ปิด "ต้องอนุมัติ" ในหน้าตั้งค่าแล้ว คำขอประเภทนั้นจะมีผลทันที และบันทึกผู้ทำรายการไว้ในประวัติ
 *  - ตัวดำเนินการของแต่ละประเภทอยู่ใน approvalHandlers_() ที่เดียว
 *    approve = ทำตามคำขอ (ตรวจเงื่อนไขใหม่) / release = คืนสิ่งที่กันไว้เมื่อไม่อนุมัติหรือถอนคำขอ
 * ============================================================================
 */

/** ประเภทคำขอนี้ต้องให้ผู้อำนวยการอนุมัติหรือไม่ (ตามหน้าตั้งค่า) */
function approvalRequired_(type) {
  return getSetting_('APPROVAL_' + type) === true;
}

/**
 * ตัวดำเนินการของคำขอแต่ละประเภท
 *  approve(data, request, actor, note)          อนุมัติ: ตรวจเงื่อนไขใหม่ทุกครั้ง ถ้าไม่ผ่านจะ error และคำขอยังรออนุมัติ
 *  release(data, request, actor, outcome, note) ไม่อนุมัติ/ถอนคำขอ: คืนสิ่งที่กันไว้ระหว่างรอ (ถ้ามี)
 */
function approvalHandlers_() {
  return {
    FEE_ADJUSTMENT: {
      approve: function (data, request, actor) { applyFeeAdjustment_(data, request.CreatedBy, actor.username, request.RequestId, actor); },
    },
    ASSESSMENT_CANCEL: {
      approve: function (data, request, actor) { applyAssessmentCancel_(data, request.CreatedBy, request.RequestId, actor); },
    },
    RECEIPT_CANCEL: {
      approve: function (data, request, actor, note) { applyReceiptCancel_(data, request.RequestId, actor, note); },
      release: function (data, request, actor, outcome, note) { releaseReceiptCancel_(data, actor, outcome, note); },
    },
    PAYMENT_CORRECTION: {
      approve: function (data, request, actor) { applyPaymentCorrection_(data, request.Reason, request.RequestId, actor); },
    },
    BOOK_CLOSE: {
      approve: function (data, request, actor) { applyBookClose_(data, actor); },
    },
  };
}

/** presetId = รหัสที่จองไว้ด้วย dbReserveId_() เมื่อรายการอื่นต้องอ้างรหัสคำขอตั้งแต่บันทึกครั้งแรก */
function createApprovalRequest_(type, refId, studentId, summary, data, reason, actor, presetId) {
  return dbInsert_(SHEETS.APPROVAL_REQUESTS, {
    RequestId: presetId || '',
    RequestType: type,
    RefId: refId,
    StudentId: studentId || '',
    Summary: summary,
    PayloadJson: JSON.stringify(data),
    Reason: reason,
    Status: STATUS.DECISION.PENDING,
  }, actor, { action: AUDIT_ACTIONS.REQUEST, note: summary });
}

/** คำขอที่รออนุมัติ แยกตามรายการที่อ้างถึง (ใช้ปิดปุ่มในหน้าเว็บระหว่างรอ) */
function pendingRequestsByRef_() {
  const out = Object.create(null);
  dbAll_(SHEETS.APPROVAL_REQUESTS).forEach(function (r) {
    if (r.Status === STATUS.DECISION.PENDING && r.RefId) {
      out[r.RefId] = { requestId: r.RequestId, type: r.RequestType, typeLabel: STATUS_LABELS.REQUEST_TYPE[r.RequestType] || r.RequestType };
    }
  });
  return out;
}

function parseRequestData_(r) {
  try {
    const data = JSON.parse(r.PayloadJson || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    return {};
  }
}

function approvalDto_(r, students, names) {
  const s = students[r.StudentId];
  const data = parseRequestData_(r);
  return {
    requestId: r.RequestId,
    type: r.RequestType,
    typeLabel: STATUS_LABELS.REQUEST_TYPE[r.RequestType] || r.RequestType,
    refId: r.RefId,
    studentId: r.StudentId,
    studentNo: s ? s.StudentNo : '',
    studentName: s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) : '',
    summary: r.Summary,
    reason: r.Reason,
    amountSatang: typeof data.amountSatang === 'number' ? data.amountSatang : null,
    referenceDoc: typeof data.referenceDoc === 'string' ? data.referenceDoc : '',
    details: Array.isArray(data.display) ? data.display.map(function (d) {
      return { label: String(d.label), before: String(d.before), after: String(d.after), changed: d.changed === true };
    }) : [],
    status: r.Status,
    statusLabel: STATUS_LABELS.DECISION[r.Status] || r.Status,
    requestedBy: r.CreatedBy,
    requestedByName: displayNameOf_(r.CreatedBy, names),
    createdAt: r.CreatedAt,
    decidedByName: displayNameOf_(r.DecidedBy, names),
    decidedAt: r.DecidedAt,
    decisionNote: r.DecisionNote,
  };
}

function requirePendingRequest_(value) {
  const id = requireId_(value, 'APR', 'รหัสคำขอ');
  const r = dbGet_(SHEETS.APPROVAL_REQUESTS, id);
  if (!r) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบคำขอนี้');
  if (r.Status !== STATUS.DECISION.PENDING) {
    throw appError_(ERROR_CODES.CONFLICT, 'คำขอนี้' + (STATUS_LABELS.DECISION[r.Status] || r.Status) + 'แล้ว');
  }
  return r;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** approvals.list — คำขอที่รออนุมัติ (เรียงเก่าก่อน) หรือทั้งหมด (ล่าสุดก่อน 300 รายการ) */
function approvalsList_(ctx, payload) {
  const showAll = payload.status === 'ALL';
  const names = userDisplayNames_();
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const all = dbAll_(SHEETS.APPROVAL_REQUESTS);
  let rows = all
    .filter(function (r) { return showAll || r.Status === STATUS.DECISION.PENDING; })
    .map(function (r) { return approvalDto_(r, students, names); })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0); });
  if (showAll) rows = rows.reverse().slice(0, 300);
  return {
    status: showAll ? 'ALL' : 'PENDING',
    rows: rows,
    pendingCount: all.filter(function (r) { return r.Status === STATUS.DECISION.PENDING; }).length,
    canDecide: ctx.role === ROLES.DIRECTOR,
    me: ctx.username,
  };
}

/** approvals.decide — ผู้อำนวยการอนุมัติหรือไม่อนุมัติ (ไม่อนุมัติต้องระบุเหตุผล) */
function approvalsDecide_(ctx, payload) {
  const r = requirePendingRequest_(payload.requestId);
  const decision = requireEnum_(payload.decision, { APPROVE: 'APPROVE', REJECT: 'REJECT' }, 'ผลการพิจารณา');
  const approve = decision === 'APPROVE';
  const note = requireText_(payload.note, 'เหตุผลที่ไม่อนุมัติ', { optional: approve, max: 500, multiline: true });
  if (r.CreatedBy === ctx.username) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'ผู้ยื่นคำขอพิจารณาคำขอของตนเองไม่ได้');
  }
  const actor = actorFromCtx_(ctx);
  const handler = approvalHandlers_()[r.RequestType];
  if (!handler) throw appError_(ERROR_CODES.CONFLICT, 'ระบบยังไม่รองรับการพิจารณาคำขอประเภทนี้');
  const status = approve ? STATUS.DECISION.APPROVED : STATUS.DECISION.REJECTED;
  if (approve) handler.approve(parseRequestData_(r), r, actor, note);
  else if (handler.release) handler.release(parseRequestData_(r), r, actor, status, note);
  dbUpdate_(SHEETS.APPROVAL_REQUESTS, r.RequestId, {
    Status: status,
    DecidedBy: ctx.username,
    DecidedAt: nowIso_(),
    DecisionNote: note,
  }, actor, { action: approve ? AUDIT_ACTIONS.APPROVE : AUDIT_ACTIONS.REJECT, note: r.Summary });
  return {
    requestId: r.RequestId,
    status: status,
    message: (approve ? 'อนุมัติ' : 'ไม่อนุมัติ') + 'คำขอเรียบร้อยแล้ว',
  };
}

/** approvals.withdraw — ผู้ยื่นถอนคำขอที่ยังรออนุมัติ */
function approvalsWithdraw_(ctx, payload) {
  const r = requirePendingRequest_(payload.requestId);
  if (r.CreatedBy !== ctx.username) throw appError_(ERROR_CODES.FORBIDDEN, 'ถอนได้เฉพาะคำขอที่ตนเองยื่น');
  const note = requireText_(payload.note, 'เหตุผลการถอนคำขอ', { optional: true, max: 300 });
  const handler = approvalHandlers_()[r.RequestType];
  if (handler && handler.release) handler.release(parseRequestData_(r), r, actorFromCtx_(ctx), STATUS.DECISION.WITHDRAWN, note || 'ผู้ยื่นถอนคำขอ');
  dbUpdate_(SHEETS.APPROVAL_REQUESTS, r.RequestId, {
    Status: STATUS.DECISION.WITHDRAWN,
    DecidedBy: ctx.username,
    DecidedAt: nowIso_(),
    DecisionNote: note || 'ผู้ยื่นถอนคำขอ',
  }, actorFromCtx_(ctx), { action: AUDIT_ACTIONS.CANCEL, note: 'ถอนคำขอ: ' + r.Summary });
  return { requestId: r.RequestId, message: 'ถอนคำขอเรียบร้อยแล้ว' };
}
