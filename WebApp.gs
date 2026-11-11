/**
 * เว็บแอป "บัญชีบ้าน" — ใช้ Google Sheet นี้เป็นฐานข้อมูล
 * ต้องมีไฟล์ แพลนจ่ายบัตร.gs (v8) อยู่ในโปรเจกต์เดียวกัน และไฟล์ HTML ชื่อ Index
 *
 * สิทธิ์ผู้ใช้:
 *   viewer = ดูอย่างเดียว
 *   editor = ดู + กรอก/แก้ข้อมูล + ติ๊กจ่ายแล้ว
 *   admin  = ทุกอย่าง + จัดการผู้ใช้ + สั่งปรับโครงสร้างชีต
 *
 * ผู้ใช้เก็บในแท็บ "ผู้ใช้งาน" (ซ่อนไว้) รหัสผ่านเก็บเป็น hash + salt ไม่เก็บรหัสจริง
 */

const USERS_SHEET = 'ผู้ใช้งาน';
const SESSION_SEC = 6 * 3600;     // เซสชันอยู่ได้ 6 ชม. นับจากใช้งานครั้งล่าสุด
const MAX_FAILS = 5;              // ใส่รหัสผิดเกินนี้ ล็อก 15 นาที
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

// ⚙️ รายชื่อบัตร: แท็บ "รายชื่อบัตร" (ชื่อบัตร | ธนาคาร | ผู้ถือบัตร | หมายเหตุ)
//    แต่ละรายการผ่อนจำว่าผ่อนกับบัตรไหนไว้ที่ช่อง I1:I2 ของแท็บรายการนั้น
const CARDS_SHEET = 'รายชื่อบัตร';
const CARD_LABEL  = '💳 บัตร';
const DEFAULT_CARDS = [   // ใส่ให้ตอนสร้างแท็บครั้งแรก แก้ในเว็บได้
  ['กสิกร', 'กสิกรไทย', '', ''],
  ['เฟิร์สช้อยส์', 'กรุงศรี (เฟิร์สช้อยส์)', '', ''],
  ['กรุงศรี', 'กรุงศรีอยุธยา', '', ''],
  ['Central', 'เซ็นทรัล (กรุงศรี คอนซูมเมอร์)', '', ''],
];

// ⚙️ ยอดที่จ่ายบัตรจริงแต่ละเดือน: แท็บ "ยอดจ่ายบัตรจริง" (เดือน | บัตร | ยอดที่จ่ายจริง | หมายเหตุ | บันทึกเมื่อ)
//    เอาไปเทียบกับยอดผ่อนของบัตรนั้นในเดือนเดียวกัน → จ่ายเกิน/ขาดเท่าไร
const CARD_PAY_SHEET = 'ยอดจ่ายบัตรจริง';

// ⚙️ ประกัน (เช่น ประกันเงินออม): แท็บ "ประกัน" เก็บรายละเอียดกรมธรรม์
//    เบี้ยที่ยังต้องจ่าย (ตั้งแต่เดือนนี้) จะสร้างเป็นแท็บรายการผ่อนชื่อเดียวกับกรมธรรม์ + ผูกบัตรที่ตัด
//    → ไปรวมในยอดผ่อนของบัตรนั้น / แพลนผ่อนบัตร / ภาพรวม อัตโนมัติ
const INS_SHEET = 'ประกัน';
const INS_FREQ  = [1, 3, 6, 12];   // จ่ายทุกกี่เดือน
// กรมธรรม์ตั้งต้น: ใส่ให้อัตโนมัติครั้งแรก (ตอนยังไม่มีแท็บ "ประกัน") — แก้/ลบในหน้า 🛡️ ประกัน ได้
// ประกันเงินออม เบี้ย 2,687/เดือน 7 ปี (84 งวด) งวดแรก ก.พ. 2026 (งวดที่ 9 = ต.ค. 2026) ตัดบัตร Central
const DEFAULT_INS = { name: 'ประกันเงินออม', premium: 2687, freq: 1, total: 84, first: [2026, 2], card: 'Central' };

/* ================= หน้าเว็บ ================= */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('บัญชีบ้าน')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // ให้เปิดผ่านหน้า GitHub Pages (iframe) ได้
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ================= ตั้งค่าผู้ดูแล (รันจากเมนูในชีต) ================= */

