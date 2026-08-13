import { IsString, IsOptional, IsArray, IsObject, IsBoolean, IsIn, IsUrl, MaxLength, IsNumber, Min } from 'class-validator';

export class CreateLeadFormDto {
  @IsString()
  @MaxLength(60)
  name!: string;

  @IsArray()
  fields!: { name: string; label: string; type: string; required?: boolean }[];

  @IsString()
  @IsOptional()
  @IsIn(['consult', 'visit', 'quote'])
  template?: string;
}

export class UpdateLeadFormDto {
  @IsString()
  @IsOptional()
  @MaxLength(60)
  name?: string;

  @IsArray()
  @IsOptional()
  fields?: { name: string; label: string; type: string; required?: boolean }[];

  @IsString()
  @IsOptional()
  @IsIn(['consult', 'visit', 'quote'])
  template?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

export class SubmitLeadDto {
  @IsString()
  formId!: string;

  @IsObject()
  data!: Record<string, string>;

  @IsString()
  @IsOptional()
  sourcePlatform?: string;

  @IsString()
  @IsOptional()
  sourceAccountId?: string;

  @IsString()
  @IsOptional()
  sourceContentId?: string;

  @IsString()
  @IsOptional()
  sourceContentTitle?: string;
}

export class UpdateLeadDto {
  @IsString()
  @IsOptional()
  @IsIn(['high', 'medium', 'low'])
  intention?: string;

  @IsString()
  @IsOptional()
  @IsIn(['new', 'assigned', 'following', 'intended', 'deal', 'lost'])
  status?: string;

  @IsString()
  @IsOptional()
  assigneeId?: string;

  @IsArray()
  @IsOptional()
  tags?: string[];

  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedValue?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  dealValue?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sourceCost?: number;
}

export class AssignLeadDto {
  @IsString()
  assigneeId!: string;
}

export class FollowUpDto {
  @IsString()
  @MaxLength(2000)
  content!: string;

  @IsString()
  @IsOptional()
  result?: string;

  @IsString()
  @IsOptional()
  nextAt?: string;
}

export class CreateAutoReplyDto {
  @IsString()
  @MaxLength(100)
  keyword!: string;

  @IsString()
  @MaxLength(2000)
  reply!: string;

  @IsString()
  @IsOptional()
  @IsIn(['comment', 'message', 'all'])
  scope?: string;
}

export class UpdateAutoReplyDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  keyword?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  reply?: string;

  @IsString()
  @IsOptional()
  @IsIn(['comment', 'message', 'all'])
  scope?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class CreateWebhookDto {
  @IsString()
  @IsUrl({ require_protocol: true })
  url!: string;

  @IsArray()
  @IsOptional()
  events?: string[];
}

export class UpdateWebhookDto {
  @IsString()
  @IsUrl({ require_protocol: true })
  @IsOptional()
  url?: string;

  @IsArray()
  @IsOptional()
  events?: string[];

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class CrmConfigDto {
  @IsString()
  @IsIn(['fenxi', 'xiaoshouyi', 'hongquan'])
  provider!: string;

  @IsObject()
  config!: any;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
