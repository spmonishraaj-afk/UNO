const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createGame, playCard, drawCard, autoDrawForTimeout, jumpIn, swapHands, callUno, catchUno, currentPlayer, botPickCard, playerHasStackCard } = require('./gameLogic');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const rooms = {};
const TURN_TIMER_MS = 15000;

// How many wins needed based on player count
// 2-4 players = 1 win, 5-8 players = 3 wins, 9-13 players = 5 wins
function winsNeeded(playerCount) {
  if (playerCount <= 4) return 1;
  if (playerCount <= 8) return 3;
  return 5;
}

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function botSeatName(name) {
  return name.endsWith(' (Bot)') ? name : `${name} (Bot)`;
}

function humanSeatName(name) {
  return name.replace(/\s+\(Bot\)$/i, '');
}

function normalizeName(name) {
  return humanSeatName(String(name || '')).trim().toLowerCase();
}

function migratePlayerId(room, oldId, newId) {
  if (!room.game || oldId === newId) return;

  const hand = room.game.hands[oldId];
  if (hand) {
    room.game.hands[newId] = hand;
    delete room.game.hands[oldId];
  }

  room.game.playerOrder = room.game.playerOrder.map(id => id === oldId ? newId : id);

  if (room.game.unoCalled && Object.prototype.hasOwnProperty.call(room.game.unoCalled, oldId)) {
    room.game.unoCalled[newId] = room.game.unoCalled[oldId];
    delete room.game.unoCalled[oldId];
  }

  if (room.game.winner === oldId) room.game.winner = newId;

  if (room.wins && Object.prototype.hasOwnProperty.call(room.wins, oldId)) {
    room.wins[newId] = room.wins[oldId];
    delete room.wins[oldId];
  }
}

function sanitizeState(state, forPlayerId, room) {
  if (!state) return null;
  const s = {
    currentColor: state.currentColor,
    currentPlayer: currentPlayer(state),
    direction: state.direction,
    winner: state.winner,
    topCard: state.discard[state.discard.length - 1],
    deckCount: state.deck.length,
    playerOrder: state.playerOrder,
    handCounts: {},
    myHand: state.hands[forPlayerId] || [],
    houseRules: state.houseRules,
    startingCards: state.startingCards,
    drawStack: state.drawStack,
    drawStackType: state.drawStackType,
    // match info
    wins: room.wins || {},
    winsNeeded: room.winsNeeded || 1,
    roundNumber: room.roundNumber || 1,
    bots: room.bots || {},
    turnDeadline: room.turnDeadline || 0,
    turnDurationMs: TURN_TIMER_MS,
    serverTime: Date.now(),
  };
  for (const pid of state.playerOrder) {
    s.handCounts[pid] = state.hands[pid]?.length || 0;
  }
  return s;
}

function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
}

function startTurnTimer(room, code) {
  clearTurnTimer(room);
  if (!room.game || room.game.winner || !rooms[code]) return;
  const playerId = currentPlayer(room.game);
  room.turnDeadline = Date.now() + TURN_TIMER_MS;
  room.turnTimer = setTimeout(() => {
    if (!rooms[code] || !room.game || room.game.winner) return;
    if (currentPlayer(room.game) !== playerId) return;
    const result = autoDrawForTimeout(room.game, playerId);
    if (result.error) return;
    const action = {
      type: result.drewStack ? 'timer_drew_stack' : 'timer_draw',
      playerId,
      count: result.drewStack || 1,
    };
    startTurnTimer(room, code);
    broadcastState(room, action);
    scheduleBotTurn(room, code);
  }, TURN_TIMER_MS + 150);
}

function broadcastState(room, lastAction) {
  for (const player of room.players) {
    if (room.bots[player.id]) continue; // skip bots
    io.to(player.id).emit('game_update', {
      state: sanitizeState(room.game, player.id, room),
      lastAction,
      players: room.players,
    });
  }
}

