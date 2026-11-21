/**
 * ============================================================================
 *  Users.gs — จัดการบัญชีผู้ใช้ (ผู้ดูแลระบบเท่านั้น ตรวจสิทธิ์ใน Api.gs)
 * ----------------------------------------------------------------------------
 *  กฎที่บังคับ
 *   - ไม่มีการลบผู้ใช้ ใช้ "ปิดการใช้งาน" แทน (ประวัติการทำรายการยังอ้างถึงผู้ใช้ได้)
 *   - ชื่อผู้ใช้เปลี่ยนไม่ได้ และห้ามซ้ำแม้ผู้ใช้เดิมถูกปิดการใช้งานแล้ว
 *   - เปลี่ยนบทบาทหรือปิดบัญชีของตนเองไม่ได้ (กันผู้ดูแลระบบล็อกตัวเองออก)
 *   - ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คนเสมอ
 *   - เปลี่ยนบทบาท ปิดบัญชี หรือรีเซ็ตรหัสผ่าน = การเข้าสู่ระบบเดิมของผู้ใช้นั้นหมดอายุทันที
 *   - รหัสผ่านชั่วคราวผู้ดูแลระบบเป็นผู้กำหนดเอง (ระบบไม่สุ่มและไม่แสดงรหัสผ่านบนหน้าเว็บ)
 *     และผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก
 * ============================================================================
 */

/** users.list */
function usersList_() {
  const roleOrder = { ADMIN: 1, DIRECTOR: 2, FINANCE: 3 };
  return dbAll_(SHEETS.USERS)
    .sort(function (a, b) {
      if (a.Status !== b.Status) return a.Status === STATUS.USER.ACTIVE ? -1 : 1;
      const r = (roleOrder[a.Role] || 9) - (roleOrder[b.Role] || 9);
      return r !== 0 ? r : (a.Username < b.Username ? -1 : 1);
    })
    .map(userDto_);
}

function activeAdminCount_() {
  return dbFind_(SHEETS.USERS, function (u) {
    return u.Role === ROLES.ADMIN && u.Status === STATUS.USER.ACTIVE;
  }).length;
}

/** users.create */
function usersCreate_(ctx, payload) {
  const mode = authMode_();
  const username = normalizeUsername_(payload.username);
  const fields = {
    Username: username,
    DisplayName: requireText_(payload.displayName, 'ชื่อ-นามสกุล', { max: 100 }),
    Position: requireText_(payload.position, 'ตำแหน่ง', { optional: true, max: 100 }),
    Email: normalizeEmail_(payload.email, mode === AUTH_MODES.GOOGLE),
    Role: requireEnum_(payload.role, ROLES, 'บทบาท'),
    Status: STATUS.USER.ACTIVE,
    SessionVersion: 1,
    MustChangePassword: false,
  };
  if (mode === AUTH_MODES.PASSWORD) {
    const password = validateNewPassword_(payload.tempPassword, username);
    fields.PasswordHash = hashPassword_(password);
    fields.MustChangePassword = true;
  }
  const rec = dbInsert_(SHEETS.USERS, fields, actorFromCtx_(ctx), { note: 'ผู้ดูแลระบบเพิ่มผู้ใช้' });
  return userDto_(rec);
}

/** users.update — ชื่อ ตำแหน่ง อีเมล บทบาท และสถานะ */
function usersUpdate_(ctx, payload) {
  const id = requireId_(payload.userId, 'USR', 'รหัสผู้ใช้');
  const user = dbGet_(SHEETS.USERS, id);
  if (!user) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ใช้ที่ต้องการแก้ไข');
  const mode = authMode_();
  const role = requireEnum_(payload.role, ROLES, 'บทบาท');
  const status = requireEnum_(payload.status, STATUS.USER, 'สถานะ');
  const changes = {
    DisplayName: requireText_(payload.displayName, 'ชื่อ-นามสกุล', { max: 100 }),
    Position: requireText_(payload.position, 'ตำแหน่ง', { optional: true, max: 100 }),
    Email: normalizeEmail_(payload.email, mode === AUTH_MODES.GOOGLE),
    Role: role,
    Status: status,
  };
  const accessChanged = role !== user.Role || status !== user.Status;
  if (id === ctx.userId && accessChanged) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'เปลี่ยนบทบาทหรือปิดการใช้งานบัญชีของตนเองไม่ได้ ให้ผู้ดูแลระบบคนอื่นดำเนินการ');
  }
  const losesAdmin = user.Role === ROLES.ADMIN && user.Status === STATUS.USER.ACTIVE &&
    (role !== ROLES.ADMIN || status !== STATUS.USER.ACTIVE);
  if (losesAdmin && activeAdminCount_() <= 1) {
    throw appError_(ERROR_CODES.CONFLICT, 'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
  }
  if (accessChanged || (mode === AUTH_MODES.GOOGLE && changes.Email !== user.Email)) {
    changes.SessionVersion = (user.SessionVersion || 0) + 1;
  }
  const res = dbUpdate_(SHEETS.USERS, id, changes, actorFromCtx_(ctx));
  return userDto_(res.after);
}

/** users.resetPassword — ผู้ดูแลระบบกำหนดรหัสผ่านชั่วคราวให้ผู้ใช้อื่น */
function usersResetPassword_(ctx, payload) {
  if (authMode_() !== AUTH_MODES.PASSWORD) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'ระบบนี้ใช้บัญชี Google จึงไม่มีรหัสผ่านของระบบ');
  }
  const id = requireId_(payload.userId, 'USR', 'รหัสผู้ใช้');
  if (id === ctx.userId) throw appError_(ERROR_CODES.FORBIDDEN, 'กรุณาเปลี่ยนรหัสผ่านของตนเองที่เมนู "เปลี่ยนรหัสผ่าน"');
  const user = dbGet_(SHEETS.USERS, id);
  if (!user) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบผู้ใช้');
  const password = validateNewPassword_(payload.tempPassword, user.Username);
  dbUpdate_(SHEETS.USERS, id, {
    PasswordHash: hashPassword_(password),
    MustChangePassword: true,
    SessionVersion: (user.SessionVersion || 0) + 1,
  }, actorFromCtx_(ctx), { action: AUDIT_ACTIONS.PASSWORD_CHANGE, note: 'ผู้ดูแลระบบรีเซ็ตรหัสผ่าน' });
  clearLoginFailures_(user.Username);
  return userDto_(dbGet_(SHEETS.USERS, id));
}
