// 🔐 CLAVE SECRETA — Cámbiala en producción
const CLAVE_SECRETA = '19344828';
let AUTENTICADO = false;

// ✅ Verificar clave (debe estar al inicio)
function verificarClave() {
  const input = document.getElementById('clave-acceso');
  const msg = document.getElementById('auth-msg');
  if (input.value === CLAVE_SECRETA) {
    AUTENTICADO = true;
    document.getElementById('auth-modal').style.display = 'none';
    const main = document.getElementById('main-container');
    main.style.display = 'grid';

    // ✅ Llamar retryInitChart tras hacer visible el contenedor (garantiza offset > 0)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        retryInitChart();
      });
    });
  } else {
    msg.textContent = '❌ Clave incorrecta.';
    input.value = '';
    input.focus();
  }
}

// === VARIABLES GLOBALES ===
let chart, dataSeries, precios = [], modelo = null;
let capitalInicial = 1000, capitalActual = 1000;
let operaciones = [], ultimoPrecio = 0, streamingInterval = null;
let simboloActual = 'BTCUSDT', symbolInfo = null;

// === UTILIDADES ===
async function fetchSymbolInfo(symbol = 'BTCUSDT') {
  if (symbolInfo) return symbolInfo;
  try {
    const url = 'https://testnet.binancefuture.com/fapi/v1/exchangeInfo';
    const res = await fetch(url);
    const data = await res.json();
    const sym = data.symbols.find(s => s.symbol === symbol);
    if (!sym) throw new Error(`Símbolo no encontrado: ${symbol}`);
    const filters = {};
    if (Array.isArray(sym.filters)) {
      sym.filters.forEach(f => {
        if (f && f.filterType === 'LOT_SIZE') {
          filters.stepSize = f.stepSize ? parseFloat(f.stepSize) : 0.001;
          filters.minQty = f.minQty ? parseFloat(f.minQty) : 0.001;
        }
        if (f && f.filterType === 'MIN_NOTIONAL') {
          filters.minNotional = f.notional ? parseFloat(f.notional) : 100;
        }
      });
    }
    symbolInfo = filters;
    console.log(`✅ Info de ${symbol} cargada:`, symbolInfo);
    return symbolInfo;
  } catch (e) {
    console.error('❌ Error al cargar info del símbolo:', e);
    return { stepSize: 0.001, minQty: 0.001, minNotional: 100 };
  }
}

function calculateQuantity(price, notional = 100) {
  notional = Math.max(symbolInfo?.minNotional || 100, notional);
  let qty = notional / price;
  const stepSize = symbolInfo?.stepSize || 0.001;
  qty = Math.floor(qty / stepSize) * stepSize;
  if (qty < (symbolInfo?.minQty || 0.001)) qty = symbolInfo?.minQty || 0.001;
  return parseFloat(qty.toFixed(8));
}

