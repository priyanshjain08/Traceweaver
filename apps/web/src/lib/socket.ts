import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from './api';

let socket: Socket | null = null;
function get(token: string) { if (!socket) socket = io({ auth: { token } }); return socket; }

/** Subscribes to a socket event and always unsubscribes on unmount. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const token = useAuth((s) => s.token);
  useEffect(() => {
    if (!token) return;
    const s = get(token); s.on(event, handler);
    return () => { s.off(event, handler); };
  }, [event, handler, token]);
}