function setupAdmin() {
  const ui = SpreadsheetApp.getUi();
  const a = ui.prompt('สร้าง/รีเซ็ตผู้ดูแลระบบ', 'ชื่อผู้ใช้ (a-z, 0-9, . _ - ยาว 3–30 ตัว)', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  const b = ui.prompt('สร้าง/รีเซ็ตผู้ดูแลระบบ', 'รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  const c = ui.prompt('สร้าง/รีเซ็ตผู้ดูแลระบบ', 'ชื่อที่แสดง', ui.ButtonSet.OK_CANCEL);
  if (c.getSelectedButton() !== ui.Button.OK) return;
  try {
    upsertUser_({ username: a.getResponseText(), password: b.getResponseText(),
                  name: c.getResponseText() || a.getResponseText(), role: 'admin', active: true });
    ui.alert('สร้างผู้ดูแลระบบเรียบร้อย ใช้ชื่อผู้ใช้และรหัสผ่านนี้เข้าสู่ระบบในเว็บได้เลย');
  } catch (e) {
    ui.alert('สร้างไม่สำเร็จ: ' + e.message);
  }
}

/* ================= helpers ================= */

function ss_() { return SpreadsheetApp.getActive(); }
function tz_() { return ss_().getSpreadsheetTimeZone(); }
function fmtD_(d) { return d instanceof Date ? Utilities.formatDate(d, tz_(), 'yyyy-MM-dd') : ''; }
function numOrBlank_(x) { return x === '' || x === null ? null : Number(x) || 0; }
function keyFromStr_(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{1,2})/);
  if (!m) throw new Error('รูปแบบเดือนไม่ถูกต้อง');
  return Number(m[1]) + '-' + Number(m[2]);
}
function dateFromStr_(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('รูปแบบวันที่ไม่ถูกต้อง');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
/** ตัวเลข ≥ 0 หรือว่าง */
function amount_(x, label) {
  if (x === '' || x === null || x === undefined) return '';
  const n = Number(String(x).replace(/[๐-๙]/g, d => '๐๑๒๓๔๕๖๗๘๙'.indexOf(d)).replace(/บาท|บ\.?|฿|,|\s/g, ''));
  if (!isFinite(n) || n < 0) throw new Error(`${label}: ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป`);
  return Math.round(n * 100) / 100;
}
/** กันข้อความที่ขึ้นต้นด้วยสัญลักษณ์สูตร ไม่ให้ชีตตีความเป็นสูตร */
function text_(s, max) {
  s = String(s || '').trim().slice(0, max || 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function sheetOrThrow_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error(`ไม่พบแท็บ "${name}" ให้เปิดชีตแล้วรันเมนู 💳 แพลนจ่ายบัตร ก่อน`);
  return sh;
}
/** หาเลขแถว (1-based) ของเดือนในแท็บ โดยดูคอลัมน์ A */
function monthRow_(sh, key) {
  const v = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (let r = 0; r < v.length; r++) if (v[r][0] instanceof Date && key_(v[r][0]) === key) return r + 1;
  throw new Error(`ไม่พบเดือนนี้ในแท็บ "${sh.getName()}"`);
}

/* ================= ผู้ใช้ ================= */

function usersSheet_() {
  let sh = ss_().getSheetByName(USERS_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(USERS_SHEET);
    sh.getRange('A1:G1').setValues([['username', 'salt', 'hash', 'role', 'displayName', 'active', 'createdAt']])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

function hash_(salt, pw) {
  let h = salt + '|' + pw;
  for (let i = 0; i < 300; i++) {
    h = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return h;
}

function normUser_(u) {
  u = String(u || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) throw new Error('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3–30 ตัว');
  return u;
}
function checkPw_(p) {
  if (String(p || '').length < 8) throw new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
}

function allUsers_() {
  const v = usersSheet_().getDataRange().getValues();
  const out = [];
  for (let r = 1; r < v.length; r++) {
    if (!v[r][0]) continue;
    out.push({ row: r + 1, username: String(v[r][0]), salt: v[r][1], hash: v[r][2], role: v[r][3],
               name: v[r][4], active: v[r][5] === true || String(v[r][5]).toUpperCase() === 'TRUE',
               createdAt: fmtD_(v[r][6]) });
  }
  return out;
}
function findUser_(u) {
  u = String(u || '').trim().toLowerCase();
  return allUsers_().find(x => x.username.toLowerCase() === u) || null;
}

function upsertUser_(d) {
  const username = normUser_(d.username);
  const role = ROLE_RANK[d.role] ? d.role : 'viewer';
  const name = text_(d.name || username, 60);
  const sh = usersSheet_();
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const u = findUser_(username);
    if (!u) {
      checkPw_(d.password);
      const salt = Utilities.getUuid();
      sh.appendRow([username, salt, hash_(salt, d.password), role, name, d.active !== false, new Date()]);
    } else {
      const row = [u.username, u.salt, u.hash, role, name, d.active !== false];
      if (d.password) {
        checkPw_(d.password);
        row[1] = Utilities.getUuid();
        row[2] = hash_(row[1], d.password);
      }
      sh.getRange(u.row, 1, 1, 6).setValues([row]);
    }
  } finally { lock.releaseLock(); }
}

/* ================= เซสชัน / ล็อกอิน ================= */

function newSession_(user) {
  const t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('s_' + t, user.username, SESSION_SEC);
  return t;
}

function session_(token) {
  if (!token) throw new Error('AUTH');
  const c = CacheService.getScriptCache();
  const username = c.get('s_' + token);
  if (!username) throw new Error('AUTH');
  const u = findUser_(username);
  if (!u || !u.active) { c.remove('s_' + token); throw new Error('AUTH'); }
  c.put('s_' + token, username, SESSION_SEC); // ต่ออายุ
  return { username: u.username, name: u.name, role: u.role, token };
}

function login(username, password) {
  const u0 = String(username || '').trim().toLowerCase();
  const c = CacheService.getScriptCache();
  const fk = 'f_' + u0;
  const fails = Number(c.get(fk) || 0);
  if (fails >= MAX_FAILS) throw new Error('ใส่รหัสผิดหลายครั้ง ลองใหม่อีกครั้งใน 15 นาที');
  const u = findUser_(u0);
  if (!u || !u.active || hash_(u.salt, String(password || '')) !== u.hash) {
    c.put(fk, String(fails + 1), 900);
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  c.remove(fk);
  return { token: newSession_(u), user: { username: u.username, name: u.name, role: u.role } };
}

/* ---------- ครั้งแรก: สร้างผู้ดูแลจากหน้าเว็บ (ใช้ได้เฉพาะตอนยังไม่มีผู้ใช้เลย) ---------- */

function setupStatus() {
  return { needsSetup: allUsers_().length === 0 };
}

function createFirstAdmin(username, password, name) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    if (allUsers_().length > 0) throw new Error('ระบบตั้งค่าไปแล้ว ให้เข้าสู่ระบบตามปกติ');
    const u = normUser_(username);
    checkPw_(password);
    const salt = Utilities.getUuid();
    usersSheet_().appendRow([u, salt, hash_(salt, password), 'admin', text_(name || u, 60), true, new Date()]);
  } finally { lock.releaseLock(); }
  return login(username, password);
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('s_' + token);
  return true;
}

/* ================= API หลัก ================= */

const ACTIONS_ = {
  me:             { role: 'viewer', fn: (d, s) => ({ username: s.username, name: s.name, role: s.role }) },
  dashboard:      { role: 'viewer', fn: () => getDashboard_() },
  plan:           { role: 'viewer', fn: () => { ensureInsSeed_(); return getPlan_(); } },
  month:          { role: 'viewer', fn: d => getMonth_(d) },
  ledger:         { role: 'viewer', fn: d => getLedger_(d) },
  changePassword: { role: 'viewer', fn: (d, s) => changePassword_(d, s) },
  setPaid:        { role: 'editor', fn: d => setPaid_(d), write: true },
  saveIncome:     { role: 'editor', fn: d => saveIncome_(d), write: true },
  saveNames:      { role: 'editor', fn: d => saveNames_(d), write: true },
  saveExpense:    { role: 'editor', fn: d => saveExpense_(d), write: true },
  addLedger:      { role: 'editor', fn: d => addLedger_(d), write: true },
  deleteLedger:   { role: 'editor', fn: d => deleteLedger_(d), write: true },
  saveInvest:     { role: 'editor', fn: d => saveInvest_(d), write: true },
  deleteInvest:   { role: 'editor', fn: d => deleteInvest_(d), write: true },
  addInstallment: { role: 'editor', fn: d => addInstallment_(d), write: true },
  deleteInstallment: { role: 'editor', fn: d => deleteInstallment_(d), write: true },
  updateInstallment: { role: 'editor', fn: d => updateInstallment_(d), write: true },
  saveCard:       { role: 'editor', fn: d => saveCard_(d), write: true },
  deleteCard:     { role: 'editor', fn: d => deleteCard_(d), write: true },
  saveCardPays:   { role: 'editor', fn: d => saveCardPays_(d), write: true },
  insurance:      { role: 'viewer', fn: () => { ensureInsSeed_(); return getInsurance_(); } },
  saveInsurance:  { role: 'editor', fn: d => saveInsurance_(d), write: true },
  deleteInsurance:{ role: 'editor', fn: d => deleteInsurance_(d), write: true },
  updateLedger:   { role: 'editor', fn: d => updateLedger_(d), write: true },
  users:          { role: 'admin',  fn: () => listUsers_() },
  saveUser:       { role: 'admin',  fn: (d, s) => saveUser_(d, s) },
  rebuild:        { role: 'admin',  fn: () => { runAll(); return true; }, write: true },
};

function api(token, action, data) {
  const s = session_(token);
  const a = ACTIONS_[action];
  if (!a) throw new Error('ไม่รู้จักคำสั่งนี้');
  if (ROLE_RANK[s.role] < ROLE_RANK[a.role]) throw new Error('บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้');
  if (!a.write) return a.fn(data || {}, s);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const out = a.fn(data || {}, s);
    SpreadsheetApp.flush();
    return out;
  } finally { lock.releaseLock(); }
}

/* ================= ภาพรวม ================= */

/** ถ้าตารางรายเดือนเหลือล่วงหน้าน้อยกว่า HORIZON_MIN_LEFT เดือน → ต่อเดือนให้อัตโนมัติ */
function ensureHorizon_() {
  const sh = ss_().getSheetByName(INCOME_SHEET);
  if (!sh) return false;
  const v = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  let last = null;
  v.forEach(r => { if (r[0] instanceof Date && (!last || r[0] > last)) last = r[0]; });
  const now = new Date();
  const need = new Date(now.getFullYear(), now.getMonth() + HORIZON_MIN_LEFT, 1);
  if (last && last >= need) return false;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { runAll(); } finally { lock.releaseLock(); }
  return true;
}

function getDashboard_() {
  ensureHorizon_();
  const sh = sheetOrThrow_(INCOME_SHEET);
  const v = sh.getDataRange().getValues();
  const h = v.findIndex(r => String(r[0]).trim() === 'เดือน');
  if (h < 0) throw new Error('โครงสร้างแท็บรายรับ-รายจ่ายไม่ถูกต้อง ให้รันเมนู 💳 แพลนจ่ายบัตร ใหม่');
  const IC = incomeCols_();
  const g = (row, c) => numOrBlank_(row[c - 1]);
  const rows = [];
  for (let r = h + 1; r < v.length; r++) {
    const row = v[r];
    if (!(row[0] instanceof Date)) break;
    rows.push({
      month: fmtD_(row[0]), payday: fmtD_(row[1]),
      inc1: g(row, IC.inc1), inc2: g(row, IC.inc2),
      ledgers: LEDGERS.map((_, i) => g(row, IC.led0 + i) || 0),
      incSum: g(row, IC.incSum) || 0, plan: g(row, IC.plan) || 0,
      oth1: g(row, IC.oth1) || 0, oth2: g(row, IC.oth2) || 0,
      fixed: FIXED_SHEETS.map((_, i) => g(row, IC.fixed0 + i) || 0),
      exp: g(row, IC.expSum) || 0, left: g(row, IC.left),
    });
  }
  return {
    names: [String(v[3][1] || 'คนที่ 1'), String(v[4][1] || 'คนที่ 2')],
    fixed: FIXED_SHEETS.map(f => ({ name: f.name, icon: f.icon })),
    ledgers: LEDGERS.map(l => ({ key: l.key, icon: l.icon, title: l.title })),
    rows, today: fmtD_(new Date()),
  };
}

/* ================= แพลนผ่อน ================= */

function getPlan_() {
  const sh = sheetOrThrow_(PLAN_SHEET);
  const v = sh.getDataRange().getValues();
  const h = v.findIndex(r => String(r[0]).trim() === 'เดือน' && String(r[2]).trim() === PAID_HEADER);
  if (h < 0) throw new Error('โครงสร้างแท็บแพลนไม่ถูกต้อง ให้รันเมนู 💳 แพลนจ่ายบัตร ใหม่');
  const hdr = v[h].map(String);
  const tIdx = hdr.indexOf('ยอดจ่ายรวม');
  const items = hdr.slice(3, tIdx);
  const rows = [];
  for (let r = h + 1; r < v.length; r++) {
    if (!(v[r][0] instanceof Date)) break;
    rows.push({
      month: fmtD_(v[r][0]), payday: fmtD_(v[r][1]), paid: v[r][2] === true,
      amounts: v[r].slice(3, tIdx).map(x => Number(x) || 0), total: Number(v[r][tIdx]) || 0,
    });
  }
  // รายละเอียดแต่ละรายการ (อ่านจากแท็บของรายการ)
  const info = items.map(name => {
    const it = ss_().getSheetByName(name);
    if (!it || !isItemSheet_(it) || it.getLastRow() < 2) return null;
    const vals = it.getRange(2, 2, it.getLastRow() - 1, 2).getValues().filter(r => r[1] instanceof Date);
    if (!vals.length) return null;
    return { name, amount: Number(vals[0][0]) || 0, firstDate: fmtD_(vals[0][1]), months: vals.length,
             total: vals.reduce((s, r) => s + (Number(r[0]) || 0), 0),
             lastDate: fmtD_(vals[vals.length - 1][1]), card: itemCard_(it) };
  }).filter(Boolean);
  const insNames = readIns_().map(p => p.name);
  info.forEach(i => { i.ins = insNames.indexOf(i.name) >= 0; });
  const inc = ss_().getSheetByName(INCOME_SHEET);
  const names = inc ? inc.getRange('B4:B5').getValues().map(r => String(r[0] || '')) : ['คนที่ 1', 'คนที่ 2'];
  return { items, info, rows, cards: readCards_(), pays: readCardPays_(), names, today: fmtD_(new Date()) };
}

/* ================= รายชื่อบัตร ================= */

function cardsSheet_() {
  let sh = ss_().getSheetByName(CARDS_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(CARDS_SHEET, ss_().getSheets().length);
    sh.getRange('A1:D1').setValues([['ชื่อบัตร', 'ธนาคาร', 'ผู้ถือบัตร', 'หมายเหตุ']])
      .setFontWeight('bold').setBackground('#17402F').setFontColor('#FFFFFF');
    sh.getRange(2, 1, DEFAULT_CARDS.length, 4).setValues(DEFAULT_CARDS);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 160); sh.setColumnWidth(2, 220); sh.setColumnWidth(3, 120); sh.setColumnWidth(4, 220);
    sh.setTabColor('#17402F');
  }
  return sh;
}

function readCards_() {
  const sh = cardsSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues().map((r, i) => ({
    row: i + 2, name: String(r[0] || '').trim(), bank: String(r[1] || ''), owner: String(r[2] || ''), note: String(r[3] || ''),
  })).filter(c => c.name);
}

/** บัตรของรายการผ่อน (เก็บไว้ที่ I1:I2 ของแท็บรายการ) */
function itemCard_(sh) {
  const v = sh.getRange('I1:I2').getValues();
  return String(v[0][0]) === CARD_LABEL ? String(v[1][0] || '').trim() : '';
}
function setItemCard_(sh, name) {
  sh.getRange('I1:I2').setValues([[CARD_LABEL], [name || '']]);
  sh.getRange('I1').setFontWeight('bold');
}
function checkCard_(name) {
  name = String(name || '').trim();
  if (!name) return '';
  if (!readCards_().some(c => c.name === name)) throw new Error(`ไม่พบบัตร "${name}" ในรายชื่อบัตร`);
  return name;
}

/** เพิ่ม (ไม่มี row) หรือแก้ไข (มี row + oldName) บัตร */
function saveCard_(d) {
  const sh = cardsSheet_();
  const name = text_(d.name, 40);
  if (!name) throw new Error('ใส่ชื่อบัตรก่อน');
  const row = Number(d.row) || 0;
  const cards = readCards_();
  if (cards.some(c => c.name.toLowerCase() === name.toLowerCase() && c.row !== row)) {
    throw new Error(`มีบัตรชื่อ "${name}" อยู่แล้ว`);
  }
  const vals = [[name, text_(d.bank, 60), text_(d.owner, 40), text_(d.note, 120)]];
  if (row) {
    const old = cards.find(c => c.row === row);
    if (!old || old.name !== String(d.oldName)) throw new Error('บัตรนี้ถูกแก้ไขไปแล้ว รีเฟรชแล้วลองใหม่');
    sh.getRange(row, 1, 1, 4).setValues(vals);
    if (old.name !== name) {
      itemSheets_().forEach(it => { if (itemCard_(it) === old.name) setItemCard_(it, name); });
      readCardPays_().filter(x => x.card === old.name).forEach(x => cardPaySheet_().getRange(x.row, 2).setValue(name));
      readIns_().filter(x => x.card === old.name).forEach(x => insSheet_().getRange(x.row, 6).setValue(name));
    }
  } else {
    sh.getRange(Math.max(sh.getLastRow(), 1) + 1, 1, 1, 4).setValues(vals);
  }
  SpreadsheetApp.flush();
  return getPlan_();
}

/** ลบบัตร: รายการผ่อนที่ใช้บัตรนี้จะกลายเป็น "ยังไม่ระบุบัตร" */
function deleteCard_(d) {
  const sh = cardsSheet_();
  const c = readCards_().find(x => x.row === Number(d.row));
  if (!c || c.name !== String(d.name)) throw new Error('บัตรนี้ถูกแก้ไขไปแล้ว รีเฟรชแล้วลองใหม่');
  itemSheets_().forEach(it => { if (itemCard_(it) === c.name) setItemCard_(it, ''); });
  readIns_().filter(x => x.card === c.name).forEach(x => insSheet_().getRange(x.row, 6).setValue(''));
  const ps = cardPaySheet_();
  readCardPays_().filter(x => x.card === c.name).map(x => x.row).sort((a, b) => b - a).forEach(r => ps.deleteRow(r));
  sh.deleteRow(c.row);
  SpreadsheetApp.flush();
  return getPlan_();
}

/* ================= ยอดจ่ายบัตรจริงต่อเดือน ================= */

function cardPaySheet_() {
  let sh = ss_().getSheetByName(CARD_PAY_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(CARD_PAY_SHEET, ss_().getSheets().length);
    sh.getRange('A1:E1').setValues([['เดือน', 'บัตร', 'ยอดที่จ่ายจริง', 'หมายเหตุ', 'บันทึกเมื่อ']])
      .setFontWeight('bold').setBackground('#17402F').setFontColor('#FFFFFF');
    sh.getRange('A2:A').setNumberFormat('mmm yyyy');
    sh.getRange('C2:C').setNumberFormat('#,##0.##');
    sh.getRange('E2:E').setNumberFormat('dd/mm/yyyy hh:mm');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 110); sh.setColumnWidth(2, 150); sh.setColumnWidth(3, 130); sh.setColumnWidth(4, 200); sh.setColumnWidth(5, 140);
    sh.setTabColor('#1A63C9');
  }
  return sh;
}

