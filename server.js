// ✅ Open Interest activo - 2025-04-05
// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import crypto from "crypto";
import dotenv from "dotenv";
import { entrenarModelo, predecirConModelo } from './ia-backend.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;
//---- Modificacion en la nube
//---- Modificacion en la nube
// 🔑 URL CORREGIDA: solo Futures Testnet (sin espacios)
const BINANCE_FUTURES_URL ="https://testnet.binancefuture.com";

const BINANCE_MAINNET_URL ="https://fapi.binance.com";           // Solo para klines/ticker (backtesting)

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
  const url = `${BINANCE_MAINNET_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
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
  const url = `${BINANCE_MAINNET_URL}/fapi/v1/ticker/price?symbol=${symbol}`;
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

// 🚀 Abrir orden
app.post("/api/binance/futures/order", async (req, res) => {
  if (!API_KEY || !API_SECRET) return res.status(500).json({ error: "Claves no configuradas" });
  const { symbol, side, quantity, leverage, positionSide = "BOTH" } = req.body;
  if (!symbol || !side || !quantity || !leverage)
    return res.status(400).json({ error: "Faltan parámetros" });
  try {
    const timestamp = await getServerTime();
    const recvWindow = 60000;
    const levParams = { symbol, leverage, timestamp, recvWindow };
    const levSignature = signParams(levParams);
    const levUrl = `${BINANCE_FUTURES_URL}/fapi/v1/leverage?${new URLSearchParams(levParams)}&signature=${levSignature}`;
    await fetch(levUrl, { method: "POST", headers: { "X-MBX-APIKEY": API_KEY } });
    const orderParams = { symbol, side, type: "MARKET", quantity, positionSide, timestamp, recvWindow };
    const orderSig = signParams(orderParams);
    const orderUrl = `${BINANCE_FUTURES_URL}/fapi/v1/order?${new URLSearchParams(orderParams)}&signature=${orderSig}`;
    const response = await fetch(orderUrl, { method: "POST", headers: { "X-MBX-APIKEY": API_KEY } });
    const result = await response.json();
    if (result.code) throw new Error(JSON.stringify(result));
  // Enviar alerta por Telegram
    const mensajeApertura = `🟢 Nueva posición\nSímbolo: ${symbol}\nLado: ${side}\nCantidad: ${quantity}`;
    enviarMensajeTelegram(mensajeApertura);
          
    res.json(result);
  } catch (error) {
    console.error("Error en /order:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 🔻 Cerrar posición
app.post("/api/binance/futures/close-position", async (req, res) => {
  if (!API_KEY || !API_SECRET) return res.status(500).json({ error: "Claves no configuradas" });
  const { symbol, positionSide = "BOTH" } = req.body;
  if (!symbol) return res.status(400).json({ error: "Falta symbol" });
  try {
    const timestamp = await getServerTime();
    const recvWindow = 60000;
    const params = { timestamp, recvWindow };
    const sig = signParams(params);
    const url = `${BINANCE_FUTURES_URL}/fapi/v2/positionRisk?${new URLSearchParams(params)}&signature=${sig}`;
    const posRes = await fetch(url, { headers: { "X-MBX-APIKEY": API_KEY } });
    const positions = await posRes.json();
    const pos = positions.find(p => p.symbol === symbol && p.positionSide === positionSide);
    if (!pos || Math.abs(parseFloat(pos.positionAmt)) < 0.0001)
      return res.status(400).json({ error: "No hay posición abierta" });
    const side = parseFloat(pos.positionAmt) > 0 ? "SELL" : "BUY";
    const quantity = Math.abs(parseFloat(pos.positionAmt)).toFixed(3);
    const closeParams = { symbol, side, type: "MARKET", quantity, positionSide, timestamp, recvWindow };
    const closeSig = signParams(closeParams);
    const closeUrl = `${BINANCE_FUTURES_URL}/fapi/v1/order?${new URLSearchParams(closeParams)}&signature=${closeSig}`;
    const closeRes = await fetch(closeUrl, { method: "POST", headers: { "X-MBX-APIKEY": API_KEY } });
    const result = await closeRes.json();
    if (result.code) throw new Error(JSON.stringify(result));

    // ✅ Añadir datos reales de ejecución a la respuesta
    result.avgPriceReal = parseFloat(result.avgPrice) || parseFloat(pos.markPrice);
    result.pnlReal = parseFloat(result.cumQuote) || 0;

    // ✅ Enviar alerta por Telegram con datos reales
    const pnlReal = result.pnlReal;
    const emoji = pnlReal >= 0 ? '✅' : '❌';
    const ganancia = Math.abs(pnlReal).toFixed(2);
    const tipo = pnlReal >= 0 ? 'Ganancia' : 'Pérdida';
    const mensajeCierre = `${emoji} Posición cerrada\nSímbolo: ${symbol}\nPnL: ${pnlReal >= 0 ? '+' : ''}${ganancia} USDT\n(${tipo})`;
    enviarMensajeTelegram(mensajeCierre);

    res.json(result);
  } catch (error) {
    console.error("Error en /close-position:", error.message);
    res.status(500).json({ error: error.message });
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