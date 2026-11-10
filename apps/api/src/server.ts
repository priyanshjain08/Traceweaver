import http from 'node:http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { SOCKET_EVENTS } from '@traceweaver/shared';
import { createApp } from './app';
import { env } from './config/env';
import { bus } from './lib/bus';
import { logger } from './lib/logger';

const server = http.createServer(createApp());
const io = new Server(server, { cors: { origin: env.WEB_ORIGIN } });
io.use((socket, next) => {
  try { jwt.verify(String(socket.handshake.auth.token ?? ''), env.JWT_SECRET); next(); } catch { next(new Error('unauthorized')); }
});
for (const name of Object.values(SOCKET_EVENTS)) bus.on(name, (payload) => io.emit(name, payload));
server.listen(env.API_PORT, () => logger.info(`TraceWeaver API listening on :${env.API_PORT}`));
