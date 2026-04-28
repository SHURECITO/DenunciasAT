#!/usr/bin/env node
'use strict';

/**
 * Verificación de WebSocket — socket.io EIO4 sobre ws
 * Conecta a /eventos, crea una denuncia, verifica que lleguen:
 *   nueva_denuncia y cambio_estado
 * Salida: exit 0 si ambos eventos recibidos, exit 1 si falló alguno.
 *
 * Uso: node test/verify-websockets.js
 * Variables de entorno:
 *   API_URL     (default: http://localhost:8741)
 *   JWT_TOKEN   token JWT válido (requerido)
 *   TIMEOUT_MS  (default: 15000)
 */

const http = require('http');
const WebSocket = require('ws');

const API_BASE   = (process.env.API_URL   || 'http://localhost:8741').replace(/\/$/, '');
const JWT        = process.env.JWT_TOKEN;
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS) || 15000;

if (!JWT) {
  console.error('❌ JWT_TOKEN no configurado. Ejecutar:');
  console.error('   export JWT_TOKEN=$(curl -sf -X POST ' + API_BASE + '/auth/login \\');
  console.error('     -H "Content-Type: application/json" \\');
  console.error('     -d \'{"email":"admin@denunciasat.co","password":"<pwd>"}\' | python3 -c "import sys,json; print(json.load(sys.stdin)[\'access_token\'])")');
  process.exit(1);
}

// Convierte URL http(s):// → ws(s)://
const wsBase = API_BASE.replace(/^http/, 'ws');

let received = { nueva_denuncia: false, cambio_estado: false };
let denunciaId = null;

// Solicitud HTTP simple
function httpReq(url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Conecta a socket.io namespace /eventos usando protocolo EIO4 sobre ws
function conectarSocketIO() {
  return new Promise((resolve, reject) => {
    // Primera petición HTTP polling para obtener sid
    const pollUrl = `${API_BASE}/socket.io/?EIO=4&transport=polling`;
    httpReq(pollUrl).then(({ body }) => {
      // Formato: "NN:0{json}..."  donde NN es largo del paquete
      const match = body.match(/0(\{[^}]+\})/);
      if (!match) return reject(new Error(`EIO open packet no encontrado: ${body.substring(0,100)}`));

      let handshake;
      try { handshake = JSON.parse(match[1]); } catch { return reject(new Error('EIO handshake JSON inválido')); }
      const sid = handshake.sid;
      if (!sid) return reject(new Error('sid no encontrado en handshake'));

      // Abrir WebSocket con el sid obtenido
      const wsUrl = `${wsBase}/socket.io/?EIO=4&transport=websocket&sid=${sid}`;
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        // Upgrade probe: enviar "2probe" (ping probe)
        ws.send('2probe');
      });

      ws.on('message', (rawMsg) => {
        const msg = rawMsg.toString();

        if (msg === '3probe') {
          // Upgrade aceptado — enviar "5" para confirmar upgrade
          ws.send('5');
          // Conectar al namespace /eventos
          ws.send('40/eventos,');
        } else if (msg.startsWith('40/eventos,')) {
          // Namespace conectado (servidor envía sid adicional: "40/eventos,{...}")
          resolve(ws);
        } else if (msg.startsWith('42/eventos,')) {
          // Evento del namespace
          handleEvento(msg);
        } else if (msg === '2') {
          // Ping del servidor — responder con pong
          ws.send('3');
        }
      });

      ws.on('error', reject);
      ws.on('close', () => {});

      setTimeout(() => reject(new Error('Timeout conectando al namespace /eventos')), 5000);
    }).catch(reject);
  });
}

function handleEvento(msg) {
  // msg: "42/eventos,["nueva_denuncia",{...}]"
  try {
    const jsonStr = msg.replace(/^42\/eventos,/, '');
    const [evento, data] = JSON.parse(jsonStr);
    console.log(`  → Evento recibido: ${evento}`, JSON.stringify(data).substring(0, 80));

    if (evento === 'nueva_denuncia') {
      received.nueva_denuncia = true;
      denunciaId = data?.id;
    }
    if (evento === 'cambio_estado') {
      received.cambio_estado = true;
    }
  } catch (e) {
    console.warn('  ! No se pudo parsear evento:', msg.substring(0, 80));
  }
}

async function crearDenuncia() {
  const res = await httpReq(`${API_BASE}/denuncias`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${JWT}` },
    body: {
      nombreCiudadano: 'Test WebSocket',
      telefono: '3001110000',
      ubicacion: 'Calle 1 # 1-1',
      descripcion: 'Prueba automática de WebSocket para verificación de eventos en tiempo real del sistema.',
      dependenciaAsignada: 'Secretaría de Infraestructura Física',
    },
  });
  if (res.status !== 201) throw new Error(`POST /denuncias falló: ${res.status} — ${res.body.substring(0,100)}`);
  const d = JSON.parse(res.body);
  console.log(`  ✓ Denuncia creada: radicado=${d.radicado}, id=${d.id}`);
  return d.id;
}

async function cambiarEstado(id) {
  const res = await httpReq(`${API_BASE}/denuncias/${id}/estado`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${JWT}` },
    body: { estado: 'EN_GESTION' },
  });
  if (res.status !== 200) throw new Error(`PATCH estado falló: ${res.status} — ${res.body.substring(0,100)}`);
  console.log(`  ✓ Estado cambiado a EN_GESTION`);
}

async function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('🔌 Verificando WebSocket (/eventos namespace)...');

  let ws;
  try {
    console.log('  Conectando a socket.io...');
    ws = await conectarSocketIO();
    console.log('  ✓ Conectado al namespace /eventos');
  } catch (err) {
    console.error(`❌ Error conectando: ${err.message}`);
    process.exit(1);
  }

  const timer = setTimeout(() => {
    console.error('❌ Timeout: no se recibieron todos los eventos en', TIMEOUT_MS, 'ms');
    console.error('  nueva_denuncia:', received.nueva_denuncia ? '✅' : '❌');
    console.error('  cambio_estado: ', received.cambio_estado  ? '✅' : '❌');
    ws.close();
    process.exit(1);
  }, TIMEOUT_MS);

  try {
    // Registrar handler de eventos en el ws (ya conectado)
    ws.on('message', (rawMsg) => {
      const msg = rawMsg.toString();
      if (msg.startsWith('42/eventos,')) handleEvento(msg);
      else if (msg === '2') ws.send('3');
    });

    await esperar(500);  // pequeña pausa para que el handler quede activo

    console.log('  Creando denuncia de prueba...');
    const id = await crearDenuncia();

    await esperar(1000);  // esperar evento nueva_denuncia

    console.log('  Cambiando estado...');
    await cambiarEstado(id);

    await esperar(1000);  // esperar evento cambio_estado

    clearTimeout(timer);
    ws.close();

    const ok = received.nueva_denuncia && received.cambio_estado;
    console.log('\n📊 Resultados:');
    console.log('  nueva_denuncia:', received.nueva_denuncia ? '✅' : '❌');
    console.log('  cambio_estado: ', received.cambio_estado  ? '✅' : '❌');

    if (ok) {
      console.log('\n✅ WebSocket OK — ambos eventos recibidos');
      process.exit(0);
    } else {
      console.error('\n❌ WebSocket FALLIDO — eventos faltantes');
      process.exit(1);
    }
  } catch (err) {
    clearTimeout(timer);
    ws.close();
    console.error(`❌ Error durante verificación: ${err.message}`);
    process.exit(1);
  }
}

main();
