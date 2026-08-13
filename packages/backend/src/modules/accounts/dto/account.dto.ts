import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class BindAccountDto {
  @IsString()
  @IsIn(['douyin', 'video_account', 'kuaishou', 'xiaohongshu', 'bilibili', 'baijiahao'])
  platform!: string;

  @IsString()
  @MaxLength(100)
  nickname!: string;

  @IsString()
  @IsOptional()
  avatar?: string;

  @IsString()
  @IsIn(['scan', 'cookie', 'oauth'])
  authType!: string; // scan/cookie/oauth

  @IsString()
  @IsOptional()
  credentials?: string;

  @IsString()
  @IsOptional()
  groupId?: string;

  @IsString()
  @IsOptional()
  regionId?: string;

  @IsBoolean()
  @IsOptional()
  isDealer?: boolean;

  @IsString()
  @IsOptional()
  parentAccountId?: string;
}

export class UpdateAccountDto {
  @IsString()
  @IsOptional()
  nickname?: string;

  @IsString()
  @IsOptional()
  groupId?: string;

  @IsString()
  @IsOptional()
  regionId?: string;

  @IsString()
  @IsOptional()
  @IsIn(['active', 'expired', 'limited', 'banned'])
  status?: string;
}

export class ExchangeOAuthDto {
  @IsString()
  @IsIn(['douyin', 'video_account', 'kuaishou', 'xiaohongshu', 'bilibili', 'baijiahao'])
  platform!: string;

  @IsString()
  @MaxLength(4096)
  code!: string;

  @IsString()
  @MaxLength(4096)
  state!: string;

  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(2048)
  redirectUri!: string;

  @IsString()
  @MaxLength(100)
  nickname!: string;

  @IsString()
  @IsOptional()
  groupId?: string;

  @IsString()
  @IsOptional()
  regionId?: string;
}

export class BrowserLoginStartDto {
  @IsString()
  @IsIn(['douyin', 'video_account', 'kuaishou', 'xiaohongshu', 'bilibili', 'baijiahao'])
  platform!: string;

  @IsString()
  @MaxLength(100)
  nickname!: string;

  @IsString()
  @IsOptional()
  groupId?: string;

  @IsString()
  @IsOptional()
  regionId?: string;

  @IsBoolean()
  @IsOptional()
  isDealer?: boolean;

  @IsString()
  @IsOptional()
  parentAccountId?: string;
}

export class CreateGroupDto {
  @IsString()
  name!: string;

  @IsString()
  @IsIn(['region', 'product', 'department', 'dealer'])
  dimension!: string;
}

export class UpdateGroupDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @IsIn(['region', 'product', 'department', 'dealer'])
  dimension?: string;
}

export class CreateRegionDto {
  @IsString()
  name!: string;

  @IsNumber()
  @IsOptional()
  level?: number;

  @IsString()
  @IsOptional()
  parentId?: string;
}

export class UpdateRegionDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @IsOptional()
  level?: number;

  @IsString()
  @IsOptional()
  parentId?: string;
}

export class PushdownDto {
  @IsString()
  contentId!: string;

  @IsObject()
  accountIds!: Record<string, string[]>;
}
