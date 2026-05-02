# Apps Script para Google Sheets

## Formato de cada tab

El nombre de la tab es el `gameId`, por ejemplo:

```txt
cumple-abril
```

Config:

```txt
A1 game_id      B1 cumple-abril
A2 title        B2 Trivia cumple abril
A3 host_pin     B3 1234
A4 game_type    B4 multiple_choice
```

Headers en fila 6:

```txt
pregunta | opcion_a | opcion_b | opcion_c | opcion_d | correcta | tiempo | puntos | categoria | dificultad
```

Preguntas desde fila 7.

Si `B1 game_id` esta vacio, la sala queda deshabilitada y no se puede entrar.

## Deploy

1. Abrir el Google Sheet.
2. Ir a `Extensiones > Apps Script`.
3. Pegar el contenido de `docs/apps-script.js`.
4. Guardar.
5. `Implementar > Nueva implementacion`.
6. Tipo: `Aplicacion web`.
7. Ejecutar como: `Yo`.
8. Quien tiene acceso: `Cualquier usuario con el enlace`.
9. Copiar la URL `/exec`.

## URLs de prueba

Publica, sin preguntas:

```txt
https://script.google.com/macros/s/.../exec?gameId=cumple-abril
```

Host, con preguntas y respuestas correctas:

```txt
https://script.google.com/macros/s/.../exec?gameId=cumple-abril&pin=1234
```

JSONP, usado por el frontend para evitar CORS:

```txt
https://script.google.com/macros/s/.../exec?gameId=cumple-abril&pin=1234&callback=miCallback
```

Si el PIN esta mal devuelve:

```json
{
  "ok": false,
  "status": 403,
  "error": "INVALID_PIN"
}
```
