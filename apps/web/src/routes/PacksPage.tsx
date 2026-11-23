import { Link } from "@tanstack/react-router";
import { api } from "@backend/_generated/api";
import { Button } from "@/components/ui/button";
import { useTokenMutation, useTokenQuery } from "@/lib/convex";
import { PACKS, type Pack } from "@/lib/packs";
import { useAsyncAction } from "@/lib/useAsyncAction";

const RANKS: [number, string][] = [[1, "All ranks"], [2501, "Rank 2,501 and beyond"], [7001, "Rank 7,001 and beyond"]];
const TOPICS: [string, string][] = [["daily", "Daily life"], ["culture", "Culture"], ["news", "News"]];

/** Learning preferences and the catalogue's packs, as on the phone's Vocabulary packs page. */
export function PacksPage() {
  const prefs = useTokenQuery(api.packs.learningPreferences, {});
  const installed = useTokenQuery(api.packs.installedPacks, {});
  const setPreferences = useTokenMutation(api.packs.setPreferences);
  const install = useTokenMutation(api.packs.installPack);
  const { run, pending, error } = useAsyncAction();
  if (prefs === undefined || installed === undefined) return <p className="text-muted">Loading…</p>;
  // Each control sends only its own change, applied to the current settings on the server.
  const toggle = (topic: string) => {
    const selected = !prefs.interests.includes(topic);
    // At least one topic stays selected, as on the phone.
    if (selected || prefs.interests.length > 1) void run(() => setPreferences({ topic: { name: topic, selected } }));
  };
  return (
    <section className="max-w-3xl space-y-8">
      <h1 className="font-semibold text-3xl">Packs</h1>
      <div className="space-y-3">
        <h2 className="font-semibold text-xl">Learning preferences</h2>
        <p className="text-sm text-muted">These choose which new meanings come first, on the web and on your phones after they sync.</p>
        <p className="text-sm">Not sure where to start? <Link to="/placement" className="underline">Take the vocabulary starting check</Link>.</p>
        <fieldset className="space-y-1" disabled={pending}>
          <legend className="text-sm font-medium">Start new meanings from</legend>
          {RANKS.map(([rank, label]) => (
            <label key={rank} className="flex items-center gap-2 text-sm">
              <input type="radio" name="rank" checked={prefs.minimumRank === rank} onChange={() => void run(() => setPreferences({ minimumRank: rank }))} />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset className="space-y-1" disabled={pending}>
          <legend className="text-sm font-medium">Your interests</legend>
          {TOPICS.map(([topic, label]) => (
            <label key={topic} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={prefs.interests.includes(topic)} onChange={() => toggle(topic)} />
              {label}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="space-y-3">
        <h2 className="font-semibold text-xl">Vocabulary packs</h2>
        <p className="text-sm text-muted">Installing a pack here adds its meanings to your study at once; phones install it on their next sync. Packs can't be uninstalled.</p>
        <ul className="space-y-3">
          {PACKS.map((pack) => (
            <PackRow key={pack.id} pack={pack} installed={pack.builtIn || installed.includes(pack.id)} disabled={pending}
              onInstall={() => void run(() => install({ packId: pack.id, packVersion: pack.packVersion, source: pack.source, license: pack.license }))} />
          ))}
        </ul>
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </section>
  );
}

function PackRow({ pack, installed, disabled, onInstall }: { pack: Pack; installed: boolean; disabled: boolean; onInstall: () => void }) {
  return (
    <li className="space-y-1 rounded-panel border border-line bg-surface p-4" aria-label={pack.title}>
      <div className="flex items-center gap-3">
        <p className="font-semibold">{pack.title}</p>
        <span className="text-sm text-muted">{pack.meanings.toLocaleString("en")} meanings</span>
        <span className="ml-auto">
          {pack.builtIn ? <span className="text-sm text-muted">Built in</span>
            : installed ? <span className="text-sm text-muted">Installed</span>
              : <Button size="sm" disabled={disabled} onClick={onInstall}>Install</Button>}
        </span>
      </div>
      <p className="text-sm">{pack.description}</p>
      <p className="text-xs text-muted">Licence: {pack.license}</p>
    </li>
  );
}
