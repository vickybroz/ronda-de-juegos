# Trivia Worker

Backend Cloudflare Worker + Durable Object para el MVP.

## URLs

WebSocket por partida:

```txt
wss://TU_WORKER.workers.dev/rooms/cumple-abril/ws?role=player
wss://TU_WORKER.workers.dev/rooms/cumple-abril/ws?role=host&pin=1234
```

## Mensajes jugador

Entrar:

```json
{ "type": "join", "name": "Vicky" }
```

Responder:

```json
{ "type": "answer", "optionIndex": 1 }
```

## Mensajes host

Iniciar:

```json
{ "type": "start" }
```

Mostrar resultados:

```json
{ "type": "showResults" }
```

Siguiente:

```json
{ "type": "next" }
```

Reset:

```json
{ "type": "reset" }
```

## Deploy con Wrangler

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

La URL del Apps Script esta en `wrangler.toml` como `APPS_SCRIPT_URL`.
