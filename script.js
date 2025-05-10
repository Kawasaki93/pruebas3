if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log("Service Worker registrado", reg);
    }).catch((err) => {
      console.error("Error al registrar el Service Worker", err);
    });
  });
}

// Variables globales
let totalEfectivo = 0;
let totalTarjeta = 0;
let db = null;
let isOnline = navigator.onLine;
let syncQueue = new Map();
let lastSyncTime = null;
let hamacasListener = null;
let pagosListener = null;
let serverStatus = {
  isConnected: false,
  lastCheck: null,
  connectionAttempts: 0,
  lastError: null
};

// Funciones para Firebase
const FirebaseService = {
  // Verificar estado del servidor con diagnóstico
  async verificarEstadoServidor() {
    try {
      console.log('Iniciando diagnóstico del servidor...');
      
      // Verificar si Firebase está disponible
      if (typeof firebase === 'undefined') {
        throw new Error('Firebase no está disponible');
      }

      // Verificar si la instancia de Firestore existe
      if (!db) {
        console.log('Reinicializando Firestore...');
        db = firebase.firestore();
      }

      // Intentar una operación simple de lectura con timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout al conectar con el servidor')), 5000)
      );

      const testDoc = await Promise.race([
        db.collection('hamacas').limit(1).get(),
        timeoutPromise
      ]);
      
      serverStatus.isConnected = true;
      serverStatus.lastCheck = new Date();
      serverStatus.connectionAttempts = 0;
      serverStatus.lastError = null;
      
      // Actualizar UI con el estado
      this.actualizarEstadoConexion(true, 'Servidor Conectado');
      
      console.log('Diagnóstico completado: Servidor conectado y funcionando correctamente');
      return true;
    } catch (error) {
      console.error('Error en diagnóstico del servidor:', error);
      serverStatus.isConnected = false;
      serverStatus.lastError = error.message;
      serverStatus.connectionAttempts++;
      
      // Actualizar UI con el estado y el error
      this.actualizarEstadoConexion(false, `Error: ${error.message}`);
      
      // Reintentar después de un error con backoff exponencial
      if (serverStatus.connectionAttempts < 5) {
        const delay = Math.min(1000 * Math.pow(2, serverStatus.connectionAttempts), 30000);
        console.log(`Reintentando conexión en ${delay/1000} segundos...`);
        setTimeout(() => this.verificarEstadoServidor(), delay);
      } else {
        console.error('Número máximo de intentos alcanzado');
        this.mostrarDialogoReconexion();
      }
      
      return false;
    }
  },

  // Mostrar diálogo de reconexión
  mostrarDialogoReconexion() {
    const dialog = document.createElement('div');
    dialog.style.position = 'fixed';
    dialog.style.top = '50%';
    dialog.style.left = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
    dialog.style.backgroundColor = 'white';
    dialog.style.padding = '20px';
    dialog.style.borderRadius = '5px';
    dialog.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
    dialog.style.zIndex = '1000';
    dialog.innerHTML = `
      <h3>Problema de Conexión</h3>
      <p>No se pudo conectar con el servidor después de varios intentos.</p>
      <p>Último error: ${serverStatus.lastError}</p>
      <button id="reconectarBtn" style="margin: 10px; padding: 5px 10px;">Reintentar Conexión</button>
      <button id="recargarBtn" style="margin: 10px; padding: 5px 10px;">Recargar Página</button>
    `;
    document.body.appendChild(dialog);

    document.getElementById('reconectarBtn').onclick = () => {
      document.body.removeChild(dialog);
      serverStatus.connectionAttempts = 0;
      this.verificarEstadoServidor();
    };

    document.getElementById('recargarBtn').onclick = () => {
      window.location.reload();
    };
  },

  // Actualizar UI con el estado de la conexión
  actualizarEstadoConexion(conectado, mensaje) {
    const statusElement = document.getElementById('serverStatus');
    if (!statusElement) {
      const div = document.createElement('div');
      div.id = 'serverStatus';
      div.style.position = 'fixed';
      div.style.top = '10px';
      div.style.right = '10px';
      div.style.padding = '10px';
      div.style.borderRadius = '5px';
      div.style.zIndex = '1000';
      div.style.transition = 'all 0.3s ease';
      document.body.appendChild(div);
    }

    const element = document.getElementById('serverStatus');
    if (conectado) {
      element.style.backgroundColor = '#4CAF50';
      element.style.color = 'white';
    } else {
      element.style.backgroundColor = '#f44336';
      element.style.color = 'white';
    }
    element.textContent = mensaje;
  },

  // Inicializar Firebase con mejor manejo de errores
  async inicializar() {
    try {
      console.log('Iniciando Firebase...');
      
      if (typeof firebase === 'undefined') {
        throw new Error('Firebase no está disponible');
      }

      // Inicializar Firebase si no está inicializado
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
        console.log('Firebase inicializado correctamente');
      }

      // Obtener la instancia de Firestore
      db = firebase.firestore();
      console.log('Firestore inicializado correctamente');
      
      // Configurar persistencia offline
      try {
        await db.enablePersistence({
          synchronizeTabs: true
        });
        console.log('Persistencia offline habilitada');
      } catch (err) {
        console.warn('Advertencia de persistencia:', err);
      }

      // Configurar Firestore para mejor rendimiento
      db.settings({
        cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED,
        merge: true,
        experimentalForceLongPolling: true,
        experimentalAutoDetectLongPolling: true
      });

      // Verificar estado inicial del servidor
      await this.verificarEstadoServidor();

      // Configurar verificación periódica del servidor
      setInterval(() => this.verificarEstadoServidor(), 30000);

      // Configurar listeners de estado de red
      this.setupNetworkListeners();
      
      // Cargar datos locales
      await this.cargarDatosLocales();
      
      // Iniciar listeners
      await this.init();
      
      return true;
    } catch (error) {
      console.error('Error al inicializar Firebase:', error);
      this.actualizarEstadoConexion(false, `Error de inicialización: ${error.message}`);
      return false;
    }
  },

  // Configurar listeners de estado de red
  setupNetworkListeners() {
    window.addEventListener('online', () => {
      console.log('Conexión restaurada');
      isOnline = true;
      this.verificarEstadoServidor();
      this.syncPendingChanges();
      this.reiniciarListeners();
    });

    window.addEventListener('offline', () => {
      console.log('Conexión perdida');
      isOnline = false;
      this.actualizarEstadoConexion(false, 'Servidor Desconectado');
    });
  },

  // Reiniciar listeners
  async reiniciarListeners() {
    if (hamacasListener) {
      hamacasListener();
    }
    if (pagosListener) {
      pagosListener();
    }
    await this.init();
  },

  // Cargar datos locales
  async cargarDatosLocales() {
    console.log('Cargando datos locales...');
    
    // Cargar estado de hamacas
    const hamacasLocales = JSON.parse(localStorage.getItem('hamacas') || '{}');
    for (const [id, datos] of Object.entries(hamacasLocales)) {
      const hamaca = document.querySelector(`#${id}`);
      if (hamaca) {
        // Actualizar UI
        if (datos.step) {
          for (let i = 1; i <= 6; i++) {
            hamaca.classList.remove(`step${i}`);
          }
          if (datos.step > 0) {
            hamaca.classList.add(`step${datos.step}`);
          }
          hamaca.dataset.actualStep = datos.step;
        }
        if (datos.cliente) {
          const inputCliente = hamaca.querySelector('.customer_name');
          if (inputCliente) {
            inputCliente.value = datos.cliente;
          }
        }
      }
    }

    // Cargar totales
    totalEfectivo = parseFloat(localStorage.getItem('totalEfectivo') || '0');
    totalTarjeta = parseFloat(localStorage.getItem('totalTarjeta') || '0');
    this.actualizarUI();
  },

  // Actualizar UI con los totales
  actualizarUI() {
    document.getElementById('totalEfectivo').textContent = totalEfectivo.toFixed(2);
    document.getElementById('totalTarjeta').textContent = totalTarjeta.toFixed(2);
    document.getElementById('totalGeneral').textContent = (totalEfectivo + totalTarjeta).toFixed(2);
  },

  // Inicializar listeners
  async init() {
    if (!db) {
      console.error('Firestore no está inicializado');
      return;
    }

    console.log('Iniciando listeners de Firebase...');
    
    try {
      // Configurar listener de hamacas
      hamacasListener = db.collection('hamacas')
        .onSnapshot((snapshot) => {
          console.log('Cambios detectados en hamacas:', snapshot.docChanges().length);
          
          snapshot.docChanges().forEach((change) => {
            const datos = change.doc.data();
            const hamacaId = change.doc.id;
            const hamaca = document.querySelector(`#${hamacaId}`);

            if (hamaca) {
              if (change.type === 'added' || change.type === 'modified') {
                // Actualizar UI
                this.actualizarUIHamaca(hamacaId, datos);
                
                // Actualizar localStorage
                const hamacasLocales = JSON.parse(localStorage.getItem('hamacas') || '{}');
                hamacasLocales[hamacaId] = {
                  step: datos.step,
                  cliente: datos.cliente,
                  ultimaActualizacion: datos.ultimaActualizacion
                };
                localStorage.setItem('hamacas', JSON.stringify(hamacasLocales));
              }
            }
          });
        }, (error) => {
          console.error('Error en listener de hamacas:', error);
          setTimeout(() => this.reiniciarListeners(), 5000);
        });

      // Configurar listener de pagos
      pagosListener = db.collection('pagos')
        .orderBy('fecha', 'desc')
        .limit(100)
        .onSnapshot((snapshot) => {
          console.log('Cambios detectados en pagos:', snapshot.docChanges().length);
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const pago = change.doc.data();
              this.actualizarTotales(pago.metodoPago, pago.total);
              this.agregarAlHistorial(
                pago.hamaca,
                pago.total,
                pago.recibido,
                pago.cambio,
                pago.metodoPago
              );
            }
          });
        }, (error) => {
          console.error('Error en listener de pagos:', error);
          setTimeout(() => this.reiniciarListeners(), 5000);
        });

      console.log('Listeners configurados correctamente');
    } catch (error) {
      console.error('Error al configurar listeners:', error);
      throw error;
    }
  },

  // Actualizar UI de una hamaca
  actualizarUIHamaca(hamacaId, datos) {
    const hamaca = document.querySelector(`#${hamacaId}`);
    if (hamaca) {
      if (datos.step !== undefined) {
        for (let i = 1; i <= 6; i++) {
          hamaca.classList.remove(`step${i}`);
        }
        if (datos.step > 0) {
          hamaca.classList.add(`step${datos.step}`);
        }
        hamaca.dataset.actualStep = datos.step;
      }
      if (datos.cliente) {
        const inputCliente = hamaca.querySelector('.customer_name');
        if (inputCliente) {
          inputCliente.value = datos.cliente;
        }
      }
    }
  },

  // Guardar hamaca con verificación de servidor
  async guardarHamaca(hamacaId, datos) {
    try {
      if (!db) {
        throw new Error('Firestore no está inicializado');
      }

      console.log('Guardando hamaca:', hamacaId, datos);
      
      // Verificar estado del servidor antes de guardar
      if (!serverStatus.isConnected) {
        console.log('Servidor no disponible, guardando localmente');
        // Guardar en localStorage
        const hamacasLocales = JSON.parse(localStorage.getItem('hamacas') || '{}');
        hamacasLocales[hamacaId] = {
          ...datos,
          ultimaActualizacion: new Date().toISOString()
        };
        localStorage.setItem('hamacas', JSON.stringify(hamacasLocales));
        
        // Actualizar UI
        this.actualizarUIHamaca(hamacaId, datos);
        return;
      }

      // Preparar datos con timestamp
      const datosCompletos = {
        ...datos,
        ultimaActualizacion: firebase.firestore.FieldValue.serverTimestamp()
      };

      // Guardar en localStorage primero para respuesta inmediata
      const hamacasLocales = JSON.parse(localStorage.getItem('hamacas') || '{}');
      hamacasLocales[hamacaId] = {
        ...datos,
        ultimaActualizacion: new Date().toISOString()
      };
      localStorage.setItem('hamacas', JSON.stringify(hamacasLocales));

      // Actualizar UI inmediatamente
      this.actualizarUIHamaca(hamacaId, datos);

      // Guardar en Firebase
      await db.collection('hamacas').doc(hamacaId).set(datosCompletos, { merge: true });
      console.log('Hamaca guardada en Firebase');
    } catch (error) {
      console.error('Error al guardar hamaca:', error);
      this.actualizarEstadoConexion(false, `Error al guardar hamaca: ${error.message}`);
      throw error;
    }
  },

  // Guardar pago con mejor manejo de sincronización
  async guardarPago(datos) {
    try {
      console.log('Guardando pago:', datos);
      
      // Preparar datos con timestamp
      const datosCompletos = {
        ...datos,
        fecha: firebase.firestore.FieldValue.serverTimestamp()
      };

      // Guardar en localStorage primero
      const pagosLocales = JSON.parse(localStorage.getItem('pagos') || '[]');
      pagosLocales.unshift({
        ...datos,
        fecha: new Date().toISOString()
      });
      localStorage.setItem('pagos', JSON.stringify(pagosLocales));

      // Actualizar UI inmediatamente
      this.actualizarTotales(datos.metodoPago, datos.total);
      this.agregarAlHistorial(
        datos.hamaca,
        datos.total,
        datos.recibido,
        datos.cambio,
        datos.metodoPago
      );

      // Guardar en Firebase si hay conexión
      if (isOnline) {
        await db.collection('pagos').add(datosCompletos);
        console.log('Pago guardado en Firebase');
      } else {
        console.log('Pago guardado localmente, pendiente de sincronización');
      }
    } catch (error) {
      console.error('Error al guardar pago:', error);
      throw error;
    }
  },

  // Actualizar totales
  actualizarTotales(metodo, monto) {
    if (metodo === 'efectivo') {
      totalEfectivo += monto;
    } else {
      totalTarjeta += monto;
    }

    // Guardar en localStorage
    localStorage.setItem('totalEfectivo', totalEfectivo.toString());
    localStorage.setItem('totalTarjeta', totalTarjeta.toString());

    // Actualizar UI
    this.actualizarUI();
  },

  // Agregar al historial
  agregarAlHistorial(hamaca, total, recibido, cambio, metodo) {
    const historial = document.getElementById('historial');
    const li = document.createElement('li');

    const fechaObj = new Date();
    const dia = String(fechaObj.getDate()).padStart(2, '0');
    const mes = String(fechaObj.getMonth() + 1).padStart(2, '0');
    const anio = fechaObj.getFullYear();
    const horas = String(fechaObj.getHours()).padStart(2, '0');
    const minutos = String(fechaObj.getMinutes()).padStart(2, '0');
    const fecha = `${dia}/${mes}/${anio} ${horas}:${minutos}`;

    li.textContent = `Hamaca ${hamaca} - Total: €${total.toFixed(2)} - Recibido: €${recibido.toFixed(2)} - Cambio: €${cambio.toFixed(2)} - Método: ${metodo} - ${fecha}`;
    historial.insertBefore(li, historial.firstChild);

    // Guardar en localStorage
    const historialLocal = JSON.parse(localStorage.getItem('historial') || '[]');
    historialLocal.unshift({
      hamaca,
      total,
      recibido,
      cambio,
      metodo,
      fecha
    });
    localStorage.setItem('historial', JSON.stringify(historialLocal));
  },

  // Sincronizar cambios pendientes con mejor manejo de errores
  async syncPendingChanges() {
    if (!isOnline || syncQueue.size === 0) return;

    console.log('Sincronizando cambios pendientes...');
    const batch = db.batch();
    let batchCount = 0;

    try {
      for (const [docId, changes] of syncQueue) {
        const docRef = db.collection('hamacas').doc(docId);
        batch.set(docRef, changes, { merge: true });
        batchCount++;

        if (batchCount >= 500) {
          await batch.commit();
          batchCount = 0;
        }
      }

      if (batchCount > 0) {
        await batch.commit();
      }

      syncQueue.clear();
      lastSyncTime = new Date();
      localStorage.setItem('lastSyncTime', lastSyncTime.toISOString());
      console.log('Cambios pendientes sincronizados exitosamente');
    } catch (error) {
      console.error('Error al sincronizar cambios pendientes:', error);
      setTimeout(() => this.syncPendingChanges(), 5000);
    }
  }
};

