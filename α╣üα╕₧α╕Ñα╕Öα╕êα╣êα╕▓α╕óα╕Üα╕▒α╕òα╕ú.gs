/**
 * แพลนจ่ายบัตรรายเดือน — Google Apps Script (v14)
 *
 * แท็บที่สคริปต์ดูแล:
 *  - แท็บรายการผ่อน (A1 = "วันที่จ่าย")  → ปรับวันจ่ายตามเงินเดือนเข้า + สถานะ
 *  - 💳 แพลนจ่ายรายเดือน   → ติ๊ก "จ่ายแล้ว" ได้ ยอดคงเหลืออัปเดตเอง
 *  - 👛 รายรับ-รายจ่าย     → กรอกรายรับ 2 คนรายเดือน ที่เหลือดึงมาคำนวณให้
 *  - 🧾 ค่าบัตรอื่นๆ        → กรอกยอดของคนที่ 1 / คนที่ 2 ทีละเดือน
 *  - 🏢 ค่าคอนโด / 🏠 ค่าบ้าน / 💡 ค่าน้ำค่าไฟ → แยกคนละแท็บ กรอกยอดทีละเดือน
 *  - 🌴 ค่าตัดปาล์ม / 🏙️ ปล่อยเช่าคอนโด → สมุดรายรับ-รายจ่าย (วันที่ / ยอด / ประเภท / หมวด)
 *       ยอดสุทธิ (รายรับ − รายจ่าย) ไปรวมเป็นรายรับของเดือนนั้น
 *
 * เงินเดือนเข้าวันที่ 29 (เดือนที่ไม่มีวันที่ 29 ใช้วันสุดท้ายของเดือน)
 * ถ้าตรงเสาร์/อาทิตย์ → เลื่อนเป็นศุกร์ก่อนหน้า
 *
 * รันซ้ำได้: ช่องที่ติ๊ก และตัวเลขที่กรอกไว้ทุกแท็บจะไม่หาย
 */

const PLAN_SHEET    = 'แพลนจ่ายรายเดือน';
const INCOME_SHEET  = 'รายรับ-รายจ่าย';
const OTHER_SHEET   = 'ค่าบัตรอื่นๆ';
const PALM_SHEET    = 'ค่าตัดปาล์ม';
const RENT_SHEET    = 'ปล่อยเช่าคอนโด';
const INCOME_IN_SHEET = 'รายรับรายเดือน';
const TRASH_PREFIX    = '__ลบแล้ว_';         // แท็บรายการผ่อนที่ลบจากเว็บ รอเก็บกวาดตอนรันครั้งถัดไป   // กรอกรายรับ + วันที่ได้รับของแต่ละคน

// ⚙️ สมุดรายรับ-รายจ่ายของกิจการ (แก้หมวดได้ที่นี่)
const LEDGERS = [
  { key: 'palm', name: PALM_SHEET, icon: '🌴', title: 'สวนปาล์ม', color: '#558B2F', light: '#F1F8E9',
    invest: true,                   // คิดการคืนทุน: ค่าที่ดิน → ได้คืนจากกำไรขายปาล์มเรื่อยๆ จนครบ
    investCat: 'ค่าที่ดิน',
    investGross: true,              // ได้คืน = รายได้ขายปาล์มอย่างเดียว ไม่หักค่าใช้จ่ายสวน
    // ใส่ให้อัตโนมัติครั้งแรกในตารางเงินลงทุน (M:O) — แก้/ลบได้ในเว็บ
    investSeed: [['ค่าที่ดิน', 62000, 'ซื้อที่ดินสวนปาล์ม']],
    investText: { title: 'ค่าที่ดิน', inc: 'ขายปาล์ม', other: 'ค่าใช้จ่ายสวน', icon: '🏞️', hint: 'เช่น ค่าที่ดิน, ค่าโอน, ค่าปรับหน้าดิน' },
    incomeCats: ['ขายปาล์ม', 'อื่นๆ'],
    expenseCats: ['ค่าปุ๋ย', 'ค่าแรงตัด', 'ค่ายา/สารเคมี', 'ค่าน้ำมัน/ขนส่ง', 'ค่าซ่อมบำรุง', 'อื่นๆ'] },
  { key: 'condo', name: RENT_SHEET, icon: '🏙️', title: 'ปล่อยเช่าคอนโด', color: '#3949AB', light: '#E8EAF6',
    invest: true,                   // คิดการคืนทุน
    investCat: 'ซื้อของเข้าห้อง',    // เงินลงทุน = รายจ่ายหมวดนี้ (ไม่นับค่างวดรายเดือน)
    investText: { title: 'ซื้อของเข้าห้อง', inc: 'ค่าเช่า', other: 'ค่าใช้จ่ายอื่น', icon: '🛋️', hint: 'เช่น แอร์ เตียง ตู้เย็น' },
    incomeCats: ['ค่าเช่า', 'ค่าน้ำไฟจากผู้เช่า', 'อื่นๆ'],
    expenseCats: ['ซื้อของเข้าห้อง', 'ค่าส่วนกลาง', 'ค่าซ่อมแซม', 'ค่าน้ำไฟ', 'ภาษี/ค่าธรรมเนียม', 'ค่านายหน้า', 'อื่นๆ'] },
];
const INCOME_TXT  = 'รายรับ';
const EXPENSE_TXT = 'รายจ่าย';
const INPUT_BG      = '#FFF2CC';

// ⚙️ ตารางรายเดือนสร้างล่วงหน้ากี่เดือนนับจากเดือนนี้ (เว็บจะต่อให้เองเมื่อเหลือน้อยกว่า HORIZON_MIN_LEFT เดือน)
const HORIZON_MONTHS   = 36;
const HORIZON_MIN_LEFT = 12;

// ⚙️ ค่าใช้จ่ายประจำ — แต่ละอันเป็นแท็บของตัวเอง กรอกยอดรายเดือน
//    amount = ยอดที่เติมให้ตอนสร้างแท็บครั้งแรก (เดือนไหนไม่เท่ากันแก้ในแท็บได้เลย)
const FIXED_SHEETS = [
  { name: 'ค่าคอนโด', icon: '🏢', amount: 13100, color: '#6D4C41' },
  { name: 'ค่าบ้าน',   icon: '🏠', amount: 20100, color: '#00897B' },
  { name: 'ค่าน้ำค่าไฟ', icon: '💡', amount: '',  color: '#F9A825' },   // ไม่มียอดตั้งต้น กรอกเองรายเดือน
];
const PAY_HEADER    = 'วันที่จ่าย (ปรับตามเงินเดือนเข้า)';
const ORIG_HEADER   = 'วันที่ตามงวดเดิม';
const STATUS_HEADER = 'สถานะ';
const PAID_HEADER   = 'จ่ายแล้ว';
const PAID_TXT      = '✅ จ่ายแล้ว';
const WAIT_TXT      = '⏳ รอจ่าย';
const FONT          = 'Sarabun';
const NUM_FMT       = '#,##0;(#,##0);-';
const HR            = 7; // แถวหัวตารางในแท็บแพลน

const PALETTE = ['#1A73E8', '#D93025', '#E37400', '#188038', '#9334E6',
                 '#12A4AF', '#D01884', '#F4511E', '#3949AB', '#5F6368'];
