import { useEffect, useMemo, useState, type FormEvent } from "react";
import { GENDERS, MAX_EXAMPLES, TOPICS, alternativesOf, answerOf, articleGender, clozeOf, entryErrors, sameContent, type EntryContent, type Gender, type RuleError } from "@backend/entryRules";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { GENDER_LABELS } from "@/lib/library";
import { EntryDrafter, genderOf, SINGLE_FIELDS, type DraftField } from "@/lib/entryDrafter";
import type { Availability, OnDeviceModel } from "@/lib/onDeviceModel";
import { MODEL_SIZE } from "@/lib/onDeviceModel";
import { errorMessage, useAsyncAction } from "@/lib/useAsyncAction";

/** The content the learner edits here; rank and source metadata come with the entry. */
type Field = "word" | "gender" | "english" | "definition" | "examples" | "topic" | "lemma";
type TextField = Exclude<Field, "examples">;
const FIELDS: { field: Field; label: string; hint?: string; control: "input" | "textarea" | "topic" | "gender" | "examples" }[] = [
  { field: "word", label: "French word or phrase", hint: "Include the article for nouns, e.g. “une rencontre”.", control: "input" },
  { field: "gender", label: "Gender", hint: "Nouns get a Gender card on the phone: choose un or une.", control: "gender" },
  { field: "english", label: "English", control: "input" },
  { field: "definition", label: "Definition", control: "textarea" },
  {
    field: "examples", label: "Examples", control: "examples",
    hint: `1 to ${MAX_EXAMPLES} sentences, each with the answer in {braces}: “Il pleut, {pourtant} elle sort.” Add other words the gap accepts after a bar: “{pourtant|cependant}”. Practice shows them in turn, starting with the first.`,
  },
  { field: "lemma", label: "Lemma", hint: "Dictionary form, used to group related meanings. Optional.", control: "input" },
  { field: "topic", label: "Topic", control: "topic" },
];
const isEditable = (field: string): field is Field => FIELDS.some((f) => f.field === field);

type Props = {
  initial: EntryContent;
  /** ID used for validation; new entries use a placeholder personal ID. */
  entryId: string;
  submitLabel: string;
  disabled?: boolean;
  /** Resolves when saved; a thrown error is shown under the form. */
  onSubmit: (content: EntryContent) => Promise<void>;
  /** An on-device model that can draft the entry from its English meaning ("AI fill"). */
  ai?: OnDeviceModel;
};

type SingleField = (typeof SINGLE_FIELDS)[number];

