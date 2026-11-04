"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import {
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  ChefHat,
  RefreshCw,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  COMANDA_STATUSES,
  TEST_IDS,
  type ComandaStatus,
  type UserRole,
} from "@/contracts";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import {
  getNotificationPermissionState,
  getPushSupportStatus,
  registerServiceWorker,
  showBrowserNotification,
  subscribeToWebPush,
  type BrowserNotificationPermission,
  type PushSupportStatus,
} from "./push-client";
import {
  initializeSoundPreference,
  installAudioAutoUnlock,
  isAudioUnlocked,
  isSoundEnabled,
  playComandaReadyAlert,
  playNewComandaAlert,
  setSoundEnabled,
  subscribeSoundState,
  unlockAudioContext,
} from "./sound-engine";

export type RealtimeConnectionStatus = "connected" | "reconnecting" | "offline";

export const REALTIME_TRACKED_TABLES = [
  "dining_tables",
  "table_sessions",
  "comandas",
  "products",
] as const;

export type RealtimeTrackedTable = (typeof REALTIME_TRACKED_TABLES)[number];

export type RealtimeSyncReason =
  | "initial_subscribe"
  | "reconnect"
  | "online"
  | "visibility_visible"
  | "realtime_change"
  | "sw_push"
  | "manual";

export interface RealtimeDatabaseChangeEvent {
  table: RealtimeTrackedTable;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  newRecord: Record<string, unknown> | null;
  oldRecord: Record<string, unknown> | null;
  receivedAt: string;
}

export type RealtimeAlertKind = "listo" | "nuevo";

export interface RealtimeAlertNotification {
  id: string;
  kind: RealtimeAlertKind;
  comandaId: string;
  comandaNumber: number;
  tableId: string;
  tableCode: string | null;
  isOwnComanda: boolean;
  title: string;
  message: string;
  createdAt: string;
}

export interface RealtimeContextValue {
  connectionStatus: RealtimeConnectionStatus;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  soundEnabled: boolean;
  audioUnlocked: boolean;
  pushSupport: PushSupportStatus;
  notificationPermission: BrowserNotificationPermission;
  notifications: RealtimeAlertNotification[];
  readyNotificationsCount: number;
  newComandasNotificationsCount: number;
  toggleSound: () => void;
  setSound: (enabled: boolean) => void;
  enableNotifications: () => Promise<void>;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
  requestSync: (reason?: RealtimeSyncReason) => Promise<void>;
  subscribeSync: (listener: (reason: RealtimeSyncReason) => void | Promise<void>) => () => void;
  subscribeTableChanges: (
    listener: (change: RealtimeDatabaseChangeEvent) => void
  ) => () => void;
  registerInlineBanner: () => () => void;
}

export interface RealtimeProviderProps {
  children: React.ReactNode;
  /** Rol activo del operador autenticado (`mozo`, `cocina`, `caja`, `admin`) */
  role?: UserRole | null;
  /** UUID del usuario autenticado (opcional, destaca comandas propias del mozo) */
  userId?: string | null;
  /** Valor inicial de alertas sonoras según `restaurant_settings.sound_alerts_default` */
  defaultSoundEnabled?: boolean;
  /** Si es `true` (por defecto), ejecuta `router.refresh()` con debounce ante cambios y reconexiones */
  autoRefreshRouter?: boolean;
  /** Si es `true`, filtra alertas de `listo` exclusivamente a `comanda.created_by === userId` */
  onlyOwnComandas?: boolean;
  /** Si es `true` (por defecto), muestra automáticamente el banner flotante de alertas si la vista no montó `<RealtimeAlertsBanner />` */
  renderFloatingAlerts?: boolean;
  /** Callback opcional de reconciliación invocado al reconectar, volver al foco o recibir cambios */
  onSyncRequested?: (reason: RealtimeSyncReason) => void | Promise<void>;
  /** Callback opcional para reaccionar de forma granular a eventos de tablas */
  onDatabaseChange?: (event: RealtimeDatabaseChangeEvent) => void;
}

interface ParsedComandaSnapshot {
  id: string;
  comandaNumber: number;
  tableId: string;
  createdBy: string;
  status: ComandaStatus;
}