const COL = {
  navy: '#1F4E78', white: '#FFFFFF', line: '#DADCE0', band: '#F8F9FA',
  paidBg: '#E6F4EA', paidFg: '#137333',
  overBg: '#FCE8E6', overFg: '#C5221F',
  nextBg: '#FEF7E0', nextFg: '#B06000',
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('💳 แพลนจ่ายบัตร')
    .addItem('ปรับวันจ่าย + สร้าง/อัปเดตแพลน', 'runAll')
    .addSeparator()
    .addItem('👤 สร้าง/รีเซ็ตผู้ดูแลเว็บ (admin)', 'setupAdmin')
    .addToUi();
}

function runAll() {
  const ss = SpreadsheetApp.getActive();
  // เก็บกวาดแท็บรายการผ่อนที่ถูกลบจากเว็บ (แพลนจะสร้างใหม่ด้านล่าง)
  ss.getSheets().filter(sh => sh.getName().indexOf(TRASH_PREFIX) === 0).forEach(sh => ss.deleteSheet(sh));
  const skip = [PLAN_SHEET, INCOME_SHEET, INCOME_IN_SHEET, OTHER_SHEET, 'ผู้ใช้งาน']
    .concat(FIXED_SHEETS.map(f => f.name)).concat(LEDGERS.map(l => l.name));
  const items = ss.getSheets().filter(sh => skip.indexOf(sh.getName()) < 0 && isItemSheet_(sh));
  if (!items.length) throw new Error('ไม่พบแท็บรายการ (A1 ต้องเป็น "วันที่จ่าย")');

  let minD = null, maxD = null;
  items.forEach(sh => {
    adjustItemSheet_(sh).forEach(d => {
      if (!minD || d < minD) minD = d;
      if (!maxD || d > maxD) maxD = d;
    });
  });

  // ใช้ยาวต่อเนื่อง: สร้างเดือนล่วงหน้าเสมอ ไม่ใช่แค่ถึงงวดผ่อนสุดท้าย
  const now = new Date();
  const horizon = new Date(now.getFullYear(), now.getMonth() + HORIZON_MONTHS, 1);
  if (!maxD || maxD < horizon) maxD = horizon;
  if (!minD) minD = new Date(now.getFullYear(), now.getMonth(), 1);

  const plan = buildPlan_(ss, items, minD, maxD);
  items.forEach((sh, i) => styleItemSheet_(sh, PALETTE[i % PALETTE.length], plan));
  buildIncomeAndInputs_(ss, plan);

  try { // เรียกจากเว็บไม่มีหน้าจอชีต ข้ามได้
    ss.setActiveSheet(ss.getSheetByName(PLAN_SHEET));
    ss.toast('อัปเดตเรียบร้อย ติ๊ก "จ่ายแล้ว" ได้เลย', '💳 แพลนจ่ายบัตร', 5);
  } catch (e) {}
}

/* ---------------- แท็บรายการ ---------------- */

function isItemSheet_(sh) {
  const h = String(sh.getRange('A1').getValue()).trim();
  return h === 'วันที่จ่าย' || h === PAY_HEADER;
}

function toDate_(v) {
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  let y = +m[3];
  if (y > 2400) y -= 543; // ปี พ.ศ.
  return new Date(y, +m[2] - 1, +m[1]);
}

function paydayFormula_(ref) {
  const p = `MIN(DATE(YEAR(${ref}),MONTH(${ref}),29),EOMONTH(${ref},0))`;
  return `${p}-MAX(0,WEEKDAY(${p},2)-5)`; // เสาร์ -1, อาทิตย์ -2
}

function adjustItemSheet_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const n = last - 1;

  const done = String(sh.getRange('C1').getValue()).trim() === ORIG_HEADER;
  const dates = sh.getRange(2, done ? 3 : 1, n, 1).getValues().map(r => toDate_(r[0]));

  sh.getRange('A1').setValue(PAY_HEADER);
  sh.getRange('C1').setValue(ORIG_HEADER);
  sh.getRange(2, 3, n, 1).setValues(dates.map(d => [d || ''])).setNumberFormat('dd/mm/yyyy');
  sh.getRange(2, 1, n, 1)
    .setFormulas(dates.map((d, i) => [d ? `=${paydayFormula_('C' + (i + 2))}` : '']))
    .setNumberFormat('ddd dd/mm/yyyy');

  return dates.filter(d => d);
}