function readCardPays_() {
  const sh = cardPaySheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues().map((r, i) => {
    if (!(r[0] instanceof Date) || !String(r[1]).trim()) return null;
    return { row: i + 2, month: fmtD_(new Date(r[0].getFullYear(), r[0].getMonth(), 1)),
             card: String(r[1]).trim(), amount: Number(r[2]) || 0, note: String(r[3] || '') };
  }).filter(Boolean);
}

/** บันทึกยอดจ่ายจริงของทุกบัตรในเดือนเดียว: d = { month, pays: [{ card, amount }] } — ยอดว่าง = ลบ */
function saveCardPays_(d) {
  const key = keyFromStr_(d.month);
  const [y, m] = key.split('-').map(Number);
  const mDate = new Date(y, m - 1, 1);
  const names = readCards_().map(c => c.name);
  const list = (d.pays || []).map(p => {
    const card = String(p.card || '').trim();
    if (names.indexOf(card) < 0) throw new Error(`ไม่พบบัตร "${card}" ในรายชื่อบัตร`);
    return { card, amount: amount_(p.amount, 'ยอดจ่ายบัตร ' + card) };
  });
  const sh = cardPaySheet_();
  const existing = readCardPays_().filter(x => x.month === fmtD_(mDate));
  const del = [], now = new Date();
  list.forEach(p => {
    const ex = existing.find(x => x.card === p.card);
    if (p.amount === '') { if (ex) del.push(ex.row); }
    else if (ex) sh.getRange(ex.row, 3, 1, 3).setValues([[p.amount, ex.note, now]]);
    else sh.appendRow([mDate, p.card, p.amount, '', now]);
  });
  del.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));   // ลบจากล่างขึ้นบน แถวจะไม่เลื่อน
  SpreadsheetApp.flush();
  return getPlan_();
}

