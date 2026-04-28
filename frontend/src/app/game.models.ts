export type GamePhase = 'lobby' | 'question' | 'results' | 'finished';

export interface Player {
  id: string;
  name: string;
  score: number;
  isReady: boolean;
  lastAnswer?: PlayerAnswer;
}

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
  timeLimit: number;
}

export interface PlayerAnswer {
  questionId: string;
  optionIndex: number;
  isCorrect: boolean;
  responseTimeMs: number;
  score: number;
}

export interface GameState {
  code: string;
  title: string;
  phase: GamePhase;
  players: Player[];
  questions: Question[];
  currentQuestionIndex: number;
  questionStartedAt: number | null;
}
