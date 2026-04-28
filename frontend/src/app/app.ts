import { Component, computed, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { fetchGameFromAppsScript } from './apps-script-client';
import { calculateScore, createInitialGameState } from './mock-game';
import { Player, Question } from './game.models';

const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbys-w2lJL0xjvdslAl4d0-y8YCinBrwjSW6LiKmCdNIEZMFIkkQMNMNgM_f47c-kO-X/exec';

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

  private readonly timer = window.setInterval(() => {
    this.now.set(Date.now());
    this.autoFinishExpiredQuestion();
  }, 250);

  ngOnInit(): void {
    if (this.viewMode() === 'host') {
      void this.loadHostGame();
    }
  }

  protected readonly currentQuestion = computed(() => {
    const state = this.state();
    return state.questions[state.currentQuestionIndex];
  });

  protected readonly player = computed(() => {
    const id = this.currentPlayerId();
    return this.state().players.find((player) => player.id === id) ?? null;
  });

  protected readonly sortedPlayers = computed(() =>
    [...this.state().players].sort((left, right) => right.score - left.score)
  );

  protected readonly readyCount = computed(() => this.state().players.filter((player) => player.isReady).length);

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

  ngOnDestroy(): void {
    window.clearInterval(this.timer);
  }

  private async loadHostGame(): Promise<void> {
    const pin = this.hostPin().trim();

    if (!pin) {
      redirectToDefaultPage();
      return;
    }

    this.loadStatus.set('loading');
    this.loadError.set('');

    try {
      const payload = await fetchGameFromAppsScript(APPS_SCRIPT_URL, this.gameId(), pin);
      const questions = normalizeQuestions(payload.questions || []);

      if (questions.length === 0) {
        throw new Error('La tab no tiene preguntas validas.');
      }

      this.state.update((state) => ({
        ...state,
        code: this.gameId(),
        title: payload.title || state.title,
        questions,
        phase: 'lobby',
        currentQuestionIndex: 0,
        questionStartedAt: null,
        players: state.players.map((player) => ({ ...player, score: 0, lastAnswer: undefined }))
      }));
      this.selectedOption.set(null);
      this.loadStatus.set('loaded');
    } catch (error) {
      if (shouldRedirectToDefaultPage(error)) {
        redirectToDefaultPage();
        return;
      }

      this.loadStatus.set('error');
      this.loadError.set(formatLoadError(error));
    }
  }

  protected joinAsPlayer(): void {
    const name = this.playerName().trim() || 'Jugador';
    const id = crypto.randomUUID();

    this.state.update((state) => ({
      ...state,
      players: [...state.players, { id, name, score: 0, isReady: true }]
    }));
    this.currentPlayerId.set(id);
  }

  protected markReady(playerId: string): void {
    this.state.update((state) => ({
      ...state,
      players: state.players.map((player) => (player.id === playerId ? { ...player, isReady: true } : player))
    }));
  }

  protected startGame(): void {
    this.state.update((state) => ({
      ...state,
      phase: 'question',
      currentQuestionIndex: 0,
      questionStartedAt: Date.now(),
      players: state.players.map((player) => ({ ...player, lastAnswer: undefined }))
    }));
    this.selectedOption.set(null);
  }

  protected submitAnswer(optionIndex: number): void {
    const player = this.player();
    const question = this.currentQuestion();
    const state = this.state();
    if (!player || !question || state.phase !== 'question' || player.lastAnswer) {
      return;
    }

    const responseTimeMs = Date.now() - (state.questionStartedAt ?? Date.now());
    const isCorrect = optionIndex === question.correctIndex;
    const score = calculateScore(isCorrect, responseTimeMs, question.timeLimit);
    this.selectedOption.set(optionIndex);

    this.state.update((current) => ({
      ...current,
      players: current.players.map((candidate) =>
        candidate.id === player.id
          ? {
              ...candidate,
              score: candidate.score + score,
              lastAnswer: {
                questionId: question.id,
                optionIndex,
                isCorrect,
                responseTimeMs,
                score
              }
            }
          : candidate
      )
    }));
  }

  protected simulateAnswers(): void {
    const question = this.currentQuestion();
    const state = this.state();
    if (!question || state.phase !== 'question') {
      return;
    }

    this.state.update((current) => ({
      ...current,
      players: current.players.map((player, index) => {
        if (player.lastAnswer) {
          return player;
        }

        const optionIndex = index % question.options.length;
        const responseTimeMs = 1800 + index * 900;
        const isCorrect = optionIndex === question.correctIndex;
        const score = calculateScore(isCorrect, responseTimeMs, question.timeLimit);

        return {
          ...player,
          score: player.score + score,
          lastAnswer: {
            questionId: question.id,
            optionIndex,
            isCorrect,
            responseTimeMs,
            score
          }
        };
      })
    }));
  }

  protected showResults(): void {
    this.state.update((state) => ({
      ...state,
      phase: 'results'
    }));
  }

  protected nextQuestion(): void {
    this.state.update((state) => {
      const nextIndex = state.currentQuestionIndex + 1;
      if (nextIndex >= state.questions.length) {
        return {
          ...state,
          phase: 'finished',
          questionStartedAt: null
        };
      }

      return {
        ...state,
        phase: 'question',
        currentQuestionIndex: nextIndex,
        questionStartedAt: Date.now(),
        players: state.players.map((player) => ({ ...player, lastAnswer: undefined }))
      };
    });
    this.selectedOption.set(null);
  }

  protected resetGame(): void {
    this.state.set(createInitialGameState(this.gameId()));
    this.currentPlayerId.set(null);
    this.selectedOption.set(null);
    this.playerName.set('Vicky');
    this.loadStatus.set('idle');
    this.loadError.set('');
  }

  protected trackPlayer(_: number, player: Player): string {
    return player.id;
  }

  private autoFinishExpiredQuestion(): void {
    const state = this.state();
    if (state.phase === 'question' && this.timeLeft() === 0) {
      this.showResults();
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

function normalizeQuestions(questions: Question[]): Question[] {
  return questions.map((question, index) => ({
    ...question,
    id: question.id || `q${index + 1}`,
    timeLimit: Number(question.timeLimit || 15)
  }));
}

function formatLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message === 'INVALID_PIN') {
    return 'PIN incorrecto.';
  }

  if (message === 'GAME_NOT_FOUND') {
    return 'No existe una tab con ese codigo de partida.';
  }

  if (message === 'INVALID_GAME_ID') {
    return 'El codigo de partida solo puede usar minusculas, numeros y guiones.';
  }

  return message;
}

function shouldRedirectToDefaultPage(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return ['INVALID_PIN', 'GAME_NOT_FOUND', 'INVALID_GAME_ID', 'MISSING_GAME_ID'].includes(message);
}

function redirectToDefaultPage(): void {
  window.location.replace('/');
}
