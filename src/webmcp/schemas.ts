import { z } from "zod";

const idSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/, "Use a compact stable element ID.");
const coordinateSchema = z.number().finite().min(-100_000).max(100_000);
const dimensionSchema = z.number().finite().positive().max(10_000);
const colorSchema = z.union([
  z.literal("transparent"),
  z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color."),
]);

const addElementSchema = z
  .object({
    id: idSchema,
    type: z.enum(["rectangle", "diamond", "ellipse", "text", "frame"]),
    x: coordinateSchema,
    y: coordinateSchema,
    width: dimensionSchema.optional(),
    height: dimensionSchema.optional(),
    text: z.string().min(1).max(1_000).optional(),
    strokeColor: colorSchema.optional(),
    backgroundColor: colorSchema.optional(),
    strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
    fillStyle: z.enum(["solid", "hachure", "cross-hatch"]).optional(),
    strokeWidth: z.number().int().min(1).max(4).optional(),
    roughness: z.number().int().min(0).max(2).optional(),
    opacity: z.number().int().min(0).max(100).optional(),
    locked: z.boolean().optional(),
    children: z.array(idSchema).max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type === "text" && !value.text) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Text elements require text.",
      });
    }
    if (value.type !== "frame" && value.children) {
      context.addIssue({
        code: "custom",
        path: ["children"],
        message: "Only frames can contain child IDs.",
      });
    }
  });

export const addElementsSchema = z
  .object({ elements: z.array(addElementSchema).min(1).max(50) })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.elements.forEach((element, index) => {
      if (seen.has(element.id)) {
        context.addIssue({
          code: "custom",
          path: ["elements", index, "id"],
          message: `Duplicate element ID: ${element.id}`,
        });
      }
      seen.add(element.id);
    });
  });

const updateElementSchema = z
  .object({
    id: idSchema,
    x: coordinateSchema.optional(),
    y: coordinateSchema.optional(),
    width: dimensionSchema.optional(),
    height: dimensionSchema.optional(),
    angle: z.number().finite().min(-Math.PI * 2).max(Math.PI * 2).optional(),
    text: z.string().min(1).max(1_000).optional(),
    strokeColor: colorSchema.optional(),
    backgroundColor: colorSchema.optional(),
    strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
    fillStyle: z.enum(["solid", "hachure", "cross-hatch"]).optional(),
    opacity: z.number().int().min(0).max(100).optional(),
    locked: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "id"),
    "Provide at least one property to update.",
  );

export const updateElementsSchema = z
  .object({ updates: z.array(updateElementSchema).min(1).max(50) })
  .strict();

export const deleteElementsSchema = z
  .object({ ids: z.array(idSchema).min(1).max(100) })
  .strict()
  .refine((value) => new Set(value.ids).size === value.ids.length, {
    path: ["ids"],
    message: "Element IDs must be unique.",
  });

const connectionSchema = z
  .object({
    id: idSchema,
    fromId: idSchema,
    toId: idSchema,
    label: z.string().min(1).max(200).optional(),
    strokeColor: colorSchema.optional(),
    strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  })
  .strict()
  .refine((value) => value.fromId !== value.toId, {
    path: ["toId"],
    message: "A connection needs two different endpoints.",
  });

export const connectElementsSchema = z
  .object({ connections: z.array(connectionSchema).min(1).max(50) })
  .strict()
  .refine(
    (value) =>
      new Set(value.connections.map((connection) => connection.id)).size ===
      value.connections.length,
    { path: ["connections"], message: "Connection IDs must be unique." },
  );

export const moveAgentCursorSchema = z
  .object({
    x: coordinateSchema,
    y: coordinateSchema,
    activity: z
      .enum(["moving", "thinking", "reading", "editing"])
      .optional(),
  })
  .strict();

export const emptyInputSchema = z.object({}).strict();

export function asJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
}

export type AddElementsInput = z.infer<typeof addElementsSchema>;
export type UpdateElementsInput = z.infer<typeof updateElementsSchema>;
export type DeleteElementsInput = z.infer<typeof deleteElementsSchema>;
export type ConnectElementsInput = z.infer<typeof connectElementsSchema>;
export type MoveAgentCursorInput = z.infer<typeof moveAgentCursorSchema>;
