'use client';

import { DependencyList, useCallback, useEffect } from 'react';
import { getSocket } from '@/lib/socket';

export function useWebSocket<T = any>(
  evento: string,
  handler: (data: T) => void,
  deps: DependencyList = [],
) {
  const cb = useCallback(handler, deps);

  useEffect(() => {
    const socket = getSocket();
    socket.on(evento, cb);

    return () => {
      socket.off(evento, cb);
    };
  }, [evento, cb]);
}