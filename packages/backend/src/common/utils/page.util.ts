import type { PageQuery } from '@mvms/shared';

export function parsePage(q: PageQuery) {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 10));
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip, take: pageSize };
}

export function paginate<T>(list: T[], total: number, page: number, pageSize: number) {
  return { list, total, page, pageSize };
}
