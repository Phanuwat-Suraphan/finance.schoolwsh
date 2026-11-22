/**
 * ============================================================================
 *  Auth.gs — การยืนยันตัวตน รหัสผ่าน และ session
 * ----------------------------------------------------------------------------
 *  รหัสผ่าน
 *   - เก็บเฉพาะค่าแฮช รูปแบบ v1$รอบ$salt$hash (HMAC-SHA256 วนซ้ำ + salt ต่อผู้ใช้ + pepper ใน Script Properties)
 *   - จำนวนรอบปรับตามความเร็วของเครื่อง Google ตอนติดตั้ง และระบบแฮชใหม่ให้อัตโนมัติเมื่อจำนวนรอบเพิ่ม
 *   - เทียบค่าแฮชแบบใช้เวลาคงที่ และคำนวณแฮชเสมอแม้ไม่พบชื่อผู้ใช้ (กันการเดาว่าชื่อใดมีอยู่)
 *  การเข้าสู่ระบบ
 *   - ใส่รหัสผิดเกินกำหนด ล็อกชื่อผู้ใช้นั้นชั่วคราว (นับตามชื่อผู้ใช้ แม้ไม่มีชื่อนั้นในระบบ)
 *   - ประวัติการเข้าสู่ระบบไม่สำเร็จ จะไม่บันทึกข้อความที่พิมพ์มาถ้าไม่ใช่ชื่อผู้ใช้จริง
 *     (กันกรณีพิมพ์รหัสผ่านลงช่องชื่อผู้ใช้โดยไม่ตั้งใจ)
 *  Session
 *   - token สุ่ม 256 บิต เก็บใน CacheService เป็นค่าแฮชของ token
 *   - หมดอายุเมื่อไม่ใช้งาน และมีอายุสูงสุด ตรวจสถานะ/บทบาทล่าสุดจากชีต Users ทุกคำขอ
 *   - เพิ่ม SessionVersion ของผู้ใช้ = ทุก session เดิมของผู้ใช้นั้นใช้ไม่ได้ทันที
 * ============================================================================
 */

const SESSION_KEY_PREFIX_ = 'sess:';
const LOGIN_FAIL_KEY_PREFIX_ = 'lfail:';
const LOGIN_FAILED_MESSAGE_ = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

// ---------------------------------------------------------------------------
// โหมดการเข้าสู่ระบบ
// ---------------------------------------------------------------------------

function authMode_() {
  const mode = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.AUTH_MODE);
  return mode === AUTH_MODES.GOOGLE ? AUTH_MODES.GOOGLE : AUTH_MODES.PASSWORD;
}

// ---------------------------------------------------------------------------
// ผู้กระทำ (ใช้บันทึก AuditLogs)
// ---------------------------------------------------------------------------

function actorFromUser_(user) {
  return { userId: user.UserId, username: user.Username, role: user.Role };
}

function actorFromCtx_(ctx) {
  return { userId: ctx.userId, username: ctx.username, role: ctx.role };
}

// ---------------------------------------------------------------------------
// รหัสผ่าน
// ---------------------------------------------------------------------------

function passwordPepper_() {
  const pepper = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.PASSWORD_PEPPER);
  if (!pepper) throw appError_(ERROR_CODES.INTERNAL, 'ระบบยังไม่ได้ติดตั้งค่าความปลอดภัย ' + SETUP_HINT_);
  return pepper;
}

function passwordHashIterations_() {
  const n = Number(PropertiesService.getScriptProperties().getProperty(PROP_KEYS.PASSWORD_HASH_ITERATIONS));
  if (!Number.isInteger(n)) return AUTH.HASH_DEFAULT_ITERATIONS;
  return Math.min(AUTH.HASH_MAX_ITERATIONS, Math.max(AUTH.HASH_MIN_ITERATIONS, n));
}

