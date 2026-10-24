// แยกคำสั่ง !<เลขคิว> [dd/mm[/yy|yyyy]] (spec ข้อ 6.1 + ข้อตัดสินเจ้าของ 90 วัน)
// ข้อความที่ไม่ตรงรูปแบบทั้งข้อความ = null (Bot ต้องเงียบ)
'use strict';
const { thaiToday, isValidDate, daysAgo } = require('./dates.js');

const MAX_DAYS_BACK = 90;
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
// เลขคิว: ตัวเลข 1–3 หลัก มีตัวอักษรนำหน้าได้ไม่เกิน 2 ตัว (เช่น A17) · วันที่ d/m หรือ d/m/yy หรือ d/m/yyyy
const CMD_RE = /^!([A-Za-z]{0,2}\d{1,3})(?:[ \t]+(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?)?$/;

function toArabic(s){
  return s.replace(/[๐-๙]/g, ch => String(THAI_DIGITS.indexOf(ch)));
}

function parseCommand(text, now){
  if(typeof text !== 'string') return null;
  const typed = text.trim().replace(/^！/, '!');
  if(typed.length > 40 || typed.charAt(0) !== '!') return null;
  const m = CMD_RE.exec(toArabic(typed));
  if(!m) return null;
  const queue = m[1];
  const today = thaiToday(now || new Date());
  if(m[2] === undefined) return { kind: 'query', queue, y: today.y, m: today.m, d: today.d, typed };

  const d = Number(m[2]), mo = Number(m[3]);
  if(!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12)) return { kind: 'bad-date', typed };
  let y;
  if(m[4] === undefined){
    // ไม่ระบุปี = ปีนี้ ถ้าวันนั้นยังไม่ถึงให้ถือเป็นปีที่แล้ว (C7)
    y = today.y;
    if(Date.UTC(y, mo - 1, d) > Date.UTC(today.y, today.m - 1, today.d)) y -= 1;
  } else if(m[4].length === 2){
    y = 2500 + Number(m[4]) - 543;            // ปีสองหลัก = พ.ศ. 25xx ตามที่แอปพิมพ์
  } else {
    y = Number(m[4]);
    if(y >= 2400) y -= 543;                    // ปีสี่หลัก ≥ 2400 = พ.ศ.
  }
  if(!isValidDate(y, mo, d)) return { kind: 'bad-date', typed };
  if(daysAgo(today, y, mo, d) > MAX_DAYS_BACK) return { kind: 'too-old', typed, y, m: mo, d };
  return { kind: 'query', queue, y, m: mo, d, typed };
}

module.exports = { parseCommand, MAX_DAYS_BACK };
