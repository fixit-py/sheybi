import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { Geist, Geist_Mono, Inter } from "next/font/google";

import { AppSidebar } from "@/components/app-sidebar";
import { AuthHeader } from "@/components/AuthHeader";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { isAdminUserId } from "@/lib/admin";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sheybi",
  description: "Prediction markets",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { userId } = await auth();
  const isAdmin = isAdminUserId(userId);

  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
    >
      <body className="flex min-h-full flex-col">
        <ClerkProvider>

          <SidebarProvider
            style={
              {
                "--sidebar-width": "calc(var(--spacing) * 72)",
                "--header-height": "calc(var(--spacing) * 12)",
              } as React.CSSProperties
            }
          >

            <AppSidebar variant="inset" isAdmin={isAdmin} />
            <SidebarInset>
              <AuthHeader />
              {children}
            </SidebarInset>
          </SidebarProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