// Inicializar Firebase cuando el documento esté listo
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Documento cargado, iniciando Firebase...');
  try {
    const inicializado = await FirebaseService.inicializar();
    if (!inicializado) {
      console.error('No se pudo inicializar Firebase');
    }
  } catch (error) {
    console.error('Error al cargar la aplicación:', error);
  }
});

let variable1;
for (var x = 1; x < 126; x++) {
  let cloned_element = $(".sunbed").first().clone();
  cloned_element.attr("id", "clon_" + x);

  if (x === 10) {
    cloned_element.find(".sunbed_name").html(82); // Asigna 85 al clon número 10
} else if (x === 9) {
    cloned_element.find(".sunbed_name").html(83); // Asigna 84 al clon número 9
} else if (x === 8) {
    cloned_element.find(".sunbed_name").html(82); // Asigna 83 al clon número 8
} else if (x === 11) {
    cloned_element.find(".sunbed_name").html(81); // Asigna 82 al clon número 11
} else if (x === 12) {
    cloned_element.find(".sunbed_name").html(80); // Asigna 81 al clon número 12
} else if (x === 19) {
    cloned_element.find(".sunbed_name").html(77); // Asigna 80 al clon número 13
} else if (x === 14) {
    cloned_element.find(".sunbed_name").html(79); // Asigna 79 al clon número 14
} else if (x === 20) {
    cloned_element.find(".sunbed_name").html(76); // Asigna 78 al clon número 20
} else if (x === 16 || x === 17 || x === 18) {
    cloned_element.find(".sunbed_name").html("M"); // Cambia el contenido de los clones 17, 18 y 19 a "X"
} else if (x === 21) {
    cloned_element.find(".sunbed_name").html(75); // Asigna 77 al clon número 21
} else if (x === 22) {
    cloned_element.find(".sunbed_name").html(74); // Asigna 76 al clon número 22
} else if (x === 23) {
    cloned_element.find(".sunbed_name").html(73); // Asigna 75 al clon número 23
} else if (x === 24) {
    cloned_element.find(".sunbed_name").html(72); // Asigna 73 al clon número 24
} else if (x === 25) {
    cloned_element.find(".sunbed_name").html(71); // Asigna 72 al clon número 25
} else if (x === 26) {
    cloned_element.find(".sunbed_name").html(70); // Asigna 71 al clon número 26
} else if (x === 27) {
    cloned_element.find(".sunbed_name").html(70); // Asigna 70 al clon número 27
} else if (x === 28) {
    cloned_element.find(".sunbed_name").html("69C"); // Asigna 69C al clon número 28
} else if (x === 29) {
    cloned_element.find(".sunbed_name").html("69B"); // Asigna 69B al clon número 29
} else if (x === 30) {
    cloned_element.find(".sunbed_name").html("69A"); // Asigna 69A al clon número 30
} else if (x === 31) {
    cloned_element.find(".sunbed_name").html(69); // Asigna 69 al clon número 31
} else if (x === 32) {
    cloned_element.find(".sunbed_name").html(68); // Asigna 68 al clon número 32
} else if (x === 33) {
    cloned_element.find(".sunbed_name").html(67); // Asigna 67 al clon número 33
} else if (x === 34) {
    cloned_element.find(".sunbed_name").html(66); // Asigna 66 al clon número 34
} else if (x === 35) {
    cloned_element.find(".sunbed_name").html(65); // Asigna 65 al clon número 35
} else if (x === 36) {
    cloned_element.find(".sunbed_name").html(64); // Asigna 64 al clon número 36
} else if (x === 37) {
    cloned_element.find(".sunbed_name").html(63); // Asigna 63 al clon número 37
} else if (x === 38) {
    cloned_element.find(".sunbed_name").html(62); // Asigna 62 al clon número 38
} else if (x === 39) {
    cloned_element.find(".sunbed_name").html(61); // Asigna 62 al clon número 38
} else if (x === 40) {
    cloned_element.find(".sunbed_name").html(60); // Asigna 62 al clon número 38
} else if (x === 42) {
    cloned_element.find(".sunbed_name").html("59C"); // Asigna 59C al clon número 39
} else if (x === 43) {
    cloned_element.find(".sunbed_name").html("59B"); // Asigna 59B al clon número 40
} else if (x === 44) {
    cloned_element.find(".sunbed_name").html("59A"); // Asigna 59A al clon número 41
}  else if (x === 45) {
    cloned_element.find(".sunbed_name").html(59); // Asigna 59 al clon número 45
} else if (x === 46) {
    cloned_element.find(".sunbed_name").html(58); // Asigna 58 al clon número 46
} else if (x === 47) {
    cloned_element.find(".sunbed_name").html(57); // Asigna 57 al clon número 47
} else if (x === 48) {
    cloned_element.find(".sunbed_name").html(56); // Asigna 56 al clon número 48
}  else if (x === 49) {
    cloned_element.find(".sunbed_name").html(55); // Asigna 55 al clon número 49
} else if (x === 50) {
    cloned_element.find(".sunbed_name").html(54); // Asigna 54 al clon número 50
} else if (x === 51) {
    cloned_element.find(".sunbed_name").html(53); // Asigna 53 al clon número 51
} else if (x === 52) {
    cloned_element.find(".sunbed_name").html(52); // Asigna 52 al clon número 52
} else if (x === 53) {
    cloned_element.find(".sunbed_name").html(51); // Asigna 51 al clon número 53
} else if (x === 54) {
    cloned_element.find(".sunbed_name").html(50); // Asigna 50 al clon número 54
} else if (x === 56) {
    cloned_element.find(".sunbed_name").html("49C");
} else if (x === 57) {
    cloned_element.find(".sunbed_name").html("49B");
} else if (x === 58) {
    cloned_element.find(".sunbed_name").html("49A");
} else if (x === 59) {
    cloned_element.find(".sunbed_name").html(49);
}  else if (x === 60) {
    cloned_element.find(".sunbed_name").html(48);
} else if (x === 61) {
    cloned_element.find(".sunbed_name").html(47);
} else if (x === 62) {
    cloned_element.find(".sunbed_name").html(46);
} else if (x === 63) {
    cloned_element.find(".sunbed_name").html(45);
}else if (x === 64) {
    cloned_element.find(".sunbed_name").html(44);
} else if (x === 65) {
    cloned_element.find(".sunbed_name").html(43);
} else if (x === 66) {
    cloned_element.find(".sunbed_name").html(42);
} else if (x === 67) {
    cloned_element.find(".sunbed_name").html(41);
} else if (x === 68) {
    cloned_element.find(".sunbed_name").html(40);
} else if (x === 70) {
    cloned_element.find(".sunbed_name").html("39C");
} else if (x === 71) {
    cloned_element.find(".sunbed_name").html("39B");
} else if (x === 72) {
    cloned_element.find(".sunbed_name").html("39A");
} else if (x === 73) {
    cloned_element.find(".sunbed_name").html("39");
} else if (x === 74) {
    cloned_element.find(".sunbed_name").html(38);
} else if (x === 75) {
    cloned_element.find(".sunbed_name").html(37);
} else if (x === 76) {
    cloned_element.find(".sunbed_name").html(36);
} else if (x === 77) {
    cloned_element.find(".sunbed_name").html(35);
} else if (x === 78) {
    cloned_element.find(".sunbed_name").html(34);
} else if (x === 79) {
    cloned_element.find(".sunbed_name").html(33);
} else if (x === 80) {
    cloned_element.find(".sunbed_name").html(32);
} else if (x === 81) {
    cloned_element.find(".sunbed_name").html(31);
} else if (x === 82) {
    cloned_element.find(".sunbed_name").html(30);
} else if (x === 84) {
    cloned_element.find(".sunbed_name").html("29C");
} else if (x === 85) {
    cloned_element.find(".sunbed_name").html("29B");
} else if (x === 86) {
    cloned_element.find(".sunbed_name").html("29A");
} else if (x === 87) {
    cloned_element.find(".sunbed_name").html(29);
} else if (x === 88) {
    cloned_element.find(".sunbed_name").html(28);
}  else if (x === 89) {
    cloned_element.find(".sunbed_name").html(27);
} else if (x === 90) {
    cloned_element.find(".sunbed_name").html(26);
} else if (x === 91) {
    cloned_element.find(".sunbed_name").html(25);
} else if (x === 92) {
    cloned_element.find(".sunbed_name").html(24);
} else if (x === 93) {
    cloned_element.find(".sunbed_name").html(23);
} else if (x === 94) {
    cloned_element.find(".sunbed_name").html(22);
} else if (x === 95) {
    cloned_element.find(".sunbed_name").html(21);
}  else if (x === 96) {
    cloned_element.find(".sunbed_name").html(20);
} else if (x === 98) {
    cloned_element.find(".sunbed_name").html("19C");
} else if (x === 99) {
    cloned_element.find(".sunbed_name").html("19B");
} else if (x === 100) {
    cloned_element.find(".sunbed_name").html("19A");
} else if (x === 101) {
    cloned_element.find(".sunbed_name").html(19);
} else if (x === 102) {
    cloned_element.find(".sunbed_name").html(18);
} else if (x === 103) {
    cloned_element.find(".sunbed_name").html(17);
}  else if (x === 104) {
    cloned_element.find(".sunbed_name").html(16);
} else if (x === 105) {
    cloned_element.find(".sunbed_name").html(15);
} else if (x === 106) {
    cloned_element.find(".sunbed_name").html(14);
} else if (x === 107) {
    cloned_element.find(".sunbed_name").html(13);
} else if (x === 108) {
    cloned_element.find(".sunbed_name").html(12);
} else if (x === 109) {
    cloned_element.find(".sunbed_name").html(11);
} else if (x === 110) {
    cloned_element.find(".sunbed_name").html(10);
} else if (x === 111) {
    cloned_element.find(".sunbed_name").html("10A");
}    
  else if (x === 112) {
    cloned_element.find(".sunbed_name").html("9D");
} else if (x === 113) {
    cloned_element.find(".sunbed_name").html("9C");
} else if (x === 114) {
    cloned_element.find(".sunbed_name").html("9B");
} else if (x === 115) {
    cloned_element.find(".sunbed_name").html("9A");
} else if (x === 116) {
    cloned_element.find(".sunbed_name").html(9);
} else if (x === 117) {
    cloned_element.find(".sunbed_name").html(8);
} else if (x === 118) {
    cloned_element.find(".sunbed_name").html(7);
} else if (x === 119) {
    cloned_element.find(".sunbed_name").html(6);
} else if (x === 120) {
    cloned_element.find(".sunbed_name").html(5);
} else if (x === 121) {
    cloned_element.find(".sunbed_name").html(4);
} else if (x === 122) {
    cloned_element.find(".sunbed_name").html(3);
} else if (x === 123) {
    cloned_element.find(".sunbed_name").html(2);
} else if (x === 124) {
    cloned_element.find(".sunbed_name").html(1);
} else if (x === 125) {
    cloned_element.find(".sunbed_name").html(0);
}

  $(".beach_wrapper").append(cloned_element);
}

