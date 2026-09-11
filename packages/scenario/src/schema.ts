import { z } from "zod";
import { ConstraintsSchema, PermissionsSchema } from "@oathra/contract";

export const PersonaSchema = z
  .object({
    /** Display name of the callee character. */
    name: z.string().default("Callee"),
    /** 0..1: how many pushbacks before the character gets short. */
    patience: z.number().min(0).max(1).default(0.7),
    /** 0..1: willingness to move on price/terms. */
    flexibility: z.number().min(0).max(1).default(0.5),
    friendliness: z.number().min(0).max(1).default(0.6),
    /** Optional ASCII/emoji face shown in Play mode. */
    avatar: z.string().optional(),
    /** Free-form hints used by LLM callee brains. */
    style: z.string().optional(),
  })
  .strict();

/** Knowledge the callee character has. Keys are domain-specific. */
export const KnowledgeSchema = z.record(z.string(), z.unknown());

export const MissionSchema = z
  .object({
    /** Dotted goal id, maps to CallContract.goal. */
    objective: z.string().min(1),
    /** Inputs the agent starts with (date, party size...). */
    input: z.record(z.string(), z.unknown()).default({}),
    /** Constraints in CallContract form. */
    constraints: ConstraintsSchema.default({}),
    /** Fields that must be verified for success. */
    require: z.record(z.string(), z.boolean()).default({}),
    permissions: PermissionsSchema.default({}),
    /** Text shown to the player describing the mission. */
    brief: z.string().optional(),
  })
  .strict();

export const WinSchema = z.record(z.string(), z.union([z.boolean(), z.string(), z.number(), ConstraintsSchema.valueSchema]));

export const ScoreSchema = z
  .object({
    success: z.number().default(5000),
    /** Weight of money saved relative to the standard price. */
    price_saved: z.number().min(0).max(1).default(0),
    latency: z.number().min(0).max(1).default(0.1),
    turns: z.number().min(0).max(1).default(0.1),
  })
  .strict();

export const ScenarioSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    title: z.string().min(1),
    description: z.string().optional(),
    difficulty: z.enum(["easy", "normal", "hard", "extreme"]).default("normal"),
    language: z.enum(["ja", "en"]).default("ja"),
    /** Domain the scripted callee uses: selects the built-in character logic. */
    domain: z.enum(["restaurant", "hotel", "shop", "serial", "mystery", "generic"]).default("generic"),
    tags: z.array(z.string()).default([]),
    mission: MissionSchema,
    callee: z
      .object({
        persona: PersonaSchema.default({}),
        knowledge: KnowledgeSchema.default({}),
        rules: z.array(z.string()).default([]),
        /** Opening line when the callee answers the phone. */
        greeting: z.string().optional(),
      })
      .strict(),
    win: WinSchema.default({}),
    score: ScoreSchema.default({}),
    /** Deterministic seed for the simulator. */
    seed: z.number().int().default(1),
  })
  .strict();

export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScenarioInput = z.input<typeof ScenarioSchema>;
export type Persona = z.infer<typeof PersonaSchema>;
export type Mission = z.infer<typeof MissionSchema>;
