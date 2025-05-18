const os = require("os");
const path = require("path");
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { roll } = require("./util/dice.js");

// 最大ラウンド数
const MAX_ROUNDS = 10;

// ダイス色ラベル＆色コード
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

// ランダムイベント定義
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

// Express + Socket.IO 初期化
const app = express();
const http = createServer(app);
const io = new Server(http);
app.use(express.static(path.join(__dirname, "../dist")));

// ゲーム状態
let currentRound = 0;
let readyCnt = 0;
let gameStarted = false;
let currentEvent = null;
const players = {};

// ネットワークインターフェイスからローカルIPを取得
function getLocalExternalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

// ラウンドイベント抽選 (1/2)
function chooseEvent() {
  if (Math.random() >= 0.5) return null;
  const base = EVENTS[Math.floor(Math.random() * EVENTS.length)];
  if (!base.pickColor) return { ...base };
  const keys = Object.keys(COL_LABEL);
  const col = keys[Math.floor(Math.random() * keys.length)];
  return {
    ...base,
    colour: col,
    desc: base.desc(col),
    color: base.colorFrom(col),
  };
}

// ラウンド最上位ID取得
function topIds(idx) {
  const arr = Object.entries(players).map(([id, p]) => ({
    id,
    sc: p.history[idx],
  }));
  const max = Math.max(...arr.map((o) => o.sc));
  return arr.filter((o) => o.sc === max).map((o) => o.id);
}

// 新ラウンド／オファー送信
function sendOffers(topIdsList) {
  const pool = ["yellow", "purple", "red", "green", "blue", "pink"];
  function randomDie() {
    return Math.random() < 0.03
      ? "gold"
      : pool[Math.floor(Math.random() * pool.length)];
  }
  const list3 = [randomDie(), randomDie(), randomDie()];
  for (const id in players) {
    const sock = io.sockets.sockets.get(id);
    if (!sock) continue;
    const offers = topIdsList.includes(id)
      ? [list3[Math.floor(Math.random() * 3)]]
      : list3;
    sock.emit("offers", offers);
  }
}

// ロビーリセット
function toLobby() {
  gameStarted = false;
  currentRound = 0;
  readyCnt = 0;
  currentEvent = null;
  for (const p of Object.values(players)) {
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
  }
}

// Socket.IO ハンドラ
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
    let turnScore = 0;
    const perType = {};
    const ev = currentEvent;
    const odd = ev && ev.key === "oddBoost";
    const even = ev && ev.key === "evenBreak";
    const fever = ev && ev.key === "fever";
    const gamble = ev && ev.key === "gambleTime";
    const c2x = ev && ev.key === "colourFocus" ? ev.colour : null;

    // 調整関数
    function adjust(v, max) {
      let imp = false;
      let orig = v;
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
    }
    function wrapHL(x) {
      return `<b style=\"color:#d32f2f;\">${x}</b>`;
    }
    function addLine(key, formula, pts) {
      perType[key] = { formula };
      turnScore += pts;
    }

    // 各色ダイス処理
    [
      ["yellow", 6],
      ["green", 20],
      ["blue", 9],
      ["pink", 10],
    ].forEach(([t, m]) => {
      const arr = Array.from({ length: p.dice[t] }, () => roll(t));
      if (!arr.length) return;
      const adj = arr.map((x) => adjust(x, m));
      let pts = adj.reduce((a, b) => a + b.v, 0);
      if (c2x === t) pts *= 2;
      const vals = adj.map((o) => (o.imp ? wrapHL(o.v) : o.v));
      addLine(
        t,
        `${vals.join(" + ")} = ${c2x === t ? wrapHL(pts) : pts}点`,
        pts
      );
    });
    // purple
    if (p.dice.purple) {
      const arr = Array.from({ length: p.dice.purple }, () => roll("purple"));
      const adj = arr.map((x) => adjust(x, 6));
      let pts = adj.reduce((a, b) => a + b.v, 0) * 2;
      if (c2x === "purple") pts *= 2;
      const vals = adj.map((o) => (o.imp ? wrapHL(o.v) : o.v));
      addLine(
        "purple",
        `(${vals.join(" + ")}) ×2倍 = ${
          c2x === "purple" ? wrapHL(pts) : pts
        }点`,
        pts
      );
    }
    // red
    if (p.dice.red) {
      const arr = Array.from({ length: p.dice.red }, () => roll("red"));
      const signed = arr.map((v) =>
        Math.random() < (gamble ? 0.75 : 0.33) ? -v : v
      );
      const adj = signed
        .map((x) => adjust(Math.abs(x), 6))
        .map((o, i) => {
          o.v = signed[i] < 0 ? -o.v : o.v;
          return o;
        });
      let pts = adj.reduce((a, b) => a + b.v, 0) * arr.length;
      if (c2x === "red") pts *= 2;
      const parts = adj.map((o) =>
        o.imp ? wrapHL(o.v >= 0 ? `+${o.v}` : o.v) : o.v >= 0 ? `+${o.v}` : o.v
      );
      addLine(
        "red",
        `(${parts.join(" ")}) × ${arr.length}個 = ${
          c2x === "red" ? wrapHL(pts) : pts
        }点`,
        pts
      );
    }
    // gold
    if (p.dice.gold) {
      let pts = 20 * p.dice.gold;
      if (c2x === "gold") pts *= 2;
      addLine(
        "gold",
        `${p.dice.gold}個 × 20 = ${c2x === "gold" ? wrapHL(pts) : pts}点`,
        pts
      );
    }

    p.history[currentRound - 1] = turnScore;
    sock.emit("rolledMe", { round: currentRound, turnScore, perType });

    // ラウンド完了判定
    if (readyCnt === Object.keys(players).length) {
      io.emit("roundEnd", { players, currentRound });
      const tops = topIds(currentRound - 1);
      if (currentRound >= MAX_ROUNDS) {
        const winners = tops.map((id) => players[id].name);
        io.emit("gameEnd", {
          players: JSON.parse(JSON.stringify(players)),
          winners,
        });
        toLobby();
      } else {
        currentRound++;
        readyCnt = 0;
        Object.values(players).forEach((p) => {
          p.rolled = p.picked = false;
        });
        currentEvent = chooseEvent();
        io.emit("roundEvent", currentEvent);
        sendOffers(tops);
      }
    } else {
      io.emit("state", players);
    }
  });

  sock.on("disconnect", () => {
    delete players[sock.id];
    io.emit("state", players);
  });
});

// サーバ起動
const PORT = process.env.PORT || 3000;
const HOST = getLocalExternalIp();
http.listen(PORT, () => console.log(`🐼 Panda Royal → http://${HOST}:${PORT}`));