function styleItemSheet_(sh, color, plan) {
  const last = sh.getLastRow();
  const n = last - 1;
  const lookup = `${q_(PLAN_SHEET)}!$A$${plan.first}:$C$${plan.last}`;

  sh.getBandings().forEach(b => b.remove());
  sh.clearConditionalFormatRules();
  sh.getRange('F1:G1').breakApart();

  // คอลัมน์สถานะ
  sh.getRange('D1').setValue(STATUS_HEADER);
  sh.getRange(2, 4, n, 1).setFormulas(
    Array.from({ length: n }, (_, i) => {
      const r = i + 2;
      return [`=IF(C${r}="","",IF(IFERROR(VLOOKUP(DATE(YEAR(C${r}),MONTH(C${r}),1),${lookup},3,FALSE),FALSE),"${PAID_TXT}","${WAIT_TXT}"))`];
    })
  ).setHorizontalAlignment('center');

  // หน้าตา
  sh.getRange(1, 1, Math.max(last, 6), 7).setFontFamily(FONT);
  sh.getRange('A1:D1').setBackground(color).setFontColor(COL.white).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sh.getRange(2, 2, n, 1).setNumberFormat(NUM_FMT);
  sh.getRange(2, 1, n, 4).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor(COL.white).setSecondRowColor(COL.band);
  sh.getRange(1, 1, last, 4).setBorder(true, true, true, true, true, true, COL.line, SpreadsheetApp.BorderStyle.SOLID);

  // สรุปรายการ
  sh.getRange('F1').setValue('สรุปรายการนี้');
  sh.getRange('F1:G1').merge().setBackground(color).setFontColor(COL.white)
    .setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange('F2:F5').setValues([['ยอดรวม'], ['จ่ายแล้ว'], ['คงเหลือ'], ['งวดที่เหลือ']]).setFontWeight('bold');
  sh.getRange('G2:G5').setFormulas([
    [`=SUM(B2:B${last})`],
    [`=SUMIF(D2:D${last},"${PAID_TXT}",B2:B${last})`],
    ['=G2-G3'],
    [`=COUNTIF(D2:D${last},"${WAIT_TXT}")&" งวด"`],
  ]).setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange('G2:G4').setNumberFormat(NUM_FMT);
  sh.getRange('F3:G3').setBackground(COL.paidBg).setFontColor(COL.paidFg);
  sh.getRange('F4:G4').setBackground(COL.overBg).setFontColor(COL.overFg);
  sh.getRange('F1:G5').setBorder(true, true, true, true, true, true, COL.line, SpreadsheetApp.BorderStyle.SOLID);

  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$D2="${PAID_TXT}"`)
      .setBackground(COL.paidBg).setFontColor(COL.paidFg)
      .setRanges([sh.getRange(2, 1, n, 4)]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(WAIT_TXT)
      .setBackground(COL.nextBg).setFontColor(COL.nextFg)
      .setRanges([sh.getRange(2, 4, n, 1)]).build(),
  ]);

  sh.setRowHeight(1, 40);
  sh.setColumnWidth(1, 190); sh.setColumnWidth(2, 90); sh.setColumnWidth(3, 130);
  sh.setColumnWidth(4, 110); sh.setColumnWidth(6, 110); sh.setColumnWidth(7, 100);
  sh.setFrozenRows(1);
  sh.setTabColor(color);
}

/* ---------------- แท็บแพลน ---------------- */

function key_(d) { return d.getFullYear() + '-' + (d.getMonth() + 1); }

function readPaidState_(ws) {
  const map = {};
  if (!ws) return map;
  const v = ws.getDataRange().getValues();
  let h = v.findIndex(r => String(r[0]).trim() === 'เดือน' && String(r[2]).trim() === PAID_HEADER);
  if (h < 0) return map;
  for (let r = h + 1; r < v.length; r++) {
    if (!(v[r][0] instanceof Date)) break;
    map[key_(v[r][0])] = v[r][2] === true;
  }
  return map;
}

function buildPlan_(ss, items, minD, maxD) {
  let ws = ss.getSheetByName(PLAN_SHEET);
  const paid = readPaidState_(ws);
  if (ws) {
    ws.getBandings().forEach(b => b.remove());
    ws.clearConditionalFormatRules();
    ws.getRange(1, 1, ws.getMaxRows(), ws.getMaxColumns()).breakApart().clearDataValidations();
    ws.clear();
  } else {
    ws = ss.insertSheet(PLAN_SHEET, 0);
  }

  const months = [];
  for (let c = new Date(minD.getFullYear(), minD.getMonth(), 1);
       c <= new Date(maxD.getFullYear(), maxD.getMonth(), 1);
       c = new Date(c.getFullYear(), c.getMonth() + 1, 1)) months.push(c);

  const n = months.length, ni = items.length;
  const first = HR + 1, last = first + n - 1, TOT = last + 1;
  const tCol = 4 + ni, rCol = 5 + ni;
  const L = columnLetter_, T = L(tCol);
  if (ws.getMaxColumns() < rCol) ws.insertColumnsAfter(ws.getMaxColumns(), rCol - ws.getMaxColumns());

  const paidR = `$C$${first}:$C$${last}`;
  const totR  = `$${T}$${first}:$${T}$${last}`;
  const payR  = `$B$${first}:$B$${last}`;

  ws.getRange(1, 1, ws.getMaxRows(), ws.getMaxColumns()).setFontFamily(FONT);
  ws.setHiddenGridlines(true);

  // หัวเรื่อง
  ws.getRange('A1').setValue('💳 แพลนจ่ายบัตรรายเดือน').setFontSize(20).setFontWeight('bold').setFontColor(COL.navy);
  ws.getRange('A2').setValue(
    'ติ๊ก "จ่ายแล้ว" เมื่อจ่ายเดือนนั้น • 🟩 จ่ายแล้ว • 🟨 งวดถัดไป • 🟥 เลยวันจ่ายแต่ยังไม่ติ๊ก • ' +
    'เงินเดือนเข้า 29 (ตรงเสาร์-อาทิตย์เลื่อนเป็นศุกร์ก่อนหน้า) ยังไม่รวมวันหยุดนักขัตฤกษ์'
  ).setFontSize(9).setFontColor('#5F6368');

  // การ์ดสรุป (แถว 4-5)
  const cards = [
    ['💰 ยอดรวมทั้งหมด', `=${T}${TOT}`, NUM_FMT, '#E8F0FE', '#1A73E8'],
    ['✅ จ่ายแล้ว', `=SUMIF(${paidR},TRUE,${totR})`, NUM_FMT, COL.paidBg, COL.paidFg],
    ['🧾 คงเหลือ', '=A5-B5', NUM_FMT, COL.overBg, COL.overFg],
    ['📊 ความคืบหน้า', '=IF(A5=0,0,B5/A5)', '0%', '#F3E8FD', '#9334E6'],
    ['', '=SPARKLINE(D5,{"charttype","bar";"max",1;"color1","#9334E6";"empty","zero"})', null, '#F3E8FD', '#9334E6'],
    ['📅 งวดถัดไป', `=IFERROR(INDEX(FILTER(${payR},${paidR}=FALSE,${totR}>0),1),"ครบแล้ว 🎉")`, 'ddd dd/mm/yyyy', COL.nextBg, COL.nextFg],
    ['💵 ยอดงวดถัดไป', `=IFERROR(INDEX(FILTER(${totR},${paidR}=FALSE,${totR}>0),1),0)`, NUM_FMT, COL.nextBg, COL.nextFg],
    ['🏁 งวดสุดท้าย', `=INDEX(FILTER(${payR},${totR}>0),COUNTIF(${totR},">0"))`, 'dd/mm/yyyy', '#E8EAED', '#3C4043'],
  ];
  ws.getRange(4, 1, 1, cards.length).setValues([cards.map(c => c[0])]);
  ws.getRange(5, 1, 1, cards.length).setFormulas([cards.map(c => c[1])]);
  cards.forEach((c, i) => {
    const col = i + 1;
    ws.getRange(4, col, 2, 1).setBackground(c[3]).setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBorder(true, true, true, true, null, null, COL.white, SpreadsheetApp.BorderStyle.SOLID_THICK);
    ws.getRange(4, col).setFontColor(c[4]).setFontSize(9).setFontWeight('bold');
    const v = ws.getRange(5, col).setFontColor(c[4]).setFontSize(15).setFontWeight('bold');
    if (c[2]) v.setNumberFormat(c[2]);
  });
  ws.getRange('D4:E4').merge();
  ws.setRowHeight(4, 26); ws.setRowHeight(5, 42);

  // หัวตาราง
  const headers = ['เดือน', 'วันจ่าย (เงินเดือนเข้า)', PAID_HEADER]
    .concat(items.map(s => s.getName()))
    .concat(['ยอดจ่ายรวม', 'คงเหลือตามแผน']);
  const hdrColors = [COL.navy, COL.navy, COL.paidFg]
    .concat(items.map((_, i) => PALETTE[i % PALETTE.length]))
    .concat(['#B06000', COL.overFg]);
  ws.getRange(HR, 1, 1, rCol).setValues([headers]).setBackgrounds([hdrColors])
    .setFontColor(COL.white).setFontWeight('bold').setWrap(true)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  ws.setRowHeight(HR, 46);

  // ข้อมูลรายเดือน
  ws.getRange(first, 1, n, 1).setValues(months.map(m => [m])).setNumberFormat('mmmm yyyy').setFontWeight('bold');
  ws.getRange(first, 2, n, 1)
    .setFormulas(months.map((_, k) => [`=${paydayFormula_('A' + (first + k))}`]))
    .setNumberFormat('ddd dd/mm/yyyy');
  ws.getRange(first, 3, n, 1).insertCheckboxes()
    .setValues(months.map(m => [paid[key_(m)] === true]))
    .setHorizontalAlignment('center');

  ws.getRange(first, 4, n, rCol - 3).setFormulas(months.map((_, k) => {
    const r = first + k;
    const row = items.map(sh => {
      const s = q_(sh.getName());
      return `=SUMIFS(${s}!$B:$B,${s}!$C:$C,">="&$A${r},${s}!$C:$C,"<="&EOMONTH($A${r},0))`;
    });
    row.push(`=SUM(${L(4)}${r}:${L(3 + ni)}${r})`);
    row.push(`=$${T}$${TOT}-SUM($${T}$${first}:${T}${r})`);
    return row;
  })).setNumberFormat(NUM_FMT);
  ws.getRange(first, tCol, n, 1).setFontWeight('bold');

  // แถวรวม
  ws.getRange(TOT, 1).setValue('รวมทั้งหมด');
  ws.getRange(TOT, 3).setFormula(`=COUNTIF(${paidR},TRUE)&" / ${n} งวด"`);
  ws.getRange(TOT, 4, 1, tCol - 3).setFormulas([
    Array.from({ length: tCol - 3 }, (_, i) => `=SUM(${L(4 + i)}${first}:${L(4 + i)}${last})`),
  ]).setNumberFormat(NUM_FMT);
  ws.getRange(TOT, 1, 1, rCol).setBackground(COL.navy).setFontColor(COL.white).setFontWeight('bold');
  ws.getRange(TOT, 3).setHorizontalAlignment('center');
  ws.setRowHeight(TOT, 32);

  ws.getRange(first, 1, n, rCol).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor(COL.white).setSecondRowColor(COL.band);
  ws.getRange(HR, 1, n + 2, rCol).setBorder(true, true, true, true, true, true, COL.line, SpreadsheetApp.BorderStyle.SOLID);

  // สีตามสถานะ
  const data = ws.getRange(first, 1, n, rCol);
  ws.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$C${first}=TRUE`)
      .setBackground(COL.paidBg).setFontColor(COL.paidFg).setStrikethrough(true)
      .setRanges([data]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($C${first}=FALSE,$B${first}<TODAY(),$${T}${first}>0)`)
      .setBackground(COL.overBg).setFontColor(COL.overFg).setBold(true)
      .setRanges([data]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($C${first}=FALSE,$${T}${first}>0,COUNTIFS($C$${first}:$C${first},FALSE,$${T}$${first}:$${T}${first},">0")=1)`)
      .setBackground(COL.nextBg).setFontColor(COL.nextFg).setBold(true)
      .setRanges([data]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint(COL.white).setGradientMaxpoint('#F6B26B')
      .setRanges([ws.getRange(first, tCol, n, 1)]).build(),
  ]);

  ws.setColumnWidth(1, 140); ws.setColumnWidth(2, 150); ws.setColumnWidth(3, 110);
  for (let c = 4; c <= rCol; c++) ws.setColumnWidth(c, 115);
  ws.setFrozenRows(HR);
  ws.setFrozenColumns(3);
  ws.setTabColor(COL.navy);

  return { first, last, tCol, months };
}

