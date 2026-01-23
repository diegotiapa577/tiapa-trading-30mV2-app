// === CONFIGURACIÓN GLOBAL ===
const IS_TESTNET = true; // Cambia a false en Mainnet
let ws = null; // ← Declárala aquí
const MAX_VELAS_HISTORICAS = 10;
let historialVelas = []; // ← Guarda las velas cerradas completas
let precios = [], modelo = null;
let chart = null;
let dataSeries = null;
let capitalInicial = 1000, capitalActual = 1000;
let operaciones = [], ultimoPrecio = 0, streamingInterval = null;
window.simboloActual = 'SOLUSDT'; // o el que quieras por defecto
let symbolInfo = null;
let lineaPE = null, lineaTP = null, lineaSL = null; // ✅ Líneas de PE/TP/SL
let autoTrading = false;      // <-- Debe existir
let ordenEnCurso = false;
let sideActual = null;    /////AQUI ESTA
let ultimosPrecios = [];
let ultimosVolumenes = [];
let rsiActual = 50;
let emaActual = 0;
let macdActual = 0;
let signalActual = 0;
let posicionBB = 0.5;
let anchoBB = 0;
let atrActual = 0.001;
let adxActual = 0; // ← ¡Declárala aquí!
let obvActual = 0;
let precioActual = 0;
let openInterest = 0;
let streamingActivo = false; // ← Evita múltiples conexiones
// ✅ Para contar velas cerradas
// Al inicio de tu archivo principal
let posicionActual = null;

let velasCerradas = 0;


// ✅ Inicializar sistema de estadísticas de IA
window.prediccionesPendientes = window.prediccionesPendientes || [];

// ✅ Estado de autoTrading (global)
window.autoTrading = false;
window.tradingActivo = false;
  if (!window.configEstadisticasIA) {
    window.configEstadisticasIA = {
      objetivo: 20,
      registros: [],
      total: 0,
      aciertos: 0
    };
  }

// ===== CONTROL DE REFRESCO AUTOMÁTICO DE POSICIONES (UI) =====
let intervaloActualizacionPosiciones = null;



// ✅ Sincronización MÍNIMA del checkbox autoTrading
document.addEventListener('DOMContentLoaded', () => {
   const btn = document.getElementById('btn-reiniciar-ia');
  if (btn) {
    btn.addEventListener('click', reiniciarEstadisticasIA);
  }
  
    const switchAuto = document.getElementById('autoTrading');
  if (switchAuto) {
    // Actualizar variable global cuando cambie el checkbox
    switchAuto.addEventListener('change', () => {
      window.autoTrading = switchAuto.checked;
      // También actualizar tu variable local si es diferente
      // (asegúrate de que ws.onmessage use window.autoTrading)
    });
    
    window.configEstadisticasIA = {
    objetivo: parseInt(document.getElementById('objetivo-predicciones')?.textContent) || 20,
    total: 0,
    aciertos: 0,
    registros: []
  };
  window.prediccionesPendientes = [];

    // Establecer estado inicial
    window.autoTrading = switchAuto.checked;
  }
});

// En la parte superior de tu script (o en window)
window.iaFuertePendiente = null; // para apertura
posicionActual = null; // para cierre
window.historialOperaciones = [];

// Mostrar el panel desde el inicio
document.getElementById('panel-estadisticas-ia').style.display = 'block';
  //document.getElementById('objetivo-predicciones').textContent = window.configEstadisticasIA.objetivo;
//document.getElementById('total-objetivo').textContent = window.configEstadisticasIA.objetivo;
// Al iniciar
// Al inicio de script.js (después de DOMContentLoaded)
if (!window.configEstadisticasIA) {
  // Intentar cargar desde localStorage
  const saved = localStorage.getItem('estadisticasIA');
  if (saved) {
    try {
      window.configEstadisticasIA = JSON.parse(saved);
    } catch (e) {
      window.configEstadisticasIA = null;
    }
  }

  // Si no hay datos válidos, usar configuración por defecto
}
 
// ✅ Función para decodificar el JWT y obtener el rol





// ─── TELEGRAM NOTIFICATIONS ───
let ultimaNotifGauss = 0;
const INTERVALO_NOTIF = 10 * 60 * 1000; // 10 minutos


function iniciarRefrescoPosiciones() {
  if (intervaloActualizacionPosiciones) return; // Ya activo
  console.log('[UI] Iniciando refresco automático de posiciones');
  intervaloActualizacionPosiciones = setInterval(async () => {
    try {
      await actualizarPosicionesAbiertas();
    } catch (err) {
      console.warn('⚠️ Error en refresco automático:', err.message);
    }
  }, 2000); // Cada 2 segundos
}

function detenerRefrescoPosiciones() {
  if (intervaloActualizacionPosiciones) {
    console.log('[UI] Deteniendo refresco automático de posiciones');
    clearInterval(intervaloActualizacionPosiciones);
    intervaloActualizacionPosiciones = null;
  }
}


function calcularRSI(precios, periodo = 14) {
  if (precios.length <= periodo) {
    return Array(precios.length).fill(50); // o []
  }

  // Convertir a números
  const closes = precios.map(p => parseFloat(p));
  const rsi = new Array(closes.length).fill(0);

  // Paso 1: calcular promedios iniciales (SMA de los primeros 'periodo' cambios)
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= periodo; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= periodo;
  avgLoss /= periodo;

  // Paso 2: primer valor RSI (en índice = periodo)
  if (avgLoss === 0) {
    rsi[periodo] = 100;
  } else {
    const rs = avgGain / avgLoss;
    rsi[periodo] = 100 - (100 / (1 + rs));
  }

  // Paso 3: suavizado Wilder para el resto
  for (let i = periodo + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (periodo - 1) + gain) / periodo;
    avgLoss = (avgLoss * (periodo - 1) + loss) / periodo;

    if (avgLoss === 0) {
      rsi[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100 - (100 / (1 + rs));
    }
  }

  // Opcional: rellenar índices iniciales con null o 50 (pero no afectan la lógica)
  for (let i = 0; i < periodo; i++) {
    rsi[i] = 50; // o null si prefieres ignorarlos
  }

  return rsi.map(v => isNaN(v) ? 50 : parseFloat(v.toFixed(2)));
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

function calcularATR(klines, periodo = 14) {
  if (!Array.isArray(klines) || klines.length <= periodo) return [];

  const trs = [];
  // ✅ Calcular TR desde i = 1
  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(klines[i].h || klines[i].high);
    const low = parseFloat(klines[i].l || klines[i].low);
    const close = parseFloat(klines[i].c || klines[i].close);
    const prevClose = parseFloat(klines[i - 1].c || klines[i - 1].close);

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  if (trs.length < periodo) return [];

  // ✅ SMA inicial sobre los primeros 'periodo' TRs
  let atr = trs.slice(0, periodo).reduce((a, b) => a + b, 0) / periodo;
  const atrArray = new Array(periodo).fill(0); // placeholders
  atrArray[periodo - 1] = atr;

  // ✅ Wilder smoothing para el resto
  for (let i = periodo; i < trs.length; i++) {
    atr = (atr * (periodo - 1) + trs[i]) / periodo;
    atrArray[i] = atr;
  }

  // ✅ Devolver desde el índice 'periodo - 1' (primer valor válido)
  return atrArray.slice(periodo - 1).map(v => parseFloat(v.toFixed(2)));
}

// ───────────────────────────────────────
// ✅ FUNCIÓN CENTRALIZADA PARA TP/SL DINÁMICO
// ───────────────────────────────────────
// ───────────────────────────────────────
// ✅ FUNCIÓN CENTRALIZADA PARA TP/SL DINÁMICO (con soporte para UI)
// ───────────────────────────────────────
function calcularTPSLDinamico(entryPrice, atrValor, esLong, opciones = {}) {
  const {
    tp: tpMultPorDefecto = 2.0,
    sl: slMultPorDefecto = 1.0,
    usarUI = false // ← nuevo parámetro
  } = opciones;

  // Validación básica
  if (!entryPrice || !atrValor || atrValor <= 0) {
    console.warn("⚠️ TP/SL dinámico: datos inválidos (entryPrice o ATR)");
    return { tpPrice: 0, slPrice: 0, tpPct: 0, slPct: 0 };
  }

  // ✅ Obtener multiplicadores: de UI si se pide, sino de los valores por defecto
  let tpMult = tpMultPorDefecto;
  let slMult = slMultPorDefecto;

  if (usarUI) {
    const tpInput = document.getElementById('tp-mult');
    const slInput = document.getElementById('sl-mult');
    
    if (tpInput) tpMult = parseFloat(tpInput.value) || tpMultPorDefecto;
    if (slInput) slMult = parseFloat(slInput.value) || slMultPorDefecto;
  }

  const tpDist = atrValor * tpMult;
  const slDist = atrValor * slMult;

  let tpPrice, slPrice, tpPct, slPct;

  if (esLong) {
    tpPrice = entryPrice + tpDist;
    slPrice = entryPrice - slDist;
  } else {
    tpPrice = entryPrice - tpDist;
    slPrice = entryPrice + slDist;
  }

  tpPct = (tpDist / entryPrice) * 100;
  slPct = (slDist / entryPrice) * 100;

  return {
    tpPrice: parseFloat(tpPrice.toFixed(2)),
    slPrice: parseFloat(slPrice.toFixed(2)),
    tpPct: parseFloat(tpPct.toFixed(2)),
    slPct: parseFloat(slPct.toFixed(2))
  };
}

function actualizarTPSLenUI() {
  const tpEl = document.getElementById('tp-dinamico');
  const slEl = document.getElementById('sl-dinamico');
  if (!tpEl || !slEl) return;

  const modoTPSL = document.getElementById('tpsl-mode')?.value || 'dinamico';
  let tpPct, slPct;

  if (modoTPSL === 'manual') {
    tpPct = parseFloat(document.getElementById('takeProfuit')?.value) || 3.0; // ❗ cuidado: typo "takeProfuit"
    slPct = parseFloat(document.getElementById('stopLoss')?.value) || 1.5;
  } else {
    // Asegúrate de que `entryPrice` y `atrVal` estén definidos
    const entryPrice = window.entryPrice; // o de donde lo obtengas
    const atrVal = window.atrGlobal; // o recalcula si es necesario
    const esLongUI = window.sideActual === 'LONG';

    if (entryPrice && atrVal) {
      const tpsl = calcularTPSLDinamico(entryPrice, atrVal, esLongUI, {
        tp: 2.0,
        sl: 1.0,
        usarUI: true // ← ¡usa los multiplicadores de la UI!
      });
      tpPct = tpsl.tpPct;
      slPct = tpsl.slPct;
    } else {
      tpPct = 0;
      slPct = 0;
    }
  }

  tpEl.textContent = modoTPSL === 'manual'
    ? `TP (Manual): ${tpPct.toFixed(2)}%`
    : `TP (Dinámico): ${tpPct.toFixed(2)}%`;
    
  slEl.textContent = modoTPSL === 'manual'
    ? `SL (Manual): ${slPct.toFixed(2)}%`
    : `SL (Dinámico): ${slPct.toFixed(2)}%`;

  // Actualizar gráfico
  if (window.sideActual && typeof window.entryPrice !== 'undefined') {
    actualizarLineasPrecios(window.entryPrice, tpPct, slPct, window.leverage);
  }
}

  // Función helper (reemplaza tu fetchConAuth o crea una nueva)
function fetchConAuth(url, options = {}) {
  const token = localStorage.getItem('authToken');
  if (!token) {
    // Redirigir a login
    localStorage.clear();
    window.location.href = '/admin-login.html';
    return Promise.reject('No autenticado');
  }

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    }
  });
}
// nuevo autenticacion llega

async function fetchSymbolInfo(symbol ) {
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


// ✅ Nueva función: solo para indicadores en tiempo real
function calcularIndicadoresEnTiempoReal(klines) {
  const closes = klines.map(k => k.close);
  const rsi = calcularRSI(closes, 14);
  const adx = calcularADX(klines); // asegúrate de tener esta función
  const { macdLine, signalLine } = calcularMACD(closes, 12, 26, 9);
  const ema20 = calcularEMA(closes, 20);
  const ema50 = calcularEMA(closes, 50);
  
  // Guardar en window para acceso global
  window.indicadores = {
    rsi: rsi[rsi.length - 1],
    adx: adx[adx.length - 1],
    macdLine,
    signalLine,
    ema20: ema20[ema20.length - 1],
    ema50: ema50[ema50.length - 1],
    closes: closes,
    timestamp: Date.now()
  };
}

function inicializarGrafico() {
  const container = document.getElementById('chart');
  if (!container) {
    console.error('❌ Contenedor #chart no encontrado.');
    return;
  }

  // Si ya existe un gráfico, destrúyelo
  if (chart) {
    chart.remove(); // O usa chart.applyOptions({ width: 1 }) si remove falla
    chart = null;
  }

  // Crear nuevo gráfico
  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      backgroundColor: '#121416',
      textColor: '#d9d9d9',
    },
    grid: {
      vertLines: { color: 'rgba(42, 46, 57, 0)' },
      horzLines: { color: 'rgba(42, 46, 57, 0)' },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#494c58' },
    timeScale: { borderColor: '#494c58', timeVisible: true },
    autoSize: true
  });

  // ✅ Asignar la serie a la variable global
  dataSeries = chart.addCandlestickSeries({
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderUpColor: '#26a69a',
    borderDownColor: '#ef5350',
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350'
  });
}
// === GRÁFICOS CON LÍNEAS PE/TP/SL ===
function initChart() {
  // ✅ Obtener el contenedor del gráfico
  const chartContainer = document.getElementById('chart');

  // ✅ Validar que exista y tenga tamaño
  if (!chartContainer || chartContainer.offsetWidth === 0 || chartContainer.offsetHeight === 0) {
    console.error('❌ #chart no encontrado o sin tamaño');
    return;
  }

  // ✅ Crear el gráfico
  chart = LightweightCharts.createChart(chartContainer, {
    layout: { backgroundColor: '#121212', textColor: 'white' },
    grid: { vertLines: { color: '#333' }, horzLines: { color: '#333' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    priceScale: { borderColor: '#494c58' },
    timeScale: { borderColor: '#494c58' },
    autoSize: true
  });

  dataSeries = chart.addCandlestickSeries({
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderVisible: false,
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350'
  });

  // ✅ Líneas PE/TP/SL
  lineaPE = chart.addLineSeries({
    color: '#2196F3',
    lineWidth: 2,
    crosshairMarkerVisible: false,
    priceLineVisible: false
  });

  lineaTP = chart.addLineSeries({
    color: '#4CAF50',
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    crosshairMarkerVisible: false,
    priceLineVisible: false
  });

  lineaSL = chart.addLineSeries({
    color: '#F44336',
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    crosshairMarkerVisible: false,
    priceLineVisible: false
  });

  console.log('✅ Gráfico inicializado correctamente con líneas de PE/TP/SL');
}
// === ACTUALIZAR GRÁFICO CON NUEVA VELA ===
function actualizarGrafico(nuevaVela) {
  if (!dataSeries) {
    console.error('❌ dataSeries no disponible');
    return;
  }

  const time = Math.floor(nuevaVela.t / 1000); // segundos

  dataSeries.update({
    time: time,
    open: parseFloat(nuevaVela.o),
    high: parseFloat(nuevaVela.h),
    low: parseFloat(nuevaVela.l),
    close: parseFloat(nuevaVela.c)
  });
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
      const estadoEl = document.getElementById('estado');
      if (estadoEl) estadoEl.textContent = '❌ Gráfico: no se pudo inicializar';
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
    const estadoEl = document.getElementById('estado');
    if (estadoEl) estadoEl.textContent = `❌ Inicialización fallida: ${err.message}`;
  }
}

// === DATOS ===
async function obtenerDatos(symbol , interval = '5m', limit = 60) {
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

// === ENTRENAMIENTO: OBTENER DATOS HISTÓRICOS EXTENSOS ===
// Esta función descarga una gran cantidad de velas (klines) para entrenamiento
// === ENTRENAMIENTO: OBTENER DATOS HISTÓRICOS EXTENSOS (CORREGIDA) ===
// Esta función descarga una gran cantidad de velas (klines) para entrenamiento
// Maneja la limitación de la API de Binance (máx 1000 velas por llamada) realizando múltiples llamadas si es necesario.
// Asegura que use BINANCE_MAINNET_URL para obtener klines.
// === ENTRENAMIENTO: OBTENER DATOS HISTÓRICOS EXTENSOS (CORREGIDA - Soporta >1000 velas) ===
// Esta función descarga una gran cantidad de velas (klines) para entrenamiento
// Maneja la limitación de la API de Binance (máx 1000 velas por llamada) realizando múltiples llamadas si es necesario.
// Asegura que use la URL correcta para klines (MAINNET para datos de precios).
async function obtenerDatosHistoricos(symbol, interval, totalLimit) {
  const maxLimit = 1000; // Límite máximo de velas por llamada a la API de Binance
  const allKlines = [];
  let endTime = Date.now(); // Comenzamos desde ahora
  let remaining = totalLimit;

  while (remaining > 0) {
    const limit = Math.min(remaining, maxLimit);
    // Calcular startTime basado en endTime, intervalo y cantidad de velas deseadas
    let startTime;
    switch (interval) {
      case '1m': startTime = endTime - (limit * 60 * 1000) - 1; break;
      case '3m': startTime = endTime - (limit * 3 * 60 * 1000) - 1; break;
      case '5m': startTime = endTime - (limit * 5 * 60 * 1000) - 1; break;
      case '15m': startTime = endTime - (limit * 15 * 60 * 1000) - 1; break;
      case '30m': startTime = endTime - (limit * 30 * 60 * 1000) - 1; break;
      case '1h': startTime = endTime - (limit * 60 * 60 * 1000) - 1; break;
      case '2h': startTime = endTime - (limit * 2 * 60 * 60 * 1000) - 1; break;
      case '4h': startTime = endTime - (limit * 4 * 60 * 60 * 1000) - 1; break;
      case '6h': startTime = endTime - (limit * 6 * 60 * 60 * 1000) - 1; break;
      case '8h': startTime = endTime - (limit * 8 * 60 * 60 * 1000) - 1; break;
      case '12h': startTime = endTime - (limit * 12 * 60 * 60 * 1000) - 1; break;
      case '1d': startTime = endTime - (limit * 24 * 60 * 60 * 1000) - 1; break;
      case '3d': startTime = endTime - (limit * 3 * 24 * 60 * 60 * 1000) - 1; break;
      case '1w': startTime = endTime - (limit * 7 * 24 * 60 * 60 * 1000) - 1; break;
      // Añadir más intervalos si es necesario
      default:
        throw new Error(`Intervalo ${interval} no soportado para cálculo de startTime`);
    }

    // Asegúrate de que startTime no sea negativo o muy antiguo si el totalLimit es muy grande
    if (startTime < 0) {
        console.warn(`[Entrenamiento] startTime calculado (${new Date(startTime).toISOString()}) es negativo. Limitando a 0.`);
        startTime = 0;
    }

    // Hacer la solicitud a la API de Binance MAINNET para klines
    // Asegúrate de que `/api/binance/klines` en tu backend apunte a MAINNET
    const res = await fetch(`/api/binance/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`);
    if (!res.ok) {
      console.error(`Error obteniendo datos históricos de ${symbol}: ${res.status} - ${res.statusText}`);
      throw new Error(`Error: ${res.status} - ${res.statusText}`);
    }
    const klines = await res.json();

    if (klines.length === 0) {
      console.log(`[Entrenamiento] No se obtuvieron más velas para ${symbol} antes de ${new Date(startTime).toISOString()}. Deteniendo descarga.`);
      break; // Si no hay más velas, detenemos la descarga
    }

    allKlines.unshift(...klines); // Añadimos al inicio para mantener el orden cronológico ascendente
    remaining -= klines.length;
    console.log(`[Entrenamiento] Descargadas ${klines.length} velas de ${symbol}. Restantes: ${remaining}. Total acumulado: ${allKlines.length}`);

    // Actualizamos endTime para la próxima llamada al timestamp de la primera vela obtenida en esta iteración
    // (Asumiendo que las velas vienen en orden ascendente de tiempo)
    endTime = klines[0][0] - 1; // Timestamp en milisegundos de la primera vela, restamos 5ms para evitar solapamiento
    // Aseguramos que endTime no sea negativo
    if (endTime < 0) {
        endTime = 0;
        break; // Si endTime se vuelve negativo, paramos
    }
  }

  // Convertir formato de Binance (array de arrays) a tu estructura interna (array de objetos)
  // Asegura que el precio sea un número flotante
  return allKlines.map(k => ({
    time: Math.floor(k[0] / 1000), // Timestamp en segundos
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5])
  }));
}
// === ENTRENAMIENTO: PREPARAR DATOS CON ETIQUETAS (CORREGIDA - V6 - Añadido anchoBBRelativo) - CON CONTADOR DE ETIQUETAS===
// Esta función toma klines históricos y prepara pares (features, label) para entrenamiento.
// La label indica si el precio cierra más alto o más bajo después de N velas.


// === ENTRENAMIENTO: PREPARAR DATOS CON ETIQUETAS (V7 — Balanced, ATR-normalizado, 3 velas) ===
 const VELAS_FUTURAS = 3; 
function prepararDatosConEtiquetas(klines) {
 // const featuresList = [];
  //const labelsList = [];

  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const rsiArr = calcularRSI(closes, 14);
  const emaArr = calcularEMA(closes, 20);
  const { macdLine, signalLine } = calcularMACD(closes, 12, 26, 9);
  const { superior: bbSuperior, inferior: bbInferior } = calcularBandasBollinger(closes, 20, 2);
  const atrArr = calcularATR(klines, 14);
  const adxArr = calcularADX(klines, 14);
  const obvArr = calcularOBV(klines);

  const desfaseRsi = 13, desfaseEma = 19, desfaseMacd = 33,
        desfaseBb = 19, desfaseAtr = 13, desfaseAdx = 27, desfaseObv = 0;
  const maxDesfase = Math.max(desfaseRsi, desfaseEma, desfaseMacd, desfaseBb, desfaseAtr, desfaseAdx, desfaseObv, 10);
  const startIndex = Math.max(maxDesfase, VELAS_FUTURAS);
  const endIndex = klines.length - VELAS_FUTURAS;

  if (startIndex >= endIndex) {
    console.error(`[Entrenamiento] No hay suficientes datos: ${klines.length} velas → usable: ${endIndex - startIndex}`);
    return { X: null, y: null };
  }

  let muestrasSubida = [];
  let muestrasBajada = [];

  for (let i = startIndex; i < endIndex; i++) {
    const rsiActual = rsiArr[i - desfaseRsi] || 50;
    const emaActual = emaArr[i - desfaseEma] || closes[i];
    const macdActual = macdLine[i - desfaseMacd] || 0;
    const signalActual = signalLine[i - desfaseMacd] || 0;
    const bbSup = bbSuperior[i - desfaseBb] || closes[i];
    const bbInf = bbInferior[i - desfaseBb] || closes[i];
    const atrActual = atrArr[i - desfaseAtr] || 0.001;
    const adxActual = adxArr[i - desfaseAdx] || 0;
    const obvActual = obvArr[i - desfaseObv] || 0;
    const precioActual = closes[i];
    const precioFuturo = closes[i + VELAS_FUTURAS];
    const retorno = (precioFuturo - precioActual) / precioActual;
    const retornoNormalizado = retorno / (atrActual / precioActual);

    // ✅ Zona neutral: descartamos ruido (< ±0.3 ATR)
    if (Math.abs(retornoNormalizado) < 0.3) continue;

    const etiqueta = retornoNormalizado > 0.3 ? 1 : 0;

    const ventanaPrecios = closes.slice(i - 10, i);
    const cambios = ventanaPrecios.map((p, idx) => idx === 0 ? 0 : (p - ventanaPrecios[idx - 1]) / ventanaPrecios[idx - 1]);
    const anchoBB = bbSup - bbInf;
    const posicionBB = anchoBB > 0 ? (precioActual - bbInf) / anchoBB : 0.5;
    const anchoBBRelativo = anchoBB / precioActual;
    const atrRelativo = atrActual / precioActual;
    const obvNormalizado = obvActual / 1e9;

    const features = [
      ...cambios,
      volumes.slice(i - 10, i).reduce((a, b) => a + b, 0) / 10 / 1e6,
      rsiActual / 100,
      precioActual > emaActual ? 1 : 0,
      rsiActual > 70 ? 1 : 0,
      rsiActual < 30 ? 1 : 0,
      macdActual / 1000,
      signalActual / 1000,
      (macdActual - signalActual) / 1000,
      posicionBB,
      anchoBBRelativo,
      atrRelativo,
      obvNormalizado,
      0 / 1e6 // openInterest placeholder
    ];

    if (features.length === 23) {
      if (etiqueta === 1) {
        muestrasSubida.push(features);
      } else {
        muestrasBajada.push(features);
      }
    }
  }

  // ✅ ✅ ✅ NUEVA LÓGICA: BALANCEAR LAS CLASES
  const minCount = Math.min(muestrasSubida.length, muestrasBajada.length);
  const balancedSubida = muestrasSubida.slice(0, minCount);
  const balancedBajada = muestrasBajada.slice(0, minCount);

  const featuresList = [...balancedSubida, ...balancedBajada];
  const labelsList = Array(minCount).fill([1]).concat(Array(minCount).fill([0]));

  console.log(`[Entrenamiento] Muestras balanceadas: SUBIDA=${minCount}, BAJADA=${minCount}, Total=${featuresList.length}`);

  if (featuresList.length === 0) return { X: null, y: null };

  return {
    X: tf.tensor2d(featuresList),
    y: tf.tensor2d(labelsList)
  };
}


