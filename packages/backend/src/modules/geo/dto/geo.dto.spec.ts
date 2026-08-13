import { validate } from 'class-validator';
import { CreateKeywordDto } from './geo.dto';

describe('CreateKeywordDto GEO target validation', () => {
  function dto(values: Partial<CreateKeywordDto>): CreateKeywordDto {
    return Object.assign(new CreateKeywordDto(), {
      word: '门窗厂家',
      type: 'industry',
      ...values,
    });
  }

  it('accepts a public FQDN and a reasonable brand', async () => {
    await expect(validate(dto({ targetDomain: 'example.com', targetBrand: '星河门窗' })))
      .resolves.toHaveLength(0);
  });

  it('rejects URL paths and non-domain values in targetDomain', async () => {
    const errors = await validate(dto({ targetDomain: 'https://example.com/path' }));
    expect(errors.some((error) => error.property === 'targetDomain')).toBe(true);
  });

  it('rejects single-character and URL-shaped brands', async () => {
    const shortErrors = await validate(dto({ targetBrand: 'A' }));
    const urlErrors = await validate(dto({ targetBrand: 'https://example.com' }));
    expect(shortErrors.some((error) => error.property === 'targetBrand')).toBe(true);
    expect(urlErrors.some((error) => error.property === 'targetBrand')).toBe(true);
  });
});
