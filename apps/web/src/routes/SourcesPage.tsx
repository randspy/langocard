import notice from "@content/NOTICE.md?raw";

/** The content notice and per-source licences, as the phone's Content sources page shows them. */
export function SourcesPage() {
  return (
    <section className="max-w-3xl space-y-4">
      <h1 className="font-semibold text-3xl">Content sources</h1>
      <p>
        Original starter material and source-aligned dictionary packs are kept separate from your learning history.
        Dictionary packs are structurally checked, not independently language-reviewed.
      </p>
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{notice}</pre>
    </section>
  );
}
