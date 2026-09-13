# POWER GROUP GSMS — โครงสร้างฐานข้อมูล Firebase (Firestore)

> เอกสารอ้างอิงสำหรับสร้างฐานข้อมูลใหม่ — ครบทุกคอลเลกชันและทุก field
> อ้างอิงจากโค้ดเวอร์ชันล่าสุด (รวมของที่น้องพัฒนาต่อ: ช่าง / ประกัน / ลายเซ็น / การเงิน / โน้ต)
> โปรเจกต์: `power-group-gsms` · ประเภท: **Cloud Firestore (NoSQL, document-based)**

---

## สารบัญ

1. [ภาพรวม](#1-ภาพรวม)
2. [ตารางสรุปทุกคอลเลกชัน](#2-ตารางสรุปทุกคอลเลกชัน)
3. [รายละเอียดแต่ละคอลเลกชัน](#3-รายละเอียดแต่ละคอลเลกชัน)
4. [ความสัมพันธ์ระหว่างตาราง](#4-ความสัมพันธ์ระหว่างตาราง)
5. [ค่าคงที่ / Enum](#5-ค่าคงที่--enum)
6. [ถ้าจะย้ายไป SQL](#6-ถ้าจะย้ายไป-sql)
7. [ข้อควรระวัง](#7-ข้อควรระวัง)

---

## 1. ภาพรวม

**Firestore ไม่ใช่ SQL** — ไม่มี table/column/foreign key จริง มีแค่:

```
Collection (เทียบเท่า table)
  └── Document (เทียบเท่า row) — มี ID เป็น string
        └── Field (เทียบเท่า column) — แต่ละ document มี field ไม่เหมือนกันก็ได้
```

**หลักการที่ใช้ในระบบนี้:**

| หลักการ | รายละเอียด |
|---|---|
| **ID** | สร้างเองด้วย `uid()` = `Date.now().toString(36) + Math.random().toString(36).slice(2,8)` เก็บใน document path ไม่ได้เก็บซ้ำใน field |
| **วันที่/เวลา** | เก็บเป็น **string ISO 8601** (`new Date().toISOString()`) ไม่ได้ใช้ Firestore Timestamp |
| **วันที่อย่างเดียว** | เก็บเป็น string `"YYYY-MM-DD"` (เวลาท้องถิ่นไทย) |
| **เงิน/จำนวน** | หลายที่เก็บเป็น **string** เพราะมาจาก `<input>` ต้องแปลงด้วย `parseFloat` ก่อนคำนวณ |
| **Array/Object ซ้อน** | ใช้ได้เต็มที่ เช่น `job.partsNeeded` เป็น array ของ object |
| **ค่าว่าง** | ใช้ `''` หรือ `0` ไม่ใช้ `null` (Firestore ไม่ชอบ `undefined` — มี `cleanForFirestore()` กรองออก) |

---

## 2. ตารางสรุปทุกคอลเลกชัน

| # | Collection | เก็บอะไร | ~จำนวน | ซิงค์เรียลไทม์ | สิทธิ์เขียน |
|---|---|---|---|---|---|
| 1 | `jobs` | ใบงานรับรถ | 600 ล่าสุด | ✅ | พนักงาน (ลบ = Admin) |
| 2 | `vehicles` | ข้อมูลรถ | ทั้งหมด | ✅ | พนักงาน |
| 3 | `customers` | ลูกค้า | ทั้งหมด | ✅ | พนักงาน |
| 4 | `models` | แคตตาล็อกรุ่นรถ + อะไหล่ + ราคา | ~101 | ✅ | Admin |
| 5 | `masterParts` | รายการอะไหล่กลาง | ~25 | ✅ | Admin |
| 6 | `partBrandOptions` | ตัวเลือกแบรนด์อะไหล่ | ~11 | ✅ | Admin |
| 7 | `complaintTypes` | อาการที่แจ้ง (ตัวเลือกสำเร็จรูป) | ~8 | ✅ | Admin |
| 8 | `editLog` | ประวัติแก้ไข/ลบ | สะสม | ✅ | เพิ่มได้อย่างเดียว |
| 9 | `jobPhotos` | รูปเต็ม (1 รูป = 1 document) | มาก | ❌ โหลดตอนเปิดงาน | พนักงาน |
| 10 | `config` | ตั้งค่าร้าน/ธีม/ช่าง (มี doc เดียว: `main`) | 1 | ✅ | Admin |
| 11 | `users` | สิทธิ์ผู้ใช้ (doc ID = Firebase Auth UID) | ~7 | ❌ โหลดตอนเปิดหน้า | Admin |
| 12 | `board` | **ข้อมูลสาธารณะสำหรับลูกค้า** (doc ID = jobId) | = jobs ที่ยังไม่ปิด | ✅ | อ่านได้ทุกคน |

---

## 3. รายละเอียดแต่ละคอลเลกชัน

### 3.1 `jobs` — ใบงานรับรถ (ตารางหลักที่สุด)

```
jobs/{jobId}
```

| Field | ชนิด | ตัวอย่าง | คำอธิบาย |
|---|---|---|---|
| **ข้อมูลพื้นฐาน** ||||
| `jobNumber` | string | `"PG260806-001"` | เลขงาน = `PG` + ปีเดือนวัน(พ.ศ.2หลัก) + ลำดับ 3 หลัก |
| `queueNo` | string | `"8"` | เลขคิวที่ให้ลูกค้าตอนรับรถ |
| `vehicleId` | string (FK) | `"m1x2y3..."` | → `vehicles/{id}` |
| `customerId` | string (FK) | `"m4a5b6..."` | → `customers/{id}` |
| `mileageIn` | string | `"125000"` | เลขไมล์ตอนรับรถ (กม.) |
| `createdAt` | string ISO | `"2026-08-06T07:22:11.000Z"` | เวลารับรถ |
| **สถานะ** ||||
| `status` | string (enum) | `"repairing"` | ดู [§5.1](#51-สถานะงาน-status) |
| `statusHistory` | array | ดูข้างล่าง | ★ ประวัติเปลี่ยนสถานะ — นาฬิกาจับเวลาอ่านจากตรงนี้ |
| `bay` | string | `"H3"` | ช่องซ่อม ดู [§5.2](#52-ช่องทำงาน-work_bays) · `""` = ยังไม่ลง |
| `appointmentDate` | string date | `"2026-08-20"` | วันนัดกลับมาทำ (`""` = ไม่ได้นัด) |
| **อาการ / อะไหล่** ||||
| `complaints` | array | `[{text, custom}]` | อาการที่ลูกค้าแจ้ง |
| `partsNeeded` | array | ดูข้างล่าง | รายการอะไหล่ที่เสนอราคา |
| **ราคา** ||||
| `priceEstimate` | number | `12500` | ราคาประเมินคร่าวๆ (ก่อนใส่รายการอะไหล่) |
| `discountType` | string | `"amount"` \| `"percent"` | ประเภทส่วนลด |
| `discountValue` | number | `500` | ค่าส่วนลด (บาท หรือ %) |
| **เวลาซ่อม** ||||
| `estUnit` | string | `"minute"` | หน่วย (ปัจจุบันเก็บเป็น `minute` เสมอ) |
| `estValue` | number | `180` | จำนวน**นาที**ที่ประเมิน |
| **ช่าง** ||||
| `technician` | string | `"สมชาย"` | ชื่อช่างที่รับผิดชอบ |
| `technicianHistory` | array | `[{name, changedAt, changedBy}]` | ประวัติการมอบหมายงาน |
| **รับประกัน** ||||
| `warrantyDays` | number | `90` | จำนวนวันประกัน (`0` = ไม่มี) นับจากวันส่งมอบ |
| **ลายเซ็น** ||||
| `signatures` | map | `{inspector, quoter, customer}` | แต่ละ role เก็บรูป PNG เป็น data URL |
| **โน้ต** ||||
| `notes` | array | `[{text, at, by}]` | บันทึกเพิ่มเติมหลายรายการ |
| `note` | string | `""` | (ของเก่า — ถูกย้ายเข้า `notes` แล้ว เก็บไว้เพื่อ backward compat) |
| **รูป** ||||
| `thumb` | string | `"data:image/jpeg;base64,..."` | รูปย่อ ~240px ติดมากับ job เพื่อให้การ์ดขึ้นเร็ว |
| `photoCount` | number | `3` | จำนวนรูปเต็มใน `jobPhotos` |
| `photos` | array | `[]` | (ของเก่า ไม่ใช้แล้ว — รูปย้ายไป `jobPhotos`) |
| **ถังขยะ** ||||
| `deletedAt` | string ISO | `"2026-08-06T09:00:00Z"` | ★ มีค่า = อยู่ในถังขยะ (soft delete) ไม่มี field นี้ = ปกติ |
| `deletedBy` | string | `"Pepsi"` | ใครลบ |

**`statusHistory[]`** (สำคัญมาก — ระบบนาฬิกาทั้งหมดพึ่งตัวนี้)
```jsonc
[
  { "status": "received",   "changedAt": "2026-08-06T07:22:11.000Z" },
  { "status": "inspecting", "changedAt": "2026-08-06T07:45:00.000Z" },
  { "status": "repairing",  "changedAt": "2026-08-06T09:10:00.000Z" },  // นาฬิกาเริ่มนับ
  { "status": "ready",      "changedAt": "2026-08-06T13:22:58.000Z" }   // นาฬิกาหยุด
]
```
> **กฎ:** อ่าน `"repairing"` **ครั้งหลังสุด** แล้วหาจุดจบเฉพาะที่เกิดหลังจากนั้น
> (รถคันเดิมอาจกลับมาซ่อมรอบใหม่ ประวัติเก่ายังอยู่)

**`complaints[]`**
```jsonc
[
  { "text": "รถเอียง",           "custom": false },  // เลือกจาก complaintTypes
  { "text": "มีเสียงดังล้อหน้า", "custom": true  }   // พิมพ์เอง
]
```

**`partsNeeded[]`**
```jsonc
[{
  "id": "m9z8y7...",
  "name": "โช๊คอัพหน้า ซ้าย",
  "qty": "2",        // string
  "unit": "ชิ้น",
  "price": "1800",   // string — บาทต่อหน่วย
  "brand": "OEM",
  "note": ""
}]
```

**`signatures{}`**
```jsonc
{
  "inspector": "data:image/png;base64,...",   // ผู้ตรวจเช็ค
  "quoter":    "data:image/png;base64,...",   // ผู้เสนอราคา
  "customer":  "data:image/png;base64,..."    // ลูกค้าอนุมัติ
}
```

**`notes[]`**
```jsonc
[{ "text": "ลูกค้าขอเปลี่ยนยางด้วย", "at": "2026-08-06T10:15:00Z", "by": "Pepsi" }]
```

---

### 3.2 `vehicles` — ข้อมูลรถ

```
vehicles/{vehicleId}
```

| Field | ชนิด | ตัวอย่าง | หมายเหตุ |
|---|---|---|---|
| `customerId` | string (FK) | `"m4a5b6..."` | → `customers/{id}` เจ้าของ |
| `plate` | string | `"6กข3896"` | ★ **ตัวพิมพ์ใหญ่เสมอ** · เก็บติดกันไม่เว้นวรรค |
| `province` | string | `"กทม."` | จังหวัดบนป้ายทะเบียน |
| `brand` | string | `"HONDA"` | ★ ตัวพิมพ์ใหญ่เสมอ |
| `model` | string | `"ACCORD GEN8"` | ★ ตัวพิมพ์ใหญ่เสมอ |
| `year` | string | `"2010"` | ปีของคันนี้จริงๆ |
| `color` | string | `"ดำ"` | |
| `mileage` | string | `"125000"` | เลขไมล์ล่าสุด |

> 1 รถ = 1 document · รถคันเดิมกลับมาซ่อมซ้ำ ใช้ `vehicleId` เดิม (ค้นจากทะเบียน)

---

### 3.3 `customers` — ลูกค้า

```
customers/{customerId}
```

| Field | ชนิด | ตัวอย่าง |
|---|---|---|
| `name` | string | `"อุดมพงษ์"` |
| `phone` | string | `"095-668-9765"` |

---

### 3.4 `models` — แคตตาล็อกรุ่นรถ + อะไหล่ + ราคา

```
models/{modelId}
```

| Field | ชนิด | ตัวอย่าง | หมายเหตุ |
|---|---|---|---|
| `brand` | string | `"HONDA"` | ★ ตัวพิมพ์ใหญ่ |
| `name` | string | `"ACCORD G8"` | ★ ตัวพิมพ์ใหญ่ · ชื่อรุ่น |
| `yearRange` | string | `"'08-12"` | ช่วงปี |
| `seedKey` | string | `"honda\|accord g8"` | คีย์กันเพิ่มซ้ำตอน seed จากแคตตาล็อก |
| `parts` | array | ดูข้างล่าง | อะไหล่ + ราคาของรุ่นนี้ |
| `promotions` | array | ดูข้างล่าง | โปรโมชั่นชุดอะไหล่ |

**`parts[]`** — ราคาต่อรุ่น
```jsonc
[{
  "id": "m1a2b3...",
  "partName": "โช๊คอัพหน้า",
  "category": "โช๊คอัพ",       // ดู §5.3
  "qty": "2",
  "unit": "ชิ้น",              // ดู §5.4
  "variant": "ซ้าย",           // ตัวแปร เช่น ซ้าย/ขวา (ว่างได้)
  "brands": [                  // ★ 1 อะไหล่ มีได้หลายแบรนด์หลายราคา
    { "id": "...", "name": "OEM",     "price": "1800" },
    { "id": "...", "name": "รีบิ้ว",  "price": "900"  },
    { "id": "...", "name": "POWERED", "price": "1500" }
  ]
}]
```

**`promotions[]`**
```jsonc
[{
  "id": "m7x8y9...",
  "name": "ชุดช่วงล่างหน้า",
  "itemIds": ["m1a2b3...", "m4c5d6..."],   // อ้างถึง parts[].id ในรุ่นเดียวกัน
  "price": "4500",                          // ราคาเหมาทั้งชุด
  "dateStart": "2026-08-01",   "dateEnd": "2026-09-30",
  "mileageStart": "80000",     "mileageEnd": "150000"
}]
```

---

### 3.5 `masterParts` — รายการอะไหล่กลาง

```
masterParts/{partId}
```

| Field | ชนิด | ตัวอย่าง |
|---|---|---|
| `name` | string | `"แร็คพวงมาลัย"` |
| `category` | string | `"ทั่วไป"` |

> เป็น "ทะเบียนกลาง" ของชื่ออะไหล่ · แก้ชื่อที่นี่ = เปลี่ยนทุกรุ่น · ลบที่นี่ = หายจากทุกรุ่น

---

### 3.6 `partBrandOptions` — ตัวเลือกแบรนด์อะไหล่

```
partBrandOptions/{id}
```

| Field | ชนิด | ตัวอย่าง |
|---|---|---|
| `name` | string | `"OEM"` |

> ค่าเริ่มต้น: `รีบิ้ว`, `OEM`, `POWERED`

---

### 3.7 `complaintTypes` — อาการที่แจ้ง (ตัวเลือกสำเร็จรูป)

```
complaintTypes/{id}
```

| Field | ชนิด | ตัวอย่าง |
|---|---|---|
| `name` | string | `"รถเอียง"` |

> ค่าเริ่มต้น: รถเอียง · รถกินซ้าย · รถกินขวา · เปลี่ยนโช๊ค · เบรกสั่น · ช่วงล่างดัง · พวงมาลัยสั่น · เช็คช่วงล่าง

---

### 3.8 `editLog` — ประวัติแก้ไข/ลบ

```
editLog/{id}
```

| Field | ชนิด | ตัวอย่าง | หมายเหตุ |
|---|---|---|---|
| `ts` | string ISO | `"2026-08-06T09:00:00Z"` | เวลาที่ทำ |
| `action` | string | `"edit"` \| `"delete"` | |
| `jobNumber` | string | `"PG260806-001"` | |
| `plate` | string | `"6กข3896"` | |
| `summary` | string | `"เปลี่ยนเบอร์โทร: 08x → 09x"` | สรุปว่าแก้อะไร |
| `by` | string | `"Pepsi"` | ใครทำ |

> **แก้ย้อนหลังไม่ได้** — Rules อนุญาตแค่ `create` เท่านั้น

---

### 3.9 `jobPhotos` — รูปเต็ม

```
jobPhotos/{photoId}
```

| Field | ชนิด | ตัวอย่าง |
|---|---|---|
| `jobId` | string (FK) | `"m1x2y3..."` |
| `dataUrl` | string | `"data:image/jpeg;base64,..."` |
| `createdAt` | string ISO | |

> **ทำไมแยกเอกสาร:** Firestore จำกัดเอกสารละ **1 MB** แต่รูปจากมือถือ 2–4 MB
> วิธีแก้: ย่อเหลือ ~1000px แล้วเก็บ **1 รูป = 1 document** โหลดเฉพาะตอนเปิดงาน
> จำกัด 6 รูป/งาน
>
> **ถ้าสร้างระบบใหม่ แนะนำใช้ Object Storage (S3/Cloud Storage) แทน แล้วเก็บแค่ URL**

---

### 3.10 `config/main` — ตั้งค่าระบบ (document เดียว)

```
config/main
```

| Field | ชนิด | โครงสร้าง |
|---|---|---|
| `shop` | map | `{ name, sub, phone, line, site }` |
| `settings` | map | `{ aiApiKey, geminiApiKey, aiModel, themeId }` |
| `technicians` | array | `[{ id, name }]` — รายชื่อช่าง |
| `deletedMasterPartNames` | array | `["ชื่ออะไหล่ที่ถูกลบ"]` — กันไม่ให้ seed กลับมา |

```jsonc
{
  "shop": {
    "name": "POWER GROUP",
    "sub":  "ระบบจัดการอู่บริการ (GSMS)",
    "phone": "", "line": "", "site": ""
  },
  "settings": {
    "aiApiKey": "", "geminiApiKey": "",
    "aiModel": "claude",      // "claude" | "gemini"
    "themeId": "default"
  },
  "technicians": [ { "id": "m1a2...", "name": "สมชาย" } ],
  "deletedMasterPartNames": []
}
```

---

### 3.11 `users/{uid}` — สิทธิ์ผู้ใช้

```
users/{firebaseAuthUid}     ← doc ID = UID จาก Firebase Authentication
```

| Field | ชนิด | ตัวอย่าง | หมายเหตุ |
|---|---|---|---|
| `name` | string | `"Pepsi"` | ชื่อที่แสดงในแอป |
| `email` | string | `"pepsi.manage1@gmail.com"` | ไว้ดูอ้างอิงเฉยๆ |
| `role` | string | `"admin"` \| `"staff"` | สิทธิ์ |

> ★ **สร้างบัญชีใน Authentication อย่างเดียวยังเข้าไม่ได้** — ต้องมี document นี้ก่อน
> ★ `BOOTSTRAP_ADMIN_UID = "79YAV3SBT7ZAFfCz9rLMYyTRlPw1"` ฝังในโค้ด+Rules
>   เพื่อแก้ปัญหาไก่กับไข่ (ยังไม่มี user แรกก็สร้างไม่ได้) และกันเผลอลบสิทธิ์ตัวเอง

---

### 3.12 `board/{jobId}` — ข้อมูลสาธารณะสำหรับลูกค้า ★

```
board/{jobId}        ← doc ID = jobId (ตรงกับ jobs/{jobId})
```

**ทำไมต้องแยกคอลเลกชัน:** Firestore Rules **ซ่อนเป็นราย field ไม่ได้**
ถ้าเปิดให้ลูกค้าอ่าน `jobs` จะเห็นชื่อ เบอร์โทร อาการ และราคาทั้งหมด
จึงคัดเฉพาะข้อมูลที่เปิดเผยได้มาไว้ที่นี่ แล้วเปิด `allow read: if true`

| Field | ชนิด | ที่มา |
|---|---|---|
| `queueNo` | string | job |
| `plate` | string | vehicle |
| `province` | string | vehicle |
| `brand` | string | vehicle |
| `model` | string | vehicle |
| `color` | string | vehicle |
| `thumb` | string | job (รูปย่อ 240px) |
| `bay` | string | job |
| `est` | string | `"1 ชม. 30 น."` — ข้อความอ่านง่าย |
| `estMins` | number | `90` — สำหรับคำนวณนับถอยหลัง |
| `workStart` | string ISO | เวลาที่เริ่มซ่อม (`""` = ยังไม่เริ่ม) |
| `workEnd` | string ISO | เวลาที่ซ่อมเสร็จ (`""` = ยังไม่เสร็จ) |
| `status` | string | job |
| `statusLabel` | string | `"กำลังซ่อม"` |
| `statusCls` | string | `"st-repairing"` — คลาส CSS สำหรับสี |
| `createdAt` | string ISO | job |
| `updatedAt` | string ISO | เวลาที่อัปเดตล่าสุด |

> ❌ **ไม่มี:** ชื่อลูกค้า · เบอร์โทร · อาการ · ราคา · เลขไมล์ · ช่าง
>
> **เขียนอัตโนมัติ** ทุกครั้งที่ `jobs` เปลี่ยน · งานที่อยู่ในถังขยะจะถูก **ลบ** ออกจาก `board`

---

## 4. ความสัมพันธ์ระหว่างตาราง

```
customers (1) ──< (N) vehicles (1) ──< (N) jobs
                                          │
                                          ├──< (N) jobPhotos       [jobId]
                                          ├──── (1) board          [doc ID = jobId]
                                          ├──── partsNeeded[]      (ฝังใน job)
                                          ├──── complaints[]       (ฝังใน job)
                                          ├──── statusHistory[]    (ฝังใน job)
                                          ├──── notes[]            (ฝังใน job)
                                          ├──── signatures{}       (ฝังใน job)
                                          └──── technicianHistory[](ฝังใน job)

models (1) ──── parts[]      (ฝัง) ──< brands[] (ฝัง)
       (1) ──── promotions[] (ฝัง) ──> อ้าง parts[].id

masterParts      → เป็นแม่แบบให้ models[].parts[].partName
partBrandOptions → เป็นตัวเลือกให้ models[].parts[].brands[].name
complaintTypes   → เป็นตัวเลือกให้ jobs.complaints[].text

config/main      → shop, settings, technicians (ช่างอ้างด้วย "ชื่อ" ไม่ใช่ ID)
users/{uid}      → Firebase Auth UID
```

**ข้อสังเกตสำคัญ:**

- ไม่มี foreign key จริง — เป็นแค่ string ที่เก็บ ID ไว้ ต้องเช็คความถูกต้องเองในแอป
- `job.technician` เก็บ **ชื่อ** ไม่ใช่ ID (ถ้าเปลี่ยนชื่อช่าง งานเก่าไม่ตาม) — จุดที่ควรแก้ถ้าสร้างใหม่
- ข้อมูลลูกซ้อนอยู่ใน document แม่ (denormalized) เพราะ Firestore ไม่มี JOIN

---

## 5. ค่าคงที่ / Enum

### 5.1 สถานะงาน (`status`)

| key | ป้ายภาษาไทย | สี | หมายเหตุ |
|---|---|---|---|
| `received` | รับรถ | แดง | เริ่มต้น |
| `inspecting` | ตรวจเช็ค | ส้ม | |
| `quoted` | เสนอราคา | เหลือง | ★ จุดตัดสินใจ |
| `approved` | อนุมัติ | ม่วง | |
| `scheduled` | นัดวันมาทำ | — | แยกออก → `carout` |
| `rejected` | ไม่อนุมัติ | — | แยกออก → `carout` |
| `repairing` | กำลังซ่อม | ฟ้าอ่อน | ★ นาฬิกาเริ่มนับ |
| `aligning` | รอตั้งศูนย์ | ฟ้าเข้ม | |
| `ready` | พร้อมส่ง | เขียวอ่อน | ★ นาฬิกาหยุด |
| `delivered` | ส่งแล้ว | เขียวเข้ม | ★ หลุดจากรายการงาน |
| `carout` | เอารถลง | เทา | ปลายทางของ scheduled/rejected |

```js
MAIN_PATH     = ['received','inspecting','quoted','approved','repairing','aligning','ready','delivered']
DECISION_KEYS = ['approved','scheduled','rejected']   // ปุ่มที่โผล่เฉพาะตอน quoted
BRANCH_ENDS   = { scheduled:'carout', rejected:'carout' }
LEGACY_STATUS_MAP = { customerout: 'quoted' }         // แปลงสถานะเก่า
```

### 5.2 ช่องทำงาน (`WORK_BAYS`)
```
H1 H2 H3 H4 H5 H6 H7 H8 H9 H10 H11 ตั้งศูนย์          (12 ช่อง)
```
> เมื่อสถานะเป็น `carout` หรือ `delivered` ระบบจะเคลียร์ `bay` เป็น `""` อัตโนมัติ

### 5.3 หมวดอะไหล่ (`PART_CATEGORIES`)
```
ทั่วไป · โช๊คอัพ · ผ้าเบรค · เพลาขับ · ของเหลว · อื่นๆ
```

### 5.4 หน่วย (`UNIT_OPTIONS`)
```
ชิ้น · เส้น · อัน · คู่ · ลิตร · ชุด · ใบ
```

### 5.5 ยี่ห้อรถ (`BRAND_OPTIONS`)
```
TOYOTA · HONDA · ISUZU · MAZDA · NISSAN · MITSUBISHI · FORD · MG · SUZUKI · CHEVROLET
```

### 5.6 role ผู้ใช้
```
admin · staff
```

---

## 6. ถ้าจะย้ายไป SQL

โครงสร้างตารางที่แนะนำ (แตก array ที่ฝังอยู่ออกมาเป็นตารางลูก):

```sql
customers        (id PK, name, phone)
vehicles         (id PK, customer_id FK, plate, province, brand, model, year, color, mileage)

jobs             (id PK, job_number UNIQUE, queue_no, vehicle_id FK, customer_id FK,
                  mileage_in, status, bay, appointment_date DATE,
                  price_estimate DECIMAL, discount_type, discount_value DECIMAL,
                  est_minutes INT, technician_id FK, warranty_days INT,
                  thumb_url, photo_count INT,
                  created_at TIMESTAMP, deleted_at TIMESTAMP NULL, deleted_by)

job_status_history (id PK, job_id FK, status, changed_at TIMESTAMP, changed_by)
job_complaints     (id PK, job_id FK, text, is_custom BOOL)
job_parts          (id PK, job_id FK, name, qty, unit, price DECIMAL, brand, note)
job_notes          (id PK, job_id FK, text, created_at, created_by)
job_signatures     (id PK, job_id FK, role, image_url)          -- role: inspector|quoter|customer
job_photos         (id PK, job_id FK, url, created_at)
job_technician_history (id PK, job_id FK, technician_name, changed_at, changed_by)

vehicle_models     (id PK, brand, name, year_range, seed_key UNIQUE)
model_parts        (id PK, model_id FK, part_name, category, qty, unit, variant)
model_part_brands  (id PK, model_part_id FK, brand_name, price DECIMAL)
promotions         (id PK, model_id FK, name, price DECIMAL,
                    date_start DATE, date_end DATE, mileage_start INT, mileage_end INT)
promotion_items    (promotion_id FK, model_part_id FK)          -- ตารางเชื่อม M:N

master_parts       (id PK, name UNIQUE, category)
part_brand_options (id PK, name UNIQUE)
complaint_types    (id PK, name UNIQUE)
technicians        (id PK, name UNIQUE)

users              (id PK = auth_uid, name, email, role)
edit_log           (id PK, ts TIMESTAMP, action, job_number, plate, summary, created_by)
shop_settings      (id PK, key, value)                          -- หรือตารางแถวเดียว
```

**ที่ควรปรับปรุงตอนสร้างใหม่:**

| ปัญหาเดิม | ควรแก้เป็น |
|---|---|
| ราคา/จำนวนเก็บเป็น string | ใช้ `DECIMAL` / `INT` |
| วันที่เก็บเป็น string ISO | ใช้ `TIMESTAMP WITH TIME ZONE` |
| `job.technician` เก็บชื่อ | ใช้ `technician_id` FK |
| รูปเป็น base64 ในฐานข้อมูล | อัปโหลดขึ้น Object Storage เก็บแค่ URL |
| `estUnit` + `estValue` แยกกัน | เก็บ `est_minutes` ตัวเดียว |
| `board` เป็นคอลเลกชันซ้ำ | ใช้ SQL VIEW หรือ API endpoint ที่คัด field เอง |

---

## 7. ข้อควรระวัง

### 7.1 นาฬิกาจับเวลาซ่อม
อ่านจาก `statusHistory` เท่านั้น ไม่มี field `repairStartedAt`/`repairEndedAt` เก็บไว้ตรงๆ

```
1. หา "repairing" ครั้งหลังสุด  → เวลาเริ่ม
2. หา ready/delivered/carout ที่เกิด "หลัง" ข้อ 1 → เวลาจบ
3. ถ้าสถานะปัจจุบันอยู่ก่อน repairing (received/inspecting/quoted/approved/scheduled/rejected)
   → ไม่ต้องแสดงนาฬิกาเลย
```
> ถ้าอ่าน `"repairing"` ครั้งแรกสุด → รถที่เคยส่งแล้วดึงกลับมาจะแสดงเวลารอบเก่า (เคยเป็นบั๊กจริง)

### 7.2 ขนาดเอกสาร
Firestore จำกัด **1 MB / document** — `job.thumb` (base64 ~240px) กินพื้นที่พอสมควร
ถ้าเก็บรูปเต็มลงไปด้วยจะเกินทันที

### 7.3 การลบ
- **ลบงาน** = soft delete (ใส่ `deletedAt`) ข้อมูลยังอยู่ครบ กู้คืนได้
- **ลบถาวร** = ลบ `jobs/{id}` + `jobPhotos` ที่ `jobId` ตรงกัน + `board/{id}` (Admin เท่านั้น)
- **ลบอะไหล่จาก masterParts** = ต้องเอาออกจาก `models[].parts[]` ทุกรุ่นด้วย + จดชื่อไว้ใน `deletedMasterPartNames`

### 7.4 ตัวพิมพ์ใหญ่
`plate` · `brand` · `model` ต้องเป็นตัวพิมพ์ใหญ่**เสมอ** (บังคับตอนบันทึก ไม่ใช่แค่แสดงผล)

### 7.5 การนับวัน
ต้องคำนวณจาก**เวลาท้องถิ่น** ไม่ใช่ตัดสตริง ISO (`"2026-08-06T07:22Z"` → UTC = 6 ส.ค. แต่เวลาไทยคือ 14:22 ของวันที่ 6 · ถ้าเป็น `01:00Z` เวลาไทยจะเป็น 08:00 ของวันเดียวกัน แต่ถ้า `18:00Z` เวลาไทยคือ **วันถัดไป**)

### 7.6 การซิงค์
- `jobs` โหลดแค่ **600 รายการล่าสุด** (`RECENT_JOBS_LIMIT`) เรียงตาม `createdAt` ลง
- `jobPhotos` และ `users` **ไม่** ซิงค์เรียลไทม์ โหลดตอนต้องใช้เท่านั้น
- การบันทึกเป็นแบบ **diff** — เทียบกับ snapshot ล่าสุดแล้วเขียนเฉพาะที่เปลี่ยน (ป้องกัน 2 เครื่องแก้พร้อมกันแล้วทับกัน)

---

## ภาคผนวก — ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | เนื้อหา |
|---|---|
| `firestore-rules.txt` | กฎความปลอดภัยฉบับเต็ม (วางใน Firebase Console → Firestore → Rules) |
| `HANDOFF - POWER GROUP GSMS.md` | เอกสารส่งต่องาน (สถาปัตยกรรม บั๊กที่เคยเจอ กฎการเขียนโค้ด) |
| `POWER GROUP_GSMS_blackup.json` | ตัวอย่างข้อมูลจริง (2 ส.ค. 2026 · 23 งาน) — ใช้ดูรูปแบบข้อมูลจริงได้ |

### วิธี export ข้อมูลปัจจุบันออกมา
เปิดแอป → **ตั้งค่า → สำรองข้อมูล** → ได้ไฟล์ JSON ที่มีทุกคอลเลกชัน (ยกเว้น `jobPhotos` และ `users`)
