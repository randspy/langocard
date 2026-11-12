import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { RouterProvider } from "@tanstack/react-router";
import { ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "@/router";
import "./index.css";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const root = createRoot(document.getElementById("root")!);

if (!url) {
  root.render(<p style={{ padding: 24 }}>VITE_CONVEX_URL isn't set. Run <code>npm run link-web</code> in apps/backend.</p>);
} else {
  const convex = new ConvexReactClient(url);
  root.render(
    <StrictMode>
      <ConvexAuthProvider client={convex}>
        <RouterProvider router={router} />
      </ConvexAuthProvider>
    </StrictMode>,
  );
}
