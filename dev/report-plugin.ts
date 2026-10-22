// Dev-only endpoint: POST /report saves a /check result to reports/.
// Never part of the production build.
import type { Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function reportPlugin(): Plugin {
  const dir = resolve(__dirname, '..', 'reports');
  return {
    name: 'dev-report',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/report', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 1e6) req.destroy();
        });
        req.on('end', () => {
          let data: { label?: string };
          try {
            data = JSON.parse(body);
          } catch {
            res.statusCode = 400;
            return res.end('bad json');
          }
          const label = String(data.label || 'device').replace(/[^a-z0-9-]/gi, '_').slice(0, 40);
          const file = resolve(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.json`);
          mkdirSync(dir, { recursive: true });
          writeFileSync(file, JSON.stringify(data, null, 2));
          server.config.logger.info(`[report] saved ${file}`);
          res.setHeader('content-type', 'text/plain');
          res.end('saved');
        });
      });
    },
  };
}
