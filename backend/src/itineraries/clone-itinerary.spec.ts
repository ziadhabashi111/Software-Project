import { Types } from 'mongoose';
import { cloneDays } from './clone-itinerary';

type ActivityFields = {
  name: string;
  description?: string;
  time?: string;
  cost?: number;
  currency?: string;
};

const day = (
  city: string,
  activities: ActivityFields[] = [],
  notes?: string,
) => ({
  _id: new Types.ObjectId(),
  city,
  ...(notes ? { notes } : {}),
  activities: activities.map((activity) => ({
    _id: new Types.ObjectId(),
    images: [{ _id: new Types.ObjectId(), url: 'http://x/uploads/a.png' }],
    ...activity,
  })),
});

describe('cloneDays (ITN-21: a clone is independent of the original)', () => {
  const original = [
    day('cairo', [
      { name: 'Pyramids', time: '09:00', cost: 20, currency: 'USD' },
      { name: 'Museum', description: 'Egyptian Museum' },
    ]),
    day('luxor', [], 'Take the early train'),
  ];

  it('copies every day and activity field', () => {
    const { days } = cloneDays(original);
    expect(days.map((d) => d.city)).toEqual(['cairo', 'luxor']);
    expect(days[0].activities[0]).toMatchObject({
      name: 'Pyramids',
      time: '09:00',
      cost: 20,
      currency: 'USD',
    });
    expect(days[0].activities[1]).toMatchObject({
      name: 'Museum',
      description: 'Egyptian Museum',
    });
    expect(days[1].notes).toBe('Take the early train');
  });

  it('gives every day a new id and maps old ids to new ones for the budgets', () => {
    const { days, dayIdMap } = cloneDays(original);
    expect(Object.keys(dayIdMap)).toEqual(
      original.map((d) => d._id.toString()),
    );
    days.forEach((copy, index) => {
      const oldId = original[index]._id.toString();
      expect(copy._id.toString()).not.toBe(oldId);
      expect(dayIdMap[oldId]).toBe(copy._id.toString());
    });
  });

  it('does not copy activity images: the files belong to the original author', () => {
    const { days } = cloneDays(original);
    expect(days[0].activities.every((a) => !('images' in a))).toBe(true);
  });

  it('is a deep copy: changing the clone never changes the original', () => {
    const { days } = cloneDays(original);
    days[0].activities[0].name = 'Changed';
    days[0].city = 'giza';
    expect(original[0].activities[0].name).toBe('Pyramids');
    expect(original[0].city).toBe('cairo');
  });

  it('copies an empty itinerary', () => {
    expect(cloneDays([])).toEqual({ days: [], dayIdMap: {} });
  });
});
