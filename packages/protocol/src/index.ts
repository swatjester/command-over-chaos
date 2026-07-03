import { z } from "zod";

// ---- client -> server ----------------------------------------------------

export const MoveModeSchema = z.enum(["sprint", "move", "sneak", "crawl"]);
export const StanceSchema = z.enum(["stand", "crouch", "prone"]);
export const WeaponIdSchema = z.enum(["carbine", "smg", "dmr", "lmg"]);

export const OrderSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("move"),
    soldierId: z.number().int().nonnegative(),
    x: z.number().int(),
    y: z.number().int(),
    mode: MoveModeSchema.optional(),
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
    type: z.literal("halt"),
    soldierId: z.number().int().nonnegative(),
  }),
]);

export const ClientMsgSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("join"), name: z.string().min(1).max(24) }),
  z.object({ t: z.literal("orders"), orders: z.array(OrderSchema).max(16) }),
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
    events: z.array(ShotEventSchema),
  }),
  z.object({ t: z.literal("pong"), n: z.number().int() }),
]);
export type ServerMsg = z.infer<typeof ServerMsgSchema>;
export type SoldierSnapshot = z.infer<typeof SoldierSnapshotSchema>;
export type ShotEvent = z.infer<typeof ShotEventSchema>;
