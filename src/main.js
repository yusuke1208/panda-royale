import { io } from "socket.io-client";
const socket = io();

/* ---------- 定義 ---------- */
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

/* ---------- イベント一覧 (クライアント用) ---------- */
const EVENTS = [
  { name: "オッドブースト", desc: "奇数出目が 2 倍！" },
  { name: "イーブンブレイク", desc: "偶数出目が 半分！" },
  { name: "カラーフォーカス", desc: "選ばれた色のダイス効果が 2 倍！" },
  { name: "パンダフィーバー", desc: "全ダイス +2 (上限まで)" },
  { name: "ギャンブルタイム", desc: "赤ダイスのマイナス確率 75 %！" },
];

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const startBtn = $("startBtn");
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

let banner = $("eventBanner");
if (!banner) {
  banner = document.createElement("p");
  banner.id = "eventBanner";
  banner.style.cssText = `
    margin:8px 0;
    padding:8px 12px;
    font-weight:700;
    font-size:1.1rem;
    color:#fff;
    border-radius:8px;
    text-align:center;
    display:none;
  `;
  infoP.after(banner);
}

/* ---------- 初期表示 ---------- */
rollBtn.style.display = "none";
rematchBtn.style.display = "none";
offersCard.style.display = "none";
winnerH2.style.display = "none";

/* ---------- 名前登録 ---------- */
const myName = prompt("名前を入力してください")?.trim() || "名無し";
socket.emit("setName", myName);

/* ---------- ダイス効果表示 ---------- */
helpDiv.innerHTML = Object.values(LABEL)
  .map((d) => `<p><b>${d.name}：</b>${d.effect}</p>`)
  .join("");

/* ---------- イベント一覧表示 ---------- */
eventList.innerHTML = EVENTS.map(
  (e) => `<li><b>${e.name}：</b>${e.desc}</li>`
).join("");

/* ---------- ボタンハンドラ ---------- */
startBtn.onclick = () => {
  socket.emit("startGame");
  startBtn.disabled = true;
  rollBtn.style.display = "inline-block";
  rollBtn.disabled = false;
};
rollBtn.onclick = () => socket.emit("roll");
resetBtn.onclick = () => socket.emit("resetGame");
rematchBtn.onclick = () => {
  socket.emit("resetGame");
  rollBtn.disabled = false;
};

/* ---------- サーバーイベント ---------- */
socket.on("resetDone", () => {
  startBtn.disabled = false;
  rollBtn.style.display = "none";
  rematchBtn.style.display = "none";
  offersCard.style.display = "none";
  banner.style.display = "none";
  winnerH2.style.display = "none";
  detailDiv.innerHTML = "<h3>🎲 ダイス結果</h3><p>—</p>";
});

socket.on("roundEvent", (ev) => {
  if (ev) {
    banner.textContent = `EVENT: ${ev.name} – ${ev.desc}`;
    banner.style.background = ev.color || "#d32f2f";
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }
});

socket.on("state", (players) => draw(players));

socket.on("offers", (list) => {
  offersCard.style.display = "block";
  offersDiv.innerHTML = "";
  rollBtn.disabled = true;

  list.forEach((t) => {
    const b = document.createElement("button");
    b.textContent = LABEL[t].name;
    b.classList.add("offer-btn", `offer-${t}`);
    b.style.background = LABEL[t].hex;

    // ゴールドダイスは複数星をランダム配置
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
      socket.emit("pick", t);
      offersDiv.textContent = `(${LABEL[t].name} を取得)`;
      rollBtn.disabled = false;
    };
    offersDiv.appendChild(b);
  });
});

socket.on("rolledMe", ({ round, turnScore, perType }) => {
  rollBtn.disabled = true;
  infoP.textContent = `ラウンド ${round}：+${turnScore}点`;

  detailDiv.innerHTML =
    "<h3>🎲 ダイス結果</h3>" +
    Object.entries(perType)
      .map(([t, o]) => `<p><b>${LABEL[t].name}：</b>${o.formula}</p>`)
      .join("");
});

socket.on("roundEnd", ({ players, currentRound: rd }) => {
  infoP.textContent = `ラウンド ${rd} 終了！`;
  rollBtn.disabled = true;
  draw(players);
});

socket.on("gameEnd", ({ players, winners }) => {
  draw(players);
  winnerH2.textContent =
    winners.length > 1
      ? `同点優勝: ${winners.join(" / ")}`
      : `優勝: ${winners[0]}`;
  winnerH2.style.display = "block";
  rollBtn.style.display = "none";
  offersCard.style.display = "none";
  rematchBtn.style.display = "inline-block";
  infoP.textContent = "ゲーム終了！「再戦！」で新ゲームを開始できます。";
});

/* ---------- 描画ヘルパー ---------- */
function draw(players) {
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
