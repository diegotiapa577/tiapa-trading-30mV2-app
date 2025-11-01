// ia-backend.js
import * as tf from '@tensorflow/tfjs';

// === INDICADORES TÉCNICOS (igual que en script.js) ===

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
  const medias = [];
  const superior = [];
  const inferior = [];

  for (let i = 0; i < precios.length; i++) {
    if (i < periodo - 1) {
      medias.push(NaN);
      superior.push(NaN);
      inferior.push(NaN);
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
    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    tr.push(Math.max(tr1, tr2, tr3));
  }
  let atr = [];
  let suma = 0;
  for (let i = 0; i < periodo - 1; i++) {
    atr.push(0);
    suma += tr[i];
  }
  const atrInicial = suma / (periodo - 1);
  atr.push(atrInicial);
  for (let i = periodo; i < tr.length; i++) {
    const nuevoATR = (atr[atr.length - 1] * (periodo - 1) + tr[i]) / periodo;
    atr.push(nuevoATR);
  }
  while (atr.length < klines.length) atr.unshift(0);
  return atr;
}

function calcularOBV(klines) {
  if (klines.length === 0) return [0];
  const obv = [0];
  for (let i = 1; i < klines.length; i++) {
    const cambioPrecio = klines[i].close - klines[i - 1].close;
    const volumen = klines[i].volume;
    if (cambioPrecio > 0) obv.push(obv[i - 1] + volumen);
    else if (cambioPrecio < 0) obv.push(obv[i - 1] - volumen);
    else obv.push(obv[i - 1]);
  }
  return obv;
}

// === MODELO DE IA ===

export async function crearModelo(inputShape = 24) {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [inputShape] }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy']
  });

  return model;
}

export function prepararDatosParaEntrenamiento(klines, fundingRate = 0, openInterest = 0) {
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const rsi = calcularRSI(closes, 14);
  const ema = calcularEMA(closes, 20);
  const { macdLine, signalLine } = calcularMACD(closes, 12, 26, 9);
  const { media: bbMedia, superior: bbSuperior, inferior: bbInferior } = calcularBandasBollinger(closes, 20, 2);
  const atr = calcularATR(klines, 14);
  const obv = calcularOBV(klines);

  const X = [];
  const y = [];

  for (let i = 30; i < klines.length - 1; i++) {
    const ventanaCierre = closes.slice(i - 10, i);
    const cambios = ventanaCierre.map((p, idx) => idx === 0 ? 0 : (p - ventanaCierre[idx - 1]) / ventanaCierre[idx - 1]);
    const volumenProm = volumes.slice(i - 10, i).reduce((a, b) => a + b, 0) / 10;

    const rsiActual = rsi[i] || 50;
    const emaActual = ema[i] || closes[i];
    const macdActual = macdLine[i] || 0;
    const signalActual = signalLine[i - 26 + 9] || 0;
    const bbMedio = bbMedia[i] || closes[i];
    const bbSup = bbSuperior[i] || closes[i];
    const bbInf = bbInferior[i] || closes[i];
    const anchoBB = bbSup - bbInf;
    const posicionBB = anchoBB > 0 ? (closes[i] - bbInf) / anchoBB : 0.5;
    const atrActual = atr[i] || 0;
    const obvActual = obv[i] || 0;

    const features = [
      ...cambios,
      volumenProm / 1e6,
      rsiActual / 100,
      closes[i] > emaActual ? 1 : 0,
      rsiActual > 70 ? 1 : 0,
      rsiActual < 30 ? 1 : 0,
      macdActual / 1000,
      signalActual / 1000,
      (macdActual - signalActual) / 1000,
      posicionBB,
      anchoBB / closes[i],
      atrActual / closes[i],
      obvActual / 1e9,
      fundingRate,
      openInterest / 1e6
    ];

    const cambioFuturo = closes[i + 1] > closes[i] ? 1 : 0;
    X.push(features);
    y.push(cambioFuturo);
  }

  return { X: tf.tensor2d(X), y: tf.tensor2d(y, [y.length, 1]) };
}

export async function entrenarModelo(klines, fundingRate = 0, openInterest = 0) {
  const { X, y } = prepararDatosParaEntrenamiento(klines, fundingRate, openInterest);
  if (X.shape[0] === 0) throw new Error("No hay suficientes datos para entrenar");

  const modelo = await crearModelo();
  await modelo.fit(X, y, { epochs: 30, batchSize: 32, verbose: 0 });

  X.dispose();
  y.dispose();
  return modelo;
}

export async function predecirConModelo(modelo, ultimosPrecios, ultimosVolumenes, rsiActual, emaActual, macdActual, signalActual, posicionBB, anchoBB, atrActual, obvActual, precioActual, fundingRate = 0, openInterest = 0) {
  const ultimos10 = ultimosPrecios.slice(-10);
  const cambios = ultimos10.map((p, idx) => idx === 0 ? 0 : (p - ultimos10[idx - 1]) / ultimos10[idx - 1]);
  const volumenProm = ultimosVolumenes.slice(-10).reduce((a, b) => a + b, 0) / 10;

  const features = [
    ...cambios,
    volumenProm / 1e6,
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
    fundingRate,
    openInterest / 1e6
  ];

  const input = tf.tensor2d([features]);
  const prediccion = modelo.predict(input);
  const valor = await prediccion.data();
  input.dispose();
  prediccion.dispose();
  return valor[0];
}