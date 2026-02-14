/**
 * パンダロイヤル – P2P版 メインエントリ
 * ホスト: ゲームロジック実行 + P2P通信管理
 * ゲスト: UI表示 + 入力送信のみ
 */
import { HostNetwork, GuestNetwork } from "./network.js";
import { GameState, MAX_ROUNDS, COL_LABEL, COL_HEX } from "./gameLogic.js";

/* ---------- ダイスUI定義 ---------- */
const LABEL = {
  yellow: { name: "黄色（6面）", effect: "出目の合計が得点", hex: "#ffd43b" },
  purple: {
    name: "紫色（2倍）",
    effect: "出目の合計 ×2倍 が得点",
    hex: "#b197fc",
  },
  red: {
    name: "赤色（リスキー）",
    effect: "1/3 でマイナス。±合計 ×個数 が得点",
    hex: "#ff6b6b",
  },
  green: { name: "緑色（20面）", effect: "出目の合計が得点", hex: "#8ce99a" },
  blue: {
    name: "青色（奇数9以下）",
    effect: "1,3,5,7,9 のみ出る",
    hex: "#74c0fc",
  },
  pink: {
    name: "桃色（偶数10以下）",
    effect: "2,4,6,8,10 のみ出る",
    hex: "#ff99c8",
  },
  gold: {
    name: "金色（20固定）",
    effect: "常に 20、入手確率 3 %",
    hex: "#ffd700",
  },
};
const EVENT_DESC = [
  { name: "オッドブースト", desc: "奇数出目が 2 倍！" },
  { name: "イーブンブレイク", desc: "偶数出目が 半分！" },
  { name: "カラーフォーカス", desc: "選ばれた色のダイス効果が 2 倍！" },
  { name: "パンダフィーバー", desc: "全ダイス +2 (上限まで)" },
  { name: "ギャンブルタイム", desc: "赤ダイスのマイナス確率 75 %！" },
];

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);

// Scenes
const sceneLobby = $("sceneLobby");
const sceneHostWait = $("sceneHostWait");
const sceneGuestJoin = $("sceneGuestJoin");
const sceneGame = $("sceneGame");

// Lobby
const nameInput = $("nameInput");
const hostBtn = $("hostBtn");
const joinBtn = $("joinBtn");

// Host wait
const roomCodeDisplay = $("roomCodeDisplay");
const playerList = $("playerList");
const startBtn = $("startBtn");

// Guest join
const codeInput = $("codeInput");
const connectBtn = $("connectBtn");
const connectStatus = $("connectStatus");
const backBtn = $("backBtn");

// Game
const rollBtn = $("rollBtn");
const resetBtn = $("resetBtn");
const rematchBtn = $("rematchBtn");
const winnerH2 = $("winner");
const offersCard = $("offersCard");
const offersDiv = $("offers");
const waitingP = $("waiting");
const infoP = $("info");
const detailDiv = $("detail");
const tbody = $("scoreBody");
const helpDiv = $("diceHelp");
const eventList = $("eventList");
const banner = $("eventBanner");
const disconnectOverlay = $("disconnectOverlay");

/* ---------- State ---------- */
let mode = null; // 'host' | 'guest'
let myName = "";
let myPeerId = "";
let hostNet = null;
let guestNet = null;
let game = null; // GameState (host only)

// ホストのピアID (ホスト自身を players に入れるために使用)
const HOST_LOCAL_ID = "__host__";

/* ---------- シーン切替 ---------- */
function showScene(scene) {
  [sceneLobby, sceneHostWait, sceneGuestJoin, sceneGame].forEach((s) =>
    s.classList.remove("active"),
  );
  scene.classList.add("active");
}

/* ---------- 初期表示 ---------- */
helpDiv.innerHTML = Object.values(LABEL)
  .map((d) => `<p><b>${d.name}：</b>${d.effect}</p>`)
  .join("");
eventList.innerHTML = EVENT_DESC.map(
  (e) => `<li><b>${e.name}：</b>${e.desc}</li>`,
).join("");

