/**
 * Default Chart of Accounts, converted once from the customer's
 * `حسابات افتراضية.xls` (93 accounts). This is the seed a new file
 * starts from; it is applied idempotently on (org_id, account_number), so the
 * .xls is a template, not a runtime dependency. Regenerate only if the source
 * chart changes. `parent_number` is null for a root; `nature` (رئيسي/فرعي/
 * ختامي) is kept for reference, `is_posting` is what the app enforces.
 */
export default [
  {
    "number": "1",
    "name": "الموجودات",
    "parent_number": null,
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "2",
    "name": "المطاليب",
    "parent_number": null,
    "type_code": "LIABILITY",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "3",
    "name": "استخدامات",
    "parent_number": null,
    "type_code": "EXPENSE",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "رئيسي"
  },
  {
    "number": "4",
    "name": "الموارد",
    "parent_number": null,
    "type_code": "REVENUE",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "رئيسي"
  },
  {
    "number": "9",
    "name": "الميزانية العمومية",
    "parent_number": null,
    "type_code": "EQUITY",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "ختامي"
  },
  {
    "number": "11",
    "name": "اصول ثابتة",
    "parent_number": "1",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "16",
    "name": "مدينون",
    "parent_number": "1",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "17",
    "name": "ذمم مختلفة",
    "parent_number": "1",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "18",
    "name": "اصول متداولة",
    "parent_number": "1",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "21",
    "name": "رؤوس اموال",
    "parent_number": "2",
    "type_code": "LIABILITY",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "24",
    "name": "مجمع اهتلاك",
    "parent_number": "2",
    "type_code": "LIABILITY",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "26",
    "name": "دائنون",
    "parent_number": "2",
    "type_code": "LIABILITY",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "27",
    "name": "ضرائب و رسوم",
    "parent_number": "2",
    "type_code": "LIABILITY",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "31",
    "name": "المشتريات",
    "parent_number": "3",
    "type_code": "EXPENSE",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "رئيسي"
  },
  {
    "number": "32",
    "name": "المصروفات",
    "parent_number": "3",
    "type_code": "EXPENSE",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "رئيسي"
  },
  {
    "number": "41",
    "name": "المبيعات",
    "parent_number": "4",
    "type_code": "REVENUE",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "رئيسي"
  },
  {
    "number": "42",
    "name": "الايرادات",
    "parent_number": "4",
    "type_code": "REVENUE",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "رئيسي"
  },
  {
    "number": "91",
    "name": "الارباح و الخسائر",
    "parent_number": "9",
    "type_code": "EQUITY",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "ختامي"
  },
  {
    "number": "92",
    "name": "المتاجرة",
    "parent_number": "91",
    "type_code": "EQUITY",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "ختامي"
  },
  {
    "number": "93",
    "name": "توزيع الارباح و الخسائر",
    "parent_number": "9",
    "type_code": "EQUITY",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "ختامي"
  },
  {
    "number": "111",
    "name": "مباني و تجهيزات",
    "parent_number": "11",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "112",
    "name": "المخزون و المستودعات",
    "parent_number": "11",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "المتاجرة",
    "nature": "رئيسي"
  },
  {
    "number": "162",
    "name": "مدينون مختلفون",
    "parent_number": "16",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "165",
    "name": "الموظفون و العمال",
    "parent_number": "16",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "166",
    "name": "وكلاء و مندوبين",
    "parent_number": "16",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "171",
    "name": "جاري حساب الشركاء",
    "parent_number": "17",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "261",
    "name": "موردون",
    "parent_number": "26",
    "type_code": "LIABILITY",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "263",
    "name": "دائنون مختلفون",
    "parent_number": "26",
    "type_code": "LIABILITY",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "264",
    "name": "اوراق مالية دائنة",
    "parent_number": "26",
    "type_code": "LIABILITY",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "265",
    "name": "الشيكات الصادرة",
    "parent_number": "26",
    "type_code": "LIABILITY",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "311",
    "name": "اجمالي المشتريات",
    "parent_number": "31",
    "type_code": "EXPENSE",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "رئيسي"
  },
  {
    "number": "321",
    "name": "الصيانات",
    "parent_number": "32",
    "type_code": "EXPENSE",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "رئيسي"
  },
  {
    "number": "322",
    "name": "مصاريف متنوعة",
    "parent_number": "32",
    "type_code": "EXPENSE",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "رئيسي"
  },
  {
    "number": "323",
    "name": "الاجور",
    "parent_number": "32",
    "type_code": "EXPENSE",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "رئيسي"
  },
  {
    "number": "325",
    "name": "اعباء الاهتلاك",
    "parent_number": "32",
    "type_code": "EXPENSE",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "رئيسي"
  },
  {
    "number": "411",
    "name": "اجمالي المبيعات",
    "parent_number": "41",
    "type_code": "REVENUE",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "رئيسي"
  },
  {
    "number": "421",
    "name": "ايرادات مختلفة",
    "parent_number": "42",
    "type_code": "REVENUE",
    "is_posting": false,
    "statement_section": "الارباح و الخسائر",
    "nature": "رئيسي"
  },
  {
    "number": "1601",
    "name": "العملاء",
    "parent_number": "16",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "1602",
    "name": "اوراق مالية مدينة",
    "parent_number": "16",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "1801",
    "name": "الصناديق",
    "parent_number": "18",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "1802",
    "name": "البنوك",
    "parent_number": "18",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "1803",
    "name": "الشيكات الواردة",
    "parent_number": "18",
    "type_code": "ASSET",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "2101",
    "name": "الشركاء",
    "parent_number": "21",
    "type_code": "LIABILITY",
    "is_posting": false,
    "statement_section": "الحساب الختامي",
    "nature": "رئيسي"
  },
  {
    "number": "2102",
    "name": "اشعار مدين ودائن",
    "parent_number": "21",
    "type_code": "LIABILITY",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "2103",
    "name": "ارصدة ابتدائية",
    "parent_number": "21",
    "type_code": "LIABILITY",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "2401",
    "name": "مجمع اهتلاك المباني",
    "parent_number": "24",
    "type_code": "LIABILITY",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "2402",
    "name": "مجمع اهتلاك الالات و المعدات",
    "parent_number": "24",
    "type_code": "LIABILITY",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "17101",
    "name": "جاري الشريك رقم 1",
    "parent_number": "171",
    "type_code": "ASSET",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "27001",
    "name": "ضريبة القيمة المضافة",
    "parent_number": "27",
    "type_code": "LIABILITY",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "31101",
    "name": "المشتريات",
    "parent_number": "311",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "المتاجرة",
    "nature": "فرعي"
  },
  {
    "number": "31102",
    "name": "مردودات المشتريات",
    "parent_number": "311",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "المتاجرة",
    "nature": "فرعي"
  },
  {
    "number": "31103",
    "name": "مصاريف نقل المشتريات",
    "parent_number": "311",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "المتاجرة",
    "nature": "فرعي"
  },
  {
    "number": "31104",
    "name": "الحسم المكتسب",
    "parent_number": "311",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "المتاجرة",
    "nature": "فرعي"
  },
  {
    "number": "32101",
    "name": "صيانة الالات",
    "parent_number": "321",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "الارباح و الخسائر",
    "nature": "فرعي"
  },
  {
    "number": "32201",
    "name": "ايجارات",
    "parent_number": "322",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "الارباح و الخسائر",
    "nature": "فرعي"
  },
  {
    "number": "32202",
    "name": "كهرباء و مياه",
    "parent_number": "322",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "الارباح و الخسائر",
    "nature": "فرعي"
  },
  {
    "number": "32203",
    "name": "بريد و هاتف",
    "parent_number": "322",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "الارباح و الخسائر",
    "nature": "فرعي"
  },
  {
    "number": "32204",
    "name": "عمولات",
    "parent_number": "322",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "الارباح و الخسائر",
    "nature": "فرعي"
  },
  {
    "number": "32205",
    "name": "نفقات تدفئة",
    "parent_number": "322",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "الارباح و الخسائر",
    "nature": "فرعي"
  },
  {
    "number": "32206",
    "name": "مصاريف مختلفة",
    "parent_number": "322",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "الارباح و الخسائر",
    "nature": "فرعي"
  },
  {
    "number": "32301",
    "name": "اجور الموظفين",
    "parent_number": "323",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "الارباح و الخسائر",
    "nature": "فرعي"
  },
  {
    "number": "32302",
    "name": "خصميات الموظفين",
    "parent_number": "323",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "الارباح و الخسائر",
    "nature": "فرعي"
  },
  {
    "number": "32303",
    "name": "مكافآت الموظفين",
    "parent_number": "323",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "الارباح و الخسائر",
    "nature": "فرعي"
  },
  {
    "number": "32501",
    "name": "اعباء اهتلاك المباني",
    "parent_number": "325",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "الارباح و الخسائر",
    "nature": "فرعي"
  },
  {
    "number": "32502",
    "name": "اعباء اهتلاك الالات و المعدات",
    "parent_number": "325",
    "type_code": "EXPENSE",
    "is_posting": true,
    "statement_section": "الارباح و الخسائر",
    "nature": "فرعي"
  },
  {
    "number": "41101",
    "name": "المبيعات",
    "parent_number": "411",
    "type_code": "REVENUE",
    "is_posting": true,
    "statement_section": "المتاجرة",
    "nature": "فرعي"
  },
  {
    "number": "41102",
    "name": "مردودات المبيعات",
    "parent_number": "411",
    "type_code": "REVENUE",
    "is_posting": true,
    "statement_section": "المتاجرة",
    "nature": "فرعي"
  },
  {
    "number": "41103",
    "name": "الحسم الممنوح",
    "parent_number": "411",
    "type_code": "REVENUE",
    "is_posting": true,
    "statement_section": "المتاجرة",
    "nature": "فرعي"
  },
  {
    "number": "111001",
    "name": "ابنية و اراضي",
    "parent_number": "111",
    "type_code": "ASSET",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "111002",
    "name": "تجهيزات",
    "parent_number": "111",
    "type_code": "ASSET",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "111003",
    "name": "الالات",
    "parent_number": "111",
    "type_code": "ASSET",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "111004",
    "name": "معدات",
    "parent_number": "111",
    "type_code": "ASSET",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "111005",
    "name": "اثاث و مفروشات",
    "parent_number": "111",
    "type_code": "ASSET",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "112001",
    "name": "بضاعة اول مدة",
    "parent_number": "112",
    "type_code": "ASSET",
    "is_posting": true,
    "statement_section": "المتاجرة",
    "nature": "فرعي"
  },
  {
    "number": "112002",
    "name": "بضاعة آخر مدة",
    "parent_number": "112",
    "type_code": "ASSET",
    "is_posting": true,
    "statement_section": "المتاجرة",
    "nature": "فرعي"
  },
  {
    "number": "112003",
    "name": "الاجازات",
    "parent_number": "112",
    "type_code": "ASSET",
    "is_posting": true,
    "statement_section": "المتاجرة",
    "nature": "فرعي"
  },
  {
    "number": "112004",
    "name": "تلف مواد",
    "parent_number": "112",
    "type_code": "ASSET",
    "is_posting": true,
    "statement_section": "المتاجرة",
    "nature": "فرعي"
  },
  {
    "number": "261001",
    "name": "مورد نقدي",
    "parent_number": "261",
    "type_code": "CASH",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "264001",
    "name": "اوراق دفع",
    "parent_number": "264",
    "type_code": "LIABILITY",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "265001",
    "name": "شيكات صادرة بنك ؟",
    "parent_number": "265",
    "type_code": "BANK",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "265002",
    "name": "شيكات مرجعة بنك ؟",
    "parent_number": "265",
    "type_code": "BANK",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "1601001",
    "name": "عميل نقدي",
    "parent_number": "1601",
    "type_code": "CASH",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "1602001",
    "name": "اوراق قبض",
    "parent_number": "1602",
    "type_code": "ASSET",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "1801001",
    "name": "صندوق الكاش شيقل",
    "parent_number": "1801",
    "type_code": "CASH",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "1801002",
    "name": "VISA",
    "parent_number": "1801",
    "type_code": "BANK",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "1801003",
    "name": "الصندوق",
    "parent_number": "1801",
    "type_code": "CASH",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "1801004",
    "name": "صندوق دينار",
    "parent_number": "1801",
    "type_code": "CASH",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "1801005",
    "name": "صندوق دولار",
    "parent_number": "1801",
    "type_code": "CASH",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "1802001",
    "name": "البنك ؟",
    "parent_number": "1802",
    "type_code": "BANK",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "1803001",
    "name": "حافظة الشيكات الواردة",
    "parent_number": "1803",
    "type_code": "ASSET",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "1803002",
    "name": "حافظة الشيكات المرجعة",
    "parent_number": "1803",
    "type_code": "ASSET",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "1803003",
    "name": "شيكات برسم التحصيل بنك ؟",
    "parent_number": "1803",
    "type_code": "BANK",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  },
  {
    "number": "2101001",
    "name": "شريك رقم 1",
    "parent_number": "2101",
    "type_code": "LIABILITY",
    "is_posting": true,
    "statement_section": "الحساب الختامي",
    "nature": "فرعي"
  }
];
