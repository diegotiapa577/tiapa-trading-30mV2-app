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
  const histograma = macdLine.slice(lento - 1).map((val, i) => val - signalLine[i]);
  return { macdLine, signalLine, histograma };
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
  if (klines.length < periodo + 1) {
    return Array(klines.length).fill(0);
  }
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
  while (atr.length < klines.length) {
    atr.unshift(0);
  }
  return atr;
}

function calcularOBV(klines) {
  if (klines.length === 0) return [];
  const obv = [0];
  for (let i = 1; i < klines.length; i++) {
    const cambioPrecio = klines[i].close - klines[i - 1].close;
    const volumen = klines[i].volume;
    if (cambioPrecio > 0) {
      obv.push(obv[i - 1] + volumen);
    } else if (cambioPrecio < 0) {
      obv.push(obv[i - 1] - volumen);
    } else {
      obv.push(obv[i - 1]);
    }
  }
  return obv;
}

// === GRÁFICOS ===
function initChart() {
  if (typeof LightweightCharts === 'undefined') {
    console.error('❌ LightweightCharts no cargado');
    return;
  }
  const chartContainer = document.getElementById('chart');
  chart = LightweightCharts.createChart(chartContainer, {
    width: chartContainer.clientWidth,
    height: 420,
    layout: { backgroundColor: '#1e1e1e', textColor: 'white' },
    grid: { vertLines: { color: '#333' }, horzLines: { color: '#333' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    priceScale: { borderColor: '#444' },
    timeScale: { borderColor: '#444', timeVisible: true }
  });
  dataSeries = chart.addCandlestickSeries({
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderVisible: false,
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350'
  });
}

// === DATOS Y MODELO ===
async function obtenerDatos(symbol = 'BTCUSDT', interval = '1m', limit = 500) {
  const res = await fetch(`/api/binance/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Error al obtener klines: ${res.status}`);
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

async function obtenerFundingRate(symbol = 'BTCUSDT') {
  const res = await fetch(`/api/binance/futures/funding?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Error al obtener funding rate: ${res.status}`);
  const data = await res.json();
  return data.fundingRate;
}

async function obtenerOpenInterest(symbol = 'BTCUSDT') {
  const res = await fetch(`/api/binance/futures/open-interest?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Error al obtener open interest: ${res.status}`);
  const data = await res.json();
  return data.openInterest;
}

function prepararDatosParaIA(klines, fundingRate = 0, openInterest = 0) {
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
      openInterest / 1e6
    ];
    const indiceFuturo = i + 15;
    if (indiceFuturo >= closes.length) continue;
    const precioFuturo = closes[indiceFuturo];
    const cambioPorcentual = (precioFuturo - closes[i]) / closes[i];
    const cambioFuturo = cambioPorcentual >= 0.005 ? 1 : 0;
    X.push(features);
    y.push(cambioFuturo);
  }
  return { X: tf.tensor2d(X), y: tf.tensor2d(y, [y.length, 1]) };
}

// === ENTRENAMIENTO ===
async function crearModelo(inputShape = 23) {
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

async function entrenarRed() {
  document.getElementById('estado').textContent = 'Descargando datos...';
  try {
    const klines = await obtenerDatos(simboloActual, '1m', 1000);
    const fundingRate = await obtenerFundingRate(simboloActual);
    const openInterest = await obtenerOpenInterest(simboloActual);
    const { X, y } = prepararDatosParaIA(klines, fundingRate, openInterest);
    if (X.shape[0] === 0) {
      alert('No hay suficientes datos para entrenar');
      document.getElementById('estado').textContent = '⚠️ Datos insuficientes';
      return;
    }
    document.getElementById('estado').textContent = 'Entrenando red...';
    modelo = await crearModelo();
    await modelo.fit(X, y, { epochs: 30, batchSize: 32, verbose: 0 });
    X.dispose();
    y.dispose();
    document.getElementById('estado').textContent = '✅ Modelo entrenado';
  } catch (err) {
    console.error('Error al entrenar:', err);
    document.getElementById('estado').textContent = `❌ Error: ${err.message}`;
  }
}

async function predecir(ultimosPrecios, ultimosVolumenes, rsiActual, emaActual, macdActual, signalActual, posicionBB, anchoBB, atrActual, obvActual, precioActual, fundingRate = 0, openInterest = 0) {
  if (!modelo) return null;
  if (ultimosPrecios.length < 10) return null;
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
    openInterest / 1e6
  ];
  const input = tf.tensor2d([features]);
  const prediccion = modelo.predict(input);
  const valor = await prediccion.data();
  input.dispose();
  prediccion.dispose();
  return valor[0];
}

// === LÓGICA DE TRADING ===
function actualizarPanelFinanciero() {
  const gananciasTotales = operaciones
    .filter(o => o.ganancia > 0)
    .reduce((sum, o) => sum + o.ganancia, 0);
  const perdidasTotales = Math.abs(
    operaciones
      .filter(o => o.ganancia < 0)
      .reduce((sum, o) => sum + o.ganancia, 0)
  );
  const roi = ((capitalActual - capitalInicial) / capitalInicial) * 100;
  document.getElementById('ganancias').textContent = `$${gananciasTotales.toFixed(2)}`;
  document.getElementById('perdidas').textContent = `$${perdidasTotales.toFixed(2)}`;
  document.getElementById('roi').textContent = `${roi.toFixed(2)}%`;
}

function renderizarHistorial() {
  const tbody = document.querySelector('#historial tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  operaciones.slice().reverse().forEach(op => {
    const row = document.createElement('tr');
    const hora = new Date(op.timestampEntrada).toLocaleTimeString();
    const tipo = op.ganancia >= 0 ? 'GANANCIA' : 'PÉRDIDA';
    const color = op.ganancia >= 0 ? 'green' : 'red';
    const simbolo = op.ganancia >= 0 ? '+' : '';
    row.innerHTML = `
      <td>${hora}</td>
      <td>${op.simbolo}</td>
      <td>${tipo}</td>
      <td>$${op.entrada.toFixed(2)}</td>
      <td style="color:${color}">${simbolo}$${op.ganancia.toFixed(2)}</td>
    `;
    tbody.appendChild(row);
  });
}

