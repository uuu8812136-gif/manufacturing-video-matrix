import axios from 'axios';
import { FenxiProvider, HongquanProvider, XiaoshouyiProvider } from './crm.service';

jest.mock('axios');
jest.mock('../../common/utils/external-url.util', () => ({
  assertSafeExternalUrl: jest.fn(async (value: string) => new URL(value)),
  prepareSafeExternalRequest: jest.fn(async (value: string) => ({ url: new URL(value), transport: {} })),
}));

describe('CRM provider acknowledgement validation', () => {
  const lead = { name: '客户', phone: '13800000000', company: '示例公司', demand: '询价' };
  const config = { apiUrl: 'https://crm.example.com/leads', token: 'token' };

  beforeEach(() => jest.clearAllMocks());

  it('rejects missing apiUrl instead of calling a guessed endpoint', async () => {
    await expect(new FenxiProvider().pushLead(lead, { token: 'token' }))
      .rejects.toThrow('API 地址未配置');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('accepts a confirmed Fxiaoke success and external id', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { errorCode: '0', data: { id: 'lead-1' } } });
    await expect(new FenxiProvider().pushLead(lead, config))
      .resolves.toEqual({ success: true, externalId: 'lead-1' });
  });

  it('rejects a Xiaoshouyi business error returned with HTTP 200', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { code: 4001, message: 'field invalid' } });
    await expect(new XiaoshouyiProvider().pushLead(lead, config))
      .rejects.toThrow('field invalid');
  });

  it('rejects an ambiguous Hongquan response', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { message: 'accepted?' } });
    await expect(new HongquanProvider().pushLead(lead, config))
      .rejects.toThrow('缺少明确的成功标记');
  });

  it('rejects a nested failure even when the outer code is successful', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { code: 0, data: { success: false, message: 'nested failure' } } });
    await expect(new FenxiProvider().pushLead(lead, config)).rejects.toThrow('nested failure');
  });

  it.each([
    ['纷享销客', new FenxiProvider()],
    ['销售易', new XiaoshouyiProvider()],
    ['红圈', new HongquanProvider()],
  ])('%s disables redirects so credentials cannot be redirected to an internal host', async (_name, provider) => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { success: true, data: { id: 'lead-1' } } });
    await provider.pushLead(lead, config);
    expect(axios.post).toHaveBeenCalledWith(
      config.apiUrl,
      expect.any(Object),
      expect.objectContaining({ maxRedirects: 0 }),
    );
  });
});
