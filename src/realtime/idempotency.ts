const STORAGE_PREFIX = "pf:idempotency:v1:";
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const memoryDraftKeys = new Map<string, string>();
const inFlightLocks = new Set<string>();

function normalizeScopeKey(draftScope: string): string {
  const trimmed = draftScope.trim();
  if (!trimmed) {
    throw new Error("El identificador de borrador (draftScope) no puede estar vacío.");
  }
  return `${STORAGE_PREFIX}${trimmed}`;
}

function readPersistedKey(storageKey: string): string | null {
  if (typeof window !== "undefined") {
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      if (stored && UUID_V4_REGEX.test(stored)) {
        return stored;
      }
    } catch {
      // Fallback a memoria si sessionStorage está restringido (modo privado estricto / iframe)
    }
  }
  const fromMemory = memoryDraftKeys.get(storageKey);
  return fromMemory && UUID_V4_REGEX.test(fromMemory) ? fromMemory : null;
}

function writePersistedKey(storageKey: string, uuid: string): void {
  memoryDraftKeys.set(storageKey, uuid);
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(storageKey, uuid);
    } catch {
      // La copia en memoria mantiene la garantía durante la vida de la pestaña
    }
  }
}

function deletePersistedKey(storageKey: string): void {
  memoryDraftKeys.delete(storageKey);
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // Ignorar errores de acceso a almacenamiento
    }
  }
}

/**
 * Genera un UUID v4 criptográficamente seguro.
 * Usa `crypto.randomUUID()` cuando está disponible y cae con gracia a `crypto.getRandomValues`
 * en contextos HTTP de red local (ej. tablets/celulares conectando por IP LAN del restaurante).
 */
export function generateIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 sección 4.4 (versión 4 + variante 10xx)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Obtiene la `idempotency_key` activa para un borrador específico (ej. `comanda:${sessionId}`)
 * o crea y persiste una nueva si todavía no existe.
 * Reintentos ante cortes de red reutilizan exactamente la misma clave evitando duplicados en PostgreSQL.
 */
export function getOrCreateDraftIdempotencyKey(draftScope: string): string {
  const storageKey = normalizeScopeKey(draftScope);
  const existing = readPersistedKey(storageKey);
  if (existing) {
    return existing;
  }

  const fresh = generateIdempotencyKey();
  writePersistedKey(storageKey, fresh);
  return fresh;
}

/**
 * Limpia la clave de idempotencia asociada a un borrador una vez confirmada la operación.
 */
export function clearDraftIdempotencyKey(draftScope: string): void {
  const storageKey = normalizeScopeKey(draftScope);
  deletePersistedKey(storageKey);
}

/**
 * Fuerza la rotación a una nueva `idempotency_key` para el siguiente envío en el mismo ámbito
 * (por ejemplo, luego de enviar con éxito una ronda y empezar una ronda adicional en la misma mesa).
 */
export function rotateDraftIdempotencyKey(draftScope: string): string {
  const storageKey = normalizeScopeKey(draftScope);
  const next = generateIdempotencyKey();
  writePersistedKey(storageKey, next);
  return next;
}

/**
 * Consume la clave actual (limpiándola del almacenamiento) y devuelve el valor consumido.
 */
export function consumeDraftIdempotencyKey(draftScope: string): string {
  const current = getOrCreateDraftIdempotencyKey(draftScope);
  clearDraftIdempotencyKey(draftScope);
  return current;
}

/**
 * Indica si una operación identificada por `lockScope` ya se encuentra en vuelo en memoria.
 */
export function isActionInFlight(lockScope: string): boolean {
  return inFlightLocks.has(normalizeScopeKey(lockScope));
}

/**
 * Adquiere síncronamente un cerrojo en memoria para impedir dobles pulsaciones en el mismo frame.
 * Devuelve `true` si adquirió el cerrojo, `false` si la acción ya estaba en curso.
 */
export function acquireActionLock(lockScope: string): boolean {
  const key = normalizeScopeKey(lockScope);
  if (inFlightLocks.has(key)) {
    return false;
  }
  inFlightLocks.add(key);
  return true;
}

/**
 * Libera el cerrojo en memoria de una acción finalizada.
 */
export function releaseActionLock(lockScope: string): void {
  inFlightLocks.delete(normalizeScopeKey(lockScope));
}

/**
 * Limpia todos los cerrojos en memoria (útil para suites de testing unitario).
 */
export function clearAllActionLocks(): void {
  inFlightLocks.clear();
}

export interface RunIdempotentActionOptions<TResult> {
  /** Identificador único del borrador/operación (ej. `comanda:${tableSessionId}`) */
  scope: string;
  /** Función asíncrona que recibe la `idempotency_key` estable del borrador */
  action: (idempotencyKey: string) => Promise<TResult>;
  /**
   * Determina si el resultado confirma que el borrador debe limpiar/rotar su clave.
   * Por defecto limpia cuando la promesa resuelve salvo que retorne `{ ok: false }` sin código de validación definitivo.
   */
  shouldClearDraftKey?: (result: TResult) => boolean;
}

export type RunIdempotentActionOutcome<TResult> =
  | {
      executed: true;
      idempotencyKey: string;
      result: TResult;
    }
  | {
      executed: false;
      idempotencyKey: string;
    };

function defaultShouldClearKey<TResult>(result: TResult): boolean {
  if (typeof result === "object" && result !== null && "ok" in result) {
    const maybeActionResult = result as { ok?: unknown };
    return maybeActionResult.ok === true;
  }
  return true;
}

/**
 * Ejecuta una mutación protegiéndola simultáneamente contra:
 * 1. Doble tap / pulsaciones repetidas concurrentes en UI (`inFlightLocks` síncrono).
 * 2. Reenvíos duplicados en redes lentas: conserva la misma `idempotency_key` si la red falla
 *    y la limpia únicamente cuando la operación concluye con éxito.
 */
export async function runIdempotentAction<TResult>(
  options: RunIdempotentActionOptions<TResult>
): Promise<RunIdempotentActionOutcome<TResult>> {
  const { scope, action, shouldClearDraftKey = defaultShouldClearKey } = options;
  const idempotencyKey = getOrCreateDraftIdempotencyKey(scope);

  if (!acquireActionLock(scope)) {
    return {
      executed: false,
      idempotencyKey,
    };
  }

  try {
    const result = await action(idempotencyKey);
    if (shouldClearDraftKey(result)) {
      clearDraftIdempotencyKey(scope);
    }
    return {
      executed: true,
      idempotencyKey,
      result,
    };
  } finally {
    releaseActionLock(scope);
  }
}
