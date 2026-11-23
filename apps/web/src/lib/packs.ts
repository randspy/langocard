import { packId as builtInPackId } from "@bundled-pack";
import catalogue from "@content/catalogue.json";

/**
 * The catalogue's packs with what installing one records (its source, licence and version),
 * read from each pack file at build time; only these fields are bundled.
 */
const field = <T,>(files: Record<string, T>) => (packId: string) =>
  Object.entries(files).find(([path]) => path.endsWith(`/${packId}.json`))?.[1];
const sources = field(import.meta.glob<string>("../../../../content/fr-core-*.json", { eager: true, import: "source" }));
const licenses = field(import.meta.glob<string>("../../../../content/fr-core-*.json", { eager: true, import: "license" }));
const versions = field(import.meta.glob<number>("../../../../content/fr-core-*.json", { eager: true, import: "packVersion" }));

/** The pack the APK ships with: always installed. */
export const BUILT_IN_PACK: string = builtInPackId;

export type Pack = {
  id: string; title: string; description: string; meanings: number;
  source: string; license: string; packVersion: number; builtIn: boolean;
};

export const PACKS: Pack[] = catalogue.packs.map((p) => ({
  id: p.id, title: p.title, description: p.description, meanings: p.meanings,
  source: sources(p.id) ?? "", license: licenses(p.id) ?? "", packVersion: versions(p.id) ?? 1, builtIn: p.id === BUILT_IN_PACK,
}));
