/**
 * Development seed — realistic Arabic sample data.
 * Safe to re-run: it clears the development organisation first.
 * Usage: npm run seed  (add `--force` to wipe an already-populated database)
 */
import { close, get, all, run, runInOrg } from './index.js';
import { devOrg, DEV_USER_ID } from '../lib/orgs.js';
import { createCategory } from '../services/categories.service.js';
import { createItem, addSubBarcode } from '../services/items.service.js';
import { createParty } from '../services/parties.service.js';
import {
  createInvoice, addLineByBarcode, postInvoice, recordQuickMovement,
} from '../services/invoices.service.js';

const force = process.argv.includes('--force');

/**
 * Wipe by deleting the organisation and letting the foreign keys cascade.
 *
 * The ledger's immutability trigger has to stand down for that: it is there to
 * stop the *application* from rewriting history, and a development reset is the
 * one legitimate exception. It needs ALTER permission on the table (db_ddladmin),
 * which is why this is a seed-only path and not something the API can do.
 */
async function wipeOrg(orgId) {
  await run('ALTER TABLE stock_movements DISABLE TRIGGER trg_movements_immutable_del');
  try {
    await run('DELETE FROM orgs WHERE id = @id', { id: orgId });
  } finally {
    await run('ALTER TABLE stock_movements ENABLE TRIGGER trg_movements_immutable_del');
  }
}

const CATEGORIES = ['إلكترونيات', 'قرطاسية', 'مواد غذائية', 'أدوات منزلية', 'مستلزمات مكتبية'];

const ITEMS = [
  ['لابتوب ديل انسبايرون 15', 'إلكترونيات', '6291041500213', 1800, 2350, 12],
  ['ماوس لاسلكي لوجيتك', 'إلكترونيات', '6291041500220', 45, 79, 40],
  ['لوحة مفاتيح عربي/إنجليزي', 'إلكترونيات', '6291041500237', 60, 110, 25],
  ['شاشة سامسونج 24 بوصة', 'إلكترونيات', '6291041500244', 420, 650, 8],
  ['كيبل HDMI ‏2 متر', 'إلكترونيات', '6291041500251', 12, 25, 120],
  ['قلم حبر جاف أزرق', 'قرطاسية', '6001234567890', 1.2, 2.5, 500],
  ['دفتر 100 ورقة مسطر', 'قرطاسية', '6001234567906', 3.5, 7, 220],
  ['علبة أقلام رصاص (12)', 'قرطاسية', '6001234567913', 6, 12, 90],
  ['مبراة معدنية', 'قرطاسية', '6001234567920', 0.8, 2, 300],
  ['ورق تصوير A4 ‏(رزمة)', 'مستلزمات مكتبية', '6001234567937', 14, 22, 60],
  ['دباسة متوسطة', 'مستلزمات مكتبية', '6001234567944', 9, 18, 35],
  ['حافظة ملفات بلاستيك', 'مستلزمات مكتبية', '6001234567951', 2.5, 5, 4],
  ['زيت زيتون بكر 1 لتر', 'مواد غذائية', '6281006540101', 22, 34, 48],
  ['أرز بسمتي 5 كغم', 'مواد غذائية', '6281006540118', 28, 42, 30],
  ['سكر ناعم 1 كغم', 'مواد غذائية', '6281006540125', 3.2, 5, 150],
  ['شاي أخضر 100 كيس', 'مواد غذائية', '6281006540132', 11, 19, 3],
  ['مقلاة تيفال 28 سم', 'أدوات منزلية', '6291100220015', 55, 95, 18],
  ['طقم أكواب زجاج (6)', 'أدوات منزلية', '6291100220022', 18, 35, 24],
  ['مكنسة أرضية', 'أدوات منزلية', '6291100220039', 14, 28, 0],
  ['حافظة طعام 1.5 لتر', 'أدوات منزلية', '6291100220046', 7, 15, 2],
];

const CUSTOMERS = [
  ['مؤسسة النور التجارية', '0599123456', 'info@alnoor.ps', 'رام الله — شارع الإرسال', '9876543210'],
  ['محلات الأمانة', '0598765432', 'amana@example.ps', 'نابلس — دوار الشهداء', '9876543211'],
  ['شركة الوفاء للتجهيزات', '0567891234', 'sales@alwafa.ps', 'الخليل — المنطقة الصناعية', '9876543212'],
  ['سوبرماركت السلام', '0592223344', null, 'بيت لحم — شارع المهد', null],
  ['مكتبة الرسالة', '0595556677', 'risala@example.ps', 'غزة — شارع عمر المختار', '9876543213'],
];

const SUPPLIERS = [
  ['شركة التقنية الحديثة', 'سامر خالد', '022987654', 'contact@modtech.ps', 'رام الله — البيرة', '1234567890'],
  ['مستودعات الشرق للقرطاسية', 'أحمد يوسف', '092345678', 'east@stationery.ps', 'نابلس — المنطقة الصناعية', '1234567891'],
  ['المجموعة الغذائية المتحدة', 'ليان عبد الله', '082223344', 'orders@unifood.ps', 'غزة — الرمال', '1234567892'],
  ['دار الأدوات المنزلية', 'مروان سعيد', '022556677', null, 'الخليل', '1234567893'],
];

