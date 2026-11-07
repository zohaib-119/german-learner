import { z } from 'zod';

/** Current lesson file format version. Bump + add a migration when it changes. */
export const SCHEMA_VERSION = 1;

const id = z.string().min(1).regex(/^[\w.\-]+$/, 'use letters, digits, _ . - only');
const text = z.string().trim().min(1);

export const ExampleSchema = z.object({ de: text, en: text.optional() });

export const ItemSchema = z.object({
  id: id.optional(), // derived from `de` when omitted
  kind: z.enum(['noun', 'verb', 'adjective', 'adverb', 'phrase', 'sentence', 'other']).default('other'),
  de: text,
  en: text,
  article: z.enum(['der', 'die', 'das']).optional(),
  plural: z.string().trim().min(1).optional(),
  example: ExampleSchema.optional(),
  forms: z.record(z.string(), z.string()).optional(),
  /** Text actually sent to TTS, if it should differ from `de` (respelling etc.). */
  tts: z.string().trim().min(1).optional(),
  notes: z.string().optional(),
});
export type ItemInput = z.infer<typeof ItemSchema>;

// --- Exercise types. Each is a small, self-contained schema. -----------------
const base = {
  id: id.optional(),
  explanation: z.string().optional(),
  hint: z.string().optional(),
};

export const FillBlankSchema = z.object({
  ...base,
  type: z.literal('fill_blank'),
  prompt: text.refine((s) => s.includes('___'), 'prompt must contain ___'),
  answer: text,
  accept: z.array(text).default([]),
});

export const WordOrderSchema = z.object({
  ...base,
  type: z.literal('word_order'),
  prompt_en: text.optional(),
  tokens: z.array(text).min(2),
  answers: z.array(text).min(1),
});

export const TranslateSchema = z.object({
  ...base,
  type: z.literal('translate'),
  prompt: text,
  answers: z.array(text).min(1),
});

export const MultipleChoiceSchema = z
  .object({
    ...base,
    type: z.literal('multiple_choice'),
    prompt: text,
    options: z.array(text).min(2),
    correct: z.number().int().min(0),
  })
  .refine((e) => e.correct < e.options.length, {
    message: 'correct must be a valid index into options',
    path: ['correct'],
  });

/** Listening recognition: the learner hears `audio` (German) and picks what it means. */
export const ListenChooseSchema = z
  .object({
    ...base,
    type: z.literal('listen_choose'),
    audio: text,
    prompt: text.optional(),
    options: z.array(text).min(2),
    correct: z.number().int().min(0),
  })
  .refine((e) => e.correct < e.options.length, {
    message: 'correct must be a valid index into options',
    path: ['correct'],
  });

export const ExerciseSchema = z.discriminatedUnion('type', [
  FillBlankSchema,
  WordOrderSchema,
  TranslateSchema,
  MultipleChoiceSchema,
  ListenChooseSchema,
]);
export type ExerciseInput = z.infer<typeof ExerciseSchema>;
export type ExerciseType = ExerciseInput['type'];
export const EXERCISE_TYPES = ['fill_blank', 'word_order', 'translate', 'multiple_choice', 'listen_choose'] as const;

export const LessonSchema = z.object({
  schema_version: z.number().int().default(SCHEMA_VERSION),
  id,
  title: text,
  tags: z.array(z.string()).default([]),
  source: z.string().optional(),
  items: z.array(ItemSchema).default([]),
  exercises: z.array(ExerciseSchema).default([]),
});
export type LessonInput = z.infer<typeof LessonSchema>;
