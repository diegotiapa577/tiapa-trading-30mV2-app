// ✅ SCRIPT ESTABLE — Compatible con index1.txt (Binance Testnet)
let chart;
let dataSeries;
let precios = [];
let modelo = null;
let capitalInicial = 1000;
let capitalActual = 1000;
let maxOperaciones = 3;
let takeProfitPct = 5.0;
let stopLossPct = 3.0;
let operaciones = [];
let ultimoPrecio = 0;
let streamingInterval = null;
let simboloActual = 'BTCUSDT';

// 📦 Cache de info del símbolo (ejecutar 1 vez al inicio)
let symbolInfo = null;

async function fetchSymbolInfo(symbol = 'BTCUSDT') {
  if (symbolInfo) return symbolInfo;

  try {
    const url = 'https://testnet.binancefuture.com/fapi/v1/exchangeInfo';
    const res = await fetch(url);
    const data = await res.json();
    const sym = data.symbols.find(s => s.symbol === symbol);
    
    if (!sym) throw new Error(`Símbolo no encontrado: ${symbol}`);

    const filters = {};
    sym.filters.forEach(f => {
      if (f.filterType === 'LOT_SIZE') {
        filters.stepSize = parseFloat(f.stepSize);
        filters.minQty = parseFloat(f.minQty);
      }
      if (f.filterType === 'MIN_NOTIONAL') {
        filters.minNotional = parseFloat(f.notional);
      }
    });

    symbolInfo = filters;
    console.log(`✅ Info de ${symbol} cargada:`, symbolInfo);
    return symbolInfo;
  } catch (e) {
    console.error('❌ Error al cargar info del símbolo:', e);
    // Fallback seguro para BTCUSDT en Testnet
    return {
      stepSize: 0.001,
      minQty: 0.001,
      minNotional: 100
    };
  }
}

