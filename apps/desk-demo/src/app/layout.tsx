import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "mastra-cc — the desk, shared",
  description: "An agent works a real desktop, and hands the keyboard back when only a person will do.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full">{children}</body>
    </html>
  );
}
