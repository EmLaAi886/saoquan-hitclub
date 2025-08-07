const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;
const SELF_URL = process.env.SELF_URL || `http://localhost:${PORT}`;
const HISTORY_FILE = "history.json";

let patternHistory = [];
let fullHistory = [];
const MAX_HISTORY = 100;

let latestResult = {
  id: "binhtool90",
  Phien: 0,
  Xuc_xac_1: 0,
  Xuc_xac_2: 0,
  Xuc_xac_3: 0,
  Tong: 0,
  Ket_qua: "",
  Pattern: "",
  Du_doan: "",
  Do_tin_cay: "",
  Streak: ""
};

// Load lịch sử từ file JSON nếu có
if (fs.existsSync(HISTORY_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
    fullHistory = data;
    patternHistory = data.map(item => item.Ket_qua === "Tài" ? "t" : "x");
    if (fullHistory.length > 0) latestResult = fullHistory[fullHistory.length - 1];
    console.log(`✅ Đã load ${fullHistory.length} phiên từ history.json`);
  } catch (e) {
    console.error("❌ Lỗi khi đọc file history.json:", e.message);
  }
}

function getTaiXiu(sum) {
  return sum > 10 ? "t" : "x";
}

// Tính độ chính xác dự đoán Markov bậc N trên lịch sử
function calcAccuracy(historyPattern, order) {
  let correct = 0, total = 0;
  for (let i = 0; i <= historyPattern.length - order - 1; i++) {
    const seq = historyPattern.slice(i, i + order);
    const next = historyPattern[i + order];
    // Dự đoán dựa vào seq: đếm tần suất next trong toàn lịch sử cùng seq
    let counts = { t: 0, x: 0 };
    for (let j = 0; j <= historyPattern.length - order - 1; j++) {
      if (historyPattern.slice(j, j + order) === seq) {
        counts[historyPattern[j + order]]++;
      }
    }
    const pred = counts.t >= counts.x ? "t" : "x";
    if (pred === next) correct++;
    total++;
  }
  return total > 0 ? correct / total : 0.5;
}

// Thuật toán dự đoán nâng cao - kết hợp trọng số bậc Markov 1-4
function duDoanAdvanced(historyPattern) {
  if (historyPattern.length < 5) {
    // Quá ít dữ liệu, fallback xác suất tổng thể
    const counts = { t: 0, x: 0 };
    for (const c of historyPattern) counts[c]++;
    const total = counts.t + counts.x;
    const percentT = total ? counts.t / total : 0.5;
    return { duDoanResult: percentT >= 0.5 ? "Tài" : "Xỉu", doTinCay: (percentT * 100).toFixed(1) };
  }

  // Tính độ chính xác của các bậc Markov
  const acc4 = calcAccuracy(historyPattern, 4);
  const acc3 = calcAccuracy(historyPattern, 3);
  const acc2 = calcAccuracy(historyPattern, 2);
  const acc1 = calcAccuracy(historyPattern, 1);

  const totalAcc = acc4 + acc3 + acc2 + acc1 || 1; // tránh chia 0

  // Lấy mẫu cuối mỗi bậc và dự đoán tỉ lệ
  function getNextCounts(order) {
    const lastSeq = historyPattern.slice(-order);
    let counts = { t: 0, x: 0 };
    let total = 0;
    for (let i = 0; i <= historyPattern.length - order - 1; i++) {
      if (historyPattern.slice(i, i + order) === lastSeq) {
        counts[historyPattern[i + order]]++;
        total++;
      }
    }
    if (total === 0) {
      // fallback tổng thể
      for (const c of historyPattern) counts[c]++;
      total = counts.t + counts.x;
    }
    return { counts, total };
  }

  const c4 = getNextCounts(4);
  const c3 = getNextCounts(3);
  const c2 = getNextCounts(2);
  const c1 = getNextCounts(1);

  let combinedT = 0;
  let combinedX = 0;

  combinedT += (acc4 / totalAcc) * (c4.counts.t / c4.total);
  combinedX += (acc4 / totalAcc) * (c4.counts.x / c4.total);

  combinedT += (acc3 / totalAcc) * (c3.counts.t / c3.total);
  combinedX += (acc3 / totalAcc) * (c3.counts.x / c3.total);

  combinedT += (acc2 / totalAcc) * (c2.counts.t / c2.total);
  combinedX += (acc2 / totalAcc) * (c2.counts.x / c2.total);

  combinedT += (acc1 / totalAcc) * (c1.counts.t / c1.total);
  combinedX += (acc1 / totalAcc) * (c1.counts.x / c1.total);

  // Chuẩn hóa xác suất
  const sum = combinedT + combinedX;
  const percentT = sum ? (combinedT / sum) * 100 : 50;
  const percentX = sum ? (combinedX / sum) * 100 : 50;

  let duDoanResult = percentT >= percentX ? "Tài" : "Xỉu";
  let doTinCay = percentT >= percentX ? percentT.toFixed(1) : percentX.toFixed(1);

  return { duDoanResult, doTinCay };
}

