import { IsString, IsOptional, IsNumber, IsBoolean, IsIn, Min, Max } from 'class-validator';

export class CreateChannelDto {
  @IsString()
  name!: string;

  @IsString()
  @IsIn(['industrial_park', 'association'])
  type!: string; // industrial_park/association

  @IsString()
  @IsOptional()
  contactName?: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  discountRate?: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  commissionRate?: number;
}

export class CreateCodeDto {
  @IsString()
  channelId!: string;

  @IsNumber()
  @IsOptional()
  discountRate?: number;
}

export class SettleDto {
  @IsBoolean()
  settled!: boolean;
}

export class MarkPaidDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
}
