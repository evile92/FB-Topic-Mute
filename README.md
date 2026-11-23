<p align="center">
  <img src="icons/logo.png" alt="FB Topic Mute Logo" width="240" />
</p>

<h1 align="center">FB Topic Mute</h1>

<p align="center">
  A lightweight, zero-dependency Manifest V3 browser extension for Chromium browsers (Chrome, Opera, Edge, Brave) that hides Facebook feed posts containing your muted words or phrases — with full Arabic and English normalization support.
</p>

<p align="center">
  <a href="#العربية---fb-topic-mute">العربية (Arabic Guide) ↓</a>
</p>

---

## Features

- **Arabic & English Normalization:**
  - Strips Arabic diacritics (Tashkeel) and Tatweel (`ـ`).
  - Normalizes Alef forms (`أ`, `إ`, `آ` → `ا`), Teh Marbuta (`ة` → `ه`), and Alef Maksura (`ى` → `ي`).
  - Case-insensitive English matching with whitespace cleanup.
- **Flexible Matching Modes:**
  - **Partial Match (Default):** Matches substrings (ideal for Arabic prefixes/suffixes like `الـ`, `و`, `بـ`).
  - **Whole-Word Match:** Unicode-aware word boundary matching (works accurately with both Arabic and English words).
- **Two React-Safe Hiding Modes:**
  - **Collapse Bar (Default):** Collapses matching posts into a slim bar showing the matched keyword with a **Show / Hide** toggle without removing React nodes.
  - **Complete Hide:** Completely hides matching posts via CSS (`display: none`).
- **Smart Facebook DOM Filtering:**
  - **Comment Isolation:** Ignores comment threads and replies so a comment never hides an unrelated post.
  - **Reels Shelf Isolation:** Hides only matching individual Reel cards inside a horizontal Reels shelf when possible.
  - **Optional Image Alt Scanning:** Matches photo descriptions and Facebook auto-OCR alt text while ignoring avatars, reaction icons, and emojis.
- **Fast & Real-Time:**
  - Batched `MutationObserver` + `WeakMap` signature caching for smooth scrolling.
  - Live updates across all open Facebook tabs without reloading the page.
- **Privacy First & Local Storage:**
  - Requests only the `storage` permission (no `tabs`, `scripting`, or `<all_urls>`).
  - Stores data locally in `chrome.storage.local` with **Export JSON / Import JSON** backup support.
  - Zero external CDNs, zero trackers, zero build step.

## Installation (Load Unpacked)

1. Download or clone this repository:
   ```bash
   git clone https://github.com/evile92/FB-Topic-Mute.git
   ```
2. Open your browser's Extensions page:
   - Chrome: `chrome://extensions`
   - Opera: `opera://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Enable **Developer mode** (top-right corner).
4. Click **Load unpacked** and select the `FB-Topic-Mute` folder.
5. Open or refresh `facebook.com`, click the **FB Topic Mute** toolbar icon, and add your muted keywords.

## Project Structure

```text
FB-Topic-Mute/
├── manifest.json            # Manifest V3 config (least-privilege permissions)
├── utils/
│   └── textNormalizer.js    # Arabic/English normalization & Unicode matcher
├── content/
│   ├── selectors.js         # Centralized semantic Facebook DOM selectors
│   ├── content.js           # Observer, scanner, hiding engine & SPA handler
│   └── content.css          # Collapse bar & hidden post styles
├── popup/
│   ├── popup.html           # Dark-mode popup interface (LTR chrome + auto RTL tags)
│   ├── popup.css            # Popup styling
│   └── popup.js             # Keyword management, settings, stats & JSON backup
└── icons/                   # Extension icons (16, 48, 128px PNG) & repository logo.png
```

---

<div dir="rtl" align="right">

## العربية - FB Topic Mute

إضافة خفيفة ومجانية لمتصفحات كروميوم (Chrome و Opera و Edge و Brave) مبنية بمعيار **Manifest V3** وبدون أي مكتبات خارجية، تتيح لك إخفاء منشورات فيسبوك التي تحتوي على كلمات أو عبارات تحددها أنت (مشابهة لميزة كتم الكلمات في منصة X/Twitter)، مع دعم كامل للغتين العربية والإنجليزية.

### المميزات

- **دعم ذكي للغة العربية والإنجليزية:**
  - إزالة التشكيل والتطويل (`ـ`) تلقائياً قبل المطابقة.
  - توحيد أشكال الألف (`أ`، `إ`، `آ` ← `ا`) والتاء المربوطة (`ة` ← `ه`) والألف المقصورة (`ى` ← `ي`).
  - مطابقة غير حساسة لحالة الأحرف في الإنجليزية.
- **وضعان للمطابقة:**
  - **مطابقة جزئية (`Partial` — الافتراضي):** تطابق الكلمة حتى مع السوابق واللواحق العربية (مثل `الـ` و`و` و`بـ`).
  - **كلمة كاملة (`Whole-Word`):** مطابقة دقيقة بحدود Unicode تدعم العربية والإنجليزية.
- **وضعان آمنان لإخفاء المنشورات:**
  - **شريط الطي (`Collapse Bar` — الافتراضي):** يطوي المنشور إلى شريط رفيع يعرض الكلمة المحظورة مع زر **Show / Hide** لعرضه أو إخفائه مؤقتاً دون كسر التمرير اللانهائي لفيسبوك.
  - **إخفاء كامل (`Complete Hide`):** يخفي المنشور تماماً من الشاشة.
- **دقة في قراءة منشورات فيسبوك:**
  - **عزل التعليقات:** يتجاهل قسم التعليقات والردود حتى لا يتسبب تعليق أحد المستخدمين في إخفاء منشور غير مرتبط.
  - **عزل بطاقات Reels:** عند ظهور شريط Reels أفقي، يخفي البطاقة المطابقة فقط بدلاً من إخفاء الشريط بالكامل كلما أمكن.
  - **فحص وصف الصور (`Scan Image Alt Text`):** خيار لفحص النص البديل للصور ووصف فيسبوك التلقائي، مع استثناء الصور الشخصية والأيقونات والإيموجي.
- **تفاعل فوري وخصوصية تامة:**
  - إضافة أو حذف أي كلمة ينعكس فوراً على جميع تبويبات فيسبوك المفتوحة بدون تحديث الصفحة.
  - صلاحية واحدة فقط (`storage`) ولا تجمع أو ترسل أي بيانات خارج جهازك.
  - دعم **تصدير واستيراد JSON** لعمل نسخة احتياطية من قائمة كلماتك.

### طريقة التثبيت

1. حمّل المشروع أو انسخه عبر Git:
   <div dir="ltr" align="left">

   ```bash
   git clone https://github.com/evile92/FB-Topic-Mute.git
   ```

   </div>
2. افتح صفحة الإضافات في متصفحك:
   - في Chrome: `chrome://extensions`
   - في Opera: `opera://extensions`
   - في Edge: `edge://extensions`
   - في Brave: `brave://extensions`
3. فعّل خيار **وضع المطور (Developer mode)**.
4. اضغط على **تحميل إضافة غير مضغوطة (Load unpacked)** واختر مجلد `FB-Topic-Mute`.
5. افتح فيسبوك أو حدّث الصفحة، ثم اضغط على أيقونة **FB Topic Mute** وأضف الكلمات التي تريد كتمها (يمكنك إدخال أكثر من كلمة بفواصل `,` أو `،`).

</div>
