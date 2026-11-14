// Қазақ тойы — TikTok Live сервері
// Іске қосу:  node server.js <tiktok_username>
// Содан кейін TikTok LIVE Studio / OBS-қа браузер көзі ретінде қос: http://localhost:8080
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const TT = require("tiktok-live-connector");

const USER = (process.argv[2] || process.env.TIKTOK_USER || "").replace(/^@/, "");
const PORT = +process.env.PORT || 8080;
const PUBLIC = __dirname;

if (!USER) {
  console.log("❗ TikTok логинді жаз:  node server.js сенің_логинің");
  process.exit(1);
}

// ---------- HTTP: ойын бетін береді ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".mp3": "audio/mpeg" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  if (p !== "/" && p !== "/index.html") { res.writeHead(404); return res.end("Not found"); }
  const file = path.join(PUBLIC, "index.html");
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

// ---------- WebSocket: оқиғаларды ойынға жібереді ----------
const wss = new WebSocketServer({ server });
let lastStatus = "TikTok-қа қосылуда…";
function send(obj) {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}
function status(text) { lastStatus = text; console.log("•", text); send({ type: "status", text }); }
wss.on("connection", ws => ws.send(JSON.stringify({ type: "status", text: lastStatus })));

// ---------- TikTok ----------
// tiktok-live-connector v1 (WebcastPushConnection) және v2 (TikTokLiveConnection) екеуін де қолдайды
function userOf(d) {
  const u = d.user || d;
  return {
    uniqueId: String(u.uniqueId || d.uniqueId || u.userId || d.userId || "anon"),
    nickname: u.nickname || d.nickname || u.uniqueId || d.uniqueId || "Қонақ",
  };
}

let conn = null, retry = 0;
function makeConnection() {
  if (TT.TikTokLiveConnection) return new TT.TikTokLiveConnection(USER, { enableExtendedGiftInfo: true });
  return new TT.WebcastPushConnection(USER, { enableExtendedGiftInfo: true });
}

function connect() {
  conn = makeConnection();

  conn.on("chat", d => send({ type: "chat", ...userOf(d), comment: d.comment || "" }));

  conn.on("gift", d => {
    const giftType = d.giftType ?? d.giftDetails?.giftType;
    // "серия" сыйлықтар (мысалы Раушан ×10): тек серия біткенде бір рет есептейміз
    if (giftType === 1 && !d.repeatEnd) return;
    const giftName = d.giftName || d.giftDetails?.giftName || d.extendedGiftInfo?.name || "";
    const diamondCount = d.diamondCount ?? d.giftDetails?.diamondCount ?? d.extendedGiftInfo?.diamond_count ?? 0;
    const msg = { type: "gift", ...userOf(d), giftId: d.giftId, giftName, diamondCount, repeatCount: d.repeatCount || 1 };
    console.log(`🎁 ${msg.nickname}: ${giftName} ×${msg.repeatCount} (${diamondCount}💎)`);
    send(msg);
  });

  conn.on("member", d => send({ type: "member", ...userOf(d) }));
  conn.on("like", d => send({ type: "like", ...userOf(d), likeCount: d.likeCount || 1 }));

  conn.on("streamEnd", () => { status("Эфир аяқталды"); scheduleReconnect(); });
  conn.on("disconnected", () => { status("Байланыс үзілді, қайта қосылуда…"); scheduleReconnect(); });
  conn.on("error", e => console.log("⚠️", e?.message || e));

  status(`@${USER} эфиріне қосылуда…`);
  conn.connect()
    .then(() => { retry = 0; status(`@${USER} эфиріне қосылды ✅`); })
    .catch(e => { status(`Қосылмады: ${e?.message || e}. Эфир ашық па?`); scheduleReconnect(); });
}

let timer = null;
function scheduleReconnect() {
  if (timer) return;
  const wait = Math.min(60, 10 + retry * 10); retry++;
  timer = setTimeout(() => { timer = null; try { conn && conn.disconnect && conn.disconnect(); } catch {} connect(); }, wait * 1000);
}

server.listen(PORT, () => {
  console.log(`\n🎉 Қазақ тойы іске қосылды:  http://localhost:${PORT}`);
  console.log(`   Тест режимі:              http://localhost:${PORT}/?test=1`);
  console.log(`   Эфирге (таза):            http://localhost:${PORT}/?clean=1\n`);
  connect();
});
