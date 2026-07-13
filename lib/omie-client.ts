// lib/omie-client.ts
import 'server-only';
import { addOmieRawLog, type LogLevel } from '@/lib/unified-log-service';

function toLevelFromStatus(s: number): LogLevel {
  if (s >= 200 && s < 300) return 'success';
  if (s >= 400) return 'error';
  return 'info';
}

export async function callOmie<T = any>({
  endpoint,
  method = 'POST',
  body,
  step,
  transactionId,
  startMessage,
  successMessage,
  errorMessage,
  headers = {},
}: {
  endpoint: string; method?: 'POST' | 'GET'; body?: any; step:
  | 'checkCliente' | 'createCliente' | 'checkProduto' | 'checkServico'
  | 'createProdutoResult' | 'createOSResult' | 'createOCResult' | 'result';
  transactionId: number | string;
  startMessage?: string; successMessage?: string; errorMessage?: string;
  headers?: Record<string, string>;
}): Promise<{
  data: T | null;
  raw: {
    endpoint: string; httpStatus: number;
    requestBodyRaw: string; responseBodyRaw: string;
    requestHeaders?: Record<string,string>; responseHeaders?: Record<string,string>;
  };
}> {
  // — log de início (INFO)
  await addOmieRawLog({
    transactionId, step, level: 'info',
    message: startMessage ?? `${step}: iniciando`,
    raw: {
      endpoint,
      httpStatus: 0,
      requestBodyRaw: JSON.stringify(body ?? {}),
      responseBodyRaw: '',
      requestHeaders: headers,
      responseHeaders: {},
    },
  });

  const reqHeaders = { 'Content-Type': 'application/json', Accept: 'application/json', ...headers };
  const init: RequestInit = {
    method, headers: reqHeaders,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    cache: 'no-store', // @ts-ignore
    next: { revalidate: 0 },
  };

  let httpStatus = 0, respText = '', data: T | null = null, respHeaders: Record<string,string> = {};
  try {
    const resp = await fetch(endpoint, init);
    httpStatus = resp.status;
    respHeaders = Object.fromEntries(resp.headers.entries());
    respText = await resp.text();
    try { data = respText ? JSON.parse(respText) : null; } catch { data = null; }

    const level = toLevelFromStatus(httpStatus);
    await addOmieRawLog({
      transactionId, step, level,
      message: level === 'success'
        ? (successMessage ?? `${step}: sucesso`)
        : (errorMessage ?? `${step}: erro`),
      raw: {
        endpoint, httpStatus,
        requestBodyRaw: JSON.stringify(body ?? {}),
        responseBodyRaw: respText,
        requestHeaders: reqHeaders,
        responseHeaders: respHeaders,
      },
    });

    return {
      data,
      raw: {
        endpoint, httpStatus,
        requestBodyRaw: JSON.stringify(body ?? {}),
        responseBodyRaw: respText,
        requestHeaders: reqHeaders,
        responseHeaders: respHeaders,
      },
    };
  } catch (e) {
    await addOmieRawLog({
      transactionId, step, level: 'error',
      message: errorMessage ?? `${step}: erro ao chamar Omie`,
      raw: {
        endpoint, httpStatus: httpStatus || 0,
        requestBodyRaw: JSON.stringify(body ?? {}),
        responseBodyRaw: respText || '',
        requestHeaders: reqHeaders,
        responseHeaders: respHeaders,
      },
    });
    return {
      data: null,
      raw: {
        endpoint, httpStatus: httpStatus || 0,
        requestBodyRaw: JSON.stringify(body ?? {}),
        responseBodyRaw: respText || '',
        requestHeaders: reqHeaders,
        responseHeaders: respHeaders,
      },
    };
  }
}
