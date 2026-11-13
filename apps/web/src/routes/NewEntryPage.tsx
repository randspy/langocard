import { Link, useNavigate } from "@tanstack/react-router";
import { api } from "@backend/_generated/api";
import type { EntryContent } from "@backend/entryRules";
import { EntryForm } from "@/components/EntryForm";
import { useTokenMutation } from "@/lib/convex";

const EMPTY: EntryContent = {
  word: "", english: "", definition: "", example: "", topic: "daily", lemma: "", rank: null, sourceUrl: "", license: "", gender: null,
};

export function NewEntryPage() {
  const create = useTokenMutation(api.entries.create);
  const navigate = useNavigate();
  return (
    <section className="max-w-2xl space-y-6">
      <Link to="/" className="text-sm text-muted hover:text-ink">← Library</Link>
      <h1 className="font-serif text-3xl">New entry</h1>
      <p className="text-sm text-muted">Personal entries are introduced before dictionary entries on your phone.</p>
      <EntryForm
        entryId="personal-new"
        initial={EMPTY}
        submitLabel="Add entry"
        onSubmit={async (content) => {
          const entryId = await create(content);
          await navigate({ to: "/entries/$entryId", params: { entryId } });
        }}
      />
    </section>
  );
}
