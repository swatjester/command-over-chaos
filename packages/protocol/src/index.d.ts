import { z } from "zod";
export declare const MoveModeSchema: z.ZodEnum<["sprint", "move", "sneak", "crawl"]>;
export declare const StanceSchema: z.ZodEnum<["stand", "crouch", "prone"]>;
export declare const OrderSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"move">;
    soldierId: z.ZodNumber;
    x: z.ZodNumber;
    y: z.ZodNumber;
    mode: z.ZodOptional<z.ZodEnum<["sprint", "move", "sneak", "crawl"]>>;
}, "strip", z.ZodTypeAny, {
    type: "move";
    soldierId: number;
    x: number;
    y: number;
    mode?: "sprint" | "move" | "sneak" | "crawl" | undefined;
}, {
    type: "move";
    soldierId: number;
    x: number;
    y: number;
    mode?: "sprint" | "move" | "sneak" | "crawl" | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"stance">;
    soldierId: z.ZodNumber;
    stance: z.ZodEnum<["stand", "crouch", "prone"]>;
}, "strip", z.ZodTypeAny, {
    stance: "stand" | "crouch" | "prone";
    type: "stance";
    soldierId: number;
}, {
    stance: "stand" | "crouch" | "prone";
    type: "stance";
    soldierId: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"halt">;
    soldierId: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "halt";
    soldierId: number;
}, {
    type: "halt";
    soldierId: number;
}>]>;
export declare const ClientMsgSchema: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
    t: z.ZodLiteral<"join">;
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "join";
    name: string;
}, {
    t: "join";
    name: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"orders">;
    orders: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"move">;
        soldierId: z.ZodNumber;
        x: z.ZodNumber;
        y: z.ZodNumber;
        mode: z.ZodOptional<z.ZodEnum<["sprint", "move", "sneak", "crawl"]>>;
    }, "strip", z.ZodTypeAny, {
        type: "move";
        soldierId: number;
        x: number;
        y: number;
        mode?: "sprint" | "move" | "sneak" | "crawl" | undefined;
    }, {
        type: "move";
        soldierId: number;
        x: number;
        y: number;
        mode?: "sprint" | "move" | "sneak" | "crawl" | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"stance">;
        soldierId: z.ZodNumber;
        stance: z.ZodEnum<["stand", "crouch", "prone"]>;
    }, "strip", z.ZodTypeAny, {
        stance: "stand" | "crouch" | "prone";
        type: "stance";
        soldierId: number;
    }, {
        stance: "stand" | "crouch" | "prone";
        type: "stance";
        soldierId: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"halt">;
        soldierId: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "halt";
        soldierId: number;
    }, {
        type: "halt";
        soldierId: number;
    }>]>, "many">;
}, "strip", z.ZodTypeAny, {
    t: "orders";
    orders: ({
        type: "move";
        soldierId: number;
        x: number;
        y: number;
        mode?: "sprint" | "move" | "sneak" | "crawl" | undefined;
    } | {
        stance: "stand" | "crouch" | "prone";
        type: "stance";
        soldierId: number;
    } | {
        type: "halt";
        soldierId: number;
    })[];
}, {
    t: "orders";
    orders: ({
        type: "move";
        soldierId: number;
        x: number;
        y: number;
        mode?: "sprint" | "move" | "sneak" | "crawl" | undefined;
    } | {
        stance: "stand" | "crouch" | "prone";
        type: "stance";
        soldierId: number;
    } | {
        type: "halt";
        soldierId: number;
    })[];
}>, z.ZodObject<{
    t: z.ZodLiteral<"ping">;
    n: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    t: "ping";
    n: number;
}, {
    t: "ping";
    n: number;
}>]>;
export type ClientMsg = z.infer<typeof ClientMsgSchema>;
export declare const SoldierSnapshotSchema: z.ZodObject<{
    id: z.ZodNumber;
    team: z.ZodUnion<[z.ZodLiteral<0>, z.ZodLiteral<1>]>;
    x: z.ZodNumber;
    y: z.ZodNumber;
    tx: z.ZodNullable<z.ZodNumber>;
    ty: z.ZodNullable<z.ZodNumber>;
    stance: z.ZodEnum<["stand", "crouch", "prone"]>;
    moveMode: z.ZodEnum<["sprint", "move", "sneak", "crawl"]>;
    hp: z.ZodNumber;
    suppression: z.ZodNumber;
    alive: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    stance: "stand" | "crouch" | "prone";
    alive: boolean;
    x: number;
    y: number;
    id: number;
    team: 0 | 1;
    tx: number | null;
    ty: number | null;
    moveMode: "sprint" | "move" | "sneak" | "crawl";
    hp: number;
    suppression: number;
}, {
    stance: "stand" | "crouch" | "prone";
    alive: boolean;
    x: number;
    y: number;
    id: number;
    team: 0 | 1;
    tx: number | null;
    ty: number | null;
    moveMode: "sprint" | "move" | "sneak" | "crawl";
    hp: number;
    suppression: number;
}>;
export declare const ServerMsgSchema: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
    t: z.ZodLiteral<"welcome">;
    playerId: z.ZodString;
    team: z.ZodUnion<[z.ZodLiteral<0>, z.ZodLiteral<1>]>;
    yourSoldierIds: z.ZodArray<z.ZodNumber, "many">;
    mapW: z.ZodNumber;
    mapH: z.ZodNumber;
    tickRate: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    t: "welcome";
    team: 0 | 1;
    playerId: string;
    yourSoldierIds: number[];
    mapW: number;
    mapH: number;
    tickRate: number;
}, {
    t: "welcome";
    team: 0 | 1;
    playerId: string;
    yourSoldierIds: number[];
    mapW: number;
    mapH: number;
    tickRate: number;
}>, z.ZodObject<{
    t: z.ZodLiteral<"snapshot">;
    tick: z.ZodNumber;
    hash: z.ZodNumber;
    soldiers: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        team: z.ZodUnion<[z.ZodLiteral<0>, z.ZodLiteral<1>]>;
        x: z.ZodNumber;
        y: z.ZodNumber;
        tx: z.ZodNullable<z.ZodNumber>;
        ty: z.ZodNullable<z.ZodNumber>;
        stance: z.ZodEnum<["stand", "crouch", "prone"]>;
        moveMode: z.ZodEnum<["sprint", "move", "sneak", "crawl"]>;
        hp: z.ZodNumber;
        suppression: z.ZodNumber;
        alive: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        stance: "stand" | "crouch" | "prone";
        alive: boolean;
        x: number;
        y: number;
        id: number;
        team: 0 | 1;
        tx: number | null;
        ty: number | null;
        moveMode: "sprint" | "move" | "sneak" | "crawl";
        hp: number;
        suppression: number;
    }, {
        stance: "stand" | "crouch" | "prone";
        alive: boolean;
        x: number;
        y: number;
        id: number;
        team: 0 | 1;
        tx: number | null;
        ty: number | null;
        moveMode: "sprint" | "move" | "sneak" | "crawl";
        hp: number;
        suppression: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    t: "snapshot";
    tick: number;
    hash: number;
    soldiers: {
        stance: "stand" | "crouch" | "prone";
        alive: boolean;
        x: number;
        y: number;
        id: number;
        team: 0 | 1;
        tx: number | null;
        ty: number | null;
        moveMode: "sprint" | "move" | "sneak" | "crawl";
        hp: number;
        suppression: number;
    }[];
}, {
    t: "snapshot";
    tick: number;
    hash: number;
    soldiers: {
        stance: "stand" | "crouch" | "prone";
        alive: boolean;
        x: number;
        y: number;
        id: number;
        team: 0 | 1;
        tx: number | null;
        ty: number | null;
        moveMode: "sprint" | "move" | "sneak" | "crawl";
        hp: number;
        suppression: number;
    }[];
}>, z.ZodObject<{
    t: z.ZodLiteral<"pong">;
    n: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    t: "pong";
    n: number;
}, {
    t: "pong";
    n: number;
}>]>;
export type ServerMsg = z.infer<typeof ServerMsgSchema>;
export type SoldierSnapshot = z.infer<typeof SoldierSnapshotSchema>;
