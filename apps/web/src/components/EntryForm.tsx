import { useState, type FormEvent } from "react";
import { TOPICS, answerOf, clozeOf, entryErrors, sameContent, type EntryContent, type RuleError } from "@backend/entryRules";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

type Field = "word" | "english" | "definition" | "example" | "topic" | "lemma";
const FIELDS: { field: Field; label: string; hint?: string; multiline?: boolean }[] = [
  { field: "word", label: "French word or phrase", hint: "Include the article for nouns, e.g. “une rencontre”." },
  { field: "english", label: "English" },
  { field: "definition", label: "Definition", multiline: true },
  { field: "example", label: "Example", hint: "Mark the answer with {braces}: “Il pleut, {pourtant} elle sort.”", multiline: true },
  { field: "lemma", label: "Lemma", hint: "Dictionary form, used to group related meanings. Optional." },
];

type Props = {
  initial: EntryContent;
  /** ID used for validation; new entries use a placeholder personal ID. */
  entryId: string;
  submitLabel: string;
  disabled?: boolean;
  /** Resolves when saved; a thrown error is shown under the form. */
  onSubmit: (content: EntryContent) => Promise<void>;
};

export function EntryForm({ initial, entryId, submitLabel, disabled, onSubmit }: Props) {
  const [content, setContent] = useState(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const errors = entryErrors(entryId, content);
  const errorFor = (field: Field): RuleError | undefined =>
    submitted || touched.has(field) ? errors.find((e) => e.field === field) : undefined;
  const unchanged = sameContent(content, initial);
  const set = (field: Field, value: string) => { setContent({ ...content, [field]: value }); setSavedAt(null); };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (errors.length > 0 || unchanged) return;
    setSaving(true);
    setServerError(null);
    try {
      await onSubmit(content);
      setSavedAt(Date.now());
    } catch (error) {
      setServerError(messageOf(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <fieldset disabled={disabled || saving} className="space-y-5">
        {FIELDS.map(({ field, label, hint, multiline }) => {
          const error = errorFor(field);
          const id = `entry-${field}`;
          const props = {
            id,
            value: content[field],
            "aria-invalid": error ? true : undefined,
            "aria-describedby": `${id}-hint ${id}-error`,
            onBlur: () => setTouched(new Set(touched).add(field)),
          };
          return (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={id}>{label}</Label>
              {multiline
                ? <Textarea {...props} onChange={(e) => set(field, e.target.value)} />
                : <Input {...props} onChange={(e) => set(field, e.target.value)} />}
              {hint && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
              {error && <p id={`${id}-error`} className="text-sm text-danger">{error.message}</p>}
            </div>
          );
        })}
        <div className="space-y-1.5">
          <Label htmlFor="entry-topic">Topic</Label>
          <Select id="entry-topic" value={content.topic} onChange={(e) => set("topic", e.target.value)} className="block">
            {TOPICS.map((topic) => <option key={topic} value={topic} className="capitalize">{topic}</option>)}
          </Select>
          {errorFor("topic") && <p className="text-sm text-danger">{errorFor("topic")!.message}</p>}
        </div>
      </fieldset>

      <Preview example={content.example} />

      {submitted && errors.some((e) => e.field === "entryId" || e.field === "rank" || e.field === "license" || e.field === "sourceUrl") && (
        <p className="text-sm text-danger">This entry's dictionary metadata is invalid; it can't be saved from here.</p>
      )}
      {serverError && <p role="alert" className="text-sm text-danger">{serverError}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={disabled || saving || unchanged}>{saving ? "Saving…" : submitLabel}</Button>
        {savedAt && <span role="status" className="text-sm text-muted">Saved. Your phone picks it up on its next sync.</span>}
      </div>
    </form>
  );
}

function Preview({ example }: { example: string }) {
  const answer = answerOf(example);
  if (!answer.trim()) return null;
  return (
    <div className="rounded-md border border-dashed border-line bg-white p-4 text-sm" aria-label="Speaking practice preview">
      <p className="mb-1 text-xs uppercase tracking-wide text-muted">Speaking practice shows</p>
      <p className="font-serif text-base">{clozeOf(example)}</p>
      <p className="mt-1 text-muted">Answer: <span className="font-medium text-ink">{answer}</span></p>
    </div>
  );
}

/** Convex errors carry the message the server threw in `data`. */
export function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "data" in error && typeof error.data === "string") return error.data;
  return error instanceof Error ? error.message : "Something went wrong";
}