function autoDrawStackIfBlocked(room, code) {
  if (!room.game || room.game.winner || !room.game.drawStack || !room.game.houseRules.stackDraw) return false;
  const playerId = currentPlayer(room.game);
  if (playerHasStackCard(room.game, playerId)) return false;

  const result = drawCard(room.game, playerId);
  if (result.error) return false;

  startTurnTimer(room, code);
  broadcastState(room, {
    type: 'auto_drew_stack',
    playerId,
    count: result.drewStack || 0,
  });
  scheduleBotTurn(room, code);
  return true;
}

function performBotSwapIfNeeded(room, code, playerId, result) {
  if (!result.needsSwap || !room.bots[playerId]) return false;
  const candidates = room.players.filter(p => p.id !== playerId);
  if (!candidates.length) return false;
  const target = candidates
    .map(p => ({ ...p, count: room.game.hands[p.id]?.length || 0 }))
    .sort((a, b) => a.count - b.count)[0];
  const swapResult = swapHands(room.game, playerId, target.id);
  if (swapResult.error) return false;
  broadcastState(room, { type: 'swap', playerId, targetId: target.id });
  io.to(code).emit('hands_swapped', {
    p1: room.players.find(p => p.id === playerId)?.name || 'Bot',
    p2: target.name,
  });
  return true;
}

// Bot takes a turn after a short delay
function scheduleBotTurn(room, code) {
  if (!room.game || room.game.winner) return;
  const cp = currentPlayer(room.game);
  if (!room.bots[cp]) return; // not a bot's turn

  setTimeout(() => {
    if (!room.game || room.game.winner || !rooms[code]) return;
    if (currentPlayer(room.game) !== cp) return; // turn already changed

    const move = botPickCard(room.game, cp);
    let result;
    if (move) {
      result = playCard(room.game, cp, move.cardIndex, move.chosenColor);
      if (result.error && !result.penalty) {
        // fallback: draw
        result = drawCard(room.game, cp);
      }
    } else {
      result = drawCard(room.game, cp);
    }

    room.game.unoCalled[cp] = false;
    const botName = room.players.find(p => p.id === cp)?.name || 'Bot';
    const action = {
      type: move && !result.drewStack ? 'play' : 'draw',
      playerId: cp,
      card: result.card,
      rotated: result.rotated,
      shuffledHands: result.shuffledHands,
    };
    startTurnTimer(room, code);
    broadcastState(room, action);
    performBotSwapIfNeeded(room, code, cp, result);

    if (room.game.winner) {
      handleRoundEnd(room, code);
      return;
    }
    if (autoDrawStackIfBlocked(room, code)) return;
    // Schedule next bot turn if needed
    scheduleBotTurn(room, code);
  }, 1200 + Math.random() * 800); // 1.2-2s delay so it feels natural
}

function startNewRound(room, code) {
  room.roundNumber = (room.roundNumber || 1) + 1;
  room.game = createGame(room.players.map(p => p.id), room.settings.startingCards, room.settings.houseRules);
  room.game.winner = null;
  startTurnTimer(room, code);

  for (const player of room.players) {
    if (room.bots[player.id]) continue;
    io.to(player.id).emit('round_started', {
      state: sanitizeState(room.game, player.id, room),
      players: room.players,
      roundNumber: room.roundNumber,
      wins: room.wins,
      winsNeeded: room.winsNeeded,
    });
  }
  scheduleBotTurn(room, code);
}

