import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Shell from "@/components/Shell";

const geistSans = localFont({ src: "./fonts/GeistVF.woff", variable: "--font-geist-sans", weight: "100 900" });

export const metadata: Metadata = {
  title: "BrandProof — check content before it goes live",
  description:
    "Brand-governance platform: checks posts, emails, documents and creatives against your approved brand rules, facts and visuals, explains every issue and keeps a human in control of approval.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased`}>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
