/**
 * ============================================================================
 *  StudentImport.gs — นำเข้ารายชื่อนักเรียน (Excel/CSV) และเลื่อนชั้นขึ้นปีการศึกษาใหม่
 * ----------------------------------------------------------------------------
 *  นำเข้า 2 ขั้นตอน: ตรวจสอบ (ไม่บันทึกอะไร) → ยืนยันนำเข้า (ตรวจซ้ำทั้งหมดภายใต้ lock ก่อนบันทึก)
 *  ทุกแถวถูกจัดประเภท และบันทึกเฉพาะประเภทที่ปลอดภัย เว้นแต่ผู้ใช้เลือกเอง:
 *   NEW               นักเรียนใหม่                              → เพิ่ม
 *   ENROLL            นักเรียนเดิมที่ยังไม่มีชั้นเรียนในปีนี้        → เพิ่มชั้นเรียน
 *   SAME              ตรงกับในระบบทุกอย่าง                      → ไม่ทำอะไร
 *   UPDATE            นักเรียนเดิม แต่ชั้น/ห้อง/เลขที่ต่าง          → ปรับปรุงเมื่อเลือก "ปรับปรุงข้อมูลเดิม"
 *   CONFLICT          เลขประจำตัวมีแล้ว แต่ชื่อต่างจากในระบบ       → ปรับปรุงเมื่อเลือก "ปรับปรุงข้อมูลเดิม"
 *   NAME_DUPLICATE    ชื่อซ้ำกับนักเรียนเดิม แต่เลขประจำตัวต่าง      → เพิ่มเมื่อเลือก "ยืนยันว่าเป็นคนละคน"
 *   DUPLICATE_IN_FILE เลขประจำตัวซ้ำกันเองในไฟล์                 → ข้าม
 *   INVALID           ข้อมูลไม่ครบหรือไม่ถูกต้อง หรือเลขที่ซ้ำ       → ข้าม
 *  การนำเข้าไฟล์เดิมซ้ำจะไม่เกิดข้อมูลซ้ำ (แถวที่บันทึกแล้วจะเป็น SAME)
 * ============================================================================
 */

const IMPORT_MAX_ROWS = 1500;
const IMPORT_STATUS_LABELS = Object.freeze({
  NEW: 'นักเรียนใหม่',
  ENROLL: 'นักเรียนเดิม: เพิ่มชั้นเรียนปีนี้',
  SAME: 'ไม่มีการเปลี่ยนแปลง',
  UPDATE: 'นักเรียนเดิม: ข้อมูลต่างจากในระบบ',
  CONFLICT: 'เลขประจำตัวซ้ำ แต่ชื่อต่างจากในระบบ',
  NAME_DUPLICATE: 'ชื่อซ้ำกับนักเรียนเดิม',
  DUPLICATE_IN_FILE: 'เลขประจำตัวซ้ำในไฟล์',
  INVALID: 'ข้อมูลไม่ถูกต้อง',
});

function importOptions_(payload) {
  return {
    updateExisting: payload.updateExisting === true,
    acceptNameDuplicates: payload.acceptNameDuplicates === true,
  };
}

/** แถวนี้จะถูกบันทึกหรือไม่ ตามตัวเลือกของผู้ใช้ */
function importRowApplies_(item, options) {
  switch (item.status) {
    case 'NEW':
    case 'ENROLL':
      return true;
    case 'UPDATE':
    case 'CONFLICT':
      return options.updateExisting;
    case 'NAME_DUPLICATE':
      return options.acceptNameDuplicates;
    default:
      return false;
  }
}

function importRawText_(v) {
  return v === null || v === undefined ? '' : String(v);
}

