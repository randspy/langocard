import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AccessGate } from "@/components/AccessGate";
import { validateSearch } from "@/lib/library";
import { EntryPage } from "@/routes/EntryPage";
import { ExportPage } from "@/routes/ExportPage";
import { LibraryPage } from "@/routes/LibraryPage";
import { NewEntryPage } from "@/routes/NewEntryPage";
import { SourcesPage } from "@/routes/SourcesPage";
import { UpstreamPage } from "@/routes/UpstreamPage";

const rootRoute = createRootRoute({ component: Layout });

function Layout() {
  return (
    <AccessGate>
      <header className="border-b border-line bg-surface">
        <nav className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <Link to="/" className="font-semibold text-xl">Langocard</Link>
          <Link to="/" className="text-sm text-muted [&.active]:text-ink [&.active]:font-medium" activeOptions={{ exact: true, includeSearch: false }}>Library</Link>
          <Link to="/entries/new" className="text-sm text-muted [&.active]:text-ink [&.active]:font-medium">New entry</Link>
          <Link to="/conflicts" className="text-sm text-muted [&.active]:text-ink [&.active]:font-medium">Upstream changes</Link>
          <Link to="/export" className="text-sm text-muted [&.active]:text-ink [&.active]:font-medium">Export</Link>
          <Link to="/sources" className="text-sm text-muted [&.active]:text-ink [&.active]:font-medium">Content sources</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8"><Outlet /></main>
    </AccessGate>
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

const upstreamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/conflicts",
  component: UpstreamPage,
});

const exportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/export",
  component: ExportPage,
});

const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sources",
  component: SourcesPage,
});

const routeTree = rootRoute.addChildren([libraryRoute, newEntryRoute, entryRoute, upstreamRoute, exportRoute, sourcesRoute]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