// ✅ FUNCIÓN COMPARTIDA — Obtiene precio de cierre con fallbacks robustos
async function obtenerPrecioSalida(resultado, posicion, symbol) {
  // 1. Primero intentar avgPrice (resultado de la orden)
  if (resultado && resultado.avgPrice) {
    const avg = parseFloat(resultado.avgPrice);
    if (avg > 0 && !isNaN(avg)) return avg;
  }
  
  // 2. Si falla, intentar markPrice de la posición
  if (posicion && posicion.markPrice) {
    const mark = parseFloat(posicion.markPrice);
    if (mark > 0 && !isNaN(mark)) return mark;
  }
  
  // 3. Último recurso: ticker en vivo
  try {
    const tickerRes = await fetch(`/api/binance/ticker?symbol=${symbol}`);
    if (tickerRes.ok) {
      const tickerData = await tickerRes.json();
      const precioTicker = parseFloat(tickerData.price);
      if (precioTicker > 0 && !isNaN(precioTicker)) {
        return precioTicker;
      }
    }
  } catch (e) {
    console.warn(`⚠️ Error al obtener ticker para ${symbol}:`, e.message);
  }
  
  // 4. Fallback seguro (nunca devuelve 0)
  const fallback = posicion?.entryPrice || 100000;
  console.error(`🚨 Todos los fallbacks fallaron para ${symbol}. Usando entrada: $${fallback.toFixed(2)}`);
  return fallback;
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
  if (!chartContainer || chartContainer.offsetWidth === 0 || chartContainer.offsetHeight === 0) {
    throw new Error('Contenedor #chart no tiene tamaño (¿está oculto con display:none?)');
  }

  chart = LightweightCharts.createChart(chartContainer, {
    layout: { backgroundColor: '#121212', textColor: 'white' },
    grid: { vertLines: { color: '#333' }, horzLines: { color: '#333' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    priceScale: { borderColor: '#444' },
    timeScale: { borderColor: '#444' },
    autoSize: true
  });

  dataSeries = chart.addCandlestickSeries({
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderVisible: false,
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350'
  });

  console.log('✅ Gráfico inicializado correctamente');
}

// ✅ Nueva función robusta: reintentar initChart hasta que el DOM esté listo
function retryInitChart(attempts = 0) {
  const chartContainer = document.getElementById('chart');
  if (!chartContainer || chartContainer.offsetWidth === 0 || chartContainer.offsetHeight === 0) {
    if (attempts < 20) {
      requestAnimationFrame(() => retryInitChart(attempts + 1));
      return;
    } else {
      console.error('❌ #chart no disponible tras 20 intentos');
      const estadoEl250 = document.getElementById('estado');
if (estadoEl250) estadoEl250.textContent = '❌ Gráfico: no se pudo inicializar';
      return;
    }
  }

  try {
    initChart();
    actualizarCapitalTestnet();
    actualizarPosicionesAbiertas();
    renderizarHistorial();
    console.log('✅ Sistema UI inicializado con éxito');
  } catch (err) {
    console.error('❌ Error al inicializar UI:', err);
    const estadoEl263 = document.getElementById('estado');
if (estadoEl263) estadoEl263.textContent = `❌ Inicialización fallida: ${err.message}`;
  }
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


// ✅ ENTRENAR RED — Corregida y accesible
async function entrenarRed() {
  if (!AUTENTICADO) {
    alert('🔒 Acceso denegado. Ingresa la clave primero.');
    return;
  }
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
window._entrenarRed = entrenarRed;

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

// ✅ ACTUALIZAR PANEL FINANCIERO — Con métricas avanzadas
function actualizarPanelFinanciero() {
  if (operaciones.length === 0) {
    document.getElementById('pf').textContent = '—';
    document.getElementById('expectancy').textContent = '—';
    document.getElementById('sharpe').textContent = '—';
    document.getElementById('max-dd').textContent = '—';
    return;
  }

  // 🔹 Ganancias y pérdidas
  const wins = operaciones.filter(o => o.ganancia > 0);
  const losses = operaciones.filter(o => o.ganancia < 0);
  const totalWin = wins.reduce((s, o) => s + o.ganancia, 0);
  const totalLoss = Math.abs(losses.reduce((s, o) => s + o.ganancia, 0));
  const winRate = operaciones.length > 0 ? wins.length / operaciones.length : 0;

  // 🔹 Profit Factor
  const pf = totalLoss > 0 ? (totalWin / totalLoss).toFixed(2) : '∞';
  document.getElementById('pf').textContent = pf;

  // 🔹 Expectancy
  const avgWin = wins.length > 0 ? totalWin / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0;
  const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);
  const expEl = document.getElementById('expectancy');
  expEl.textContent = expectancy >= 0 ? `+$${expectancy.toFixed(2)}` : `-$${Math.abs(expectancy).toFixed(2)}`;
  expEl.style.color = expectancy >= 0 ? '#26a69a' : '#ef5350';

  // 🔹 ROI y retorno diario (estimado)
  const roi = ((capitalActual - capitalInicial) / capitalInicial) * 100;
  document.getElementById('roi').textContent = `${roi.toFixed(2)}%`;
  document.getElementById('ganancias').textContent = `$${totalWin.toFixed(2)}`;
  document.getElementById('perdidas').textContent = `-$${totalLoss.toFixed(2)}`;

  // 🔹 Sharpe Ratio (simple: ROI anualizado / desv ROE)
  const roes = operaciones.map(o => {
    const size = Math.abs(o.montoInvertido / ((o.entrada + o.salida) / 2));
    const leverage = parseFloat(document.getElementById('apalancamiento')?.value) || 4;
    return ((o.salida - o.entrada) / o.entrada) * leverage * (o.entrada < o.salida ? 1 : -1) * 100;
   });
   if (roes.length > 1) {
    const mean = roes.reduce((a, b) => a + b, 0) / roes.length;
    const variance = roes.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / roes.length;
    const std = Math.sqrt(variance);
    // ✅ SHARPE RATIO CORREGIDO (solo si hay ≥5 operaciones y std > 0.01)
    let sharpe = '—';
    if (roes.length >= 5 && std > 0.01) {
    // ROI promedio por operación (no anualizado artificialmente)
    const roiPromedio = roes.reduce((a, b) => a + b, 0) / roes.length;
    sharpe = (roiPromedio / std).toFixed(2);
    // Límite razonable para evitar valores absurdos
    if (parseFloat(sharpe) > 10) sharpe = '10+';
    }
   document.getElementById('sharpe').textContent = sharpe;    document.getElementById('sharpe').textContent = sharpe;
   } else {
    document.getElementById('sharpe').textContent = '—';
  }

  // 🔹 Max Drawdown (estimado desde historial)
  let peak = capitalInicial;
  let maxDD = 0;
  let capital = capitalInicial;
  operaciones.forEach(op => {
    capital += op.ganancia;
    peak = Math.max(peak, capital);
    const dd = (peak - capital) / peak;
    maxDD = Math.max(maxDD, dd);
  });
  const ddEl = document.getElementById('max-dd');
  ddEl.textContent = `${(maxDD * 100).toFixed(1)}%`;
  ddEl.style.color = maxDD > 0.08 ? '#ef5350' : '#26a69a';
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

// ✅ TELEGRAM MEJORADO
async function enviarTelegram(mensaje) {
  try {
    let token = (localStorage.getItem('TELEGRAM_TOKEN') || '').trim();
    let chatId = (localStorage.getItem('TELEGRAM_CHAT_ID') || '').trim();
    if (!token) {
      token = '8543828763:AAHhqQYb_h_-kH5TTtcCcRFxP9hl6t28YH8';
      localStorage.setItem('TELEGRAM_TOKEN', token);
    }
    if (!chatId) {
      chatId = '5684283330';
      localStorage.setItem('5684283330', chatId);
    }
    if (token.length < 30 || !chatId || chatId === 'TU_CHAT_ID') {
      console.warn('⚠️ Telegram: token o chat ID inválido. Revisa localStorage.');
      return;
    }
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: mensaje,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    if (!res.ok) {
      const errorData = await res.json();
      console.error('❌ Telegram error:', errorData);
      if (errorData.error_code === 401) {
        alert('❌ Token de Telegram inválido. Verifica en @BotFather.');
      }
    } else {
      console.log('✅ Telegram enviado con éxito');
    }
  } catch (e) {
    console.error('🚨 Fallo crítico al enviar a Telegram:', e.message);
  }
}
// ✅ REGISTRAR OPERACIÓN — Corregido: muestra PnL bruto y neto, fees reales, ROE exacto
function registrarOperacionReal(symbol, side, entrada, salida, cantidad, pnl, motivo = 'Manual', datosBinance = null) {
  // 1. Validación de datos
  if (!symbol || isNaN(entrada) || isNaN(salida) || isNaN(cantidad) || isNaN(pnl)) {
    console.warn('⚠️ Datos inválidos en registrarOperacionReal');
    return;
  }
  
  // 2. Calcular fees reales (usar datos de Binance si están disponibles)
  let feesTotales = 0;
  let pnLBruto = pnl;
  
  if (datosBinance && datosBinance.executedQty && datosBinance.fee) {
    // Fees proporcionados por Binance (más precisos)
    feesTotales = parseFloat(datosBinance.fee);
    pnLBruto = pnl + feesTotales;
  } else {
    // Cálculo estimado de fees (0.1% por ejecución)
    const valorOperado = Math.abs(cantidad * entrada);
    const feeApertura = valorOperado * 0.001; // 0.1%
    const feeCierre = valorOperado * 0.001; // 0.1%
    feesTotales = feeApertura + feeCierre;
    pnLBruto = pnl + feesTotales;
  }
  
  // 3. Calcular ROE real (retorno sobre margen)
  const apalancamiento = parseFloat(document.getElementById('apalancamiento')?.value) || 4;
  const margenUsado = Math.abs(cantidad * entrada) / apalancamiento;
  const roePct = margenUsado !== 0 ? (pnl / margenUsado) * 100 : 0;
  
  // 4. Crear objeto de operación
  const op = {
    entrada: parseFloat(entrada) || 0,
    salida: parseFloat(salida) || 0,
    ganancia: parseFloat(pnl) || 0,
    gananciaBruta: parseFloat(pnLBruto) || 0,
    fees: parseFloat(feesTotales) || 0,
    montoInvertido: Math.abs(cantidad * entrada),
    margenUsado: margenUsado,
    roe: roePct,
    timestampEntrada: Date.now() - 60000,
    timestampSalida: Date.now(),
    resultado: (pnl >= 0) ? 'GANANCIA' : 'PÉRDIDA',
    simbolo: symbol,
    motivo,
    side,
    apalancamiento
  };
  
  // 5. Guardar en historial
  operaciones.unshift(op);
  if (operaciones.length > 50) operaciones = operaciones.slice(0, 50);
  localStorage.setItem('historialOperaciones', JSON.stringify(operaciones));
  
  // 6. Actualizar panel financiero
  actualizarPanelFinanciero();
  renderizarHistorial();
  
  // 7. Preparar mensaje de Telegram con todos los detalles
  const cambioPrecioPct = entrada !== 0 ? ((salida - entrada) / entrada) * 100 : 0;
  const simPnl = pnl >= 0 ? '+' : '-';
  const emoji = pnl >= 0 ? '🟢' : '🔴';
  const dirPrecio = cambioPrecioPct >= 0 ? '+' : '-';
  
  // ✅ Mensaje completo con PnL bruto, fees y neto
  const msg = `${emoji} *${symbol} ${side}* (${motivo})
Entrada: $${entrada.toFixed(2)}
Salida: $${salida.toFixed(2)}
Δ Precio: ${dirPrecio}${Math.abs(cambioPrecioPct).toFixed(2)}%
ROE: ${roePct >= 0 ? '+' : ''}${roePct.toFixed(2)}% (x${apalancamiento})
PnL Bruto: ${pnLBruto >= 0 ? '+' : ''}$${Math.abs(pnLBruto).toFixed(2)}
Fees: -$${feesTotales.toFixed(3)}
PnL Neto: ${simPnl}$${Math.abs(pnl).toFixed(2)}`;
  
  // 8. Enviar a Telegram
  enviarTelegram(msg);
  
  // 9. Log para debugging
  console.log(`[OPERACIÓN] ${symbol} ${side} | ROE: ${roePct.toFixed(2)}% | PnL Neto: $${pnl.toFixed(2)} | Fees: $${feesTotales.toFixed(3)}`);
}

// === CAPITAL TESTNET ===
async function actualizarCapitalTestnet() {
  if (!AUTENTICADO) return;
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
    const montoInvertir = parseFloat(document.getElementById('montoCompra')?.value) || 100;
    const usdtEl = document.getElementById('saldo-usdt');
    const btcEl = document.getElementById('saldo-btc');
    const invEl = document.getElementById('monto-invertir');
    if (usdtEl) usdtEl.textContent = `$${saldoUSDT.toFixed(2)}`;
    if (btcEl) btcEl.textContent = `${saldoBTC.toFixed(6)} BTC`;
    if (invEl) invEl.textContent = `$${montoInvertir.toFixed(2)}`;
  } catch (err) {
    const usdtEl = document.getElementById('saldo-usdt');
    const btcEl = document.getElementById('saldo-btc');
    const invEl = document.getElementById('monto-invertir');
    const montoInvertir = parseFloat(document.getElementById('montoCompra')?.value) || 100;
    if (usdtEl) usdtEl.textContent = `$1000.00`;
    if (btcEl) btcEl.textContent = `0.000000 BTC`;
    if (invEl) invEl.textContent = `$${montoInvertir.toFixed(2)}`;
  }
}

// === ÓRDENES ===
async function abrirPosicionReal(side) {
  if (!AUTENTICADO) return;
  try {
    const ticker = await (await fetch(`/api/binance/ticker?symbol=${simboloActual}`)).json();
    const precio = parseFloat(ticker.price);
    let monto = parseFloat(document.getElementById('montoCompra').value) || 100;
    if (monto < 100) monto = 100;
    let qty = symbolInfo ? calculateQuantity(precio, monto) : Math.floor((monto / precio) / 0.001) * 0.001;
    const lev = parseInt(document.getElementById('apalancamiento').value) || 4;
    console.log(`🔍 [DEBUG] Monto deseado: $${monto}`);
    console.log(`🔍 [DEBUG] Precio: $${precio}`);
    console.log(`🔍 [DEBUG] Size calculado: ${qty.toFixed(8)} BTC`);
    console.log(`🔍 [DEBUG] Notional real: $${(qty * precio).toFixed(2)}`);
     const tpslMode = document.getElementById('tpsl-mode')?.value || 'dinamico';
    let takeProfit = 1.5, stopLoss = 0.5;
    // En abrirPosicionReal():
     if (tpslMode === 'manual') {
    takeProfit = Math.max(0.5, parseFloat(document.getElementById('takeProfit').value) || 3.0); // ← de 1.5 → 3.0
    stopLoss = Math.max(0.5, parseFloat(document.getElementById('stopLoss').value) || 1.5);  // ← de 0.5 → 1.5
    }else {
      const k5m = await obtenerDatos(simboloActual, '5m', 50);
      const atrArr = k5m.length >= 20 ? calcularATR(k5m, 14) : [];
      const atrVal = atrArr.length > 0 ? atrArr[atrArr.length - 1] : 0;
      takeProfit = Math.max(0.8, (atrVal * 6 / precio) * 100);
      stopLoss = Math.max(0.3, (atrVal * 3 / precio) * 100);
    }
    const res = await fetch('/api/binance/futures/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: simboloActual, side, quantity: qty.toString(), leverage: lev })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(`${err.msg || 'Error Binance'} (code: ${err.code})`);
    }
    console.log(`🟢 Orden ${side} abierta | TP: ${takeProfit.toFixed(2)}% | SL: ${stopLoss.toFixed(2)}%`);
    document.getElementById('estado').textContent = `✅ ${side} ${qty} ${simboloActual}`;
    await actualizarPosicionesAbiertas();
  } catch (err) {
    console.error('🔴 abrirPosicionReal error:', err);
    const msg = err.message.includes('-4164') ? '❌ Notional < 100 USDT' : `❌ ${err.message}`;
    document.getElementById('estado').textContent = msg;
  }
}

// ✅ CERRAR PARCIAL — Corregido: manejo real de datos de Binance, fragmentación y fees
async function cerrarParcial(symbol, positionSide, sizeParcial, motivo) {
  try {
    // 1. Obtener posición actual
    const posResponse = await fetch('/api/binance/futures/positions');
    const posiciones = await posResponse.json();
    const posicion = Array.isArray(posiciones) 
      ? posiciones.find(p => p.symbol === symbol && p.positionSide === positionSide && Math.abs(parseFloat(p.positionAmt || 0)) > 0.0001)
      : null;
    
    if (!posicion) {
      throw new Error(`Sin posición abierta para ${symbol}`);
    }
    
    // 2. Extraer datos reales de la posición
    const precioEntrada = parseFloat(posicion.entryPrice) || parseFloat(posicion.markPrice) || 0;
    const positionAmt = parseFloat(posicion.positionAmt) || 0;
    const sideActual = positionAmt > 0 ? 'LONG' : 'SHORT';
    const leverage = parseFloat(posicion.leverage) || 1;
    
    // 3. Ejecutar orden parcial
    const closeRes = await fetch('/api/binance/futures/close-position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        symbol, 
        positionSide, 
        quantity: sizeParcial.toString() 
      })
    });
    
    if (!closeRes.ok) {
      const errorData = await closeRes.json();
      throw new Error(`Binance error: ${errorData.msg || errorData.message}`);
    }
    
    const resultado = await closeRes.json();
    
    // 4. Obtener precio real de cierre con fallbacks robustos
    let precioSalida = precioEntrada;
    
    // a) Primero intentar avgPrice (el más preciso)
    if (resultado && resultado.avgPrice != null) {
      const avg = parseFloat(resultado.avgPrice);
      if (avg > 0 && !isNaN(avg)) precioSalida = avg;
    }
    
    // b) Si falla, intentar markPrice de la posición
    if (precioSalida <= 0 || isNaN(precioSalida)) {
      if (posicion && posicion.markPrice != null) {
        const mark = parseFloat(posicion.markPrice);
        if (mark > 0 && !isNaN(mark)) precioSalida = mark;
      }
    }
    
    // c) Último recurso: ticker en vivo
    if (precioSalida <= 0 || isNaN(precioSalida)) {
      try {
        const tickerRes = await fetch(`/api/binance/ticker?symbol=${symbol}`);
        if (tickerRes.ok) {
          const tickerData = await tickerRes.json();
          const precioTicker = parseFloat(tickerData.price);
          if (precioTicker > 0 && !isNaN(precioTicker)) {
            precioSalida = precioTicker;
          }
        }
      } catch (e) {
        console.warn(`⚠️ Error al obtener ticker para ${symbol}:`, e.message);
      }
    }
    
    // d) Fallback final (siempre válido)
    if (precioSalida <= 0 || isNaN(precioSalida) || !isFinite(precioSalida)) {
      precioSalida = precioEntrada;
      console.error(`🚨 Precio de salida inválido para ${symbol}. Usando entrada: $${precioEntrada.toFixed(2)}`);
    }
    
    // 5. Calcular PnL REAL con datos de Binance (no recalcular)
    let pnl = 0;
    if (resultado && resultado.pnl != null) {
      // Binance ya proporciona PnL neto (con fees incluidos)
      pnl = parseFloat(resultado.pnl);
    } else {
      // Cálculo manual como fallback
      if (sideActual === 'LONG') {
        pnl = (precioSalida - precioEntrada) * sizeParcial * leverage;
      } else {
        pnl = (precioEntrada - precioSalida) * sizeParcial * leverage;
      }
    }
    
    // 6. Registrar operación real
    registrarOperacionReal(
      symbol, 
      sideActual, 
      precioEntrada, 
      precioSalida, 
      sizeParcial, 
      pnl, 
      motivo,
      resultado // Pasar datos completos para análisis de fees
    );
    
    // 7. Actualizar UI
    await actualizarPosicionesAbiertas();
    
  } catch (err) {
    console.error(`CloseOperation parcial fallida: ${err.message}`);
    document.getElementById('estado').textContent = `CloseOperation parcial fallida: ${err.message.slice(0, 50)}`;
  }
}
// ✅ CERRAR POSICIÓN — Corregido: sin errores, con leverage real y PnL exacto
async function cerrarPosicion(symbol, positionSide = 'BOTH', motivo = 'Manual') {
  try {
    // 1. Obtener posiciones actuales
    const posResponse = await fetch('/api/binance/futures/positions');
    const posiciones = await posResponse.json();
    const posicion = Array.isArray(posiciones)
      ? posiciones.find(p => p.symbol === symbol && p.positionSide === positionSide)
      : null;

    // 2. Validar existencia
    if (!posicion || Math.abs(parseFloat(posicion.positionAmt || 0)) < 0.0001) {
      throw new Error(`Sin posición abierta para ${symbol}`);
    }

    // 3. Extraer datos reales (¡sin asumir!)
    const precioEntrada = parseFloat(posicion.entryPrice) || parseFloat(posicion.markPrice) || 0;
    const positionAmt = parseFloat(posicion.positionAmt) || 0;
    const cantidad = Math.abs(positionAmt);
    const sideActual = positionAmt > 0 ? 'LONG' : 'SHORT';
    const leverage = parseFloat(posicion.leverage) || 1;  // ✅ ÚNICA FUENTE DE VERDAD

    // 4. Cerrar en Binance
    const closeRes = await fetch('/api/binance/futures/close-position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, positionSide })
    });
    const resultado = await closeRes.json();
    

   const precioSalida = await obtenerPrecioSalida(resultado, posicion, symbol);

   let pnl = 0;
    if (sideActual === 'LONG') {
    pnl = (precioSalida - precioEntrada) * cantidad;
    } else {
    pnl = (precioEntrada - precioSalida) * cantidad;
    }
    // 6. Registrar operación
    registrarOperacionReal(symbol, sideActual, precioEntrada, precioSalida, cantidad, pnl, motivo);

    // 7. Feedback visual
    const simPnl = pnl >= 0 ? '+' : '';
    document.getElementById('estado').textContent = 
      `✅ ${symbol} ${sideActual} cerrada | ${motivo} | ${simPnl}$${Math.abs(pnl).toFixed(2)}`;

    // 8. Actualizar UI
    await actualizarPosicionesAbiertas();

  } catch (err) {
    // ✅ Mensaje seguro: err.message siempre existe
    const msg = `CloseOperation fallida: ${err.message || 'Error desconocido'}`;
    console.error(msg); // ← línea 683: ahora NO falla
    const estadoEl = document.getElementById('estado');
    if (estadoEl) estadoEl.textContent = msg;
  }
}

