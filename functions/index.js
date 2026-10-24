// LINE Bot ตอบคำสั่ง !<เลขคิว> ในกลุ่มร้าน (spec docs/specs/line-bot-queue-command.md)
// ตรรกะทั้งหมดอยู่ใน lib/handler.js (เทสต์ได้โดยไม่ต้องติดตั้ง firebase-*) ไฟล์นี้แค่ต่อของจริงเข้าไป
// deploy เฉพาะตัวนี้: firebase deploy --only functions:linebot (เจ้าของเป็นคนสั่งเอง)
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { createHandler } = require('./lib/handler.js');
const { createLineClient } = require('./lib/lineApi.js');

initializeApp();

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
  timeoutSeconds: 30,
  minInstances: 0,
  maxInstances: 2,
  concurrency: 10,
  serviceAccount: 'line-bot@power-group-gsms.iam.gserviceaccount.com',
  invoker: 'public',          // LINE เรียกโดยไม่มี Google auth — ความปลอดภัยมาจากการตรวจลายเซ็น
  secrets: [LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN]
}, handler);
