// controlador_operaciones.js
// Asegúrate de que este script se cargue DESPUÉS de tu HTML y del script principal

let verificadorInterval = null;
let controladorActivo = false;

function leerParametrosUI() {
  const objetivoExitosas = parseFloat(document.getElementById('objetivo-ops-exitosas')?.value) || 0;
  const limiteTotales = parseFloat(document.getElementById('limite-ops-totales')?.value) || 0;
  const stopLossCapital = parseFloat(document.getElementById('stop-loss-capital')?.value) || 0;
  const stopLossDrawdown = parseFloat(document.getElementById('stop-loss-drawdown')?.value) || 0;

  const limiteCapitalAbs = Math.abs(stopLossCapital);
  const limiteDrawdownAbs = Math.abs(stopLossDrawdown);

  return {
    objetivoExitosas: objetivoExitosas >= 0 ? objetivoExitosas : 0,
    limiteTotales: limiteTotales >= 0 ? limiteTotales : 0,
    limiteCapital: limiteCapitalAbs,
    limiteDrawdown: limiteDrawdownAbs
  };
}

function verificarYControlar() {
  if (!controladorActivo) {
    // console.log("[Controlador] Inactivo, no verifica.");
    return;
  }

  const params = leerParametrosUI();

  // [Corrección] Verificar que window.operaciones exista y sea un array
  if (!window.operaciones || !Array.isArray(window.operaciones)) {
      console.error("[Controlador] window.operaciones no es un array válido:", window.operaciones);
      detenerControlador(); // Detener si el estado es inválido
      return;
  }

  const totalOperacionesAhora = window.operaciones.length;
  // [Corrección] Contar operaciones exitosas usando la propiedad correcta ('ganancia')
  const operacionesExitosasAhora = window.operaciones.filter(op => op.ganancia > 0).length;

  // [Corrección] Leer capital inicial y actual, con fallbacks
  const capitalInicial = window.capitalInicial || 1000;
  const capitalActual = window.capitalActual !== undefined ? window.capitalActual : capitalInicial; // Usar capitalActual si está definido, sino, capitalInicial como fallback

  console.log(`[Controlador] OpsTot: ${totalOperacionesAhora}/${params.limiteTotales}, OpsExit: ${operacionesExitosasAhora}/${params.objetivoExitosas}, Capital: $${capitalActual.toFixed(2)}`); // Log para depuración

  // Condición 1: Objetivo de operaciones exitosas alcanzado (si está activo)
  if (params.objetivoExitosas > 0 && operacionesExitosasAhora >= params.objetivoExitosas) {
    console.log(`✅ Objetivo de ${params.objetivoExitosas} operaciones exitosas alcanzado (${operacionesExitosasAhora}). Deteniendo sistema...`);
    if (typeof window.detenerTradingAutomatico === 'function') {
      window.detenerTradingAutomatico();
    } else {
      console.error("Función detenerTradingAutomatico no encontrada en el script principal.");
    }
    detenerControlador();
    return;
  }

  // Condición 2: Límite de operaciones totales alcanzado (si está activo)
  if (params.limiteTotales > 0 && totalOperacionesAhora >= params.limiteTotales) {
    console.log(`⚠️ Límite de ${params.limiteTotales} operaciones totales alcanzado (${totalOperacionesAhora}). Deteniendo sistema...`);
    if (typeof window.detenerTradingAutomatico === 'function') {
      window.detenerTradingAutomatico();
    } else {
      console.error("Función detenerTradingAutomatico no encontrada en el script principal.");
    }
    detenerControlador();
    return;
  }

  // Condición 3: Stop Loss de Capital alcanzado (si está activo)
  if (params.limiteCapital > 0) {
    const perdidaCapital = capitalInicial - capitalActual; // Si capitalActual < capitalInicial, perdida es positiva
    if (perdidaCapital >= params.limiteCapital) {
      console.log(`🚨 Stop Loss de Capital alcanzado: -$${perdidaCapital.toFixed(2)} (Límite: $${params.limiteCapital}). Deteniendo sistema...`);
      if (typeof window.detenerTradingAutomatico === 'function') {
        window.detenerTradingAutomatico();
      } else {
        console.error("Función detenerTradingAutomatico no encontrada en el script principal.");
      }
      detenerControlador();
      return;
    }
  }

  // Condición 4: Stop Loss de Drawdown alcanzado (si está activo)
  if (params.limiteDrawdown > 0) {
    const drawdownPct = ((capitalInicial - capitalActual) / capitalInicial) * 100; // Si capitalActual < capitalInicial, drawdownPct es positivo
    if (drawdownPct >= params.limiteDrawdown) {
      console.log(`🚨 Stop Loss de Drawdown alcanzado: -${drawdownPct.toFixed(2)}% (Límite: -${params.limiteDrawdown}%). Deteniendo sistema...`);
      if (typeof window.detenerTradingAutomatico === 'function') {
        window.detenerTradingAutomatico();
      } else {
        console.error("Función detenerTradingAutomatico no encontrada en el script principal.");
      }
      detenerControlador();
      return;
    }
  }

  // console.log(`[Controlador] Verificación OK.`);
}

function iniciarControlador() {
  if (controladorActivo) {
    console.warn("[Controlador] Ya está activo.");
    return;
  }
  controladorActivo = true;
  console.log("[Controlador] Activado.");
  document.getElementById('toggle-controlador').textContent = 'Desactivar Control';
  if (!verificadorInterval) {
    verificadorInterval = setInterval(verificarYControlar, 10000); // Cada 10 segundos
  }
}

function detenerControlador() {
  if (!controladorActivo) {
    console.warn("[Controlador] Ya está detenido.");
    return;
  }
  controladorActivo = false;
  console.log("[Controlador] Desactivado.");
  document.getElementById('toggle-controlador').textContent = 'Activar Control';
  if (verificadorInterval) {
    clearInterval(verificadorInterval);
    verificadorInterval = null;
  }
}

document.getElementById('toggle-controlador').addEventListener('click', function() {
  if (controladorActivo) {
    detenerControlador();
  } else {
    iniciarControlador();
  }
});

document.getElementById('toggle-controlador').textContent = controladorActivo ? 'Desactivar Control' : 'Activar Control';
