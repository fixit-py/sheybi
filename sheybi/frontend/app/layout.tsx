import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";

import { AppShell } from "@/components/AppShell";
import { InstantProvider } from "@/components/instant-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sheybi",
  description: "Prediction markets",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full font-sans antialiased"
    >
      <body className="flex min-h-full flex-col">
        <ClerkProvider>
          <InstantProvider>
            <AppShell>{children}</AppShell>
          </InstantProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
