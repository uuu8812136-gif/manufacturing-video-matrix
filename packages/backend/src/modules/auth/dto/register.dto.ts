import { IsString, MinLength, Matches, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  @MinLength(8, { message: '密码至少8位' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: '密码必须同时包含字母和数字' })
  password!: string;

  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  teamName?: string;

  @IsString()
  @IsOptional()
  inviteCode?: string;
}
