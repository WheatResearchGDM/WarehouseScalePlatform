import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pesagem de Ensaios | GDM",
  description:
    "Leitura de parcelas, registro de PW e acompanhamento dos ensaios de trigo.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
