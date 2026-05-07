import "./globals.css";

export const metadata = {
  title: "Inbound AI Voice Dashboard",
  description: "Operator dashboard for the inbound AI voice platform"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