const VALID_STATUS_SET = new Set<string>(COMANDA_STATUSES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseComandaRecord(raw: unknown): ParsedComandaSnapshot | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : null;
  const status =
    typeof raw.status === "string" && VALID_STATUS_SET.has(raw.status)
      ? (raw.status as ComandaStatus)
      : null;

  if (!id || !status) return null;

  const comandaNumber =
    typeof raw.comanda_number === "number"
      ? raw.comanda_number
      : Number(raw.comanda_number ?? 0) || 0;
  const tableId = typeof raw.table_id === "string" ? raw.table_id : "";
  const createdBy = typeof raw.created_by === "string" ? raw.created_by : "";

  return {
    id,
    comandaNumber,
    tableId,
    createdBy,
    status,
  };
}

function computeBackoffDelayMs(attempt: number): number {
  const baseMs = 1_000;
  const maxMs = 20_000;
  const exp = Math.min(maxMs, baseMs * Math.pow(2, Math.min(attempt, 5)));
  return Math.round(exp * (0.5 + Math.random() * 0.5));
}

const FALLBACK_CONTEXT: RealtimeContextValue = {
  connectionStatus: "connected",
  isSyncing: false,
  lastSyncedAt: null,
  soundEnabled: true,
  audioUnlocked: false,
  pushSupport: "unsupported",
  notificationPermission: "unsupported",
  notifications: [],
  readyNotificationsCount: 0,
  newComandasNotificationsCount: 0,
  toggleSound: () => {},
  setSound: () => {},
  enableNotifications: async () => {},
  dismissNotification: () => {},
  clearNotifications: () => {},
  requestSync: async () => {},
  subscribeSync: () => () => {},
  subscribeTableChanges: () => () => {},
  registerInlineBanner: () => () => {},
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/**
 * Proveedor cliente de Tiempo Real, Reconciliación Post-Corte y Alertas Operativas de Pedidos Flash.
 */
export function RealtimeProvider({
  children,
  role = null,
  userId = null,
  defaultSoundEnabled = true,
  autoRefreshRouter = true,
  onlyOwnComandas = false,
  renderFloatingAlerts = true,
  onSyncRequested,
  onDatabaseChange,
}: RealtimeProviderProps) {
  const router = useRouter();

  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [channelSubscribed, setChannelSubscribed] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() =>
    isSoundEnabled(defaultSoundEnabled)
  );
  const [audioUnlockedState, setAudioUnlockedState] = useState<boolean>(() =>
    isAudioUnlocked()
  );
  const [pushSupport, setPushSupport] = useState<PushSupportStatus>("unsupported");
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationPermission>("unsupported");

  const [notifications, setNotifications] = useState<RealtimeAlertNotification[]>([]);
  const [inlineBannerCount, setInlineBannerCount] = useState<number>(0);

  const onSyncRequestedRef = useRef(onSyncRequested);
  onSyncRequestedRef.current = onSyncRequested;

  const onDatabaseChangeRef = useRef(onDatabaseChange);
  onDatabaseChangeRef.current = onDatabaseChange;

  const roleRef = useRef(role);
  roleRef.current = role;

  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const onlyOwnComandasRef = useRef(onlyOwnComandas);
  onlyOwnComandasRef.current = onlyOwnComandas;

  const syncListenersRef = useRef(
    new Set<(reason: RealtimeSyncReason) => void | Promise<void>>()
  );
  const changeListenersRef = useRef(
    new Set<(change: RealtimeDatabaseChangeEvent) => void>()
  );

  const knownComandaStatusesRef = useRef(new Map<string, ComandaStatus>());
  const tableCodeMapRef = useRef(new Map<string, string>());
  const notifiedTransitionKeysRef = useRef(new Set<string>());
  const initialSeedCompletedRef = useRef<boolean>(false);
  const hasSubscribedOnceRef = useRef<boolean>(false);
  const syncInFlightRef = useRef<boolean>(false);
  const refreshDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connectionStatus: RealtimeConnectionStatus = useMemo(() => {
    if (!isBrowserOnline) return "offline";
    if (channelSubscribed) return "connected";
    return "reconnecting";
  }, [isBrowserOnline, channelSubscribed]);

  const scheduleRouterRefresh = useCallback(() => {
    if (!autoRefreshRouter) return;
    if (refreshDebounceTimerRef.current) {
      clearTimeout(refreshDebounceTimerRef.current);
    }
    refreshDebounceTimerRef.current = setTimeout(() => {
      refreshDebounceTimerRef.current = null;
      router.refresh();
    }, 180);
  }, [autoRefreshRouter, router]);

  const resolveTableCode = useCallback(async (tableId: string): Promise<string | null> => {
    if (!tableId) return null;
    const cached = tableCodeMapRef.current.get(tableId);
    if (cached) return cached;

    try {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase
        .from("dining_tables")
        .select("id, code")
        .eq("id", tableId)
        .maybeSingle();

      if (data && typeof data.code === "string") {
        tableCodeMapRef.current.set(tableId, data.code);
        return data.code;
      }
    } catch {
      // Silencioso si no hay red momentáneamente
    }
    return null;
  }, []);

  const processComandaTransition = useCallback(
    (comanda: ParsedComandaSnapshot, allowAlerts: boolean) => {
      const prevStatus = knownComandaStatusesRef.current.get(comanda.id);
      knownComandaStatusesRef.current.set(comanda.id, comanda.status);

      // Si pasó a entregado, retiramos automáticamente cualquier banner pendiente de esa comanda
      if (comanda.status === "entregado") {
        setNotifications((prev) =>
          prev.filter((item) => item.comandaId !== comanda.id)
        );
        return;
      }

      if (!allowAlerts) {
        if (comanda.status === "nuevo" || comanda.status === "listo") {
          notifiedTransitionKeysRef.current.add(`${comanda.status}:${comanda.id}`);
        }
        return;
      }

      const activeRole = roleRef.current;
      const activeUserId = userIdRef.current;

      // 1. Transición a `nuevo` -> Alerta inmediata para Cocina (KDS)
      if (
        activeRole === "cocina" &&
        comanda.status === "nuevo" &&
        prevStatus !== "nuevo"
      ) {
        const dedupeKey = `nuevo:${comanda.id}`;
        if (notifiedTransitionKeysRef.current.has(dedupeKey)) return;
        notifiedTransitionKeysRef.current.add(dedupeKey);

        const knownCode = tableCodeMapRef.current.get(comanda.tableId) ?? null;
        const label = comanda.comandaNumber > 0 ? `#${comanda.comandaNumber}` : "";
        const title = knownCode
          ? `Nueva comanda ${label} · ${knownCode}`.trim()
          : `Nueva comanda ${label}`.trim();

        const alertItem: RealtimeAlertNotification = {
          id: dedupeKey,
          kind: "nuevo",
          comandaId: comanda.id,
          comandaNumber: comanda.comandaNumber,
          tableId: comanda.tableId,
          tableCode: knownCode,
          isOwnComanda: false,
          title,
          message: "Ingresó un nuevo pedido a la cola de cocina.",
          createdAt: new Date().toISOString(),
        };

        setNotifications((prev) => [
          alertItem,
          ...prev.filter((n) => n.id !== dedupeKey),
        ].slice(0, 12));

        void playNewComandaAlert();
        void showBrowserNotification({
          title,
          body: alertItem.message,
          tag: dedupeKey,
          url: "/cocina",
        });

        if (!knownCode && comanda.tableId) {
          void resolveTableCode(comanda.tableId).then((hydratedCode) => {
            if (!hydratedCode) return;
            setNotifications((prev) =>
              prev.map((n) =>
                n.id === dedupeKey
                  ? {
                      ...n,
                      tableCode: hydratedCode,
                      title: `Nueva comanda ${label} · ${hydratedCode}`.trim(),
                    }
                  : n
              )
            );
          });
        }
      }

      // 2. Transición a `listo` -> Alerta inmediata para Mozo
      if (
        activeRole === "mozo" &&
        comanda.status === "listo" &&
        prevStatus !== "listo"
      ) {
        const isOwn = activeUserId ? comanda.createdBy === activeUserId : true;
        if (onlyOwnComandasRef.current && activeUserId && !isOwn) {
          return;
        }

        const dedupeKey = `listo:${comanda.id}`;
        if (notifiedTransitionKeysRef.current.has(dedupeKey)) return;
        notifiedTransitionKeysRef.current.add(dedupeKey);

        const knownCode = tableCodeMapRef.current.get(comanda.tableId) ?? null;
        const label = comanda.comandaNumber > 0 ? `#${comanda.comandaNumber}` : "";
        const title = knownCode
          ? `¡Pedido listo! ${knownCode} · Comanda ${label}`.trim()
          : `¡Pedido listo! Comanda ${label}`.trim();

        const alertItem: RealtimeAlertNotification = {
          id: dedupeKey,
          kind: "listo",
          comandaId: comanda.id,
          comandaNumber: comanda.comandaNumber,
          tableId: comanda.tableId,
          tableCode: knownCode,
          isOwnComanda: isOwn,
          title,
          message: "Lista en cocina para retirar y entregar en mesa.",
          createdAt: new Date().toISOString(),
        };

        setNotifications((prev) => [
          alertItem,
          ...prev.filter((n) => n.id !== dedupeKey),
        ].slice(0, 12));

        void playComandaReadyAlert();
        void showBrowserNotification({
          title,
          body: alertItem.message,
          tag: dedupeKey,
          url: "/mozo",
        });

        if (!knownCode && comanda.tableId) {
          void resolveTableCode(comanda.tableId).then((hydratedCode) => {
            if (!hydratedCode) return;
            setNotifications((prev) =>
              prev.map((n) =>
                n.id === dedupeKey
                  ? {
                      ...n,
                      tableCode: hydratedCode,
                      title: `¡Pedido listo! ${hydratedCode} · Comanda ${label}`.trim(),
                    }
                  : n
              )
            );
          });
        }
      }
    },
    [resolveTableCode]
  );

  /**
   * Reconcilia contra PostgreSQL el estado actual de mesas y comandas activas,
   * garantizando que ningún pedido ni cambio a `listo` ocurrido durante un microcorte se pierda.
   */
  const reconcileFromPostgres = useCallback(
    async (reason: RealtimeSyncReason) => {
      if (typeof window !== "undefined" && !navigator.onLine) {
        return;
      }
      if (syncInFlightRef.current) {
        return;
      }

      syncInFlightRef.current = true;
      setIsSyncing(true);

      try {
        const supabase = createBrowserSupabaseClient();

        const [tablesRes, comandasRes] = await Promise.all([
          supabase.from("dining_tables").select("id, code"),
          supabase
            .from("comandas")
            .select("id, comanda_number, table_id, created_by, status")
            .in("status", ["nuevo", "recibido", "preparando", "listo"]),
        ]);

        if (Array.isArray(tablesRes.data)) {
          for (const row of tablesRes.data) {
            if (isRecord(row) && typeof row.id === "string" && typeof row.code === "string") {
              tableCodeMapRef.current.set(row.id, row.code);
            }
          }
        }

        if (Array.isArray(comandasRes.data)) {
          const allowCatchupAlerts = initialSeedCompletedRef.current;
          const activeIds = new Set<string>();

          for (const rawRow of comandasRes.data) {
            const parsed = parseComandaRecord(rawRow);
            if (parsed) {
              activeIds.add(parsed.id);
              processComandaTransition(parsed, allowCatchupAlerts);
            }
          }

          // Limpiar notificaciones de comandas que ya fueron entregadas mientras estaba desconectado
          if (allowCatchupAlerts) {
            setNotifications((prev) =>
              prev.filter((item) => activeIds.has(item.comandaId))
            );
          }

          initialSeedCompletedRef.current = true;
        }

        const callbacks: Array<Promise<unknown> | void> = [];
        if (onSyncRequestedRef.current) {
          callbacks.push(onSyncRequestedRef.current(reason));
        }
        for (const listener of syncListenersRef.current) {
          callbacks.push(listener(reason));
        }
        await Promise.allSettled(callbacks);

        if (reason !== "initial_subscribe") {
          scheduleRouterRefresh();
        }

        setLastSyncedAt(new Date().toISOString());
      } catch {
        // La próxima señal de red / backoff volverá a reconciliar
      } finally {
        syncInFlightRef.current = false;
        setIsSyncing(false);
      }
    },
    [processComandaTransition, scheduleRouterRefresh]
  );

  // Inicialización de audio, permisos y Service Worker
  useEffect(() => {
    initializeSoundPreference(defaultSoundEnabled);
    setSoundEnabledState(isSoundEnabled(defaultSoundEnabled));
    setAudioUnlockedState(isAudioUnlocked());
    setPushSupport(getPushSupportStatus());
    setNotificationPermission(getNotificationPermissionState());

    const cleanupAudioUnlock = installAudioAutoUnlock();
    const unsubscribeSound = subscribeSoundState(() => {
      setSoundEnabledState(isSoundEnabled(defaultSoundEnabled));
      setAudioUnlockedState(isAudioUnlocked());
    });

    void registerServiceWorker();

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (!isRecord(event.data)) return;
      if (
        event.data.type === "PF_SW_PUSH_EVENT" ||
        event.data.type === "PF_SW_NOTIFICATION_CLICK"
      ) {
        void reconcileFromPostgres("sw_push");
      }
    };

    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    }

    return () => {
      cleanupAudioUnlock();
      unsubscribeSound();
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener(
          "message",
          handleServiceWorkerMessage
        );
      }
    };
  }, [defaultSoundEnabled, reconcileFromPostgres]);

  // Suscripción principal a Supabase Realtime + Resiliencia ante desconexión y desbloqueo de pantalla
  useEffect(() => {
    if (typeof window === "undefined") return;

    const supabase = createBrowserSupabaseClient();
    let activeChannel: RealtimeChannel | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let disposed = false;

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const teardownChannel = () => {
      if (activeChannel) {
        const ch = activeChannel;
        activeChannel = null;
        void supabase.removeChannel(ch);
      }
    };

    const handlePostgresPayload = (
      table: RealtimeTrackedTable,
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      const newRecord = isRecord(payload.new) ? payload.new : null;
      const oldRecord = isRecord(payload.old) ? payload.old : null;

      if (table === "dining_tables" && newRecord) {
        if (typeof newRecord.id === "string" && typeof newRecord.code === "string") {
          tableCodeMapRef.current.set(newRecord.id, newRecord.code);
        }
      }

      if (table === "comandas" && newRecord) {
        const parsed = parseComandaRecord(newRecord);
        if (parsed) {
          processComandaTransition(parsed, true);
        }
      }

      const changeEvent: RealtimeDatabaseChangeEvent = {
        table,
        eventType: payload.eventType,
        newRecord,
        oldRecord,
        receivedAt: new Date().toISOString(),
      };

      onDatabaseChangeRef.current?.(changeEvent);
      for (const listener of changeListenersRef.current) {
        listener(changeEvent);
      }

      void (async () => {
        const tasks: Array<Promise<unknown> | void> = [];
        if (onSyncRequestedRef.current) {
          tasks.push(onSyncRequestedRef.current("realtime_change"));
        }
        for (const listener of syncListenersRef.current) {
          tasks.push(listener("realtime_change"));
        }
        await Promise.allSettled(tasks);
      })();

      scheduleRouterRefresh();
    };

    const scheduleReconnect = () => {
      if (disposed || !navigator.onLine || reconnectTimer) return;
      const delay = computeBackoffDelayMs(reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!disposed && navigator.onLine) {
          connectChannel();
        }
      }, delay);
    };

    const connectChannel = () => {
      if (disposed) return;
      clearReconnectTimer();
      teardownChannel();

      const channelName = `pf-ops-${role ?? "staff"}-${Date.now()}`;
      let channel = supabase.channel(channelName);

      for (const table of REALTIME_TRACKED_TABLES) {
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
          },
          (payload) => handlePostgresPayload(table, payload)
        );
      }

      activeChannel = channel.subscribe((status) => {
        if (disposed) return;

        if (status === "SUBSCRIBED") {
          reconnectAttempt = 0;
          setChannelSubscribed(true);
          const syncReason: RealtimeSyncReason = hasSubscribedOnceRef.current
            ? "reconnect"
            : "initial_subscribe";
          hasSubscribedOnceRef.current = true;
          void reconcileFromPostgres(syncReason);
          return;
        }

        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setChannelSubscribed(false);
          scheduleReconnect();
        }
      });
    };

    const { data: authSubscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.access_token) {
          supabase.realtime.setAuth(session.access_token);
        }
      }
    );

    const handleOnline = () => {
      setIsBrowserOnline(true);
      reconnectAttempt = 0;
      connectChannel();
      void reconcileFromPostgres("online");
    };

    const handleOffline = () => {
      setIsBrowserOnline(false);
      setChannelSubscribed(false);
      clearReconnectTimer();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      setNotificationPermission(getNotificationPermissionState());
      if (navigator.onLine) {
        if (!activeChannel || activeChannel.state !== "joined") {
          reconnectAttempt = 0;
          connectChannel();
        }
        void reconcileFromPostgres("visibility_visible");
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (navigator.onLine) {
      connectChannel();
    } else {
      setIsBrowserOnline(false);
    }

    return () => {
      disposed = true;
      clearReconnectTimer();
      if (refreshDebounceTimerRef.current) {
        clearTimeout(refreshDebounceTimerRef.current);
      }
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      authSubscription.subscription.unsubscribe();
      teardownChannel();
    };
  }, [processComandaTransition, reconcileFromPostgres, role, scheduleRouterRefresh]);

  const toggleSound = useCallback(() => {
    const next = !isSoundEnabled(defaultSoundEnabled);
    setSoundEnabled(next);
    setSoundEnabledState(next);
    if (next) {
      void unlockAudioContext();
    }
  }, [defaultSoundEnabled]);

  const setSound = useCallback((enabled: boolean) => {
    setSoundEnabled(enabled);
    setSoundEnabledState(enabled);
    if (enabled) {
      void unlockAudioContext();
    }
  }, []);

  const enableNotifications = useCallback(async () => {
    await unlockAudioContext();
    const res = await subscribeToWebPush();
    setPushSupport(getPushSupportStatus());
    setNotificationPermission(res.permission);
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const requestSync = useCallback(
    async (reason: RealtimeSyncReason = "manual") => {
      await reconcileFromPostgres(reason);
    },
    [reconcileFromPostgres]
  );

  const subscribeSync = useCallback(
    (listener: (reason: RealtimeSyncReason) => void | Promise<void>) => {
      syncListenersRef.current.add(listener);
      return () => {
        syncListenersRef.current.delete(listener);
      };
    },
    []
  );

  const subscribeTableChanges = useCallback(
    (listener: (change: RealtimeDatabaseChangeEvent) => void) => {
      changeListenersRef.current.add(listener);
      return () => {
        changeListenersRef.current.delete(listener);
      };
    },
    []
  );

  const registerInlineBanner = useCallback(() => {
    setInlineBannerCount((count) => count + 1);
    return () => {
      setInlineBannerCount((count) => Math.max(0, count - 1));
    };
  }, []);

  const readyNotificationsCount = useMemo(
    () => notifications.filter((n) => n.kind === "listo").length,
    [notifications]
  );

  const newComandasNotificationsCount = useMemo(
    () => notifications.filter((n) => n.kind === "nuevo").length,
    [notifications]
  );

  const contextValue = useMemo<RealtimeContextValue>(
    () => ({
      connectionStatus,
      isSyncing,
      lastSyncedAt,
      soundEnabled,
      audioUnlocked: audioUnlockedState,
      pushSupport,
      notificationPermission,
      notifications,
      readyNotificationsCount,
      newComandasNotificationsCount,
      toggleSound,
      setSound,
      enableNotifications,
      dismissNotification,
      clearNotifications,
      requestSync,
      subscribeSync,
      subscribeTableChanges,
      registerInlineBanner,
    }),
    [
      audioUnlockedState,
      clearNotifications,
      connectionStatus,
      dismissNotification,
      enableNotifications,
      isSyncing,
      lastSyncedAt,
      newComandasNotificationsCount,
      notificationPermission,
      notifications,
      pushSupport,
      readyNotificationsCount,
      registerInlineBanner,
      requestSync,
      setSound,
      soundEnabled,
      subscribeSync,
      subscribeTableChanges,
      toggleSound,
    ]
  );

  return (
    <RealtimeContext.Provider value={contextValue}>
      {children}
      {renderFloatingAlerts && inlineBannerCount === 0 && notifications.length > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-50 mx-auto flex max-w-xl flex-col px-3 sm:px-4">
          <RealtimeAlertsBannerList
            notifications={notifications}
            onDismiss={dismissNotification}
            onClearAll={clearNotifications}
          />
        </div>
      ) : null}
    </RealtimeContext.Provider>
  );
}

