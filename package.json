// ===================================================================
//  DURAK ENGINE  (pure logic, no DOM) — durak_engine.js
// ===================================================================
//
// Turn model (explicit state machine):
//   A "bout": one defender, one or more attackers. Attackers add cards
//   (same ranks as already on table) up to ATTACK_LIMIT or defender's hand size.
//   Defender responds to each: defend / transfer / take.
//
//   phase:
//     'attack'  -> waiting for the active attacker to place card(s) or pass
//     'defense' -> there are undefended cards; waiting for defender to act
//   After defender clears all undefended cards, control returns to attackers
//   (phase 'attack') so they may add more. When ALL eligible attackers pass
//   in a row with nothing undefended, the bout is WON by the defender.
//   If defender takes, bout ends immediately (taker skipped as next defender).
// ===================================================================

const SUITS = ['♠','♥','♦','♣'];
const SUIT_RED = {'♥':true,'♦':true,'♠':false,'♣':false};
const RANKS = [
  {r:2,l:'2'},{r:3,l:'3'},{r:4,l:'4'},{r:5,l:'5'},{r:6,l:'6'},
  {r:7,l:'7'},{r:8,l:'8'},{r:9,l:'9'},{r:10,l:'10'},
  {r:11,l:'J'},{r:12,l:'Q'},{r:13,l:'K'},{r:14,l:'A'}
];
const ATTACK_LIMIT = 4;

function makeDeck(){
  const d=[];
  for(const s of SUITS) for(const rk of RANKS) d.push({suit:s,rank:rk.r,label:rk.l});
  return d;
}
function shuffle(a, rng=Math.random){
  for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function cardId(c){return c.suit+c.rank;}

function createGame(numPlayers, startIdx=0, rng=Math.random){
  const deck = shuffle(makeDeck(), rng);
  const players=[];
  for(let i=0;i<numPlayers;i++){
    players.push({id:i, name:i===0?'Você':'Bot '+i, isHuman:i===0, hand:[], out:false});
  }
  for(let n=0;n<6;n++) for(const p of players) p.hand.push(deck.pop());
  const trumpCard = deck.shift();      // bottom card; drawn last
  const G = {
    players, deck, trumpCard, trumpSuit:trumpCard.suit, numPlayers,
    attackerIdx:startIdx, defenderIdx:nextActive(players,startIdx,1),
    table:[], phase:'attack',
    passers:new Set(),                 // attacker ids who passed this round
    discardCount:0, finished:false, durak:null, log:[], finishOrder:[],
    _sigCounts:{}, _sigLast:''   // endgame cycle-breaker bookkeeping
  };
  for(const p of players) sortHand(G,p);
  return G;
}

function nextActive(players, from, dir){
  let i=from;
  for(let k=0;k<players.length;k++){
    i=(i+dir+players.length)%players.length;
    if(!players[i].out) return i;
  }
  return from;
}
function activePlayers(G){return G.players.filter(p=>!p.out);}
function isTrump(G,c){return c.suit===G.trumpSuit;}
function beats(G,def,atk){
  if(def.suit===atk.suit) return def.rank>atk.rank;
  if(isTrump(G,def)&&!isTrump(G,atk)) return true;
  return false;
}
function sortHand(G,p){
  p.hand.sort((a,b)=>{
    const at=isTrump(G,a)?1:0,bt=isTrump(G,b)?1:0;
    if(at!==bt)return at-bt;
    if(a.suit!==b.suit)return SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit);
    return a.rank-b.rank;
  });
}
function L(G,msg,big=false){ G.log.unshift({msg,big}); }

function tableRanks(G){
  const s=new Set();
  for(const pr of G.table){ s.add(pr.atk.rank); if(pr.def)s.add(pr.def.rank); }
  return s;
}
function undefended(G){return G.table.filter(p=>!p.def);}
function drawPileSize(G){return G.deck.length+(G.trumpCard?1:0);}
function drawOne(G){
  if(G.deck.length>0)return G.deck.pop();
  if(G.trumpCard){const t=G.trumpCard;G.trumpCard=null;return t;}
  return null;
}
function removeFromHand(p,c){
  const i=p.hand.findIndex(x=>x.suit===c.suit&&x.rank===c.rank);
  if(i>=0)p.hand.splice(i,1);
}

