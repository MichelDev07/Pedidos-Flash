import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");

function main() {
  const raw = execSync("npx supabase status -o json", { encoding: "utf8" });
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`No se pudo parsear salida JSON de supabase status: ${raw}`);
  }
  const status = JSON.parse(raw.slice(jsonStart));

  const apiUrl = (status.API_URL || "http://127.0.0.1:54321").replace("localhost", "127.0.0.1");
  const anonKey = status.ANON_KEY || status.PUBLISHABLE_KEY;
  const serviceRoleKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;

  if (!anonKey || !serviceRoleKey) {
    throw new Error("Faltan ANON_KEY o SERVICE_ROLE_KEY en supabase status");
  }

  let vapidPublic = "";
  let vapidPrivate = "";

  if (existsSync(envPath)) {
    const existing = readFileSync(envPath, "utf8");
    const pubMatch = existing.match(/^NEXT_PUBLIC_VAPID_PUBLIC_KEY=(.+)$/m);
    const privMatch = existing.match(/^VAPID_PRIVATE_KEY=(.+)$/m);
    if (pubMatch?.[1] && privMatch?.[1]) {
      vapidPublic = pubMatch[1].trim();
      vapidPrivate = privMatch[1].trim();
    }
  }

  if (!vapidPublic || !vapidPrivate) {
    try {
      const webpush = awaitImportWebPush();
      if (webpush) {
        const keys = webpush.generateVAPIDKeys();
        vapidPublic = keys.publicKey;
        vapidPrivate = keys.privateKey;
      }
    } catch {
      // Se generará luego si web-push aún no está instalado
    }
  }

  const content = [
    "# Autogenerado para desarrollo local (ignorado en Git)",
    "NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000",
    `NEXT_PUBLIC_SUPABASE_URL=${apiUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
    `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapidPublic}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`,
    `VAPID_PRIVATE_KEY=${vapidPrivate}`,
    "VAPID_SUBJECT=mailto:soporte@pedidosflash.local",
    "",
  ].join("\n");

  writeFileSync(envPath, content, { encoding: "utf8" });
  console.log("Archivo .env.local configurado exitosamente para Supabase local.");
}

function awaitImportWebPush() {
  try {
    return require("web-push");
  } catch {
    return null;
  }
}

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
main();
