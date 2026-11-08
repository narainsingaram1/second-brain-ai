import type { Plugin } from "vite";

/**
 * Serves server/routes/<name>.ts at /api/<name> during `vite dev`, the same Web Request/Response handlers
 * Vercel runs in production, loaded through Vite so edits apply without a rebuild. Responses stream, so
 * the assistant's server-sent events work locally too.
 */
export function apiRoutes(): Plugin {
  return {
    name: "synapse-api-routes",
    configureServer(server) {
      // Node request/response types are not installed (no @types/node); the shapes used here are minimal.
      server.middlewares.use(async (req: any, res: any, next: () => void) => {
        const match = req.url?.match(/^\/api\/([a-z-]+)(?:[/?]|$)/);
        if (!match) return next();
        try {
          const mod = await server.ssrLoadModule(`/server/routes/${match[1]}.ts`).catch(() => null);
          const handler = mod?.[req.method || "GET"];
          if (typeof handler !== "function") { res.statusCode = mod ? 405 : 404; res.end(); return; }
          const chunks: Uint8Array[] = [];
          for await (const chunk of req) chunks.push(chunk as Uint8Array);
          const controller = new AbortController();
          res.on("close", () => { if (!res.writableFinished) controller.abort(); });
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
          const request = new Request(`http://${req.headers.host || "localhost"}${req.url}`, {
            method: req.method, headers, signal: controller.signal,
            ...(chunks.length && req.method !== "GET" && req.method !== "HEAD" ? { body: new TextDecoder().decode(concat(chunks)) } : {}),
          });
          const response: Response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          if (!response.body) { res.end(); return; }
          const reader = response.body.getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        } catch (error) {
          server.config.logger.error(`[api] ${req.method} ${req.url} failed: ${error instanceof Error ? error.stack : error}`);
          if (!res.headersSent) res.statusCode = 500;
          res.end();
        }
      });
    },
  };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}
