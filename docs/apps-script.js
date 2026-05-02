const QUESTION_HEADER_ROW = 6;
const FIRST_QUESTION_ROW = 7;
const DEFAULT_TIME_LIMIT = 15;
const ALLOWED_GAME_ID = /^[a-z0-9-]+$/;

function doGet(event) {
  const params = (event && event.parameter) || {};

  try {
    const gameId = normalizeGameId(params.gameId);
    const pin = String(params.pin || '').trim();

    if (!gameId) {
      return jsonResponse({ error: 'MISSING_GAME_ID' }, 400, params.callback);
    }

    if (!ALLOWED_GAME_ID.test(gameId)) {
      return jsonResponse({ error: 'INVALID_GAME_ID' }, 400, params.callback);
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(gameId);

    if (!sheet) {
      return jsonResponse({ error: 'GAME_NOT_FOUND' }, 404, params.callback);
    }

    const config = readConfig(sheet);
    if (config.sheetGameId !== gameId) {
      return jsonResponse({ error: 'GAME_DISABLED', message: 'Game tab is disabled or game_id does not match.' }, 404, params.callback);
    }

    const isHostRequest = pin.length > 0;

    if (isHostRequest && pin !== config.hostPin) {
      return jsonResponse({ error: 'INVALID_PIN' }, 403, params.callback);
    }

    const questions = isHostRequest ? readQuestions(sheet) : [];

    return jsonResponse({
      gameId,
      title: config.title,
      gameType: config.gameType,
      host: isHostRequest,
      questions
    }, 200, params.callback);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);

    if (message === 'GAME_DISABLED') {
      return jsonResponse(
        {
          error: 'GAME_DISABLED',
          message: 'Game tab is disabled.'
        },
        404,
        params.callback
      );
    }

    return jsonResponse(
      {
        error: 'SERVER_ERROR',
        message
      },
      500,
      params.callback
    );
  }
}

function readConfig(sheet) {
  const sheetGameId = String(sheet.getRange('B1').getValue() || '').trim();
  const title = String(sheet.getRange('B2').getValue() || '').trim();
  const hostPin = String(sheet.getRange('B3').getValue() || '').trim();
  const gameType = String(sheet.getRange('B4').getValue() || 'multiple_choice').trim();

  if (!sheetGameId) {
    throw new Error('GAME_DISABLED');
  }

  if (!title) {
    throw new Error('Missing title in B2.');
  }

  if (!hostPin) {
    throw new Error('Missing host_pin in B3.');
  }

  if (gameType !== 'multiple_choice') {
    throw new Error('Unsupported game_type: ' + gameType);
  }

  return {
    sheetGameId,
    title,
    hostPin,
    gameType
  };
}

function readQuestions(sheet) {
  const lastRow = sheet.getLastRow();

  if (lastRow < FIRST_QUESTION_ROW) {
    throw new Error('No questions found.');
  }

  const rowCount = lastRow - FIRST_QUESTION_ROW + 1;
  const rows = sheet.getRange(FIRST_QUESTION_ROW, 1, rowCount, 10).getValues();
  const questions = [];

  rows.forEach(function (row, index) {
    const questionText = String(row[0] || '').trim();

    if (!questionText) {
      return;
    }

    const options = [
      String(row[1] || '').trim(),
      String(row[2] || '').trim(),
      String(row[3] || '').trim(),
      String(row[4] || '').trim()
    ].filter(Boolean);

    if (options.length < 2) {
      throw new Error('Question row ' + (FIRST_QUESTION_ROW + index) + ' needs at least 2 options.');
    }

    const correctIndex = parseCorrectIndex(row[5], options.length, FIRST_QUESTION_ROW + index);
    const timeLimit = parseTimeLimit(row[6]);
    const points = parsePoints(row[7]);
    const category = String(row[8] || '').trim();
    const difficulty = String(row[9] || '').trim();

    questions.push({
      id: 'q' + (questions.length + 1),
      text: questionText,
      options,
      correctIndex,
      timeLimit,
      points,
      category,
      difficulty
    });
  });

  if (questions.length === 0) {
    throw new Error('No valid questions found.');
  }

  return questions;
}

function parseCorrectIndex(value, optionCount, rowNumber) {
  const letter = String(value || '').trim().toUpperCase();
  const index = ['A', 'B', 'C', 'D'].indexOf(letter);

  if (index < 0 || index >= optionCount) {
    throw new Error('Invalid correct answer in row ' + rowNumber + '. Use A, B, C or D.');
  }

  return index;
}

function parseTimeLimit(value) {
  const parsed = Number(value || DEFAULT_TIME_LIMIT);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIME_LIMIT;
  }

  return Math.round(parsed);
}

function parsePoints(value) {
  const parsed = Number(value || 1);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }

  return Math.round(parsed);
}

function normalizeGameId(value) {
  return String(value || '').trim().toLowerCase();
}

function jsonResponse(payload, statusCode, callback) {
  const body = JSON.stringify({
    ok: !payload.error,
    status: statusCode || 200,
    ...payload
  });

  if (callback) {
    const safeCallback = String(callback).trim();

    if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(safeCallback)) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, status: 400, error: 'INVALID_CALLBACK' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(safeCallback + '(' + body + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}
