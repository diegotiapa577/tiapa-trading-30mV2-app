// 🔐 CLAVE SECRETA — Cámbiala en producción
const CLAVE_SECRETA = '19344828';
let AUTENTICADO = false;

// ✅ Verificar clave (debe estar al inicio)
function verificarClave() {
  const input = document.getElementById('clave-acceso');
  const msg = document.getElementById('auth-msg')
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
let lineaPE = null, lineaTP = null, lineaSL = null; // ✅ Líneas de PE/TP/SL
let autoTrading = false;      // <-- Debe existir
let ordenEnCurso = false;
let sideActual = null;    /////AQUI ESTA
// [Agregado] Asegurar que operaciones esté disponible globalmente para controlador_operaciones.js
window.operaciones = operaciones;
// [Agregado] Asegurar que otras variables críticas también estén disponibles globalmente si es necesario
window.capitalActual = capitalActual;
window.capitalInicial = capitalInicial;
// Nota: capitalActual y capitalInicial se actualizan en otras funciones, por lo que debes asegurarte
// que cuando se actualicen, también se actualice el valor en window.capitalActual
// por ejemplo, en actualizarPanelFinanciero() o donde se modifique capitalActual.
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

// === GRÁFICOS CON LÍNEAS PE/TP/SL ===
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
  
  // ✅ Crear líneas de PE, TP y SL
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
    endTime = klines[0][0] - 1; // Timestamp en milisegundos de la primera vela, restamos 1ms para evitar solapamiento
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
const VELAS_FUTURAS = 5; // Define cuántas velas hacia adelante mira para la etiqueta


function prepararDatosConEtiquetas(klines) {
  const featuresList = [];
  const labelsList = [];

  // Calculamos todos los indicadores para todos los puntos donde tengamos datos suficientes
  // (por ejemplo, RSI necesita 14 velas anteriores)
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const rsiArr = calcularRSI(closes, 14); // Longitud: closes.length - 14 + 1 (siempre que haya suficientes datos)
  const emaArr = calcularEMA(closes, 20); // Longitud: closes.length - 20 + 1
  const { macdLine, signalLine } = calcularMACD(closes, 12, 26, 9); // Longitud: closes.length - slowPeriod - signalPeriod + 2 + 1 (siempre que haya suficientes datos)
  const { superior: bbSuperior, inferior: bbInferior } = calcularBandasBollinger(closes, 20, 2); // Longitud: closes.length - 20 + 1
  const atrArr = calcularATR(klines, 14); // Longitud: klines.length - 14 + 1
  const adxArr = calcularADX(klines, 14); // Longitud: klines.length - (14 * 2 - 1) (siempre que haya suficientes datos)
  const obvArr = calcularOBV(klines); // Longitud: klines.length

  console.log(`[Entrenamiento] Longitudes de arrays calculados - Closes: ${closes.length}, RSI: ${rsiArr.length}, EMA: ${emaArr.length}, MACD: ${macdLine.length}, BB: ${bbSuperior.length}, ATR: ${atrArr.length}, ADX: ${adxArr.length}, OBV: ${obvArr.length}`);

  // Iteramos desde el inicio hasta donde podamos mirar VELAS_FUTURAS adelante
  // Y aseguramos tener datos para todos los indicadores en el índice i
  // El desfase máximo es para MACD (índice 0 de macdLine es para closes[33]), luego ADX (índice 0 de adxArr es para klines[27]), etc.
  // También necesitamos mirar hacia adelante VELAS_FUTURAS
  // startIndex = max(Desfase_Máximo_Indicador, 10_para_ventana_precios, VELAS_FUTURAS_para_mirar_adelante)
  const desfaseRsi = 13; // rsiArr[0] <-> closes[13]
  const desfaseEma = 19; // emaArr[0] <-> closes[19]
  const desfaseMacd = 33; // macdLine[0] <-> closes[33] (ver implementación de calcularMACD)
  const desfaseBb = 19; // bbSuperior[0] <-> closes[19]
  const desfaseAtr = 13; // atrArr[0] <-> klines[13]
  const desfaseAdx = 27; // adxArr[0] <-> klines[27] (ver implementación de calcularADX)
  const desfaseObv = 0; // obvArr[0] <-> klines[0]

  const maxDesfase = Math.max(desfaseRsi, desfaseEma, desfaseMacd, desfaseBb, desfaseAtr, desfaseAdx, desfaseObv, 10); // 10 para ventana de precios
  const startIndex = Math.max(maxDesfase, VELAS_FUTURAS); // Asegura tener datos para indicadores y mirar adelante
  const endIndex = klines.length - VELAS_FUTURAS; // Hasta donde podemos mirar adelante

  if (startIndex >= endIndex) {
      console.error(`[Entrenamiento] startIndex (${startIndex}) >= endIndex (${endIndex}). No hay suficientes datos para el rango requerido con ${klines.length} velas.`);
      return { X: null, y: null };
  }

  console.log(`[Entrenamiento] Bucle desde vela ${startIndex} hasta ${endIndex}. Total velas: ${closes.length}, Rango usable: ${startIndex} - ${endIndex}`);

  for (let i = startIndex; i < endIndex; i++) {
    // Extraemos los valores actuales de los indicadores CORREGIDOS
    // Asumiendo que los arrays calculados empiezan en el índice correspondiente al primer valor válido
    // Por ejemplo, si RSI(14) se calcula, rsiArr[0] es para closes[13]. Por lo tanto, para closes[i], el valor es rsiArr[i - 13].
    // Si i < 13, rsiArr[i - 13] no existe y daría undefined. El operador || maneja eso.
    const rsiActual = rsiArr[i - desfaseRsi] || 50;
    const emaActual = emaArr[i - desfaseEma] || klines[i].close;
    const macdActual = macdLine[i - desfaseMacd] || 0;
    const signalActual = signalLine[i - desfaseMacd] || 0;
    const bbSup = bbSuperior[i - desfaseBb] || klines[i].close;
    const bbInf = bbInferior[i - desfaseBb] || klines[i].close;
    const atrActual = atrArr[i - desfaseAtr] || 0;
    const adxActual = adxArr[i - desfaseAdx] || 0;
    const obvActual = obvArr[i - desfaseObv] || 0; // Obv no tiene desfase, usa [i]

    // Definir la etiqueta: 1 si sube, 0 si no sube (cierra igual o más bajo)
    const precioActual = klines[i].close;
    const precioFuturo = klines[i + VELAS_FUTURAS].close;
    const etiqueta = precioFuturo > precioActual ? 1 : 0;

    // Extraemos las últimas 10 velas de precios y volúmenes para calcular features
    const ventanaPrecios = closes.slice(i - 10, i); // Precios en i-9, i-8, ..., i-1 (closes[i-9] a closes[i-1])
    const ventanaVolumenes = volumes.slice(i - 10, i);

    // Calculamos cambios porcentuales de precios
    const cambios = ventanaPrecios.map((p, idx) => idx === 0 ? 0 : (p - ventanaPrecios[idx - 1]) / ventanaPrecios[idx - 1]);

    // Calculamos posición relativa en BB
    const anchoBB = bbSup - bbInf;
    const posicionBB = anchoBB > 0 ? (precioActual - bbInf) / anchoBB : 0.5;

    // Calculamos ancho de BB relativo al precio
    const anchoBBRelativo = anchoBB / precioActual;

    // Calculamos ATR relativo al precio
    const atrRelativo = atrActual / precioActual;

    // Calculamos OBV normalizado
    const obvNormalizado = obvActual / 1e9;

    // Feature Vector (DEBE coincidir exactamente con la estructura de prepararDatosParaIA usada en predecir)
    // Conteo: 10 (cambios) + 13 (siguientes) = 23
    let features;
    try {
        features = [
            ...cambios, // 10 cambios porcentuales
            ventanaVolumenes.reduce((a, b) => a + b, 0) / 10 / 1e6, // 1. Promedio de volumen normalizado
            rsiActual / 100, // 2. RSI normalizado
            precioActual > emaActual ? 1 : 0, // 3. EMA booleana
            rsiActual > 70 ? 1 : 0, // 4. RSI > 70 booleana
            rsiActual < 30 ? 1 : 0, // 5. RSI < 30 booleana
            macdActual / 1000, // 6. MACD normalizado
            signalActual / 1000, // 7. Signal normalizado
            (macdActual - signalActual) / 1000, // 8. Histograma MACD normalizado
            posicionBB, // 9. Posición en BB
            anchoBBRelativo, // 10. Ancho BB relativo AL PRECIO
            atrRelativo, // 11. ATR relativo
            obvNormalizado, // 12. OBV normalizado
            0 / 1e6 // 13. openInterest simulado como 0 para completar 23 features. Puedes cambiarlo si tienes el valor real.
        ];
    } catch (error) {
        // Si la creación del array falla, registramos el error y saltamos la iteración
        console.error(`[Entrenamiento] Error al crear features para vela ${i}:`, error);
        console.log(`[Entrenamiento] Valores en error: rsi: ${rsiActual}, ema: ${emaActual}, precio: ${precioActual}, macd: ${macdActual}, signal: ${signalActual}, bbSup: ${bbSup}, bbInf: ${bbInf}, atr: ${atrActual}, obv: ${obvActual}`);
        continue; // Saltar esta iteración
    }

    // Verificamos que el número de features coincida con el inputShape del modelo (23)
    if (features.length === 23) {
      featuresList.push(features);
      labelsList.push(etiqueta);
    } else {
      console.warn(`[Entrenamiento] Features para vela ${i} no tiene 23 elementos (tiene ${features.length}). Saltando. Valores: RSI(${rsiActual}), EMA(${emaActual}), MACD(${macdActual}), Signal(${signalActual}), BB(Sup:${bbSup}, Inf:${bbInf}), ATR(${atrActual}), ADX(${adxActual}), OBV(${obvActual})`);
    }
  }

  if (featuresList.length === 0) {
    console.error("[Entrenamiento] No se generaron datos suficientes con la función prepararDatosConEtiquetas.");
    console.log(`[Entrenamiento] Longitudes de arrays originales - Closes: ${closes.length}, startIndex: ${startIndex}, endIndex: ${endIndex}`);
    console.log(`[Entrenamiento] Longitudes de arrays calculados - RSI: ${rsiArr.length}, EMA: ${emaArr.length}, MACD: ${macdLine.length}, BB: ${bbSuperior.length}, ATR: ${atrArr.length}, ADX: ${adxArr.length}, OBV: ${obvArr.length}`);
    return { X: null, y: null };
  }

  console.log(`[Entrenamiento] Datos preparados: ${featuresList.length} muestras válidas.`);
  return {
    X: tf.tensor2d(featuresList),
    y: tf.tensor2d(labelsList, [labelsList.length, 1])
  };
}

async function obtenerOpenInterest(symbol = 'BTCUSDT') {
  const res = await fetch(`/api/binance/futures/open-interest?symbol=${symbol}`);
  if (!res.ok) return 0;
  const data = await res.json();
  return data.openInterest || 0;
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

// === ENTRENAMIENTO (CORREGIDO - MultiSímbolo con gather) ===
// baraja los datos, crea el modelo con más dropout, y lo entrena.
// === ENTRENAMIENTO (MULTI-SÍMBOLO) ===
// Esta función descarga datos de múltiples símbolos, los prepara con etiquetas,
// los concatena, baraja los datos mezclados, crea el modelo con Dropout y lo entrena.
async function entrenarRed() {
  if (!AUTENTICADO) {
    alert('🔒 Acceso denegado. Ingresa la clave primero.');
    return;
  }

  // Definir símbolos a usar para entrenamiento
  const SIMBOLOS_ENTRENAMIENTO = ['BTCUSDT', 'ETHUSDT'];
  const INTERVALO = '1m'; // Usamos 4h como acordamos
  const LIMITE_DATOS = 50000; // Ajusta este número. Por ejemplo, 15000 velas de 4h por símbolo
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

    const X_train = X_shuffled.slice([0, 0], [trainSize, -1]);
    const y_train = y_shuffled.slice([0, 0], [trainSize, -1]);
    const X_val = X_shuffled.slice([trainSize, 0], [valSize, -1]);
    const y_val = y_shuffled.slice([trainSize, 0], [valSize, -1]);

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
    document.getElementById('sharpe').textContent = sharpe;
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



// En script-tapa.txt (asegúrate de que estas variables estén definidas globalmente o accesibles)
// let streamingInterval = null; // <-- Debe existir
// let autoTrading = false;      // <-- Debe existir

// Añadir o asegurar esta función en script-tapa.txt
function detenerTradingAutomatico() {
  console.log("Deteniendo trading automático por controlador externo o manualmente.");
  autoTrading = false; // Desactivar bandera de trading automático si se usa
  if (streamingInterval) {
    clearInterval(streamingInterval);
    streamingInterval = null;
    console.log("✅ Bucle de streaming detenido.");
  } else {
    console.log("ℹ️ Bucle de streaming no estaba activo.");
  }
  // Opcional: Actualizar UI
  const estadoEl = document.getElementById('estado');
  if (estadoEl) estadoEl.textContent = '⏹️ Trading automático detenido.';
  // Opcional: Detener streaming de precios si aplica
  // clearInterval(streamingPreciosInterval); // Si tienes uno separado
}
// Asegúrate de exponerla globalmente si el controlador la llama
window.detenerTradingAutomatico = detenerTradingAutomatico;

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
     // Si no hay una posición activa o no se ha definido el side, ocultar las líneas o no actualizarlas
     // Opcional: Podrías querer ocultarlas completamente
     // lineaPE.applyOptions({ visible: false });
     // lineaTP.applyOptions({ visible: false });
     // lineaSL.applyOptions({ visible: false });
     // return;
     // Para este ejemplo, asumiremos que no se llama a esta función si no hay side, o que side se limpia correctamente.
     // Si sideActual no está definido o es null, no actualizamos las líneas.
     console.warn("advertencia: sideActual no está definido o es null. No se actualizarán las líneas.");
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

  // Opcional: Actualizar textos de tooltips si los usas
  // document.getElementById('tooltip-pe')?.textContent = `PE: $${entrada.toFixed(4)}`;
  // document.getElementById('tooltip-tp')?.textContent = `TP (${tpPct}%): $${precioTP.toFixed(4)}`;
  // document.getElementById('tooltip-sl')?.textContent = `SL (${slPct}%): $${precioSL.toFixed(4)}`;
  // Y mostrarlos en la posición del precio en el gráfico
  // (Este código de tooltip es más complejo y depende de cómo lo hayas implementado originalmente)

  console.log(`[Gráfico] Líneas actualizadas - PE: ${entrada.toFixed(4)}, TP (${side}): ${precioTP.toFixed(4)}, SL (${side}): ${precioSL.toFixed(4)}`);

  // === AJUSTAR ESCALA DEL GRÁFICO PARA ZOOM IN EN LA POSICIÓN ACTUAL ===
  // Calculamos un rango de precios que incluya PE, TP y SL, y un pequeño margen
  // para que no estén pegados a los bordes superior/inferior

  // Determinar límites superior e inferior del rango de precios
   // === AJUSTAR ESCALA DEL GRÁFICO PARA ZOOM IN EN LA POSICIÓN ACTUAL ===
  // Calculamos un rango de precios que incluya PE, TP y SL, y un pequeño margen
  // para que no estén pegados a los bordes superior/inferior

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
     // Desactivar autoescala y aplicar márgenes para enfocar
     // scaleMargins: { top: <porcentaje>, bottom: <porcentaje> }
     // top: 0.1 significa que el precio más alto ocupará el 10% superior del gráfico
     // bottom: 0.15 significa que el precio más bajo ocupará el 15% inferior del gráfico
     // (0.1 + 0.15 = 0.25, por lo tanto, el 75% central del gráfico mostrará el rango deseado)
     // Es un enfoque relativo, no absoluto como setVisibleRange.
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
         // Aunque minPriceScale y maxPriceScale pueden no ser directos o requerir valores absolutos
         // que dependen del precio actual, y su efectividad puede variar.
         // minPriceScale: limiteInferior, // No garantizado que funcione como setVisibleRange
         // maxPriceScale: limiteSuperior, // No garantizado que funcione como setVisibleRange
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
    console.log(`🔍 [DEBUG] Notional real: $${(qty * precio).toFixed(3)}`);
    
    const tpslMode = document.getElementById('tpsl-mode')?.value || 'dinamico';
    let takeProfit = 1.5, stopLoss = 0.5;
    // En abrirPosicionReal():
    if (tpslMode === 'manual') {
      takeProfit = Math.max(0.5, parseFloat(document.getElementById('takeProfit').value) || 3.0); // ← de 1.5 → 3.0
      stopLoss = Math.max(0.5, parseFloat(document.getElementById('stopLoss').value) || 1.5);  // ← de 0.5 → 1.5
    } else {
      const k5m = await obtenerDatos(simboloActual, '5m', 50);
      const atrArr = k5m.length >= 20 ? calcularATR(k5m, 14) : [];
      const atrVal = atrArr.length > 0 ? atrArr[atrArr.length - 1] : 0;
      takeProfit = Math.max(0.8, (atrVal * 6 / precio) * 100);
      stopLoss = Math.max(0.3, (atrVal * 3 / precio) * 100);
    }
    
   // 1. Cambiar apalancamiento
const leverageRes = await fetch('/api/binance/futures/leverage', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ symbol: simboloActual, leverage: lev })
});
if (!leverageRes.ok) {
  const leverageErr = await leverageRes.json();
  console.error('⚠️ Error cambiando apalancamiento:', leverageErr);
  // Opcional: lanzar error y detener la apertura
  throw new Error(`Error cambiando apalancamiento: ${leverageErr.msg || 'Desconocido'}`);
} else {
    console.log('✅ Apalancamiento cambiado a:', lev);
}