async function obtenerOpenInterest(symbol ) {
  const res = await fetch(`/api/binance/futures/open-interest?symbol=${symbol}`);
  if (!res.ok) return 0;
  const data = await res.json();
  return data.openInterest || 0;
}

// === INDICADORES TÉCNICOS ===



function calcularMACD(precios, rapido = 12, lento = 26, signal = 9) {
  if (precios.length <= lento) {
    return { macdLine: [], signalLine: [] };
  }

  const emaRapida = calcularEMA(precios, rapido);
  const emaLenta = calcularEMA(precios, lento);

  // ✅ Alinear MACD desde el índice donde EMA lenta es válida
  const inicio = lento - 1;
  const macdLine = [];
  for (let i = inicio; i < precios.length; i++) {
    const rapida = emaRapida[i] || 0;
    const lenta = emaLenta[i] || 0;
    macdLine.push(rapida - lenta);
  }

  // ✅ Calcular señal sobre la MACD line (requiere al menos 'signal' valores)
  if (macdLine.length <= signal) {
    return { macdLine: macdLine, signalLine: [] };
  }

  const signalLine = calcularEMA(macdLine, signal);

  return {
    macdLine: macdLine,
    signalLine: signalLine
  };
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

function calcularOBV(klines) {
  // ✅ En Testnet, devolver array de ceros (misma longitud que klines)
  if (IS_TESTNET) {
    return new Array(klines.length).fill(0);
  }

  // 🟢 En Mainnet, calcular el OBV real
  if (klines.length === 0) return [];
  const obv = [0];
  for (let i = 1; i < klines.length; i++) {
    const close = parseFloat(klines[i].c) || parseFloat(klines[i].close);
    const prevClose = parseFloat(klines[i - 1].c) || parseFloat(klines[i - 1].close);
    const volume = parseFloat(klines[i].v) || parseFloat(klines[i].volume);
    const delta = close - prevClose;
    obv.push(obv[i - 1] + (delta > 0 ? volume : delta < 0 ? -volume : 0));
  }
  return obv;
}

function calcularADX(klines, period = 14) {
  if (!Array.isArray(klines) || klines.length < period + 10) return [];

  // ✅ CONVERSIÓN EXPLÍCITA A NÚMERO — CLAVE
  const highs = klines.map(k => parseFloat(k.h) || parseFloat(k.high));
  const lows  = klines.map(k => parseFloat(k.l) || parseFloat(k.low));
  const closes = klines.map(k => parseFloat(k.c) || parseFloat(k.close));
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

  // ✅ Suma inicial de los primeros `period` valores
  let trSmooth = tr.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let plusDMSmooth = plusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let minusDMSmooth = minusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);

  const plusDI = [], minusDI = [], dx = [];

  const firstPlusDI = (plusDMSmooth / trSmooth) * 100;
  const firstMinusDI = (minusDMSmooth / trSmooth) * 100;

  plusDI[period] = isNaN(firstPlusDI) ? 0 : firstPlusDI;
  minusDI[period] = isNaN(firstMinusDI) ? 0 : firstMinusDI;

  const firstDX = (plusDI[period] + minusDI[period]) !== 0 
    ? (Math.abs(plusDI[period] - minusDI[period]) / (plusDI[period] + minusDI[period])) * 100 
    : 0;
  dx[period] = isNaN(firstDX) ? 0 : firstDX;

  // ✅ Calcular ADX con Wilders smoothing
  for (let i = period + 1; i < n; i++) {
    trSmooth = trSmooth - trSmooth / period + tr[i];
    plusDMSmooth = plusDMSmooth - plusDMSmooth / period + plusDM[i];
    minusDMSmooth = minusDMSmooth - minusDMSmooth / period + minusDM[i];

    const pdi = (plusDMSmooth / trSmooth) * 100;
    const mdi = (minusDMSmooth / trSmooth) * 100;

    plusDI[i] = isNaN(pdi) ? 0 : pdi;
    minusDI[i] = isNaN(mdi) ? 0 : mdi;

    const currentDX = (pdi + mdi) !== 0 
      ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 
      : 0;
    dx[i] = isNaN(currentDX) ? 0 : currentDX;
  }

  // ✅ ADX final: promedio móvil de DX (desde period*2)
  const adx = new Array(n).fill(0);
  let dxSum = dx.slice(period, period * 2).reduce((a, b) => a + b, 0);
  adx[period * 2 - 1] = dxSum / period;

  for (let i = period * 2; i < n; i++) {
    dxSum = dxSum - dxSum / period + dx[i];
    adx[i] = dxSum / period;
  }

  // ✅ Devolver solo los valores útiles (desde period*2-1)
  return adx.slice(period * 2 - 1).map(val => Math.max(0, parseFloat(val.toFixed(2))));
}

// === MODELO IA (MODIFICADO - Mayor Dropout para reducir Overfitting) ===
async function crearModelo() {
  const model = tf.sequential();
  // Capa de entrada y primera capa densa
  model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [23] }));
  // Capa de Dropout después de la primera capa densa (aumentado de 0.2 a 0.3)
  model.add(tf.layers.dropout({ rate: 0.3 })); 

  // Segunda capa densa
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  // Capa de Dropout después de la segunda capa densa (aumentado de 0.2 a 0.3)
  model.add(tf.layers.dropout({ rate: 0.3 })); 

  // Tercera capa densa
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  // Añadido: Capa de Dropout después de la tercera capa densa (nueva)
  model.add(tf.layers.dropout({ rate: 0.2 })); 

  // Capa de salida
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

  model.compile({
    optimizer: 'adam',
    loss: 'binaryCrossentropy', // Adecuado para clasificación binaria
    metrics: ['accuracy']
  });
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

// === ENTRENAMIENTO: MULTI-SÍMBOLO (3+), 15m, 15k velas, portable ===
async function entrenarRed() {

  // Definir símbolos a usar para entrenamiento
  const SIMBOLOS_ENTRENAMIENTO = ['SOLUSDT'];
  const INTERVALO = '5m'; //  1m
  const LIMITE_DATOS = 10000; // Ajusta este número. Por ejemplo, 15000 velas de 4h por símbolo
  const VELAS_FUTURAS = 3;
  const EPOCAS = 50;
  const BATCH_SIZE = 32;
  const estadoEl = document.getElementById('estado');
  if (!estadoEl) {
    console.error("❌ Elemento de estado no encontrado.");
    return; // O manejarlo como prefieras
  }

  estadoEl.textContent = `📥 Descargando datos de ${SIMBOLOS_ENTRENAMIENTO.join(', ')}... (${INTERVALO})`;
  estadoEl.style.color = '#2196F3'; // Azul para descarga

  try {
    let todosLosFeatures = [];
    let todasLasLabels = [];

    // 1. Descargar y preparar datos para CADA símbolo
    for (const simbolo of SIMBOLOS_ENTRENAMIENTO) {
      estadoEl.textContent = `📥 Descargando ${LIMITE_DATOS} velas de ${simbolo} (${INTERVALO})...`;
      console.log(`[Entrenamiento MultiSímbolo] Descargando datos de ${simbolo}...`);
      const klinesHistoricos = await obtenerDatosHistoricos(simbolo, INTERVALO, LIMITE_DATOS); // Asegúrate de tener esta función
      if (klinesHistoricos.length < 1000) {
        throw new Error(`Se necesitan más datos para entrenamiento en ${simbolo} (${klinesHistoricos.length} recibidas, mínimo 1000)`);
      }

      estadoEl.textContent = `⚙️ Preparando datos de ${simbolo} con etiquetas...`;
      console.log(`[Entrenamiento MultiSímbolo] Preparando datos de ${simbolo}...`);
      const { X, y } = prepararDatosConEtiquetas(klinesHistoricos); // Usa la función corregida V2
      if (!X || !y) {
        throw new Error(`No se generaron datos suficientes o hubo un error en la preparación para ${simbolo}.`);
      }

      // Convertir tensores a arrays JS para concatenarlos fácilmente
      const featuresArray = X.arraySync();
      const labelsArray = y.arraySync();

      todosLosFeatures.push(...featuresArray);
      todasLasLabels.push(...labelsArray);

      // Liberar memoria de los tensores temporales
      X.dispose();
      y.dispose();

      console.log(`[Entrenamiento MultiSímbolo] Datos de ${simbolo} agregados. Total acumulado: ${todosLosFeatures.length} muestras.`);
    }

    if (todosLosFeatures.length === 0) {
      throw new Error("No se generaron datos de entrenamiento de ningún símbolo.");
    }

    estadoEl.textContent = '📊 Concatenando y barajando datos de todos los símbolos...';
    console.log(`[Entrenamiento MultiSímbolo] Total muestras antes de barajar: ${todosLosFeatures.length}`);

    // 2. Convertir arrays JS de nuevo a tensores y barajarlos JUNTOS
    let X_total = tf.tensor2d(todosLosFeatures);
    let y_total = tf.tensor2d(todasLasLabels, [todasLasLabels.length, 1]);

    console.log(`[Entrenamiento MultiSímbolo] Datos concatenados antes de barajar. Shape X: [${X_total.shape}], Shape y: [${y_total.shape}]`);

    // 3. Barajar los datos concatenados (X con y) usando tensores
    // Creamos un tensor de índices y lo barajamos
    const numSamples = X_total.shape[0];
    // tf.util.createShuffledIndices devuelve un TypedArray (Uint32Array)
    const indicesArray = tf.util.createShuffledIndices(numSamples);

    // [CORRECCIÓN] Crear el tensor de índices 1D directamente desde el TypedArray
      // [CORRECCIÓN 2] Asegurar que indicesArray sea un TypedArray y crear el tensor
    // tf.util.createShuffledIndices debería devolver un Int32Array (TypedArray), pero lo forzamos por si acaso.
    // Usamos tf.tensor en lugar de tf.tensor1d para mayor control sobre el tipo.
    const indicesTypedArray = new Int32Array(indicesArray); // <-- Convertimos explícitamente a Int32Array
    const indicesShuffledTensor = tf.tensor(indicesTypedArray, [indicesTypedArray.length], 'int32'); // <-- Usamos tf.tensor

    // Usamos gather para reorganizar X e y usando los índices barajados
    const X_shuffled = X_total.gather(indicesShuffledTensor);
    const y_shuffled = y_total.gather(indicesShuffledTensor);

    // Liberar memoria del tensor de índices barajados *después* de usarlo
    indicesShuffledTensor.dispose();

    console.log(`[Entrenamiento MultiSímbolo] Datos concatenados y barajados. Shape X: [${X_shuffled.shape}], Shape y: [${y_shuffled.shape}]`);

    // 4. Dividir en entrenamiento y validación (usando los datos ya barajados)
    const totalSamples = X_shuffled.shape[0];
    const trainSize = Math.floor(totalSamples * 0.8); // 80% para entrenamiento
    const valSize = totalSamples - trainSize; // 20% para validación

    //const X_train = X_shuffled.slice([0, 0], [trainSize, -1]);
    //const y_train = y_shuffled.slice([0, 0], [trainSize, -1]);
    const X_train = X_shuffled.slice([0, 0], [totalSamples - valSize, -1]); // Primeros 80% (antiguos)
    const X_val = X_shuffled.slice([totalSamples - valSize, 0], [valSize, -1]); // Últimos 20% (recientes)
    const y_train = y_shuffled.slice([0, 0], [totalSamples - valSize, -1]);
    const y_val = y_shuffled.slice([totalSamples - valSize, 0], [valSize, -1]);

    console.log(`[Entrenamiento MultiSímbolo] División (barajada): Entrenamiento: ${X_train.shape[0]}, Validación: ${X_val.shape[0]}`);

    // 5. Crear modelo (usando la versión con MAYOR Dropout)
    estadoEl.textContent = '🧠 Creando modelo...';
    estadoEl.style.color = '#9C27B0'; // Púrpura para creación
    modelo = await crearModelo(); // Recrea el modelo (o carga uno existente si implementas eso)

    // 6. Compilar modelo (opcional, crearModelo ya lo hace, pero se puede recompilar si cambian métricas)
    modelo.compile({
      optimizer: 'adam',
      loss: 'binaryCrossentropy', // Adecuado para clasificación binaria
      metrics: ['accuracy']
    });

    console.log(`[Entrenamiento MultiSímbolo] Modelo creado y compilado. Iniciando entrenamiento por ${EPOCAS} épocas...`);
    estadoEl.textContent = `🧠 Entrenando modelo por ${EPOCAS} épocas...`;
    estadoEl.style.color = '#4CAF50'; // Verde para entrenamiento activo

    // 7. Entrenar el modelo con datos de entrenamiento y validación
    // Agregamos EarlyStopping como callback
    const history = await modelo.fit(X_train, y_train, {
      epochs: EPOCAS,
      batchSize: BATCH_SIZE,
      validationData: [X_val, y_val],
      verbose: 1, // 1 para ver progreso por época en la consola
      callbacks: [
          tf.callbacks.earlyStopping({
            monitor: 'val_loss', // Monitorea la pérdida en validación
            patience: 5,        // Detiene si no mejora por 5 épocas consecutivas
            // restoreBestWeights: true // <-- COMENTADO: No soportado en esta versión de TFJS
            // onEpochEnd: async (epoch, logs) => {
            //   // Opcional: Actualizar estado con la época actual y las métricas
            //   // estadoEntrenamientoEl.textContent = `🧠 Entrenando... Época ${epoch+1}/${epocas} - Loss: ${logs.loss.toFixed(4)}, Val Loss: ${logs.val_loss.toFixed(4)}`;
            //   // console.log(`[Entrenamiento] Época ${epoch+1}/${epocas} - Loss: ${logs.loss.toFixed(4)}, Val Loss: ${logs.val_loss.toFixed(4)}`);
            // }
          })
          // Puedes agregar más callbacks aquí si es necesario
      ]
    });

    console.log(`[Entrenamiento MultiSímbolo] Entrenamiento finalizado.`);
    console.log('Historial de entrenamiento:', history.history);

    // 8. Calcular métricas finales
    estadoEl.textContent = '📊 Calculando métricas finales...';
    console.log(`[Entrenamiento MultiSímbolo] Calculando métricas finales...`);

    const [trainLoss, trainAcc] = modelo.evaluate(X_train, y_train);
    const [valLoss, valAcc] = modelo.evaluate(X_val, y_val);

    const trainAccPct = (await trainAcc.data())[0] * 100;
    const valAccPct = (await valAcc.data())[0] * 100;
    const trainLossVal = (await trainLoss.data())[0];
    const valLossVal = (await valLoss.data())[0];

    console.log(`[Entrenamiento MultiSímbolo] Métricas Finales - Entrenamiento: Loss: ${trainLossVal.toFixed(4)}, Acc: ${trainAccPct.toFixed(2)}%`);
    console.log(`[Entrenamiento MultiSímbolo] Métricas Finales - Validación: Loss: ${valLossVal.toFixed(4)}, Acc: ${valAccPct.toFixed(2)}%`);

    // Actualizar estado final con métricas
    estadoEl.textContent = `✅ Modelo entrenado. Val Loss: ${valLossVal.toFixed(4)}, Val Acc: ${valAccPct.toFixed(2)}%`;
    estadoEl.style.color = trainAccPct >= 55 && valAccPct >= 55 ? '#4CAF50' : '#FF9800'; // Verde si >55%, naranja si no

    // 9. Limpiar tensores para liberar memoria
    X_total.dispose();
    y_total.dispose();
    X_shuffled.dispose();
    y_shuffled.dispose();
    X_train.dispose();
    y_train.dispose();
    X_val.dispose();
    y_val.dispose();

    console.log(`[Entrenamiento MultiSímbolo] Memoria liberada.`);

  } catch (err) {
    console.error('❌ Error en entrenarRed (MultiSímbolo):', err);
    // Actualizar estado con el error
    const estadoEntrenamientoEl = document.getElementById('estado');
    if (estadoEntrenamientoEl) {
        estadoEntrenamientoEl.textContent = `❌ Error entrenando: ${err.message}`;
        estadoEntrenamientoEl.style.color = '#ef5350'; // Color rojo para error
    } else {
        // Si no se encuentra el elemento específico, podrías usar el estado general
        document.getElementById('estado').textContent = `❌ Error entrenando: ${err.message}`;
    }
  }
}
window._entrenarRed = entrenarRed;


async function predecirprueba(ultimosPrecios, ultimosVolumenes, rsiActual, emaActual, macdActual, signalActual, posicionBB, anchoBB, atrActual, obvActual, precioActual, openInterest = 0) {
  if (!modelo) {
    console.warn('[PRED] Modelo no cargado');
    return null;
  }

  // Validación mínima
  if (ultimosPrecios.length < 10 || ultimosVolumenes.length < 10) {
    console.warn('[PRED] Datos insuficientes para predecir');
    return null;
  }

  const ultimos10 = ultimosPrecios.slice(-10);
  const cambios = ultimos10.map((p, idx) => idx === 0 ? 0 : (p - ultimos10[idx - 1]) / ultimos10[idx - 1]);

  const volumenPromedio = ultimosVolumenes.slice(-10).reduce((a, b) => a + b, 0) / 10 / 1e6;
  const rsiNorm = rsiActual / 100;
  const precioSobreEMA = precioActual > emaActual ? 1 : 0;
  const rsiSobreComprado = rsiActual > 70 ? 1 : 0;
  const rsiSobreVendido = rsiActual < 30 ? 1 : 0;
  const macdNorm = macdActual / 1000;
  const signalNorm = (signalActual || 0) / 1000;
  const histogramaNorm = (macdActual - signalActual) / 1000;
  const anchoBBRel = anchoBB / precioActual;
  const atrRel = atrActual / precioActual;
  const obvNorm = obvActual / 1e9;
  const oiNorm = openInterest / 1e6;

  const features = [
    ...cambios,
    volumenPromedio,
    rsiNorm,
    precioSobreEMA,
    rsiSobreComprado,
    rsiSobreVendido,
    macdNorm,
    signalNorm,
    histogramaNorm,
    posicionBB,
    anchoBBRel,
    atrRel,
    obvNorm,
    oiNorm
  ];

  // 🔍 DIAGNÓSTICO: imprimir features con etiquetas
  if (features.length === 23) {
    console.table({
      'cambio_p0': cambios[0],
      'cambio_p1': cambios[1],
      'cambio_p2': cambios[2],
      'cambio_p3': cambios[3],
      'cambio_p4': cambios[4],
      'cambio_p5': cambios[5],
      'cambio_p6': cambios[6],
      'cambio_p7': cambios[7],
      'cambio_p8': cambios[8],
      'cambio_p9': cambios[9],
      'volumen_prom_10': volumenPromedio,
      'rsi_norm': rsiNorm,
      'precio_sobre_ema': precioSobreEMA,
      'rsi_sobrecomprado': rsiSobreComprado,
      'rsi_sobrevendido': rsiSobreVendido,
      'macd_norm': macdNorm,
      'signal_norm': signalNorm,
      'histograma_norm': histogramaNorm,
      'posicion_bb': posicionBB,
      'ancho_bb_rel': anchoBBRel,
      'atr_rel': atrRel,
      'obv_norm': obvNorm,
      'open_interest_norm': oiNorm
    });

    // Hacer la predicción
    const input = tf.tensor2d([features]);
    const pred = modelo.predict(input);
    const valor = await pred.data();

    input.dispose();
    pred.dispose();

    console.log(`✅ Predicción RAW: ${valor[0].toFixed(4)} | Confianza: ${(valor[0] > 0.5 ? valor[0] : 1 - valor[0]).toFixed(4)}`);
    return valor[0];
  } else {
    console.error(`❌ [PRED] Número incorrecto de features: ${features.length}`, features);
    return null;
  }
}



async function predecir(ultimosPrecios, ultimosVolumenes, rsiActual, emaActual, macdActual, signalActual, posicionBB, anchoBB, atrActual, obvActual, precioActual, openInterest = 0) {
  if (!modelo) return null;

  const ultimos10 = ultimosPrecios.slice(-10);
  const cambios = ultimos10.map((p, idx) => idx === 0 ? 0 : (p - ultimos10[idx - 1]) / ultimos10[idx - 1]);
   
   // 🔧 OBV: desactivado en Testnet


  const features = [
    ...cambios,
    ultimosVolumenes.slice(-10).reduce((a, b) => a + b, 0) / 10 / 1e6,
    rsiActual / 100,
    precioActual > emaActual ? 1 : 0,
    rsiActual > 70 ? 1 : 0,
    rsiActual < 30 ? 1 : 0,
    macdActual / 1000,
    (signalActual || 0) / 1000,
    (macdActual - signalActual) / 1000,
    posicionBB,
    anchoBB / precioActual,
    atrActual / precioActual,
    obvActual / 1e9,// ✅ ¡Usar esta variable, no obvActual / 1e9!  ,para testnet, en Maint se devuelve el cambio/se elimina 0bv=0    obvActual / 1e9,
    openInterest / 1e6
  ];

  if (features.length !== 23) {
    console.warn(`[Predicción] Features ≠ 23 (${features.length}). Saltando predicción.`);
    return null;
  }

  const input = tf.tensor2d([features]);
  const pred = modelo.predict(input);
  const valor = await pred.data();

  input.dispose();
  pred.dispose();

  return valor[0]; // ← ¡SOLO DEVUELVE EL VALOR! NADA MÁS.
}


function registrarResultadoIA(prediccion, resultado) {
  const { prediccionRaw, confianza, direccion, precioInicio, timestamp } = prediccion;
  const { acierto, retorno, precioFuturo } = resultado;

  // Guardar registro completo
  const registro = {
    id: window.configEstadisticasIA.total + 1,
    timestamp: new Date(timestamp).toLocaleString(),
    precioInicio,
    precioFuturo,
    retorno: (retorno * 100).toFixed(2),
    prediccionRaw: prediccionRaw.toFixed(4),
    confianza: (confianza * 100).toFixed(1),
    direccionPredicha: direccion,
    direccionReal: retorno > 0 ? 'SUBIDA' : 'BAJADA',
    resultado: acierto ? 'ACIERTO' : 'FALLO'
  };

  window.configEstadisticasIA.registros.push(registro);
  window.configEstadisticasIA.total++;
  if (acierto) window.configEstadisticasIA.aciertos++;

  // Actualizar UI
// Actualizar UI
  document.getElementById('progreso-predicciones').textContent = window.configEstadisticasIA.total;
  document.getElementById('aciertos-predicciones').textContent = window.configEstadisticasIA.aciertos; // ← NUEVO
  const precision = (window.configEstadisticasIA.aciertos / window.configEstadisticasIA.total * 100).toFixed(1);
  document.getElementById('precision-actual').textContent = `${precision}%`; console.log(`Progureso -Prediccion : progreso-predicciones`);
  console.log(`Prediccion-Actual : precision-actual`);


  // ¿Alcanzó el objetivo?
  if (window.configEstadisticasIA.total >= window.configEstadisticasIA.objetivo) {
    const resumen = `🎯 ¡Objetivo alcanzado! Precisión final: ${precision}% (${window.configEstadisticasIA.aciertos}/${window.configEstadisticasIA.total})`;
    document.getElementById('resumen-final').textContent = resumen;
    document.getElementById('resumen-final').style.display = 'block';
    document.getElementById('btn-exportar-ia').style.display = 'inline-block';
  }
}

