import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class CreateContentDto {
  @IsString()
  @IsIn(['video', 'image_text', 'dynamic'])
  type!: string; // video/image_text/dynamic

  @IsString()
  @MaxLength(100)
  title!: string;

  @IsString()
  @IsOptional()
  coverUrl?: string;

  @IsString()
  @IsOptional()
  videoUrl?: string;

  @IsString()
  @IsOptional()
  body?: string;

  @IsArray()
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  watermark?: string;

  @IsString()
  @IsOptional()
  @IsIn(['cart', 'poi', 'website', 'lead_form'])
  attachType?: string;

  @IsString()
  @IsOptional()
  attachValue?: string;

  @IsString()
  @IsOptional()
  @IsIn(['manual', 'ai', 'digital_human', 'recreation', 'batch_import'])
  source?: string;
}

export class PublishDto {
  @IsString()
  contentId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  accountIds!: string[];

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsArray()
  @IsOptional()
  platforms?: string[];
}

export class BatchImportItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;

  @IsString()
  @IsNotEmpty()
  videoUrl!: string;

  @IsString()
  @IsOptional()
  coverUrl?: string;

  @IsArray()
  @IsOptional()
  tags?: string[];
}

export class BatchImportDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => BatchImportItemDto)
  items!: BatchImportItemDto[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  accountIds!: string[];
}
