const COLORS = ['red', 'green', 'blue', 'yellow'];
const ACTIONS = ['skip','reverse','draw2'];

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
    deck.push({ color: 'wild', value: 'shuffleHands', type: 'wild' });
    deck.push({ color: 'wild', value: 'swapHands', type: 'wild' });
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

function getStackableValues(state) {
  if (!state.drawStack || !state.houseRules.stackDraw) return [];
  return state.drawStackType === 'wild4' ? ['wild4'] : ['draw2', 'wild4'];
}

function canStackDraw(state, card) {
  return getStackableValues(state).includes(card?.value);
}

function playerHasStackCard(state, playerId) {
  const hand = state.hands[playerId] || [];
  return hand.some(card => canStackDraw(state, card));
}

function createGame(playerIds, startingCards = 7, houseRules = {}) {
  let fullDeck = createDeck();
  const totalNeeded = playerIds.length * startingCards + 20;
  while (fullDeck.length < totalNeeded) {
    fullDeck = shuffle([...fullDeck, ...createDeck()]);
  }
  const hands = {};
  for (const id of playerIds) {
    hands[id] = fullDeck.splice(0, startingCards);
  }
  let topCard = fullDeck.splice(0, 1)[0];
  while (topCard.type === 'wild') {
    fullDeck.push(topCard);
    fullDeck = shuffle(fullDeck);
    topCard = fullDeck.splice(0, 1)[0];
  }
  return {
    deck: fullDeck,
    hands,
    discard: [topCard],
    currentColor: topCard.color,
    playerOrder: [...playerIds],
    currentIndex: 0,
    direction: 1,
    drawStack: 0,
    drawStackType: null,
    unoCalled: {},
    winner: null,
    houseRules: {
      stackDraw: true,
      jumpIn: false,
      sevenSwap: false,
      zeroRotate: false,
      wrongCardPenalty: true,
      ...houseRules,
    },
    startingCards,
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
      state.deck = shuffle([...state.discard]);
      state.discard = [top];
    }
    if (state.deck.length > 0) drawn.push(state.deck.pop());
  }
  state.hands[playerId].push(...drawn);
  return drawn;
}

function rotateHands(state) {
  const order = state.playerOrder;
  const snap = order.map(id => state.hands[id]);
  if (state.direction === 1) {
    const last = snap.pop();
    snap.unshift(last);
  } else {
    const first = snap.shift();
    snap.push(first);
  }
  order.forEach((id, i) => { state.hands[id] = snap[i]; });
}

function playCard(state, playerId, cardIndex, chosenColor) {
  if (currentPlayer(state) !== playerId) return { error: 'Not your turn' };
  const hand = state.hands[playerId];
  const card = hand[cardIndex];
  if (!card) return { error: 'Invalid card' };
  const topCard = getTopCard(state);

  if (state.drawStack > 0 && state.houseRules.stackDraw) {
    if (!canStackDraw(state, card)) {
      const allowed = getStackableValues(state).map(v => v === 'draw2' ? '+2' : '+4').join(' or ');
      return { error: `Must stack ${allowed} or draw ${state.drawStack} cards!`, mustDraw: true };
    }
  }

  if (!canPlay(card, topCard, state.currentColor)) {
    if (state.houseRules.wrongCardPenalty) {
      drawCards(state, playerId, 2);
      return { error: 'Wrong card! Penalty: drew 2 cards.', penalty: true };
    }
    return { error: 'Cannot play that card' };
  }

  hand.splice(cardIndex, 1);
  state.discard.push(card);

  if (card.type === 'wild') {
    state.currentColor = chosenColor || 'red';
  } else {
    state.currentColor = card.color;
  }

  if (hand.length === 0) {
    state.winner = playerId;
    return { success: true, card, state };
  }

  if (card.value === '7' && state.houseRules.sevenSwap) {
    advanceTurn(state);
    return { success: true, card, state, needsSwap: true, swapPlayerId: playerId };
  }

  if (card.value === '0' && state.houseRules.zeroRotate) {
    rotateHands(state);
    advanceTurn(state);
    return { success: true, card, state, rotated: true };
  }

  if (card.value === 'draw2') {
    if (state.houseRules.stackDraw) { state.drawStack += 2; state.drawStackType = 'draw2'; advanceTurn(state); }
    else { drawCards(state, state.playerOrder[nextIndex(state)], 2); advanceTurn(state, 1); }
  } else if (card.value === 'wild4') {
    if (state.houseRules.stackDraw) { state.drawStack += 4; state.drawStackType = 'wild4'; advanceTurn(state); }
    else { drawCards(state, state.playerOrder[nextIndex(state)], 4); advanceTurn(state, 1); }
  } else if (card.value === 'shuffleHands') {
    rotateHands(state);
    advanceTurn(state);
    return { success: true, card, state, shuffledHands: true };
  } else if (card.value === 'swapHands') {
    advanceTurn(state);
    return { success: true, card, state, needsSwap: true, swapPlayerId: playerId };
  } else if (card.value === 'skip') {
    advanceTurn(state, 1);
  } else if (card.value === 'reverse') {
    state.direction *= -1;
    if (state.playerOrder.length === 2) advanceTurn(state, 1);
    else advanceTurn(state);
  } else {
    advanceTurn(state);
  }

  return { success: true, card, state };
}