/* ---------- 名前バリデーション ---------- */
function getName() {
  const n = nameInput.value.trim();
  if (!n) {
    nameInput.focus();
    nameInput.style.borderColor = "#fa5252";
    setTimeout(() => (nameInput.style.borderColor = ""), 1500);
    return null;
  }
  return n;
}

/* =============================================
   ホストモード
   ============================================= */
hostBtn.onclick = async () => {
  const name = getName();
  if (!name) return;
  myName = name;
  mode = "host";
  hostBtn.disabled = true;

  hostNet = new HostNetwork();
  game = new GameState();

  try {
    const code = await hostNet.start();
    roomCodeDisplay.textContent = code;
    showScene(sceneHostWait);

    // ホスト自身をプレイヤーに追加
    game.addPlayer(HOST_LOCAL_ID, myName);
    updatePlayerList();

    // ゲスト接続ハンドラ
    hostNet.onPlayerConnect = (peerId) => {
      // 名前はまだ来ていない → setNameを待つ
    };
    hostNet.onPlayerDisconnect = (peerId) => {
      game.removePlayer(peerId);
      updatePlayerList();
      hostNet.broadcast("state", game.serialize());
    };

    // メッセージハンドラ登録
    hostNet.on("setName", (peerId, name) => {
      if (game.addPlayer(peerId, name)) {
        updatePlayerList();
        hostNet.broadcast("state", game.serialize());
      } else {
        hostNet.sendTo(peerId, "joinDenied", null);
      }
    });

    hostNet.on("roll", (peerId) => {
      hostHandleRoll(peerId);
    });

    hostNet.on("pick", (peerId, col) => {
      if (game.pickDie(peerId, col)) {
        hostNet.broadcast("state", game.serialize());
      }
    });

    hostNet.on("resetGame", () => {
      hostResetGame();
    });
  } catch (err) {
    alert("ホスト開始に失敗しました: " + err.message);
    hostBtn.disabled = false;
  }
};

