/**
 * P2P通信レイヤー (PeerJS WebRTC DataChannel)
 * ホスト-ゲスト方式
 *
 * ホスト: PeerJSインスタンスを作成 → 短縮ルームコード表示 → 接続待ち受け
 * ゲスト: ルームコード入力 → PeerJS経由でホストに接続
 */
import { Peer } from "peerjs";

// ルームコードのプレフィックス (衝突防止)
const PREFIX = "panda-royale-";

/**
 * ランダム4桁コードを生成
 */
function generateCode() {
  // 数字のみ4桁 (1000-9999)
  return String(1000 + Math.floor(Math.random() * 9000));
}

/* ========================================
   ホスト側ネットワーク
   ======================================== */
export class HostNetwork {
  constructor() {
    this.peer = null;
    this.connections = new Map(); // peerId → DataConnection
    this.handlers = new Map(); // type → callback
    this.roomCode = "";
    this.onPlayerConnect = null; // (peerId) => void
    this.onPlayerDisconnect = null; // (peerId) => void
  }

  /**
   * ホスト開始 → ルームコードを返す (Promise)
   */
  start() {
    return new Promise((resolve, reject) => {
      this.roomCode = generateCode();
      const fullId = PREFIX + this.roomCode;

      this.peer = new Peer(fullId, {
        debug: 0,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        },
      });

      this.peer.on("open", () => {
        resolve(this.roomCode);
      });

      this.peer.on("error", (err) => {
        if (err.type === "unavailable-id") {
          // コード衝突 → リトライ
          this.peer.destroy();
          this.roomCode = generateCode();
          this.start().then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });

      this.peer.on("connection", (conn) => {
        conn.on("open", () => {
          this.connections.set(conn.peer, conn);
          if (this.onPlayerConnect) this.onPlayerConnect(conn.peer);
        });

        conn.on("data", (data) => {
          const { type, payload } = data;
          const handler = this.handlers.get(type);
          if (handler) handler(conn.peer, payload);
        });

        conn.on("close", () => {
          this.connections.delete(conn.peer);
          if (this.onPlayerDisconnect) this.onPlayerDisconnect(conn.peer);
        });

        conn.on("error", () => {
          this.connections.delete(conn.peer);
          if (this.onPlayerDisconnect) this.onPlayerDisconnect(conn.peer);
        });
      });
    });
  }

  /**
   * メッセージハンドラ登録
   */
  on(type, callback) {
    this.handlers.set(type, callback);
  }

  /**
   * 特定ピアに送信
   */
  sendTo(peerId, type, payload) {
    const conn = this.connections.get(peerId);
    if (conn && conn.open) {
      conn.send({ type, payload });
    }
  }

  /**
   * 全ゲストにブロードキャスト
   */
  broadcast(type, payload) {
    for (const conn of this.connections.values()) {
      if (conn.open) {
        conn.send({ type, payload });
      }
    }
  }

  /**
   * 接続中のピアID一覧
   */
  connectedPeers() {
    return Array.from(this.connections.keys());
  }

  /**
   * 破棄
   */
  destroy() {
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.connections.clear();
  }
}

/* ========================================
   ゲスト側ネットワーク
   ======================================== */
export class GuestNetwork {
  constructor() {
    this.peer = null;
    this.connection = null;
    this.handlers = new Map();
    this.myPeerId = "";
    this.onDisconnect = null;
  }

  /**
   * ホストに接続 → 自分のpeerIdを返す (Promise)
   */
  connect(roomCode) {
    return new Promise((resolve, reject) => {
      const hostId = PREFIX + roomCode.trim();

      this.peer = new Peer(undefined, {
        debug: 0,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        },
      });

      this.peer.on("open", (id) => {
        this.myPeerId = id;
        const conn = this.peer.connect(hostId, { reliable: true });

        conn.on("open", () => {
          this.connection = conn;
          resolve(this.myPeerId);
        });

        conn.on("data", (data) => {
          const { type, payload } = data;
          const handler = this.handlers.get(type);
          if (handler) handler(payload);
        });

        conn.on("close", () => {
          if (this.onDisconnect) this.onDisconnect();
        });

        conn.on("error", (err) => {
          reject(err);
        });

        // 接続タイムアウト (10秒)
        setTimeout(() => {
          if (!this.connection) {
            reject(new Error("接続タイムアウト"));
          }
        }, 10000);
      });

      this.peer.on("error", (err) => {
        reject(err);
      });
    });
  }

  /**
   * メッセージハンドラ登録
   */
  on(type, callback) {
    this.handlers.set(type, callback);
  }

  /**
   * ホストに送信
   */
  send(type, payload) {
    if (this.connection && this.connection.open) {
      this.connection.send({ type, payload });
    }
  }

  /**
   * 破棄
   */
  destroy() {
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.connection = null;
  }
}
