import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { UploadsService } from '../uploads/uploads.service';
import { ActivityImagesService } from './activity-images.service';
import type { ItineraryRepository } from './itinerary.repository';

const ME = new Types.ObjectId().toString();
const me = { id: ME, role: Role.USER };
const ACTIVITY = new Types.ObjectId();

const image = (url: string) => ({ _id: new Types.ObjectId(), url });

function itinerary(owner: string, urls: string[] = []) {
  return {
    id: 'i1',
    owner: new Types.ObjectId(owner),
    days: [
      {
        _id: new Types.ObjectId(),
        activities: [
          { _id: ACTIVITY, name: 'Pyramids', images: urls.map(image) },
        ],
      },
    ],
  };
}

const files = [{ buffer: Buffer.from([1]), size: 1 }];

function build(
  doc: ReturnType<typeof itinerary> | null,
  options: { stored?: string[]; removeFails?: boolean } = {},
) {
  const repository = {
    findByActivityId: jest.fn().mockResolvedValue(doc),
    // Like the real one: runs the change, and a throw becomes a rejection.
    change: jest.fn(
      (
        _id: string,
        _user: unknown,
        fn: (d: NonNullable<typeof doc>) => unknown,
      ) => {
        try {
          return Promise.resolve({
            itinerary: doc,
            result: fn(doc as NonNullable<typeof doc>),
          });
        } catch (error) {
          return Promise.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      },
    ),
  };
  const uploads = {
    saveImages: jest.fn().mockResolvedValue(
      (options.stored ?? ['http://x/uploads/new.png']).map((url) => ({
        id: url.split('/').pop(),
        url,
      })),
    ),
    assertCanAdd: jest.fn(),
    remove: options.removeFails
      ? jest.fn().mockRejectedValue(new Error('disk'))
      : jest.fn().mockResolvedValue(true),
  };
  const service = new ActivityImagesService(
    repository as unknown as ItineraryRepository,
    uploads as unknown as UploadsService,
  );
  return { service, repository, uploads };
}

describe('ActivityImagesService.add (ITN-12)', () => {
  it('stores the files for the uploader and attaches them to the activity', async () => {
    const doc = itinerary(ME, ['http://x/uploads/old.png']);
    const { service, uploads } = build(doc);
    const view = await service.add(me, ACTIVITY.toString(), files);

    expect(uploads.saveImages).toHaveBeenCalledWith(files, 'activity', ME, 1);
    expect(view.images.map((i) => i.url)).toEqual([
      'http://x/uploads/old.png',
      'http://x/uploads/new.png',
    ]);
    expect(doc.days[0].activities[0].images).toHaveLength(2);
  });

  it('answers 404 for someone else’s activity and stores nothing', async () => {
    const { service, uploads } = build(
      itinerary(new Types.ObjectId().toString()),
    );
    await expect(
      service.add(me, ACTIVITY.toString(), files),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(uploads.saveImages).not.toHaveBeenCalled();
  });

  it('answers 404 for an activity that does not exist', async () => {
    const { service, uploads } = build(null);
    await expect(
      service.add(me, ACTIVITY.toString(), files),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(uploads.saveImages).not.toHaveBeenCalled();
  });

  it('removes the stored files again when the 5-image limit was reached meanwhile', async () => {
    const { service, uploads } = build(itinerary(ME));
    uploads.assertCanAdd.mockImplementation(() => {
      throw new BadRequestException('At most 5 images');
    });
    await expect(
      service.add(me, ACTIVITY.toString(), files),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(uploads.remove).toHaveBeenCalledWith('http://x/uploads/new.png', ME);
  });

  it('rejects files that break the upload rules before attaching anything', async () => {
    const doc = itinerary(ME);
    const { service, uploads, repository } = build(doc);
    uploads.saveImages.mockRejectedValueOnce(
      new BadRequestException('Not a JPG or PNG'),
    );
    await expect(
      service.add(me, ACTIVITY.toString(), files),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.change).not.toHaveBeenCalled();
    expect(doc.days[0].activities[0].images).toHaveLength(0);
  });
});

describe('ActivityImagesService.remove (ITN-12)', () => {
  it('takes the image off the activity and deletes its file', async () => {
    const doc = itinerary(ME, [
      'http://x/uploads/a.png',
      'http://x/uploads/b.png',
    ]);
    const target = doc.days[0].activities[0].images[0];
    const { service, uploads } = build(doc);
    const view = await service.remove(
      me,
      ACTIVITY.toString(),
      target._id.toString(),
    );

    expect(view.images.map((i) => i.url)).toEqual(['http://x/uploads/b.png']);
    expect(uploads.remove).toHaveBeenCalledWith('http://x/uploads/a.png', ME);
  });

  it('answers 404 for an image that is not on the activity, and deletes no file', async () => {
    const { service, uploads } = build(
      itinerary(ME, ['http://x/uploads/a.png']),
    );
    await expect(
      service.remove(me, ACTIVITY.toString(), new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(uploads.remove).not.toHaveBeenCalled();
  });

  it('answers 404 for someone else’s activity', async () => {
    const doc = itinerary(new Types.ObjectId().toString(), [
      'http://x/uploads/a.png',
    ]);
    const { service, uploads } = build(doc);
    await expect(
      service.remove(
        me,
        ACTIVITY.toString(),
        doc.days[0].activities[0].images[0]._id.toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(uploads.remove).not.toHaveBeenCalled();
  });

  it('still succeeds when the file cannot be deleted (the image is already gone from the activity)', async () => {
    const doc = itinerary(ME, ['http://x/uploads/a.png']);
    const { service } = build(doc, { removeFails: true });
    await expect(
      service.remove(
        me,
        ACTIVITY.toString(),
        doc.days[0].activities[0].images[0]._id.toString(),
      ),
    ).resolves.toMatchObject({ images: [] });
  });
});

describe('ActivityImagesService.discard (ITN-12: deleted activities, days and itineraries)', () => {
  it('deletes every file for the owner, and keeps going if one fails', async () => {
    const { service, uploads } = build(null, { removeFails: true });
    await expect(
      service.discard(['http://x/uploads/a.png', 'http://x/uploads/b.png'], ME),
    ).resolves.toBeUndefined();
    expect(uploads.remove).toHaveBeenCalledTimes(2);
  });
});
