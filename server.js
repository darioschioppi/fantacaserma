const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// ─── Config ───────────────────────────────────────────────────────────────────

const ADMIN_PASSWORD = 'fantacaserma2025';
const INITIAL_BUDGET = 500;
const AUCTION_TIMER = 30; // seconds

const TEAMS_CONFIG = [
  { id: 't1',  name: 'La Caserma FC', emoji: '🦁', password: 'caserma1'  },
  { id: 't2',  name: 'Fulmine FC',    emoji: '⚡', password: 'fulmine2'  },
  { id: 't3',  name: 'Drago Rosso',   emoji: '🔥', password: 'drago3'    },
  { id: 't4',  name: 'Stella Alpina', emoji: '⭐', password: 'stella4'   },
  { id: 't5',  name: 'Lupo Grigio',   emoji: '🐺', password: 'lupo5'     },
  { id: 't6',  name: 'Aquila FC',     emoji: '🦅', password: 'aquila6'   },
  { id: 't7',  name: 'Golden Boys',   emoji: '🏆', password: 'golden7'   },
  { id: 't8',  name: 'Onda FC',       emoji: '🌊', password: 'onda8'     },
  { id: 't9',  name: 'Freccia Rossa', emoji: '🎯', password: 'freccia9'  },
  { id: 't10', name: 'Supernova',     emoji: '🌟', password: 'nova10'    }
];

// ─── Load players ─────────────────────────────────────────────────────────────

const playersPath = path.join(__dirname, 'data', 'players.json');
const ALL_PLAYERS = JSON.parse(fs.readFileSync(playersPath, 'utf-8'));

// ─── Game State ───────────────────────────────────────────────────────────────

function buildInitialState() {
  const teams = {};
  for (const tc of TEAMS_CONFIG) {
    teams[tc.id] = {
      id: tc.id,
      name: tc.name,
      emoji: tc.emoji,
      budget: INITIAL_BUDGET,
      players: [],      // assigned player objects
      connected: false,
      socketId: null
    };
  }
  return {
    teams,
    auction: null,      // active auction object or null
    auctionHistory: [], // last N assigned/skipped
    phase: 'idle'       // 'idle' | 'bidding' | 'reveal' | 'tiebreaker'
  };
}

let state = buildInitialState();
let timerInterval = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function teamById(id) { return state.teams[id] || null; }

function safeState() {
  // Public state — bids are hidden during bidding/tiebreaker
  const auction = state.auction ? sanitizeAuction(state.auction) : null;
  return {
    teams: Object.values(state.teams).map(t => ({
      id: t.id, name: t.name, emoji: t.emoji,
      budget: t.budget, playerCount: t.players.length,
      connected: t.connected
    })),
    auction,
    phase: state.phase,
    auctionHistory: state.auctionHistory.slice(-5)
  };
}

function sanitizeAuction(a) {
  const bids = {};
  for (const [tid, b] of Object.entries(a.bids)) {
    // During bidding/tiebreaker: only reveal flag, not amount
    if (state.phase === 'reveal') {
      bids[tid] = b;
    } else {
      bids[tid] = { submitted: b.submitted, amount: null };
    }
  }
  return {
    player: a.player,
    timerLeft: a.timerLeft,
    tiebreakerRound: a.tiebreakerRound,
    tiebreakerTeams: a.tiebreakerTeams || [],
    tiebreakerMin: a.tiebreakerMin || null,
    winner: a.winner || null,
    bids
  };
}

function adminAuction(a) {
  if (!a) return null;
  return {
    player: a.player,
    timerLeft: a.timerLeft,
    tiebreakerRound: a.tiebreakerRound,
    tiebreakerTeams: a.tiebreakerTeams || [],
    tiebreakerMin: a.tiebreakerMin || null,
    winner: a.winner || null,
    bids: a.bids // full bids — admin sees all
  };
}