// list of attacker ids in priority order (main attacker first, then clockwise, excluding defender)
function attackerOrder(G){
  const order=[G.attackerIdx];
  let i=G.attackerIdx;
  for(let k=0;k<G.numPlayers;k++){
    i=(i+1)%G.numPlayers;
    if(i!==G.defenderIdx && !G.players[i].out && !order.includes(i)) order.push(i);
  }
  return order.filter(idx=>!G.players[idx].out);
}

// Can a co-attacker still add? (limit + defender hand capacity)
function canAddMore(G){
  if(undefended(G).length>0) return false;          // must clear defense first
  if(G.table.length===0) return true;               // opening attack
  if(G.table.length>=ATTACK_LIMIT) return false;
  if(G.table.length>=G.players[G.defenderIdx].hand.length+G.table.filter(p=>!p.def).length) {
    // defender must be able to cover; cards already on table that are defended don't need covering.
  }
  // capacity = how many MORE undefended cards defender could face = defender hand length
  const need=G.table.filter(p=>!p.def).length; // currently 0 here
  if(G.table.length>=G.players[G.defenderIdx].hand.length+countDefended(G)) {}
  return G.table.length<ATTACK_LIMIT;
}
function countDefended(G){return G.table.filter(p=>p.def).length;}

// ---- core actions ----
function startBout(G, attackerIdx){
  // ensure the attacker actually has cards; if not, advance to one who does
  let aIdx=attackerIdx, guard=0;
  while(G.players[aIdx].hand.length===0 && guard++<G.numPlayers){
    aIdx=nextActive(G.players,aIdx,1);
  }
  G.attackerIdx=aIdx;
  // defender = next active player WITH cards (can't attack an empty hand)
  let dIdx=nextActive(G.players,aIdx,1); guard=0;
  while(G.players[dIdx].hand.length===0 && dIdx!==aIdx && guard++<G.numPlayers){
    dIdx=nextActive(G.players,dIdx,1);
  }
  G.defenderIdx=dIdx;
  G.table=[];
  G.phase='attack';
  G.passers=new Set();
  L(G,'— '+G.players[G.attackerIdx].name+' ataca '+G.players[G.defenderIdx].name+' —',true);
}

function legalAttackCap(G){
  // max cards that may be on the table total = min(ATTACK_LIMIT, defenderHand + alreadyDefended)
  return Math.min(ATTACK_LIMIT, G.players[G.defenderIdx].hand.length + countDefended(G));
}

function doAttack(G, playerIdx, cards){
  for(const c of cards){ G.table.push({atk:c,def:null}); removeFromHand(G.players[playerIdx],c); }
  G.passers=new Set();                 // a new attack resets passes
  G.phase='defense';
  L(G,G.players[playerIdx].name+' joga '+cards.map(c=>fmtTxt(c)).join(' '));
}

function doDefend(G, pairIndex, card){
  G.table[pairIndex].def=card;
  removeFromHand(G.players[G.defenderIdx],card);
  L(G,G.players[G.defenderIdx].name+' defende '+fmtTxt(G.table[pairIndex].atk)+' com '+fmtTxt(card));
  if(undefended(G).length===0) G.phase='attack'; // back to attackers to add or pass
}

function doTransfer(G, cards){
  const def=G.players[G.defenderIdx];
  for(const c of cards){ G.table.push({atk:c,def:null}); removeFromHand(def,c); }
  const nd=nextActive(G.players,G.defenderIdx,1);
  L(G,def.name+' TRANSFERE para '+G.players[nd].name+'!',true);
  G.defenderIdx=nd;
  G.passers=new Set();
  G.phase='defense';
}