/** ตรวจและจัดประเภททุกแถว (ไม่บันทึกอะไร) */
function analyzeImport_(year, rawRows, options) {
  if (!Array.isArray(rawRows) || !rawRows.length) throw validationError_('ไม่พบข้อมูลที่จะนำเข้า');
  if (rawRows.length > IMPORT_MAX_ROWS) throw validationError_('นำเข้าได้ครั้งละไม่เกิน ' + IMPORT_MAX_ROWS.toLocaleString() + ' แถว');
  const levels = gradeLevels_();
  const byNo = Object.create(null);
  const byName = Object.create(null);
  const studentsById = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) {
    studentsById[s.StudentId] = s;
    byNo[String(s.StudentNo).toUpperCase()] = s;
    const key = nameKey_(s.FirstName, s.LastName);
    (byName[key] = byName[key] || []).push(s);
  });
  const yearEnrollments = dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === year; });
  const enrollmentByStudent = Object.create(null);
  yearEnrollments.forEach(function (e) { enrollmentByStudent[e.StudentId] = e; });
  const seenNo = Object.create(null);

  const items = rawRows.map(function (raw, i) {
    const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const item = {
      rowNo: Number.isInteger(row.rowNo) && row.rowNo > 0 ? row.rowNo : i + 1,
      status: '',
      messages: [],
      changes: [],
      data: null,
      existing: null,
    };
    let prefix = importRawText_(row.prefix);
    let firstName = importRawText_(row.firstName);
    let lastName = importRawText_(row.lastName);
    if (!cleanText_(firstName) && cleanText_(row.fullName)) {
      const split = splitThaiFullName_(cleanText_(row.fullName));
      prefix = cleanText_(prefix) || split.prefix;
      firstName = split.firstName;
      lastName = split.lastName;
    }
    let gradeLevel = importRawText_(row.gradeLevel);
    let room = importRawText_(row.room);
    if (!cleanText_(gradeLevel) && cleanText_(row.gradeRoom)) {
      const parts = cleanText_(row.gradeRoom).split('/');
      gradeLevel = parts[0];
      room = cleanText_(room) || parts[1] || '';
    }
    let data;
    try {
      data = validateStudentInput_({ studentNo: row.studentNo, prefix: prefix, firstName: firstName, lastName: lastName,
        gradeLevel: gradeLevel, room: room, classNo: row.classNo }, levels);
    } catch (e) {
      if (!isAppError_(e)) throw e;
      item.status = 'INVALID';
      item.messages.push(e.userMessage);
      item.data = {
        studentNo: cleanText_(row.studentNo), prefix: cleanText_(prefix), firstName: cleanText_(firstName), lastName: cleanText_(lastName),
        gradeLevel: cleanText_(gradeLevel), room: cleanText_(room), classNo: cleanText_(row.classNo),
      };
      return item;
    }
    item.data = data;
    const noKey = data.studentNo.toUpperCase();
    if (seenNo[noKey]) {
      item.status = 'DUPLICATE_IN_FILE';
      item.messages.push('เลขประจำตัวซ้ำกับแถวที่ ' + seenNo[noKey] + ' ในไฟล์');
      return item;
    }
    seenNo[noKey] = item.rowNo;

    const existing = byNo[noKey];
    if (existing) {
      item.existing = {
        studentId: existing.StudentId,
        fullName: studentDisplayName_(existing.Prefix, existing.FirstName, existing.LastName),
        status: existing.Status,
      };
      if (nameKey_(existing.FirstName, existing.LastName) !== nameKey_(data.firstName, data.lastName)) {
        item.status = 'CONFLICT';
        item.messages.push('เลขประจำตัวนี้ในระบบเป็นของ ' + item.existing.fullName);
        item.changes.push('ชื่อ ' + item.existing.fullName + ' → ' + studentDisplayName_(data.prefix, data.firstName, data.lastName));
      } else if (data.prefix && data.prefix !== existing.Prefix) {
        item.changes.push('คำนำหน้า ' + (existing.Prefix || '–') + ' → ' + data.prefix);
      }
      const enrollment = enrollmentByStudent[existing.StudentId];
      if (!enrollment) {
        item.changes.push('เพิ่มชั้นเรียน ' + classLabel_(data.gradeLevel, data.room) + ' ปีการศึกษา ' + year);
        if (!item.status) item.status = item.changes.length > 1 ? 'UPDATE' : 'ENROLL';
      } else {
        if (enrollment.GradeLevel !== data.gradeLevel || enrollment.Room !== data.room) {
          item.changes.push('ชั้น ' + classLabel_(enrollment.GradeLevel, enrollment.Room) + ' → ' + classLabel_(data.gradeLevel, data.room));
        }
        if (enrollment.ClassNo !== data.classNo) {
          item.changes.push('เลขที่ ' + (enrollment.ClassNo === null ? '–' : enrollment.ClassNo) + ' → ' + (data.classNo === null ? '–' : data.classNo));
        }
        if (!item.status) item.status = item.changes.length ? 'UPDATE' : 'SAME';
      }
      if (existing.Status !== STATUS.STUDENT.STUDYING) {
        item.messages.push('สถานะในระบบ: ' + STATUS_LABELS.STUDENT[existing.Status]);
      }
      return item;
    }
    const sameName = byName[nameKey_(data.firstName, data.lastName)];
    if (sameName && sameName.length) {
      item.status = 'NAME_DUPLICATE';
      item.messages.push('ชื่อซ้ำกับ ' + studentDisplayName_(sameName[0].Prefix, sameName[0].FirstName, sameName[0].LastName) +
        ' (เลขประจำตัว ' + sameName[0].StudentNo + ') ตรวจให้แน่ใจว่าเป็นคนละคน');
    } else {
      item.status = 'NEW';
    }
    return item;
  });

  markClassNoConflicts_(year, items, options, yearEnrollments, studentsById);
  return items;
}