/**
 * Hook para acceder al estado de conexión Realtime, alertas activas y controles de audio/notificaciones.
 */
export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext) ?? FALLBACK_CONTEXT;
}

/**
 * Hook para que vistas cliente (Salón, KDS, Caja) registren callbacks de recarga/reconciliación
 * al recibir cambios en tablas específicas o al reconectar tras cortes de red.
 */
export function useRealtimeSync(
  onSync: (reason: RealtimeSyncReason) => void | Promise<void>,
  options?: { tables?: readonly RealtimeTrackedTable[] }
): void {
  const { subscribeSync, subscribeTableChanges } = useRealtime();
  const callbackRef = useRef(onSync);
  callbackRef.current = onSync;

  const tablesKey = options?.tables ? options.tables.join(",") : "*";

  useEffect(() => {
    const allowedTables =
      tablesKey === "*"
        ? null
        : new Set<string>(tablesKey.split(",").filter(Boolean));

    const unsubSync = subscribeSync((reason) => {
      if (reason === "realtime_change" && allowedTables !== null) {
        return;
      }
      return callbackRef.current(reason);
    });

    const unsubTables =
      allowedTables === null
        ? () => {}
        : subscribeTableChanges((change) => {
            if (allowedTables.has(change.table)) {
              void callbackRef.current("realtime_change");
            }
          });

    return () => {
      unsubSync();
      unsubTables();
    };
  }, [subscribeSync, subscribeTableChanges, tablesKey]);
}

