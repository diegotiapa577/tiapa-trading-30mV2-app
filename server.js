// ✅ Open Interest activo - 2025-04-05
// server.js
//npm install axios
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import crypto from "crypto";
import dotenv from "dotenv";
import { entrenarModelo, predecirConModelo } from './ia-backend.js';
import axios from "axios"; // ← IMPORTADO

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// 🔑 URL CORREGIDA: solo Futures Testnet (sin espacios)
const BINANCE_FUTURES_URL = "https://testnet.binancefuture.com";

//const BINANCE_MAINNET_URL = "https://fapi.binance.com"; // Solo para klines/ticker (backtesting)

// 🔒 Claves API
const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;

if (!API_KEY || !API_SECRET) {
  console.warn("⚠️  Claves de Binance no configuradas.");
}

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

function signParams(params) {
  const queryString = new URLSearchParams(params).toString();
  return crypto.createHmac("sha256", API_SECRET).update(queryString).digest("hex");
}

async function getServerTime() {
  const res = await fetch(`${BINANCE_FUTURES_URL}/fapi/v1/time`);
  const data = await res.json();
  return data.serverTime;
}

// 📈 Klines → ahora usa MAINNET (pública, sin claves, estable)
app.get("/api/binance/klines", async (req, res) => {
  const { symbol = "BTCUSDT", interval = "1m", limit = 100 } = req.query;
  const url = `${BINANCE_FUTURES_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error en /klines (Mainnet):", err.message);
    res.status(500).json({ error: "Error al obtener klines desde Mainnet" });
  }
});

// 💰 Ticker → ahora usa MAINNET (pública, sin claves, estable)
app.get("/api/binance/ticker", async (req, res) => {
  const { symbol = "BTCUSDT" } = req.query;
  const url = `${BINANCE_FUTURES_URL}/fapi/v1/ticker/price?symbol=${symbol}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error en /ticker (Mainnet):", err.message);
    res.status(500).json({ error: "Error al obtener precio desde Mainnet" });
  }
});

// 💸 Funding Rate (desde premiumIndex)
app.get("/api/binance/futures/funding", async (req, res) => {
  const { symbol = "BTCUSDT" } = req.query;
  const url = `${BINANCE_FUTURES_URL}/fapi/v1/premiumIndex?symbol=${symbol}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    
    res.json({
      fundingRate: parseFloat(data.fundingRate) || 0,
      nextFundingTime: data.nextFundingTime ? parseInt(data.nextFundingTime) : null
    });
  } catch (err) {
    console.error("Error en /funding:", err.message);
    res.status(500).json({ error: "Error al obtener funding rate" });
  }
});

// 📈 Open Interest (OI) - exclusivo de futuros
app.get("/api/binance/futures/open-interest", async (req, res) => {
  const { symbol = "BTCUSDT" } = req.query;
  const url = `${BINANCE_FUTURES_URL}/fapi/v1/openInterest?symbol=${symbol}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    
    res.json({
      openInterest: parseFloat(data.openInterest) || 0,
      symbol: data.symbol || symbol
    });
  } catch (err) {
    console.error("Error en /open-interest:", err.message);
    res.status(500).json({ error: "Error al obtener open interest" });
  }
});

// ✅ Cuenta
app.get("/api/binance/futures/account", async (req, res) => {
  if (!API_KEY || !API_SECRET) return res.status(500).json({ error: "Claves no configuradas" });
  try {
    const timestamp = await getServerTime();
    const recvWindow = 60000;
    const params = { timestamp, recvWindow };
    const signature = signParams(params);
    const url = `${BINANCE_FUTURES_URL}/fapi/v2/account?${new URLSearchParams(params)}&signature=${signature}`;
    const response = await fetch(url, { headers: { "X-MBX-APIKEY": API_KEY } });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error en /account:", error);
    res.status(500).json({ error: "No se pudo obtener la cuenta" });
  }
});

