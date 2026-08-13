import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelService } from './channel.service';

describe('ChannelService markPaid', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  const updateMany = jest.fn();
  const create = jest.fn();
  const transaction = jest.fn(async (callback: (tx: unknown) => unknown) => callback({
    channelCustomer: { update },
    commissionRecord: { updateMany, create },
  }));
  const prisma = {
    channelCustomer: { findUnique },
    $transaction: transaction,
  };
  const service = new ChannelService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([0, -1, 0.001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid amounts before reading or writing the customer: %s',
    async (amount) => {
      await expect(service.markPaid('customer-1', amount)).rejects.toBeInstanceOf(BadRequestException);
      expect(findUnique).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('stores the exact amount and calculates the channel commission', async () => {
    findUnique.mockResolvedValue({
      id: 'customer-1',
      paid: false,
      code: { channel: { commissionRate: 0.18 } },
      commissions: [],
    });
    update.mockResolvedValue({ id: 'customer-1', paid: true, paidAmount: 10000 });
    create.mockResolvedValue({ id: 'commission-1', amount: 1800 });

    await expect(service.markPaid('customer-1', 10000)).resolves.toMatchObject({
      paid: true,
      paidAmount: 10000,
      commission: 1800,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: { paid: true, paidAmount: 10000 },
    });
    expect(create).toHaveBeenCalledWith({
      data: { customerId: 'customer-1', amount: 1800 },
    });
  });
});
