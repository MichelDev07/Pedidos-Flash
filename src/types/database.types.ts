
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_role": Database["public"]['Enums']["user_role"] | null,"created_at": string,"id": number,"new_data": Json | null,"old_data": Json | null,"record_id": string,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_role"?: Database["public"]['Enums']["user_role"] | null,"created_at"?: string,"id"?: never,"new_data"?: Json | null,"old_data"?: Json | null,"record_id": string,"table_name": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_role"?: Database["public"]['Enums']["user_role"] | null,"created_at"?: string,"id"?: never,"new_data"?: Json | null,"old_data"?: Json | null,"record_id"?: string,"table_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"name": string,"slug": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"slug"?: string,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"slug"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"comanda_items": {
                  Row: {
                    "comanda_id": string,"id": string,"product_id": string,"product_name_snapshot": string,"quantity": number,"special_instructions": string | null,"subtotal": number | null,"unit_price_snapshot": number
                  }
                  ComputedFields: never
                  Insert: {
                    "comanda_id": string,"id"?: string,"product_id": string,"product_name_snapshot": string,"quantity": number,"special_instructions"?: string | null,"subtotal"?: never,"unit_price_snapshot": number
                  }
                  Update: {
                    "comanda_id"?: string,"id"?: string,"product_id"?: string,"product_name_snapshot"?: string,"quantity"?: number,"special_instructions"?: string | null,"subtotal"?: never,"unit_price_snapshot"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "comanda_items_comanda_id_fkey"
      columns: ["comanda_id"]
isOneToOne: false
      referencedRelation: "comandas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comanda_items_comanda_id_fkey"
      columns: ["comanda_id"]
isOneToOne: false
      referencedRelation: "v_kds_queue"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comanda_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"comandas": {
                  Row: {
                    "comanda_number": number,"comanda_type": Database["public"]['Enums']["comanda_type"],"created_at": string,"created_by": string,"delivered_at": string | null,"id": string,"idempotency_key": string,"notes": string | null,"parent_comanda_id": string | null,"preparing_at": string | null,"ready_at": string | null,"received_at": string | null,"status": Database["public"]['Enums']["comanda_status"],"table_id": string,"table_session_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "comanda_number"?: never,"comanda_type"?: Database["public"]['Enums']["comanda_type"],"created_at"?: string,"created_by": string,"delivered_at"?: string | null,"id"?: string,"idempotency_key": string,"notes"?: string | null,"parent_comanda_id"?: string | null,"preparing_at"?: string | null,"ready_at"?: string | null,"received_at"?: string | null,"status"?: Database["public"]['Enums']["comanda_status"],"table_id": string,"table_session_id": string,"version"?: number
                  }
                  Update: {
                    "comanda_number"?: never,"comanda_type"?: Database["public"]['Enums']["comanda_type"],"created_at"?: string,"created_by"?: string,"delivered_at"?: string | null,"id"?: string,"idempotency_key"?: string,"notes"?: string | null,"parent_comanda_id"?: string | null,"preparing_at"?: string | null,"ready_at"?: string | null,"received_at"?: string | null,"status"?: Database["public"]['Enums']["comanda_status"],"table_id"?: string,"table_session_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "comandas_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comandas_parent_comanda_id_fkey"
      columns: ["parent_comanda_id"]
isOneToOne: false
      referencedRelation: "comandas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comandas_parent_comanda_id_fkey"
      columns: ["parent_comanda_id"]
isOneToOne: false
      referencedRelation: "v_kds_queue"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comandas_table_id_fkey"
      columns: ["table_id"]
isOneToOne: false
      referencedRelation: "dining_tables"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comandas_table_id_fkey"
      columns: ["table_id"]
isOneToOne: false
      referencedRelation: "v_floor_tables"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comandas_table_session_id_fkey"
      columns: ["table_session_id"]
isOneToOne: false
      referencedRelation: "table_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"dining_tables": {
                  Row: {
                    "capacity": number,"code": string,"created_at": string,"current_session_id": string | null,"id": string,"is_active": boolean,"name": string,"sector_id": string,"sort_order": number,"status": Database["public"]['Enums']["table_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity"?: number,"code": string,"created_at"?: string,"current_session_id"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"sector_id": string,"sort_order"?: number,"status"?: Database["public"]['Enums']["table_status"],"updated_at"?: string
                  }
                  Update: {
                    "capacity"?: number,"code"?: string,"created_at"?: string,"current_session_id"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"sector_id"?: string,"sort_order"?: number,"status"?: Database["public"]['Enums']["table_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "dining_tables_sector_id_fkey"
      columns: ["sector_id"]
isOneToOne: false
      referencedRelation: "sectors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_dining_tables_current_session"
      columns: ["current_session_id"]
isOneToOne: false
      referencedRelation: "table_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_methods": {
                  Row: {
                    "code": string,"id": string,"is_active": boolean,"is_cash": boolean,"name": string,"requires_reference": boolean,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"id"?: string,"is_active"?: boolean,"is_cash"?: boolean,"name": string,"requires_reference"?: boolean,"sort_order"?: number
                  }
                  Update: {
                    "code"?: string,"id"?: string,"is_active"?: boolean,"is_cash"?: boolean,"name"?: string,"requires_reference"?: boolean,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"amount_tendered": number | null,"cashier_id": string,"change_amount": number,"created_at": string,"currency_code": string,"id": string,"idempotency_key": string,"payment_method_id": string,"reference_code": string | null,"table_session_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"amount_tendered"?: number | null,"cashier_id": string,"change_amount"?: number,"created_at"?: string,"currency_code"?: string,"id"?: string,"idempotency_key": string,"payment_method_id": string,"reference_code"?: string | null,"table_session_id": string
                  }
                  Update: {
                    "amount"?: number,"amount_tendered"?: number | null,"cashier_id"?: string,"change_amount"?: number,"created_at"?: string,"currency_code"?: string,"id"?: string,"idempotency_key"?: string,"payment_method_id"?: string,"reference_code"?: string | null,"table_session_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_cashier_id_fkey"
      columns: ["cashier_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_payment_method_id_fkey"
      columns: ["payment_method_id"]
isOneToOne: false
      referencedRelation: "payment_methods"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_table_session_id_fkey"
      columns: ["table_session_id"]
isOneToOne: false
      referencedRelation: "table_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "category_id": string,"created_at": string,"description": string | null,"id": string,"image_url": string | null,"is_active": boolean,"is_available": boolean,"name": string,"price_amount": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"created_at"?: string,"description"?: string | null,"id"?: string,"image_url"?: string | null,"is_active"?: boolean,"is_available"?: boolean,"name": string,"price_amount": number,"updated_at"?: string
                  }
                  Update: {
                    "category_id"?: string,"created_at"?: string,"description"?: string | null,"id"?: string,"image_url"?: string | null,"is_active"?: boolean,"is_available"?: boolean,"name"?: string,"price_amount"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string,"id": string,"is_active": boolean,"role": Database["public"]['Enums']["user_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"full_name": string,"id": string,"is_active"?: boolean,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string,"id"?: string,"is_active"?: boolean,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"push_subscriptions": {
                  Row: {
                    "auth": string,"created_at": string,"endpoint": string,"id": string,"p256dh": string,"updated_at": string,"user_agent": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth": string,"created_at"?: string,"endpoint": string,"id"?: string,"p256dh": string,"updated_at"?: string,"user_agent"?: string | null,"user_id": string
                  }
                  Update: {
                    "auth"?: string,"created_at"?: string,"endpoint"?: string,"id"?: string,"p256dh"?: string,"updated_at"?: string,"user_agent"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_subscriptions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"restaurant_settings": {
                  Row: {
                    "business_name": string,"currency_code": string,"currency_decimals": number,"id": number,"kds_critical_minutes": number,"kds_warn_minutes": number,"slogan": string,"sound_alerts_default": boolean,"tax_percentage": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_name"?: string,"currency_code"?: string,"currency_decimals"?: number,"id"?: number,"kds_critical_minutes"?: number,"kds_warn_minutes"?: number,"slogan"?: string,"sound_alerts_default"?: boolean,"tax_percentage"?: number,"updated_at"?: string
                  }
                  Update: {
                    "business_name"?: string,"currency_code"?: string,"currency_decimals"?: number,"id"?: number,"kds_critical_minutes"?: number,"kds_warn_minutes"?: number,"slogan"?: string,"sound_alerts_default"?: boolean,"tax_percentage"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sectors": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"name": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"status_history": {
                  Row: {
                    "changed_at": string,"changed_by": string | null,"entity_id": string,"entity_type": string,"from_status": string | null,"id": number,"metadata": NonNullable<Json>,"to_status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "changed_at"?: string,"changed_by"?: string | null,"entity_id": string,"entity_type": string,"from_status"?: string | null,"id"?: never,"metadata"?: NonNullable<Json>,"to_status": string
                  }
                  Update: {
                    "changed_at"?: string,"changed_by"?: string | null,"entity_id"?: string,"entity_type"?: string,"from_status"?: string | null,"id"?: never,"metadata"?: NonNullable<Json>,"to_status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "status_history_changed_by_fkey"
      columns: ["changed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"table_sessions": {
                  Row: {
                    "balance_due": number | null,"closed_at": string | null,"closed_by": string | null,"currency_code": string,"id": string,"open_idempotency_key": string | null,"opened_at": string,"opened_by": string,"paid_amount": number,"session_number": number,"status": Database["public"]['Enums']["session_status"],"subtotal_amount": number,"table_id": string,"total_amount": number,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "balance_due"?: never,"closed_at"?: string | null,"closed_by"?: string | null,"currency_code"?: string,"id"?: string,"open_idempotency_key"?: string | null,"opened_at"?: string,"opened_by": string,"paid_amount"?: number,"session_number"?: never,"status"?: Database["public"]['Enums']["session_status"],"subtotal_amount"?: number,"table_id": string,"total_amount"?: number,"version"?: number
                  }
                  Update: {
                    "balance_due"?: never,"closed_at"?: string | null,"closed_by"?: string | null,"currency_code"?: string,"id"?: string,"open_idempotency_key"?: string | null,"opened_at"?: string,"opened_by"?: string,"paid_amount"?: number,"session_number"?: never,"status"?: Database["public"]['Enums']["session_status"],"subtotal_amount"?: number,"table_id"?: string,"total_amount"?: number,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "table_sessions_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "table_sessions_opened_by_fkey"
      columns: ["opened_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "table_sessions_table_id_fkey"
      columns: ["table_id"]
isOneToOne: false
      referencedRelation: "dining_tables"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "table_sessions_table_id_fkey"
      columns: ["table_id"]
isOneToOne: false
      referencedRelation: "v_floor_tables"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "v_floor_tables": {
                  Row: {
                    "active_comandas_count": number | null,"balance_due": number | null,"capacity": number,"code": string,"current_session_id": string | null,"id": string,"is_active": boolean,"name": string,"opened_by_name": string | null,"paid_amount": number | null,"ready_comandas_count": number | null,"sector_id": string,"sector_name": string,"session_number": number | null,"session_opened_at": string | null,"sort_order": number,"status": Database["public"]['Enums']["table_status"],"total_amount": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "dining_tables_sector_id_fkey"
      columns: ["sector_id"]
isOneToOne: false
      referencedRelation: "sectors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_dining_tables_current_session"
      columns: ["current_session_id"]
isOneToOne: false
      referencedRelation: "table_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"v_kds_queue": {
                  Row: {
                    "comanda_number": number,"comanda_type": Database["public"]['Enums']["comanda_type"],"created_at": string,"created_by": string,"delivered_at": string | null,"id": string,"idempotency_key": string,"items": Json | null,"notes": string | null,"parent_comanda_id": string | null,"preparing_at": string | null,"ready_at": string | null,"received_at": string | null,"sector_name": string,"status": Database["public"]['Enums']["comanda_status"],"table_code": string,"table_id": string,"table_session_id": string,"version": number,"waiter_name": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "comandas_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comandas_parent_comanda_id_fkey"
      columns: ["parent_comanda_id"]
isOneToOne: false
      referencedRelation: "comandas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comandas_parent_comanda_id_fkey"
      columns: ["parent_comanda_id"]
isOneToOne: false
      referencedRelation: "v_kds_queue"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comandas_table_id_fkey"
      columns: ["table_id"]
isOneToOne: false
      referencedRelation: "dining_tables"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comandas_table_id_fkey"
      columns: ["table_id"]
isOneToOne: false
      referencedRelation: "v_floor_tables"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comandas_table_session_id_fkey"
      columns: ["table_session_id"]
isOneToOne: false
      referencedRelation: "table_sessions"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "advance_comanda_status":
{ Args: { "p_comanda_id": string,"p_target_status": Database["public"]['Enums']["comanda_status"] }; Returns: Json
                           },
"assert_caller_role":
{ Args: { "p_allowed_roles": (Database["public"]['Enums']["user_role"])[] }; Returns: {
              "actor_id": string,"actor_role": Database["public"]['Enums']["user_role"]
            }[]
                           },
"cancel_empty_table_session":
{ Args: { "p_table_session_id": string }; Returns: Json
                           },
"create_comanda_idempotent":
{ Args: { "p_comanda_type"?: Database["public"]['Enums']["comanda_type"],"p_idempotency_key": string,"p_items": Json,"p_notes"?: string,"p_parent_comanda_id"?: string,"p_table_session_id": string }; Returns: Json
                           },
"current_user_role":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["user_role"]
                           },
"has_any_role":
{ Args: { "p_roles": (Database["public"]['Enums']["user_role"])[] }; Returns: boolean
                           },
"is_active_staff":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"open_table_session":
{ Args: { "p_idempotency_key": string,"p_table_id": string }; Returns: Json
                           },
"recalculate_table_session_totals":
{ Args: { "p_table_session_id": string }; Returns: {
              "balance_due": number | null,
"closed_at": string | null,
"closed_by": string | null,
"currency_code": string,
"id": string,
"open_idempotency_key": string | null,
"opened_at": string,
"opened_by": string,
"paid_amount": number,
"session_number": number,
"status": Database["public"]['Enums']["session_status"],
"subtotal_amount": number,
"table_id": string,
"total_amount": number,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "table_sessions"
        isOneToOne: true
        isSetofReturn: false
      } },
"register_payment_and_close_table":
{ Args: { "p_amount": number,"p_amount_tendered"?: number,"p_idempotency_key": string,"p_payment_method_id": string,"p_reference_code"?: string,"p_table_session_id": string }; Returns: Json
                           },
"request_table_bill":
{ Args: { "p_force"?: boolean,"p_table_session_id": string }; Returns: Json
                           },
"toggle_product_availability":
{ Args: { "p_is_available": boolean,"p_product_id": string }; Returns: Json
                           }
          }
          Enums: {
            "comanda_status": "nuevo"|"recibido"|"preparando"|"listo"|"entregado","comanda_type": "original"|"adicion"|"correccion","session_status": "abierta"|"pendiente_cobro"|"cerrada","table_status": "libre"|"ocupada"|"pendiente_cobro","user_role": "admin"|"mozo"|"cocina"|"caja"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "comanda_status": ["nuevo", "recibido", "preparando", "listo", "entregado"],"comanda_type": ["original", "adicion", "correccion"],"session_status": ["abierta", "pendiente_cobro", "cerrada"],"table_status": ["libre", "ocupada", "pendiente_cobro"],"user_role": ["admin", "mozo", "cocina", "caja"]
          }
        }
} as const