function drawCard(state, playerId) {
  if (currentPlayer(state) !== playerId) return { error: 'Not your turn' };
  if (state.drawStack > 0) {
    const count = state.drawStack;
    state.drawStack = 0;
    state.drawStackType = null;
    drawCards(state, playerId, count);
    advanceTurn(state);
    return { success: true, drewStack: count, state };
  }
  const drawn = drawCards(state, playerId, 1);
  const card = drawn[0];
  const playable = card && canPlay(card, getTopCard(state), state.currentColor);
  if (!playable) advanceTurn(state);
  return { success: true, card, playable, state };
}

function autoDrawForTimeout(state, playerId) {
  if (currentPlayer(state) !== playerId) return { error: 'Not your turn' };
  if (state.drawStack > 0) {
    const count = state.drawStack;
    state.drawStack = 0;
    state.drawStackType = null;
    drawCards(state, playerId, count);
    advanceTurn(state);
    return { success: true, drewStack: count, state };
  }
  const drawn = drawCards(state, playerId, 1);
  advanceTurn(state);
  return { success: true, card: drawn[0], timedOut: true, state };
}

function jumpIn(state, playerId, cardIndex) {
  if (!state.houseRules.jumpIn) return { error: 'Jump-in not enabled' };
  const hand = state.hands[playerId];
  const card = hand[cardIndex];
  if (!card) return { error: 'Invalid card' };
  const topCard = getTopCard(state);
  if (card.color !== topCard.color || card.value !== topCard.value)
    return { error: 'Must match exact card to jump in' };
  state.currentIndex = state.playerOrder.indexOf(playerId);
  return playCard(state, playerId, cardIndex, null);
}

function swapHands(state, playerId, targetId) {
  if (!state.hands[targetId]) return { error: 'Invalid target' };
  const tmp = state.hands[playerId];
  state.hands[playerId] = state.hands[targetId];
  state.hands[targetId] = tmp;
  return { success: true, state };
}

function callUno(state, playerId) {
  state.unoCalled[playerId] = true;
  return { success: true };
}

function catchUno(state, catcherId, targetId) {
  const hand = state.hands[targetId];
  if (hand && hand.length === 1 && !state.unoCalled[targetId]) {
    drawCards(state, targetId, 2);
    return { success: true };
  }
  return { success: false };
}

// Bot AI: pick best card to play
function botPickCard(state, botId) {
  const hand = state.hands[botId];
  const topCard = getTopCard(state);
  const cc = state.currentColor;

  // If drawStack active and stackDraw enabled, try to stack
  if (state.drawStack > 0 && state.houseRules.stackDraw) {
    const stackIdx = hand.findIndex(c => canStackDraw(state, c));
    if (stackIdx >= 0) return { cardIndex: stackIdx, chosenColor: null };
    return null; // must draw
  }

  // Prioritize action/special cards
  const priorities = ['wild4','draw2','skip','reverse','swapHands','shuffleHands','wild'];
  for (const val of priorities) {
    const idx = hand.findIndex(c => c.value === val && canPlay(c, topCard, cc));
    if (idx >= 0) {
      const chosenColor = c => {
        // pick most common color in hand
        const counts = { red:0, green:0, blue:0, yellow:0 };
        hand.forEach(card => { if (card.color !== 'wild') counts[card.color]++; });
        return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
      };
      return { cardIndex: idx, chosenColor: chosenColor() };
    }
  }
  // Play any valid card
  const idx = hand.findIndex(c => canPlay(c, topCard, cc));
  if (idx >= 0) {
    const card = hand[idx];
    let chosenColor = card.color;
    if (card.type === 'wild') {
      const counts = { red:0, green:0, blue:0, yellow:0 };
      hand.forEach(c => { if (c.color !== 'wild') counts[c.color]++; });
      chosenColor = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
    }
    return { cardIndex: idx, chosenColor };
  }
  return null; // no playable card, must draw
}

module.exports = { createGame, playCard, drawCard, autoDrawForTimeout, jumpIn, swapHands, callUno, catchUno, currentPlayer, canPlay, getTopCard, botPickCard, canStackDraw, getStackableValues, playerHasStackCard };