interface RealtimeAlertsBannerListProps {
  notifications: RealtimeAlertNotification[];
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  className?: string;
}

function RealtimeAlertsBannerList({
  notifications,
  onDismiss,
  onClearAll,
  className = "",
}: RealtimeAlertsBannerListProps) {
  if (notifications.length === 0) return null;

  const hasReadyNotifications = notifications.some((n) => n.kind === "listo");

  return (
    <section
      role="region"
      aria-live="assertive"
      aria-label="Alertas operativas en tiempo real"
      data-testid={
        hasReadyNotifications
          ? TEST_IDS.MOZO.READY_NOTIFICATION_BANNER
          : "kds-new-notification-banner"
      }
      className={`pointer-events-auto flex flex-col gap-2 ${className}`.trim()}
    >
      {notifications.map((item) => {
        const isReady = item.kind === "listo";
        return (
          <div
            key={item.id}
            className={`flex items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3 shadow-lg transition-all ${
              isReady
                ? "border-[#22C55E] bg-[#DCFCE7] text-[#14532D] dark:bg-[#172033] dark:text-white"
                : "border-[#FF6B35] bg-[#FFF1EB] text-[#172033] dark:bg-[#172033] dark:text-white"
            }`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${
                  isReady ? "bg-[#22C55E]" : "bg-[#FF6B35]"
                }`}
                aria-hidden="true"
              >
                {isReady ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <ChefHat className="h-5 w-5" />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold sm:text-base">
                  {item.title}
                </p>
                <p className="truncate text-xs font-medium opacity-85 sm:text-sm">
                  {item.message}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onDismiss(item.id)}
              aria-label={`Descartar alerta ${item.title}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-black/10 active:scale-95 dark:hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        );
      })}

      {notifications.length > 1 ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClearAll}
            className="rounded-xl bg-[#172033]/90 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-[#172033]"
          >
            Descartar todas ({notifications.length})
          </button>
        </div>
      ) : null}
    </section>
  );
}

