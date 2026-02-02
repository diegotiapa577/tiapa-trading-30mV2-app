import 'dotenv/config';
// server.js
//npm install axios
const app = express();
const PORT = process.env.PORT || 8080;
app.use(express.static("public"));
app.use(cors());
app.use(express.json());


import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import crypto from "crypto";
import dotenv from "dotenv";
import axios from "axios"; // ← IMPORTADO

// Nuevo autenticacion sale
// 🔐 Autenticación

import jwt from 'jsonwebtoken'; // ← NUEVO
//import bcrypt from 'bcryptjs';
//console.log(bcrypt.hashSync('123', 10));
import fs from 'fs';
import path from 'path';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
if (!ADMIN_PASSWORD || !JWT_SECRET) {
  console.error('❌ Faltan variables de entorno: ADMIN_PASSWORD o JWT_SECRET');
  process.exit(1);
}

// Funcion para crear usuarios en el sistema
function getUSERS() {
  const users = {
    admin: {
      role: 'admin',
      password: process.env.ADMIN_PASSWORD,
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET
    }
  };

  // Cargar usuarios 1 a 10
  for (let i = 1; i <= 10; i++) {
    const id = process.env[`USER_${i}_ID`];
    if (id) {
      users[id] = {
        role: 'user',
        apiKey: process.env[`USER_${i}_API_KEY`],
        apiSecret: process.env[`USER_${i}_API_SECRET`]
      };
    } else {
      break;
    }
  }

  return users;
}



app.get('/script.js', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).send('Forbidden');
  }
  res.sendFile(path.join(process.cwd(), 'public/script.js'));
});

app.use(express.static("public"));

//console.log('🔍 BINANCE_API_KEY al iniciar:', process.env.BINANCE_API_KEY?.substring(0,10) + '...');



//nuevo autenticacion llega
//nuevo autenticacion sale

app.post('/api/register', requireAuth, (req, res) => {
});




// Middleware de autenticación
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acceso no autorizado' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    
    // ✅ Obtener usuarios dinámicamente
    const USERS = getUSERS();
    const user = USERS[payload.id];

    if (!user) {
      return res.status(403).json({ error: 'Usuario no encontrado' });
    }

    // ✅ Asignar TODOS los datos del usuario a req.user (incluyendo claves para admin y user)
    req.user = {
      id: payload.id,
      role: user.role,
      apiKey: user.apiKey,      // ← clave para Binance
      apiSecret: user.apiSecret // ← secreto para Binance
    };

    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido' });
  }
}

// 🔑 URL CORREGIDA: solo Futures Testnet (sin espacios)
const BINANCE_FUTURES_URL = "https://testnet.binancefuture.com";

//const BINANCE_MAINNET_URL = "https://fapi.binance.com"; // Solo para klines/ticker (backtesting)

function signParams(params, secret) {
  const queryString = new URLSearchParams(params).toString();
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

// ✅ FUNCIÓN PARA OBTENER EL TIEMPO DEL SERVIDOR DE BINANCE
async function getServerTime() {
  const res = await fetch(`${BINANCE_FUTURES_URL}/fapi/v1/time`);
  const data = await res.json();
  return data.serverTime;
}


// 📈 Klines (Mainnet) - CORREGIDO para usar fetch importado
app.get("/api/binance/klines", async (req, res) => {
  const { symbol = "BTCUSDT", interval = "1m", limit = 100 } = req.query;
  const url = `${BINANCE_FUTURES_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  try {
    // Usar fetch importado
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} - ${response.statusText} al obtener klines de Mainnet`);
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error en /api/binance/klines (Mainnet):", err.message);
    res.status(500).json({ error: `Error al obtener klines desde Mainnet: ${err.message}` });
  }
});

