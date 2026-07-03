export declare const GAME_NAME = "Command over Chaos";
export declare const GAME_ABBR = "CoC";
export declare const DEFAULT_SERVER_PORT = 8787;
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
export declare const FIRETEAMS: FireteamArchetype[];