//CLONES------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
//CLONES COLOR NARANJA
$("#clon_126,#clon_127,#clon_128,#clon_129,#clon_130,#clon_131,#clon_132,#clon_133,#clon_134,#clon_135,#clon_136,#clon_137,#clon_138,#clon_139,#clon_140,#clon_141,#clon_142,#clon_143,#clon_144,#clon_145,#clon_146,#clon_147,#clon_148,#clon_149,#clon_150,#clon_151,#clon_152,#clon_153,#clon_154,#clon_155,#clon_156,#clon_157,#clon_158,#clon_159,#clon_160,#clon_161,#clon_162,#clon_163,#clon_164,#clon_165,#clon_166,#clon_167,#clon_168,#clon_169,#clon_170,#clon_171,#clon_172,#clon_173,#clon_174,#clon_175,#clon_176,#clon_177,#clon_178,#clon_179,#clon_180,#clon_181,#clon_182,#clon_183,#clon_184,#clon_185,#clon_186,#clon_187,#clon_188,#clon_189,#clon_190,#clon_191,#clon_199").addClass('especiales');
//CLONES DESCONECTADOS GENERALES
$("#clon_1,#clon_2,#clon_3,#clon_4,#clon_5,#clon_6,#clon_7,#clon_8,#clon_11,#clon_13,#clon_27,#clon_41,#clon_55,#clon_69,#clon_83,#clon_97").addClass('desconectadosgeneral');
//CLON 10A y CLON 0
$("#clon_111").addClass("clon10A")
$("#clon_125").addClass("clon0")
//CLONES DESCONECTADOS FILA 0
$("#clon_112,#clon_113,#clon_114,#clon_115,#clon_116,#clon_117,#clon_118,#clon_119,#clon_120,#clon_121,#clon_122,#clon_123,#clon_124").addClass("desconectadosFila0");
//CLONES DESCONECTADOS FILA 1
$("#clon_98,#clon_99,#clon_100,#clon_101,#clon_102,#clon_103,#clon_104,#clon_105,#clon_106,#clon_106,#clon_107,#clon_108,#clon_109,#clon_110").addClass("desconectadosFila1");
//CLONES DESCONECTADOS FILA 2
$("#clon_84,#clon_85,#clon_86,#clon_87,#clon_88,#clon_89,#clon_90,#clon_91,#clon_92,#clon_93,#clon_94,#clon_95,#clon_96").addClass("desconectadosFila2");
//CLONES DESCONECTADOS FILA 3
$("#clon_70,#clon_71,#clon_72,#clon_73,#clon_74,#clon_75,#clon_76,#clon_77,#clon_78,#clon_79,#clon_80,#clon_81,#clon_82").addClass("desconectadosFila3");
//CLONES DESCONECTADOS FILA 4
$("#clon_56,#clon_57,#clon_58,#clon_59,#clon_60,#clon_61,#clon_62,#clon_63,#clon_64,#clon_65,#clon_66,#clon_67,#clon_68").addClass("desconectadosFila4");
//CLONES DESCONECTADOS FILA 8
$("#clon_9,#clon_10,#clon_11,#clon_12").addClass("desconectadosfila8");