function broadcastState() {
  // Send safe state to all non-admin clients
  io.emit('state_sync', safeState());
  // Send full bids to admin sockets
  if (adminSocket) {
    adminSocket.emit('state_sync', {
      ...safeState(),
      auction: adminAuction(state.auction),
      isAdmin: true
    });
  }
}

function getConnectedTeamIds() {
  return Object.values(state.teams).filter(t => t.connected).map(t => t.id);
}

function allBidsSubmitted(eligibleIds) {
  if (!state.auction) return false;
  const bids = state.auction.bids;
  return eligibleIds.every(id => bids[id] && bids[id].submitted);
}

function clearTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startTimer(onExpire) {
  clearTimer();
  timerInterval = setInterval(() => {
    if (!state.auction) { clearTimer(); return; }
    state.auction.timerLeft--;
    io.emit('timer_update', { timerLeft: state.auction.timerLeft });
    if (state.auction.timerLeft <= 0) {
      clearTimer();
      onExpire();
    }
  }, 1000);
}

// ─── Auction logic ────────────────────────────────────────────────────────────

function startAuction(player) {
  clearTimer();
  const bids = {};
  for (const id of Object.keys(state.teams)) {
    bids[id] = { submitted: false, amount: null };
  }
  state.auction = {
    player,
    bids,
    timerLeft: AUCTION_TIMER,
    tiebreakerRound: 0,
    tiebreakerTeams: [],
    tiebreakerMin: null,
    winner: null
  };
  state.phase = 'bidding';

  io.emit('auction_started', { player, timerLeft: AUCTION_TIMER });
  broadcastState();

  startTimer(() => revealBids());
}

function revealBids() {
  if (!state.auction) return;
  clearTimer();
  state.phase = 'reveal';

  const eligible = getConnectedTeamIds();
  const bids = state.auction.bids;

  // Find max among connected teams with valid bids
  let maxAmount = 0;
  for (const id of eligible) {
    const b = bids[id];
    if (b.submitted && b.amount > maxAmount) maxAmount = b.amount;
  }

  // Teams tied at max
  const tied = eligible.filter(id => bids[id].submitted && bids[id].amount === maxAmount && maxAmount > 0);

  if (tied.length === 1) {
    // Single winner
    state.auction.winner = tied[0];
    io.emit('bid_reveal', {
      bids: state.auction.bids,
      winner: state.auction.winner,
      tiebreaker: false,
      tiebreakerMin: null
    });
    broadcastState();
  } else if (tied.length > 1) {
    // Tiebreaker
    state.auction.tiebreakerTeams = tied;
    state.auction.tiebreakerMin = maxAmount + 1;
    state.auction.tiebreakerRound += 1;

    io.emit('bid_reveal', {
      bids: state.auction.bids,
      winner: null,
      tiebreaker: true,
      tiebreakerTeams: tied,
      tiebreakerMin: state.auction.tiebreakerMin,
      tiebreakerRound: state.auction.tiebreakerRound
    });

    // Start tiebreaker
    const newBids = {};
    for (const id of Object.keys(state.teams)) {
      newBids[id] = { submitted: false, amount: null };
    }
    state.auction.bids = newBids;
    state.auction.timerLeft = AUCTION_TIMER;
    state.phase = 'tiebreaker';

    io.emit('tiebreaker_start', {
      round: state.auction.tiebreakerRound,
      tiebreakerTeams: tied,
      tiebreakerMin: state.auction.tiebreakerMin,
      timerLeft: AUCTION_TIMER
    });
    broadcastState();

    startTimer(() => revealBids());
  } else {
    // No one bid — treat as skipped
    io.emit('bid_reveal', { bids: state.auction.bids, winner: null, tiebreaker: false });
    broadcastState();
  }
}

