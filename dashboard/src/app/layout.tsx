import type { Metadata } from "next";
import "./globals.css";
import AppLayout from "./components/AppLayout";

export const metadata: Metadata = {
  title: "uwu-code",
  description: "Web-based development environment manager for VPS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-grid min-h-screen" style={{ background: "#0a0e1a" }}>
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