function reiniciarCapital() {
  const capitalEl = document.getElementById('capital');
  const maxOpEl = document.getElementById('maxOperaciones');
  const tpEl = document.getElementById('takeProfit');
  const slEl = document.getElementById('stopLoss');
  const simboloEl = document.getElementById('simbolo');
  const apalancamientoEl = document.getElementById('apalancamiento');
  capitalInicial = parseFloat(capitalEl.value) || 1000;
  maxOperaciones = parseInt(maxOpEl.value) || 3;
  takeProfitPct = parseFloat(tpEl.value) || 5.0;
  stopLossPct = parseFloat(slEl.value) || 3.0;
  simboloActual = simboloEl.value.toUpperCase() || 'BTCUSDT';
  capitalActual = capitalInicial;
  operaciones = [];
  actualizarPanelFinanciero();
  renderizarHistorial();
  console.log(`🔁 Capital reiniciado`);
}

function exportarCSV() {
  if (operaciones.length === 0) {
    alert('No hay operaciones para exportar.');
    return;
  }
  const fechaExport = new Date().toISOString().split('T')[0];
  let csv = `# Símbolo: ${simboloActual}\n`;
  csv += `# Capital Inicial: $${capitalInicial}\n`;
  csv += `# Take-Profit: ${takeProfitPct}%, Stop-Loss: ${stopLossPct}%\n`;
  csv += `# Fecha Exportación: ${fechaExport}\n\n`;
  csv += 'Hora,Símbolo,Tipo,Precio,Ganancia\n';
  operaciones.forEach(op => {
    const hora = new Date(op.timestampEntrada).toISOString();
    const tipo = op.ganancia >= 0 ? 'GANANCIA' : 'PÉRDIDA';
    csv += `"${hora}",${op.simbolo},${tipo},${op.entrada.toFixed(2)},${op.ganancia.toFixed(2)}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('href', url);
  a.setAttribute('download', `trading_${fechaExport}.csv`);
  a.click();
  URL.revokeObjectURL(url);
}

// === REGISTRO DE OPERACIONES REALES ===
function registrarOperacionReal(symbol, side, precioEntrada, precioSalida, cantidad, pnl) {
  const montoInvertido = Math.abs(cantidad * precioEntrada);
  const gananciaAbs = parseFloat(pnl);
  const operacion = {
    entrada: precioEntrada,
    salida: precioSalida,
    ganancia: gananciaAbs,
    montoInvertido,
    timestampEntrada: Date.now() - 60000,
    timestampSalida: Date.now(),
    resultado: gananciaAbs >= 0 ? 'GANANCIA' : 'PÉRDIDA',
    simbolo: symbol
  };
  let historial = JSON.parse(localStorage.getItem('historialOperaciones') || '[]');
  historial.unshift(operacion);
  if (historial.length > 10) historial = historial.slice(0, 10);
  localStorage.setItem('historialOperaciones', JSON.stringify(historial));
  operaciones = historial;
  actualizarPanelFinanciero();
  renderizarHistorial();
}

// === TRADING REAL EN TESTNET ===
async function abrirPosicionReal(side) {
  try {
    const tickerRes = await fetch(`/api/binance/ticker?symbol=${simboloActual}`);
    if (!tickerRes.ok) throw new Error('No se pudo obtener el precio');
    const ticker = await tickerRes.json();
    const precioActual = parseFloat(ticker.price);
    if (isNaN(precioActual)) throw new Error('Precio inválido');
    let cantidad;
    if (simboloActual === 'BTCUSDT') {
      if (side === 'BUY') {
        const montoUSDT = parseFloat(document.getElementById('montoCompra').value) || 10;
        cantidad = (montoUSDT / precioActual).toFixed(6);
      } else {
        cantidad = (parseFloat(document.getElementById('montoVenta').value) || 0.001).toFixed(6);
      }
    } else if (simboloActual === 'ETHUSDT') {
      if (side === 'BUY') {
        const montoUSDT = parseFloat(document.getElementById('montoCompra').value) || 10;
        cantidad = (montoUSDT / precioActual).toFixed(5);
      } else {
        cantidad = (parseFloat(document.getElementById('montoVenta').value) || 0.01).toFixed(5);
      }
    } else {
      const montoUSDT = parseFloat(document.getElementById('montoCompra').value) || 10;
      cantidad = (montoUSDT / precioActual).toFixed(6);
    }
    const apalancamientoEl = document.getElementById('apalancamiento');
    const leverage = apalancamientoEl ? parseInt(apalancamientoEl.value) || 10 : 10;
    const response = await fetch('/api/binance/futures/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: simboloActual,
        side: side,
        quantity: cantidad,
        leverage: leverage,
        positionSide: 'BOTH'
      })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    const resultado = await response.json();
    console.log('✅ Orden ejecutada en Testnet:', resultado);
    document.getElementById('estado').textContent = `✅ Orden ${side} ejecutada en ${simboloActual}`;
    await actualizarPosicionesAbiertas();

    // Enviar alerta por Telegram
    const mensajeApertura = `🟢 Nueva posición\nSímbolo: ${simboloActual}\nLado: ${side}\nCantidad: ${cantidad}`;
    enviarMensajeTelegram(mensajeApertura);
  } catch (err) {
    console.error('❌ Error al abrir posición:', err);
    alert('Error: ' + err.message);
    document.getElementById('estado').textContent = `❌ Error: ${err.message}`;
  }
}

async function actualizarPosicionesAbiertas() {
  try {
    const response = await fetch('/api/binance/futures/positions');
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error HTTP:', response.status, errorText);
      return;
    }
    const data = await response.json();
    if (Array.isArray(data)) {
      const tbody = document.querySelector('#operaciones-abiertas tbody');
      tbody.innerHTML = '';
      data.forEach(pos => {
        const size = parseFloat(pos.positionAmt);
        if (Math.abs(size) < 0.0001) return;
        const entryPrice = parseFloat(pos.entryPrice);
        const markPrice = parseFloat(pos.markPrice);
        const pnl = parseFloat(pos.unRealizedProfit);
        const roe = ((markPrice - entryPrice) / entryPrice) * (size > 0 ? 1 : -1) * 100;
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${pos.symbol}</td>
          <td>${size > 0 ? 'LONG' : 'SHORT'}</td>
          <td>$${entryPrice.toFixed(2)}</td>
          <td>${roe.toFixed(2)}%</td>
          <td>$${pnl.toFixed(2)}</td>
          <td><button onclick="cerrarPosicion('${pos.symbol}', '${pos.positionSide}')">CloseOperation</button></td>
        `;
        tbody.appendChild(row);
      });
    }
  } catch (err) {
    console.error('💥 Error en actualizarPosicionesAbiertas:', err);
    document.getElementById('estado').textContent = `Error de red: ${err.message}`;
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
      throw new Error('No hay posición abierta para cerrar');
    }
    const precioEntrada = parseFloat(posicion.entryPrice);
    const cantidad = Math.abs(parseFloat(posicion.positionAmt));
    const sideActual = cantidad > 0 ? 'LONG' : 'SHORT';
    const response = await fetch('/api/binance/futures/close-position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, positionSide })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    const tickerRes = await fetch(`/api/binance/ticker?symbol=${symbol}`);
    const ticker = await tickerRes.json();
    const precioSalida = parseFloat(ticker.price);
    const pnl = parseFloat(posicion.unRealizedProfit);
    registrarOperacionReal(symbol, sideActual, precioEntrada, precioSalida, cantidad, pnl);
    document.getElementById('estado').textContent = `CloseOperation ${symbol} exitosa`;

    // Enviar alerta por Telegram
    const emoji = pnl >= 0 ? '✅' : '❌';
    const ganancia = Math.abs(pnl).toFixed(2);
    const tipo = pnl >= 0 ? 'Ganancia' : 'Pérdida';
    const mensajeCierre = `${emoji} Posición cerrada\nSímbolo: ${symbol}\nPnL: ${pnl >= 0 ? '+' : ''}${ganancia} USDT\n(${tipo})`;
    enviarMensajeTelegram(mensajeCierre);

    await actualizarPosicionesAbiertas();
  } catch (err) {
    console.error('Error al cerrar posición:', err);
    alert('Error al cerrar: ' + err.message);
    document.getElementById('estado').textContent = `❌ Error: ${err.message}`;
  }
}

