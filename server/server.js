/*───────── 依存 ────────*/
const path = require("path");
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { roll } = require("./util/dice.js");

/*───────── 定数 ────────*/
const MAX_ROUNDS = 10;
const COL_LABEL = {
  yellow: "黄色",
  purple: "紫色",
  red: "赤色",
  green: "緑色",
  blue: "青色",
  pink: "桃色",
  gold: "金色",
};
const COL_HEX = {
  yellow: "#ffd43b",
  purple: "#b197fc",
  red: "#ff6b6b",
  green: "#8ce99a",
  blue: "#74c0fc",
  pink: "#ff99c8",
  gold: "#ffd700",
};

/* 新ダイスはイベント colourFocus の対象にも含める */
const COLOUR_KEYS = Object.keys(COL_LABEL);

/* イベント一覧 */
const EVENTS = [
  {
    key: "oddBoost",
    name: "オッドブースト",
    desc: "奇数出目が 2 倍！",
    color: "#ff922b",
  },
  {
    key: "evenBreak",
    name: "イーブンブレイク",
    desc: "偶数出目が 半分！",
    color: "#0ca678",
  },
  {
    key: "fever",
    name: "パンダフィーバー",
    desc: "全ダイス +2 (上限まで)",
    color: "#339af0",
  },
  {
    key: "gambleTime",
    name: "ギャンブルタイム",
    desc: "赤ダイスのマイナス確率 75 %！",
    color: "#fa5252",
  },
  {
    key: "colourFocus",
    name: "カラーフォーカス",
    desc: (c) => `${COL_LABEL[c]} が 2 倍！`,
    pickColor: true,
    colorFrom: (c) => COL_HEX[c],
  },
];

/*───────── 初期化 ────────*/
const app = express();
const http = createServer(app);
const io = new Server(http);
app.use(express.static(path.join(__dirname, "../dist")));

/*───────── 状態 ────────*/
let currentRound = 0,
  readyCnt = 0,
  gameStarted = false,
  currentEvent = null;
const players = {};

/*───────── util ────────*/
function chooseEvent() {
  if (Math.random() >= 0.5) return null; // 1/2
  const base = EVENTS[Math.floor(Math.random() * EVENTS.length)];
  if (!base.pickColor) return { ...base };
  const col = COLOUR_KEYS[Math.floor(Math.random() * COLOUR_KEYS.length)];
  return {
    ...base,
    colour: col,
    desc: base.desc(col),
    color: base.colorFrom(col),
  };
}
const topIds = (idx) => {
  const max = Math.max(...Object.values(players).map((p) => p.history[idx]));
  return Object.entries(players)
    .filter(([_, p]) => p.history[idx] === max)
    .map(([id]) => id);
};
const wrapHL = (v) => `<b style="color:#d32f2f;">${v}</b>`;

