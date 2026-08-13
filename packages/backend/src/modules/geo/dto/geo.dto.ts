import {
  IsFQDN,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const REASONABLE_BRAND_PATTERN = /^(?!.*(?:https?:\/\/|[\r\n\t]))(?=(?:.*[\p{L}\p{N}]){2})[\p{L}\p{N}\p{M}\s·&＋+（）()_.\-'’]+$/u;

export class CreateKeywordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  word!: string;

  @IsIn(['product', 'industry', 'region'])
  type!: string; // product/industry/region

  @IsString()
  @IsOptional()
  @IsFQDN({ require_tld: true, allow_underscores: false }, { message: '目标官网域名格式无效，请填写 example.com 形式的公网域名' })
  @MaxLength(253)
  targetDomain?: string;

  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(100)
  @Matches(REASONABLE_BRAND_PATTERN, { message: '目标品牌至少包含两个文字或数字，且不能是网址或包含控制字符' })
  targetBrand?: string;
}

export class CheckRankDto {
  @IsString()
  keywordId!: string;
}

export class AiCitationDto {
  @IsIn(['deepseek', 'doubao', 'ernie', 'qwen'])
  aiPlatform!: string;
}

export class CompetitorCompareDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  keyword!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  competitor!: string;
}

export class SeoAdviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  keyword!: string;

  @IsString()
  @IsOptional()
  type?: string;
}
