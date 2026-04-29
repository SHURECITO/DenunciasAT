#!/usr/bin/env node
'use strict';

/**
 * Verificación de eventos QR y estado WhatsApp vía WebSocket
 * Conecta a /eventos, escucha qr_actualizado y estado_whatsapp.
 * Salida: exit 0 si al menos un evento recibido en 30 s, exit 1 si ninguno.
 *
 * Uso: node test/verify-qr-whatsapp.js
 * Variables de entorno:
 *   API_URL     (default: http://localhost:8741)
 *   TIMEOUT_MS  (default: 30000)
 */

const http = require('http');
const WebSocket = require('ws');

const API_BASE   = (process.env.API_URL || 'http://localhost:8741').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS) || 30000;

const wsBase = API_BASE.replace(/^http/, 'ws');

const received = { qr_actualizado: false, estado_whatsapp: false };

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function conectarSocketIO() {
  return new Promise((resolve, reject) => {
    const pollUrl = `${API_BASE}/socket.io/?EIO=4&transport=polling`;
    httpGet(pollUrl).then(({ body }) => {
      const match = body.match(/0(\{[^}]+\})/);
      if (!match) return reject(new Error(`EIO open packet no encontrado: ${body.substring(0, 100)}`));

      let handshake;
      try { handshake = JSON.parse(match[1]); } catch { return reject(new Error('EIO handshake JSON inválido')); }
      const sid = handshake.sid;
      if (!sid) return reject(new Error('sid no encontrado en handshake'));

      const wsUrl = `${wsBase}/socket.io/?EIO=4&transport=websocket&sid=${sid}`;
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => ws.send('2probe'));

      ws.on('message', (rawMsg) => {
        const msg = rawMsg.toString();
        if (msg === '3probe') {
          ws.send('5');
          ws.send('40/eventos,');
        } else if (msg.startsWith('40/eventos,')) {
          resolve(ws);
        } else if (msg === '2') {
          ws.send('3');
        }
      });

      ws.on('error', reject);
      setTimeout(() => reject(new Error('Timeout conectando al namespace /eventos')), 8000);
    }).catch(reject);
  });
}

function handleEvento(msg) {
  try {
    const jsonStr = msg.replace(/^42\/eventos,/, '');
    const [evento, data] = JSON.parse(jsonStr);
    console.log(`  → Evento: ${evento}`, JSON.stringify(data).substring(0, 120));
    if (evento === 'qr_actualizado') received.qr_actualizado = true;
    if (evento === 'estado_whatsapp') received.estado_whatsapp = true;
  } catch {
    console.warn('  ! No se pudo parsear evento:', msg.substring(0, 80));
  }
}

async function main() {
  console.log(`🔌 Conectando a ${API_BASE}/eventos — esperando qr_actualizado / estado_whatsapp...`);

  let ws;
  try {
    ws = await conectarSocketIO();
    console.log('  ✓ Conectado al namespace /eventos');
  } catch (err) {
    console.error(`❌ Error conectando: ${err.message}`);
    process.exit(1);
  }

  ws.on('message', (rawMsg) => {
    const msg = rawMsg.toString();
    if (msg.startsWith('42/eventos,')) handleEvento(msg);
    else if (msg === '2') ws.send('3');
  });

  const timer = setTimeout(() => {
    console.log('\n⏱  Timeout de', TIMEOUT_MS, 'ms alcanzado.');
    printResult(ws);
  }, TIMEOUT_MS);

  ws.on('close', () => {
    clearTimeout(timer);
    printResult(null);
  });
}

function printResult(ws) {
  if (ws) ws.close();
  const alguno = received.qr_actualizado || received.estado_whatsapp;
  console.log('\n📊 Resultados:');
  console.log('  qr_actualizado:  ', received.qr_actualizado  ? '✅' : '❌ (no recibido)');
  console.log('  estado_whatsapp: ', received.estado_whatsapp ? '✅' : '❌ (no recibido)');
  if (alguno) {
    console.log('\n✅ Al menos un evento recibido — WebSocket funcionando');
    process.exit(0);
  } else {
    console.error('\n❌ Ningún evento recibido en el timeout.');
    console.error('   Verifique que NEXT_PUBLIC_WS_URL apunte al host público correcto.');
    process.exit(1);
  }
}

main();
