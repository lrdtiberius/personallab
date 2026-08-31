import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PersonalLab 2.5.7",
  description:
    "Lokale Dokument- und Datenzentrale für Paperless-NGX, EnergieLab, FinanzLab und Home Assistant.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  other: {
    "codex-preview": "development",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
