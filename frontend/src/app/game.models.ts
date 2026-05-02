export type GamePhase = 'lobby' | 'question' | 'results' | 'finished';

export interface Player {
  id: string;
  name: string;
  score: number;
  isReady: boolean;
  connected?: boolean;
  invitationHash?: string;
  lastAnswer?: PlayerAnswer;
}

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctIndex?: number;
  timeLimit: number;
  points: number;
  category?: string;
  difficulty?: string;
}

export interface PlayerAnswer {
  playerId?: string;
  questionId: string;
  optionIndex: number;
  isCorrect: boolean;
  responseTimeMs: number;
  score: number;
}

export interface Invitation {
  hash: string;
  createdAt: number;
  usedByPlayerId?: string;
  usedByPlayerName?: string;
}

export interface GameState {
  gameId?: string;
  version?: string;
  code: string;
  title: string;
  phase: GamePhase;
  players: Player[];
  questions: Question[];
  currentQuestionIndex: number;
  questionStartedAt: number | null;
  resultsShownAt?: number | null;
  questionCount?: number;
  currentQuestion?: Question | null;
  answers?: PlayerAnswer[];
  invitationHash?: string;
  invitationUses?: number;
  invitations?: Invitation[];
}
