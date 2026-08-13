import { parsePage, paginate } from './page.util';

describe('parsePage', () => {
  it('uses defaults when empty', () => {
    const r = parsePage({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(10);
    expect(r.skip).toBe(0);
    expect(r.take).toBe(10);
  });

  it('respects provided values', () => {
    const r = parsePage({ page: 3, pageSize: 20 });
    expect(r.page).toBe(3);
    expect(r.pageSize).toBe(20);
    expect(r.skip).toBe(40);
    expect(r.take).toBe(20);
  });

  it('clamps page and pageSize to min 1', () => {
    const r = parsePage({ page: 0, pageSize: 0 });
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(10);
    expect(r.skip).toBe(0);
  });

  it('clamps pageSize to max 100', () => {
    const r = parsePage({ page: 2, pageSize: 999 });
    expect(r.pageSize).toBe(100);
    expect(r.skip).toBe(100);
    expect(r.take).toBe(100);
  });

  it('handles invalid number strings', () => {
    const r = parsePage({ page: 'abc' as unknown as number, pageSize: 'xyz' as unknown as number });
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(10);
  });
});

describe('paginate', () => {
  it('returns paginated shape', () => {
    const r = paginate([1, 2], 5, 1, 2);
    expect(r).toEqual({ list: [1, 2], total: 5, page: 1, pageSize: 2 });
  });
});
