#!/usr/bin/env node
// extract-line-shared — คัดโค้ดข้อความสรุปใบงานจาก public/index.html ไปเป็น functions/shared/lineSummary.js
// (spec docs/specs/line-bot-queue-command.md ข้อ 7.2 + BR-6 · Node ล้วน ไม่มี dependency)
//
//   node scripts/extract-line-shared.js            เขียน functions/shared/lineSummary.js (exit 1 เมื่อผิด)
//   node scripts/extract-line-shared.js --check    ไม่เขียน แค่เทียบกับไฟล์ที่มีอยู่ (exit 1 ถ้าไม่ตรง)
//   require('./scripts/extract-line-shared.js').extractLineShared(htmlSource) -> เนื้อหาไฟล์ (string)
//
// สิ่งที่คัด
//   (ก) บล็อก /* LINE-SHARED:BEGIN */ ... /* LINE-SHARED:END */ ในสคริปต์หลักทั้งก้อน
//   (ข) ฟังก์ชันเดิมตามรายชื่อ SHARED_FUNCTIONS: บรรทัดที่ขึ้นต้น "function <ชื่อ>(" ที่คอลัมน์ 0
//       ไปจนถึง "}" ที่คอลัมน์ 0 ตัวแรก (หรือบรรทัดเดียวถ้าปิดวงเล็บในบรรทัดนั้น)
//   (ค) ค่าคงที่บรรทัดเดียวตามรายชื่อ SHARED_CONSTS ("const <ชื่อ> = ...;" ที่คอลัมน์ 0)
// ตรวจตัวเอง (ล้ม = throw / exit 1 ไม่เขียนไฟล์)
//   - ไม่เจอ marker / เจอมากกว่า 1 ชุด / ไม่เจอฟังก์ชันหรือค่าคงที่ตามชื่อ
//   - ทุกชิ้น parse ผ่าน new vm.Script()
//   - ซอร์สที่คัด (ตัดคอมเมนต์แล้ว) อ้าง view / state / document / window / localStorage / db
//   - ผลลัพธ์ต้องรันใน vm context เปล่าได้ แล้วเรียกฟังก์ชันหลักกับใบตัวอย่างได้โดยไม่ ReferenceError
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const BEGIN = '/* LINE-SHARED:BEGIN */', END = '/* LINE-SHARED:END */';
// ฟังก์ชันเดิมที่บล็อกร่วมเรียก (ห้ามย้ายออกจากที่เดิมใน index.html — BR-6)
const SHARED_FUNCTIONS = [
  'normalizeDigits', 'parseMoney', 'parseLinePrice', 'isDeductRow', 'parseQty',
  'jobPartsTotal', 'jobDiscountAmount', 'jobGrandTotal', 'isPromoChild', 'jobHasPricedLines',
  'usableVisitTime', 'fmtMoney', 'sameQueueNo'
];
const SHARED_CONSTS = ['THAI_DIGITS', 'LAST_SERVICE_DONE_STATUSES', 'VEHICLE_HISTORY_ROWS'];
const EXPORTS = [
  'formatLineSummary', 'normalizeJobForSummary', 'pickLastService', 'previousServiceRows', 'summarizeService', 'fmtDateBEBangkok',
  'parseMoney', 'parseLinePrice', 'parseQty', 'isDeductRow', 'isPromoChild',
  'jobPartsTotal', 'jobDiscountAmount', 'jobGrandTotal', 'jobHasPricedLines', 'usableVisitTime', 'fmtMoney', 'sameQueueNo',
  'LAST_SERVICE_DONE_STATUSES', 'VEHICLE_HISTORY_ROWS'
];
const FORBIDDEN = /\b(view|state|document|window|localStorage|db)\s*[.[]/g;

function fail(msg){ throw new Error('extract-line-shared: ' + msg); }

// สคริปต์หลัก = ระหว่างบรรทัด "<script>" เป๊ะ ๆ ตัวสุดท้าย กับ "</script>" เป๊ะ ๆ ตัวสุดท้าย
function mainScriptLines(html){
  const lines = String(html).split(/\r?\n/);
  let s = -1, e = -1;
  lines.forEach((l, i) => { if(l === '<script>') s = i; if(l === '</script>') e = i; });
  if(s < 0 || e <= s) fail('ไม่พบสคริปต์หลัก (<script> / </script> บรรทัดสุดท้าย)');
  return lines.slice(s + 1, e);
}

function stripComments(code){
  // ตัดคอมเมนต์ออกก่อนตรวจคำต้องห้าม (สตริงในโค้ดชุดนี้ไม่มี // หรือ /* ปนอยู่)
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function takeFunction(lines, name){
  const head = 'function ' + name + '(';
  const starts = [];
  lines.forEach((l, i) => { if(l.indexOf(head) === 0) starts.push(i); });
  if(starts.length !== 1) fail('ต้องเจอ "' + head + '" ที่คอลัมน์ 0 หนึ่งครั้ง (เจอ ' + starts.length + ')');
  const s = starts[0];
  const first = lines[s];
  const open = (first.match(/\{/g) || []).length, close = (first.match(/\}/g) || []).length;
  if(open > 0 && open === close && /\}\s*$/.test(first)) return first;   // ฟังก์ชันบรรทัดเดียว
  for(let i = s + 1; i < lines.length; i++){
    if(/^\}/.test(lines[i])) return lines.slice(s, i + 1).join('\n');
  }
  fail('หา "}" ปิดของ function ' + name + ' ไม่เจอ');
}