/* ---------------- แท็บกรอกรายเดือน (ค่าบัตรอื่นๆ / ค่าคอนโด / ค่าบ้าน) ---------------- */

function resetSheet_(sh) {
  sh.getBandings().forEach(b => b.remove());
  sh.clearConditionalFormatRules();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart().clearDataValidations();
  sh.clear();
}

/** แปลงแท็บ "ค่าบัตรอื่นๆ" แบบเก่า (วันที่ / รายการ / ยอด) → ยอดรวมรายเดือน ใส่ไว้ช่องคนที่ 1 */
function legacyOtherLog_(v) {
  const out = {};
  for (let r = 1; r < v.length; r++) {
    const d = toDate_(v[r][0]), amt = Number(v[r][2]) || 0;
    if (!d || !amt) continue;
    const k = key_(d);
    if (!out[k]) out[k] = [0, '', []];
    out[k][0] += amt;
    out[k][2].push(`${v[r][1] || 'รายการ'} ${amt.toLocaleString()}`);
  }
  Object.keys(out).forEach(k => out[k][2] = 'ย้ายจากรายการเดิม: ' + out[k][2].join(', '));
  return out;
}

/**
 * สร้าง/อัปเดตแท็บกรอกยอดรายเดือน
 * cfg = { name, color, index, note, cols: [{ h, num, def }], seed(k), legacy(values) }
 */
function buildMonthlySheet_(ss, cfg, months) {
  const nc = cfg.cols.length;
  let sh = ss.getSheetByName(cfg.name);
  let saved = {}, legacy = {};
  if (sh) {
    const v = sh.getDataRange().getValues();
    if (String(v[0][0]).trim() === 'เดือน') {
      for (let r = 1; r < v.length; r++) {
        if (!(v[r][0] instanceof Date)) continue;
        const row = v[r].slice(2, 2 + nc);
        while (row.length < nc) row.push('');
        saved[key_(v[r][0])] = row;
      }
    } else if (cfg.legacy) {
      legacy = cfg.legacy(v);
    }
    resetSheet_(sh);
  } else {
    sh = ss.insertSheet(cfg.name, Math.min(cfg.index, ss.getSheets().length));
  }

  const n = months.length, first = 2, last = first + n - 1, TOT = last + 1, NC = 2 + nc;
  const L = columnLetter_;
  if (sh.getMaxColumns() < NC + 2) sh.insertColumnsAfter(sh.getMaxColumns(), NC + 2 - sh.getMaxColumns());
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setFontFamily(FONT);
  sh.setHiddenGridlines(true);

  // หัวตาราง
  sh.getRange(1, 1, 1, 2).setValues([['เดือน', 'วันเงินเดือนเข้า']]);
  cfg.cols.forEach((c, i) => {
    const cell = sh.getRange(1, 3 + i);
    String(c.h).charAt(0) === '=' ? cell.setFormula(c.h) : cell.setValue(c.h);
  });
  sh.getRange(1, 1, 1, NC)
    .setBackgrounds([[COL.navy, COL.navy].concat(cfg.cols.map(() => cfg.color))])
    .setFontColor(COL.white).setFontWeight('bold').setWrap(true)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(1, 44);

  // เดือน + วันเงินเดือนเข้า
  sh.getRange(first, 1, n, 1).setValues(months.map(m => [m])).setNumberFormat('mmmm yyyy').setFontWeight('bold');
  sh.getRange(first, 2, n, 1)
    .setFormulas(months.map((_, k) => [`=${paydayFormula_('A' + (first + k))}`]))
    .setNumberFormat('ddd dd/mm/yyyy');

  // ช่องกรอก: ค่าที่กรอกไว้ > ข้อมูลแบบเก่า > ค่าจากหน้ารายรับ-รายจ่ายเดิม > ค่าเริ่มต้น
  const vals = months.map(m => {
    const k = key_(m);
    const src = saved[k] || legacy[k] || (cfg.seed && cfg.seed(k)) || [];
    return cfg.cols.map((c, i) => (src[i] !== undefined && src[i] !== null) ? src[i] : c.def);
  });
  sh.getRange(first, 3, n, nc).setValues(vals).setBackground(INPUT_BG);

  const numRule = SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0)
    .setHelpText('ใส่ยอดของเดือนนี้ (ตัวเลข)').setAllowInvalid(false).build();
  sh.getRange(TOT, 1).setValue('รวม');
  cfg.cols.forEach((c, i) => {
    const col = 3 + i;
    if (c.date) {
      sh.getRange(first, col, n, 1).setNumberFormat('ddd dd/mm/yyyy').setDataValidation(
        SpreadsheetApp.newDataValidation().requireDate().setHelpText('ใส่วันที่ เช่น 29/10/2026').setAllowInvalid(false).build());
      sh.setColumnWidth(col, 150);
    } else if (c.num) {
      sh.getRange(first, col, n, 1).setNumberFormat(NUM_FMT).setDataValidation(numRule);
      sh.getRange(TOT, col).setFormula(`=SUM(${L(col)}${first}:${L(col)}${last})`).setNumberFormat(NUM_FMT);
      sh.setColumnWidth(col, 140);
    } else {
      sh.getRange(first, col, n, 1).setWrap(true);
      sh.setColumnWidth(col, 260);
    }
  });
  sh.getRange(TOT, 1, 1, NC).setBackground(cfg.color).setFontColor(COL.white).setFontWeight('bold');
  sh.setRowHeight(TOT, 30);

  sh.getRange(first, 1, n, 2).setBackground(null);
  sh.getRange(first, 1, n, 2).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor(COL.white).setSecondRowColor(COL.band);
  sh.getRange(1, 1, n + 2, NC).setBorder(true, true, true, true, true, true, COL.line, SpreadsheetApp.BorderStyle.SOLID);

  sh.getRange(1, NC + 2).setValue('💡 ' + cfg.note).setFontSize(9).setFontColor('#5F6368');
  sh.setColumnWidth(1, 140); sh.setColumnWidth(2, 140);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
  sh.setTabColor(cfg.color);
  return sh;
}

