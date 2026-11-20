import { readFile, writeFile, copyFile, mkdir, cp, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("./", import.meta.url);
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
await mkdir(new URL("dist/", root), { recursive: true });
await cp(new URL("src/vendor/", root), new URL("dist/vendor/", root), {
  recursive: true,
});
await copyFile(
  new URL("THIRD_PARTY_NOTICES.txt", root),
  new URL("dist/THIRD_PARTY_NOTICES.txt", root),
);
for (const file of [
  "index.html",
  "styles.css",
  "chat.css",
  "mix.css",
  "smart.css",
  "icon.svg",
])
  await copyFile(new URL(`src/${file}`, root), new URL(`dist/${file}`, root));
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
await writeFile(new URL("dist/app.bundle.js", root), bundle);
console.log(
  `Built ${fileURLToPath(new URL("dist/app.bundle.js", root))} (${Buffer.byteLength(bundle)} bytes)`,
);

const wasmURL = new URL("dist/vendor/ffmpeg/ffmpeg-core.wasm", root);
const wasmBytes = await readFile(wasmURL);
const chunkSize = 16 * 1024 * 1024;
for (let index = 0; index < 2; index++) {
  await writeFile(new URL(`dist/vendor/ffmpeg/ffmpeg-core.wasm.part${index}`, root), wasmBytes.subarray(index * chunkSize, (index + 1) * chunkSize));
}
await unlink(wasmURL);
