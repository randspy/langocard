import { useAuthActions } from "@convex-dev/auth/react";
import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { Button } from "@/components/ui/button";
import { validateSearch } from "@/lib/library";
import { EntryPage } from "@/routes/EntryPage";
import { LibraryPage } from "@/routes/LibraryPage";
import { NewEntryPage } from "@/routes/NewEntryPage";

const rootRoute = createRootRoute({ component: Layout });

function Layout() {
  const { signOut } = useAuthActions();
  return (
    <AuthGate>
      <header className="border-b border-line bg-white">
        <nav className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <Link to="/" className="font-serif text-xl">Langocard</Link>
          <Link to="/" className="text-sm text-muted [&.active]:text-ink [&.active]:font-medium" activeOptions={{ exact: true, includeSearch: false }}>Library</Link>
          <Link to="/entries/new" className="text-sm text-muted [&.active]:text-ink [&.active]:font-medium">New entry</Link>
          <div className="ml-auto"><Button variant="ghost" size="sm" onClick={() => void signOut()}>Sign out</Button></div>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8"><Outlet /></main>
    </AuthGate>
  );
}

export const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch,
  component: LibraryPage,
});

const newEntryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/entries/new",
  component: NewEntryPage,
});

const entryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/entries/$entryId",
  component: EntryPage,
});

const routeTree = rootRoute.addChildren([libraryRoute, newEntryRoute, entryRoute]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