/* ---------------- สมุดรายรับ-รายจ่าย (ปาล์ม / ปล่อยเช่าคอนโด) — ไม่ลบข้อมูลที่กรอก ---------------- */
// คอลัมน์: A วันที่ | B ยอด | C หมายเหตุ | D ประเภท (รายรับ/รายจ่าย) | E หมวด

function ensureLedgerSheet_(ss, Lg, index) {
  let sh = ss.getSheetByName(Lg.name);
  if (!sh) sh = ss.insertSheet(Lg.name, Math.min(index, ss.getSheets().length));
  const ROWS = 500;
  if (sh.getMaxRows() < ROWS) sh.insertRowsAfter(sh.getMaxRows(), ROWS - sh.getMaxRows());
  const NEED_COLS = Lg.invest ? 17 : 12;
  if (sh.getMaxColumns() < NEED_COLS) sh.insertColumnsAfter(sh.getMaxColumns(), NEED_COLS - sh.getMaxColumns());

  // ล้างส่วนสรุปแบบเก่า (คอลัมน์ E:F ของแท็บปาล์มเวอร์ชันก่อน) และของรอบก่อน (G:K)
  if (String(sh.getRange('E1').getValue()).indexOf('สรุปรายได้ปาล์ม') >= 0) {
    sh.getRange('E1:F10').breakApart().clear();
  }
  sh.getRange('G1:K40').breakApart().clear();
  sh.getCharts().forEach(c => sh.removeChart(c));
  sh.getBandings().forEach(b => b.remove());

  // เติมประเภท/หมวดให้แถวเก่าที่ยังว่าง (ข้อมูลเดิมเป็นรายรับ)
  const last = sh.getLastRow();
  if (last >= 2) {
    const rng = sh.getRange(2, 1, last - 1, 5), v = rng.getValues();
    let changed = false;
    v.forEach(r => {
      if (r[0] === '' && r[1] === '') return;
      if (r[3] === '') { r[3] = INCOME_TXT; changed = true; }
      if (r[4] === '') { r[4] = r[3] === EXPENSE_TXT ? 'อื่นๆ' : Lg.incomeCats[0]; changed = true; }
    });
    if (changed) sh.getRange(2, 4, last - 1, 2).setValues(v.map(r => [r[3], r[4]]));
  }

  sh.getRange(1, 1, ROWS, 12).setFontFamily(FONT);
  sh.setHiddenGridlines(true);
  sh.getRange('A1:E1').setValues([['📅 วันที่', '💵 ยอด (บาท)', '📝 หมายเหตุ', '↕️ ประเภท', '🏷️ หมวด']])
    .setBackground(Lg.color).setFontColor(COL.white).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  const R = (c) => sh.getRange(2, c, ROWS - 1, 1);
  R(1).setNumberFormat('ddd dd/mm/yyyy').setDataValidation(SpreadsheetApp.newDataValidation().requireDate()
    .setHelpText('ใส่วันที่ เช่น 15/10/2026').setAllowInvalid(false).build());
  R(2).setNumberFormat(NUM_FMT).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0)
    .setHelpText('ใส่ยอด (ตัวเลข)').setAllowInvalid(false).build());
  R(4).setHorizontalAlignment('center').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList([INCOME_TXT, EXPENSE_TXT], true).setAllowInvalid(false).build());
  const cats = Lg.incomeCats.concat(Lg.expenseCats).filter((x, i, a) => a.indexOf(x) === i);
  R(5).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(cats, true)
    .setHelpText('เลือกหมวด หรือพิมพ์หมวดใหม่ได้').setAllowInvalid(true).build());
  sh.getRange(2, 1, ROWS - 1, 5).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor('#FFFFFF').setSecondRowColor(Lg.light);
  sh.getRange(1, 1, ROWS, 5).setBorder(true, true, true, true, true, null, COL.line, SpreadsheetApp.BorderStyle.SOLID);

  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$D2="${EXPENSE_TXT}"`)
      .setFontColor(COL.overFg).setRanges([sh.getRange(2, 2, ROWS - 1, 1), sh.getRange(2, 4, ROWS - 1, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$D2="${INCOME_TXT}"`)
      .setFontColor(COL.paidFg).setRanges([sh.getRange(2, 2, ROWS - 1, 1), sh.getRange(2, 4, ROWS - 1, 1)]).build(),
  ]);

  // สรุปด้านขวา (G:H)
  const B = `$B$2:$B$${ROWS}`, D = `$D$2:$D$${ROWS}`, E = `$E$2:$E$${ROWS}`;
  sh.getRange('G1').setValue(`${Lg.icon} สรุป${Lg.title}`);
  sh.getRange('G1:H1').merge().setBackground(Lg.color).setFontColor(COL.white).setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange('G2:G4').setValues([['รายรับรวม'], ['รายจ่ายรวม'], ['คงเหลือสุทธิ']]).setFontWeight('bold');
  sh.getRange('H2:H4').setFormulas([
    [`=SUMIFS(${B},${D},"<>${EXPENSE_TXT}")`], [`=SUMIFS(${B},${D},"${EXPENSE_TXT}")`], ['=H2-H3'],
  ]).setNumberFormat(NUM_FMT).setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange('G2:H2').setBackground(COL.paidBg).setFontColor(COL.paidFg);
  sh.getRange('G3:H3').setBackground(COL.overBg).setFontColor(COL.overFg);
  sh.getRange('G4:H4').setBackground('#E8F0FE').setFontColor('#1A73E8');

  // รายจ่ายแยกหมวด + กราฟ
  const ec = Lg.expenseCats;
  sh.getRange('G6:H6').setValues([['รายจ่ายแยกหมวด', 'ยอด']]).setBackground(Lg.color).setFontColor(COL.white).setFontWeight('bold');
  sh.getRange(7, 7, ec.length, 1).setValues(ec.map(c => [c]));
  sh.getRange(7, 8, ec.length, 1).setFormulas(ec.map((c, i) =>
    i === ec.length - 1 && c === 'อื่นๆ'
      // "อื่นๆ" รวมหมวดที่พิมพ์เองซึ่งไม่อยู่ในรายการด้วย
      ? [`=H3-SUM(H7:H${6 + ec.length - 1})`]
      : [`=SUMIFS(${B},${D},"${EXPENSE_TXT}",${E},G${7 + i})`]
  )).setNumberFormat(NUM_FMT);
  sh.getRange(6, 7, ec.length + 1, 2).setBorder(true, true, true, true, true, true, COL.line, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('G1:H4').setBorder(true, true, true, true, true, true, COL.line, SpreadsheetApp.BorderStyle.SOLID);
  sh.insertChart(sh.newChart().asPieChart()
    .addRange(sh.getRange(6, 7, ec.length + 1, 2))
    .setOption('title', `รายจ่าย${Lg.title}แยกหมวด`)
    .setOption('pieHole', 0.45)
    .setOption('legend', { position: 'right' })
    .setNumHeaders(1)
    .setPosition(8 + ec.length, 7, 0, 0)
    .build());

  // ตารางเงินลงทุน (M:O) — ไม่ล้างข้อมูลที่กรอก
  if (Lg.invest) {
    seedInvest_(sh, Lg);
    sh.getRange('M1:O1').setValues([[INVEST_HEADER, 'ยอด', 'หมายเหตุ']])
      .setBackground('#283593').setFontColor(COL.white).setFontWeight('bold').setHorizontalAlignment('center');
    sh.getRange(2, 14, ROWS - 1, 1).setNumberFormat(NUM_FMT);
    // ลงทุนทั้งหมด = รายจ่ายหมวดซื้อของเข้าห้อง (+ ลงทุนเพิ่มเติมคอลัมน์ M:O ถ้ามี)
    // ได้คืน = ค่าเช่า − ค่าใช้จ่ายอื่น (ไม่นับค่าซื้อของ)
    const buy = `SUMIFS(${B},${D},"${EXPENSE_TXT}",${E},"${Lg.investCat}")`;
    const X = Lg.investText || {};
    sh.getRange('Q1:Q6').setValues([[`ลงทุนทั้งหมด (${X.title || Lg.investCat})`], [''],
      [Lg.investGross ? `ได้คืน (รายได้${X.inc || 'รายรับ'})` : `ได้คืน (${X.inc || 'รายรับ'} − ${X.other || 'ค่าใช้จ่ายอื่น'})`], [''], ['% คืนทุน'], ['']]);
    sh.getRange('Q1:Q6').setFontWeight('bold');
    sh.getRange('Q2').setFormula(`=${buy}+SUM(N2:N${ROWS})`).setNumberFormat(NUM_FMT);
    sh.getRange('Q4').setFormula(Lg.investGross ? '=H2' : `=H2-(H3-${buy})`).setNumberFormat(NUM_FMT);
    sh.getRange('Q6').setFormula('=IF(Q2=0,"",Q4/Q2)').setNumberFormat('0.0%');
    sh.getRange('Q7:Q8').clearContent();
    sh.setColumnWidth(13, 200); sh.setColumnWidth(14, 120); sh.setColumnWidth(15, 180); sh.setColumnWidth(17, 130);
  }
  sh.getRange('J1').setValue(`💡 จดทุกรายการ: เลือก "รายรับ" หรือ "รายจ่าย" และหมวด • ยอดสุทธิของแต่ละเดือนไปรวมในหน้า "รายรับ-รายจ่าย"`)
    .setFontSize(9).setFontColor('#5F6368');
  sh.setRowHeight(1, 40);
  sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 120); sh.setColumnWidth(3, 220);
  sh.setColumnWidth(4, 90); sh.setColumnWidth(5, 140); sh.setColumnWidth(7, 150); sh.setColumnWidth(8, 110);
  sh.setFrozenRows(1);
  sh.setTabColor(Lg.color);
  return sh;
}

