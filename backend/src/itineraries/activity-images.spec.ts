import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { imageUrlsOf, locateActivity } from './activity-images';

const image = (url: string) => ({ _id: new Types.ObjectId(), url });
const activity = (urls: string[]) => ({
  _id: new Types.ObjectId(),
  images: urls.map(image),
});

describe('activity image helpers (ITN-12)', () => {
  const a = activity(['http://x/uploads/1.png', 'http://x/uploads/2.png']);
  const b = activity([]);
  const c = activity(['http://x/uploads/3.jpg']);
  const days = [
    { activities: [a, b] },
    { activities: [c] },
    { activities: [] },
  ];

  it('lists every image url of the given days, in order', () => {
    expect(imageUrlsOf(days)).toEqual([
      'http://x/uploads/1.png',
      'http://x/uploads/2.png',
      'http://x/uploads/3.jpg',
    ]);
    expect(imageUrlsOf([])).toEqual([]);
  });

  it('finds an activity in any day', () => {
    expect(locateActivity(days, c._id.toString())).toBe(c);
    expect(locateActivity(days, a._id.toString())).toBe(a);
  });

  it('answers 404 for an activity that is not there', () => {
    expect(() => locateActivity(days, new Types.ObjectId().toString())).toThrow(
      NotFoundException,
    );
  });
});