function exportarEstadisticasIA() {
  if (window.configEstadisticasIA.registros.length === 0) {
    alert('No hay datos para exportar.');
    return;
  }

  // Encabezados
  const headers = [
    'ID', 'Fecha', 'Precio Inicio', 'Precio Futuro', 'Retorno (%)',
    'Predicción RAW', 'Confianza (%)', 'Dirección Predicha',
    'Dirección Real', 'Resultado'
  ];

  // Filas
  const filas = window.configEstadisticasIA.registros.map(r => [
    r.id, r.timestamp, r.precioInicio, r.precioFuturo, r.retorno,
    r.prediccionRaw, r.confianza, r.direccionPredicha,
    r.direccionReal, r.resultado
  ]);

  // Convertir a CSV
  let csv = headers.join(',') + '\n';
  csv += filas.map(fila => 
    fila.map(campo => `"${campo}"`).join(',')
  ).join('\n');

  // Descargar
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `estadisticas_ia_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function reiniciarEstadisticasIA() {
  // ✅ Valor por defecto si no hay configuración previa
  const objetivoActual = window.configEstadisticasIA?.objetivo || 20;

  window.configEstadisticasIA = {
    objetivo: objetivoActual,
    registros: [],
    total: 0,
    aciertos: 0
  };

  // Actualizar UI
  document.getElementById('progreso-predicciones').textContent = '0';
  document.getElementById('precision-actual').textContent = '—';
  document.getElementById('aciertos-predicciones').textContent = '—';
  document.getElementById('resumen-final').style.display = 'none';

  // Opcional: limpiar localStorage si lo usas
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('estadisticasIA');
  }

  console.log('📊 Estadísticas de IA reiniciadas.');
}

//document.getElementById('btn-reiniciar-ia').addEventListener('click', reiniciarEstadisticasIA);

// Vincular botón
document.getElementById('btn-exportar-ia').addEventListener('click', exportarEstadisticasIA);





function renderizarHistorial() {
  const tbody = document.querySelector('#historial tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  operaciones.slice(0, 10).forEach(op => {
    const ent = new Date(op.timestampEntrada).toLocaleTimeString();
    const sal = new Date(op.timestampSalida).toLocaleTimeString();
    const gan = op.ganancia !== undefined ? op.ganancia : 0;
    const color = gan >= 0 ? '#26a69a' : '#ef5350';
    const sim = gan >= 0 ? '+' : '-';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${ent}</td>
      <td>${sal}</td>
      <td>$${(op.entrada || 0).toFixed(4)}</td>
      <td>$${(op.salida || 0).toFixed(4)}</td>
      <td style="color:${color}">${sim}$${gan.toFixed(4)}</td>
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
        text: `[RENDER] ${mensaje}`, // ✅ Prefijo para Render
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


// ✅ REGISTRAR OPERACIÓN — Corregido: calcula PnL bruta y neta desde datos reales, sin duplicar apalancamiento, usa leverage real
function registrarOperacionReal(symbol, side, entrada, salida, cantidad, pnl, motivo = 'Manual', datosBinance = null) {
  // 1. Validación de datos
  if (!symbol || isNaN(entrada) || isNaN(salida) || isNaN(cantidad) || isNaN(pnl)) {
    console.warn('⚠️ Datos inválidos en registrarOperacionReal');
    return;
  }

  // 2. Calcular fees reales (usar datos de Binance si están disponibles)
  let feesTotales = 0;
  if (datosBinance && datosBinance.fee != null) { // <-- Busca 'fee' como se pasa desde cerrarParcial y cerrarPosicion
    // Fees proporcionados por Binance (más precisos)
    feesTotales = parseFloat(datosBinance.fee);
    // Opcional: Validar que fees no sea NaN o negativo
    if (isNaN(feesTotales) || feesTotales < 0) {
        feesTotales = 0; // Fallback seguro
        console.warn('⚠️ Fee de Binance inválido, usando 0.');
    }
  } else {
    // Cálculo estimado de fees (0.1% por ejecución: 0.05% apertura + 0.05% cierre)
    // Usar el valor nominal de la operación para estimar fees
    const valorOperado = Math.abs(cantidad * entrada); // Puede ser mejor usar el de cierre o promedio si se cierra parcialmente
    feesTotales = valorOperado * 0.001; // 0.1% estimado
    console.log(`⚠️ Usando fee estimado: $${feesTotales.toFixed(4)}`);
  }

  // 3. Calcular PnL Bruta independientemente desde precios - CORREGIDO: SIN * LEVERAGE
  // 'cantidad' es 'positionAmt' o 'sizeParcial', que ya incluye el apalancamiento implícitamente en su valor nominal.
  // Multiplicar por 'leverage' otra vez lo duplica. La PnL bruta en USDT es (precioSalida - precioEntrada) * cantidad.
  // USAMOS EL APLACAMIENTO REAL DE 'datosBinance' O UN FALBACK
  const leverage = datosBinance && datosBinance.leverage != null ? parseFloat(datosBinance.leverage) : (parseFloat(document.getElementById('apalancamiento')?.value) || 4);
  let pnlBrutaCalculada;
  if (side === 'LONG') {
      pnlBrutaCalculada = (salida - entrada) * cantidad; // <-- CORRECTO: Sin * leverage
  } else if (side === 'SHORT') {
      pnlBrutaCalculada = (entrada - salida) * cantidad; // <-- CORRECTO: Sin * leverage
  } else {
      console.error(`❌ Side desconocido: ${side}. No se puede calcular PnL bruta.`);
      return; // Detener si el side no es válido
  }

  // 4. Calcular ROE real (retorno sobre margen) - USANDO EL APLACAMIENTO REAL
  // El margen es el valor nominal dividido por el apalancamiento
  const margenUsado = Math.abs(cantidad * entrada) / leverage;
  // ROE es PnL neta sobre el margen usado
  const roePct = margenUsado !== 0 ? (pnl / margenUsado) * 100 : 0;

  // 5. Crear objeto de operación con los valores calculados correctamente
  const op = {
    entrada: parseFloat(entrada) || 0,
    salida: parseFloat(salida) || 0,
    ganancia: parseFloat(pnl) || 0, // Usar la PnL neta ya calculada
    gananciaBruta: parseFloat(pnlBrutaCalculada) || 0, // Usar el valor calculado CORRECTAMENTE
    fees: parseFloat(feesTotales) || 0,
    montoInvertido: Math.abs(cantidad * entrada),
    margenUsado: margenUsado,
    roe: roePct,
    timestampEntrada: Date.now() - 60000, // Ajustar si se tiene el real
    timestampSalida: Date.now(), // Ajustar si se tiene el real
    resultado: (pnl >= 0) ? 'GANANCIA' : 'PÉRDIDA',
    simbolo: symbol,
    motivo,
    side,
    apalancamiento: leverage // <-- GUARDAMOS EL APLACAMIENTO REAL USADO
  };

  // 6. Guardar en historial
  operaciones.unshift(op);
  if (operaciones.length > 50) operaciones = operaciones.slice(0, 50);
  localStorage.setItem('historialOperaciones', JSON.stringify(operaciones));

  // 7. Actualizar panel financiero
  actualizarPanelFinanciero();
  renderizarHistorial();

  // 8. Preparar mensaje de Telegram con todos los detalles
  const cambioPrecioPct = entrada !== 0 ? ((salida - entrada) / entrada) * 100 : 0;
  const simPnl = pnl >= 0 ? '+' : '-';
  const emoji = pnl >= 0 ? '🟢' : '🔴';
  const dirPrecio = cambioPrecioPct >= 0 ? '+' : '-';

  // ✅ Mensaje completo con PnL bruto, fees y neto (usando valores calculados o recibidos)
  const msg = `${emoji} *${symbol} ${side}* (${motivo})
  Entrada: $${entrada.toFixed(4)}
  Salida: $${salida.toFixed(4)}
  Δ Precio: ${dirPrecio}${Math.abs(cambioPrecioPct).toFixed(4)}%
  ROE: ${roePct >= 0 ? '+' : ''}${roePct.toFixed(4)}% (x${leverage})
  PnL Bruto: ${pnlBrutaCalculada >= 0 ? '+' : '-'}$${Math.abs(pnlBrutaCalculada).toFixed(4)}
  Fees: -$${feesTotales.toFixed(3)}
  PnL Neto: ${simPnl}$${Math.abs(pnl).toFixed(4)}`;

// 8.5. IMPRIMIR EL MENSAJE FINAL PARA DEPURACIÓN
  console.log('[DEBUG] Mensaje Telegram a enviar (antes de enviar):', msg);

  // 9. Enviar a Telegram
  enviarTelegram(msg);

  // 10. Log para debugging
  console.log(`[OPERACIÓN REGISTRADA] ${symbol} ${side} | ROE: ${roePct.toFixed(2)}% | PnL Bruto: $${pnlBrutaCalculada.toFixed(2)} | Fees: $${feesTotales.toFixed(3)} | PnL Neto: $${pnl.toFixed(2)} | Leverage: ${leverage}`);
}
// === CAPITAL TESTNET ===




// En script-tapa.txt (asegúrate de que estas variables estén definidas globalmente o accesibles)
// let streamingInterval = null; // <-- Debe existir
// let autoTrading = false;      // <-- Debe existir

// Añadir o asegurar esta función en script-tapa.txt
// ✅ ACTUALIZAR LÍNEAS DE PRECIOS — Para PE/TP/SL (Ahora considera LONG/SHORT y ajusta escala del gráfico)
function actualizarLineasPrecios(entrada, tpPct, slPct, leverage) {
  // Asegurarse de que las líneas y el gráfico existan
  if (!chart || !lineaPE || !lineaTP || !lineaSL) {
    console.warn("advertencia: chart o una o más líneas (PE/TP/SL) no están inicializadas.");
    return;
  }

  // Asumimos que 'sideActual' es una variable global que indica 'LONG' o 'SHORT'
  // Esta variable debe actualizarse cada vez que se abre una nueva posición
  // y limpiarse cuando se cierra la última posición.
  // Asegúrate de que 'sideActual' esté definida globalmente antes de usarla aquí.
  if (typeof window.sideActual === 'undefined' || window.sideActual === null) {
    // console.warn("advertencia: sideActual no está definido o es null. No se actualizarán las líneas.");
     return;
  }

  const side = window.sideActual; // <-- Leemos el side global

  const tiempoActual = Math.floor(Date.now() / 1000);

  // Calcular niveles de TP y SL en precio (no en porcentaje)
  // LONG: TP > entrada, SL < entrada
  // SHORT: TP < entrada, SL > entrada
  let precioTP, precioSL;

  if (side === 'LONG') {
    precioTP = entrada * (1 + (tpPct / 100));
    precioSL = entrada * (1 - (slPct / 100));
  } else if (side === 'SHORT') {
    precioTP = entrada * (1 - (tpPct / 100)); // TP por debajo para SHORT
    precioSL = entrada * (1 + (slPct / 100)); // SL por encima para SHORT
  } else {
    console.error(`Error: side desconocido "${side}" en actualizarLineasPrecios. No se actualizarán las líneas.`);
    return;
  }

  // Actualizar datos de las series
  const dataPE = [{ time: tiempoActual - 60, value: entrada }, { time: tiempoActual, value: entrada }];
  const dataTP = [{ time: tiempoActual - 60, value: precioTP }, { time: tiempoActual, value: precioTP }];
  const dataSL = [{ time: tiempoActual - 60, value: precioSL }, { time: tiempoActual, value: precioSL }];

  lineaPE.setData(dataPE);
  lineaTP.setData(dataTP);
  lineaSL.setData(dataSL);


  console.log(`[Gráfico] Líneas actualizadas - PE: ${entrada.toFixed(4)}, TP (${side}): ${precioTP.toFixed(4)}, SL (${side}): ${precioSL.toFixed(4)}`);


  // Determinar límites superior e inferior del rango de precios
  const precios = [entrada, precioTP, precioSL];
  const precioMin = Math.min(...precios);
  const precioMax = Math.max(...precios);

  // Añadir un margen porcentual (ej: 0.5% o 1%) alrededor del rango PE-TP-SL
  // para que no estén justo en los bordes
  const margenPorcentaje = 0.01; // 1% de margen
  const rango = precioMax - precioMin;
  // Usar un margen absoluto mínimo para evitar problemas si rango es muy pequeño o cero
  const margenAbsoluto = Math.max(rango * margenPorcentaje, entrada * 0.0005); // Ajusta el 0.0005 según sea necesario

  const limiteInferior = precioMin - margenAbsoluto;
  const limiteSuperior = precioMax + margenAbsoluto;

  // Opción: Aplicar opciones a la escala de precio para enfocarse en el rango
  // Esto implica desactivar la autoescala y posiblemente ajustar los márgenes
  // para que el rango de precios deseado ocupe la mayor parte del área vertical del gráfico.
  try {
     // Los valores de margen deben ser ajustados para lograr el "zoom" deseado.
     const margenSuperiorRelativo = 0.15; // Ajusta este valor (0.10 a 0.25 típicamente)
     const margenInferiorRelativo = 0.15; // Ajusta este valor (0.10 a 0.25 típicamente)

     chart.priceScale().applyOptions({
         autoScale: false, // Desactivar autoescala para que respete scaleMargins
         scaleMargins: {
             top: margenSuperiorRelativo,
             bottom: margenInferiorRelativo,
         },
         // Opcional: Puedes intentar forzar el rango mínimo/máximo si autoScale está desactivado
         // Es mejor depender de scaleMargins con autoScale: false para el zoom relativo.
     });
     // Opcional: Forzar un ajuste del gráfico después de aplicar las opciones
     // chart.timeScale().fitContent(); // Esto ajusta el tiempo, no el precio
     // No hay un "reflow" directo, pero aplicar las opciones debería actualizar la vista.

     console.log(`[Gráfico] Escala ajustada con autoScale: false y scaleMargins - Rango relativo enfocado.`);
     console.log(`[Gráfico] Límites de precios calculados: ${limiteInferior.toFixed(2)} a ${limiteSuperior.toFixed(2)}`);
  } catch (e) {
     // Si applyOptions falla (menos probable, pero por si acaso)
     console.warn("[Gráfico] applyOptions para ajustar escala falló:", e.message);
     // No hay mucho más que hacer si ni applyOptions funciona.
     // El gráfico seguirá usando su comportamiento por defecto.
  }
}
// ✅ FUNCIÓN AUXILIAR PARA TOOLTIPS
function crearTooltip(id, color, valor) {
  const container = document.getElementById('chart');
  const tooltip = document.createElement('div');
  tooltip.id = `tooltip-${id}`;
  tooltip.style.position = 'absolute';
  tooltip.style.top = '10px';
  tooltip.style.right = id === 'pe' ? '10px' : id === 'tp' ? '70px' : '130px';
  tooltip.style.backgroundColor = 'rgba(0,0,0,0.7)';
  tooltip.style.color = color;
  tooltip.style.padding = '4px 8px';
  tooltip.style.borderRadius = '4px';
  tooltip.style.fontSize = '0.85em';
  tooltip.style.zIndex = '1000';
  tooltip.textContent = `${id.toUpperCase()}: $${valor.toFixed(2)}`;
  container.parentElement.appendChild(tooltip);
  return tooltip;
}

// ✅ OCULTAR LÍNEAS — Cuando no hay posiciones abiertas
function ocultarLineasPrecios() {
  if (lineaPE) lineaPE.setData([]);
  if (lineaTP) lineaTP.setData([]);
  if (lineaSL) lineaSL.setData([]);
  
  // ✅ Ocultar tooltips
  const tooltips = ['pe', 'tp', 'sl'];
  tooltips.forEach(id => {
    const tooltip = document.getElementById(`tooltip-${id}`);
    if (tooltip) tooltip.style.display = 'none';
  });
}

// === ÓRDENES ===
async function abrirPosicionReal(side) {
  //if (!AUTENTICADO) return;
  try {
    
    const simbolo = document.getElementById('selector-simbolo').value;
    const ticker = await (await fetch(`/api/binance/ticker?symbol=${simbolo}`)).json();
    const precio = parseFloat(ticker.price);
    let monto = parseFloat(document.getElementById('montoCompra').value) || 100;
    if (monto < 100) monto = 100;
    let qty = symbolInfo ? calculateQuantity(precio, monto) : Math.floor((monto / precio) / 0.001) * 0.001;
    const lev = parseInt(document.getElementById('apalancamiento').value) || 2;
    console.log(`🔍 [DEBUG] Monto deseado: $${monto}`);
    console.log(`🔍 [DEBUG] Precio: $${precio}`);
    console.log(`🔍 [DEBUG] Size calculado: ${qty.toFixed(8)} BTC`);
    console.log(`🔍 [DEBUG] Notional real: $${(qty * precio).toFixed(3)}`);
    
    const tpslMode = document.getElementById('tpsl-mode')?.value || 'dinamico';
    let takeProfit = 3.0; // valores por defecto (manual)
    let stopLoss = 1.5;
  
    // En abrirPosicionReal():
    if (tpslMode === 'manual') {
      takeProfit = Math.max(0.5, parseFloat(document.getElementById('takeProfit').value) || 3.0); // ← de 1.5 → 3.0
      stopLoss = Math.max(0.25, parseFloat(document.getElementById('stopLoss').value) || 1.5);  // ← de 0.5 → 1.5
    } else {
      
      // Obtener ATR reciente (mismo que usas en otros lugares)
      const simbolo = document.getElementById('selector-simbolo').value;
      const k5m = await obtenerDatos(simbolo, '5m', 50);
     
      const atrArr = k5m.length >= 20 ? calcularATR(k5m, 14):[];
      const atrVal = atrArr.length > 0 ? atrArr[atrArr.length - 1] : 0;

      const tpMult = parseFloat(document.getElementById('tp-mult')?.value) || 2.0;
      const slMult = parseFloat(document.getElementById('sl-mult')?.value) || 1.0;

      takeProfit = (atrVal * tpMult / precio) * 100;
      stopLoss = (atrVal * slMult / precio) * 100;
      console.log(`🔍 [DEBUG] TP dinámico: ${takeProfit.toFixed(2)}%`);
      console.log(`🔍 [DEBUG] SL dinámico: ${stopLoss.toFixed(2)}%`);
      console.log(`🔍 [DEBUG] ATR usado: En Abrir Posicion Real: ${atrVal.toFixed(2)}`);

   
    };

    
    // 1. Cambiar apalancamiento
    const token = localStorage.getItem('authToken');
    const leverageRes = await fetch('/api/binance/futures/leverage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`, // ← ¡Obligatorio!
        'Content-Type': 'application/json'
      },
       
    
      body: JSON.stringify({ symbol: simbolo, leverage: lev })
    });
    if (!leverageRes.ok) {
      const leverageErr = await leverageRes.json();
      console.error('⚠️ Error cambiando apalancamiento:', leverageErr);
      // Opcional: lanzar error y detener la apertura
      throw new Error(`Error cambiando apalancamiento: ${leverageErrr.msg || 'Desconocido'}`);
    } else {
      console.log('✅ Apalancamiento cambiado a:', lev);
    }

    // 2. Abrir la posición
    const res = await fetch('/api/binance/futures/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` // ← ¡Agregado!
      },
     
      body: JSON.stringify({ symbol: simbolo, side, quantity: qty.toString() /*, leverage: lev */ }) // <-- 'leverage' ya no va aquí
    });


    const orderData = await res.json();

    // ✅ Manejar respuesta (incluyendo -1007)
   
    await manejarRespuestaOrden(res, orderData, simbolo);


    
    // Si llega aquí, la orden se ejecutó o el estado fue verificado

    console.log(`🟢 Orden ${side} abierta | TP: ${takeProfit.toFixed(2)}% | SL: ${stopLoss.toFixed(2)}%`);
 
    document.getElementById('estado').textContent = `✅ ${side} ${qty} ${simbolo}`;
    
    // ✅ Guardar TP/SL por símbolo para cierre consistente
    tpSlConfig[simbolo] = { tpPct: takeProfit, slPct: stopLoss, modo: tpslMode };
    


  window.sideActual = side === 'BUY' ? 'LONG' : 'SHORT'; // ✅ Solo actualiza sideActual
  console.log(`[DEBUG] sideActual actualizado a: ${window.sideActual} para ${simbolo}`);

// ...
  await actualizarPosicionesAbiertas();

  // 👇 AGREGA ESTO:
iniciarRefrescoPosiciones(); // Activa el refresco visual cada 2s
  
  } catch (err) {
   // console.error('🔴 abrirPosicionReal error:', err);
   // const msg = err.message.includes('-4164') ? '❌ Notional < 100 USDT' : `❌ ${err.message}`;
    //document.getElementById('estado').textContent = msg;
   // ✅ Guardar TP/SL por símbolo para cierre consistentetpSlConfig[window.simboloActual] = { tpPct: takeProfit, slPct: stopLoss, modo: tpslMode };
  // [Agregado] Actualizar sideActual global para el gráfico
  // Convertimos 'BUY'/'SELL' a 'LONG'/'SHORT'
   //window.sideActual = side === 'BUY' ? 'LONG' : 'SHORT';
  // console.log(`[DEBUG] sideActual actualizado a: ${window.sideActual} para ${window.simboloActual}`);
// ...
//await actualizarPosicionesAbiertas();
  }
}

let tpSlConfig = {}; // { BTCUSDT: { tpPct, slPct, modo } }

// ✅ CERRAR PARCIAL — Corregido: calcula PnL neta real y fees reales, SIN DUPLICAR APLACAMIENTO, pasa leverage
async function cerrarParcial(symbol, positionSide, sizeParcial, motivo) {
  try {
    const posResponse = await fetchConAuth('/api/binance/futures/positions');

    const posiciones = await posResponse.json();
    const posicion = posiciones.find(p => p.symbol === symbol && p.positionSide === positionSide);
    if (!posicion || Math.abs(parseFloat(posicion.positionAmt || 0)) < 0.0001) {
      throw new Error(`Sin posición para ${symbol}`);
    }
    const precioEntrada = parseFloat(posicion.entryPrice) || 0;
    const positionAmt = parseFloat(posicion.positionAmt) || 0;
    const sideActual = positionAmt > 0 ? 'LONG' : 'SHORT';
    const leverage = parseFloat(posicion.leverage) || 1; // <-- Aseguramos usar el leverage real de la posicion


    // ✅ 1. Enviar orden parcial
    const closeRes = await fetchConAuth('/api/binance/futures/close-position', {
     method: 'POST',
      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({
        symbol,
        positionSide,
        quantity: sizeParcial.toString()
      })
    });

     const closeData = await closeRes.json();

    const resultado = closeData

 

    // ✅ Manejar respuesta (incluyendo -1007)
    await manejarRespuestaOrden(closeRes, closeData, symbol);

    // Si llega aquí, el cierre se ejecutó o el estado fue verificado
    console.log("✅ Cierre procesado (o estado verificado). Continuando con cálculos...");




    // ✅ 2. Obtener precio real de cierre con validaciones robustas
    let precioSalida = precioEntrada;
    if (resultado && resultado.avgPrice) {
      const avg = parseFloat(resultado.avgPrice);
      if (avg > 0 && !isNaN(avg)) precioSalida = avg;
    } else {
         // Si avgPrice no está, usar markPrice como fallback
         if (posicion && posicion.markPrice) {
            const mark = parseFloat(posicion.markPrice);
            if (mark > 0 && !isNaN(mark)) precioSalida = mark;
         }
         console.warn(`⚠️ avgPrice no encontrado en resultado de cierre parcial para ${symbol}. Usando markPrice o entrada.`);
    }

    if (precioSalida <= 0 || isNaN(precioSalida)) {
      try {
        const ticker = await (await fetch(`/api/binance/ticker?symbol=${symbol}`)).json();
        const precioTicker = parseFloat(ticker.price);
        if (precioTicker > 0 && !isNaN(precioTicker)) precioSalida = precioTicker;
      } catch (e) {
        console.warn('⚠️ Error obteniendo ticker para fallback en cerrarParcial');
      }
    }

    if (precioSalida <= 0 || isNaN(precioSalida)) {
      precioSalida = precioEntrada;
      console.error(`🚨 Precio de salida inválido en cerrarParcial para ${symbol}. Usando entrada: $${precioEntrada}`);
    }

    // ✅ 3. Calcular PnL BRUTA (antes de fees) para la parte cerrada - CORREGIDO: SIN * LEVERAGE
    // La fórmula (precioSalida - precioEntrada) * sizeParcial ya da la PnL en USDT para el tamaño nominal cerrado.
    // El apalancamiento ya está reflejado en el tamaño nominal 'sizeParcial' en relación al margen.
    const pnlBruta = sideActual === 'LONG'
      ? (precioSalida - precioEntrada) * sizeParcial // <-- CORRECTO: Sin * leverage
      : (precioEntrada - precioSalida) * sizeParcial; // <-- CORRECTO: Sin * leverage

    // ✅ 4. Calcular fees TOTALES reales de la operación de cierre
    let feesTotales = 0;
    if (resultado && resultado.fills && Array.isArray(resultado.fills)) {
      feesTotales = resultado.fills.reduce((total, fill) => {
        const comm = parseFloat(fill.commission) || 0;
        // Asumimos que la comisión está en USDT o una stablecoin equivalente
        return total + comm;
      }, 0);
    } else {
      // Fallback: estimar fees basado en el valor nominal de la operación cerrada
      const valorNominalCierre = sizeParcial * precioSalida;
      feesTotales = valorNominalCierre * 0.0005; // 0.05% por lado (taker) - Ajustar si es maker
      console.log(`⚠️ Usando fee estimado para cierre parcial: $${feesTotales.toFixed(4)}`);
    }

    // ✅ 5. Calcular PnL NETA REAL
    const pnlNeta = pnlBruta - feesTotales;

    // ✅ 6. Registrar operación REAL con PnL neta y fees reales
    // PASAMOS EL 'leverage' REAL en el objeto datosBinance
    registrarOperacionReal(symbol, sideActual, precioEntrada, precioSalida, sizeParcial, pnlNeta, motivo, {
      fee: feesTotales, // Nombre del campo ajustado para coincidir con la lógica de registrarOperacionReal (busca 'fee')
      fills: resultado.fills || null, // Opcional: para debugging
      avgPrice: precioSalida, // Opcional: para debugging
      leverage: leverage // <-- PASAMOS EL APLACAMIENTO REAL
    });

    await actualizarPosicionesAbiertas();
  } catch (err) {
    console.error(`CloseOperation parcial fallida: ${err.message}`);
    document.getElementById('estado').textContent = `CloseOperation parcial fallida: ${err.message}`;
  }
}