const INVEST_HEADER = '💼 เงินลงทุน (เช่น ค่าที่ดิน, เงินดาวน์, ตกแต่ง)';
/** ใส่ยอดลงทุนตั้งต้น (investSeed) ครั้งแรกครั้งเดียว — ถ้าหัวตาราง M1 มีแล้วจะไม่ทำอีก (ลบในเว็บแล้วไม่กลับมา) */
function seedInvest_(sh, Lg) {
  if (!Lg.invest || sh.getRange('M1').getValue()) return false;
  if (sh.getMaxColumns() < 17) sh.insertColumnsAfter(sh.getMaxColumns(), 17 - sh.getMaxColumns());
  sh.getRange('M1:O1').setValues([[INVEST_HEADER, 'ยอด', 'หมายเหตุ']]).setFontWeight('bold');
  const seed = Lg.investSeed || [];
  if (seed.length) sh.getRange(2, 13, seed.length, 3).setValues(seed);
  return true;
}

/* ---------------- แท็บรายรับ-รายจ่าย ---------------- */

// คอลัมน์ในหน้ารายรับ-รายจ่าย
function incomeCols_() {
  const nf = FIXED_SHEETS.length;
  const c = { month: 1, payday: 2, inc1: 3, inc2: 4, led0: 5 };
  c.incSum = c.led0 + LEDGERS.length;
  c.plan = c.incSum + 1;
  c.oth1 = c.plan + 1;
  c.oth2 = c.oth1 + 1;
  c.fixed0 = c.oth2 + 1;
  c.expSum = c.fixed0 + nf;
  c.left = c.expSum + 1;
  c.pct = c.left + 1;
  return c;
}

/** อ่านค่าที่กรอกไว้ในหน้ารายรับ-รายจ่าย (รวมค่าจากเวอร์ชันเก่าเพื่อย้ายไปแท็บใหม่) */
function readIncomeState_(ws) {
  const st = { settings: null, rows: {} };
  if (!ws) return st;
  st.settings = ws.getRange('B4:B5').getValues();
  const rng = ws.getDataRange(), v = rng.getValues(), f = rng.getFormulas();
  const h = v.findIndex(r => String(r[0]).trim() === 'เดือน');
  if (h < 0) return st;
  const hdr = v[h].map(x => String(x).trim());
  const IC = incomeCols_();
  const hasOther = String(hdr[IC.oth1 - 1]).indexOf('ค่าบัตรอื่นๆ') >= 0 && !(f[h + 1] && f[h + 1][IC.oth1 - 1]);
  for (let r = h + 1; r < v.length; r++) {
    if (!(v[r][0] instanceof Date)) break;
    const keep = (c) => (f[r][c - 1] && (v[r][c - 1] === 0 || v[r][c - 1] === '')) ? '' : v[r][c - 1];
    const row = {
      inc1: keep(IC.inc1), inc2: keep(IC.inc2),
      oth1: hasOther ? v[r][IC.oth1 - 1] : undefined,
      oth2: hasOther ? v[r][IC.oth2 - 1] : undefined,
      fixed: {},
    };
    FIXED_SHEETS.forEach(fx => {
      const c = hdr.indexOf(`${fx.icon} ${fx.name}`);
      if (c >= 0 && !f[r][c]) row.fixed[fx.name] = v[r][c];
    });
    st.rows[key_(v[r][0])] = row;
  }
  return st;
}

