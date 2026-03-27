const lobby = document.getElementById('lobby');
const waiting = document.getElementById('waiting');
const game = document.getElementById('game');
const joinBtn = document.getElementById('joinBtn');
const restartBtn = document.getElementById('restartBtn');
const statusEl = document.getElementById('status');
const roomIdEl = document.getElementById('roomId');
const cells = document.querySelectorAll('.cell');
const scoreX = document.getElementById('scoreX');
const scoreO = document.getElementById('scoreO');
const scoreDraw = document.getElementById('scoreDraw');

let ws;
let mySymbol = null;
let currentTurn = null;
let gameActive = false;
const score = { X: 0, O: 0, draw: 0 };

joinBtn.addEventListener('click', () => {
  lobby.classList.add('hidden');
  waiting.classList.remove('hidden');
  connect();
});

restartBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'restart' }));
  restartBtn.classList.add('hidden');
});

cells.forEach(cell => {
  cell.addEventListener('click', () => {
    const index = parseInt(cell.dataset.index);
    if (!gameActive || currentTurn !== mySymbol || cell.classList.contains('taken')) return;
    ws.send(JSON.stringify({ type: 'move', index }));
  });
});

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join' }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handle(msg);
  };

  ws.onclose = () => {
    if (gameActive) {
      showStatus('Соединение потеряно', 'game-over');
      gameActive = false;
    }
  };
}

function handle(msg) {
  switch (msg.type) {
    case 'joined':
      mySymbol = msg.symbol;
      roomIdEl.textContent = msg.roomId;
      if (msg.playersCount < 2) {
        // ждём второго игрока
      }
      break;

    case 'start':
      waiting.classList.add('hidden');
      game.classList.remove('hidden');
      restartBtn.classList.add('hidden');
      currentTurn = msg.currentTurn;
      gameActive = true;
      renderBoard(msg.board);
      updateStatus();
      break;

    case 'update':
      currentTurn = msg.currentTurn;
      renderBoard(msg.board);
      updateStatus();
      break;

    case 'gameOver':
      gameActive = false;
      renderBoard(msg.board, msg.result.line);
      const { winner } = msg.result;
      if (winner === 'draw') {
        score.draw++;
        showStatus('Ничья!', 'game-over');
      } else if (winner === mySymbol) {
        score[winner]++;
        showStatus('Вы победили!', 'game-over');
      } else {
        score[winner]++;
        showStatus('Соперник победил!', 'game-over');
      }
      updateScore();
      restartBtn.classList.remove('hidden');
      break;

    case 'opponentLeft':
      gameActive = false;
      showStatus('Соперник покинул игру', 'game-over');
      restartBtn.classList.add('hidden');
      break;
  }
}

function renderBoard(board, winLine = []) {
  cells.forEach((cell, i) => {
    cell.textContent = board[i] || '';
    cell.className = 'cell';
    if (board[i]) {
      cell.classList.add('taken', board[i]);
    }
    if (winLine.includes(i)) {
      cell.classList.add('winner');
    }
  });
}

function updateStatus() {
  if (currentTurn === mySymbol) {
    showStatus(`Ваш ход (${mySymbol})`, 'your-turn');
  } else {
    showStatus(`Ход соперника (${currentTurn})`, 'opponent-turn');
  }
}

function showStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = cls;
}

function updateScore() {
  scoreX.textContent = score.X;
  scoreO.textContent = score.O;
  scoreDraw.textContent = score.draw;
}
