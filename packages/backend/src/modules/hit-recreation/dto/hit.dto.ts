import { ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class AddPeerDto {
  @IsString()
  platform!: string;

  @IsString()
  nickname!: string;

  @IsString()
  @IsOptional()
  avatar?: string;

  @IsNumber()
  @IsOptional()
  followerCount?: number;

  @IsBoolean()
  @IsOptional()
  isBenchmark?: boolean;

  @IsNumber()
  @IsOptional()
  explosiveThresholdPlay?: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  explosiveThresholdLikeRate?: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  explosiveThresholdCommentRate?: number;
}

export class UpdatePeerDto {
  @IsString()
  @IsOptional()
  platform?: string;

  @IsString()
  @IsOptional()
  nickname?: string;

  @IsString()
  @IsOptional()
  avatar?: string;

  @IsNumber()
  @IsOptional()
  followerCount?: number;

  @IsBoolean()
  @IsOptional()
  isBenchmark?: boolean;

  @IsNumber()
  @IsOptional()
  explosiveThresholdPlay?: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  explosiveThresholdLikeRate?: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  explosiveThresholdCommentRate?: number;
}

export class GenerateRecreationsDto {
  @IsString()
  hitContentId!: string;

  @IsString()
  @IsOptional()
  productId?: string;

  @IsString()
  @IsOptional()
  style?: string; // professional/humorous/story/compare

  @IsString()
  @IsOptional()
  platform?: string;

  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  versionCount?: number;
}

export class UpdateRecreationDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  body?: string;

  @IsString()
  @IsOptional()
  storyboard?: string;

  @IsString()
  @IsOptional()
  videoUrl?: string;

  @IsString()
  @IsOptional()
  coverUrl?: string;

  @IsArray()
  @IsOptional()
  tags?: string[];
}

export class PublishRecreationDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  accountIds!: string[];
}

export class UpdateRecreationScoreDto {
  @IsInt()
  @Min(0)
  playCount!: number;

  @IsInt()
  @Min(0)
  likeCount!: number;

  @IsInt()
  @Min(0)
  commentCount!: number;

  @IsInt()
  @Min(0)
  shareCount!: number;
}
