import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

function getSocketBaseUrl(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_WS_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:8741';

  return fromEnv.replace(/\/$/, '');
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