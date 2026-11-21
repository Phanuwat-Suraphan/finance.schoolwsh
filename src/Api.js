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