function calculateQuantity(price, notional = 100) {
  notional = Math.max(symbolInfo?.minNotional || 100, notional);
  let qty = notional / price;
  const stepSize = symbolInfo?.stepSize || 0.001;
  qty = Math.floor(qty / stepSize) * stepSize;
  if (qty < (symbolInfo?.minQty || 0.001)) {
    qty = symbolInfo?.minQty || 0.001;
  }
  return parseFloat(qty.toFixed(8));
}
// === INDICADORES TÉCNICOS ===
function calcularRSI(precios, periodo = 14) {
  if (precios.length < periodo + 1) return Array(precios.length).fill(50);
  const rsi = Array(periodo).fill(50);
  let gananciaProm = 0;
  let perdidaProm = 0;
  for (let i = 1; i <= periodo; i++) {
    const cambio = precios[i] - precios[i - 1];
    if (cambio > 0) gananciaProm += cambio;
    else perdidaProm -= cambio;
  }
  gananciaProm /= periodo;
  perdidaProm /= periodo;
  for (let i = periodo; i < precios.length; i++) {
    const cambio = precios[i] - precios[i - 1];
    const ganancia = cambio > 0 ? cambio : 0;
    const perdida = cambio < 0 ? -cambio : 0;
    gananciaProm = (gananciaProm * (periodo - 1) + ganancia) / periodo;
    perdidaProm = (perdidaProm * (periodo - 1) + perdida) / periodo;
    const rs = perdidaProm === 0 ? 100 : gananciaProm / perdidaProm;
    rsi.push(100 - (100 / (1 + rs)));
  }
  return rsi;
}
function calcularEMA(precios, periodo = 20) {
  if (precios.length === 0) return [];
  const ema = [precios[0]];
  const k = 2 / (periodo + 1);
  for (let i = 1; i < precios.length; i++) {
    ema.push(precios[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}
function calcularMACD(precios, rapido = 12, lento = 26, signal = 9) {
  const emaRapida = calcularEMA(precios, rapido);
  const emaLenta = calcularEMA(precios, lento);
  const macdLine = emaRapida.map((val, i) => val - emaLenta[i]);
  const signalLine = calcularEMA(macdLine.slice(lento - 1), signal);
  return { macdLine, signalLine };
}
function calcularBandasBollinger(precios, periodo = 20, desv = 2) {
  const medias = [], superior = [], inferior = [];
  for (let i = 0; i < precios.length; i++) {
    if (i < periodo - 1) {
      medias.push(NaN); superior.push(NaN); inferior.push(NaN);
    } else {
      const ventana = precios.slice(i - periodo + 1, i + 1);
      const media = ventana.reduce((a, b) => a + b, 0) / ventana.length;
      const varianza = ventana.reduce((sum, p) => sum + Math.pow(p - media, 2), 0) / ventana.length;
      const desvEst = Math.sqrt(varianza);
      medias.push(media);
      superior.push(media + desv * desvEst);
      inferior.push(media - desv * desvEst);
    }
  }
  return { media: medias, superior, inferior };
}
function calcularATR(klines, periodo = 14) {
  if (klines.length < periodo + 1) return Array(klines.length).fill(0);
  const tr = [];
  for (let i = 1; i < klines.length; i++) {
    const high = klines[i].high;
    const low = klines[i].low;
    const prevClose = klines[i - 1].close;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let atr = Array(periodo - 1).fill(0);
  let suma = tr.slice(0, periodo - 1).reduce((a, b) => a + b, 0);
  atr.push(suma / (periodo - 1));
  for (let i = periodo; i < tr.length; i++) {
    atr.push((atr[atr.length - 1] * (periodo - 1) + tr[i]) / periodo);
  }
  while (atr.length < klines.length) atr.unshift(0);
  return atr;
}
function calcularOBV(klines) {
  if (klines.length === 0) return [];
  const obv = [0];
  for (let i = 1; i < klines.length; i++) {
    const delta = klines[i].close - klines[i - 1].close;
    const vol = klines[i].volume;
    obv.push(obv[i - 1] + (delta > 0 ? vol : delta < 0 ? -vol : 0));
  }
  return obv;
}
function calcularADX(klines, period = 14) {
  if (!Array.isArray(klines) || klines.length < period + 10) return [];
  
  // ✅ Corregido: usar objetos {high, low, close}
  const highs = klines.map(k => k.high);
  const lows  = klines.map(k => k.low);
  const closes = klines.map(k => k.close);
  const n = highs.length;
  const tr = new Array(n).fill(0);
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }

  let trSmooth = tr.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let plusDMSmooth = plusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let minusDMSmooth = minusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);

  const plusDI = [], minusDI = [], dx = [];
  const firstPlusDI = (plusDMSmooth / trSmooth) * 100;
  const firstMinusDI = (minusDMSmooth / trSmooth) * 100;
  plusDI[period] = isNaN(firstPlusDI) ? 0 : firstPlusDI;
  minusDI[period] = isNaN(firstMinusDI) ? 0 : firstMinusDI;
  const firstDX = Math.abs(plusDI[period] - minusDI[period]) / (plusDI[period] + minusDI[period]) * 100;
  dx[period] = isNaN(firstDX) ? 0 : firstDX;

  for (let i = period + 1; i < n; i++) {
    trSmooth = trSmooth - trSmooth / period + tr[i];
    plusDMSmooth = plusDMSmooth - plusDMSmooth / period + plusDM[i];
    minusDMSmooth = minusDMSmooth - minusDMSmooth / period + minusDM[i];
    const pdi = (plusDMSmooth / trSmooth) * 100;
    const mdi = (minusDMSmooth / trSmooth) * 100;
    plusDI[i] = isNaN(pdi) ? 0 : pdi;
    minusDI[i] = isNaN(mdi) ? 0 : mdi;
    const currentDX = (pdi + mdi) !== 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0;
    dx[i] = isNaN(currentDX) ? 0 : currentDX;
  }

  const adx = new Array(n).fill(0);
  let dxSum = dx.slice(period, period * 2).reduce((a, b) => a + b, 0);
  adx[period * 2 - 1] = dxSum / period;

  for (let i = period * 2; i < n; i++) {
    dxSum = dxSum - dxSum / period + dx[i];
    adx[i] = dxSum / period;
  }

  return adx.slice(period * 2 - 1).map(val => Math.max(0, parseFloat(val.toFixed(2))));
}
// === GRÁFICOS ===
function initChart() {
  const chartContainer = document.getElementById('chart');
  chart = LightweightCharts.createChart(chartContainer, {
    layout: { backgroundColor: '#121212', textColor: 'white' },
    grid: { vertLines: { color: '#333' }, horzLines: { color: '#333' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    priceScale: { borderColor: '#444' },
    timeScale: { borderColor: '#444' }
  });
  dataSeries = chart.addCandlestickSeries({
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderVisible: false,
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350'
  });
}

// === DATOS ===
async function obtenerDatos(symbol = 'BTCUSDT', interval = '1m', limit = 60) {
  const res = await fetch(`/api/binance/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  const klines = await res.json();
  return klines.map(k => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5])
   
  
  }));
}

async function obtenerOpenInterest(symbol = 'BTCUSDT') {
  const res = await fetch(`/api/binance/futures/open-interest?symbol=${symbol}`);
  if (!res.ok) return 0;
  const data = await res.json();
  return data.openInterest || 0;
}

// === MODELO IA ===
async function crearModelo() {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [23] }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
  model.compile({ optimizer: 'adam', loss: 'binaryCrossentropy', metrics: ['accuracy'] });
  return model;
}
function prepararDatosParaIA(klines, openInterest = 0) {
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const rsi = calcularRSI(closes, 14);
  const ema = calcularEMA(closes, 20);
  const { macdLine, signalLine } = calcularMACD(closes, 12, 26, 9);
  const { media: bbMedia, superior: bbSuperior, inferior: bbInferior } = calcularBandasBollinger(closes, 20, 2);
  const atr = calcularATR(klines, 14);
  const obv = calcularOBV(klines);
  const X = [], y = [];
  for (let i = 30; i < klines.length - 1; i++) {
    const ventana = closes.slice(i - 10, i);
    const cambios = ventana.map((p, idx) => idx === 0 ? 0 : (p - ventana[idx - 1]) / ventana[idx - 1]);
    const features = [
      ...cambios,
      volumes.slice(i - 10, i).reduce((a, b) => a + b, 0) / 10 / 1e6,
      (rsi[i] || 50) / 100,
      closes[i] > (ema[i] || closes[i]) ? 1 : 0,
      (rsi[i] || 50) > 70 ? 1 : 0,
      (rsi[i] || 50) < 30 ? 1 : 0,
      (macdLine[i] || 0) / 1000,
      (signalLine[i - 17] || 0) / 1000,
      ((macdLine[i] || 0) - (signalLine[i - 17] || 0)) / 1000,
      ((closes[i] - (bbInferior[i] || closes[i])) / ((bbSuperior[i] || closes[i]) - (bbInferior[i] || closes[i])) || 0.5),
      ((bbSuperior[i] || closes[i]) - (bbInferior[i] || closes[i])) / closes[i],
      (atr[i] || 0) / closes[i],
      (obv[i] || 0) / 1e9,
      openInterest / 1e6
    ];
    const futuro = closes[i + 1];
    X.push(features);
    y.push(futuro > closes[i] ? 1 : 0);
  }
  return { X: tf.tensor2d(X), y: tf.tensor2d(y, [y.length, 1]) };
}
async function entrenarRed() {
  document.getElementById('estado').textContent = '⏳ Descargando datos...';
  try {
    const klines = await obtenerDatos(simboloActual, '15m', 1000);
    const openInterest = await obtenerOpenInterest(simboloActual);
    const { X, y } = prepararDatosParaIA(klines, openInterest);
    if (X.shape[0] === 0) throw new Error('Datos insuficientes');
    document.getElementById('estado').textContent = '🧠 Entrenando...';
    modelo = await crearModelo();
    await modelo.fit(X, y, { epochs: 30, batchSize: 32, verbose: 0 });
    X.dispose(); y.dispose();
    document.getElementById('estado').textContent = '✅ Modelo listo';
  } catch (err) {
    document.getElementById('estado').textContent = `❌ ${err.message}`;
  }
}
async function predecir(ultimosPrecios, ultimosVolumenes, rsiActual, emaActual, macdActual, signalActual, posicionBB, anchoBB, atrActual, obvActual, precioActual, openInterest = 0) {
  if (!modelo) return null;
  const ultimos10 = ultimosPrecios.slice(-10);
  const cambios = ultimos10.map((p, idx) => idx === 0 ? 0 : (p - ultimos10[idx - 1]) / ultimos10[idx - 1]);
  const features = [
    ...cambios,
    ultimosVolumenes.slice(-10).reduce((a, b) => a + b, 0) / 10 / 1e6,
    rsiActual / 100,
    precioActual > emaActual ? 1 : 0,
    rsiActual > 70 ? 1 : 0,
    rsiActual < 30 ? 1 : 0,
    macdActual / 1000,
    signalActual / 1000,
    (macdActual - signalActual) / 1000,
    posicionBB,
    anchoBB / precioActual,
    atrActual / precioActual,
    obvActual / 1e9,
    openInterest / 1e6
  ];
  const input = tf.tensor2d([features]);
  const pred = modelo.predict(input);
  const valor = await pred.data();
  input.dispose(); pred.dispose();
  return valor[0];
}

// === PANEL FINANCIERO ===
function actualizarPanelFinanciero() {
  const gan = operaciones.filter(o => o.ganancia > 0).reduce((s, o) => s + o.ganancia, 0);
  const per = Math.abs(operaciones.filter(o => o.ganancia < 0).reduce((s, o) => s + o.ganancia, 0));
  const roi = ((capitalActual - capitalInicial) / capitalInicial) * 100;
  document.getElementById('roi').textContent = `${roi.toFixed(2)}%`;
}
function renderizarHistorial() {
  const tbody = document.querySelector('#historial tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  operaciones.slice(0, 10).forEach(op => {
    const ent = new Date(op.timestampEntrada).toLocaleTimeString();
    const sal = new Date(op.timestampSalida).toLocaleTimeString();
    const gan = op.ganancia !== undefined ? op.ganancia : 0;
    const color = gan >= 0 ? '#26a69a' : '#ef5350';
    const sim = gan >= 0 ? '+' : '';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${ent}</td>
      <td>${sal}</td>
      <td>$${(op.entrada || 0).toFixed(2)}</td>
      <td>$${(op.salida || 0).toFixed(2)}</td>
      <td style="color:${color}">${sim}$${gan.toFixed(2)}</td>
      <td>${op.resultado || '—'}</td>
    `;
    tbody.appendChild(row);
  });
}
function registrarOperacionReal(symbol, side, entrada, salida, cantidad, pnl) {
  const op = {
    entrada: entrada || 0,
    salida: salida || 0,
    ganancia: parseFloat(pnl) || 0,
    montoInvertido: Math.abs(cantidad * entrada),
    timestampEntrada: Date.now() - 60000,
    timestampSalida: Date.now(),
    resultado: (pnl >= 0) ? 'GANANCIA' : 'PÉRDIDA',
    simbolo: symbol
  };
  operaciones.unshift(op);
  if (operaciones.length > 50) operaciones = operaciones.slice(0, 50);
  localStorage.setItem('historialOperaciones', JSON.stringify(operaciones));
  actualizarPanelFinanciero();
  renderizarHistorial();
}

// === CAPITAL TESTNET ===
async function actualizarCapitalTestnet() {
  try {
    const res = await fetch('/api/binance/futures/account');
    const data = await res.json();
    let saldoUSDT = 0;
    if (data.availableBalance) saldoUSDT = parseFloat(data.availableBalance);
    else if (data.assets?.length) {
      const usdt = data.assets.find(a => a.asset === 'USDT');
      saldoUSDT = usdt ? parseFloat(usdt.walletBalance) : 0;
    }
    const ticker = await (await fetch('/api/binance/ticker?symbol=BTCUSDT')).json();
    const precioBTC = parseFloat(ticker.price) || 1;
    const saldoBTC = saldoUSDT / precioBTC;
    const montoInvertir = parseFloat(document.getElementById('montoCompra')?.value) || 10;
    // ✅ Actualizar solo valores (sin texto extra)
    const usdtEl = document.getElementById('saldo-usdt');
    const btcEl = document.getElementById('saldo-btc');
    const invEl = document.getElementById('monto-invertir');
    if (usdtEl) usdtEl.textContent = `$${saldoUSDT.toFixed(2)}`;
    if (btcEl) btcEl.textContent = `${saldoBTC.toFixed(6)} BTC`;
    if (invEl) invEl.textContent = `$${montoInvertir.toFixed(2)}`;
  } catch (err) {
    // ✅ Fallback seguro
    const usdtEl = document.getElementById('saldo-usdt');
    const btcEl = document.getElementById('saldo-btc');
    const invEl = document.getElementById('monto-invertir');
    const montoInvertir = parseFloat(document.getElementById('montoCompra')?.value) || 10;
    if (usdtEl) usdtEl.textContent = `$1000.00`;
    if (btcEl) btcEl.textContent = `0.000000 BTC`;
    if (invEl) invEl.textContent = `$${montoInvertir.toFixed(2)}`;
  }
}

// === ÓRDENES ===
// ✅ Función corregida y robusta para abrir posición
// ✅ openPosition corregida — solo envía orden MARKET
async function abrirPosicionReal(side) {
  try {
    const ticker = await (await fetch(`/api/binance/ticker?symbol=${simboloActual}`)).json();
    const precio = parseFloat(ticker.price);
    let monto = parseFloat(document.getElementById('montoCompra').value) || 10;
    
    // ✅ Asegurar notional mínimo de 100 USDT
    if (monto < 100) monto = 100;

    // ✅ Calcular cantidad con stepSize (usa symbolInfo si ya está cargado)
    let qty;
    if (symbolInfo && symbolInfo.stepSize) {
      qty = calculateQuantity(precio, monto);
    } else {
      const stepSize = 0.001; // fallback BTC
      qty = Math.floor((monto / precio) / stepSize) * stepSize;
    }

    const lev = parseInt(document.getElementById('apalancamiento').value) || 4;
    
    const res = await fetch('/api/binance/futures/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: simboloActual,
        side: side,
        quantity: qty.toString(),  // ✅ string, no número
        leverage: lev
      })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(`${err.msg || 'Error Binance'} (code: ${err.code})`);
    }
    
    document.getElementById('estado').textContent = `✅ ${side} ${qty} ${simboloActual}`;
    await actualizarPosicionesAbiertas();
  } catch (err) {
    console.error('🔴 abrirPosicionReal error:', err);
    const msg = err.message.includes('notional')
      ? '❌ Exposición < 100 USDT'
      : `❌ ${err.message}`;
    document.getElementById('estado').textContent = msg;
  }
}
async function cerrarPosicion(symbol, positionSide = 'BOTH') {
  try {
    const posResponse = await fetch('/api/binance/futures/positions');
    const posiciones = await posResponse.json();
    const posicion = Array.isArray(posiciones)
      ? posiciones.find(p => p.symbol === symbol && p.positionSide === positionSide)
      : null;
    if (!posicion || Math.abs(parseFloat(posicion.positionAmt)) < 0.0001) {
      throw new Error('Sin posición abierta');
    }
    // ✅ Extraer datos correctamente
    const precioEntrada = parseFloat(posicion.entryPrice) || parseFloat(posicion.markPrice) || 0;
    const positionAmt = parseFloat(posicion.positionAmt) || 0;
    const cantidad = Math.abs(positionAmt);
    const sideActual = positionAmt > 0 ? 'LONG' : 'SHORT';
    // ✅ Cerrar posición
    const closeRes = await fetch('/api/binance/futures/close-position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, positionSide })
    });
    const resultado = await closeRes.json();
    const precioSalida = parseFloat(resultado.avgPrice) || parseFloat(posicion.markPrice) || precioEntrada;
    const pnl = sideActual === 'LONG'
      ? (precioSalida - precioEntrada) * cantidad
      : (precioEntrada - precioSalida) * cantidad;
    registrarOperacionReal(symbol, sideActual, precioEntrada, precioSalida, cantidad, pnl);
    document.getElementById('estado').textContent = `CloseOperation exitosa`;
    await actualizarPosicionesAbiertas();
  } catch (err) {
    document.getElementById('estado').textContent = `CloseOperation fallida: ${err.message}`;
  }
}
async function actualizarPosicionesAbiertas() {
  try {
    const data = await (await fetch('/api/binance/futures/positions')).json();
    const tbody = document.querySelector('#operaciones-abiertas tbody');
    tbody.innerHTML = '';
    data.filter(p => Math.abs(parseFloat(p.positionAmt)) > 0.0001).forEach(pos => {
      const size = parseFloat(pos.positionAmt);
      const entry = parseFloat(pos.entryPrice);
      const mark = parseFloat(pos.markPrice);
      const pnl = parseFloat(pos.unRealizedProfit);
      const roe = ((mark - entry) / entry) * (size > 0 ? 1 : -1) * 100;
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${pos.symbol}</td>
        <td>${size > 0 ? 'LONG' : 'SHORT'}</td>
        <td>$${entry.toFixed(2)}</td>
        <td>${roe.toFixed(2)}%</td>
        <td>$${pnl.toFixed(2)}</td>
        <td><button class="btn btn-outline" style="padding:4px 8px;font-size:0.8em;" onclick="cerrarPosicion('${pos.symbol}', '${pos.positionSide}')">CloseOperation</button></td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    console.error('Error actualizando posiciones:', err);
  }
}

// === SEMÁFORO ===
function actualizarSemaforo({ adx = 0, confianza = 0, preciosLen = 0, modo = 'volatil', alcista = false, bajista = false } = {}) {
  const adxOk = adx > 20;
  const predOk = confianza > 0.6;
  const datosOk = preciosLen >= 55;

  // ✅ Modo solo es "OK" si es coherente con la tendencia real
  let modoOk = false;
  if (modo === 'volatil') {
    modoOk = true;
  } else if (modo === 'alcista') {
    modoOk = alcista; // ✅ requiere EMA20 > EMA50
  } else if (modo === 'bajista') {
    modoOk = bajista; // ✅ requiere EMA20 < EMA50
  }

  const adxEl = document.getElementById('cond-adx');
  const modoEl = document.getElementById('cond-modo');
  const predEl = document.getElementById('cond-pred');
  const datosEl = document.getElementById('cond-datos');
  const msgEl = document.getElementById('semaforo-msg');

  if (adxEl) adxEl.style.backgroundColor = adxOk ? '#26a69a' : '#ef5350';
  if (modoEl) modoEl.style.backgroundColor = modoOk ? '#26a69a' : '#ef5350';
  if (predEl) predEl.style.backgroundColor = predOk ? '#26a69a' : '#ef5350';
  if (datosEl) datosEl.style.backgroundColor = datosOk ? '#26a69a' : '#ef5350';

  if (msgEl) {
    if (adxOk && modoOk && predOk && datosOk) {
      msgEl.textContent = '✅ Listo para operar';
      msgEl.style.color = '#26a69a';
    } else {
      msgEl.textContent = '❌ Condiciones no cumplidas';
      msgEl.style.color = '#ef5350';
    }
  }
}

// === STREAMING ===
// === STREAMING ===
async function iniciarStreaming() {
  if (streamingInterval) return;
  if (!modelo) { alert('Entrena el modelo primero'); return; }
  simboloActual = document.getElementById('simbolo').value.toUpperCase();

  let klines = await obtenerDatos(simboloActual, '1m', 60);
  precios = klines.map(k => k.close);
  ultimoPrecio = klines[klines.length - 1].close;
  dataSeries.setData(klines);

  // ✅ Cargar info del símbolo 1 vez
  if (!symbolInfo) await fetchSymbolInfo(simboloActual);

  let atrGlobal = 0;

  streamingInterval = setInterval(async () => {
    try {
      const ticker = await (await fetch(`/api/binance/ticker?symbol=${simboloActual}`)).json();
      ultimoPrecio = parseFloat(ticker.price);
      const ahora = Math.floor(Date.now() / 1000);
      const ultimaVela = klines[klines.length - 1];
      if (ahora - ultimaVela.time >= 60) {
        klines.push({ time: ahora, open: ultimaVela.close, high: Math.max(ultimaVela.close, ultimoPrecio), low: Math.min(ultimaVela.close, ultimoPrecio), close: ultimoPrecio, volume: 0 });
        precios.push(ultimoPrecio);
        dataSeries.update(klines[klines.length - 1]);
      } else {
        klines[klines.length - 1] = { ...ultimaVela, high: Math.max(ultimaVela.high, ultimoPrecio), low: Math.min(ultimaVela.low, ultimoPrecio), close: ultimoPrecio };
        dataSeries.update(klines[klines.length - 1]);
      }

      // ✅ Recalcular indicadores (usar últimos 100 datos)
      const closes = klines.slice(-100).map(k => k.close);
      const rsi = calcularRSI(closes, 14);
      const ema20 = calcularEMA(closes, 20);
      const ema50 = calcularEMA(closes, 50);
      const { macdLine, signalLine } = calcularMACD(closes, 12, 26, 9);
      const { media: bbMedia, superior: bbSuperior, inferior: bbInferior } = calcularBandasBollinger(closes, 20, 2);
      const atrArr = calcularATR(klines.slice(-100), 14);
      const adxArr = calcularADX(klines.slice(-100), 14);
      const obv = calcularOBV(klines.slice(-100));

      const rsiActual = rsi[rsi.length - 1] || 50;
      const e20 = ema20[ema20.length - 1] || ultimoPrecio;
      const e50 = ema50[ema50.length - 1] || ultimoPrecio;
      const macdActual = macdLine[macdLine.length - 1] || 0;
      const signalActual = signalLine[signalLine.length - 1] || 0;
      const bbInf = bbInferior[bbInferior.length - 1] || ultimoPrecio;
      const bbSup = bbSuperior[bbSuperior.length - 1] || ultimoPrecio;
      const anchoBB = bbSup - bbInf;
      const posicionBB = anchoBB > 0 ? (ultimoPrecio - bbInf) / anchoBB : 0.5;
      atrGlobal = atrArr[atrArr.length - 1] || 0;
      const adxActual = adxArr.length > 0 ? adxArr[adxArr.length - 1] : 0;
      const obvActual = obv[obv.length - 1] || 0;

      // ✅ Mostrar ADX y ATR SIEMPRE
      const adxE = document.getElementById('adx-valor');
      const atrE = document.getElementById('atr-valor');
      if (adxE) adxE.textContent = adxActual.toFixed(1);
      if (atrE) atrE.textContent = `ATR: ${atrGlobal.toFixed(2)}`;

      // ✅ TP/SL estimado (sin posición)
      const tpPct = (atrGlobal * 6 / ultimoPrecio) * 100;
      const slPct = (atrGlobal * 3 / ultimoPrecio) * 100;
      const tpEl = document.getElementById('tp-dinamico');
      const slEl = document.getElementById('sl-dinamico');
      if (tpEl) tpEl.textContent = `TP: ${tpPct.toFixed(2)}%`;
      if (slEl) slEl.textContent = `SL: ${slPct.toFixed(2)}%`;

      const openInterest = await obtenerOpenInterest(simboloActual);
      let prediccionRaw = null, confianza = 0;
      if (precios.length >= 30) {
        prediccionRaw = await predecir(
          precios.slice(-10),
          klines.slice(-10).map(k => k.volume),
          rsiActual,
          e20,
          macdActual,
          signalActual,
          posicionBB,
          anchoBB,
          atrGlobal,
          obvActual,
          ultimoPrecio,
          openInterest
        );
      }

      if (prediccionRaw != null && !isNaN(prediccionRaw)) {
        confianza = prediccionRaw > 0.5 ? prediccionRaw : 1 - prediccionRaw;
        const dir = prediccionRaw > 0.5 ? 'SUBIDA' : 'BAJADA';
        const porc = Math.round(confianza * 100);
        document.getElementById('prediccion-direccion').innerHTML = `${dir === 'SUBIDA' ? '🟢' : '🔴'} ${dir}`;
        document.getElementById('prediccion-porcentaje').textContent = `${porc}%`;
        const prog = document.getElementById('prediccion-progreso');
        if (prog) {
          prog.style.width = `${porc}%`;
          prog.style.backgroundColor = porc > 55 ? (dir === 'SUBIDA' ? '#26a69a' : '#ef5350') : '#666';
        }
      } else {
        document.getElementById('prediccion-direccion').textContent = '—';
        document.getElementById('prediccion-porcentaje').textContent = '—';
        const prog = document.getElementById('prediccion-progreso');
        if (prog) prog.style.width = '0%';
      }

      // ✅ Semáforo
     
      // 🔍 Diagnóstico ADX (temporal)
     // ✅ Solo ejecutar el debug si adxArray existe
if (typeof adxArray !== 'undefined') {
  console.log('📈 [DEBUG ADX]', {
   adxArrayLength: (typeof adxArray !== 'undefined') ? adxArray.length : 0,
    adxActualRaw: (typeof adxArray !== 'undefined' && adxArray.length > 0) ? adxArray[adxArray.length - 1] : 0,
    adxActual: adxActual,
    klinesLength: klines.length
  });
}

// ✅ Semáforo (siempre se puede actualizar)
const modo = document.getElementById('modo-mercado')?.value || 'volatil';
actualizarSemaforo({ adx: adxActual, confianza, preciosLen: precios.length, modo });

      // === TRADING ===
// === TRADING AUTOMÁTICO ===
if (!document.getElementById('autoTrading')?.checked) return;

const posiciones = await (await fetch('/api/binance/futures/positions')).json();
const posicionActual = posiciones.find(p => p.symbol === simboloActual && Math.abs(parseFloat(p.positionAmt)) > 0.0001);

if (posicionActual) {
  // ... (lógica de cierre, ya está bien) ...
  const size = parseFloat(posicionActual.positionAmt);
  const entryPrice = parseFloat(posicionActual.entryPrice);
  const markPrice = parseFloat(posicionActual.markPrice);
  const leverage = parseFloat(posicionActual.leverage);
  const esLong = size > 0;
  const esShort = size < 0;

  let atrTPSL = 0;
  try {
    const k5m = await obtenerDatos(simboloActual, '5m', 50);
    if (k5m.length >= 20) {
      const a = calcularATR(k5m, 14);
      atrTPSL = a[a.length - 1] || 0;
    }
  } catch (e) {
    const a = calcularATR(klines.slice(-50), 14);
    atrTPSL = a[a.length - 1] || 0;
  }

  const sl = atrTPSL * 3;
  const tp = atrTPSL * 6;
  const slPct = (sl / entryPrice) * 100;
  const tpPct = (tp / entryPrice) * 100;

  const tpEl = document.getElementById('tp-dinamico');
  const slEl = document.getElementById('sl-dinamico');
  if (tpEl) tpEl.textContent = `TP: ${tpPct.toFixed(2)}%`;
  if (slEl) slEl.textContent = `SL: ${slPct.toFixed(2)}%`;

  const roePct = ((markPrice - entryPrice) / entryPrice) * leverage * (esLong ? 1 : -1) * 100;
  if (roePct >= tpPct || roePct <= -slPct || 
     (prediccionRaw != null && confianza >= 0.6 && 
     ((esLong && prediccionRaw <= 0.5) || (esShort && prediccionRaw > 0.5)))) {
    cerrarPosicion(simboloActual, posicionActual.positionSide);
  }

} else {
  // ✅ Calcular ADX aquí, dentro del mismo scope
  let adxVal = 0;
  if (precios.length >= 30) {
    const adxArray = calcularADX(klines, 14);
    adxVal = adxArray.length > 0 ? adxArray[adxArray.length - 1] : 0;
  }

  if (prediccionRaw != null && confianza >= 0.6 && precios.length >= 55 && adxVal > 20) {
    const ema20 = calcularEMA(precios, 20);
    const ema50 = calcularEMA(precios, 50);
    const idx = Math.min(ema20.length, ema50.length) - 1;
    if (idx < 0) return;
    const e20 = ema20[idx], e50 = ema50[idx];
    const alcista = e20 > e50, bajista = e20 < e50;
    const side = prediccionRaw > 0.5 ? 'BUY' : 'SELL';
    
    const modo = document.getElementById('modo-mercado')?.value || 'volatil';
    let operar = false;
    if (modo === 'alcista' && side === 'BUY' && alcista) operar = true;
    else if (modo === 'bajista' && side === 'SELL' && bajista) operar = true;
    else if (modo === 'volatil' && ((side === 'BUY' && alcista) || (side === 'SELL' && bajista))) operar = true;

    if (operar) abrirPosicionReal(side);
  }
}

    } catch (err) { 
      console.error('Streaming error:', err);
      document.getElementById('estado').textContent = `⚠️ ${err.message}`;
    }
  }, 10000);
}
async function detenerStreaming() {
  if (streamingInterval) clearInterval(streamingInterval);
  streamingInterval = null;
  document.getElementById('estado').textContent = '⏹️ Detenido';
}

// ✅ Función corregida para abrir posición (compatible con tu sistema)

// === INICIALIZACIÓN ===
window.onload = () => {
  initChart();
  // Valores iniciales
  takeProfitPct = parseFloat(document.getElementById('takeProfit').value) || 5.0;
  stopLossPct = parseFloat(document.getElementById('stopLoss').value) || 3.0;
  maxOperaciones = parseInt(document.getElementById('maxOperaciones')?.value) || 3;
  // ✅ Forzar actualización inmediata del capital
  actualizarCapitalTestnet();
  // Eventos
  const btnReiniciar = document.getElementById('btn-reiniciar');
  if (btnReiniciar) btnReiniciar.onclick = () => {
    capitalActual = capitalInicial = 1000;
    operaciones = [];
    actualizarPanelFinanciero();
    renderizarHistorial();
  };
  const btnExportar = document.getElementById('btn-exportar');
  if (btnExportar) btnExportar.onclick = () => {
    const csv = ['"Entrada","Salida","Ganancia"'].concat(
      operaciones.map(o => `"${new Date(o.timestampEntrada).toISOString()}","${new Date(o.timestampSalida).toISOString()}","${o.ganancia.toFixed(2)}"`)
    ).join('\n');
    const a = document.createElement('a');
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    a.download = `trading_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };
  // Cargar historial
  const hist = JSON.parse(localStorage.getItem('historialOperaciones') || '[]');
  if (hist.length > 0) {
    operaciones = hist;
    actualizarPanelFinanciero();
    renderizarHistorial();
  }
  // Métodos globales
  window.entrenarRed = entrenarRed;
  window.iniciarStreaming = iniciarStreaming;
  window.detenerStreaming = detenerStreaming;
 
 window.operacionPrueba = async () => {
  const dir = document.getElementById('prediccion-direccion').textContent;
  
  // ✅ 1. Permitir órdenes SIEMPRE (modo prueba), sin bloqueo por ADX
  //    (solo advertencia, no bloqueo)
  const adxE = document.getElementById('adx-valor');
  const adxActual = parseFloat(adxE?.textContent) || 0;
  if (adxActual < 20) {
    const continuar = confirm(`⚠️ ADX actual: ${adxActual.toFixed(1)} (< 20)\nEsto es solo una prueba (no automática).\n¿Deseas continuar igual?`);
    if (!continuar) return;
  }

  // ✅ 2. Validar que haya señal clara
  if (!dir.includes('SUBIDA') && !dir.includes('BAJADA')) {
    alert('⚠️ No hay señal clara. Espera a que la IA defina dirección.');
    return;
  }

  // ✅ 3. Usar LA FUNCIÓN QUE SÍ FUNCIONA: abrirPosicionReal
  try {
    if (dir.includes('SUBIDA')) {
      await abrirPosicionReal('BUY');
    } else if (dir.includes('BAJADA')) {
      await abrirPosicionReal('SELL');
    }
  } catch (err) {
    console.error('🔴 Error en operación manual:', err);
    alert(`❌ Falló la orden: ${err.message || 'Error desconocido'}`);
  }
};
  window.cerrarPosicion = cerrarPosicion;
  // Actualizaciones periódicas
  setInterval(actualizarPosicionesAbiertas, 10000);
  setInterval(actualizarCapitalTestnet, 60000);
// Cargar info del símbolo 1 vez
fetchSymbolInfo(simboloActual).catch(console.warn);

};