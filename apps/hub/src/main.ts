import { run } from "./index.js";

run(process.argv.slice(2), (line) => console.log(line)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(`hub: ${(error as Error).message}`);
    process.exit(1);
  },
);