/** HMAC-SHA256 วนซ้ำ คืนค่าฐานสิบหก */
function derivePasswordHash_(password, saltHex, iterations) {
  const pepper = passwordPepper_();
  let hash = bytesToHex_(Utilities.computeHmacSha256Signature(saltHex + '|' + password, pepper, Utilities.Charset.UTF_8));
  for (let i = 1; i < iterations; i++) {
    hash = bytesToHex_(Utilities.computeHmacSha256Signature(hash + '|' + saltHex, pepper));
  }
  return hash;
}

function hashPassword_(password) {
  const salt = randomHex_(32).toLowerCase();
  const iterations = passwordHashIterations_();
  return [AUTH.HASH_VERSION, iterations, salt, derivePasswordHash_(password, salt, iterations)].join('$');
}

/** ตรวจรหัสผ่าน คืนค่า { ok, needsRehash } */
function verifyPassword_(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== AUTH.HASH_VERSION || !/^[0-9a-f]{32}$/.test(parts[2])) {
    // รูปแบบไม่ถูกต้อง: ยังคำนวณแฮชเพื่อให้ใช้เวลาเท่ากัน
    derivePasswordHash_(String(password), randomHex_(32).toLowerCase(), passwordHashIterations_());
    return { ok: false, needsRehash: false };
  }
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > AUTH.HASH_MAX_ITERATIONS * 4) {
    return { ok: false, needsRehash: false };
  }
  const actual = derivePasswordHash_(String(password), parts[2], iterations);
  return { ok: constantTimeEquals_(actual, parts[3]), needsRehash: iterations < passwordHashIterations_() };
}