function takeConst(lines, name){
  const re = new RegExp('^const ' + name + '\\s*=');
  const hit = lines.filter(l => re.test(l));
  if(hit.length !== 1) fail('ต้องเจอ "const ' + name + ' =" ที่คอลัมน์ 0 หนึ่งครั้ง (เจอ ' + hit.length + ')');
  if(!/;\s*(\/\/.*)?$/.test(hit[0])) fail('const ' + name + ' ต้องจบในบรรทัดเดียว');
  return hit[0];
}

function selfTest(code){
  const sandbox = { module: { exports: {} }, console: { log(){}, warn(){}, error(){} } };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);   // ไม่มี window / document / state / view / db / require
  vm.runInContext(code, sandbox, { filename: 'lineSummary.js' });
  const m = sandbox.module.exports;
  EXPORTS.forEach(k => { if(m[k] === undefined) fail('ไม่มี export ' + k); });
  const sig = 'data:image/png;base64,AAAA';
  const prev = { id: 'p', vehicleId: 'v', status: 'delivered', jobNumber: 'J-P', createdAt: '2026-01-01T03:00:00.000Z',
    partsNeeded: [ { partName: 'ก', qty: '1', price: '100' }, { partName: 'ข', qty: '1', price: '-50' } ] };
  const job = { id: 'j', vehicleId: 'v', customerId: 'c', status: 'quoted', queueNo: '4', jobNumber: 'J-1',
    createdAt: '2026-10-21T18:00:00.000Z', complaint: 'เสียงดัง', discountType: 'percent', discountValue: 10,
    signatures: { inspector: sig },
    partsNeeded: [ { partName: 'ชุดโปร', qty: '1', unit: 'ชุด', price: '1000', promoId: 'x' },
                   { partName: 'ลูก', qty: '2', price: '๙๐', promoParent: 'x' },
                   { partName: 'แร็ค', variant: 'L+R', qty: '1', unit: 'ตัว', brand: 'OEM', price: '5,000 บาท' },
                   { partName: 'เทิร์น', qty: '1', price: '-500' } ] };
  const lastRow = m.pickLastService([prev, job], job);
  if(!lastRow || lastRow.id !== 'p') fail('pickLastService ให้ผลผิด');
  const last = m.summarizeService(lastRow, m.fmtDateBEBangkok);
  const ctx = { vehicle: { plate: '1กข', province: 'กทม', brand: 'TOYOTA', model: 'VIOS', color: 'ขาว' },
                customer: { name: 'ทดสอบ', phone: '0' }, seenBefore: true, lastService: last,
                priceNote: 'x', prevDate: null, prevWork: null, queueFallback: '', fmtDate: m.fmtDateBEBangkok };
  const text = m.formatLineSummary(job, ctx);
  if(typeof text !== 'string' || text.indexOf('คิวที่ (4) 22/10/69') !== 0) fail('formatLineSummary ให้ผลผิด: ' + String(text).slice(0, 60));
  m.formatLineSummary(Object.assign({}, job, { partsNeeded: [], priceEstimate: 300 }), {});
  [m.jobGrandTotal, m.jobPartsTotal, m.jobDiscountAmount, m.jobHasPricedLines].forEach(f => f(job));
  m.previousServiceRows([prev, job], job);
  if(!m.sameQueueNo('04', 4) || m.sameQueueNo('A4', '4')) fail('sameQueueNo ให้ผลผิด');
  m.fmtMoney(1234.5); m.usableVisitTime(job); m.normalizeJobForSummary(job);
  m.parseMoney('๑,๒๐๐'); m.parseLinePrice('-1'); m.parseQty('0'); m.isDeductRow(job.partsNeeded[3]); m.isPromoChild(job.partsNeeded[1]);
}

