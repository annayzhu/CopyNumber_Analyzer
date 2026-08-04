import Link from "next/link";

export default function Home() {
  return (
    <main className="fallback">
      <h1>CNV分析工具</h1>
      <p>页面正在载入。</p>
      <Link href="/index.html">进入分析工具</Link>
    </main>
  );
}
