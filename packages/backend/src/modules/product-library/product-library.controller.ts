import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductLibraryService } from './product-library.service';
import { CreateProductDto, UpdateProductDto, CreateCategoryDto, ImportProductsDto, CreateProductMaterialDto } from './dto/product.dto';
import { CurrentUser } from '../../common/decorators';

@ApiBearerAuth()
@ApiTags('产品信息库')
@Controller('products')
export class ProductLibraryController {
  constructor(private service: ProductLibraryService) {}

  @Get()
  @ApiOperation({ summary: '产品列表' })
  list(@CurrentUser() user: { teamId: string }, @Query() query: Record<string, unknown>) {
    return this.service.list(user.teamId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '产品详情' })
  get(@Param('id') id: string, @CurrentUser() user: { teamId: string }) {
    return this.service.get(id, user.teamId);
  }

  @Post()
  @ApiOperation({ summary: '创建产品' })
  create(@CurrentUser() user: { teamId: string }, @Body() dto: CreateProductDto) {
    return this.service.create(user.teamId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新产品' })
  update(@Param('id') id: string, @CurrentUser() user: { teamId: string }, @Body() dto: UpdateProductDto) {
    return this.service.update(id, user.teamId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除产品' })
  remove(@Param('id') id: string, @CurrentUser() user: { teamId: string }) {
    return this.service.remove(id, user.teamId);
  }

  @Post('import')
  @ApiOperation({ summary: '批量导入产品' })
  importProducts(@CurrentUser() user: { teamId: string }, @Body() dto: ImportProductsDto) {
    return this.service.importProducts(user.teamId, dto);
  }

  @Post('import-file')
  @ApiOperation({ summary: '从 Excel 参数表导入产品' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  importFile(@CurrentUser() user: { teamId: string }, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('请上传 Excel 文件');
    return this.service.importWorkbook(user.teamId, file.buffer);
  }

  @Get('categories/all')
  @ApiOperation({ summary: '产品分类' })
  categories(@CurrentUser() user: { teamId: string }) {
    return this.service.listCategories(user.teamId);
  }

  @Post('categories')
  @ApiOperation({ summary: '创建分类' })
  createCategory(@CurrentUser() user: { teamId: string }, @Body() dto: CreateCategoryDto) {
    return this.service.createCategory(user.teamId, dto);
  }

  @Post(':id/materials')
  @ApiOperation({ summary: '关联产品素材' })
  addMaterial(
    @CurrentUser() user: { teamId: string },
    @Param('id') id: string,
    @Body() dto: CreateProductMaterialDto,
  ) {
    return this.service.addMaterial(user.teamId, id, dto);
  }

  @Delete(':id/materials/:materialId')
  @ApiOperation({ summary: '移除产品素材' })
  removeMaterial(
    @CurrentUser() user: { teamId: string },
    @Param('id') id: string,
    @Param('materialId') materialId: string,
  ) {
    return this.service.removeMaterial(user.teamId, id, materialId);
  }
}