// 2. Abrir la posición
const res = await fetch('/api/binance/futures/order', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ symbol: simboloActual, side, quantity: qty.toString() /*, leverage: lev */ }) // <-- 'leverage' ya no va aquí
});
    if (!res.ok) {
      const err = await res.json();
      throw new Error(`${err.msg || 'Error Binance'} (code: ${err.code})`);
    }
    console.log(`🟢 Orden ${side} abierta | TP: ${takeProfit.toFixed(2)}% | SL: ${stopLoss.toFixed(2)}%`);
    document.getElementById('estado').textContent = `✅ ${side} ${qty} ${simboloActual}`;
    
    // ✅ Guardar TP/SL por símbolo para cierre consistente
    tpSlConfig[simboloActual] = { tpPct: takeProfit, slPct: stopLoss, modo: tpslMode };
    
    const resultado = await res.json();
// ... (manejo de resultado) ...
      console.log(`🟢 Orden ${side} abierta | TP: ${takeProfit.toFixed(2)}% | SL: ${stopLoss.toFixed(2)}%`);
     document.getElementById('estado').textContent = `✅ ${side} ${qty} ${simboloActual}`;
   // ✅ Guardar TP/SL por símbolo para cierre consistente
   tpSlConfig[simboloActual] = { tpPct: takeProfit, slPct: stopLoss, modo: tpslMode };

  // [Agregado] Actualizar sideActual global para el gráfico
  // Convertimos 'BUY'/'SELL' a 'LONG'/'SHORT'
  // ESTA LÍNEA DEBE ESTAR AQUÍ, DENTRO DEL TRY, DESPUÉS DE ENVIAR LA ORDEN EXITOSAMENTE
  window.sideActual = side === 'BUY' ? 'LONG' : 'SHORT';
  console.log(`[DEBUG] sideActual actualizado a: ${window.sideActual} para ${simboloActual}`);

