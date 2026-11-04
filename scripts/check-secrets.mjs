import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd(), "src");
const forbiddenInClient = ["SUPABASE_SERVICE_ROLE_KEY", "VAPID_PRIVATE_KEY"];
const violations = [];

function scanDir(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      scanDir(full);
      continue;
    }
    if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
    const content = readFileSync(full, "utf8");
    const isClientComponent =
      content.includes('"use client"') || content.includes("'use client'");
    if (isClientComponent) {
      for (const secret of forbiddenInClient) {
        if (content.includes(secret)) {
          violations.push(`${full}: referencia prohibida a ${secret} en componente cliente`);
        }
      }
      if (content.includes("lib/env/server") || content.includes("lib/supabase/admin")) {
        violations.push(`${full}: importación de módulo exclusivo de servidor en cliente`);
      }
    }
    if (content.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE")) {
      violations.push(`${full}: variable prohibida NEXT_PUBLIC_SUPABASE_SERVICE_ROLE*`);
    }
  }
}

scanDir(root);
if (violations.length > 0) {
  console.error("Violaciones de seguridad detectadas:\n" + violations.join("\n"));
  process.exit(1);
}
console.log("Verificación de seguridad superada: 0 secretos expuestos al cliente.");
