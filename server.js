// Basket Online - a Basket Random style 1v1 game played across devices.
// The server runs the physics (so both players see the same game);
// browsers only send "button pressed / released" and draw what the server sends.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Engine, Bodies, Body, Composite, Constraint } = require('matter-js');

const app = express();
app.use(express.static(__dirname + '/public'));
const server = http.createServer(app);
const io = new Server(server);

const W = 1000, H = 600, FLOOR = 540, WIN_SCORE = 5;
const RIM_Y = 250;
// Hoops: index 0 = left hoop (team 1 shoots here), 1 = right hoop (team 0 shoots here)
const HOOPS = [
  { board: 40, back: 58, front: 150 },
  { board: W - 40, back: W - 58, front: W - 150 },
];

const BASE = { name: 'Classic', gravity: 1, ballR: 18, ballDensity: 0.002, bounce: 0.75,
  height: [95, 110], friction: 0.8, court: '#d9a066', sky: '#8fd3ff' };
const VARIANTS = [
  {},
  { name: 'Beach Ball', ballR: 27, ballDensity: 0.0004, bounce: 0.9, court: '#f2d48b', sky: '#7fe0ff' },
  { name: 'Heavy Ball', ballR: 15, ballDensity: 0.012, bounce: 0.35, court: '#9a9a9a', sky: '#c9c9d6' },
  { name: 'Moon', gravity: 0.5, court: '#cfcfcf', sky: '#1b1b3a' },
  { name: 'Giants', height: [125, 140] },
  { name: 'Tiny', height: [65, 80], court: '#b5e08a' },
  { name: 'Ice', friction: 0.02, court: '#dff3ff', sky: '#bfe6ff' },
  { name: 'Mismatch', height: [65, 140], court: '#e3a3c7' },
];
const pickVariant = (prev) => {
  let v; do { v = VARIANTS[Math.floor(Math.random() * VARIANTS.length)]; } while (v.name === prev && VARIANTS.length > 1);
  return { ...BASE, ...v };
};

const rooms = {};
const makeCode = () => { let c; do { c = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms[c]); return c; };
const rand = (a, b) => a + Math.random() * (b - a);

function buildRound(room) {
  const v = room.variant = pickVariant(room.variant && room.variant.name);
  const engine = room.engine = Engine.create();
  engine.gravity.y = v.gravity;
  const st = { isStatic: true, friction: v.friction, restitution: 0.2 };
  Composite.add(engine.world, [
    Bodies.rectangle(W / 2, FLOOR + 50, W * 2, 100, st),
    Bodies.rectangle(-25, H / 2, 50, H * 4, st),
    Bodies.rectangle(W + 25, H / 2, 50, H * 4, st),
    Bodies.rectangle(W / 2, -300, W * 2, 50, st),
  ]);
  for (const h of HOOPS) {
    Composite.add(engine.world, [
      Bodies.rectangle(h.board, RIM_Y - 50, 12, 130, { isStatic: true, restitution: 0.5 }),
      Bodies.circle(h.back, RIM_Y, 5, { isStatic: true, restitution: 0.5 }),
      Bodies.circle(h.front, RIM_Y, 5, { isStatic: true, restitution: 0.5 }),
    ]);
  }
  // Characters: 2 per team, one button controls both
  room.chars = [];
  const starts = [[260, 380], [740, 620]];
  let group = -1;
  for (let team = 0; team < 2; team++) {
    for (let i = 0; i < 2; i++) {
      const h = rand(v.height[0], v.height[1]);
      const x = starts[team][i];
      const body = Bodies.rectangle(x, FLOOR - h / 2 - 2, 34, h, {
        chamfer: { radius: 14 }, density: 0.0025, friction: v.friction, frictionAir: 0.01,
        collisionFilter: { group }, restitution: 0.1,
      });
      const armLen = h * 0.62;
      const arm = Bodies.rectangle(x, FLOOR - h / 2 - 2 - h * 0.28 + armLen / 2, 12, armLen, {
        density: 0.0005, collisionFilter: { group }, frictionAir: 0.02,
      });
      const joint = Constraint.create({ bodyA: body, pointA: { x: 0, y: -h * 0.28 }, bodyB: arm,
        pointB: { x: 0, y: -armLen / 2 }, length: 0, stiffness: 1 });
      Composite.add(engine.world, [body, arm, joint]);
      room.chars.push({ team, body, arm, h, armLen, face: team === 0 ? 1 : -1, jumpCd: 0, grabCd: 0, prevHand: null });
      group--;
    }
  }
  const ball = room.ball = Bodies.circle(W / 2, 120, v.ballR, {
    density: v.ballDensity, restitution: v.bounce, friction: 0.05, frictionAir: 0.002,
  });
  Body.setVelocity(ball, { x: rand(-1, 1), y: 0 });
  Composite.add(engine.world, ball);
  room.holder = -1; room.heldTicks = 0; room.prevBallY = ball.position.y; room.roundTicks = 0;
}

