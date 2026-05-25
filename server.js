// ===================================================================
//  DURAK ONLINE — servidor autoritativo (Node + ws)
// ===================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const E = require('./engine.js');

const PORT = process.env.PORT || 3000;

// ---------- static file server (serves the client) ----------
// Looks for static files in ./public first, then the project root, so it works
// whether index.html sits inside a public/ folder or loose in the repo root.
const ROOTS = [path.join(__dirname, 'public'), __dirname];
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.ico':'image/x-icon' };
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath.startsWith('/sala/')) urlPath = '/index.html'; // room links serve the app
  const rel = urlPath.replace(/^\/+/, '');                 // strip leading slashes
  if (rel.includes('..')) { res.writeHead(403); return res.end('forbidden'); }
  // try each root in order
  let idx = 0;
  const tryNext = () => {
    if (idx >= ROOTS.length) { res.writeHead(404); return res.end('not found'); }
    const base = ROOTS[idx++];
    const file = path.join(base, rel);
    if (!file.startsWith(base)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(file, (err, data) => {
      if (err) return tryNext();
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  };
  tryNext();
});

// ===================================================================
//  ROOMS
// ===================================================================
/*
 room = {
   code, hostId, started, numSeats,
   seats: [ { kind:'open'|'human'|'bot', playerId, name, connId } ],   // index = engine player index
   G,                       // engine game state (or null until started)
   conns: Map<connId, ws>,
   botTimer
 }
*/
const rooms = new Map();

function roomCode() {
  // short, link-friendly, unambiguous
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for (let i=0;i<4;i++) s+=a[crypto.randomInt(a.length)];
  return s;
}
function newId() { return crypto.randomBytes(8).toString('hex'); }

function createRoom(hostConnId, hostName, numSeats, attackLimit) {
  let code; do { code = roomCode(); } while (rooms.has(code));
  const seats = [];
  for (let i=0;i<numSeats;i++) seats.push({ kind:'open', playerId:null, name:'Vazio', connId:null });
  // host takes seat 0
  const hostId = newId();
  seats[0] = { kind:'human', playerId:hostId, name:hostName||'Jogador', connId:hostConnId };
  const room = { code, hostId, started:false, numSeats, attackLimit: (attackLimit===0?0:(attackLimit||4)), seats, G:null, conns:new Map(), botTimer:null };
  rooms.set(code, room);
  return { room, hostId };
}

function seatCounts(room){
  let humans=0, open=0, bots=0;
  for (const s of room.seats){ if(s.kind==='human') humans++; else if(s.kind==='open') open++; else bots++; }
  return { humans, open, bots };
}

// ---------- lobby / game state broadcasting ----------
function lobbyView(room){
  return {
    type:'lobby',
    code: room.code,
    started: room.started,
    numSeats: room.numSeats,
    attackLimit: room.attackLimit,   // 4/5/6 or 0 = sem limite
    seats: room.seats.map((s,i)=>({ idx:i, kind:s.kind, name:s.name, connected: s.kind==='human' ? !!(s.connId && room.conns.has(s.connId)) : true }))
  };
}

// Per-player filtered game view: hide other players' card faces.
function gameView(room, viewerSeatIdx){
  const G = room.G;
  if (!G) return null;
  return {
    type:'state',
    you: viewerSeatIdx,
    trumpSuit: G.trumpSuit,
    trumpCard: G.trumpCard ? pubCard(G.trumpCard) : null,
    deckCount: E.drawPileSize(G),
    discardCount: G.discardCount,
    attackLimit: G.attackLimit===Infinity ? 0 : G.attackLimit,   // 0 = sem limite (no JSON, Infinity vira null)
    attackerIdx: G.attackerIdx,
    defenderIdx: G.defenderIdx,
    phase: G.phase,
    table: G.table.map(pr=>({ atk: pubCard(pr.atk), def: pr.def?pubCard(pr.def):null })),
    passers: [...G.passers],
    finished: G.finished,
    durakIdx: G.durak ? G.durak.id : null,
    finishOrder: G.finishOrder.slice(),
    players: G.players.map((p,i)=>({
      idx:i, name: room.seats[i]?room.seats[i].name:p.name,
      kind: room.seats[i]?room.seats[i].kind:'bot',
      out:p.out, count:p.hand.length,
      hand: i===viewerSeatIdx ? p.hand.map(pubCard) : null  // only your own hand
    })),
    legal: viewerSeatIdx!=null ? legalFor(room, viewerSeatIdx) : null,
    log: G.log.slice(0,30)
  };
}
function pubCard(c){ return { suit:c.suit, rank:c.rank, label:c.label }; }

function broadcast(room){
  if (room.started && room.G){
    for (const [connId, ws] of room.conns){
      const seatIdx = room.seats.findIndex(s=>s.connId===connId);
      send(ws, gameView(room, seatIdx>=0?seatIdx:null));
    }
  } else {
    const lv = lobbyView(room);
    for (const [, ws] of room.conns) send(ws, lv);
  }
}
function send(ws, obj){ try{ if(ws && ws.readyState===1) ws.send(JSON.stringify(obj)); }catch(e){} }

// ===================================================================
//  GAME FLOW
// ===================================================================
function startGame(room){
  // fill remaining open seats with bots
  for (const s of room.seats) if (s.kind==='open'){ s.kind='bot'; s.name = botName(room); }
  room.numSeats = room.seats.length;
  const G = E.createGame(room.numSeats, 0, Math.random, room.attackLimit);
  // override engine player names + isHuman with seat info
  G.players.forEach((p,i)=>{ p.name = room.seats[i].name; p.isHuman = room.seats[i].kind==='human'; });
  room.G = G;
  room.started = true;
  E.startBout(G, 0);
  broadcast(room);
  driveBots(room);
}
let botCounter=0;
function botName(room){ botCounter++; return 'Bot '+botCounter; }

// A human seat that is disconnected is treated like a bot for flow purposes.
function seatActsAsBot(room, idx){
  const s = room.seats[idx];
  if (s.kind==='bot') return true;
  if (s.kind==='human' && !(s.connId && room.conns.has(s.connId))) return true; // disconnected
  return false;
}

// Sync engine isHuman flags to reflect who is a *connected* human right now.
function syncControl(room){
  const G = room.G; if(!G) return;
  G.players.forEach((p,i)=>{ p.isHuman = !seatActsAsBot(room, i); });
}

// The seat the engine is waiting on for the SEQUENTIAL phases (defense, opening attack).
// Returns null during the co-attack window (handled separately/simultaneously) or when
// the game can advance on its own.
function whoseTurn(room){
  const G = room.G;
  if (!G || G.finished) return null;
  if (G.phase==='defense') return G.defenderIdx;
  if (G.phase==='attack' && G.table.length===0) return G.attackerIdx;
  return null;
}

// True if we must pause for human input. Covers:
//  - defense / opening attack: the single actor is a connected human
//  - co-attack window: ANY connected human attacker can still act and hasn't passed
function isWaitingOnConnectedHuman(room){
  const G = room.G;
  if (!G || G.finished) return false;

  // co-attack window
  if (G.phase==='attack' && G.table.length>0 && E.undefended(G).length===0){
    const cap = E.legalAttackCap(G);
    const ranks = E.tableRanks(G);
    for (const i of E.attackerOrder(G)){
      if (i===G.defenderIdx) continue;
      if (G.passers.has(i)) continue;
      if (seatActsAsBot(room, i)) continue;            // bots are driven by botTick, not waited on
      // a connected human who hasn't passed: they may add (if room) or must choose to pass
      return true;
    }
    return false;
  }

  const idx = whoseTurn(room);
  if (idx==null) return false;
  return !seatActsAsBot(room, idx);
}

// Drive bot/disconnected attackers in the co-attack window (add a card or pass),
// without touching connected humans. Returns true if any bot acted.
function driveCoAttackBots(room){
  const G = room.G;
  if (!(G.phase==='attack' && G.table.length>0 && E.undefended(G).length===0)) return false;
  let acted = false;
  const cap = E.legalAttackCap(G);
  for (const i of E.attackerOrder(G)){
    if (i===G.defenderIdx) continue;
    if (G.passers.has(i)) continue;
    if (!seatActsAsBot(room, i)) continue;            // leave humans alone
    const ranks = E.tableRanks(G);
    const card = (G.table.length < E.legalAttackCap(G))
      ? G.players[i].hand.find(c=>ranks.has(c.rank)) : null;
    if (card && Math.random()<0.85){
      E.doAttack(G, i, [card]);                        // bot piles on
    } else {
      E.doPass(G, i);                                  // bot declines
    }
    acted = true;
    if (G.finished) return true;
    // after a bot adds, undefended>0 -> defender must respond; stop co-attack driving
    if (E.undefended(G).length>0) return true;
  }
  return acted;
}

// Auto-pass any attacker (in the co-attack window) who literally cannot add a card.
function autoPassStuckCoAttackers(room){
  const G = room.G;
  if (!(G.phase==='attack' && G.table.length>0 && E.undefended(G).length===0)) return;
  const cap = E.legalAttackCap(G);
  const ranks = E.tableRanks(G);
  for (const i of E.attackerOrder(G)){
    if (i===G.defenderIdx) continue;
    if (G.passers.has(i)) continue;
    const canAdd = G.table.length < cap && G.players[i].hand.some(c=>ranks.has(c.rank));
    if (!canAdd && seatActsAsBot(room, i)){ E.doPass(G, i); if (G.finished) return; }
  }
}

// Main driver. Idempotent & safe to call from any message handler.
// Advances all bot/disconnected turns (broadcasting each, with pacing) until it's
// a connected human's turn or the game ends. Uses a single per-room timer guarded
// by `pumping` so timers never pile up or get orphaned.
function pump(room){
  const G = room.G;
  if (!G) return;
  syncControl(room);

  // --- Co-attack window: simultaneous. Drive bots, wait on humans, resolve when all passed. ---
  if (G.phase==='attack' && G.table.length>0 && E.undefended(G).length===0){
    autoPassStuckCoAttackers(room);                 // bots with nothing to add pass automatically
    if (allCoAttackersDone(room)){                  // everyone passed (or limit reached) -> bout won
      E.resolveBoutWon(G);
      broadcast(room); syncControl(room);
      if (G.finished){ clearTimeout(room.botTimer); room.botTimer=null; return; }
      scheduleNext(room); return;
    }
    if (isWaitingOnConnectedHuman(room)){           // a human may still add/pass -> wait for them
      clearTimeout(room.botTimer); room.botTimer=null; broadcast(room); return;
    }
    // only bots left to act -> let a bot add or pass, then continue
    const acted = driveCoAttackBots(room);
    broadcast(room); syncControl(room);
    if (G.finished){ clearTimeout(room.botTimer); room.botTimer=null; return; }
    if (acted){ scheduleNext(room); return; }
    // nothing happened: safety resolve
    E.resolveBoutWon(G); broadcast(room); if(!G.finished) scheduleNext(room);
    return;
  }

  if (G.finished){ clearTimeout(room.botTimer); room.botTimer=null; broadcast(room); return; }
  if (isWaitingOnConnectedHuman(room)){ clearTimeout(room.botTimer); room.botTimer=null; broadcast(room); return; }

  // Sequential phases (defense / opening attack) driven by the validated engine.
  let acted = false;
  try { acted = E.botTick(G); }
  catch(e){ console.error('PUMP botTick error', e.message, e.stack); }
  if (!acted && !G.finished){
    if (E.undefended(G).length===0 && G.table.length>0){ E.resolveBoutWon(G); acted=true; }
  }
  broadcast(room);
  syncControl(room);
  if (G.finished){ clearTimeout(room.botTimer); room.botTimer=null; return; }
  if (isWaitingOnConnectedHuman(room)){ clearTimeout(room.botTimer); room.botTimer=null; return; }
  if (!acted){ clearTimeout(room.botTimer); room.botTimer=null; return; }
  scheduleNext(room);
}

// True when every eligible attacker has passed (or the table hit the cap) -> bout is won.
function allCoAttackersDone(room){
  const G = room.G;
  const cap = E.legalAttackCap(G);
  if (G.table.length >= cap) {
    // at cap: done only if no undefended remain (all defended) — which is the window condition
    // still allow if everyone passed too; treat cap as done.
    return true;
  }
  for (const i of E.attackerOrder(G)){
    if (i===G.defenderIdx) continue;
    if (!G.passers.has(i)) return false;             // someone still has the option
  }
  return true;
}

function scheduleNext(room){
  clearTimeout(room.botTimer);
  const pace = process.env.FAST ? 15 : 650;
  room.botTimer = setTimeout(()=>{ room.botTimer=null; pump(room); }, pace);
}

// Back-compat name used by message handlers.
function driveBots(room){ clearTimeout(room.botTimer); room.botTimer=null; pump(room); }

// ---------- legal-move computation for a given (connected) seat ----------
function legalFor(room, seatIdx){
  const G = room.G;
  if (!G || G.finished) return null;
  const p = G.players[seatIdx];
  if (!p || p.out) return { youract:false };
  const out = { youract:false, canAttack:false, canDefend:false, canTransfer:false, canTake:false, canPass:false, defendMap:{}, attackRanks:[], transferRank:null };

  // DEFENSE: only the defender acts.
  if (G.phase==='defense' && G.defenderIdx===seatIdx){
    out.youract = true;
    out.canTake = true;
    if (E.canTransfer(G)){ out.canTransfer = true; out.transferRank = G.table[0].atk.rank; }
    G.table.forEach((pr,ti)=>{
      if (pr.def) return;
      const opts = p.hand.filter(c=>E.beats(G,c,pr.atk)).map(E.cardId);
      if (opts.length) out.defendMap[ti] = opts;
    });
    out.canDefend = Object.keys(out.defendMap).length>0;
    return out;
  }

  if (G.phase==='attack'){
    // OPENING attack: only the main attacker.
    if (G.table.length===0){
      if (G.attackerIdx===seatIdx){
        out.youract = true; out.canAttack = true;
        out.attackRanks = [...new Set(p.hand.map(c=>c.rank))];
      }
      return out;
    }
    // CO-ATTACK window (all cards defended): ANY eligible attacker may add, simultaneously.
    if (E.undefended(G).length===0){
      if (seatIdx===G.defenderIdx) return out;            // defender never co-attacks
      if (!E.attackerOrder(G).includes(seatIdx)) return out;
      if (G.passers.has(seatIdx)) return out;             // already passed this round
      out.youract = true;
      out.canPass = true;                                 // may always decline
      const cap = E.legalAttackCap(G);
      if (G.table.length < cap){
        const ranks = E.tableRanks(G);
        const addable = p.hand.filter(c=>ranks.has(c.rank)).map(c=>c.rank);
        if (addable.length){ out.canAttack=true; out.attackRanks=[...new Set(addable)]; }
      }
      return out;
    }
  }
  return out;
}

// ---------- apply a validated action from a seat ----------
function applyAction(room, seatIdx, msg){
  const G = room.G;
  if (!G || G.finished) return;
  syncControl(room);
  const p = G.players[seatIdx];
  if (!p || p.out) return;
  const byId = id => p.hand.find(c=>E.cardId(c)===id);

  if (msg.action==='attack'){
    const cards = (msg.cardIds||[]).map(byId).filter(Boolean);
    if (!cards.length) return;
    if (new Set(cards.map(c=>c.rank)).size>1) return;       // must be same rank
    if (G.table.length===0){
      if (G.attackerIdx!==seatIdx) return;
      if (cards.length > E.legalAttackCap(G)) return;
      E.doAttack(G, seatIdx, cards);
    } else {
      // co-attack: must be an eligible attacker who hasn't passed, all defended, ranks on table
      if (E.undefended(G).length!==0) return;
      if (seatIdx===G.defenderIdx) return;
      if (!E.attackerOrder(G).includes(seatIdx)) return;
      if (G.passers.has(seatIdx)) return;
      const ranks = E.tableRanks(G);
      if (!cards.every(c=>ranks.has(c.rank))) return;
      if (G.table.length + cards.length > E.legalAttackCap(G)) return;
      E.doAttack(G, seatIdx, cards);
    }
  }
  else if (msg.action==='defend'){
    if (G.phase!=='defense' || G.defenderIdx!==seatIdx) return;
    const ti = msg.pairIndex; const card = byId(msg.cardId);
    if (card==null || !G.table[ti] || G.table[ti].def) return;
    if (!E.beats(G, card, G.table[ti].atk)) return;
    E.doDefend(G, ti, card);
  }
  else if (msg.action==='transfer'){
    if (!E.canTransfer(G) || G.defenderIdx!==seatIdx) return;
    const cards = (msg.cardIds||[]).map(byId).filter(Boolean);
    const r = G.table[0].atk.rank;
    if (!cards.length || !cards.every(c=>c.rank===r)) return;
    E.doTransfer(G, cards);
  }
  else if (msg.action==='take'){
    if (G.phase!=='defense' || G.defenderIdx!==seatIdx) return;
    E.doTake(G);
  }
  else if (msg.action==='pass'){
    if (G.phase!=='attack' || G.table.length===0) return;
    if (E.undefended(G).length!==0) return;          // can only pass when all defended
    if (seatIdx===G.defenderIdx) return;
    if (!E.attackerOrder(G).includes(seatIdx)) return;
    E.doPass(G, seatIdx);
  }

  broadcast(room);
  if (!G.finished) driveBots(room); else clearTimeout(room.botTimer);
}

// ===================================================================
//  WEBSOCKET WIRING
// ===================================================================
const wss = new WebSocketServer({ server });
wss.on('connection', (ws)=>{
  const connId = newId();
  ws._connId = connId;
  ws._room = null;
  ws._seat = null;

  send(ws, { type:'hello', connId });

  ws.on('message', (raw)=>{
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }

    if (msg.type==='create'){
      const seats = Math.min(6, Math.max(2, msg.numSeats||4));
      // attackLimit: 4, 5, 6, or 0 = "sem limite" (limita só pela mão do defensor)
      let lim = msg.attackLimit;
      if (lim===0 || lim==='0' || lim==='none') lim = 0;
      else { lim = parseInt(lim); if (![4,5,6].includes(lim)) lim = 4; }
      const { room, hostId } = createRoom(connId, msg.name, seats, lim);
      room.conns.set(connId, ws);
      ws._room = room.code; ws._seat = 0;
      send(ws, { type:'joined', code:room.code, seat:0, playerId:hostId, host:true });
      broadcast(room);
      return;
    }

    if (msg.type==='join'){
      const room = rooms.get((msg.code||'').toUpperCase());
      if (!room){ send(ws, { type:'error', error:'Sala não encontrada' }); return; }
      if (room.started){
        // allow reconnecting to an existing human seat by playerId
        const seat = room.seats.findIndex(s=>s.kind==='human' && s.playerId===msg.playerId);
        if (seat>=0){
          room.seats[seat].connId = connId;
          room.conns.set(connId, ws);
          ws._room=room.code; ws._seat=seat;
          send(ws, { type:'joined', code:room.code, seat, playerId:msg.playerId, host:room.seats[seat].playerId===room.hostId });
          broadcast(room); driveBots(room);
          return;
        }
        send(ws, { type:'error', error:'A partida já começou' }); return;
      }
      // take first open seat
      const seat = room.seats.findIndex(s=>s.kind==='open');
      if (seat<0){ send(ws, { type:'error', error:'Sala cheia' }); return; }
      const pid = newId();
      room.seats[seat] = { kind:'human', playerId:pid, name:msg.name||('Jogador '+(seat+1)), connId };
      room.conns.set(connId, ws);
      ws._room=room.code; ws._seat=seat;
      send(ws, { type:'joined', code:room.code, seat, playerId:pid, host:false });
      broadcast(room);
      return;
    }

    const room = ws._room ? rooms.get(ws._room) : null;
    if (!room) return;

    if (msg.type==='start'){
      // only host can start, need >=2 humans? allow host alone vs bots too
      if (room.seats[0].connId!==connId) return; // simplistic host check (seat 0)
      if (room.started) return;
      startGame(room);
      return;
    }

    if (msg.type==='setSeats'){
      if (room.started || room.seats[0].connId!==connId) return;
      const n = Math.min(6, Math.max(2, msg.numSeats||4));
      resizeSeats(room, n);
      broadcast(room);
      return;
    }

    if (msg.type==='addBot'){
      if (room.started || room.seats[0].connId!==connId) return;
      const seat = room.seats.findIndex(s=>s.kind==='open');
      if (seat>=0){ room.seats[seat]={kind:'bot',playerId:null,name:botName(room),connId:null}; broadcast(room); }
      return;
    }
    if (msg.type==='removeBot'){
      if (room.started || room.seats[0].connId!==connId) return;
      for (let i=room.seats.length-1;i>=1;i--){ if(room.seats[i].kind==='bot'){ room.seats[i]={kind:'open',playerId:null,name:'Vazio',connId:null}; break; } }
      broadcast(room);
      return;
    }

    if (msg.type==='action'){
      if (!room.started) return;
      if (ws._seat==null) return;
      applyAction(room, ws._seat, msg);
      return;
    }

    if (msg.type==='leave'){
      // intentional exit to menu (different from a disconnect, which keeps the seat)
      const seat = room.seats.findIndex(s=>s.connId===connId);
      room.conns.delete(connId);
      ws._room = null; ws._seat = null;
      if (seat>=0){
        if (!room.started && seat===0){
          // host left the lobby -> close the room
          for (const [,c] of room.conns) send(c, { type:'error', error:'O anfitrião saiu. Sala encerrada.' });
          clearTimeout(room.botTimer); rooms.delete(room.code);
          return;
        }
        if (room.started){
          // replace with a bot for the rest of the game
          room.seats[seat] = { kind:'bot', playerId:null, name:room.seats[seat].name, connId:null };
        } else {
          room.seats[seat] = { kind:'open', playerId:null, name:'Vazio', connId:null };
        }
      }
      if (room.conns.size===0){ clearTimeout(room.botTimer); rooms.delete(room.code); return; }
      broadcast(room);
      if (room.started) driveBots(room);
      return;
    }

    if (msg.type==='again'){
      if (!room.started || !room.G || !room.G.finished) return;
      if (room.seats[0].connId!==connId) return;
      // restart: durak starts, keep same seats
      const starter = room.G.durak ? room.G.durak.id : 0;
      const G = E.createGame(room.numSeats, 0, Math.random, room.attackLimit);
      G.players.forEach((p,i)=>{ p.name=room.seats[i].name; p.isHuman=room.seats[i].kind==='human'; });
      room.G = G;
      E.startBout(G, (starter<room.numSeats && !G.players[starter].out)?starter:0);
      broadcast(room); driveBots(room);
      return;
    }
  });

  ws.on('close', ()=>{
    const room = ws._room ? rooms.get(ws._room) : null;
    if (!room) return;
    room.conns.delete(connId);
    if (!room.started){
      // free the seat in lobby
      const seat = room.seats.findIndex(s=>s.connId===connId);
      if (seat>=0){
        if (seat===0){
          // host left lobby -> close room
          rooms.delete(room.code);
          for (const [,c] of room.conns) send(c, { type:'error', error:'O anfitrião saiu. Sala encerrada.' });
          return;
        }
        room.seats[seat] = { kind:'open', playerId:null, name:'Vazio', connId:null };
      }
      broadcast(room);
    } else {
      // in-game: mark disconnected; bots will cover the turn. keep seat for reconnect.
      const seat = room.seats.findIndex(s=>s.connId===connId);
      if (seat>=0) room.seats[seat].connId = null;
      broadcast(room);
      driveBots(room);
    }
    // cleanup empty rooms
    if (room.conns.size===0){ clearTimeout(room.botTimer); rooms.delete(room.code); }
  });
});

function resizeSeats(room, n){
  const cur = room.seats.length;
  if (n>cur){ for(let i=cur;i<n;i++) room.seats.push({kind:'open',playerId:null,name:'Vazio',connId:null}); }
  else if (n<cur){
    // only trim trailing open/bot seats; never remove humans
    for (let i=cur-1;i>=n;i--){ if(room.seats[i].kind==='human'){ n=i+1; break; } }
    room.seats.length = Math.max(n, room.seats.findLastIndex(s=>s.kind==='human')+1);
  }
  room.numSeats = room.seats.length;
}

server.listen(PORT, ()=>console.log('Durak online em http://localhost:'+PORT));
