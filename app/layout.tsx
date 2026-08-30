import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/workspace/sidebar";
import { ExamHeader } from "@/components/workspace/exam-header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Veda AI — Assessment Extraction & Answer Mapping",
  description:
    "Upload a question paper and a handwritten answer sheet to extract, map, and grade student answers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-screen overflow-hidden bg-background text-foreground">
        <div className="flex h-full shrink-0 pt-2 pl-2 pb-2">
          <Sidebar />
        </div>
        <main className="mx-2 flex min-w-0 flex-1 flex-col ">
          <ExamHeader />
          <div className="mb-2 min-h-0 flex-1 overflow-hidden">{children}</div>
        </main>
      </body>
    </html>
  );
}