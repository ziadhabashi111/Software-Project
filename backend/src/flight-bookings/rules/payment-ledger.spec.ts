import { allocateRefund, ledgerOf } from './payment-ledger';

describe('payment ledger (FLT-27, PAY-03)', () => {
  it('starts from the original payment when a booking has no ledger yet', () => {
    expect(
      ledgerOf({
        payment: { paymentIntentId: 'pi_1', amount: 300 },
        price: { total: 300 },
      }),
    ).toEqual([{ paymentIntentId: 'pi_1', amount: 300, refunded: 0 }]);
    expect(ledgerOf({ price: { total: 300 } })).toEqual([]);
  });

  it('keeps an existing ledger as it is', () => {
    const payments = [
      { paymentIntentId: 'pi_1', amount: 200, refunded: 0 },
      { paymentIntentId: 'pi_2', amount: 60, refunded: 0 },
    ];
    expect(
      ledgerOf({
        payments,
        payment: { paymentIntentId: 'pi_1', amount: 200 },
        price: { total: 260 },
      }),
    ).toEqual(payments);
  });

  it('takes a refund from the newest payment first, never more than what is left on each', () => {
    const { parts, ledger } = allocateRefund(
      [
        { paymentIntentId: 'pi_1', amount: 200, refunded: 0 },
        { paymentIntentId: 'pi_2', amount: 60, refunded: 10 },
      ],
      120,
    );
    expect(parts).toEqual([
      { paymentIntentId: 'pi_2', amount: 50 },
      { paymentIntentId: 'pi_1', amount: 70 },
    ]);
    expect(ledger).toEqual([
      { paymentIntentId: 'pi_1', amount: 200, refunded: 70 },
      { paymentIntentId: 'pi_2', amount: 60, refunded: 60 },
    ]);
  });

  it('rounds to cents and skips fully refunded payments', () => {
    const { parts } = allocateRefund(
      [
        { paymentIntentId: 'pi_1', amount: 100.1, refunded: 0 },
        { paymentIntentId: 'pi_2', amount: 20.2, refunded: 20.2 },
      ],
      30.3,
    );
    expect(parts).toEqual([{ paymentIntentId: 'pi_1', amount: 30.3 }]);
  });

  it('refuses to refund more than was paid', () => {
    expect(() =>
      allocateRefund(
        [{ paymentIntentId: 'pi_1', amount: 50, refunded: 0 }],
        60,
      ),
    ).toThrow('more than was paid');
  });
});
