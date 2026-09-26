/**
 * Vouchers — Cash Receipt (سند قبض) and Payment (سند صرف).
 *
 * A voucher is a money document that posts a balanced pair of ledger entries
 * into `transactions` the instant it is created: one debit, one credit, of the
 * same amount. Which account is debited and which credited is derived from the
 * voucher's `type`, never stored, so the two sides can never disagree:
 *
 *   • RECEIPT — money comes in.  Debit the cash/bank account (an asset grows),
 *     credit the counter account (e.g. the customer who paid settles down).
 *   • PAYMENT — money goes out.  Credit the cash/bank account (the asset
 *     shrinks), debit the counter account (e.g. the supplier or expense).
 *
 * There is no draft and no edit. A mistake is corrected by reversing the
 * voucher — a compensating pair of entries is written and the voucher marked
 * REVERSED — so both the original and the correction stay in the record. This
 * mirrors the discipline the invoice ledger already follows.
 *
 * Everything is org-scoped through the ambient context, same as the rest.
 */
import {
  all, get, run, tx, money, newId, nowIso, nextNumber, orgId, publicRow,
} from '../db/index.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';

const PREFIX = { RECEIPT: 'RCV', PAYMENT: 'PAY' };
const LABEL = { RECEIPT: 'سند قبض', PAYMENT: 'سند صرف' };

/**
 * Which account is debited and which credited, per voucher type. The single
 * source of truth for direction — the ledger writer and any future reader both
 * go through this rather than re-deriving the sign from `type`.
 */
function sidesOf(type, { cashAccountId, counterAccountId }) {
  if (type === 'RECEIPT') {
    return { debitAccount: cashAccountId, creditAccount: counterAccountId };
  }
  return { debitAccount: counterAccountId, creditAccount: cashAccountId };
}

const SELECT_VOUCHER = `
  SELECT v.*,
         ca.account_number AS cash_account_number, ca.name AS cash_account_name,
         co.account_number AS counter_account_number, co.name AS counter_account_name
    FROM vouchers v
    LEFT JOIN accounts ca ON ca.id = v.cash_account_id AND ca.org_id = v.org_id
    LEFT JOIN accounts co ON co.id = v.counter_account_id AND co.org_id = v.org_id`;

function publicVoucher(row) {
  if (!row) return row;
  return { ...publicRow(row), amount: money(row.amount) };
}

/** A posting, active account in this file, or a 4xx that says which rule failed. */
async function requirePostingAccount(id, role) {
  if (!id) throw badRequest(`حساب ${role} مطلوب`, 'ACCOUNT_REQUIRED');
  const acc = await get(
    'SELECT id, is_posting, is_active FROM accounts WHERE id = @id AND org_id = @org',
    { id, org: orgId() },
  );
  if (!acc) throw badRequest(`حساب ${role} غير موجود`, 'ACCOUNT_NOT_FOUND');
  if (!acc.is_posting) {
    throw unprocessable(`حساب ${role} حساب تجميعي — اختر حساباً تفصيلياً`, 'ACCOUNT_NOT_POSTING');
  }
  if (!acc.is_active) throw unprocessable(`حساب ${role} غير مفعّل`, 'ACCOUNT_INACTIVE');
  return acc.id;
}

/** Write the balanced debit/credit pair for one voucher into the ledger. */
async function postEntries({
  voucherId, type, cashAccountId, counterAccountId, amount, entryDate, description, by,
}) {
  const { debitAccount, creditAccount } = sidesOf(type, { cashAccountId, counterAccountId });
  const rows = [
    { account: debitAccount, debit: amount, credit: 0 },
    { account: creditAccount, debit: 0, credit: amount },
  ];
  for (const r of rows) {
    await run(
      `INSERT INTO transactions
         (id, org_id, account_id, entry_date, debit, credit, description, source_type, source_id, created_by)
       VALUES (@id, @org, @account, @date, @debit, @credit, @desc, 'VOUCHER', @src, @by)`,
      {
        id: newId(),
        org: orgId(),
        account: r.account,
        date: entryDate,
        debit: r.debit,
        credit: r.credit,
        desc: description ?? null,
        src: voucherId,
        by: by ?? null,
      },
    );
  }
}

