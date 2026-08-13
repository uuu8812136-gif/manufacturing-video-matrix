import { IsString, IsOptional, IsArray, IsNumber, IsIn, Min, Max, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class GenerateScriptDto {
  @IsString()
  templateType!: string; // product_intro/process/customer_case/industry_knowledge/recruitment/digital_human

  @IsString()
  topic!: string;

  @IsString()
  @IsOptional()
  productParams?: string;

  @IsString()
  @IsOptional()
  style?: string;
}

export class GenerateTitlesDto {
  @IsString()
  topic!: string;

  @IsString()
  @IsOptional()
  style?: string;
}

export class GenerateTagsDto {
  @IsString()
  topic!: string;
}

export class SensitiveCheckDto {
  @IsString()
  text!: string;
}

export class CreateMaterialDto {
  @IsString()
  name!: string;

  @IsString()
  type!: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  url!: string;

  @IsString()
  @IsOptional()
  thumbnail?: string;
}

export class ExtractTextDto {
  @IsString()
  videoUrl!: string;
}

export class SynthesizeVoiceDto {
  @IsString()
  text!: string;

  @IsString()
  @IsOptional()
  voice?: string;

  @IsNumber()
  @IsOptional()
  rate?: number;

  @IsNumber()
  @IsOptional()
  pitch?: number;
}

export class MixcutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  clips!: string[];

  @IsString()
  @IsOptional()
  watermark?: string;

  @IsString()
  @IsIn(['9:16', '16:9', '1:1', '3:4'])
  @IsOptional()
  ratio?: string;
}

export class AdaptRatioDto {
  @IsString()
  videoUrl!: string;

  @IsString()
  @IsIn(['9:16', '16:9', '1:1', '3:4'])
  ratio!: string;
}

export class MultiVersionsDto {
  @IsString()
  topic!: string;

  @IsNumber()
  @IsOptional()
  count?: number;

  @IsString()
  @IsOptional()
  style?: string;
}

export class VideoToolDto {
  @IsString()
  videoUrl!: string;

  @IsString()
  @IsIn(['gif', 'speed', 'crop'])
  operation!: 'gif' | 'speed' | 'crop';

  @IsNumber()
  @Min(0.25)
  @Max(4)
  @IsOptional()
  speed?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  start?: number;

  @IsNumber()
  @Min(0.1)
  @Max(3600)
  @IsOptional()
  duration?: number;
}
