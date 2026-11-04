"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type {
  ActionResult,
  Category,
  DiningTable,
  Product,
  RestaurantSettings,
  Sector,
  UserProfile,
} from "@/contracts/domain";
import { CURRENCY_CONFIG } from "@/contracts/money";
import { RPC_NAMES } from "@/contracts/rpc";
import {
  createStaffUserSchema,
  updateRestaurantSettingsSchema,
  updateStaffUserSchema,
  upsertCategorySchema,
  upsertDiningTableSchema,
  upsertProductSchema,
  upsertSectorSchema,
} from "@/contracts/schemas";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  mapUserProfileRow,
  requireRole,
  requireRoleWithClient,
} from "@/server/auth/session";
import {
  mapCategory,
  mapDiningTable,
  mapProduct,
  mapRestaurantSettings,
  mapSector,
} from "@/server/queries/_mappers";
import {
  extractPostgrestError,
  handleActionError,
  validationFailure,
} from "./_helpers";

const toggleProductAvailabilityInputSchema = z.object({
  productId: z.string().uuid("Producto inválido"),
  isAvailable: z.boolean().optional(),
});

function buildSlug(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "categoria";
}

export async function upsertCategoryAction(
  input: unknown
): Promise<ActionResult<Category>> {
  try {
    const parsed = upsertCategorySchema.safeParse(input);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { supabase } = await requireRoleWithClient(["admin"]);
    const baseSlug = buildSlug(parsed.data.name);

    // Evitar colisiones de slug único con otras categorías
    let finalSlug = baseSlug;
    const { data: colliding } = await supabase
      .from("categories")
      .select("id, slug")
      .eq("slug", baseSlug)
      .maybeSingle();

    if (
      colliding &&
      typeof colliding.id === "string" &&
      colliding.id !== parsed.data.id
    ) {
      finalSlug = `${baseSlug}-${Date.now().toString(36).slice(-4)}`;
    }

    if (parsed.data.id) {
      const { data, error } = await supabase
        .from("categories")
        .update({
          name: parsed.data.name,
          slug: finalSlug,
          sort_order: parsed.data.sortOrder,
          is_active: parsed.data.isActive,
        })
        .eq("id", parsed.data.id)
        .select("*")
        .single();

      if (error) {
        return {
          ok: false,
          ...extractPostgrestError(error, "No se pudo actualizar la categoría."),
        };
      }

      revalidatePath("/admin");
      revalidatePath("/mozo");
      revalidatePath("/cocina");

      return {
        ok: true,
        data: mapCategory(data as Record<string, unknown>),
      };
    }

    const { data, error } = await supabase
      .from("categories")
      .insert({
        name: parsed.data.name,
        slug: finalSlug,
        sort_order: parsed.data.sortOrder,
        is_active: parsed.data.isActive,
      })
      .select("*")
      .single();

    if (error) {
      return {
        ok: false,
        ...extractPostgrestError(error, "No se pudo crear la categoría."),
      };
    }

    revalidatePath("/admin");
    revalidatePath("/mozo");
    revalidatePath("/cocina");

    return {
      ok: true,
      data: mapCategory(data as Record<string, unknown>),
    };
  } catch (err) {
    return handleActionError(err, "Error al guardar la categoría.");
  }
}

export async function upsertProductAction(
  input: unknown
): Promise<ActionResult<Product>> {
  try {
    const parsed = upsertProductSchema.safeParse(input);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { supabase } = await requireRoleWithClient(["admin"]);

    const payload = {
      category_id: parsed.data.categoryId,
      name: parsed.data.name,
      description: parsed.data.description?.trim() || null,
      price_amount: parsed.data.priceAmount,
      image_url: parsed.data.imageUrl?.trim() ? parsed.data.imageUrl.trim() : null,
      is_available: parsed.data.isAvailable,
      is_active: parsed.data.isActive,
      updated_at: new Date().toISOString(),
    };

    if (parsed.data.id) {
      const { data, error } = await supabase
        .from("products")
        .update(payload)
        .eq("id", parsed.data.id)
        .select("*")
        .single();

      if (error) {
        return {
          ok: false,
          ...extractPostgrestError(error, "No se pudo actualizar el producto."),
        };
      }

      revalidatePath("/admin");
      revalidatePath("/mozo");
      revalidatePath("/cocina");

      return {
        ok: true,
        data: mapProduct(data as Record<string, unknown>),
      };
    }

    const { data, error } = await supabase
      .from("products")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      return {
        ok: false,
        ...extractPostgrestError(error, "No se pudo crear el producto."),
      };
    }

    revalidatePath("/admin");
    revalidatePath("/mozo");
    revalidatePath("/cocina");

    return {
      ok: true,
      data: mapProduct(data as Record<string, unknown>),
    };
  } catch (err) {
    return handleActionError(err, "Error al guardar el producto.");
  }
}

