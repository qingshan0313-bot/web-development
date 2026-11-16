import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { handleSmartRequest } from "./smart-relay.mjs";

const development = process.argv.includes("--dev");
const production = process.argv.includes("--production");
const portArgument = process.argv.indexOf("--port");
const hostArgument = process.argv.indexOf("--host");
const host = hostArgument === -1 ? "127.0.0.1" : process.argv[hostArgument + 1];
if (!host || host.startsWith("--") || (development && production)) {
  console.error(
    "Provide a valid --host value and choose either --dev or --production.",
  );
  process.exit(1);
}
const port = Number(
  (portArgument === -1 ? undefined : process.argv[portArgument + 1]) ||
    process.env.PORT ||
    (production ? 8080 : development ? 4173 : 4174),
);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(
    "Invalid port. Use --port followed by a number from 1 to 65535.",
  );
  process.exit(1);
}

const root = fileURLToPath(
  new URL(development ? "./src/" : "./dist/", import.meta.url),
);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  if (await handleSmartRequest(request, response)) return;
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }
  let file;
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    file = path.resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    let content = await readFile(file);
    if (development && file === path.join(root, "index.html")) {
      content = Buffer.from(
        content
          .toString("utf8")
          .replace(
            '<script src="app.bundle.js" defer></script>',
            '<script type="module" src="app.js"></script>',
          ),
      );
    }
    response.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Content-Length": content.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    response.writeHead(
      error.code === "ENOENT" || error.code === "EISDIR" ? 404 : 500,
    );
    response.end(
      "Unable to read this file. Run npm run build before previewing.",
    );
  }
});

server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Choose another with --port.`
      : error.message,
  );
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(
    `Frame ${development ? "development" : production ? "production" : "production preview"}: http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`,
  );
  console.log(`Listening on ${host}:${port}`);
  console.log(
    development
      ? "Edit src/ and refresh your browser. Ctrl+C to stop."
      : "Serving dist/. Ctrl+C to stop.",
  );
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close());
