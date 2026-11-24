// Cloudflare Worker entry: serves the app from /public and answers /api/* itself.
// (Used when the project is deployed as a Worker; Pages uses /functions instead.)
import { onRequestGet as product } from '../functions/api/product.js';
import { onRequestGet as catalog } from '../functions/api/catalog.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && pathname === '/api/product') return product({ request, env });
    if (request.method === 'GET' && pathname === '/api/catalog') return catalog({ request, env });
    return env.ASSETS.fetch(request);
  },
};
