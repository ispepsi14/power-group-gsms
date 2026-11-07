// lookupMyCar — callable ของหน้า ?reception (bugfix-sweep K3 ขั้นที่ 1 · 24 ต.ค. 2569)
// spec: docs/specs/bugfix-sweep.decisions.md "คำตอบเจ้าของ K3" · สัญญา: หัวไฟล์ tests/line-bot-sweep.guard.js
//
// createLookupMyCar(deps) -> async (request) => { cars: [car], v: 2 }   (+ includesDelivered: true เมื่อ purpose 'feedback')
//   deps = { db (Admin SDK Firestore), now: () => Date, log?: fn, HttpsError?: class(code, message) }
//   request = { data: { last4, queueNo, purpose? }, auth: { uid } | null, rawRequest? }   (รูปของ onCall v2)
//
// กติกา:
//  - ต้องมี auth (หน้าเว็บล็อกอิน anonymous ก่อนเรียก) ไม่มี = 'unauthenticated'
//  - ต้องมีทั้งเบอร์ 4 ตัวท้าย + เลขคิว ขาด/รูปผิด = 'invalid-argument'
//  - เบอร์ผิด / คิวไม่ตรง = { cars: [] } ไม่ throw (หน้าเว็บถือ error อื่นทุกตัวว่า "function ยังไม่ deploy"
//    แล้วตกไปค้น board/ ตรง ๆ — receptionCallableFailed ใน index.html)
//  - จำกัดความถี่ต่อ uid และต่อ IP (ในหน่วยความจำของ instance · best effort เหมือน rate ของ lineWebhook)
//    เกิน = 'resource-exhausted' และยังโดนกันจนหมดหน้าต่างเวลา ต่อให้รอบนั้นเดาถูก
//  - อ่านด้วย Admin SDK เท่านั้น ทุก query มีเงื่อนไข (ไม่มี list) + select() เฉพาะฟิลด์ที่ใช้ + timeout
//  - คืนเฉพาะฟิลด์ที่ receptionResultHtml / receptionQuoteSheetHtml / chatSetCars ใช้
//    ห้ามคืนชื่อลูกค้า / เบอร์ (แม้ 4 ตัวท้าย) / notes / ลายเซ็น / customerId / รูป
//
// รุ่น 2 (bugfix-round2 S2 · 26 ต.ค. 2569 · spec docs/specs/bugfix-round2.backend.md §1.6):
//  - อ่านค่าที่แอปคำนวณไว้แล้ว (ยอดเงิน / ป้ายสถานะ คำนวณด้วยฟังก์ชันเดียวกับใบที่ปริ้น ห้ามคำนวณซ้ำที่นี่)
//    จาก boardPrivate/ (สำเนาเต็มที่อ่านได้เฉพาะ Admin SDK) และ board/ (ช่วงเปลี่ยนผ่าน: เครื่อง 4.6.8
//    ยังเขียนราคาลง board/) ค้นทั้งสองทางพร้อมกัน รวมตาม id ให้ boardPrivate ชนะ — ลูกค้าคนเดียว
//    อาจมีใบหนึ่งอยู่ใน boardPrivate อีกใบยังอยู่แค่ board/
//  - ยืนยันกับ jobs/ ว่าใบยังอยู่ ไม่ถูกลบ ไม่ส่งมอบแล้ว (เหมือนรุ่น 1)
//  - ผลมี v: 2 เสมอ (ปุ่มตรวจในแอปแยก function รุ่น 1 ที่ยังไม่ deploy ใหม่ออกได้)
//  - purpose === 'feedback' (หน้า ?feedback): ไม่กรองส่งมอบ/เอารถลง (ยังกรอง deletedAt) แต่รถที่ส่งมอบแล้ว
//    ต้อง updatedAt ไม่เกิน FEEDBACK_MAX_AGE_MS และ car เหลือเฉพาะ FEEDBACK_FIELDS (security ข้อ 4:
//    ไล่ last4 ได้ ห้ามคืนราคา / อะไหล่ / อาการของรถที่ส่งมอบไปแล้ว) + includesDelivered: true
//  - root ไม่เขียนอะไรเลย · ทุก query เป็น equality ฟิลด์เดียว (ไม่ต้องมี composite index)
//
// เฟส 3 multi-branch (4 พ.ย. 2569 · spec docs/specs/multi-branch.phase3.md §2, §4):
//  - data.branchId (มีคีย์นี้ = หน้าสาขา): string /^[a-z0-9-]{2,24}$/ และไม่ใช่ 'donmueang' ผิด = 'invalid-argument' ก่อนอ่าน db
//    branches/{b} ต้องมีอยู่ ไม่มี = 'not-found' · อ่านเฉพาะ branches/{b}/boardPrivate + branches/{b}/jobs (ไม่อ่าน board ของสาขา
//    เพราะไม่มี phoneLast4 · ไม่แตะ path root · ไม่มี collectionGroup)
//  - ผลของสาขา = {cars, v:2, branch, grant} — หน้าสาขารับผลเฉพาะเมื่อ branch ตรง (function รุ่นเก่าไม่คืน branch)
//  - เขียนได้ที่เดียว: branches/{b}/chatGrants/{uid}_{jobId} (แชท, purpose reception) หรือ {uid}_{jobId}_fb (purpose feedback) (ดูท้ายฟังก์ชัน) · rate limit ใช้คีย์เดิม (root/ทุกสาขาโควตาเดียวกัน)
//  - ไม่มีคีย์ branchId = root: ผลและการอ่านเหมือนรุ่น 2 ทุกไบต์
'use strict';

