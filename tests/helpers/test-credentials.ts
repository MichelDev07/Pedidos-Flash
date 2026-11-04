import { ROLE_HOME_ROUTES, type UserRole } from "@/contracts/domain";

/**
 * Credenciales exclusivamente ficticias del dataset semilla (`supabase/seed.sql`)
 * destinadas a pruebas locales e integración/E2E contra Supabase CLI local.
 */
export const TEST_PASSWORD = "Flash123!" as const;

export interface SeedTestCredential {
  readonly email: string;
  readonly password: typeof TEST_PASSWORD;
  readonly role: UserRole;
  readonly homeRoute: string;
  readonly label: string;
}

export const TEST_CREDENTIALS = {
  admin: {
    email: "admin@pedidosflash.local",
    password: TEST_PASSWORD,
    role: "admin",
    homeRoute: ROLE_HOME_ROUTES.admin,
    label: "Administrador QA",
  },
  mozo: {
    email: "mozo@pedidosflash.local",
    password: TEST_PASSWORD,
    role: "mozo",
    homeRoute: ROLE_HOME_ROUTES.mozo,
    label: "Mozo 1 QA",
  },
  mozo2: {
    email: "mozo2@pedidosflash.local",
    password: TEST_PASSWORD,
    role: "mozo",
    homeRoute: ROLE_HOME_ROUTES.mozo,
    label: "Mozo 2 QA",
  },
  cocina: {
    email: "cocina@pedidosflash.local",
    password: TEST_PASSWORD,
    role: "cocina",
    homeRoute: ROLE_HOME_ROUTES.cocina,
    label: "Cocina KDS QA",
  },
  caja: {
    email: "caja@pedidosflash.local",
    password: TEST_PASSWORD,
    role: "caja",
    homeRoute: ROLE_HOME_ROUTES.caja,
    label: "Caja POS QA",
  },
} as const satisfies Record<string, SeedTestCredential>;

export type TestAccountKey = keyof typeof TEST_CREDENTIALS;

export function getTestCredentialByRole(role: UserRole): SeedTestCredential {
  switch (role) {
    case "admin":
      return TEST_CREDENTIALS.admin;
    case "mozo":
      return TEST_CREDENTIALS.mozo;
    case "cocina":
      return TEST_CREDENTIALS.cocina;
    case "caja":
      return TEST_CREDENTIALS.caja;
  }
}
