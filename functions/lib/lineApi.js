// ตัวเรียก LINE Messaging API แบบเล็กที่สุด (fetch ของ Node 22 · ไม่ใช้ @line/bot-sdk)
// มีแค่ 3 ทาง: reply (ตอบด้วย replyToken), อ่านชื่อกลุ่ม (summary) และจำนวนสมาชิก (members/count)
// — ไม่มีทางส่งข้อความแบบ push / multicast / broadcast
// error ที่โยนออกไปมีแค่ code (HTTP status) ไม่มีเนื้อหาตอบกลับ / header / token (S9)
'use strict';

const API = 'https://api.line.me/v2/bot';
const TIMEOUT_MS = 8000;

function httpError(status){
  const e = new Error('line api ' + status);
  e.code = 'line-' + status;
  return e;
}

function createLineClient(getToken, opts){
  opts = opts || {};
  const doFetch = opts.fetch || ((u, o) => fetch(u, o));
  async function call(method, path, body){
    const headers = { Authorization: 'Bearer ' + getToken() };
    if(body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await doFetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body),
                                          signal: AbortSignal.timeout(TIMEOUT_MS) });
    if(!r.ok) throw httpError(r.status);
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  }
  return {
    reply(replyToken, messages){
      return call('POST', '/message/reply', { replyToken, messages });
    },
    getGroupSummary(groupId){
      if(!/^C[0-9a-f]{32}$/.test(String(groupId))) return Promise.reject(httpError(400));
      return call('GET', '/group/' + groupId + '/summary');
    },
    // จำนวนสมาชิกกลุ่ม ให้แอดมินดูประกอบตอนอนุมัติ (S2) · ได้ { count }
    getGroupMemberCount(groupId){
      if(!/^C[0-9a-f]{32}$/.test(String(groupId))) return Promise.reject(httpError(400));
      return call('GET', '/group/' + groupId + '/members/count');
    }
  };
}

module.exports = { createLineClient };
