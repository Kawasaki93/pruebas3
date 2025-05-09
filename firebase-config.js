// Configuración de Firebase
// Para obtener estas credenciales:
// 1. Ve a la consola de Firebase (https://console.firebase.google.com)
// 2. Selecciona tu proyecto
// 3. Haz clic en el ícono de configuración (⚙️) junto a "Project Overview"
// 4. Selecciona "Configuración del proyecto"
// 5. En la sección "Tus aplicaciones", haz clic en el ícono de web (</>)
// 6. Registra tu app con un nombre (por ejemplo "playa-juan-web")
// 7. Copia las credenciales que aparecen y reemplázalas abajo

const firebaseConfig = {
  apiKey: "AIzaSyDpVd0jLqj3D6q4VjRjHYPAdrOd5qs_Y54",
  authDomain: "base-datos-ce254.firebaseapp.com",
  projectId: "base-datos-ce254",
  storageBucket: "base-datos-ce254.firebasestorage.app",
  messagingSenderId: "268304492138",
  appId: "1:268304492138:web:1e583f94f6bf013f870c13"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Función para sincronizar el estado de los sunbeds
function syncSunbedState(sunbedId, state) {
  return db.collection('sunbeds').doc(sunbedId).set({
    color: state.color,
    clientName: state.clientName,
    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// Función para sincronizar el estado de los círculos
function syncCircleState(circleId, state) {
  return db.collection('circles').doc(circleId).set({
    color: state.color,
    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// Función para sincronizar el registro de la calculadora
function syncCalculatorLog(log) {
  return db.collection('calculatorLogs').add({
    log: log,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// Función para sincronizar la visibilidad de filas y sombrillas
function syncVisibilityState(state) {
  return db.collection('visibility').doc('current').set({
    rows: state.rows,
    umbrellas: state.umbrellas,
    lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// Función para escuchar cambios en tiempo real
function listenToChanges() {
  console.log('Iniciando escucha de cambios en Firebase...');

  // Escuchar cambios en sunbeds
  db.collection('sunbeds').onSnapshot((snapshot) => {
    console.log('Cambios detectados en sunbeds:', snapshot.docChanges());
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'modified' || change.type === 'added') {
        const data = change.doc.data();
        console.log('Actualizando sunbed:', change.doc.id, data);
        updateSunbedUI(change.doc.id, data);
      }
    });
  }, (error) => {
    console.error('Error al escuchar cambios en sunbeds:', error);
  });

  // Escuchar cambios en círculos
  db.collection('circles').onSnapshot((snapshot) => {
    console.log('Cambios detectados en círculos:', snapshot.docChanges());
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'modified' || change.type === 'added') {
        const data = change.doc.data();
        console.log('Actualizando círculo:', change.doc.id, data);
        updateCircleUI(change.doc.id, data);
      }
    });
  }, (error) => {
    console.error('Error al escuchar cambios en círculos:', error);
  });

  // Escuchar cambios en visibilidad
  db.collection('visibility').doc('current').onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      console.log('Actualizando visibilidad:', data);
      updateVisibilityUI(data);
    }
  }, (error) => {
    console.error('Error al escuchar cambios en visibilidad:', error);
  });
}

// Funciones auxiliares para actualizar la UI
function updateSunbedUI(sunbedId, data) {
  console.log('Intentando actualizar sunbed:', sunbedId, data);
  const sunbed = document.getElementById(sunbedId);
  if (sunbed) {
    if (data.color) {
      sunbed.style.backgroundColor = data.color;
    }
    const nameInput = sunbed.querySelector('.customer_name');
    if (nameInput && data.clientName) {
      nameInput.value = data.clientName;
    }
    console.log('Sunbed actualizado:', sunbedId);
  } else {
    console.warn('No se encontró el sunbed:', sunbedId);
  }
}

function updateCircleUI(circleId, data) {
  console.log('Intentando actualizar círculo:', circleId, data);
  const circle = document.getElementById(circleId);
  if (circle && data.color) {
    circle.style.backgroundColor = data.color;
    console.log('Círculo actualizado:', circleId);
  } else {
    console.warn('No se encontró el círculo:', circleId);
  }
}

function updateVisibilityUI(data) {
  console.log('Actualizando visibilidad:', data);
  if (data.rows) {
    data.rows.forEach((row, index) => {
      const rowElement = document.querySelector(`.row-${index}`);
      if (rowElement) {
        rowElement.style.display = row.visible ? 'flex' : 'none';
      }
    });
  }
  if (data.umbrellas) {
    data.umbrellas.forEach((umbrella, index) => {
      const umbrellaElement = document.querySelector(`.umbrella-${index}`);
      if (umbrellaElement) {
        umbrellaElement.style.display = umbrella.visible ? 'block' : 'none';
      }
    });
  }
}

// Función para verificar la conexión con Firestore
function checkFirestoreConnection() {
  const connectionStatus = document.getElementById('connectionStatus');
  connectionStatus.textContent = '...';
  connectionStatus.style.backgroundColor = 'rgba(240, 240, 240, 0.8)';
  connectionStatus.style.color = '#333';
  
  // Intentar una operación simple de Firestore
  db.collection('connection_test').doc('test').set({
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  })
  .then(() => {
    connectionStatus.textContent = 'OK';
    connectionStatus.style.backgroundColor = 'rgba(76, 175, 80, 0.8)';
    connectionStatus.style.color = 'white';
    
    // Verificar la latencia
    const startTime = Date.now();
    return db.collection('connection_test').doc('test').get()
      .then(() => {
        const latency = Date.now() - startTime;
        if (latency < 100) {
          connectionStatus.textContent = 'OK';
        } else {
          connectionStatus.textContent = `${latency}ms`;
        }
      });
  })
  .catch((error) => {
    connectionStatus.textContent = 'X';
    connectionStatus.style.backgroundColor = 'rgba(244, 67, 54, 0.8)';
    connectionStatus.style.color = 'white';
    console.error('Error de conexión:', error);
    
    // Mostrar el error específico
    if (error.code === 'permission-denied') {
      connectionStatus.textContent = '!';
    } else if (error.code === 'unavailable') {
      connectionStatus.textContent = 'X';
    } else {
      connectionStatus.textContent = 'X';
    }
  });
}

// Verificar conexión cada 30 segundos
setInterval(checkFirestoreConnection, 30000);

// Verificar conexión inicial
document.addEventListener('DOMContentLoaded', () => {
  checkFirestoreConnection();
}); 