import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parsePage } from '../../common/utils/page.util';
import { CreateProductDto, UpdateProductDto, CreateCategoryDto, ImportProductsDto } from './dto/product.dto';
import { CreateProductMaterialDto } from './dto/product.dto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

@Injectable()
export class ProductLibraryService {
  constructor(private prisma: PrismaService) {}

  async list(teamId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = parsePage(query);
    const where: Record<string, unknown> = { teamId };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.keyword) where.name = { contains: query.keyword as string };
    const [list, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { category: true, materials: true },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      list: list.map((p) => ({
        ...p,
        parameters: p.parameters ? JSON.parse(p.parameters) : {},
        sellingPoints: p.sellingPoints ? JSON.parse(p.sellingPoints) : [],
        scenarios: p.scenarios ? JSON.parse(p.scenarios) : [],
      })),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string, teamId: string) {
    const p = await this.prisma.product.findFirst({
      where: { id, teamId },
      include: { category: true, materials: true },
    });
    if (!p) return null;
    return {
      ...p,
      parameters: p.parameters ? JSON.parse(p.parameters) : {},
      sellingPoints: p.sellingPoints ? JSON.parse(p.sellingPoints) : [],
      scenarios: p.scenarios ? JSON.parse(p.scenarios) : [],
    };
  }

  async create(teamId: string, dto: CreateProductDto) {
    if (dto.categoryId) {
      const category = await this.prisma.productCategory.findFirst({ where: { id: dto.categoryId, teamId } });
      if (!category) throw new BadRequestException('产品分类不存在或不属于当前企业');
    }
    return this.prisma.product.create({
      data: {
        teamId,
        name: dto.name,
        categoryId: dto.categoryId,
        parameters: JSON.stringify(dto.parameters || {}),
        sellingPoints: JSON.stringify(dto.sellingPoints || []),
        scenarios: JSON.stringify(dto.scenarios || []),
        brandScript: dto.brandScript,
      },
    });
  }

  async update(id: string, teamId: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findFirst({ where: { id, teamId } });
    if (!existing) throw new BadRequestException('产品不存在');
    if (dto.categoryId) {
      const category = await this.prisma.productCategory.findFirst({ where: { id: dto.categoryId, teamId } });
      if (!category) throw new BadRequestException('产品分类不存在或不属于当前企业');
    }
    return this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name,
        categoryId: dto.categoryId,
        parameters: dto.parameters ? JSON.stringify(dto.parameters) : undefined,
        sellingPoints: dto.sellingPoints ? JSON.stringify(dto.sellingPoints) : undefined,
        scenarios: dto.scenarios ? JSON.stringify(dto.scenarios) : undefined,
        brandScript: dto.brandScript,
      },
    });
  }

  async remove(id: string, teamId: string) {
    const result = await this.prisma.product.deleteMany({ where: { id, teamId } });
    if (result.count === 0) throw new BadRequestException('产品不存在');
    return { deleted: true };
  }

  async importProducts(teamId: string, dto: ImportProductsDto) {
    const created = [];
    for (const p of dto.products) {
      created.push(await this.create(teamId, p));
    }
    return { count: created.length };
  }

  async listCategories(teamId: string) {
    return this.prisma.productCategory.findMany({
      where: { teamId },
      include: { _count: { select: { products: true } } },
    });
  }

  async createCategory(teamId: string, dto: CreateCategoryDto) {
    return this.prisma.productCategory.create({ data: { teamId, name: dto.name } });
  }

  async importWorkbook(teamId: string, buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    const normalizedBuffer = await this.normalizeSpreadsheetNamespaces(buffer);
    await workbook.xlsx.load(normalizedBuffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('Excel 中没有工作表');
    const headers = new Map<number, string>();
    sheet.getRow(1).eachCell((cell, column) => headers.set(column, cell.text.trim()));
    const products: CreateProductDto[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values: Record<string, string> = {};
      row.eachCell((cell, column) => {
        const header = headers.get(column);
        if (header) values[header] = cell.text.trim();
      });
      const name = values['产品名称'] || values.name || values['名称'];
      if (!name) return;
      const parameters: Record<string, string> = {};
      for (const [header, value] of Object.entries(values)) {
        if (header.startsWith('参数:') || header.startsWith('参数：')) {
          parameters[header.slice(3).trim()] = value;
        }
      }
      this.splitCell(values['参数'] || values.parameters).forEach((item, index) => {
        const separator = item.search(/[:：]/);
        if (separator > 0) {
          parameters[item.slice(0, separator).trim()] = item.slice(separator + 1).trim();
        } else {
          parameters[`参数${index + 1}`] = item;
        }
      });
      products.push({
        name,
        parameters,
        sellingPoints: this.splitCell(values['卖点'] || values.sellingPoints),
        scenarios: this.splitCell(values['应用场景'] || values.scenarios),
        brandScript: values['品牌话术'] || values.brandScript,
      });
    });
    if (products.length === 0) throw new BadRequestException('没有识别到产品数据，请确认首行包含“产品名称”');
    return this.importProducts(teamId, { products });
  }

  async addMaterial(teamId: string, productId: string, dto: CreateProductMaterialDto) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, teamId } });
    if (!product) throw new BadRequestException('产品不存在');
    return this.prisma.productMaterial.create({ data: { productId, name: dto.name, url: dto.url } });
  }

  async removeMaterial(teamId: string, productId: string, materialId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, teamId } });
    if (!product) throw new BadRequestException('产品不存在');
    const result = await this.prisma.productMaterial.deleteMany({ where: { id: materialId, productId } });
    if (result.count === 0) throw new BadRequestException('产品素材不存在');
    return { deleted: true };
  }

  private splitCell(value?: string) {
    return value ? value.split(/[\n、;,；]+/).map((item) => item.trim()).filter(Boolean) : [];
  }

  /**
   * Some standards-compliant generators prefix SpreadsheetML elements
   * (for example, <x:workbook>). ExcelJS 4.x only recognises the same
   * namespace when it is declared as the default namespace. Normalise those
   * element prefixes in-memory while leaving relationship namespaces intact.
   */
  private async normalizeSpreadsheetNamespaces(buffer: Buffer): Promise<Buffer> {
    const zip = await JSZip.loadAsync(buffer);
    let changed = false;

    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !name.endsWith('.xml')) continue;
      let xml = await entry.async('string');
      const namespace = xml.match(
        /xmlns:([A-Za-z_][\w.-]*)=["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/,
      );
      if (!namespace) continue;

      const prefix = namespace[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      xml = xml
        .replace(new RegExp(`(<\\/?)(?:${prefix}):`, 'g'), '$1')
        .replace(new RegExp(`xmlns:${prefix}=`, 'g'), 'xmlns=');
      zip.file(name, xml);
      changed = true;
    }

    return changed
      ? zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
      : buffer;
  }
}