/**
 * เลขที่ต้องไม่ซ้ำในห้องเดียวกันหลังนำเข้า
 * - ค่าที่จะยังอยู่ในระบบ (นักเรียนที่ไม่ได้ถูกปรับปรุงในการนำเข้านี้) ถือเป็นค่าที่จองแล้ว
 * - แถวที่จะบันทึก ไล่ตามลำดับในไฟล์ แถวหลังที่ซ้ำจะถูกเปลี่ยนเป็น INVALID
 */
function markClassNoConflicts_(year, items, options, yearEnrollments, studentsById) {
  const changing = Object.create(null);
  items.forEach(function (it) {
    if (it.existing && (it.status === 'UPDATE' || it.status === 'CONFLICT') && options.updateExisting) changing[it.existing.studentId] = true;
  });
  const occupied = Object.create(null);
  const slot = function (grade, room, no) { return grade + '|' + room + '|' + no; };
  yearEnrollments.forEach(function (e) {
    if (e.ClassNo === null || e.EnrollStatus !== STATUS.STUDENT.STUDYING || changing[e.StudentId]) return;
    const s = studentsById[e.StudentId];
    occupied[slot(e.GradeLevel, e.Room, e.ClassNo)] = s ? studentDisplayName_(s.Prefix, s.FirstName, s.LastName) + ' (ในระบบ)' : 'นักเรียนในระบบ';
  });
  items.forEach(function (it) {
    if (!importRowApplies_(it, options) || !it.data || it.data.classNo === null) return;
    if (it.status === 'SAME') return;
    const key = slot(it.data.gradeLevel, it.data.room, it.data.classNo);
    if (occupied[key]) {
      it.status = 'INVALID';
      it.messages.push('เลขที่ ' + it.data.classNo + ' ของชั้น ' + classLabel_(it.data.gradeLevel, it.data.room) + ' ซ้ำกับ ' + occupied[key]);
      return;
    }
    occupied[key] = 'แถวที่ ' + it.rowNo + ' ในไฟล์';
  });
}

function importCounts_(items, options) {
  const counts = { total: items.length, apply: 0 };
  Object.keys(IMPORT_STATUS_LABELS).forEach(function (k) { counts[k] = 0; });
  items.forEach(function (it) {
    counts[it.status] += 1;
    if (importRowApplies_(it, options)) counts.apply += 1;
  });
  return counts;
}

/**
 * students.importPreview — ตรวจข้อมูลที่จะนำเข้า (ไม่บันทึก)
 * payload: { year, rows: [{ rowNo, studentNo, prefix, firstName, lastName, fullName, gradeLevel, room, gradeRoom, classNo }],
 *            updateExisting, acceptNameDuplicates }
 */
