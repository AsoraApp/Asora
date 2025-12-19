export const runtime = "edge";

export const metadata = {
  title: "Asora — U1",
  description: "Asora U1 read-only admin console"
};

import DevTokenBar from "@/app/ui/DevTokenBar";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial"
        }}
      >
        <DevTokenBar />
        <div style={{ padding: 16 }}>{children}</div>
      </body>
    </html>
  );
}
