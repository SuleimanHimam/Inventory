# التطوير من جهاز آخر

كيف تُعدّل هذا النظام — الواجهة والخادم معاً — من جهازك الشخصي بدل الخادم،
وكيف يصل تعديلك إلى خادم العميل بعد أن يجهز.

> **القاعدة الوحيدة التي تحمي العميل:** الجهاز الآخر لا يتصل أبداً بقاعدة
> بيانات الخادم. لكل جهاز قاعدة بياناته الخاصة، ببيانات تجريبية.

---

## 1. ما يلزم على الجهاز

| | لماذا |
| --- | --- |
| **Git** | لجلب الشيفرة ورفع التعديلات |
| **Node.js 20.12** أو أحدث | الخادم يقرأ إعداداته بـ `--env-file`، وهذه أول نسخة تدعمها |
| **Docker Desktop** | لتشغيل SQL Server للتطوير بأمر واحد — البديل تثبيت SQL Server Express محلياً |
| **VS Code** (اختياري) | محرّر الشيفرة |

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
winget install Docker.DockerDesktop
```

بعد التثبيت أغلق نافذة PowerShell وافتح واحدة جديدة، وإلا لن يجد الجهاز `node`.

---

## 2. أول مرة فقط

```powershell
git clone https://github.com/SuleimanHimam/Inventory.git C:\dev\Inventory
cd C:\dev\Inventory
npm run setup                 # حزم الخادم والواجهة معاً

npm run db:up                 # SQL Server داخل Docker على المنفذ 14330
npm run db:provision          # ينشئ قاعدة inventory بترتيب عربي

Copy-Item server\.env.example server\.env
```

ثم افتح `server\.env` وغيّر أربعة أسطر فقط لتشير إلى قاعدة التطوير:

```ini
DB_SERVER=127.0.0.1,14330
DB_NAME=inventory
DB_USER=sa
DB_PASSWORD=DevPassw0rd!
```

باقي الملف كما هو. `AUTH_MODE=none` يعني أن التطوير يجري بلا شاشة دخول،
وكل الطلبات تُنفَّذ بصلاحية مدير — وهو المطلوب أثناء العمل.

```powershell
npm run migrate               # ينشئ الجداول
npm run seed                  # بيانات عربية تجريبية: أصناف وفواتير وحركات
npm run dev                   # الخادم والواجهة معاً
```

افتح **http://127.0.0.1:5173** — لا تكتب `localhost`، فالخادم مربوط بـ IPv4.

---

## 3. كل يوم بعد ذلك

```powershell
cd C:\dev\Inventory
git pull                      # آخر ما وصل إلى main
npm run db:up                 # لو كان Docker مغلقاً
npm run dev
```

`npm run dev` يراقب الملفات: أي تعديل في `client/src` يظهر في المتصفح فوراً،
وأي تعديل في `server/src` يعيد تشغيل الخادم وحده.

---

## 4. تعديل ميزة أو إضافة واحدة

```powershell
git switch -c feature/اسم-قصير-بالإنجليزية

#  … عدّل، جرّب في المتصفح …
npm test                      # اختبارات الخادم

git commit -am "وصف ما تغيّر"
git push -u origin feature/اسم-قصير-بالإنجليزية
```

ثم من GitHub افتح **Pull Request**، اقرأ الفرق فيه، وادمجه في `main`.
الفائدة أن كل تغيير يمرّ بمكان واحد تُراجعه قبل أن يصل إلى العميل.

**أين تعدّل ماذا:**

| ماذا تريد أن تغيّر | الملفات |
| --- | --- |
| شاشة أو زر أو نص عربي | `client/src/pages/`, `client/src/components/` |
| قاعدة عمل (ترحيل فاتورة، جرد، رصيد) | `server/src/services/` |
| مسار API جديد | `server/src/routes/` |
| جدول أو عمود في قاعدة البيانات | ملف **جديد** في `server/migrations-mssql/` |

ثلاث قواعد لا تُكسر:

1. **لا تعدّل ملف ترحيل سبق تطبيقه على خادم العميل.** أضف ملفاً جديداً برقم
   تالٍ. الفواصل بين الدفعات سطر فيه `GO` وحده، لأن `server/src/db/migrate.js`
   يقسّم الملف عليه.
2. **كل نص يراه المستخدم عربي ومن اليمين إلى اليسار**، على نسق النصوص الموجودة.
3. **لا يتغيّر الرصيد إلا بفاتورة مُرحَّلة.** لا تكتب في `stock_movements`
   مباشرة — الشرح في `SYSTEM-AR.md` القسم 4.

---

## 5. إيصال التعديل إلى خادم العميل

بعد دمج الـ PR في `main`، على الخادم نفسه (`D:\Inventory`) وبهذا الترتيب:

```powershell
D:\Inventory\deploy\windows\backup.ps1        # 1. نسخة احتياطية أولاً
cd D:\Inventory
git status                                     # 2. لا تعديلات معلّقة
git pull
npm run setup                                  # 3. الحزم والواجهة
cd client; npm run build; cd ..
cd server; npm run migrate; npm run doctor; cd ..   # 4. الترحيلات يدوياً هنا
Restart-Service inventory-api                  # 5. إعادة التشغيل
curl.exe http://127.0.0.1:4317/api/v1/health   #    المطلوب: "db":"ready"
```

الخطوة 4 يدوية لأن هذا التثبيت يضع `SKIP_MIGRATIONS=1`، فالترحيلات لا تُطبَّق
وحدها عند الإقلاع.

`git pull` لا يمسّ بيانات العميل: `server\.env` و`data\uploads\` و`backups\`
و`secrets\` كلها خارج Git أصلاً.

**للتراجع:** `git checkout v6.0.0` ثم أعد بناء الواجهة وأعد تشغيل الخدمة. وإن
كان الخلل في ترحيل، استرجع النسخة الاحتياطية بـ `restore.ps1`.

---

## 6. حين لا يعمل شيء

| العَرَض | السبب |
| --- | --- |
| `npm run dev` يقول إن المنفذ 5173 مشغول | نسخة أخرى تعمل — أغلقها، المنفذ مثبّت عمداً |
| الواجهة تفتح والبيانات لا تظهر | الخادم متوقف، أو `server\.env` يشير إلى قاعدة غير موجودة |
| `Login failed for user` | حاوية Docker متوقفة: `npm run db:up` |
| `docker` غير معروف | Docker Desktop لم يُشغَّل بعد فتح الجهاز |
| الترحيل يفشل بخطأ في `GO` | الملف لا يفصل الدفعات بسطر فيه `GO` وحده |
| تعديل عربي يظهر مقلوباً | النص خارج عنصر عليه `dir="rtl"` |

---

## 7. ملفات تستحق القراءة قبل أول تعديل

| الملف | ماذا يشرح |
| --- | --- |
| `SYSTEM-AR.md` | النظام كله: الجداول، القواعد، الأدوار، القرارات |
| `FEATURES-AR.md` | ما يفعله النظام من وجهة نظر المستخدم |
| `deploy/windows/README.md` | التشغيل على الخادم: الخدمات، النسخ الاحتياطي، الاسترجاع |
| `server/src/db/index.js` | كيف تُعزل بيانات كل مؤسسة (`org_id`) |
