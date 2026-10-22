# 🤖 AiPASS Auto Quiz Extension

**เจ้าของไฟล์: Kimmy**

ส่วนขยาย Chrome สำหรับทำแบบทดสอบบนเว็บไซต์ AiPASS อัตโนมัติ โดยใช้ Claude AI วิเคราะห์คำถามและเลือกคำตอบ

---

## 📁 โครงสร้างไฟล์

```
aipass-quiz-extension/
├── manifest.json      ← ไฟล์หลักของ Extension
├── popup.html         ← หน้า UI ของ Extension
├── popup.js           ← Logic ของ UI
├── content.js         ← Script ที่ทำงานบนหน้าเว็บ AiPASS
├── background.js      ← Service Worker
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## 🚀 วิธีติดตั้ง

1. เปิด Chrome แล้วไปที่ `chrome://extensions/`
2. เปิด **Developer mode** (มุมบนขวา)
3. คลิก **"Load unpacked"**
4. เลือกโฟลเดอร์ `aipass-quiz-extension`
5. Extension จะปรากฏในแถบเครื่องมือ

---

## 🔑 การตั้งค่า

1. รับ **Anthropic API Key** จาก https://console.anthropic.com/
2. คลิกไอคอน Extension → ใส่ API Key → กด **บันทึก**
3. เลือกความหน่วง และโหมดการทำงาน
4. เปิดหน้า AiPASS ที่มีแบบทดสอบ
5. กด **▶ เริ่มทำแบบทดสอบ**

---

## ⚙️ ตัวเลือก

| ตัวเลือก | คำอธิบาย |
|---------|----------|
| ความหน่วง | เวลาระหว่างแต่ละคำถาม (1.5–6 วินาที) |
| โหมดอัตโนมัติ | เลือกคำตอบทันที |
| โหมดยืนยัน | แสดงคำตอบก่อนเลือก (เร็ว ๆ นี้) |
| ส่งอัตโนมัติ | กดส่งคำตอบหลังทำครบ |

---

## ⚠️ หมายเหตุ

- ใช้ได้กับ `de.aipass.net` และ `*.aipass.net`
- ต้องมี API Key ของ Anthropic (มีค่าใช้จ่ายตาม token ที่ใช้)
- ใช้เพื่อการเรียนรู้และทดสอบระบบเท่านั้น