const LAST4_RE = /^[0-9]{4}$/;
const QUEUE_MAX_LEN = 12;
const DB_TIMEOUT_MS = 5000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_PER_UID = 10;          // คนจริงพิมพ์ผิดได้หลายรอบ แต่ไม่ถึง 10 ครั้งต่อนาที
const RATE_MAX_PER_IP = 30;           // uid anonymous สร้างใหม่ได้ฟรี — กันที่ IP อีกชั้น (ร้านใช้ wifi เดียวกันหลายคน)
const MAX_CANDIDATES = 5;             // เบอร์ 4 ตัวท้าย + คิวเดียวกัน มากกว่านี้ = ผิดปกติ
const INACTIVE = ['delivered', 'carout'];   // เหมือน receptionDirectLookup ของหน้าเว็บ
const FEEDBACK_MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const FEEDBACK_FIELDS = ['id', 'queueNo', 'plate', 'province', 'brand', 'model', 'status', 'createdAt'];

// ฟิลด์ของ board/ ที่หน้า reception ใช้ (ไม่มี phoneLast4 / thumb / bay)
const BOARD_FIELDS = ['queueNo', 'queueLabel', 'plate', 'province', 'brand', 'model', 'color',
  'complaints', 'price', 'parts', 'partsSubtotal', 'discountType', 'discountValue', 'discountAmount',
  'jobNumber', 'shopName', 'shopPhone', 'shopLine', 'est', 'estMins', 'workStart', 'workEnd',
  'status', 'statusLabel', 'statusCls', 'createdAt', 'updatedAt'];
