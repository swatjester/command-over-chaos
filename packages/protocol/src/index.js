import { z } from "zod";
// ---- client -> server ----------------------------------------------------
export const MoveModeSchema = z.enum(["sprint", "move", "sneak", "crawl"]);
export const StanceSchema = z.enum(["stand", "crouch", "prone"]);
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
        type: z.literal("halt"),
        soldierId: z.number().int().nonnegative(),
    }),
]);
export const ClientMsgSchema = z.discriminatedUnion("t", [
    z.object({ t: z.literal("join"), name: z.string().min(1).max(24) }),
    z.object({ t: z.literal("orders"), orders: z.array(OrderSchema).max(16) }),
    z.object({ t: z.literal("ping"), n: z.number().int() }),
]);
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
        soldiers: z.array(SoldierSnapshotSchema),
    }),
    z.object({ t: z.literal("pong"), n: z.number().int() }),
]);
//# sourceMappingURL=index.js.map