function handleRoundEnd(room, code) {
  clearTurnTimer(room);
  const winnerId = room.game.winner;
  const winnerName = room.players.find(p => p.id === winnerId)?.name || 'Bot';

  // Track wins
  room.wins[winnerId] = (room.wins[winnerId] || 0) + 1;

  // Broadcast round result
  for (const player of room.players) {
    if (room.bots[player.id]) continue;
    io.to(player.id).emit('round_over', {
      winner: winnerId,
      winnerName,
      wins: room.wins,
      winsNeeded: room.winsNeeded,
      players: room.players,
    });
  }

  // Check if someone reached total wins
  if (room.wins[winnerId] >= room.winsNeeded) {
    for (const player of room.players) {
      if (room.bots[player.id]) continue;
      io.to(player.id).emit('match_over', {
        winner: winnerId,
        winnerName,
        wins: room.wins,
        players: room.players,
      });
    }
    room.started = false;
    clearTurnTimer(room);
    return;
  }

  // Start next round after 4 seconds
  setTimeout(() => {
    if (rooms[code]) startNewRound(room, code);
  }, 4000);
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('create_room', ({ name }) => {
    const code = generateCode();
    rooms[code] = {
      players: [{ id: socket.id, name }],
      game: null,
      started: false,
      wins: {},
      winsNeeded: 1,
      roundNumber: 1,
      bots: {},
      settings: {
        startingCards: 7,
        houseRules: { stackDraw: true, jumpIn: false, sevenSwap: false, zeroRotate: false, wrongCardPenalty: true }
      }
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name;
    socket.emit('room_created', { code, players: rooms[code].players, settings: rooms[code].settings });
  });

  socket.on('join_room', ({ name, code }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (room.started) {
      const returningPlayer = room.players.find(p => room.bots[p.id] && normalizeName(p.name) === normalizeName(name));
      if (!returningPlayer) {
        return socket.emit('error', { message: 'Game already started. Rejoin with the same name as a disconnected player.' });
      }

      const oldId = returningPlayer.id;
      const originalName = humanSeatName(returningPlayer.name);
      migratePlayerId(room, oldId, socket.id);
      delete room.bots[oldId];

      returningPlayer.id = socket.id;
      returningPlayer.name = originalName;

      socket.join(code);
      socket.data.roomCode = code;
      socket.data.name = originalName;
      socket.emit('game_rejoined', {
        code,
        state: sanitizeState(room.game, socket.id, room),
        players: room.players,
        winsNeeded: room.winsNeeded,
      });
      broadcastState(room, { type: 'rejoin', playerId: socket.id });
      io.to(code).emit('player_rejoined', { playerId: socket.id, name: originalName, players: room.players });
      if (!room.game.winner && currentPlayer(room.game) === socket.id) startTurnTimer(room, code);
      return;
    }
    if (room.players.length >= 13) return socket.emit('error', { message: 'Room is full (max 13)' });
    room.players.push({ id: socket.id, name });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name;
    io.to(code).emit('player_joined', { players: room.players });
    socket.emit('room_joined', { code, players: room.players, settings: room.settings });
  });

  socket.on('update_settings', ({ startingCards, houseRules }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.players[0].id !== socket.id) return;
    if (startingCards) room.settings.startingCards = startingCards;
    if (houseRules) room.settings.houseRules = { ...room.settings.houseRules, ...houseRules };
    io.to(code).emit('settings_updated', room.settings);
  });

  socket.on('start_game', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    if (room.players[0].id !== socket.id) return socket.emit('error', { message: 'Only host can start' });
    if (room.players.length < 2) return socket.emit('error', { message: 'Need at least 2 players' });

    room.wins = {};
    room.roundNumber = 1;
    room.winsNeeded = winsNeeded(room.players.length);
    room.game = createGame(room.players.map(p => p.id), room.settings.startingCards, room.settings.houseRules);
    room.started = true;
    startTurnTimer(room, code);

    for (const player of room.players) {
      io.to(player.id).emit('game_started', {
        state: sanitizeState(room.game, player.id, room),
        players: room.players,
        winsNeeded: room.winsNeeded,
      });
    }
    scheduleBotTurn(room, code);
  });

  socket.on('play_card', ({ cardIndex, chosenColor }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.game) return;
    const result = playCard(room.game, socket.id, cardIndex, chosenColor);
    if (result.error) {
      socket.emit('play_error', { message: result.error, penalty: result.penalty || false });
      if (result.penalty) {
        startTurnTimer(room, code);
        broadcastState(room, { type: 'penalty', playerId: socket.id });
      }
      return;
    }
    room.game.unoCalled[socket.id] = false;
    startTurnTimer(room, code);
    broadcastState(room, {
      type: 'play',
      playerId: socket.id,
      card: result.card,
      rotated: result.rotated,
      shuffledHands: result.shuffledHands,
    });
    if (result.needsSwap) {
      socket.emit('needs_swap', { players: room.players.filter(p => p.id !== socket.id) });
    }
    if (room.game.winner) { handleRoundEnd(room, code); return; }
    if (autoDrawStackIfBlocked(room, code)) return;
    scheduleBotTurn(room, code);
  });

  socket.on('draw_card', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.game) return;
    const result = drawCard(room.game, socket.id);
    if (result.error) return socket.emit('error', { message: result.error });
    startTurnTimer(room, code);
    broadcastState(room, { type: result.drewStack ? 'drew_stack' : 'draw', playerId: socket.id, count: result.drewStack });
    scheduleBotTurn(room, code);
  });

  socket.on('jump_in', ({ cardIndex }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.game) return;
    const result = jumpIn(room.game, socket.id, cardIndex);
    if (result.error) return socket.emit('error', { message: result.error });
    const pname = room.players.find(p => p.id === socket.id)?.name;
    io.to(code).emit('jump_in_happened', { name: pname });
    startTurnTimer(room, code);
    broadcastState(room, { type: 'jump_in', playerId: socket.id, card: result.card, shuffledHands: result.shuffledHands });
    if (room.game.winner) { handleRoundEnd(room, code); return; }
    if (autoDrawStackIfBlocked(room, code)) return;
    scheduleBotTurn(room, code);
  });

  socket.on('swap_hands', ({ targetId }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.game) return;
    const result = swapHands(room.game, socket.id, targetId);
    if (result.error) return socket.emit('error', { message: result.error });
    const tname = room.players.find(p => p.id === targetId)?.name;
    io.to(code).emit('hands_swapped', { p1: socket.data.name, p2: tname });
    broadcastState(room, { type: 'swap', playerId: socket.id, targetId });
  });

  socket.on('call_uno', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.game) return;
    callUno(room.game, socket.id);
    io.to(code).emit('uno_called', { playerId: socket.id, name: socket.data.name });
  });

  socket.on('catch_uno', ({ targetId }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.game) return;
    const result = catchUno(room.game, socket.id, targetId);
    if (result.success) {
      const tname = room.players.find(p => p.id === targetId)?.name;
      broadcastState(room, { type: 'catch_uno', catcherId: socket.id, targetId });
      io.to(code).emit('uno_caught', { targetId, targetName: tname });
    }
  });

  socket.on('chat_message', ({ message }) => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const msg = { name: socket.data.name, message: message.slice(0, 120), id: socket.id, ts: Date.now() };
    io.to(code).emit('chat_message', msg);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    const leftName = socket.data.name;
    const leftId = socket.id;

    // If the match is active, keep the seat and let a bot hold it until rejoin.
    if (room.started && room.game) {
      const botName = botSeatName(leftName);
      room.bots[leftId] = true; // mark as bot
      // Update player name to show it's a bot now
      const playerEntry = room.players.find(p => p.id === leftId);
      if (playerEntry) playerEntry.name = botName;

      io.to(code).emit('player_became_bot', {
        playerId: leftId,
        botName,
        players: room.players,
      });
      console.log(`${leftName} disconnected, replaced by bot`);

      // If it's the bot's turn right now, schedule bot move
      if (!room.game.winner && currentPlayer(room.game) === leftId) {
        scheduleBotTurn(room, code);
      }
    } else {
      // Not in game, just remove
      room.players = room.players.filter(p => p.id !== leftId);
      if (room.players.length === 0) {
        clearTurnTimer(room);
        delete rooms[code];
      } else {
        io.to(code).emit('player_left', { players: room.players, leftName });
      }
    }
  });
});

app.get('/', (req, res) => res.json({ status: 'UNO server running 🃏' }));
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server on port ${PORT}`));