async function cerrarPosicion(symbol, positionSide = 'BOTH', motivo = 'Manual') {
  try {
       const token = localStorage.getItem('authToken');
    // 1. Obtener posiciones actuales
    const posResponse = await fetchConAuth('/api/binance/futures/positions');
    const posiciones = await posResponse.json();
    const posicion = Array.isArray(posiciones)
      ? posiciones.find(p => p.symbol === symbol && p.positionSide === positionSide)
      : null;

    // 2. Validar existencia
    if (!posicion || Math.abs(parseFloat(posicion.positionAmt || 0)) < 0.0001) {
      throw new Error(`Sin posición abierta para ${symbol}`);
    }

    // 3. Extraer datos reales
    const precioEntrada = parseFloat(posicion.entryPrice) || 0; // Usar entryPrice, no markPrice
    const positionAmt = parseFloat(posicion.positionAmt) || 0;
    const cantidad = Math.abs(positionAmt); // Cantidad total cerrada
    const sideActual = positionAmt > 0 ? 'LONG' : 'SHORT';
    const leverage = parseFloat(posicion.leverage) || 1; // <-- Aseguramos usar el leverage real de la posicion

    // 4. Cerrar en Binance
    const closeRes = await fetchConAuth('/api/binance/futures/close-position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, positionSide })

    });
    const resultado = await closeRes.json();

    // ✅ 5. Obtener precio de cierre REAL (promedio ponderado de la orden)
    let precioSalida = precioEntrada; // Fallback
    if (resultado && resultado.avgPrice != null) {
      const avg = parseFloat(resultado.avgPrice);
      if (!isNaN(avg) && avg > 0) {
          precioSalida = avg;
      } else {
          console.warn('⚠️ avgPrice inválido en respuesta de cierre, usando markPrice o entrada...');
          precioSalida = parseFloat(posicion.markPrice) || precioEntrada;
      }
    } else {
      // Fallback si avgPrice no está en la respuesta
      precioSalida = parseFloat(posicion.markPrice) || precioEntrada;
    }

    if (precioSalida <= 0 || isNaN(precioSalida)) {
      console.error(`🚨 Precio de salida inválido en cerrarPosicion para ${symbol}. Usando entrada: $${precioEntrada}`);
      precioSalida = precioEntrada;
    }

    // ✅ 6. Calcular fees TOTALES reales de la operación de cierre
    let feesTotales = 0;
    if (resultado && resultado.fills && Array.isArray(resultado.fills)) {
      feesTotales = resultado.fills.reduce((total, fill) => {
        const comm = parseFloat(fill.commission) || 0;
        // Asumimos que la comisión está en USDT o una stablecoin equivalente
        return total + comm;
      }, 0);
    } else {
        // Fallback: estimar fees basado en el valor nominal de la operación cerrada
        const valorNominalCierre = cantidad * precioSalida;
        feesTotales = valorNominalCierre * 0.0005; // 0.05% por lado (taker) - Ajustar si es maker
        console.log(`⚠️ Usando fee estimado para cierre total: $${feesTotales.toFixed(4)}`);
    }

    // ✅ 7. Calcular PnL BRUTA REAL (sin duplicar apalancamiento)
    // La PnL bruta (sin fees) para la cantidad cerrada es:
    // (precioSalida - precioEntrada) * positionAmt (si LONG)
    // (precioEntrada - precioSalida) * positionAmt (si SHORT)
    // Que es equivalente a:
    const pnlBruta = (precioSalida - precioEntrada) * positionAmt; // Esta fórmula maneja LONG/SHORT correctamente

    // ✅ 8. Calcular PnL NETA REAL
    const pnlNeta = pnlBruta - feesTotales; // Aplicar leverage ya está incluido en positionAmt

    // 9. Registrar operación REAL con la PnL calculada correctamente
    // PASAMOS EL 'leverage' REAL en el objeto datosBinance
    registrarOperacionReal(symbol, sideActual, precioEntrada, precioSalida, cantidad, pnlNeta, motivo, {
      fee: feesTotales, // Nombre del campo ajustado para coincidir con la lógica de registrarOperacionReal
      fills: resultado.fills || null, // Opcional: para debugging
      avgPrice: precioSalida, // Opcional: para debugging
      leverage: leverage // <-- PASAMOS EL APLACAMIENTO REAL
    });

    // 10. Feedback visual
    const simPnl = pnlNeta >= 0 ? '+' : '-';
    document.getElementById('estado').textContent =
      `✅ ${symbol} ${sideActual} cerrada | ${motivo} | ${simPnl}$${Math.abs(pnlNeta).toFixed(4)} (Fees: $${feesTotales.toFixed(3)})`;

    // 11. Actualizar UI
    await actualizarPosicionesAbiertas();

    // 👇 AGREGA ESTO
    // Opcional: detener refresco si ya no hay posiciones
    // Pero para ser seguro, llamamos a una versión que verifica
    setTimeout(() => {
      // Pequeño retraso para asegurar que la posición ya se cerró en Binance
      actualizarPosicionesAbiertas().then(() => {
        // Si después de actualizar no hay posiciones, detenemos
        const posiciones = document.querySelectorAll('#operaciones-abiertas tbody tr');
        const hayPosiciones = posiciones.length > 0 &&
          !posiciones[0].textContent.includes('Sin posiciones abiertas');
        if (!hayPosiciones) {
          detenerRefrescoPosiciones();
        }
      }).catch(() => {
        detenerRefrescoPosiciones(); // Si falla, detenemos por seguridad
      });
    }, 500);

    //[Agregado] Limpiar sideActual global si ya no hay posiciones abiertas para este símbolo
    // Obtenemos las posiciones actuales de la API
    try {
  const posiciones = await (await fetchConAuth('/api/binance/futures/positions')).json();
  // Buscamos si hay ALGUNA posición abierta para window.simboloActual (no solo la del mismo side, todas)
  const hayPosicionSimbolo = posiciones.some(p => p.symbol === symbol && Math.abs(parseFloat(p.positionAmt)) > 0.0001);

  if (!hayPosicionSimbolo) {
     // No hay más posiciones (de ningún side) para este símbolo
     window.sideActual = null; // Limpiar la variable global
     console.log(`[Gráfico] sideActual limpiado para ${symbol} (posición cerrada y no hay otras abiertas para este símbolo).`);
     // Opcional: Ocultar líneas si se cierra la última posición
     // lineaPE.applyOptions({ visible: false });
     // lineaTP.applyOptions({ visible: false });
     // lineaSL.applyOptions({ visible: false });
  } else {
     // Aún hay posiciones abiertas para este símbolo
     console.log(`[Gráfico] sideActual no se limpia para ${symbol}, aún hay otras posiciones abiertas.`);
  }
} catch (err) {
  console.error(`Error verificando posiciones restantes para limpiar sideActual de ${symbol}:`, err);
  // Opcional: Limpiar igualmente si no se puede verificar, aunque no es lo ideal
  // window.sideActual = null;
}




    console.log(`[DEBUG] Cierre ${symbol} | Entrada: $${precioEntrada.toFixed(4)} | Salida: $${precioSalida.toFixed(4)} | Cantidad: ${cantidad} | Side: ${sideActual} | Leverage: ${leverage}`);
    console.log(`[DEBUG] PnL Bruta: $${pnlBruta.toFixed(4)} | Fees: $${feesTotales.toFixed(4)} | PnL Neta Final: $${pnlNeta.toFixed(4)}`);

  } catch (err) {
    const msg = `CloseOperation fallida: ${err.message || 'Error desconocido'}`;
    console.error(msg);
    const estadoEl = document.getElementById('estado');
    if (estadoEl) estadoEl.textContent = msg;
  }
   posicionActual = null;
   
}

// ✅ ACTUALIZAR POSICIONES — Seguro
async function actualizarPosicionesAbiertas() {
  try {
    const simbolo = document.getElementById('selector-simbolo').value;
    // console.log("🔍 Consultando posiciones para:", simbolo); // ← AGREGA ESTO
    const res = await fetchConAuth(`/api/binance/futures/positions?symbol=${simbolo}&_t=${Date.now()}`);
    const data = await res.json();
    
    // ✅ ¡AÑADE ESTA LÍNEA! → Si no es array, hazlo array vacío
    if (!Array.isArray(data)) {
      console.warn('⚠️ Respuesta de /positions no es un array. Usando array vacío.');
      return []; // o [] para que no falle
    }
        
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
        <td>$${entry.toFixed(4)}</td>
        <td>${roe.toFixed(4)}%</td>
        <td>$${pnl.toFixed(4)}</td>
        <td><button class="btn btn-outline" style="padding:4px 8px;font-size:0.8em;" 
            onclick="cerrarPosicion('${pos.symbol}', '${pos.positionSide}', 'Manual')">CloseOperation</button></td>
      `;
      tbody.appendChild(row);
    });
    if (posicionesAbiertas.length === 0) {
      ocultarLineasPrecios(); // ✅ Ocultar líneas si no hay posiciones
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = `<td colspan="6" style="text-align:center;color:#666;">Sin posiciones abiertas</td>`;
      tbody.appendChild(emptyRow);
    }
    // Al final de try, después de renderizar la tabla
    if (posicionesAbiertas.length === 0) {
      detenerRefrescoPosiciones(); // 👈 Detiene si no hay posiciones
    }


  } catch (err) {
    console.error('🔴 Error actualizando posiciones:', err);
    const tbody = document.querySelector('#operaciones-abiertas tbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:#ef5350;text-align:center;">⚠️ Error al cargar posiciones</td></tr>`;
    }
  }
}


// ───────────────────────────────────────
// 🔥 APERTURA: IA ↔ Cruce con prioridad a confirmaciones pendientes
// ───────────────────────────────────────
function evaluarAperturaReversion(simbolo, prediccionRaw, indicadores, historialVelas) {
  console.log("🔍 [APERTURA] Nueva vela en Reversion | IA:", prediccionRaw, "MACD último:", indicadores.macdLine.slice(-4), "Signal último:", indicadores.signalLine.slice(-4));
 
  // Ejemplo: al activar Modo Mercado, desactivar Gauss y Reversión
  document.getElementById('modo-reversion-activo')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      document.getElementById('modo-mercado-activo').checked = false;
      document.getElementById('modo-gauss-activo').checked = false;
    }
  });
 
  const modoActivo = document.getElementById('modo-reversion-activo')?.checked || false;
  if (!modoActivo || prediccionRaw == null) return;

  const modoAuto = document.querySelector('input[name="modo-reversion"]:checked')?.value === 'auto';
  const btnOperar = document.getElementById('btn-operar-reversion');
  const estadoDiv = document.getElementById('estado-reversion');

  // ─── UMBRALES DE PRUEBA ───
  const UMBRAL_IA = 0.60;
  const UMBRAL_RSI_MIN = 20;
  const UMBRAL_RSI_MAX = 80;
 // AHORA (suave para pruebas):
  const UMBRAL_MACD_COMPRA = -0.0355;  // zona de compra , segun estudio dat  MIN +/- 0.0355 equiv. 60 en BTC de trabajo 1m =0.0355. <50
  const UMBRAL_MACD_VENTA = 0.0355;    // zona de venta

  // ─── Validar indicadores ───
  if (!indicadores?.rsi || !indicadores?.adx || !indicadores?.macdLine || !indicadores?.signalLine) {
    return;
  }

  const rsiActual = indicadores.rsi;
  const adxActual = indicadores.adx;
  const macdLine = indicadores.macdLine;
  const signalLine = indicadores.signalLine;

  if (macdLine.length < 2 || signalLine.length < 2) return;

  const macdActual = macdLine[macdLine.length - 1];
  const signalActual = signalLine[signalLine.length - 1];
  const macdPrev = macdLine[macdLine.length - 2];
  const signalPrev = signalLine[signalLine.length - 2];

  const cruceAlcista = macdPrev <= signalPrev && macdActual > signalActual;
  const cruceBajista = macdPrev >= signalPrev && macdActual < signalActual;
  const hayCruce = cruceAlcista || cruceBajista;

  // ─── VALIDAR CONDICIONES TÉCNICAS ACTUALES ───
  const adxValido = adxActual >= 25;
  const rsiValido = rsiActual > UMBRAL_RSI_MIN && rsiActual < UMBRAL_RSI_MAX;
  const condicionesTecnicas = adxValido && rsiValido;

  // ───────────────────────────────────────
  // ✅ 1. PRIMERO: verificar CONFIRMACIONES de señales pendientes
  // ───────────────────────────────────────

  // A. Confirmar CRUCE pendiente (de vela N) con IA actual (vela N+1)
  const crucePend = window.crucePendiente;
  if (crucePend && 
      crucePend.simbolo === simbolo && 
      historialVelas.length === crucePend.velaIndex + 1) {
    
    const esLongConf = crucePend.side === 'BUY';
    const iaConfirma = esLongConf 
      ? (prediccionRaw >= UMBRAL_IA) 
      : (prediccionRaw <= (1 - UMBRAL_IA));
     console.log(`🔍 [CONFIRMACIÓN IA] Vela: ${historialVelas.length} | IA: ${(prediccionRaw*100).toFixed(1)}% | Signal: ${signalActual.toFixed(1)} | ADX: ${adxActual.toFixed(1)} | RSI: ${rsiActual.toFixed(1)}`);


    // ✅ Validar que la zona ACTUAL coincida con la dirección del cruce pendiente
    const enZonaValidaAhora = esLongConf
      ? (signalActual < UMBRAL_MACD_COMPRA)
      : (signalActual > UMBRAL_MACD_VENTA);

    if (iaConfirma && condicionesTecnicas && enZonaValidaAhora) {
      ejecutarApertura(crucePend.side, simbolo, modoAuto, btnOperar, estadoDiv, signalActual);
      window.crucePendiente = null;
      return;
    } else {
      window.crucePendiente = null;
    }
  }

  // B. Confirmar IA pendiente (de vela N) con CRUCE actual (vela N+1)
  const iaPend = window.iaFuertePendiente;
  if (iaPend && 
      iaPend.simbolo === simbolo && 
      historialVelas.length === iaPend.velaIndex + 1) {
      console.log("✅ [CONFIRMACIÓN] IA pendiente de vela", iaPend.velaIndex, "con side", iaPend.side);
      
    const esLongConf = iaPend.side === 'BUY';
    const cruceConfirma = esLongConf ? cruceAlcista : cruceBajista;
      console.log("📊 Cruce válido:", cruceConfirma, "| En zona:", esLongConf, "| Signal actual:", signalActual);
     const enZonaConfirma = esLongConf 
  
      ? (signalActual < UMBRAL_MACD_COMPRA) 
      : (signalActual > UMBRAL_MACD_VENTA);
    
    if (cruceConfirma && enZonaConfirma && condicionesTecnicas) {
      ejecutarApertura(iaPend.side, simbolo, modoAuto, btnOperar, estadoDiv, signalActual);
      window.iaFuertePendiente = null;
      return; // ✅ Sale después de abrir
    } else {
      window.iaFuertePendiente = null; // limpiar si no se confirma
    }
  }

  // ───────────────────────────────────────
  // 🔸 2. LUEGO: guardar NUEVAS señales de esta vela
  // ───────────────────────────────────────

  // A. Guardar CRUCE si está en zona y condiciones técnicas válidas
  if (hayCruce && condicionesTecnicas) {
    const enZonaCompra = cruceAlcista && signalActual < UMBRAL_MACD_COMPRA;
    const enZonaVenta = cruceBajista && signalActual > UMBRAL_MACD_VENTA;
    console.log(`🔔 [CRUCE DETECTADO] Vela: ${historialVelas.length} | Signal: ${signalActual.toFixed(1)} | Esperando IA en próxima vela...`);


    if (enZonaCompra || enZonaVenta) {
      window.crucePendiente = {
        velaIndex: historialVelas.length,
        side: enZonaCompra ? 'BUY' : 'SELL',
        simbolo: simbolo,
        timestamp: Date.now()
      };
      if (estadoDiv && !modoAuto) {
        estadoDiv.textContent = `🔔 Cruce detectado. Esperando confirmación IA...`;
      }
      return;
    }
  }

  // B. Guardar IA si es fuerte y condiciones técnicas válidas
  const esLongPorIA = prediccionRaw > 0.5;
  const iaFuerte = esLongPorIA ? (prediccionRaw >= UMBRAL_IA) : (prediccionRaw <= (1 - UMBRAL_IA));
  
  if (iaFuerte && condicionesTecnicas) {
    window.iaFuertePendiente = {
      velaIndex: historialVelas.length,
      side: esLongPorIA ? 'BUY' : 'SELL',
      simbolo: simbolo,
      rsi: rsiActual,
      adx: adxActual,
      timestamp: Date.now()
    };
    if (estadoDiv && !modoAuto) {
      estadoDiv.textContent = `🔔 IA fuerte detectada. Esperando cruce...`;
    }
    return;
  }
}



// ─── UTILIDAD: verificar si el modo permite la operación ───
function permitirOperacion(side) {
  const modo = document.querySelector('input[name="modo-operacion"]:checked')?.value || 'both';
  if (modo === 'long' && side === 'SELL') return false;
  if (modo === 'short' && side === 'BUY') return false;
  return true;
}

// ─── Función auxiliar (igual que antes) ───
function ejecutarApertura(side, simbolo, modoAuto, btnOperar, estadoDiv, signalActual) {

  // En la sección de confirmación (antes de if (modoAuto))
  console.log(`[DEBUG] Confirmando apertura: side=${side}, signal=${signalActual}, modoAuto=${modoAuto}`);
  console.log(`[DEBUG] ordenEnCurso=${ordenEnCurso}, posicionActual=`, posicionActual);
  console.log(`[DEBUG] Zona válida: ${side === 'BUY' ? (signalActual < -60) : (signalActual > 60)}`);
   
   
 if (!permitirOperacion(side)) {
  console.log(`⚠️ Operación ${side} bloqueada por modo de operación`);
  return;
  }


  if (modoAuto) {
    if (ordenEnCurso || posicionActual) {
       console.log("🛑 Bloqueado: hay posición u orden en curso");
      if (estadoDiv) estadoDiv.textContent = "🔒 Posición abierta";
    } else {
      console.log(`✅ [APERTURA AUTOMÁTICA] ${side} | Signal: ${signalActual.toFixed(1)}`);
      ordenEnCurso = true;
      posicionActual = { side, simbolo };
      abrirPosicionReal(side)
        .finally(() => { ordenEnCurso = false; });
      if (estadoDiv) estadoDiv.textContent = `✅ Automático: ${side} abierto`;
    }
  } else {
    if (btnOperar) {
      btnOperar.textContent = `⚡ ABRIR ${side} (Signal: ${signalActual.toFixed(0)})`;
      btnOperar.style.display = 'inline-block';
      btnOperar.disabled = false;
      btnOperar.onclick = () => {
        if (ordenEnCurso || posicionActual) {
          alert("⚠️ Ya hay posición abierta.");
          return;
        }
        console.log(`✅ [APERTURA MANUAL] ${side}`);
        ordenEnCurso = true;
        posicionActual = { side, simbolo };
        abrirPosicionReal(side)
          .finally(() => {
            ordenEnCurso = false;
            btnOperar.style.display = 'none';
          });
      };
    }
    if (estadoDiv) estadoDiv.textContent = `🔔 Confirmación recibida. ¡Confirma apertura!`;
  }
}


// ───────────────────────────────────────
// 🔒 CIERRE: cruce final en vela M+1 (después de apertura)
// ───────────────────────────────────────
function evaluarCierreReversion(simbolo, posicionActual, indicadores) {
  const modoActivo = document.getElementById('modo-reversion-activo')?.checked || false;
  if (!modoActivo || !posicionActual) return;

  const posicionRev = posicionActual;
  if (!posicionRev || posicionRev.simbolo !== simbolo) return;

  const macdLine = indicadores?.macdLine;
  const signalLine = indicadores?.signalLine;
  if (!macdLine || !signalLine || macdLine.length < 2) return;

  const macdActual = macdLine[macdLine.length - 1];
  const signalActual = signalLine[signalLine.length - 1];
  const macdPrev = macdLine[macdLine.length - 2];

  // Umbrales de cierre (ajustables)
  //const UMBRAL_CIERRE_LONG = 0;
 // const UMBRAL_CIERRE_SHORT = 0;

  const esLong = posicionRev.side === 'BUY';
  const cierreLong = macdPrev >= signalActual && macdActual < signalActual ;
  const cierreShort = macdPrev <= signalActual && macdActual > signalActual ;
  const hayCierre = (esLong && cierreLong) || (!esLong && cierreShort);

  if (!hayCierre) return;

  const modoAuto = document.querySelector('input[name="modo-reversion"]:checked')?.value === 'auto';
  const btnCerrar = document.getElementById('btn-cerrar-reversion');
  const estadoDiv = document.getElementById('estado-reversion');

  if (modoAuto) {
    console.log(`✅ [CIERRE AUTOMÁTICO] ${posicionRev.side} por cruce final`);
    ordenEnCurso = true;
    const simbolo = document.getElementById('selector-simbolo').value;
    cerrarPosicion(simbolo, posicionActual.positionSide, 'MACD cruce final')
      .finally(() => {
        ordenEnCurso = false;
        posicionActual = false;
        if (btnCerrar) btnCerrar.style.display = 'none';
      });
    if (estadoDiv) estadoDiv.textContent = `✅ Cierre automático ejecutado`;
  } else {
    if (btnCerrar) {
      btnCerrar.style.display = 'inline-block';
      btnCerrar.disabled = false;
      btnCerrar.onclick = () => {
        console.log(`✅ [CIERRE MANUAL] ${posicionRev.side}`);
        ordenEnCurso = true;
        const simbolo = document.getElementById('selector-simbolo').value;
        cerrarPosicion(simbolo, posicionActual.positionSide, 'Cierre manual MACD')
          .finally(() => {
            ordenEnCurso = false;
            posicionActual = false;
            btnCerrar.style.display = 'none';
          });
      };
    }
    if (estadoDiv) estadoDiv.textContent = `🔔 Cierre recomendado. Confirma manualmente.`;
  }
}


