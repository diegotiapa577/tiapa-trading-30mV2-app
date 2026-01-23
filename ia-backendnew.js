// ia-backend.js
import * as tf from '@tensorflow/tfjs';

// === INDICADORES TÉCNICOS (igual que en script.js) ===

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
// === ENTRENAMIENTO: MULTI-SÍMBOLO (3+), 15m, 15k velas, portable ===
async function entrenarRed() {
  //if (!AUTENTICADO) {
   // alert('🔒 Acceso denegado. Ingresa la clave primero.');
   // return;
 // }

  // Definir símbolos a usar para entrenamiento
  const SIMBOLOS_ENTRENAMIENTO = ['BTCUSDT'];
  const INTERVALO = '1m'; // Usamos 4h como acordamos
  const LIMITE_DATOS = 5500; // Ajusta este número. Por ejemplo, 15000 velas de 4h por símbolo
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