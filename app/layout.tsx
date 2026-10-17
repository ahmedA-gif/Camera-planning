import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@xyflow/react/dist/style.css";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Plan Vision - Computer Vision Planning by TechHub",
  description: "Plan, design, and document computer vision projects with TechHub Plan Vision.",
  keywords: ["computer vision", "AI", "camera planning", "workflow", "technical blueprint"],
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

import Footer from '@/components/layout/footer';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try { if (localStorage.getItem('detvision-theme') === 'dark') document.documentElement.classList.add('dark'); } catch {}` }} />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="theme-color" content="#1e293b" />
      </head>
      <body className="flex flex-col min-h-screen bg-background text-foreground">
        <ClerkProvider>
          <main className="flex-1 min-h-0">{children}</main>
          <Footer />
        </ClerkProvider>
      </body>
    </html>
  );
}