//FILA ZONA LIBRE EXTRA 1 Y 2
$("#clon_14,#clon_15,#clon_28,#clon_29,#clon_42,#clon_43,#clon_56,#clon_57,#clon_70,#clon_71").addClass("Zonalibre")
$("#clon_84,#clon_85,#clon_98,#clon_99,#clon_112,#clon_113").addClass("Zonalibre2")
//CLONES MAGNETA CARPA
$("#sunbed,#clon_16,#clon_17,#clon_18").addClass('intocables');
//CLONES CON FORMA DE SOMBRILLA RECTANGULO REDONDO
$("#clon_83,#clon_84,#clon_85,#clon_89,#clon_90,#clon_91,#clon_92,#clon_93,#clon_97,#clon_98,#clon_99,#clon_100,#clon_101,#clon_102,#clon_103,#clon_104,#clon_105,#clon_106,#clon_107,#clon_108,#clon_109,#clon_110,#clon_111,#clon_112,#clon_113,#clon_114,#clon_115,#clon_116,#clon_117,#clon_118,#clon_119,#clon_120,#clon_121,#clon_122,#clon_123,#clon_124,#clon_125,#clon_186,#clon_187,#clon_188,#clon_189,#clon_190,#clon_191").addClass('primerafila');
//DE LA 1ª FILA Del 84 al 95.
//DE la 2º FILA del 72 al 83
//DE la 3º FILA DEL 60 AL 70
//DE LA 4º FILA DEL 48 AL 58
//DE LA 5ª FILA DEL 36 AL 46
//DE LA 6ª FILA DEL 24 AL 34
//DE LA 7ª FILA DEL 12 AL 22
//DE LA 8ª FILA DEL 1 AL 10

