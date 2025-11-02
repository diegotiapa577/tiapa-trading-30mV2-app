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
const BINANCE_FUTURES_URL = "https://testnet.binancefuture.com";

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

// 📈 Klines desde FUTURES Testnet
app.get("/api/binance/klines", async (req, res) => {
  const { symbol = "BTCUSDT", interval = "1m", limit = 100 } = req.query;
  const url = `${BINANCE_FUTURES_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error en /klines:", err.message);
    res.status(500).json({ error: "Error al obtener klines" });
  }
});

// 💰 Precio actual
app.get("/api/binance/ticker", async (req, res) => {
  const { symbol = "BTCUSDT" } = req.query;
  const url = `${BINANCE_FUTURES_URL}/fapi/v1/ticker/price?symbol=${symbol}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error en /ticker:", err.message);
    res.status(500).json({ error: "Error al obtener precio" });
  }
});
// 📉 Datos históricos para backtesting
// 🧪 Backtesting con IA real
app.post("/api/backtest", async (req, res) => {
  const { symbol = "BTCUSDT", interval = "15m", days = 30, takeProfit = 5, stopLoss = 3 } = req.body;
  
  try {
    // Obtener datos históricos
    const limit = Math.min(1500, days * (interval === '1m' ? 1440 : interval === '5m' ? 288 : interval === '15m' ? 96 : 24));
    const url = `${BINANCE_FUTURES_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const response = await fetch(url);
    const klinesRaw = await response.json();
    const klines = klinesRaw.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));

    // Entrenar modelo
    const modelo = await entrenarModelo(klines, 0, 0); // fundingRate y openInterest fijos por ahora

    // Simular trading
    let operaciones = [];
    let capital = 1000;
    let posicionAbierta = null;
    let maxEquity = capital;
    let drawdownMax = 0;

    for (let i = 30; i < klines.length; i++) {
      const closes = klines.slice(0, i).map(k => k.close);
      const ultimos10Precios = closes.slice(-10);
      const ultimos10Volumenes = klines.slice(i - 10, i).map(k => k.volume);
      const rsi = calcularRSI(closes, 14);
      const ema = calcularEMA(closes, 20);
      const { macdLine, signalLine } = calcularMACD(closes, 12, 26, 9);
      const { media: bbMedia, superior: bbSuperior, inferior: bbInferior } = calcularBandasBollinger(closes, 20, 2);
      const atr = calcularATR(klines.slice(0, i), 14);
      const obv = calcularOBV(klines.slice(0, i));

      const rsiActual = rsi[rsi.length - 1] || 50;
      const emaActual = ema[ema.length - 1] || closes[closes.length - 1];
      const macdActual = macdLine[macdLine.length - 1] || 0;
      const signalActual = signalLine[signalLine.length - 1] || 0;
      const bbMedio = bbMedia[bbMedia.length - 1] || closes[closes.length - 1];
      const bbSup = bbSuperior[bbSuperior.length - 1] || closes[closes.length - 1];
      const bbInf = bbInferior[bbInferior.length - 1] || closes[closes.length - 1];
      const anchoBB = bbSup - bbInf;
      const posicionBB = anchoBB > 0 ? (closes[closes.length - 1] - bbInf) / anchoBB : 0.5;
      const atrActual = atr[atr.length - 1] || 0;
      const obvActual = obv[obv.length - 1] || 0;

      const prediccionRaw = await predecirConModelo(
        modelo,
        ultimos10Precios,
        ultimos10Volumenes,
        rsiActual,
        emaActual,
        macdActual,
        signalActual,
        posicionBB,
        anchoBB,
        atrActual,
        obvActual,
        klines[i].close,
        0,
        0
      );

      const confianza = prediccionRaw > 0.5 ? prediccionRaw : 1 - prediccionRaw;
      const direccion = prediccionRaw > 0.5 ? 'SUBIDA' : 'BAJADA';
      const precioActual = klines[i].close;
      const leverage = 10;

      if (posicionAbierta) {
        const roePct = ((precioActual - posicionAbierta.precioEntrada) / posicionAbierta.precioEntrada) * leverage * (posicionAbierta.esLong ? 1 : -1) * 100;
        if (roePct >= takeProfit || roePct <= -stopLoss) {
          const ganancia = ((precioActual - posicionAbierta.precioEntrada) / posicionAbierta.precioEntrada) * posicionAbierta.montoInvertido * leverage;
          operaciones.push({ ganancia, resultado: ganancia >= 0 ? 'GANANCIA' : 'PÉRDIDA' });
          capital += ganancia;
          posicionAbierta = null;
        }
      } else if (confianza > 0.55) {
        const montoInvertido = capital * 0.1;
        const esLong = direccion === 'SUBIDA';
        posicionAbierta = { precioEntrada: precioActual, montoInvertido, esLong };
      }

      if (capital > maxEquity) maxEquity = capital;
      const drawdown = ((maxEquity - capital) / maxEquity) * 100;
      if (drawdown > drawdownMax) drawdownMax = drawdown;
    }

    // Calcular métricas
    const ganancias = operaciones.filter(o => o.ganancia > 0).length;
    const winRate = operaciones.length > 0 ? (ganancias / operaciones.length) * 100 : 0;
    const gananciasTotales = operaciones.filter(o => o.ganancia > 0).reduce((sum, o) => sum + o.ganancia, 0);
    const perdidasTotales = Math.abs(operaciones.filter(o => o.ganancia < 0).reduce((sum, o) => sum + o.ganancia, 0));
    const profitFactor = perdidasTotales > 0 ? gananciasTotales / perdidasTotales : gananciasTotales;
    const roeTotal = ((capital - 1000) / 1000) * 100;

    res.json({
      operaciones: operaciones.length,
      winRate,
      profitFactor,
      maxDrawdown: drawdownMax,
      roeTotal
    });

  } catch (error) {
    console.error("Error en backtesting:", error);
    res.status(500).json({ error: error.message });
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
    
    // Enviar alerta por Telegram al cerrar
const pnl = parseFloat(pos.unRealizedProfit) || 0;
const emoji = pnl >= 0 ? '✅' : '❌';
const ganancia = Math.abs(pnl).toFixed(2);
const tipo = pnl >= 0 ? 'Ganancia' : 'Pérdida';
const mensajeCierre = `${emoji} Posición cerrada\nSímbolo: ${symbol}\nPnL: ${pnl >= 0 ? '+' : ''}${ganancia} USDT\n(${tipo})`;
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
  console.log("🧪 Conectado a Binance Futures TESTNET");
});