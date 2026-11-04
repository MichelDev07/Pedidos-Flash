import { describe, expect, it } from "vitest";
import {
  COMANDA_STATUSES,
  ROLE_HOME_ROUTES,
  USER_ROLES,
  VALID_COMANDA_TRANSITIONS,
  canRoleAccessPath,
  canTransitionComandaStatus,
  type ComandaStatus,
  type UserRole,
} from "@/contracts/domain";
import { TEST_CREDENTIALS, getTestCredentialByRole } from "../helpers/test-credentials";

describe("contracts/domain — RBAC de rutas (canRoleAccessPath)", () => {
  it("permite a cada rol acceder a su propia ruta de inicio (ROLE_HOME_ROUTES)", () => {
    for (const role of USER_ROLES) {
      expect(canRoleAccessPath(role, ROLE_HOME_ROUTES[role])).toBe(true);
    }
  });

  it("otorga a 'admin' acceso transversal a /admin y a todas las vistas operativas", () => {
    const allPaths = [
      "/",
      "/admin",
      "/admin/productos",
      "/admin/mesas",
      "/admin/usuarios",
      "/mozo",
      "/mozo/mesas/M1",
      "/cocina",
      "/cocina/historial",
      "/caja",
      "/caja/cobro/123",
    ];

    for (const pathname of allPaths) {
      expect(canRoleAccessPath("admin", pathname)).toBe(true);
    }
  });

  it("bloquea estrictamente a 'mozo', 'cocina' y 'caja' de acceder a /admin y subrutas (TC-10)", () => {
    const nonAdminRoles: UserRole[] = ["mozo", "cocina", "caja"];
    const adminPaths = ["/admin", "/admin/productos", "/admin/mesas", "/admin/usuarios"];

    for (const role of nonAdminRoles) {
      for (const adminPath of adminPaths) {
        expect(canRoleAccessPath(role, adminPath)).toBe(false);
      }
    }
  });

  it("aísla cada módulo operativo entre roles no administrativos", () => {
    // Mozo solo entra a /mozo (y rutas públicas compartidas como /login), no a /cocina ni /caja
    expect(canRoleAccessPath("mozo", "/mozo")).toBe(true);
    expect(canRoleAccessPath("mozo", "/mozo/sesion/abc")).toBe(true);
    expect(canRoleAccessPath("mozo", "/cocina")).toBe(false);
    expect(canRoleAccessPath("mozo", "/caja")).toBe(false);
    expect(canRoleAccessPath("mozo", "/login")).toBe(true);

    // Cocina solo entra a /cocina
    expect(canRoleAccessPath("cocina", "/cocina")).toBe(true);
    expect(canRoleAccessPath("cocina", "/cocina/kds")).toBe(true);
    expect(canRoleAccessPath("cocina", "/mozo")).toBe(false);
    expect(canRoleAccessPath("cocina", "/caja")).toBe(false);

    // Caja solo entra a /caja
    expect(canRoleAccessPath("caja", "/caja")).toBe(true);
    expect(canRoleAccessPath("caja", "/caja/pagos")).toBe(true);
    expect(canRoleAccessPath("caja", "/mozo")).toBe(false);
    expect(canRoleAccessPath("caja", "/cocina")).toBe(false);
  });

  it("mantiene alineadas las credenciales semilla de prueba con los roles y rutas del dominio", () => {
    for (const role of USER_ROLES) {
      const cred = getTestCredentialByRole(role);
      expect(cred.role).toBe(role);
      expect(canRoleAccessPath(cred.role, cred.homeRoute)).toBe(true);
    }
    expect(TEST_CREDENTIALS.mozo2.role).toBe("mozo");
    expect(canRoleAccessPath(TEST_CREDENTIALS.mozo2.role, "/admin")).toBe(false);
  });
});

describe("contracts/domain — máquina de estados de comanda (canTransitionComandaStatus)", () => {
  it("permite la secuencia completa 'nuevo -> recibido -> preparando -> listo -> entregado' con roles válidos", () => {
    // Etapa KDS Cocina / Admin
    expect(canTransitionComandaStatus("nuevo", "recibido", "cocina")).toBe(true);
    expect(canTransitionComandaStatus("nuevo", "preparando", "cocina")).toBe(true);
    expect(canTransitionComandaStatus("recibido", "preparando", "cocina")).toBe(true);
    expect(canTransitionComandaStatus("recibido", "listo", "cocina")).toBe(true);
    expect(canTransitionComandaStatus("preparando", "listo", "cocina")).toBe(true);

    // Admin también puede operar cualquier transición válida del grafo
    expect(canTransitionComandaStatus("nuevo", "recibido", "admin")).toBe(true);
    expect(canTransitionComandaStatus("recibido", "preparando", "admin")).toBe(true);
    expect(canTransitionComandaStatus("preparando", "listo", "admin")).toBe(true);
    expect(canTransitionComandaStatus("listo", "entregado", "admin")).toBe(true);

    // Entrega a la mesa: permitida para mozo, cocina y admin
    expect(canTransitionComandaStatus("listo", "entregado", "mozo")).toBe(true);
    expect(canTransitionComandaStatus("listo", "entregado", "cocina")).toBe(true);
  });

  it("impide que 'mozo' avance estados exclusivos de cocina y que 'caja' mute estados de comanda", () => {
    expect(canTransitionComandaStatus("nuevo", "recibido", "mozo")).toBe(false);
    expect(canTransitionComandaStatus("nuevo", "preparando", "mozo")).toBe(false);
    expect(canTransitionComandaStatus("recibido", "preparando", "mozo")).toBe(false);
    expect(canTransitionComandaStatus("recibido", "listo", "mozo")).toBe(false);
    expect(canTransitionComandaStatus("preparando", "listo", "mozo")).toBe(false);

    for (const from of COMANDA_STATUSES) {
      for (const to of COMANDA_STATUSES) {
        expect(canTransitionComandaStatus(from, to, "caja")).toBe(false);
      }
    }
  });

  it("rechaza transiciones inválidas, retrocesos, saltos prohibidos y auto-transiciones incluso para 'admin'", () => {
    const invalidPairs: Array<[ComandaStatus, ComandaStatus]> = [
      // Auto-transiciones
      ["nuevo", "nuevo"],
      ["recibido", "recibido"],
      ["preparando", "preparando"],
      ["listo", "listo"],
      ["entregado", "entregado"],
      // Saltos prohibidos hacia adelante
      ["nuevo", "listo"],
      ["nuevo", "entregado"],
      ["recibido", "entregado"],
      ["preparando", "entregado"],
      // Retrocesos hacia atrás
      ["recibido", "nuevo"],
      ["preparando", "recibido"],
      ["preparando", "nuevo"],
      ["listo", "preparando"],
      ["listo", "recibido"],
      ["entregado", "listo"],
      ["entregado", "preparando"],
      ["entregado", "nuevo"],
    ];

    expect(VALID_COMANDA_TRANSITIONS.entregado).toEqual([]);

    for (const [from, to] of invalidPairs) {
      for (const role of USER_ROLES) {
        expect(canTransitionComandaStatus(from, to, role)).toBe(false);
      }
    }
  });
});
