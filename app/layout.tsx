import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Livy World Mini App",
  description: "Capture image hash, verify World ID proof, and sign payload in one Next.js app.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