export async function toggleProductAvailabilityAction(
  input: unknown
): Promise<ActionResult<Product>> {
  try {
    const normalizedInput =
      typeof input === "string" ? { productId: input } : input;

    const parsed = toggleProductAvailabilityInputSchema.safeParse(normalizedInput);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { supabase } = await requireRoleWithClient(["admin", "cocina"]);

    const { data: currentRow, error: fetchError } = await supabase
      .from("products")
      .select("*")
      .eq("id", parsed.data.productId)
      .maybeSingle();

    if (fetchError || !currentRow) {
      return {
        ok: false,
        error: "No se encontró el producto solicitado.",
        code: "PRODUCT_NOT_FOUND",
      };
    }

    const currentProduct = mapProduct(currentRow as Record<string, unknown>);
    const targetAvailability =
      parsed.data.isAvailable ?? !currentProduct.is_available;

    // Invocar el RPC transaccional con soporte tanto para firma de 2 argumentos como de 1 argumento
    const firstAttempt = await supabase.rpc(
      RPC_NAMES.TOGGLE_PRODUCT_AVAILABILITY,
      {
        p_product_id: parsed.data.productId,
        p_is_available: targetAvailability,
      }
    );

    if (firstAttempt.error) {
      if (firstAttempt.error.code === "PGRST202") {
        if (currentProduct.is_available !== targetAvailability) {
          const fallbackAttempt = await supabase.rpc(
            RPC_NAMES.TOGGLE_PRODUCT_AVAILABILITY,
            {
              p_product_id: parsed.data.productId,
            }
          );
          if (fallbackAttempt.error) {
            return {
              ok: false,
              ...extractPostgrestError(
                fallbackAttempt.error,
                "No se pudo cambiar la disponibilidad del producto."
              ),
            };
          }
        }
      } else {
        return {
          ok: false,
          ...extractPostgrestError(
            firstAttempt.error,
            "No se pudo cambiar la disponibilidad del producto."
          ),
        };
      }
    }

    const { data: updatedRow, error: reloadError } = await supabase
      .from("products")
      .select("*")
      .eq("id", parsed.data.productId)
      .single();

    if (reloadError || !updatedRow) {
      return {
        ok: true,
        data: {
          ...currentProduct,
          is_available: targetAvailability,
          updated_at: new Date().toISOString(),
        },
      };
    }

    revalidatePath("/cocina");
    revalidatePath("/mozo");
    revalidatePath("/admin");

    return {
      ok: true,
      data: mapProduct(updatedRow as Record<string, unknown>),
    };
  } catch (err) {
    return handleActionError(
      err,
      "Error al actualizar la disponibilidad del producto."
    );
  }
}

export async function upsertSectorAction(
  input: unknown
): Promise<ActionResult<Sector>> {
  try {
    const parsed = upsertSectorSchema.safeParse(input);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { supabase } = await requireRoleWithClient(["admin"]);

    if (parsed.data.id) {
      const { data, error } = await supabase
        .from("sectors")
        .update({
          name: parsed.data.name,
          sort_order: parsed.data.sortOrder,
          is_active: parsed.data.isActive,
        })
        .eq("id", parsed.data.id)
        .select("*")
        .single();

      if (error) {
        return {
          ok: false,
          ...extractPostgrestError(error, "No se pudo actualizar el sector."),
        };
      }

      revalidatePath("/admin");
      revalidatePath("/mozo");
      revalidatePath("/caja");

      return {
        ok: true,
        data: mapSector(data as Record<string, unknown>),
      };
    }

    const { data, error } = await supabase
      .from("sectors")
      .insert({
        name: parsed.data.name,
        sort_order: parsed.data.sortOrder,
        is_active: parsed.data.isActive,
      })
      .select("*")
      .single();

    if (error) {
      return {
        ok: false,
        ...extractPostgrestError(error, "No se pudo crear el sector."),
      };
    }

    revalidatePath("/admin");
    revalidatePath("/mozo");
    revalidatePath("/caja");

    return {
      ok: true,
      data: mapSector(data as Record<string, unknown>),
    };
  } catch (err) {
    return handleActionError(err, "Error al guardar el sector.");
  }
}

