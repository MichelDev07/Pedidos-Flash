# ⚡ Pedidos Flash

> **De la mesa a la cocina, en un flash.**  
> Sistema PWA de comandas digitales y gestión operativa en tiempo real para restaurantes.

---

## 🚀 Módulos Operativos

- **📱 Salón / Mozos (`/mozo`)**: Mapa de salón interactivo, apertura de mesas, comandas rápidas con adiciones, solicitud de precuenta y alertas de comandas listas.
- **🍳 Cocina KDS (`/cocina`)**: Comandero digital en tiempo real con semáforos de SLA y avances de estado de preparación.
- **💵 Caja (`/caja`)**: Visualización de mesas pendientes de cobro, desglose de consumos, registro de pagos y cierre de mesa.
- **⚙️ Administración (`/admin`)**: Gestión del menú, categorías, productos, sectores, mesas y personal.

---

## 🛠️ Tecnologías

- **Frontend:** Next.js 15 (App Router), React 19, Tailwind CSS v4, Lucide Icons.
- **Backend & Base de Datos:** Supabase (PostgreSQL 15+, Row Level Security, Realtime Publications, RPCs transaccionales).
- **PWA:** Service Worker para soporte offline y Web Push Notifications.

---

## 📦 Puesta en Marcha Local

### 1. Requisitos
- [Node.js](https://nodejs.org/) v20 o superior
- [pnpm](https://pnpm.io/) (`npm i -g pnpm`)

### 2. Instalación de dependencias
```bash
pnpm install
```

### 3. Variables de Entorno
Copia el archivo `.env.example` a `.env.local` y configura tus credenciales de Supabase:
```bash
cp .env.example .env.local
```

### 4. Servidor de Desarrollo
```bash
pnpm dev
```
Abre en tu navegador: **[http://localhost:3000](http://localhost:3000)**

---

## 🧪 Pruebas y Verificación

```bash
# Verificación rápida (TypeScript + Tests unitarios + Auditoría de seguridad)
pnpm verify:fast

# Tests unitarios con Vitest
pnpm test:unit

# Verificación de seguridad de variables de entorno
pnpm security:check
```
