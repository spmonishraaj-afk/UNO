const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createGame, playCard, drawCard, callUno, catchUno, currentPlayer } = require('./gameLogic');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const rooms = {}; // roomCode -> { players: [{id, name}], game, started }

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function sanitizeState(state, forPlayerId) {
  if (!state) return null;
  const sanitized = {
    currentColor: state.currentColor,
    currentPlayer: currentPlayer(state),
    direction: state.direction,
    winner: state.winner,
    topCard: state.discard[state.discard.length - 1],
    deckCount: state.deck.length,
    playerOrder: state.playerOrder,
    handCounts: {},
    myHand: state.hands[forPlayerId] || [],
  };
  for (const pid of state.playerOrder) {
    sanitized.handCounts[pid] = state.hands[pid]?.length || 0;
  }
  return sanitized;
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('create_room', ({ name }) => {
    const code = generateCode();
    rooms[code] = { players: [{ id: socket.id, name }], game: null, started: false };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name;
    socket.emit('room_created', { code, players: rooms[code].players });
    console.log(`Room ${code} created by ${name}`);
  });

  socket.on('join_room', ({ name, code }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (room.started) return socket.emit('error', { message: 'Game already started' });
    if (room.players.length >= 8) return socket.emit('error', { message: 'Room is full (max 8)' });
    room.players.push({ id: socket.id, name });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name;
    io.to(code).emit('player_joined', { players: room.players });
    socket.emit('room_joined', { code, players: room.players });
  });

  socket.on('start_game', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    if (room.players[0].id !== socket.id) return socket.emit('error', { message: 'Only host can start' });
    if (room.players.length < 2) return socket.emit('error', { message: 'Need at least 2 players' });
    room.game = createGame(room.players.map(p => p.id));
    room.started = true;
    // send each player their own view
    for (const player of room.players) {
      io.to(player.id).emit('game_started', {
        state: sanitizeState(room.game, player.id),
        players: room.players,
      });
    }
  });

  socket.on('play_card', ({ cardIndex, chosenColor }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.game) return;
    const result = playCard(room.game, socket.id, cardIndex, chosenColor);
    if (result.error) return socket.emit('error', { message: result.error });
    // reset uno called after playing
    room.game.unoCalled[socket.id] = false;
    for (const player of room.players) {
      io.to(player.id).emit('game_update', {
        state: sanitizeState(room.game, player.id),
        lastAction: { type: 'play', playerId: socket.id, card: result.card },
      });
    }
    if (room.game.winner) {
      const winnerName = room.players.find(p => p.id === room.game.winner)?.name;
      io.to(code).emit('game_over', { winner: room.game.winner, winnerName });
    }
  });

  socket.on('draw_card', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.game) return;
    const result = drawCard(room.game, socket.id);
    if (result.error) return socket.emit('error', { message: result.error });
    for (const player of room.players) {
      io.to(player.id).emit('game_update', {
        state: sanitizeState(room.game, player.id),
        lastAction: { type: 'draw', playerId: socket.id },
      });
    }
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
      const targetName = room.players.find(p => p.id === targetId)?.name;
      for (const player of room.players) {
        io.to(player.id).emit('game_update', {
          state: sanitizeState(room.game, player.id),
          lastAction: { type: 'catch_uno', catcherId: socket.id, targetId },
        });
      }
      io.to(code).emit('uno_caught', { targetId, targetName });
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      delete rooms[code];
    } else {
      io.to(code).emit('player_left', { players: room.players, leftId: socket.id, leftName: socket.data.name });
    }
  });
});

app.get('/', (req, res) => res.json({ status: 'UNO server running 🃏' }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