// ...
  await actualizarPosicionesAbiertas();
  
  } catch (err) {
   // console.error('🔴 abrirPosicionReal error:', err);
   // const msg = err.message.includes('-4164') ? '❌ Notional < 100 USDT' : `❌ ${err.message}`;
    //document.getElementById('estado').textContent = msg;
   // ✅ Guardar TP/SL por símbolo para cierre consistentetpSlConfig[simboloActual] = { tpPct: takeProfit, slPct: stopLoss, modo: tpslMode };
  // [Agregado] Actualizar sideActual global para el gráfico
  // Convertimos 'BUY'/'SELL' a 'LONG'/'SHORT'
   //window.sideActual = side === 'BUY' ? 'LONG' : 'SHORT';
  // console.log(`[DEBUG] sideActual actualizado a: ${window.sideActual} para ${simboloActual}`);
// ...
//await actualizarPosicionesAbiertas();
  }
}

let tpSlConfig = {}; // { BTCUSDT: { tpPct, slPct, modo } }

// ✅ CERRAR PARCIAL — Corregido: calcula PnL neta real y fees reales, SIN DUPLICAR APLACAMIENTO, pasa leverage
async function cerrarParcial(symbol, positionSide, sizeParcial, motivo) {
  try {
    const posResponse = await fetch('/api/binance/futures/positions');
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
    const closeRes = await fetch('/api/binance/futures/close-position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        positionSide,
        quantity: sizeParcial.toString()
      })
    });
    const resultado = await closeRes.json();

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

    // 3. Extraer datos reales
    const precioEntrada = parseFloat(posicion.entryPrice) || 0; // Usar entryPrice, no markPrice
    const positionAmt = parseFloat(posicion.positionAmt) || 0;
    const cantidad = Math.abs(positionAmt); // Cantidad total cerrada
    const sideActual = positionAmt > 0 ? 'LONG' : 'SHORT';
    const leverage = parseFloat(posicion.leverage) || 1; // <-- Aseguramos usar el leverage real de la posicion

    // 4. Cerrar en Binance
    const closeRes = await fetch('/api/binance/futures/close-position', {
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

    //[Agregado] Limpiar sideActual global si ya no hay posiciones abiertas para este símbolo
    // Obtenemos las posiciones actuales de la API
    try {
  const posiciones = await (await fetch('/api/binance/futures/positions')).json();
  // Buscamos si hay ALGUNA posición abierta para simboloActual (no solo la del mismo side, todas)
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
  } catch (err) {
    console.error('🔴 Error actualizando posiciones:', err);
    const tbody = document.querySelector('#operaciones-abiertas tbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:#ef5350;text-align:center;">⚠️ Error al cargar posiciones</td></tr>`;
    }
  }
}

// === SEMÁFORO MEJORADO (ACTUALIZADO) ===
// Añadimos un parámetro opcional 'tradingActivo' para reflejar el estado del autotrading
function actualizarSemaforo({ adx = 0, confianza = 0, preciosLen = 0, modo = 'volatil', alcista = false, bajista = false, tradingActivo = true } = {}) {
  // Solo evalúa las condiciones si el trading automático está activo
  if (tradingActivo) {
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
  } else {
    // Si el trading automático está desactivado, mostrar un estado diferente
    const adxEl = document.getElementById('cond-adx');
    const modoEl = document.getElementById('cond-modo');
    const predEl = document.getElementById('cond-pred');
    const datosEl = document.getElementById('cond-datos');
    const msgEl = document.getElementById('semaforo-msg');

    // Opcional: Dejar los indicadores técnicos como estaban, o ponerlos en un estado neutro
    // Por ejemplo, dejar los colores técnicos actuales, pero cambiar el mensaje:
    // (Esto requiere leer los valores actuales o guardarlos, lo cual complica)
    // Para simplificar, se pueden dejar los colores anteriores si es aceptable,
    // o reiniciarlos a un estado neutro como gris.
    // Por ahora, dejamos los colores técnicos anteriores (o como estaban en la última actualización)
    // y solo cambiamos el mensaje principal.

    // Cambia solo el mensaje principal para indicar que está detenido
    if (msgEl) {
      msgEl.textContent = '⏸️ Trading automático detenido';
      msgEl.style.color = '#ffa726'; // Naranja para indicar pausa
    }
    // Si deseas que los indicadores técnicos también reflejen el estado "pausado",
    // puedes descomentar y adaptar las siguientes líneas:
    /*
    if (adxEl) adxEl.style.backgroundColor = '#999'; // Gris
    if (modoEl) modoEl.style.backgroundColor = '#999';
    if (predEl) predEl.style.backgroundColor = '#999';
    if (datosEl) datosEl.style.backgroundColor = '#999';
    */
  }
}
// === STREAMING ===
// === STREAMING (ACTUALIZADO - Con logs y manejo de ordenEnCurso corregido) ===
async function iniciarStreaming() {
  if (!AUTENTICADO) return;

  // [Agregado] Prevenir múltiples intervalos si ya está corriendo
  if (streamingInterval) {
      console.log("⚠️ iniciarStreaming: Bucle ya está activo. Deténgalo primero.");
      return; // Opcional: Puedes detener el anterior automáticamente aquí si lo prefieres
  }

  if (!modelo) { alert('Entrena el modelo primero'); return; }
  simboloActual = document.getElementById('simbolo').value.toUpperCase();

  // [Agregado] Log de inicio
  console.log(`[Streaming] Iniciando bucle de streaming para ${simboloActual}...`);

  try {
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
      // ✅ VERIFICAR BANDERA DE ORDEN EN CURSO ANTES DE TODO
      if (ordenEnCurso) {
        console.log("⚠️ Operación en curso, esperando a que termine...");
        return; // Salir de esta iteración si hay una orden en curso
      }

      try {
        const ticker = await (await fetch(`/api/binance/ticker?symbol=${simboloActual}`)).json();
        ultimoPrecio = parseFloat(ticker.price);
        const ahora = Math.floor(Date.now() / 1000);
        const ultimaVela = klines[klines.length - 1];
        if (ahora - ultimaVela.time >= 60) {
          klines.push({ time: ahora, open: ultimaVela.close, high: Math.max(ultimaVela.close, ultimoPrecio), low: Math.min(ultimaVela.close, ultimoPrecio), close: ultimoPrecio, volume: 0 });
          precios.push(ultimoPrecio);
          // [CORRECCIÓN] Asegurar que el tiempo para la actualización del gráfico sea el mismo que el de la vela
          dataSeries.update({ time: ahora, open: ultimaVela.close, high: Math.max(ultimaVela.close, ultimoPrecio), low: Math.min(ultimaVela.close, ultimoPrecio), close: ultimoPrecio, volume: 0 });
        } else {
          klines[klines.length - 1] = { ...ultimaVela, high: Math.max(ultimaVela.high, ultimoPrecio), low: Math.min(ultimaVela.low, ultimoPrecio), close: ultimoPrecio };
          // [CORRECCIÓN] Asegurar que el tiempo para la actualización del gráfico sea el mismo que el de la vela
          dataSeries.update({ ...klines[klines.length - 1] });
        }

        // ... (código para calcular indicadores: rsi, ema, macd, bb, atr, adx, obv, etc.) ...
        // (Asumiendo que todas estas variables se calculan aquí)
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

        // Actualizar UI de ADX y ATR
        const adxE = document.getElementById('adx-valor');
        const atrE = document.getElementById('atr-valor');
        if (adxE) adxE.textContent = adxActual.toFixed(1);
        if (atrE) atrE.textContent = `ATR: ${atrGlobal.toFixed(2)}`;

        // Calcular predicción
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
            // [CORRECCIÓN] Cálculo de confianza basado en distancia a 0.5
            confianza = Math.abs(prediccionRaw - 0.5) * 2;
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

        // === ACTUALIZAR SEMÁFORO (considerando autoTrading) ===
        // Asegúrate de que estas variables (adxActual, confianza, alcista, bajista, etc.)
        // estén definidas en este punto del código dentro del setInterval.
        const modo = document.getElementById('modo-mercado')?.value || 'volatil';
        // PASAMOS EL ESTADO DE autoTrading PARA QUE EL SEMÁFORO LO REFLEJE
        actualizarSemaforo({
          adx: adxActual,
          confianza: confianza,
          preciosLen: precios.length,
          modo: modo,
          alcista: alcista,
          bajista: bajista,
          tradingActivo: autoTrading // <-- PASAMOS EL ESTADO DE autoTrading
        });
        // === FIN ACTUALIZAR SEMÁFORO ===

        // === PROTECCIÓN CONTRA FLASH EVENTS (>5% en 10s) ===
        if (precios.length >= 6) {
          const cambio10s = ((ultimoPrecio - precios[precios.length - 6]) / precios[precios.length - 6]) * 100;
          if (Math.abs(cambio10s) > 5.0) {
            console.warn(`🚨 Flash event detectado: ${cambio10s.toFixed(2)}% en 10s`);
            document.getElementById('estado').textContent = `⚠️ Flash event (${cambio10s.toFixed(1)}%) → Auto-cierre seguro`;
            // Cerrar TODAS las posiciones abiertas inmediatamente
            const posiciones = await (await fetch('/api/binance/futures/positions')).json();
            for (const pos of posiciones) {
              if (Math.abs(parseFloat(pos.positionAmt)) > 0.0001) {
                // [CORRECCIÓN] Manejar ordenEnCurso en flash events
                // ACTIVAR BANDERA ANTES DE CERRAR
                ordenEnCurso = true;
                cerrarPosicion(pos.symbol, pos.positionSide, 'Flash Event')
                  .finally(() => {
                     // DESACTIVAR BANDERA DESPUÉS DE CERRAR (éxito o error)
                     ordenEnCurso = false;
                  });
              }
            }
            return; // Salir de esta iteración
          }
        }

        // === CONTROL DE TRADING AUTOMÁTICO (APERTURA Y CIERRE BASADO EN SEÑALES) ===
        // Esta línea detiene la lógica de apertura/cierre automático basado en señales
        if (!autoTrading) {
            // El bucle sigue corriendo, actualizando precios, indicadores, semáforo, etc.
            // Pero no intentará abrir ni cerrar posiciones automáticamente basadas en señales de IA.
            // Continúa hasta la actualización del semáforo y el catch.
        } else {
            // === TRADING AUTOMÁTICO === (Lógica de cierre y apertura basada en señales)
            // [Corrección] Obtener posiciones con manejo de errores más robusto
            let posiciones;
            try {
              const posResponse = await fetch('/api/binance/futures/positions');
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

            // [CORRECCIÓN] Asignar la posición específica para el símbolo actual
            const posicionActual = posiciones.find(p => p.symbol === simboloActual && Math.abs(parseFloat(p.positionAmt)) > 0.0001);

            // [Agregado] Inicializar estado global para posiciones si no existe
            if (typeof window.estadoPosiciones === 'undefined') window.estadoPosiciones = {};

            // [Agregado] Inicializar estado persistente para esta posición si es la primera vez que la vemos en esta iteración
            if (posicionActual) {
                const symbolSideKey = `${posicionActual.symbol}_${posicionActual.positionSide}`;
                if (!window.estadoPosiciones[symbolSideKey]) {
                    window.estadoPosiciones[symbolSideKey] = { tp1Cerrado: false, slTrailing: false };
                }
            }

            // ✅ Solo evaluar cierre si ya se calculó la predicción y hay posición
            if (precios.length >= 30 && prediccionRaw != null && posicionActual) { // <-- Asegurar que posicionActual no sea null aquí también
              // [CORRECCIÓN] Asignar variables desde posicionActual
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
              let tpPctEquity = 3.0, slPctEquity = 1.5;
              const modoTPSL = document.getElementById('tpsl-mode')?.value || 'dinamico';
              if (modoTPSL === 'manual') {
                tpPctEquity = Math.max(0.5, parseFloat(document.getElementById('takeProfit')?.value) || 3.0);
                slPctEquity = Math.max(0.5, parseFloat(document.getElementById('stopLoss')?.value) || 1.5);
              } else {
                try {
                  const k5m = await obtenerDatos(simboloActual, '5m', 50);
                  if (k5m.length >= 20) {
                    const a = calcularATR(k5m, 14);
                    const atrVal = a[a.length - 1] || 0;
                    tpPctEquity = Math.max(0.8, (atrVal * 6 / entryPrice) * leverage * 100);
                    slPctEquity = Math.max(0.5, (atrVal * 3 / entryPrice) * leverage * 100);
                  }
                } catch (e) {
                  console.warn('⚠️ Error calculando ATR para TP/SL:', e.message);
                  tpPctEquity = 3.0; // Fallback
                  slPctEquity = 1.5; // Fallback
                }
              }
              tpPctEquity = Math.max(0.5, tpPctEquity);
              slPctEquity = Math.max(0.5, slPctEquity);

              const roePct = ((markPrice - entryPrice) / entryPrice) * leverage * (esLong ? 1 : -1) * 100;

              // 🟢 TP1 (50%): activa en ROE = 50% del TP total
              const tp1Threshold = tpPctEquity * 0.5;
              // [Corrección] Verificar estado persistente ANTES de intentar TP1
              if (roePct >= tp1Threshold && !estadoLocal.tp1Cerrado) {
                const sizeParcial = Math.abs(size) * 0.5;
                // [Corrección] Marcar como TP1 ejecutado en estado persistente ANTES de llamar a cerrarParcial
                estadoLocal.tp1Cerrado = true;
                window.estadoPosiciones[symbolSideKey] = estadoLocal; // [Corrección] Guardar estado persistente

                // ACTIVAR BANDERA ANTES DE CERRAR PARCIAL
                ordenEnCurso = true;
                cerrarParcial(simboloActual, posicionActual.positionSide, sizeParcial, `TP1 (50%)`)
                  .finally(() => {
                     // DESACTIVAR BANDERA DESPUÉS DE CERRAR PARCIAL (éxito o error)
                     ordenEnCurso = false;
                  });
              }

              // 🔵 Trailing SL: tras ROE ≥ 1.0%, mover SL a break-even + 0.3% (en equity) - Aplicar si activado
              // [Corrección] Usar estado persistente para trailing
              if (roePct >= 1.0 && estadoLocal.slTrailing) { // <-- Usar estado persistente
                slPctEquity = 0.3; // 0.3% de margen
              }

              // 🔴 SL, TP2 o IA
              let cerrar = false, motivo = 'Manual';
              if (roePct <= -slPctEquity) {
                cerrar = true;
                motivo = `SL alcanzado (${slPctEquity.toFixed(1)}%)`;
              } else if (roePct >= tpPctEquity) {
                cerrar = true;
                motivo = `TP2 (50%)`;
              } else {
                // ✅ Cierre por IA + 50% SL (SOLO SI AMBAS CONDICIONES SE CUMPLEN)
                const debeCerrarPorIA = prediccionRaw != null &&
                  confianza >= 0.53 && // Ajustar confianza si es necesario
                  roePct < 0 &&
                  Math.abs(roePct) > (slPctEquity * 0.5) && // 50% del SL
                  ((esLong && prediccionRaw <= 0.35) || (esShort && prediccionRaw >= 0.65)); // Ajustar umbrales IA si es necesario
                if (debeCerrarPorIA) {
                  cerrar = true;
                  motivo = `IA cambio + PnL=${roePct.toFixed(2)}%`;
                }
              }

              if (cerrar) {
                  // ACTIVAR BANDERA ANTES DE CERRAR TOTAL
                  ordenEnCurso = true;
                  cerrarPosicion(simboloActual, posicionActual.positionSide, motivo)
                    .finally(() => {
                       // DESACTIVAR BANDERA DESPUÉS DE CERRAR TOTAL (éxito o error)
                       ordenEnCurso = false;
                       // [Corrección] Limpiar estado persistente si se cierra totalmente
                       delete window.estadoPosiciones[symbolSideKey];
                    });
              }

              // ✅ Actualizar líneas de PE/TP/SL (solo si hay posición abierta)
              // [CORRECCIÓN] Usar el side de la posicionActual o window.sideActual para el gráfico
              // Asumiendo que sideActual se actualiza en abrirPosicionReal y se limpia en cerrarPosicion
              if (window.sideActual) {
                  actualizarLineasPrecios(entryPrice, tpPctEquity, slPctEquity, leverage);
              }
            } // Fin del if (precios.length >= 30 && prediccionRaw != null && posicionActual)

            // 🔹 Abrir nuevas posiciones (fuera del bloque de cierre, como antes)
            // [Corrección] Asegurar que !posicionActual sea verdadero ANTES de intentar abrir
            // [Corrección] Asegurar que ordenEnCurso sea falso antes de intentar abrir (ya está chequeado arriba)
            if (prediccionRaw != null && confianza >= 0.55 && precios.length >= 55 && adxActual > 20) { // <-- Añadido !ordenEnCurso (ya está chequeado arriba, por lo tanto, !ordenEnCurso es true aquí)
              const side = prediccionRaw > 0.5 ? 'BUY' : 'SELL';
              let operar = false;
              const modo = document.getElementById('modo-mercado')?.value || 'volatil';
              // Asumiendo que alcista y bajista se calculan antes de este if
              // const alcista = e20 > e50;
              // const bajista = e20 < e50;
              // (Asegúrate de que alcista y bajista estén definidos aquí)
              if (modo === 'alcista' && side === 'BUY' && alcista) operar = true;
              else if (modo === 'bajista' && side === 'SELL' && bajista) operar = true;
              else if (modo === 'volatil' && ((side === 'BUY' && alcista) || (side === 'SELL' && bajista))) operar = true;

              // [Corrección] Verificar !posicionActual aquí también (la obtenida de posiciones.find)
              if (operar && !posicionActual) { // <-- Condición clave
                 // ACTIVAR BANDERA ANTES DE ABRIR POSICIÓN
                 ordenEnCurso = true;
                 abrirPosicionReal(side)
                   .finally(() => {
                      // DESACTIVAR BANDERA DESPUÉS DE ABRIR POSICIÓN (éxito o error)
                      ordenEnCurso = false;
                   });
              } else if (operar && posicionActual) {
                 // [Corrección] Log para depuración si se intenta abrir con posición existente
                 // console.log(`[DEBUG] Condición de apertura cumplida, PERO posicionActual EXISTE:`, posicionActual);
                 // Opcional: Actualizar estado UI
                 // document.getElementById('estado').textContent = `⚠️ Señal de apertura, pero posición abierta para ${simboloActual}`;
              }
            }
        } // Fin del bloque else (cuando autoTrading es true)

        // === ACTUALIZAR SEMÁFORO AL FINAL DEL BLOQUE TRY (independientemente de autoTrading) ===
        // Asegúrate de que estas variables (adxActual, confianza, alcista, bajista, etc.)
        // estén definidas en este punto del código dentro del setInterval.
        // const modo = document.getElementById('modo-mercado')?.value || 'volatil'; // Ya se define arriba
        // Ya se llama a actualizarSemaforo arriba con el parámetro tradingActivo
        // actualizarSemaforo({ ... }); // <-- Esta línea está duplicada y fuera del bloque condicional correcto
        // === FIN ACTUALIZAR SEMÁFORO ===
        // === FIN ACTUALIZAR SEMÁFORO ===

      } catch (err) {
        console.error('🔴 Streaming error:', err);
        document.getElementById('estado').textContent = `⚠️ ${err.message}`;
        // ASEGURAR QUE LA BANDERA SE DESACTIVE EN CASO DE ERROR EN EL BLOQUE PRINCIPAL
        // [CORRECCIÓN] Asegurar que ordenEnCurso se reactive si hay un error general aquí
        // Si un error ocurre dentro del try *principal* del setInterval, ordenEnCurso podría quedar en true si se seteó antes del error.
        // Sin embargo, el error haría que la iteración termine, y en la siguiente iteración, la verificación `if (ordenEnCurso)` al inicio la detectaría.
        // Esta línea es redundante aquí si la verificación está al inicio y si .finally() se usa correctamente en operaciones.
        // ordenEnCurso = false; // <-- COMENTADO: No es necesaria aquí si se manejan bien los finally()
      }
    }, 10000); // Intervalo de 10 segundos

    // [Agregado] Log de confirmación de inicio del bucle
    console.log(`✅ Bucle de streaming iniciado para ${simboloActual}. autoTrading = true.`);

    autoTrading = true; // Asegurar que la bandera global de autoTrading esté en true al iniciar
  } catch (err) {
    console.error('Error en iniciarStreaming:', err);
    document.getElementById('estado').textContent = `❌ Error iniciando streaming: ${err.message}`;
    // [Agregado] Asegurar que el intervalo se limpie si falla la inicialización
    if (streamingInterval) {
      clearInterval(streamingInterval);
      streamingInterval = null;
      console.log("❌ Bucle de streaming limpiado tras error en inicio.");
    }
  }
}
// === FUNCIONES DE CONTROL DEL SISTEMA ===

