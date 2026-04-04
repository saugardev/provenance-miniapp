import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prove Reality",
  description: "Prove your photos are real and defend yourself from AI-generated fakes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