function canTransfer(G){
  if(G.table.length===0) return false;
  if(G.table.some(p=>p.def)) return false;                 // no defenses yet
  if(new Set(G.table.map(p=>p.atk.rank)).size!==1) return false;
  const nd=nextActive(G.players,G.defenderIdx,1);
  if(nd===G.defenderIdx) return false;
  // next defender must have capacity to receive (hand >= resulting attack count)
  if(G.players[nd].hand.length < G.table.length+1) return false;
  return true;
}

function doTake(G){
  const def=G.players[G.defenderIdx];
  let n=0;
  for(const pr of G.table){ def.hand.push(pr.atk);n++; if(pr.def){def.hand.push(pr.def);n++;} }
  sortHand(G,def);
  L(G,def.name+' PEGA '+n+' carta(s).',true);
  const taker=G.defenderIdx;
  G.table=[];
  refill(G);
  if(eliminate(G))return;
  // next attacker is the player after the taker (taker is skipped)
  startBout(G, nextActive(G.players,taker,1));
}

function resolveBoutWon(G){
  G.discardCount += G.table.reduce((n,p)=>n+(p.def?2:1),0);
  L(G,'Defesa bem-sucedida! Cartas descartadas.',true);
  const oldDef=G.defenderIdx;
  G.table=[];
  refill(G);
  if(eliminate(G))return;
  startBout(G, oldDef); // defender becomes attacker
}

// Refill in order: main attacker first, co-attackers clockwise, defender last.
function refill(G){
  const order=attackerOrder(G);
  if(!order.includes(G.defenderIdx) && !G.players[G.defenderIdx].out) order.push(G.defenderIdx);
  for(const idx of order){
    const p=G.players[idx];
    while(p.hand.length<6 && drawPileSize(G)>0) p.hand.push(drawOne(G));
    sortHand(G,p);
  }
}

function eliminate(G){
  if(drawPileSize(G)>0) return false;
  // process exits in attacker-first order so simultaneous exits get sensible placement
  const order=[];
  let i=G.attackerIdx;
  for(let k=0;k<G.numPlayers;k++){ order.push(i); i=(i+1)%G.numPlayers; }
  for(const idx of order){
    const p=G.players[idx];
    if(!p.out && p.hand.length===0){ p.out=true; G.finishOrder.push(p.id); L(G,p.name+' terminou suas cartas e saiu!',true); }
  }
  const rem=activePlayers(G);
  if(rem.length<=1){
    G.finished=true; G.durak=rem.length===1?rem[0]:null;
    if(G.durak){ G.finishOrder.push(G.durak.id); L(G,'🃏 '+G.durak.name+' é o DURAK!',true); }
    return true;
  }
  return false;
}

function fmtTxt(c){return c.label+c.suit;}

// ===== Attacker pass handling =====
// An attacker "passes" (declines to add). When every active attacker has passed
// while nothing is undefended, the bout is won by the defender.
function doPass(G, playerIdx){
  G.passers.add(playerIdx);
  const order=attackerOrder(G);
  const allPassed=order.every(idx=>G.passers.has(idx) || G.players[idx].hand.length===0);
  if(undefended(G).length===0 && allPassed && G.table.length>0){
    resolveBoutWon(G);
    return true;
  }
  if(G.table.length===0 && allPassed){
    // opening attacker has no cards to play (edge): move bout along
    resolveBoutWon(G);
    return true;
  }
  return false;
}

// ===================== BOT AI =====================
function botActAttacker(G, idx){
  const p=G.players[idx];
  const cap=legalAttackCap(G)-G.table.length;
  if(cap<=0 || p.hand.length===0){ return doPass(G,idx); }
  let candidates;
  if(G.table.length===0){
    candidates=p.hand;                        // opening: any card
  }else{
    const ranks=tableRanks(G);
    candidates=p.hand.filter(c=>ranks.has(c.rank)); // add: must match a table rank
  }
  if(candidates.length===0) return doPass(G,idx);
  // choose lowest (prefer non-trump)
  const sorted=[...candidates].sort((a,b)=>{
    const at=isTrump(G,a)?1:0,bt=isTrump(G,b)?1:0;
    if(at!==bt)return at-bt;return a.rank-b.rank;
  });
  const pick=sorted[0];
  // when opening, don't dump trumps early if non-trump exists
  const sameRank=p.hand.filter(c=>c.rank===pick.rank);
  const take=Math.min(sameRank.length, cap);
  doAttack(G, idx, sameRank.slice(0,Math.max(1,take)));
  return false;
}