function studentsImportPreview_(ctx, payload) {
  const year = requireAcademicYear_(payload.year, { mustBeOpen: true });
  const options = importOptions_(payload);
  const items = analyzeImport_(year, payload.rows, options);
  return {
    year: year,
    options: options,
    counts: importCounts_(items, options),
    labels: IMPORT_STATUS_LABELS,
    rows: items.map(function (it) {
      return {
        rowNo: it.rowNo,
        status: it.status,
        statusLabel: IMPORT_STATUS_LABELS[it.status],
        applies: importRowApplies_(it, options),
        messages: it.messages,
        changes: it.changes,
        studentNo: it.data ? it.data.studentNo : '',
        fullName: it.data ? studentDisplayName_(it.data.prefix, it.data.firstName, it.data.lastName) : '',
        classLabel: it.data && it.data.gradeLevel ? classLabel_(it.data.gradeLevel, it.data.room) : '',
        classNo: it.data ? it.data.classNo : null,
        existingName: it.existing ? it.existing.fullName : '',
      };
    }),
  };
}

/** students.importCommit — ตรวจซ้ำทั้งหมดภายใต้ lock แล้วบันทึกเฉพาะแถวที่ผ่าน */
function studentsImportCommit_(ctx, payload) {
  const year = requireAcademicYear_(payload.year, { mustBeOpen: true });
  const options = importOptions_(payload);
  const fileName = requireText_(payload.fileName, 'ชื่อไฟล์', { optional: true, max: 200 });
  const items = analyzeImport_(year, payload.rows, options);
  const actor = actorFromCtx_(ctx);
  const note = 'นำเข้าข้อมูลนักเรียน ปีการศึกษา ' + year + (fileName ? ' จาก ' + fileName : '');
  const result = { year: year, created: 0, enrolled: 0, updated: 0, unchanged: 0, skipped: 0 };

  const toCreate = items.filter(function (it) {
    return importRowApplies_(it, options) && (it.status === 'NEW' || it.status === 'NAME_DUPLICATE');
  });
  const created = dbInsertMany_(SHEETS.STUDENTS, toCreate.map(function (it) {
    return { StudentNo: it.data.studentNo, Prefix: it.data.prefix, FirstName: it.data.firstName, LastName: it.data.lastName, Status: STATUS.STUDENT.STUDYING };
  }), actor, { action: AUDIT_ACTIONS.IMPORT, note: note });
  result.created = created.length;

  const newEnrollments = created.map(function (s, i) {
    const d = toCreate[i].data;
    return { StudentId: s.StudentId, AcademicYear: year, GradeLevel: d.gradeLevel, Room: d.room, ClassNo: d.classNo, EnrollStatus: STATUS.STUDENT.STUDYING };
  });

  items.forEach(function (it) {
    if (!importRowApplies_(it, options) || !it.existing) return;
    const d = it.data;
    const studentId = it.existing.studentId;
    const student = dbGet_(SHEETS.STUDENTS, studentId);
    const enrollment = enrollmentOf_(studentId, year);
    let changed = false;
    if (it.status === 'UPDATE' || it.status === 'CONFLICT') {
      const res = dbUpdate_(SHEETS.STUDENTS, studentId, { Prefix: d.prefix || student.Prefix, FirstName: d.firstName, LastName: d.lastName },
        actor, { action: AUDIT_ACTIONS.IMPORT, note: note });
      changed = res.changed.length > 0;
    }
    if (enrollment) {
      const res = dbUpdate_(SHEETS.ENROLLMENTS, enrollment.EnrollmentId, { GradeLevel: d.gradeLevel, Room: d.room, ClassNo: d.classNo },
        actor, { action: AUDIT_ACTIONS.IMPORT, note: note });
      changed = changed || res.changed.length > 0;
      if (changed) result.updated += 1;
    } else {
      newEnrollments.push({ StudentId: studentId, AcademicYear: year, GradeLevel: d.gradeLevel, Room: d.room, ClassNo: d.classNo, EnrollStatus: student.Status });
      if (it.status === 'ENROLL') result.enrolled += 1;
      else result.updated += 1;
    }
  });
  dbInsertMany_(SHEETS.ENROLLMENTS, newEnrollments, actor, { action: AUDIT_ACTIONS.IMPORT, note: note });

  items.forEach(function (it) {
    if (it.status === 'SAME') result.unchanged += 1;
    else if (!importRowApplies_(it, options)) result.skipped += 1;
  });
  auditAppend_([{
    action: AUDIT_ACTIONS.IMPORT,
    entity: SHEETS.STUDENTS,
    entityId: '',
    after: { year: year, fileName: fileName, rows: items.length, created: result.created, enrolled: result.enrolled,
      updated: result.updated, unchanged: result.unchanged, skipped: result.skipped },
    note: note + ': เพิ่มใหม่ ' + result.created + ' คน, เพิ่มชั้นเรียน ' + result.enrolled + ' คน, ปรับปรุง ' + result.updated +
      ' คน, ไม่เปลี่ยนแปลง ' + result.unchanged + ' คน, ข้าม ' + result.skipped + ' แถว',
  }], actor);
  return result;
}

