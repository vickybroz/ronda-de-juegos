import { GameState } from './game.models';
import { environment } from '../environments/environment';

export type ClientRole = 'host' | 'player';

export interface GameClientOptions {
  gameId: string;
  role: ClientRole;
  pin?: string;
  inviteHash?: string;
  onState: (state: GameState) => void;
  onJoined: (playerId: string) => void;
  onInvitation: (hash: string) => void;
  onStatus: (status: ConnectionStatus) => void;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

const WORKER_WS_URL = environment.workerWsUrl;

export class GameClient {
  private socket: WebSocket | null = null;
  private connected = false;

  constructor(private readonly options: GameClientOptions) {}

  connect(): void {
    this.options.onStatus('connecting');

    const url = new URL(`/rooms/${this.options.gameId}/ws`, WORKER_WS_URL);
    url.searchParams.set('role', this.options.role);

    if (this.options.pin) {
      url.searchParams.set('pin', this.options.pin);
    }

    if (this.options.inviteHash) {
      url.searchParams.set('ci', this.options.inviteHash);
    }

    this.socket = new WebSocket(url.toString());
    this.socket.addEventListener('open', () => {
      this.connected = true;
      this.options.onStatus('connected');
    });
    this.socket.addEventListener('message', (event) => this.handleMessage(event));
    this.socket.addEventListener('error', () => this.options.onStatus('error'));
    this.socket.addEventListener('close', () => {
      this.options.onStatus(this.connected ? 'closed' : 'error');
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  join(name: string): void {
    this.send({ type: 'join', name });
  }

  start(): void {
    this.send({ type: 'start' });
  }

  showResults(): void {
    this.send({ type: 'showResults' });
  }

  next(): void {
    this.send({ type: 'next' });
  }

  finish(): void {
    this.send({ type: 'finish' });
  }

  reset(): void {
    this.send({ type: 'reset' });
  }

  reload(): void {
    this.send({ type: 'reload' });
  }

  createInvitation(): void {
    this.send({ type: 'createInvitation' });
  }

  leave(): void {
    this.send({ type: 'leave' });
  }

  answer(optionIndex: number): void {
    this.send({ type: 'answer', optionIndex });
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private handleMessage(event: MessageEvent): void {
    const payload = parsePayload(event.data);

    if (payload?.['type'] === 'state' && payload['state']) {
      this.options.onState(payload['state'] as GameState);
    }

    if (payload?.['type'] === 'joined' && typeof payload['playerId'] === 'string') {
      this.options.onJoined(payload['playerId']);
    }

    if (payload?.['type'] === 'left') {
      this.options.onJoined('');
    }

    if (payload?.['type'] === 'invitation' && typeof payload['hash'] === 'string') {
      this.options.onInvitation(payload['hash']);
    }
  }
}

function parsePayload(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(data);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
