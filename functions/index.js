// LINE Bot ตอบคำสั่ง !<เลขคิว> ในกลุ่มร้าน (spec docs/specs/line-bot-queue-command.md) + lookupMyCar ของหน้า ?reception
// ตรรกะทั้งหมดอยู่ใน lib/*.js (เทสต์ได้โดยไม่ต้องติดตั้ง firebase-*) ไฟล์นี้แค่ต่อของจริงเข้าไป
// deploy เฉพาะ: firebase deploy --only functions:linebot:lookupMyCar (เจ้าของเป็นคนสั่งเอง)
//   ห้าม deploy ทั้ง codebase (--only functions:linebot / firebase deploy เปล่า ๆ) และห้ามใช้ --force
// บอท LINE ปิดอยู่ (27 ต.ค. 2569 · spec docs/specs/deploy-lookup-without-line-2026-10-27.md):
//   สวิตช์อยู่ใน linebot.config.json (ไฟล์ธรรมดา ไม่ใช่ secret) · ปิด = ไม่มี defineSecret ไม่มี lineWebhook
//   Firebase CLI จึงไม่ถาม LINE_CHANNEL_SECRET ตอน deploy lookupMyCar
// เปิดบอทวันหน้า: ทำตาม docs/specs/line-bot-install.md จนตั้ง secret ครบ -> แก้ linebot.config.json เป็น
//   { "lineBotEnabled": true } -> commit ด้วย publish.cmd -> deploy lineWebhook ตามขั้นในคู่มือ (ไม่ต้องแก้โค้ด)
'use strict';
const fs = require('fs');
const path = require('path');
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createLookupMyCar } = require('./lib/lookupMyCar.js');

initializeApp();

// อ่านสวิตช์จากไฟล์ที่ commit เท่านั้น (ไม่มีทาง override ผ่าน env) · ไฟล์ไม่มี / JSON เสีย / ค่าไม่ใช่ true เป๊ะ = ปิด
// ห้าม throw — discovery ของ Firebase CLI ต้องไม่ล้ม · ห้าม log เนื้อไฟล์
function lineBotEnabled(){
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'linebot.config.json'), 'utf8'));
    return !!cfg && typeof cfg === 'object' && !Array.isArray(cfg) && cfg.lineBotEnabled === true;
  } catch(e){
    return false;
  }
}

if(lineBotEnabled()){
  const { defineSecret } = require('firebase-functions/params');
  const { getStorage } = require('firebase-admin/storage');
  const { createHandler } = require('./lib/handler.js');
  const { createLineClient } = require('./lib/lineApi.js');

  // ค่าอยู่ใน Secret Manager (เจ้าของตั้งเองด้วย firebase functions:secrets:set) · ห้าม log ค่า
  const LINE_CHANNEL_SECRET = defineSecret('LINE_CHANNEL_SECRET');
  const LINE_CHANNEL_ACCESS_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN');

  const handler = createHandler({
    db: getFirestore(),
    bucket: getStorage().bucket(),
    line: createLineClient(() => LINE_CHANNEL_ACCESS_TOKEN.value()),
    channelSecret: () => LINE_CHANNEL_SECRET.value(),
    now: () => new Date(),
    log: (msg, info) => logger.info(msg, info)
  });

  exports.lineWebhook = onRequest({
    region: 'asia-southeast1',
    memory: '512MiB',
    cpu: 1,
    timeoutSeconds: 60,         // 24 ต.ค. 2569 (H1): handler ตัดเองที่ ~20 วิ · เผื่อไว้ให้ reply ออกทันเสมอ
    minInstances: 0,
    maxInstances: 2,
    concurrency: 10,
    serviceAccount: 'line-bot@power-group-gsms.iam.gserviceaccount.com',
    invoker: 'public',          // LINE เรียกโดยไม่มี Google auth — ความปลอดภัยมาจากการตรวจลายเซ็น
    secrets: [LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN]
  }, handler);
}

// หน้า ?reception ค้นรถของลูกค้า (bugfix-sweep K3 ขั้นที่ 1 · 24 ต.ค. 2569) — ตรรกะใน lib/lookupMyCar.js
// ไม่ใช้ secret ของ LINE · ไม่บังคับ App Check (หน้าเว็บยังไม่ได้ลงทะเบียน — ถ้าบังคับจะตกไปทางเดิมทุกครั้ง)
// service account ของตัวเอง (27 ต.ค. 2569) ไม่พึ่ง line-bot@ ของบอท · ต้องมีบัญชีนี้ใน IAM ก่อน deploy (เจ้าของสร้างเอง)
// deploy เฉพาะตัวนี้: firebase deploy --only functions:linebot:lookupMyCar (เจ้าของเป็นคนสั่งเอง)
const lookupMyCar = createLookupMyCar({
  db: getFirestore(),
  now: () => new Date(),
  HttpsError,
  log: (msg, info) => logger.info(msg, info)
});
exports.lookupMyCar = onCall({
  region: 'asia-southeast1',
  memory: '256MiB',
  cpu: 1,
  timeoutSeconds: 15,
  minInstances: 0,
  maxInstances: 2,
  concurrency: 20,
  serviceAccount: 'lookup-my-car@power-group-gsms.iam.gserviceaccount.com'
}, lookupMyCar);
