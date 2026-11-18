import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsMongoId, Min } from 'class-validator';

/** Body for `PATCH /api/itineraries/:id/days/reorder` (ITN-08). */
export class ReorderDaysDto {
  @ApiProperty({ description: 'The day to move' })
  @IsMongoId()
  dayId!: string;

  @ApiProperty({
    minimum: 1,
    description: 'Its new position, 1 to the number of days',
  })
  @IsInt()
  @Min(1)
  position!: number;
}
