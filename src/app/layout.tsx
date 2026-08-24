import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Family Ledger",
  description: "High-speed expense tracking for the family — bills, lifestyle and one-time buys at a glance.",
  // UX pass — PWA installability on iOS (Android/Chrome read the web manifest)
  appleWebApp: {
    capable: true,
    title: "Ledger",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // cover lets env(safe-area-inset-*) resolve on iOS — the bottom nav and
  // sheets pad against the home indicator with it; no maximumScale so
  // pinch-zoom stays available (a11y).
  viewportFit: "cover",
  // match the browser chrome to the active theme
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#171717" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: next-themes may set the theme class on <html>
    // before hydration, so the server-rendered class can legitimately differ.
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-dvh flex flex-col bg-background text-foreground">
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