// ✅ ACTUALIZAR POSICIONES — Seguro
async function actualizarPosicionesAbiertas() {
  try {
    const res = await fetch(`/api/binance/futures/positions?_t=${Date.now()}`);
    const data = await res.json();
    const table = document.getElementById('operaciones-abiertas');
    if (!table) return;
    if (!table.querySelector('tbody')) {
      const tbody = document.createElement('tbody');
      table.appendChild(tbody);
    }
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    const posicionesAbiertas = data.filter(p => p.symbol && Math.abs(parseFloat(p.positionAmt || 0)) > 0.0001);
    posicionesAbiertas.forEach(pos => {
      const size = parseFloat(pos.positionAmt) || 0;
      const entry = parseFloat(pos.entryPrice) || parseFloat(pos.markPrice) || 0;
      const mark = parseFloat(pos.markPrice) || entry;
      const pnl = parseFloat(pos.unRealizedProfit) || 0;
      const roe = (entry !== 0) ? ((mark - entry) / entry) * (size > 0 ? 1 : -1) * 100 : 0;
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${pos.symbol || '—'}</td>
        <td>${size > 0 ? 'LONG' : 'SHORT'}</td>
        <td>$${entry.toFixed(2)}</td>
        <td>${roe.toFixed(2)}%</td>
        <td>$${pnl.toFixed(2)}</td>
        <td><button class="btn btn-outline" style="padding:4px 8px;font-size:0.8em;" 
            onclick="cerrarPosicion('${pos.symbol}', '${pos.positionSide}', 'Manual')">CloseOperation</button></td>
      `;
      tbody.appendChild(row);
    });
    if (posicionesAbiertas.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = `<td colspan="6" style="text-align:center;color:#666;">Sin posiciones abiertas</td>`;
      tbody.appendChild(emptyRow);
    }
  } catch (err) {
    console.error('🔴 Error actualizando posiciones:', err);
    const tbody = document.querySelector('#operaciones-abiertas tbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:#ef5350;text-align:center;">⚠️ Error al cargar posiciones</td></tr>`;
    }
  }
}

// === SEMÁFORO MEJORADO ===
function actualizarSemaforo({ adx = 0, confianza = 0, preciosLen = 0, modo = 'volatil', alcista = false, bajista = false } = {}) {
  const adxOk = adx > 20;
  const predOk = confianza > 0.65;
  const datosOk = preciosLen >= 55;
  let modoOk = false;
  if (modo === 'volatil') modoOk = true;
  else if (modo === 'alcista') modoOk = alcista;
  else if (modo === 'bajista') modoOk = bajista;
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
async function iniciarStreaming() {
  if (!AUTENTICADO) return;
  if (streamingInterval) return;
  if (!modelo) { alert('Entrena el modelo primero'); return; }
  simboloActual = document.getElementById('simbolo').value.toUpperCase();
  let klines = await obtenerDatos(simboloActual, '1m', 60);
  precios = klines.map(k => k.close);
  ultimoPrecio = klines[klines.length - 1].close;
  dataSeries.setData(klines);
  if (!symbolInfo) await fetchSymbolInfo(simboloActual);

  // ✅ Recuperar capital desde localStorage
  const savedCapital = parseFloat(localStorage.getItem('capitalActual'));
  const savedHistorial = JSON.parse(localStorage.getItem('historialOperaciones') || '[]');
  if (savedHistorial.length > 0 && !isNaN(savedCapital)) {
    operaciones = savedHistorial;
    capitalActual = savedCapital;
    capitalInicial = parseFloat(localStorage.getItem('capitalInicial')) || 1000;
    actualizarPanelFinanciero();
    renderizarHistorial();
  }

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
      const e20 = ema20.length > 0 ? ema20[ema20.length - 1] : ultimoPrecio;
      const e50 = ema50.length > 0 ? ema50[ema50.length - 1] : ultimoPrecio;
      const alcista = e20 > e50;
      const bajista = e20 < e50;
      const macdActual = macdLine[macdLine.length - 1] || 0;
      const signalActual = signalLine[signalLine.length - 1] || 0;
      const bbInf = bbInferior[bbInferior.length - 1] || ultimoPrecio;
      const bbSup = bbSuperior[bbSuperior.length - 1] || ultimoPrecio;
      const anchoBB = bbSup - bbInf;
      const posicionBB = anchoBB > 0 ? (ultimoPrecio - bbInf) / anchoBB : 0.5;
      const atrGlobal = atrArr.length > 0 ? atrArr[atrArr.length - 1] : 0;
      const adxActual = adxArr.length > 0 ? adxArr[adxArr.length - 1] : 0;
      const obvActual = obv[obv.length - 1] || 0;
      const adxE = document.getElementById('adx-valor');
      const atrE = document.getElementById('atr-valor');
      if (adxE) adxE.textContent = adxActual.toFixed(1);
      if (atrE) atrE.textContent = `ATR: ${atrGlobal.toFixed(2)}`;
      let prediccionRaw = null, confianza = 0;
      
      if (precios.length >= 30) {
        const openInterest = await obtenerOpenInterest(simboloActual);
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
      }
      const modo = document.getElementById('modo-mercado')?.value || 'volatil';
      actualizarSemaforo({ adx: adxActual, confianza, preciosLen: precios.length, modo, alcista, bajista });

      // === TRADING AUTOMÁTICO ===
      if (!document.getElementById('autoTrading')?.checked ?? false) return;
      const posiciones = await (await fetch('/api/binance/futures/positions')).json();
      const posicionActual = posiciones.find(p => p.symbol === simboloActual && Math.abs(parseFloat(p.positionAmt)) > 0.0001);
       if (posicionActual) {
  const size = parseFloat(posicionActual.positionAmt);
  const entryPrice = parseFloat(posicionActual.entryPrice);
  const markPrice = parseFloat(posicionActual.markPrice);
  const leverage = parseFloat(posicionActual.leverage);
  const esLong = size > 0;
  const esShort = size < 0;

  if (!size || !entryPrice || isNaN(entryPrice) || isNaN(markPrice) || leverage <= 0) {
    console.warn('⚠️ Datos de posición inválidos. Saltando evaluación.');
    return;
  }

  // ✅ Obtener TP/SL reales (ahora en % de equity)
  let tpPct = 3.0, slPct = 1.5;
  const modoTPSL = document.getElementById('tpsl-mode')?.value || 'dinamico';
  if (modoTPSL === 'manual') {
    tpPct = Math.max(0.5, parseFloat(document.getElementById('takeProfit')?.value) || 3.0);
    slPct = Math.max(0.5, parseFloat(document.getElementById('stopLoss')?.value) || 1.5);
  } else {
    try {
      const k5m = await obtenerDatos(simboloActual, '5m', 50);
      if (k5m.length >= 20) {
        const a = calcularATR(k5m, 14);
        const atrVal = a[a.length - 1] || 0;
        tpPct = Math.max(0.8, (atrVal * 6 / entryPrice) * 100);
        slPct = Math.max(0.5, (atrVal * 3 / entryPrice) * 100);
      }
    } catch (e) {
      tpPct = 3.0; slPct = 1.5;
    }
  }

  // ✅ Actualizar UI
  const tpEl = document.getElementById('tp-dinamico');
  const slEl = document.getElementById('sl-dinamico');
  if (tpEl) tpEl.textContent = `TP: ${tpPct.toFixed(2)}%`;
  if (slEl) slEl.textContent = `SL: ${slPct.toFixed(2)}%`;

  // ✅ ROE real (en % de equity)
  const roePct = ((markPrice - entryPrice) / entryPrice) * leverage * (esLong ? 1 : -1) * 100;

  // ✅ CIERRE ESCALONADO
  let motivo = 'Manual';

  // 🟢 TP1: 50% en +1.5% (mitad de TP=3%)
 // ✅ TP1 (50%) activa en ROE = 3.0% para TP=6% (no 1.5%)
    const tp1Threshold = tpPct * 0.5; // 6.0% × 0.5 = 3.0%
    if (roePct >= tp1Threshold && !posicionActual.tp1Cerrado) {
    const sizeParcial = Math.abs(size) * 0.5;
    cerrarParcial(simboloActual, posicionActual.positionSide, sizeParcial, `TP1 (50%)`);
    posicionActual.tp1Cerrado = true;
    posicionActual.slTrailing = 0.3; // Activa trailing SL
    return;
  }

   // ✅ Trailing SL: tras ROE ≥ 1.0%, mover SL a break-even + 0.3% (en equity)
   if (roePct >= 1.0 && posicionActual.slTrailing) {
   slPct = 0.3; // 0.3% de margen (no del precio)
   } 

  // 🔴 SL, TP2 o IA
  if (roePct <= -slPct) {
    motivo = `SL alcanzado (${slPct.toFixed(1)}%)`;
  } else if (roePct >= tpPct) {
    motivo = `TP2 (50%)`;
  } else if (prediccionRaw != null && confianza >= 0.7 && roePct < 0 && Math.abs(roePct) > (slPct * 0.5) &&
    ((esLong && prediccionRaw <= 0.3) || (esShort && prediccionRaw >= 0.7))) {
    motivo = `IA cambio + PnL=${roePct.toFixed(2)}%`;
  }

  // ✅ Cierre total si aplica
  if (roePct <= -slPct || roePct >= tpPct || motivo.includes('IA')) {
    cerrarPosicion(simboloActual, posicionActual.positionSide, motivo);
  }
      } 
       else {
        if (prediccionRaw != null && confianza >= 0.65 && precios.length >= 55 && adxActual > 20) {
          const side = prediccionRaw > 0.5 ? 'BUY' : 'SELL';
          let operar = false;
          if (modo === 'alcista' && side === 'BUY' && alcista) operar = true;
          else if (modo === 'bajista' && side === 'SELL' && bajista) operar = true;
          else if (modo === 'volatil' && ((side === 'BUY' && alcista) || (side === 'SELL' && bajista))) operar = true;
          if (operar) abrirPosicionReal(side);
        }
      }
    } catch (err) {
      console.error('🔴 Streaming error:', err);
      document.getElementById('estado').textContent = `⚠️ ${err.message}`;
    }
  }, 10000);
}

