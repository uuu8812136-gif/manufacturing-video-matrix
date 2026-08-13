import { validate } from 'class-validator';
import { MarkPaidDto } from './channel.dto';

describe('MarkPaidDto', () => {
  function dto(amount?: number): MarkPaidDto {
    return Object.assign(new MarkPaidDto(), amount === undefined ? {} : { amount });
  }

  it.each([undefined, 0, -1, 0.001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid paid amount: %s',
    async (amount) => {
      const errors = await validate(dto(amount));
      expect(errors.some((error) => error.property === 'amount')).toBe(true);
    },
  );

  it.each([0.01, 12.34, 10000])('accepts a positive currency amount: %s', async (amount) => {
    await expect(validate(dto(amount))).resolves.toHaveLength(0);
  });
});
