import { GameState } from './game.models';

export function createInitialGameState(gameId = 'demo'): GameState {
  return {
    code: gameId,
    title: 'Ronda de Juegos',
    phase: 'lobby',
    players: [],
    questions: [],
    currentQuestionIndex: 0,
    questionStartedAt: null
  };
}
