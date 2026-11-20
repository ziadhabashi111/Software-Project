import { Types } from 'mongoose';
import { remapToClone } from './budget-clone';

describe('remapToClone (ITN-21: budgets follow the cloned days)', () => {
  const oldDay1 = new Types.ObjectId();
  const oldDay2 = new Types.ObjectId();
  const newDay1 = new Types.ObjectId();
  const newDay2 = new Types.ObjectId();
  const dayIdMap = {
    [oldDay1.toString()]: newDay1.toString(),
    [oldDay2.toString()]: newDay2.toString(),
  };
  const clone = new Types.ObjectId();

  it('points each row at the new itinerary and the new day, keeping the rest', () => {
    const rows = [
      { dayId: oldDay1, category: 'food', amount: 40, currency: 'EUR' },
      { dayId: oldDay2, category: 'activities', amount: 10, currency: 'USD' },
    ];
    const copies = remapToClone(rows, dayIdMap, clone);
    expect(copies).toEqual([
      {
        itineraryId: clone,
        dayId: newDay1,
        category: 'food',
        amount: 40,
        currency: 'EUR',
      },
      {
        itineraryId: clone,
        dayId: newDay2,
        category: 'activities',
        amount: 10,
        currency: 'USD',
      },
    ]);
  });

  it('skips a row whose day was not cloned, instead of attaching it to the wrong day', () => {
    const stray = { dayId: new Types.ObjectId(), amount: 5 };
    expect(remapToClone([stray], dayIdMap, clone)).toEqual([]);
  });

  it('does not change the original rows', () => {
    const row = { dayId: oldDay1, amount: 1 };
    remapToClone([row], dayIdMap, clone);
    expect(row.dayId).toBe(oldDay1);
    expect('itineraryId' in row).toBe(false);
  });
});