// Tính streak liên tiếp hiện tại
function getCurrentStreak(pattern) {
  if (pattern.length === 0) return { type: "-", count: 0 };

  const lastChar = pattern.slice(-1);
  let count = 0;

  for (let i = pattern.length - 1; i >= 0; i--) {
    if (pattern[i] === lastChar) count++;
    else break;
  }

  return {
    type: lastChar === "t" ? "Tài" : "Xỉu",
    count
  };
}

function updateResult(d1, d2, d3, sid = null) {
  const total = d1 + d2 + d3;
  const result = total > 10 ? "Tài" : "Xỉu";
  const shorthand = getTaiXiu(total);

  if (sid !== latestResult.Phien) {
    // Update pattern history
    patternHistory.push(shorthand);
    if (patternHistory.length > 50) patternHistory.shift();

    const pattern = patternHistory.join("");
    const { duDoanResult, doTinCay } = duDoanAdvanced(pattern);
    const streak = getCurrentStreak(pattern);

    latestResult = {
      id: "binhtool90",
      Phien: sid || latestResult.Phien,
      Xuc_xac_1: d1,
      Xuc_xac_2: d2,
      Xuc_xac_3: d3,
      Tong: total,
      Ket_qua: result,
      Pattern: pattern,
      Du_doan: duDoanResult,
      Do_tin_cay: doTinCay + "%",
      Streak: `${streak.type} (${streak.count})`
    };

    // Lưu vào lịch sử đầy đủ
    fullHistory.push({ ...latestResult });
    if (fullHistory.length > MAX_HISTORY) fullHistory.shift();

    // Save history to file
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(fullHistory, null, 2));

    const timeStr = new Date().toISOString().replace("T", " ").slice(0, 19);
    console.log(
      `[🎲✅] Phiên ${latestResult.Phien} - ${d1}-${d2}-${d3} ➜ Tổng: ${total}, Kết quả: ${result} | Dự đoán: ${duDoanResult} (${doTinCay}%) | Streak: ${streak.type} (${streak.count})`
    );
  }
}

// API lấy kết quả Hitclub
const API_TARGET_URL = 'https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=g8&gid=vgmn_101';

async function fetchGameData() {
  try {
    const response = await axios.get(API_TARGET_URL);
    const data = response.data;

    if (data.status === "OK" && Array.isArray(data.data) && data.data.length > 0) {
      const game = data.data[0];
      const sid = game.sid;
      const d1 = game.d1;
      const d2 = game.d2;
      const d3 = game.d3;

      if (sid !== latestResult.Phien && d1 !== undefined && d2 !== undefined && d3 !== undefined) {
        updateResult(d1, d2, d3, sid);
      }
    }
  } catch (error) {
    console.error("❌ Lỗi khi lấy dữ liệu từ API GET:", error.message);
  }
}

// Fetch dữ liệu mỗi 5s
setInterval(fetchGameData, 5000);

// API endpoints
app.get("/api/taixiu", (req, res) => {
  res.json(latestResult);
});

app.get("/api/history", (req, res) => {
  res.json(fullHistory);
});

app.get("/", (req, res) => {
  res.json({ status: "HITCLUB Tài Xỉu đang chạy", phien: latestResult.Phien });
});

// Ping để Render không ngủ
setInterval(() => {
  if (SELF_URL.includes("http")) {
    axios.get(`${SELF_URL}/api/taixiu`).catch(() => {});
  }
}, 300000); // 5 phút ping 1 lần

app.listen(PORT, () => {
  console.log(`🚀 Server Hitclub Tài Xỉu đang chạy tại http://localhost:${PORT}`);
});
