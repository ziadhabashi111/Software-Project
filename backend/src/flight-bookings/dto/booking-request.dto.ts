import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { CabinClass } from '../../flights/flight-status';
import { PassengerType } from '../../flights/passenger-rules';
import { MAX_PASSENGERS } from '../rules/passenger-rules';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** One flight and cabin chosen from search (FLT-11, FLT-12). */
export class SegmentChoiceDto {
  @ApiProperty({ example: '6660a1b2c3d4e5f601234567' })
  @IsMongoId()
  flightId!: string;

  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  @IsEnum(CabinClass)
  cabinClass!: CabinClass;
}

/** A passenger's details and optional extra baggage (FLT-19). */
export class PassengerDto {
  @ApiProperty({ example: 'Mona Adel' })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  fullName!: string;

  @ApiProperty({ example: '1990-05-01', description: 'YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use the format YYYY-MM-DD' })
  @IsDateString({ strict: true })
  dateOfBirth!: string;

  @ApiProperty({ example: 'A1234567', description: 'Passport or ID number' })
  @Transform(trim)
  @IsString()
  @Length(3, 30)
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'Use letters, digits and dashes only',
  })
  documentNumber!: string;

  @ApiProperty({
    enum: PassengerType,
    description:
      "Must match the date of birth on the outbound's local departure date: adult 12+, child 2-11, infant under 2",
  })
  @IsEnum(PassengerType)
  type!: PassengerType;

  @ApiPropertyOptional({
    minimum: 0,
    default: 0,
    description: "Up to the airline's maximum extra bags per passenger",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  extraBags?: number;

  @ApiPropertyOptional({
    example: 20,
    description:
      "Weight of each extra bag in kg (required with extra bags); at most the cabin's free-bag allowance",
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @IsPositive()
  extraBagWeightKg?: number;
}

/**
 * Body of the booking summary and of the hold (FLT-19, FLT-21, FLT-22). A
 * round trip adds `return`: one booking with two segments (FLT-12a).
 */
export class BookingRequestDto {
  @ApiProperty({ type: SegmentChoiceDto })
  @ValidateNested()
  @Type(() => SegmentChoiceDto)
  outbound!: SegmentChoiceDto;

  @ApiPropertyOptional({
    type: SegmentChoiceDto,
    description: 'Return flight for a round trip (reverse route)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SegmentChoiceDto)
  return?: SegmentChoiceDto;

  @ApiProperty({ type: [PassengerDto], minItems: 1, maxItems: MAX_PASSENGERS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PASSENGERS)
  @ValidateNested({ each: true })
  @Type(() => PassengerDto)
  passengers!: PassengerDto[];
}