function extractLineShared(html){
  const lines = mainScriptLines(html);
  const main = lines.join('\n');
  const a = main.indexOf(BEGIN), b = main.indexOf(END);
  if(a < 0 || b < 0) fail('ไม่พบ marker ' + (a < 0 ? BEGIN : END));
  if(main.indexOf(BEGIN, a + 1) >= 0 || main.indexOf(END, b + 1) >= 0) fail('marker ซ้ำ');
  if(b < a) fail('marker เรียงผิด');
  const block = main.slice(a, b + END.length);

  const pieces = [];
  SHARED_CONSTS.forEach(n => pieces.push({ name: 'const ' + n, code: takeConst(lines, n) }));
  SHARED_FUNCTIONS.forEach(n => pieces.push({ name: 'function ' + n, code: takeFunction(lines, n) }));
  pieces.push({ name: 'LINE-SHARED block', code: block });

  pieces.forEach(p => {
    try { new vm.Script(p.code, { filename: p.name }); } catch(e){ fail(p.name + ' parse ไม่ผ่าน: ' + e.message); }
    const bad = stripComments(p.code).match(FORBIDDEN);
    if(bad) fail(p.name + ' อ้างของหน้าแอพ: ' + Array.from(new Set(bad)).join(', '));
  });

  const out = [
    '/* GENERATED — แก้ที่ public/index.html เท่านั้น (บล็อก LINE-SHARED + ฟังก์ชันเดิมตามรายชื่อใน scripts/extract-line-shared.js)',
    '   สร้างใหม่: node scripts/extract-line-shared.js · ห้ามแก้ไฟล์นี้ด้วยมือ (tests/line-bot-shared.guard.js X5 จับ drift)',
    '   วันที่ทุกตัวในฝั่ง function ให้ส่ง fmtDate: fmtDateBEBangkok (เวลาไทย ไม่พึ่ง timezone ของเครื่อง) */',
    ''
  ];
  pieces.forEach(p => { out.push('// ---- ' + p.name); out.push(p.code); out.push(''); });
  out.push('module.exports = {');
  out.push(EXPORTS.map(k => '  ' + k).join(',\n'));
  out.push('};');
  const code = out.join('\n') + '\n';
  try { selfTest(code); } catch(e){ fail('ตรวจใน vm เปล่าไม่ผ่าน: ' + (e && e.message || e)); }
  return code;
}

module.exports = { extractLineShared };

if(require.main === module){
  const root = path.join(__dirname, '..');
  const src = path.join(root, 'public', 'index.html');
  const dst = path.join(root, 'functions', 'shared', 'lineSummary.js');
  try {
    const code = extractLineShared(fs.readFileSync(src, 'utf8'));
    if(process.argv.indexOf('--check') >= 0){
      const cur = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8').replace(/\r\n/g, '\n') : '';
      if(cur !== code){ console.error('functions/shared/lineSummary.js ไม่ตรงกับ public/index.html — รัน node scripts/extract-line-shared.js'); process.exit(1); }
      console.log('lineSummary.js ตรงกับ index.html');
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, code);
      console.log('เขียน ' + path.relative(root, dst) + ' (' + code.length + ' ตัวอักษร)');
    }
  } catch(e){
    console.error(String(e && e.message || e));
    process.exit(1);
  }
}
