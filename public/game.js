// --- DOM ---
const lobby       = document.getElementById('lobby');
const waiting     = document.getElementById('waiting');
const game        = document.getElementById('game');
const joinBtn     = document.getElementById('joinBtn');
const restartBtn  = document.getElementById('restartBtn');
const statusEl    = document.getElementById('status');
const roomIdEl    = document.getElementById('roomId');
const boardEl     = document.getElementById('board');
const scoreXEl    = document.getElementById('scoreX');
const scoreOEl    = document.getElementById('scoreO');
const scoreDrawEl = document.getElementById('scoreDraw');
const timerEl     = document.getElementById('timer');
const timerArc    = document.getElementById('timerArc');
const timerCount  = document.getElementById('timerCount');
const chatMessages = document.getElementById('chatMessages');
const chatInput   = document.getElementById('chatInput');
const chatSend    = document.getElementById('chatSend');

// --- Состояние ---
let ws, mySymbol, currentTurn, gameActive = false;
let timerInterval = null, timerSeconds = 20, timerStarted = null;
const score = { X: 0, O: 0, draw: 0 };
const BOARD_SIZE = 25;

// --- Генерация доски ---
const cells = [];
for (let i = 0; i < BOARD_SIZE; i++) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.dataset.index = i;
  cell.addEventListener('click', () => onCellClick(i));
  boardEl.appendChild(cell);
  cells.push(cell);
}

// --- Звуки (Web Audio API) ---
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;

function getAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playSound(type) {
  try {
    const ctx = getAudio();
    const now = ctx.currentTime;

    if (type === 'move') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 520; o.type = 'sine';
      g.gain.setValueAtTime(0.25, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      o.start(now); o.stop(now + 0.12);
    }

    if (type === 'tick') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 900; o.type = 'square';
      g.gain.setValueAtTime(0.15, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      o.start(now); o.stop(now + 0.06);
    }

    if (type === 'timeout') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 220; o.type = 'sawtooth';
      g.gain.setValueAtTime(0.3, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      o.start(now); o.stop(now + 0.5);
    }

    if (type === 'win') {
      [523, 659, 784, 1047].forEach((freq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq; o.type = 'sine';
        const t = now + i * 0.14;
        g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.start(t); o.stop(t + 0.3);
      });
    }

    if (type === 'draw') {
      [400, 350].forEach((freq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq;
        const t = now + i * 0.18;
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        o.start(t); o.stop(t + 0.25);
      });
    }
  } catch (e) { /* звук недоступен */ }
}

// --- Таймер ---
function startTimer(startedAt, seconds) {
  timerSeconds = seconds;
  timerStarted = startedAt;
  timerEl.classList.remove('hidden');
  clearInterval(timerInterval);

  const circumference = 94.2;

  function tick() {
    const elapsed = (Date.now() - timerStarted) / 1000;
    const remaining = Math.max(0, timerSeconds - elapsed);
    const secs = Math.ceil(remaining);
    const fraction = remaining / timerSeconds;

    timerCount.textContent = secs;
    timerArc.style.strokeDashoffset = circumference * (1 - fraction);

    const urgent = remaining <= 5;
    timerArc.classList.toggle('urgent', urgent);

    if (urgent && secs !== Math.ceil((Date.now() - 100 - timerStarted) / 1000)) {
      // каждую секунду в режиме urgent — тик
    }

    if (remaining <= 5 && remaining > 0) {
      playSound('tick');
    }

    if (remaining <= 0) {
      clearInterval(timerInterval);
      if (gameActive && currentTurn === mySymbol) {
        playSound('timeout');
        ws.send(JSON.stringify({ type: 'timeout' }));
      }
    }
  }

  tick();
  timerInterval = setInterval(tick, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerEl.classList.add('hidden');
}

// --- WebSocket ---
joinBtn.addEventListener('click', () => {
  lobby.classList.add('hidden');
  waiting.classList.remove('hidden');
  connect();
});

restartBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'restart' }));
  restartBtn.classList.add('hidden');
});

function onCellClick(index) {
  if (!gameActive || currentTurn !== mySymbol || cells[index].classList.contains('taken')) return;
  playSound('move');
  ws.send(JSON.stringify({ type: 'move', index }));
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}`);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join' }));
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => {
    if (gameActive) { showStatus('Соединение потеряно', 'game-over'); gameActive = false; stopTimer(); }
  };
}

function handle(msg) {
  switch (msg.type) {
    case 'joined':
      mySymbol = msg.symbol;
      roomIdEl.textContent = msg.roomId;
      break;

    case 'start':
      waiting.classList.add('hidden');
      game.classList.remove('hidden');
      restartBtn.classList.add('hidden');
      currentTurn = msg.currentTurn;
      gameActive = true;
      renderBoard(msg.board);
      updateStatus();
      startTimer(msg.turnStarted, msg.timerSeconds);
      addSystemMsg('Игра началась!');
      break;

    case 'update':
      currentTurn = msg.currentTurn;
      renderBoard(msg.board);
      updateStatus();
      startTimer(msg.turnStarted, msg.timerSeconds);
      break;

    case 'gameOver': {
      gameActive = false;
      stopTimer();
      renderBoard(msg.board, msg.result.line);
      const { winner } = msg.result;
      if (winner === 'draw') {
        score.draw++;
        showStatus('Ничья!', 'game-over');
        playSound('draw');
      } else if (winner === mySymbol) {
        score[winner]++;
        showStatus('Вы победили! 🎉', 'game-over');
        playSound('win');
      } else {
        score[winner]++;
        showStatus('Соперник победил', 'game-over');
      }
      updateScore();
      restartBtn.classList.remove('hidden');
      break;
    }

    case 'opponentLeft':
      gameActive = false;
      stopTimer();
      showStatus('Соперник покинул игру', 'game-over');
      addSystemMsg('Соперник отключился');
      restartBtn.classList.add('hidden');
      break;

    case 'chat':
      addChatMsg(msg.from, msg.text);
      break;
  }
}

// --- Доска ---
function renderBoard(board, winLine = []) {
  cells.forEach((cell, i) => {
    cell.textContent = board[i] || '';
    cell.className = 'cell';
    if (board[i]) cell.classList.add('taken', board[i]);
    if (winLine && winLine.includes(i)) cell.classList.add('winner');
  });
}

function updateStatus() {
  if (currentTurn === mySymbol) showStatus(`Ваш ход (${mySymbol})`, 'your-turn');
  else showStatus(`Ход соперника (${currentTurn})`, 'opponent-turn');
}

function showStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = cls;
}

function updateScore() {
  scoreXEl.textContent = score.X;
  scoreOEl.textContent = score.O;
  scoreDrawEl.textContent = score.draw;
}

// --- Чат ---
function addChatMsg(from, text) {
  const isMine = from === mySymbol;
  const wrap = document.createElement('div');
  wrap.className = `chat-msg ${isMine ? 'mine' : 'theirs'}`;

  const label = document.createElement('div');
  label.className = 'chat-label';
  label.textContent = isMine ? 'Вы' : `Соперник (${from})`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.textContent = text;

  wrap.appendChild(label);
  wrap.appendChild(bubble);
  chatMessages.appendChild(wrap);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMsg(text) {
  const el = document.createElement('div');
  el.className = 'chat-system';
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChat() {
  const text = chatInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'chat', text }));
  chatInput.value = '';
}

chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
