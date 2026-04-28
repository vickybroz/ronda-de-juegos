export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  APPS_SCRIPT_URL: string;
}

type GamePhase = 'lobby' | 'question' | 'results' | 'finished';
type ClientRole = 'host' | 'player';

interface Question {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
  timeLimit: number;
  category?: string;
  difficulty?: string;
}

interface PublicQuestion {
  id: string;
  text: string;
  options: string[];
  timeLimit: number;
  category?: string;
  difficulty?: string;
}

interface Player {
  id: string;
  name: string;
  score: number;
  isReady: boolean;
  connected: boolean;
}

interface PlayerAnswer {
  playerId: string;
  questionId: string;
  optionIndex: number;
  isCorrect: boolean;
  responseTimeMs: number;
  score: number;
}

interface AppsScriptResponse {
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

interface SessionState {
  gameId: string;
  title: string;
  gameType: string;
  phase: GamePhase;
  questions: Question[];
  currentQuestionIndex: number;
  questionStartedAt: number | null;
  resultsShownAt: number | null;
  players: Player[];
  answers: PlayerAnswer[];
}

interface SocketMeta {
  role: ClientRole;
  playerId?: string;
  gameId: string;
  pin?: string;
}

const DEFAULT_TITLE = 'Ronda de Juegos';
const WORKER_VERSION = 'worker-v0.4.2-ebe43ad';
const RESULT_DISPLAY_MS = 5000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return corsResponse(null, { status: 204 });
    }

    const match = url.pathname.match(/^\/rooms\/([a-z0-9-]+)\/ws$/);
    if (!match) {
      return jsonResponse({ ok: true, service: 'trivia-worker' });
    }

    const gameId = match[1];
    const roomId = env.GAME_ROOM.idFromName(gameId);
    const room = env.GAME_ROOM.get(roomId);
    return room.fetch(request);
  }
};

