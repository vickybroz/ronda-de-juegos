export type GamePhase = 'lobby' | 'question' | 'results' | 'finished';

export interface Player {
  id: string;
  name: string;
  score: number;
  isReady: boolean;
  connected?: boolean;
  lastAnswer?: PlayerAnswer;
}

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctIndex?: number;
  timeLimit: number;
  category?: string;
  difficulty?: string;
}

export interface PlayerAnswer {
  questionId: string;
  optionIndex: number;
  isCorrect: boolean;
  responseTimeMs: number;
  score: number;
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
  questionCount?: number;
  currentQuestion?: Question | null;
  answers?: PlayerAnswer[];
}