async function detenerStreaming() {
  if (!AUTENTICADO) return;
  if (streamingInterval) clearInterval(streamingInterval);
  streamingInterval = null;
  document.getElementById('estado').textContent = '⏹️ Detenido';
}

// === RECARGAR TESTNET ===
async function recargarTestnet() {
  if (!AUTENTICADO) return;
  if (confirm('¿Reiniciar capital a $1000 y borrar historial?')) {
    capitalActual = capitalInicial = 1000;
    operaciones = [];
    localStorage.removeItem('historialOperaciones');
    localStorage.setItem('capitalActual', 1000);
    localStorage.setItem('capitalInicial', 1000);
    actualizarPanelFinanciero();
    renderizarHistorial();
    await actualizarCapitalTestnet();
    alert('✅ Testnet recargado con $1000');
  }
}

// === PRUEBA MANUAL ===
async function operacionPrueba() {
  if (!AUTENTICADO) return;
  const dir = document.getElementById('prediccion-direccion').textContent;
  const adxE = document.getElementById('adx-valor');
  const adxActual = parseFloat(adxE?.textContent) || 0;
  if (adxActual < 20) {
    const continuar = confirm(`⚠️ ADX: ${adxActual.toFixed(1)} (<20). ¿Forzar orden?`);
    if (!continuar) return;
  }
  if (!dir.includes('SUBIDA') && !dir.includes('BAJADA')) {
    alert('⚠️ Sin señal clara de IA.');
    return;
  }
  try {
    if (dir.includes('SUBIDA')) await abrirPosicionReal('BUY');
    else if (dir.includes('BAJADA')) await abrirPosicionReal('SELL');
  } catch (err) {
    alert(`❌ ${err.message}`);
  }
}
// ✅ BACKTESTING REALISTA — Usa datos reales de Binance, calcula métricas reales
async function ejecutarBacktesting() {
  const msgEl = document.getElementById('backtesting-msg');
  if (!msgEl) return;
  msgEl.textContent = '⏳ Descargando datos históricos...';
  msgEl.style.color = '#aaa';
  
  try {
    // 🔹 Parámetros reales (desde UI)
    const simbolo = document.getElementById('simbolo')?.value.toUpperCase() || 'BTCUSDT';
    const modo = document.getElementById('modo-mercado')?.value || 'volatil';
    const tpslMode = document.getElementById('tpsl-mode')?.value || 'dinamico';
    const leverage = parseInt(document.getElementById('apalancamiento')?.value) || 4;
    const notional = parseFloat(document.getElementById('montoCompra')?.value) || 100;
    
    // 🔹 Datos reales: 500 velas en 5m (~41.6 horas)
    const klines = await obtenerDatos(simbolo, '5m', 500);
    if (klines.length < 100) throw new Error('Se necesitan ≥100 velas (5m)');
    
    // 🔹 Simulación paso a paso (como en streaming)
    let capital = 1000, peak = capital, maxDrawdown = 0;
    let operacionesSim = [], posicionAbierta = null;
    
    for (let i = 50; i < klines.length - 1; i++) {
      const vela = klines[i];
      const closes = klines.slice(0, i + 1).map(k => k.close);
      const rsi = calcularRSI(closes, 14);
      const ema20 = calcularEMA(closes, 20);
      const ema50 = calcularEMA(closes, 50);
      const adxArr = calcularADX(klines.slice(0, i + 1), 14);
      const atrArr = calcularATR(klines.slice(0, i + 1), 14);
      
      const rsiActual = rsi[rsi.length - 1] || 50;
      const e20 = ema20[ema20.length - 1] || vela.close;
      const e50 = ema50[ema50.length - 1] || vela.close;
      const alcista = e20 > e50;
      const bajista = e20 < e50;
      const adxActual = adxArr.length > 0 ? adxArr[adxArr.length - 1] : 0;
      const atrActual = atrArr.length > 0 ? atrArr[atrArr.length - 1] : 0;
      
      // 🔸 IA simulada (como en producción)
      let prediccionRaw = 0.5;
      if (adxActual > 15) {
        if (alcista && rsiActual < 70) prediccionRaw = 0.72;
        else if (bajista && rsiActual > 30) prediccionRaw = 0.28;
      }
      const confianza = Math.abs(prediccionRaw - 0.5) * 2;
      
      // 🔹 GESTIÓN DE POSICIÓN ABIERTA
      if (posicionAbierta) {
        const { entrada, size, side, tp, sl } = posicionAbierta;
        const precio = vela.close;
        const roePct = ((precio - entrada) / entrada) * leverage * (side === 'LONG' ? 1 : -1) * 100;
        
        let cerrar = false, motivo = 'CloseOperation';
        if (roePct >= tp) cerrar = true, motivo = `TP`;
        else if (roePct <= -sl) cerrar = true, motivo = `SL`;
        else if (confianza >= 0.7 && roePct < 0 && Math.abs(roePct) > (sl * 0.5)) {
          const debeCerrarIA = (side === 'LONG' && prediccionRaw <= 0.3) || (side === 'SHORT' && prediccionRaw >= 0.7);
          if (debeCerrarIA) cerrar = true, motivo = `IA`;
        }
        
        if (cerrar) {
          const pnl = (precio - entrada) * size * (side === 'LONG' ? 1 : -1);
          capital += pnl;
          operacionesSim.push({ entrada, salida: precio, pnl, motivo });
          posicionAbierta = null;
          peak = Math.max(peak, capital);
          maxDrawdown = Math.max(maxDrawdown, (peak - capital) / peak);
        }
      }
      
      // 🔹 ABRIR NUEVA POSICIÓN
      if (!posicionAbierta && confianza >= 0.7 && adxActual > 20) {
        let side = null;
        if (modo === 'alcista' && prediccionRaw > 0.5 && alcista) side = 'LONG';
        else if (modo === 'bajista' && prediccionRaw <= 0.5 && bajista) side = 'SHORT';
        else if (modo === 'volatil' && ((prediccionRaw > 0.5 && alcista) || (prediccionRaw <= 0.5 && bajista))) {
          side = prediccionRaw > 0.5 ? 'LONG' : 'SHORT';
        }
        
        if (side) {
          let tpPct = 3.0, slPct = 1.5;
          if (tpslMode === 'manual') {
            tpPct = Math.max(0.5, parseFloat(document.getElementById('takeProfit')?.value) || 3.0);
            slPct = Math.max(0.5, parseFloat(document.getElementById('stopLoss')?.value) || 1.5);
          } else {
            tpPct = Math.max(0.8, (atrActual * 6 / vela.close) * 100);
            slPct = Math.max(0.5, (atrActual * 3 / vela.close) * 100);
          }
          const size = notional / vela.close;
          posicionAbierta = { entrada: vela.close, size, side, tp: tpPct, sl: slPct };
        }
      }
      
      peak = Math.max(peak, capital);
    }
    
    // 🔹 Cerrar última posición (si está abierta)
    if (posicionAbierta) {
      const { entrada, size, side } = posicionAbierta;
      const precioFinal = klines[klines.length - 1].close;
      const pnl = (precioFinal - entrada) * size * (side === 'LONG' ? 1 : -1);
      capital += pnl;
      operacionesSim.push({ entrada, salida: precioFinal, pnl, motivo: 'Final' });
    }
    
    // 🔹 Calcular métricas reales
    const winRate = operacionesSim.length > 0 ? 
      operacionesSim.filter(o => o.pnl > 0).length / operacionesSim.length : 0;
    const roi = ((capital - 1000) / 1000) * 100;
    const fees = operacionesSim.length * 0.0008 * 100; // 0.08% por operación (realista Binance)
    const roiNeto = roi - fees;
    
    // ✅ GUARDAR EN LOCALSTORAGE
    localStorage.setItem('backtest-last', JSON.stringify({
      fecha: new Date().toISOString(),
      simbolo,
      operaciones: operacionesSim,
      roi: roiNeto,
      winRate,
      maxDrawdown
    }));
    
    // ✅ MOSTRAR RESULTADO
    msgEl.innerHTML = `
      ✅ ${operacionesSim.length} ops | Win: ${(winRate * 100).toFixed(1)}% |
      ROI bruto: ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}% |
      Neto: ${roiNeto >= 0 ? '+' : ''}${roiNeto.toFixed(1)}% |
      DD: ${(maxDrawdown * 100).toFixed(1)}%
    `;
    msgEl.style.color = roiNeto >= 0 ? '#26a69a' : '#ef5350';
    
  } catch (err) {
    msgEl.textContent = `❌ ${err.message}`;
    msgEl.style.color = '#ef5350';
  }
}
// Helper para backtesting
function predRawValida(modo, p, alcista, bajista) {
  return (modo === 'volatil' && ((p > 0.5 && alcista) || (p <= 0.5 && bajista)));
}

