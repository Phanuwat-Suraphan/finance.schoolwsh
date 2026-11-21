/**
 * ============================================================================
 *  Config.gs — ค่าคงที่และโครงสร้างฐานข้อมูลทั้งหมดของระบบ
 *  ระบบบริหารจัดเก็บเงินบำรุงการศึกษา โรงเรียนวัดเสาหิน จังหวัดเชียงใหม่
 * ----------------------------------------------------------------------------
 *  หลักการของไฟล์นี้
 *   - โครงสร้างชีตทั้งหมดอยู่ใน SCHEMA ที่เดียว โค้ดส่วนอื่นอ้างคอลัมน์ด้วย "ชื่อ"
 *   - ห้ามเปลี่ยนชื่อหรือลบคอลัมน์เดิม ถ้าต้องการคอลัมน์ใหม่ให้เพิ่มต่อท้ายรายการ
 *     แล้วรันเมนู "ติดตั้ง / ตรวจสอบโครงสร้างฐานข้อมูล" ระบบจะเพิ่มคอลัมน์ที่ขาดให้
 *   - ไฟล์นี้มีแต่ข้อมูล ไม่มีโค้ดที่เรียกไฟล์อื่นตอนโหลด จึงวางไฟล์ในลำดับใดก็ได้
 *
 *  ชนิดคอลัมน์ (ใช้ควบคุมการตรวจและการเขียนค่า)
 *   id        รหัสอ้างอิงเฉพาะของแถว (คอลัมน์แรกของทุกชีต)
 *   text      ข้อความ (เก็บแบบ Plain text กันการแปลงอัตโนมัติและสูตร)
 *   enum      ข้อความที่ต้องเป็นค่าในรายการที่กำหนดเท่านั้น
 *   money     จำนวนเงิน (บาท ทศนิยม 2 ตำแหน่ง) ระบบคำนวณภายในเป็นสตางค์
 *   int       จำนวนเต็ม
 *   bool      TRUE / FALSE
 *   date      วันที่ ค.ศ. รูปแบบ yyyy-MM-dd (แสดงผลเป็น พ.ศ. บนหน้าเว็บ)
 *   datetime  วันเวลา ค.ศ. รูปแบบ yyyy-MM-dd HH:mm:ss เขตเวลา Asia/Bangkok
 *   json      ข้อมูลโครงสร้างที่ระบบใช้ภายใน
 * ============================================================================
 */

const APP = Object.freeze({
  NAME: 'ระบบบริหารจัดเก็บเงินบำรุงการศึกษา',
  SCHOOL_NAME: 'โรงเรียนวัดเสาหิน',
  PROVINCE: 'เชียงใหม่',
  VERSION: '0.1.0',
  RELEASE: 'ระยะที่ 1: โครงสร้างระบบและฐานข้อมูล',
  SCHEMA_VERSION: 1,
  TIMEZONE: 'Asia/Bangkok',
});

/** ชื่อค่าใน Script Properties (ที่เก็บความลับ ไม่อยู่ในชีต และไม่ส่งออกไปหน้าเว็บ) */
const PROP_KEYS = Object.freeze({
  DB_SPREADSHEET_ID: 'DB_SPREADSHEET_ID', // รหัสไฟล์ Google Sheets ที่ใช้เป็นฐานข้อมูล
  AUTH_MODE: 'AUTH_MODE',                 // PASSWORD หรือ GOOGLE
  PASSWORD_PEPPER: 'PASSWORD_PEPPER',     // ค่าลับสำหรับแฮชรหัสผ่าน ห้ามแก้หรือลบ
  BACKUP_FOLDER_ID: 'BACKUP_FOLDER_ID',   // โฟลเดอร์สำรองข้อมูล (ระยะที่ 7)
  AUDIT_HEAD: 'AUDIT_HEAD',               // ตำแหน่งและ hash ล่าสุดของ AuditLogs ใช้ตรวจการลบแถวท้ายชีต
});

const AUTH_MODES = Object.freeze({ PASSWORD: 'PASSWORD', GOOGLE: 'GOOGLE' });

const ROLES = Object.freeze({ ADMIN: 'ADMIN', FINANCE: 'FINANCE', DIRECTOR: 'DIRECTOR' });

const ROLE_LABELS = Object.freeze({
  ADMIN: 'ผู้ดูแลระบบ',
  FINANCE: 'เจ้าหน้าที่การเงิน',
  DIRECTOR: 'ผู้อำนวยการ',
});

/** ผู้กระทำที่ไม่ใช่ผู้ใช้ในชีต Users (บันทึกลง AuditLogs) */
const ACTORS = Object.freeze({
  OWNER: Object.freeze({ userId: 'OWNER', username: 'owner', role: 'OWNER' }),
  SYSTEM: Object.freeze({ userId: 'SYSTEM', username: 'system', role: 'SYSTEM' }),
});

const LIMITS = Object.freeze({
  LOCK_TIMEOUT_MS: 20000,       // รอ lock สูงสุดสำหรับการบันทึกทั่วไป
  SETUP_LOCK_TIMEOUT_MS: 30000, // รอ lock สูงสุดสำหรับการติดตั้งฐานข้อมูล
  CELL_MAX_CHARS: 50000,        // ข้อจำกัดของ Google Sheets ต่อ 1 เซลล์
  ROW_CAPACITY_STEP: 200,       // เพิ่มแถวว่างครั้งละกี่แถวเมื่อชีตเต็ม
});

