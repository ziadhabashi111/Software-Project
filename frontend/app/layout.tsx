import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Travel Planning and Booking Platform",
  description: "Search and book flights and hotels, and plan itineraries.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