//Clicking function-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------



//clear localstorage
function clearClick(number) {
    localStorage.clear();
    window.location.reload();
}

//BOTONES PARA OCULTAR FILAS------------------------------------------------------------------------------------------------------------------------------------------------------------------------

//VISIBILIDAD DE LA FILA 8--------------------------------
function toggleDesconectadosFila8() {
    var $desconectadosFila8 = $(".desconectadosfila8");
    var currentVisibility = $desconectadosFila8.css("visibility");

    if (currentVisibility === "hidden") {
        $desconectadosFila8.css("visibility", "visible");
        localStorage.setItem("desconectadosFila8Visibility", "visible");
    } else {
        $desconectadosFila8.css("visibility", "hidden");
        localStorage.setItem("desconectadosFila8Visibility", "hidden");
    }
}

// Al cargar la página, restaurar el estado de visibilidad de FILA 8-------
$(document).ready(function() {
    var storedVisibility = localStorage.getItem("desconectadosFila8Visibility");
    if (storedVisibility === "visible") {
        $(".desconectadosfila8").css("visibility", "visible");
    } else if (storedVisibility === "hidden") {
        $(".desconectadosfila8").css("visibility", "hidden");
    }
});

//VISIBILIDAD DE LA FILA 4--------------------------------------
function toggledesconectadosFila4() {
    var $desconectadosFila4 = $(".desconectadosFila4");
    var currentVisibility = $desconectadosFila4.css("visibility");

    if (currentVisibility === "hidden") {
        $desconectadosFila4.css("visibility", "visible");
        localStorage.setItem("desconectadosFila4Visibility", "visible");
    } else {
        $desconectadosFila4.css("visibility", "hidden");
        localStorage.setItem("desconectadosFila4Visibility", "hidden");
    }
}

// Al cargar la página, restaurar el estado de visibilidad de FILA 4-----
$(document).ready(function() {
    var storedVisibility = localStorage.getItem("desconectadosFila4Visibility");
    if (storedVisibility === "visible") {
        $(".desconectadosFila4").css("visibility", "visible");
    } else if (storedVisibility === "hidden") {
        $(".desconectadosFila4").css("visibility", "hidden");
    }
});

//VISIBILIDAD DE LA FILA 3--------------------------------------
function toggledesconectadosFila3() {
    var $desconectadosFila3 = $(".desconectadosFila3");
    var currentVisibility = $desconectadosFila3.css("visibility");

    if (currentVisibility === "hidden") {
        $desconectadosFila3.css("visibility", "visible");
        localStorage.setItem("desconectadosFila3Visibility", "visible");
    } else {
        $desconectadosFila3.css("visibility", "hidden");
        localStorage.setItem("desconectadosFila3Visibility", "hidden");
    }
}

// Al cargar la página, restaurar el estado de visibilidad de FILA 3-----
$(document).ready(function() {
    var storedVisibility = localStorage.getItem("desconectadosFila3Visibility");
    if (storedVisibility === "visible") {
        $(".desconectadosFila3").css("visibility", "visible");
    } else if (storedVisibility === "hidden") {
        $(".desconectadosFila3").css("visibility", "hidden");
    }
});

//VISIBILIDAD DE LA FILA 2--------------------------------------
function toggledesconectadosFila2() {
    var $desconectadosFila2 = $(".desconectadosFila2");
    var currentVisibility = $desconectadosFila2.css("visibility");

    if (currentVisibility === "hidden") {
        $desconectadosFila2.css("visibility", "visible");
        localStorage.setItem("desconectadosFila2Visibility", "visible");
    } else {
        $desconectadosFila2.css("visibility", "hidden");
        localStorage.setItem("desconectadosFila2Visibility", "hidden");
    }
}

// Al cargar la página, restaurar el estado de visibilidad de FILA 2-----
$(document).ready(function() {
    var storedVisibility = localStorage.getItem("desconectadosFila2Visibility");
    if (storedVisibility === "visible") {
        $(".desconectadosFila2").css("visibility", "visible");
    } else if (storedVisibility === "hidden") {
        $(".desconectadosFila2").css("visibility", "hidden");
    }
});




//VISIBILIDAD DE LA FILA 1-----------------------------------
function toggledesconectadosFila1() {
    var $desconectadosFila1 = $(".desconectadosFila1");
    var currentVisibility = $desconectadosFila1.css("visibility");

    if (currentVisibility === "hidden") {
        $desconectadosFila1.css("visibility", "visible");
        localStorage.setItem("desconectadosFila1Visibility", "visible");
    } else {
        $desconectadosFila1.css("visibility", "hidden");
        localStorage.setItem("desconectadosFila1Visibility", "hidden");
    }
}

// Al cargar la página, restaurar el estado de visibilidad de FILA 1-----
$(document).ready(function() {
    var storedVisibility = localStorage.getItem("desconectadosFila1Visibility");
    if (storedVisibility === "visible") {
        $(".desconectadosFila1").css("visibility", "visible");
    } else if (storedVisibility === "hidden") {
        $(".desconectadosFila1").css("visibility", "hidden");
    }
});

//VISIBILIDAD DE LA FILA 0------------------------------------  -
function toggleDesconectadosFila0() {
    var $desconectadosFila0 = $(".desconectadosFila0");
    var currentVisibility = $desconectadosFila0.css("visibility");

    if (currentVisibility === "hidden") {
        $desconectadosFila0.css("visibility", "visible");
        localStorage.setItem("desconectadosFila0Visibility", "visible");
    } else {
        $desconectadosFila0.css("visibility", "hidden");
        localStorage.setItem("desconectadosFila0Visibility", "hidden");
    }
}

// Al cargar la página, restaurar el estado de visibilidad de FILA 0------
$(document).ready(function() {
    var storedVisibility = localStorage.getItem("desconectadosFila0Visibility");
    if (storedVisibility === "visible") {
        $(".desconectadosFila0").css("visibility", "visible");
    } else if (storedVisibility === "hidden") {
        $(".desconectadosFila0").css("visibility", "hidden");
    }
});