export interface RealtimeAlertsBannerProps {
  className?: string;
}

/**
 * Componente embebible para mostrar la lista descartable de alertas activas en el flujo de la página.
 * Al montarse, inhibe automáticamente el overlay flotante del proveedor evitando duplicar `data-testid`.
 */
export function RealtimeAlertsBanner({ className }: RealtimeAlertsBannerProps) {
  const {
    notifications,
    dismissNotification,
    clearNotifications,
    registerInlineBanner,
  } = useRealtime();

  useEffect(() => registerInlineBanner(), [registerInlineBanner]);

  if (notifications.length === 0) return null;

  return (
    <RealtimeAlertsBannerList
      notifications={notifications}
      onDismiss={dismissNotification}
      onClearAll={clearNotifications}
      className={className}
    />
  );
}

export interface ConnectionBadgeProps {
  /** Muestra los controles rápidos de sonido y notificaciones junto al indicador de enlace */
  showControls?: boolean;
  /** Oculta etiquetas secundarias en pantallas muy estrechas */
  compact?: boolean;
  className?: string;
}

/**
 * Indicador claro de estado de conexión en tiempo real (`En línea`, `Reconectando`, `Sin conexión`)
 * con `data-testid={TEST_IDS.CONNECTION.BADGE}` y controles integrados de alertas sonoras y navegador.
 */