function constantTimeEquals_(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/** นโยบายรหัสผ่าน: 8–128 ตัว มีทั้งตัวอักษรและตัวเลข ไม่มีชื่อผู้ใช้อยู่ในรหัสผ่าน */
function validateNewPassword_(password, username) {
  if (typeof password !== 'string' || password === '') throw validationError_('กรุณากรอกรหัสผ่าน');
  if (password.length < AUTH.PASSWORD_MIN_LENGTH) throw validationError_('รหัสผ่านต้องมีอย่างน้อย ' + AUTH.PASSWORD_MIN_LENGTH + ' ตัวอักษร');
  if (password.length > AUTH.PASSWORD_MAX_LENGTH) throw validationError_('รหัสผ่านยาวเกิน ' + AUTH.PASSWORD_MAX_LENGTH + ' ตัวอักษร');
  if (!/[A-Za-zก-ฮ]/.test(password) || !/[0-9]/.test(password)) throw validationError_('รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข');
  if (/^\s|\s$/.test(password)) throw validationError_('รหัสผ่านต้องไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง');
  if (username && password.toLowerCase().indexOf(String(username).toLowerCase()) !== -1) {
    throw validationError_('รหัสผ่านต้องไม่มีชื่อผู้ใช้อยู่ในรหัสผ่าน');
  }
  return password;
}

/** ชื่อผู้ใช้: ตัวพิมพ์เล็ก a-z ขึ้นต้น ตามด้วย a-z 0-9 . _ - รวม 3–32 ตัว */
function normalizeUsername_(value) {
  const username = requireText_(value, 'ชื่อผู้ใช้', { max: 32 }).toLowerCase();
  if (!new RegExp(AUTH.USERNAME_PATTERN).test(username)) {
    throw validationError_('ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษตัวพิมพ์เล็ก ขึ้นต้นด้วยตัวอักษร ใช้ได้เฉพาะ a-z 0-9 . _ - และยาว 3–32 ตัว');
  }
  return username;
}

function normalizeEmail_(value, required) {
  const email = requireText_(value, 'อีเมล', { optional: !required, max: 254 }).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validationError_('รูปแบบอีเมลไม่ถูกต้อง');
  return email;
}

/** วัดความเร็วการแฮชบนเครื่อง Google แล้วเลือกจำนวนรอบให้ใช้เวลาประมาณ AUTH.HASH_TARGET_MS */
function calibrateHashIterations_() {
  const sample = 200;
  const started = Date.now();
  derivePasswordHash_('calibration-password-1', 'c0ffee00c0ffee00c0ffee00c0ffee00', sample);
  const perIteration = Math.max(Date.now() - started, 1) / sample;
  const target = Math.round(AUTH.HASH_TARGET_MS / perIteration);
  return Math.min(AUTH.HASH_MAX_ITERATIONS, Math.max(AUTH.HASH_MIN_ITERATIONS, target));
}

// ---------------------------------------------------------------------------
// การล็อกเมื่อใส่รหัสผ่านผิด
// ---------------------------------------------------------------------------

function authLimits_() {
  return {
    idleMinutes: getSetting_('SESSION_IDLE_MINUTES'),
    maxHours: getSetting_('SESSION_MAX_HOURS'),
    allowRemember: getSetting_('SESSION_ALLOW_REMEMBER'),
    maxAttempts: getSetting_('LOGIN_MAX_ATTEMPTS'),
    lockMinutes: getSetting_('LOGIN_LOCK_MINUTES'),
  };
}

function loginFailKey_(username) {
  return LOGIN_FAIL_KEY_PREFIX_ + sha256Hex_(String(username).toLowerCase());
}

function safeJsonParse_(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

function loginFailState_(username) {
  const state = safeJsonParse_(CacheService.getScriptCache().get(loginFailKey_(username)));
  if (!state) return { count: 0, lockedUntil: 0 };
  if (state.lockedUntil && state.lockedUntil <= now_().getTime()) {
    CacheService.getScriptCache().remove(loginFailKey_(username));
    return { count: 0, lockedUntil: 0 };
  }
  return state;
}

function recordLoginFailure_(username, limits) {
  const state = loginFailState_(username);
  state.count = (state.count || 0) + 1;
  if (state.count >= limits.maxAttempts) state.lockedUntil = now_().getTime() + limits.lockMinutes * 60000;
  const ttl = Math.min(AUTH.CACHE_MAX_SECONDS, limits.lockMinutes * 60);
  CacheService.getScriptCache().put(loginFailKey_(username), JSON.stringify(state), ttl);
  return state;
}

function clearLoginFailures_(username) {
  CacheService.getScriptCache().remove(loginFailKey_(username));
}

function lockedMessage_(lockedUntil) {
  const minutes = Math.max(1, Math.ceil((lockedUntil - now_().getTime()) / 60000));
  return 'มีการใส่รหัสผ่านผิดหลายครั้ง ชื่อผู้ใช้นี้ถูกล็อกชั่วคราว กรุณารอประมาณ ' + minutes + ' นาทีแล้วลองใหม่';
}

/** บันทึกการเข้าสู่ระบบไม่สำเร็จ (ไม่บันทึกข้อความที่พิมพ์ ถ้าไม่ใช่ชื่อผู้ใช้จริง) */
function auditLoginFailure_(user, reason) {
  const actor = user ? actorFromUser_(user) : { userId: 'ANONYMOUS', username: '(ไม่พบชื่อผู้ใช้)', role: 'ANONYMOUS' };
  auditAppend_([{
    action: AUDIT_ACTIONS.LOGIN_FAILED,
    entity: SHEETS.USERS,
    entityId: user ? user.UserId : '',
    note: reason,
  }], actor);
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

function sessionKey_(token) {
  return SESSION_KEY_PREFIX_ + sha256Hex_(token);
}

/**
 * สร้าง session ใหม่
 * remember = ผู้ใช้เลือก "อยู่ในระบบต่อในเครื่องนี้" (ถ้าผู้ดูแลระบบอนุญาต): ไม่ออกจากระบบเพราะไม่ได้ใช้งาน
 * จนครบอายุสูงสุดของการเข้าสู่ระบบ (CacheService เก็บได้ไม่เกิน 6 ชั่วโมงนับจากการใช้งานครั้งล่าสุด)
 */
function createSession_(user, limits, remember) {
  const token = randomHex_(64).toLowerCase();
  const nowMs = now_().getTime();
  const remembered = !!remember && limits.allowRemember === true;
  const idleSeconds = Math.min(AUTH.CACHE_MAX_SECONDS, remembered ? limits.maxHours * 3600 : limits.idleMinutes * 60);
  const session = {
    uid: user.UserId,
    ver: user.SessionVersion || 0,
    ep: sessionEpoch_(),
    rem: remembered,
    created: nowMs,
    seen: nowMs,
    idle: idleSeconds,
    maxMs: limits.maxHours * 3600000,
  };
  CacheService.getScriptCache().put(sessionKey_(token), JSON.stringify(session), idleSeconds);
  return token;
}

/** ค่าที่เปลี่ยนเมื่อกู้คืนข้อมูล (session ที่สร้างก่อนหน้านั้นใช้ไม่ได้ทั้งหมด) */
function sessionEpoch_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_KEYS.SESSION_EPOCH) || '';
}

function sessionExpiredError_(message) {
  return appError_(ERROR_CODES.UNAUTHENTICATED, message || 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
}

/**
 * ตรวจ token ของทุกคำขอ คืนค่าข้อมูลผู้ใช้ล่าสุด (ctx)
 * ไม่เชื่อข้อมูลบทบาทจากหน้าเว็บ อ่านจากชีต Users ทุกครั้ง
 */
function authenticate_(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw sessionExpiredError_();
  const cache = CacheService.getScriptCache();
  const key = sessionKey_(token);
  const session = safeJsonParse_(cache.get(key));
  if (!session || !session.uid) throw sessionExpiredError_();
  if ((session.ep || '') !== sessionEpoch_()) {
    cache.remove(key);
    throw sessionExpiredError_('ผู้ดูแลระบบกู้คืนข้อมูลจากไฟล์สำรองแล้ว กรุณาเข้าสู่ระบบใหม่');
  }
  const nowMs = now_().getTime();
  if (nowMs - session.created > session.maxMs) {
    cache.remove(key);
    throw sessionExpiredError_('ครบเวลาการเข้าสู่ระบบสูงสุดแล้ว กรุณาเข้าสู่ระบบใหม่');
  }
  if (nowMs - session.seen > session.idle * 1000) {
    cache.remove(key);
    throw sessionExpiredError_();
  }
  const user = dbGet_(SHEETS.USERS, session.uid);
  if (!user || user.Status !== STATUS.USER.ACTIVE || (user.SessionVersion || 0) !== session.ver) {
    cache.remove(key);
    throw sessionExpiredError_('บัญชีของคุณมีการเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่');
  }
  if (authMode_() === AUTH_MODES.GOOGLE) {
    const email = activeGoogleEmail_();
    if (!email || email !== String(user.Email).toLowerCase()) {
      cache.remove(key);
      throw sessionExpiredError_('บัญชี Google ที่ใช้อยู่ไม่ตรงกับผู้ใช้ที่เข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่');
    }
  }
  if (nowMs - session.seen > 60000) {
    session.seen = nowMs;
    cache.put(key, JSON.stringify(session), session.idle);
  }
  return {
    userId: user.UserId,
    username: user.Username,
    role: user.Role,
    displayName: user.DisplayName,
    mustChangePassword: authMode_() === AUTH_MODES.PASSWORD && user.MustChangePassword === true,
    sessionKey: key,
    remember: session.rem === true,
  };
}

function activeGoogleEmail_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').toLowerCase();
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// API: การเข้าสู่ระบบ
// ---------------------------------------------------------------------------

/** ข้อมูลผู้ใช้ที่ส่งให้หน้าเว็บ (ไม่มีค่าแฮชรหัสผ่านหรือ SessionVersion) */
function userDto_(u) {
  return {
    userId: u.UserId,
    username: u.Username,
    displayName: u.DisplayName,
    position: u.Position,
    email: u.Email,
    role: u.Role,
    roleLabel: ROLE_LABELS[u.Role] || u.Role,
    status: u.Status,
    statusLabel: STATUS_LABELS.USER[u.Status] || u.Status,
    mustChangePassword: u.MustChangePassword === true,
    lastLoginAt: u.LastLoginAt,
    createdAt: u.CreatedAt,
    updatedAt: u.UpdatedAt,
  };
}

/**
 * หลังยืนยันตัวตนสำเร็จ: บันทึกเวลา ประวัติ และสร้าง session
 * rehashPassword = รหัสผ่านที่ต้องแฮชใหม่ด้วยจำนวนรอบปัจจุบัน (null = ไม่ต้อง)
 */
function completeLogin_(user, rehashPassword, limits, remember) {
  const remembered = remember === true && limits.allowRemember === true;
  const changes = { LastLoginAt: nowIso_() };
  if (rehashPassword !== null) changes.PasswordHash = hashPassword_(rehashPassword);
  dbUpdate_(SHEETS.USERS, user.UserId, changes, actorFromUser_(user), { note: 'ปรับรูปแบบการเก็บรหัสผ่านอัตโนมัติ' });
  auditAppend_([{
    action: AUDIT_ACTIONS.LOGIN, entity: SHEETS.USERS, entityId: user.UserId,
    note: 'เข้าสู่ระบบสำเร็จ' + (remembered ? ' (เลือกอยู่ในระบบต่อในเครื่องนี้)' : ''),
  }], actorFromUser_(user));
  const fresh = dbGet_(SHEETS.USERS, user.UserId);
  return {
    token: createSession_(fresh, limits, remembered),
    remember: remembered,
    user: userDto_(fresh),
    mustChangePassword: authMode_() === AUTH_MODES.PASSWORD && fresh.MustChangePassword === true,
  };
}

/** auth.login — โหมดชื่อผู้ใช้และรหัสผ่าน */
function authLogin_(ctx, payload) {
  if (authMode_() !== AUTH_MODES.PASSWORD) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'ระบบนี้ตั้งค่าให้เข้าสู่ระบบด้วยบัญชี Google ของโรงเรียน');
  }
  const username = cleanText_(typeof payload.username === 'string' ? payload.username : '').toLowerCase().slice(0, 64);
  const password = typeof payload.password === 'string' ? payload.password : '';
  if (!username || !password) throw validationError_('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');

  const limits = authLimits_();
  const user = dbFindOne_(SHEETS.USERS, function (u) { return u.Username === username; });

  const lock = loginFailState_(username);
  if (lock.lockedUntil) {
    auditLoginFailure_(user, 'ถูกล็อกชั่วคราวเพราะใส่รหัสผ่านผิดหลายครั้ง');
    throw appError_(ERROR_CODES.UNAUTHENTICATED, lockedMessage_(lock.lockedUntil));
  }

  let verified = false;
  let needsRehash = false;
  if (password.length <= AUTH.PASSWORD_MAX_LENGTH) {
    if (user) {
      const check = verifyPassword_(password, user.PasswordHash);
      verified = check.ok;
      needsRehash = check.needsRehash;
    } else {
      derivePasswordHash_(password, randomHex_(32).toLowerCase(), passwordHashIterations_());
    }
  }
  if (!verified) {
    const state = recordLoginFailure_(username, limits);
    auditLoginFailure_(user, (user ? 'รหัสผ่านไม่ถูกต้อง' : 'ไม่พบชื่อผู้ใช้') + ' (ครั้งที่ ' + state.count + ')');
    throw appError_(ERROR_CODES.UNAUTHENTICATED, state.lockedUntil ? lockedMessage_(state.lockedUntil) : LOGIN_FAILED_MESSAGE_);
  }
  if (user.Status !== STATUS.USER.ACTIVE) {
    auditLoginFailure_(user, 'บัญชีถูกปิดการใช้งาน');
    throw appError_(ERROR_CODES.UNAUTHENTICATED, 'บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  }
  clearLoginFailures_(username);
  return completeLogin_(user, needsRehash ? password : null, limits, payload.remember === true);
}

/** auth.loginGoogle — โหมดบัญชี Google ของโรงเรียน (ใช้อีเมลที่ Google ยืนยันแล้ว) */
function authLoginGoogle_(ctx, payload) {
  if (authMode_() !== AUTH_MODES.GOOGLE) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'ระบบนี้ตั้งค่าให้เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน');
  }
  const email = activeGoogleEmail_();
  if (!email) {
    throw appError_(ERROR_CODES.UNAUTHENTICATED, 'ไม่พบบัญชี Google ที่เข้าสู่ระบบ กรุณาเข้าสู่ระบบ Google ด้วยบัญชีของโรงเรียน');
  }
  const user = dbFindOne_(SHEETS.USERS, function (u) { return String(u.Email).toLowerCase() === email; });
  if (!user || user.Status !== STATUS.USER.ACTIVE) {
    auditLoginFailure_(user, user ? 'บัญชีถูกปิดการใช้งาน' : 'บัญชี Google ที่ยังไม่ได้รับสิทธิ์ใช้งาน');
    throw appError_(ERROR_CODES.FORBIDDEN, 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งานระบบ กรุณาติดต่อผู้ดูแลระบบ');
  }
  return completeLogin_(user, null, authLimits_(), !!payload && payload.remember === true);
}

/** auth.me — ข้อมูลผู้ใช้และโรงเรียนสำหรับหน้าเว็บ */
function authMe_(ctx) {
  const user = dbGet_(SHEETS.USERS, ctx.userId);
  return {
    user: userDto_(user),
    mustChangePassword: ctx.mustChangePassword,
    authMode: authMode_(),
    school: schoolInfo_(),
    app: { name: APP.NAME, version: APP.VERSION, release: APP.RELEASE },
  };
}

/** auth.logout */
function authLogout_(ctx) {
  CacheService.getScriptCache().remove(ctx.sessionKey);
  auditAppend_([{ action: AUDIT_ACTIONS.LOGOUT, entity: SHEETS.USERS, entityId: ctx.userId, note: 'ออกจากระบบ' }], actorFromCtx_(ctx));
  return { loggedOut: true };
}

/** auth.changePassword — เปลี่ยนรหัสผ่านของตนเอง (ทุก session เดิมหมดอายุ แล้วออก session ใหม่ให้) */
function authChangePassword_(ctx, payload) {
  if (authMode_() !== AUTH_MODES.PASSWORD) {
    throw appError_(ERROR_CODES.FORBIDDEN, 'ระบบนี้ใช้บัญชี Google จึงไม่มีรหัสผ่านของระบบ');
  }
  const user = dbGet_(SHEETS.USERS, ctx.userId);
  const current = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
  const next = typeof payload.newPassword === 'string' ? payload.newPassword : '';
  const limits = authLimits_();
  const lock = loginFailState_(user.Username);
  if (lock.lockedUntil) throw appError_(ERROR_CODES.VALIDATION, lockedMessage_(lock.lockedUntil));
  if (!current || !verifyPassword_(current, user.PasswordHash).ok) {
    const state = recordLoginFailure_(user.Username, limits);
    auditLoginFailure_(user, 'เปลี่ยนรหัสผ่าน: รหัสผ่านปัจจุบันไม่ถูกต้อง (ครั้งที่ ' + state.count + ')');
    throw validationError_(state.lockedUntil ? lockedMessage_(state.lockedUntil) : 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }
  validateNewPassword_(next, user.Username);
  if (next === current) throw validationError_('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
  clearLoginFailures_(user.Username);
  dbUpdate_(SHEETS.USERS, user.UserId, {
    PasswordHash: hashPassword_(next),
    MustChangePassword: false,
    SessionVersion: (user.SessionVersion || 0) + 1,
  }, actorFromCtx_(ctx), { action: AUDIT_ACTIONS.PASSWORD_CHANGE, note: 'เปลี่ยนรหัสผ่านด้วยตนเอง' });
  CacheService.getScriptCache().remove(ctx.sessionKey);
  const fresh = dbGet_(SHEETS.USERS, user.UserId);
  return { token: createSession_(fresh, limits, ctx.remember), remember: ctx.remember === true && limits.allowRemember === true, user: userDto_(fresh), mustChangePassword: false };
}
