import { prepareSafeExternalRequest } from './external-url.util';

describe('prepareSafeExternalRequest', () => {
  it('requires HTTPS and rejects embedded credentials for credential-bearing calls', async () => {
    await expect(prepareSafeExternalRequest('http://8.8.8.8/api', { requireHttps: true }))
      .rejects.toThrow('HTTPS');
    await expect(prepareSafeExternalRequest('https://user:pass@8.8.8.8/api', { requireHttps: true }))
      .rejects.toThrow('内嵌');
  });

  it('rejects literal private and loopback destinations', async () => {
    await expect(prepareSafeExternalRequest('https://127.0.0.1/api', { requireHttps: true }))
      .rejects.toThrow('内网');
    await expect(prepareSafeExternalRequest('https://10.0.0.2/api', { requireHttps: true }))
      .rejects.toThrow('内网');
  });

  it('pins the validated address and refuses a second hostname lookup', async () => {
    const target = await prepareSafeExternalRequest('https://8.8.8.8/api', { requireHttps: true });
    const pinnedLookup = target.transport.httpsAgent.options.lookup!;

    const address = await new Promise<string>((resolve, reject) => {
      pinnedLookup('8.8.8.8', { all: false }, (error, result) => {
        if (error) reject(error);
        else resolve(String(result));
      });
    });
    expect(address).toBe('8.8.8.8');
    expect(target.transport.proxy).toBe(false);

    await expect(new Promise((resolve, reject) => {
      pinnedLookup('rebound.example.com', { all: false }, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    })).rejects.toThrow('主机不一致');
  });
});