// ---------------------------------------------------------------------------
// เลื่อนชั้นขึ้นปีการศึกษาใหม่
// ---------------------------------------------------------------------------

/**
 * วางแผนเลื่อนชั้น: นักเรียนที่กำลังศึกษาในปีเดิม → ชั้นถัดไปตามลำดับในตั้งค่า GRADE_LEVELS
 * ชั้นสุดท้าย → จบการศึกษา / มีชั้นเรียนในปีใหม่แล้ว → ข้าม (รันซ้ำได้ไม่เกิดข้อมูลซ้ำ)
 */
function promotionPlan_(fromYear, toYear) {
  const levels = gradeLevels_();
  const students = Object.create(null);
  dbAll_(SHEETS.STUDENTS).forEach(function (s) { students[s.StudentId] = s; });
  const targetHas = Object.create(null);
  const occupied = Object.create(null);
  dbFind_(SHEETS.ENROLLMENTS, function (e) { return e.AcademicYear === toYear; }).forEach(function (e) {
    targetHas[e.StudentId] = true;
    if (e.ClassNo !== null && e.EnrollStatus === STATUS.STUDENT.STUDYING) occupied[e.GradeLevel + '|' + e.Room + '|' + e.ClassNo] = true;
  });
  return dbFind_(SHEETS.ENROLLMENTS, function (e) {
    return e.AcademicYear === fromYear && e.EnrollStatus === STATUS.STUDENT.STUDYING &&
      students[e.StudentId] && students[e.StudentId].Status === STATUS.STUDENT.STUDYING;
  }).map(function (e) {
    const s = students[e.StudentId];
    const item = {
      studentId: s.StudentId,
      enrollmentId: e.EnrollmentId,
      studentNo: s.StudentNo,
      fullName: studentDisplayName_(s.Prefix, s.FirstName, s.LastName),
      fromGrade: e.GradeLevel,
      room: e.Room,
      classNo: e.ClassNo,
      action: '',
      toGrade: '',
      reason: '',
      classNoCleared: false,
    };
    const idx = levels.indexOf(e.GradeLevel);
    if (targetHas[s.StudentId]) {
      item.action = 'SKIP';
      item.reason = 'มีข้อมูลชั้นเรียนปีการศึกษา ' + toYear + ' แล้ว';
    } else if (idx === -1) {
      item.action = 'SKIP';
      item.reason = 'ระดับชั้น ' + e.GradeLevel + ' ไม่อยู่ในรายการระดับชั้นที่เปิดสอน';
    } else if (idx === levels.length - 1) {
      item.action = 'GRADUATE';
    } else {
      item.action = 'PROMOTE';
      item.toGrade = levels[idx + 1];
      if (item.classNo !== null) {
        const key = item.toGrade + '|' + item.room + '|' + item.classNo;
        if (occupied[key]) {
          item.classNo = null;
          item.classNoCleared = true;
        } else {
          occupied[key] = true;
        }
      }
    }
    return item;
  });
}

function requirePromotionYears_(payload) {
  const fromYear = requireAcademicYear_(payload.fromYear);
  const toYear = requireAcademicYear_(payload.toYear, { mustBeOpen: true });
  if (toYear <= fromYear) throw validationError_('ปีการศึกษาใหม่ต้องมากกว่าปีการศึกษาเดิม');
  return { fromYear: fromYear, toYear: toYear };
}