export class GameRoom {
  private state: DurableObjectState;
  private env: Env;
  private session: SessionState | null = null;
  private sockets = new Map<WebSocket, SocketMeta>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') !== 'websocket') {
      return jsonResponse({ ok: false, error: 'WEBSOCKET_REQUIRED' }, { status: 426 });
    }

    const role = url.searchParams.get('role') === 'host' ? 'host' : 'player';
    const pin = url.searchParams.get('pin') || '';
    const gameId = readGameIdFromPath(url.pathname);

    if (!gameId) {
      return jsonResponse({ ok: false, error: 'MISSING_GAME_ID' }, { status: 400 });
    }

    if (role === 'host') {
      try {
        await this.ensureHostSession(gameId, pin);
      } catch (error) {
        return jsonResponse({ ok: false, error: errorMessage(error) }, { status: 403 });
      }
    } else {
      this.ensureLobbySession(gameId);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    this.sockets.set(server, { role, gameId, pin });
    server.addEventListener('message', (event) => this.handleMessage(server, event));
    server.addEventListener('close', () => this.handleClose(server));
    server.addEventListener('error', () => this.handleClose(server));

    this.send(server, {
      type: 'state',
      state: this.publicState(role)
    });
    this.broadcastState();

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  private async ensureHostSession(gameId: string, pin: string): Promise<void> {
    if (!pin) {
      throw new Error('INVALID_PIN');
    }

    if (this.session?.questions.length) {
      return;
    }

    const existingSession = this.session;
    const loaded = await loadGameFromAppsScript(this.env.APPS_SCRIPT_URL, gameId, pin);
    this.session = {
      gameId,
      title: loaded.title || DEFAULT_TITLE,
      gameType: loaded.gameType || 'multiple_choice',
      phase: existingSession?.phase || 'lobby',
      questions: loaded.questions || [],
      currentQuestionIndex: existingSession?.currentQuestionIndex || 0,
      questionStartedAt: existingSession?.questionStartedAt || null,
      resultsShownAt: existingSession?.resultsShownAt || null,
      players: existingSession?.players || [],
      answers: existingSession?.answers || []
    };
  }

  private ensureLobbySession(gameId: string): void {
    if (this.session) {
      return;
    }

    this.session = {
      gameId,
      title: DEFAULT_TITLE,
      gameType: 'multiple_choice',
      phase: 'lobby',
      questions: [],
      currentQuestionIndex: 0,
      questionStartedAt: null,
      resultsShownAt: null,
      players: [],
      answers: []
    };
  }

  private handleMessage(socket: WebSocket, event: MessageEvent): void {
    const meta = this.sockets.get(socket);
    const message = parseMessage(event.data);

    if (!meta || !message || !this.session) {
      return;
    }

    if (message.type === 'join' && meta.role === 'player') {
      this.joinPlayer(socket, String(message.name || 'Jugador'));
      return;
    }

    if (message.type === 'leave' && meta.role === 'player') {
      this.leavePlayer(socket);
      return;
    }

    if (message.type === 'ready' && meta.role === 'player' && meta.playerId) {
      this.setReady(meta.playerId);
      return;
    }

    if (message.type === 'answer' && meta.role === 'player' && meta.playerId) {
      this.answer(meta.playerId, Number(message.optionIndex));
      return;
    }

    if (meta.role !== 'host') {
      return;
    }

    if (message.type === 'start') {
      this.start();
    } else if (message.type === 'showResults') {
      this.showResults();
    } else if (message.type === 'next') {
      this.next();
    } else if (message.type === 'finish') {
      this.finish();
    } else if (message.type === 'reset') {
      this.reset();
    } else if (message.type === 'reload') {
      void this.reload(meta.gameId, meta.pin || '');
    }
  }

  private handleClose(socket: WebSocket): void {
    const meta = this.sockets.get(socket);
    this.sockets.delete(socket);

    if (meta?.playerId && this.session) {
      this.session.players = this.session.players.filter((player) => player.id !== meta.playerId);
      this.broadcastState();
    }
  }

  private joinPlayer(socket: WebSocket, rawName: string): void {
    if (!this.session) {
      return;
    }

    const name = rawName.trim().slice(0, 18) || 'Jugador';
    const player: Player = {
      id: crypto.randomUUID(),
      name,
      score: 0,
      isReady: true,
      connected: true
    };

    this.session.players = [...this.session.players, player];
    const previousMeta = this.sockets.get(socket);
    this.sockets.set(socket, { role: 'player', playerId: player.id, gameId: previousMeta?.gameId || this.session.gameId });
    this.send(socket, { type: 'joined', playerId: player.id });
    this.broadcastState();
  }

  private leavePlayer(socket: WebSocket): void {
    const meta = this.sockets.get(socket);
    if (!meta?.playerId || !this.session) {
      return;
    }

    this.session.players = this.session.players.filter((player) => player.id !== meta.playerId);
    this.sockets.set(socket, { role: 'player', gameId: meta.gameId });
    this.send(socket, { type: 'left' });
    this.broadcastState();
  }

  private setReady(playerId: string): void {
    if (!this.session) {
      return;
    }

    this.session.players = this.session.players.map((player) =>
      player.id === playerId ? { ...player, isReady: true } : player
    );
    this.broadcastState();
  }

  private start(): void {
    if (!this.session || this.session.questions.length === 0) {
      return;
    }

    this.session.phase = 'question';
    this.session.currentQuestionIndex = 0;
    this.session.questionStartedAt = Date.now();
    this.session.resultsShownAt = null;
    this.session.answers = [];
    this.broadcastState();
    this.scheduleQuestionTimeout();
  }

  private showResults(): void {
    if (!this.session) {
      return;
    }

    this.session.phase = 'results';
    this.session.resultsShownAt = Date.now();
    this.broadcastState();
    this.scheduleNextQuestion();
  }

  private next(): void {
    if (!this.session) {
      return;
    }

    const nextIndex = this.session.currentQuestionIndex + 1;
    if (nextIndex >= this.session.questions.length) {
      this.session.phase = 'finished';
      this.session.questionStartedAt = null;
      this.session.resultsShownAt = null;
    } else {
      this.session.phase = 'question';
      this.session.currentQuestionIndex = nextIndex;
      this.session.questionStartedAt = Date.now();
      this.session.resultsShownAt = null;
    }

    this.broadcastState();

    if (this.session.phase === 'question') {
      this.scheduleQuestionTimeout();
    }
  }

  private finish(): void {
    if (!this.session) {
      return;
    }

    this.session.phase = 'finished';
    this.session.questionStartedAt = null;
    this.session.resultsShownAt = null;
    this.broadcastState();
  }

  private reset(): void {
    if (!this.session) {
      return;
    }

    this.session.phase = 'lobby';
    this.session.currentQuestionIndex = 0;
    this.session.questionStartedAt = null;
    this.session.resultsShownAt = null;
    this.session.answers = [];
    this.session.players = this.session.players.map((player) => ({ ...player, score: 0, isReady: false }));
    this.broadcastState();
  }

  private async reload(gameId: string, pin: string): Promise<void> {
    if (!pin) {
      return;
    }

    try {
      const loaded = await loadGameFromAppsScript(this.env.APPS_SCRIPT_URL, gameId, pin);
      this.session = {
        gameId,
        title: loaded.title || DEFAULT_TITLE,
        gameType: loaded.gameType || 'multiple_choice',
        phase: 'lobby',
        questions: loaded.questions || [],
        currentQuestionIndex: 0,
        questionStartedAt: null,
        resultsShownAt: null,
        players: [],
        answers: []
      };

      for (const [socket, meta] of this.sockets) {
        if (meta.role === 'player') {
          this.sockets.set(socket, { role: 'player', gameId });
          this.send(socket, { type: 'left' });
        }
      }

      this.broadcastState();
    } catch (error) {
      for (const [socket, meta] of this.sockets) {
        if (meta.role === 'host') {
          this.send(socket, { type: 'error', error: errorMessage(error) });
        }
      }
    }
  }

  private answer(playerId: string, optionIndex: number): void {
    if (!this.session || this.session.phase !== 'question' || this.session.questionStartedAt === null) {
      return;
    }

    const question = this.session.questions[this.session.currentQuestionIndex];
    if (!question || optionIndex < 0 || optionIndex >= question.options.length) {
      return;
    }

    const alreadyAnswered = this.session.answers.some(
      (answer) => answer.playerId === playerId && answer.questionId === question.id
    );
    if (alreadyAnswered) {
      return;
    }

    const responseTimeMs = Date.now() - this.session.questionStartedAt;
    const isCorrect = optionIndex === question.correctIndex;
    const score = calculateScore(isCorrect, responseTimeMs, question.timeLimit);
    const answer: PlayerAnswer = {
      playerId,
      questionId: question.id,
      optionIndex,
      isCorrect,
      responseTimeMs,
      score
    };

    this.session.answers = [...this.session.answers, answer];
    this.session.players = this.session.players.map((player) =>
      player.id === playerId ? { ...player, score: player.score + score } : player
    );
    this.broadcastState();
  }

  private publicState(role: ClientRole): unknown {
    if (!this.session) {
      return null;
    }

    const question = this.session.questions[this.session.currentQuestionIndex];
    return {
      gameId: this.session.gameId,
      version: WORKER_VERSION,
      title: this.session.title,
      gameType: this.session.gameType,
      phase: this.session.phase,
      players: this.session.players,
      currentQuestionIndex: this.session.currentQuestionIndex,
      questionCount: this.session.questions.length,
      questionStartedAt: this.session.questionStartedAt,
      resultsShownAt: this.session.resultsShownAt,
      currentQuestion: question ? publicQuestion(question, role) : null,
      answers: role === 'host' ? this.session.answers : undefined
    };
  }

  private scheduleQuestionTimeout(): void {
    const session = this.session;
    const question = session?.questions[session.currentQuestionIndex];
    const questionStartedAt = session?.questionStartedAt;

    if (!session || !question || !questionStartedAt) {
      return;
    }

    const delayMs = Math.max(0, question.timeLimit * 1000);
    this.state.waitUntil(
      scheduler.wait(delayMs).then(() => {
        if (
          this.session?.phase === 'question' &&
          this.session.currentQuestionIndex === session.currentQuestionIndex &&
          this.session.questionStartedAt === questionStartedAt
        ) {
          this.showResults();
        }
      })
    );
  }

  private scheduleNextQuestion(): void {
    const session = this.session;
    const resultsShownAt = session?.resultsShownAt;

    if (!session || !resultsShownAt) {
      return;
    }

    this.state.waitUntil(
      scheduler.wait(RESULT_DISPLAY_MS).then(() => {
        if (this.session?.phase === 'results' && this.session.resultsShownAt === resultsShownAt) {
          this.next();
        }
      })
    );
  }

  private broadcastState(): void {
    for (const [socket, meta] of this.sockets) {
      this.send(socket, {
        type: 'state',
        state: this.publicState(meta.role)
      });
    }
  }

  private send(socket: WebSocket, payload: unknown): void {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      this.sockets.delete(socket);
    }
  }
}