/* ================= ประกัน ================= */

function insSheet_() {
  let sh = ss_().getSheetByName(INS_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(INS_SHEET, ss_().getSheets().length);
    sh.getRange('A1:G1').setValues([['ชื่อกรมธรรม์', 'เบี้ยต่องวด', 'จ่ายทุก (เดือน)', 'จำนวนงวดทั้งหมด', 'เดือนงวดแรก', 'บัตรที่ตัด', 'หมายเหตุ']])
      .setFontWeight('bold').setBackground('#5B3F8C').setFontColor('#FFFFFF');
    sh.getRange('B2:B').setNumberFormat('#,##0.##');
    sh.getRange('E2:E').setNumberFormat('mmm yyyy');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 180); sh.setColumnWidth(5, 110); sh.setColumnWidth(6, 120); sh.setColumnWidth(7, 220);
    sh.setTabColor('#5B3F8C');
  }
  return sh;
}

function readIns_() {
  const sh = ss_().getSheetByName(INS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues().map((r, i) => {
    if (!String(r[0]).trim() || !(r[4] instanceof Date)) return null;
    return { row: i + 2, name: String(r[0]).trim(), premium: Number(r[1]) || 0, freq: Number(r[2]) || 1,
             total: Number(r[3]) || 0, first: fmtD_(new Date(r[4].getFullYear(), r[4].getMonth(), 1)),
             card: String(r[5] || '').trim(), note: String(r[6] || '') };
  }).filter(Boolean);
}

/** วันเงินเดือนเข้าของเดือน (29 หรือวันสุดท้าย, ตรงเสาร์-อาทิตย์เลื่อนเป็นศุกร์) */
function payday_(y, m0) {
  const d = new Date(y, m0, Math.min(29, new Date(y, m0 + 1, 0).getDate()));
  if (d.getDay() === 6) d.setDate(d.getDate() - 1);
  if (d.getDay() === 0) d.setDate(d.getDate() - 2);
  return d;
}
function today0_() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }

/** ตารางงวดทั้งหมด: งวดไหนถึงวันเงินเดือนเข้าแล้ว = จ่ายแล้ว */
function insSchedule_(p) {
  const f = dateFromStr_(p.first), t = today0_(), out = [];
  for (let k = 1; k <= p.total; k++) {
    const m = new Date(f.getFullYear(), f.getMonth() + (k - 1) * p.freq, 1);
    const pd = payday_(m.getFullYear(), m.getMonth());
    out.push({ k, month: fmtD_(m), payday: fmtD_(pd), paid: pd <= t });
  }
  return out;
}

function getInsurance_() {
  const policies = readIns_().map(p => {
    const sch = insSchedule_(p), n = sch.filter(x => x.paid).length;
    return Object.assign(p, { schedule: sch, paidN: n, paidAmt: n * p.premium, totalAmt: p.total * p.premium,
      lastMonth: sch.length ? sch[sch.length - 1].month : '', next: sch.find(x => !x.paid) || null,
      linked: !!ss_().getSheetByName(p.name) });
  });
  return { policies, cards: readCards_(), today: fmtD_(new Date()) };
}

/** ย้ายแท็บรายการผ่อนไปถังขยะ (ลบจริงตอนสร้างแพลนใหม่) */
function trashItem_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh || itemReserved_().indexOf(name) >= 0 || !isItemSheet_(sh)) return false;
  sh.getRange(1, 1, sh.getMaxRows(), Math.min(sh.getMaxColumns(), 9)).clearContent();
  sh.setName(TRASH_PREFIX + Utilities.formatDate(new Date(), tz_(), 'yyyyMMddHHmmss') + '_' + Math.floor(Math.random() * 1000));
  sh.hideSheet();
  try { renamePlanHeader_(name, name + ' (ลบแล้ว)'); } catch (e) {}
  return true;
}

/**
 * เพิ่ม/แก้ไขกรมธรรม์: d = { row?, oldName?, name, premium, freq, years, paid, card, note }
 * paid = จ่ายไปแล้วกี่งวด (นับงวดที่ถึงวันเงินเดือนเข้าแล้ว)
 */
