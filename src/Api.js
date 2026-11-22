/**
 * ============================================================================
 *  Api.gs — ทางเข้าเดียวของข้อมูลทั้งหมดจากหน้าเว็บ
 * ----------------------------------------------------------------------------
 *  หน้าเว็บเรียก google.script.run.api({ action, token, payload }) เท่านั้น
 *  ทุกคำขอผ่านขั้นตอนเดียวกัน:
 *   1. action ต้องอยู่ในตาราง apiActions_() (ไม่อยู่ = ปฏิเสธ)
 *   2. ตรวจ session จาก token และอ่านบทบาทล่าสุดจากชีต Users
 *   3. ถ้าผู้ใช้ต้องเปลี่ยนรหัสผ่าน ใช้ได้เฉพาะคำสั่งที่จำเป็น
 *   4. ตรวจบทบาทตามตาราง (ถูกปฏิเสธ = บันทึก ACCESS_DENIED)
 *   5. คำสั่งที่บันทึกข้อมูลทำภายใต้ LockService (ตรวจ session ภายใน lock ด้วย)
 *   6. ตอบกลับ { ok: true, data } หรือ { ok: false, error: { code, message } }
 *      ไม่ส่งรายละเอียดข้อผิดพลาดภายในหรือ stack trace ออกไป
 *
 *  ตารางสิทธิ์ทั้งหมดอยู่ใน apiActions_() ที่เดียว ตรวจทานได้ในที่เดียว
 * ============================================================================
 */

let API_ACTIONS_ = null;

/**
 * ตารางคำสั่งและสิทธิ์
 *  roles    บทบาทที่ใช้คำสั่งได้
 *  public   ไม่ต้องเข้าสู่ระบบ (เฉพาะคำสั่งเข้าสู่ระบบ)
 *  write    บันทึกข้อมูล = ทำภายใต้ LockService
 *  allowWhenMustChangePassword  ใช้ได้แม้ยังไม่ได้เปลี่ยนรหัสผ่านชั่วคราว
 */
