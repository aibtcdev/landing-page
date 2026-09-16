import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const hiroMessage =
  "Direct Hiro API URL not allowed. Use stacksApiFetch() from lib/stacks-api-fetch.ts with STACKS_API_BASE / STACKS_API_TESTNET_BASE from lib/identity/constants.ts.";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    ".claude/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    "cloudflare-env.d.ts",
  ]),
  {
    // eslint-config-next 16 ships eslint-plugin-react-hooks 7, whose
    // recommended set adds React Compiler rules as errors. Existing code
    // predates them, so they report as warnings until addressed separately.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/error-boundaries": "warn",
    },
  },
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/api(?:\\.mainnet|\\.testnet)?\\.hiro\\.so/]",
          message: hiroMessage,
        },
        {
          selector:
            "TemplateLiteral > TemplateElement[value.raw=/api(?:\\.mainnet|\\.testnet)?\\.hiro\\.so/]",
          message: hiroMessage,
        },
      ],
    },
  },
  {
    files: [
      "lib/stacks-api-fetch.ts",
      "lib/identity/constants.ts",
      "lib/**/__tests__/**/*.ts",
      "lib/**/__tests__/**/*.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["lib/**/*.ts", "lib/**/*.tsx"],
    rules: {
      "no-console": "error",
    },
  },
  {
    files: [
      "lib/logging.ts",
      "lib/**/__tests__/**/*.ts",
      "lib/**/__tests__/**/*.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
      "lib/admin/auth.ts",
      "lib/agent-lookup.ts",
      "lib/bitcoin-verify.ts",
      "lib/d1/agents-mirror.ts",
      "lib/competition/d1-reads.ts",
      "lib/competition/stats.ts",
      "lib/challenge.ts",
      "lib/achievements/kv.ts",
      "lib/heartbeat/kv-helpers.ts",
      "lib/inbox/kv-helpers.ts",
      "lib/vouch/kv-helpers.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
]);