function cerrarTodas() {
  alert('Función "Cerrar todas" aún no implementada.');
}

function operacionPrueba() {
  if (!modelo) {
    alert('Primero entrena la red neuronal');
    return;
  }
  const porcentajeTexto = document.getElementById('prediccion-porcentaje').textContent;
  if (porcentajeTexto === '—' || porcentajeTexto === '0%') {
    alert('No hay predicción válida');
    return;
  }
  const direccionTexto = document.getElementById('prediccion-direccion').textContent;
  const side = direccionTexto.includes('SUBIDA') ? 'BUY' : 'SELL';
  abrirPosicionReal(side);
}

async function iniciarStreaming() {
  if (streamingInterval) {
    console.warn('⚠️ Streaming ya está activo');
    return;
  }
  if (!modelo) {
    alert('Primero entrena la red neuronal');
    document.getElementById('estado').textContent = '❌ Modelo no entrenado';
    return;
  }
  simboloActual = document.getElementById('simbolo').value.toUpperCase();
  let fundingRate = 0;
  try { fundingRate = await obtenerFundingRate(simboloActual); } catch (err) { console.warn("⚠️ Funding Rate no disponible"); }
  let openInterest = 0;
  try { openInterest = await obtenerOpenInterest(simboloActual); } catch (err) { console.warn("⚠️ Open Interest no disponible"); }
  try {
    let klines = await obtenerDatos(simboloActual, '1m', 50);
    precios = klines.map(k => k.close);
    ultimoPrecio = klines[klines.length - 1].close;
    if (!dataSeries) {
      console.error('⚠️ dataSeries no inicializado');
      return;
    }
    dataSeries.setData(klines);
    actualizarPanelFinanciero();
    streamingInterval = setInterval(async () => {
      try {
        const tickerRes = await fetch(`/api/binance/ticker?symbol=${simboloActual}`);
        if (!tickerRes.ok) throw new Error('Binance API error');
        const ticker = await tickerRes.json();
        const precioActual = parseFloat(ticker.price);
        if (isNaN(precioActual) || precioActual <= 0) return;
        ultimoPrecio = precioActual;
        const ahora = Math.floor(Date.now() / 1000);
        const ultimaVela = klines[klines.length - 1];
        let timeVela = typeof ultimaVela.time === 'number' ? ultimaVela.time : ahora - 30;
        if (ahora - timeVela >= 60) {
          const nuevaVela = {
            time: ahora,
            open: ultimaVela.close,
            high: Math.max(ultimaVela.close, ultimoPrecio),
            low: Math.min(ultimaVela.close, ultimoPrecio),
            close: ultimoPrecio,
            volume: 0
          };
          klines.push(nuevaVela);
          precios.push(ultimoPrecio);
          dataSeries.update(nuevaVela);
        } else {
          const velaActualizada = {
            time: timeVela,
            open: ultimaVela.open,
            high: Math.max(ultimaVela.high, ultimoPrecio),
            low: Math.min(ultimaVela.low, ultimoPrecio),
            close: ultimoPrecio,
            volume: ultimaVela.volume
          };
          klines[klines.length - 1] = velaActualizada;
          dataSeries.update(velaActualizada);
        }
        // Predicción
        let prediccionRaw = null;
        let confianza = 0;
        let direccion = '';
        if (precios.length >= 30) {
          const closes = precios;
          const ultimos10Precios = closes.slice(-10);
          const ultimos10Volumenes = klines.slice(-10).map(k => k.volume);
          const rsi = calcularRSI(closes, 14);
          const ema = calcularEMA(closes, 20);
          const { macdLine, signalLine } = calcularMACD(closes, 12, 26, 9);
          const { media: bbMedia, superior: bbSuperior, inferior: bbInferior } = calcularBandasBollinger(closes, 20, 2);
          const atr = calcularATR(klines, 14);
          const obv = calcularOBV(klines);
          const rsiActual = rsi[rsi.length - 1] || 50;
          const emaActual = ema[ema.length - 1] || ultimoPrecio;
          const macdActual = macdLine[macdLine.length - 1] || 0;
          const signalActual = signalLine[signalLine.length - 1] || 0;
          const bbMedio = bbMedia[bbMedia.length - 1] || ultimoPrecio;
          const bbSup = bbSuperior[bbSuperior.length - 1] || ultimoPrecio;
          const bbInf = bbInferior[bbInferior.length - 1] || ultimoPrecio;
          const anchoBB = bbSup - bbInf;
          const posicionBB = anchoBB > 0 ? (ultimoPrecio - bbInf) / anchoBB : 0.5;
          const atrActual = atr[atr.length - 1] || 0;
          const obvActual = obv[obv.length - 1] || 0;
          prediccionRaw = await predecir(
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
            ultimoPrecio,
            fundingRate,
            openInterest
          );
          if (prediccionRaw == null || isNaN(prediccionRaw)) {
            document.getElementById('prediccion-direccion').textContent = '—';
            document.getElementById('prediccion-porcentaje').textContent = '—';
            document.getElementById('prediccion-progreso').style.width = '0%';
          } else {
            confianza = prediccionRaw > 0.5 ? prediccionRaw : 1 - prediccionRaw;
            direccion = prediccionRaw > 0.5 ? 'SUBIDA' : 'BAJADA';
            const porcentaje = Math.round(confianza * 100);
            const emoji = direccion === 'SUBIDA' ? '🟢' : '🔴';
            const color = porcentaje > 55 ? (direccion === 'SUBIDA' ? '#26a69a' : '#ef5350') : '#666';
            document.getElementById('prediccion-direccion').innerHTML = `${emoji} ${direccion}`;
            document.getElementById('prediccion-porcentaje').textContent = `${porcentaje}%`;
            document.getElementById('prediccion-progreso').style.width = `${porcentaje}%`;
            document.getElementById('prediccion-progreso').style.backgroundColor = color;
          }
        }
        // === AUTO-TRADING ===
        const autoTrading = document.getElementById('auto-trading')?.checked || false;
        if (!autoTrading) return;
        const posResponse = await fetch('/api/binance/futures/positions');
        if (!posResponse.ok) return;
        const posiciones = await posResponse.json();
        const posicionActual = Array.isArray(posiciones) 
          ? posiciones.find(p => p.symbol === simboloActual && Math.abs(parseFloat(p.positionAmt)) > 0.0001)
          : null;
        if (posicionActual) {
          const size = parseFloat(posicionActual.positionAmt);
          const entryPrice = parseFloat(posicionActual.entryPrice);
          const markPrice = parseFloat(posicionActual.markPrice);
          const leverage = parseFloat(posicionActual.leverage);
          const esLong = size > 0;
          // Calcular ATR en tiempo real
          let atrActual = 0;
          try {
            const klines5m = await obtenerDatos(simboloActual, '5m', 50);
            if (klines5m.length >= 20) {
              const atrArray = calcularATR(klines5m, 14);
              atrActual = atrArray[atrArray.length - 1] || 0;
            }
          } catch (e) {
            console.warn("⚠️ Usando ATR de 1m como respaldo");
            const klinesATR = klines.slice(-50);
            const atrArray = calcularATR(klinesATR, 14);
            atrActual = atrArray[atrArray.length - 1] || 0;
          }
          // Leer múltiplos desde el dashboard
          const multiploTPEl = document.getElementById('multiploTP');
          const multiploSLEl = document.getElementById('multiploSL');
          const multiploTP = multiploTPEl ? parseFloat(multiploTPEl.value) || 4 : 4;
          const multiploSL = multiploSLEl ? parseFloat(multiploSLEl.value) || 2 : 2;
          // TP/SL dinámico con múltiplos ajustables
          const slDinamico = atrActual * multiploSL;
          const tpDinamico = atrActual * multiploTP;
          const stopLossPct = (slDinamico / entryPrice) * 100;
          const takeProfitPct = (tpDinamico / entryPrice) * 100;
          // Mostrar en dashboard
          const tpEl = document.getElementById('tp-dinamico');
          const slEl = document.getElementById('sl-dinamico');
          const atrEl = document.getElementById('atr-valor');
          if (tpEl) tpEl.textContent = `TP: ${takeProfitPct.toFixed(2)}%`;
          if (slEl) slEl.textContent = `SL: ${stopLossPct.toFixed(2)}%`;
          if (atrEl) atrEl.textContent = `ATR: ${atrActual.toFixed(2)}`;
          const roePct = ((markPrice - entryPrice) / entryPrice) * leverage * (esLong ? 1 : -1) * 100;
          let debeCerrarPorTPSL = false;
          if (roePct >= takeProfitPct) {
            debeCerrarPorTPSL = true;
            console.log(`🎯 Take-Profit (${roePct.toFixed(2)}% ≥ ${takeProfitPct.toFixed(2)}%) → Cerrando`);
          } else if (roePct <= -stopLossPct) {
            debeCerrarPorTPSL = true;
            console.log(`🎯 Stop-Loss (${roePct.toFixed(2)}% ≤ -${stopLossPct.toFixed(2)}%) → Cerrando`);
          }
          if (debeCerrarPorTPSL) {
            cerrarPosicion(simboloActual, posicionActual.positionSide);
          }
        } else {
          if (prediccionRaw != null && !isNaN(prediccionRaw) && confianza >= 0.60) {
            const closesEMA = precios;
            const ema20 = calcularEMA(closesEMA, 20);
            const ema50 = calcularEMA(closesEMA, 50);
            const ema20Actual = ema20[ema20.length - 1];
            const ema50Actual = ema50[ema50.length - 1];
            const esTendenciaAlcista = ema20Actual > ema50Actual;
            const esTendenciaBajista = ema20Actual < ema50Actual;
            const side = prediccionRaw > 0.5 ? 'BUY' : 'SELL';
            let debeOperar = false;
            if (side === 'BUY' && esTendenciaAlcista) debeOperar = true;
            else if (side === 'SELL' && esTendenciaBajista) debeOperar = true;
            if (debeOperar) {
              console.log(`🤖 Auto-trading: abriendo ${side} en ${simboloActual} (confianza: ${(confianza * 100).toFixed(1)}%)`);
              abrirPosicionReal(side);
            }
          }
        }
      } catch (err) {
        console.error('Error en streaming:', err);
      }
    }, 10000);
  } catch (err) {
    console.error('Error al iniciar streaming:', err);
    document.getElementById('estado').textContent = `❌ Error: ${err.message}`;
  }
}