export function ConnectionBadge({
  showControls = true,
  compact = false,
  className = "",
}: ConnectionBadgeProps) {
  const {
    connectionStatus,
    isSyncing,
    soundEnabled,
    audioUnlocked,
    notificationPermission,
    toggleSound,
    enableNotifications,
    requestSync,
  } = useRealtime();

  const statusConfig = useMemo(() => {
    if (connectionStatus === "connected") {
      return {
        label: "En línea",
        dotClass: "bg-[#22C55E]",
        pillClass:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        Icon: Wifi,
      };
    }
    if (connectionStatus === "reconnecting") {
      return {
        label: "Reconectando",
        dotClass: "animate-pulse bg-[#F59E0B]",
        pillClass:
          "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300",
        Icon: RefreshCw,
      };
    }
    return {
      label: "Sin conexión",
      dotClass: "bg-[#EF4444]",
      pillClass:
        "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300",
      Icon: WifiOff,
    };
  }, [connectionStatus]);

  const StatusIcon = statusConfig.Icon;

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`.trim()}>
      <button
        type="button"
        onClick={() => void requestSync("manual")}
        data-testid={TEST_IDS.CONNECTION.BADGE}
        data-connection-status={connectionStatus}
        role="status"
        aria-live="polite"
        title="Estado de sincronización en tiempo real (tocá para resincronizar)"
        className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors active:scale-[0.98] ${statusConfig.pillClass}`}
      >
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusConfig.dotClass}`}
          aria-hidden="true"
        />
        <StatusIcon
          className={`h-3.5 w-3.5 shrink-0 ${
            connectionStatus === "reconnecting" || isSyncing ? "animate-spin" : ""
          }`}
          aria-hidden="true"
        />
        <span className={compact ? "sr-only sm:not-sr-only" : ""}>
          {statusConfig.label}
        </span>
      </button>

      {showControls ? (
        <>
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={soundEnabled}
            aria-label={
              soundEnabled
                ? "Alertas sonoras activadas (tocá para silenciar)"
                : "Alertas sonoras silenciadas (tocá para activar)"
            }
            title={
              soundEnabled
                ? audioUnlocked
                  ? "Sonido activo"
                  : "Sonido activo (tocá para habilitar audio del navegador)"
                : "Sonido silenciado"
            }
            className={`relative inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors active:scale-95 ${
              soundEnabled
                ? "border-slate-200 bg-white text-[#172033] hover:bg-slate-50 dark:border-slate-700 dark:bg-[#172033] dark:text-white"
                : "border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500"
            }`}
          >
            {soundEnabled ? (
              <Volume2 className="h-4 w-4 text-[#FF6B35]" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
            {soundEnabled && !audioUnlocked ? (
              <span
                className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#FF6B35]"
                aria-hidden="true"
              />
            ) : null}
          </button>

          {notificationPermission !== "unsupported" ? (
            <button
              type="button"
              onClick={() => void enableNotifications()}
              disabled={notificationPermission === "denied"}
              aria-label={
                notificationPermission === "granted"
                  ? "Notificaciones del navegador activas"
                  : notificationPermission === "denied"
                    ? "Notificaciones bloqueadas en el navegador"
                    : "Activar notificaciones del navegador"
              }
              title={
                notificationPermission === "granted"
                  ? "Avisos del sistema activos"
                  : notificationPermission === "denied"
                    ? "Permiso de notificaciones denegado en ajustes del navegador"
                    : "Activar avisos del navegador / Web Push"
              }
              className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors active:scale-95 ${
                notificationPermission === "granted"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-[#22C55E]"
                  : notificationPermission === "denied"
                    ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 opacity-60 dark:border-slate-800 dark:bg-slate-900"
                    : "border-slate-200 bg-white text-[#172033] hover:bg-slate-50 dark:border-slate-700 dark:bg-[#172033] dark:text-white"
              }`}
            >
              {notificationPermission === "granted" ? (
                <BellRing className="h-4 w-4" />
              ) : notificationPermission === "denied" ? (
                <BellOff className="h-4 w-4" />
              ) : (
                <Bell className="h-4 w-4" />
              )}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