function apiActions_() {
  if (API_ACTIONS_) return API_ACTIONS_;
  const ALL = [ROLES.ADMIN, ROLES.FINANCE, ROLES.DIRECTOR];
  const ADMIN = [ROLES.ADMIN];
  const OVERSIGHT = [ROLES.ADMIN, ROLES.DIRECTOR];
  const FINANCE = [ROLES.FINANCE];
  const STUDENT_VIEW = [ROLES.FINANCE, ROLES.DIRECTOR];
  const FINANCE_VIEW = [ROLES.FINANCE, ROLES.DIRECTOR];
  const DIRECTOR = [ROLES.DIRECTOR];
  API_ACTIONS_ = {
    // การเข้าสู่ระบบ
    'auth.login': { public: true, write: true, handler: authLogin_ },
    'auth.loginGoogle': { public: true, write: true, handler: authLoginGoogle_ },
    'auth.me': { roles: ALL, write: false, allowWhenMustChangePassword: true, handler: authMe_ },
    'auth.logout': { roles: ALL, write: true, allowWhenMustChangePassword: true, handler: authLogout_ },
    'auth.changePassword': { roles: ALL, write: true, allowWhenMustChangePassword: true, handler: authChangePassword_ },
    // ผู้ใช้งาน
    'users.list': { roles: ADMIN, write: false, handler: usersList_ },
    'users.create': { roles: ADMIN, write: true, handler: usersCreate_ },
    'users.update': { roles: ADMIN, write: true, handler: usersUpdate_ },
    'users.resetPassword': { roles: ADMIN, write: true, handler: usersResetPassword_ },
    // ค่าตั้งค่าโรงเรียน
    'settings.get': { roles: ALL, write: false, handler: settingsGet_ },
    'settings.update': { roles: ADMIN, write: true, handler: settingsUpdate_ },
    // ปีการศึกษา
    'years.list': { roles: ALL, write: false, handler: yearsList_ },
    'years.create': { roles: ADMIN, write: true, handler: yearsCreate_ },
    'years.update': { roles: ADMIN, write: true, handler: yearsUpdate_ },
    'years.setCurrent': { roles: ADMIN, write: true, handler: yearsSetCurrent_ },
    // ประวัติการใช้งาน
    'audit.list': { roles: OVERSIGHT, write: false, handler: auditList_ },
    'audit.verify': { roles: OVERSIGHT, write: true, handler: auditVerify_ },
    // นักเรียน (ผู้ดูแลระบบไม่เห็นข้อมูลนักเรียน ตามหลักสิทธิ์น้อยที่สุด)
    'students.list': { roles: STUDENT_VIEW, write: false, handler: studentsList_ },
    'students.get': { roles: STUDENT_VIEW, write: false, handler: studentsGet_ },
    'students.create': { roles: FINANCE, write: true, handler: studentsCreate_ },
    'students.update': { roles: FINANCE, write: true, handler: studentsUpdate_ },
    'students.setStatus': { roles: FINANCE, write: true, handler: studentsSetStatus_ },
    'students.importPreview': { roles: FINANCE, write: false, handler: studentsImportPreview_ },
    'students.importCommit': { roles: FINANCE, write: true, handler: studentsImportCommit_ },
    'students.promotePreview': { roles: FINANCE, write: false, handler: studentsPromotePreview_ },
    'students.promoteCommit': { roles: FINANCE, write: true, handler: studentsPromoteCommit_ },
    // อัตราเงินบำรุงและรายการเรียกเก็บ (ผู้ดูแลระบบไม่เห็นข้อมูลการเงิน)
    'fees.list': { roles: FINANCE_VIEW, write: false, handler: feesList_ },
    'fees.create': { roles: FINANCE, write: true, handler: feesCreate_ },
    'fees.update': { roles: FINANCE, write: true, handler: feesUpdate_ },
    'assessments.list': { roles: FINANCE_VIEW, write: false, handler: assessmentsList_ },
    'assessments.preview': { roles: FINANCE, write: false, handler: assessmentsPreview_ },
    'assessments.generate': { roles: FINANCE, write: true, handler: assessmentsGenerate_ },
    'assessments.createOne': { roles: FINANCE, write: true, handler: assessmentsCreateOne_ },
    'assessments.requestCancel': { roles: FINANCE, write: true, handler: assessmentsRequestCancel_ },
    'adjustments.request': { roles: FINANCE, write: true, handler: adjustmentsRequest_ },
    'adjustments.revoke': { roles: DIRECTOR, write: true, handler: adjustmentsRevoke_ },
    // บัญชีการเงินของนักเรียน
    'ledger.students': { roles: FINANCE_VIEW, write: false, handler: ledgerStudents_ },
    'ledger.student': { roles: FINANCE_VIEW, write: false, handler: ledgerStudent_ },
    'arrears.summary': { roles: FINANCE_VIEW, write: false, handler: arrearsSummary_ },
    // คำขออนุมัติ: เจ้าหน้าที่ยื่น/ถอน ผู้อำนวยการพิจารณา
    'approvals.list': { roles: FINANCE_VIEW, write: false, handler: approvalsList_ },
    'approvals.decide': { roles: DIRECTOR, write: true, handler: approvalsDecide_ },
    'approvals.withdraw': { roles: FINANCE, write: true, handler: approvalsWithdraw_ },
    // ทะเบียนเล่มใบเสร็จ
    'receipts.books': { roles: FINANCE_VIEW, write: false, handler: receiptsBooks_ },
    'receipts.registerBook': { roles: FINANCE, write: true, handler: receiptsRegisterBook_ },
    'receipts.updateBook': { roles: FINANCE, write: true, handler: receiptsUpdateBook_ },
    'receipts.activateBook': { roles: FINANCE, write: true, handler: receiptsActivateBook_ },
    'receipts.book': { roles: FINANCE_VIEW, write: false, handler: receiptsBook_ },
    'receipts.requestCancelNumber': { roles: FINANCE, write: true, handler: receiptsRequestCancelNumber_ },
    'receipts.requestCloseBook': { roles: FINANCE, write: true, handler: receiptsRequestCloseBook_ },
    // รับชำระเงิน
    'payments.context': { roles: FINANCE, write: false, handler: paymentsContext_ },
    'payments.create': { roles: FINANCE, write: true, handler: paymentsCreate_ },
    'payments.list': { roles: FINANCE_VIEW, write: false, handler: paymentsList_ },
    'payments.get': { roles: FINANCE_VIEW, write: false, handler: paymentsGet_ },
    'payments.requestVoid': { roles: FINANCE, write: true, handler: paymentsRequestVoid_ },
    'payments.requestCorrection': { roles: FINANCE, write: true, handler: paymentsRequestCorrection_ },
    // ภาพรวม รายงาน และการปิดยอดประจำวัน
    'dashboard.summary': { roles: FINANCE_VIEW, write: false, handler: dashboardSummary_ },
    'reports.daily': { roles: FINANCE_VIEW, write: false, handler: reportsDaily_ },
    'reports.collections': { roles: FINANCE_VIEW, write: false, handler: reportsCollections_ },
    'reports.cancelled': { roles: FINANCE_VIEW, write: false, handler: reportsCancelled_ },
    'reports.annual': { roles: FINANCE_VIEW, write: false, handler: reportsAnnual_ },
    'reports.receiptUsage': { roles: FINANCE_VIEW, write: false, handler: reportsReceiptUsage_ },
    'reports.notices': { roles: FINANCE_VIEW, write: false, handler: reportsNotices_ },
    'closings.list': { roles: FINANCE_VIEW, write: false, handler: closingsList_ },
    'closings.close': { roles: FINANCE, write: true, handler: closingsClose_ },
    'closings.reopen': { roles: DIRECTOR, write: true, handler: closingsReopen_ },
    // สำรองและกู้คืนข้อมูล (ผู้ดูแลระบบ: เห็นเฉพาะรายชื่อไฟล์และจำนวนแถว ไม่เห็นรายละเอียดการเงิน)
    'backups.status': { roles: ADMIN, write: false, handler: backupsStatus_ },
    'backups.list': { roles: ADMIN, write: false, handler: backupsList_ },
    'backups.create': { roles: ADMIN, write: true, handler: backupsCreate_ },
    'backups.setSchedule': { roles: ADMIN, write: true, handler: backupsSetSchedule_ },
    'backups.restorePreview': { roles: ADMIN, write: false, handler: backupsRestorePreview_ },
    'backups.restore': { roles: ADMIN, write: true, handler: backupsRestore_ },
    // ตรวจความถูกต้องของข้อมูล (ตรวจภายใต้ lock และบันทึกประวัติ)
    'integrity.check': { roles: OVERSIGHT, write: true, handler: integrityCheck_ },
    'integrity.status': { roles: OVERSIGHT, write: false, handler: integrityStatus_ },
  };
  Object.keys(API_ACTIONS_).forEach(function (k) { Object.freeze(API_ACTIONS_[k]); });
  Object.freeze(API_ACTIONS_);
  return API_ACTIONS_;
}

