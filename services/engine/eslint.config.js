import { config } from "@repo/eslint-config/base";

const RESTRICTED = {
  bullmq: "domain/ is the pure core — keep BullMQ in the shell.",
  ioredis: "domain/ is the pure core — keep Redis in the shell.",
  "@repo/db": "domain/ must not touch Prisma. Convert at the edges.",
};

const restrict = (names) => [
  "error",
  { paths: names.map((name) => ({ name, message: RESTRICTED[name] })) },
];

export default [
  ...config,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": restrict(["bullmq", "ioredis", "@repo/db"]),
    },
  },
];
