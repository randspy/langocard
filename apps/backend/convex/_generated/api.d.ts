/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as anki from "../anki.js";
import type * as cardState from "../cardState.js";
import type * as cards from "../cards.js";
import type * as entries from "../entries.js";
import type * as entryRules from "../entryRules.js";
import type * as fittedSettings from "../fittedSettings.js";
import type * as fsrs from "../fsrs.js";
import type * as library from "../library.js";
import type * as merge from "../merge.js";
import type * as packs from "../packs.js";
import type * as migrations from "../migrations.js";
import type * as seed from "../seed.js";
import type * as skills from "../skills.js";
import type * as study from "../study.js";
import type * as stuckWords from "../stuckWords.js";
import type * as studyProgress from "../studyProgress.js";
import type * as studyOrder from "../studyOrder.js";
import type * as studyPolicy from "../studyPolicy.js";
import type * as studyIndex from "../studyIndex.js";
import type * as sync from "../sync.js";
import type * as typedAnswer from "../typedAnswer.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  anki: typeof anki;
  cardState: typeof cardState;
  cards: typeof cards;
  entries: typeof entries;
  entryRules: typeof entryRules;
  fittedSettings: typeof fittedSettings;
  fsrs: typeof fsrs;
  library: typeof library;
  merge: typeof merge;
  packs: typeof packs;
  migrations: typeof migrations;
  seed: typeof seed;
  skills: typeof skills;
  study: typeof study;
  stuckWords: typeof stuckWords;
  studyProgress: typeof studyProgress;
  studyOrder: typeof studyOrder;
  studyPolicy: typeof studyPolicy;
  studyIndex: typeof studyIndex;
  sync: typeof sync;
  typedAnswer: typeof typedAnswer;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
