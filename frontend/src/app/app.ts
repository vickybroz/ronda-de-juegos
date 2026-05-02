import { Component, computed, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { APP_VERSION } from './app-version';
import { ConnectionStatus, GameClient, validateRoom } from './game-client';
import { createInitialGameState } from './mock-game';
import { GameState, Invitation, Player } from './game.models';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnDestroy, OnInit {
  protected readonly appVersion = APP_VERSION;
  protected readonly hasGameRoute = signal(hasRouteGameId());
  protected readonly gameId = signal(readRouteGameId());
  protected readonly viewMode = signal<'host' | 'player'>(readHostPinFromRoute() ? 'host' : 'player');
  protected readonly state = signal(createInitialGameState(this.gameId()));
  protected readonly playerName = signal('Vicky');
  protected readonly currentPlayerId = signal<string | null>(null);
  protected readonly selectedOption = signal<number | null>(null);
  protected readonly now = signal(Date.now());
  protected readonly hostPin = signal(readHostPinFromRoute());
  protected readonly inviteHash = signal(readInviteHashFromRoute());
  protected readonly activeInviteHash = signal('');
  protected readonly inviteStatus = signal('');
  protected readonly routeStatus = signal<'validating' | 'valid' | 'invalid' | 'error'>(
    hasRouteGameId() ? 'validating' : 'invalid'
  );
  protected readonly loadStatus = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  protected readonly loadError = signal('');
  protected readonly connectionStatus = signal<ConnectionStatus>('idle');
  protected readonly lastServerEvent = signal('sin eventos');

  private client: GameClient | null = null;
  private readonly timer = window.setInterval(() => {
    this.now.set(Date.now());
  }, 250);

  ngOnInit(): void {
    if (!this.hasGameRoute()) {
      return;
    }

    if (this.viewMode() === 'host' && !this.hostPin()) {
      redirectToDefaultPage();
      return;
    }

    if (this.viewMode() === 'player' && !this.inviteHash()) {
      redirectToDefaultPage();
      return;
    }

    void this.validateAndConnect();
  }

  ngOnDestroy(): void {
    window.clearInterval(this.timer);
    this.client?.close();
  }

  protected readonly currentQuestion = computed(() => this.state().currentQuestion ?? null);

  protected readonly player = computed(() => {
    const id = this.currentPlayerId();
    return this.state().players.find((player) => player.id === id) ?? null;
  });

  protected readonly sortedPlayers = computed(() =>
    [...this.state().players].sort((left, right) => right.score - left.score)
  );

  protected readonly readyCount = computed(() => this.state().players.filter((player) => player.isReady).length);

  protected readonly hasScoresToReset = computed(() => this.state().players.some((player) => player.score > 0));

  protected readonly questionCount = computed(() => this.state().questionCount ?? this.state().questions.length);

  protected readonly playerPanelTitle = computed(() => (this.state().phase === 'lobby' ? 'Lobby' : 'Ronda'));

  protected readonly currentAnsweredPlayerIds = computed(() => {
    const question = this.currentQuestion();

    if (!question) {
      return new Set<string>();
    }

    return new Set(
      (this.state().answers || [])
        .filter((answer) => answer.questionId === question.id)
        .map((answer) => answer.playerId)
        .filter((playerId): playerId is string => Boolean(playerId))
    );
  });

  protected hasPlayerAnsweredCurrent(playerId: string): boolean {
    return this.currentAnsweredPlayerIds().has(playerId);
  }

  protected currentPlayerAnswerState(playerId: string): 'answered' | 'waiting' | 'missed' | null {
    if (!this.currentQuestion()) {
      return null;
    }

    if (this.state().phase === 'question') {
      return this.hasPlayerAnsweredCurrent(playerId) ? 'answered' : 'waiting';
    }

    if (this.state().phase === 'results') {
      return this.hasPlayerAnsweredCurrent(playerId) ? 'answered' : 'missed';
    }

    return null;
  }

  protected readonly timeLeft = computed(() => {
    const state = this.state();
    const question = this.currentQuestion();
    if (!question || state.phase !== 'question' || !state.questionStartedAt) {
      return question?.timeLimit ?? 0;
    }

    const elapsed = (this.now() - state.questionStartedAt) / 1000;
    return Math.max(0, Math.ceil(question.timeLimit - elapsed));
  });

  protected readonly progress = computed(() => {
    const question = this.currentQuestion();
    if (!question) {
      return 0;
    }

    return Math.max(0, Math.min(100, (this.timeLeft() / question.timeLimit) * 100));
  });

  protected readonly hasAnswered = computed(() => this.selectedOption() !== null);

  protected readonly invitationCode = computed(
    () => this.activeInviteHash() || this.state().invitationHash || this.inviteHash()
  );

  protected readonly invitationConfirmed = computed(() => (this.state().invitationUses || 0) > 0);

  protected readonly lobbyInvitations = computed<Invitation[]>(() => {
    const invitations = this.state().invitations || [];
    const activeHash = this.activeInviteHash();
    const pendingInvitations = invitations.filter((invitation) => !invitation.usedByPlayerId);

    if (activeHash && !invitations.some((invitation) => invitation.hash === activeHash)) {
      return [...pendingInvitations, { hash: activeHash, createdAt: Date.now() }];
    }

    return pendingInvitations;
  });

  protected joinAsPlayer(): void {
    const name = this.playerName().trim() || 'Jugador';
    this.client?.join(name);
  }

  protected readonly lobbyInviteUrl = computed(() => {
    return this.buildLobbyInviteUrl(this.invitationCode());
  });

  protected async shareLobbyLink(): Promise<void> {
    const code = await this.createFreshInvitation();
    const url = this.buildLobbyInviteUrl(code);
    const status = code ? `Codigo de invitacion ${code}` : 'Codigo de invitacion pendiente';

    try {
      if (navigator.share) {
        await navigator.share({
          title: this.state().title,
          text: 'Unite a la partida de Ronda de Juegos!',
          url
        });
        this.inviteStatus.set(status);
        return;
      }

      await this.copyLobbyLink();
    } catch {
      this.inviteStatus.set(status);
    }
  }

  protected async copyLobbyLink(): Promise<void> {
    const code = await this.createFreshInvitation();
    const url = this.buildLobbyInviteUrl(code);

    try {
      await navigator.clipboard.writeText(url);
      this.inviteStatus.set(code ? `Codigo de invitacion ${code}` : 'Link copiado');
    } catch {
      this.inviteStatus.set(url);
    }
  }

  protected startGame(): void {
    this.selectedOption.set(null);
    this.client?.start();
  }

  protected submitAnswer(optionIndex: number): void {
    if (!this.player() || this.state().phase !== 'question' || this.hasAnswered()) {
      return;
    }

    this.selectedOption.set(optionIndex);
    this.client?.answer(optionIndex);
  }

  protected showResults(): void {
    this.client?.showResults();
  }

  protected nextQuestion(): void {
    this.selectedOption.set(null);
    this.client?.next();
  }

  protected finishGame(): void {
    this.selectedOption.set(null);
    this.client?.finish();
  }

  protected resetGame(): void {
    this.selectedOption.set(null);
    this.client?.reset();
  }

  protected reloadGame(): void {
    this.selectedOption.set(null);
    this.currentPlayerId.set(null);
    this.client?.reload();
  }

  protected leaveGame(): void {
    this.selectedOption.set(null);
    this.currentPlayerId.set(null);
    this.client?.leave();
  }

  protected trackPlayer(_: number, player: Player): string {
    return player.id;
  }

  private connect(): void {
    this.loadStatus.set('loading');
    this.loadError.set('');

    this.client = new GameClient({
      gameId: this.gameId(),
      role: this.viewMode(),
      pin: this.hostPin(),
      inviteHash: this.inviteHash(),
      onState: (state) => this.applyServerState(state),
      onJoined: (playerId) => {
        this.currentPlayerId.set(playerId || null);
        this.lastServerEvent.set(playerId ? `joined:${playerId.slice(0, 8)}` : 'left');
      },
      onInvitation: (hash) => {
        this.activeInviteHash.set(hash);
        this.pendingInvitationResolver?.(hash);
        this.pendingInvitationResolver = null;
      },
      onStatus: (status) => this.applyConnectionStatus(status)
    });
    this.client.connect();
  }

  private async validateAndConnect(): Promise<void> {
    this.loadStatus.set('loading');
    this.loadError.set('');

    try {
      const validation = await validateRoom(this.gameId(), this.viewMode(), this.hostPin(), this.inviteHash());

      if (!validation.ok) {
        if (
          validation.status === 404 ||
          validation.error === 'GAME_NOT_FOUND' ||
          validation.error === 'GAME_DISABLED' ||
          validation.error === 'INVALID_INVITATION' ||
          validation.error === 'INVITATION_REQUIRED'
        ) {
          this.routeStatus.set('invalid');
          redirectToDefaultPage();
          return;
        }

        this.routeStatus.set('error');
        this.loadStatus.set('error');
        this.loadError.set(validation.error || 'No se pudo validar la sala.');
        return;
      }

      this.routeStatus.set('valid');
      this.connect();
    } catch {
      this.routeStatus.set('error');
      this.loadStatus.set('error');
      this.loadError.set('No se pudo validar la sala contra el worker.');
    }
  }

  private pendingInvitationResolver: ((hash: string) => void) | null = null;

  private createFreshInvitation(): Promise<string> {
    if (this.viewMode() !== 'host' || this.connectionStatus() !== 'connected') {
      return Promise.resolve(this.invitationCode());
    }

    return new Promise((resolve) => {
      const fallback = window.setTimeout(() => {
        if (this.pendingInvitationResolver) {
          this.pendingInvitationResolver = null;
          resolve(this.invitationCode());
        }
      }, 1200);

      this.pendingInvitationResolver = (hash) => {
        window.clearTimeout(fallback);
        resolve(hash);
      };

      this.client?.createInvitation();
    });
  }

  private buildLobbyInviteUrl(hash: string): string {
    const path = `/${this.state().code || this.gameId()}`;
    const url = new URL(path, shareableOrigin());

    if (hash) {
      url.searchParams.set('ci', hash);
    }

    return url.toString();
  }

  private applyServerState(serverState: GameState): void {
    this.state.set({
      ...createInitialGameState(this.gameId()),
      ...serverState,
      code: serverState.code || serverState.gameId || this.gameId(),
      questions: serverState.questions?.length
        ? serverState.questions
        : serverState.currentQuestion
          ? [serverState.currentQuestion]
          : []
    } as GameState);
    this.lastServerEvent.set(`${serverState.phase} · ${serverState.players.length} jugador(es)`);
    this.loadStatus.set('loaded');

    if (serverState.phase !== 'question') {
      this.selectedOption.set(null);
    }
  }

  private applyConnectionStatus(status: ConnectionStatus): void {
    this.connectionStatus.set(status);

    if (status === 'connecting') {
      this.loadStatus.set('loading');
      return;
    }

    if (status === 'connected') {
      this.loadStatus.set('loaded');
      return;
    }

    if (status === 'error' || status === 'closed') {
      this.loadStatus.set('error');
      this.loadError.set(
        this.viewMode() === 'host'
          ? 'No se pudo conectar con el worker. En local, levantalo con npm run dev dentro de worker.'
          : 'No se pudo conectar con la partida.'
      );
    }
  }
}

function readRouteGameId(): string {
  const firstSegment = window.location.pathname.split('/').filter(Boolean)[0];
  return firstSegment || 'demo';
}

function hasRouteGameId(): boolean {
  return window.location.pathname.split('/').filter(Boolean).length > 0;
}

function readHostPinFromRoute(): string {
  return window.location.pathname.split('/').filter(Boolean)[1] || '';
}

function readInviteHashFromRoute(): string {
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get('ci') || searchParams.get('invite') || '';
}

function shareableOrigin(): string {
  if (window.location.hostname === 'localhost') {
    return `${window.location.protocol}//127.0.0.1:${window.location.port}`;
  }

  return window.location.origin;
}

function redirectToDefaultPage(): void {
  window.location.replace('/');
}
