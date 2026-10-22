/**
 * Local API server: the same Fetch handler Vercel runs, on 127.0.0.1:3001.
 * Does: serve `/api/*` for Vite's dev proxy. Never does: listen beyond loopback.
 */
import { serve } from '@hono/node-server';
import { handlerFromEnv } from '../server/handler.js';

serve({ fetch: handlerFromEnv(process.env), port: 3001, hostname: '127.0.0.1' });
