// วันที่ตามเวลาไทย (UTC+7 ไม่มี DST) — ไม่พึ่ง TZ ของเครื่อง (Cloud Functions เป็น UTC)
'use strict';

const TH_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 86400000;

function thaiToday(now){
  const u = new Date((now instanceof Date ? now.getTime() : Number(now)) + TH_OFFSET_MS);
  return { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate() };
}

// start = 00:00 ไทยของวันนั้น, end = 00:00 ไทยของวันถัดไป (ISO UTC แบบเดียวกับ nowIso() ของแอป)
function thaiDayRangeUtc(y, m, d){
  const start = Date.UTC(y, m - 1, d) - TH_OFFSET_MS;
  return { start: new Date(start).toISOString(), end: new Date(start + DAY_MS).toISOString() };
}

function isValidDate(y, m, d){
  if(!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// จำนวนวันจาก (y,m,d) ถึง today (บวก = อยู่ในอดีต)
function daysAgo(today, y, m, d){
  return Math.round((Date.UTC(today.y, today.m - 1, today.d) - Date.UTC(y, m - 1, d)) / DAY_MS);
}

function shiftDay(y, m, d, k){
  const t = new Date(Date.UTC(y, m - 1, d + k));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// d/m/yy พ.ศ. (แบบ fmtDateBE ของแอป)
function fmtThaiDate(y, m, d){
  return d + '/' + m + '/' + String(y + 543).slice(-2);
}

// "d/m/yy HH:MM" พ.ศ. ตามเวลาไทยของ ISO string · ค่าเสีย = ''
function fmtThaiDateTime(iso){
  const t = Date.parse(iso);
  if(!isFinite(t)) return '';
  const u = new Date(t + TH_OFFSET_MS);
  return fmtThaiDate(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate()) + ' ' + fmtThaiTime(iso);
}

// "HH:MM" ตามเวลาไทย
function fmtThaiTime(iso){
  const t = Date.parse(iso);
  if(!isFinite(t)) return '';
  const u = new Date(t + TH_OFFSET_MS);
  return String(u.getUTCHours()).padStart(2, '0') + ':' + String(u.getUTCMinutes()).padStart(2, '0');
}

module.exports = { thaiToday, thaiDayRangeUtc, isValidDate, daysAgo, shiftDay, fmtThaiDate, fmtThaiDateTime, fmtThaiTime, TH_OFFSET_MS, DAY_MS };