// 💰 Ticker (Mainnet) - CORREGIDO para usar fetch importado
app.get("/api/binance/ticker", async (req, res) => {
  const { symbol = "BTCUSDT" } = req.query;
  const url = `${BINANCE_FUTURES_URL}/fapi/v1/ticker/price?symbol=${symbol}`;
  try {
    // Usar fetch importado
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} - ${response.statusText} al obtener ticker de Mainnet`);
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error en /api/binance/ticker (Mainnet):", err.message);
    res.status(500).json({ error: `Error al obtener ticker desde Mainnet: ${err.message}` });
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

// ✅ Cuenta (Testnet) - CORREGIDO para usar fetch importado
// backend/routes/binanceRoutes.js

// Endpoint para Testnet account
app.get('/api/binance/testnet/account', requireAuth, async (req, res) => {
  try {
    const { apiKey, apiSecret } = req.user;
    
    // Usar URL de Testnet
    const url = 'https://testnet.binancefuture.com/fapi/v2/account';
    const timestamp = Date.now();
    const params = { timestamp: timestamp.toString(), recvWindow: '5000' };
    const signature = signParams(params, apiSecret);
    const queryString = new URLSearchParams(params).toString() + `&signature=${signature}`;
    
    const response = await axios.get(`${url}?${queryString}`, {
      headers: { 'X-MBX-APIKEY': apiKey }
    });
    
    res.json(response.data);
  } catch (err) {
    console.error('Error Testnet account:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error obteniendo cuenta Testnet' });
  }
});

// Endpoint para Mainnet account  
app.get('/api/binance/mainnet/account', requireAuth, async (req, res) => {
  try {
    const { apiKey, apiSecret } = req.user;
    
    // Usar URL de Mainnet
    const url = 'https://fapi.binance.com/fapi/v2/account';
    const timestamp = Date.now();
    const params = { timestamp: timestamp.toString(), recvWindow: '5000' };
    const signature = signParams(params, apiSecret);
    const queryString = new URLSearchParams(params).toString() + `&signature=${signature}`;
    
    const response = await axios.get(`${url}?${queryString}`, {
      headers: { 'X-MBX-APIKEY': apiKey }
    });
    
    res.json(response.data);
  } catch (err) {
    console.error('Error Mainnet account:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error obteniendo cuenta Mainnet' });
  }
});

// 📊 Posiciones
app.get("/api/binance/futures/positions", requireAuth,async (req, res) => {
  const { apiKey, apiSecret } = req.user;
  if (!apiKey || !apiSecret) return res.status(500).json({ error: "Claves no configuradas" });
  try {
    const timestamp = await getServerTime(); // ✅ CORREGIDO
    const recvWindow = 60000;
    const params = { timestamp, recvWindow };
     const signature = signParams(params, apiSecret); // ✅ así
    const url = `${BINANCE_FUTURES_URL}/fapi/v2/positionRisk?${new URLSearchParams(params)}&signature=${signature}`;
    const response = await fetch(url, { headers: { "X-MBX-APIKEY": req.user.apiKey} });
    const data = await response.json();
    if (data.code) throw new Error(JSON.stringify(data));
    res.json(data.filter(p => Math.abs(parseFloat(p.positionAmt)) > 0.0001));
  } catch (error) {
    console.error("Error en /positions:", error.message);
   res.status(500).json([]); // ← ¡Devuelve un array vacío si hay error!
  }
});

// 🚀 Abrir orden — ✅ CORREGIDO: usa getServerTime()
app.post('/api/binance/futures/order', requireAuth, async (req, res) => {
   const { apiKey, apiSecret } = req.user;
   
   //console.log("🔍 Usuario en endpoint:", req.user.id, req.user.role);
   //console.log("🔑 apiKey:", req.user.apiKey?.substring(0,10) + '...');
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
    // ✅ CORREGIDO: Usar getServerTime()
    const timestamp = await getServerTime(); // <-- CORREGIDO
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
    const signature = crypto.createHmac('sha256', req.user.apiSecret).update(queryString).digest('hex');
  
    // ✅ URL final
    const url = `${BINANCE_FUTURES_URL}/fapi/v1/order?${queryString}&signature=${signature}`;

    // ✅ POST sin cuerpo
    const orderRes = await axios.post(url, null, {
      headers: { 'X-MBX-APIKEY': req.user.apiKey}
    });

    res.json(orderRes.data);
  } catch (err) {
    console.error('❌ Error en /order (CORREGIDO):', err.response?.data || err.message || err);

    // ✅ MANEJO ESPECÍFICO PARA TIMEOUT (-1007)
    const errorCode = err.response?.data?.code;
    if (errorCode === -1007) {
      return res.status(202).json({
        code: -1007,
        msg: "Timeout: estado de la orden desconocido. Verifique su posición en Binance.",
        status: "UNKNOWN"
      });
    }

    // Otros errores
    res.status(500).json({
      msg: 'Error al abrir orden',
      code: errorCode,
      details: err.response?.data?.msg || err.message
    });
  }
});

// 🔻 Cerrar posición — ✅ CORREGIDO: usa getServerTime()
app.post("/api/binance/futures/close-position", requireAuth, async (req, res) => {
  const { apiKey, apiSecret } = req.user;
 
  if (!apiKey || !apiSecret)  return res.status(500).json({ error: "Claves no configuradas" });
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: "Falta symbol" });

  try {
    const recvWindow = 5000;

    // ✅ 1. Obtener posición actual (con timestamp fresco del servidor Binance)
    // ✅ CORREGIDO: Usar getServerTime()
    const timestamp1 = await getServerTime(); // <-- CORREGIDO
    const posParams = { timestamp: timestamp1, recvWindow };
    const posSig = signParams(posParams, apiSecret); // ← ¡esta línea DEBE estar!
    const posUrl = `${BINANCE_FUTURES_URL}/fapi/v2/positionRisk?${new URLSearchParams(posParams)}&signature=${posSig}`;

    const posRes = await axios.get(posUrl, { headers: { "X-MBX-APIKEY": req.user.apiKey } });
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
    // ✅ CORREGIDO: Usar getServerTime()
    const timestamp2 = await getServerTime(); // <-- CORREGIDO

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
    const sortedKeys = Object.keys(closeParams).sort();  //
    const queryString = sortedKeys.map(k => `${k}=${closeParams[k]}`).join('&'); /////////////inicializo posSig
    //const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
    const closeSig = crypto.createHmac('sha256', req.user.apiSecret).update(queryString).digest('hex');

    // ✅ URL final
    const closeUrl = `${BINANCE_FUTURES_URL}/fapi/v1/order?${queryString}&signature=${closeSig}`;

    // ✅ Enviar orden
    const closeRes = await axios.post(closeUrl, null, { headers: { "X-MBX-APIKEY": req.user.apiKey } });
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

   // await enviarMensajeTelegram(mensajeCierre);

    res.json({ ...result, formattedQty, avgPrice });

  } catch (error) {
    const errMsg = error.response?.data || error.message || error;
    console.error("❌ Error en /close-position:", errMsg);
    res.status(500).json({ error: "Error al cerrar posición", details: errMsg });
  }
});

// +++ NUEVO: Endpoint para cambiar apalancamiento +++
app.post('/api/binance/futures/leverage', requireAuth,  async (req, res) => {
  const { apiKey, apiSecret } = req.user;
 
  if (!apiKey || !apiSecret)  return res.status(500).json({ error: "Claves no configuradas" });
  const { symbol, leverage } = req.body;

  if (!symbol || !leverage) {
    return res.status(400).json({ msg: 'Faltan parámetros: symbol, leverage' });
  }

  const leverageNum = parseInt(leverage);
  if (isNaN(leverageNum) || leverageNum < 1 || leverageNum > 125) {
    return res.status(400).json({ msg: 'Leverage inválido: debe ser un número entre 1 y 125' });
  }

  try {
    // ✅ CORREGIDO: Usar getServerTime()
    const timestamp = await getServerTime(); // <-- CORREGIDO
    const recvWindow = 5000;

    const params = {
      symbol,
      leverage: leverageNum.toString(), // Binance espera un string
      timestamp,
      recvWindow
    };
   
    const queryString = new URLSearchParams(params).toString();
    const signature = signParams(params, apiSecret); // ✅ así

    const url = `${BINANCE_FUTURES_URL}/fapi/v1/leverage?${queryString}&signature=${signature}`;

    const response = await axios.post(url, null, {
      headers: { 'X-MBX-APIKEY': req.user.apiKey}
    });

    res.json(response.data);

  } catch (err) {
    console.error('❌ Error en /leverage:', err.response?.data || err.message || err);
    res.status(500).json({
      msg: 'Error al cambiar apalancamiento',
      code: err.response?.data?.code,
      details: err.response?.data?.msg || err.message
    });
  }
});
// --- Fin NUEVO ---

app.get("/favicon.ico", (req, res) => res.status(204).end());

// === ALERTAS POR TELEGRAM ===
//async function enviarMensajeTelegram(mensaje) {
  //const token = process.env.TELEGRAM_BOT_TOKEN;
  //const chatId = process.env.TEL/EGRAM_CHAT_ID;
  
  //if (!token || !chatId) {
  //  console.warn("⚠️ Telegram no configurado-Backend");
 //   return;
 // }

  //const url = `https://api.telegram.org/bot${token}/sendMessage`;
  //const data = {
  //  chat_id: chatId,
 //   text: mensaje,
 //   parse_mode: "HTML"
 // };

 // try {
 //   await fetch(url, {
//      method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//   });
 // /  console.log("✅ Alerta enviada a Telegram");
 /// } catch (err) {
 //   console.error("❌ Error al enviar alerta:", err.message);
 // }
//}

app.listen(PORT, () => {
  console.log(`✅ Servidor en http://localhost:${PORT}`);
  console.log("🧪 Conectado a Binance Futures TESTNET Y MAIN");
});

// genera-hash.js
// Endpoint para crear usuario (solo admin)


// ✅ Público: cualquier usuario puede llamarlo
app.post('/api/user/login', express.json(), (req, res) => {
  const { code } = req.body;
  console.log('🔍 Código recibido:', JSON.stringify(code));
  
  // Verificar si las variables de entorno están cargadas
  console.log('⚙️ USER_1_ID desde .env:', process.env.USER_1_ID);
  
  const USERS = getUSERS();
  console.log('👥 Usuarios generados:', Object.keys(USERS));
  
  const user = USERS[code];
  console.log('👤 Usuario encontrado:', user ? 'SÍ' : 'NO');
  
  if (user && user.role === 'user') {
    const token = jwt.sign(
      { id: code, role: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: '72h' }
    );
    return res.json({ success: true, token });
  }
  
  res.status(401).json({ success: false, error: 'Código de acceso inválido' });
});


// GET /api/admin/users


// Definir usuarios desde variables de entorno
// En lugar de: const USERS = { ... };
// Función para cargar usuarios desde variables de entorno


app.post('/api/login', express.json(), (req, res) => {
  const { password } = req.body;
  
  if (password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ id: 'admin', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '72h' });
    return res.json({ success: true, token });
  }
  
  res.status(401).json({ error: 'Contraseña incorrecta' });
});