// === FUNCIONES DE CONTROL DEL SISTEMA ===

// Asegúrate de que detenerTradingAutomatico solo desactive la bandera, no detenga el intervalo
// === FUNCIONES DE CONTROL DEL SISTEMA (ACTUALIZADO - Con log de confirmación de detención de bandera) ===

// Asegúrate de que detenerTradingAutomatico solo desactive la bandera, no detenga el intervalo
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
  console.log("✅ Bandera de trading automático desactivada. Streaming sigue corriendo.");

  // NO HACEMOS clearInterval(streamingInterval);
  // El setInterval sigue corriendo, pero la lógica de trading no se ejecuta si autoTrading es false.
}
// Asegúrate de exponerla globalmente si el controlador la llama
// Esta línea probablemente ya exista en tu script.js, pero es crucial:
// window.detenerTradingAutomatico = detenerTradingAutomatico;

// Asegúrate de exponerla globalmente si el controlador la llama
// Esta línea probablemente ya exista en tu script.js, pero es crucial:
// window.detenerTradingAutomatico = detenerTradingAutomatico;
// Asegúrate de exponerla globalmente si el controlador la llama
window.detenerTradingAutomatico = detenerTradingAutomatico;

// Asegúrate de que iniciarStreaming también actualice autoTrading
// async function iniciarStreaming() {
//   // ... (inicio como antes) ...
//   autoTrading = true; // <-- Añadir esta línea
//   // ... (resto del código) ...
// }
// Asegúrate de que donde llamas a iniciarStreaming, autoTrading esté en true.
// Por ejemplo, en el botón de UI que activa el streaming, antes de llamar a iniciarStreaming, hacer autoTrading = true;