// ─── INICIALIZAR HISTORIAL (al inicio de tu script) ───
if (!window.historialOperaciones) {
  window.historialOperaciones = [];
}

// ─── FUNCIÓN: agregar operación al historial ───
function registrarOperacion(operacion) {
  const simbolo = document.getElementById('selector-simbolo').value;
  window.historialOperaciones.push({
    fecha: new Date().toISOString(),
    simbolo: operacion.simbolo ,
    side: operacion.side,
    entrada: operacion.entrada,
    salida: operacion.salida,
    roe: operacion.roe,
    pnlNeto: operacion.pnlNeto,
    modo: operacion.modo || 'auto',
    motivoCierre: operacion.motivoCierre || 'unknown'
  });
}

// ─── VERIFICAR POSICIÓN ACTUAL EN BINANCE ───
async function verificarPosicionActual(simbolo ) {
  try {
    const token = localStorage.getItem('authToken');
    const response = await fetch('/api/binance/futures/position', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ symbol: simbolo })
    });

    const data = await response.json();
    
    if (response.ok) {
      // Actualizar posicionActual
      posicionActual = data;
      
      // Calcular tamaño real
      const positionAmt = parseFloat(data.positionAmt);
      const hayPosicionReal = Math.abs(positionAmt) > 0.0001;
      
      console.log(`📊 Posición actual: ${positionAmt} | ¿Real?: ${hayPosicionReal}`);
      
      // Opcional: actualizar UI
      const estadoDiv = document.getElementById('estado-reversion');
      if (estadoDiv) {
        estadoDiv.textContent = hayPosicionReal 
          ? `📊 Posición abierta: ${positionAmt.toFixed(4)}`
          : '📊 Sin posición abierta';
      }
      
      return data;
    } else {
      console.error("❌ Error al verificar posición:", data);
      return null;
    }
  } catch (error) {
    console.error("⚠️ Excepción en verificarPosicionActual:", error);
    return null;
  }
}

// ─── MANEJAR RESPUESTA DE ORDEN (reutilizable) ─── 
const simbolo = document.getElementById('selector-simbolo').value;
async function manejarRespuestaOrden(response, data, simbolo ) {
  if (response.status === 202 && data.code === -1007) {
    console.warn("⏳ Timeout Binance: verificando estado real...");
    await verificarPosicionActual(simbolo);
    return { success: true, unknown: true };
  }
  
  if (response.ok) {
    console.log("✅ Orden ejecutada:", data);
    return { success: true, unknown: false };
  }
  
  console.error("❌ Orden fallida:", data);
  return { success: false, unknown: false };
}