async function loadGameFromAppsScript(appsScriptUrl: string, gameId: string, pin: string): Promise<AppsScriptResponse> {
  const url = new URL(appsScriptUrl);
  url.searchParams.set('gameId', gameId);
  url.searchParams.set('pin', pin);

  const response = await fetch(url.toString(), {
    redirect: 'follow'
  });
  const payload = (await response.json()) as AppsScriptResponse;

  if (!payload.ok) {
    throw new Error(payload.message || payload.error || 'APPS_SCRIPT_ERROR');
  }

  if (!payload.questions || payload.questions.length === 0) {
    throw new Error('NO_QUESTIONS');
  }

  return payload;
}

function readGameIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/rooms\/([a-z0-9-]+)\/ws$/);
  return match?.[1] || null;
}

function publicQuestion(question: Question, role: ClientRole): PublicQuestion | Question {
  if (role === 'host') {
    return question;
  }

  return {
    id: question.id,
    text: question.text,
    options: question.options,
    timeLimit: question.timeLimit,
    category: question.category,
    difficulty: question.difficulty
  };
}

function parseMessage(data: unknown): Record<string, unknown> | null {
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

function calculateScore(isCorrect: boolean, responseTimeMs: number, timeLimitSeconds: number): number {
  if (!isCorrect) {
    return 0;
  }

  const timeLimitMs = timeLimitSeconds * 1000;
  const speedRatio = Math.max(0, 1 - responseTimeMs / timeLimitMs);
  return 1000 + Math.round(500 * speedRatio);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return corsResponse(JSON.stringify(payload), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init?.headers
    }
  });
}

function corsResponse(body: BodyInit | null, init?: ResponseInit): Response {
  return new Response(body, {
    ...init,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      ...init?.headers
    }
  });
}