const JOB_FIELDS = ['deletedAt', 'status', 'queueNo'];
const BRANCH_RE = /^[a-z0-9-]{2,24}$/;
const ROOT_BRANCH = 'donmueang';
const GRANT_ROOT = false;                       // ดอนเมืองยังไม่เขียน grant (multi-branch.phase3.md §6 opt-in ภายหลัง)
const GRANT_TTL_MS = 24 * 3600 * 1000;
const GRANT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function str(v){ return v === undefined || v === null ? '' : String(v); }
function num(v){ const n = Number(v); return isFinite(n) ? n : 0; }
function localSameQueueNo(a, b){
  const A = str(a).trim(), B = str(b).trim();
  if(!A || !B) return false;
  if(A.toLowerCase() === B.toLowerCase()) return true;
  if(/^\d+$/.test(A) && /^\d+$/.test(B)) return Number(A) === Number(B);
  return false;
}
function withTimeout(p, ms){
  let timer = null;
  const t = new Promise((_, rej) => {
    timer = setTimeout(() => { const e = new Error('timeout'); e.code = 'deadline-exceeded'; rej(e); }, ms);
    if(timer && timer.unref) timer.unref();
  });
  return Promise.race([Promise.resolve(p), t]).finally(() => { if(timer) clearTimeout(timer); });
}

// รูปของ car ที่ส่งกลับ — คัดทีละฟิลด์ ไม่ส่งทั้งเอกสาร (ฟิลด์ที่เพิ่มใน board/ ภายหลังจะไม่หลุดออกไปเอง)
function toCar(id, b){
  const parts = Array.isArray(b.parts) ? b.parts.slice(0, 200).filter(p => p && typeof p === 'object').map(p => ({
    name: str(p.name), qty: num(p.qty) || 1, unit: str(p.unit) || 'ชิ้น', price: num(p.price), inPromo: !!p.inPromo })) : [];
  const complaints = Array.isArray(b.complaints) ? b.complaints.filter(x => typeof x === 'string' && x) .slice(0, 50) : [];
  return {
    id,
    queueNo: str(b.queueNo), queueLabel: str(b.queueLabel),
    plate: str(b.plate), province: str(b.province), brand: str(b.brand), model: str(b.model), color: str(b.color),
    status: str(b.status) || 'received', statusLabel: str(b.statusLabel) || str(b.status) || 'received', statusCls: str(b.statusCls),
    complaints, parts,
    price: num(b.price), partsSubtotal: num(b.partsSubtotal),
    discountType: str(b.discountType) || 'amount', discountValue: num(b.discountValue), discountAmount: num(b.discountAmount),
    jobNumber: str(b.jobNumber), shopName: str(b.shopName), shopPhone: str(b.shopPhone), shopLine: str(b.shopLine),
    est: str(b.est), estMins: num(b.estMins), workStart: str(b.workStart), workEnd: str(b.workEnd),
    createdAt: str(b.createdAt), updatedAt: str(b.updatedAt)
  };
}

function toFeedbackCar(car){
  const o = {};
  FEEDBACK_FIELDS.forEach(k => { o[k] = car[k]; });
  return o;
}

