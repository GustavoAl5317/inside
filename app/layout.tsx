import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { CurrentUserProvider } from "@/components/current-user-provider";
import { AppNav, AccessGate } from "@/components/app-nav";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Sistema de Inside Sales - Interatell",
  description: "Gerenciamento de transações comerciais entre empresas",
  generator: "v0.dev",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.className} ${inter.variable} ${spaceGrotesk.variable}`}>
        <CurrentUserProvider>
          <AppNav />

          <Toaster richColors position="top-right" />
          <main className="min-h-screen">
            <AccessGate>{children}</AccessGate>
          </main>
        </CurrentUserProvider>

        <footer className="relative overflow-hidden bg-[#0b1029] text-white py-6 border-t border-indigo-500/20">
          <div className="absolute inset-0 tech-grid-light opacity-60" />
          <div
            className="absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(99,102,241,0.9), rgba(34,211,238,0.9), transparent)",
            }}
          />
          <div className="relative container mx-auto px-4">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br from-indigo-500 to-cyan-400 shadow-[0_0_14px_rgba(34,211,238,0.45)]">
                  <span className="text-white font-bold text-xs">I</span>
                </div>
                <span className="text-sm text-indigo-100">
                  © 2026 Interatell — Sistema de Inside Sales
                </span>
              </div>
              <div className="text-xs text-indigo-300/70 tracking-wide">
                Integração Bitrix24 · Omie
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
