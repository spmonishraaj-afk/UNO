const COLORS = ['red', 'green', 'blue', 'yellow'];
const NUMBERS = ['0','1','2','3','4','5','6','7','8','9'];
const ACTIONS = ['skip','reverse','draw2'];
const WILDS = ['wild','wild4'];

function createDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push({ color, value: '0', type: 'number' });
    for (let i = 1; i <= 9; i++) {
      deck.push({ color, value: String(i), type: 'number' });
      deck.push({ color, value: String(i), type: 'number' });
    }
    for (const action of ACTIONS) {
      deck.push({ color, value: action, type: 'action' });
      deck.push({ color, value: action, type: 'action' });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'wild', value: 'wild', type: 'wild' });
    deck.push({ color: 'wild', value: 'wild4', type: 'wild' });
  }
  return shuffle(deck);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function canPlay(card, topCard, currentColor) {
  if (card.type === 'wild') return true;
  if (card.color === currentColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

function createGame(playerIds) {
  const deck = createDeck();
  const hands = {};
  for (const id of playerIds) {
    hands[id] = deck.splice(0, 7);
  }
  let topCard = deck.splice(0, 1)[0];
  // make sure first card isn't wild
  while (topCard.type === 'wild') {
    deck.push(topCard);
    shuffle(deck);
    topCard = deck.splice(0, 1)[0];
  }
  return {
    deck,
    hands,
    discard: [topCard],
    currentColor: topCard.color,
    playerOrder: [...playerIds],
    currentIndex: 0,
    direction: 1,
    drawPending: 0,
    unoCalled: {},
    winner: null,
  };
}

function getTopCard(state) {
  return state.discard[state.discard.length - 1];
}

function currentPlayer(state) {
  return state.playerOrder[state.currentIndex];
}

function nextIndex(state, skip = 0) {
  const len = state.playerOrder.length;
  return ((state.currentIndex + state.direction * (1 + skip)) % len + len) % len;
}

function advanceTurn(state, skip = 0) {
  state.currentIndex = nextIndex(state, skip);
}

function drawCards(state, playerId, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (state.deck.length === 0) {
      const top = state.discard.pop();
      state.deck = shuffle(state.discard);
      state.discard = [top];
    }
    if (state.deck.length > 0) {
      drawn.push(state.deck.pop());
    }
  }
  state.hands[playerId].push(...drawn);
  return drawn;
}

function playCard(state, playerId, cardIndex, chosenColor) {
  if (currentPlayer(state) !== playerId) return { error: 'Not your turn' };
  const hand = state.hands[playerId];
  const card = hand[cardIndex];
  if (!card) return { error: 'Invalid card' };
  if (!canPlay(card, getTopCard(state), state.currentColor)) return { error: 'Cannot play that card' };

  hand.splice(cardIndex, 1);
  state.discard.push(card);

  if (card.type === 'wild') {
    state.currentColor = chosenColor || 'red';
  } else {
    state.currentColor = card.color;
  }

  // check win
  if (hand.length === 0) {
    state.winner = playerId;
    return { success: true, card, state };
  }

  // handle effects
  if (card.value === 'skip') {
    advanceTurn(state, 1);
  } else if (card.value === 'reverse') {
    state.direction *= -1;
    if (state.playerOrder.length === 2) {
      advanceTurn(state, 1);
    } else {
      advanceTurn(state);
    }
  } else if (card.value === 'draw2') {
    const nextPid = state.playerOrder[nextIndex(state)];
    drawCards(state, nextPid, 2);
    advanceTurn(state, 1);
  } else if (card.value === 'wild4') {
    const nextPid = state.playerOrder[nextIndex(state)];
    drawCards(state, nextPid, 4);
    advanceTurn(state, 1);
  } else {
    advanceTurn(state);
  }

  return { success: true, card, state };
}

function drawCard(state, playerId) {
  if (currentPlayer(state) !== playerId) return { error: 'Not your turn' };
  const drawn = drawCards(state, playerId, 1);
  const card = drawn[0];
  // check if drawable card is playable
  const playable = card && canPlay(card, getTopCard(state), state.currentColor);
  if (!playable) advanceTurn(state);
  return { success: true, card, playable, state };
}

function callUno(state, playerId) {
  state.unoCalled[playerId] = true;
  return { success: true };
}

function catchUno(state, catcherId, targetId) {
  const hand = state.hands[targetId];
  if (hand && hand.length === 1 && !state.unoCalled[targetId]) {
    drawCards(state, targetId, 2);
    return { success: true, penalized: targetId };
  }
  return { success: false };
}

module.exports = { createGame, playCard, drawCard, callUno, catchUno, currentPlayer, canPlay, getTopCard };
