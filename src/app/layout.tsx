import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pedidos Flash — De la mesa a la cocina, en un flash",
  description: "Sistema PWA de comandas digitales para restaurantes.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/favicon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#FF6B35",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] antialiased font-sans">
        {children}
      </body>
    </html>
  );
}