function buildIncomeAndInputs_(ss, plan) {
  let inc = ss.getSheetByName(INCOME_SHEET);
  const st = readIncomeState_(inc);
  if (!inc) inc = ss.insertSheet(INCOME_SHEET, 1);
  // ใส่ชื่อก่อน เพื่อให้หัวคอลัมน์แท็บค่าบัตรอื่นๆ ดึงชื่อได้
  const s0 = st.settings;
  inc.getRange('B4:B5').setValues([[(s0 && s0[0][0]) || 'คนที่ 1'], [(s0 && s0[1][0]) || 'คนที่ 2']]);

  LEDGERS.forEach((Lg, i) => ensureLedgerSheet_(ss, Lg, 4 + FIXED_SHEETS.length + i));

  const I = q_(INCOME_SHEET);
  buildMonthlySheet_(ss, {
    name: INCOME_IN_SHEET, color: '#188038', index: 2,
    note: 'กรอกรายรับและวันที่ได้เงินของแต่ละคนในแต่ละเดือน ยอดจะไปรวมในหน้า "รายรับ-รายจ่าย" อัตโนมัติ',
    cols: [
      { h: `="💰 "&${I}!$B$4`, num: true, def: '' },
      { h: `="📅 วันที่ได้รับ "&${I}!$B$4`, date: true, def: '' },
      { h: `="💰 "&${I}!$B$5`, num: true, def: '' },
      { h: `="📅 วันที่ได้รับ "&${I}!$B$5`, date: true, def: '' },
      { h: '📝 หมายเหตุ', num: false, def: '' },
    ],
    seed: k => st.rows[k] ? [st.rows[k].inc1, '', st.rows[k].inc2, ''] : null,
  }, plan.months);

  buildMonthlySheet_(ss, {
    name: OTHER_SHEET, color: '#E37400', index: 3,
    note: 'กรอกยอดค่าบัตรอื่นๆ (นอกเหนือจากค่าผ่อน) ของแต่ละคนในแต่ละเดือน ยอดจะไปรวมในหน้า "รายรับ-รายจ่าย" อัตโนมัติ',
    cols: [
      { h: `="🧾 "&${I}!$B$4`, num: true, def: '' },
      { h: `="🧾 "&${I}!$B$5`, num: true, def: '' },
      { h: '📝 หมายเหตุ', num: false, def: '' },
    ],
    seed: k => (st.rows[k] && st.rows[k].oth1 !== undefined) ? [st.rows[k].oth1, st.rows[k].oth2] : null,
    legacy: legacyOtherLog_,
  }, plan.months);

  FIXED_SHEETS.forEach((fx, i) => buildMonthlySheet_(ss, {
    name: fx.name, color: fx.color, index: 4 + i,
    note: fx.amount === '' || fx.amount === undefined
      ? `กรอกยอด${fx.name}ของแต่ละเดือน`
      : `กรอกยอด${fx.name}ของแต่ละเดือน (เติมยอด ${Number(fx.amount).toLocaleString()} ให้ตอนสร้างครั้งแรก เดือนไหนไม่เท่ากันแก้ได้เลย)`,
    cols: [
      { h: `${fx.icon} ยอด${fx.name}`, num: true, def: fx.amount === undefined ? '' : fx.amount },
      { h: '📝 หมายเหตุ', num: false, def: '' },
    ],
    seed: k => (st.rows[k] && (fx.name in st.rows[k].fixed)) ? [st.rows[k].fixed[fx.name]] : null,
  }, plan.months));

  buildIncome_(ss, inc, st, plan);
}

