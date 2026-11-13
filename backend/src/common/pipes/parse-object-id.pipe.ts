import { Injectable, NotFoundException, PipeTransform } from '@nestjs/common';

const OBJECT_ID = /^[a-f\d]{24}$/i;

/**
 * Route ids that are not a MongoDB id cannot exist, so they answer 404 (not
 * 400, and never a 500 from a failed cast).
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!OBJECT_ID.test(value)) throw new NotFoundException('Not found');
    return value;
  }
}
