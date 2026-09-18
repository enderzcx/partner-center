type StaticFile = { file: string; type: string };

// Explicit SPA routes keep unknown API paths and files out of the HTML fallback.
const pages = new Set([
  '/', '/index.html', '/login', '/console', '/console/orders',
  '/console/settlements', '/console/wallet', '/docs',
]);
const types: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

export function staticFileFor(path: string): StaticFile | null {
  if (pages.has(path)) return { file: 'index.html', type: 'text/html; charset=utf-8' };
  // Legacy names remain available for existing HTTP fixtures. No source maps,
  // arbitrary root files, encoded separators or dot-directory traversal.
  if (path === '/app.js' || path === '/style.css') {
    return { file: path.slice(1), type: types[path.endsWith('.js') ? 'js' : 'css']! };
  }
  if (path === '/global-icon.svg' || path === '/favicon.ico') {
    return { file: path.slice(1), type: path.endsWith('.svg') ? types.svg! : types.ico! };
  }
  if (path === '/licenses/new-api.txt') {
    return { file: 'licenses/new-api.txt', type: 'text/plain; charset=utf-8' };
  }
  const match = /^\/(?:assets|fonts|images)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.([a-z0-9]+)$/.exec(path);
  if (!match || !types[match[1]!]) return null;
  return { file: path.slice(1), type: types[match[1]!]! };
}
