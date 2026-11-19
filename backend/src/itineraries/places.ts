import { Injectable } from '@nestjs/common';

/**
 * The predefined country and city lists (GEN-12), owned by the reference-data
 * module (Ahmed's seed). That module registers its lists here in
 * `onModuleInit`. Until it does, a country only has to look like a two-letter
 * code (`EG`) and a city like a lower-case id (`cairo`).
 */
export interface PlaceLists {
  isCountry(code: string): Promise<boolean>;
  isCity(id: string): Promise<boolean>;
  /**
   * The countries and cities whose code, id or name contains the keyword, so
   * a visitor can search public itineraries for "egypt" or "cairo" (ITN-21).
   * Optional: without it only the title and exact codes are searched.
   */
  matchKeyword?(
    keyword: string,
  ): Promise<{ countryCodes: string[]; cityIds: string[] }>;
}

@Injectable()
export class PlaceCatalog {
  private lists?: PlaceLists;

  register(lists: PlaceLists): void {
    this.lists = lists;
  }

  get(): PlaceLists | undefined {
    return this.lists;
  }
}
