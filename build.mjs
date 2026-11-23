import { readFile, writeFile, copyFile, mkdir, cp, unlink, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("./", import.meta.url);
const sitesBuild = process.argv.includes("--sites");
const dist = new URL("dist/", root);
const browserOutput = sitesBuild ? new URL("client/", dist) : dist;
const browserFiles = [
  "index.html",
  "styles.css",
  "chat.css",
  "mix.css",
  "smart.css",
  "icon.svg",
];
const modules = [
  "undo-history",
  "media",
  "prores-export",
  "video-export",
  "video",
  "chat-model",
  "chat-renderer",
  "chat-ui",
  "mix-model",
  "video-join",
  "mix-preview",
  "mix-ui",
  "smart-model",
  "smart-media",
  "smart-optimize",
  "smart-ai",
  "smart-ui",
];
const bindings = new Map();
function connectImports(code) {
  return code.replace(
    /^import\s*\{([\s\S]*?)\}\s*from\s+["']\.\/([^"']+)\.js["'];?/gm,
    (_, names, dependency) => {
      if (!bindings.has(dependency))
        throw new Error(
          `Unknown or unordered module dependency: ${dependency}`,
        );
      return `const {${names}} = ${bindings.get(dependency)};`;
    },
  );
}
await mkdir(browserOutput, { recursive: true });
await cp(new URL("src/vendor/", root), new URL("vendor/", browserOutput), {
  recursive: true,
});
await copyFile(
  new URL("THIRD_PARTY_NOTICES.txt", root),
  new URL("THIRD_PARTY_NOTICES.txt", browserOutput),
);
for (const file of browserFiles)
  await copyFile(new URL(`src/${file}`, root), new URL(file, browserOutput));
let bundle =
  "/* Frame Studio · browser-local tools; media library bundled alongside */\n";
for (const name of modules) {
  const code = await readFile(new URL(`src/${name}.js`, root), "utf8");
  const exports = [
    ...code.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm,
    ),
  ].map((match) => match[1]);
  const binding = name.replace(/-/g, "_") + "Module";
  bundle += `const ${binding} = (() => {\n${connectImports(code).replace(/^export\s+/gm, "")}\nreturn { ${exports.join(", ")} };\n})();\n`;
  bindings.set(name, binding);
}
const app = connectImports(await readFile(new URL("src/app.js", root), "utf8"));
bundle += `(() => {\n${app}\n})();\n`;
await writeFile(new URL("app.bundle.js", browserOutput), bundle);
console.log(
  `Built ${fileURLToPath(new URL("app.bundle.js", browserOutput))} (${Buffer.byteLength(bundle)} bytes)`,
);

const wasmURL = new URL("vendor/ffmpeg/ffmpeg-core.wasm", browserOutput);
const wasmBytes = await readFile(wasmURL);
const chunkSize = 16 * 1024 * 1024;
for (let index = 0; index < 2; index++) {
  await writeFile(new URL(`vendor/ffmpeg/ffmpeg-core.wasm.part${index}`, browserOutput), wasmBytes.subarray(index * chunkSize, (index + 1) * chunkSize));
}
await unlink(wasmURL);

if (sitesBuild) {
  const serverOutput = new URL("server/", dist);
  await mkdir(serverOutput, { recursive: true });
  for (const file of ["index.js", "smart-relay-core.mjs"])
    await copyFile(new URL(`worker/${file}`, root), new URL(file, serverOutput));
  await writeFile(new URL("wrangler.json", serverOutput), JSON.stringify({
    main: "index.js",
    compatibility_date: "2026-01-01",
    assets: { directory: "../client", binding: "ASSETS" },
  }, null, 2) + "\n");

  // Older static Site builds emitted the same assets directly under dist/.
  for (const entry of [...browserFiles, "app.bundle.js", "THIRD_PARTY_NOTICES.txt", "vendor/"])
    await rm(new URL(entry, dist), { recursive: true, force: true });
}
