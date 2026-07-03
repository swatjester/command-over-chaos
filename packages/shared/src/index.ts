import fireteamsJson from "./fireteams.json" with { type: "json" };

export const GAME_NAME = "Command over Chaos";
export const GAME_ABBR = "CoC";
export const DEFAULT_SERVER_PORT = 8787;

export interface SoldierTemplate {
  role: string;
  weapon: string;
  acc: number;
  tough: number;
  speed: number;
  stealth: number;
  aware: number;
}

export interface FireteamArchetype {
  id: string;
  name: string;
  ability: string;
  passive: string;
  soldiers: SoldierTemplate[];
}

export const FIRETEAMS: FireteamArchetype[] = fireteamsJson.archetypes;

/** M2 archetype proxies: preset weapon kits until abilities/stats land (M3).
 *  Grenadiers (carbine_gl) launch frags/smokes from the GL: long range, tight
 *  accuracy, stun-not-kill warheads. Everyone else hand-tosses. */
export type PlayableArchetype = "infantry" | "rangers" | "recon";
export interface KitSoldier { weapon: string; frags: number; smokes: number; }
export const ARCHETYPE_KITS: Record<PlayableArchetype, [KitSoldier, KitSoldier, KitSoldier, KitSoldier]> = {
  infantry: [
    { weapon: "carbine", frags: 2, smokes: 1 },
    { weapon: "carbine", frags: 2, smokes: 1 },
    { weapon: "lmg", frags: 2, smokes: 1 },
    { weapon: "carbine_gl", frags: 6, smokes: 4 },
  ],
  rangers: [ // rangers carry one extra of each
    { weapon: "carbine", frags: 3, smokes: 2 },
    { weapon: "smg", frags: 3, smokes: 2 },
    { weapon: "carbine_gl", frags: 7, smokes: 5 },
    { weapon: "smg", frags: 3, smokes: 2 },
  ],
  recon: [
    { weapon: "carbine", frags: 2, smokes: 1 },
    { weapon: "dmr", frags: 2, smokes: 1 },
    { weapon: "carbine_gl", frags: 6, smokes: 4 },
    { weapon: "smg", frags: 2, smokes: 1 },
  ],
};
