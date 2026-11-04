import type { ComandaStatus, ComandaType, SessionStatus, TableStatus } from "./domain";

export const RPC_NAMES = {
  OPEN_TABLE_SESSION: "open_table_session",
  CREATE_COMANDA_IDEMPOTENT: "create_comanda_idempotent",
  ADVANCE_COMANDA_STATUS: "advance_comanda_status",
  REQUEST_TABLE_BILL: "request_table_bill",
  REGISTER_PAYMENT_AND_CLOSE_TABLE: "register_payment_and_close_table",
  TOGGLE_PRODUCT_AVAILABILITY: "toggle_product_availability",
  CANCEL_EMPTY_TABLE_SESSION: "cancel_empty_table_session",
} as const;

export interface OpenTableSessionRpcArgs {
  p_table_id: string;
  p_idempotency_key: string;
}

export interface OpenTableSessionRpcResult {
  session_id: string;
  session_number: number;
  table_id: string;
  table_status: TableStatus;
  idempotent_replay: boolean;
}

export interface CreateComandaRpcItemInput {
  product_id: string;
  quantity: number;
  special_instructions?: string | null;
}

export interface CreateComandaRpcArgs {
  p_table_session_id: string;
  p_idempotency_key: string;
  p_items: CreateComandaRpcItemInput[];
  p_notes?: string | null;
  p_comanda_type?: ComandaType;
  p_parent_comanda_id?: string | null;
}

export interface CreateComandaRpcResult {
  comanda_id: string;
  comanda_number: number;
  status: ComandaStatus;
  session_total_amount: number;
  idempotent_replay: boolean;
}

export interface AdvanceComandaStatusRpcArgs {
  p_comanda_id: string;
  p_target_status: ComandaStatus;
}

export interface AdvanceComandaStatusRpcResult {
  comanda_id: string;
  comanda_number: number;
  table_id: string;
  table_code: string;
  previous_status: ComandaStatus;
  new_status: ComandaStatus;
  created_by: string;
  already_in_status: boolean;
}

export interface RequestTableBillRpcArgs {
  p_table_session_id: string;
  p_force?: boolean;
}

export interface RequestTableBillRpcResult {
  session_id: string;
  table_id: string;
  session_status: SessionStatus;
  table_status: TableStatus;
  total_amount: number;
  balance_due: number;
}

export interface RegisterPaymentRpcArgs {
  p_table_session_id: string;
  p_payment_method_id: string;
  p_amount: number;
  p_idempotency_key: string;
  p_amount_tendered?: number | null;
  p_reference_code?: string | null;
}

export interface RegisterPaymentRpcResult {
  payment_id: string;
  session_id: string;
  table_id: string;
  paid_amount: number;
  balance_due: number;
  change_amount: number;
  session_closed: boolean;
  table_status: TableStatus;
  idempotent_replay: boolean;
}
