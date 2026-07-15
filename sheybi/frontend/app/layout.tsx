import type { Metadata } from "next";

import { RouteProviders } from "@/components/route-providers";
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
        <RouteProviders>{children}</RouteProviders>
      </body>
    </html>
  );
}
