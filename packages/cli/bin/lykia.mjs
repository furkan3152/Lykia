#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`lykia: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
