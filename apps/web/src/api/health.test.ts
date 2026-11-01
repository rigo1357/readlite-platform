import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchApiHealth } from './health';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchApiHealth', () => {
  it('gọi health endpoint cùng origin và trả trạng thái API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', service: 'api' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchApiHealth()).resolves.toEqual({ status: 'ok', service: 'api' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/health', {
      headers: { Accept: 'application/json' },
    });
  });

  it('báo lỗi khi backend trả HTTP không thành công', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(fetchApiHealth()).rejects.toThrow('Backend chưa sẵn sàng.');
  });

  it('báo lỗi khi JSON health không đúng hợp đồng', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'error' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(fetchApiHealth()).rejects.toThrow('Phản hồi backend không hợp lệ.');
  });
});