async function detenerStreaming() {
  if (streamingInterval) {
    clearInterval(streamingInterval);
    streamingInterval = null;
  }
  document.getElementById('estado').textContent = '⏹️ Streaming detenido';
}

// === BACKTESTING ===
async function obtenerDatosBacktesting(symbol = 'BTCUSDT', interval = '15m', days = 30) {
  const minutosPorDia = 1440;
  let velasPorDia;
  if (interval === '1m') velasPorDia = 1440;
  else if (interval === '5m') velasPorDia = 288;
  else if (interval === '15m') velasPorDia = 96;
  else if (interval === '1h') velasPorDia = 24;
  else if (interval === '4h') velasPorDia = 6;
  else velasPorDia = 24;
  const limit = Math.min(1500, days * velasPorDia);
  const res = await fetch(`/api/binance/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Error al obtener datos: ${res.status}`);
  const klinesRaw = await res.json();
  return klinesRaw.map(k => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5])
  }));
}

async function ejecutarBacktesting() {
  const simbolo = document.getElementById('bt-simbolo').value.toUpperCase();
  const intervalo = document.getElementById('bt-intervalo').value;
  const dias = parseInt(document.getElementById('bt-dias').value);
  document.getElementById('bt-estado').textContent = 'Descargando datos...';
  try {
    const klines = await obtenerDatosBacktesting(simbolo, intervalo, dias);
    document.getElementById('bt-estado').textContent = `Simulando ${klines.length} velas...`;
    const resultados = simularTrading(klines);
    document.getElementById('bt-operaciones').textContent = resultados.operaciones;
    document.getElementById('bt-winrate').textContent = `${resultados.winRate.toFixed(2)}%`;
    document.getElementById('bt-roetotal').textContent = `${resultados.roeTotal.toFixed(2)}%`;
    document.getElementById('bt-resultados').style.display = 'block';
    document.getElementById('bt-estado').textContent = '✅ Simulación completada';
  } catch (err) {
    console.error('Error en backtesting:', err);
    document.getElementById('bt-estado').textContent = `❌ Error: ${err.message}`;
  }
}