/** สถานะทั้งหมดของระบบ (ค่าที่เก็บในชีตเป็นภาษาอังกฤษ ป้ายภาษาไทยอยู่ใน STATUS_LABELS) */
const STATUS = Object.freeze({
  USER: Object.freeze({ ACTIVE: 'ACTIVE', DISABLED: 'DISABLED' }),
  STUDENT: Object.freeze({ STUDYING: 'STUDYING', TRANSFERRED: 'TRANSFERRED', GRADUATED: 'GRADUATED' }),
  ACADEMIC_YEAR: Object.freeze({ OPEN: 'OPEN', CLOSED: 'CLOSED' }),
  FEE_SETTING: Object.freeze({ ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' }),
  TERM: Object.freeze({ TERM_1: '1', TERM_2: '2', YEAR: 'Y' }),
  ASSESSMENT: Object.freeze({ ACTIVE: 'ACTIVE', CANCELLED: 'CANCELLED' }),
  ADJUSTMENT_TYPE: Object.freeze({ DISCOUNT: 'DISCOUNT', EXEMPTION: 'EXEMPTION' }),
  ADJUSTMENT: Object.freeze({ ACTIVE: 'ACTIVE', REVOKED: 'REVOKED' }),
  PAYMENT: Object.freeze({ ACTIVE: 'ACTIVE', VOIDED: 'VOIDED', REPLACED: 'REPLACED' }),
  ALLOCATION: Object.freeze({ ACTIVE: 'ACTIVE', VOIDED: 'VOIDED' }),
  BOOK: Object.freeze({ REGISTERED: 'REGISTERED', ACTIVE: 'ACTIVE', FULL: 'FULL', CLOSED: 'CLOSED' }),
  RECEIPT_ENTRY: Object.freeze({ USED: 'USED', CANCEL_PENDING: 'CANCEL_PENDING', CANCELLED: 'CANCELLED' }),
  CANCEL_TYPE: Object.freeze({ SPOILED: 'SPOILED', VOID_PAYMENT: 'VOID_PAYMENT' }),
  DECISION: Object.freeze({ PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', WITHDRAWN: 'WITHDRAWN' }),
  REQUEST_TYPE: Object.freeze({
    FEE_ADJUSTMENT: 'FEE_ADJUSTMENT',
    ASSESSMENT_CANCEL: 'ASSESSMENT_CANCEL',
    RECEIPT_CANCEL: 'RECEIPT_CANCEL',
    PAYMENT_CORRECTION: 'PAYMENT_CORRECTION',
    BOOK_CLOSE: 'BOOK_CLOSE',
  }),
  // สถานะการชำระของรายการเรียกเก็บ: ระบบคำนวณจากข้อมูลทุกครั้ง ไม่ได้เก็บไว้ในชีต
  PAY_STATE: Object.freeze({ UNPAID: 'UNPAID', PARTIAL: 'PARTIAL', PAID: 'PAID', EXEMPT: 'EXEMPT', CANCELLED: 'CANCELLED' }),
});

const STATUS_LABELS = Object.freeze({
  USER: { ACTIVE: 'ใช้งาน', DISABLED: 'ปิดการใช้งาน' },
  STUDENT: { STUDYING: 'กำลังศึกษา', TRANSFERRED: 'ย้ายออก', GRADUATED: 'จบการศึกษา' },
  ACADEMIC_YEAR: { OPEN: 'เปิด', CLOSED: 'ปิดแล้ว' },
  FEE_SETTING: { ACTIVE: 'ใช้งาน', INACTIVE: 'ไม่ใช้งาน' },
  TERM: { '1': 'ภาคเรียนที่ 1', '2': 'ภาคเรียนที่ 2', Y: 'ทั้งปีการศึกษา' },
  ASSESSMENT: { ACTIVE: 'มีผล', CANCELLED: 'ยกเลิก' },
  ADJUSTMENT_TYPE: { DISCOUNT: 'ลดหย่อน', EXEMPTION: 'ยกเว้น' },
  ADJUSTMENT: { ACTIVE: 'มีผล', REVOKED: 'เพิกถอน' },
  PAYMENT: { ACTIVE: 'มีผล', VOIDED: 'ยกเลิกใบเสร็จ', REPLACED: 'ถูกแทนด้วยรายการแก้ไข' },
  ALLOCATION: { ACTIVE: 'มีผล', VOIDED: 'ยกเลิก' },
  BOOK: { REGISTERED: 'ลงทะเบียนแล้ว', ACTIVE: 'กำลังใช้', FULL: 'ใช้ครบเล่ม', CLOSED: 'ปิดเล่ม' },
  RECEIPT_ENTRY: { USED: 'ใช้แล้ว', CANCEL_PENDING: 'รออนุมัติยกเลิก', CANCELLED: 'ยกเลิก' },
  CANCEL_TYPE: { SPOILED: 'เขียนผิดหรือชำรุด (ยังไม่บันทึกรับเงิน)', VOID_PAYMENT: 'ยกเลิกใบเสร็จที่บันทึกรับเงินแล้ว' },
  DECISION: { PENDING: 'รออนุมัติ', APPROVED: 'อนุมัติ', REJECTED: 'ไม่อนุมัติ', WITHDRAWN: 'ถอนคำขอ' },
  REQUEST_TYPE: {
    FEE_ADJUSTMENT: 'ลดหย่อน/ยกเว้น',
    ASSESSMENT_CANCEL: 'ยกเลิกรายการเรียกเก็บ',
    RECEIPT_CANCEL: 'ยกเลิกเลขที่ใบเสร็จ',
    PAYMENT_CORRECTION: 'แก้ไขรายการรับเงินที่บันทึกผิด',
    BOOK_CLOSE: 'ปิดเล่มใบเสร็จก่อนใช้ครบเล่ม',
  },
  PAY_STATE: { UNPAID: 'ยังไม่ชำระ', PARTIAL: 'ชำระบางส่วน', PAID: 'ชำระครบ', EXEMPT: 'ได้รับยกเว้น', CANCELLED: 'ยกเลิก' },
});

/** การกระทำที่บันทึกใน AuditLogs */
const AUDIT_ACTIONS = Object.freeze({
  SETUP: 'SETUP',
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  CANCEL: 'CANCEL',
  REQUEST: 'REQUEST',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  IMPORT: 'IMPORT',
  EXPORT: 'EXPORT',
  BACKUP: 'BACKUP',
  RESTORE: 'RESTORE',
  INTEGRITY_CHECK: 'INTEGRITY_CHECK',
});

const SHEETS = Object.freeze({
  USERS: 'Users',
  SCHOOL_SETTINGS: 'SchoolSettings',
  ACADEMIC_YEARS: 'AcademicYears',
  STUDENTS: 'Students',
  ENROLLMENTS: 'Enrollments',
  FEE_SETTINGS: 'FeeSettings',
  FEE_ASSESSMENTS: 'FeeAssessments',
  FEE_ADJUSTMENTS: 'FeeAdjustments',
  PAYMENTS: 'Payments',
  PAYMENT_ALLOCATIONS: 'PaymentAllocations',
  RECEIPT_BOOKS: 'ReceiptBooks',
  RECEIPT_ENTRIES: 'ReceiptEntries',
  RECEIPT_CANCELLATIONS: 'ReceiptCancellations',
  APPROVAL_REQUESTS: 'ApprovalRequests',
  AUDIT_LOGS: 'AuditLogs',
});

/** ลำดับแท็บชีตเมื่อสร้างใหม่ */
const SHEET_ORDER = Object.freeze([
  SHEETS.USERS,
  SHEETS.SCHOOL_SETTINGS,
  SHEETS.ACADEMIC_YEARS,
  SHEETS.STUDENTS,
  SHEETS.ENROLLMENTS,
  SHEETS.FEE_SETTINGS,
  SHEETS.FEE_ASSESSMENTS,
  SHEETS.FEE_ADJUSTMENTS,
  SHEETS.PAYMENTS,
  SHEETS.PAYMENT_ALLOCATIONS,
  SHEETS.RECEIPT_BOOKS,
  SHEETS.RECEIPT_ENTRIES,
  SHEETS.RECEIPT_CANCELLATIONS,
  SHEETS.APPROVAL_REQUESTS,
  SHEETS.AUDIT_LOGS,
]);

const TAB_COLORS = Object.freeze({
  SYSTEM: '#607D8B',
  STUDENT: '#2E86DE',
  FEE: '#1F3A5F',
  RECEIPT: '#0B7285',
  APPROVAL: '#B7791F',
  AUDIT: '#9B2C2C',
});

/** สีหัวตารางในชีต (โทนกรมท่า) */
const SHEET_HEADER_STYLE = Object.freeze({ background: '#1F3A5F', fontColor: '#FFFFFF' });

/** คอลัมน์ที่ระบบบันทึกเองทุกครั้ง ห้ามส่งค่ามาจากโค้ดส่วนอื่น */
const SYSTEM_COLUMNS = Object.freeze(['CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy']);

const STD_CREATED_COLUMNS_ = [
  ['CreatedAt', 'datetime', 'วันเวลาที่สร้างรายการ (ระบบบันทึกอัตโนมัติ)'],
  ['CreatedBy', 'text', 'ชื่อผู้ใช้ที่สร้างรายการ (ระบบบันทึกอัตโนมัติ)'],
];

const STD_UPDATED_COLUMNS_ = [
  ['UpdatedAt', 'datetime', 'วันเวลาที่แก้ไขล่าสุด (ระบบบันทึกอัตโนมัติ)'],
  ['UpdatedBy', 'text', 'ชื่อผู้ใช้ที่แก้ไขล่าสุด (ระบบบันทึกอัตโนมัติ)'],
];

/**
 * โครงสร้างฐานข้อมูล
 *  label       ชื่อภาษาไทยของชีต
 *  idPrefix    คำนำหน้ารหัสอ้างอิงที่ระบบสร้างอัตโนมัติ (null = ผู้เรียกต้องกำหนดรหัสเอง)
 *  columns     [ชื่อคอลัมน์, ชนิด, คำอธิบายภาษาไทย, รายการค่าที่อนุญาต (เฉพาะ enum)]
 *  unique      กฎห้ามซ้ำ { cols, skipStatus (สถานะที่ไม่นับ), message }
 *              ค่าว่างไม่นับว่าซ้ำ และเทียบโดยไม่สนตัวพิมพ์เล็กใหญ่และช่องว่างหัวท้าย
 *  mutable     คอลัมน์ที่แก้ไขได้หลังบันทึก ('*' = ทุกคอลัมน์ยกเว้นรหัสและคอลัมน์ระบบ)
 *              คอลัมน์ที่ไม่อยู่ในรายการ "แก้ไขไม่ได้" ระบบจะปฏิเสธทันที
 *  secret      คอลัมน์ลับ: ซ่อนค่าใน AuditLogs และห้ามส่งออกไปหน้าเว็บ
 *  auditExempt คอลัมน์ที่เปลี่ยนบ่อยและไม่สำคัญ ไม่ต้องบันทึก AuditLogs เมื่อเปลี่ยนเฉพาะคอลัมน์นี้
 *  writeVia    'db' (ค่าเริ่มต้น) หรือ 'audit' (เขียนได้เฉพาะผ่าน auditAppend_)
 */
const SCHEMA = Object.freeze({
  [SHEETS.USERS]: {
    label: 'ผู้ใช้งาน',
    idPrefix: 'USR',
    tabColor: TAB_COLORS.SYSTEM,
    columns: [
      ['UserId', 'id', 'รหัสผู้ใช้ (ระบบสร้างอัตโนมัติ)'],
      ['Username', 'text', 'ชื่อผู้ใช้สำหรับเข้าสู่ระบบ ไม่ซ้ำ ตัวพิมพ์เล็ก เปลี่ยนภายหลังไม่ได้'],
      ['DisplayName', 'text', 'ชื่อ-นามสกุล'],
      ['Position', 'text', 'ตำแหน่ง (ใช้ในช่องลงนามของรายงาน)'],
      ['Email', 'text', 'อีเมล (ใช้เมื่อเข้าสู่ระบบด้วยบัญชี Google ของโรงเรียน)'],
      ['Role', 'enum', 'บทบาท: ADMIN ผู้ดูแลระบบ / FINANCE เจ้าหน้าที่การเงิน / DIRECTOR ผู้อำนวยการ', ROLES],
      ['Status', 'enum', 'สถานะ: ACTIVE ใช้งาน / DISABLED ปิดการใช้งาน', STATUS.USER],
      ['PasswordHash', 'text', 'ค่าแฮชรหัสผ่าน (ห้ามแก้ไขด้วยมือ ระบบไม่ส่งค่านี้ออกไปหน้าเว็บ)'],
      ['MustChangePassword', 'bool', 'TRUE = ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งถัดไป'],
      ['SessionVersion', 'int', 'เลขรุ่นของการเข้าสู่ระบบ เพิ่มขึ้นเมื่อต้องการให้ทุกการเข้าสู่ระบบเดิมของผู้ใช้หมดอายุทันที'],
      ['LastLoginAt', 'datetime', 'วันเวลาเข้าสู่ระบบล่าสุด'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [
      { cols: ['Username'], message: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' },
      { cols: ['Email'], message: 'อีเมลนี้ถูกใช้กับผู้ใช้อื่นแล้ว' },
    ],
    mutable: ['DisplayName', 'Position', 'Email', 'Role', 'Status', 'PasswordHash',
      'MustChangePassword', 'SessionVersion', 'LastLoginAt'],
    secret: ['PasswordHash'],
    auditExempt: ['LastLoginAt'],
  },

  [SHEETS.SCHOOL_SETTINGS]: {
    label: 'ค่าตั้งค่าโรงเรียน',
    idPrefix: null,
    tabColor: TAB_COLORS.SYSTEM,
    columns: [
      ['SettingKey', 'id', 'ชื่อค่าตั้งค่า (ห้ามแก้ไข)'],
      ['Value', 'text', 'ค่าที่ตั้งไว้ (แก้ไขผ่านหน้าเว็บ เมนูตั้งค่า)'],
      ['Description', 'text', 'คำอธิบาย'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [],
    mutable: ['Value', 'Description'],
  },

  [SHEETS.ACADEMIC_YEARS]: {
    label: 'ปีการศึกษา',
    idPrefix: 'AY',
    tabColor: TAB_COLORS.SYSTEM,
    columns: [
      ['AcademicYearId', 'id', 'รหัสปีการศึกษา (ระบบสร้างอัตโนมัติ)'],
      ['Year', 'int', 'ปีการศึกษา (พ.ศ.) เช่น 2569'],
      ['Label', 'text', 'ชื่อที่แสดง เช่น ปีการศึกษา 2569'],
      ['StartDate', 'date', 'วันเริ่มปีการศึกษา (ค.ศ. yyyy-MM-dd)'],
      ['EndDate', 'date', 'วันสิ้นสุดปีการศึกษา (ค.ศ. yyyy-MM-dd)'],
      ['IsCurrent', 'bool', 'TRUE = ปีการศึกษาปัจจุบัน (มีได้ปีเดียว)'],
      ['Status', 'enum', 'OPEN เปิด / CLOSED ปิดแล้ว (ปิดแล้วสร้างรายการเรียกเก็บใหม่ไม่ได้ แต่ยังรับชำระหนี้ค้างได้)', STATUS.ACADEMIC_YEAR],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{ cols: ['Year'], message: 'มีปีการศึกษานี้ในระบบแล้ว' }],
    mutable: ['Label', 'StartDate', 'EndDate', 'IsCurrent', 'Status'],
  },

  [SHEETS.STUDENTS]: {
    label: 'นักเรียน',
    idPrefix: 'STU',
    tabColor: TAB_COLORS.STUDENT,
    columns: [
      ['StudentId', 'id', 'รหัสนักเรียนในระบบ (ระบบสร้างอัตโนมัติ)'],
      ['StudentNo', 'text', 'เลขประจำตัวนักเรียนของโรงเรียน (ไม่ซ้ำ)'],
      ['Prefix', 'text', 'คำนำหน้าชื่อ เช่น ด.ช. ด.ญ.'],
      ['FirstName', 'text', 'ชื่อ'],
      ['LastName', 'text', 'นามสกุล'],
      ['Status', 'enum', 'STUDYING กำลังศึกษา / TRANSFERRED ย้ายออก / GRADUATED จบการศึกษา', STATUS.STUDENT],
      ['StatusDate', 'date', 'วันที่เปลี่ยนสถานะล่าสุด'],
      ['StatusNote', 'text', 'หมายเหตุการเปลี่ยนสถานะ'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{ cols: ['StudentNo'], message: 'เลขประจำตัวนักเรียนนี้มีอยู่ในระบบแล้ว' }],
    mutable: '*',
  },

  [SHEETS.ENROLLMENTS]: {
    label: 'ชั้นเรียนรายปี',
    idPrefix: 'ENR',
    tabColor: TAB_COLORS.STUDENT,
    columns: [
      ['EnrollmentId', 'id', 'รหัสข้อมูลชั้นเรียนรายปี (ระบบสร้างอัตโนมัติ)'],
      ['StudentId', 'text', 'รหัสนักเรียนในระบบ (อ้างอิงชีต Students)'],
      ['AcademicYear', 'int', 'ปีการศึกษา (พ.ศ.)'],
      ['GradeLevel', 'text', 'ระดับชั้น เช่น ป.1'],
      ['Room', 'text', 'ห้อง'],
      ['ClassNo', 'int', 'เลขที่'],
      ['EnrollStatus', 'enum', 'สถานะในปีการศึกษานั้น: STUDYING / TRANSFERRED / GRADUATED', STATUS.STUDENT],
      ['Note', 'text', 'หมายเหตุ'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{ cols: ['StudentId', 'AcademicYear'], message: 'นักเรียนคนนี้มีข้อมูลชั้นเรียนในปีการศึกษานี้แล้ว' }],
    mutable: '*',
  },

  [SHEETS.FEE_SETTINGS]: {
    label: 'อัตราเงินบำรุงการศึกษา',
    idPrefix: 'FEE',
    tabColor: TAB_COLORS.FEE,
    columns: [
      ['FeeSettingId', 'id', 'รหัสอัตราเงินบำรุง (ระบบสร้างอัตโนมัติ)'],
      ['AcademicYear', 'int', 'ปีการศึกษา (พ.ศ.)'],
      ['Term', 'enum', 'ภาคเรียน: 1 / 2 / Y = ทั้งปีการศึกษา', STATUS.TERM],
      ['GradeLevel', 'text', 'ระดับชั้น'],
      ['Amount', 'money', 'จำนวนเงินต่อคน (บาท) แก้ไม่ได้หลังสร้างรายการเรียกเก็บแล้ว'],
      ['StartDate', 'date', 'วันเริ่มเรียกเก็บ'],
      ['DueDate', 'date', 'วันครบกำหนดชำระ'],
      ['Description', 'text', 'คำอธิบาย'],
      ['ApprovalRef', 'text', 'เลขที่และวันที่ของหนังสือหรือมติที่อนุมัติอัตรานี้ (เช่น มติคณะกรรมการสถานศึกษา)'],
      ['Status', 'enum', 'ACTIVE ใช้งาน / INACTIVE ไม่ใช้งาน', STATUS.FEE_SETTING],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{
      cols: ['AcademicYear', 'Term', 'GradeLevel'],
      message: 'มีอัตราเงินบำรุงของปีการศึกษา ภาคเรียน และระดับชั้นนี้แล้ว',
    }],
    // Amount แก้ได้ที่ชั้นข้อมูล แต่ระยะที่ 4 จะห้ามแก้เมื่อมีรายการเรียกเก็บแล้ว
    mutable: ['Amount', 'StartDate', 'DueDate', 'Description', 'ApprovalRef', 'Status'],
  },

  [SHEETS.FEE_ASSESSMENTS]: {
    label: 'รายการเรียกเก็บรายบุคคล',
    idPrefix: 'ASM',
    tabColor: TAB_COLORS.FEE,
    columns: [
      ['AssessmentId', 'id', 'รหัสรายการเรียกเก็บ (ระบบสร้างอัตโนมัติ)'],
      ['StudentId', 'text', 'รหัสนักเรียนในระบบ'],
      ['EnrollmentId', 'text', 'รหัสข้อมูลชั้นเรียนรายปี'],
      ['FeeSettingId', 'text', 'รหัสอัตราเงินบำรุง'],
      ['AcademicYear', 'int', 'ปีการศึกษา (พ.ศ.)'],
      ['Term', 'enum', 'ภาคเรียน', STATUS.TERM],
      ['GradeLevel', 'text', 'ระดับชั้น ณ วันที่สร้างรายการ'],
      ['Room', 'text', 'ห้อง ณ วันที่สร้างรายการ'],
      ['GrossAmount', 'money', 'ยอดเรียกเก็บก่อนลดหย่อน (บาท) แก้ไขไม่ได้'],
      ['DueDate', 'date', 'วันครบกำหนดชำระ'],
      ['Status', 'enum', 'ACTIVE มีผล / CANCELLED ยกเลิก', STATUS.ASSESSMENT],
      ['CancelReason', 'text', 'เหตุผลการยกเลิก'],
      ['CancelledAt', 'datetime', 'วันเวลาที่ยกเลิก'],
      ['CancelledBy', 'text', 'ผู้ยกเลิก'],
      ['ApprovalRequestId', 'text', 'รหัสคำขออนุมัติที่เกี่ยวข้อง'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{
      cols: ['StudentId', 'FeeSettingId'],
      skipStatus: [STATUS.ASSESSMENT.CANCELLED],
      message: 'นักเรียนคนนี้มีรายการเรียกเก็บของอัตรานี้แล้ว',
    }],
    mutable: ['Status', 'CancelReason', 'CancelledAt', 'CancelledBy', 'ApprovalRequestId'],
  },

  [SHEETS.FEE_ADJUSTMENTS]: {
    label: 'ลดหย่อน/ยกเว้น',
    idPrefix: 'ADJ',
    tabColor: TAB_COLORS.FEE,
    columns: [
      ['AdjustmentId', 'id', 'รหัสรายการลดหย่อน/ยกเว้น (ระบบสร้างอัตโนมัติ)'],
      ['AssessmentId', 'text', 'รหัสรายการเรียกเก็บ'],
      ['StudentId', 'text', 'รหัสนักเรียนในระบบ'],
      ['Type', 'enum', 'DISCOUNT ลดหย่อน / EXEMPTION ยกเว้น', STATUS.ADJUSTMENT_TYPE],
      ['Amount', 'money', 'จำนวนเงินที่ลดหรือยกเว้น (บาท) แก้ไขไม่ได้'],
      ['Reason', 'text', 'เหตุผล'],
      ['ReferenceDoc', 'text', 'เอกสารอ้างอิง เช่น เลขที่หนังสือขอยกเว้นหรือประกาศของโรงเรียน'],
      ['Status', 'enum', 'ACTIVE มีผล / REVOKED เพิกถอน', STATUS.ADJUSTMENT],
      ['RequestedBy', 'text', 'ผู้ขอ (เจ้าหน้าที่การเงิน)'],
      ['ApprovedBy', 'text', 'ผู้อนุมัติ (ว่าง = ไม่ต้องอนุมัติตามการตั้งค่า)'],
      ['ApprovalRequestId', 'text', 'รหัสคำขออนุมัติ'],
      ['RevokedAt', 'datetime', 'วันเวลาที่เพิกถอน'],
      ['RevokedBy', 'text', 'ผู้เพิกถอน'],
      ['RevokeReason', 'text', 'เหตุผลการเพิกถอน'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [],
    mutable: ['Status', 'RevokedAt', 'RevokedBy', 'RevokeReason'],
  },

  [SHEETS.PAYMENTS]: {
    label: 'การรับชำระเงิน',
    idPrefix: 'PAY',
    tabColor: TAB_COLORS.FEE,
    columns: [
      ['PaymentId', 'id', 'รหัสการรับเงิน (ระบบสร้างอัตโนมัติ)'],
      ['RequestKey', 'text', 'รหัสคำขอจากหน้าเว็บ ใช้กันการบันทึกซ้ำ'],
      ['StudentId', 'text', 'รหัสนักเรียนในระบบ'],
      ['PaymentDate', 'date', 'วันที่รับเงิน'],
      ['Amount', 'money', 'จำนวนเงินที่รับจริง (บาท) แก้ไขไม่ได้'],
      ['Channel', 'text', 'ช่องทางการรับเงิน'],
      ['ChannelRef', 'text', 'เลขอ้างอิง เช่น เลขรายการโอน'],
      ['ReceiptBookId', 'text', 'รหัสเล่มใบเสร็จ'],
      ['ReceiptBookNo', 'text', 'เลขเล่มใบเสร็จ'],
      ['ReceiptNo', 'int', 'เลขที่ใบเสร็จ'],
      ['ReceiptEntryId', 'text', 'รหัสรายการในทะเบียนคุมใบเสร็จ'],
      ['ReceivedByName', 'text', 'ผู้รับเงิน'],
      ['Note', 'text', 'หมายเหตุ'],
      ['Status', 'enum', 'ACTIVE มีผล / VOIDED ยกเลิกใบเสร็จ / REPLACED ถูกแทนด้วยรายการแก้ไข', STATUS.PAYMENT],
      ['VoidReason', 'text', 'เหตุผลการยกเลิกหรือการแก้ไข'],
      ['VoidedAt', 'datetime', 'วันเวลาที่ยกเลิกหรือแก้ไข'],
      ['VoidedBy', 'text', 'ผู้ยกเลิกหรือแก้ไข'],
      ['ReplacesPaymentId', 'text', 'รหัสการรับเงินเดิมที่รายการนี้แก้ไขแทน'],
      ['ReplacedByPaymentId', 'text', 'รหัสการรับเงินใหม่ที่แก้ไขแทนรายการนี้'],
      ['ApprovalRequestId', 'text', 'รหัสคำขออนุมัติที่เกี่ยวข้อง'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [
      { cols: ['RequestKey'], message: 'รายการนี้ถูกบันทึกไปแล้ว (ระบบป้องกันการกดบันทึกซ้ำ)' },
      {
        cols: ['ReceiptBookId', 'ReceiptNo'],
        skipStatus: [STATUS.PAYMENT.VOIDED, STATUS.PAYMENT.REPLACED],
        message: 'เลขที่ใบเสร็จนี้ผูกกับการรับเงินที่ยังมีผลอยู่แล้ว',
      },
    ],
    mutable: ['Status', 'VoidReason', 'VoidedAt', 'VoidedBy', 'ReplacedByPaymentId', 'ApprovalRequestId'],
  },

  [SHEETS.PAYMENT_ALLOCATIONS]: {
    label: 'การตัดชำระ',
    idPrefix: 'ALC',
    tabColor: TAB_COLORS.FEE,
    columns: [
      ['AllocationId', 'id', 'รหัสการตัดชำระ (ระบบสร้างอัตโนมัติ)'],
      ['PaymentId', 'text', 'รหัสการรับเงิน'],
      ['AssessmentId', 'text', 'รหัสรายการเรียกเก็บที่ตัดชำระ'],
      ['StudentId', 'text', 'รหัสนักเรียนในระบบ'],
      ['AcademicYear', 'int', 'ปีการศึกษาของรายการเรียกเก็บ (พ.ศ.)'],
      ['Amount', 'money', 'จำนวนเงินที่ตัดชำระ (บาท) แก้ไขไม่ได้'],
      ['Status', 'enum', 'ACTIVE มีผล / VOIDED ยกเลิก', STATUS.ALLOCATION],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{
      cols: ['PaymentId', 'AssessmentId'],
      skipStatus: [STATUS.ALLOCATION.VOIDED],
      message: 'การรับเงินครั้งนี้ตัดชำระรายการนี้ไปแล้ว',
    }],
    mutable: ['Status'],
  },

  [SHEETS.RECEIPT_BOOKS]: {
    label: 'ทะเบียนเล่มใบเสร็จ',
    idPrefix: 'BOOK',
    tabColor: TAB_COLORS.RECEIPT,
    columns: [
      ['BookId', 'id', 'รหัสเล่มใบเสร็จ (ระบบสร้างอัตโนมัติ)'],
      ['BookNo', 'text', 'เลขเล่มตามเล่มจริง (ไม่ซ้ำ)'],
      ['StartNo', 'int', 'เลขที่เริ่มต้นของเล่ม'],
      ['EndNo', 'int', 'เลขที่สิ้นสุดของเล่ม'],
      ['ReceivedDate', 'date', 'วันที่ได้รับเล่ม'],
      ['StartUseDate', 'date', 'วันที่เริ่มใช้'],
      ['ClosedDate', 'date', 'วันที่ปิดเล่ม'],
      ['ResponsibleUserId', 'text', 'รหัสผู้ใช้ของผู้รับผิดชอบ'],
      ['ResponsibleName', 'text', 'ชื่อผู้รับผิดชอบ'],
      ['Status', 'enum', 'REGISTERED ลงทะเบียนแล้ว / ACTIVE กำลังใช้ / FULL ใช้ครบเล่ม / CLOSED ปิดเล่ม', STATUS.BOOK],
      ['CloseReason', 'text', 'เหตุผลการปิดเล่ม'],
      ['Note', 'text', 'หมายเหตุ'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{ cols: ['BookNo'], message: 'เลขเล่มนี้ลงทะเบียนไว้แล้ว' }],
    // เลขเล่ม/ช่วงเลขที่ แก้ได้ที่ชั้นข้อมูล แต่ระยะที่ 4 จะอนุญาตเฉพาะเล่มที่ยังไม่เคยใช้
    mutable: ['BookNo', 'StartNo', 'EndNo', 'ReceivedDate', 'StartUseDate', 'ClosedDate',
      'ResponsibleUserId', 'ResponsibleName', 'Status', 'CloseReason', 'Note'],
  },

  [SHEETS.RECEIPT_ENTRIES]: {
    label: 'ทะเบียนคุมเลขที่ใบเสร็จ',
    idPrefix: 'RCE',
    tabColor: TAB_COLORS.RECEIPT,
    columns: [
      ['EntryId', 'id', 'รหัสรายการทะเบียนคุมใบเสร็จ (ระบบสร้างอัตโนมัติ)'],
      ['BookId', 'text', 'รหัสเล่มใบเสร็จ'],
      ['BookNo', 'text', 'เลขเล่ม'],
      ['ReceiptNo', 'int', 'เลขที่ใบเสร็จ'],
      ['Status', 'enum', 'USED ใช้แล้ว / CANCEL_PENDING รออนุมัติยกเลิก / CANCELLED ยกเลิก', STATUS.RECEIPT_ENTRY],
      ['PaymentId', 'text', 'รหัสการรับเงินที่ผูกอยู่ (ว่าง = ยกเลิกก่อนบันทึกรับเงิน)'],
      ['ReceiptDate', 'date', 'วันที่ในใบเสร็จ'],
      ['Amount', 'money', 'จำนวนเงินในใบเสร็จ (บาท)'],
      ['StudentId', 'text', 'รหัสนักเรียนในระบบ'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [{ cols: ['BookId', 'ReceiptNo'], message: 'เลขที่ใบเสร็จนี้ถูกบันทึกในทะเบียนคุมแล้ว ใช้ซ้ำไม่ได้' }],
    // PaymentId/ReceiptDate/Amount/StudentId เปลี่ยนได้เฉพาะกรณี "แก้ไขรายการบันทึกผิด" ที่ได้รับอนุมัติ
    mutable: ['Status', 'PaymentId', 'ReceiptDate', 'Amount', 'StudentId'],
  },

  [SHEETS.RECEIPT_CANCELLATIONS]: {
    label: 'ประวัติการยกเลิกเลขที่ใบเสร็จ',
    idPrefix: 'RCX',
    tabColor: TAB_COLORS.RECEIPT,
    columns: [
      ['CancellationId', 'id', 'รหัสการยกเลิก (ระบบสร้างอัตโนมัติ) ผู้ขอ = CreatedBy, เวลาที่ขอ = CreatedAt'],
      ['EntryId', 'text', 'รหัสรายการทะเบียนคุมใบเสร็จ'],
      ['BookId', 'text', 'รหัสเล่มใบเสร็จ'],
      ['BookNo', 'text', 'เลขเล่ม'],
      ['ReceiptNo', 'int', 'เลขที่ใบเสร็จ'],
      ['CancelType', 'enum', 'SPOILED เขียนผิดหรือชำรุด / VOID_PAYMENT ยกเลิกใบเสร็จที่บันทึกรับเงินแล้ว', STATUS.CANCEL_TYPE],
      ['PaymentId', 'text', 'รหัสการรับเงินที่เกี่ยวข้อง'],
      ['Amount', 'money', 'จำนวนเงินในใบเสร็จที่ยกเลิก (บาท)'],
      ['Reason', 'text', 'เหตุผลการยกเลิก'],
      ['Status', 'enum', 'PENDING รออนุมัติ / APPROVED อนุมัติ / REJECTED ไม่อนุมัติ / WITHDRAWN ถอนคำขอ', STATUS.DECISION],
      ['DecidedBy', 'text', 'ผู้พิจารณา'],
      ['DecidedAt', 'datetime', 'วันเวลาที่พิจารณา'],
      ['DecisionNote', 'text', 'ความเห็นของผู้พิจารณา'],
      ['ApprovalRequestId', 'text', 'รหัสคำขออนุมัติ'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [],
    mutable: ['Status', 'DecidedBy', 'DecidedAt', 'DecisionNote', 'ApprovalRequestId'],
  },

  [SHEETS.APPROVAL_REQUESTS]: {
    label: 'คำขออนุมัติ',
    idPrefix: 'APR',
    tabColor: TAB_COLORS.APPROVAL,
    columns: [
      ['RequestId', 'id', 'รหัสคำขออนุมัติ (ระบบสร้างอัตโนมัติ) ผู้ขอ = CreatedBy, เวลาที่ขอ = CreatedAt'],
      ['RequestType', 'enum', 'ประเภทคำขอ', STATUS.REQUEST_TYPE],
      ['RefId', 'text', 'รหัสรายการที่ขออนุมัติ'],
      ['StudentId', 'text', 'รหัสนักเรียนที่เกี่ยวข้อง'],
      ['Summary', 'text', 'สรุปคำขอ'],
      ['PayloadJson', 'json', 'รายละเอียดคำขอ (ระบบใช้ ห้ามแก้ไขด้วยมือ)'],
      ['Reason', 'text', 'เหตุผลของผู้ขอ'],
      ['Status', 'enum', 'PENDING รออนุมัติ / APPROVED อนุมัติ / REJECTED ไม่อนุมัติ / WITHDRAWN ถอนคำขอ', STATUS.DECISION],
      ['DecidedBy', 'text', 'ผู้พิจารณา'],
      ['DecidedAt', 'datetime', 'วันเวลาที่พิจารณา'],
      ['DecisionNote', 'text', 'ความเห็นของผู้พิจารณา'],
    ].concat(STD_CREATED_COLUMNS_, STD_UPDATED_COLUMNS_),
    unique: [],
    mutable: ['Status', 'DecidedBy', 'DecidedAt', 'DecisionNote'],
  },

  [SHEETS.AUDIT_LOGS]: {
    label: 'ประวัติการใช้งาน',
    idPrefix: 'LOG',
    tabColor: TAB_COLORS.AUDIT,
    writeVia: 'audit',
    columns: [
      ['LogId', 'id', 'รหัสประวัติ (ระบบสร้างอัตโนมัติ)'],
      ['Timestamp', 'datetime', 'วันเวลา'],
      ['UserId', 'text', 'รหัสผู้ใช้'],
      ['Username', 'text', 'ชื่อผู้ใช้'],
      ['Role', 'text', 'บทบาทขณะทำรายการ'],
      ['Action', 'enum', 'การกระทำ', AUDIT_ACTIONS],
      ['Entity', 'text', 'ชีตหรือหมวดข้อมูล'],
      ['EntityId', 'text', 'รหัสรายการ'],
      ['BeforeJson', 'json', 'ค่าเดิม (เฉพาะคอลัมน์ที่เปลี่ยน)'],
      ['AfterJson', 'json', 'ค่าใหม่'],
      ['Note', 'text', 'หมายเหตุ'],
      ['PrevHash', 'text', 'ค่า hash ของแถวก่อนหน้า'],
      ['Hash', 'text', 'ค่า hash ของแถวนี้ ใช้ตรวจว่ามีการแก้ไขหรือลบประวัติหรือไม่'],
    ],
    unique: [],
    mutable: [],
  },
});

/**
 * ค่าตั้งค่าเริ่มต้นใน SchoolSettings (SetupDatabase เพิ่มเฉพาะรายการที่ยังไม่มี ไม่เขียนทับค่าเดิม)
 * type: text | int | bool | list (คั่นด้วยจุลภาค) | year (ปีการศึกษา พ.ศ.)
 */
const SETTINGS_DEFS = Object.freeze([
  { key: 'SCHOOL_NAME', type: 'text', defaultValue: 'โรงเรียนวัดเสาหิน', description: 'ชื่อโรงเรียน (ใช้ในหัวเอกสาร)' },
  { key: 'SCHOOL_ADDRESS', type: 'text', defaultValue: '', description: 'ที่อยู่โรงเรียน (ใช้ในหัวเอกสาร)' },
  { key: 'SCHOOL_PROVINCE', type: 'text', defaultValue: 'เชียงใหม่', description: 'จังหวัด' },
  { key: 'SCHOOL_AFFILIATION', type: 'text', defaultValue: '', description: 'หน่วยงานต้นสังกัด (กรอกตามจริง)' },
  { key: 'DIRECTOR_NAME', type: 'text', defaultValue: '', description: 'ชื่อผู้อำนวยการ (ใช้ในช่องลงนาม)' },
  { key: 'DIRECTOR_POSITION', type: 'text', defaultValue: 'ผู้อำนวยการโรงเรียนวัดเสาหิน', description: 'ตำแหน่งผู้อำนวยการ (ใช้ในช่องลงนาม)' },
  { key: 'FINANCE_OFFICER_NAME', type: 'text', defaultValue: '', description: 'ชื่อเจ้าหน้าที่การเงิน (ใช้ในช่องลงนาม)' },
  { key: 'FINANCE_OFFICER_POSITION', type: 'text', defaultValue: 'เจ้าหน้าที่การเงิน', description: 'ตำแหน่งเจ้าหน้าที่การเงิน (ใช้ในช่องลงนาม)' },
  { key: 'CURRENT_ACADEMIC_YEAR', type: 'year', defaultValue: null, description: 'ปีการศึกษาปัจจุบัน (พ.ศ.) ค่าเริ่มต้นคำนวณจากวันที่ติดตั้ง' },
  { key: 'GRADE_LEVELS', type: 'list', defaultValue: 'อ.1,อ.2,อ.3,ป.1,ป.2,ป.3,ป.4,ป.5,ป.6', description: 'ระดับชั้นที่เปิดสอน คั่นด้วยจุลภาค เรียงจากชั้นต่ำไปสูง (ใช้เลื่อนชั้น)' },
  { key: 'PAYMENT_CHANNELS', type: 'list', defaultValue: 'เงินสด,โอนเงินเข้าบัญชีโรงเรียน', description: 'ช่องทางการรับเงิน คั่นด้วยจุลภาค' },
  { key: 'APPROVAL_FEE_ADJUSTMENT', type: 'bool', defaultValue: 'TRUE', description: 'การลดหย่อน/ยกเว้น ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'APPROVAL_ASSESSMENT_CANCEL', type: 'bool', defaultValue: 'TRUE', description: 'การยกเลิกรายการเรียกเก็บ ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'APPROVAL_RECEIPT_CANCEL', type: 'bool', defaultValue: 'TRUE', description: 'การยกเลิกเลขที่ใบเสร็จ ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'APPROVAL_PAYMENT_CORRECTION', type: 'bool', defaultValue: 'TRUE', description: 'การแก้ไขรายการรับเงินที่บันทึกผิด ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'APPROVAL_BOOK_CLOSE', type: 'bool', defaultValue: 'TRUE', description: 'การปิดเล่มใบเสร็จก่อนใช้ครบเล่ม ต้องให้ผู้อำนวยการอนุมัติ' },
  { key: 'RECEIPT_LOW_WARNING', type: 'int', defaultValue: '5', min: 0, max: 100, description: 'แจ้งเตือนเมื่อเลขที่ใบเสร็จในเล่มที่กำลังใช้เหลือน้อยกว่าหรือเท่ากับจำนวนนี้' },
  { key: 'RECEIPT_STRICT_SEQUENCE', type: 'bool', defaultValue: 'TRUE', description: 'TRUE = ต้องใช้เลขที่ถัดไปเท่านั้น ถ้าจะข้ามเลขต้องยกเลิกเลขนั้นพร้อมเหตุผลก่อน (ค่าที่แนะนำ) / FALSE = ใช้เลขอื่นในเล่มได้แต่ต้องยืนยันคำเตือนเลขขาดช่วง' },
  { key: 'SESSION_IDLE_MINUTES', type: 'int', defaultValue: '30', min: 5, max: 240, description: 'ไม่ใช้งานเกินกี่นาทีจึงต้องเข้าสู่ระบบใหม่' },
  { key: 'SESSION_MAX_HOURS', type: 'int', defaultValue: '8', min: 1, max: 12, description: 'อายุสูงสุดของการเข้าสู่ระบบแต่ละครั้ง (ชั่วโมง)' },
  { key: 'LOGIN_MAX_ATTEMPTS', type: 'int', defaultValue: '5', min: 3, max: 20, description: 'จำนวนครั้งที่ใส่รหัสผ่านผิดได้ก่อนถูกล็อกชั่วคราว' },
  { key: 'LOGIN_LOCK_MINUTES', type: 'int', defaultValue: '15', min: 5, max: 1440, description: 'ระยะเวลาล็อกชั่วคราวเมื่อใส่รหัสผ่านผิดเกินกำหนด (นาที)' },
  { key: 'BACKUP_RETENTION', type: 'int', defaultValue: '60', min: 7, max: 365, description: 'จำนวนไฟล์สำรองข้อมูลรายวันที่เก็บไว้ (ไม่นับไฟล์วันแรกของเดือนซึ่งเก็บถาวร)' },
]);