// 📊 Posiciones
app.get("/api/binance/futures/positions", async (req, res) => {
  if (!API_KEY || !API_SECRET) return res.status(500).json({ error: "Claves no configuradas" });
  try {
    const timestamp = await getServerTime();
    const recvWindow = 60000;
    const params = { timestamp, recvWindow };
    const signature = signParams(params);
    const url = `${BINANCE_FUTURES_URL}/fapi/v2/positionRisk?${new URLSearchParams(params)}&signature=${signature}`;
    const response = await fetch(url, { headers: { "X-MBX-APIKEY": API_KEY } });
    const data = await response.json();
    if (data.code) throw new Error(JSON.stringify(data));
    res.json(data.filter(p => Math.abs(parseFloat(p.positionAmt)) > 0.0001));
  } catch (error) {
    console.error("Error en /positions:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 🚀 Abrir orden — ✅ CORREGIDO
app.post('/api/binance/futures/order', async (req, res) => {
  const { symbol, side, quantity } = req.body; // leverage NO va aquí

  if (!symbol || !side || !quantity) {
    return res.status(400).json({ msg: 'Faltan parámetros: symbol, side, quantity' });
  }

  try {
    // ✅ 1. Ajustar precisión (tu lógica ya es buena)
    const exchangeInfo = await axios.get(`${BINANCE_FUTURES_URL}/fapi/v1/exchangeInfo`);
    const sym = exchangeInfo.data.symbols.find(s => s.symbol === symbol);
    if (!sym) return res.status(400).json({ msg: 'Símbolo no encontrado' });

    const lotSizeFilter = sym.filters.find(f => f.filterType === 'LOT_SIZE');
    if (!lotSizeFilter) return res.status(400).json({ msg: 'Filtro LOT_SIZE no encontrado' });

    const stepSize = parseFloat(lotSizeFilter.stepSize);
    const qty = parseFloat(quantity);
    const roundedQty = Math.round(qty / stepSize) * stepSize;
    const formattedQty = roundedQty.toFixed(Math.max(0, Math.ceil(-Math.log10(stepSize))));

    // ✅ 2. Parámetros firmados: SOLO los que Binance acepta en /order + timestamp [+ recvWindow opcional]
    const timestamp = Date.now();
    const recvWindow = 5000; // más seguro: 5000 ms en lugar de 60000 para testnet

    // ⚠️ Ordenar alfabéticamente: recvWindow, quantity, side, symbol, timestamp, type
    const params = {
      recvWindow,
      quantity: formattedQty,
      side,
      symbol,
      timestamp,
      type: 'MARKET'
    };

    // ✅ Firmar con parámetros ordenados explícitamente
    const sortedKeys = Object.keys(params).sort();
    const queryString = sortedKeys.map(key => `${key}=${params[key]}`).join('&');
    const signature = crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');

    // ✅ URL final
    const url = `${BINANCE_FUTURES_URL}/fapi/v1/order?${queryString}&signature=${signature}`;

    // ✅ POST sin cuerpo
    const orderRes = await axios.post(url, null, {
      headers: { 'X-MBX-APIKEY': API_KEY }
    });

    res.json(orderRes.data);
  } catch (err) {
    console.error('❌ Error en /order (CORREGIDO):', err.response?.data || err.message || err);
    res.status(500).json({
      msg: 'Error al abrir orden',
      code: err.response?.data?.code,
      details: err.response?.data?.msg || err.message
    });
  }
});

// 🔻 Cerrar posición — ✅ CORREGIDO
app.post("/api/binance/futures/close-position", async (req, res) => {
  if (!API_KEY || !API_SECRET) return res.status(500).json({ error: "Claves no configuradas" });
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: "Falta symbol" });

  try {
    const recvWindow = 5000;

    // ✅ 1. Obtener posición actual (con timestamp fresco)
    const timestamp1 = Date.now();
    const posParams = { timestamp: timestamp1, recvWindow };
    const posSig = signParams(posParams);
    const posUrl = `${BINANCE_FUTURES_URL}/fapi/v2/positionRisk?${new URLSearchParams(posParams)}&signature=${posSig}`;
    
    const posRes = await axios.get(posUrl, { headers: { "X-MBX-APIKEY": API_KEY } });
    const positions = posRes.data;
    const pos = positions.find(p => p.symbol === symbol && Math.abs(parseFloat(p.positionAmt)) > 0.0001);
    if (!pos) return res.status(400).json({ error: "No hay posición abierta" });

    // ✅ 2. Obtener stepSize para formatear quantity correctamente
    const infoRes = await axios.get(`${BINANCE_FUTURES_URL}/fapi/v1/exchangeInfo`);
    const symInfo = infoRes.data.symbols.find(s => s.symbol === symbol);
    if (!symInfo) return res.status(400).json({ error: "Símbolo no válido" });

    const lotFilter = symInfo.filters.find(f => f.filterType === 'LOT_SIZE');
    const stepSize = parseFloat(lotFilter.stepSize);
    const rawQty = Math.abs(parseFloat(pos.positionAmt));
    const roundedQty = Math.round(rawQty / stepSize) * stepSize;
    const formattedQty = roundedQty.toFixed(Math.max(0, -Math.floor(Math.log10(stepSize))));

    // ✅ 3. Preparar orden de cierre (sin positionSide si no es hedge mode)
    const side = parseFloat(pos.positionAmt) > 0 ? "SELL" : "BUY";
    const timestamp2 = Date.now(); // ⏱️ fresco

    // Solo incluir positionSide si Binance lo reportó y es distinto de "BOTH"
    const closeParams = {
      recvWindow,
      side,
      symbol,
      type: "MARKET",
      quantity: formattedQty,
      timestamp: timestamp2
    };

    // Si estás en modo hedge y la posición lo requiere, añade positionSide
    if (pos.positionSide && pos.positionSide !== "BOTH") {
      closeParams.positionSide = pos.positionSide;
    }

    // ✅ Firmar con parámetros ordenados
    const sortedKeys = Object.keys(closeParams).sort();
    const queryString = sortedKeys.map(k => `${k}=${closeParams[k]}`).join('&');
    const closeSig = crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');

    // ✅ URL final
    const closeUrl = `${BINANCE_FUTURES_URL}/fapi/v1/order?${queryString}&signature=${closeSig}`;

    // ✅ Enviar orden
    const closeRes = await axios.post(closeUrl, null, { headers: { "X-MBX-APIKEY": API_KEY } });
    const result = closeRes.data;

    // ✅ Telegram (reutiliza tu función, solo mejoro el mensaje)
    const avgPrice = parseFloat(result.avgPrice) || parseFloat(pos.markPrice) || 0;
    const cumQuote = parseFloat(result.cumQuote) || 0;
    // PnL aproximado: (price - entry) * qty — pero Binance no da entry en esta respuesta
    // Así que usamos cumQuote solo como referencia
    const pnl = cumQuote > 0 ? cumQuote : -cumQuote;
    const isProfit = cumQuote > 0;
    const emoji = isProfit ? '✅' : '❌';
    const mensajeCierre = `${emoji} Posición cerrada
📌 ${symbol} | ${side === 'BUY' ? 'SHORT' : 'LONG'}
💵 PnL: ${isProfit ? '+' : ''}${pnl.toFixed(2)} USDT`;

    await enviarMensajeTelegram(mensajeCierre);

    res.json({ ...result, formattedQty, avgPrice });

  } catch (error) {
    const errMsg = error.response?.data || error.message || error;
    console.error("❌ Error en /close-position:", errMsg);
    res.status(500).json({ error: "Error al cerrar posición", details: errMsg });
  }
});
app.get("/favicon.ico", (req, res) => res.status(204).end());

// === ALERTAS POR TELEGRAM ===
async function enviarMensajeTelegram(mensaje) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!token || !chatId) {
    console.warn("⚠️ Telegram no configurado");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const data = {
    chat_id: chatId,
    text: mensaje,
    parse_mode: "HTML"
  };

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    console.log("✅ Alerta enviada a Telegram");
  } catch (err) {
    console.error("❌ Error al enviar alerta:", err.message);
  }
}

app.listen(PORT, () => {
  console.log(`✅ Servidor en http://localhost:${PORT}`);
  console.log("🧪 Conectado a Binance Futures TESTNET Y MAIN");
});