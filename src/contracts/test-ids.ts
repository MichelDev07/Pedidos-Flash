export const TEST_IDS = {
  AUTH: {
    EMAIL_INPUT: "login-email-input",
    PASSWORD_INPUT: "login-password-input",
    SUBMIT_BTN: "login-submit-btn",
    ERROR_ALERT: "login-error-alert",
    LOGOUT_BTN: "nav-logout-btn",
  },
  CONNECTION: {
    BADGE: "realtime-connection-badge",
  },
  MOZO: {
    FLOOR_GRID: "mozo-floor-grid",
    tableCard: (code: string) => `table-card-${code}`,
    OPEN_TABLE_BTN: "open-table-btn",
    SEARCH_INPUT: "order-product-search",
    categoryChip: (slug: string) => `category-chip-${slug}`,
    productCard: (productId: string) => `product-card-${productId}`,
    productAddBtn: (productId: string) => `product-add-${productId}`,
    cartItemQtyInc: (index: number) => `cart-qty-inc-${index}`,
    cartItemQtyDec: (index: number) => `cart-qty-dec-${index}`,
    cartItemNotesInput: (index: number) => `cart-notes-${index}`,
    ORDER_SUBTOTAL: "order-draft-subtotal",
    SEND_COMANDA_BTN: "send-comanda-btn",
    REQUEST_BILL_BTN: "request-bill-btn",
    READY_NOTIFICATION_BANNER: "mozo-ready-notification-banner",
    DELIVER_COMANDA_BTN: (comandaNumber: number) => `deliver-comanda-${comandaNumber}`,
  },
  KDS: {
    BOARD: "kds-board",
    comandaCard: (comandaNumber: number) => `kds-comanda-card-${comandaNumber}`,
    comandaStatusBadge: (comandaNumber: number) => `kds-status-${comandaNumber}`,
    advanceBtn: (comandaNumber: number, targetStatus: string) =>
      `kds-advance-${comandaNumber}-${targetStatus}`,
  },
  CAJA: {
    PENDING_LIST: "caja-pending-tables",
    PAY_AMOUNT_INPUT: "caja-pay-amount",
    PAY_METHOD_SELECT: "caja-pay-method",
    SUBMIT_PAYMENT_BTN: "caja-submit-payment-btn",
  },
  ADMIN: {
    DASHBOARD: "admin-dashboard",
    PRODUCTS_TAB: "admin-tab-products",
    TABLES_TAB: "admin-tab-tables",
    USERS_TAB: "admin-tab-users",
  },
} as const;
