// ตัว webhook ของ LINE Bot (spec docs/specs/line-bot-queue-command.md ส่วน B / C · UX U2/U3)
// createHandler(deps) -> async (req, res)  — index.js แค่ห่อด้วย onRequest
//
// กติกาที่ไฟล์นี้ต้องรักษา (ห้ามถอด):
//  - ตรวจลายเซ็นจาก req.rawBody ก่อนแตะ Firestore / LINE (S1 · C22)
//  - ตอบข้อมูลลูกค้าเฉพาะ source.type === 'group' ที่ lineGroups/{id} ได้รับอนุมัติแล้ว (S4)
//  - Admin SDK อ่านอย่างเดียว เขียนได้แค่ lineGroups (create ตอน join / lastSeenAt) และ lineBotState (กันซ้ำ)
//    ห้ามเขียนใบงาน: flushState ของเครื่องในร้านใช้ set ทั้งเอกสาร ฟิลด์ที่ function เติมจะหายอยู่ดี (BR-7)
//  - ไม่มีเส้นไหนเปลี่ยนสถานะกลุ่มเป็นอนุมัติ — มีแต่แอดมินในแอป (S3)
//  - ใช้ reply เท่านั้น ไม่มีการส่งแบบ push / multicast / broadcast
//  - log: groupId / คำสั่ง / จำนวน / ผลแต่ละช่อง / เวลา เท่านั้น ห้ามชื่อ เบอร์ ทะเบียน URL replyToken userId
//    ข้อความที่ไม่ใช่คำสั่ง และ err.message ดิบ (S9 · C27)
//  - reply ให้เสร็จก่อนตอบ HTTP 200 (2nd gen ตัด CPU หลังตอบ · ข้อ 6.6)
'use strict';
const { verifySignature } = require('./signature.js');
const { parseCommand } = require('./command.js');
const { thaiDayRangeUtc, shiftDay, fmtThaiDate, fmtThaiDateTime, fmtThaiTime } = require('./dates.js');

const GROUP_ID_RE = /^C[0-9a-f]{32}$/;
const EVENT_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const DOC_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PHOTO_FILE_RE = /^[A-Za-z0-9_-]{1,128}\.(jpe?g|png)$/i;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // ไม่มี 0 O 1 I L (S2 / UX U1)

const EVENT_MAX_AGE_MS = 5 * 60 * 1000;       // S3 (ค)
const DEDUPE_TTL_MS = 10 * 60 * 1000;         // ข้อ 6.6
const RATE_WINDOW_MS = 60 * 1000;             // C28
const RATE_MAX = 20;
const NOTICE_EVERY_MS = 60 * 60 * 1000;       // "ยังไม่ได้รับอนุญาต" ชั่วโมงละครั้ง (B2) · lastSeenAt ด้วย (S3 ง)
const PENDING_MAX = 20;                       // B10
const PENDING_FRESH_MS = 24 * 3600 * 1000;    // S3 (ก) pending ที่เก่ากว่า 24 ชม. ไม่นับเพดาน
const SIGNED_URL_TTL_MS = 24 * 3600 * 1000;   // ข้อ 6.5 (ต้องพิสูจน์ C19 บนเครื่องจริง)
const IMAGE_BUDGET_MS = 15000;                // ข้อ 6.6 / C23
const MAX_PHOTOS = 8;                         // = JOB_SHARE_MAX_PHOTOS ของแอป
const MAX_PHOTO_ROWS_CHECKED = 40;
const MAX_URL_LEN = 2000;                     // LINE image URL
const MAX_FLEX_URI_LEN = 1000;                // LINE uri action
const MAX_TEXT_LEN = 5000;                    // LINE text message
const MAX_GROUP_NAME = 100;

// คำสถานะเดียวกับบรรทัดปิดของ buildLineSummaryText (CLOSING) — ใช้เฉพาะรายการย่อ U2.7
const CLOSING = { received: 'รอเช็ค', inspecting: 'รอเช็ค', quoted: 'รอลูกค้าตัดสินใจ', approved: 'อนุมัติ',
  scheduled: 'นัดวันมาทำ', rejected: 'ไม่อนุมัติ', repairing: 'กำลังซ่อม', aligning: 'รอตั้งศูนย์',
  ready: 'พร้อมส่ง', delivered: 'ส่งแล้ว', carout: 'เอารถลง' };

// ฟิลด์ที่ต้องใช้จริง (ใบงานพกลายเซ็น base64 มาทั้งก้อน · BR-1 ก)
const DAY_FIELDS = ['queueNo', 'createdAt', 'deletedAt', 'jobNumber', 'vehicleId', 'customerId', 'status'];
const HISTORY_FIELDS = ['jobNumber', 'createdAt', 'deletedAt', 'status', 'vehicleId', 'customerId',
  'partsNeeded', 'discountType', 'discountValue', 'priceEstimate'];

