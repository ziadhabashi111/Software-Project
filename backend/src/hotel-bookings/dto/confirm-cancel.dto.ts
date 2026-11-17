import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/** The backend insists on the confirmation too, not only the UI dialog (GEN-03). */
export class ConfirmCancelQueryDto {
  @ApiProperty({ enum: ['true'], description: 'Must be "true" to confirm' })
  @IsIn(['true'], { message: 'Confirm the cancellation with ?confirm=true' })
  confirm!: string;
}
