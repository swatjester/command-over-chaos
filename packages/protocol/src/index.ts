import { z } from "zod";

// ---- client -> server ----------------------------------------------------

export const MoveModeSchema = z.enum(["sprint", "move", "sneak", "crawl"]);
export const StanceSchema = z.enum(["stand", "crouch", "prone"]);
export const WeaponIdSchema = z.enum(["carbine", "smg", "dmr", "lmg"]);
export const GrenadeKindSchema = z.enum(["frag", "smoke"]);

export const OrderSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("move"),
    soldierId: z.number().int().nonnegative(),
    x: z.number().int(),
    y: z.number().int(),
    mode: MoveModeSchema.optional(),
    queue: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("mode"),
    soldierId: z.number().int().nonnegative(),
    mode: MoveModeSchema,
  }),
  z.object({
    type: z.literal("stance"),
    soldierId: z.number().int().nonnegative(),
    stance: StanceSchema,
  }),
  z.object({
    type: z.literal("target"),
    soldierId: z.number().int().nonnegative(),
    targetId: z.number().int().nonnegative().nullable(),
  }),
  z.object({
    type: z.literal("throw"),
    soldierId: z.number().int().nonnegative(),
    kind: GrenadeKindSchema,
    x: z.number().int(),
    y: z.number().int(),
  }),
  z.object({
    type: z.literal("aid"),
    soldierId: z.number().int().nonnegative(),
    targetId: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("firemode"),
    soldierId: z.number().int().nonnegative(),
    hold: z.boolean(),
  }),
  z.object({
    type: z.literal("halt"),
    soldierId: z.number().int().nonnegative(),
  }),
]);

export const ClientMsgSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("join"),
    name: z.string().min(1).max(24),
    token: z.string().max(64).optional(),
    archetype: z.enum(["infantry", "rangers", "recon"]).optional(),
  }),
  z.object({ t: z.literal("orders"), orders: z.array(OrderSchema).max(32) }),
  z.object({ t: z.literal("ping"), n: z.number().int() }),
]);
export type ClientMsg = z.infer<typeof ClientMsgSchema>;

// ---- server -> client ----------------------------------------------------

export const SoldierSnapshotSchema = z.object({
  id: z.number().int(),
  team: z.union([z.literal(0), z.literal(1)]),
  x: z.number().int(),
  y: z.number().int(),
  tx: z.number().int().nullable(),
  ty: z.number().int().nullable(),
  stance: StanceSchema,
  moveMode: MoveModeSchema,
  hp: z.number().int(),
  suppression: z.number().int(),
  alive: z.boolean(),
  weapon: WeaponIdSchema,
  targetId: z.number().int().nullable(),
  aimId: z.number().int().nullable(),
  settle: z.number().int(),
  frags: z.number().int(),
  smokes: z.number().int(),
  holdFire: z.boolean(),
  leanX: z.number().int(),
  leanY: z.number().int(),
  down: z.boolean(),
  bleed: z.number().int(),
  aidId: z.number().int().nullable(),
  aidProgress: z.number().int(),
  queue: z.array(z.tuple([z.number().int(), z.number().int()])),
});

export const ShotEventSchema = z.object({
  shooter: z.number().int(),
  target: z.number().int(),
  hit: z.boolean(),
  kill: z.boolean(),
  sx: z.number().int(),
  sy: z.number().int(),
  tx: z.number().int(),
  ty: z.number().int(),
});

export const GrenadeSnapshotSchema = z.object({
  id: z.number().int(),
  kind: GrenadeKindSchema,
  sx: z.number().int(),
  sy: z.number().int(),
  x: z.number().int(),
  y: z.number().int(),
  thrownTick: z.number().int(),
  landTick: z.number().int(),
});

export const SmokeSnapshotSchema = z.object({
  id: z.number().int(),
  x: z.number().int(),
  y: z.number().int(),
  r: z.number().int(),
  ttl: z.number().int(),
});

export const BoomSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  kind: GrenadeKindSchema,
});

export const ServerMsgSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("welcome"),
    playerId: z.string(),
    team: z.union([z.literal(0), z.literal(1)]),
    yourSoldierIds: z.array(z.number().int()),
    mapW: z.number().int(),
    mapH: z.number().int(),
    tickRate: z.number().int(),
  }),
  z.object({
    t: z.literal("snapshot"),
    tick: z.number().int(),
    hash: z.number().int(),
    /** own team always; enemies only while your team has LOS (server-culled fog) */
    soldiers: z.array(SoldierSnapshotSchema),
    shots: z.array(ShotEventSchema),
    booms: z.array(BoomSchema),
    grenades: z.array(GrenadeSnapshotSchema),
    smokes: z.array(SmokeSnapshotSchema),
  }),
  z.object({ t: z.literal("pong"), n: z.number().int() }),
]);
export type ServerMsg = z.infer<typeof ServerMsgSchema>;
export type SoldierSnapshot = z.infer<typeof SoldierSnapshotSchema>;
export type ShotEvent = z.infer<typeof ShotEventSchema>;
export type GrenadeSnapshot = z.infer<typeof GrenadeSnapshotSchema>;
export type SmokeSnapshot = z.infer<typeof SmokeSnapshotSchema>;
export type Boom = z.infer<typeof BoomSchema>;
