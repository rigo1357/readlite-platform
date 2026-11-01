export type ApiHealth = {
  status: 'ok';
  service: 'api';
};

export async function fetchApiHealth(): Promise<ApiHealth> {
  const response = await fetch('/api/v1/health', {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Backend chưa sẵn sàng.');
  }

  const payload: unknown = await response.json();
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('status' in payload) ||
    payload.status !== 'ok' ||
    !('service' in payload) ||
    payload.service !== 'api'
  ) {
    throw new Error('Phản hồi backend không hợp lệ.');
  }

  return { status: 'ok', service: 'api' };
}