// ---------------------------------------------------------------------------
const first = await devOrg();
const populated = await runInOrg(first.orgId, async () =>
  (await get('SELECT COUNT(*) n FROM items WHERE org_id = @org', { org: first.orgId })).n);

if (populated && !force) {
  console.log(`قاعدة البيانات تحتوي على ${populated} صنف بالفعل. استخدم --force للاستبدال.`);
  await close();
  process.exit(0);
}

if (populated) {
  console.log('[seed] wiping existing development data…');
  await wipeOrg(first.orgId);
}

// A wipe removes the membership too, so the dev user gets a fresh organisation.
const { orgId } = await devOrg();
console.log(`[seed] organisation ${orgId} (dev user ${DEV_USER_ID})`);

await runInOrg(orgId, async () => {
  console.log('[seed] creating catalogue…');

  const catIds = {};
  for (const name of CATEGORIES) catIds[name] = (await createCategory(name)).id;

  const items = [];
  for (const [name, cat, barcode, purchase, sale, opening] of ITEMS) {
    items.push({
      ...await createItem({
        name, category_id: catIds[cat], barcode,
        purchase_price: purchase, sale_price: sale,
        low_stock_threshold: cat === 'إلكترونيات' ? 5 : null,
      }),
      opening,
    });
  }

  // A couple of items carry alternate supplier / legacy barcodes.
  await addSubBarcode(items[0].id, { barcode: 'DELL-INS-15-2026', label: 'كود المورد' });
  await addSubBarcode(items[5].id, { barcode: '1200000000015', label: 'باركود قديم' });
  await addSubBarcode(items[5].id, { barcode: 'PEN-BLUE-BOX', label: 'باركود العلبة' });

  for (const [name, phone, email, address, tax] of CUSTOMERS) {
    await createParty('customers', { name, phone, email, address, tax_number: tax });
  }
  for (const [name, contact, phone, email, address, tax] of SUPPLIERS) {
    await createParty('suppliers', {
      name, contact_person: contact, phone, email, address, tax_number: tax,
    });
  }

  console.log('[seed] posting opening stock…');
  const opening = await createInvoice({
    type: 'STOCK_IN', source: 'IMPORT', note: 'أرصدة افتتاحية',
  });
  for (const it of items.filter((i) => i.opening > 0)) {
    await addLineByBarcode(opening.id, {
      item_id: it.id, quantity: it.opening, unit_price: it.purchase_price, update_item_price: false,
    });
  }
  await postInvoice(opening.id, { referenceType: 'IMPORT' });

  console.log('[seed] posting sample stock-in & stock-out invoices…');
  const suppliers = await all('SELECT id FROM suppliers WHERE org_id = @org ORDER BY name', { org: orgId });
  const customers = await all('SELECT id FROM customers WHERE org_id = @org ORDER BY name', { org: orgId });

  const purchase = await createInvoice({
    type: 'STOCK_IN', supplier_id: suppliers[0].id, note: 'طلبية إلكترونيات',
  });
  await addLineByBarcode(purchase.id, { item_id: items[1].id, quantity: 20, unit_price: 44 });
  await addLineByBarcode(purchase.id, { item_id: items[4].id, quantity: 50, unit_price: 11.5 });
  await postInvoice(purchase.id);

  const sale = await createInvoice({
    type: 'STOCK_OUT', customer_id: customers[0].id, note: 'طلب مكتبي',
  });
  await addLineByBarcode(sale.id, { item_id: items[5].id, quantity: 100, unit_price: 2.5 });
  await addLineByBarcode(sale.id, { item_id: items[9].id, quantity: 10, unit_price: 22 });
  await addLineByBarcode(sale.id, { item_id: items[6].id, quantity: 25, unit_price: 7 });
  await postInvoice(sale.id);

  // One open draft so the Invoices screen shows every status.
  const draft = await createInvoice({
    type: 'STOCK_OUT', customer_id: customers[1].id, note: 'عرض سعر قيد الإعداد',
  });
  await addLineByBarcode(draft.id, { item_id: items[16].id, quantity: 2 });

  // Spread a little movement history for the dashboard chart.
  await recordQuickMovement(items[14].id, { type: 'OUT', quantity: 20, note: 'صرف داخلي' });
  await recordQuickMovement(items[12].id, { type: 'IN', quantity: 12, note: 'مرتجع من عميل' });
  await recordQuickMovement(items[17].id, { type: 'OUT', quantity: 4, note: 'تالف' });

  const stats = await get(
    `SELECT (SELECT COUNT(*) FROM items WHERE org_id=@org) items,
            (SELECT COUNT(*) FROM categories WHERE org_id=@org) cats,
            (SELECT COUNT(*) FROM invoices WHERE org_id=@org) invoices,
            (SELECT COUNT(*) FROM stock_movements WHERE org_id=@org) movements,
            (SELECT COUNT(*) FROM customers WHERE org_id=@org) customers,
            (SELECT COUNT(*) FROM suppliers WHERE org_id=@org) suppliers`, { org: orgId });
  console.log('[seed] done:', stats);
});

await close();
