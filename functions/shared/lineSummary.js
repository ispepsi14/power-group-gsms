/* GENERATED — แก้ที่ public/index.html เท่านั้น (บล็อก LINE-SHARED + ฟังก์ชันเดิมตามรายชื่อใน scripts/extract-line-shared.js)
   สร้างใหม่: node scripts/extract-line-shared.js · ห้ามแก้ไฟล์นี้ด้วยมือ (tests/line-bot-shared.guard.js X5 จับ drift)
   วันที่ทุกตัวในฝั่ง function ให้ส่ง fmtDate: fmtDateBEBangkok (เวลาไทย ไม่พึ่ง timezone ของเครื่อง) */

// ---- const THAI_DIGITS
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

// ---- const LAST_SERVICE_DONE_STATUSES
const LAST_SERVICE_DONE_STATUSES = ['delivered', 'ready'];

// ---- const VEHICLE_HISTORY_ROWS
const VEHICLE_HISTORY_ROWS = 20;                // ใบต่อคันที่เก็บพอ (ใหม่สุดก่อน)

// ---- function normalizeDigits
function normalizeDigits(s){
  return String(s).replace(/[๐-๙]/g, ch => String(THAI_DIGITS.indexOf(ch)));
}

// ---- function parseMoney
function parseMoney(v){
  if(typeof v === 'number') return isFinite(v) ? v : 0;
  const s = normalizeDigits(v == null ? '' : v).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// ---- function parseLinePrice
function parseLinePrice(v){
  const n = parseMoney(v);
  return isFinite(n) ? n : 0;
}

// ---- function isDeductRow
function isDeductRow(p){
  // บรรทัดลูกของชุดโปรไม่เข้ายอดรวมอยู่แล้ว ติดป้าย "หักออก" ไปก็ผิด — ใบที่ลูกค้า
  // เซ็นจะบอกว่าหักเงินให้ ทั้งที่ช่องจำนวนเงินขึ้นว่า "อยู่ในรายการโปร"
  if(!p || p.promoParent) return false;
  return parseLinePrice(p.price) < 0;
}

// ---- function parseQty
function parseQty(v){
  const n = parseMoney(v);
  return n > 0 ? n : 1;
}

// ---- function jobPartsTotal
function jobPartsTotal(job){
  return (job.partsNeeded || []).reduce((sum, p) => {
    // รายการในชุดโปร คิดเงินรวมไปในราคาชุดแล้ว ไม่นับซ้ำ
    if(p.promoParent) return sum;
    // v4.3.6 — ราคาติดลบ = บรรทัดหักลบ (เทิร์นของเก่า) หักออกจากยอดจริง
    const price = parseLinePrice(p.price);
    if(!price) return sum;
    return sum + price * parseQty(p.qty);
  }, 0);
}

// ---- function jobDiscountAmount
function jobDiscountAmount(job){
  const subtotal = jobPartsTotal(job);
  const val = Number(job.discountValue) || 0;
  if(val <= 0 || subtotal <= 0) return 0;
  const raw = job.discountType === 'percent' ? subtotal * (val / 100) : val;
  return Math.min(subtotal, Math.max(0, raw));
}

// ---- function jobGrandTotal
function jobGrandTotal(job){
  return Math.max(0, jobPartsTotal(job) - jobDiscountAmount(job));
}

// ---- function isPromoChild
function isPromoChild(p){ return !!(p && p.promoParent); }

// ---- function jobHasPricedLines
function jobHasPricedLines(job){
  return (job && job.partsNeeded || []).some(p => p && !p.promoParent && parseLinePrice(p.price));
}

// ---- function usableVisitTime
function usableVisitTime(j){
  if(!j || !j.createdAt) return NaN;
  const t = new Date(j.createdAt).getTime();
  if(!isFinite(t)) return NaN;
  /* ใบที่ลงวันที่ไว้ในอนาคต = ข้อมูลเสีย ไม่ใช่การเข้าจริง ที่พบได้คือข้อมูลเก่าที่
     เผลอคีย์ปี พ.ศ. ลงไป ("2569-03-03" parse ผ่าน แล้วไปโผล่อีก 543 ปีข้างหน้า)
     ถ้าปล่อยผ่าน ตัวเทียบ t < cutoff จะตัดใบนั้นทิ้งเงียบ ๆ แล้วข้ามไปหยิบใบที่เก่ากว่า
     หรือไม่เจออะไรเลย — ซึ่งเป็นกับดักของฟีเจอร์นี้โดยเฉพาะ เพราะของที่เราตั้งใจไป
     ขุดมาคือใบเก่าที่สุด ซึ่งก็คือใบที่มีโอกาสเป็นข้อมูลนำเข้ามากที่สุด
     เผื่อ 1 วันไว้กันนาฬิกาเครื่องเร็วเล็กน้อย (ดูข้อ Q7 เรื่องนาฬิกาเพี้ยน) */
  if(t > Date.now() + 86400000) return NaN;
  return t;
}

// ---- function fmtMoney
function fmtMoney(n){
  const num = Number(n) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---- function sameQueueNo
function sameQueueNo(a, b){
  const A = String(a == null ? '' : a).trim();
  const B = String(b == null ? '' : b).trim();
  if(!A || !B) return false;
  if(A.toLowerCase() === B.toLowerCase()) return true;
  // Only pure numbers get the numeric comparison — a shop that prefixes its
  // queues ("A17") means something different by A17 than by 17, and stripping the
  // letter would hand a customer the wrong car.
  if(/^\d+$/.test(A) && /^\d+$/.test(B)) return Number(A) === Number(B);   // 017 === 17
  return false;
}

// ---- LINE-SHARED block
/* LINE-SHARED:BEGIN */
/* v4.6.7 — formatter ร่วมระหว่างแอพกับ LINE Bot (spec line-bot-queue-command ข้อ 7.2 · BR-6)
   บล็อกนี้ถูกคัดออกไปเป็น functions/shared/lineSummary.js ด้วย scripts/extract-line-shared.js
   พร้อมฟังก์ชันเดิมตามรายชื่อในสคริปต์นั้น (parseMoney / jobGrandTotal / fmtMoney / usableVisitTime ฯลฯ)
   กติกา: ตรรกะล้วนเท่านั้น ห้ามอ้างตัวแปรของหน้าแอพ (ค่าของเครื่อง / DOM / ฐานข้อมูล) — ค่าทุกตัวต้องรับผ่านพารามิเตอร์
   ถ้าเผลออ้าง ตัวคัดจะล้มทันที (ตรวจตัวเองใน vm เปล่า) และเทสต์ line-bot-shared.guard ตก
   แก้ที่นี่แล้วต้องรัน node scripts/extract-line-shared.js ใหม่ทุกครั้ง (guard X5 จับ drift) */

// วันที่ d/m/yy พ.ศ. ตามเวลาไทย ไม่พึ่ง timezone ของเครื่อง (Cloud Functions เป็น UTC)
// ไทยไม่มี DST จึงบวก 7 ชั่วโมงแล้วอ่านแบบ UTC ได้ตรงทุกวัน
function fmtDateBEBangkok(iso){
  const t = iso ? new Date(iso).getTime() : Date.now();
  const d = new Date(t + 7 * 3600 * 1000);
  return `${d.getUTCDate()}/${d.getUTCMonth()+1}/${String(d.getUTCFullYear() + 543).slice(-2)}`;
}

// สำเนาใบงานที่มีฟิลด์ครบพอให้ formatter อ่าน (แบบ ensureJobFields เฉพาะส่วนที่ข้อความใช้)
// ไม่แก้ object ต้นฉบับ — ใบที่ Bot ดึงตรงจากฐาน (นอก 600 ใบ) อาจไม่เคยผ่าน ensureJobFields
function normalizeJobForSummary(job){
  const j = Object.assign({}, job || {});
  if(!Array.isArray(j.complaints)){
    j.complaints = (j.complaint && String(j.complaint).trim())
      ? [{ text: String(j.complaint).trim() }] : [];
  }
  if(!Array.isArray(j.partsNeeded)) j.partsNeeded = [];
  if(j.discountType === undefined) j.discountType = 'amount';
  if(j.discountValue === undefined) j.discountValue = 0;
  return j;
}

// ใบเก่าของรถคันนี้ที่รับเข้า "ก่อน" ใบนี้ ใหม่สุดก่อน: กรองใบที่ไม่ลบ / ไม่ใช่ใบนี้ / วันที่อ่านออกและเก่ากว่าใบนี้
// → เรียงใหม่สุดก่อน → แล้วค่อยตัดเหลือ VEHICLE_HISTORY_ROWS ใบ (ตัดหลังกรอง — ถ้าตัดก่อน รถที่เข้ามาเกิน 20 ครั้ง
// ถามใบเก่าแล้วหา "ครั้งก่อน" ไม่เจอ ซึ่งต่างจาก 4.6.6 · QA round 1)
function previousServiceRows(rows, job){
  if(!job) return [];
  const cutoff = usableVisitTime(job);
  if(!isFinite(cutoff)) return [];
  return (rows || [])
    .filter(j => {
      if(!j || j.deletedAt || j.id === job.id) return false;
      const t = usableVisitTime(j);
      return isFinite(t) && t < cutoff;
    })
    .sort((a, b) => usableVisitTime(b) - usableVisitTime(a))
    .slice(0, VEHICLE_HISTORY_ROWS);
}

// ใบ "ครั้งก่อน" = ใบแรกที่ทำเสร็จแล้วใน previousServiceRows · ทั้งแอพและ Bot เรียกตัวนี้
function pickLastService(rows, job){
  if(!job || !job.vehicleId) return null;
  return previousServiceRows(rows, job)
    .find(j => LAST_SERVICE_DONE_STATUSES.indexOf(j.status) >= 0) || null;
}

/* สรุปใบครั้งก่อน: วันที่ / รายการ / ยอดที่เก็บจริง
   ราคาต้องเป็น "ยอดที่เก็บไปจริง" เท่านั้น — ใบที่ไม่มีรายการที่คีย์ราคา = ไม่รู้ว่าเก็บเท่าไร → null
   (ห้ามถอยไปใช้ priceEstimate ซึ่งเป็นเลขที่เดาไว้ตอนรับรถ ไม่ใช่เงินที่ลูกค้าจ่าย) */
function summarizeService(prev, fmtDate){
  const items = (prev.partsNeeded || [])
    .filter(p => p && !p.promoParent && !isDeductRow(p))
    .map(p => String((p && p.partName) || '').trim())
    .filter(Boolean);
  const billed = jobHasPricedLines(prev) ? jobGrandTotal(prev) : null;
  return {
    jobNumber: prev.jobNumber || '',
    date: fmtDate(prev.createdAt),
    items: items.join(', '),
    price: billed
  };
}

/* ข้อความสรุปใบงานสำหรับกลุ่มไลน์ — แหล่งเดียวของรูปแบบข้อความ (การ์ดในแอพ + ปุ่ม 4.6.6 + Bot)
   ctx = { vehicle, customer, seenBefore, lastService, priceNote, prevDate, prevWork, queueFallback, fmtDate }
     lastService   สรุปใบครั้งก่อน { jobNumber, date, items, price } จาก summarizeService(pickLastService(...)) หรือ null
     prevDate/prevWork  ค่าที่ช่างพิมพ์ทับในการ์ด · null/undefined = ใช้ค่าอัตโนมัติจาก lastService
     queueFallback ใช้เมื่อใบงานไม่มีเลขคิว · fmtDate แอพส่ง fmtDateBE / Bot ส่ง fmtDateBEBangkok */
function formatLineSummary(job, ctx){
  const o = ctx || {};
  const j = normalizeJobForSummary(job);
  const fmtDate = typeof o.fmtDate === 'function' ? o.fmtDate : fmtDateBEBangkok;
  const v = o.vehicle || {};
  const c = o.customer || {};
  const q = String(j.queueNo ? j.queueNo : (o.queueFallback || '')).trim();
  const lines = [];
  lines.push(`คิวที่${q ? ' ('+q+')' : ''} ${fmtDate(j.createdAt)}`);
  lines.push(`คุณ${c.name || '-'}${o.seenBefore ? ' (ลูกค้าเดิม)' : ''}`);
  lines.push(c.phone || '-');
  lines.push(`${v.plate || '-'}${v.province || ''}`);
  lines.push(`${v.brand || ''} ${v.model || ''}`.trim() || '-');
  lines.push(v.color || '-');
  const svc = o.lastService || null;
  const typedDate = o.prevDate !== null && o.prevDate !== undefined;
  const typedWork = o.prevWork !== null && o.prevWork !== undefined;
  const prevDate = (typedDate ? String(o.prevDate) : (svc ? svc.date : '')).trim();
  const prevWork = (typedWork ? String(o.prevWork) : (svc ? svc.items : '')).trim();
  if(prevDate || prevWork){
    if(prevDate) lines.push(`เข้าทำ ${prevDate}`);
    if(prevWork) lines.push(`- ${prevWork}`);
    // ราคาผูกกับ "ใบที่ระบบหยิบมา" ตัวตัดสินคือช่องวันที่ช่องเดียว (ช่างพิมพ์ทับวันที่ = ไม่ใช่ใบนั้นแล้ว)
    const pv = (!typedDate && svc && svc.price !== null) ? svc.price : null;
    if(pv !== null){
      // 0 บาทต้องพูดเป็นคำ ไม่ใช่ "ค่าซ่อมครั้งก่อน 0.00 บาท" ซึ่งอ่านเหมือนข้อมูลหาย
      lines.push(pv > 0 ? `- ค่าซ่อมครั้งก่อน ${fmtMoney(pv)} บาท`
                        : `- ครั้งก่อนไม่มียอดเรียกเก็บ`);
    }
  }
  lines.push('อาการ');
  if(j.complaints.length === 0){
    lines.push('- ไม่มีข้อมูล');
  } else {
    j.complaints.forEach(cp => lines.push(`- ${cp.text}`));
  }
  const parts = j.partsNeeded || [];
  if(parts.length > 0){
    lines.push('');
    lines.push('รายการเสนอราคา');
    parts.forEach(p => {
      const qty = parseQty(p.qty);
      const price = parseMoney(p.price);
      const qtyTxt = p.qty ? ` ${p.qty} ${p.unit || ''}`.trimEnd() : '';
      const brandTxt = p.brand ? ` (${p.brand})` : '';
      // ลูกชุดโปรคิดเงินรวมในราคาชุดแล้ว (ใบพิมพ์เขียน "อยู่ในรายการโปร") ห้ามโชว์ราคาค้าง
      const priceTxt = price && !isPromoChild(p) ? ` = ${fmtMoney(price * qty)}` : '';
      lines.push(`- ${p.partName}${p.variant ? ' ('+p.variant+')' : ''}${qtyTxt}${brandTxt}${priceTxt}`);
    });
    // ตัดสินด้วย "มีรายการที่คีย์ราคาแล้ว" ไม่ใช่ยอดรวม > 0 (บรรทัดหักลบทำยอดติดลบได้ · v4.3.7)
    const total = jobPartsTotal(j);
    if(jobHasPricedLines(j)){
      const discountAmt = jobDiscountAmount(j);
      if(discountAmt > 0){
        lines.push(`รวม ${fmtMoney(total)} บาท`);
        lines.push(`ส่วนลด ${j.discountType === 'percent' ? j.discountValue+'%' : fmtMoney(discountAmt)+' บาท'}`);
        lines.push(`ยอดสุทธิ ${fmtMoney(jobGrandTotal(j))} บาท`);
      } else {
        lines.push(`รวม ${fmtMoney(total)} บาท`);
      }
    }
  } else if(Number(j.priceEstimate) > 0){
    lines.push('');
    lines.push(`ราคาประมาณ ${fmtMoney(Number(j.priceEstimate))} บาท`);
  }

  const note = String(o.priceNote || '').trim();
  if(note) lines.push(`(${note})`);

  // บรรทัดปิดบอกว่างานอยู่ขั้นไหน
  const CLOSING = {
    received:  'รอเช็ค',
    inspecting:'รอเช็ค',
    quoted:    'รอลูกค้าตัดสินใจ',
    approved:  'อนุมัติ',
    scheduled: 'นัดวันมาทำ',
    rejected:  'ไม่อนุมัติ',
    repairing: 'กำลังซ่อม',
    aligning:  'รอตั้งศูนย์',
    ready:     'พร้อมส่ง',
    delivered: 'ส่งแล้ว',
    carout:    'เอารถลง'
  };
  lines.push(CLOSING[j.status] || 'รอเช็ค');
  return lines.join('\n');
}
/* LINE-SHARED:END */

module.exports = {
  formatLineSummary,
  normalizeJobForSummary,
  pickLastService,
  previousServiceRows,
  summarizeService,
  fmtDateBEBangkok,
  parseMoney,
  parseLinePrice,
  parseQty,
  isDeductRow,
  isPromoChild,
  jobPartsTotal,
  jobDiscountAmount,
  jobGrandTotal,
  jobHasPricedLines,
  usableVisitTime,
  fmtMoney,
  sameQueueNo,
  LAST_SERVICE_DONE_STATUSES,
  VEHICLE_HISTORY_ROWS
};