//VISIBILIDAD DE LA ZONA LIBRE 1--------------------------------------  
function toggleZonalibre() {
    var $Zonalibre = $(".Zonalibre");
    var currentVisibility = $Zonalibre.css("visibility");

    if (currentVisibility === "hidden") {
        $Zonalibre.css("visibility", "visible");
        localStorage.setItem("ZonalibreVisibility", "visible");
    } else {
        $Zonalibre.css("visibility", "hidden");
        localStorage.setItem("ZonalibreVisibility", "hidden");
    }
}

// Al cargar la página, restaurar el estado de visibilidad de ZONA LIBRE 1----
$(document).ready(function() {
    var storedVisibility = localStorage.getItem("ZonalibreVisibility");
    if (storedVisibility === "visible") {
        $(".Zonalibre").css("visibility", "visible");
    } else if (storedVisibility === "hidden") {
        $(".Zonalibre").css("visibility", "hidden");
    }
});

//VISIBILIDAD DE LA ZONA LIBRE 2--------------------------------------  
function toggleZonalibre2() {
    var $Zonalibre2 = $(".Zonalibre2");
    var currentVisibility = $Zonalibre2.css("visibility");

    if (currentVisibility === "hidden") {
        $Zonalibre2.css("visibility", "visible");
        localStorage.setItem("Zonalibre2Visibility", "visible");
    } else {
        $Zonalibre2.css("visibility", "hidden");
        localStorage.setItem("Zonalibre2Visibility", "hidden");
    }
}

// Al cargar la página, restaurar el estado de visibilidad de ZONA LIBRE 2----
$(document).ready(function() {
    var storedVisibility = localStorage.getItem("Zonalibre2Visibility");
    if (storedVisibility === "visible") {
        $(".Zonalibre2").css("visibility", "visible");
    } else if (storedVisibility === "hidden") {
        $(".Zonalibre2").css("visibility", "hidden");
    }
});


//VISIBILIDAD DEL CLON 10A--------------------------------------  
function toggleclon10A() {
    var $clon10A = $(".clon10A");
    var currentVisibility = $clon10A.css("visibility");

    if (currentVisibility === "hidden") {
        $clon10A.css("visibility", "visible");
        localStorage.setItem("clon10AVisibility", "visible");
    } else {
        $clon10A.css("visibility", "hidden");
        localStorage.setItem("clon10AVisibility", "hidden");
    }
}

// Al cargar la página, restaurar el estado de visibilidad del CLON 10A----
$(document).ready(function() {
    var storedVisibility = localStorage.getItem("clon10AVisibility");
    if (storedVisibility === "visible") {
        $(".clon10A").css("visibility", "visible");
    } else if (storedVisibility === "hidden") {
        $(".clon10A").css("visibility", "hidden");
    }
});

//VISIBILIDAD DEL CLON 0--------------------------------------  
function toggleclon0() {
    var $clon0 = $(".clon0");
    var currentVisibility = $clon0.css("visibility");

    if (currentVisibility === "hidden") {
        $clon0.css("visibility", "visible");
        localStorage.setItem("clon0Visibility", "visible");
    } else {
        $clon0.css("visibility", "hidden");
        localStorage.setItem("clon0Visibility", "hidden");
    }
}

// Al cargar la página, restaurar el estado de visibilidad del CLON 0----
$(document).ready(function() {
    var storedVisibility = localStorage.getItem("clon0Visibility");
    if (storedVisibility === "visible") {
        $(".clon0").css("visibility", "visible");
    } else if (storedVisibility === "hidden") {
        $(".clon0").css("visibility", "hidden");
    }
});

//VISIBILIDAD DE LOS CIRCULOS---------------

  // Variable para controlar la visibilidad de los círculos
  let circlesVisible = true;

  // Comprobar el estado guardado en localStorage al cargar la página
  window.onload = function() {
    // Verificamos si hay un estado guardado en localStorage
    const savedState = localStorage.getItem('circlesVisible');
    if (savedState !== null) {
      circlesVisible = savedState === 'true'; // Convertirlo a un valor booleano
    }

    // Actualizar la visibilidad de los círculos según el estado guardado
    const circles = document.querySelectorAll('.circle');
    circles.forEach(circle => {
      circle.style.display = circlesVisible ? 'block' : 'none';
    });

    // Restaurar el color de los círculos desde localStorage
    document.querySelectorAll('.circle').forEach(circle => {
      const savedColorStep = localStorage.getItem('circle_color_' + circle.id);
      if (savedColorStep) {
        circle.classList.add('step' + savedColorStep); // Aplicar la clase de color guardada
      }
    });
  };

  // Función para alternar la visibilidad de los círculos y guardar el estado
  function toggleCircles() {
    const circles = document.querySelectorAll('.circle');
    circles.forEach(circle => {
      circle.style.display = circlesVisible ? 'none' : 'block';
    });

    // Guardar el nuevo estado en localStorage
    circlesVisible = !circlesVisible;
    localStorage.setItem('circlesVisible', circlesVisible); // Guardamos el estado
  }

//---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
var SunbedController = function() {
    return {
        init: function() {
            this.bind_listeners();
            this.restore_customers_name();
            this.restore_sunbeds_colors();
            this.retreive_prices();
            this.restore_comments();
            this.restore_total_sold();
        },

        bind_listeners: function() {
            $("input.customer_name").keyup(function () {
                var text = $(this).val();
                var target_id = $(this).closest(".sunbed").attr('id');
                let target_key = 'customer_name' + target_id;
                localStorage.setItem(target_key, text);
            });

            $("#comments").keyup(function() {
               let actual_value = $(this).val();
               localStorage.setItem('comments', actual_value);
            });

          
            
        },

        restore_customers_name: function() {
            $("input.customer_name").each(function () {
                let actual_id = $(this).closest(".sunbed").attr('id');
                let target_key = 'customer_name' + actual_id;

                let target_value = localStorage.getItem(target_key);

                if (target_value) {
                    $(this).val(target_value);
                }
            });
        },

        restore_sunbeds_colors: function() {
            $(".sunbed").each(function() {
                let actual_id = $(this).attr('id'),
                    target_key = 'sunbed_color' + actual_id;

                let target_step = localStorage.getItem(target_key);
                if (target_step) {
                    $(this).addClass('step' + target_step);
                    $(this).data('actual-step', target_step);
                }

            });
        },

        retreive_prices: function() {
            shopping_cart = 0;
            total_sold = 0;

            var saved_total = localStorage.getItem('total_sold');
            if (saved_total) {
                total_sold = parseInt(saved_total);
            }

            var saved_shopping_cart = localStorage.getItem('shopping_cart');
            if (saved_shopping_cart) {
                shopping_cart = parseInt(saved_shopping_cart);
            }

            this.update_prices();
        },

        update_prices: function() {
            $("#shopping_cat_value").html(shopping_cart);
            $("#total_price_value").html(total_sold);
        },

        reset_local_storage_except_customers: function () {           
    Object.keys(localStorage).forEach(function (local_key) {
        // Solo eliminar si NO es customer_name y NO es visibilidad de fila o zona libre
        if (
            !local_key.includes('customer_name') &&
            !local_key.includes('Visibility')
        ) {
            localStorage.removeItem(local_key);
        }
    });

    window.location.reload();
},



        restore_comments: function () {
            var old_comments = localStorage.getItem('comments');
            if (old_comments) {
                $("#comments").val(old_comments);
            }
        },


        restore_total_sold: function(){
            localStorage.getItem(total_sold);
            localStorage.removeItem(total_sold);
        }
    };
}();

// Agrega un evento de clic al botón "Fila 8"
$("#fila8_btn").click(function () {
    // Cambia la visibilidad de los clones del 6 al 10
    for (var x = 6; x <= 10; x++) {
        $("#clon_" + x).css("visibility", "hidden");
    }
});