function updatePlayerList() {
  playerList.innerHTML = "";
  for (const [id, p] of Object.entries(game.players)) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="status-dot connected"></span>${p.name}${id === HOST_LOCAL_ID ? " (ホスト)" : ""}`;
    playerList.appendChild(li);
  }
  startBtn.disabled = Object.keys(game.players).length < 2;
}

startBtn.onclick = () => {
  if (!game.startGame()) return;
  game.currentEvent = null;

  const state = game.serialize();
  hostNet.broadcast("state", state);
  hostNet.broadcast("roundEvent", null);
  hostNet.broadcast("gameStarted", true);

  // ホスト自身もゲーム画面へ
  showScene(sceneGame);
  rollBtn.classList.remove("hidden");
  rollBtn.disabled = false;
  drawFromState(state);
  showEventBanner(null);
};

/* ホスト: ロール処理 */
function hostHandleRoll(peerId) {
  const result = game.rollDice(peerId);
  if (!result) return;

  // ロールした本人に結果送信
  const rollData = {
    round: game.currentRound,
    turnScore: result.turnScore,
    perType: result.perType,
  };

  if (peerId === HOST_LOCAL_ID) {
    onMyRollResult(rollData);
  } else {
    hostNet.sendTo(peerId, "rolledMe", rollData);
  }

  // 全員に状態更新
  hostNet.broadcast("state", game.serialize());

  // ラウンド完了チェック
  const roundResult = game.checkRoundComplete();
  if (roundResult) {
    if (roundResult.type === "gameEnd") {
      hostNet.broadcast("gameEnd", {
        players: roundResult.players,
        winners: roundResult.winners,
      });
      onGameEnd(roundResult.players, roundResult.winners);
      game.resetGame();
    } else {
      // roundEnd
      hostNet.broadcast("roundEnd", {
        players: roundResult.players,
        currentRound: roundResult.currentRound,
      });
      onRoundEnd(roundResult.players, roundResult.currentRound);

      // オファー送信
      for (const [pid, offers] of Object.entries(roundResult.offersMap)) {
        if (pid === HOST_LOCAL_ID) {
          onOffers(offers);
        } else {
          hostNet.sendTo(pid, "offers", offers);
        }
      }

      // イベント通知
      hostNet.broadcast("roundEvent", roundResult.currentEvent);
      showEventBanner(roundResult.currentEvent);

      // 新状態送信
      hostNet.broadcast("state", game.serialize());
    }
  }
}

/* ホスト: リセット */
function hostResetGame() {
  game.resetGame();
  hostNet.broadcast("resetDone", null);
  hostNet.broadcast("state", game.serialize());

  // ホスト自身のUI
  onResetDone();
}

/* ホスト: ロールボタン */
function hostRoll() {
  hostHandleRoll(HOST_LOCAL_ID);
}

/* ホスト: ピック */
function hostPick(col) {
  if (game.pickDie(HOST_LOCAL_ID, col)) {
    hostNet.broadcast("state", game.serialize());
    rollBtn.disabled = false;
  }
}

/* =============================================
   ゲストモード
   ============================================= */
joinBtn.onclick = () => {
  const name = getName();
  if (!name) return;
  myName = name;
  mode = "guest";
  showScene(sceneGuestJoin);
  codeInput.focus();
};

backBtn.onclick = () => {
  showScene(sceneLobby);
  mode = null;
};

connectBtn.onclick = async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length < 4) {
    codeInput.style.borderColor = "#fa5252";
    setTimeout(() => (codeInput.style.borderColor = ""), 1500);
    return;
  }
  connectBtn.disabled = true;
  connectStatus.textContent = "接続中…";

  guestNet = new GuestNetwork();

  try {
    myPeerId = await guestNet.connect(code);

    // 名前送信
    guestNet.send("setName", myName);

    // ハンドラ登録
    guestNet.on("joinDenied", () => {
      alert("ゲーム進行中のため参加できません");
      guestNet.destroy();
      showScene(sceneLobby);
    });

    guestNet.on("state", (state) => {
      drawFromState(state);
    });

    guestNet.on("gameStarted", () => {
      showScene(sceneGame);
      rollBtn.classList.remove("hidden");
      rollBtn.disabled = false;
    });

    guestNet.on("roundEvent", (ev) => {
      showEventBanner(ev);
    });

    guestNet.on("rolledMe", (data) => {
      onMyRollResult(data);
    });

    guestNet.on("offers", (list) => {
      onOffers(list);
    });

    guestNet.on("roundEnd", ({ players, currentRound }) => {
      onRoundEnd(players, currentRound);
    });

    guestNet.on("gameEnd", ({ players, winners }) => {
      onGameEnd(players, winners);
    });

    guestNet.on("resetDone", () => {
      onResetDone();
    });

    guestNet.onDisconnect = () => {
      disconnectOverlay.classList.remove("hidden");
      disconnectOverlay.style.display = "flex";
    };

    // 接続成功 → ホスト待機画面で待つ (ゲーム開始はホストが行う)
    connectStatus.textContent =
      "✅ 接続完了！ ホストのゲーム開始を待っています…";
    connectBtn.disabled = false;

    // ゲスト待機 → ゲーム開始でsceneGameに切り替わる
  } catch (err) {
    connectStatus.textContent = "❌ 接続失敗: " + err.message;
    connectBtn.disabled = false;
    if (guestNet) {
      guestNet.destroy();
      guestNet = null;
    }
  }
};

/* =============================================
   共通UI ハンドラ (ホスト/ゲスト両方で使用)
   ============================================= */

rollBtn.onclick = () => {
  if (mode === "host") {
    hostRoll();
  } else {
    guestNet.send("roll", null);
  }
};

resetBtn.onclick = () => {
  if (mode === "host") {
    hostResetGame();
  } else {
    guestNet.send("resetGame", null);
  }
};

rematchBtn.onclick = () => {
  if (mode === "host") {
    hostResetGame();
  } else {
    guestNet.send("resetGame", null);
  }
  rollBtn.disabled = false;
};

/* ---------- イベントバナー ---------- */
function showEventBanner(ev) {
  if (ev) {
    banner.textContent = `EVENT: ${ev.name} – ${ev.desc}`;
    banner.style.background = ev.color || "#d32f2f";
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

/* ---------- ロール結果受信 ---------- */
function onMyRollResult({ round, turnScore, perType }) {
  rollBtn.disabled = true;
  infoP.textContent = `ラウンド ${round}：+${turnScore}点`;
  detailDiv.innerHTML =
    "<h3>🎲 ダイス結果</h3>" +
    Object.entries(perType)
      .map(([t, o]) => `<p><b>${LABEL[t].name}：</b>${o.formula}</p>`)
      .join("");
}

/* ---------- オファー受信 ---------- */
function onOffers(list) {
  offersCard.classList.remove("hidden");
  offersDiv.innerHTML = "";
  rollBtn.disabled = true;

  list.forEach((t) => {
    const b = document.createElement("button");
    b.textContent = LABEL[t].name;
    b.classList.add("offer-btn", `offer-${t}`);
    b.style.background = LABEL[t].hex;

    if (t === "gold") {
      b.style.position = "relative";
      for (let i = 0; i < 6; i++) {
        const star = document.createElement("span");
        star.classList.add("star");
        star.textContent = "✦";
        star.style.left = `${Math.random() * 80 + 10}%`;
        star.style.top = `${Math.random() * 80 + 10}%`;
        star.style.animationDelay = `${Math.random() * 1.5}s`;
        b.appendChild(star);
      }
    }

    b.onclick = () => {
      if (mode === "host") {
        hostPick(t);
      } else {
        guestNet.send("pick", t);
      }
      offersDiv.textContent = `(${LABEL[t].name} を取得)`;
      rollBtn.disabled = false;
    };
    offersDiv.appendChild(b);
  });
}

/* ---------- ラウンド終了 ---------- */
function onRoundEnd(players, currentRound) {
  infoP.textContent = `ラウンド ${currentRound} 終了！`;
  rollBtn.disabled = true;
  drawPlayers(players);
}

/* ---------- ゲーム終了 ---------- */
function onGameEnd(players, winners) {
  drawPlayers(players);
  winnerH2.textContent =
    winners.length > 1
      ? `同点優勝: ${winners.join(" / ")}`
      : `優勝: ${winners[0]}`;
  winnerH2.classList.remove("hidden");
  rollBtn.classList.add("hidden");
  offersCard.classList.add("hidden");
  rematchBtn.classList.remove("hidden");
  infoP.textContent = "ゲーム終了！「再戦！」で新ゲームを開始できます。";
}

/* ---------- リセット ---------- */
function onResetDone() {
  rollBtn.classList.remove("hidden");
  rollBtn.disabled = false;
  rematchBtn.classList.add("hidden");
  offersCard.classList.add("hidden");
  banner.classList.add("hidden");
  winnerH2.classList.add("hidden");
  detailDiv.innerHTML = "<h3>🎲 ダイス結果</h3><p>—</p>";
  infoP.textContent = "";
  waitingP.textContent = "";
}

/* ---------- 状態からUI更新 ---------- */
function drawFromState(state) {
  if (state.players) drawPlayers(state.players);
}

/* ---------- スコアボード描画 ---------- */
function drawPlayers(players) {
  tbody.innerHTML = "";
  const waitingCount = Object.values(players).filter((p) => !p.rolled).length;
  waitingP.textContent = waitingCount
    ? `🕒 他 ${waitingCount} 人のロール待ち…`
    : "";

  Object.values(players).forEach((p) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<th>${p.name}</th>` +
      p.history.map((s) => `<td>${s}</td>`).join("") +
      `<td>黄:${p.dice.yellow} 紫:${p.dice.purple} 赤:${p.dice.red} 緑:${p.dice.green} 青:${p.dice.blue} 桃:${p.dice.pink} 金:${p.dice.gold}</td>`;
    tbody.appendChild(tr);
  });
}