function summarizePromotion_(plan) {
  const groups = Object.create(null);
  const order = [];
  plan.forEach(function (it) {
    if (it.action === 'SKIP') return;
    const key = it.fromGrade + '→' + (it.action === 'GRADUATE' ? 'GRADUATE' : it.toGrade);
    if (!groups[key]) {
      groups[key] = { fromGrade: it.fromGrade, toGrade: it.action === 'GRADUATE' ? '' : it.toGrade, graduate: it.action === 'GRADUATE', count: 0 };
      order.push(key);
    }
    groups[key].count += 1;
  });
  const levels = gradeLevels_();
  return order.map(function (k) { return groups[k]; }).sort(function (a, b) { return levels.indexOf(a.fromGrade) - levels.indexOf(b.fromGrade); });
}

/** students.promotePreview — ดูผลการเลื่อนชั้นก่อนยืนยัน (ไม่บันทึก) */
function studentsPromotePreview_(ctx, payload) {
  const years = requirePromotionYears_(payload);
  const plan = promotionPlan_(years.fromYear, years.toYear);
  return {
    fromYear: years.fromYear,
    toYear: years.toYear,
    groups: summarizePromotion_(plan),
    promote: plan.filter(function (it) { return it.action === 'PROMOTE'; }).length,
    graduate: plan.filter(function (it) { return it.action === 'GRADUATE'; }).length,
    classNoCleared: plan.filter(function (it) { return it.classNoCleared; }).length,
    skipped: plan.filter(function (it) { return it.action === 'SKIP'; }).map(function (it) {
      return { studentNo: it.studentNo, fullName: it.fullName, classLabel: classLabel_(it.fromGrade, it.room), reason: it.reason };
    }),
  };
}

/** students.promoteCommit — เลื่อนชั้นจริง (ข้อมูลปีเดิมไม่ถูกแก้ ยกเว้นสถานะจบการศึกษาของชั้นสุดท้าย) */
function studentsPromoteCommit_(ctx, payload) {
  const years = requirePromotionYears_(payload);
  const graduationDate = requireIsoDate_(payload.graduationDate, 'วันที่จบการศึกษา', { optional: true }) || todayIso_();
  const plan = promotionPlan_(years.fromYear, years.toYear);
  const actor = actorFromCtx_(ctx);
  const promote = plan.filter(function (it) { return it.action === 'PROMOTE'; });
  dbInsertMany_(SHEETS.ENROLLMENTS, promote.map(function (it) {
    return {
      StudentId: it.studentId,
      AcademicYear: years.toYear,
      GradeLevel: it.toGrade,
      Room: it.room,
      ClassNo: it.classNo,
      EnrollStatus: STATUS.STUDENT.STUDYING,
      Note: 'เลื่อนชั้นจาก ' + classLabel_(it.fromGrade, it.room) + ' ปีการศึกษา ' + years.fromYear,
    };
  }), actor, { action: AUDIT_ACTIONS.PROMOTE });
  const graduates = plan.filter(function (it) { return it.action === 'GRADUATE'; });
  graduates.forEach(function (it) {
    const note = 'จบการศึกษาชั้น ' + it.fromGrade + ' ปีการศึกษา ' + years.fromYear;
    dbUpdate_(SHEETS.STUDENTS, it.studentId, { Status: STATUS.STUDENT.GRADUATED, StatusDate: graduationDate, StatusNote: note },
      actor, { action: AUDIT_ACTIONS.PROMOTE, note: note });
    dbUpdate_(SHEETS.ENROLLMENTS, it.enrollmentId, { EnrollStatus: STATUS.STUDENT.GRADUATED }, actor, { action: AUDIT_ACTIONS.PROMOTE, note: note });
  });
  const skipped = plan.length - promote.length - graduates.length;
  auditAppend_([{
    action: AUDIT_ACTIONS.PROMOTE,
    entity: SHEETS.ENROLLMENTS,
    entityId: '',
    after: { fromYear: years.fromYear, toYear: years.toYear, promoted: promote.length, graduated: graduates.length, skipped: skipped },
    note: 'เลื่อนชั้นจากปีการศึกษา ' + years.fromYear + ' เป็น ' + years.toYear + ': เลื่อนชั้น ' + promote.length +
      ' คน, จบการศึกษา ' + graduates.length + ' คน, ข้าม ' + skipped + ' คน',
  }], actor);
  return {
    fromYear: years.fromYear,
    toYear: years.toYear,
    promoted: promote.length,
    graduated: graduates.length,
    skipped: skipped,
    classNoCleared: promote.filter(function (it) { return it.classNoCleared; }).length,
  };
}