SunbedController.init();

//CALCuLadora--------------------------------

function calcularCambio() {
  const hamaca = document.getElementById('hamaca').value;
  const totalSelect = document.getElementById('totalSelect');
  const totalManual = document.getElementById('totalManual');
  const recibidoSelect = document.getElementById('recibidoSelect');
  const recibidoManual = document.getElementById('recibidoManual');
  const pago = document.getElementById('pago').value;
  
  let total = totalManual.value ? parseFloat(totalManual.value) : parseFloat(totalSelect.value);
  let recibido = recibidoManual.value ? parseFloat(recibidoManual.value) : parseFloat(recibidoSelect.value);
  
  if (isNaN(total) || isNaN(recibido)) {
    alert('Por favor, ingrese valores válidos');
    return;
  }
  
  const cambio = recibido - total;
  
  if (cambio < 0) {
    alert('El monto recibido es insuficiente');
    return;
  }
  
  document.getElementById('resultado').innerHTML = `Cambio: €${cambio.toFixed(2)}`;
  
  // Guardar el pago en Firebase
  FirebaseService.guardarPago({
    hamaca: hamaca,
    total: total,
    recibido: recibido,
    cambio: cambio,
    metodoPago: pago
  });
  
  // Actualizar totales
  actualizarTotales(pago, total);
  
  // Agregar al historial
  agregarAlHistorial(hamaca, total, recibido, cambio, pago);
}

function procesarDevolucion() {
  const hamaca = document.getElementById('hamaca').value;
  const totalSelect = parseFloat(document.getElementById('totalSelect').value);
  const totalManual = parseFloat(document.getElementById('totalManual').value);
  const recibidoSelect = parseFloat(document.getElementById('recibidoSelect').value);
  const recibidoManual = parseFloat(document.getElementById('recibidoManual').value);
  const metodo = document.getElementById('pago').value;

  // Usamos el total como el valor de lo que se debe devolver
  const total = totalManual || totalSelect;

  if (isNaN(total)) {
    alert("Por favor, introduce un monto válido.");
    return;
  }

  // La devolución será simplemente el total (es decir, se debe devolver todo el monto)
  const devolucion = total;

  // Mostramos el monto de la devolución
  document.getElementById('resultado').textContent = `Devolución: €${devolucion.toFixed(2)}`;

  const historial = document.getElementById('historial');
  const li = document.createElement('li');

  // Fecha y hora del registro
  const fechaObj = new Date();
  const dia = String(fechaObj.getDate()).padStart(2, '0');
  const mes = String(fechaObj.getMonth() + 1).padStart(2, '0');
  const anio = fechaObj.getFullYear();
  const horas = String(fechaObj.getHours()).padStart(2, '0');
  const minutos = String(fechaObj.getMinutes()).padStart(2, '0');
  const fecha = `${dia}/${mes}/${anio} ${horas}:${minutos}`;

  // Creamos el elemento de historial
  li.textContent = `Devolución Hamaca ${hamaca} - Total: €${total.toFixed(2)} - Devolución: €${devolucion.toFixed(2)} - Método: ${metodo} - ${fecha}`;
  historial.insertBefore(li, historial.firstChild);

  // Actualizamos los totales de efectivo o tarjeta según el método de pago
  if (metodo === 'efectivo') {
    totalEfectivo -= total;  // Restamos el total para reflejar la devolución
  } else {
    totalTarjeta -= total;  // Restamos el total para reflejar la devolución
  }

  // Actualizamos el total en pantalla
  document.getElementById('totalEfectivo').textContent = totalEfectivo.toFixed(2);
  document.getElementById('totalTarjeta').textContent = totalTarjeta.toFixed(2);
  document.getElementById('totalGeneral').textContent = (totalEfectivo + totalTarjeta).toFixed(2);

  // Guardamos el historial en localStorage
  let datosHistorial = JSON.parse(localStorage.getItem("historial")) || [];
  datosHistorial.push({
    fecha,
    hamaca: hamaca || "-",
    total: total.toFixed(2),
    devolucion: devolucion.toFixed(2),
    metodo
  });
  localStorage.setItem("historial", JSON.stringify(datosHistorial));

  // Guardamos la operación de la devolución en el historial de operaciones
  let operaciones = JSON.parse(localStorage.getItem("operaciones")) || [];
  operaciones.push({
    fecha,
    hamaca: hamaca || "-",
    pagado: "",
    devuelto: devolucion.toFixed(2)
  });
  localStorage.setItem("operaciones", JSON.stringify(operaciones));
}

function toggleHistorial() {
  const historialContainer = document.getElementById('historialContainer');
  historialContainer.style.display = historialContainer.style.display === 'none' ? 'block' : 'none';
}

function descargarHistorial() {
  let datosHistorial = JSON.parse(localStorage.getItem("historial")) || [];

  const resumenDiario = {};
  const resumenMensual = {};

  datosHistorial.forEach(entry => {
    // Manejo correcto para fechas en formato DD/MM/YYYY
    let [dia, mes, anioHora] = entry.fecha.split('/');
    let [anio] = anioHora.split(' ');
    let fecha = new Date(`${anio}-${mes}-${dia}`);

    const diaClave = `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}/${fecha.getFullYear()}`;
    const mesClave = `${String(fecha.getMonth() + 1).padStart(2, '0')}/${fecha.getFullYear()}`;
    const total = parseFloat(entry.total || 0);
    const metodo = entry.metodo;

    if (!resumenDiario[diaClave]) {
      resumenDiario[diaClave] = { efectivo: 0, tarjeta: 0 };
    }
    if (!resumenMensual[mesClave]) {
      resumenMensual[mesClave] = { efectivo: 0, tarjeta: 0 };
    }

    if (metodo === 'efectivo') {
      resumenDiario[diaClave].efectivo += total;
      resumenMensual[mesClave].efectivo += total;
    } else {
      resumenDiario[diaClave].tarjeta += total;
      resumenMensual[mesClave].tarjeta += total;
    }
  });

  let csv = "Resumen Diario\nDía,Efectivo,Tarjeta,Total\n";
  for (let dia in resumenDiario) {
    const d = resumenDiario[dia];
    csv += `${dia},${d.efectivo.toFixed(2)},${d.tarjeta.toFixed(2)},${(d.efectivo + d.tarjeta).toFixed(2)}\n`;
  }

  csv += "\nResumen Mensual\nMes,Efectivo,Tarjeta,Total\n";
  for (let mes in resumenMensual) {
    const m = resumenMensual[mes];
    csv += `${mes},${m.efectivo.toFixed(2)},${m.tarjeta.toFixed(2)},${(m.efectivo + m.tarjeta).toFixed(2)}\n`;
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "resumen_contabilidad_2025.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}


function reiniciarCalculadora() {
  document.getElementById('hamaca').value = '';
  document.getElementById('totalSelect').selectedIndex = 0;
  document.getElementById('totalManual').value = '';
  document.getElementById('recibidoSelect').selectedIndex = 0;
  document.getElementById('recibidoManual').value = '';
  document.getElementById('pago').selectedIndex = 0;
  document.getElementById('resultado').textContent = '';

  totalEfectivo = 0;
  totalTarjeta = 0;

  document.getElementById('totalEfectivo').textContent = '0.00';
  document.getElementById('totalTarjeta').textContent = '0.00';
  document.getElementById('totalGeneral').textContent = '0.00';

  const historial = document.getElementById('historial');
  historial.innerHTML = '';

  localStorage.removeItem('historial'); // solo historial, no operaciones
}

function descargarLog() {
  let operaciones = JSON.parse(localStorage.getItem("operaciones")) || [];

  let csv = "Fecha,Hora,Hamaca,Pagado,Devuelto\n";

  operaciones.forEach(entry => {
    // Separar la fecha original "DD/MM/YYYY HH:MM"
    const partes = entry.fecha.split(' ');
    const fechaTexto = partes[0]; // "DD/MM/YYYY"
    const horaTexto = partes[1] || ''; // "HH:MM"

    csv += `${fechaTexto},${horaTexto},${entry.hamaca},${entry.pagado},${entry.devuelto}\n`;
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "log_operaciones_individuales.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}


//FUNCIONAMIENTO DE SERVICE WORKER NO TOCAR
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log("Service Worker registrado", reg);
    }).catch((err) => {
      console.error("Error al registrar el Service Worker", err);
    });
  });
}





