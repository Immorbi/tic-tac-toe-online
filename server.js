const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const BOARD_SIZE = 25; // 5x5
const TIMER_SECONDS = 20;

function createRoom(id) {
  return {
    id,
    players: [],
    board: Array(BOARD_SIZE).fill(null),
    currentTurn: 'X',
    gameOver: false,
    turnStarted: null,
  };
}

function checkWinner(board) {
  const SIZE = 5;
  const WIN = 5;

  // Строки
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c <= SIZE - WIN; c++) {
      const i = r * SIZE + c;
      const v = board[i];
      if (v && [1,2,3,4].every(k => board[i+k] === v))
        return { winner: v, line: [0,1,2,3,4].map(k => i+k) };
    }
  }
  // Столбцы
  for (let c = 0; c < SIZE; c++) {
    for (let r = 0; r <= SIZE - WIN; r++) {
      const i = r * SIZE + c;
      const v = board[i];
      if (v && [1,2,3,4].every(k => board[i+k*SIZE] === v))
        return { winner: v, line: [0,1,2,3,4].map(k => i+k*SIZE) };
    }
  }
  // Диагональ ↘
  for (let r = 0; r <= SIZE - WIN; r++) {
    for (let c = 0; c <= SIZE - WIN; c++) {
      const i = r * SIZE + c;
      const v = board[i];
      if (v && [1,2,3,4].every(k => board[i+k*(SIZE+1)] === v))
        return { winner: v, line: [0,1,2,3,4].map(k => i+k*(SIZE+1)) };
    }
  }
  // Диагональ ↙
  for (let r = 0; r <= SIZE - WIN; r++) {
    for (let c = WIN-1; c < SIZE; c++) {
      const i = r * SIZE + c;
      const v = board[i];
      if (v && [1,2,3,4].every(k => board[i+k*(SIZE-1)] === v))
        return { winner: v, line: [0,1,2,3,4].map(k => i+k*(SIZE-1)) };
    }
  }

  if (board.every(c => c !== null)) return { winner: 'draw' };
  return null;
}

function broadcast(room, message) {
  room.players.forEach(({ ws }) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  });
}

function findOrCreateRoom() {
  for (const [, room] of rooms) {
    if (room.players.length === 1 && !room.gameOver) return room;
  }
  const id = Math.random().toString(36).slice(2, 8).toUpperCase();
  const room = createRoom(id);
  rooms.set(id, room);
  return room;
}

function switchTurn(room) {
  room.currentTurn = room.currentTurn === 'X' ? 'O' : 'X';
  room.turnStarted = Date.now();
  broadcast(room, {
    type: 'update',
    board: room.board,
    currentTurn: room.currentTurn,
    turnStarted: room.turnStarted,
    timerSeconds: TIMER_SECONDS,
  });
}

wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerSymbol = null;

  ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.type === 'join') {
      const room = findOrCreateRoom();
      playerRoom = room;
      playerSymbol = room.players.length === 0 ? 'X' : 'O';
      room.players.push({ ws, symbol: playerSymbol });

      ws.send(JSON.stringify({
        type: 'joined',
        symbol: playerSymbol,
        roomId: room.id,
        playersCount: room.players.length,
      }));

      if (room.players.length === 2) {
        room.turnStarted = Date.now();
        broadcast(room, {
          type: 'start',
          board: room.board,
          currentTurn: room.currentTurn,
          turnStarted: room.turnStarted,
          timerSeconds: TIMER_SECONDS,
        });
      }
    }

    if (msg.type === 'create') {
      const id = Math.random().toString(36).slice(2, 8).toUpperCase();
      const room = createRoom(id);
      rooms.set(id, room);
      playerRoom = room;
      playerSymbol = 'X';
      room.players.push({ ws, symbol: 'X' });

      ws.send(JSON.stringify({
        type: 'joined',
        symbol: 'X',
        roomId: room.id,
        playersCount: 1,
      }));
    }

    if (msg.type === 'joinByCode') {
      const code = (msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);

      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена' }));
        return;
      }
      if (room.players.length >= 2) {
        ws.send(JSON.stringify({ type: 'error', message: 'Комната занята' }));
        return;
      }

      playerRoom = room;
      playerSymbol = 'O';
      room.players.push({ ws, symbol: 'O' });

      ws.send(JSON.stringify({
        type: 'joined',
        symbol: 'O',
        roomId: room.id,
        playersCount: 2,
      }));

      room.turnStarted = Date.now();
      broadcast(room, {
        type: 'start',
        board: room.board,
        currentTurn: room.currentTurn,
        turnStarted: room.turnStarted,
        timerSeconds: TIMER_SECONDS,
      });
    }

    if (msg.type === 'move' && playerRoom) {
      const room = playerRoom;
      const { index } = msg;
      if (room.gameOver || room.players.length < 2 || room.currentTurn !== playerSymbol || room.board[index] !== null) return;

      room.board[index] = playerSymbol;
      const result = checkWinner(room.board);

      if (result) {
        room.gameOver = true;
        broadcast(room, { type: 'gameOver', board: room.board, result });
      } else {
        switchTurn(room);
      }
    }

    if (msg.type === 'timeout' && playerRoom) {
      const room = playerRoom;
      if (room.gameOver || room.players.length < 2 || room.currentTurn !== playerSymbol) return;
      // Пропускаем ход
      switchTurn(room);
    }

    if (msg.type === 'chat' && playerRoom) {
      const room = playerRoom;
      broadcast(room, {
        type: 'chat',
        from: playerSymbol,
        text: msg.text.slice(0, 200),
      });
    }

    if (msg.type === 'restart' && playerRoom) {
      const room = playerRoom;
      room.board = Array(BOARD_SIZE).fill(null);
      room.currentTurn = 'X';
      room.gameOver = false;
      room.turnStarted = Date.now();
      broadcast(room, {
        type: 'start',
        board: room.board,
        currentTurn: room.currentTurn,
        turnStarted: room.turnStarted,
        timerSeconds: TIMER_SECONDS,
      });
    }
  });

  ws.on('close', () => {
    if (playerRoom) {
      broadcast(playerRoom, { type: 'opponentLeft' });
      rooms.delete(playerRoom.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