/*───────── ソケット ────────*/
io.on("connection", (sock) => {
  sock.on("setName", (name) => {
    if (gameStarted) {
      sock.emit("joinDenied");
      return;
    }
    players[sock.id] = {
      name,
      dice: {
        yellow: 1,
        purple: 0,
        red: 0,
        green: 0,
        blue: 0,
        pink: 0,
        gold: 0,
      },
      history: Array(MAX_ROUNDS).fill("-"),
      rolled: false,
      picked: false,
    };
    io.emit("state", players);
  });

  sock.on("startGame", () => {
    if (gameStarted || !Object.keys(players).length) return;
    gameStarted = true;
    currentRound = 1;
    currentEvent = null;
    io.emit("roundEvent", null);
    io.emit("state", players);
  });

  sock.on("resetGame", () => {
    toLobby();
    io.emit("resetDone");
    io.emit("state", players);
  });

  sock.on("pick", (col) => {
    const p = players[sock.id];
    if (p && !p.picked) {
      p.dice[col]++;
      p.picked = true;
      io.emit("state", players);
    }
  });

  sock.on("roll", () => {
    const p = players[sock.id];
    if (!gameStarted || !p || p.rolled || (currentRound > 1 && !p.picked))
      return;
    p.rolled = true;
    readyCnt++;
    let turn = 0;
    const per = {};
    const ev = currentEvent,
      odd = ev && ev.key === "oddBoost",
      even = ev && ev.key === "evenBreak";
    const fever = ev && ev.key === "fever",
      gamble = ev && ev.key === "gambleTime";
    const col2x = ev && ev.key === "colourFocus" ? ev.colour : null;

    const adjust = (v, max) => {
      let imp = false,
        orig = v;
      if (fever) {
        v = Math.min(v + 2, max);
        if (v !== orig) imp = true;
        orig = v;
      }
      if (odd && v % 2) {
        v *= 2;
        imp = true;
      }
      if (even && v % 2 === 0) {
        v = Math.ceil(v / 2);
        imp = true;
      }
      return { v, imp };
    };
    const addLine = (k, f, pts) => {
      per[k] = { formula: f };
      turn += pts;
    };

    /* 汎用ロール */
    const simpleDie = (key, max) => {
      const raws = Array.from({ length: p.dice[key] }, () => roll(key));
      if (!raws.length) return;
      const adj = raws.map((x) => adjust(x, max));
      let pts = adj.reduce((a, b) => a + b.v, 0);
      if (col2x === key) pts *= 2;
      const vals = adj.map((o) => (o.imp ? wrapHL(o.v) : o.v));
      addLine(
        key,
        `${vals.join(" + ")} = ${col2x === key ? wrapHL(pts) : pts}点`,
        pts
      );
    };
    simpleDie("yellow", 6);
    simpleDie("green", 20);
    simpleDie("blue", 9);
    simpleDie("pink", 10);

    /* purple */
    if (p.dice.purple) {
      const raws = Array.from({ length: p.dice.purple }, () => roll("purple"));
      const adj = raws.map((x) => adjust(x, 6));
      let pts = adj.reduce((a, b) => a + b.v, 0) * 2;
      if (col2x === "purple") pts *= 2;
      const vals = adj.map((o) => (o.imp ? wrapHL(o.v) : o.v));
      addLine(
        "purple",
        `(${vals.join(" + ")}) ×2倍 = ${
          col2x === "purple" ? wrapHL(pts) : pts
        }点`,
        pts
      );
    }
    /* red */
    if (p.dice.red) {
      const raws = Array.from({ length: p.dice.red }, () => roll("red"));
      const signed = raws.map((v) => {
        const prob = gamble ? 0.75 : 0.33;
        return Math.random() < prob ? -v : v;
      });
      const adj = signed
        .map((x) => adjust(Math.abs(x), 6))
        .map((o, i) => {
          o.v = signed[i] < 0 ? -o.v : o.v;
          return o;
        });
      let pts = adj.reduce((a, b) => a + b.v, 0) * raws.length;
      if (col2x === "red") pts *= 2;
      const parts = adj
        .map((o) => {
          const txt = o.v >= 0 ? `+${Math.abs(o.v)}` : `${o.v}`;
          return o.imp ? wrapHL(txt) : txt;
        })
        .join(" ");
      addLine(
        "red",
        `(${parts}) × ${p.dice.red}個 = ${
          col2x === "red" ? wrapHL(pts) : pts
        }点`,
        pts
      );
    }
    /* gold (always 20) */
    if (p.dice.gold) {
      let pts = 20 * p.dice.gold;
      if (col2x === "gold") pts *= 2;
      addLine(
        "gold",
        `${p.dice.gold}個 × 20 = ${col2x === "gold" ? wrapHL(pts) : pts}点`,
        pts
      );
    }

    p.history[currentRound - 1] = turn;
    sock.emit("rolledMe", {
      round: currentRound,
      turnScore: turn,
      perType: per,
    });

    if (readyCnt === Object.keys(players).length) {
      io.emit("roundEnd", { players, currentRound });
      const tops = topIds(currentRound - 1);
      if (currentRound >= MAX_ROUNDS) {
        io.emit("gameEnd", {
          players: JSON.parse(JSON.stringify(players)),
          winners: tops.map((id) => players[id].name),
        });
        toLobby();
      } else {
        currentRound++;
        readyCnt = 0;
        Object.values(players).forEach((p) => {
          p.rolled = false;
          p.picked = false;
        });
        currentEvent = chooseEvent();
        io.emit("roundEvent", currentEvent);
        sendOffers(tops);
      }
    } else io.emit("state", players);
  });

  sock.on("disconnect", () => {
    delete players[sock.id];
    io.emit("state", players);
  });
});

/*───────── 共通関数 ────────*/
function toLobby() {
  gameStarted = false;
  currentRound = 0;
  readyCnt = 0;
  currentEvent = null;
  Object.values(players).forEach((p) => {
    p.dice = {
      yellow: 1,
      purple: 0,
      red: 0,
      green: 0,
      blue: 0,
      pink: 0,
      gold: 0,
    };
    p.history = Array(MAX_ROUNDS).fill("-");
    p.rolled = p.picked = false;
  });
}
function sendOffers(topIds) {
  const pool = ["yellow", "purple", "red", "green", "blue", "pink"];
  /* gold は 3 % で候補に入る */
  function randomDie() {
    return Math.random() < 0.03
      ? "gold"
      : pool[Math.floor(Math.random() * pool.length)];
  }
  const list3 = [randomDie(), randomDie(), randomDie()];
  for (const id in players) {
    const sock = io.sockets.sockets.get(id);
    if (!sock) continue;
    sock.emit(
      "offers",
      topIds.includes(id) ? [list3[Math.floor(Math.random() * 3)]] : list3
    );
  }
}

/*───────── 起動 ────────*/
const PORT = process.env.PORT || 3000;
http.listen(PORT, () =>
  console.log(`🐼 Panda Royal → http://localhost:${PORT}`)
);
