import http from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import app from './server.js';
import backupModule from './backup.js';

const server = http.createServer(app);
const httpHandler = httpServerHandler(server);

function applyRuntimeEnvironment(env) {
  // nodejs_compat exposes process.versions.node, so feature-detecting Node is
  // not enough to distinguish a Worker from a long-lived Node server.
  process.env.CLOUDFLARE_WORKER = 'true';
  for (const name of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'DATA_ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GROQ_API_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE', 'EMAIL_FROM']) {
    if (typeof env[name] === 'string') process.env[name] = env[name];
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      applyRuntimeEnvironment(env);
      return await httpHandler.fetch(request, env, ctx);
    } catch (err) {
      console.error('Worker unhandled fetch error:', err);
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api')) {
        return new Response(JSON.stringify({
          success: false,
          error: `Worker execution error: ${err.message || 'Internal server error'}`
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      return new Response(`<!DOCTYPE html><html><body><h1>Service Error</h1><p>${err.message}</p></body></html>`, {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  },
  async scheduled(controller, env, ctx) {
    applyRuntimeEnvironment(env);
    ctx.waitUntil(backupModule.runGoogleDriveBackup().catch(error => console.error('Daily Google Drive backup failed:', error.message)));
  }
};
