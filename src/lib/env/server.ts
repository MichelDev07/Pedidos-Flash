import "server-only";
import { z } from "zod";
import { getClientEnv } from "./client";

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  VAPID_SUBJECT: z.string().optional().default("mailto:soporte@pedidosflash.local"),
});

export type ServerEnv = ReturnType<typeof getClientEnv> & z.infer<typeof serverEnvSchema>;

let cachedServerEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;
  const client = getClientEnv();
  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || "",
    VAPID_SUBJECT: process.env.VAPID_SUBJECT || "mailto:soporte@pedidosflash.local",
  });

  if (!parsed.success) {
    throw new Error(
      `Variables de entorno de servidor inválidas: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ")}`
    );
  }

  cachedServerEnv = { ...client, ...parsed.data };
  return cachedServerEnv;
}
