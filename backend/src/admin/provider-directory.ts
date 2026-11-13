import { Injectable } from '@nestjs/common';

export enum ProviderType {
  HOTEL = 'hotel',
  AIRLINE = 'airline',
}

export interface ProviderChange {
  /** Display name, used in messages and the response. */
  name: string;
  /** False when the provider was already in the requested state. */
  changed: boolean;
  /** Travellers with a Confirmed booking, to notify as well (ACC-15). */
  affectedUserIds?: string[];
}

/** Implemented by the airlines and hotels modules (ACC-13, ACC-15). */
export interface ProviderHandler {
  exists(id: string): Promise<boolean>;
  /**
   * Hides (`false`) or restores (`true`) the provider: a deactivated provider
   * is hidden from search and cannot be booked, existing Confirmed bookings
   * stay valid. Returns `null` when the provider does not exist.
   */
  setActive(id: string, active: boolean): Promise<ProviderChange | null>;
}

/**
 * The admin module needs to check and (de)activate airlines and hotels
 * without depending on those modules. Each of them registers itself:
 *
 *   constructor(directory: ProviderDirectory) {}
 *   onModuleInit() { this.directory.register(ProviderType.HOTEL, this); }
 */
@Injectable()
export class ProviderDirectory {
  private readonly handlers = new Map<ProviderType, ProviderHandler>();

  register(type: ProviderType, handler: ProviderHandler): void {
    this.handlers.set(type, handler);
  }

  /** `undefined` while that module has not registered (not built yet). */
  get(type: ProviderType): ProviderHandler | undefined {
    return this.handlers.get(type);
  }
}