function buildIncome_(ss, ws, st, plan) {
  resetSheet_(ws);

  const IC = incomeCols_();
  const months = plan.months, n = months.length;
  const first = HR + 1, last = first + n - 1, TOT = last + 1, NC = IC.pct;
  const P = q_(PLAN_SHEET), PT = columnLetter_(plan.tCol), O = q_(OTHER_SHEET);
  const L = columnLetter_;
  const cE = L(IC.incSum), cX = L(IC.expSum), cJ = L(IC.left);
  const pull = (sheetQ, col, r) =>
    `=IFERROR(N(INDEX(${sheetQ}!$${col}:$${col},MATCH($A${r},${sheetQ}!$A:$A,0))),0)`;
  if (ws.getMaxColumns() < NC) ws.insertColumnsAfter(ws.getMaxColumns(), NC - ws.getMaxColumns());

  ws.getRange(1, 1, ws.getMaxRows(), ws.getMaxColumns()).setFontFamily(FONT);
  ws.setHiddenGridlines(true);

  ws.getRange('A1').setValue('👛 รายรับ-รายจ่ายรายเดือน').setFontSize(20).setFontWeight('bold').setFontColor('#188038');
  ws.getRange('A2').setValue(
    'รายรับกรอกที่แท็บ "รายรับรายเดือน" • ' + LEDGERS.map(l => l.title).join(' / ') + ' = ยอดสุทธิ (รายรับ − รายจ่าย) จากแท็บของแต่ละอัน • ค่าบัตรอื่นๆ / ' + FIXED_SHEETS.map(f => f.name).join(' / ') +
    ' กรอกในแท็บของแต่ละอัน แล้วจะดึงมารวมที่นี่ • ค่าผ่อนดึงจากแท็บแพลน • เดือนที่ยังไม่กรอกรายรับ ช่องคงเหลือจะว่างไว้'
  ).setFontSize(9).setFontColor('#5F6368');

  // ชื่อ 2 คน
  const s = st.settings;
  ws.getRange('A4:B5').setValues([
    ['👤 คนที่ 1', (s && s[0][0]) || 'คนที่ 1'],
    ['👤 คนที่ 2', (s && s[1][0]) || 'คนที่ 2'],
  ]);
  ws.getRange('A4:A5').setFontWeight('bold');
  ws.getRange('B4:B5').setBackground(INPUT_BG).setFontWeight('bold');
  ws.getRange('A4:B5').setBorder(true, true, true, true, true, true, COL.line, SpreadsheetApp.BorderStyle.SOLID);

  // การ์ดสรุป
  const cards = [
    ['💵 รายรับรวม', `=${cE}${TOT}`, NUM_FMT, COL.paidBg, COL.paidFg],
    ['💳 รายจ่ายรวม', `=${cX}${TOT}`, NUM_FMT, COL.overBg, COL.overFg],
    ['🪙 เหลือรวม (เดือนที่กรอกแล้ว)', `=${cJ}${TOT}`, NUM_FMT, '#E8F0FE', '#1A73E8'],
    ['⚠️ เดือนที่เหลือน้อยสุด', `=IFERROR(INDEX(A${first}:A${last},MATCH(MIN(${cJ}${first}:${cJ}${last}),${cJ}${first}:${cJ}${last},0)),"-")`, 'mmmm yyyy', COL.nextBg, COL.nextFg],
    ['เหลือ', `=IF(COUNT(${cJ}${first}:${cJ}${last})=0,"-",MIN(${cJ}${first}:${cJ}${last}))`, NUM_FMT, COL.nextBg, COL.nextFg],
  ];
  const c0 = 4;
  ws.getRange(4, c0, 1, cards.length).setValues([cards.map(c => c[0])]);
  ws.getRange(5, c0, 1, cards.length).setFormulas([cards.map(c => c[1])]);
  cards.forEach((c, i) => {
    const col = c0 + i;
    ws.getRange(4, col, 2, 1).setBackground(c[3]).setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBorder(true, true, true, true, null, null, COL.white, SpreadsheetApp.BorderStyle.SOLID_THICK);
    ws.getRange(4, col).setFontColor(c[4]).setFontSize(9).setFontWeight('bold').setWrap(true);
    ws.getRange(5, col).setFontColor(c[4]).setFontSize(14).setFontWeight('bold').setNumberFormat(c[2]);
  });
  ws.getRange(4, c0 + 3, 1, 2).merge();
  ws.setRowHeight(4, 30); ws.setRowHeight(5, 40);

  // หัวตาราง
  const headers = ['เดือน', 'วันเงินเดือนเข้า', '', '']
    .concat(LEDGERS.map(l => `${l.icon} ${l.title} (สุทธิ)`))
    .concat(['รวมรายรับ', 'ค่าผ่อน (จากแพลน)', '', ''])
    .concat(FIXED_SHEETS.map(f => `${f.icon} ${f.name}`))
    .concat(['รวมรายจ่าย', 'คงเหลือ', '% รายจ่าย / รายรับ']);
  const colors = [COL.navy, COL.navy, '#188038', '#188038']
    .concat(LEDGERS.map(l => l.color))
    .concat([COL.paidFg, '#1A73E8', '#E37400', '#E37400'])
    .concat(FIXED_SHEETS.map(f => f.color))
    .concat([COL.overFg, '#9334E6', '#5F6368']);
  ws.getRange(HR, 1, 1, NC).setValues([headers]).setBackgrounds([colors])
    .setFontColor(COL.white).setFontWeight('bold').setWrap(true)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  ws.getRange(HR, IC.inc1, 1, 2).setFormulas([['="💰 รายรับ "&$B$4', '="💰 รายรับ "&$B$5']]);
  ws.getRange(HR, IC.oth1, 1, 2).setFormulas([['="🧾 ค่าบัตรอื่นๆ "&$B$4', '="🧾 ค่าบัตรอื่นๆ "&$B$5']]);
  ws.setRowHeight(HR, 50);

  // ข้อมูลรายเดือน
  ws.getRange(first, IC.month, n, 1).setValues(months.map(m => [m])).setNumberFormat('mmmm yyyy').setFontWeight('bold');
  ws.getRange(first, IC.payday, n, 1)
    .setFormulas(months.map((_, k) => [`=${paydayFormula_('A' + (first + k))}`]))
    .setNumberFormat('ddd dd/mm/yyyy');

  // รายรับ: ดึงจากแท็บรายรับรายเดือน (เว้นว่างถ้ายังไม่กรอก)
  const II = q_(INCOME_IN_SHEET);
  const pullBlank = (col, r) =>
    `=IFERROR(IF(INDEX(${II}!$${col}:$${col},MATCH($A${r},${II}!$A:$A,0))="","",INDEX(${II}!$${col}:$${col},MATCH($A${r},${II}!$A:$A,0))),"")`;
  ws.getRange(first, IC.inc1, n, 2).setFormulas(months.map((_, k) => [pullBlank('C', first + k), pullBlank('E', first + k)]));

  // สูตร: ยอดสุทธิของแต่ละสมุด … % รายจ่าย
  const ledRange = `${L(IC.led0)}${'{r}'}:${L(IC.incSum - 1)}${'{r}'}`;
  ws.getRange(first, IC.led0, n, NC - IC.led0 + 1).setFormulas(months.map((_, k) => {
    const r = first + k;
    const inMonth = Q => `${Q}!$A:$A,">="&$A${r},${Q}!$A:$A,"<"&EOMONTH($A${r},0)+1`;
    const ledgerNet = LEDGERS.map(Lg => {
      const Q = q_(Lg.name);
      return `=SUMIFS(${Q}!$B:$B,${inMonth(Q)},${Q}!$D:$D,"<>${EXPENSE_TXT}")-SUMIFS(${Q}!$B:$B,${inMonth(Q)},${Q}!$D:$D,"${EXPENSE_TXT}")`;
    });
    const ledSum = ledRange.replace(/\{r\}/g, r);
    return ledgerNet.concat([
      `=SUM(C${r}:D${r})+SUM(${ledSum})`,
      `=IFERROR(INDEX(${P}!$${PT}$${plan.first}:$${PT}$${plan.last},MATCH($A${r},${P}!$A$${plan.first}:$A$${plan.last},0)),0)`,
      pull(O, 'C', r),
      pull(O, 'D', r),
    ].concat(FIXED_SHEETS.map(fx => pull(q_(fx.name), 'C', r)))
     .concat([
      `=SUM(${L(IC.plan)}${r}:${L(IC.expSum - 1)}${r})`,
      `=IF(AND(C${r}="",D${r}="",SUM(${ledSum})=0),"",${cE}${r}-${cX}${r})`,
      `=IF(${cE}${r}=0,"",${cX}${r}/${cE}${r})`,
    ]));
  }));
  ws.getRange(first, IC.inc1, n, IC.left - IC.inc1 + 1).setNumberFormat(NUM_FMT);
  ws.getRange(first, IC.pct, n, 1).setNumberFormat('0%').setHorizontalAlignment('center');
  ws.getRange(first, IC.expSum, n, 2).setFontWeight('bold');

  // แถวรวม
  ws.getRange(TOT, 1).setValue('รวมทั้งหมด');
  const tot = [];
  for (let c = IC.inc1; c <= IC.left; c++) tot.push(`=SUM(${L(c)}${first}:${L(c)}${last})`);
  tot.push(`=IF(${cE}${TOT}=0,"",${cX}${TOT}/${cE}${TOT})`);
  ws.getRange(TOT, IC.inc1, 1, tot.length).setFormulas([tot]);
  ws.getRange(TOT, IC.inc1, 1, IC.left - IC.inc1 + 1).setNumberFormat(NUM_FMT);
  ws.getRange(TOT, IC.pct).setNumberFormat('0%').setHorizontalAlignment('center');
  ws.getRange(TOT, 1, 1, NC).setBackground(COL.navy).setFontColor(COL.white).setFontWeight('bold');
  ws.setRowHeight(TOT, 32);

  ws.getRange(first, 1, n, NC).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor(COL.white).setSecondRowColor(COL.band);
  ws.getRange(HR, 1, n + 2, NC).setBorder(true, true, true, true, true, true, COL.line, SpreadsheetApp.BorderStyle.SOLID);

  // สี: คงเหลือติดลบ = แดง, บวก = เขียว, % รายจ่ายไล่สีเขียว→เหลือง→แดง
  const left = ws.getRange(first, IC.left, n, 1);
  const pct = ws.getRange(first, IC.pct, n, 1);
  const IT = SpreadsheetApp.InterpolationType;
  ws.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0)
      .setBackground(COL.overBg).setFontColor(COL.overFg).setRanges([left]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(0)
      .setBackground(COL.paidBg).setFontColor(COL.paidFg).setRanges([left]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpointWithValue('#B7E1CD', IT.NUMBER, '0.3')
      .setGradientMidpointWithValue('#FFE599', IT.NUMBER, '0.6')
      .setGradientMaxpointWithValue('#F4C7C3', IT.NUMBER, '0.9')
      .setRanges([pct]).build(),
  ]);

  ws.setColumnWidth(1, 140); ws.setColumnWidth(2, 140);
  for (let c = 3; c <= NC; c++) ws.setColumnWidth(c, 120);
  ws.setFrozenRows(HR);
  ws.setFrozenColumns(2);
  ws.setTabColor('#188038');
}

/* ---------------- helpers ---------------- */

function q_(name) { return `'${name.replace(/'/g, "''")}'`; }

function columnLetter_(c) {
  let s = '';
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}