// ─── FUNCIÓN: exportar a CSV ───
document.getElementById('btn-exportar')?.addEventListener('click', () => {
  const historial = window.historialOperaciones;
  if (!historial || historial.length === 0) {
    alert("No hay operaciones para exportar.");
    return;
  }

  const cabeceras = ['Fecha','Símbolo','Operación','Entrada','Salida','ROE%','PnL Neto','Modo','Cierre'];
  const filas = historial.map(op => [
    op.fecha.replace('T', ' ').substring(0, 19),
    op.simbolo,
    op.side,
    op.entrada,
    op.salida,
    op.roe,
    op.pnlNeto,
    op.modo,
    op.motivoCierre
  ]);

  let csv = cabeceras.join(',') + '\n';
  csv += filas.map(f => 
    f.map(cell => `"${typeof cell === 'string' ? cell.replace(/"/g, '""') : cell}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `operaciones_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ─── FUNCIÓN: reset historial ───
document.getElementById('btn-reset-historial')?.addEventListener('click', () => {
  if (confirm("¿Borrar historial de operaciones? Esta acción no se puede deshacer.")) {
    window.historialOperaciones = [];
    alert("✅ Historial de operaciones reseteado.");
  }
});

// ───────────────────────────────────────
// ───────────────────────────────────────
// 📊 ACTUALIZAR MONITOR MACD EN TIEMPO REAL (con alineación visual correcta)
// ───────────────────────────────────────
function actualizarMonitorMACD() {
  const indicadores = window.indicadores;
  const valoresEl = document.getElementById('macd-signal-valores');
  const indicadorEl = document.getElementById('signal-indicador');
  const estadoEl = document.getElementById('estado-senal');

  if (!valoresEl || !indicadorEl || !estadoEl) return;

  // Protección si no hay datos
  if (!indicadores || !Array.isArray(indicadores.signalLine) || indicadores.signalLine.length < 1) {
    valoresEl.textContent = "MACD: -- | Signal: --";
    indicadorEl.style.left = '50%';
    estadoEl.textContent = '⏳ Esperando datos...';
    estadoEl.style.color = '#ffd700';
    return;
  }

  const signalLine = indicadores.signalLine;
  const macdLine = indicadores.macdLine;

  if (!Array.isArray(macdLine) || macdLine.length < 1) {
    valoresEl.textContent = "MACD: -- | Signal: --";
    indicadorEl.style.left = '50%';
    estadoEl.textContent = '⚠️ Datos incompletos';
    return;
  }

  // ✅ EXTRAER VALORES REALES
  const signalActual = signalLine[signalLine.length - 1];
  const macdActual = macdLine[macdLine.length - 1];
  console.log("📈 [MONITOR] Valor usado para cursor:", signalActual);

  // ✅ FORMATEAR PARA MOSTRAR
  const signalMostrar = parseFloat(signalActual.toFixed(4));
  const macdMostrar = parseFloat(macdActual.toFixed(4));
  valoresEl.textContent = `MACD: ${macdMostrar} | Signal: ${signalMostrar}`;

  // ───────────────────────────────────────
  // ✅ POSICIONAMIENTO VISUAL: adaptado a SOLUSDT (rango ±0.1)
  // Zona verde: Signal < -0.0455 → 0% a 30%
  // Zona neutra: -0.01 ≤ Signal ≤ +0.01 → 45% a 55%
  // Zona roja: Signal > +0.0455 → 70% a 100%
  // ───────────────────────────────────────
  let porcentaje;

  if (signalActual < -0.0355) {
    // Mapear –0.1 a –0.0355 → 0% a 30%
    const rango = -0.0355 - (-0.8); // 0.0545
    const rel = Math.max(0, signalActual - (-0.8));
    porcentaje = (rel / rango) * 30;
  } else if (signalActual > 0.0355) {
    // Mapear +0.0355 a +0.1 → 70% a 100%
    const rango = 0.8 - 0.0355; // 0.0545
    const rel = Math.min(rango, signalActual - 0.0355);
    porcentaje = 70 + (rel / rango) * 30;
  } else if (signalActual <= -0.8) {
    // –0.0355 a –0.01 → 30% a 45%
    const rango = -0.8 - (-0.0355); // 0.0355
    const rel = signalActual - (-0.0355);
    porcentaje = 30 + (rel / rango) * 15;
  } else if (signalActual >= 0.8) {
    // +0.01 a +0.0355 → 55% a 70%
    const rango = 0.0355 - 0.8; // 0.0355
    const rel = signalActual - 0.8;
    porcentaje = 55 + (rel / rango) * 15;
  } else {
    // –0.01 a +0.01 → 45% a 55%
    const rango = 0.08;
    const rel = signalActual + 0.8;
    porcentaje = 45 + (rel / rango) * 10;
  }

  const porcentajeClamped = Math.max(0, Math.min(100, porcentaje));
  indicadorEl.style.left = `${porcentajeClamped}%`;

  // ───────────────────────────────────────
  // ✅ ESTADOS (umbrales adaptados a SOLUSDT)
  // ───────────────────────────────────────
  let estado = '⚪ Zona neutra';
  let color = '#90a4ae';

  if (signalActual < -0.0355) {
    estado = '🟢 ¡Zona de COMPRA!';
    color = '#4caf50';
  } else if (signalActual > 0.0355) {
    estado = '🔴 ¡Zona de VENTA!';
    color = '#f44336';
  } else {
    estado = '⚪ Zona neutra';
    color = '#90a4ae';
  }
  console.log("🔍 [MONITOR] Signal usado:", signalActual, "| MACD:", macdActual);
  estadoEl.textContent = estado;
  estadoEl.style.color = color;
}

function actualizarDebug() {
  const debugEl = document.getElementById('debug-panel');
  if (!debugEl) return;
  
  const pos = posicionActual;
  const size = pos ? parseFloat(pos.positionAmt) : 0;
  const hayPos = Math.abs(size) > 0.0001;
  
  debugEl.innerHTML = `
    📌 DEBUG | Posición: ${hayPos ? 'SÍ' : 'NO'} | Tamaño: ${size.toFixed(6)}<br>
    🧠 IA: ${(window.prediccionRaw || 0).toFixed(3)} | Modo Auto: ${document.querySelector('input[name="modo-reversion"]:checked')?.value === 'auto'}<br>
    📊 Signal: ${(window.indicadores?.signalLine?.at(-1) || '--').toFixed(1)}
  `;
}






// ───────────────────────────────────────
// 📊 DIBUJAR GRÁFICO MACD (centrado en cero, estilo Binance)
// ───────────────────────────────────────
function dibujarMACDBinance(macdLine, signalLine) {
  const contenedor = document.getElementById('macd-chart');
  if (!contenedor || !macdLine || !signalLine || macdLine.length === 0) return;

  // ✅ Número de velas a mostrar (máximo 50)
  const n = Math.min(50, macdLine.length);
  const macdSlice = macdLine.slice(-n);
  const signalSlice = signalLine.slice(-n);
  const histSlice = macdSlice.map((m, i) => m - signalSlice[i]);

  // ✅ Encontrar máximo absoluto del histograma (para escalar)
  const maxHist = Math.max(...histSlice.map(h => Math.abs(h))) || 1;

  // ✅ Limpiar contenedor
  contenedor.innerHTML = '';

  // ✅ Dimensiones
  const anchoBarra = 8;
  const gap = 3;
  const totalAncho = n * (anchoBarra + gap);
  contenedor.style.width = `${totalAncho}px`;

  // ✅ Altura total (debe coincidir con el height del contenedor en HTML - margen)
  const alturaTotal = 300; // ← ajusta si cambias el height del #macd-chart
  const mitad = alturaTotal / 2; // línea cero en el centro

  // ✅ Dibujar cada elemento
  for (let i = 0; i < n; i++) {
    const hist = histSlice[i];
    const macd = macdSlice[i];
    const signal = signalSlice[i];
    const absHist = Math.abs(hist);

    // --- Histograma centrado en cero ---
    const opacidad = Math.min(0.9, Math.max(0.2, absHist / maxHist));
    const barHeight = (absHist / maxHist) * mitad * 0.95; // 95% del espacio

    const bar = document.createElement('div');
    bar.style.position = 'absolute';
    bar.style.left = `${i * (anchoBarra + gap)}px`;
    bar.style.width = `${anchoBarra}px`;
    bar.style.height = `${barHeight}px`;

    if (hist >= 0) {
      // Barras positivas: hacia arriba desde cero
      bar.style.bottom = `${mitad}px`;
      bar.style.backgroundColor = `rgba(38, 166, 154, ${opacidad})`; // verde
    } else {
      // Barras negativas: hacia abajo desde cero
      bar.style.top = `${mitad}px`;
      bar.style.backgroundColor = `rgba(239, 83, 80, ${opacidad})`; // rojo
    }
    contenedor.appendChild(bar);

    // --- Punto MACD (azul) ---
    const escala = mitad / maxHist;
    const macdY = mitad - (macd * escala);
    const macdDot = document.createElement('div');
    macdDot.style.position = 'absolute';
    macdDot.style.left = `${i * (anchoBarra + gap) + anchoBarra / 2 - 2}px`;
    macdDot.style.bottom = `${macdY}px`;
    macdDot.style.width = '4px';
    macdDot.style.height = '4px';
    macdDot.style.backgroundColor = '#29b6f6';
    macdDot.style.borderRadius = '50%';
    contenedor.appendChild(macdDot);

    // --- Punto Signal (naranja) ---
    const signalY = mitad - (signal * escala);
    const signalDot = document.createElement('div');
    signalDot.style.position = 'absolute';
    signalDot.style.left = `${i * (anchoBarra + gap) + anchoBarra / 2 - 1.5}px`;
    signalDot.style.bottom = `${signalY}px`;
    signalDot.style.width = '3px';
    signalDot.style.height = '3px';
    signalDot.style.backgroundColor = '#ff9800';
    signalDot.style.borderRadius = '50%';
    contenedor.appendChild(signalDot);
  }

  // --- Línea cero (centrada) ---
  const zeroLine = document.createElement('div');
  zeroLine.style.position = 'absolute';
  zeroLine.style.bottom = `${mitad}px`;
  zeroLine.style.left = '0';
  zeroLine.style.width = '100%';
  zeroLine.style.height = '1px';
  zeroLine.style.backgroundColor = '#444';
  contenedor.appendChild(zeroLine);
}


      // ───────────────────────────────────────
      // 📊 REGISTRO DE EVENTOS IA (hasta 50)
      // ───────────────────────────────────────
      let eventosIA = JSON.parse(localStorage.getItem('eventosIA')) || [];

      function registrarEventoIA(simbolo, prediccionRaw, indicadores, precio) {
        const registroActivo = document.getElementById('registro-activo')?.checked || false;
        if (!registroActivo || prediccionRaw == null) return;

        const ahora = new Date();
        const evento = {
          fecha: ahora.toISOString(), // ISO 8601: 2025-04-05T14:30:00.000Z
          fechaLocal: ahora.toLocaleString(), // legible: "5/4/2025, 2:30:00 p. m."
          simbolo,
          prediccion: prediccionRaw,
          confianza: Math.max(prediccionRaw, 1 - prediccionRaw),
          lado: prediccionRaw > 0.5 ? 'BUY' : 'SELL',
          precio,
          rsi: indicadores?.rsi || null,
          adx: indicadores?.adx || null,
          macd: indicadores?.macdLine?.[indicadores.macdLine.length - 1] || null,
          signal: indicadores?.signalLine?.[indicadores.signalLine.length - 1] || null,
          atr: indicadores?.atr || null
        };

        // Mantener solo los últimos 50
        eventosIA.unshift(evento);
        if (eventosIA.length > 50) eventosIA.pop();

        // Guardar en localStorage (persistente)
        localStorage.setItem('eventosIA', JSON.stringify(eventosIA));

        // Actualizar UI
        document.getElementById('contador-eventos').textContent = `${eventosIA.length}/50`;
        document.getElementById('btn-exportar-registro').disabled = eventosIA.length === 0;
      }


// ─── FUNCIÓN: reset eventos IA ───
document.getElementById('btn-reset-ia')?.addEventListener('click', () => {
  if (confirm("¿Borrar todos los eventos IA y señales pendientes?")) {
    // Limpiar eventos guardados
    window.eventosIA = [];
    // Limpiar señales pendientes de reversión
    window.iaFuertePendiente = null;
    window.crucePendiente = null;
    // Limpiar otros estados relacionados (ajusta según tu código)
    if (window.estadoPosiciones) {
      window.estadoPosiciones = {};
    }
    alert("✅ Eventos IA y señales pendientes reseteados.");
  }
});

// ─── Inicializar si no existe (al inicio del script) ───
if (!window.eventosIA) window.eventosIA = [];


      // ───────────────────────────────────────
      // 📥 EXPORTAR A CSV
      // ───────────────────────────────────────
      function exportarEventosACSV() {
        if (eventosIA.length === 0) return;

        // Cargar desde localStorage (en caso de que la página se recargue)
        const datos = JSON.parse(localStorage.getItem('eventosIA')) || [];
        if (datos.length === 0) return;

        // Encabezados
        const headers = [
          'Fecha', 'Símbolo', 'Predicción', 'Confianza', 'Lado', 'Precio',
          'RSI', 'ADX', 'MACD', 'Signal', 'ATR'
        ];

        // Convertir a CSV
        const csv = [
          headers.join(','),
          ...datos.map(e => [
            `"${e.fechaLocal}"`,
            e.simbolo,
            e.prediccion?.toFixed(4) || '',
            e.confianza?.toFixed(4) || '',
            e.lado,
            e.precio?.toFixed(2) || '',
            e.rsi?.toFixed(2) || '',
            e.adx?.toFixed(2) || '',
            e.macd?.toFixed(2) || '',
            e.signal?.toFixed(2) || '',
            e.atr?.toFixed(2) || ''
          ].join(','))
        ].join('\n');

        // Crear y descargar archivo
        const now = new Date();
        const nombre = `registro-reversa-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.csv`;

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      // Vincular botón
      document.getElementById('btn-exportar-registro')?.addEventListener('click', exportarEventosACSV);


// ─── SISTEMA GAUSS: TENDENCIA EN 1H ───
function evaluarSistemaGauss(simbolo, prediccionRaw, indicadores, historialVelas) {


// Ejemplo: al activar Modo Mercado, desactivar Gauss y Reversión
document.getElementById('modo-gauss-activo')?.addEventListener('change', (e) => {
  if (e.target.checked) {
    document.getElementById('modo-reversion-activo').checked = false;
    document.getElementById('modo-mercado-activo').checked = false;
  }
});


  const modoActivo = document.getElementById('modo-gauss-activo')?.checked || false;
  if (!modoActivo) return;

  // Verificar datos mínimos
  if (!indicadores?.adx || !indicadores?.atr || !indicadores?.ema20 || !indicadores?.ema50 ||
      !indicadores?.macdLine || !indicadores?.signalLine || prediccionRaw == null) {
       console.log("⚠️ Esperando datos completos...");
        return;
  }

  const adx = indicadores.adx;
  const atr = indicadores.atr;
  const ema20 = indicadores.ema20;
  const ema50 = indicadores.ema50;
  const macdLine = indicadores.macdLine;
  const signalLine = indicadores.signalLine;
  const precioActual = parseFloat(historialVelas[historialVelas.length - 1].close);

  if (macdLine.length < 2) { 
    console.log("⚠️ Esperando MACD completo...");
    return;

  }
  const macdActual = macdLine[macdLine.length - 1];
  const signalActual = signalLine[signalLine.length - 1];
  const macdPrev = macdLine[macdLine.length - 2];
  const signalPrev = signalLine[signalLine.length - 2];

   // Calcular diferencias
  const deltaEMA = Math.abs(ema20 - ema50) / ema50;
  const esAlcista = ema20 > ema50;
  const macdPositivo = macdActual > 0;
  const signalPositivo = signalActual > 0;

   // ─── DIAGNÓSTICO EN CONSOLA ───

 // ─── LOG LOCAL + TELEGRAM ───
const mensajeGauss = `🔍 [GAUSS] Vela-SOL: ${historialVelas.length} | IA: ${(prediccionRaw*100).toFixed(1)}% | ADX: ${adx.toFixed(1)} | ATR: ${atr.toFixed(4)} | EMA20/50: ${deltaEMA.toFixed(4)} (${esAlcista ? '↑' : '↓'}) | MACD: ${macdActual.toFixed(4)} | Signal: ${signalActual.toFixed(4)}`;

console.log(mensajeGauss);

// Enviar a Telegram si está activado y pasaron 10 min
const notifActiva = document.getElementById('gauss-notif-telegram')?.checked || false;
const ahora = Date.now();

if (notifActiva && (ahora - ultimaNotifGauss) >= INTERVALO_NOTIF) {
  enviarTelegram(mensajeGauss);
  ultimaNotifGauss = ahora;
}



 // segun estudio dat en Gaus ATR bueno trabajo=0.1428 , adx =40, pruebas ATR=0.06, adx=30


  // ─── ZONA 1: ARRANQUE DE TENDENCIA ALCISTA ───
  const arranqueAlcista = 
    (prediccionRaw >= 0.60) &&
    (adx > 25) &&
    (atr > 0.06) &&
    (ema20 > ema50) &&
    ((ema20 - ema50) / ema50 >= 0.0015) && // >1.5%

    (macdActual > 0) &&
    (signalActual > 0);

  // ─── ZONA 2: AGOTAMIENTO ALCISTA ───
  const agotamientoAlcista = 
    (adx < 25) &&
    (Math.abs(ema20 - ema50) / ema50 <= 0.0005) && // <0.5%
    (prediccionRaw <= 0.40) &&
    (macdActual < 0) &&
    (signalActual < 0);

  // ─── ZONA 1: ARRANQUE DE TENDENCIA BAJISTA ───
  const arranqueBajista = 
    (prediccionRaw <= 0.40) &&
    (adx > 25) &&
    (atr > 0.06) &&
    (ema20 < ema50) &&
    ((ema50 - ema20) / ema50 >= 0.0015) &&
    (macdActual < 0) &&
    (signalActual < 0);

  // ─── ZONA 2: AGOTAMIENTO BAJISTA ───
  const agotamientoBajista = 
    (adx < 30) &&
    (Math.abs(ema20 - ema50) / ema50 <= 0.0005) &&
    (prediccionRaw >= 0.60) &&
    (macdActual > 0) &&
    (signalActual > 0);

  const modoAuto = document.querySelector('input[name="modo-gauss"]:checked')?.value === 'auto';
  const btnCerrar = document.getElementById('btn-cerrar-gauss');
    const estadoDiv = document.getElementById('estado-reversion');

  // ─── CIERRE: si hay posición abierta y hay agotamiento ───
  if (posicionActual && posicionActual.simbolo === simbolo) {
    const esLong = posicionActual.side === 'BUY';
    const debeCerrar = (esLong && agotamientoAlcista) || (!esLong && agotamientoBajista);

    if (debeCerrar) {
      if (modoAuto) {
        console.log(`✅ [GAUSS] Cierre automático por agotamiento`);
        ordenEnCurso = true;
        cerrarPosicion(simbolo, 'BOTH', 'Gauss - Agotamiento')
          .finally(() => {
            ordenEnCurso = false;
            posicionActual = null;
            if (btnCerrar) btnCerrar.style.display = 'none';
          });
        if (estadoDiv) estadoDiv.textContent = '✅ Cierre Gauss automático';
      } else {
        if (btnCerrar) {
          btnCerrar.style.display = 'inline-block';
          btnCerrar.onclick = () => {
            console.log(`✅ [GAUSS] Cierre manual`);
            ordenEnCurso = true;
            cerrarPosicion(simbolo, 'BOTH', 'Gauss - Cierre manual')
              .finally(() => {
                ordenEnCurso = false;
                posicionActual = null;
                btnCerrar.style.display = 'none';
              });
          };
        }
        if (estadoDiv) estadoDiv.textContent = '🔔 Cierre Gauss recomendado';
      }
      return;
    }
  }

  // ─── APERTURA: si no hay posición y hay arranque ───
  console.log("🔍 [GAUSS] ¿Hay posición guardada?", posicionActual);
  console.log("🔍 [GAUSS] Arranque bajista:", arranqueBajista);
   console.log("🔍 [GAUSS] Arranque alcista:", arranqueAlcista);

  // ─── APERTURA: si no hay posición y hay arranque ───
  if (!posicionActual) {
    let nuevaOrden = null;
    if (arranqueAlcista) {
      nuevaOrden = 'BUY';
      console.log('🟢 [GAUSS] Arranque alcista detectado');
    } else if (arranqueBajista) {
      nuevaOrden = 'SELL';
      console.log('🔴 [GAUSS] Arranque bajista detectado');
    }

    if (nuevaOrden) {
      posicionActual = {
        side: nuevaOrden,
        simbolo: simbolo,
        entrada: precioActual,
        timestamp: Date.now()
      };
      window.sideActual = nuevaOrden === 'BUY' ? 'LONG' : 'SHORT';

      // Abrir posición
      if (modoAuto) {
        ordenEnCurso = true;
        abrirPosicionReal(nuevaOrden)
          .finally(() => {
            ordenEnCurso = false;
          });
        if (estadoDiv) estadoDiv.textContent = `✅ Gauss ${nuevaOrden} abierto`;
      } else {
        if (btnCerrar) {
          btnCerrar.style.display = 'none'; // ocultar cierre (no hay posición)
        }
        const btnAbrir = document.getElementById('btn-abrir-gauss');
        if (btnAbrir) {
          btnAbrir.style.display = 'inline-block';
          btnAbrir.onclick = () => {
            ordenEnCurso = true;
            abrirPosicionReal(nuevaOrden)
              .finally(() => {
                ordenEnCurso = false;
                btnAbrir.style.display = 'none';
              });
          };
        }
        if (estadoDiv) estadoDiv.textContent = `🔔 Gauss ${nuevaOrden} detectado. Modo manual.`;
      }
    }
  }
}


// ─── SISTEMA 1: MODO MERCADO ───
function evaluarModoMercado(
  simbolo,
  prediccionRaw,
  confianza,
  adxActual,
  rsiActual,
  historialVelas,
  ordenEnCurso,
  posicionActual,
  alcista,
  bajista
) {
 // 🔍 [DIAG. APERTURA Entrada a APP modo-mercado-Despues]

  // Ejemplo: al activar Modo Mercado, desactivar Gauss y Reversión
  document.getElementById('modo-mercado-activo')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      document.getElementById('modo-reversion-activo').checked = false;
      document.getElementById('modo-gauss-activo').checked = false;
    }
  });


// 🔍 DEBUG: imprimir valores reales
console.log("🔍 [DEBUG] Valores reales antes del if:", {
  prediccionRaw: prediccionRaw,
  confianza: confianza,
  adxActual: adxActual,
  historialVelasLength: historialVelas.length,
  ordenEnCurso: ordenEnCurso,
  tipoOrdenEnCurso: typeof ordenEnCurso
});

if (prediccionRaw != null && 
    confianza >= 0.60 && 
    adxActual >= 20 && 
    historialVelas.length >= 55 && 
    !ordenEnCurso) {

  // 🔍 DEBUG: imprimir valores reales
  console.log("🔍 [DEBUG] Valores reales despues del if :", {
    prediccionRaw: prediccionRaw,
    confianza: confianza,
    adxActual: adxActual,
    historialVelasLength: historialVelas.length,
    ordenEnCurso: ordenEnCurso,
    tipoOrdenEnCurso: typeof ordenEnCurso
  });


    const side = prediccionRaw > 0.5 ? 'BUY' : 'SELL';
    let operar = false;
    const modo = document.getElementById('modo-mercado')?.value || 'volatil';
   // window.sideActual = side === 'BUY' ? 'LONG' : 'SHORT';
    //console.log(`[DEBUG] sideActual actualizado a: ${window.sideActual} para ${window.simboloActual}`);

    // 🔍 [DIAGNÓSTICO 2] Modo y side
    console.log(`🔍 [DIAG. APERTURA] Side: ${side}, Modo UI: "${modo}"`);

    // Zonas seguras de RSI (evitar extremos)
    const rsiSeguroAlcista = rsiActual >= 50 && rsiActual < 75;
    const rsiSeguroBajista = rsiActual < 50 && rsiActual > 25;
    // 🔍 LOG 2: ¿El RSI está en zona segura?
    console.log(`🔍 [RSI SEGURO] RSI: ${rsiActual.toFixed(2)} → Alcista: ${rsiSeguroAlcista}, Bajista: ${rsiSeguroBajista}`);

    // Evaluar según el modo
    if (modo === 'alcista') {
      if (side === 'BUY' && alcista && rsiSeguroAlcista) {
        operar = true;
      }
    } else if (modo === 'bajista') {
      if (side === 'SELL' && bajista && rsiSeguroBajista) {
        operar = true;
      }
    } else if (modo === 'volatil') {
      if (side === 'BUY' && alcista && rsiSeguroAlcista) {
        operar = true;
      } else if (side === 'SELL' && bajista && rsiSeguroBajista) {
        operar = true;
      }
    }
    
    // 🔍 [DIAGNÓSTICO 3] ¿Se cumplen condiciones de modo?
    console.log(`🔍 [DIAG. APERTURA] Modo="${modo}", alcista=${alcista}, bajista=${bajista}, operar=${operar}`);

    // [Corrección] Verificar !posicionActual aquí también
    if (operar && !posicionActual) {
      console.log(`[DEBUG] Posicion actual aqui  operar&&!posicionActual:`, posicionActual);
      // 💡 EN VEZ DE ABRIR AHORA, GUARDAMOS PARA EVALUAR EN VELA N+3
      window.prediccionPendiente = {
        velaObjetivo: historialVelas.length + 3,
        precioRef: historialVelas[historialVelas.length - 1].close,
        side: side,
        timestamp: Date.now()
      };
      console.log(`📌 Predicción guardada. Se evaluará en vela #${window.prediccionPendiente.velaObjetivo}`);
      console.log(`✅ Señal válida guardada para vela N+3: ${side}`);
    } else if (operar && posicionActual) {
      // [Corrección] Log para depuración si se intenta abrir con posición existente
      console.log(`⚠️ Señal válida, pero hay posición abierta:`, posicionActual);
      console.log(`[DEBUG] Condición de apertura cumplida, PERO posicionActual EXISTE:`, posicionActual);
      document.getElementById('estado').textContent = `⚠️ Señal de apertura, pero posición abierta para ${simbolo}`;
    } else {
      // 🔍 [DIAGNÓSTICO 4] ¿Cuál condición falló?
      if (prediccionRaw == null) console.log(`❌ Falló: prediccionRaw es null`);
      if (confianza < 0.63) console.log(`❌ Falló: confianza baja (${(confianza * 100).toFixed(1)}%)`);
      if (historialVelas.length < 55) console.log(`❌ Falló: velas insuficientes (${historialVelas.length}/55)`);
      if (ordenEnCurso) console.log(`❌ Falló: ordenEnCurso = true`);
    }
  }
}


// ─── VERIFICAR PREDICCIÓN PENDIENTE (N+3) ───
function verificarPrediccionPendiente(historialVelas, ordenEnCurso, posicionActual) {
  const indiceVelaActual = historialVelas.length;
  if (window.prediccionPendiente &&
      indiceVelaActual === window.prediccionPendiente.velaObjetivo &&
      !ordenEnCurso &&
      !posicionActual) {

    const { precioRef, side } = window.prediccionPendiente;
    const precioActual = historialVelas[indiceVelaActual - 1].close;

    const movimientoCorrecto = (side === 'BUY' && precioActual > precioRef) ||
                              (side === 'SELL' && precioActual < precioRef);

    if (movimientoCorrecto) {
      console.log(`✅ Movimiento confirmado en vela #${indiceVelaActual}. Abriendo ${side}.`);
      ordenEnCurso = true;
      abrirPosicionReal(side)
        .finally(() => { ordenEnCurso = false; });
    } else {
      console.log(`❌ Movimiento NO confirmado en vela #${indiceVelaActual}. Predicción descartada.`);
    }

    delete window.prediccionPendiente;
  }
}


// ─── SEMÁFORO DE OPERACIÓN + CONTROL AUTOMÁTICO ───
function actualizarSemaforoOperacion(adx, atr) {
  const semaforoEl = document.getElementById('semaforo-operacion');
  const modoAutoInput = document.querySelector('input[name="modo-reversion"][value="auto"]');
  const modoReversionActivo = document.getElementById('modo-reversion-activo');
  const estadoDiv = document.getElementById('estado-reversion');
  
  if (!semaforoEl || !modoAutoInput) return;

  // 1. Hora local en UTC-4
  const horaLocal = (new Date().getUTCHours() - 4 + 24) % 24;

  // 2. Condiciones técnicas
  const adxFuerte = adx > 20;
  // const atrFuerte = atr > 70;
  const atrFuerte = atr >= 0.007;
  const enVentanaVerde = horaLocal >= 7 && horaLocal < 13;

  // 3. Evaluar estado
  let estado = '🔴 ROJO';
  let color = '#ef5350';
  let debeDesactivarAuto = false;

  if (enVentanaVerde && adxFuerte && atrFuerte) {
    estado = '🟢 VERDE';
    color = '#66bb6a';
    debeDesactivarAuto = false;
    //else if ((horaLocal >= 4 && horaLocal < 16) && (adx > 20 || atr > 50)) {
  } else if ((horaLocal >= 4 && horaLocal < 16) && (adx > 20 || atr >= 0.007)) {
    estado = '🟡 AMARILLA';
    color = '#ffca28';
    debeDesactivarAuto = false; // permitir manual en amarillo
  }

  // 4. Actualizar UI del semáforo
  semaforoEl.textContent = estado;
  semaforoEl.style.color = color;
  semaforoEl.title = `Hora: ${horaLocal}:00 | ADX: ${adx.toFixed(1)} | ATR: ${atr.toFixed(1)}`;

  // 5. ✅ DESACTIVAR MODO AUTOMÁTICO EN ROJO
  if (debeDesactivarAuto) {
    const estabaEnAuto = modoAutoInput.checked;
    if (estabaEnAuto) {
      modoAutoInput.checked = false;
      console.log("⚠️ Modo automático desactivado: condiciones de mercado no óptimas (ROJO).");
      if (estadoDiv) estadoDiv.textContent = "🔒 Automático desactivado (semáforo ROJO)";
    }
    
    // Opcional: desactivar también el toggle principal
    if (modoReversionActivo && modoReversionActivo.checked) {
      // No desactivamos el toggle general, solo el modo automático
      // Así puedes seguir operando en manual si quieres
    }
  }
}


function actualizarSemaforo({ adx = 0,emaActual=0,rsiActual=50,atrActual=0.001, precioActual=0, confianza = 0, preciosLen = 0, modo = 'volatil', alcista = false, bajista = false, tradingActivo = true }) {
  const luzADX = document.getElementById('cond-adx');
  const luzModo = document.getElementById('cond-modo');
  const luzPred = document.getElementById('cond-pred');
  const luzDatos = document.getElementById('cond-datos');
  const msgEl = document.getElementById('semaforo-msg');

//Segun estudio   ATR bueno = 0.1428 //// ATR min = 0.0800  /// actual de trabajo 0.12 , equivalente 40 en BTC
// segun estudio ADX bueno =40 /// ADX min = 35 ////pruebas   adx=30,, atr=0.06



  // ✅ Evaluar condicione0
  const adxOk = adx >= 25;
  const datosOk = preciosLen >= 55;
  const predOk = confianza >= 0.60;
  const atrok = atrActual >= 0.06;

  let modoOk = false;
  if (modo === 'alcista') modoOk = alcista;
  else if (modo === 'bajista') modoOk = bajista;
  else if (modo === 'volatil') modoOk = true;

  // ✅ Actualizar luces (siempre)
  if (luzADX) luzADX.style.backgroundColor = adxOk ? '#4CAF50' : '#ef5350';
  if (luzModo) luzModo.style.backgroundColor = modoOk ? '#4CAF50' : '#ef5350';
  if (luzPred) luzPred.style.backgroundColor = predOk ? '#4CAF50' : '#ef5350';
  if (luzDatos) luzDatos.style.backgroundColor = datosOk ? '#4CAF50' : '#ef5350';

  // ✅ Mensaje principal
  if (!tradingActivo) {
    if (msgEl) {
      msgEl.textContent = '⏸️ Trading automático detenido';
      msgEl.style.color = '#FF9800';
    }
  }
  
  else {
    const listo = adxOk && datosOk && predOk && modoOk && atrok;
    if (msgEl) {
      msgEl.textContent = listo ? '✅ Listo para operar' : '❌ Condiciones no cumplidas';
      msgEl.style.color = listo ? '#26a69a' : '#ef5350';
    }
  }
  
   //Actualiza UI con valores y condiciones-diego

  const confianzaEl = document.getElementById('confianza-valor');
if (confianzaEl) confianzaEl.textContent = `${Math.round(confianza * 100)}%`;

const modoEl = document.getElementById('modo-valor');
if (modoEl) modoEl.textContent = modo.toUpperCase();

const datosEl = document.getElementById('datos-valor');
if (datosEl) datosEl.textContent = preciosLen;

const adxEl = document.getElementById('adx1-valor');
if (adxEl) adxEl.textContent = adx.toFixed(1);


 const emaEl = document.getElementById('ema-valor');
if (emaEl) emaEl.textContent = emaActual.toFixed(1);

const rsiEl = document.getElementById('rsi-valor');
if (rsiEl) rsiEl.textContent = rsiActual.toFixed(1);

const atrEl = document.getElementById('atr-valor');
if (atrEl) atrEl.textContent = atrActual.toFixed(4);

const precioEl = document.getElementById('precio-actual');
if (precioEl) precioEl.textContent = precioActual.toFixed(1)

}

function iniciarSupervivencia() {
  if (!window.modoSupervivencia) return;
  
  // Verificar órdenes cada 10 segundos
  verificarOrdenesSupervivencia();
  
  // Programar próxima verificación
  setTimeout(iniciarSupervivencia, 10000);
}


// === STREAMING (ACTUALIZADO - Con logs y manejo de ordenEnCurso corregido) ===
async function iniciarStreaming() {
 
  if (!modelo) {
    alert('⚠️ Primero entrena el modelo antes de iniciar el streaming.');
    streamingActivo = false;
    return;
  }


  if (streamingActivo) {
    console.log("⚠️ Streaming ya activo. Ignorando nueva llamada.");
    return;
  }
  console.log('🚀 INICIANDO STREAMING...');


  streamingActivo = true; // ✅ Marcar como activo
   
  console.log('🚀 INICIANDO STREAMING...');

  if (!modelo) {
    alert('⚠️ Primero entrena el modelo antes de iniciar el streaming.');
    return;
  }

  console.log('✅ Modelos y autenticación verificados. Iniciando WebSocket...');

  // ✅ 1. Actualizar UI: indicar que se está iniciando
  const estadoEl = document.getElementById('estado-streaming');
  if (estadoEl) {
    estadoEl.textContent = '⏳ Conectando con Binance... (espera hasta 5 minutos)';
    estadoEl.style.color = '#FF9800';
    estadoEl.style.fontWeight = 'bold';
  }

  const ws = new WebSocket('wss://stream.binance.com:9443/ws/solusdt@kline_5m');

  ws.onopen = () => {
   
    console.log('🟢 ¡CONEXIÓN EXITOSA! WebSocket abierto.');

    if (estadoEl) {
      estadoEl.textContent = '📡 Conectado. Esperando vela cerrada (5m)...';
      estadoEl.style.color = '#2196F3';
    }
  };

  ws.onerror = (error) => {
    console.error('🔴 ERROR EN LA CONEXIÓN:', error);
    if (estadoEl) {
      estadoEl.textContent = '🔴 Error de conexión. Reintentando...';
      estadoEl.style.color = '#ef5350';
    }
  };

ws.onclose = async () => {
  console.log('🟡 WebSocket cerrado. Verificando posiciones abiertas...');
  streamingActivo = false;

  try {
    // 1. Obtener posiciones actuales desde Binance
    const posResponse = await fetchConAuth('/api/binance/futures/positions');
    const posiciones = await posResponse.json();
    const posicionesAbiertas = posiciones.filter(p => Math.abs(parseFloat(p.positionAmt)) > 0.0001);

    if (posicionesAbiertas.length > 0) {
      console.log(`⚠️ ${posicionesAbiertas.length} posición(es) abierta(s). Cerrando antes de reconectar...`);
      
      // 2. Cerrar cada posición
      for (const pos of posicionesAbiertas) {
        await cerrarPosicion(
          pos.symbol, 
          pos.positionSide || 'BOTH', 
          'WebSocket cerrado' // motivo
        );
        console.log(`✅ Posición ${pos.symbol} cerrada por desconexión.`);
      }
    } else {
      console.log('✅ No hay posiciones abiertas. Seguro para reconectar.');
    }

  } catch (err) {
    console.error('❌ Error al cerrar posiciones en onclose:', err);
  }

  // 3. Actualizar estado y reconectar
  const estadoEl = document.getElementById('estado-streaming');
  if (estadoEl) {
    estadoEl.textContent = '🟡 Conexión perdida. Reintentando en 5s...';
    estadoEl.style.color = '#FF9800';
  }

  setTimeout(() => {
    console.log('🔄 Intentando reconectar...');
    iniciarStreaming();
  }, 5000);
};

/// === WEBSOCKET: MANEJO DE DATOS EN TIEMPO REAL (CORREGIDO - V2 - Mayor Dropout) ===
// Asegúrate de que 'historialVelas', 'modelo', 'autoTrading', 'ordenEnCurso', 'window.simboloActual', etc. estén definidas globalmente.
// Asegúrate de que 'crearModelo', 'predecir', 'actualizarSemaforo', 'cerrarPosicion', 'abrirPosicionReal', 'actualizarGrafico', 'inicializarGrafico' estén disponibles globalmente.
// Asegúrate de que 'calcularRSI', 'calcularEMA', 'calcularMACD', 'calcularBandasBollinger', 'calcularATR', 'calcularADX', 'calcularOBV' estén disponibles globalmente.

ws.onmessage = async (event) => {
  try {
    // console.log("🔹 [DEBUG] ws.onmessage iniciado");
    const data = JSON.parse(event.data);
    const kline = data.k;
  
    // ✅ Actualizar UI del estado con la vela recibida
    const estadoEl = document.getElementById('estado');
    if (estadoEl) {
      estadoEl.textContent = `🕒 Recibida vela: ${new Date(kline.t).toLocaleTimeString()} | Cerrada: ${kline.x ? '✅ Sí' : '⏳ No'}`;
      estadoEl.style.color = kline.x ? '#4CAF50' : '#FF9800';
    }

    // ✅ Actualizar gráfico incluso si está en curso (como en el primer archivo)
    if (!window.chart) {
      inicializarGrafico();
    }
    actualizarGrafico(kline); // ← recibe kline directo del stream (con .t en ms, .o, .h, etc.)

    // ❌ Ignorar si la vela NO está cerrada (solo procesar cuando x=true)
    if (!kline.x) {
    //  console.log(`⏳ Vela en curso: ${new Date(kline.t).toLocaleTimeString()}`);
      return;
    }

    // ❌ Validar datos mínimos
    if (!kline.o || !kline.h || !kline.l || !kline.c || !kline.v) {
      console.error("❌ Vela incompleta recibida:", kline);
      return;
    }

    // ✅ Agregar vela cerrada al historial (con formato requerido por los indicadores)
    const lastKlineTime = historialVelas.length > 0 ? historialVelas[historialVelas.length - 1].time : 0;
    const newTimeSec = Math.floor(kline.t / 1000);
    if (newTimeSec > lastKlineTime) {
      historialVelas.push({
        time: newTimeSec,
        open: parseFloat(kline.o),
        high: parseFloat(kline.h),
        low: parseFloat(kline.l),
        close: parseFloat(kline.c),
        volume: parseFloat(kline.v)
      });
      if (historialVelas.length > 10000) {
        historialVelas = historialVelas.slice(-10000);
      }
      console.log(`✅ Vela cerrada añadida al historial (formato nuevo). Total velas: ${historialVelas.length}. Time: ${newTimeSec}`);
    } else {
      console.warn(`⚠️ Vela duplicada o desordenada recibida (time: ${newTimeSec}), Última en historial: ${lastKlineTime}`);
      return;
    }




    // ✅ Incrementar contador de velas cerradas
    velasCerradas++; // <-- [CORRECCIÓN] Incrementar aquí, después de agregar correctamente
    console.log(`📊 Velas cerradas acumuladas: ${velasCerradas}/100`);
    
    
    
    //
    // === ACTUALIZAR GRÁFICO ===

     //cambio diego
    // === PROCESAR DATOS PARA PREDICCIÓN Y TRADING (cuando hay 100 velas cerradas) ===
    if (velasCerradas >= 55) { // <-- Asegura que haya al menos 100 velas cerradas para procesar
      console.log('✅ 100 velas recibidas. Procesando datos para IA...');



      // [DIAGNÓSTICO] Verificar longitud de historialVelas
      console.log(`[DIAGNÓSTICO WS] historialVelas.length: ${historialVelas.length}`);
      
      
      //cambio diego
      
      if (historialVelas.length < 55) {
          console.error("[DIAGNÓSTICO WS] historialVelas tiene menos de 100 elementos.");
          return; // Salir si no hay suficientes datos
      }
       // cambio diego
      // ✅ Obtener últimos 100 precios y volúmenes (de historialVelas con estructura {time, open, high, low, close, volume})
      const ultimas100 = historialVelas.slice(-100);
      // [DIAGNÓSTICO] Verificar que slice funciona y hay 100 elementos
      console.log(`[DIAGNÓSTICO WS] ultimas100.length: ${ultimas100.length}`);
      console.log(`[DIAGNÓSTICO WS] Primera vela de ultimas100 (close, volume):`, { close: ultimas100[0].close, volume: ultimas100[0].volume });
      console.log(`[DIAGNÓSTICO WS] Última vela de ultimas100 (close, volume):`, { close: ultimas100[ultimas100.length - 1].close, volume: ultimas100[ultimas100.length - 1].volume });

      const closes = ultimas100.map(k => k.close); // k.close, no k.c
      const volumes = ultimas100.map(k => k.volume); // k.volume, no k.v

      // [DIAGNÓSTICO] Verificar si hay NaN en los arrays de precios/volúmenes
      console.log(`[DIAGNÓSTICO WS] Closes contiene NaN: ${closes.some(isNaN)}`);
      console.log(`[DIAGNÓSTICO WS] Volumes contiene NaN: ${volumes.some(isNaN)}`);
      console.log(`[DIAGNÓSTICO WS] Closes (últimos 5):`, closes.slice(-5));
      console.log(`[DIAGNÓSTICO WS] Volumes (últimos 5):`, volumes.slice(-5));

      // [DIAGNÓSTICO] Verificar que ultimoPrecio sea un número válido
      const ultimoPrecio = closes[closes.length - 1];
      console.log(`[DIAGNÓSTICO WS] ultimoPrecio calculado: ${ultimoPrecio} (typeof: ${typeof ultimoPrecio}, isNaN: ${isNaN(ultimoPrecio)})`);
       
       const simbolo = document.getElementById('selector-simbolo').value;
      const k5m = await obtenerDatos(simbolo, '5m', 50);
     

      // ✅ Calcular indicadores técnicos (últimos valores de los arrays)
      // [DIAGNÓSTICO] Calcular todos los indicadores y verificar sus longitudes y valores
      console.log("[DIAGNÓSTICO WS] Iniciando cálculo de indicadores...");
      const rsi = calcularRSI(closes, 14);
      const ema20 = calcularEMA(closes, 20);
      const ema50 = calcularEMA(closes, 50);
      const { macdLine: macdValues, signalLine: signalValues } = calcularMACD(closes, 12, 26, 9);
      const { superior: bbSuperior, inferior: bbInferior } = calcularBandasBollinger(closes, 20, 2);
      const atrValues = k5m.length >= 20 ? calcularATR(k5m, 14):[];

      const adxValues = k5m.length >= 20 ? calcularADX(k5m, 14):[];

     // const adxValues = calcularADX(ultimas100, 14); // Usar las últimas 100 velas del historial (con estructura correcta)
      const obvValues = calcularOBV(ultimas100); // Usar las últimas 100 velas del historial (con estructura correcta)
      console.log("[DIAGNÓSTICO WS] Cálculo de indicadores finalizado.");

      // [DIAGNÓSTICO] Verificar longitudes y tipos de los arrays de indicadores
      console.log(`[DIAGNÓSTICO WS] Longitudes - RSI: ${rsi?.length}, EMA20: ${ema20?.length}, EMA50: ${ema50?.length}, MACD: ${macdValues?.length}, Signal: ${signalValues?.length}, BB: ${bbSuperior?.length}, ATR: ${atrValues?.length}, ADX: ${adxValues?.length}, OBV: ${obvValues?.length}`);
      // console.log(`[DIAGNÓSTICO WS] Tipos - RSI: ${typeof rsi}, EMA20: ${typeof ema20}, MACD: ${typeof macdValues}, BB: ${typeof bbSuperior}, ATR: ${typeof atrValues}, ADX: ${typeof adxValues}, OBV: ${typeof obvValues}`);

      // [DIAGNÓSTICO] Verificar que los arrays no sean null/undefined o vacíos
      if (!Array.isArray(rsi) || rsi.length === 0) { console.error("[DIAGNÓSTICO WS] RSI no es un array o está vacío:", rsi); return; }
      if (!Array.isArray(ema20) || ema20.length === 0) { console.error("[DIAGNÓSTICO WS] EMA20 no es un array o está vacío:", ema20); return; }
      if (!Array.isArray(ema50) || ema50.length === 0) { console.error("[DIAGNÓSTICO WS] EMA50 no es un array o está vacío:", ema50); return; }
      if (!Array.isArray(macdValues) || macdValues.length === 0) { console.error("[DIAGNÓSTICO WS] MACD no es un array o está vacío:", macdValues); return; }
      if (!Array.isArray(signalValues) || signalValues.length === 0) { console.error("[DIAGNÓSTICO WS] Signal no es un array o está vacío:", signalValues); return; }
      if (!Array.isArray(bbSuperior) || bbSuperior.length === 0) { console.error("[DIAGNÓSTICO WS] BB Superior no es un array o está vacío:", bbSuperior); return; }
      if (!Array.isArray(bbInferior) || bbInferior.length === 0) { console.error("[DIAGNÓSTICO WS] BB Inferior no es un array o está vacío:", bbInferior); return; }
      if (!Array.isArray(atrValues) || atrValues.length === 0) { console.error("[DIAGNÓSTICO WS] ATR no es un array o está vacío:", atrValues); return; }
      if (!Array.isArray(adxValues) || adxValues.length === 0) { console.error("[DIAGNÓSTICO WS] ADX no es un array o está vacío:", adxValues); return; }
      if (!Array.isArray(obvValues) || obvValues.length === 0) { console.error("[DIAGNÓSTICO WS] OBV no es un array o está vacío:", obvValues); return; }



      // [CORRECCIÓN] Asignar valores con fallback solo si son NaN o undefined
      // Usamos los índices calculados con los desfases correctos
      // ✅ Usa siempre el último valor válido de cada indicadorf
      const rsiActual = rsi.length > 0 ? (rsi[rsi.length - 1] || 50) : 50;
      const e20 = ema20.length > 0 ? (ema20[ema20.length - 1] || ultimoPrecio) : ultimoPrecio;
      const e50 = ema50.length > 0 ? (ema50[ema50.length - 1] || ultimoPrecio) : ultimoPrecio;
      const macdActual = macdValues.length > 0 ? (macdValues[macdValues.length - 1] || 0) : 0;
      const signalActual = signalValues.length > 0 ? (signalValues[signalValues.length - 1] || 0) : 0;
      const bbSup = bbSuperior.length > 0 ? (bbSuperior[bbSuperior.length - 1] || ultimoPrecio) : ultimoPrecio;
      const bbInf = bbInferior.length > 0 ? (bbInferior[bbInferior.length - 1] || ultimoPrecio) : ultimoPrecio;
      const atrGlobal1= atrValues.length > 0 ? atrValues[atrValues.length - 1] : 0;
      const atrGlobal= parseFloat(atrGlobal1.toFixed(4));
    
      
     // const atrGlobal = atrValues.length > 0 ? (atrValues[atrValues.length - 1] || 0) : 0;
      const adxActual = adxValues.length > 0 ? adxValues[adxValues.length - 1] : 0;


      const obvActual = obvValues.length > 0 ? (obvValues[obvValues.length - 1] || 0) : 0;

      const alcista = e20 > e50;
      const bajista = e20 < e50;

      console.log(`[DIAGNÓSTICO WS] Valores finales - RSI: ${rsiActual}, EMA20: ${e20}, EMA50: ${e50}, alcista: ${alcista}, bajista: ${bajista}, MACD: ${macdActual}, Signal: ${signalActual}, BB_Sup: ${bbSup}, BB_Inf: ${bbInf}, ATR: ${atrGlobal}, ADX: ${adxActual}, OBV: ${obvActual}`);

      // [DIAGNÓSTICO] Calcular posición y ancho BB para la predicción
      const anchoBB = bbSup - bbInf;
      const posicionBB = anchoBB > 0 ? (ultimoPrecio - bbInf) / anchoBB : 0.5;
      const anchoBBRelativo = anchoBB / ultimoPrecio;
      const atrRelativo = atrGlobal / ultimoPrecio;
      const obvNormalizado = obvActual / 1e9;

      // [DIAGNÓSTICO] Calcular cambios para la predicción
      const ultimosPrecios = closes.slice(-10);
      const ultimosVolumenes = volumes.slice(-10);
      const cambios = ultimosPrecios.map((p, idx) => idx === 0 ? 0 : (p - ultimosPrecios[idx - 1]) / ultimosPrecios[idx - 1]);

          


      //const macdRedondeado = macdValues.map(v => parseFloat(v.toFixed(4)));
      //const signalRedondeado = signalValues .map(v => parseFloat(v.toFixed(4)));
      // Calcular indicadores
      // ✅ CORRECTO: usar las variables que sí existen
      window.indicadores = {
        macdLine: macdValues,
        signalLine: signalValues,
        rsi: rsiActual,
        adx: adxActual,
        atr: atrGlobal,
        ema20: e20,
        ema50: e50
      };

          // ✅ Actualizar el monitor visual
       actualizarMonitorMACD();


       // Ejemplo:
    //const adxActual = indicadores.adx;
     //const atrActual = indicadores.atr; // asegúrate de tener ATR en tus indicadores

     actualizarSemaforoOperacion(adxActual, atrActual);

      // Asumiendo que window.indicadores existe y tiene macdLine/signalLine

      //if (window.indicadores?.macdLine && window.indicadores?.signalLine) {
        //console.log("📊 Dibujando MACD con", window.indicadores.macdLine.length, "valores");
       // dibujarMACDBinance(window.indicadores.macdLine, window.indicadores.signalLine);
     // }
       

        // 👇 ESTE ES EL MOMENTO DE ACTUALIZAR TP/SL EN UI
      // actualizarTPSLenUI(); // ← tu bloque debe estar aquí

      // [DIAGNÓSTICO] Construir array de features como lo hace prepararDatosParaIA
      const featuresParaPrediccion = [
          ...cambios, // 10
          ultimosVolumenes.reduce((a, b) => a + b, 0) / 10 / 1e6, // 1
          rsiActual / 100, // 2
          ultimoPrecio > e20 ? 1 : 0, // 3
          rsiActual > 70 ? 1 : 0, // 4
          rsiActual < 30 ? 1 : 0, // 5
          macdActual / 1000, // 6
          signalActual / 1000, // 7
          (macdActual - signalActual) / 1000, // 8
          posicionBB, // 9
          anchoBBRelativo, // 10
          atrRelativo, // 11
          obvNormalizado, // 12
          0 / 1e6 // 13. openInterest simulado como 0
          // Total: 10 + 13 = 23
      ];

      // [DIAGNÓSTICO] Verificar longitud y contenido de features ANTES de llamar a predecir
      console.log(`[DIAGNÓSTICO WS] featuresParaPrediccion.length: ${featuresParaPrediccion.length}`);
      console.log(`[DIAGNÓSTICO WS] featuresParaPrediccion (primeros 5):`, featuresParaPrediccion.slice(0, 5));
      console.log(`[DIAGNÓSTICO WS] featuresParaPrediccion (últimos 5):`, featuresParaPrediccion.slice(-5));

      if (featuresParaPrediccion.length !== 23) {
          console.error(`[DIAGNÓSTICO WS] featuresParaPrediccion.length no es 23. Es: ${featuresParaPrediccion.length}`);
          return; // Salir si las features no tienen la longitud esperada
      }

      // ✅ Hacer predicción
      let prediccionRaw = null;
      try {
          prediccionRaw = await predecir(
              ultimosPrecios,      // 1. Array de 10 precios
              ultimosVolumenes,    // 2. Array de 10 volúmenes
              rsiActual,           // 3. RSI actual (CORREGIDO)
              e20,                 // 4. EMA20 actual (CORREGIDO)
              macdActual,          // 5. MACD actual (CORREGIDO)
              signalActual,        // 6. Signal actual (CORREGIDO)
              posicionBB,          // 7. Posición en BB (CORREGIDO)
              anchoBB,             // 8. Ancho de BB (CORREGIDO)
              atrGlobal,           // 9. ATR actual (CORREGIDO)
              obvActual,           // 10. OBV actual (CORREGIDO)
              ultimoPrecio,        // 11. Precio actual
              0                    // 12. Open Interest (simulado como 0)
          );
           // Agregado por diego
          window.prediccionRaw = prediccionRaw; // ← Ahora sí podrás verlo en consola
          

          console.log(`[DIAGNÓSTICO WS] Predicción recibida de predecir(): ${prediccionRaw} (typeof: ${typeof prediccionRaw}, isNaN: ${isNaN(prediccionRaw)})`);
      } catch (errorPredict) {
          console.error('[DIAGNÓSTICO WS] Error al llamar a predecir():', errorPredict);
          prediccionRaw = 0.5; // Fallback seguro
      }




      // [DIAGNÓSTICO] Calcular confianza y dirección ANTES de actualizar UI
      let confianza = 0;
      let dir = '—';
      if (prediccionRaw != null && !isNaN(prediccionRaw)) {
          confianza = Math.max(prediccionRaw, 1 - prediccionRaw);
          dir = prediccionRaw > 0.5 ? 'SUBIDA' : 'BAJADA';
          console.log(`[DIAGNÓSTICO WS] PrediccionRaw: ${prediccionRaw}, Confianza: ${confianza}, Dirección: ${dir}`);
          // ... (resto del código para actualizar UI de predicción y semáforo) ...
           } else {
          console.warn('[DIAGNÓSTICO WS] prediccionRaw es null, undefined o NaN. No se actualizará la UI de predicción.');
          }




      // Después de obtener la predicción de la IA
       // const prediccionRaw = await predecir(...);

      // Registrar evento (si está activo el modo)
      
      registrarEventoIA(
        simbolo,
        prediccionRaw,
        window.indicadores, // o tu objeto de indicadores
        precioActual // o historialVelas[historialVelas.length - 1].close
      );

      // ✅ Actualizar UI de predicción (solo si prediccionRaw es válida)
      // Agregado po diego

      // ✅ Filtro: solo mostrar si hay cierta confianza
      // if (confianza < 0.55) { // ← Umbral profesional
      //  document.getElementById('prediccion-porcentaje').textContent = '—';
      //const prog = document.getElementById('prediccion-progreso');
      //if (prog) {
      //    prog.style.width = '0%';
      //   prog.style.backgroundColor = '#666'; // gris
      //    }
      //       return; // No seguir si no hay suficiente confianza
      // }
      if (prediccionRaw != null && !isNaN(prediccionRaw)) {
        const dirEl = document.getElementById('prediccion-direccion');
        const porcEl = document.getElementById('prediccion-porcentaje');
        const progEl = document.getElementById('prediccion-progreso');
        if (dirEl) dirEl.innerHTML = `${dir === 'SUBIDA' ? '🟢' : '🔴'} ${dir}`;
        if (porcEl) porcEl.textContent = `${Math.round(confianza * 100)}%`;
        if (progEl) {
          progEl.style.width = `${Math.round(confianza * 100)}%`;
          progEl.style.backgroundColor = confianza >= 0.60 ? (dir === 'SUBIDA' ? '#26a69a' : '#ef5350') : '#666';
        }
      }

        const direccion = prediccionRaw > 0.5 ? 'SUBIDA' : 'BAJADA';
        const VELAS_FUTURAS = 3; // ajusta según tu modelo
        const confianzaMinima = 0.60; // 65%
        if (confianza >= confianzaMinima || confianza <= (1 - confianzaMinima)) {
         console.log(`🧠 Predicción fuerte: ${direccion} (${(confianza * 100).toFixed(1)}%)`);

        const nuevaPrediccion = {
          prediccionRaw,
          confianza,
          direccion,
          precioInicio: ultimoPrecio,
          timestamp: Date.now(),
          velaVerificacion: historialVelas.length - 1 + VELAS_FUTURAS,
          resultado: null
        };

        if (!window.prediccionesPendientes) window.prediccionesPendientes = [];
        window.prediccionesPendientes.push(nuevaPrediccion);
        console.log("🔍 Predicción registrada. Total pendientes:", window.prediccionesPendientes.length);

      } else {
            console.log(`🔇 Predicción débil (${(confianza * 100).toFixed(1)}%). Ignorada.`);

      }
      // 👇 REGISTRAR EN ESTADÍSTICAS
      const modo = document.getElementById('modo-mercado')?.value || 'volatil';
      actualizarSemaforo({
        adx: adxActual,
        emaActual: e50,
        rsiActual: rsiActual,
        atrActual: atrGlobal,
        precioActual: ultimoPrecio,
        confianza: confianza, // Pasamos la confianza calculada en este bloque
        preciosLen: historialVelas.length, // La longitud del array de precios
        modo: modo,
        alcista: alcista,
        bajista: bajista,
        tradingActivo: autoTrading // <-- PASAMOS EL ESTADO DE autoTrading
      });
      // Lee el estado actual del checkbox HTML y actualiza la variable autoTrading local en cada iteración del WebSocket.
        autoTrading = document.getElementById('autoTrading')?.checked ?? false;


        if (!autoTrading) {
          // El bucle sigue corriendo, actualizando precios, indicadores, semáforo, etc.
          // Pero no intentará abrir ni cerrar posiciones automáticamente basadas en señales de IA.
          // Continúa hasta el final del try.
      } 
      


        else {

          if (typeof window.ultimoCheckPosiciones === 'undefined') {
            window.ultimoCheckPosiciones = 0;
          }

          const ahoraMs = Date.now();
          const tiempoMinimoEntreChecks = 10000; // 10 segundos en milisegundos (ajusta según sea necesario)

          let posiciones = null;








          if (ahoraMs - window.ultimoCheckPosiciones >= tiempoMinimoEntreChecks) {
            window.ultimoCheckPosiciones = ahoraMs; // Actualizar timestamp


            try {
              const posResponse = await fetchConAuth('/api/binance/futures/positions?_t=' + Date.now()); // <-- Solicita con timestamp para evitar cacheo
              if (!posResponse.ok) {
                console.error('❌ Error HTTP obteniendo posiciones:', posResponse.status, posResponse.statusText);
                document.getElementById('estado').textContent = `⚠️ Error HTTP: ${posResponse.status}`;
                return; // Salir de esta iteración si falla la API (4xx/5xx)
              }
              posiciones = await posResponse.json(); // Intentar parsear JSON
            } catch (fetchOrJsonError) {
              // Captura errores de red (fetch) o de parsing JSON
              console.error('❌ Error obteniendo o parseando posiciones:', fetchOrJsonError);
              document.getElementById('estado').textContent = `⚠️ Error de red o formato`;
              return; // Salir de esta iteración si falla el fetch o json()
            }



            // Verificar que la respuesta sea un array después del parsing
            if (!Array.isArray(posiciones)) {
              console.error('❌ Formato inesperado de posiciones (no es un array):', posiciones);
              document.getElementById('estado').textContent = `⚠️ Error: Formato de posiciones inválido`;
              return; // Salir de esta iteración si la respuesta no es un array
            }

          }


          // Si no se obtuvieron nuevas posiciones (por el límite de tiempo), salir sin hacer trading
          if (posiciones === null) {
            console.log(`[DEBUG WS] No ha pasado suficiente tiempo para volver a checkear posiciones. Último check: ${new Date(window.ultimoCheckPosiciones).toLocaleTimeString()}, Ahora: ${new Date(ahoraMs).toLocaleTimeString()}`);
            // Actualizar TP/SL en UI (solo visual, sin trading)

            return;
          }
          // [CORRECCIÓN] Asegurar que posicionActual sea null si no hay posición
          const simbolo = document.getElementById('selector-simbolo').value;
          const posicionActual = posiciones.find(p =>
            p.symbol === simbolo && Math.abs(parseFloat(p.positionAmt || 0)) > 0.0001
          ) || null;

          // Inicializar estado persistente de posiciones si no existe
          if (typeof window.estadoPosiciones === 'undefined') {
            window.estadoPosiciones = {};
          }




          if (posicionActual) {
            const symbolSideKey = `${posicionActual.symbol}_${posicionActual.positionSide}`;
            if (!window.estadoPosiciones[symbolSideKey]) {
              window.estadoPosiciones[symbolSideKey] = { tp1Cerrado: false, slTrailing: false };
            }
          }

        // Desde aqui comienza el uso de la cuenta de Binance relacionada con los API KEY y API SECRET...


        // ───────────────────────────────────────
        // 🔥 CIERRE REVERSIÓN - 5m
        // ───────────────────────────────────────

          // Después de tener: posicionActual, window.simboloActual
         // evaluarCierreReversion(window.simboloActual, posicionActual, window.indicadores);

          // ───────────────────────────────────────
          // 🔴 LÓGICA DE CIERRE (si hay posición)
          // ───────────────────────────────────────

          // --- NUEVA PROTECCIÓN: EXCLUIR POSICIONES DE MODO REVERSIÓN ---
          if (posicionActual) {
            const esPosicionReversion =
              posicionActual &&
              posicionActual.simbolo === posicionActual.symbol;

            if (esPosicionReversion) {
              // ✅ Delegar cierre a la lógica de reversión
              evaluarCierreReversion(
                posicionActual.symbol,
                posicionActual,
                window.indicadores
              );
             // return; // ← Salir sin ejecutar cierre antiguo
            }
          }

          // ✅ Solo evaluar cierre si ya se calculó la predicción y hay posición
          if (historialVelas.length >= 30 && prediccionRaw != null && posicionActual) { // <-- Asegurar que posicionActual no sea null aquí también
            const size = parseFloat(posicionActual.positionAmt);
            const entryPrice = parseFloat(posicionActual.entryPrice);
            const markPrice = parseFloat(posicionActual.markPrice);
            const leverage = parseFloat(posicionActual.leverage);
            const esLong = size > 0;
            const esShort = size < 0;

            if (!size || !entryPrice || isNaN(entryPrice) || isNaN(markPrice) || leverage <= 0) {
              console.warn('⚠️ Datos de posición inválidos. Saltando evaluación.');
              return; // Salir si los datos son inválidos
            }

            // [Agregado] Obtener estado persistente
            const symbolSideKey = `${posicionActual.symbol}_${posicionActual.positionSide}`;
            let estadoLocal = window.estadoPosiciones[symbolSideKey] || { tp1Cerrado: false, slTrailing: false };



            // 🔵 ROE y TP/SL dinámicos (misma lógica de antes)
            let tpPrice, slPrice, tpPctDisplay, slPctDisplay;

            const modoTPSL = document.getElementById('tpsl-mode')?.value || 'dinamico';

            if (modoTPSL === 'manual') {
              // Manual: usas % sobre precio (sin leverage)
              const tpPct = parseFloat(document.getElementById('takeProfit')?.value) || 3.0;
              const slPct = parseFloat(document.getElementById('stopLoss')?.value) || 1.5;

              if (esLong) {
                tpPrice = entryPrice * (1 + tpPct / 100);
                slPrice = entryPrice * (1 - slPct / 100);
              } else {
                tpPrice = entryPrice * (1 - tpPct / 100);
                slPrice = entryPrice * (1 + slPct / 100);
              }
              tpPctDisplay = tpPct;
              slPctDisplay = slPct;
            } else {
              // Dinámico: basado en ATR (sin leverage para precios)
              try {
                const simbolo = document.getElementById('selector-simbolo').value;
                const k5m = await obtenerDatos(simbolo, '5m', 50);
                if (k5m.length >= 20) {
                  const atrArray = calcularATR(k5m, 14);
                  const atrVal = atrArray .length > 0 ? atrArray [atrArray .length - 1] : 0;// fallback razonable
                  // Ajusta estos multiplicadores según tu estrategia
                  const tpMult = parseFloat(document.getElementById('tp-mult')?.value) || 2.0;
                  const slMult = parseFloat(document.getElementById('sl-mult')?.value) || 1.0;

                  const tpDist = atrVal * tpMult;
                  const slDist = atrVal * slMult;
                   console.log(`🔍 [DEBUG] ATR usado/cerrar posicion: ${atrVal.toFixed(2)}`);
               


                  if (esLong) {
                    tpPrice = entryPrice + tpDist;
                    slPrice = entryPrice - slDist;
                  }else {
                    tpPrice = entryPrice - tpDist;
                    slPrice = entryPrice + slDist;
                  }

                  // Para mostrar en UI: % de movimiento del precio
                  tpPctDisplay = (tpDist / entryPrice) * 100;
                  slPctDisplay = (slDist / entryPrice) * 100;
                } else {

                 throw new Error("No hay suficientes velas");
                  }
                } catch (e) {
                  console.warn('⚠️ Fallback a TP/SL manual por error en ATR:', e.message);
                // Fallback a valores manuales
                const tpPct = 1.0, slPct = 0.5;
                if (esLong) {
                  tpPrice = entryPrice * 1.01;
                  slPrice = entryPrice * 0.995;
                } else {
                  tpPrice = entryPrice * 0.99;
                  slPrice = entryPrice * 1.005;
                }
            
              }
            }

            // Asegura que los precios sean válidos
            tpPrice = parseFloat(tpPrice.toFixed(2));
            slPrice = parseFloat(slPrice.toFixed(2));

            const roePct = ((markPrice - entryPrice) / entryPrice) * leverage * (esLong ? 1 : -1) * 100;

            

               let tpPctEquity = tpPctDisplay  ;
               let slPctEquity = slPctDisplay ;




            // 🔴 DECISIÓN DE CIERRE: SL, TP1, TP2, IA y Trailing (opcional)

            const trailingEnabled = document.getElementById('trailing-enabled')?.checked || false;
            let cerrar = false;
            let motivo = 'Manual';

            // 1. 🟢 TP1: Cierre parcial al 50% del ROE objetivo
            // (Solo si TP1 no se ha ejecutado)
            if (!estadoLocal.tp1Cerrado && roePct >= tpPctEquity ) {
              console.log(`✅ TP1 ALCANZADO | ROE: ${roePct.toFixed(2)}%`);
              estadoLocal.tp1Cerrado = true;
              window.estadoPosiciones[symbolSideKey] = estadoLocal;

              ordenEnCurso = true;
              const simbolo = document.getElementById('selector-simbolo').value;
              cerrarParcial(simbolo, posicionActual.positionSide, Math.abs(size) * 0.5, `TP1 (100%)`)
                .finally(() => { ordenEnCurso = false; });
           }

            // 2. 📉 Trailing Stop (opcional, solo si hay ganancia)
            //if (trailingEnabled && roePct >= 0.3) {
             //  console.log(`🚀 [TRAILING ACTIVADO] ROE=${roePct.toFixed(2)}%`);
              
             // if (roePct <= 0.1) {
             //   cerrar = true;
             //   motivo = `🟢 Trailing: +${roePct.toFixed(2)}%`;
             // console.log(`✅ [CIERRE POR TRAILING] ROE=${roePct.toFixed(2)}%`);
            //  }
          //  }

            // 3. 🔴 Stop Loss (solo si no se cerró por trailing)
            if (!cerrar && roePct <= -slPctEquity) {
              cerrar = true;
              motivo = `🔴 SL: ${roePct.toFixed(2)}%`;
            }

            // 4. 🎯 TP2 (Take Profit total)
           // else if (!cerrar && roePct >= tpPctEquity) {
            //  cerrar = true;
           //   motivo = `🎯 TP2: +${roePct.toFixed(2)}%`;
           // }

            // 5. 🤖 Cierre por IA (solo si no se cerró por TP/SL/trailing)
          //  else if (!cerrar) {
           //   const esShort = !esLong;
            //  const debeCerrarPorIA = prediccionRaw != null &&
            //    confianza >= 0.60 &&
            //    roePct < 0 &&
            //    Math.abs(roePct) > (slPctEquity * 0.5) &&
            ///    ((esLong && prediccionRaw <= 0.35) || (esShort && prediccionRaw >= 0.65));

            //  if (debeCerrarPorIA) {
            //    cerrar = true;
           //     motivo = `🤖 IA cambio: ${roePct.toFixed(2)}%`;
           //   }
           // }

            if (cerrar) { // <-- Esta es la condición que decide si se cierra
              // ACTIVAR BANDERA ANTES DE CERRAR TOTAL
              ordenEnCurso = true;
              const simbolo = document.getElementById('selector-simbolo').value;
              cerrarPosicion(simbolo, posicionActual.positionSide, motivo) // <-- Llamada a la función de cierre total
                .finally(() => {
                  // DESACTIVAR BANDERA DESPUÉS DE CERRAR TOTAL (éxito o error)
                  ordenEnCurso = false;
                  // [Corrección] Limpiar estado persistente si se cierra totalmente
                  delete window.estadoPosiciones[symbolSideKey];
                });
            }
            
             
            let entrada = entryPrice;
            let tpPct = tpPctEquity;
            let slPct = slPctEquity;
             
            // ✅ Actualizar líneas de PE/TP/SL (solo si hay posición abierta)
            actualizarLineasPrecios(entrada, tpPct, slPct, leverage);

          } // Fin del if (historialVelas.length >= 30 && prediccionRaw != null && posicionActual)

           console.log("🔍 [GAUSS] ¿Orden en Curso activa?", ordenEnCurso);

          // Después de tener: prediccionRaw, window.simboloActual, indicadores, historialVelas
          evaluarAperturaReversion(document.getElementById('selector-simbolo').value, prediccionRaw, window.indicadores, historialVelas);



          // ❌ Desactivar otros modos si Gauss está activo
         // if (document.getElementById('modo-gauss-activo')?.checked) {
            // Opcional: desactivar reversión si Gauss está activo
          //   document.getElementById('modo-reversion-activo').checked = false;
         // } else {
            // Evaluar reversión normalmente
         //   evaluarAperturaReversion(window.simboloActual, prediccionRaw,  window.indicadores, historialVelas);
         // }f

          // ✅ Evaluar Gauss SIEMPRE que esté activo
          evaluarSistemaGauss(document.getElementById('selector-simbolo').value, prediccionRaw,  window.indicadores, historialVelas);


          // En 5m, exige ADX un poco más alto (ej: > 25) para filtrar mercados laterales

          // 🟢 LÓGICA DE APERTURA (solo si NO hay posición)
          // ───────────────────────────────────────


          // En 5m, exige ADX un poco más alto (ej: > 25) para filtrar mercados laterales
         
            // 🔍 [DIAGNÓSTICO 1] Verificar entradas iniciales
              // ✅ Verificar que no haya posición real abierta
            const hayPosicionReal = posicionActual &&
            Math.abs(parseFloat(posicionActual.positionAmt)) > 0.0001;
           console.log(`🔍 [DIAG. APERTURA Entrada a APP modo-mercado-Antes] Pred: ${prediccionRaw != null ? prediccionRaw.toFixed(3) : 'null'}, Conf: ${(confianza * 100).toFixed(1)}%, Velas: ${historialVelas.length}, ADX: ${adxActual.toFixed(1)}, OrdenEnCurso: ${ordenEnCurso}`);


          // ─── EVALUAR SISTEMA 1: MODO MERCADO (solo si está activo) ───
          const modoMercadoActivo = document.getElementById('modo-mercado-activo')?.checked || false;
          if (modoMercadoActivo) {
            evaluarModoMercado(
              document.getElementById('selector-simbolo').value,
              prediccionRaw,
              confianza,
              adxActual,
              rsiActual,
              historialVelas,
              ordenEnCurso,
              posicionActual,
              alcista,
              bajista
            );
          }
          
          // ─── VERIFICAR PREDICCIÓN PENDIENTE ───
          verificarPrediccionPendiente(historialVelas, ordenEnCurso, posicionActual);
           
           // else if (operar && posicionActual) {
              // [Corrección] Log para depuración si se intenta abrir con posición existente
          //    console.log(`[DEBUG] Condición de apertura cumplida, PERO posicionActual EXISTE:`, posicionActual);
              // Opcional: Actualizar estado UI
          //    document.getElementById('estado').textContent = `⚠️ Señal de apertura, pero posición abierta para ${window.simboloActual}`;
           // }

         
          
            // ─────────   ──────────────────────────────
            // 💡 ACTUALIZAR TP/SL VISUAL EN PANEL
            // ───────────────────────────────────────
            let tpPct, slPct;
            const modoTPSL = document.getElementById('tpsl-mode')?.value || 'dinamico';

            if (modoTPSL === 'manual') {
              tpPct = parseFloat(document.getElementById('takeProfit')?.value) || 3.0;
              slPct = parseFloat(document.getElementById('stopLoss')?.value) || 1.5;
            } else {
              try {
                const simbolo = document.getElementById('selector-simbolo').value;
                const k5m = await obtenerDatos(simbolo, '5m', 50);
                if (k5m.length >= 20) {
                  const atrArray = calcularATR(k5m, 14);
                  const atrVal = atrArray.length > 0 ? atrArray[atrArray.length - 1] : 0;// fallback razonable
                  // Ajusta estos multiplicadores según tu estrategia

                  // ✅ Corregido: sin leverage, con multiplicadores razonables
                  const tpMult = parseFloat(document.getElementById('tp-mult')?.value) || 2.0;
                  const slMult = parseFloat(document.getElementById('sl-mult')?.value) || 1.0;

                  tpPct = (atrVal * tpMult / ultimoPrecio) * 100; // 2x ATR
                  slPct = (atrVal * slMult / ultimoPrecio) * 100; // 1x ATR
                  console.log(`🔍 [DEBUG] ATR usado/actualizar pantalla: ${atrVal.toFixed(2)}`);
                 
                }

                else {

                  throw new Error("No hay suficientes velas");
                }


              }catch(e)  {
              console.warn('⚠️ Fallback a TP/SL manual por error en ATR:', e.message);
              }
            }

            const tpEl = document.getElementById('tp-dinamico');
            const slEl = document.getElementById('sl-dinamico');

            if (tpEl) {
              tpEl.textContent = modoTPSL === 'manual'
                ? `TP (Manual): ${tpPct.toFixed(2)}%`
                : `TP (Dinámico): ${tpPct.toFixed(2)}%`;
            }
            if (slEl) {
              slEl.textContent = modoTPSL === 'manual'
                ? `SL (Manual): ${slPct.toFixed(2)}%`
                : `SL (Dinámico): ${slPct.toFixed(2)}%`;
                 // 2. ✅ ACTUALIZAR LAS LÍNEAS DEL GRÁFICO
              // Asumimos que tienes: entryPrice, leverage, y window.sideActual definidos
              if (window.sideActual && typeof entryPrice !== 'undefined') {
                const entrada = entryPrice;
                actualizarLineasPrecios(entrada, tpPct, slPct, leverage);
              }
            }

          
        



        } // Fin del bloque else (cuando autoTrading es true)



      }


      else {
        // === MOSTRAR PROGRESO SI AÚN NO SE ALCANZA EL LÍMITE ===
        const estadoEl = document.getElementById('estado');
        if (estadoEl) {
          estadoEl.textContent = `📊 Recibidas ${velasCerradas}/100 velas. Esperando...`;
          estadoEl.style.color = '#666';
        }
        console.log(`[DEBUG] Recibidas ${velasCerradas}/100 velas. Esperando más datos para procesar.`);
      }

      // ... (todo tu código de procesamiento de vela, indicadores, predicción, UI, trading) ...

    // ✅ === VALIDAR PREDICCIONES PENDIENTES (al final del ws.onmessage) ===
// ✅ Validar predicciones pendientes
    if (Array.isArray(window.prediccionesPendientes) && window.prediccionesPendientes.length > 0) {
      const ahora = historialVelas.length - 1;
          
      window.prediccionesPendientes = window.prediccionesPendientes.map(pred => {
        if (pred.resultado !== null) return pred; // ya verificada

        if (ahora >= pred.velaVerificacion) {
          const indiceVerif = Math.min(pred.velaVerificacion, historialVelas.length - 1);
          const precioFuturo = historialVelas[indiceVerif]?.close;

          if (precioFuturo == null) return pred; // vela no disponible aún

          const retorno = (precioFuturo - pred.precioInicio) / pred.precioInicio;
          const direccionReal = retorno > 0 ? 'SUBIDA' : 'BAJADA';
          const esAcierto = pred.direccion === direccionReal;
           console.log("🔍 Validando predicciones pendientes...", window.prediccionesPendientes?.length);
          pred.resultado = {
            acierto: esAcierto,
            retorno,
            precioFuturo,
            timestampVerif: Date.now()
          };

          registrarResultadoIA(pred, pred.resultado);
          // Al final de registrarResultadoIA
          localStorage.setItem('estadisticasIA', JSON.stringify(window.configEstadisticasIA));

        }
        return pred;
      });

    }


    }
    catch (err) {
      console.error("❌ ERROR EN ws.onmessage:", err);
      const estadoEl = document.getElementById('estado');
      if (estadoEl) {
        estadoEl.textContent = `❌ Error WebSocket: ${err.message}`;
        estadoEl.style.color = '#ef5350'; // Color rojo para error
      }
    }
  };

}


//Y llámala después de 100 velas.
function verificarEstadoPrediccion() {
  const timer = setInterval(() => {
    if (historialVelas.length >= 100 && !prediccionActiva) {
      console.log('✅ Sistema listo. Reactivando predicción...');
      // Fuerza una nueva predicción manualmente
      clearInterval(timer);
    }
  }, 10000); // Cada 10 segundos
}


// Función genérica para actualizar capital
async function actualizarCapitalDesdeCuenta(tipoCuenta = 'testnet') {
  try {
    const endpoint = tipoCuenta === 'mainnet' 
      ? '/api/binance/mainnet/account' 
      : '/api/binance/testnet/account';
      
    const token = localStorage.getItem('authToken');
    const res = await fetch(endpoint, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) throw new Error('Error en la respuesta');
    
    const data = await res.json();
    let saldoUSDT = 0;
    
    // Extraer saldo USDT
    if (data.availableBalance) {
      saldoUSDT = parseFloat(data.availableBalance);
    } else if (data.assets?.length) {
      const usdt = data.assets.find(a => a.asset === 'USDT');
      saldoUSDT = usdt ? parseFloat(usdt.walletBalance) : 0;
    }
    
    // Guardar en localStorage
    const keyPrefix = tipoCuenta === 'mainnet' ? 'mainnet_' : '';
    localStorage.setItem(`${keyPrefix}capitalActual`, saldoUSDT);
    localStorage.setItem(`${keyPrefix}capitalInicial`, saldoUSDT);
    
    // Actualizar interfaz
    await actualizarPanelFinanciero(tipoCuenta);
 
    
    return saldoUSDT;
    
  } catch (err) {
    console.error(`Error actualizando ${tipoCuenta}:`, err);
    // Usar valores por defecto
    const saldoDefault = tipoCuenta === 'mainnet' ? 0 : 1000;
    const keyPrefix = tipoCuenta === 'mainnet' ? 'mainnet_' : '';
    localStorage.setItem(`${keyPrefix}capitalActual`, saldoDefault);
    localStorage.setItem(`${keyPrefix}capitalInicial`, saldoDefault);
   await actualizarPanelFinanciero(tipoCuenta);
 
    return saldoDefault;
  }
}

// Función para recargar Testnet
async function recargarTestnet() {
  if (confirm('¿Actualizar Panel Financiero con saldo Testnet?')) {
    const saldo = await actualizarCapitalDesdeCuenta('testnet');
    alert(`✅ Testnet recargado - Saldo: $${saldo.toFixed(2)}`);
  }
}



// Función para recargar Mainnet  
async function recargarMainnet() {
  if (confirm('¿Actualizar Panel Financiero con saldo Mainnet?')) {
    const saldo = await actualizarCapitalDesdeCuenta('mainnet');
    alert(`✅ Mainnet recargado - Saldo: $${saldo.toFixed(2)}`);
  }
}

async function obtenerPrecioBTC() {
  try {
    // Asegurar que la URL es correcta
    const response = await fetch('/api/binance/ticker?symbol=BTCUSDT');
    if (!response.ok) {
      throw new Error('Respuesta no OK');
    }
    const data = await response.json();
    const precio = parseFloat(data.price);
    return isNaN(precio) ? 1 : precio;
  } catch (error) {
    console.warn('Usando precio BTC por defecto: 1', error);
    return 1;
  }
}


async function actualizarSaldoCuenta(tipoCuenta = 'testnet') {
  const keyPrefix = tipoCuenta === 'mainnet' ? 'mainnet_' : '';
  const capitalActual = parseFloat(localStorage.getItem(`${keyPrefix}capitalActual`)) || 
                       (tipoCuenta === 'mainnet' ? 0 : 1000);
  
  const montoInvertir = parseFloat(document.getElementById('montoCompra')?.value) || 100;
  
  // ✅ Obtener precio BTC de forma segura
  let saldoBTC = 0;
  try {
    const precioBTC = await obtenerPrecioBTC();
    saldoBTC = capitalActual / precioBTC;
  } catch (error) {
    console.warn('No se pudo calcular saldo BTC, usando 0');
    saldoBTC = 0;
  }
  
  const saldoUSDT = capitalActual;
  
  // Actualizar elementos
  const usdtEl = document.getElementById('saldo-usdt');
  const btcEl = document.getElementById('saldo-btc');
  const invEl = document.getElementById('monto-invertir');
  
  if (usdtEl) usdtEl.textContent = `$${saldoUSDT.toFixed(2)}`;
  if (btcEl) btcEl.textContent = `${saldoBTC.toFixed(6)} BTC`;
  if (invEl) invEl.textContent = `$${montoInvertir.toFixed(2)}`;
  
  // Mostrar cuenta actual
  const cuentaEl = document.getElementById('cuenta-actual');
  if (cuentaEl) {
    cuentaEl.textContent = tipoCuenta === 'mainnet' ? 'MAINNET' : 'TESTNET';
    cuentaEl.style.color = tipoCuenta === 'mainnet' ? '#ff6b6b' : '#4ecdc4';
  }
}

function actualizarMetricasFinancieras()  {
  if (operaciones.length === 0) {
    document.getElementById('pf').textContent = '—';
    document.getElementById('expectancy').textContent = '—';
    document.getElementById('sharpe').textContent = '—';
    document.getElementById('max-dd').textContent = '—';
    return;
  }
  
  // 🔹 Ganancias y pérdidas
  // 🔹 Clasificación de operaciones
  const wins = operaciones.filter(o => o.ganancia > 0);
  const losses = operaciones.filter(o => o.ganancia <= 0); // incluye 0
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
  const capitalInicial = 1000; // o desde input/constante
  const gananciaTotal = operaciones.reduce((sum, op) => sum + op.ganancia, 0);
  const roi = (gananciaTotal / capitalInicial) * 100;

  document.getElementById('roi').textContent = `${roi.toFixed(2)}%`;
  document.getElementById('ganancias').textContent = `$${totalWin.toFixed(2)}`;
  document.getElementById('perdidas').textContent = `-$${totalLoss.toFixed(2)}`;
  


  // 🔹 Sharpe Ratio (simple: ROI anualizado / desv ROE)
  // 🔹 ROE real por operación (usando leverage guardado)
  const roes = operaciones.map(o => {
    const leverage = o.leverage || 1;
    const retorno = (o.salida - o.entrada) / o.entrada;
    return retorno * leverage * 100;
  });
  



  // 🔹 Sharpe (por operación)
  if (roes.length >= 5) {
    const mean = roes.reduce((a, b) => a + b, 0) / roes.length;
    const variance = roes.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / roes.length;
    const std = Math.sqrt(variance);
    
    if (std > 0.01) {
      const sharpe = (mean / std).toFixed(2);
      document.getElementById('sharpe').textContent = parseFloat(sharpe) > 10 ? '10+' : sharpe;
    } else {
      document.getElementById('sharpe').textContent = '—';
    }
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


async function actualizarPanelFinanciero(tipoCuenta = 'testnet') {
  // Actualizar saldo (incluyendo BTC)
  await actualizarSaldoCuenta(tipoCuenta);
  
  // Actualizar métricas financieras
  actualizarMetricasFinancieras();
}


// === PRUEBA MANUAL ===
async function operacionPrueba() {
 // if (!AUTENTICADO) return;
  const dir = document.getElementById('prediccion-direccion').textContent;
  const adxE = document.getElementById('adx1-valor');
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

// ✅ BACKTESTING CON IA REAL — Versión final corregida
async function ejecutarBacktesting() {
  const msgEl = document.getElementById('backtesting-msg');
  if (!msgEl) return;
  msgEl.textContent = '⏳ Cargando datos y modelo…';
  msgEl.style.color = '#aaa';
  try {
    // 🔹 Parámetros desde UI
    const simbolo = document.getElementById('simbolo')?.value.toUpperCase() ;
    const modo = document.getElementById('modo-mercado')?.value || 'volatil';
    const tpslMode = document.getElementById('tpsl-mode')?.value || 'dinamico';
    const leverage = parseInt(document.getElementById('apalancamiento')?.value) || 2;
    const notional = parseFloat(document.getElementById('montoCompra')?.value) || 100;
    const intervalo = document.getElementById('intervalo-backtest')?.value || '5m'; // ← Selector de intervalo
    const adxUmbral = parseFloat(document.getElementById('adx-umbral')?.value) || 20; // ← Umbral ajustable

    // 🔹 Descargar datos reales
    const klines = await obtenerDatos(simbolo, intervalo, 300);
    if (klines.length < 100) throw new Error(`Se necesitan ≥100 velas (${intervalo})`);

    // 🔹 Validar modelo
    const usarIA = modelo != null;
    if (usarIA) {
      msgEl.textContent = '🧠 IA activa — Ejecutando backtesting con modelo real…';
    } else {
      msgEl.textContent = '⚙️ IA no entrenada — Usando lógica clásica (EMA+RSI)';
    }

    // 🔹 Simulación paso a paso
    let capital = 1000, peak = capital, maxDrawdown = 0;
    let operacionesSim = [], posicionAbierta = null;

    // 🔹 Pre-calcular indicadores globales
    const closes = klines.map(k => k.close);
    const rsiArr = calcularRSI(closes, 14);
    const ema20Arr = calcularEMA(closes, 20);
    const ema50Arr = calcularEMA(closes, 50);
    const adxArr = calcularADX(klines, 14); // ← Usa la versión corregida
    const atrArr = calcularATR(klines, 14);

    for (let i = 50; i < klines.length - 1; i++) {
      const vela = klines[i];
      const rsiActual = rsiArr[i] || 50;
      const e20 = ema20Arr[i] || vela.close;
      const e50 = ema50Arr[i] || vela.close;
      const alcista = e20 > e50;
      const bajista = e20 < e50;
      const adxActual = adxArr[i] || 0;
      const atrActual = atrArr[i] || 0;

      // ✅ Calcular OBV para la predicción
      const obvArr = calcularOBV(klines.slice(0, i + 1));
      const obvActual = obvArr.length > 0 ? obvArr[obvArr.length - 1] : 0;

      // ✅ PREDICCIÓN REAL CON MODELO (si está disponible)
      let prediccionRaw = 0.5;
      if (usarIA && closes.length >= 30) {
        try {
          const pred = await predecir(
            closes.slice(-10),
            klines.slice(i - 10, i).map(k => k.volume),
            rsiActual,
            e20,
            0, // macd
            0, // signal
            0.5, // bb
            0, // anchoBB
            atrActual,
            obvActual, // ← PASADO CORRECTAMENTE
            vela.close,
            0 // openInterest
          );
          if (pred != null && !isNaN(pred)) prediccionRaw = pred;
        } catch (e) {
          console.warn('⚠️ Error en predicción simulada:', e.message);
        }
      } else {
        // 🔹 Fallback clásico (tu lógica original)
        if (adxActual > 15) {
          if (alcista && rsiActual < 70) prediccionRaw = 0.72;
          else if (bajista && rsiActual > 30) prediccionRaw = 0.28;
        }
      }
     const confianza = Math.max(prediccionRaw, 1 - prediccionRaw);

      // ✅ Mostrar ADX y confianza en consola para depuración
      console.log(`[Backtest] Vela ${i}: ADX=${adxActual.toFixed(2)} | RSI=${rsiActual.toFixed(2)} | Confianza=${confianza.toFixed(2)} | Predicción=${prediccionRaw.toFixed(2)}`);

      // 🔹 GESTIÓN DE POSICIÓN ABIERTA
      if (posicionAbierta) {
        const { entrada, size, side, tp, sl, tp1Cerrado } = posicionAbierta;
        const precio = vela.close;
        const roePct = ((precio - entrada) / entrada) * leverage * (side === 'LONG' ? 1 : -1) * 100;

        // 🟢 TP1: 50% en TP/2
        if (!tp1Cerrado && roePct >= tp * 0.5) {
          const sizeParcial = size * 0.5;
          const pnlParcial = (precio - entrada) * sizeParcial * (side === 'LONG' ? 1 : -1);
          capital += pnlParcial;
          operacionesSim.push({ entrada, salida: precio, pnl: pnlParcial, motivo: `TP1 (50%)` });
          posicionAbierta.size = sizeParcial;
          posicionAbierta.tp1Cerrado = true;
        }

        // 🔴 SL / TP2 / IA (solo sobre el 50% restante)
        const roeRestante = ((precio - entrada) / entrada) * leverage * (side === 'LONG' ? 1 : -1) * 100;
        let cerrar = false, motivo = 'CloseOperation';
        if (roeRestante <= -sl) cerrar = true, motivo = `SL`;
        else if (roeRestante >= tp) cerrar = true, motivo = `TP2 (50%)`;
        else if (confianza >= 0.60 && roeRestante < -0.5 && Math.abs(roeRestante) > (sl * 0.5)) {
          const debeCerrarIA = (side === 'LONG' && prediccionRaw <= 0.3) || (side === 'SHORT' && prediccionRaw >= 0.7);
          if (debeCerrarIA) cerrar = true, motivo = `IA`;
        }
        if (cerrar) {
          const pnl = (precio - entrada) * posicionAbierta.size * (side === 'LONG' ? 1 : -1);
          capital += pnl;
          operacionesSim.push({ entrada, salida: precio, pnl, motivo });
          posicionAbierta = null;
        }
      }

      // 🔹 ABRIR NUEVA POSICIÓN
      if (!posicionAbierta && confianza >= 0.60 && adxActual > adxUmbral) {
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
          posicionAbierta = { entrada: vela.close, size, side, tp: tpPct, sl: slPct, tp1Cerrado: false };
        }
      }

      // Actualizar equity y drawdown
      peak = Math.max(peak, capital);
      const dd = (peak - capital) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // 🔹 Cerrar última posición (si está abierta)
    if (posicionAbierta) {
      const { entrada, size, side } = posicionAbierta;
      const precioFinal = klines[klines.length - 1].close;
      const pnl = (precioFinal - entrada) * size * (side === 'LONG' ? 1 : -1);
      capital += pnl;
      operacionesSim.push({ entrada, salida: precioFinal, pnl, motivo: 'Final' });
    }

    // 🔹 Calcular métricas
    const winRate = operacionesSim.length > 0 ? 
      operacionesSim.filter(o => o.pnl > 0).length / operacionesSim.length : 0;
    const roi = ((capital - 1000) / 1000) * 100;
    const fees = operacionesSim.length * 0.0016 * 100;
    const roiNeto = roi - fees;

    // ✅ Guardar y mostrar
    localStorage.setItem('backtest-last', JSON.stringify({
      fecha: new Date().toISOString(),
      simbolo,
      operaciones: operacionesSim,
      roi: roiNeto,
      winRate,
      maxDrawdown
    }));

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
  a.download = `backtest_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  console.log('✅ Backtest exportado:', backtest);
}

// Helper para backtesting
function predRawValida(modo, p, alcista, bajista) {
  return (modo === 'volatil' && ((p > 0.5 && alcista) || (p <= 0.5 && bajista)));
}




// ✅ FORZAR CIERRE POR IA — Solo para pruebas
async function forzarCierreIA() {
  if (!confirm('⚠️ ¿Forzar cierre por IA en todas las posiciones?')) return;
  try {
    const posiciones = await (await fetchConAuth('/api/binance/futures/positions')).json();
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



// === FUNCIONES DE CONTROL DEL SISTEMA (ACTUALIZADO - Con log de confirmación de detención de bandera) ===

// Asegúrate de que detenerTradingAutomatico solo desactive la bandera, no detenga el WebSocket ni el setInterval de ws.onmessage
function detenerTradingAutomatico() {
  console.log("Deteniendo trading automático (solo señales) por controlador externo o manualmente.");
  autoTrading = false; // <-- Desactivar SOLO la bandera de trading automático

  // Opcional: Actualizar UI del botón de trading automático (checkbox en este caso)
  const checkboxAutoTrading = document.getElementById('autoTrading'); // Ajusta el ID si es diferente
  if (checkboxAutoTrading) {
    checkboxAutoTrading.checked = false; // Desmarca el checkbox
  }

  // Opcional: Actualizar texto de estado
  const estadoEl = document.getElementById('estado');
  if (estadoEl) estadoEl.textContent = '⏹️ Trading automático detenido (seguimiento activo).';

  // [Agregado] Log de confirmación de detención de bandera
  console.log("✅ Bandera de trading automático desactivada. WebSocket sigue corriendo.");

  // NO HACEMOS ws.close() ni clearInterval(streamingInterval);
  // El WebSocket y su onmessage siguen corriendo, actualizando precios, gráfico, indicadores, etc.
}