// [Agregado] Función detenerStreaming para usar en detenerTradingAutomatico
async function detenerStreaming() {
  if (!AUTENTICADO) return;
  if (streamingInterval) {
      clearInterval(streamingInterval);
      streamingInterval = null;
      console.log("✅ Bucle de streaming detenido.");
  } else {
      console.log("ℹ️ Bucle de streaming no estaba activo.");
  }
  // Limpiar bandera por si acaso
  //ordenEnCurso = false;
  // Opcional: Actualizar UI
  const estadoEl = document.getElementById('estado');
  if (estadoEl) estadoEl.textContent = '⏹️ Streaming detenido.';
}


// === RECARGAR TESTNET ===
async function recargarTestnet() {
  if (!AUTENTICADO) return;
  if (confirm('¿Reiniciar capital a $1000 y borrar historial?')) {
    capitalActual = capitalInicial = 1000;
    operaciones = [];
    localStorage.removeItem('historialOperaciones');
    localStorage.removeItem('capitalActual');
    localStorage.removeItem('capitalInicial');
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



async function ejecutarBacktesting() {
  const msgEl = document.getElementById('backtesting-msg');
  if (!msgEl) return;
  msgEl.textContent = '⏳ Cargando datos y modelo…';
  msgEl.style.color = '#aaa';
  try {
    // 🔹 Parámetros desde UI
    const simbolo = document.getElementById('simbolo')?.value.toUpperCase() || 'BTCUSDT';
    const modo = document.getElementById('modo-mercado')?.value || 'volatil';
    const tpslMode = document.getElementById('tpsl-mode')?.value || 'dinamico';
    const leverage = parseInt(document.getElementById('apalancamiento')?.value) || 4;
    const notional = parseFloat(document.getElementById('montoCompra')?.value) || 100;
    const intervalo = document.getElementById('intervalo-backtest')?.value || '1h'; // ← Selector de intervalo
    const adxUmbral = parseFloat(document.getElementById('adx-umbral')?.value) || 20; // ← Umbral ajustable

    // 🔹 Descargar datos reales
    const klines = await obtenerDatos(simbolo, intervalo, 500);
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
      let prediccionRaw = 0.55;
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
      const confianza = Math.abs(prediccionRaw - 0.5) * 2;

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
        else if (confianza >= 0.7 && roeRestante < -0.5 && Math.abs(roeRestante) > (sl * 0.5)) {
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
      if (!posicionAbierta && confianza >= 0.55 && adxActual > adxUmbral) {
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
  
  
   // Asegúrate de que el botón exista antes de intentar agregar el listener
  const btnEntrenar = document.getElementById('btnEntrenar');
  if (btnEntrenar) {
    btnEntrenar.addEventListener('click', async () => {
      // Llamar a la función entrenarRed actualizada
      await entrenarRed();
    });
  } else {
    console.warn("⚠️ Botón de entrenamiento (id='btnEntrenar') no encontrado en el HTML.");
  }
    
  
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
  window.exportarBacktest = exportarBacktest;
  window.forzarCierreIA = forzarCierreIA;
  
  // 3. Eventos
  const btnReiniciar = document.getElementById('btn-reiniciar');
  if (btnReiniciar) {
    btnReiniciar.onclick = () => {
      capitalActual = capitalInicial = 1000;
      operaciones = [];
      actualizarPanelFinanciero();
      renderizarHistorial();
      localStorage.removeItem('historialOperaciones');
      localStorage.removeItem('capitalActual');
      localStorage.removeItem('capitalInicial');
    };
  }
  
  const btnExportar = document.getElementById('btn-exportar');
  if (btnExportar) {
    btnExportar.onclick = exportarBacktest;
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