export async function upsertDiningTableAction(
  input: unknown
): Promise<ActionResult<DiningTable>> {
  try {
    const parsed = upsertDiningTableSchema.safeParse(input);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { supabase } = await requireRoleWithClient(["admin"]);
    const normalizedCode = parsed.data.code.toUpperCase();

    if (parsed.data.id) {
      if (!parsed.data.isActive) {
        const { data: existingTable } = await supabase
          .from("dining_tables")
          .select("status, current_session_id")
          .eq("id", parsed.data.id)
          .maybeSingle();

        if (
          existingTable &&
          (existingTable.status !== "libre" ||
            existingTable.current_session_id !== null)
        ) {
          return {
            ok: false,
            error:
              "No se puede desactivar una mesa que tiene una sesión abierta o pendiente de cobro.",
            code: "TABLE_HAS_ACTIVE_SESSION",
          };
        }
      }

      const { data, error } = await supabase
        .from("dining_tables")
        .update({
          code: normalizedCode,
          name: parsed.data.name,
          sector_id: parsed.data.sectorId,
          capacity: parsed.data.capacity,
          sort_order: parsed.data.sortOrder,
          is_active: parsed.data.isActive,
        })
        .eq("id", parsed.data.id)
        .select("*")
        .single();

      if (error) {
        return {
          ok: false,
          ...extractPostgrestError(error, "No se pudo actualizar la mesa."),
        };
      }

      revalidatePath("/admin");
      revalidatePath("/mozo");
      revalidatePath("/caja");

      return {
        ok: true,
        data: mapDiningTable(data as Record<string, unknown>),
      };
    }

    const { data, error } = await supabase
      .from("dining_tables")
      .insert({
        code: normalizedCode,
        name: parsed.data.name,
        sector_id: parsed.data.sectorId,
        capacity: parsed.data.capacity,
        sort_order: parsed.data.sortOrder,
        is_active: parsed.data.isActive,
      })
      .select("*")
      .single();

    if (error) {
      return {
        ok: false,
        ...extractPostgrestError(error, "No se pudo crear la mesa."),
      };
    }

    revalidatePath("/admin");
    revalidatePath("/mozo");
    revalidatePath("/caja");

    return {
      ok: true,
      data: mapDiningTable(data as Record<string, unknown>),
    };
  } catch (err) {
    return handleActionError(err, "Error al guardar la mesa.");
  }
}

export async function createStaffUserAction(
  input: unknown
): Promise<ActionResult<UserProfile>> {
  try {
    const parsed = createStaffUserSchema.safeParse(input);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    // Verificación estricta de administrador activo antes de usar el cliente admin
    await requireRole(["admin"]);

    const supabaseAdmin = createAdminSupabaseClient();
    const normalizedEmail = parsed.data.email.toLowerCase();

    const { data: createdAuth, error: createAuthError } =
      await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password: parsed.data.password,
        email_confirm: true,
        user_metadata: {
          full_name: parsed.data.fullName,
          role: parsed.data.role,
        },
      });

    if (createAuthError || !createdAuth.user) {
      const msg = createAuthError?.message ?? "";
      const isDuplicate =
        msg.toLowerCase().includes("already") ||
        msg.toLowerCase().includes("registered");
      return {
        ok: false,
        error: isDuplicate
          ? "Ya existe un usuario registrado con ese correo electrónico."
          : msg || "No se pudo crear la cuenta de personal.",
        code: isDuplicate ? "EMAIL_ALREADY_EXISTS" : "AUTH_ADMIN_ERROR",
      };
    }

    const { data: profileRow, error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: createdAuth.user.id,
          email: normalizedEmail,
          full_name: parsed.data.fullName,
          role: parsed.data.role,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      )
      .select("id, email, full_name, role, is_active, created_at, updated_at")
      .single();

    if (profileError || !profileRow) {
      // Revertir usuario en auth si falló la creación/actualización de perfil
      await supabaseAdmin.auth.admin.deleteUser(createdAuth.user.id);
      return {
        ok: false,
        ...extractPostgrestError(
          profileError ?? { message: "No se pudo crear el perfil." },
          "No se pudo registrar el perfil del usuario."
        ),
      };
    }

    const mappedProfile = mapUserProfileRow(
      profileRow as Record<string, unknown>
    );
    if (!mappedProfile) {
      return {
        ok: false,
        error: "Perfil creado con formato inválido.",
        code: "PROFILE_PARSE_ERROR",
      };
    }

    revalidatePath("/admin");

    return {
      ok: true,
      data: mappedProfile,
    };
  } catch (err) {
    return handleActionError(err, "Error al crear la cuenta de personal.");
  }
}

