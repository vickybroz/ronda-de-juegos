import { GameState, Player, Question } from './game.models';

export const mockQuestions: Question[] = [
  {
    id: 'q1',
    text: 'Que tecnologia vamos a usar para coordinar una partida realtime en Cloudflare?',
    options: ['Durable Objects', 'GitHub Pages', 'Google Fonts', 'LocalStorage'],
    correctIndex: 0,
    timeLimit: 15
  },
  {
    id: 'q2',
    text: 'Donde vive la partida activa durante el MVP?',
    options: ['En cada celular', 'En un Durable Object', 'En un PDF', 'En el DNS'],
    correctIndex: 1,
    timeLimit: 12
  },
  {
    id: 'q3',
    text: 'Que dato no deberia recibir el jugador mientras responde?',
    options: ['Opciones', 'Pregunta', 'Respuesta correcta', 'Tiempo restante'],
    correctIndex: 2,
    timeLimit: 10
  }
];

export const mockPlayers: Player[] = [
  { id: 'ana', name: 'Ana', score: 0, isReady: true },
  { id: 'leo', name: 'Leo', score: 0, isReady: true },
  { id: 'mora', name: 'Mora', score: 0, isReady: false }
];

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

export function calculateScore(isCorrect: boolean, responseTimeMs: number, timeLimitSeconds: number): number {
  if (!isCorrect) {
    return 0;
  }

  const timeLimitMs = timeLimitSeconds * 1000;
  const speedRatio = Math.max(0, 1 - responseTimeMs / timeLimitMs);
  return 1000 + Math.round(500 * speedRatio);
}