function saveInsurance_(d) {
  const name = cleanItemName_(d.name);
  if (!name) throw new Error('ใส่ชื่อกรมธรรม์ก่อน');
  const premium = amount_(d.premium, 'เบี้ยต่องวด');
  if (premium === '' || premium === 0) throw new Error('ใส่เบี้ยต่องวดก่อน');
  const freq = Number(d.freq);
  if (INS_FREQ.indexOf(freq) < 0) throw new Error('เลือกความถี่การจ่ายเบี้ย');
  const years = Number(d.years);
  if (!(years >= 1 && years <= 30)) throw new Error('ระยะเวลาจ่ายเบี้ยต้องอยู่ระหว่าง 1–30 ปี');
  const total = Math.round(years * 12 / freq);
  const paid = Math.floor(Number(d.paid));
  if (!(paid >= 0 && paid <= total)) throw new Error(`งวดที่จ่ายแล้วต้องอยู่ระหว่าง 0–${total}`);
  const card = checkCard_(d.card);

  const list = readIns_(), row = Number(d.row) || 0;
  const old = row ? list.find(x => x.row === row) : null;
  if (row && (!old || old.name !== String(d.oldName))) throw new Error('กรมธรรม์นี้ถูกแก้ไขไปแล้ว รีเฟรชแล้วลองใหม่');
  if (list.some(x => x.name === name && x.row !== row)) throw new Error(`มีกรมธรรม์ชื่อ "${name}" อยู่แล้ว`);
  if ((!old || old.name !== name) && (itemReserved_().indexOf(name) >= 0 || INS_SHEET === name || ss_().getSheetByName(name))) {
    throw new Error(`ชื่อ "${name}" ซ้ำกับแท็บที่มีอยู่ ตั้งชื่ออื่น`);
  }

  // งวดล่าสุดที่จ่ายแล้วอยู่เดือนนี้ (ถ้าถึงวันเงินเดือนเข้าแล้ว) ไม่งั้นเดือนก่อน → ย้อนหาเดือนงวดแรก
  const t = today0_();
  let last = new Date(t.getFullYear(), t.getMonth(), 1);
  if (payday_(last.getFullYear(), last.getMonth()) > t) last = new Date(last.getFullYear(), last.getMonth() - 1, 1);
  const first = paid >= 1
    ? new Date(last.getFullYear(), last.getMonth() - (paid - 1) * freq, 1)
    : new Date(last.getFullYear(), last.getMonth() + freq, 1);

  writeInsurance_(old, { name, premium, freq, total, first, card, note: text_(d.note, 200) });
  runAll();   // สร้างแพลน/หน้ารายรับ-รายจ่ายใหม่ (ข้อมูลที่กรอกไว้ไม่หาย)
  return getInsurance_();
}

/** เขียนแถวกรมธรรม์ + สร้างแท็บรายการผ่อนของเบี้ยที่ยังต้องจ่าย (ยังไม่สร้างแพลนใหม่) */
function writeInsurance_(old, p) {
  const { name, premium, freq, total, first, card } = p;
  const t = today0_();
  const sh = insSheet_();
  const vals = [[name, premium, freq, total, first, card, p.note || '']];
  if (old) sh.getRange(old.row, 1, 1, 7).setValues(vals);
  else sh.getRange(Math.max(sh.getLastRow(), 1) + 1, 1, 1, 7).setValues(vals);

  // แท็บรายการผ่อน: เบี้ยตั้งแต่เดือนนี้ถึงงวดสุดท้าย (เดือนที่ผ่านมาแล้วไม่ใส่ เพื่อไม่ให้แพลนย้อนหลัง)
  if (old) trashItem_(old.name);
  const cur = new Date(t.getFullYear(), t.getMonth(), 1), rows = [];
  for (let k = 1; k <= total; k++) {
    const m = new Date(first.getFullYear(), first.getMonth() + (k - 1) * freq, 1);
    if (m >= cur) rows.push([m, premium]);
  }
  if (rows.length) {
    const it = ss_().insertSheet(name, ss_().getSheets().length);
    it.getRange(1, 1, 1, 2).setValues([['วันที่จ่าย', 'ยอด']]);
    it.getRange(2, 1, rows.length, 2).setValues(rows);
    setItemCard_(it, card);
  }
  SpreadsheetApp.flush();
}

/** ครั้งแรก (ยังไม่มีแท็บ "ประกัน"): ใส่กรมธรรม์ตั้งต้น แล้วรวมเข้าแพลนผ่อนบัตร */
function ensureInsSeed_() {
  if (!DEFAULT_INS || ss_().getSheetByName(INS_SHEET)) return false;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return false;
  try {
    if (ss_().getSheetByName(INS_SHEET)) return false;
    const D = DEFAULT_INS;
    if (ss_().getSheetByName(D.name)) { insSheet_(); return false; }   // มีแท็บชื่อนี้อยู่แล้ว ไม่ทับ
    const card = readCards_().some(c => c.name === D.card) ? D.card : '';
    writeInsurance_(null, { name: D.name, premium: D.premium, freq: D.freq, total: D.total,
                            first: new Date(D.first[0], D.first[1] - 1, 1), card, note: '' });
    runAll();
    return true;
  } finally { lock.releaseLock(); }
}

/** รันเองจากหน้า Apps Script ได้ (เลือกฟังก์ชันนี้แล้วกด ▶ เรียกใช้) */
function setupInsurance() { return ensureInsSeed_(); }

function deleteInsurance_(d) {
  const p = readIns_().find(x => x.row === Number(d.row));
  if (!p || p.name !== String(d.name)) throw new Error('กรมธรรม์นี้ถูกแก้ไขไปแล้ว รีเฟรชแล้วลองใหม่');
  trashItem_(p.name);
  insSheet_().deleteRow(p.row);
  SpreadsheetApp.flush();
  return getInsurance_();
}