function handPos(c) {
  const a = c.arm.angle, d = c.armLen / 2;
  return { x: c.arm.position.x - Math.sin(a) * d, y: c.arm.position.y + Math.cos(a) * d };
}

function step(room) {
  const v = room.variant, ball = room.ball;
  const playing = room.state === 'playing';
  room.roundTicks++;
  room.chars.forEach((c, idx) => {
    const pressed = playing && room.input[c.team];
    const b = c.body;
    const grounded = b.bounds.max.y > FLOOR - 6 && Math.abs(b.velocity.y) < 2.5;
    // Wobbly self-righting (weaker in the air, so they flop around)
    const k = grounded ? 0.035 : 0.008;
    Body.setAngularVelocity(b, b.angularVelocity * 0.96 - b.angle * k);
    // Jump in the direction the body is leaning -> the "random" feel
    c.jumpCd--;
    if (pressed && grounded && c.jumpCd <= 0) {
      const j = 10.5 * Math.sqrt(0.6 + 0.4 * v.gravity);
      Body.setVelocity(b, { x: b.velocity.x + Math.sin(b.angle) * j + c.face * 2.2, y: -Math.cos(b.angle) * j });
      Body.setAngularVelocity(b, b.angularVelocity + c.face * 0.06);
      c.jumpCd = 22;
    }
    // Arm motor: raise arm forward-up while pressed, hang down when released
    const rel = c.arm.angle - b.angle;
    const target = pressed ? -c.face * 2.8 : 0;
    Body.setAngularVelocity(c.arm, b.angularVelocity + (target - rel) * (pressed ? 0.35 : 0.12));
    c.grabCd--;
    const hand = handPos(c);
    c.handVel = c.prevHand ? { x: hand.x - c.prevHand.x, y: hand.y - c.prevHand.y } : { x: 0, y: 0 };
    c.prevHand = hand;
    // Grab / steal
    const dist = Math.hypot(hand.x - ball.position.x, hand.y - ball.position.y);
    if (playing && c.grabCd <= 0 && dist < v.ballR + 14 && room.holder !== idx) {
      const holderChar = room.chars[room.holder];
      const free = room.holder === -1;
      const canSteal = holderChar && holderChar.team !== c.team && pressed && room.heldTicks > 20 && Math.random() < 0.15;
      if (free || canSteal) {
        if (holderChar) holderChar.grabCd = 30;
        room.holder = idx; room.heldTicks = 0; ball.isSensor = true;
      }
    }
  });

  // Held ball follows the hand; throw when the arm swings up
  if (room.holder >= 0) {
    const c = room.chars[room.holder];
    room.heldTicks++;
    const hand = handPos(c);
    Body.setPosition(ball, { x: hand.x, y: hand.y });
    Body.setVelocity(ball, c.handVel);
    const raised = -(c.arm.angle - c.body.angle) * c.face;
    if (room.input[c.team] && raised > 2.1 && room.heldTicks > 12) throwBall(room, c, hand);
  }

  Engine.update(room.engine, 1000 / 60);

  // Scoring: ball passes downward through a rim
  if (room.state === 'playing') {
    const y0 = room.prevBallY, y1 = ball.position.y, x = ball.position.x;
    if (room.holder === -1 && y0 < RIM_Y && y1 >= RIM_Y) {
      HOOPS.forEach((h, i) => {
        const lo = Math.min(h.back, h.front) + 6, hi = Math.max(h.back, h.front) - 6;
        if (x > lo && x < hi) scorePoint(room, i === 1 ? 0 : 1);
      });
    }
  }
  room.prevBallY = ball.position.y;
  // Safety: if ball escapes or the round stalls, re-drop it
  if (ball.position.y > H + 100 || ball.position.x < -100 || ball.position.x > W + 100) {
    Body.setPosition(ball, { x: W / 2, y: 100 }); Body.setVelocity(ball, { x: 0, y: 0 });
  }
}

