export const runtime = "edge";

export const metadata = {
  title: "Asora — U1",
  description: "Asora U1 read-only admin console"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
        {children}
      </body>
    </html>
  );
}
