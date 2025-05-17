import { io } from "socket.io-client";
const socket = io();

/* ---------- 定義 ---------- */
const LABEL = {
  yellow: { name: "黄色（6面）", hex: "#ffd43b" },
  purple: { name: "紫色（2倍）", hex: "#b197fc" },
  red: { name: "赤色（リスキー）", hex: "#ff6b6b" },
  green: { name: "緑色（20面）", hex: "#8ce99a" },
  blue: { name: "青色（奇数9以下）", hex: "#74c0fc" },
  pink: { name: "桃色（偶数10以下）", hex: "#ff99c8" },
  gold: { name: "金色（20固定）", hex: "#ffd700" },
};

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

/* ---------- 効果説明 ---------- */
helpDiv.innerHTML = Object.values(LABEL)
  .map((d) => `<p><b>${d.name}：</b></p>`)
  .join("");

/* ---------- 状態 ---------- */
let currentRound = 0;

/* ---------- 初期可視 ---------- */
rollBtn.style.display = "none";
rematchBtn.style.display = "none";
offersCard.style.display = "none";
winnerH2.style.display = "none";

/* ---------- 名前登録 ---------- */
const myName = prompt("名前を入力してください")?.trim() || "名無し";
socket.emit("setName", myName);

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
  currentRound = 0;
  startBtn.disabled = false;
  rollBtn.style.display = "none";
  rematchBtn.style.display = "none";
  offersCard.style.display = "none";
  offersDiv.innerHTML = "";
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
    b.onclick = () => {
      socket.emit("pick", t);
      offersDiv.textContent = `(${LABEL[t].name} を取得)`;
      rollBtn.disabled = false;
    };
    offersDiv.appendChild(b);
  });
});

socket.on("rolledMe", ({ round, turnScore, perType }) => {
  currentRound = round;
  infoP.textContent = `ラウンド ${round}：+${turnScore}点`;
  rollBtn.disabled = true;

  // 直接 formula を信頼して HTML 表示
  detailDiv.innerHTML =
    "<h3>🎲 ダイス結果</h3>" +
    Object.entries(perType)
      .map(
        ([t, o]) => `
        <p>
          <b>${LABEL[t].name}：</b>
          ${o.formula}
        </p>
      `
      )
      .join("");
});

socket.on("roundEnd", ({ players, currentRound: rd }) => {
  currentRound = rd + 1;
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
  infoP.textContent = "ゲーム終了！「再戦！」で新ゲームを開始できます。";
  rollBtn.style.display = "none";
  offersCard.style.display = "none";
  rematchBtn.style.display = "inline-block";
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
      `<td>
        黄:${p.dice.yellow}  紫:${p.dice.purple}  赤:${p.dice.red}  緑:${p.dice.green}
        青:${p.dice.blue}  桃:${p.dice.pink}  金:${p.dice.gold}
      </td>`;
    tbody.appendChild(tr);
  });
}