// Bucle de colores para los círculos


function setupColorCycle(selector, stepsCount, storagePrefix) {
    $(selector).each(function (index) {
        const el = $(this);
        const storageKey = storagePrefix + index;

        el.on('dblclick', function (event) {
            event.stopPropagation();

            const currentStep = parseInt(el.data('actual-step')) || 0;
            const newStep = currentStep >= stepsCount ? 1 : currentStep + 1;

            // Eliminar clases anteriores
            for (let i = 1; i <= stepsCount; i++) {
                el.removeClass('step' + i);
            }

            // Añadir nueva clase
            el.addClass('step' + newStep);
            el.data('actual-step', newStep);

            // Guardar en localStorage
            localStorage.setItem(storageKey, newStep);

            // Guardar en Firebase si es una hamaca
            if (el.hasClass('sunbed')) {
                const hamacaId = el.attr('id');
                const cliente = el.find('.customer_name').val();
                FirebaseService.guardarHamaca(hamacaId, {
                    step: newStep,
                    cliente: cliente
                });
            }
        });

        // Restaurar estado desde localStorage
        const savedStep = localStorage.getItem(storageKey);
        if (savedStep) {
            for (let i = 1; i <= stepsCount; i++) {
                el.removeClass('step' + i);
            }
            el.addClass('step' + savedStep);
            el.data('actual-step', savedStep);
        }
    });
}

// Aplicamos color cycle separado
setupColorCycle('.circle', 3, 'circle_color_');
setupColorCycle('.sunbed', 6, 'sunbed_color_');


//------zona pruebas

// Manejo del menú contextual de colores
document.addEventListener('DOMContentLoaded', function() {
    const contextMenu = document.getElementById('colorContextMenu');
    let activeSunbed = null;

    // Mostrar menú contextual al hacer clic derecho o mantener pulsado
    document.addEventListener('contextmenu', function(e) {
        const sunbed = e.target.closest('.sunbed');
        if (sunbed) {
            e.preventDefault();
            activeSunbed = sunbed;
            contextMenu.style.display = 'block';
            contextMenu.style.left = e.pageX + 'px';
            contextMenu.style.top = e.pageY + 'px';
        }
    });

    // Cerrar menú al hacer clic en cualquier lugar
    document.addEventListener('click', function(e) {
        if (!contextMenu.contains(e.target)) {
            contextMenu.style.display = 'none';
        }
    });

    // Manejar la selección de color
    contextMenu.addEventListener('click', function(e) {
        const colorOption = e.target.closest('.color-option');
        if (colorOption && activeSunbed) {
            const step = colorOption.dataset.step;
            
            // Eliminar clases anteriores
            for (let i = 1; i <= 6; i++) {
                activeSunbed.classList.remove('step' + i);
            }
            
            // Añadir nueva clase
            activeSunbed.classList.add('step' + step);
            activeSunbed.dataset.actualStep = step;
            
            // Guardar en localStorage
            const sunbedId = activeSunbed.id;
            localStorage.setItem('sunbed_color' + sunbedId, step);
            
            // Ocultar menú
            contextMenu.style.display = 'none';
        }
    });

    // Cerrar menú al hacer scroll
    window.addEventListener('scroll', function() {
        contextMenu.style.display = 'none';
    });
});

function actualizarTotales(metodo, monto) {
  if (metodo === 'efectivo') {
    totalEfectivo += monto;
  } else {
    totalTarjeta += monto;
  }

  document.getElementById('totalEfectivo').textContent = totalEfectivo.toFixed(2);
  document.getElementById('totalTarjeta').textContent = totalTarjeta.toFixed(2);
  document.getElementById('totalGeneral').textContent = (totalEfectivo + totalTarjeta).toFixed(2);
}

function agregarAlHistorial(hamaca, total, recibido, cambio, metodo) {
  const historial = document.getElementById('historial');
  const li = document.createElement('li');

  const fechaObj = new Date();
  const dia = String(fechaObj.getDate()).padStart(2, '0');
  const mes = String(fechaObj.getMonth() + 1).padStart(2, '0');
  const anio = fechaObj.getFullYear();
  const horas = String(fechaObj.getHours()).padStart(2, '0');
  const minutos = String(fechaObj.getMinutes()).padStart(2, '0');
  const fecha = `${dia}/${mes}/${anio} ${horas}:${minutos}`;

  li.textContent = `Hamaca ${hamaca} - Total: €${total.toFixed(2)} - Recibido: €${recibido.toFixed(2)} - Cambio: €${cambio.toFixed(2)} - Método: ${metodo} - ${fecha}`;
  historial.insertBefore(li, historial.firstChild);
}

// Modificar la función que maneja los clics en las hamacas
$(document).on('click', '.sunbed', function() {
  const hamacaId = $(this).attr('id');
  const currentStep = $(this).data('actual-step') || 0;
  const cliente = $(this).find('.customer_name').val();

  FirebaseService.guardarHamaca(hamacaId, {
    step: currentStep,
    cliente: cliente
  });
});

// Evento para cambios en el nombre del cliente
$(document).on('change', '.customer_name', function() {
  const hamacaId = $(this).closest('.sunbed').attr('id');
  const cliente = $(this).val();
  const step = $(this).closest('.sunbed').data('actual-step') || 0;

  FirebaseService.guardarHamaca(hamacaId, {
    step: step,
    cliente: cliente
  });
});

// Función para guardar datos en Firebase
function guardarDatosEnFirebase(datos) {
  const database = firebase.database();
  const referencia = database.ref('datos');
  
  return referencia.push(datos)
    .then(() => {
      console.log('Datos guardados correctamente en Firebase');
      return true;
    })
    .catch(error => {
      console.error('Error al guardar en Firebase:', error);
      return false;
    });
}

// Función para cargar datos desde Firebase
function cargarDatosDesdeFirebase() {
  const database = firebase.database();
  const referencia = database.ref('datos');
  
  return referencia.once('value')
    .then(snapshot => {
      const datos = [];
      snapshot.forEach(childSnapshot => {
        datos.push(childSnapshot.val());
      });
      return datos;
    })
    .catch(error => {
      console.error('Error al cargar datos desde Firebase:', error);
      return [];
    });
}

// Función para actualizar datos en Firebase
function actualizarDatosEnFirebase(id, nuevosDatos) {
  const database = firebase.database();
  const referencia = database.ref(`datos/${id}`);
  
  return referencia.update(nuevosDatos)
    .then(() => {
      console.log('Datos actualizados correctamente en Firebase');
      return true;
    })
    .catch(error => {
      console.error('Error al actualizar en Firebase:', error);
      return false;
    });
}

// Función para eliminar datos en Firebase
function eliminarDatosEnFirebase(id) {
  const database = firebase.database();
  const referencia = database.ref(`datos/${id}`);
  
  return referencia.remove()
    .then(() => {
      console.log('Datos eliminados correctamente de Firebase');
      return true;
    })
    .catch(error => {
      console.error('Error al eliminar de Firebase:', error);
      return false;
    });
}
