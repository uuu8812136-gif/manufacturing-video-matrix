import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { ProductLibraryService } from './product-library.service';

describe('ProductLibraryService Excel import', () => {
  const productCreate = jest.fn();
  const prisma = {
    product: { create: productCreate },
    productCategory: { findFirst: jest.fn() },
  };
  const service = new ProductLibraryService(prisma as never);

  beforeEach(() => {
    productCreate.mockReset();
    productCreate.mockImplementation(async ({ data }) => ({ id: `product-${data.name}`, ...data }));
  });

  it('imports prefixed SpreadsheetML and splits combined parameter cells', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('产品数据');
    sheet.addRow(['产品名称', '参数', '卖点', '应用场景', '品牌话术']);
    sheet.addRow([
      'UAT-断桥系统窗 A70',
      '壁厚:1.8mm；双层中空玻璃；多点锁闭',
      '隔音保温；稳定耐用',
      '住宅卧室、书房',
      '让安静与节能成为家的日常。',
    ]);

    const standard = Buffer.from(await workbook.xlsx.writeBuffer());
    const prefixed = await prefixSpreadsheetNamespace(standard);
    const result = await service.importWorkbook('team-1', prefixed);

    expect(result).toEqual({ count: 1 });
    expect(productCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        teamId: 'team-1',
        name: 'UAT-断桥系统窗 A70',
        parameters: JSON.stringify({ 壁厚: '1.8mm', 参数2: '双层中空玻璃', 参数3: '多点锁闭' }),
        sellingPoints: JSON.stringify(['隔音保温', '稳定耐用']),
        scenarios: JSON.stringify(['住宅卧室', '书房']),
      }),
    });
  });
});

async function prefixSpreadsheetNamespace(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.endsWith('.xml')) continue;
    let xml = await entry.async('string');
    if (!xml.includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')) continue;
    xml = xml
      .replace(
        'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
      )
      .replace(/<(\/?)([A-Za-z_][\w.-]*)(?=[\s>])/g, '<$1x:$2');
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}