/** ทางเข้าเดียวจากหน้าเว็บ */
function api(request) {
  try {
    const req = request && typeof request === 'object' && !Array.isArray(request) ? request : {};
    const action = typeof req.action === 'string' ? req.action : '';
    const actions = apiActions_();
    if (!Object.prototype.hasOwnProperty.call(actions, action)) {
      throw appError_(ERROR_CODES.FORBIDDEN, 'ไม่มีสิทธิ์ใช้งานคำสั่งนี้');
    }
    const def = actions[action];
    const payload = req.payload && typeof req.payload === 'object' && !Array.isArray(req.payload) ? req.payload : {};
    const execute = function () {
      const ctx = def.public ? null : authorizeRequest_(req.token, def, action);
      return def.handler(ctx, payload);
    };
    const data = def.write ? withScriptLock_(execute) : execute();
    return { ok: true, data: data === undefined ? null : data };
  } catch (e) {
    return apiErrorResponse_(e);
  }
}

/** ตรวจ session และสิทธิ์ของคำขอ คืนค่า ctx ของผู้ใช้ */
function authorizeRequest_(token, def, action) {
  const ctx = authenticate_(token);
  if (ctx.mustChangePassword && !def.allowWhenMustChangePassword) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งานระบบ', { reason: 'PASSWORD_CHANGE_REQUIRED' });
  }
  if (def.roles.indexOf(ctx.role) === -1) {
    auditAccessDenied_(ctx, action);
    throw appError_(ERROR_CODES.FORBIDDEN, 'ไม่มีสิทธิ์ใช้งานคำสั่งนี้');
  }
  return ctx;
}

/** บันทึกความพยายามใช้คำสั่งที่ไม่มีสิทธิ์ (หน้าเว็บปกติจะไม่ส่งคำสั่งเหล่านี้) */
function auditAccessDenied_(ctx, action) {
  try {
    withScriptLock_(function () {
      auditAppend_([{
        action: AUDIT_ACTIONS.ACCESS_DENIED,
        entity: 'Api',
        entityId: action,
        note: 'พยายามใช้คำสั่งที่ไม่มีสิทธิ์',
      }], actorFromCtx_(ctx));
    }, 5000);
  } catch (e) {
    console.error('บันทึก ACCESS_DENIED ไม่สำเร็จ');
  }
}

/** แปลงข้อผิดพลาดเป็นคำตอบที่ปลอดภัยต่อการส่งให้หน้าเว็บ */
function apiErrorResponse_(e) {
  if (isAppError_(e)) {
    const error = { code: e.code, message: e.userMessage };
    if (e.details && typeof e.details.reason === 'string') error.reason = e.details.reason;
    return { ok: false, error: error };
  }
  console.error('API error: ' + (e && e.name ? e.name : 'Error') + ': ' + (e && e.message ? e.message : String(e)));
  return { ok: false, error: { code: ERROR_CODES.INTERNAL, message: safeErrorMessage_(e) } };
}
