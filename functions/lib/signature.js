// ตรวจลายเซ็น webhook ของ LINE (x-line-signature)
// = Base64(HMAC-SHA256(channel secret, raw body)) — ต้องคิดจากไบต์ดิบ (req.rawBody) เท่านั้น
// ห้าม throw: header หาย / ความยาวไม่เท่า / base64 เสีย / secret ว่าง = false
'use strict';
const crypto = require('crypto');

const B64_SHA256 = /^[A-Za-z0-9+/]{43}=$/;   // 32 ไบต์ = base64 ยาว 44 ตัวพอดี

function verifySignature(rawBody, signatureHeader, channelSecret){
  try {
    if(typeof signatureHeader !== 'string' || !B64_SHA256.test(signatureHeader)) return false;
    if(typeof channelSecret !== 'string' || !channelSecret) return false;
    if(rawBody === undefined || rawBody === null) return false;
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
    const got = Buffer.from(signatureHeader, 'base64');
    const want = crypto.createHmac('sha256', channelSecret).update(body).digest();
    if(got.length !== want.length) return false;
    return crypto.timingSafeEqual(got, want);
  } catch(e){
    return false;
  }
}

module.exports = { verifySignature };