function checkAutoReveal() {
  if (!state.auction) return;
  const eligible = (state.phase === 'tiebreaker')
    ? state.auction.tiebreakerTeams.filter(id => state.teams[id].connected)
    : getConnectedTeamIds();
  if (eligible.length > 0 && allBidsSubmitted(eligible)) {
    clearTimer();
    // Small delay so clients see the "submitted" animation
    setTimeout(() => revealBids(), 800);
  }
}

// ─── Admin socket tracking ────────────────────────────────────────────────────
let adminSocket = null;

// ─── Socket.io handlers ───────────────────────────────────────────────────────

io.on('connection', (socket) => {
  // On reconnect, sync state
  socket.emit('state_sync', safeState());

  // ── team_login ──────────────────────────────────────────────────────────────
  socket.on('team_login', ({ teamId, password }) => {
    const tc = TEAMS_CONFIG.find(t => t.id === teamId);
    if (!tc || tc.password !== password) {
      socket.emit('login_error', { message: 'Password errata o squadra non trovata.' });
      return;
    }
    socket.teamId = teamId;
    socket.isAdmin = false;

    const team = state.teams[teamId];
    // Disconnect old socket for this team
    if (team.socketId && team.socketId !== socket.id) {
      const old = io.sockets.sockets.get(team.socketId);
      if (old) old.disconnect(true);
    }
    team.connected = true;
    team.socketId = socket.id;

    socket.emit('login_success', {
      teamId,
      teamName: team.name,
      emoji: team.emoji,
      budget: team.budget,
      players: team.players
    });

    io.emit('team_connected', { teamId, teamName: team.name });
    broadcastState();
  });

  // ── admin_login ─────────────────────────────────────────────────────────────
  socket.on('admin_login', ({ password }) => {
    if (password !== ADMIN_PASSWORD) {
      socket.emit('login_error', { message: 'Password admin errata.' });
      return;
    }
    socket.isAdmin = true;
    adminSocket = socket;
    socket.emit('admin_login_success', {
      teams: Object.values(state.teams),
      players: ALL_PLAYERS,
      phase: state.phase,
      auction: adminAuction(state.auction),
      auctionHistory: state.auctionHistory
    });
    broadcastState();
  });

  // ── start_auction ────────────────────────────────────────────────────────────
  socket.on('start_auction', ({ playerIndex }) => {
    if (!socket.isAdmin) return;
    if (state.phase !== 'idle') return;
    const player = ALL_PLAYERS[playerIndex];
    if (!player) return;
    // Check not already assigned
    const alreadyAssigned = state.auctionHistory.some(h => h.player.Nome === player.Nome && h.result === 'assigned');
    if (alreadyAssigned) {
      socket.emit('login_error', { message: 'Giocatore già assegnato.' });
      return;
    }
    startAuction(player);
  });

  // ── submit_bid ───────────────────────────────────────────────────────────────
  socket.on('submit_bid', ({ amount }) => {
    if (!socket.teamId) return;
    if (state.phase !== 'bidding' && state.phase !== 'tiebreaker') return;
    const tid = socket.teamId;
    const team = state.teams[tid];

    // In tiebreaker, only eligible teams can bid
    if (state.phase === 'tiebreaker' && !state.auction.tiebreakerTeams.includes(tid)) return;

    // Min bid validation
    const minBid = state.phase === 'tiebreaker' ? state.auction.tiebreakerMin : 1;
    const parsedAmount = parseInt(amount, 10);
    if (isNaN(parsedAmount) || parsedAmount < minBid) {
      socket.emit('login_error', { message: `Offerta minima: ${minBid} crediti.` });
      return;
    }
    if (parsedAmount > team.budget) {
      socket.emit('login_error', { message: 'Budget insufficiente.' });
      return;
    }
    if (state.auction.bids[tid].submitted) return; // already bid

    state.auction.bids[tid] = { submitted: true, amount: parsedAmount };

    // Notify all: team has submitted (no amount)
    io.emit('team_bid_submitted', { teamId: tid });

    // Admin sees full bid
    if (adminSocket) {
      adminSocket.emit('admin_bid_update', { teamId: tid, amount: parsedAmount, bids: state.auction.bids });
    }

    broadcastState();
    checkAutoReveal();
  });

  // ── force_reveal ─────────────────────────────────────────────────────────────
  socket.on('force_reveal', () => {
    if (!socket.isAdmin) return;
    if (state.phase !== 'bidding' && state.phase !== 'tiebreaker') return;
    clearTimer();
    revealBids();
  });

  // ── assign_player ────────────────────────────────────────────────────────────
  socket.on('assign_player', ({ teamId }) => {
    if (!socket.isAdmin) return;
    if (state.phase !== 'reveal') return;
    if (!state.auction) return;

    const winner = state.auction.winner || teamId;
    const winnerTeam = state.teams[winner];
    if (!winnerTeam) return;

    const winBid = state.auction.bids[winner];
    const cost = winBid && winBid.submitted ? winBid.amount : 0;

    winnerTeam.budget -= cost;
    winnerTeam.players.push({ ...state.auction.player, cost });

    const histEntry = {
      player: state.auction.player,
      winner,
      winnerName: winnerTeam.name,
      winnerEmoji: winnerTeam.emoji,
      cost,
      result: 'assigned'
    };
    state.auctionHistory.unshift(histEntry);

    io.emit('player_assigned', {
      player: state.auction.player,
      winner,
      winnerName: winnerTeam.name,
      winnerEmoji: winnerTeam.emoji,
      cost,
      budgetLeft: winnerTeam.budget
    });

    io.emit('budget_update', { teamId: winner, budget: winnerTeam.budget });

    // Notify winning team
    const winSocket = io.sockets.sockets.get(winnerTeam.socketId);
    if (winSocket) {
      winSocket.emit('your_player', {
        player: state.auction.player,
        cost,
        budget: winnerTeam.budget,
        players: winnerTeam.players
      });
    }

    state.auction = null;
    state.phase = 'idle';
    broadcastState();
  });

  // ── skip_player ──────────────────────────────────────────────────────────────
  socket.on('skip_player', () => {
    if (!socket.isAdmin) return;
    if (!state.auction) return;
    clearTimer();

    state.auctionHistory.unshift({
      player: state.auction.player,
      winner: null,
      result: 'skipped'
    });

    io.emit('player_skipped', { player: state.auction.player });
    state.auction = null;
    state.phase = 'idle';
    broadcastState();
  });

  // ── reset_game ───────────────────────────────────────────────────────────────
  socket.on('reset_game', () => {
    if (!socket.isAdmin) return;
    clearTimer();
    state = buildInitialState();
    io.emit('state_sync', { ...safeState(), reset: true });
  });

  // ── disconnect ───────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (socket.isAdmin && adminSocket === socket) {
      adminSocket = null;
    }
    if (socket.teamId) {
      const team = state.teams[socket.teamId];
      if (team && team.socketId === socket.id) {
        team.connected = false;
        team.socketId = null;
        io.emit('team_disconnected', { teamId: socket.teamId });
        broadcastState();
      }
    }
  });
});

// ─── HTTP Routes ──────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/state', (req, res) => res.json(safeState()));

app.get('/api/players', (req, res) => {
  const { q, role, squad } = req.query;
  let result = ALL_PLAYERS;
  if (q) result = result.filter(p => p.Nome.toLowerCase().includes(q.toLowerCase()));
  if (role) result = result.filter(p => p.Ruolo_Classic === role.toUpperCase());
  if (squad) result = result.filter(p => p.Squadra.toLowerCase().includes(squad.toLowerCase()));
  res.json(result.slice(0, 100));
});

app.post('/api/teams-passwords', (req, res) => {
  const { adminPassword } = req.body;
  if (adminPassword !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Forbidden' });
  res.json(TEAMS_CONFIG.map(t => ({ id: t.id, name: t.name, password: t.password })));
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Fantacaserma server running on port ${PORT}`);
});
