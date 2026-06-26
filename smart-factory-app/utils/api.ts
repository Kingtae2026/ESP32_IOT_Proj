import { SERVER_URL } from '../config';

const TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`연결 시간 초과 (${ms / 1000}초)`)), ms)
  );
  return Promise.race([promise, timeout]);
}

export async function sendCommand(cmd: string): Promise<{ latency: number }> {
  const start = Date.now();

  const fetcher = fetch(`${SERVER_URL}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd }),
  });

  let res: Response;
  try {
    res = await withTimeout(fetcher, TIMEOUT_MS);
  } catch (err: any) {
    throw new Error(
      err.message?.includes('시간 초과')
        ? err.message
        : '서버에 연결할 수 없습니다.\nPC에서 서버가 실행 중인지 확인하세요.'
    );
  }

  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error ?? '명령 전송 실패');
  }

  return { latency: Date.now() - start };
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await withTimeout(
      fetch(`${SERVER_URL}/health`),
      3000
    );
    const data = await res.json();
    return !!data.ok;
  } catch {
    return false;
  }
}
