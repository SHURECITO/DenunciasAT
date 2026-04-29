import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

function getSocketBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '';

  // En browser, si la variable apunta a localhost pero el usuario accede desde otra
  // IP (producción), derivamos la URL del host actual para que el WebSocket funcione.
  if (
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    (!fromEnv || fromEnv.includes('localhost') || fromEnv.includes('127.0.0.1'))
  ) {
    const proto = window.location.protocol === 'https:' ? 'https' : 'http';
    // Dashboard-api siempre en puerto 8741 (arquitectura fija del proyecto)
    return `${proto}://${window.location.hostname}:8741`;
  }

  return (fromEnv || 'http://localhost:8741').replace(/\/$/, '');
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(`${getSocketBaseUrl()}/eventos`, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
    });

    socket.on('connect', () => console.log('WebSocket conectado:', socket?.id));
    socket.on('disconnect', () => console.log('WebSocket desconectado'));
    socket.on('connect_error', (err) =>
      console.warn('WebSocket error:', err.message),
    );
  }

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}