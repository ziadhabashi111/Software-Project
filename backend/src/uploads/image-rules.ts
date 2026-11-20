import { Role } from '../auth/auth.types';

/**
 * GEN-08: the shared media-upload rule.
 * JPG or PNG only, up to 5 MB each, up to 5 images per post, activity or
 * hotel, and 1 logo per airline.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const IMAGE_LIMITS = {
  post: 5,
  activity: 5,
  hotel: 5,
  airlineLogo: 1,
} as const;

export type ImageOwnerKind = keyof typeof IMAGE_LIMITS;

/**
 * Who may upload images for each kind of item: users own posts and
 * activities, an airline moderator the airline logo, a hotel moderator the
 * hotel photos.
 */
export const UPLOADER_ROLE: Record<ImageOwnerKind, Role> = {
  post: Role.USER,
  activity: Role.USER,
  hotel: Role.HOTEL_MODERATOR,
  airlineLogo: Role.AIRLINE_MODERATOR,
};

/** The most files one upload request may carry (the largest limit). */
export const MAX_FILES_PER_REQUEST = Math.max(...Object.values(IMAGE_LIMITS));

export type ImageType = 'jpg' | 'png';

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (data: Uint8Array, signature: number[]): boolean =>
  data.length >= signature.length &&
  signature.every((byte, index) => data[index] === byte);

/**
 * Detects the real format from the file's first bytes, so a renamed `.exe`
 * or a wrong Content-Type cannot slip through. Returns null for anything that
 * is not a JPG or PNG.
 */
export function detectImageType(data: Uint8Array): ImageType | null {
  if (startsWith(data, JPEG_SIGNATURE)) return 'jpg';
  if (startsWith(data, PNG_SIGNATURE)) return 'png';
  return null;
}

export const IMAGE_CONTENT_TYPES: Record<ImageType, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
};
