import { ArrayNotEmpty, IsArray, IsDateString, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  title!: string;

  @IsString()
  @IsOptional()
  contentId?: string;
}

export class ReviewActionDto {
  @IsString()
  @IsIn(['approve', 'reject'])
  action!: string; // approve/reject

  @IsString()
  @IsOptional()
  comment?: string;
}

export class PublishReviewDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  accountIds!: string[];

  @IsDateString()
  @IsOptional()
  scheduledAt?: string;
}

export class CreateTaskDto {
  @IsString()
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @IsIn(['creation', 'publish', 'review'])
  type?: string;

  @IsString()
  @IsOptional()
  assigneeId?: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;
}

export class UpdateTaskDto {
  @IsString()
  @IsOptional()
  @IsIn(['todo', 'in_progress', 'done'])
  status?: string;

  @IsString()
  @IsOptional()
  assigneeId?: string;
}

export class CreateCalendarDto {
  @IsString()
  title!: string;

  @IsString()
  @IsOptional()
  contentId?: string;

  @IsString()
  @IsOptional()
  platform?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  accountIds?: string[];

  @IsDateString()
  scheduledAt!: string;
}

export class CreateAnnotationDto {
  @IsString()
  @MaxLength(2000)
  text!: string;

  @IsObject()
  @IsOptional()
  position?: Record<string, unknown>;
}
