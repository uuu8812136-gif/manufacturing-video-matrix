import { IsString, IsOptional, IsBoolean, IsArray, IsIn, MaxLength, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class CreateAvatarDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsString()
  @IsIn(['heygen', 'guiji', 'zhiying'])
  provider!: string;

  @IsString()
  @IsOptional()
  avatarKey?: string;

  @IsString()
  @IsOptional()
  voiceKey?: string;

  @IsBoolean()
  @IsOptional()
  custom?: boolean;
}

export class UpdateAvatarDto {
  @IsString()
  @MaxLength(80)
  @IsOptional()
  name?: string;

  @IsString()
  @IsIn(['heygen', 'guiji', 'zhiying'])
  @IsOptional()
  provider?: string;

  @IsString()
  @IsOptional()
  avatarKey?: string;

  @IsString()
  @IsOptional()
  voiceKey?: string;

  @IsBoolean()
  @IsOptional()
  custom?: boolean;
}

export class CreateIpDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsString()
  @IsIn(['heygen', 'guiji', 'zhiying'])
  provider!: string;

  @IsString()
  @IsOptional()
  avatarId?: string;

  @IsString()
  @IsOptional()
  persona?: string;
}

export class UpdateIpDto {
  @IsString()
  @MaxLength(80)
  @IsOptional()
  name?: string;

  @IsString()
  @IsIn(['heygen', 'guiji', 'zhiying'])
  @IsOptional()
  provider?: string;

  @IsString()
  @IsOptional()
  avatarId?: string;

  @IsString()
  @IsOptional()
  persona?: string;
}

export class GenerateVideoDto {
  @IsString()
  ipId!: string;

  @IsString()
  @MaxLength(10_000)
  script!: string;

  @IsString()
  @IsOptional()
  background?: string;
}

export class ReplaceBackgroundDto {
  @IsString()
  videoUrl!: string;

  @IsString()
  bgUrl!: string;
}

export class DigitalHumanMixcutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  avatarIds!: string[];

  @IsString()
  script!: string;
}

export class PublishDigitalHumanDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  accountIds!: string[];

  @IsString()
  @IsOptional()
  scheduledAt?: string;
}
