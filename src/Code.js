/**
 * ============================================================================
 *  Code.gs — จุดเข้าของ Web App
 * ----------------------------------------------------------------------------
 *  ระยะที่ 1: แสดงหน้าสถานะ "อยู่ระหว่างติดตั้ง" เท่านั้น ไม่มีข้อมูลใด ๆ
 *  ระยะที่ 2: เปลี่ยนเป็นหน้าเข้าสู่ระบบและแอปเต็มรูปแบบ
 * ============================================================================
 */

function doGet() {
  const html =
    '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><base target="_top"></head>' +
    '<body style="margin:0;font-family:Sarabun,Tahoma,sans-serif;background:#F4F7FB;color:#1F3A5F">' +
    '<div style="max-width:560px;margin:48px auto;padding:24px;background:#FFFFFF;border-radius:12px;' +
    'border-top:6px solid #1F3A5F">' +
    '<h2 style="margin:0 0 4px">' + escapeHtml_(APP.NAME) + '</h2>' +
    '<p style="margin:0;color:#4A6A8F">' + escapeHtml_(APP.SCHOOL_NAME + ' จังหวัด' + APP.PROVINCE) + '</p>' +
    '<p style="margin:24px 0 0">ระบบอยู่ระหว่างการติดตั้ง ยังไม่เปิดให้ใช้งาน</p>' +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