function simularTrading(klines) {
  if (klines.length < 30) {
    throw new Error("No hay suficientes datos para simular");
  }
  let operaciones = [];
  let capital = 1000;
  let posicionAbierta = null;
  let maxEquity = capital;
  let drawdownMax = 0;
  for (let i = 30; i < klines.length; i++) {
    const closes = klines.slice(0, i).map(k => k.close);
    const ultimos10Precios = closes.slice(-10);
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
    const features = [
      ...ultimos10Precios.map((p, idx) => idx === 0 ? 0 : (p - ultimos10Precios[idx - 1]) / ultimos10Precios[idx - 1]),
      0,
      rsiActual / 100,
      closes[closes.length - 1] > emaActual ? 1 : 0,
      rsiActual > 70 ? 1 : 0,
      rsiActual < 30 ? 1 : 0,
      macdActual / 1000,
      signalActual / 1000,
      (macdActual - signalActual) / 1000,
      posicionBB,
      anchoBB / closes[closes.length - 1],
      atrActual / closes[closes.length - 1],
      obvActual / 1e9,
      0
    ];
    const prediccionRaw = Math.random() > 0.45 ? 0.6 : 0.4; // Simulación simple
    const confianza = prediccionRaw > 0.5 ? prediccionRaw : 1 - prediccionRaw;
    const direccion = prediccionRaw > 0.5 ? 'SUBIDA' : 'BAJADA';
    const precioActual = klines[i].close;
    const leverage = 10;
    const takeProfit = 0.05;
    const stopLoss = 0.03;
    if (posicionAbierta) {
      const roePct = ((precioActual - posicionAbierta.precioEntrada) / posicionAbierta.precioEntrada) * leverage * (posicionAbierta.esLong ? 1 : -1) * 100;
      if (roePct >= takeProfit * 100 || roePct <= -stopLoss * 100) {
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
  if (posicionAbierta) {
    const precioFinal = klines[klines.length - 1].close;
    const ganancia = ((precioFinal - posicionAbierta.precioEntrada) / posicionAbierta.precioEntrada) * posicionAbierta.montoInvertido * 10;
    operaciones.push({ ganancia, resultado: ganancia >= 0 ? 'GANANCIA' : 'PÉRDIDA' });
    capital += ganancia;
  }
  const ganancias = operaciones.filter(o => o.ganancia > 0).length;
  const winRate = operaciones.length > 0 ? (ganancias / operaciones.length) * 100 : 0;
  const roeTotal = ((capital - 1000) / 1000) * 100;
  return {
    operaciones: operaciones.length,
    winRate,
    roeTotal
  };
}

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

// === ACTUALIZAR CAPITAL DE TESTNET ===
async function actualizarCapitalTestnet() {
  try {
    const response = await fetch('/api/binance/futures/account');
    if (!response.ok) return;
    const data = await response.json();
    let saldoUSDT = 0;
    if (data.availableBalance !== undefined) {
      saldoUSDT = parseFloat(data.availableBalance) || 0;
    } else if (data.assets && Array.isArray(data.assets)) {
      const usdtAsset = data.assets.find(a => a.asset === 'USDT');
      saldoUSDT = usdtAsset ? parseFloat(usdtAsset.walletBalance) || 0 : 0;
    }
    const tickerRes = await fetch('/api/binance/ticker?symbol=BTCUSDT');
    const ticker = await tickerRes.json();
    const precioBTC = parseFloat(ticker.price) || 1;
    const saldoBTC = saldoUSDT / precioBTC;
    const montoCompraEl = document.getElementById('montoCompra');
    const montoInvertir = montoCompraEl ? parseFloat(montoCompraEl.value) || 10 : 10;
    const saldoUsdtEl = document.getElementById('saldo-usdt');
    const saldoBtcEl = document.getElementById('saldo-btc');
    const montoInvertirEl = document.getElementById('monto-invertir');
    if (saldoUsdtEl) saldoUsdtEl.textContent = `$${saldoUSDT.toFixed(2)}`;
    if (saldoBtcEl) saldoBtcEl.textContent = `${saldoBTC.toFixed(6)}`;
    if (montoInvertirEl) montoInvertirEl.textContent = `$${montoInvertir.toFixed(2)}`;
  } catch (err) {
    console.error("❌ Error en actualizarCapitalTestnet:", err);
  }
}

// === INICIALIZACIÓN ===
window.onload = () => {
  initChart();
  const capitalEl = document.getElementById('capital');
  const maxOpEl = document.getElementById('maxOperaciones');
  const tpEl = document.getElementById('takeProfit');
  const slEl = document.getElementById('stopLoss');
  const simboloEl = document.getElementById('simbolo');
  capitalInicial = parseFloat(capitalEl.value) || 1000;
  maxOperaciones = parseInt(maxOpEl.value) || 3;
  takeProfitPct = parseFloat(tpEl.value) || 5.0;
  stopLossPct = parseFloat(slEl.value) || 3.0;
  simboloActual = simboloEl.value.toUpperCase() || 'BTCUSDT';
  capitalActual = capitalInicial;
  document.getElementById('btn-reiniciar')?.addEventListener('click', reiniciarCapital);
  document.getElementById('btn-exportar')?.addEventListener('click', exportarCSV);
  window.entrenarRed = entrenarRed;
  window.iniciarStreaming = iniciarStreaming;
  window.detenerStreaming = detenerStreaming;
  window.operacionPrueba = operacionPrueba;
  window.cerrarPosicion = cerrarPosicion;
  window.cerrarTodas = cerrarTodas;
  window.abrirLong = () => abrirPosicionReal('BUY');
  window.abrirShort = () => abrirPosicionReal('SELL');
  setInterval(actualizarPosicionesAbiertas, 10000);
  actualizarCapitalTestnet();
  setInterval(actualizarCapitalTestnet, 60000);
  const historialGuardado = JSON.parse(localStorage.getItem('historialOperaciones') || '[]');
  if (historialGuardado.length > 0) {
    operaciones = historialGuardado;
    actualizarPanelFinanciero();
    renderizarHistorial();
  }
};