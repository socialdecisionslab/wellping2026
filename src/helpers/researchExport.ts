import { AnswerSchema } from "@wellping/study-schemas/lib/schemas/Answer";
import { PingSchema } from "@wellping/study-schemas/lib/schemas/Ping";
import { z } from "zod";

const date = z.preprocess(
  (value) => (typeof value === "string" ? new Date(value) : value),
  z.date(),
);
const schema = z
  .object({
    schemaVersion: z.literal(1),
    studyId: z.string().min(1),
    participant: z
      .object({ username: z.string(), sessionId: z.string() })
      .strict(),
    pings: z.array(
      PingSchema.extend({
        notificationTime: date,
        startTime: date,
        endTime: date.nullable(),
      }),
    ),
    answers: z.array(
      z.preprocess((value) => {
        if (value && typeof value === "object" && "date" in value)
          return {
            ...value,
            date:
              typeof value.date === "string"
                ? new Date(value.date)
                : value.date,
          };
        return value;
      }, AnswerSchema),
    ),
  })
  .strict();
export type ResearchExport = z.infer<typeof schema>;
function validate(value: unknown): ResearchExport {
  try {
    const result = schema.parse(value);
    const pings = new Set<string>();
    for (const ping of result.pings) {
      if (pings.has(ping.id)) throw new Error();
      pings.add(ping.id);
    }
    const answers = new Set<string>();
    for (const answer of result.answers) {
      const key = JSON.stringify([answer.pingId, answer.questionId]);
      if (!pings.has(answer.pingId) || answers.has(key)) throw new Error();
      answers.add(key);
    }
    return result;
  } catch (_) {
    // Validation errors must not serialize participant responses or credentials.
    throw new Error(
      "Research export is invalid or incomplete; source data preserved.",
    );
  }
}
/** Explicit interchange format, not an assertion of historical parser compatibility. */
export function serializeResearchExport(value: ResearchExport): string {
  return JSON.stringify(validate(value));
}
export function parseResearchExport(raw: string): ResearchExport {
  try {
    return validate(JSON.parse(raw));
  } catch (_) {
    throw new Error(
      "Research export is invalid or incomplete; source data preserved.",
    );
  }
}
