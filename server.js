const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Хранилище комнат
const rooms = new Map();

function createRoom(id) {
  return {
    id,
    players: [],
    board: Array(9).fill(null),
    currentTurn: 'X',
    gameOver: false,
  };
}

function checkWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // строки
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // столбцы
    [0, 4, 8], [2, 4, 6],             // диагонали
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] };
    }
  }
  if (board.every(cell => cell !== null)) return { winner: 'draw' };
  return null;
}

function broadcast(room, message) {
  room.players.forEach(({ ws }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
}

function findOrCreateRoom() {
  for (const [id, room] of rooms) {
    if (room.players.length === 1 && !room.gameOver) return room;
  }
  const id = Math.random().toString(36).slice(2, 8).toUpperCase();
  const room = createRoom(id);
  rooms.set(id, room);
  return room;
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
        broadcast(room, {
          type: 'start',
          board: room.board,
          currentTurn: room.currentTurn,
        });
      }
    }

    if (msg.type === 'move' && playerRoom) {
      const room = playerRoom;
      const { index } = msg;

      if (
        room.gameOver ||
        room.players.length < 2 ||
        room.currentTurn !== playerSymbol ||
        room.board[index] !== null
      ) return;

      room.board[index] = playerSymbol;
      const result = checkWinner(room.board);

      if (result) {
        room.gameOver = true;
        broadcast(room, {
          type: 'gameOver',
          board: room.board,
          result,
        });
      } else {
        room.currentTurn = room.currentTurn === 'X' ? 'O' : 'X';
        broadcast(room, {
          type: 'update',
          board: room.board,
          currentTurn: room.currentTurn,
        });
      }
    }

    if (msg.type === 'restart' && playerRoom) {
      const room = playerRoom;
      room.board = Array(9).fill(null);
      room.currentTurn = 'X';
      room.gameOver = false;
      broadcast(room, {
        type: 'start',
        board: room.board,
        currentTurn: room.currentTurn,
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