export async function updateStaffUserAction(
  input: unknown
): Promise<ActionResult<UserProfile>> {
  try {
    const parsed = updateStaffUserSchema.safeParse(input);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { profile: currentAdmin, supabase } = await requireRoleWithClient([
      "admin",
    ]);

    if (parsed.data.userId === currentAdmin.id) {
      if (!parsed.data.isActive) {
        return {
          ok: false,
          error: "No podés desactivar tu propia cuenta de administrador.",
          code: "SELF_DEACTIVATION_FORBIDDEN",
        };
      }
      if (parsed.data.role !== "admin") {
        return {
          ok: false,
          error: "No podés quitarte a vos mismo el rol de administrador.",
          code: "SELF_DEMOTION_FORBIDDEN",
        };
      }
    }

    const { data: updatedRow, error: updateError } = await supabase
      .from("profiles")
      .update({
        full_name: parsed.data.fullName,
        role: parsed.data.role,
        is_active: parsed.data.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.userId)
      .select("id, email, full_name, role, is_active, created_at, updated_at")
      .single();

    if (updateError || !updatedRow) {
      return {
        ok: false,
        ...extractPostgrestError(
          updateError ?? { message: "No se encontró el usuario." },
          "No se pudo actualizar el usuario."
        ),
      };
    }

    // Sincronizar metadatos en Supabase Auth
    const supabaseAdmin = createAdminSupabaseClient();
    await supabaseAdmin.auth.admin.updateUserById(parsed.data.userId, {
      user_metadata: {
        full_name: parsed.data.fullName,
        role: parsed.data.role,
      },
    });

    const mappedProfile = mapUserProfileRow(
      updatedRow as Record<string, unknown>
    );
    if (!mappedProfile) {
      return {
        ok: false,
        error: "Error al leer el perfil actualizado.",
        code: "PROFILE_PARSE_ERROR",
      };
    }

    revalidatePath("/admin");

    return {
      ok: true,
      data: mappedProfile,
    };
  } catch (err) {
    return handleActionError(err, "Error al actualizar los datos del usuario.");
  }
}

export async function updateRestaurantSettingsAction(
  input: unknown
): Promise<ActionResult<RestaurantSettings>> {
  try {
    const parsed = updateRestaurantSettingsSchema.safeParse(input);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    if (parsed.data.kdsCriticalMinutes <= parsed.data.kdsWarnMinutes) {
      return {
        ok: false,
        error:
          "El tiempo crítico de cocina debe ser mayor al tiempo de advertencia.",
        code: "VALIDATION_ERROR",
      };
    }

    const { supabase } = await requireRoleWithClient(["admin"]);
    const currencyDecimals = CURRENCY_CONFIG[parsed.data.currencyCode].decimals;

    const { data, error } = await supabase
      .from("restaurant_settings")
      .upsert(
        {
          id: 1,
          business_name: parsed.data.businessName,
          slogan: parsed.data.slogan,
          currency_code: parsed.data.currencyCode,
          currency_decimals: currencyDecimals,
          tax_percentage: parsed.data.taxPercentage,
          kds_warn_minutes: parsed.data.kdsWarnMinutes,
          kds_critical_minutes: parsed.data.kdsCriticalMinutes,
          sound_alerts_default: parsed.data.soundAlertsDefault,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      )
      .select("*")
      .single();

    if (error) {
      return {
        ok: false,
        ...extractPostgrestError(
          error,
          "No se pudo actualizar la configuración del restaurante."
        ),
      };
    }

    revalidatePath("/admin");
    revalidatePath("/mozo");
    revalidatePath("/cocina");
    revalidatePath("/caja");

    return {
      ok: true,
      data: mapRestaurantSettings(data as Record<string, unknown>),
    };
  } catch (err) {
    return handleActionError(
      err,
      "Error al actualizar la configuración del restaurante."
    );
  }
}