function itemReserved_() {
  return [PLAN_SHEET, INCOME_SHEET, INCOME_IN_SHEET, OTHER_SHEET, USERS_SHEET, CARDS_SHEET, CARD_PAY_SHEET, INS_SHEET]
    .concat(FIXED_SHEETS.map(f => f.name)).concat(LEDGERS.map(l => l.name));
}
function itemSheets_() {
  const res = itemReserved_();
  return ss_().getSheets().filter(x => res.indexOf(x.getName()) < 0 && x.getName().indexOf(TRASH_PREFIX) !== 0 && isItemSheet_(x));
}
function cleanItemName_(s) {
  return String(s || '').replace(/[\[\]*?:\/\\']/g, '').trim().slice(0, 50);
}
/** หาแถวหัวตารางแพลน + ช่วงเดือน */
function planLayout_() {
  const sh = sheetOrThrow_(PLAN_SHEET);
  const v = sh.getDataRange().getValues();
  const h = v.findIndex(r => String(r[0]).trim() === 'เดือน' && String(r[2]).trim() === PAID_HEADER);
  let last = h + 1;
  while (last < v.length && v[last][0] instanceof Date) last++;
  return { sh, hdrRow: h + 1, first: h + 2, last, firstMonth: v[h + 1][0], lastMonth: v[last - 1][0], hdr: v[h].map(String) };
}
/** แก้ชื่อหัวคอลัมน์รายการในแท็บแพลน (หัวคอลัมน์เป็นข้อความ ไม่ตามชื่อแท็บอัตโนมัติ) */
function renamePlanHeader_(oldName, newName) {
  const L = planLayout_();
  const c = L.hdr.indexOf(oldName);
  if (c >= 0) L.sh.getRange(L.hdrRow, c + 1).setValue(newName);
}

function setPaid_(d) {
  const sh = sheetOrThrow_(PLAN_SHEET);
  sh.getRange(monthRow_(sh, keyFromStr_(d.month)), 3).setValue(d.paid === true);
  SpreadsheetApp.flush();
  return getPlan_();
}

/** เพิ่มรายการผ่อนใหม่: สร้างแท็บรายการ แล้วสร้างแพลนใหม่ */
function addInstallment_(d) {
  const name = String(d.name || '').replace(/[\[\]*?:\/\\']/g, '').trim().slice(0, 50);
  if (!name) throw new Error('ใส่ชื่อรายการผ่อนก่อน');
  const reserved = itemReserved_();
  if (name.indexOf(TRASH_PREFIX) === 0 || reserved.indexOf(name) >= 0 || ss_().getSheetByName(name)) throw new Error(`มีรายการชื่อ "${name}" อยู่แล้ว ตั้งชื่ออื่น`);
  const amt = amount_(d.amount, 'ยอดต่องวด');
  if (amt === '' || amt === 0) throw new Error('ใส่ยอดต่องวดก่อน');
  const n = Math.floor(Number(d.months));
  if (!(n >= 1 && n <= 24)) throw new Error('จำนวนงวดต้องอยู่ระหว่าง 1–24 เดือน');
  const start = dateFromStr_(d.firstDate);
  const card = checkCard_(d.card);

  // งวดละเดือน วันเดียวกันทุกเดือน (เดือนที่สั้นกว่าใช้วันสุดท้ายของเดือน)
  const rows = [];
  for (let i = 0; i < n; i++) {
    const y = start.getFullYear(), m = start.getMonth() + i;
    const lastDay = new Date(y, m + 1, 0).getDate();
    rows.push([new Date(y, m, Math.min(start.getDate(), lastDay)), amt]);
  }
  const sh = ss_().insertSheet(name, ss_().getSheets().length);
  sh.getRange(1, 1, 1, 2).setValues([['วันที่จ่าย', 'ยอด']]);
  sh.getRange(2, 1, n, 2).setValues(rows);
  setItemCard_(sh, card);
  SpreadsheetApp.flush();
  runAll(); // ปรับวันจ่าย + สร้างแพลน/หน้ารายรับ-รายจ่ายใหม่ (ข้อมูลที่กรอกไว้ไม่หาย)
  return getPlan_();
}

/** ลบรายการผ่อน: ลบแท็บของรายการนั้น แล้วสร้างแพลนใหม่ */
function deleteInstallment_(d) {
  const name = String(d.name || '').trim();
  if (readIns_().some(p => p.name === name)) throw new Error('รายการนี้เป็นเบี้ยประกัน แก้ไขหรือลบที่หน้า 🛡️ ประกัน');
  const reserved = itemReserved_();
  const sh = ss_().getSheetByName(name);
  if (!sh || reserved.indexOf(name) >= 0 || name.indexOf(TRASH_PREFIX) === 0 || !isItemSheet_(sh)) throw new Error(`ไม่พบรายการผ่อน "${name}"`);
  if (itemSheets_().length <= 1) throw new Error('ต้องมีรายการผ่อนเหลืออย่างน้อย 1 รายการ');
  // ลบแบบเร็ว: ย้ายแท็บไปถังขยะ (ซ่อน + ล้างข้อมูล) สูตรในแพลนยังชี้แท็บนี้อยู่จึงเป็น 0 ทันที
  // แท็บจะถูกลบจริงตอนปรับโครงสร้างชีตครั้งถัดไป
  sh.getRange(1, 1, sh.getMaxRows(), Math.min(sh.getMaxColumns(), 8)).clearContent();
  sh.setName(TRASH_PREFIX + Utilities.formatDate(new Date(), tz_(), 'yyyyMMddHHmmss'));
  sh.hideSheet();
  renamePlanHeader_(name, name + ' (ลบแล้ว)');
  SpreadsheetApp.flush();
  return getPlan_();
}

/** แก้ไขรายการผ่อน: ชื่อ / ยอดต่องวด / วันที่งวดแรก / จำนวนเดือน */
function updateInstallment_(d) {
  const oldName = String(d.oldName || '').trim();
  if (readIns_().some(p => p.name === oldName)) throw new Error('รายการนี้เป็นเบี้ยประกัน แก้ไขหรือลบที่หน้า 🛡️ ประกัน');
  const sh = ss_().getSheetByName(oldName);
  if (!sh || itemReserved_().indexOf(oldName) >= 0 || !isItemSheet_(sh)) throw new Error(`ไม่พบรายการผ่อน "${oldName}"`);
  const name = cleanItemName_(d.name);
  if (!name) throw new Error('ใส่ชื่อรายการผ่อนก่อน');
  if (name !== oldName && (itemReserved_().indexOf(name) >= 0 || ss_().getSheetByName(name) || name.indexOf(TRASH_PREFIX) === 0)) {
    throw new Error(`มีรายการชื่อ "${name}" อยู่แล้ว ตั้งชื่ออื่น`);
  }
  const amt = amount_(d.amount, 'ยอดต่องวด');
  if (amt === '' || amt === 0) throw new Error('ใส่ยอดต่องวดก่อน');
  const n = Math.floor(Number(d.months));
  if (!(n >= 1 && n <= 24)) throw new Error('จำนวนงวดต้องอยู่ระหว่าง 1–24 เดือน');
  const start = dateFromStr_(d.firstDate);
  const card = checkCard_(d.card);
  const dates = [];
  for (let i = 0; i < n; i++) {
    const y = start.getFullYear(), m = start.getMonth() + i;
    dates.push(new Date(y, m, Math.min(start.getDate(), new Date(y, m + 1, 0).getDate())));
  }

  if (name !== oldName) { sh.setName(name); renamePlanHeader_(oldName, name); } // สูตรที่อ้างแท็บนี้เปลี่ยนชื่อตามให้เอง
  setItemCard_(sh, card);

  // เขียนงวดใหม่ (A วันจ่ายจริง | B ยอด | C วันที่ตามงวด | D สถานะ)
  const L = planLayout_();
  const lookup = `${q_(PLAN_SHEET)}!$A$${L.first}:$C$${L.last}`;
  if (sh.getMaxRows() < n + 1) sh.insertRowsAfter(sh.getMaxRows(), n + 1 - sh.getMaxRows());
  sh.getRange(2, 1, sh.getMaxRows() - 1, 4).clearContent();
  const pd = r => { const p = `MIN(DATE(YEAR(C${r}),MONTH(C${r}),29),EOMONTH(C${r},0))`; return `=${p}-MAX(0,WEEKDAY(${p},2)-5)`; };
  sh.getRange(2, 3, n, 1).setValues(dates.map(x => [x])).setNumberFormat('dd/mm/yyyy');
  sh.getRange(2, 2, n, 1).setValues(dates.map(() => [amt])).setNumberFormat('#,##0;(#,##0);-');
  sh.getRange(2, 1, n, 1).setFormulas(dates.map((_, i) => [pd(i + 2)])).setNumberFormat('ddd dd/mm/yyyy');
  sh.getRange(2, 4, n, 1).setFormulas(dates.map((_, i) => {
    const r = i + 2;
    return [`=IF(C${r}="","",IF(IFERROR(VLOOKUP(DATE(YEAR(C${r}),MONTH(C${r}),1),${lookup},3,FALSE),FALSE),"${PAID_TXT}","${WAIT_TXT}"))`];
  }));
  SpreadsheetApp.flush();

  // ถ้างวดใหม่เลยช่วงเดือนที่มีในแพลน ต้องสร้างแพลนใหม่ (ช้ากว่า แต่เกิดไม่บ่อย)
  const firstM = new Date(dates[0].getFullYear(), dates[0].getMonth(), 1);
  const lastM = new Date(dates[n - 1].getFullYear(), dates[n - 1].getMonth(), 1);
  if (firstM < L.firstMonth || lastM > L.lastMonth) runAll();
  return getPlan_();
}

/* ================= กรอกรายเดือน ================= */

function getMonth_(d) {
  const key = keyFromStr_(d.month);
  const IC = incomeCols_();
  const inc = sheetOrThrow_(INCOME_SHEET);
  const iv = inc.getRange(monthRow_(inc, key), 1, 1, IC.pct).getValues()[0];
  const ins = sheetOrThrow_(INCOME_IN_SHEET);
  const nv = ins.getRange(monthRow_(ins, key), 3, 1, 5).getValues()[0];
  const oth = sheetOrThrow_(OTHER_SHEET);
  const ov = oth.getRange(monthRow_(oth, key), 3, 1, 3).getValues()[0];
  const names = inc.getRange('B4:B5').getValues().map(r => String(r[0] || ''));
  return {
    month: d.month, names, payday: fmtD_(iv[1]),
    inc1: nv[0], date1: fmtD_(nv[1]), inc2: nv[2], date2: fmtD_(nv[3]), incNote: String(nv[4] || ''),
    ledgers: LEDGERS.map((l, i) => ({ icon: l.icon, title: l.title, net: Number(iv[IC.led0 - 1 + i]) || 0 })),
    plan: Number(iv[IC.plan - 1]) || 0,
    oth1: ov[0], oth2: ov[1], othNote: String(ov[2] || ''),
    fixed: FIXED_SHEETS.map(f => {
      const sh = sheetOrThrow_(f.name);
      const fv = sh.getRange(monthRow_(sh, key), 3, 1, 2).getValues()[0];
      return { name: f.name, icon: f.icon, amount: fv[0], note: String(fv[1] || '') };
    }),
    left: numOrBlank_(iv[IC.left - 1]), exp: Number(iv[IC.expSum - 1]) || 0,
  };
}

/** แก้ชื่อคนที่ 1 / คนที่ 2 (หัวคอลัมน์ทุกแท็บที่อ้างชื่อจะเปลี่ยนตามเอง) */
function saveNames_(d) {
  const n1 = text_(d.name1, 40), n2 = text_(d.name2, 40);
  if (!n1 || !n2) throw new Error('ใส่ชื่อให้ครบทั้ง 2 คน');
  sheetOrThrow_(INCOME_SHEET).getRange('B4:B5').setValues([[n1], [n2]]);
  SpreadsheetApp.flush();
  return { names: [n1, n2] };
}

/** บันทึกรายรับ + วันที่ได้เงินของแต่ละคน */
function saveIncome_(d) {
  const key = keyFromStr_(d.month);
  const names = sheetOrThrow_(INCOME_SHEET).getRange('B4:B5').getValues().map(r => String(r[0] || ''));
  const inc1 = amount_(d.inc1, 'รายรับ ' + names[0]);
  const inc2 = amount_(d.inc2, 'รายรับ ' + names[1]);
  const date1 = d.date1 ? dateFromStr_(d.date1) : '';
  const date2 = d.date2 ? dateFromStr_(d.date2) : '';
  const sh = sheetOrThrow_(INCOME_IN_SHEET);
  sh.getRange(monthRow_(sh, key), 3, 1, 5).setValues([[inc1, date1, inc2, date2, text_(d.incNote)]]);
  SpreadsheetApp.flush();
  return getMonth_(d);
}

/** บันทึกค่าบัตรอื่นๆ + ค่าใช้จ่ายประจำ */
function saveExpense_(d) {
  const key = keyFromStr_(d.month);
  const names = sheetOrThrow_(INCOME_SHEET).getRange('B4:B5').getValues().map(r => String(r[0] || ''));
  const oth1 = amount_(d.oth1, 'ค่าบัตรอื่นๆ ' + names[0]);
  const oth2 = amount_(d.oth2, 'ค่าบัตรอื่นๆ ' + names[1]);
  const fixed = FIXED_SHEETS.map((f, i) => {
    const x = (d.fixed || [])[i] || {};
    return { amount: amount_(x.amount, f.name), note: text_(x.note) };
  });
  const oth = sheetOrThrow_(OTHER_SHEET);
  oth.getRange(monthRow_(oth, key), 3, 1, 3).setValues([[oth1, oth2, text_(d.othNote)]]);
  FIXED_SHEETS.forEach((f, i) => {
    const sh = sheetOrThrow_(f.name);
    sh.getRange(monthRow_(sh, key), 3, 1, 2).setValues([[fixed[i].amount, fixed[i].note]]);
  });
  SpreadsheetApp.flush();
  return getMonth_(d);
}

/* ================= สมุดรายรับ-รายจ่าย (ปาล์ม / ปล่อยเช่าคอนโด) ================= */

function ledgerOf_(key) {
  const Lg = LEDGERS.find(x => x.key === key);
  if (!Lg) throw new Error('ไม่รู้จักสมุดบัญชีนี้');
  return Lg;
}

function getLedger_(d) {
  const Lg = ledgerOf_(d.book);
  const sh = sheetOrThrow_(Lg.name);
  if (Lg.invest && Lg.investSeed && !sh.getRange('M1').getValue()) {   // ใส่ค่าที่ดินตั้งต้นครั้งแรก
    const lock = LockService.getScriptLock();
    if (lock.tryLock(5000)) { try { seedInvest_(sh, Lg); SpreadsheetApp.flush(); } finally { lock.releaseLock(); } }
  }
  const last = sh.getLastRow();
  const entries = [];
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 5).getValues().forEach((r, i) => {
      if (r[0] === '' && r[1] === '') return;
      const expense = String(r[3]).trim() === EXPENSE_TXT;
      entries.push({ row: i + 2, date: fmtD_(r[0]), amount: Number(r[1]) || 0, note: String(r[2] || ''),
                     type: expense ? 'expense' : 'income',
                     category: String(r[4] || '').trim() || (expense ? 'อื่นๆ' : Lg.incomeCats[0]) });
    });
  }
  entries.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.row - a.row);
  const tot = { income: 0, expense: 0 }, cats = { income: {}, expense: {} }, months = {};
  entries.forEach(e => {
    tot[e.type] += e.amount;
    cats[e.type][e.category] = (cats[e.type][e.category] || 0) + e.amount;
    const m = (e.date || '').slice(0, 7);
    if (m) { months[m] = months[m] || { income: 0, expense: 0 }; months[m][e.type] += e.amount; }
  });
  const sortCats = o => Object.keys(o).map(k => ({ name: k, amount: o[k] })).sort((a, b) => b.amount - a.amount);
  return {
    book: { key: Lg.key, icon: Lg.icon, title: Lg.title, color: Lg.color,
            incomeCats: Lg.incomeCats, expenseCats: Lg.expenseCats },
    entries, totals: { income: tot.income, expense: tot.expense, net: tot.income - tot.expense },
    expenseByCat: sortCats(cats.expense), incomeByCat: sortCats(cats.income),
    byMonth: Object.keys(months).sort().map(m => ({ month: m, income: months[m].income, expense: months[m].expense })),
    today: fmtD_(new Date()),
    invest: Lg.invest ? investSummary_(Lg, sh, tot, entries) : null,
  };
}

/* ---------- เงินลงทุน (คอลัมน์ M:O ของสมุดที่ตั้ง invest: true) ---------- */
function readInvest_(sh) {
  const last = sh.getLastRow();
  const items = [];
  if (last >= 2) {
    sh.getRange(2, 13, last - 1, 3).getValues().forEach((r, i) => {
      if (r[0] === '' && r[1] === '') return;
      items.push({ row: i + 2, name: String(r[0] || ''), amount: Number(r[1]) || 0, note: String(r[2] || '') });
    });
  }
  return { items, total: items.reduce((s, x) => s + x.amount, 0) };
}

/**
 * สรุปการลงทุน: ลงทุนทั้งหมด = รายจ่ายหมวด investCat (ซื้อของเข้าห้อง) + ลงทุนเพิ่มเติม (M:O ถ้ามี)
 * ได้คืน = รายรับ − รายจ่ายอื่นที่ไม่ใช่ค่าซื้อของ (ไม่นับค่างวดรายเดือน)
 */
function investSummary_(Lg, sh, tot, entries) {
  const extra = readInvest_(sh);
  const buys = entries.filter(e => e.type === 'expense' && e.category === Lg.investCat);
  const buyTotal = buys.reduce((s, e) => s + e.amount, 0);
  const otherExp = tot.expense - buyTotal;
  const gross = !!Lg.investGross;                       // ปาล์ม: ได้คืน = รายได้อย่างเดียว ไม่หักค่าใช้จ่าย
  const returned = gross ? tot.income : tot.income - otherExp;
  const dates = entries.map(e => e.date).filter(Boolean).sort();
  const today = new Date();
  let months = 0;
  if (dates.length) {
    const f = dateFromStr_(dates[0]);
    months = Math.max(1, (today.getFullYear() - f.getFullYear()) * 12 + today.getMonth() - f.getMonth() + 1);
  }
  return {
    cat: Lg.investCat, text: Lg.investText || null, gross, buys: buys.map(e => ({ date: e.date, amount: e.amount, note: e.note, row: e.row })),
    buyTotal, items: extra.items, extra: extra.total,
    total: buyTotal + extra.total,
    income: tot.income, otherExp, returned, months,
  };
}

/** เพิ่ม (ไม่มี row) หรือแก้ไข (มี row + ค่าเดิมไว้ตรวจ) รายการลงทุนเพิ่มเติม */
function saveInvest_(d) {
  const Lg = ledgerOf_(d.book);
  if (!Lg.invest) throw new Error('สมุดนี้ไม่มีตารางเงินลงทุน');
  const sh = sheetOrThrow_(Lg.name);
  const name = text_(d.name, 60);
  if (!name) throw new Error('ใส่ชื่อรายการลงทุนก่อน');
  const amt = amount_(d.amount, 'ยอดลงทุน');
  if (amt === '' || amt === 0) throw new Error('ใส่ยอดลงทุนก่อน');
  let row = Number(d.row) || 0;
  if (row) {
    const r = sh.getRange(row, 13, 1, 2).getValues()[0];
    if (String(r[0]) !== String(d.oldName) || Number(r[1]) !== Number(d.oldAmount)) {
      throw new Error('รายการนี้ถูกแก้ไขไปแล้ว รีเฟรชแล้วลองใหม่');
    }
  } else {
    const last = Math.max(sh.getLastRow(), 1);
    row = last + 1;
    if (last >= 2) {
      const v = sh.getRange(2, 13, last - 1, 3).getValues();
      const i = v.findIndex(r => r.every(x => x === ''));
      if (i >= 0) row = i + 2;
    }
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  }
  if (!sh.getRange('M1').getValue()) {
    sh.getRange('M1:O1').setValues([[INVEST_HEADER, 'ยอด', 'หมายเหตุ']]).setFontWeight('bold');
  }
  sh.getRange(row, 13, 1, 3).setValues([[name, amt, text_(d.note)]]);
  return getLedger_(d);
}

function deleteInvest_(d) {
  const Lg = ledgerOf_(d.book);
  const sh = sheetOrThrow_(Lg.name);
  const row = Number(d.row);
  if (!(row >= 2)) throw new Error('ไม่พบรายการนี้');
  const r = sh.getRange(row, 13, 1, 2).getValues()[0];
  if (String(r[0]) !== String(d.name) || Number(r[1]) !== Number(d.amount)) {
    throw new Error('รายการนี้ถูกแก้ไขไปแล้ว รีเฟรชแล้วลองใหม่');
  }
  sh.getRange(row, 13, 1, 3).clearContent();
  return getLedger_(d);
}

function addLedger_(d) {
  const Lg = ledgerOf_(d.book);
  const date = dateFromStr_(d.date);
  const amt = amount_(d.amount, 'ยอด');
  if (amt === '' || amt === 0) throw new Error('ใส่ยอดก่อนบันทึก');
  const type = d.type === 'expense' ? EXPENSE_TXT : INCOME_TXT;
  const cat = text_(d.category, 40) || (d.type === 'expense' ? 'อื่นๆ' : Lg.incomeCats[0]);
  const sh = sheetOrThrow_(Lg.name);
  const last = Math.max(sh.getLastRow(), 1);
  let row = last + 1;
  if (last >= 2) {
    const v = sh.getRange(2, 1, last - 1, 5).getValues();
    const i = v.findIndex(r => r.every(x => x === ''));
    if (i >= 0) row = i + 2;
  }
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  sh.getRange(row, 1, 1, 5).setValues([[date, amt, text_(d.note), type, cat]]);
  return getLedger_(d);
}

function updateLedger_(d) {
  const Lg = ledgerOf_(d.book);
  const sh = sheetOrThrow_(Lg.name);
  const row = Number(d.row);
  if (!(row >= 2)) throw new Error('ไม่พบรายการนี้');
  const r = sh.getRange(row, 1, 1, 5).getValues()[0];
  if (fmtD_(r[0]) !== d.oldDate || Number(r[1]) !== Number(d.oldAmount)) {
    throw new Error('รายการนี้ถูกแก้ไขไปแล้ว รีเฟรชแล้วลองใหม่');
  }
  const date = dateFromStr_(d.date);
  const amt = amount_(d.amount, 'ยอด');
  if (amt === '' || amt === 0) throw new Error('ใส่ยอดก่อนบันทึก');
  const type = d.type === 'expense' ? EXPENSE_TXT : INCOME_TXT;
  const cat = text_(d.category, 40) || (d.type === 'expense' ? 'อื่นๆ' : Lg.incomeCats[0]);
  sh.getRange(row, 1, 1, 5).setValues([[date, amt, text_(d.note), type, cat]]);
  return getLedger_(d);
}

function deleteLedger_(d) {
  const Lg = ledgerOf_(d.book);
  const sh = sheetOrThrow_(Lg.name);
  const row = Number(d.row);
  if (!(row >= 2)) throw new Error('ไม่พบรายการนี้');
  const r = sh.getRange(row, 1, 1, 5).getValues()[0];
  // กันลบผิดแถว ถ้ามีคนแก้ชีตไปก่อน
  if (fmtD_(r[0]) !== d.date || Number(r[1]) !== Number(d.amount)) {
    throw new Error('รายการนี้ถูกแก้ไขไปแล้ว รีเฟรชแล้วลองใหม่');
  }
  sh.getRange(row, 1, 1, 5).clearContent();
  return getLedger_(d);
}

/* ================= จัดการผู้ใช้ ================= */

function listUsers_() {
  return allUsers_().map(u => ({ username: u.username, name: u.name, role: u.role,
                                 active: u.active, createdAt: u.createdAt }));
}

function saveUser_(d, s) {
  const username = normUser_(d.username);
  const users = allUsers_();
  const existing = users.find(u => u.username.toLowerCase() === username);
  const role = ROLE_RANK[d.role] ? d.role : 'viewer';
  const active = d.active !== false;
  if (existing && existing.username.toLowerCase() === s.username.toLowerCase() && (role !== 'admin' || !active)) {
    throw new Error('ลดสิทธิ์หรือปิดบัญชีของตัวเองไม่ได้');
  }
  const admins = users.filter(u => u.role === 'admin' && u.active && u.username.toLowerCase() !== username);
  if ((role !== 'admin' || !active) && admins.length === 0) throw new Error('ต้องมีผู้ดูแลที่ใช้งานอยู่อย่างน้อย 1 คน');
  if (!existing && !d.password) throw new Error('ผู้ใช้ใหม่ต้องตั้งรหัสผ่าน');
  upsertUser_({ username, password: d.password || '', name: d.name, role, active });
  return listUsers_();
}

function changePassword_(d, s) {
  const u = findUser_(s.username);
  if (hash_(u.salt, String(d.oldPassword || '')) !== u.hash) throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');
  upsertUser_({ username: u.username, password: d.newPassword, name: u.name, role: u.role, active: u.active });
  return true;
}