// ---------------------------------------------------------------- ข้อความ (UX U2)
const T = {
  joined: code => 'Bot ร้าน POWER GROUP เข้ากลุ่มแล้ว\nกลุ่มนี้ยังใช้งานไม่ได้ ต้องให้แอดมินอนุมัติก่อน\n\nรหัสกลุ่ม: ' + code +
    '\n\nแอดมิน: เปิดแอพ GSMS → ตั้งค่า → กลุ่ม LINE\nแล้วกด "อนุมัติกลุ่มนี้" ที่รหัส ' + code +
    '\n\nอนุมัติแล้ว พิมพ์ !เลขคิว เช่น !4 หรือ !4 20/10',
  pending: code => 'กลุ่มนี้ยังไม่ได้รับอนุมัติ (รหัส ' + code + ')\nให้แอดมินอนุมัติในแอพ GSMS → ตั้งค่า → กลุ่ม LINE',
  denied: 'กลุ่มนี้ยังไม่ได้รับอนุญาตให้ดูข้อมูลคิว\nติดต่อแอดมินร้าน',
  notGroup: 'ใช้คำสั่งนี้ได้เฉพาะในกลุ่มร้านที่ลงทะเบียนแล้ว',
  badDate: 'วันที่ไม่ถูกต้อง พิมพ์แบบ !4 หรือ !4 20/10',
  tooOld: 'ดูย้อนหลังได้ไม่เกิน 90 วัน\nใบเก่ากว่านั้นเปิดดูในแอพ',
  dbDown: 'ระบบดึงข้อมูลไม่ได้ตอนนี้ ลองใหม่อีกครั้ง',
  notFound: (q, date, prev) => 'ไม่พบคิว ' + q + ' ของวันที่ ' + date + '\nคิวของวันอื่น พิมพ์แบบ !' + q + ' ' + prev,
  timeout: typed => '※ ส่งแค่ข้อความ เตรียมรูปไม่ทันเวลา\nลองพิมพ์ ' + typed + ' ใหม่อีกครั้ง'
};