function botActDefender(G){
  const def=G.players[G.defenderIdx];
  const undef=undefended(G);
  if(undef.length===0) return; // nothing to do
  // transfer? Only with a low non-trump card and not in the empty-deck endgame
  if(canTransfer(G) && drawPileSize(G)>0){
    const r=G.table[0].atk.rank;
    const m=def.hand.find(c=>c.rank===r && !isTrump(G,c) && c.rank<=8);
    if(m && Math.random()<0.4){ doTransfer(G,[m]); return; }
  }
  // defend lowest undefended with smallest valid card
  const tgt=[...undef].sort((a,b)=>a.atk.rank-b.atk.rank)[0];
  const opts=def.hand.filter(c=>beats(G,c,tgt.atk)).sort((a,b)=>{
    const at=isTrump(G,a)?1:0,bt=isTrump(G,b)?1:0;
    if(at!==bt)return at-bt;return a.rank-b.rank;
  });
  if(opts.length===0){ doTake(G); return; }
  // don't waste a high trump if total attack is small & we might get overwhelmed: simple heuristic ok
  const pairIndex=G.table.indexOf(tgt);
  doDefend(G,pairIndex,opts[0]);
}

// One synchronous "tick": advance whichever side must act. Returns false if it's
// waiting on a human (caller handles UI), true if it acted.
function botTick(G){
  if(G.finished) return false;

  // --- endgame cycle-breaker: only when deck is empty ---
  if(drawPileSize(G)===0){
    const sig=G.attackerIdx+'|'+G.defenderIdx+'|'+G.phase+'|'+
      G.players.map(p=>p.out?'X':p.hand.map(cardId).sort().join('')).join('/')+'|'+
      G.table.map(pr=>cardId(pr.atk)+(pr.def?cardId(pr.def):'-')).join(',');
    if(sig===G._sigLast){
      G._sigCounts[sig]=(G._sigCounts[sig]||0)+1;
    } else {
      G._sigLast=sig; G._sigCounts[sig]=(G._sigCounts[sig]||0)+1;
    }
    if(G._sigCounts[sig]>2){
      // forced progress: defender takes whatever is on the table; if nothing, forced lowest attack
      if(G.table.length>0 && undefended(G).length>0){ doTake(G); return true; }
      if(G.table.length===0){
        const a=G.players[G.attackerIdx];
        if(a.hand.length>0){
          const low=[...a.hand].sort((x,y)=>x.rank-y.rank)[0];
          doAttack(G,G.attackerIdx,[low]); return true;
        }
      }
    }
  }

  if(G.phase==='defense'){
    const def=G.players[G.defenderIdx];
    if(def.isHuman) return false;
    botActDefender(G);
    return true;
  }
  const order=attackerOrder(G);
  for(const idx of order){
    if(G.passers.has(idx)) continue;
    if(G.players[idx].isHuman) return false;
    botActAttacker(G, idx);
    return true;
  }
  if(undefended(G).length===0 && G.table.length>0){ resolveBoutWon(G); return true; }
  return false;
}


// ---- exports for Node (server) and browser ----
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createGame, startBout, botTick, botActAttacker, botActDefender,
    doAttack, doDefend, doTransfer, doTake, doPass, resolveBoutWon,
    canTransfer, beats, isTrump, drawPileSize, activePlayers, attackerOrder,
    tableRanks, undefended, legalAttackCap, nextActive, cardId, refill, eliminate,
    SUITS, SUIT_RED, RANKS, ATTACK_LIMIT
  };
}