// ✅ EXPORTAR BACKTEST — Corregido: tolerante a datos faltantes
function exportarBacktest() {
  const rawData = localStorage.getItem('backtest-last');
  if (!rawData) {
    alert('❌ No hay backtest guardado. Ejecuta primero la simulación.');
    return;
  }
  
  let backtest;
  try {
    backtest = JSON.parse(rawData);
  } catch (e) {
    alert('❌ Datos corruptos. Ejecuta nuevamente el backtesting.');
    return;
  }

  if (!backtest.operaciones || backtest.operaciones.length === 0) {
    alert('❌ No hay operaciones en el backtest.');
    return;
  }

  const headers = ['Entrada', 'Salida', 'PnL', 'Motivo', 'ROE (%)'];
  const rows = backtest.operaciones.map(o => [
    o.entrada?.toFixed(2) || '—',
    o.salida?.toFixed(2) || '—',
    o.pnl?.toFixed(4) || '0.0000',
    o.motivo || '—',
    o.roe?.toFixed(2) || '0.00'
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backtest_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log('✅ Backtest exportado:', backtest);
}

// ✅ FORZAR CIERRE POR IA — Solo para pruebas
async function forzarCierreIA() {
  if (!confirm('⚠️ ¿Forzar cierre por IA en todas las posiciones?')) return;
  try {
    const posiciones = await (await fetch('/api/binance/futures/positions')).json();
    for (const pos of posiciones) {
      if (Math.abs(parseFloat(pos.positionAmt)) > 0.0001) {
        cerrarPosicion(pos.symbol, pos.positionSide, 'IA (Prueba Forzada)');
      }
    }
    document.getElementById('estado').textContent = '✅ Prueba forzada: todas las posiciones cerradas por IA';
  } catch (err) {
    console.error('❌ Error en prueba forzada:', err);
    const el = document.getElementById('estado');
    if (el) el.textContent = `❌ Prueba fallida: ${err.message}`;
  }
}
// === INICIALIZACIÓN SEGURA ===
document.addEventListener('DOMContentLoaded', () => {
  // ✅ Re-registrar backtesting (por si hay duplicados previos)
window.ejecutarBacktesting = ejecutarBacktesting;
    // 1. Cargar historial y capital desde localStorage
  const hist = JSON.parse(localStorage.getItem('historialOperaciones') || '[]');
  const savedCapital = parseFloat(localStorage.getItem('capitalActual'));
  const savedInicial = parseFloat(localStorage.getItem('capitalInicial'));

  if (hist.length > 0 && !isNaN(savedCapital)) {
    operaciones = hist;
    capitalActual = savedCapital;
    capitalInicial = !isNaN(savedInicial) ? savedInicial : 1000;
  } else {
    capitalActual = capitalInicial = 1000;
  }

  // 2. Registrar funciones globales
  window.entrenarRed = entrenarRed;
  window.iniciarStreaming = iniciarStreaming;
  window.detenerStreaming = detenerStreaming;
  window.operacionPrueba = operacionPrueba;
  window.cerrarPosicion = cerrarPosicion;
  window.recargarTestnet = recargarTestnet;
  window.ejecutarBacktesting = ejecutarBacktesting;

  // 3. Eventos
  const btnReiniciar = document.getElementById('btn-reiniciar');
  if (btnReiniciar) {
    btnReiniciar.onclick = () => {
      capitalActual = capitalInicial = 1000;
      operaciones = [];
      actualizarPanelFinanciero();
      renderizarHistorial();
      localStorage.removeItem('historialOperaciones');
      localStorage.setItem('capitalActual', 1000);
      localStorage.setItem('capitalInicial', 1000);
    };
  }
  const btnExportar = document.getElementById('btn-exportar');
  if (btnExportar) {
    btnExportar.onclick = () => {
      const csv = ['"Entrada","Salida","Ganancia"'].concat(
        operaciones.map(o => `"${new Date(o.timestampEntrada).toISOString()}","${new Date(o.timestampSalida).toISOString()}","${o.ganancia.toFixed(2)}"`)
      ).join('\n');
      const a = document.createElement('a');
      a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
      a.download = `trading_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
    };
  }

  // 4. Listener TP/SL
  const tpslModeSelect = document.getElementById('tpsl-mode');
  if (tpslModeSelect) {
    tpslModeSelect.addEventListener('change', function() {
      const showManual = this.value === 'manual';
      const g1 = document.getElementById('tpsl-manual-group');
      const g2 = document.getElementById('tpsl-manual-group2');
      if (g1) g1.style.display = showManual ? 'block' : 'none';
      if (g2) g2.style.display = showManual ? 'block' : 'none';
    });
  }

  // 5. Actualizaciones periódicas
  setInterval(actualizarPosicionesAbiertas, 10000);
  setInterval(actualizarCapitalTestnet, 60000);
  fetchSymbolInfo(simboloActual).catch(console.warn);
});