/* ------------------------------------------------------------------ listing */
export async function listVouchers({
  type, status, party_id: partyId, search, date_from: dateFrom, date_to: dateTo,
  page = 1, limit = 25,
} = {}) {
  const params = { org: orgId() };
  const where = ['v.org_id = @org'];
  if (type) { params.type = type; where.push('v.type = @type'); }
  if (status) { params.status = status; where.push('v.status = @status'); }
  if (partyId) { params.party = partyId; where.push('v.party_id = @party'); }
  if (dateFrom) { params.from = dateFrom; where.push('v.voucher_date >= @from'); }
  if (dateTo) { params.to = dateTo; where.push('v.voucher_date <= @to'); }
  if (search && search.trim()) {
    params.q = `%${search.trim()}%`;
    where.push('(v.number LIKE @q OR v.counterparty LIKE @q OR v.description LIKE @q OR v.reference LIKE @q)');
  }
  const clause = `WHERE ${where.join(' AND ')}`;

  const { n: total } = await get(`SELECT COUNT(*) AS n FROM vouchers v ${clause}`, params);
  const rows = await all(
    `${SELECT_VOUCHER} ${clause}
      ORDER BY v.voucher_date DESC, v.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
    { ...params, limit, offset: (page - 1) * limit },
  );

  // Totals for the filtered set, per direction — the list header shows them.
  const sums = await get(
    `SELECT
        COALESCE(SUM(CASE WHEN type='RECEIPT' AND status='POSTED' THEN amount END), 0) AS receipts_total,
        COALESCE(SUM(CASE WHEN type='PAYMENT' AND status='POSTED' THEN amount END), 0) AS payments_total
       FROM vouchers v ${clause}`,
    params,
  );
  return {
    rows: rows.map(publicVoucher),
    total,
    summary: {
      receipts_total: money(sums.receipts_total),
      payments_total: money(sums.payments_total),
      net_total: money(sums.receipts_total - sums.payments_total),
    },
  };
}

export async function getVoucher(id) {
  const row = await get(`${SELECT_VOUCHER} WHERE v.id = @id AND v.org_id = @org`, { id, org: orgId() });
  if (!row) throw notFound('السند غير موجود', 'VOUCHER_NOT_FOUND');
  const voucher = publicVoucher(row);
  voucher.entries = await all(
    `SELECT t.id, t.account_id, a.account_number, a.name AS account_name,
            t.entry_date, t.debit, t.credit, t.description
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.org_id = t.org_id
      WHERE t.source_type = 'VOUCHER' AND t.source_id = @id AND t.org_id = @org
      ORDER BY t.seq`,
    { id, org: orgId() },
  );
  return voucher;
}

/* ------------------------------------------------------------------ writing */
export async function createVoucher(data, by) {
  const org = orgId();
  const type = data.type;
  if (type !== 'RECEIPT' && type !== 'PAYMENT') throw badRequest('نوع السند غير صالح', 'BAD_TYPE');

  const amount = money(data.amount);
  if (!(amount > 0)) throw badRequest('المبلغ يجب أن يكون أكبر من صفر', 'BAD_AMOUNT');

  const cashAccountId = await requirePostingAccount(data.cash_account_id, 'الصندوق/البنك');
  const counterAccountId = await requirePostingAccount(data.counter_account_id, 'الطرف المقابل');
  if (cashAccountId === counterAccountId) {
    throw unprocessable('لا يمكن أن يكون الحسابان متطابقين', 'SAME_ACCOUNT');
  }

  return tx(async () => {
    const id = newId();
    const number = await nextNumber(`voucher:${type}`, PREFIX[type]);
    const voucherDate = data.voucher_date || nowIso().slice(0, 10);
    const description = data.description?.trim() || null;
    await run(
      `INSERT INTO vouchers
         (id, org_id, type, number, voucher_date, cash_account_id, counter_account_id,
          amount, party_type, party_id, counterparty, payment_method, reference,
          description, created_by)
       VALUES (@id, @org, @type, @number, @date, @cash, @counter,
               @amount, @ptype, @pid, @cpty, @method, @ref, @desc, @by)`,
      {
        id,
        org,
        type,
        number,
        date: voucherDate,
        cash: cashAccountId,
        counter: counterAccountId,
        amount,
        ptype: data.party_type ?? null,
        pid: data.party_id ?? null,
        cpty: data.counterparty?.trim() || null,
        method: data.payment_method || 'CASH',
        ref: data.reference?.trim() || null,
        desc: description,
        by: by ?? null,
      },
    );
    await postEntries({
      voucherId: id,
      type,
      cashAccountId,
      counterAccountId,
      amount,
      entryDate: voucherDate,
      description: description || `${LABEL[type]} ${number}`,
      by,
    });
    return getVoucher(id);
  });
}

/**
 * Reverse a posted voucher: write the compensating (swapped) pair of entries
 * and mark it REVERSED. Nothing already written is touched — the original
 * entries and the reversing entries both stay in the ledger, so an account
 * statement shows the whole story. Manager-only at the route.
 */
export async function reverseVoucher(id, by) {
  const voucher = await getVoucher(id); // 404s if missing
  if (voucher.status === 'REVERSED') {
    throw unprocessable('السند معكوس بالفعل', 'ALREADY_REVERSED');
  }
  return tx(async () => {
    // Swapped direction: a RECEIPT is undone by a PAYMENT-shaped pair, and
    // vice versa, which sidesOf gives us by flipping the type.
    const flipped = voucher.type === 'RECEIPT' ? 'PAYMENT' : 'RECEIPT';
    await postEntries({
      voucherId: id,
      type: flipped,
      cashAccountId: voucher.cash_account_id,
      counterAccountId: voucher.counter_account_id,
      amount: money(voucher.amount),
      entryDate: nowIso().slice(0, 10),
      description: `عكس ${LABEL[voucher.type]} ${voucher.number}`,
      by,
    });
    await run(
      `UPDATE vouchers SET status = 'REVERSED', reversed_at = @now, reversed_by = @by
        WHERE id = @id AND org_id = @org`,
      { id, org: orgId(), now: nowIso(), by: by ?? null },
    );
    return getVoucher(id);
  });
}
