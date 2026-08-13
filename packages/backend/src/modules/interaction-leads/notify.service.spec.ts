import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { NotifyService } from './notify.service';

jest.mock('axios');
jest.mock('../../common/utils/external-url.util', () => ({
  prepareSafeExternalRequest: jest.fn(async (value: string) => ({ url: new URL(value), transport: {} })),
}));

describe('NotifyService provider acknowledgements', () => {
  const values: Record<string, string> = {
    WECOM_WEBHOOK_URL: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',
    SMS_API_URL: 'https://sms.example.com/send',
    SMS_API_KEY: 'secret',
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  let service: NotifyService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotifyService(config);
  });

  it('accepts an explicit successful WeCom response', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { errcode: 0, errmsg: 'ok' } });
    await expect(service.notifyWeCom('team', { name: '客户', phone: '13800000000' }))
      .resolves.toEqual({ sent: true });
  });

  it('does not report WeCom business errors as sent', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { errcode: 93000, errmsg: 'invalid webhook' } });
    await expect(service.notifyWeCom('team', { name: '客户', phone: '13800000000' }))
      .resolves.toEqual({ sent: false });
  });

  it('requires an explicit SMS success acknowledgement', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: {} });
    await expect(service.notifySms('13800000000', '测试'))
      .resolves.toEqual({ sent: false });
  });

  it('accepts common successful SMS gateway responses', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { success: true, messageId: 'm1' } });
    await expect(service.notifySms('13800000000', '测试'))
      .resolves.toEqual({ sent: true });
  });

  it('rejects nested SMS failures even when the outer code is successful', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { code: 0, data: { success: false, message: 'nested failure' } } });
    await expect(service.notifySms('13800000000', '测试')).resolves.toEqual({ sent: false });
  });

  it('disables redirects on credential-bearing notification requests', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { success: true, messageId: 'm1' } });
    await service.notifySms('13800000000', '测试');
    expect(axios.post).toHaveBeenCalledWith(
      values.SMS_API_URL,
      expect.any(Object),
      expect.objectContaining({ maxRedirects: 0 }),
    );
  });
});
