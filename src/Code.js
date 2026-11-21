/**
 * ============================================================================
 *  Code.gs — จุดเข้าของ Web App และการประกอบหน้าเว็บ
 * ----------------------------------------------------------------------------
 *  - doGet() ส่งหน้าเว็บเปล่าที่ยังไม่มีข้อมูลใด ๆ ข้อมูลทั้งหมดโหลดผ่าน api() หลังเข้าสู่ระบบ
 *  - หน้าเว็บประกอบจากไฟล์ HTML (Index, Styles, JsCore, JsViews) ด้วยการแทนที่ข้อความตรง ๆ
 *    ไม่ใช้ scriptlet ของ HtmlTemplate เพื่อไม่ให้โค้ด JavaScript ถูกตีความผิด
 *  - ติดตั้งแบบไฟล์เดียว (dist/Code.gs): ไฟล์ HTML ถูกฝังไว้ในค่าคงที่ BUNDLED_HTML_
 *    ติดตั้งแบบแยกไฟล์: อ่านจากไฟล์ HTML ในโปรเจกต์
 * ============================================================================
 */

function doGet() {
  return HtmlService.createHtmlOutput(renderAppHtml_())
    .setTitle(APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** ประกอบหน้าเว็บทั้งหน้า */
function renderAppHtml_() {
  let html = htmlSource_('Index');
  html = injectHtml_(html, '<!--@@STYLES@@-->', htmlSource_('Styles'));
  html = injectHtml_(html, '/*@@BOOT@@*/', 'var BOOT = ' + safeJsonForScript_(bootConfig_()) + ';');
  html = injectHtml_(html, '/*@@SHARED@@*/', sharedClientSource_());
  html = injectHtml_(html, '<!--@@CORE@@-->', htmlSource_('JsCore'));
  html = injectHtml_(html, '<!--@@VIEWS@@-->', htmlSource_('JsViews'));
  return html;
}

/** ค่าเริ่มต้นที่หน้าเว็บต้องรู้ก่อนเข้าสู่ระบบ (ไม่มีข้อมูลลับ) */
function bootConfig_() {
  let schoolName = APP.SCHOOL_NAME;
  let province = APP.PROVINCE;
  try {
    schoolName = getSetting_('SCHOOL_NAME') || schoolName;
    province = getSetting_('SCHOOL_PROVINCE') || province;
  } catch (e) {
    // ยังไม่ได้ติดตั้งฐานข้อมูล: ใช้ค่าเริ่มต้น
  }
  return {
    appName: APP.NAME,
    schoolName: schoolName,
    province: province,
    version: APP.VERSION,
    release: APP.RELEASE,
    authMode: authMode_(),
  };
}

/** เนื้อหาไฟล์ HTML ตามชื่อ (ไฟล์เดียว: จาก BUNDLED_HTML_ / แยกไฟล์: จากไฟล์ในโปรเจกต์) */
function htmlSource_(name) {
  if (typeof BUNDLED_HTML_ !== 'undefined' && Object.prototype.hasOwnProperty.call(BUNDLED_HTML_, name)) {
    return BUNDLED_HTML_[name];
  }
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** แทนที่เครื่องหมายด้วยเนื้อหา (ไม่ใช้ String.replace เพราะ $ ในเนื้อหาจะถูกตีความพิเศษ) */
function injectHtml_(html, marker, content) {
  const index = html.indexOf(marker);
  if (index === -1) throw appError_(ERROR_CODES.INTERNAL, 'ข้อผิดพลาดของโปรแกรม: ไม่พบตำแหน่ง ' + marker + ' ในหน้าเว็บ');
  return html.slice(0, index) + content + html.slice(index + marker.length);
}

/** JSON ที่ปลอดภัยต่อการวางในแท็ก <script> */
function safeJsonForScript_(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/ /g, '\\u2028')
    .replace(/ /g, '\\u2029');
}
