import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fija la raíz del workspace de Turbopack al directorio del proyecto.
  // Evita que Next infiera mal la raíz cuando hay otro lockfile en un ancestro
  // (p.ej. un package-lock.json suelto en el home). Hace la build determinística
  // local, en CI y en Vercel.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
