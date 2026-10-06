import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Capy Cab｜卡皮巴拉計程車",
  description: "以第三人稱跟車視角親自駕駛水豚復古機車計程車，穿梭原創台灣風格 3D 城市接送乘客。",
  openGraph: {
    title: "Capy Cab｜卡皮巴拉計程車",
    description: "用第三人稱跟車鏡頭親自操控橄欖綠復古機車，在原創台灣風格城市載客營業。",
    type: "website",
    images: [{ url: "/og.png", width: 1730, height: 909, alt: "CAPY CAB 卡皮巴拉計程車" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Capy Cab｜卡皮巴拉計程車",
    description: "用第三人稱跟車鏡頭親自駕駛水豚機車計程車，穿梭高密度台灣風格 3D 街區載客。",
    images: ["/og.png"],
  },
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
    <html lang="zh-Hant">
      <head>
        <link rel="preload" href="/models/capybara-premium-original.glb?v=original-285179-front-fixed" as="fetch" crossOrigin="anonymous" fetchPriority="high" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