function errCode(e){
  const c = e && e.code;
  return (typeof c === 'number' || typeof c === 'string') ? String(c).slice(0, 40) : 'error';
}
function isAlreadyExists(e){
  const c = e && e.code;
  return c === 6 || c === '6' || c === 'already-exists' || c === 'ALREADY_EXISTS';
}
function headerOf(req, name){
  if(req && typeof req.get === 'function'){ const v = req.get(name); if(v !== undefined) return v; }
  const h = (req && req.headers) || {};
  return h[name] !== undefined ? h[name] : h[name.toLowerCase()];
}
function sendStatus(res, code){
  try { res.status(code).send(code === 200 ? 'OK' : ''); } catch(e){ try { res.end(); } catch(e2){} }
}
function randomCode(taken){
  const crypto = require('crypto');
  for(let tries = 0; tries < 50; tries++){
    let s = '';
    for(let i = 0; i < 4; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if(!taken.has(s)) return s;
  }
  return null;
}
function str(v){ return v === undefined || v === null ? '' : String(v); }
function byCreatedAt(a, b){
  const x = str(a.createdAt), y = str(b.createdAt);
  if(x !== y) return x < y ? -1 : 1;
  const i = str(a.id || a.__id), j = str(b.id || b.__id);
  return i < j ? -1 : i > j ? 1 : 0;
}

// เทียบเลขคิวแบบเดียวกับ sameQueueNo ของแอป ("04" = "4" · "A4" ≠ "4") — ใช้เมื่อไฟล์ร่วมไม่ได้ส่งมา
function localSameQueueNo(a, b){
  const A = str(a).trim(), B = str(b).trim();
  if(!A || !B) return false;
  if(A.toLowerCase() === B.toLowerCase()) return true;
  if(/^\d+$/.test(A) && /^\d+$/.test(B)) return Number(A) === Number(B);
  return false;
}

// path รูปรถที่ยอมเซ็น: jobPhotos/{jobId}/{ไฟล์} เท่านั้น ไม่มี .. % // \ (S5 · C18)
function safePhotoPath(p, jobId){
  if(typeof p !== 'string' || p.length > 300) return null;
  if(/\.\.|%|\/\/|\\/.test(p)) return null;
  const pre = 'jobPhotos/' + jobId + '/';
  if(p.indexOf(pre) !== 0) return null;
  return PHOTO_FILE_RE.test(p.slice(pre.length)) ? p : null;
}

// ---------------------------------------------------------------- ตัวสร้าง handler
function createHandler(deps){
  if(!deps || !deps.db || !deps.bucket || !deps.line) throw new Error('createHandler: ต้องมี db / bucket / line');
  const db = deps.db, bucket = deps.bucket, line = deps.line;
  const now = typeof deps.now === 'function' ? deps.now : () => new Date();
  const nowMs = () => now().getTime();
  const logFn = typeof deps.log === 'function' ? deps.log : function(){};
  const imageBudgetMs = deps.imageBudgetMs > 0 ? deps.imageBudgetMs : IMAGE_BUDGET_MS;
  const S = deps.shared || require('../shared/lineSummary.js');
  for(const k of ['formatLineSummary', 'pickLastService', 'fmtDateBEBangkok', 'jobGrandTotal'])
    if(typeof S[k] !== 'function') throw new Error('shared/lineSummary.js ไม่มี ' + k);
  const sameQueueNo = typeof S.sameQueueNo === 'function' ? S.sameQueueNo : localSameQueueNo;

  // สถานะในหน่วยความจำของ instance (best effort · maxInstances 2 = หลุดได้ไม่เกิน 2 เท่า · BR-5)
  const rate = new Map();        // key -> [เวลา]
  const notices = new Map();     // groupId -> เวลาที่ตอบ "ยังไม่ได้รับอนุญาต" ล่าสุด
  const seenWrites = new Map();  // groupId -> เวลาที่เขียน lastSeenAt ล่าสุด

  function log(step, info){
    try { logFn('lineWebhook', Object.assign({ step }, info || {})); } catch(e){}
  }
  function trimMap(m, max){
    let over = m.size - max;
    if(over <= 0) return;
    for(const k of Array.from(m.keys())){ if(over-- <= 0) break; m.delete(k); }
  }
  function rateLimited(key){
    const t = nowMs();
    const list = (rate.get(key) || []).filter(x => t - x < RATE_WINDOW_MS);
    if(list.length >= RATE_MAX){ rate.set(key, list); return true; }
    list.push(t); rate.set(key, list); trimMap(rate, 500);
    return false;
  }
  async function claimEvent(ev){
    // กันซ้ำข้าม instance: create() ล้มแบบ atomic ถ้าเคยทำแล้ว (C24)
    const id = ev.webhookEventId;
    if(typeof id !== 'string' || !EVENT_ID_RE.test(id)){ log('no-event-id', {}); return false; }
    try {
      await db.collection('lineBotState').doc('evt_' + id).create({
        at: now().toISOString(), expireAt: new Date(nowMs() + DEDUPE_TTL_MS) });
      return true;
    } catch(e){
      if(isAlreadyExists(e)){ log('duplicate', {}); return false; }
      log('dedupe-error', { code: errCode(e) });
      return true;   // ฐานข้อมูลสะดุด: ทำต่อ ถ้าอ่านไม่ได้จริงจะได้ข้อความ dbDown
    }
  }
  async function reply(ev, messages, info){
    const token = ev.replyToken;
    if(typeof token !== 'string' || !token || !messages.length) return;
    try {
      await line.reply(token, messages.slice(0, 5));
      log('replied', Object.assign({ messages: messages.length }, info || {}));
    } catch(e){
      log('reply-error', Object.assign({ code: errCode(e) }, info || {}));
    }
  }
  const textMsg = t => ({ type: 'text', text: str(t).slice(0, MAX_TEXT_LEN) });

  // ---------------------------------------------------------- join (ส่วน B)
  async function onJoin(ev){
    const src = ev.source || {};
    if(src.type !== 'group' || !GROUP_ID_RE.test(src.groupId || '')){ log('join-ignored', {}); return; }
    const gid = src.groupId;
    const ref = db.collection('lineGroups').doc(gid);
    let snap;
    try { snap = await ref.get(); } catch(e){ log('join-error', { gid, code: errCode(e) }); return; }
    if(snap.exists){ log('join-existing', { gid }); return; }       // ไม่ทับคำตัดสินของแอดมิน
    let pend;
    try { pend = await db.collection('lineGroups').where('status', '==', 'pending').select('firstSeenAt', 'code').get(); }
    catch(e){ log('join-error', { gid, code: errCode(e) }); return; }
    const t = nowMs();
    let fresh = 0; const taken = new Set();
    pend.docs.forEach(d => {
      const x = d.data() || {};
      if(x.code) taken.add(String(x.code));
      const at = Date.parse(x.firstSeenAt);
      if(!isFinite(at) || t - at < PENDING_FRESH_MS) fresh++;
    });
    if(fresh >= PENDING_MAX){ log('join-cap', { gid, pending: fresh }); return; }  // B10: ไม่สร้าง ไม่ตอบ
    const code = randomCode(taken);
    if(!code){ log('join-nocode', { gid }); return; }
    // ชื่อกลุ่ม + จำนวนสมาชิก (S2) ถ้าเรียกไม่สำเร็จ join ยังต้องสำเร็จ (memberCount ไม่ใส่ฟิลด์เลย)
    const [sum, cnt] = await Promise.all([
      Promise.resolve().then(() => line.getGroupSummary(gid)).catch(e => { log('summary-error', { gid, code: errCode(e) }); return null; }),
      typeof line.getGroupMemberCount === 'function'
        ? Promise.resolve().then(() => line.getGroupMemberCount(gid)).catch(e => { log('member-count-error', { gid, code: errCode(e) }); return null; })
        : null
    ]);
    const name = str(sum && sum.groupName).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_GROUP_NAME);
    const iso = new Date(t).toISOString();
    const doc = { name, code, status: 'pending', firstSeenAt: iso, lastSeenAt: iso };
    const count = cnt && Number(cnt.count);
    if(Number.isInteger(count) && count >= 0 && count <= 100000) doc.memberCount = count;
    try {
      // create() เท่านั้น: เอกสารที่มีอยู่แล้ว (revoked / approved) จะไม่ถูกทับ (S3 ข)
      await ref.create(doc);
    } catch(e){
      log(isAlreadyExists(e) ? 'join-existing' : 'join-error', { gid, code: errCode(e) });
      return;
    }
    seenWrites.set(gid, t);
    await reply(ev, [textMsg(T.joined(code))], { gid, result: 'joined' });
  }

  // ---------------------------------------------------------- ข้อความ (ส่วน C)
  async function onMessage(ev){
    const msg = ev.message || {};
    if(msg.type !== 'text') return;                       // สติกเกอร์ / รูป = เงียบ
    const cmd = parseCommand(msg.text, now());
    if(!cmd) return;                                       // ไม่ใช่คำสั่ง = เงียบ ไม่ log ข้อความ
    const src = ev.source || {};
    if(src.type !== 'group'){
      // แชท 1:1 / room: ไม่อ่านอะไรเลย (S4) · key ของ rate limit ไม่ได้ใช้ตัดสินสิทธิ์
      const key = src.type === 'room' ? 'room:' + str(src.roomId) : 'user:' + str(src.userId);
      if(rateLimited(key)) return;
      if(!(await claimEvent(ev))) return;
      await reply(ev, [textMsg(T.notGroup)], { result: 'not-group', source: src.type === 'room' ? 'room' : 'user' });
      return;
    }
    const gid = src.groupId;
    if(!GROUP_ID_RE.test(gid || '')){ log('bad-group-id', {}); return; }
    if(rateLimited('group:' + gid)){ log('rate-limited', { gid }); return; }
    if(!(await claimEvent(ev))) return;

    // whitelist อ่านจาก Firestore ทุกครั้ง (ยกเลิกสิทธิ์มีผลทันที · B7)
    let group;
    try { const s = await db.collection('lineGroups').doc(gid).get(); group = s.exists ? (s.data() || {}) : null; }
    catch(e){ log('group-error', { gid, code: errCode(e) }); await reply(ev, [textMsg(T.dbDown)], { gid, result: 'db-down' }); return; }

    const allowed = !!group && group.status === 'approved';
    if(!allowed){
      const t = nowMs(), last = notices.get(gid);
      if(last !== undefined && t - last < NOTICE_EVERY_MS){ log('not-allowed-quiet', { gid }); return; }
      notices.set(gid, t); trimMap(notices, 500);
      if(group) await touchLastSeen(gid);
      const isPending = !!group && group.status === 'pending' && /^[A-Z0-9]{4}$/.test(str(group.code));
      await reply(ev, [textMsg(isPending ? T.pending(group.code) : T.denied)], { gid, cmd: cmd.typed, result: 'not-allowed' });
      return;
    }
    await touchLastSeen(gid);

    if(cmd.kind === 'bad-date'){ await reply(ev, [textMsg(T.badDate)], { gid, cmd: cmd.typed, result: 'bad-date' }); return; }
    if(cmd.kind === 'too-old'){ await reply(ev, [textMsg(T.tooOld)], { gid, cmd: cmd.typed, result: 'too-old' }); return; }
    const out = await answerQuery(cmd, gid);
    await reply(ev, out.messages, Object.assign({ gid, cmd: cmd.typed }, out.info));
  }

  // lastSeenAt ไม่เกินชั่วโมงละครั้งต่อกลุ่ม (S3 ง) · update() ไม่สร้างเอกสารใหม่
  async function touchLastSeen(gid){
    const t = nowMs(), last = seenWrites.get(gid);
    if(last !== undefined && t - last < NOTICE_EVERY_MS) return;
    seenWrites.set(gid, t); trimMap(seenWrites, 500);
    try { await db.collection('lineGroups').doc(gid).update({ lastSeenAt: new Date(t).toISOString() }); }
    catch(e){ log('lastseen-error', { gid, code: errCode(e) }); }
  }

  // ---------------------------------------------------------- หาใบงาน
  async function answerQuery(cmd, gid){
    const t0 = nowMs();
    const q = cmd.queue;
    const range = thaiDayRangeUtc(cmd.y, cmd.m, cmd.d);
    const dateLabel = fmtThaiDate(cmd.y, cmd.m, cmd.d);
    const prev = shiftDay(cmd.y, cmd.m, cmd.d, -1);
    let found;
    try {
      // range บนฟิลด์เดียว ห้าม where queueNo (ต้องมี composite index และ "04" ต้องเท่ากับ "4") · BR-1
      const day = await db.collection('jobs').where('createdAt', '>=', range.start).where('createdAt', '<', range.end)
        .select(...DAY_FIELDS).get();
      found = day.docs.map(d => Object.assign({}, d.data() || {}, { id: d.id }))
        .filter(j => !j.deletedAt && sameQueueNo(j.queueNo, q));
    } catch(e){
      log('jobs-error', { gid, code: errCode(e) });
      return { messages: [textMsg(T.dbDown)], info: { result: 'db-down' } };
    }
    if(found.length === 0){
      return { messages: [textMsg(T.notFound(q, dateLabel, prev.d + '/' + prev.m))],
               info: { found: 0, result: 'not-found', ms: nowMs() - t0 } };
    }
    if(found.length > 1) return listDuplicates(found, q, dateLabel, gid, t0);
    return fullAnswer(found[0].id, cmd, gid, t0);
  }

  // หลายใบ: ข้อความเดียว ไม่มีรูป ไม่มีชื่อ/เบอร์ ทะเบียนไม่มีจังหวัด (U2.7 · C11)
  async function listDuplicates(found, q, dateLabel, gid, t0){
    found.sort(byCreatedAt);
    const vids = Array.from(new Set(found.map(j => j.vehicleId).filter(v => typeof v === 'string' && DOC_ID_RE.test(v))));
    const vehicles = {};
    await Promise.all(vids.map(v => db.collection('vehicles').doc(v).get()
      .then(s => { if(s.exists) vehicles[v] = s.data() || {}; }, e => log('vehicle-error', { gid, code: errCode(e) }))));
    const lines = ['คิว ' + q + ' ของวันที่ ' + dateLabel + ' มี ' + found.length + ' ใบ'];
    found.forEach((j, i) => {
      const v = vehicles[j.vehicleId] || {};
      lines.push((i + 1) + ') ' + (str(j.jobNumber).trim() || '-') + ' · ' + (str(v.plate).trim() || '-'));
      lines.push('   ' + ((str(v.brand) + ' ' + str(v.model)).trim() || '-') + ' · รับ ' + (fmtThaiTime(j.createdAt) || '-') +
                 ' · ' + (CLOSING[j.status] || 'รอเช็ค'));
    });
    lines.push('คิวนี้ซ้ำ ' + found.length + ' ใบ แก้เลขคิวในแอพให้ไม่ซ้ำแล้วพิมพ์ใหม่');
    return { messages: [textMsg(lines.join('\n'))], info: { found: found.length, result: 'duplicate', ms: nowMs() - t0 } };
  }

  // ---------------------------------------------------------- ใบเดียว: ข้อความเต็ม + ภาพ
  function summarize(prevJob){
    if(!prevJob) return null;
    if(typeof S.summarizeService === 'function') return S.summarizeService(prevJob, S.fmtDateBEBangkok);
    // แบบเดียวกับ lastServiceSummary ของแอป (ใช้เมื่อไฟล์ร่วมไม่ได้ส่ง summarizeService มา)
    const deduct = typeof S.isDeductRow === 'function' ? S.isDeductRow
      : p => !p.promoParent && Number(str(p.price).replace(/[^0-9.-]/g, '')) < 0;
    const items = (prevJob.partsNeeded || []).filter(p => p && !p.promoParent && !deduct(p))
      .map(p => str(p && p.partName).trim()).filter(Boolean);
    const priced = typeof S.jobHasPricedLines === 'function' ? S.jobHasPricedLines(prevJob) : true;
    return { jobNumber: prevJob.jobNumber || '', date: S.fmtDateBEBangkok(prevJob.createdAt), items: items.join(', '),
             price: priced ? S.jobGrandTotal(prevJob) : null };
  }
  function previousRows(rows, job){
    if(typeof S.previousServiceRows === 'function') return S.previousServiceRows(rows, job);
    // เกณฑ์เดียวกับแอป (PM-5): กรองใบที่เก่ากว่าใบนี้และไม่ลบก่อน -> เรียงใหม่ก่อน -> ตัด 20
    const vt = typeof S.usableVisitTime === 'function' ? S.usableVisitTime
      : j => { const x = j && j.createdAt ? Date.parse(j.createdAt) : NaN; return isFinite(x) && x <= Date.now() + 86400000 ? x : NaN; };
    const cutoff = vt(job);
    if(!isFinite(cutoff)) return [];
    return rows.filter(j => j && !j.deletedAt && j.id !== job.id && isFinite(vt(j)) && vt(j) < cutoff)
      .sort((a, b) => vt(b) - vt(a)).slice(0, 20);
  }

  async function fullAnswer(jobId, cmd, gid, t0){
    let job, vehicle, customer, seenBefore, lastService;
    try {
      const js = await db.collection('jobs').doc(jobId).get();
      if(!js.exists) return { messages: [textMsg(T.dbDown)], info: { result: 'db-down' } };
      job = Object.assign({}, js.data() || {}, { id: jobId });
      if(job.queueNo !== undefined && job.queueNo !== null) job.queueNo = String(job.queueNo);   // BR-1 (ข)
      const vid = typeof job.vehicleId === 'string' && DOC_ID_RE.test(job.vehicleId) ? job.vehicleId : null;
      const cid = typeof job.customerId === 'string' && DOC_ID_RE.test(job.customerId) ? job.customerId : null;
      const [vs, cs, hist, cjobs] = await Promise.all([
        vid ? db.collection('vehicles').doc(vid).get() : null,
        cid ? db.collection('customers').doc(cid).get() : null,
        // equality ฟิลด์เดียว ไม่ orderBy / limit (ไม่ต้องมี composite index · BR-2)
        vid ? db.collection('jobs').where('vehicleId', '==', vid).select(...HISTORY_FIELDS).get() : null,
        cid ? db.collection('jobs').where('customerId', '==', cid).select('deletedAt').get() : null
      ]);
      vehicle = vs && vs.exists ? (vs.data() || {}) : {};
      customer = cs && cs.exists ? (cs.data() || {}) : {};
      const rows = hist ? hist.docs.map(d => Object.assign({}, d.data() || {}, { id: d.id })) : [];
      // ลูกค้าเดิม: ใบอื่นของลูกค้าคนนี้ที่ไม่ลบ (กรองในหน่วยความจำ · BR-2 ข) หรือรถคันนี้เคยเข้ามาก่อน
      const repeat = cjobs ? cjobs.docs.some(d => d.id !== jobId && !(d.data() || {}).deletedAt) : false;
      seenBefore = repeat || previousRows(rows, job).length > 0;
      lastService = summarize(S.pickLastService(rows, job));
    } catch(e){
      log('job-read-error', { gid, code: errCode(e) });
      return { messages: [textMsg(T.dbDown)], info: { result: 'db-down' } };
    }

    let main;
    try {
      // ค่าที่ Bot ไม่มี (ช่องที่ช่างพิมพ์ในการ์ด) = ค่าอัตโนมัติเสมอ (ข้อ 7.2.6)
      main = S.formatLineSummary(job, { vehicle, customer, seenBefore, lastService, priceNote: '',
        prevDate: null, prevWork: null, queueFallback: '', fmtDate: S.fmtDateBEBangkok });
    } catch(e){
      log('format-error', { gid, code: errCode(e) });
      return { messages: [textMsg(T.dbDown)], info: { result: 'format-error' } };
    }
    let grand = NaN;
    try { grand = S.jobGrandTotal(typeof S.normalizeJobForSummary === 'function' ? S.normalizeJobForSummary(job) : job); } catch(e){}

    // ภาพ: งบเวลา imageBudgetMs ถ้าไม่ทัน ส่งแค่ข้อความ (C23)
    let timer = null;
    const budget = new Promise(r => { timer = setTimeout(() => r(null), imageBudgetMs); if(timer && timer.unref) timer.unref(); });
    const media = await Promise.race([
      prepareMedia(job, cmd, grand, gid).catch(e => { log('media-error', { gid, code: errCode(e) }); return null; }),
      budget]);
    if(timer) clearTimeout(timer);

    let status, extra = [], info;
    if(!media){
      status = [T.timeout(cmd.typed)];
      info = { found: 1, result: 'text-only-timeout' };
    } else {
      status = media.status; extra = media.messages; info = Object.assign({ found: 1, result: 'full' }, media.info);
    }
    info.ms = nowMs() - t0;
    return { messages: [textMsg(fitText(main, status))].concat(extra).slice(0, 5), info };
  }

  // ---------------------------------------------------------- ภาพที่ปริ้นไว้ + รูปรถ
  async function meta(p){
    try { const r = await bucket.file(p).getMetadata(); return (Array.isArray(r) ? r[0] : r) || {}; }
    catch(e){ return null; }   // หาไม่เจอ = ถือว่ายังไม่ได้ปริ้น / ไฟล์หาย
  }
  // Signed URL V4 อ่านอย่างเดียว อายุ 24 ชม. (ห้ามใช้ download token URL · ข้อ 6.5) · URL ห้ามลง log
  async function sign(p){
    try {
      const r = await bucket.file(p).getSignedUrl({ version: 'v4', action: 'read', expires: nowMs() + SIGNED_URL_TTL_MS });
      const u = Array.isArray(r) ? r[0] : r;
      return typeof u === 'string' && u.indexOf('https://') === 0 && u.length <= MAX_URL_LEN ? u : null;
    } catch(e){ log('sign-error', { code: errCode(e) }); return null; }
  }
  const imageMsg = u => ({ type: 'image', originalContentUrl: u, previewImageUrl: u });
  // ของ @google-cloud/storage: customMetadata ของ Firebase อยู่ที่ metadata.metadata
  const customMeta = m => (m && (m.metadata || m.customMetadata)) || {};

  async function prepareMedia(job, cmd, grand, gid){
    const jobId = job.id;
    if(!DOC_ID_RE.test(jobId)){
      return { status: ['※ ยังไม่ได้ปริ้นใบเสนอราคา', '※ ยังไม่ได้ปริ้นใบรับรถ', '※ ใบนี้ไม่มีรูปรถ'], messages: [], info: {} };
    }
    const base = 'jobPrints/' + jobId + '/';
    const [quote, receipt, photos] = await Promise.all([prepareQuote(base, grand), prepareReceipt(base), preparePhotos(job, cmd, gid)]);
    // ลำดับ message (U3): ใบเสนอราคาหน้า 1 -> หน้า 2 -> ใบรับรถ -> อัลบั้มรูปรถ · ลำดับบรรทัด ※ ตาม U2.5
    return { status: quote.status.concat(receipt.status, photos.status),
             messages: quote.messages.concat(receipt.messages, photos.messages),
             info: { quote: quote.result, receipt: receipt.result, photos: photos.result } };
  }

  async function prepareQuote(base, grand){
    const m1 = await meta(base + 'quote-1.jpg');
    if(!m1) return { status: ['※ ยังไม่ได้ปริ้นใบเสนอราคา'], messages: [], result: 'none' };
    const cm = customMeta(m1);
    const printId = str(cm.printId);
    const pages = Math.max(1, parseInt(cm.pages, 10) || 1);
    const u1 = await sign(base + 'quote-1.jpg');
    if(!u1) return { status: ['※ ยังไม่ได้ปริ้นใบเสนอราคา'], messages: [], result: 'sign-failed' };
    const status = [], messages = [imageMsg(u1)];
    const printed = Number(cm.grandTotal);
    if(str(cm.grandTotal) !== '' && isFinite(printed) && isFinite(grand) && Math.abs(printed - grand) > 0.005){
      status.push('※ รูปใบเสนอราคาปริ้นไว้ ' + (fmtThaiDateTime(cm.printedAt) || '-') + '\nยอดตอนนี้ไม่ตรงกับในรูป ให้ยึดยอดในข้อความนี้');
    }
    let result = 'p1';
    if(pages >= 2){
      // ส่งหน้า 2 เฉพาะเมื่อ printId ตรงกับหน้า 1 (กันหน้าเก่าค้าง / อัปได้ครึ่งเดียว · C14)
      const m2 = await meta(base + 'quote-2.jpg');
      const u2 = m2 && printId && str(customMeta(m2).printId) === printId ? await sign(base + 'quote-2.jpg') : null;
      if(u2){
        messages.push(imageMsg(u2)); result = 'p2';
        if(pages > 2) status.push('※ ใบเสนอราคามี ' + pages + ' หน้า ส่ง 2 หน้าแรก ที่เหลือดูในแอพ');
      } else {
        status.push('※ ใบเสนอราคาส่งได้แค่หน้า 1 ที่เหลือดูในแอพ');
      }
    }
    return { status, messages, result };
  }

  async function prepareReceipt(base){
    const m = await meta(base + 'receipt.jpg');
    const u = m ? await sign(base + 'receipt.jpg') : null;
    if(!u) return { status: ['※ ยังไม่ได้ปริ้นใบรับรถ'], messages: [], result: 'none' };
    return { status: [], messages: [imageMsg(u)], result: 'ok' };
  }

  async function preparePhotos(job, cmd, gid){
    let rows;
    try {
      const s = await db.collection('jobPhotos').where('jobId', '==', job.id).get();   // ไม่ orderBy (BR-2) เรียงเอง
      rows = s.docs.map(d => Object.assign({}, d.data() || {}, { __id: d.id }));
    } catch(e){
      log('photos-error', { gid, code: errCode(e) });
      return { status: ['※ โหลดรูปรถไม่ได้ ลองพิมพ์ ' + cmd.typed + ' ใหม่'], messages: [], result: 'query-failed' };
    }
    const total = rows.length;
    if(!total) return { status: ['※ ใบนี้ไม่มีรูปรถ'], messages: [], result: 'none' };
    // ลำดับเดียวกับแกลเลอรี (createdAt น้อยไปมาก) · ใช้ path เท่านั้น ห้ามใช้ url ในเอกสาร (C18)
    rows.sort(byCreatedAt);
    const cand = rows.slice(0, MAX_PHOTO_ROWS_CHECKED).map(r => safePhotoPath(r.path, job.id));
    const ok = await Promise.all(cand.map(p => p ? meta(p).then(m => !!m) : false));
    const good = cand.filter((p, i) => p && ok[i]);
    const urls = [];
    for(const p of good.slice(0, MAX_PHOTOS)){ const u = await sign(p); if(u) urls.push(u); }
    const unchecked = total - cand.length;
    const bad = (cand.length - good.length) + (Math.min(good.length, MAX_PHOTOS) - urls.length);
    if(!urls.length){
      return { status: ['※ รูปรถส่งไม่ได้ทั้ง ' + total + ' รูป (รูปเก่าหรือไฟล์หาย)'], messages: [], result: 'all-failed' };
    }
    const status = [];
    if(good.length + unchecked > MAX_PHOTOS) status.push('※ รูปรถ ' + urls.length + ' จาก ' + total + ' รูป ที่เหลือดูในแอพ');
    if(bad > 0) status.push('※ รูปรถส่งไม่ได้ ' + bad + ' รูป (รูปเก่าหรือไฟล์หาย)');
    const n = urls.length;
    // Flex: ไม่กำหนดสี (ตามธีม LINE) · ไม่มีข้อมูลลูกค้าใน uri / action / altText (S10 · U3)
    const bubbles = urls.map((u, i) => {
      const hero = { type: 'image', url: u, size: 'full', aspectRatio: '4:3', aspectMode: 'cover' };
      if(u.length <= MAX_FLEX_URI_LEN) hero.action = { type: 'uri', uri: u };
      return { type: 'bubble', size: 'kilo', hero,
        body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'รูป ' + (i + 1) + '/' + n, size: 'xs' }] } };
    });
    const flex = { type: 'flex', altText: 'รูปรถคิว ' + cmd.queue + ' (' + n + ' รูป)',
                   contents: { type: 'carousel', contents: bubbles } };
    return { status, messages: [flex], result: n + '/' + total };
  }

  // ---------------------------------------------------------- ความยาวข้อความ (C29)
  // เกิน 5000: ตัดรายการเสนอราคาช่วงท้าย ใส่บรรทัดบอกจำนวนที่ตัด เก็บบล็อกยอด บรรทัดปิด และบรรทัด ※ ไว้ครบ
  function fitText(main, status){
    const tail = status.length ? '\n\n' + status.join('\n') : '';
    if(main.length + tail.length <= MAX_TEXT_LEN) return main + tail;
    const lines = main.split('\n');
    const head = lines.indexOf('รายการเสนอราคา');
    if(head >= 0){
      let end = head + 1;
      while(end < lines.length && lines[end].indexOf('- ') === 0) end++;
      const items = lines.slice(head + 1, end), before = lines.slice(0, head + 1), after = lines.slice(end);
      for(let keep = items.length - 1; keep >= 0; keep--){
        const marker = '- ...อีก ' + (items.length - keep) + ' รายการ (รายการเต็มดูในแอพ)';
        const t = before.concat(items.slice(0, keep), [marker], after).join('\n');
        if(t.length + tail.length <= MAX_TEXT_LEN) return t + tail;
      }
    }
    return main.slice(0, Math.max(0, MAX_TEXT_LEN - tail.length - 1)) + '…' + tail;
  }

  // ---------------------------------------------------------- ตัว handler
  return async function lineWebhook(req, res){
    if(!req || req.method !== 'POST'){ sendStatus(res, 405); return; }
    const sig = headerOf(req, 'x-line-signature');
    if(typeof sig !== 'string' || !sig){ sendStatus(res, 401); return; }
    const raw = req.rawBody;
    if(!raw || !raw.length){ sendStatus(res, 400); return; }
    let secret = '';
    try { secret = deps.channelSecret(); } catch(e){ secret = ''; }
    if(!verifySignature(raw, sig, secret)){ log('bad-signature', {}); sendStatus(res, 401); return; }
    let body;
    try { body = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); } catch(e){ sendStatus(res, 400); return; }
    const events = body && Array.isArray(body.events) ? body.events : null;
    if(!events){ sendStatus(res, 400); return; }
    for(const ev of events.slice(0, 50)){
      try {
        if(!ev || typeof ev !== 'object') continue;
        // ทิ้ง event ที่เก่ากว่า 5 นาที (หรือมาจากอนาคตเกิน 5 นาที) — กัน replay (S3 ค)
        const ts = Number(ev.timestamp), t = nowMs();
        if(!isFinite(ts) || t - ts > EVENT_MAX_AGE_MS || ts - t > EVENT_MAX_AGE_MS){ log('stale-event', {}); continue; }
        if(ev.type === 'join'){
          if(!(await claimEvent(ev))) continue;
          await onJoin(ev);
        } else if(ev.type === 'message'){
          await onMessage(ev);
        }
      } catch(e){
        log('event-error', { code: errCode(e) });
      }
    }
    sendStatus(res, 200);
  };
}

module.exports = { createHandler, CLOSING, SIGNED_URL_TTL_MS, IMAGE_BUDGET_MS };