function createLookupMyCar(deps){
  if(!deps || !deps.db) throw new Error('createLookupMyCar: ต้องมี db');
  const db = deps.db;
  const now = typeof deps.now === 'function' ? deps.now : () => new Date();
  const logFn = typeof deps.log === 'function' ? deps.log : function(){};
  const dbTimeoutMs = deps.dbTimeoutMs > 0 ? deps.dbTimeoutMs : DB_TIMEOUT_MS;
  const HttpsError = typeof deps.HttpsError === 'function' ? deps.HttpsError
    : class extends Error { constructor(code, msg){ super(msg || code); this.code = code; } };
  let sameQueueNo = localSameQueueNo;
  try { const S = deps.shared || require('../shared/lineSummary.js'); if(typeof S.sameQueueNo === 'function') sameQueueNo = S.sameQueueNo; } catch(e){}

  const rate = new Map();   // key -> [เวลา]
  function log(step, info){ try { logFn('lookupMyCar', Object.assign({ step }, info || {})); } catch(e){} }
  function hit(key, max, t){
    const list = (rate.get(key) || []).filter(x => t - x < RATE_WINDOW_MS);
    list.push(t);              // นับทุกครั้ง รวมครั้งที่โดนกัน — ยิงต่อ = โดนกันต่อ
    rate.delete(key); rate.set(key, list);
    if(rate.size > 2000){ const first = rate.keys().next().value; rate.delete(first); }
    return list.length > max;
  }
  const dbq = p => withTimeout(p, dbTimeoutMs);

  return async function lookupMyCar(request){
    const req = request || {};
    const uid = req.auth && typeof req.auth.uid === 'string' ? req.auth.uid : '';
    if(!uid) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อน');

    const t = now().getTime();
    const ip = str(req.rawRequest && req.rawRequest.ip).slice(0, 64);
    const overUid = hit('uid:' + uid, RATE_MAX_PER_UID, t);
    const overIp = ip ? hit('ip:' + ip, RATE_MAX_PER_IP, t) : false;
    if(overUid || overIp){ log('rate-limited', { by: overUid ? 'uid' : 'ip' }); throw new HttpsError('resource-exhausted', 'ค้นหาบ่อยเกินไป'); }

    const d = req.data;
    const last4 = d && typeof d === 'object' ? d.last4 : undefined;
    const queueRaw = d && typeof d === 'object' ? d.queueNo : undefined;
    if(typeof last4 !== 'string' || !LAST4_RE.test(last4) || typeof queueRaw !== 'string'){
      throw new HttpsError('invalid-argument', 'ต้องมีเบอร์ 4 ตัวท้าย และเลขคิว');
    }
    const queueNo = queueRaw.trim();
    if(!queueNo || queueNo.length > QUEUE_MAX_LEN) throw new HttpsError('invalid-argument', 'เลขคิวไม่ถูกต้อง');

    let branch = '';
    if(Object.prototype.hasOwnProperty.call(d, 'branchId')){
      const b = d.branchId;
      if(typeof b !== 'string' || b === ROOT_BRANCH || !BRANCH_RE.test(b)) throw new HttpsError('invalid-argument', 'สาขาไม่ถูกต้อง');
      branch = b;
    }
    const base = branch ? db.collection('branches').doc(branch) : db;
    if(branch){
      let bs;
      try { bs = await dbq(db.collection('branches').doc(branch).get()); }
      catch(e){ log('branch-error', { code: str(e && e.code).slice(0, 40) || 'error' }); throw new HttpsError('unavailable', 'ระบบดึงข้อมูลไม่ได้ตอนนี้'); }
      if(!bs || !bs.exists) throw new HttpsError('not-found', 'ไม่พบสาขา');
    }
    const feedback = d.purpose === 'feedback';
    const t0 = now().getTime();
    // รถที่ยังอยู่ในร้าน = ผ่าน · รถส่งมอบ/เอารถลง = ผ่านเฉพาะ feedback ที่ updatedAt ไม่เกิน 14 วัน
    const statusOk = (status, updatedAt) => {
      if(INACTIVE.indexOf(status) < 0) return true;
      if(!feedback) return false;
      const at = Date.parse(str(updatedAt));
      return isFinite(at) && t0 - at <= FEEDBACK_MAX_AGE_MS && at - t0 <= FEEDBACK_MAX_AGE_MS;
    };
    let grant = false;
    const done = cars => {
      const out = { cars, v: 2 };
      if(feedback) out.includesDelivered = true;
      if(branch){ out.branch = branch; out.grant = grant; }
      return out;
    };

    let rows;
    try {
      // equality ฟิลด์เดียว (single-field index อัตโนมัติ) · ไม่ where queueNo เพราะ "04" ต้องเท่ากับ "4"
      const [sp, sb] = await Promise.all([
        dbq(base.collection('boardPrivate').where('phoneLast4', '==', last4).select(...BOARD_FIELDS).get()),
        branch ? Promise.resolve({ docs: [] }) : dbq(db.collection('board').where('phoneLast4', '==', last4).select(...BOARD_FIELDS).get())
      ]);
      const merged = new Map();
      (sb.docs || []).forEach(x => merged.set(x.id, x.data() || {}));
      (sp.docs || []).forEach(x => merged.set(x.id, x.data() || {}));   // boardPrivate ชนะ
      rows = Array.from(merged, ([id, b]) => ({ id, b }))
        .filter(r => sameQueueNo(r.b.queueNo, queueNo) && statusOk(r.b.status, r.b.updatedAt))
        .slice(0, MAX_CANDIDATES);
    } catch(e){
      log('board-error', { code: str(e && e.code).slice(0, 40) || 'error' });
      throw new HttpsError('unavailable', 'ระบบดึงข้อมูลไม่ได้ตอนนี้');
    }
    if(!rows.length){ log('done', { found: 0, feedback }); return done([]); }

    // ยืนยันกับใบงานจริง: board/ ของใบที่ลบลงถังขยะ / ส่งมอบแล้วอาจค้างอยู่
    let jobs;
    try {
      const refs = rows.map(r => base.collection('jobs').doc(r.id));
      jobs = await dbq(typeof db.getAll === 'function'
        ? db.getAll(...refs, { fieldMask: JOB_FIELDS })
        : Promise.all(refs.map(r => r.get())));
    } catch(e){
      log('jobs-error', { code: str(e && e.code).slice(0, 40) || 'error' });
      throw new HttpsError('unavailable', 'ระบบดึงข้อมูลไม่ได้ตอนนี้');
    }
    const byId = {};
    (jobs || []).forEach(s => { if(s && s.exists) byId[s.id] = s.data() || {}; });
    let cars = rows.filter(r => {
      const j = byId[r.id];
      return j && !j.deletedAt && statusOk(j.status, r.b.updatedAt) && sameQueueNo(j.queueNo, queueNo);
    }).map(r => toCar(r.id, r.b));
    cars.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if(feedback) cars = cars.map(toFeedbackCar);
    // เฟส 3: สิทธิ์แชท/ให้คะแนนของลูกค้าสาขา = branches/{b}/chatGrants/{uid}_{jobId} (อายุ 24 ชม.)
    //   สร้างจาก cars หลังเทียบ jobs/ แล้วเท่านั้น (แถว boardPrivate ที่ค้างไม่ได้สิทธิ์) · batch เดียว <= MAX_CANDIDATES
    //   refresh: true (ตัวรีเฟรช 60 วิของหน้าเว็บ) ไม่เขียนซ้ำ · root ไม่เขียน (GRANT_ROOT = false)
    //   เขียนไม่ได้ (เช่น service account ยังเป็น Datastore Viewer) = คืนรถตามปกติ + grant:false · ไม่ทำให้การค้นล้ม
    //   S-1: feedback (คืนรถที่ส่งมอบแล้วได้) เขียนที่ {uid}_{jobId}_fb เท่านั้น — กฎใช้ id นี้ได้แค่ให้คะแนน เปิดแชทไม่ได้
    //   และไม่ทับ grant แชท {uid}_{jobId} (purpose 'reception') ของคันเดียวกัน
    const grantSuffix = feedback ? '_fb' : '';
    const grantCars = branch && d.refresh !== true ? cars.filter(c => GRANT_ID_RE.test(str(c.id))) : [];
    if(grantCars.length){
      const batch = db.batch();
      grantCars.forEach(c => batch.set(base.collection('chatGrants').doc(uid + '_' + c.id + grantSuffix),
        { uid, jobId: c.id, branchId: branch, purpose: feedback ? 'feedback' : 'reception', expireAt: new Date(t0 + GRANT_TTL_MS), createdAt: new Date(t0) }));
      try { await dbq(batch.commit()); grant = true; }
      catch(e){ log('grant-error', { code: str(e && e.code).slice(0, 40) || 'error' }); grant = false; }
    }
    log('done', { found: cars.length, feedback });
    return done(cars);
  };
}

module.exports = { createLookupMyCar, FEEDBACK_FIELDS, FEEDBACK_MAX_AGE_MS };