function throwBall(room, c, hand) {
  const ball = room.ball, v = room.variant;
  const targetHoop = HOOPS[c.team === 0 ? 1 : 0];
  const tx = (targetHoop.back + targetHoop.front) / 2;
  const g = 0.001 * v.gravity * (1000 / 60) ** 2; // px per tick^2 in matter.js
  const apex = Math.min(hand.y, RIM_Y) - rand(90, 170);
  const vy = -Math.sqrt(2 * g * Math.max(20, hand.y - apex));
  const T = -vy / g + Math.sqrt(2 * (RIM_Y - apex) / g);
  const error = rand(0.8, 1.2) + (Math.abs(c.body.angle) > 0.5 ? rand(-0.4, 0.4) : 0);
  const vx = ((tx - hand.x) / T) * error;
  room.holder = -1; ball.isSensor = false; c.grabCd = 25;
  Body.setPosition(ball, { x: hand.x, y: hand.y - 6 });
  Body.setVelocity(ball, { x: vx, y: vy });
}

function scorePoint(room, team) {
  room.score[team]++;
  room.state = 'point';
  io.to(room.code).emit('point', { team, score: room.score });
  setTimeout(() => {
    if (!rooms[room.code]) return;
    if (room.score[team] >= WIN_SCORE) {
      room.state = 'over';
      io.to(room.code).emit('over', { winner: team, score: room.score });
    } else {
      buildRound(room); room.state = 'playing';
      io.to(room.code).emit('round', { variant: room.variant, score: room.score });
    }
  }, 1600);
}

const r1 = (n) => Math.round(n * 10) / 10;
function snapshot(room) {
  return {
    c: room.chars.map((c) => [r1(c.body.position.x), r1(c.body.position.y), r1(c.body.angle * 100) / 100,
      r1(c.arm.position.x), r1(c.arm.position.y), Math.round(c.arm.angle * 100) / 100, Math.round(c.h), Math.round(c.armLen), c.team]),
    b: [r1(room.ball.position.x), r1(room.ball.position.y), Math.round(room.ball.angle * 100) / 100],
  };
}

function startGame(room) {
  room.score = [0, 0]; room.rematch = [false, false];
  buildRound(room); room.state = 'playing';
  room.players.forEach((id, team) => io.to(id).emit('start', {
    team, code: room.code, variant: room.variant, score: room.score, hoops: HOOPS, rimY: RIM_Y, floor: FLOOR, W, H,
  }));
  if (!room.loop) room.loop = setInterval(() => {
    if (room.state === 'over') return;
    step(room);
    io.to(room.code).emit('s', snapshot(room));
  }, 1000 / 60);
}

function closeRoom(code) {
  const room = rooms[code]; if (!room) return;
  clearInterval(room.loop); delete rooms[code];
}

io.on('connection', (socket) => {
  let myRoom = null, myTeam = -1;
  socket.on('create', () => {
    const code = makeCode();
    rooms[code] = { code, players: [socket.id, null], input: [false, false], state: 'waiting' };
    myRoom = code; myTeam = 0; socket.join(code);
    socket.emit('created', { code });
  });
  socket.on('join', (raw) => {
    const code = String(raw || '').trim().toUpperCase();
    const room = rooms[code];
    if (!room) return socket.emit('err', 'Room not found');
    if (room.players[1]) return socket.emit('err', 'Room is full');
    room.players[1] = socket.id; myRoom = code; myTeam = 1; socket.join(code);
    startGame(room);
  });
  socket.on('input', (down) => { const r = rooms[myRoom]; if (r && myTeam >= 0) r.input[myTeam] = !!down; });
  socket.on('rematch', () => {
    const r = rooms[myRoom]; if (!r || r.state !== 'over') return;
    r.rematch[myTeam] = true;
    io.to(myRoom).emit('rematchVote', r.rematch);
    if (r.rematch[0] && r.rematch[1]) startGame(r);
  });
  socket.on('disconnect', () => {
    if (!myRoom || !rooms[myRoom]) return;
    socket.to(myRoom).emit('left');
    closeRoom(myRoom);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Basket Online running on http://localhost:${PORT}`));
