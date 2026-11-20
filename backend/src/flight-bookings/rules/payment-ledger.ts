import { roundMoney } from './pricing';

/** One Stripe payment a booking was paid with (FLT-27). */
export interface LedgerEntry {
  paymentIntentId: string;
  /** Major units charged. */
  amount: number;
  /** Major units already promised back (refunds created or reserved). */
  refunded: number;
}

/** A piece of a refund, taken from one payment. */
export interface RefundPart {
  paymentIntentId: string;
  amount: number;
}

/**
 * Every payment of a booking. Bookings that were never changed have no
 * ledger: their single original payment is the ledger.
 */
export function ledgerOf(doc: {
  payments?: LedgerEntry[] | null;
  payment?: { paymentIntentId?: string; amount?: number } | null;
  price: { total: number };
}): LedgerEntry[] {
  if (doc.payments && doc.payments.length > 0) {
    return doc.payments.map((p) => ({
      paymentIntentId: p.paymentIntentId,
      amount: p.amount,
      refunded: p.refunded ?? 0,
    }));
  }
  if (!doc.payment?.paymentIntentId) return [];
  return [
    {
      paymentIntentId: doc.payment.paymentIntentId,
      amount: doc.payment.amount ?? doc.price.total,
      refunded: 0,
    },
  ];
}

/**
 * Splits a refund over the payments, newest first, never taking more than
 * what is left on a payment (Stripe refuses that). Returns the parts and the
 * ledger with the parts counted as refunded.
 */
export function allocateRefund(
  ledger: LedgerEntry[],
  amount: number,
): { parts: RefundPart[]; ledger: LedgerEntry[] } {
  let left = roundMoney(amount);
  const updated = ledger.map((entry) => ({ ...entry }));
  const parts: RefundPart[] = [];
  for (let i = updated.length - 1; i >= 0 && left > 0; i -= 1) {
    const entry = updated[i];
    const available = roundMoney(entry.amount - entry.refunded);
    if (available <= 0) continue;
    const take = roundMoney(Math.min(available, left));
    parts.push({ paymentIntentId: entry.paymentIntentId, amount: take });
    entry.refunded = roundMoney(entry.refunded + take);
    left = roundMoney(left - take);
  }
  if (left > 0) {
    throw new Error('Cannot refund more than was paid for this booking');
  }
  return { parts, ledger: updated };
}