export function EntryForm({ initial, entryId, submitLabel, disabled, onSubmit, ai }: Props) {
  const [content, setContent] = useState(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const { run, pending: saving, error: serverError } = useAsyncAction();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const errors = entryErrors(entryId, content);
  const shown = (key: string) => submitted || touched.has(key);
  const touch = (key: string) => setTouched(new Set(touched).add(key));
  const errorFor = (field: Field): RuleError | undefined =>
    shown(field) ? errors.find((e) => e.field === field && e.index === undefined) : undefined;
  const unchanged = sameContent(content, initial);
  // A new entry's gender follows the article typed in the word until the learner picks one.
  const [genderChosen, setGenderChosen] = useState(initial.word !== "");
  // Drafted values stay "drafted" until the learner edits them; regenerating replaces only those.
  const [drafted, setDrafted] = useState<Set<SingleField>>(new Set());
  const [draftedExamples, setDraftedExamples] = useState<Set<string>>(new Set());
  const set = (field: TextField, value: string) => {
    const next = field === "gender" ? { ...content, gender: (value || null) as Gender | null } : { ...content, [field]: value };
    if (field === "gender") setGenderChosen(true);
    if (drafted.has(field as SingleField)) setDrafted(new Set([...drafted].filter((f) => f !== field)));
    if (field === "word" && !genderChosen) {
      // A typed article decides; without one, a drafted gender stays (as for "l'intrigue").
      const stated = articleGender(value);
      if (stated !== null || !drafted.has("gender")) next.gender = stated;
    }
    change(next);
  };
  const change = (next: EntryContent) => {
    setContent(next);
    setSavedAt(null);
  };

  // While the model drafts, the form is locked so its reply can't overwrite new edits.
  const [drafting, setDrafting] = useState(false);
  async function draftWith(drafter: EntryDrafter): Promise<string> {
    setDrafting(true);
    try {
      return await draftInto(drafter);
    } finally {
      setDrafting(false);
    }
  }

  /** Drafts what the learner hasn't written, keeping everything they did. */
  async function draftInto(drafter: EntryDrafter): Promise<string> {
    const kept: Partial<Record<SingleField, string>> = {};
    if (!drafted.has("word")) kept.word = content.word;
    if (!drafted.has("definition")) kept.definition = content.definition;
    if (genderChosen && !drafted.has("gender")) kept.gender = content.gender ?? "none";
    const own = content.examples.filter((e) => e.trim() && !draftedExamples.has(e));
    const draft = await drafter.draft(content.english, kept, own);
    const next = { ...content };
    const apply = (field: SingleField, value: string | undefined) => {
      if (field === "gender") next.gender = value === undefined ? null : genderOf(value);
      else next[field] = value ?? "";
    };
    for (const field of SINGLE_FIELDS) {
      if (draft.filled[field] !== undefined) apply(field, draft.filled[field]);
      // A stale drafted value that couldn't be redrafted no longer fits; the learner writes it.
      else if (draft.unfilled.has(field) && drafted.has(field)) apply(field, undefined);
    }
    // Drafted examples are replaced; a stale one that couldn't be redrafted goes too.
    next.examples = [...own, ...draft.examples];
    if (next.examples.length === 0) next.examples = [""];
    setDrafted(new Set([...[...drafted].filter((f) => !draft.unfilled.has(f)), ...(Object.keys(draft.filled) as SingleField[])]));
    setDraftedExamples(new Set(draft.examples));
    change(next);
    if (draft.unfilled.size === 0) return "Check the draft before saving.";
    const missing = [...draft.unfilled].map((f: DraftField) => `the ${f}`).join(" or ");
    return `Couldn't draft ${missing}. Write ${draft.unfilled.size === 1 && !draft.unfilled.has("examples") ? "it" : "them"} yourself.`;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (errors.length > 0 || unchanged) return;
    if (await run(() => onSubmit(content))) setSavedAt(Date.now());
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <fieldset disabled={disabled || saving || drafting} className="space-y-5">
        {FIELDS.map(({ field, label, hint, control }) => {
          const error = errorFor(field);
          const id = `entry-${field}`;
          if (field === "examples") {
            return (
              <Examples key={field} examples={content.examples} hint={hint} error={error}
                errorAt={(index) => (shown(`examples.${index}`) ? errors.find((e) => e.field === field && e.index === index) : undefined)}
                onTouch={touch} onChange={(examples) => change({ ...content, examples })} />
            );
          }
          const props = {
            id,
            value: content[field] ?? "",
            "aria-invalid": error ? true : undefined,
            "aria-describedby": `${id}-hint ${id}-error`,
            onBlur: () => touch(field),
            onChange: (e: { target: { value: string } }) => set(field, e.target.value),
          };
          return (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={id}>{label}</Label>
              {control === "input" && <Input {...props} />}
              {control === "textarea" && <Textarea {...props} />}
              {control === "gender" && (
                <Select {...props} className="block">
                  <option value="">Not a noun</option>
                  {GENDERS.map((gender) => <option key={gender} value={gender}>{GENDER_LABELS[gender]}</option>)}
                </Select>
              )}
              {control === "topic" && (
                <Select {...props} className="block">
                  {TOPICS.map((topic) => <option key={topic} value={topic} className="capitalize">{topic}</option>)}
                </Select>
              )}
              {hint && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
              {error && <p id={`${id}-error`} className="text-sm text-danger">{error.message}</p>}
            </div>
          );
        })}
      </fieldset>

      {ai && (
        <AiFill model={ai} english={content.english} anyDrafted={drafted.size > 0 || draftedExamples.size > 0}
          disabled={disabled || saving} onDraft={draftWith} />
      )}

      <Preview examples={content.examples} />

      {submitted && errors.some((e) => !isEditable(e.field)) && (
        <p className="text-sm text-danger">This entry's dictionary metadata is invalid; it can't be saved from here.</p>
      )}
      {serverError && <p role="alert" className="text-sm text-danger">{serverError}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={disabled || saving || drafting || unchanged}>{saving ? "Saving…" : submitLabel}</Button>
        {savedAt && <span role="status" className="text-sm text-muted">Saved. Your phone picks it up on its next sync.</span>}
      </div>
    </form>
  );
}

/**
 * Edits a meaning's ordered examples: add (up to `MAX_EXAMPLES`), remove (keeping one) and
 * move up, since the first is the introductory example. Errors show under the example
 * they belong to; list-wide ones (count, duplicates) under the list.
 */
function Examples({ examples, hint, error, errorAt, onTouch, onChange }: {
  examples: string[];
  hint?: string;
  error?: RuleError;
  errorAt: (index: number) => RuleError | undefined;
  onTouch: (key: string) => void;
  onChange: (examples: string[]) => void;
}) {
  const replace = (index: number, value: string) => onChange(examples.map((e, i) => (i === index ? value : e)));
  const remove = (index: number) => onChange(examples.filter((_, i) => i !== index));
  const moveUp = (index: number) =>
    onChange(examples.map((e, i) => (i === index - 1 ? examples[index] : i === index ? examples[index - 1] : e)));
  return (
    <fieldset className="space-y-3" aria-describedby="entry-examples-hint entry-examples-error">
      <legend className="text-sm font-medium">Examples</legend>
      {hint && <p id="entry-examples-hint" className="text-xs text-muted">{hint}</p>}
      {examples.map((example, index) => {
        const id = `entry-example-${index}`;
        const problem = errorAt(index);
        return (
          <div key={index} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor={id}>Example {index + 1}</Label>
              <div className="ml-auto flex gap-1">
                <Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => moveUp(index)}
                  aria-label={`Move example ${index + 1} up`}>Move up</Button>
                <Button type="button" size="sm" variant="ghost" disabled={examples.length === 1} onClick={() => remove(index)}
                  aria-label={`Remove example ${index + 1}`}>Remove</Button>
              </div>
            </div>
            <Textarea id={id} value={example} aria-invalid={problem ? true : undefined} aria-describedby={`${id}-error`}
              onBlur={() => onTouch(`examples.${index}`)} onChange={(e) => replace(index, e.target.value)} />
            {problem && <p id={`${id}-error`} className="text-sm text-danger">{problem.message}</p>}
          </div>
        );
      })}
      <Button type="button" size="sm" variant="outline" disabled={examples.length >= MAX_EXAMPLES}
        onClick={() => { onTouch("examples"); onChange([...examples, ""]); }}>Add example</Button>
      {error && <p id="entry-examples-error" className="text-sm text-danger">{error.message}</p>}
    </fieldset>
  );
}

/** The cloze each example becomes in speaking practice, in the order practice shows them. */
function Preview({ examples }: { examples: string[] }) {
  const marked = examples.filter((example) => answerOf(example).trim());
  if (marked.length === 0) return null;
  return (
    <div className="rounded-panel border border-dashed border-line bg-surface p-4 text-sm" aria-label="Speaking practice preview">
      <p className="mb-1 text-xs uppercase tracking-wide text-muted">Speaking practice shows, in turn</p>
      <ol className="space-y-2">
        {marked.map((example, index) => (
          <li key={index}>
            <p className="font-semibold text-base">{clozeOf(example)}</p>
            <p className="mt-1 text-muted">Answer: <span className="font-medium text-ink">{answerOf(example)}</span></p>
            {alternativesOf(example).length > 0 && (
              <p className="text-muted">Also accepted: <span className="font-medium text-ink">{alternativesOf(example).join(", ")}</span></p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * "Enable AI fill" and "Fill with AI": downloads the on-device model once, then drafts the
 * entry from its English meaning. Hidden when the browser can't run the model.
 */
function AiFill({ model, english, anyDrafted, disabled, onDraft }: {
  model: OnDeviceModel;
  english: string;
  anyDrafted: boolean;
  disabled?: boolean;
  onDraft: (drafter: EntryDrafter) => Promise<string>;
}) {
  const [availability, setAvailability] = useState<Availability>({ kind: "checking" });
  const [message, setMessage] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const drafter = useMemo(() => new EntryDrafter((prompt) => model.generate(prompt)), [model]);
  useEffect(() => {
    let live = true;
    model.availability().then((a) => { if (live) setAvailability(a); }, () => { if (live) setAvailability({ kind: "unavailable" }); });
    return () => { live = false; };
  }, [model]);

  if (availability.kind === "checking" || availability.kind === "unavailable") return null;
  const download = async () => {
    setAvailability({ kind: "downloading", progress: 0 });
    try {
      await model.download((progress) => setAvailability({ kind: "downloading", progress }));
      setAvailability({ kind: "available" });
    } catch (e) {
      setAvailability({ kind: "downloadable", problem: errorMessage(e) });
    }
  };
  const draft = async () => {
    setDrafting(true);
    setMessage("");
    try {
      setMessage(await onDraft(drafter));
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setDrafting(false);
    }
  };
  const remove = async () => {
    setRemoving(true);
    try {
      await model.remove();
      setMessage("");
      setAvailability({ kind: "downloadable" });
    } catch (e) {
      setMessage(`Could not remove on-device AI: ${errorMessage(e)}`);
    } finally {
      setRemoving(false);
    }
  };
  return (
    <div className="space-y-2 rounded-panel border border-line bg-surface p-4 text-sm" aria-label="AI fill">
      {availability.kind === "downloadable" && (
        <>
          {availability.problem && <p role="alert" className="text-danger">Could not download on-device AI: {availability.problem}</p>}
          <Button type="button" variant="outline" onClick={() => void download()} disabled={disabled}>Enable AI fill</Button>
          <p className="text-xs text-muted">Downloads a small language model once ({MODEL_SIZE}) into this browser. It then runs offline; nothing you type leaves the browser.</p>
        </>
      )}
      {availability.kind === "downloading" && (
        <p role="status">Downloading on-device AI… {Math.round(availability.progress * 100)}%</p>
      )}
      {availability.kind === "available" && (
        <>
          <p className="text-xs text-muted">Type the English meaning, and the French word if you know it. AI fill drafts the rest for you to check.</p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void draft()} disabled={disabled || drafting || removing || !english.trim()}>
              {drafting ? "Drafting…" : anyDrafted ? "Regenerate" : "Fill with AI"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void remove()} disabled={drafting || removing}>Remove on-device AI</Button>
          </div>
          {message && <p role="status">{message}</p>}
        </>
      )}
    </div>
  );
}
