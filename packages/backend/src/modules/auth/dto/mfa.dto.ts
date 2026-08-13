import { IsString } from 'class-validator';

export class MfaVerifyDto {
  @IsString()
  mfaToken!: string;

  @IsString()
  code!: string;
}

export class MfaEnableDto {
  @IsString()
  code!: string;
}
