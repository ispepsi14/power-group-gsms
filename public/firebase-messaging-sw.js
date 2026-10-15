/* POWER GROUP GSMS — service worker ของการแจ้งเตือน (Firebase Cloud Messaging)
   วางไว้ที่ public/firebase-messaging-sw.js  ต้องอยู่ที่รากของเว็บเท่านั้น
   เพราะแอปลงทะเบียนมันด้วยชื่อ 'firebase-messaging-sw.js' (PUSH_SW_URL)

   ไฟล์นี้หายไปจากเซิร์ฟเวอร์ (404) มาตั้งแต่เพิ่มฟีเจอร์แจ้งเตือนใน v3.17.0
   navigator.serviceWorker.register() จึงล้มทุกครั้ง แปลว่า getToken() ไม่เคยสำเร็จ
   และการแจ้งเตือนไม่เคยทำงานเลยแม้แต่ครั้งเดียว ตรวจพบ 25 ก.ย. 2026

   *** ไฟล์นี้มีหน้าที่เดียว: รับข้อความตอนแอปปิดอยู่ ***
   ห้ามใส่การแคชไฟล์แอปลงในนี้เด็ดขาด — updateAppNow() ในตัวแอปตั้งใจ "ไม่ถอน"
   service worker ตัวนี้ตอนกดโหลดเวอร์ชันล่าสุด (isPushServiceWorker) ถ้าไฟล์นี้
   แคชแอปไว้ด้วย ปุ่มโหลดเวอร์ชันล่าสุดจะเลิกทำงานทันที และไม่มีใครรู้ว่าทำไม

   หมายเหตุเรื่องคีย์: ค่าใน firebaseConfig ไม่ใช่ความลับ มันถูกส่งไปกับหน้าเว็บ
   ให้ทุกเบราว์เซอร์อยู่แล้ว (ดูคอมเมนต์เดียวกันใน index.html) สิ่งที่กันข้อมูลจริง ๆ
   คือ Firestore Security Rules กับบัญชีผู้ใช้ ไม่ใช่การซ่อนค่าพวกนี้

   ข้อจำกัดบน iPhone/iPad: เว็บจะรับการแจ้งเตือนได้ต่อเมื่อผู้ใช้ "เพิ่มลงหน้าจอโฮม"
   แล้วเปิดจากไอคอนนั้น (iOS 16.4 ขึ้นไป) เปิดใน Safari ธรรมดาจะไม่เด้ง
   บน Android / Chrome บนคอม ใช้ได้ตามปกติ
*/

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDaZS0zuG4AcC5d0-BE2AJIRtmjh8bfrzE",
  authDomain: "power-group-gsms.firebaseapp.com",
  projectId: "power-group-gsms",
  storageBucket: "power-group-gsms.firebasestorage.app",
  messagingSenderId: "794612913632",
  appId: "1:794612913632:web:8412ee1e11ec3a46e90785"
});

const messaging = firebase.messaging();

/* ข้อความที่เข้ามาตอนแอปปิดหรืออยู่เบื้องหลัง
   ถ้าเซิร์ฟเวอร์ส่งมาเป็น notification payload เบราว์เซอร์เด้งให้เองอยู่แล้ว
   ตัวนี้จึงเด้งเฉพาะกรณี data-only เพื่อกันการเด้งซ้ำสองอัน */
messaging.onBackgroundMessage(payload => {
  const d = (payload && payload.data) || {};
  if(payload && payload.notification) return;      // เบราว์เซอร์จัดการเองแล้ว
  const title = d.title || 'POWER GROUP GSMS';
  self.registration.showNotification(title, {
    body: d.body || 'มีข้อความใหม่',
    icon: d.icon || '/favicon.ico',
    tag:  d.tag  || 'gsms',                        // ข้อความใหม่ทับอันเก่า ไม่กองเป็นตั้ง
    data: { url: d.url || '/' }
  });
});

/* กดที่การแจ้งเตือน — ถ้าแอปเปิดค้างอยู่แล้วให้สลับไปหน้าต่างนั้น ไม่เปิดใหม่ซ้อน */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for(const c of list){
        if(c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) return c.focus();
      }
      if(clients.openWindow) return clients.openWindow(target);
    })
  );
});

/* ติดตั้งแล้วใช้ได้เลย ไม่ต้องรอปิดแท็บทั้งหมดก่อน */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
