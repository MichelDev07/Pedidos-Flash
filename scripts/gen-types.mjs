import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outPath = resolve(process.cwd(), "src/types/database.types.ts");
mkdirSync(dirname(outPath), { recursive: true });
const output = execSync("npx supabase gen types typescript --local --schema public", {
  encoding: "utf8",
});
writeFileSync(outPath, output, { encoding: "utf8" });
console.log("Tipos generados en src/types/database.types.ts");
