import { EventEmitter } from 'node:events';
/** Decouples ingestion/simulation from the Socket.IO transport. */
export const bus = new EventEmitter();
