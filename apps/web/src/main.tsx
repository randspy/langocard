import { RouterProvider } from "@tanstack/react-router";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { syncToken } from "@/lib/convex";
import { router } from "@/router";
import "./index.css";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const root = createRoot(document.getElementById("root")!);

if (!url || !syncToken) {
  root.render(<p style={{ padding: 24 }}>VITE_CONVEX_URL or VITE_SYNC_TOKEN isn't set. Run <code>npm run link-web</code> in apps/backend.</p>);
} else {
  const convex = new ConvexReactClient(url);
  root.render(
    <StrictMode>
      <ConvexProvider client={convex}>
        <RouterProvider router={router} />
      </ConvexProvider>
    </StrictMode>,
  );
}
