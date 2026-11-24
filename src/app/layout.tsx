import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import "./globals.css";

/** Display face: a grotesque with optical sizes, tight and architectural at large sizes. */
const display = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

/** Interface face: neutral, compact, with tabular figures for the numbers. */
const text = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Inmobilite: tu propiedad en 3D",
  description:
    "Buscá una esquina de Buenos Aires y volá hasta ahí: calles, árboles y los edificios más cercanos en 3D, con datos reales de OpenStreetMap.",
  applicationName: "Inmobilite",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "Inmobilite: tu propiedad en 3D",
    description: "Tu esquina de Buenos Aires, modelada en 3D con datos reales de OpenStreetMap.",
    locale: "es_AR",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0e1218",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${display.variable} ${text.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
