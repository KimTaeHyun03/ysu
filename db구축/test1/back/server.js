// server.js
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// 기본 라우트
app.get("/", (req, res) => {
  res.send("Express 서버 정상 작동 중!");
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Express API alive" });
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`서버 실행됨: http://localhost:${PORT}`);
});
