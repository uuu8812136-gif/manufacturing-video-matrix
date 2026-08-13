import { IsString, IsOptional, Matches, MinLength, IsIn } from 'class-validator';

const ROLES = ['super_admin', 'ops_lead', 'dealer', 'content_editor'];

export class InviteMemberDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  name!: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: '密码必须同时包含字母和数字' })
  password!: string;

  @IsString()
  @IsIn(ROLES)
  role!: string;
}

export class UpdateRoleDto {
  @IsString()
  @IsIn(ROLES)
  role!: string;
}

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  avatar?: string;
}
