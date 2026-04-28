import { Component, computed, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConnectionStatus, GameClient } from './game-client';
import { createInitialGameState } from './mock-game';
import { GameState, Player } from './game.models';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnDestroy, OnInit {
  protected readonly hasGameRoute = signal(hasRouteGameId());
  protected readonly gameId = signal(readRouteGameId());
  protected readonly viewMode = signal<'host' | 'player'>(readHostPinFromRoute() ? 'host' : 'player');
  protected readonly state = signal(createInitialGameState(this.gameId()));
  protected readonly playerName = signal('Vicky');
  protected readonly currentPlayerId = signal<string | null>(null);
  protected readonly selectedOption = signal<number | null>(null);
  protected readonly now = signal(Date.now());
  protected readonly hostPin = signal(readHostPinFromRoute());
  protected readonly loadStatus = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  protected readonly loadError = signal('');
  protected readonly connectionStatus = signal<ConnectionStatus>('idle');

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

    this.connect();
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

  protected readonly questionCount = computed(() => this.state().questionCount ?? this.state().questions.length);

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

  protected joinAsPlayer(): void {
    const name = this.playerName().trim() || 'Jugador';
    this.client?.join(name);
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

  protected resetGame(): void {
    this.selectedOption.set(null);
    this.client?.reset();
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
      onState: (state) => this.applyServerState(state),
      onJoined: (playerId) => this.currentPlayerId.set(playerId),
      onStatus: (status) => this.applyConnectionStatus(status)
    });
    this.client.connect();
  }

  private applyServerState(serverState: GameState): void {
    this.state.set({
      ...createInitialGameState(this.gameId()),
      ...serverState,
      code: serverState.code || serverState.gameId || this.gameId(),
      questions: serverState.currentQuestion ? [serverState.currentQuestion] : []
    } as GameState);
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

    if (status === 'error') {
      if (this.viewMode() === 'host') {
        redirectToDefaultPage();
        return;
      }

      this.loadStatus.set('error');
      this.loadError.set('No se pudo conectar con la partida.');
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

function redirectToDefaultPage(): void {
  window.location.replace('/');
}
