import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits a self-contained server with only the traced modules, so the runtime
  // image needs no node_modules of its own. Without this the web image would
  // have to carry the whole monorepo dependency tree.
  output: "standalone",

  // Tracing walks up to the workspace root to collect what the server needs.
  outputFileTracingRoot: path.join(__dirname, "..", ".."),

  turbopack: {
    // Pin the workspace root (multiple lockfiles exist above this dir).
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
