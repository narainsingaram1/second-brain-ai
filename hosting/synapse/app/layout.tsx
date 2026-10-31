import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Synapse",
  description: "Your private second brain, across devices.",
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
