import { Question } from './game.models';

export interface AppsScriptGameResponse {
  ok: boolean;
  status: number;
  gameId?: string;
  title?: string;
  gameType?: string;
  host?: boolean;
  questions?: Question[];
  error?: string;
  message?: string;
}

export async function fetchGameFromAppsScript(
  appsScriptUrl: string,
  gameId: string,
  pin?: string
): Promise<AppsScriptGameResponse> {
  const url = new URL(appsScriptUrl);
  url.searchParams.set('gameId', gameId);

  if (pin) {
    url.searchParams.set('pin', pin);
  }

  const payload = await fetchJsonp(url);

  if (!payload.ok) {
    throw new Error(payload.message || payload.error || 'No se pudo cargar la partida.');
  }

  return payload;
}

function fetchJsonp(url: URL): Promise<AppsScriptGameResponse> {
  return new Promise((resolve, reject) => {
    const callbackName = `appsScriptCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('No se pudo conectar con Google Sheets.'));
    }, 12000);

    function cleanup(): void {
      window.clearTimeout(timeout);
      script.remove();
      delete (window as unknown as Record<string, unknown>)[callbackName];
    }

    (window as unknown as Record<string, (payload: AppsScriptGameResponse) => void>)[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    url.searchParams.set('callback', callbackName);
    script.src = url.toString();
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error('No se pudo cargar el script de Google Sheets.'));
    };

    document.head.appendChild(script);
  });
}
