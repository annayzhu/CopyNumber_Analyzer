import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CNV分析工具 v 1.3",
  description: "基于 CopyCaller 公开原理的 TaqMan qPCR CNV 分析工具。",
  openGraph: {
    title: "CNV分析工具 / CNV Analysis Tool",
    description: "从孔级 Ct 到样本级拷贝数，支持 qPCR CNV 计算、质控、校准与实验记录导出。",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
