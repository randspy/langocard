# Personal memory hooks

A hook belongs to an entry, across every skill. Four consecutive misses pause the skill for three days and offer a skippable note. Reveal displays the note. The web entry page edits it.

Hooks are separate from shipped vocabulary. Each stores entryId, text (up to 500 characters), and editedAt. Sync uses the strictly newer edit; ties retain the stored note. Empty text is a clearing tombstone. Android sends hooks in bounded batches on every sync, including after restore. Older clients can omit hooks. New clients require a backend with the hooks table before syncing.

Keeping notes inside entry content was rejected because an unrelated vocabulary edit or seed could overwrite a learner's association. A separate per-entry map also keeps notes in the existing atomic study file and backup envelope without changing scheduling identity.
