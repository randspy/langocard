import { api } from "@backend/_generated/api";
import { license, source } from "@bundled-pack";
import { Button } from "@/components/ui/button";
import { exportLibrary } from "@/lib/anki";
import { useTokenFetch } from "@/lib/convex";
import { useAsyncAction } from "@/lib/useAsyncAction";

/** The APK's built-in pack is credited first, as the phone's export does. */
const BUILT_IN_CREDIT = { source, license };

export function ExportPage() {
  const fetch = useTokenFetch();
  const { run, pending, error } = useAsyncAction();
  const download = () => run(async () => {
    const credits = [BUILT_IN_CREDIT, ...await fetch(api.anki.credits, {})];
    const tsv = await exportLibrary((cursor) => fetch(api.anki.page, { cursor }), credits);
    const url = URL.createObjectURL(new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "langocard-anki.tsv" });
    link.click();
    URL.revokeObjectURL(url);
  });
  return (
    <section className="max-w-3xl space-y-4">
      <h1 className="font-semibold text-3xl">Export to Anki</h1>
      <p className="text-muted">
        Downloads a tab-separated file of Reading and Production cards (and Gender cards for nouns) for every
        active entry, in the same format as the phone's export. Each card keeps its source credit and licence.
        In Anki, choose File → Import.
      </p>
      <Button onClick={() => void download()} disabled={pending}>{pending ? "Preparing…" : "Download langocard-anki.tsv"}</Button>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </section>
  );
}
