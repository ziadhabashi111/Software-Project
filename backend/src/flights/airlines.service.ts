import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { ProviderDirectory, ProviderType } from '../admin/provider-directory';
import type {
  ProviderChange,
  ProviderHandler,
} from '../admin/provider-directory';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { fieldError } from '../common/validation/validation-errors';
import { assertOwnAirline, isOwnAirlineModerator } from './airline-access';
import { normalizeTiers } from './airline-policies';
import { toAirlineView } from './airline-view';
import type { AirlineView } from './airline-view';
import { BaggagePolicyDto } from './dto/baggage-policy.dto';
import { CancellationPolicyDto } from './dto/cancellation-policy.dto';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { Airline } from './schemas/airline.schema';
import type { AirlineDocument } from './schemas/airline.schema';

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

const codeTaken = () =>
  fieldError('code', 'Another airline already uses this code', 409);

/** FLT-01, FLT-08, FLT-09 and the provider switch used by the admin (ACC-15). */
@Injectable()
export class AirlinesService implements OnModuleInit, ProviderHandler {
  constructor(
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    private readonly directory: ProviderDirectory,
  ) {}

  onModuleInit(): void {
    this.directory.register(ProviderType.AIRLINE, this);
  }

  /** FLT-01: admin creates the airline profile. */
  async create(dto: CreateAirlineDto): Promise<AirlineView> {
    try {
      const airline = await this.airlines.create({
        name: dto.name,
        code: dto.code,
      });
      return toAirlineView(airline);
    } catch (error) {
      if (isDuplicateKey(error)) throw codeTaken();
      throw error;
    }
  }

  /**
   * A deactivated airline is hidden from everyone except admins and its own
   * moderator (ACC-15), so it answers 404 like a missing one.
   */
  async get(id: string, user?: AuthUser): Promise<AirlineView> {
    const airline = await this.airlines.findById(id);
    const canSeeInactive =
      user?.role === Role.ADMIN || isOwnAirlineModerator(user, id);
    if (!airline || (!airline.isActive && !canSeeInactive)) {
      throw new NotFoundException('Airline not found');
    }
    return toAirlineView(airline);
  }

  /** FLT-01: the airline's own moderator edits name, code and logo. */
  async update(
    id: string,
    user: AuthUser,
    dto: UpdateAirlineDto,
  ): Promise<AirlineView> {
    assertOwnAirline(user, id);
    const changes: Partial<Pick<Airline, 'name' | 'code' | 'logoUrl'>> = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.code !== undefined) changes.code = dto.code;
    if (dto.logoUrl !== undefined) changes.logoUrl = dto.logoUrl;
    return this.apply(id, changes);
  }

  /** FLT-08 */
  async setBaggagePolicy(
    id: string,
    user: AuthUser,
    dto: BaggagePolicyDto,
  ): Promise<AirlineView> {
    assertOwnAirline(user, id);
    return this.apply(id, {
      baggagePolicy: {
        extraBagPrice: dto.extraBagPrice,
        maxExtraBags: dto.maxExtraBags,
      },
    });
  }

  /** FLT-09 */
  async setCancellationPolicy(
    id: string,
    user: AuthUser,
    dto: CancellationPolicyDto,
  ): Promise<AirlineView> {
    assertOwnAirline(user, id);
    return this.apply(id, { cancellationPolicy: normalizeTiers(dto.tiers) });
  }

  /** Reads an airline for other modules (flights, bookings). Active only unless told otherwise. */
  async findForFlights(
    id: string,
    options: { includeInactive?: boolean } = {},
  ): Promise<AirlineDocument | null> {
    const airline = await this.airlines.findById(id);
    if (!airline) return null;
    if (!airline.isActive && !options.includeInactive) return null;
    return airline;
  }

  /** Airlines by id, for building flight results in one query. */
  findByIds(ids: string[]): Promise<AirlineDocument[]> {
    return this.airlines.find({ _id: { $in: ids } });
  }

  /** Ids of airlines that are not deactivated: only their flights are searchable (ACC-15). */
  async findActiveIds(): Promise<Types.ObjectId[]> {
    const rows = await this.airlines.find({ isActive: true }).select('_id');
    return rows.map((row) => row._id);
  }

  // ProviderHandler (ACC-13, ACC-15) -----------------------------------

  async exists(id: string): Promise<boolean> {
    return (await this.airlines.exists({ _id: id })) !== null;
  }

  async setActive(id: string, active: boolean): Promise<ProviderChange | null> {
    const airline = await this.airlines.findById(id);
    if (!airline) return null;
    const changed = airline.isActive !== active;
    if (changed) {
      airline.isActive = active;
      await airline.save();
    }
    // Travellers with Confirmed bookings are added once flight bookings exist.
    return { name: airline.name, changed, affectedUserIds: [] };
  }

  private async apply(
    id: string,
    changes: Partial<Airline>,
  ): Promise<AirlineView> {
    try {
      const airline = await this.airlines.findByIdAndUpdate(
        id,
        { $set: changes },
        { returnDocument: 'after', runValidators: true },
      );
      if (!airline) throw new NotFoundException('Airline not found');
      return toAirlineView(airline);
    } catch (error) {
      if (isDuplicateKey(error)) throw codeTaken();
      throw error;
    }
  }
}
