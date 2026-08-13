import { IsString, IsOptional, IsArray, IsObject } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  name!: string;
}

export class CreateProductDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsObject()
  @IsOptional()
  parameters?: Record<string, string>;

  @IsArray()
  @IsOptional()
  sellingPoints?: string[];

  @IsArray()
  @IsOptional()
  scenarios?: string[];

  @IsString()
  @IsOptional()
  brandScript?: string;
}

export class UpdateProductDto extends CreateProductDto {}

export class ImportProductsDto {
  @IsArray()
  products!: CreateProductDto[];
}

export class CreateProductMaterialDto {
  @IsString()
  name!: string;

  @IsString()
  url!: string;
}
