/**
 * ゲームロジック (server/server.js から移植)
 * ホスト端末上で実行される
 */
import { roll } from "./util/dice.js";

export const MAX_ROUNDS = 10;

// ダイス色ラベル＆色コード
export const COL_LABEL = {
  yellow: "黄色",
  purple: "紫色",
  red: "赤色",
  green: "緑色",
  blue: "青色",
  pink: "桃色",
  gold: "金色",
};
export const COL_HEX = {
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
    desc: null, // 動的生成
    pickColor: true,
  },
];

/* ---------- ゲーム状態クラス ---------- */
export class GameState {
  constructor() {
    this.players = {}; // { peerId: { name, dice, history, rolled, picked } }
    this.currentRound = 0;
    this.readyCnt = 0;
    this.gameStarted = false;
    this.currentEvent = null;
  }

  /* プレイヤー追加 */
  addPlayer(peerId, name) {
    if (this.gameStarted) return false;
    this.players[peerId] = {
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
    return true;
  }

  /* プレイヤー削除 */
  removePlayer(peerId) {
    delete this.players[peerId];
  }

  /* ゲーム開始 */
  startGame() {
    if (this.gameStarted || !Object.keys(this.players).length) return false;
    this.gameStarted = true;
    this.currentRound = 1;
    this.currentEvent = null;
    return true;
  }

  /* ロビーリセット */
  resetGame() {
    this.gameStarted = false;
    this.currentRound = 0;
    this.readyCnt = 0;
    this.currentEvent = null;
    for (const p of Object.values(this.players)) {
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

  /* ダイス選択 */
  pickDie(peerId, col) {
    const p = this.players[peerId];
    if (p && !p.picked) {
      p.dice[col]++;
      p.picked = true;
      return true;
    }
    return false;
  }

  /* ラウンドイベント抽選 (50%) */
  chooseEvent() {
    if (Math.random() >= 0.5) return null;
    const base = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    if (!base.pickColor) return { ...base };
    const keys = Object.keys(COL_LABEL);
    const col = keys[Math.floor(Math.random() * keys.length)];
    return {
      ...base,
      colour: col,
      desc: `${COL_LABEL[col]} が 2 倍！`,
      color: COL_HEX[col],
    };
  }

  /* ラウンド最上位ID一覧 */
  topIds(roundIdx) {
    const arr = Object.entries(this.players).map(([id, p]) => ({
      id,
      sc: p.history[roundIdx],
    }));
    const max = Math.max(...arr.map((o) => o.sc));
    return arr.filter((o) => o.sc === max).map((o) => o.id);
  }

  /* オファー生成 */
  generateOffers(topIdsList) {
    const pool = ["yellow", "purple", "red", "green", "blue", "pink"];
    function randomDie() {
      return Math.random() < 0.03
        ? "gold"
        : pool[Math.floor(Math.random() * pool.length)];
    }
    const list3 = [randomDie(), randomDie(), randomDie()];
    const offersMap = {}; // { peerId: [colors] }
    for (const id in this.players) {
      offersMap[id] = topIdsList.includes(id)
        ? [list3[Math.floor(Math.random() * 3)]]
        : [...list3];
    }
    return offersMap;
  }

  /* ダイスロール処理 → { turnScore, perType } */
  rollDice(peerId) {
    const p = this.players[peerId];
    if (!this.gameStarted || !p || p.rolled) return null;
    if (this.currentRound > 1 && !p.picked) return null;

    p.rolled = true;
    this.readyCnt++;

    let turnScore = 0;
    const perType = {};
    const ev = this.currentEvent;
    const odd = ev && ev.key === "oddBoost";
    const even = ev && ev.key === "evenBreak";
    const fever = ev && ev.key === "fever";
    const gamble = ev && ev.key === "gambleTime";
    const c2x = ev && ev.key === "colourFocus" ? ev.colour : null;

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
      return `<b style="color:#d32f2f;">${x}</b>`;
    }
    function addLine(key, formula, pts) {
      perType[key] = { formula };
      turnScore += pts;
    }

    // 黄, 緑, 青, 桃
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
        pts,
      );
    });

    // 紫
    if (p.dice.purple) {
      const arr = Array.from({ length: p.dice.purple }, () => roll("purple"));
      const adj = arr.map((x) => adjust(x, 6));
      let pts = adj.reduce((a, b) => a + b.v, 0) * 2;
      if (c2x === "purple") pts *= 2;
      const vals = adj.map((o) => (o.imp ? wrapHL(o.v) : o.v));
      addLine(
        "purple",
        `(${vals.join(" + ")}) ×2倍 = ${c2x === "purple" ? wrapHL(pts) : pts}点`,
        pts,
      );
    }

    // 赤
    if (p.dice.red) {
      const arr = Array.from({ length: p.dice.red }, () => roll("red"));
      const signed = arr.map((v) =>
        Math.random() < (gamble ? 0.75 : 0.33) ? -v : v,
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
        o.imp ? wrapHL(o.v >= 0 ? `+${o.v}` : o.v) : o.v >= 0 ? `+${o.v}` : o.v,
      );
      addLine(
        "red",
        `(${parts.join(" ")}) × ${arr.length}個 = ${c2x === "red" ? wrapHL(pts) : pts}点`,
        pts,
      );
    }

    // 金
    if (p.dice.gold) {
      let pts = 20 * p.dice.gold;
      if (c2x === "gold") pts *= 2;
      addLine(
        "gold",
        `${p.dice.gold}個 × 20 = ${c2x === "gold" ? wrapHL(pts) : pts}点`,
        pts,
      );
    }

    p.history[this.currentRound - 1] = turnScore;
    return { turnScore, perType };
  }

  /* ラウンド完了チェック → 結果を返す */
  checkRoundComplete() {
    const total = Object.keys(this.players).length;
    if (this.readyCnt < total) return null;

    // ラウンド完了
    const tops = this.topIds(this.currentRound - 1);

    if (this.currentRound >= MAX_ROUNDS) {
      // ゲーム終了 → 総合得点で勝者決定
      const totals = Object.entries(this.players).map(([id, p]) => ({
        id,
        total: p.history.reduce(
          (a, b) => a + (typeof b === "number" ? b : 0),
          0,
        ),
      }));
      const maxTotal = Math.max(...totals.map((o) => o.total));
      const winnerIds = totals
        .filter((o) => o.total === maxTotal)
        .map((o) => o.id);
      const winners = winnerIds.map((id) => this.players[id].name);
      return {
        type: "gameEnd",
        winners,
        players: JSON.parse(JSON.stringify(this.players)),
      };
    }

    // 次ラウンドへ
    const offersMap = this.generateOffers(tops);
    this.currentRound++;
    this.readyCnt = 0;
    Object.values(this.players).forEach((p) => {
      p.rolled = p.picked = false;
    });
    this.currentEvent = this.chooseEvent();
    return {
      type: "roundEnd",
      offersMap,
      currentEvent: this.currentEvent,
      players: JSON.parse(JSON.stringify(this.players)),
      currentRound: this.currentRound - 1, // 終了したラウンド番号
    };
  }

  /* シリアライズ (ネットワーク送信用) */
  serialize() {
    return {
      players: JSON.parse(JSON.stringify(this.players)),
      currentRound: this.currentRound,
      gameStarted: this.gameStarted,
      currentEvent: this.currentEvent,
    };
  }
}
