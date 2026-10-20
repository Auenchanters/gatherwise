/**
 * Vercel function for `GET /api/health`: whether AI is configured, never how.
 * Does: hand every request to the shared Fetch handler. Never does: anything else.
 */
import { handleRequest } from '../server/handler.js';

/** Vercel's Web-standard function export. */
export default { fetch: handleRequest };
